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
import type { State, ToolRec, SubAgentNode } from './model_types';
import type { Effect } from './model_types';
import type { WireHistoryMessage, WireHistoryIteration } from './model_hydrate';
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
    out.push({
      id: `turn-${t.id}-assistant`, role: 'assistant', content: text, turnID: t.id,
      iterations: wireIters(its), regionsBefore: rb,
    });
  }
  return out;
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
export function stepEvent(st: State, ev: DomainEvent, chat: string): ModelStep {
  if (ev.type === 'history_replaced') {
    const act = ev.active;
    const seq: number = ev.lastSeq === null || ev.lastSeq === undefined ? st.seq : ev.lastSeq;
    const next: State = hydrate(st, historyEventToWire(ev), seq,
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
  const res = stepAll(st, adapt(ev as never, chat, st.epoch) as never, new Date().toISOString());
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
