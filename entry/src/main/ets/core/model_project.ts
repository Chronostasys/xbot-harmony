/**
 * core/model/project.ts —— `State → Row[]` 的**纯投影**（⛔ 无 ArkUI/无 `.ets` import）。
 *
 * 三条纪律（`docs/STATE-MODEL.md` §3.6）：
 *  1. **一块一迭代**：`blocks` 原样交给渲染（⛔ 不吸收、不合并、不去重）；
 *  2. **在飞只有一块且必然在末尾**：`inflight` 就是 `live`（`live = ⊥ ⇒ inflight = ⊥`），零判定；
 *  3. **引用稳定**：对未变化的 `TurnRec` 返回**同一个 Row 对象**（WeakMap 恒等）⇒ UI 侧只需
 *     `next !== prev`（不需要任何字符串指纹）。
 */
import type { Block, ChatID, Compaction, LiveIter, Stats, ToolRec, TurnID, TurnRec, Usage, UserLine, State, LegacyLine } from './model_types';
import { isSubChatKey } from './model_hydrate';

export interface PUserRow {
  readonly kind: 'user';
  readonly id: string;
  readonly turnID: number;
  readonly content: string;
  readonly timestamp: string;
  readonly isNotification: boolean;
  readonly queued: boolean;
  readonly sending: boolean;
  readonly dbID?: number;
  readonly standalone?: boolean;
  readonly anchorTurnID?: number;
}

export interface PAssistantRow {
  readonly kind: 'assistant';
  readonly id: string;
  readonly turnID: number;
  /** **回合级正文**（= `final.content`；在飞时 = live.content）。旧 derive 的 committed/live 行同名字段。 */
  readonly content: string;
  readonly cancelled: boolean;
  /** 已提交块：**原样**（每个迭代一块）。 */
  readonly blocks: readonly Block[];
  /** 在飞块（未提交迭代）；`live = ⊥` 或不属于本 turn ⇒ null。 */
  readonly inflight: Block | null;
  readonly phase: string;
  readonly streaming: boolean;
  readonly stats: Stats | null;
  readonly usage: Usage | null;
  readonly compactions: readonly Compaction[];
  readonly droppedBefore: number;
  readonly regionsBefore: number;
  /** 服务端权威收尾（null = 回合在飞）。 */
  readonly finalized: boolean;
}

export type PRow = PUserRow | PAssistantRow;

/** 投影 memo：键 = `TurnRec`（未变的 turn 直接复用上一帧的 Row）。 */
const rowByTurn: WeakMap<TurnRec, PAssistantRow> = new WeakMap<TurnRec, PAssistantRow>();

/**
 * 「空壳块过滤」的结果 memo：键 = 源 `blocks` 数组。
 * ⛔ 为什么必须 memo：`filter` 每次都返**新数组** ⇒ 指纹/引用判据全失效 ⇒ 页面每帧重建块列表
 *   （用户硬约束：每帧成本与块数 N 无关）。同源数组 ⇒ 同一结果引用 ⇒ 下游零重建。
 */
const nonEmptyMemo: WeakMap<readonly Block[], readonly Block[]> = new WeakMap<readonly Block[], readonly Block[]>();

function nonEmptyBlocks(blocks: readonly Block[]): readonly Block[] {
  const hit: readonly Block[] | undefined = nonEmptyMemo.get(blocks);
  if (hit !== undefined) {
    return hit;
  }
  // ⛔ **空壳块不渲染**（旧管线 `[ITER-DROP]` 同源规则）：无正文/无思考/无工具/无子代理的块
  //   只是一条没有任何可见信息的记录；渲染它会得到一张"空气卡"（真机实测：整屏空白 +
  //   一个悬浮 pill）。这是**投影规则**，不是去重/合并。
  const out: readonly Block[] = blocks.filter((b) => b.cancelled
    || b.content.length > 0 || b.reasoning.length > 0
    || b.tools.length > 0 || b.subAgents.length > 0);
  nonEmptyMemo.set(blocks, out);
  return out;
}

/**
 * ⛔ **同一回合内迭代号唯一（投影层最后一道闸）** —— 用户 2026-11-14 P0
 *   「子代理的 shell 转后台之后，该迭代被重复渲染」：模型层已按 `iteration` upsert
 *   （`model_hydrate` / `onDone` / `drain`），但快照/重放/缓冲并集等多条构造路径仍可能
 *   落下同号两份（字段互补或逐字相同）⇒ 渲染就是两条「思考 N 字」。
 *   语义：**按号取"更完整的那一份"**（正文/思考/工具/子代理任一非空计数更多者），
 *   顺序按迭代号 —— 只影响绘制，不删模型数据。
 *   同输入同输出 ⇒ memo 保持引用稳定（页面零重建）。
 */
