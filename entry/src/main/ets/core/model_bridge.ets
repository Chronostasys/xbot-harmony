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
import type { PRow, PAssistantRow, PUserRow } from './model_project';
import type { Block } from './model_types';
import type { State, ToolRec, SubAgentNode } from './model_types';
import { project } from './model_project';

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

/** `Block` → `HistoryIteration`（**一块一迭代**；按源对象恒等）。 */
export function toHistoryIteration(b: Block): HistoryIteration {
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
  if (r.inflight !== null && (r.inflight.content.length > 0 || r.inflight.tools.length > 0)) {
    blocks.push(toHistoryIteration(r.inflight));
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
  if (row.iterBlocks.blocks !== blocks) {
    row.iterBlocks.blocks = blocks;
    row.iterBlocks.rev = row.iterBlocks.rev + 1;
  }
  if (isLive) {
    row.liveRevision = row.liveRevision + 1;
  }
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
