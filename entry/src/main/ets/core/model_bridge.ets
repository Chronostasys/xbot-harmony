/**
 * core/model_bridge.ets —— 模型 → 渲染行（`ChatRow`）的**唯一适配**（ArkTS 侧）。
 *
 * ⛔ 为什么是 `.ets`：`ChatRow` / `HistoryIteration` / `ToolProgress` 都定义在 `.ets` 里，
 *   而 **`core/*.ts` 不许 import `.ets`**（ArkTS 硬红 10605999）⇒ 适配层必须落在 ArkTS 侧。
 *
 * 纪律（`docs/STATE-MODEL.md` §3.7）：
 *   · 只做**形状映射**：无判据、无去重、无合并（语义全在 `model_step.ts`）；
 *   · 按**源对象恒等**记忆化（`Block`/`ToolRec`/`PRow` ⇒ 同一个 `HistoryIteration`/`ToolProgress`），
 *     未变化的行/块 ⇒ 引用不变 ⇒ 组件零重建（不需要任何字符串指纹）。
 */
import { ChatRow, HistoryIteration, ToolProgress } from './types';
import { syncRowBlocks } from './render';
import { WebCompaction } from './chattypes';
import type { WebIteration, WebSubAgentProgress } from './chattypes';
import type { DomainEvent, LegacyRow, Turn } from './chat_types_full';
import type { PRow, PAssistantRow, PUserRow } from './model_project';
import type { Block } from './model_types';
import type { State, ToolRec, SubAgentNode, TurnID, TurnRec } from './model_types';
import type { Effect } from './model_types';
import type { WireCompaction, WireHistoryIteration, WireHistoryMessage } from './model_hydrate';
import { project } from './model_project';
import { adapt } from './model_adapter';
import { stepAll } from './model_step';
import { hydrate } from './model_hydrate';

/** `ToolRec` → `ToolProgress`（按源对象记忆化）。 */
const toolByRec: WeakMap<Object, ToolProgress> = new WeakMap<Object, ToolProgress>();

export function toToolProgress(t: ToolRec): ToolProgress {
  const hit: ToolProgress | undefined = toolByRec.get(t as Object);
  if (hit !== undefined) {
    return hit;
  }
  const out: ToolProgress = {
    name: t.meta.name,
    label: t.state.label,
    status: t.state.status,
    elapsed_ms: t.state.elapsedMs,
    summary: t.meta.summary,
    detail: t.meta.detail,
    args: t.meta.args,
    call_id: t.call,
    iteration: t.iteration,
    ui_mode: t.meta.uiMode,
    gen_chars: t.state.genChars,
    tool_hints: t.meta.toolHints,
  };
  toolByRec.set(t as Object, out);
  return out;
}

let revCounter: number = 0;
const blockByBlock: WeakMap<Object, HistoryIteration> = new WeakMap<Object, HistoryIteration>();

/** `SubAgentNode` → `WebSubAgentProgress`（按源对象记忆化；子代理树逐层搬运）。 */
const subByNode: WeakMap<Object, WebSubAgentProgress> = new WeakMap<Object, WebSubAgentProgress>();

export function toSubAgentProgress(n: SubAgentNode): WebSubAgentProgress {
  const hit: WebSubAgentProgress | undefined = subByNode.get(n as Object);
  if (hit !== undefined) {
    return hit;
  }
  const out: WebSubAgentProgress = {
    role: n.role,
    instance: n.instance,
    status: n.status,
    desc: n.desc,
    iteration: n.iteration,
  };
  const kids: readonly SubAgentNode[] = n.children !== undefined ? n.children : [];
  if (kids.length > 0) {
    const cs: WebSubAgentProgress[] = [];
    for (let i = 0; i < kids.length; i++) {
      cs.push(toSubAgentProgress(kids[i]));
    }
    out.children = cs;
  }
  subByNode.set(n as Object, out);
  return out;
}

/** `Block` → `HistoryIteration`（**一块一迭代**；按源对象恒等）。
 *
 *  `live=true` 只给 **在飞块**（`PAssistantRow.inflight`）：页面 `syncLiveTail` 靠
 *  `iterations[i].live === true` 找到它并把正文/思考/工具投递给打字机
 *  （`Index.ets:10320-10341`）。⛔ 漏这个标记 ⇒ 流式内容只在收尾时出现（无打字机）。 */