/** 块的"信息量"（同回合同号两份块取更完整的那一份）。 */
function blockWeight(b: Block): number {
  return b.content.length + b.reasoning.length + b.tools.length * 8 + b.subAgents.length * 8;
}

/** 该回合里是否已有**有实质内容**的同号迭代块（空壳不算：cancel/边界快照时 live 才是唯一可见内容）。 */
function hasRealIterBlock(blocks: readonly Block[], iteration: number): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const b: Block = blocks[i];
    if (b.iteration !== iteration) continue;
    if (b.content.length > 0 || b.reasoning.length > 0 || b.tools.length > 0 || b.subAgents.length > 0) {
      return true;
    }
  }
  return false;
}

const uniqueIterMemo: WeakMap<readonly Block[], readonly Block[]> = new WeakMap<readonly Block[], readonly Block[]>();

function uniqueIterBlocks(blocks: readonly Block[]): readonly Block[] {
  const hit: readonly Block[] | undefined = uniqueIterMemo.get(blocks);
  if (hit !== undefined) {
    return hit;
  }
  const byIter: Map<number, Block> = new Map<number, Block>();
  let dup = false;
  for (let i = 0; i < blocks.length; i++) {
    const b: Block = blocks[i];
    const prev: Block | undefined = byIter.get(b.iteration);
    if (prev === undefined) {
      byIter.set(b.iteration, b);
    } else {
      dup = true;
      byIter.set(b.iteration, blockWeight(b) >= blockWeight(prev) ? b : prev);
    }
  }
  let out: readonly Block[] = blocks;
  if (dup) {
    const arr: Block[] = [];
    byIter.forEach((b: Block): void => { arr.push(b); });
    arr.sort((a: Block, b: Block): number => a.iteration - b.iteration);
    out = arr;
  }
  uniqueIterMemo.set(blocks, out);
  return out;
}

function assistantRow(t: TurnRec, live: LiveIter | null): PAssistantRow {
  const hit = rowByTurn.get(t);
  const liveHere: LiveIter | null = live !== null && live.turn === t.id ? live : null;
  // ⛔ **前沿唯一（投影层，最后一道闸）**：`live` 指向的迭代若**已经作为块存在**，
  //   它在行里必然是重复的一份（块 + 在飞块）。模型层已在各入口清理，但投影是渲染的
  //   唯一数据源（用户 2026-11-14 P0「子代理 shell 转后台后该迭代被重复渲染」）⇒
  //   这里也必须兜住：块是权威，`live` 不画。
  const liveVisible: LiveIter | null = liveHere !== null && hasRealIterBlock(t.blocks, liveHere.iteration)
    ? null : liveHere;
  const inflightNow = liveVisible === null ? null : blockOfLive(liveVisible);
  // 块列表（与下面行构造共用同一份，memo 恒定 ⇒ 引用判等有效）
  const blocksNow: readonly Block[] = uniqueIterBlocks(nonEmptyBlocks(t.blocks));
  if (hit !== undefined) {
    // ⛔ **命中条件必须同时看「已提交块」**（用户 2026-11-18 P0：「迭代完成就消失，idle 时才重新出现」）。
    //   旧条件只看在飞块：新迭代提交后 `inflight` 没变 ⇒ 返回**旧 PRow** ⇒ 桥接 `fillAssistant`
    //   不执行 ⇒ `liveRevision` 不自增 ⇒ 页面 `liveBlocks` 不投递 ⇒ **live 行的已提交块区
    //   冻结在创建那一瞬（空）**；idle 后该行转普通行走 `applyRows` 全量重建 ⇒ 块才出现。
    //   ⇒ 只要块列表（或压缩点）引用变了就必须产出新 PRow。
    if (hit.inflight === inflightNow && hit.blocks === blocksNow) return hit;
  }
  const inflight = liveVisible === null ? null : blockOfLive(liveVisible);
  const row: PAssistantRow = {
    kind: 'assistant',
    // ⛔ 行 id 与旧 `derive` 逐字一致（页面用 id 找导航锚点/滚动目标）：
    //   live ⇒ `turn-N-live`；committed ⇒ `turn-N`；cancelled ⇒ `turn-N-c`
    id: t.final === null ? `turn-${t.id}-live` : (t.final.cancelled ? `turn-${t.id}-c` : `turn-${t.id}`),
    turnID: t.id,
    content: t.final !== null ? t.final.content : (liveVisible !== null ? liveVisible.content : ''),
    cancelled: t.final !== null && t.final.cancelled,
    // ⛔ **空壳块不渲染**（旧管线 `[ITER-DROP]` 同源规则）：无正文/无思考/无工具/无子代理的块
    //   只是一条没有任何可见信息的记录；渲染它会得到一张"空气卡"（真机实测：整屏空白 +
    //   一个悬浮 pill）。这是**投影规则**，不是去重/合并。
    blocks: blocksNow,
    inflight,
    phase: t.phase,
    streaming: t.streaming,
    stats: t.streamStats,
    usage: t.tokenUsage,
    // 压缩点：窗口化（`regionsBefore > 0`）时**丢掉落在外面的 `afterIteration=0`**
    // （它属于更早那段，渲染会浮在缺口上；与 `core/compaction.ets:toHistoryCompactions` 同源规则）。
    compactions: t.regionsBefore > 0
      ? t.compactions.filter((c) => c.afterIteration > 0)
      : t.compactions,
    droppedBefore: t.droppedBefore,
    regionsBefore: t.regionsBefore,
    finalized: t.final !== null,
  };
  rowByTurn.set(t, row);
  return row;
}

