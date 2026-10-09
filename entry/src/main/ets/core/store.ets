/**
 * ChatStore —— 会话/消息/实时进度的唯一数据源（M1）。
 *
 * 与 web 前端的对应关系（web 用 reducer 状态机，这里用命令式 store + 回调通知）：
 *   · `rows`（ChatRow）        ≈ web 的 `deriveRows(state)`：一个 turn = 1 user 行 + 1 assistant 行
 *   · `sessions`               ≈ `/api/session-tree`
 *   · live 迭代（isLive=true） ≈ web 的 live 行 + `progress_structured`
 *
 * ⚠️ M1 的取舍：live 只保留**当前迭代**（web 版有完整 live/committed 双轨与 seq 水位线，
 * 见 docs/ROADMAP.md 的 M2）。这样能先跑通"发消息 → 看到流式 → 收尾落库"的闭环。
 */
import { XbotHttp } from './http';
import { SseClient } from './sse';
import {
  ChatRow,
  HistoryData,
  HistoryIteration,
  HistoryMessage,
  ProgressEvent,
  SessionEvent,
  SessionItem,
  SessionTreeData,
  SseEnvelope,
  SseEventType,
  ToolProgress,
} from './types';

export class ChatStore {
  http: XbotHttp;
  sse: SseClient;
  channel: string = 'web';

  sessions: SessionItem[] = [];
  rows: ChatRow[] = [];
  busy: boolean = false;
  currentChatId: string = '';
  lastSeq: number = 0;
  /** 变更通知（页面把它接到 @State 上）。 */
  onUpdate: () => void = () => {
  };

  constructor(baseUrl: string) {
    this.http = new XbotHttp(baseUrl);
    this.sse = new SseClient(baseUrl);
  }

  // ── 会话 ───────────────────────────────────────────────────────────────────

  async loadSessions(): Promise<void> {
    const data: SessionTreeData = await this.http.postAs<SessionTreeData>(
      '/api/session-tree', new EmptyBody());
    const list: SessionItem[] = data.sessions !== undefined && data.sessions.length > 0
      ? data.sessions
      : (data.chats !== undefined ? data.chats : []);
    this.sessions = list;
    this.onUpdate();
  }

  async createSession(): Promise<void> {
    const created: SessionItem = await this.http.postAs<SessionItem>(
      '/api/chats/create', new ChannelBody(this.channel));
    await this.loadSessions();
    if (created.chat_id !== undefined && created.chat_id.length > 0) {
      await this.openSession(created.chat_id);
    }
  }

  async openSession(chatId: string): Promise<void> {
    this.currentChatId = chatId;
    this.lastSeq = 0;
    this.rows = [];
    this.busy = false;
    this.onUpdate();
    await this.loadHistory();
    this.subscribe();
  }

  async loadHistory(): Promise<void> {
    const data: HistoryData = await this.http.postAs<HistoryData>('/api/history', new HistoryBody(
      this.channel, this.currentChatId, 30, 0));
    this.rows = ChatStore.rowsFromHistory(
      data.messages !== undefined ? data.messages : []);
    const ap: ProgressEvent | undefined = data.active_progress;
    if (ap !== undefined && ap.busy === true) {
      this.busy = true;
      this.applyProgress(ap);
    }
    if (data.last_seq !== undefined) {
      this.lastSeq = data.last_seq;
    }
    this.onUpdate();
  }

  /** 历史 → 渲染行（与 web 同构：每 turn 取**第一条 user** + 最后一条 assistant）。 */
  static rowsFromHistory(messages: HistoryMessage[]): ChatRow[] {
    const out: ChatRow[] = [];
    let current: ChatRow | null = null;
    for (let i = 0; i < messages.length; i++) {
      const m: HistoryMessage = messages[i];
      const turnID: number = m.turn_id !== undefined ? m.turn_id : 0;
      if (m.role === 'user') {
        const r: ChatRow = new ChatRow();
        r.id = `u-${m.id}`;
        r.role = 'user';
        r.turnID = turnID;
        r.content = m.content !== undefined ? m.content : '';
        out.push(r);
        current = null;
      } else if (m.role === 'assistant') {
        if (current === null || current.turnID !== turnID) {
          const r: ChatRow = new ChatRow();
          r.id = `a-${m.id}`;
          r.role = 'assistant';
          r.turnID = turnID;
          r.content = m.content !== undefined ? m.content : '';
          r.iterations = m.iterations !== undefined ? m.iterations : [];
          out.push(r);
          current = r;
        } else {
          // 同一 turn 的多条 assistant：后面的覆盖（回复在最后一条）
          current.content = m.content !== undefined ? m.content : current.content;
          if (m.iterations !== undefined && m.iterations.length > 0) {
            current.iterations = m.iterations;
          }
        }
      }
    }
    return out;
  }

