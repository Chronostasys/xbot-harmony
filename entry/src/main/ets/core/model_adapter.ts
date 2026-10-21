/**
 * core/model/adapter.ts —— **老 wire → 新模型**的适配层（纯 TS）。
 *
 * 为什么需要：后端协议（`docs/STATE-MODEL.md` §2.1）尚未上线时，线上的 15 种 `DomainEvent`
 * 必须被翻译成模型的 6 种帧 + 本机意图。翻译是**形状转换**（无判据、无去重、无合并）：
 *   · `turn_started`        → `open`
 *   · `iteration` / `stream` → `tick`（老 wire 的正文是**全量累积** ⇒ `{kind:'full'}`）
 *                              + 该帧携带的 `iterationsDelta`/`finalIteration` → **逐条** `done`
 *   · `phase_done`          → `done`（若带 finalIteration）+ `session`（todos/goal）
 *   · `text_final`          → `final`（命令回复 → `standalone`，不进 turn）
 *   · `session` / `session_running` → `session`
 *   · `session_fields`      → `session`
 *   · `queue_state`         → `session{queue}`
 *   · `user_sent/echo/ack/fail` → 本机意图 `send/ack/fail`
 *   · `history_replaced` / `iterations_loaded` → **水合**（不是帧）：由 `hydrate.ts` 直接构造权威 State
 *
 * ⛔ 适配层**只做搬运**：不合并、不去重、不比较内容 —— 所有判据都在 `step.ts` 一处。
 */
import type { AckIntent, Block, DoneFrame, FailIntent, FinalFrame, Frame, IterNum, OpenFrame, SendIntent,
  SessionFrame, State, SubAgentNode, TextPatch, TickFrame, ToolMeta, ToolRec, ToolStatus, ToolTick, TurnID,
  TurnRec, UserLine, LegacyLine, Compaction } from './model_types';
import { newTurn } from './model_types';

// ─── 老 wire 的最小结构面（结构化类型；避免 import 旧类型文件造成的循环）──

interface WireTool {
  readonly name: string;
  readonly label?: string;
  readonly status?: string;
  readonly elapsedMs?: number;
  readonly exitCode?: number;
  readonly genChars?: number;
  readonly call_id?: string;
  readonly callID?: string;
  readonly iteration?: number;
  readonly uiMode?: string;
  readonly uiLibs?: string;
  readonly toolHints?: string;
  readonly args?: string;
  readonly detail?: string;
  readonly summary?: string;
}

interface WireIteration {
  readonly iteration: number;
  readonly content?: string;
  readonly reasoning?: string;
  readonly tools?: readonly WireTool[];
  readonly subAgents?: readonly SubAgentNode[];
  readonly genui?: string;
  readonly toolsFolded?: boolean;
}

interface WireLive {
  readonly iter: number;
  readonly streaming: boolean;
  readonly progressPhase?: string;
  readonly content: string;
  readonly reasoning: string;
  readonly iterations: readonly WireIteration[];
  readonly activeTools: readonly WireTool[];
  readonly streamingTools: readonly WireTool[];
  readonly completedTools?: readonly WireTool[];
  readonly genui: string;
  readonly subAgents?: readonly SubAgentNode[];
  readonly tokenUsage?: unknown;
  readonly streamStats?: unknown;
}

interface WireUser {
  readonly id: string;
  readonly content: string;
  readonly timestamp: string;
  readonly isNotification: boolean;
  readonly queued: boolean;
  readonly sending: boolean;
  readonly requestID: string | null;
  readonly dbID?: number;
}

/** 事件信封（只用到这些字段；判别用 `type`）。 */
export interface WireEvent {
  readonly type: string;
  readonly seq?: number | null;
  readonly turnID?: number | null;
  readonly iter?: number | null;
  readonly phase?: string;
  readonly content?: string | undefined | null;
  readonly reasoning?: string | undefined;
  readonly iterationsDelta?: readonly WireIteration[];
  readonly finalIteration?: WireIteration | null;
  readonly activeTools?: readonly WireTool[];
  readonly completedTools?: readonly WireTool[];
  readonly streamingTools?: readonly WireTool[] | undefined;
  readonly genui?: string | undefined;
  readonly todos?: readonly string[] | undefined;
  readonly goal?: { readonly objective: string; readonly status: string; readonly summary?: string } | null | undefined;
  readonly running?: boolean;
  readonly busy?: boolean;
  readonly trigger?: string;
  readonly requestID?: string | null;
  readonly row?: WireUser;
  readonly cancelled?: boolean;
  readonly commandReply?: boolean;
  readonly progressHistory?: readonly WireIteration[];
  readonly stats?: unknown;
  readonly usage?: unknown;
}

const NO_TOOLS: readonly ToolRec[] = [];