/** live 快照 → 在飞块（**唯一**的"在飞"表示；不做任何合并/去重）。 */
const blockByLive: WeakMap<LiveIter, Block> = new WeakMap<LiveIter, Block>();
function blockOfLive(l: LiveIter): Block {
  const hit = blockByLive.get(l);
  if (hit !== undefined) return hit;
  const b: Block = {
    iteration: l.iteration,
    content: l.content,
    reasoning: l.reasoning,
    tools: l.tools,
    subAgents: [],
    genui: l.genui,
    cancelled: false,
  };
  blockByLive.set(l, b);
  return b;
}

/** user 行投影 memo：键 = `UserLine`（未变 ⇒ 复用同一 PRow ⇒ `applyModel` 零写入、页面零重建）。 */
const userRowByLine: WeakMap<UserLine, PUserRow> = new WeakMap<UserLine, PUserRow>();

function userRow(turnID: number, u: UserLine, standalone?: boolean): PUserRow {
  const hit: PUserRow | undefined = userRowByLine.get(u);
  if (hit !== undefined && hit.turnID === turnID && hit.standalone === standalone) {
    return hit;
  }
  const row: PUserRow = {
    kind: 'user',
    id: u.id,
    turnID,
    content: u.content,
    timestamp: u.timestamp,
    isNotification: u.isNotification,
    queued: u.queued,
    sending: u.sending,
    dbID: u.dbID,
    standalone,
  };
  userRowByLine.set(u, row);
  return row;
}

/** legacy 行投影 memo：键 = `LegacyLine`（只读历史前缀，未变即复用）。 */
const legacyRowByLine: WeakMap<LegacyLine, PRow> = new WeakMap<LegacyLine, PRow>();

function legacyRow(l: LegacyLine): PRow {
  const hit: PRow | undefined = legacyRowByLine.get(l);
  if (hit !== undefined) {
    return hit;
  }
  const row: PRow = l.role === 'user'
    ? {
      kind: 'user', id: l.id, turnID: 0, content: l.content, timestamp: l.timestamp,
      isNotification: false, queued: false, sending: false, dbID: l.dbID,
      standalone: l.standalone === true, anchorTurnID: l.anchorTurn,
    }
    : {
      kind: 'assistant', id: l.id, turnID: 0, content: l.content, cancelled: false, blocks: l.blocks,
      inflight: null, phase: 'done', streaming: false, stats: null, usage: null,
      compactions: [], droppedBefore: l.droppedBefore !== undefined ? l.droppedBefore : 0,
      regionsBefore: l.regionsBefore !== undefined ? l.regionsBefore : 0, finalized: true,
    };
  legacyRowByLine.set(l, row);
  return row;
}

/**
 * 唯一投影。
 * 顺序（与现状语义一致）：`legacy` ⊕ turns（按 turn 升序，user < assistant）⊕ `standalone` ⊕ pending。
 */