export function toHistoryIteration(b: Block, live: boolean = false): HistoryIteration {
  const hit: HistoryIteration | undefined = blockByBlock.get(b as Object);
  if (hit !== undefined) {
    return hit;
  }
  const tools: ToolProgress[] = [];
  for (let i = 0; i < b.tools.length; i++) {
    tools.push(toToolProgress(b.tools[i]));
  }
  const out: HistoryIteration = {
    iteration: b.iteration,
    content: b.content,
    reasoning: b.reasoning,
    tools,
    tools_folded: false,
    rev: ++revCounter,
  };
  if (live) {
    out.live = true;
  }
  if (b.subAgents.length > 0) {
    const subs: WebSubAgentProgress[] = [];
    for (let i = 0; i < b.subAgents.length; i++) {
      subs.push(toSubAgentProgress(b.subAgents[i]));
    }
    out.subAgents = subs;
  }
  blockByBlock.set(b as Object, out);
  return out;
}

function toHistoryIterations(bs: readonly Block[]): HistoryIteration[] {
  const out: HistoryIteration[] = [];
  for (let i = 0; i < bs.length; i++) {
    out.push(toHistoryIteration(bs[i]));
  }
  return out;
}

// ─── 帧 → 模型：**唯一入口** ────────────────────────────────────────────────
// 实时喂帧（store）与录制重放（pages/SseReplay）必须走同一个函数，否则
// 「重放看起来对、真机不对」这类分歧无法归因。

function wireIters(its: readonly WebIteration[]): WireHistoryIteration[] {
  const out: WireHistoryIteration[] = [];
  for (let i = 0; i < its.length; i++) {
    out.push({
      iteration: its[i].iteration,
      content: its[i].content,
      reasoning: its[i].reasoning,
      tools: its[i].tools,
      // ⛔ 子代理树必须一起水合：历史重载后卡片不能凭空消失（逐迭代冻结，与 web 同源）。
      subAgents: its[i].subAgents,
    });
  }
  return out;
}

/** `history_replaced` → 水合输入（结构面：committed/live 都摊平成块，live 身份由 `active` 表达）。 */
export function historyEventToWire(ev: DomainEvent): WireHistoryMessage[] {
  const out: WireHistoryMessage[] = [];
  if (ev.type !== 'history_replaced') {
    return out;
  }
  const legacy: readonly LegacyRow[] = ev.legacy !== undefined ? ev.legacy : [];
  for (let i = 0; i < legacy.length; i++) {
    const l: LegacyRow = legacy[i];
    out.push({
      id: l.id, role: l.role, content: l.content,
      iterations: wireIters(l.iterations),
      timestamp: l.timestamp, dbID: l.dbID,
      regionsBefore: l.regionsBefore,
      // ⛔ 无 turn 行的身份/锚点（`!cmd` 命令输出、压缩标记回落形态）——丢这两个字段会让
      //   `hydrate` 把命令输出画成 user 气泡、把压缩标记挂到 turn 0 而整段消失。
      standalone: l.standalone,
      anchorTurnID: l.anchorTurnID,
    });
  }
  const turns: readonly Turn[] = ev.turns !== undefined ? ev.turns : [];
  for (let i = 0; i < turns.length; i++) {
    const t: Turn = turns[i];
    if (t.user !== undefined && t.user !== null) {
      out.push({
        id: `turn-${t.id}-user`, role: 'user', content: t.user.content, turnID: t.id,
        timestamp: t.user.timestamp, isNotification: t.user.isNotification,
      });
    }
    const its: readonly WebIteration[] = t.phase.kind === 'committed'
      ? t.phase.payload.iterations : t.phase.data.iterations;
    const text: string = t.phase.kind === 'committed' ? t.phase.payload.content : t.phase.data.content;
    const rb: number | undefined = t.phase.kind === 'committed' ? t.phase.payload.regionsBefore : undefined;
    // ⛔ **turn 内压缩点必须搬**（用户 2026-11-20）：`/api/history` 唯一的压缩下发通道就是
    //   这条字段；在此丢弃 ⇒ `TurnRec.compactions` 恒空 ⇒ 界面永远没有「上下文已压缩」胶囊。
    // `compactions` 只存在于 committed/fold 的 payload（`LiveSnapshot` 没有该字段）。
    // `compactions` 只存在于 committed/fold 的 payload（`LiveSnapshot` 没有该字段）。
    const compsSrc: readonly WebCompaction[] | undefined = t.phase.kind === 'committed'
      ? t.phase.payload.compactions : undefined;
    const wireComps: WireCompaction[] = [];
    if (compsSrc !== undefined) {
      for (let ci = 0; ci < compsSrc.length; ci++) {
        const cc: string | undefined = compsSrc[ci].content;
        wireComps.push({ after_iteration: compsSrc[ci].afterIteration, content: cc !== undefined && cc !== null ? cc : '' });
      }
    }
    out.push({
      id: `turn-${t.id}-assistant`, role: 'assistant', content: text, turnID: t.id,
      iterations: wireIters(its), regionsBefore: rb,
      compactions: wireComps.length > 0 ? wireComps : undefined,
    });
  }
  return out;
}

