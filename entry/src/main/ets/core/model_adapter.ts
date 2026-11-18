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
import type { AckIntent, Block, DetailInput, DoneFrame, FailIntent, FinalFrame, Frame, IterNum, OpenFrame,
  SendIntent, SessionFrame, State, SubAgentNode, TextPatch, TickFrame, ToolMeta, ToolRec, ToolStatus, ToolTick,
  TurnID, TurnRec, UserLine, LegacyLine, Compaction } from './model_types';
import { newTurn, toolStatusOf } from './model_types';

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
  /** `stream` DomainEvent 用这个字段名（`normalize.ts:207/412`）；与 `iter` 同义。 */
  readonly iteration?: number | null;
  readonly phase?: string;
  readonly content?: string | undefined | null;
  readonly reasoning?: string | undefined;
  readonly iterationsDelta?: readonly WireIteration[];
  /** `iterations_loaded`（按需 hydrate 的完整迭代；详情/区域段共用）。 */
  readonly iterations?: readonly WireIteration[];
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
  /** `user_ack` 的排队标记（busy 时服务端把消息入队 ⇒ `queued:true`）。 */
  readonly queued?: boolean;
  readonly commandReply?: boolean;
  readonly progressHistory?: readonly WireIteration[];
  readonly stats?: unknown;
  readonly usage?: unknown;
}

