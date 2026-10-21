/**
 * core/model/types.ts —— 会话状态机的**最小模型**（纯 TS，⛔ 不 import 任何 `.ets`/ArkUI）。
 *
 * 权威规格：`docs/STATE-MODEL.md`（§3 模型 / §4 证明 / §14 契约）。
 * 落地原则：
 *   · **位置状态**（覆盖语义）而非增量 ⇒ 重复/乱序天然幂等；
 *   · **唯一身份**：`turn` / `iteration` / `call`（全是整数/不透明 id，⛔ 不用内容判等）；
 *   · **单一写出点**：只有 `step.ts` 构造/改写 `State`；
 *   · 恢复只有**按对象拉权威**（`pullIter` / `pullTurn` / `snapshot`），客户端零重建。
 */

// ─── 身份 ─────────────────────────────────────────────────────

/** 会话 id（不透明）。 */
export type ChatID = string;

/** 回合号：每会话单调 +1，永不复用。 */
export type TurnID = number;

/** 迭代号：一次 LLM 调用 + 其工具执行；同一 turn 内严格递增（允许跳号）。 */
export type IterNum = number;

/** 工具调用 id：服务端分配、终身不变（生成态即分配）。 */
export type CallID = string;

/** 帧序号：**每 chat** 严格 +1（客户端只用于丢弃迟到帧；跳号以最大为准）。 */
export type Seq = number;

// ─── 工具 ─────────────────────────────────────────────────────

export type ToolStatus = 'generating' | 'pending' | 'running' | 'done' | 'failed';

/**
 * 线格式工具状态 → 模型状态（**唯一实现**：adapter 与 hydrate 必须同源，
 * 否则"同一 status 字符串"在两个入口被翻译成两种语义）。
 * `error` 与 `done` 同义（服务端两种拼写）；未知 ⇒ `pending`。
 */
export function toolStatusOf(s: string | undefined): ToolStatus {
  if (s === 'done' || s === 'error') return 'done';
  if (s === 'failed') return 'failed';
  if (s === 'running') return 'running';
  if (s === 'generating') return 'generating';
  return 'pending';
}

/** **不可变**部分（只在"首次出现"那一帧携带；`args`/`detail` 在参数生成完成后一次性）。 */
export interface ToolMeta {
  readonly name: string;
  readonly uiMode?: string;
  readonly uiLibs?: string;
  readonly toolHints?: string;
  readonly args?: string;
  readonly detail?: string;
  readonly summary?: string;
}

/** **可变**部分（每帧覆盖）：`label` 会随参数生成而增长（= name + 参数截断）。 */
interface ToolState {
  readonly status: ToolStatus;
  readonly label: string;
  readonly genChars: number;
  readonly elapsedMs: number;
  readonly exitCode?: number;
}

export interface ToolRec {
  readonly call: CallID;
  /** 恒等于所属 Block 的 iteration（构造时由 step 盖章，见 §4 T5-c）。 */
  readonly iteration: IterNum;
  readonly meta: ToolMeta;
  readonly state: ToolState;
}

/** 一帧里携带的工具条目：`meta` 仅在首次出现时给（缺省 = 沿用已知）。 */
export interface ToolTick {
  readonly call: CallID;
  readonly iteration: IterNum;
  readonly state: ToolState;
  readonly meta?: ToolMeta;
}

// ─── 迭代 / 回合 ──────────────────────────────────────────────

/** 子代理进度（透传结构；渲染层只读）。 */
export interface SubAgentNode {
  readonly role: string;
  readonly instance?: string;
  readonly status: string;
  readonly desc?: string;
  readonly iteration?: number;
  readonly children?: readonly SubAgentNode[];
}

/** 回合内压缩点（迭代之间内联渲染）。 */
export interface Compaction {
  readonly afterIteration: number;
  readonly content: string;
}

/** 一个**已提交**迭代：**恰好一块/迭代**，工具号恒等于块号。 */
export interface Block {
  readonly iteration: IterNum;
  readonly content: string;
  readonly reasoning: string;
  readonly tools: readonly ToolRec[];
  readonly subAgents: readonly SubAgentNode[];
  readonly genui: string;
  readonly cancelled: boolean;
}

interface Final {
  readonly content: string;
  readonly cancelled: boolean;
}

export interface Stats {
  readonly ttftMs: number;
  readonly tpotMs: number;
  readonly tokensPerSec: number;
  readonly totalMs: number;
  readonly chunks: number;
}