/**
 * 快照是否**落后于本地状态**（单调性判据：回合不丢、同回合块数不减）。
 *
 * ⛔ 为什么必须有（用户 2026-10-22 P0）：「终止 turn 后发新消息 ⇒ 被终止 turn 的 agent 消息
 *   消失几秒又出现」。这是**过时快照整表替换**造成的缩表：cancel 之后 `send` 触发的 resync
 *   可能拿到 cancel 之前抓的快照（缺该 turn 的 assistant 块）。
 *   历史是权威，但权威**不能倒退**（append-only：回合单调增、同回合块数单调不减）⇒
 *   落后的快照必须**丢弃**，等下一份更新的。
 * ⛔ 判据只用**结构**（回合是否出现、块数是否减少），不比内容、不比字符串。
 * ⛔ 这里**不做合并**（合并会让本地与权威分叉 = 补丁）；丢弃是 fail-safe：不刷新也不缩表。
 * ⛔ 唯一允许"缩表"的路径是**显式破坏性重置**（rewind / 切会话）：那条路径由
 *   `store.resetStateMachine()` 清空模型影子（`st.turns.size === 0`）⇒ 本判据不生效。
 */
export function isStaleSnapshot(st: State, wire: readonly WireHistoryMessage[]): boolean {
  if (st.turns.size === 0) {
    return false;
  }
  // ⛔ **只按回合单调性判落后**（用户 2026-10-28 P-1：「别的端看得到的消息我们看不到」）。
  //   旧实现还比较"每回合块数是否减少"，但块数**不可靠**：
  //     · `/api/history` 是窗口化的（100 条 / 上拉分页），快照天然比本地少块；
  //     · 服务端压缩/区域滚动会让块数变少；
  //     · 本地 `onFinal` 的并集、`pending` 落地都会抬高块数。
  //   ⇒ 一旦本地块数多于服务端，**之后每一份权威快照都被判"落后"并整份丢弃** ⇒
  //     别的端的消息永远进不来（永久卡死，正是本次 P-1 的形态）。
  //   ⇒ 新判据只看"谁更新"：快照最新回合 **<** 本地最新回合，且本地最新回合**已收尾** ⇒ 落后；
  //     其余一律接受（宁可让权威快照覆盖，也不要卡死在旧状态）。
  let incMaxTurn: number = 0;
  const incTurns: Set<number> = new Set<number>();
  for (let i = 0; i < wire.length; i++) {
    const tid: number = wire[i].turnID !== undefined && wire[i].turnID !== null
      ? (wire[i].turnID as number) : 0;
    if (tid <= 0) {
      continue;
    }
    incTurns.add(tid);
    if (tid > incMaxTurn) {
      incMaxTurn = tid;
    }
  }
  if (incTurns.size === 0) {
    // 只有 turn<=0 的 legacy 行（DB 截断/老会话）：无法判断新旧 ⇒ 接受
    return false;
  }
  let maxLocal: number = 0;
  st.turns.forEach((_t: TurnRec, id: number) => {
    if (id > maxLocal) {
      maxLocal = id;
    }
  });
  if (incMaxTurn >= maxLocal) {
    return false;   // 快照不旧于本地 ⇒ 接受
  }
  const latest: TurnRec | undefined = st.turns.get(maxLocal);
  if (latest !== undefined && latest.final === null) {
    // 本地最新回合**仍在跑**（还没落库）⇒ 快照只是还没看到它 ⇒ 接受
    return false;
  }
  // 快照确实更旧（最新回合更小、本地最新已收尾）⇒ 丢弃，避免回退
  return true;
}

