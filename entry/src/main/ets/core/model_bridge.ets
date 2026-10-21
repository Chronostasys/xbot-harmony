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
  // 顶层 content 只承载**在飞正文**（已提交正文在各块里，⛔ 不重复）
  row.content = r.inflight === null ? '' : r.inflight.content;
  const blocks: HistoryIteration[] = toHistoryIterations(r.blocks);
  row.iterations = blocks;
  row.completedBlocks = blocks;
  row.isLive = isLive;
  row.isNotification = false;
  row.sending = false;
  row.queued = false;
  row.regionsBefore = r.regionsBefore;
  // ⚠️ 压缩点（`Compaction` → `WebCompaction`）在 W2 切换行源时再映射；
  //    当前只服务影子比对（不显示），置空以免引入未导出类型的依赖。
  row.compactions = [];
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
    if (r.kind === 'user') {
      fillUser(row, r as PUserRow);
    } else {
      fillAssistant(row, r as PAssistantRow, (r as PAssistantRow).finalized === false);
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