export interface Usage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** 乐观 user 行（本机意图；绑定后交给 turns）。 */
export interface UserLine {
  /** 内部续跑（`trigger=resume`）的合成 user 行：**不是用户输入** ⇒ 不驱动"进行中"渲染。 */
  readonly isResume?: boolean;
  readonly id: string;
  readonly content: string;
  readonly timestamp: string;
  readonly isNotification: boolean;
  readonly queued: boolean;
  readonly sending: boolean;
  readonly requestID: string | null;
  readonly dbID?: number;
}

export interface TurnRec {
  readonly id: TurnID;
  readonly user: UserLine | null;
  /** 严格递增的 iter，**恰好一块/迭代**（同号不可表示）。 */
  readonly blocks: readonly Block[];
  /** null = 回合尚未收尾。 */
  readonly final: Final | null;
  // ── 回合级进度（**不随 live 消失**：压缩/思考/上下文环在"迭代间隙"仍要显示）──
  readonly phase: string;
  readonly streaming: boolean;
  readonly streamStats: Stats | null;
  readonly tokenUsage: Usage | null;
  readonly compactions: readonly Compaction[];
  /** 服务端头部截断的块数（"更早的 N 个迭代"）。 */
  readonly droppedBefore: number;
  /** "更早区域"（可动态取回）。 */
  readonly regionsBefore: number;
  readonly requestID: string | null;
}

/** 在飞迭代：恒有 `iteration > 最后一个已提交块的号`（§4 T5-b）。 */
export interface LiveIter {
  readonly turn: TurnID;
  readonly iteration: IterNum;
  readonly content: string;
  readonly reasoning: string;
  readonly tools: readonly ToolRec[];
  readonly genui: string;
}

export type GoalState = { readonly kind: 'none' } | { readonly kind: 'value'; readonly objective: string; readonly status: string; readonly summary?: string } | { readonly kind: 'cleared' };

export interface Session {
  readonly running: boolean;
  readonly todos: readonly string[];
  readonly goal: GoalState;
  readonly queue: readonly string[];
}

export interface Local {
  readonly pending: readonly UserLine[];
}

/** 无 turn 归属的行：DB 历史前缀（legacy）与实时命令回复（standalone）。 */
export interface LegacyLine {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly blocks: readonly Block[];
  readonly timestamp: string;
  readonly dbID?: number;
  /** 显式"无 turn"标记（命令回复）；渲染层据此跳过 turn 绑定。 */
  readonly standalone?: boolean;
  /** 命令行的排序锚点（该行到达时已知的最大 turn id；0 = 尚无 turn）。 */
  readonly anchorTurn?: number;
  /** 服务端头部截断的块数（legacy 段）。 */
  readonly droppedBefore?: number;
  readonly regionsBefore?: number;
}

/** 全量状态。`rev` 是**本机代数**（换会话/重载 +1；异步回包靠它丢弃旧结果）。 */
export interface State {
  readonly chat: ChatID;
  readonly epoch: number;
  readonly seq: Seq;
  readonly gen: number;
  readonly turns: ReadonlyMap<TurnID, TurnRec>;
  readonly live: LiveIter | null;
  readonly sess: Session;
  readonly local: Local;
  /** DB 历史前缀（只读；由 snapshot 整段替换）。 */
  readonly legacy: readonly LegacyLine[];
  /** 无 turn 归属的**实时**回复（命令 `!cmd`/slash）：排在 turns 之后。 */
  readonly standalone: readonly LegacyLine[];
  /** 已到达但**尚不可入账**的完成块（迭代缺口）：等缺的那几号补齐后按序 drain。 */
  readonly pending: ReadonlyMap<TurnID, ReadonlyMap<IterNum, Block>>;
  /** 权威回答"该号不存在"（合法跳号）——避免对同一号无限补洞。 */
  readonly absent: ReadonlyMap<TurnID, ReadonlySet<IterNum>>;
}

// ─── 帧（服务端 → 客户端，6 个构造子）────────────────────────

export interface OpenFrame {
  readonly kind: 'open';
  readonly epoch: number;
  readonly seq: Seq;
  readonly chat: ChatID;
  readonly turn: TurnID;
  readonly user: UserLine;
  readonly requestID: string | null;
}

/**
 * 文本补丁：两种**位置状态**表达
 *  · `full`：整段覆盖（老 wire 的全量累积语义、快照恢复）；
 *  · `delta`：`{base, chunk}` 增量（新 wire，带宽最优；`base` 不匹配 ⇒ 丢弃本帧文本）。
 */
export type TextPatch =
  | { readonly kind: 'full'; readonly text: string }
  | { readonly kind: 'delta'; readonly base: number; readonly chunk: string };