  /** 追加一条本地 user 行（乐观渲染，随后由 user_echo 去重）。 */
  private appendLocalUser(text: string): void {
    const r: ChatRow = new ChatRow();
    r.id = `local-${Date.now()}`;
    r.role = 'user';
    r.turnID = 0;
    r.content = text;
    this.rows.push(r);
    this.onUpdate();
  }

  private liveRow(): ChatRow {
    const last: ChatRow | undefined = this.rows.length > 0 ? this.rows[this.rows.length - 1] : undefined;
    if (last !== undefined && last.role === 'assistant' && last.isLive) {
      return last;
    }
    const r: ChatRow = new ChatRow();
    r.id = 'live';
    r.role = 'assistant';
    r.isLive = true;
    this.rows.push(r);
    return r;
  }

  // ── 发送 / 取消 ────────────────────────────────────────────────────────────

  async send(text: string): Promise<void> {
    this.appendLocalUser(text);
    this.busy = true;
    this.onUpdate();
    await this.http.post('/api/message', new MessageBody(
      this.channel, this.currentChatId, text, 0));
  }

  async cancel(): Promise<void> {
    await this.http.post('/api/cancel', new ChannelBody(this.channel, this.currentChatId));
  }

  // ── SSE ────────────────────────────────────────────────────────────────────

  subscribe(): void {
    if (this.currentChatId.length === 0) {
      return;
    }
    this.sse.connect(this.currentChatId, this.channel, this.cookieHeader(), (event: string, data: string) => {
      this.onSse(event, data);
    });
  }

  private cookieHeader(): string {
    // XbotHttp 内部持有 cookie jar；SSE 需要原始 Cookie 头
    return this.http.cookieHeaderForStream();
  }

  private onSse(event: string, data: string): void {
    let env: SseEnvelope;
    try {
      env = JSON.parse(data) as SseEnvelope;
    } catch (e) {
      return;
    }
    // ArkTS：case 标签需常量表达式 ⇒ 用 if/else 链（语义相同）
    if (event === SseEventType.heartbeat) {
      return;
    }
    if (event === SseEventType.session) {
      this.onSessionEvent(env.session);
      return;
    }
    if (event === SseEventType.userEcho) {
      this.onUserEcho(env);
      return;
    }
    if (event === SseEventType.progressStructured || event === SseEventType.streamContent) {
      if (env.progress !== undefined) {
        this.applyProgress(env.progress);
      }
      return;
    }
    if (event === SseEventType.text) {
      this.onFinalText(env);
      return;
    }
    if (event === SseEventType.resyncRequired) {
      // 服务端环形缓冲已淘汰 ⇒ 必须回退到 DB 权威快照（web 同款语义）
      this.loadHistory().catch((e: Error) => {
        console.error(`resync 失败: ${e.message}`);
      });
    }
  }

  private onSessionEvent(ev: SessionEvent | undefined): void {
    if (ev === undefined) {
      return;
    }
    const state: string = ev.state !== undefined ? ev.state : '';
    if (state === 'idle' || state === 'agent-idle') {
      this.busy = false;
      this.onUpdate();
    } else if (state === 'busy' || state === 'agent-busy') {
      this.busy = true;
      this.onUpdate();
    }
  }