/**
 * **收尾帧的回合归属**（`text_final` 缺 turn_id 时的唯一判据）。
 *
 * ⛔ 为什么需要（用户 2026-10-22 P0「cancel 后发新消息 ⇒ 历史变成 user1 user2 +
 *   iter1-20 busy」）：cancel ack 的 `OutboundMsg` **不带 `TurnID`**
 *   （`agent/agent_process.go:handleCancelledRun`）⇒ SSE 载荷里 `turn_id` 缺省
 *   （字段 `omitempty`；载荷结构沿用后端 `WSMessage`）⇒ `normalizeText` 给 `turnID: null`。模型若把它当"命令回复"丢弃，被取消的那一轮
 *   **永远没有 `final`** ⇒ 行恒 `turn-N-live`（`finalized=false` ⇒ `isLive=true`）
 *   ⇒ 页面把这条"在飞"行抽出列表末尾当打字机尾项渲染 ⇒ 用户看到
 *   「user1 user2 + iter1-20 busy」（assistant1 不在原位）。
 *
 * 判据（只用结构，不比内容）：
 *   ① 有在飞迭代（`live`）⇒ 就是它所在的那一轮（唯一正在产出的一轮）；
 *   ② 否则取**最早仍未收尾**（`final === null`）的一轮 —— 被取消的那一轮必定先于
 *      之后 `turn_started` 的新一轮打开，而新轮绝不会比它还早。
 *      （取"最早"而不是"最晚"：cancel ack 可能与新一轮的 `turn_started` 竞争，
 *      最晚的会误伤**新轮**；收尾后该轮不再是 `final === null`，不会被重复命中。）
 */
function endingTurnOf(st: State): number {
  // ⛔ **只认"此刻确实在飞"的那一轮**（`live` 指向、且该轮 live+streaming）。
  //   2026-10-24：旧实现还有一条"取最早未收尾"的兜底 ⇒ 在「cancel(T1) 后排队消息立刻出队成
  //   T2」的竞态里（cancel ack 无 turn_id 且晚于 `turn_started(T2)`），T1 已被 `phase_done`
  //   收尾 ⇒ 兜底会落到 **T2** ⇒ 把刚出队的那一轮标成 cancelled/final ⇒ 之后 T2 的 tick 全被
  //   当"迟到帧"丢弃 ⇒ 消息静默消失。⇒ 归属不明时**不许猜**，交回驱动层做权威重载。
  if (st.live === null) {
    return 0;
  }
  const t: TurnRec | undefined = st.turns.get(st.live.turn);
  if (t === undefined || t.final !== null) {
    return 0;
  }
  if (t.streaming !== true) {
    return 0;
  }
  return st.live.turn as number;
}

/**
 * 是否"缺 turn_id 的收尾帧"（是否**属于命令回复**由 `adapt` 判 —— 那条规则只该有一处：
 * 命令回复是唯一合法的"无 turn"形态，由驱动层写 standalone；这里只描述"没有 turn 可用"这个事实）。
 */
function needsEndingTurn(ev: DomainEvent): boolean {
  if (ev.type !== 'text_final') {
    return false;
  }
  const t: number | null = ev.turnID;
  return t === null || t === undefined || (t as number) <= 0;
}

/** 一帧的模型步进结果（`state` 供下一帧/投影；`effects` 由调用方处置——实时侧拉权威）。 */
export interface ModelStep {
  readonly state: State;
  readonly effects: readonly Effect[];
}

/**
 * 单帧喂进模型。`history_replaced` 是**权威历史**（走 `hydrate` 构造，不是增量帧）；
 * 其余事件按 wire 语义 `adapt → stepAll`。⛔ 绝不在这里做去重/兜底——语义全在 `model_step`。
 */