const NO_TOOLS: readonly ToolRec[] = [];


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
  // ⛔ 工具**自己**的迭代号优先于承载它的帧号：服务端 `active_tools` 会**整批先标 pending**
  //   并把陈条目带进后续帧（`agent/engine_run_tools.go:49-64`，其注释明确要求前端按
  //   `iteration` 过滤）⇒ 若按帧号重盖章，上一迭代残留的 shell 会在新迭代里重新变成
  //   「排队」（用户 2026-10-11 P0「所有 tool 都渲染为排队」）。按自身号入账 ⇒ 它落到
  //   自己那一块（已提交）⇒ live 列表里自然不再出现。
  const ownIter: IterNum = t.iteration !== undefined && t.iteration !== null && t.iteration > 0
    ? t.iteration : iteration;
  return {
    call,
    iteration: ownIter,
    meta,
    state: {
      status: toolStatusOf(t.status),
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
 *
 * @param fallbackTurn `text_final` **缺 turn_id** 时的回合归属（由驱动层按状态给出 ——
 *   唯一需要"看状态"的形状，见该分支的长注释）。0/缺省 ⇒ 没有可归属的回合（丢弃）。
 */
export function adapt(ev: WireEvent, chat: string, epoch: number,
  fallbackTurn?: number): readonly (Frame | SendIntent | AckIntent | FailIntent | DetailInput)[] {
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
        isResume: trigger === 'resume',
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
      // ⛔ 两种字段名都要认：结构化帧用 `iter`，而 `normalize` 产出的 **`stream` DomainEvent
      //   用的是 `iteration`**（`normalize.ts:207/412`）。只读 `iter` ⇒ stream 帧的迭代号恒为 0
      //   ⇒ 不产生 tick ⇒ 正文/思考/streamingTools 全丢（判据 `stream_frame_enters_model`）。
      const rawIter: number | null | undefined = ev.iter !== undefined && ev.iter !== null
        ? ev.iter : ev.iteration;
      const iteration: number = rawIter !== undefined && rawIter !== null ? rawIter : 0;
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
            // ⛔ 用工具**自己**的迭代号（陈旧条目自带更小的号 ⇒ 它会落回自己那一块，
            //   而不是在当前 live 块里重新变「排队」）。
            tools.push({ call: r.call, iteration: r.iteration, state: r.state, meta: r.meta });
          }
        };
        push(ev.streamingTools);
        push(ev.activeTools);
        push(ev.completedTools);
        out.push({
          kind: 'tick', epoch, seq, chat, turn, iteration,
          phase: ev.phase !== undefined ? ev.phase : 'thinking',
          streaming: true,
          // ⛔ 字段缺省 ≠ 空串：web 的合并语义是 `ev.content !== undefined ? ev.content : prev`
          //   ⇒ 只带推理的帧（`reasoning_stream_content`）绝不能把正文冲成空
          //   （判据 `p0_tail_visibility` 第四条 SSE：可见内容 6 → 1 的回退）。
          content: ev.content !== undefined && ev.content !== null ? fullText(ev.content) : undefined,
          reasoning: ev.reasoning !== undefined ? fullText(ev.reasoning) : undefined,
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
      const raw: number = ev.turnID !== undefined && ev.turnID !== null ? ev.turnID : 0;
      const content: string = ev.content !== undefined && ev.content !== null ? ev.content : '';
      // ⛔ **命令回复是"无 turn"的唯一合法形态**（后端显式打标 `metadata.command_reply`）：
      //   由驱动层写 standalone，不进 turn。
      if (raw <= 0 && ev.commandReply === true) return [];
      // ⛔ 2026-10-22 用户 P0「cancel 后发新消息 ⇒ 历史变成 user1 user2（iter1-20，busy）」：
      //   普通回合的 `text_final` **也可能没有 turn_id** —— cancel ack 就是这种
      //   （`agent/agent_process.go:handleCancelledRun` 返回的 `OutboundMsg` 不带 `TurnID`
      //   ⇒ SSE 载荷里 `turn_id` 缺省（该字段 `omitempty`，载荷结构沿用后端 `WSMessage`）
      //   ⇒ `normalizeText` 给 `turnID: null`）。旧实现把"无 turn"一律
      //   当命令回复丢弃 ⇒ **被取消的回合永远没有 `final`** ⇒ 行停在 `turn-N-live`
      //   （`finalized=false` ⇒ `isLive=true`）⇒ 页面把这条在飞行**抽出列表末尾**当打字机尾项
      //   渲染 ⇒ 用户看到「user1 user2 + iter1-20 busy」（assistant1 不在原位）。
      //   ⇒ 无 turn 的普通收尾帧必须落到**正在收尾的那一轮**（`reduce` 的
      //   `ev.turnID ?? s.activeTurn` 同语义）；归属由驱动层按状态给出（`fallbackTurn`），
      //   这里只做形状搬运 —— ⛔ 不在这里猜状态。
      const turn: TurnID = raw > 0
        ? raw as TurnID
        : (fallbackTurn !== undefined && fallbackTurn > 0 ? fallbackTurn as TurnID : 0 as TurnID);
      if (turn <= 0) return [];
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
      // ⛔ 透传归属轮（P0）：旧实现把 `ev.turnID` **丢掉** ⇒ 模型侧无法判断"这条 busy/idle
      //   属于哪一轮" ⇒ 迟到信号会压掉新轮。`0/缺省` = 未指定（仍按当前轮处理）。
      const sessTurn: number | undefined = ev.turnID !== undefined && ev.turnID !== null
        ? ev.turnID as number : undefined;
      return [{
        kind: 'session', epoch, seq, chat, running,
        turn: sessTurn !== undefined && sessTurn > 0 ? sessTurn as TurnID : undefined,
      } as SessionFrame];
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
      // ⛔ 2026-10-22 用户亲报「busy 时发消息没被当成排队，按没排队渲染 ⇒ 状态混乱」：
      //   服务端在**会话忙**时会把消息入队，回包带 `queued:true`（`web_rest.go:113-120`），
      //   且**同时**带 `turn_id`（"将来要跑的那一轮"）。旧实现只认 command/delivered ⇒
      //   `queued` 被丢弃 ⇒ `onAck` 走 delivered 分支 ⇒ 把这条**排队消息当成该轮 user 行**
      //   绑进 turns（`turn === N` 时直接 set，顶掉/伪造该轮 user）⇒ 消息既没进排队区、
      //   又出现在消息流里，回合归属错乱。
      //   语义（与 `reduce.ts:2565` / web `useChatMessages.ts:870` 逐字对齐）：
      //   命令 ⇒ `command`（永无 turn）；排队 ⇒ `queued`（**只退役 pending**，渲染交给
      //   StagingTray 的 `queue_state`）；否则 `delivered`。
      const how: 'delivered' | 'queued' | 'command' = ev.commandReply === true
        ? 'command'
        : (ev.queued === true ? 'queued' : 'delivered');
      return [{ kind: 'ack', requestID, how, turn: ev.turnID !== undefined && ev.turnID !== null ? ev.turnID : undefined } as AckIntent];
    }
    case 'user_fail': {
      const requestID: string = ev.requestID !== undefined && ev.requestID !== null ? ev.requestID : '';
      return requestID === '' ? [] : [{ kind: 'fail', requestID } as FailIntent];
    }
    // ── 按需 hydrate 的**完整迭代**（`/api/iteration_detail`、`/api/regions`）───────────────
    // ⛔ 这一支此前**不存在** ⇒ 事件落 `default` 被丢弃，而**行源是模型**（`applyModel`）
    //   ⇒ 详情拉回来了也上不了屏（用户 2026-10-27 P0：历史工具打开全是「暂无详情」，
    //   只有最后一个工具可见——它是在飞帧带过完整 `meta` 的那一个）。
    // 语义：按号覆盖（`model_step.onDetail`），不带 seq、不推进水位、不动 live。
    case 'iterations_loaded': {
      const turn: TurnID = ev.turnID !== undefined && ev.turnID !== null ? ev.turnID : 0;
      const src: readonly WireIteration[] | undefined = ev.iterations;
      if (turn <= 0 || src === undefined || src.length === 0) return [];
      const blocks: Block[] = [];
      for (let i = 0; i < src.length; i++) {
        const w: WireIteration = src[i];
        if (w.iteration !== undefined && w.iteration > 0) blocks.push(toBlock(w));
      }
      return blocks.length === 0 ? [] : [{ kind: 'detail', turn, blocks } as DetailInput];
    }
    default:
      return [];
  }
}