export function project(s: State): readonly PRow[] {
  const out: PRow[] = [];
  // legacy：DB 历史前缀（只读）
  for (let i = 0; i < s.legacy.length; i++) out.push(legacyRow(s.legacy[i]));

  // turns：**按到达顺序**（`Map` 插入序 = 真实事件时序）渲染，⛔ 绝不按 turn 号排序。
  //
  // ⛔ 用户 2026-11-17 P0：「user 消息刚发出去、还没发送成功就出现在错误的位置（上一个 user
  //   msg 后面，下方是之前的回复）」。根因：turn 号会**倒退** —— 重连后 DB 号与本地新号并存、
  //   子代理 dump 号(1..N) 与 SSE 号混用、服务端重启后号重排。旧实现对"非单调"的集合做
  //   `ids.sort(号)` ⇒ **新轮被排到旧轮前面** ⇒ 新 user 行跑到上面、旧回复留在下面。
  //   ⇒ 顺序只认**到达顺序**（与 web `deriveRows` 的 turns 遍历同源：状态容器就是时序容器）。
  const ids: TurnID[] = [];
  for (const id of s.turns.keys()) ids.push(id);
  // ⛔ **顺序 = turn id**（用户 2026-11-18：「他不是有 turn id 吗」）：
  //   回合号是服务端的权威时序，**普通会话必须按它升序渲染**。之前为迁就"号会倒退"把它删了 ⇒
  //   冷启动（会话 busy）时在飞回合可能先于历史入表 ⇒ 到达顺序 ≠ 时序 ⇒ 错位（重启才复现、
  //   切会话因保留状态而正常）。
  //   ⛔ 唯一例外 = **子代理会话**：那里有两套号（`dump` 派生 1..N 与 DB/SSE 号混用），
  //     号不可比 ⇒ 保持到达顺序（`isSubChatKey`）。
  if (!isSubChatKey(s.chat as string)) {
    ids.sort((a: TurnID, b: TurnID): number => (a as number) - (b as number));
  }
  for (let i = 0; i < ids.length; i++) {
    const t = s.turns.get(ids[i]) as TurnRec;
    // 折叠窗口期间 user 行不渲染（"加载更多一定在顶部"：user 输入不得悬在折叠内容上方）
    const hideUser = t.regionsBefore > 0;
    if (t.user !== null && !hideUser) out.push(userRow(t.id, t.user));
    const row = assistantRow(t, s.live);
    // 空 turn 不产 assistant 行（"幽灵行"）：无块、无在飞、无最终正文 ⇒ 跳过。
    // ⛔ 不能把「有 user 行」无条件算作"有内容"—— cron/通知 turn 只有 user 行且**已收尾**
    //   （`final` 非空），那样会给它们画一条**空白助手气泡**（旧 derive 的 `hasVisibleOutput` 会跳过）。
    //   反过来**未收尾且有 user** 的 turn（刚 turn_started、还没产出）必须留行 —— 它是
    //   spinner / 打字机的挂载点（判据 `live_iteration_inline` §3）。
    // ⛔ **user-less** 的空 turn 一律不渲染（compaction/resume 的合成 turn，判据
    //   `reduce` 的 REPRO 2026-10-18：凭空一条「思考中」空白助手行）。
    //    ⛔ 判"有真实 user"看**内容非空**：`trigger=resume` 的内部续跑 turn 也带一条空 user 行，
    //      它不是用户输入 ⇒ 不许因此凭空画一条「思考中」空白助手行（`reduce` REPRO 2026-10-18）。
    const openWithUser: boolean = t.final === null && t.user !== null && t.user.isResume !== true;
    const hasAny = t.blocks.length > 0 || row.inflight !== null || openWithUser
      || (t.final !== null && t.final.content.length > 0);
    if (hasAny) out.push(row);
  }

  // standalone：无 turn 的实时命令回复（排在 turns 之后 = 底部，用户视角的最新）
  for (let i = 0; i < s.standalone.length; i++) out.push(legacyRow(s.standalone[i]));

  // pending：未绑定的乐观 user 行（沉底）
  for (let i = 0; i < s.local.pending.length; i++) {
    out.push(userRow(Number.MAX_SAFE_INTEGER, s.local.pending[i]));
  }
  return out;
}

/** 某回合当前"最后一次见到的迭代号"（= max(已提交块号, 在飞号)；0 = 无）。 */
export function lastIterOf(s: State, turn: TurnID): number {
  const t = s.turns.get(turn);
  if (t === undefined) return 0;
  const lastBlock = t.blocks.length === 0 ? 0 : t.blocks[t.blocks.length - 1].iteration;
  const live = s.live !== null && s.live.turn === turn ? s.live.iteration : 0;
  return Math.max(lastBlock, live);
}


/** 所有工具（诊断用：断言"每个 call 恰好出现一次"）。 */
export function allToolCalls(s: State): readonly string[] {
  const out: string[] = [];
  for (const t of s.turns.values()) {
    for (let i = 0; i < t.blocks.length; i++) {
      const tools: readonly ToolRec[] = t.blocks[i].tools;
      for (let k = 0; k < tools.length; k++) out.push(tools[k].call);
    }
  }
  if (s.live !== null) {
    for (let i = 0; i < s.live.tools.length; i++) out.push(s.live.tools[i].call);
  }
  return out;
}