export function stepEvent(st: State, ev: DomainEvent, chat: string, cancelTurn?: number): ModelStep {
  if (ev.type === 'history_replaced') {
    const act = ev.active;
    const wire: WireHistoryMessage[] = historyEventToWire(ev);
    // ⛔ 权威快照**不能倒退**（append-only）：落后的快照整份丢弃，绝不拿它缩表
    //   （用户 2026-10-22：「终止 turn 后发新消息 ⇒ 被终止 turn 的 agent 消息消失几秒又出现」）。
    if (isStaleSnapshot(st, wire)) {
      return { state: st, effects: [] };
    }
    const seq: number = ev.lastSeq === null || ev.lastSeq === undefined ? st.seq : ev.lastSeq;
    const next: State = hydrate(st, wire, seq,
      act === null || act === undefined ? null : { turnID: act.turnID, snapshot: act.snapshot as never });
    return { state: next, effects: [] };
  }
  // ⛔ `inject_user` 是服务端把"注入的 user 消息"**回显**给客户端（WSMessage 四字段，无 id/turn）：
  //   通知 turn 的 user 行已经由 `turn_started(trigger=notification)` 建好了 ⇒ 有在飞回合时
  //   这条回显不得再落一行（判据 `user_row_integrity`「通知 turn 恰 1 条」，用户 2026-10-18 截图）。
  //   判定只用**状态**（有没有在飞回合），不比字符串内容。
  if (ev.type === 'user_echo') {
    // 已有**在飞/未收尾且有 user 行**的回合 ⇒ 这条回显是那条 user 消息的副本（单端场景的常态：
    // 通知 turn 的 user 行由 `turn_started` 建、本地发送的行由 `user_sent` 建）。
    // ⛔ 判定只看状态（有没有未收尾回合 + 有没有 user 行），不比内容、不比 id。
    let openWithUser: boolean = false;
    st.turns.forEach((t) => {
      if (t.final === null && t.user !== null) {
        openWithUser = true;
      }
    });
    if (openWithUser) {
      return { state: st, effects: [] };
    }
  }
  // ⛔ 缺 turn_id 的普通收尾帧（cancel ack / 重启恢复）必须落到"正在收尾的那一轮"
  //   （见 `endingTurnOf` 的长注释）——否则该轮永不 `final`，行恒 `isLive`。
  const fallbackTurn: number = needsEndingTurn(ev) ? endingTurnOf(st) : 0;
  // ⛔ **取消的归属**（2026-10-24 用户点名的竞态）：turn-less 的 cancel ack 只能收尾
  //   "用户按下取消时正在跑的那一轮" —— 那个轮号**客户端自己知道**（`store.performCancel`
  //   记的 `cancelTurn`），不需要猜。
  //   · 目标轮仍未被收尾 ⇒ 就收它（哪怕此刻 live 已经指向刚出队的新轮）；
  //   · 目标轮**已经收尾** ⇒ 这是重复/迟到的 ack ⇒ **幂等丢弃**（⛔ 不得顺手去收尾 live 新轮）。
  const ct: number = cancelTurn !== undefined && cancelTurn !== null ? cancelTurn : 0;
  if (needsEndingTurn(ev) && ct > 0) {
    const target: TurnRec | undefined = st.turns.get(ct as TurnID);
    if (target !== undefined && target.final !== null) {
      return { state: st, effects: [] };   // 已经收过尾：幂等
    }
    if (target !== undefined) {
      return stepAll(st, adapt(ev as never, chat, st.epoch, ct) as never, new Date().toISOString());
    }
    return { state: st, effects: [{ kind: 'snapshot', chat: st.chat }] };
  }
  // ⛔ 归属不明（没有在飞轮 / 在飞轮已收尾）⇒ **不猜、也不丢**：交给驱动层做一次权威重载
  //   （`snapshot` effect ⇒ store 的 `pullTurnAuthoritative(-1)`）。丢掉会让该轮永不 final；
  //   猜成"最早未收尾"会杀掉刚出队的新轮（2026-10-24 用户点名的竞态）。
  if (needsEndingTurn(ev) && fallbackTurn <= 0) {
    return { state: st, effects: [{ kind: 'snapshot', chat: st.chat }] };
  }
  const res = stepAll(st, adapt(ev as never, chat, st.epoch, fallbackTurn) as never,
    new Date().toISOString());
  return { state: res.state, effects: res.effects };
}


/** 行对象缓存（键 = 行 id；**身份稳定** ⇒ LazyForEach 不重建行）。 */
export type RowCache = Map<string, ChatRow>;

function fillUser(row: ChatRow, r: PUserRow): void {
  row.role = 'user';
  row.turnID = r.turnID;
  row.content = r.content;
  row.iterations = [];
  row.completedBlocks = [];
  row.isLive = false;
  row.isNotification = r.isNotification;
  row.sending = r.sending;
  row.queued = r.queued;
  row.regionsBefore = 0;
  row.subAgents = [];
  row.iterBlocks.blocks = [];
  row.iterBlocks.rev = row.iterBlocks.rev + 1;
}