  private onUserEcho(env: SseEnvelope): void {
    const text: string = env.content !== undefined ? env.content : '';
    const turnID: number = env.turn_id !== undefined ? env.turn_id : 0;
    // 乐观行去重：最后一条本地 user 行内容相同 → 就地转正（拿服务端 turn_id）
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r: ChatRow = this.rows[i];
      if (r.role === 'user' && r.turnID === 0 && r.content === text) {
        r.turnID = turnID;
        this.busy = true;
        this.onUpdate();
        return;
      }
    }
    const r: ChatRow = new ChatRow();
    r.id = `echo-${turnID}-${this.rows.length}`;
    r.role = 'user';
    r.turnID = turnID;
    r.content = text;
    this.rows.push(r);
    this.busy = true;
    this.onUpdate();
  }

  /** 结构化进度：seq 是 per-Run 水位线（丢弃重放）。 */
  private applyProgress(p: ProgressEvent): void {
    const seq: number = p.seq !== undefined ? p.seq : 0;
    if (seq > 0 && seq <= this.lastSeq) {
      return;
    }
    if (seq > 0) {
      this.lastSeq = seq;
    }
    if (p.streaming !== undefined) {
      this.busy = p.streaming ? true : this.busy;
    }
    const it: number = p.iteration !== undefined ? p.iteration : 0;
    const row: ChatRow = this.liveRow();
    const iter: HistoryIteration = ChatStore.progressToIteration(p, it);
    // 同号迭代覆盖（append-only，与 web 的 union-by-iteration 同语义）
    let replaced: boolean = false;
    for (let i = 0; i < row.iterations.length; i++) {
      if (row.iterations[i].iteration === it) {
        row.iterations[i] = iter;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      row.iterations.push(iter);
    }
    const hist: HistoryIteration[] | undefined = p.iteration_history;
    if (hist !== undefined) {
      for (let i = 0; i < hist.length; i++) {
        const h: HistoryIteration = hist[i];
        let found: boolean = false;
        for (let j = 0; j < row.iterations.length; j++) {
          if (row.iterations[j].iteration === h.iteration) {
            row.iterations[j] = h;
            found = true;
            break;
          }
        }
        if (!found) {
          row.iterations.push(h);
        }
      }
    }
    this.onUpdate();
  }

  private static progressToIteration(p: ProgressEvent, iterNo: number): HistoryIteration {
    const it: HistoryIteration = {
      iteration: iterNo,
      content: p.content !== undefined ? p.content : '',
      reasoning: p.reasoning !== undefined ? p.reasoning : '',
      tools: p.tools !== undefined ? p.tools : [],
    };
    return it;
  }

  /** 最终回复（消息路径）：把 live 行固化为 committed 行。 */
  private onFinalText(env: SseEnvelope): void {
    const text: string = env.content !== undefined ? env.content : '';
    if (this.rows.length === 0) {
      return;
    }
    const last: ChatRow = this.rows[this.rows.length - 1];
    if (last.role === 'assistant') {
      last.content = text.length > 0 ? text : last.content;
      last.isLive = false;
      last.id = `a-${env.turn_id !== undefined ? env.turn_id : last.turnID}`;
      last.turnID = env.turn_id !== undefined ? env.turn_id : last.turnID;
    } else {
      const r: ChatRow = new ChatRow();
      r.id = `a-${env.turn_id !== undefined ? env.turn_id : 0}`;
      r.role = 'assistant';
      r.turnID = env.turn_id !== undefined ? env.turn_id : 0;
      r.content = text;
      this.rows.push(r);
    }
    this.busy = false;
    this.onUpdate();
  }
}

// ── 请求体小类型（显式 > 隐式：字段名即协议） ─────────────────────────────────

export class EmptyBody {
}

export class ChannelBody {
  channel: string;
  chat_id?: string;

  constructor(channel: string, chatId?: string) {
    this.channel = channel;
    this.chat_id = chatId;
  }
}

export class HistoryBody {
  channel: string;
  chat_id: string;
  limit: number;
  before_id: number;

  constructor(channel: string, chatId: string, limit: number, beforeId: number) {
    this.channel = channel;
    this.chat_id = chatId;
    this.limit = limit;
    this.before_id = beforeId;
  }
}

export class MessageBody {
  channel: string;
  chat_id: string;
  content: string;
  turn_id: number;

  constructor(channel: string, chatId: string, content: string, turnId: number) {
    this.channel = channel;
    this.chat_id = chatId;
    this.content = content;
    this.turn_id = turnId;
  }
}

/** 供 UI 复用：把工具数组渲染成一行摘要。 */
export function toolsSummary(tools: ToolProgress[]): string {
  const names: string[] = [];
  for (let i = 0; i < tools.length; i++) {
    names.push(tools[i].name);
  }
  return names.join(' · ');
}