function statusOf(s: string | undefined): ToolStatus {
  if (s === 'done' || s === 'error') return 'done';
  if (s === 'failed') return 'failed';
  if (s === 'running') return 'running';
  if (s === 'generating') return 'generating';
  return 'pending';
}

/** 线格式工具 → 模型工具（身份只认 `callID`；缺 id 时用**位置**兜底 `iter#idx`，不猜内容）。 */
function toToolRec(t: WireTool, iteration: IterNum, idx: number): ToolRec {
  const rawCall: string | undefined = t.call_id !== undefined && t.call_id !== ''
    ? t.call_id : (t.callID !== undefined && t.callID !== '' ? t.callID : undefined);
  const call: string = rawCall !== undefined ? rawCall : `${iteration}#${idx}`;
  const meta: ToolMeta = {
    name: t.name,
    uiMode: t.uiMode,
    uiLibs: t.uiLibs,
    toolHints: t.toolHints,
    args: t.args,
    detail: t.detail,
    summary: t.summary,
  };
  return {
    call,
    iteration,
    meta,
    state: {
      status: statusOf(t.status),
      label: t.label !== undefined ? t.label : t.name,
      genChars: t.genChars !== undefined ? t.genChars : 0,
      elapsedMs: t.elapsedMs !== undefined ? t.elapsedMs : 0,
      exitCode: t.exitCode,
    },
  };
}

function toToolRecs(list: readonly WireTool[] | undefined, iteration: IterNum): readonly ToolRec[] {
  if (list === undefined || list.length === 0) return NO_TOOLS;
  const out: ToolRec[] = [];
  for (let i = 0; i < list.length; i++) out.push(toToolRec(list[i], iteration, i));
  return out;
}

/** 线格式迭代 → 提交块（工具号**一律盖成块号**：T5-c）。 */
function toBlock(w: WireIteration): Block {
  return {
    iteration: w.iteration,
    content: w.content !== undefined ? w.content : '',
    reasoning: w.reasoning !== undefined ? w.reasoning : '',
    tools: toToolRecs(w.tools, w.iteration),
    subAgents: w.subAgents !== undefined ? w.subAgents : [],
    genui: w.genui !== undefined ? w.genui : '',
    cancelled: false,
  };
}

/** 线格式 user → 模型 user 行。 */
function toUser(u: WireUser): UserLine {
  return {
    id: u.id, content: u.content, timestamp: u.timestamp, isNotification: u.isNotification,
    queued: u.queued, sending: u.sending, requestID: u.requestID, dbID: u.dbID,
  };
}

function fullText(t: string | undefined | null): TextPatch {
  return { kind: 'full', text: t === undefined || t === null ? '' : t };
}

/**
 * 把一个老事件翻译成 0..n 个模型输入（帧/意图）。纯函数、无状态。
 * ⛔ 不消费 `stats/usage` 的具体形状（`unknown` ⇒ 保持 undefined），由驱动层按需透传。
 */