export interface TickFrame {
  readonly kind: 'tick';
  readonly epoch: number;
  readonly seq: Seq;
  readonly chat: ChatID;
  readonly turn: TurnID;
  readonly iteration: IterNum;
  readonly phase: string;
  readonly streaming: boolean;
  /** 缺省 = 本帧**不带**正文补丁 ⇒ 保留上一帧的值（web 同源：`ev.content !== undefined ? … : prev`）。 */
  readonly content?: TextPatch;
  readonly reasoning?: TextPatch;
  readonly tools: readonly ToolTick[];
  readonly genui: string;
  readonly stats?: Stats;
  readonly usage?: Usage;
}

export interface DoneFrame {
  readonly kind: 'done';
  readonly epoch: number;
  readonly seq: Seq;
  readonly chat: ChatID;
  readonly turn: TurnID;
  readonly block: Block;
}

export interface FinalFrame {
  readonly kind: 'final';
  readonly epoch: number;
  readonly seq: Seq;
  readonly chat: ChatID;
  readonly turn: TurnID;
  readonly content: string;
  readonly cancelled: boolean;
  readonly phase: string;
  readonly blocks?: readonly Block[];
  readonly droppedBefore?: number;
}

/** 会话级字段：`undefined` = 未携带；`goal: null` = 显式清除；`todos/queue: []` = 值。 */
export interface SessionFrame {
  readonly kind: 'session';
  readonly epoch: number;
  readonly seq: Seq;
  readonly chat: ChatID;
  readonly running?: boolean;
  readonly todos?: readonly string[];
  readonly goal?: { readonly objective: string; readonly status: string; readonly summary?: string } | null;
  readonly queue?: readonly string[];
}

/** 保活帧：不推进 seq，只让客户端能发现"最后几帧丢了"（当前实现不依赖，保留形状）。 */
export interface KeepaliveFrame {
  readonly kind: 'keepalive';
  readonly epoch: number;
  readonly seq: Seq;
  readonly chat: ChatID;
}

export type Frame = OpenFrame | TickFrame | DoneFrame | FinalFrame | SessionFrame | KeepaliveFrame;

// ─── 本机意图（不进网络）────────────────────────────────────

export interface SendIntent {
  readonly kind: 'send';
  readonly row: UserLine;
}

export interface AckIntent {
  readonly kind: 'ack';
  readonly requestID: string;
  /** delivered ⇒ 绑定 turn；queued ⇒ 进排队区；command ⇒ 永无 turn（进 standalone 段）。 */
  readonly how: 'delivered' | 'queued' | 'command';
  readonly turn?: TurnID;
  readonly dbID?: number;
}

export interface FailIntent {
  readonly kind: 'fail';
  readonly requestID: string;
}

interface ResyncIntent {
  readonly kind: 'resync';
}

export type Intent = SendIntent | AckIntent | FailIntent | ResyncIntent;

// ─── step 的**外部效应**（纯函数的唯一出口）──────────────────

/** 需要读权威的动作：由驱动层（store）执行，结果以帧形式回灌 `step`。 */
export type Effect =
  | { readonly kind: 'pullIter'; readonly chat: ChatID; readonly turn: TurnID; readonly iteration: IterNum }
  | { readonly kind: 'pullTurn'; readonly chat: ChatID; readonly turn: TurnID }
  | { readonly kind: 'snapshot'; readonly chat: ChatID };

export interface StepResult {
  readonly state: State;
  readonly effects: readonly Effect[];
}

/** 初态（空会话；`epoch/seq` 由 snapshot 填）。 */
export function emptyState(chat: ChatID, epoch: number, seq: Seq): State {
  return {
    chat,
    epoch,
    seq,
    gen: 0,
    turns: new Map<TurnID, TurnRec>(),
    live: null,
    sess: { running: false, todos: [], goal: { kind: 'none' }, queue: [] },
    local: { pending: [] },
    legacy: [],
    standalone: [],
    pending: new Map<TurnID, ReadonlyMap<IterNum, Block>>(),
    absent: new Map<TurnID, ReadonlySet<IterNum>>(),
  };
}

/** 新建回合记录（**唯一**构造点，`phase/streaming` 等初值集中在这里）。 */
export function newTurn(turn: TurnID, user: UserLine | null, requestID: string | null): TurnRec {
  return {
    id: turn,
    user,
    blocks: [],
    final: null,
    phase: 'thinking',
    streaming: true,
    streamStats: null,
    tokenUsage: null,
    compactions: [],
    droppedBefore: 0,
    regionsBefore: 0,
    requestID,
  };
}