function fillAssistant(row: ChatRow, r: PAssistantRow, isLive: boolean): void {
  row.role = 'assistant';
  row.turnID = r.turnID;
  // 顶层 content = **回合级正文**（旧 `applyRow` 的 committed/live 行同名字段；
  // 无迭代的回合——例如 demo / 纯文本回复——正文只在这里）。
  row.content = r.content;
  // 行内块 = 已提交块 ⊕ 在飞块（**与旧 `liveIterations` 同形**：在飞块只在有产出时追加）。
  // ⛔ 这不是"合并/去重"——`project` 已保证二者迭代号不重叠，这里只做**形状拼接**。
  const committed: HistoryIteration[] = toHistoryIterations(r.blocks);
  const blocks: HistoryIteration[] = [];
  for (let i = 0; i < committed.length; i++) {
    blocks.push(committed[i]);
  }
  // ⛔ 判定必须与 `liveHasOutput` 同源（content/reasoning/tools/genui 任一有产出即算）：
  //   只看 content/tools 会漏掉「只有思考流」的帧 ⇒ 行里没有在飞块 ⇒ 页面停在「思考中…」
  //   （这正是用户 2026-10-20 报的现场）。
  if (r.inflight !== null && (r.inflight.content.length > 0 || r.inflight.reasoning.length > 0
    || r.inflight.tools.length > 0 || r.inflight.genui.length > 0)) {
    blocks.push(toHistoryIteration(r.inflight, true));
  }
  row.iterations = blocks;
  row.completedBlocks = committed;
  row.isLive = isLive;
  row.isNotification = false;
  row.sending = false;
  row.queued = false;
  row.regionsBefore = r.regionsBefore;
  // 压缩点（`Compaction` → `WebCompaction`，字段同形，逐字段搬运）
  const comps: WebCompaction[] = [];
  for (let i = 0; i < r.compactions.length; i++) {
    comps.push({ afterIteration: r.compactions[i].afterIteration, content: r.compactions[i].content });
  }
  row.compactions = comps;
  row.subAgents = [];
  // ⛔ 块列表的**唯一写者**是 `syncRowBlocks`（同一份 `syncIterBlocks` 逻辑，不复制）：
  //   这里再写一次只会让 `IterBlocksView` 每帧多收一次通知（rev 双跳）。
  if (isLive) {
    row.liveRevision = row.liveRevision + 1;
  }
  row.rev = row.rev + 1;
}

/**
 * 投影 + 落地：把模型状态映射成 `ChatRow[]`（复用 `cache` 里的行对象 ⇒ 身份稳定）。
 * **未变化的行不写字段**（`PRow` 引用相同 ⇒ 直接复用）。
 */
const appliedByRow: WeakMap<Object, PRow> = new WeakMap<Object, PRow>();

export function applyModel(state: State, cache: RowCache): ChatRow[] {
  const rows: PRow[] = project(state) as PRow[];
  const out: ChatRow[] = [];
  const seen: Set<string> = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r: PRow = rows[i];
    const key: string = r.id;
    seen.add(key);
    let row: ChatRow | undefined = cache.get(key);
    if (row === undefined) {
      row = new ChatRow();
      row.id = key;
      cache.set(key, row);
    }
    // ⛔ **身份稳定**（旧 `applyRow` 的 `sameRowEssence` 早退等价语义）：同一 `PRow` 对象
    //   ⇒ 什么都不写（`project` 在内容未变时返回同一对象）。否则每帧整表重排 ⇒ 高度抖动。
    const prevRow: PRow | undefined = appliedByRow.get(row as Object);
    if (prevRow !== r) {
      appliedByRow.set(row as Object, r);
      if (r.kind === 'user') {
        fillUser(row, r as PUserRow);
      } else {
        const pa: PAssistantRow = r as PAssistantRow;
        const isLive: boolean = pa.finalized === false;
        fillAssistant(row, pa, isLive);
        // ⛔ 视图的唯一数据源是 `row.iterBlocks`（由 `applyRow` 内的 `syncIterBlocks` 填充）；
        //   桥接必须显式调一次，否则块列表为空 ⇒ 整屏空白（真机实证）。
        syncRowBlocks(row, isLive, pa.turnID);
      }
    }
    out.push(row);
  }
  // 淘汰已消失的行（会话切换 / 回合被删）
  const stale: string[] = [];
  cache.forEach((_v: ChatRow, k: string) => {
    if (!seen.has(k)) {
      stale.push(k);
    }
  });
  for (let i = 0; i < stale.length; i++) {
    cache.delete(stale[i]);
  }
  return out;
}