export function adapt(ev: WireEvent, chat: string, epoch: number): readonly (Frame | SendIntent | AckIntent | FailIntent)[] {
  // ⛔ `seq` 是 **transport** 序号（每帧必有）。缺 seq 的输入（demo / 本地合成 / 部分测试）
  //   不得伪造 0 —— 否则会与真实水位冲突（`seq < last ⇒ 丢弃`），把 `text_final` 当迟到帧丢掉。
  //   用 -1 表示"无信封"：`step` 对它跳过 seq 守卫、不推进水位。
  const seq: number = ev.seq !== undefined && ev.seq !== null ? ev.seq : -1;
  switch (ev.type) {
    case 'turn_started': {
      const turn: TurnID = ev.turnID !== undefined && ev.turnID !== null ? ev.turnID : 0;
      if (turn <= 0) return [];
      const trigger: string = ev.trigger !== undefined ? ev.trigger : 'user';
      const content: string = ev.content !== undefined && ev.content !== null ? ev.content : '';
      const user: UserLine = {
        id: `turn-${turn}-user`, content, timestamp: '', isNotification: trigger === 'notification',
        queued: false, sending: false, requestID: ev.requestID !== undefined ? ev.requestID : null,
      };
      const out: (Frame | SendIntent | AckIntent | FailIntent)[] = [];
      // 会话级字段随 open 到达（与老语义一致：turn_started 携带 todos/goal）
      if (ev.todos !== undefined || ev.goal !== undefined) {
        out.push({
          kind: 'session', epoch, seq, chat,
          todos: ev.todos, goal: ev.goal,
        } as SessionFrame);
      }
      out.push({ kind: 'open', epoch, seq, chat, turn, user, requestID: user.requestID } as OpenFrame);
      return out;
    }
    case 'iteration':
    case 'stream': {
      const turn: TurnID = ev.turnID !== undefined && ev.turnID !== null ? ev.turnID : 0;
      const iteration: number = ev.iter !== undefined && ev.iter !== null ? ev.iter : 0;
      const out: (Frame | SendIntent | AckIntent | FailIntent)[] = [];
      if (ev.todos !== undefined || ev.goal !== undefined) {
        out.push({ kind: 'session', epoch, seq, chat, todos: ev.todos, goal: ev.goal } as SessionFrame);
      }
      if (turn > 0 && iteration > 0) {
        const tools: ToolTick[] = [];
        const push = (list: readonly WireTool[] | undefined): void => {
          if (list === undefined) return;
          for (let i = 0; i < list.length; i++) {
            const r = toToolRec(list[i], iteration, i);
            tools.push({ call: r.call, iteration, state: r.state, meta: r.meta });
          }
        };
        push(ev.streamingTools);
        push(ev.activeTools);
        push(ev.completedTools);
        out.push({
          kind: 'tick', epoch, seq, chat, turn, iteration,
          phase: ev.phase !== undefined ? ev.phase : 'thinking',
          streaming: true,
          content: fullText(ev.content),
          reasoning: fullText(ev.reasoning),
          tools,
          genui: ev.genui !== undefined ? ev.genui : '',
        } as TickFrame);
      }
      // 该帧携带的**已完成迭代** ⇒ 逐条 `done`（老 wire 的"增量"在这里被摊平成位置状态）
      const doneIts: readonly WireIteration[] = ev.iterationsDelta !== undefined ? ev.iterationsDelta : [];
      for (let i = 0; i < doneIts.length; i++) {
        out.push({ kind: 'done', epoch, seq, chat, turn, block: toBlock(doneIts[i]) } as DoneFrame);
      }
      if (ev.finalIteration !== undefined && ev.finalIteration !== null) {
        out.push({ kind: 'done', epoch, seq, chat, turn, block: toBlock(ev.finalIteration) } as DoneFrame);
      }
      return out;
    }
    case 'phase_done': {
      const turn: TurnID = ev.turnID !== undefined && ev.turnID !== null ? ev.turnID : 0;
      const out: (Frame | SendIntent | AckIntent | FailIntent)[] = [];
      if (ev.todos !== undefined || ev.goal !== undefined) {
        out.push({ kind: 'session', epoch, seq, chat, todos: ev.todos, goal: ev.goal } as SessionFrame);
      }
      if (turn > 0 && ev.finalIteration !== undefined && ev.finalIteration !== null) {
        out.push({ kind: 'done', epoch, seq, chat, turn, block: toBlock(ev.finalIteration) } as DoneFrame);
      }
      return out;
    }
    case 'text_final': {
      const turn: TurnID = ev.turnID !== undefined && ev.turnID !== null ? ev.turnID : 0;
      const content: string = ev.content !== undefined && ev.content !== null ? ev.content : '';
      if (turn <= 0) return [];      // 命令回复：由驱动层写 standalone（见 `commandLine`）
      const blocks: Block[] = [];
      const hist: readonly WireIteration[] = ev.progressHistory !== undefined ? ev.progressHistory : [];
      for (let i = 0; i < hist.length; i++) blocks.push(toBlock(hist[i]));
      return [{
        kind: 'final', epoch, seq, chat, turn, content,
        cancelled: ev.cancelled === true,
        phase: 'done',
        blocks: blocks.length > 0 ? blocks : undefined,
      } as FinalFrame];
    }
    case 'session':
    case 'session_running': {
      const running: boolean | undefined = ev.type === 'session_running' ? ev.running : (ev.busy === true ? true : false);
      return [{ kind: 'session', epoch, seq, chat, running } as SessionFrame];
    }
    case 'session_fields': {
      return [{ kind: 'session', epoch, seq, chat, todos: ev.todos, goal: ev.goal } as SessionFrame];
    }
    case 'queue_state': {
      return [];    // 队列形状由驱动层直写（`string[]` 视图与老 `QueueItemPayload[]` 不同）
    }
    case 'user_sent': {
      return ev.row !== undefined ? [{ kind: 'send', row: toUser(ev.row) } as SendIntent] : [];
    }
    case 'user_echo': {
      return ev.row !== undefined ? [{ kind: 'send', row: toUser(ev.row) } as SendIntent] : [];
    }
    case 'user_ack': {
      const requestID: string = ev.requestID !== undefined && ev.requestID !== null ? ev.requestID : '';
      if (requestID === '') return [];
      const how: 'delivered' | 'queued' | 'command' = ev.commandReply === true ? 'command' : 'delivered';
      return [{ kind: 'ack', requestID, how, turn: ev.turnID !== undefined && ev.turnID !== null ? ev.turnID : undefined } as AckIntent];
    }
    case 'user_fail': {
      const requestID: string = ev.requestID !== undefined && ev.requestID !== null ? ev.requestID : '';
      return requestID === '' ? [] : [{ kind: 'fail', requestID } as FailIntent];
    }
    default:
      return [];
  }
}
