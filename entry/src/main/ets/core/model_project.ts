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

function assistantRow(t: TurnRec, live: LiveIter | null): PAssistantRow {
  const hit = rowByTurn.get(t);
  const liveHere: LiveIter | null = live !== null && live.turn === t.id ? live : null;
  if (hit !== undefined) {
    // 只有"在飞块"会独立变化 ⇒ 命中时仅在 live 身份变化时重建（历史块引用不变）
    if (hit.inflight === (liveHere === null ? null : blockOfLive(liveHere))) return hit;
  }
  const inflight = liveHere === null ? null : blockOfLive(liveHere);
  const row: PAssistantRow = {
    kind: 'assistant',
    id: `turn-${t.id}-assistant`,
    turnID: t.id,
    cancelled: t.final !== null && t.final.cancelled,
    blocks: t.blocks,
    inflight,
    phase: t.phase,
    streaming: t.streaming,
    stats: t.streamStats,
    usage: t.tokenUsage,
    compactions: t.compactions,
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

function userRow(turnID: number, u: UserLine, standalone?: boolean): PUserRow {
  return {
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
}

function legacyRow(l: LegacyLine): PRow {
  if (l.role === 'user') {
    return {
      kind: 'user', id: l.id, turnID: 0, content: l.content, timestamp: l.timestamp,
      isNotification: false, queued: false, sending: false, dbID: l.dbID,
      standalone: l.standalone === true, anchorTurnID: l.anchorTurn,
    };
  }
  return {
    kind: 'assistant', id: l.id, turnID: 0, cancelled: false, blocks: l.blocks,
    inflight: null, phase: 'done', streaming: false, stats: null, usage: null,
    compactions: [], droppedBefore: l.droppedBefore !== undefined ? l.droppedBefore : 0,
    regionsBefore: l.regionsBefore !== undefined ? l.regionsBefore : 0, finalized: true,
  };
}

/**
 * 唯一投影。
 * 顺序（与现状语义一致）：`legacy` ⊕ turns（按 turn 升序，user < assistant）⊕ `standalone` ⊕ pending。
 */
export function project(s: State): readonly PRow[] {
  const out: PRow[] = [];
  // legacy：DB 历史前缀（只读）
  for (let i = 0; i < s.legacy.length; i++) out.push(legacyRow(s.legacy[i]));

  // turns：Map 插入序在真实事件流里已按 turn 单调；异常时按号排序（O(T log T) 仅此一次）
  const ids: TurnID[] = [];
  for (const id of s.turns.keys()) ids.push(id);
  let ordered = true;
  for (let i = 1; i < ids.length; i++) if (ids[i] < ids[i - 1]) ordered = false;
  if (!ordered) ids.sort((a, b) => a - b);

  for (let i = 0; i < ids.length; i++) {
    const t = s.turns.get(ids[i]) as TurnRec;
    // 折叠窗口期间 user 行不渲染（"加载更多一定在顶部"：user 输入不得悬在折叠内容上方）
    const hideUser = t.regionsBefore > 0;
    if (t.user !== null && !hideUser) out.push(userRow(t.id, t.user));
    const row = assistantRow(t, s.live);
    // 空 turn（无 user、无块、无在飞、无最终文本）不产 assistant 行（"幽灵行"由投影过滤）
    const hasAny = t.user !== null || t.blocks.length > 0 || row.inflight !== null
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

