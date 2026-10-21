/**
 * core/model_bridge.ts —— 模型 → 渲染行（`ChatRow`）的**唯一适配**（纯 TS 侧，ArkTS 可直接消费）。
 *
 * 为什么需要：`project()` 产出的是**语义行**（`PRow`），而列表组件消费的是 `ChatRow`
 * （`@Observed`，就地更新 + 独立 `iterBlocks` holder）。本文件只做**形状映射**：
 *   · 无判据、无去重、无合并（一切语义都在 `model_step.ts`）；
 *   · 按**源对象恒等**记忆化（`Block`/`ToolRec`/`PRow` ⇒ 同一个 `HistoryIteration`/`ToolProgress`），
 *     未变化的行/块 ⇒ 引用不变 ⇒ 组件零重建（不需要任何字符串指纹）。
 */
import type { PRow, PAssistantRow, PUserRow } from './model_project';
import type { Block } from './model_types';
import { project } from './model_project';
import type { State, ToolRec } from './model_types';
import { ChatRow, HistoryIteration, ToolProgress } from './types';

/** `ToolRec` → 渲染层 `ToolProgress`（按源对象记忆化）。 */
const toolByRec: WeakMap<ToolRec, ToolProgress> = new WeakMap<ToolRec, ToolProgress>();
export function toToolProgress(t: ToolRec): ToolProgress {
  const hit = toolByRec.get(t);
  if (hit !== undefined) return hit;
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
  toolByRec.set(t, out);
  return out;
}

const rev = { n: 0 };
const blockByBlock: WeakMap<Block, HistoryIteration> = new WeakMap<Block, HistoryIteration>();
/** `Block` → 渲染块（**一块一迭代**；按源对象恒等）。 */
export function toHistoryIteration(b: Block): HistoryIteration {
  const hit = blockByBlock.get(b);
  if (hit !== undefined) return hit;
  const tools: ToolProgress[] = [];
  for (let i = 0; i < b.tools.length; i++) tools.push(toToolProgress(b.tools[i]));
  const out: HistoryIteration = {
    iteration: b.iteration,
    content: b.content,
    reasoning: b.reasoning,
    tools,
    tools_folded: false,
    rev: ++rev.n,
  };
  if (b.subAgents.length > 0) {
    out.subAgents = b.subAgents as unknown as HistoryIteration['subAgents'];
  }
  blockByBlock.set(b, out);
  return out;
}

function toHistoryIterations(bs: readonly Block[]): HistoryIteration[] {
  const out: HistoryIteration[] = [];
  for (let i = 0; i < bs.length; i++) out.push(toHistoryIteration(bs[i]));
  return out;
}

/** 行对象缓存（键 = 行 id；**身份稳定** ⇒ LazyForEach 不会重建行）。 */
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
  row.compactions = [];
  row.subAgents = [];
  row.iterBlocks.blocks = [];
  row.iterBlocks.rev = row.iterBlocks.rev + 1;
}

function fillAssistant(row: ChatRow, r: PAssistantRow, isLive: boolean): void {
  row.role = 'assistant';
  row.turnID = r.turnID;
  // 顶层 content 只承载"在飞正文"（已提交正文在各块里，⛔ 不重复）
  row.content = r.inflight === null ? '' : r.inflight.content;
  // 已提交块（原样；引用稳定）
  row.iterations = toHistoryIterations(r.blocks);
  row.completedBlocks = row.iterations;
  row.isLive = isLive;
  row.isNotification = false;
  row.sending = false;
  row.queued = false;
  row.regionsBefore = r.regionsBefore;
  row.compactions = r.compactions as unknown as ChatRow['compactions'];
  // 在飞内容由页面（LiveTailView）承载；这里只给「有在飞」的信号与最后迭代号
  row.subAgents = [];
  const blocks = row.iterations;
  if (row.iterBlocks.blocks !== blocks) {
    row.iterBlocks.blocks = blocks;
    row.iterBlocks.rev = row.iterBlocks.rev + 1;
  }
  if (isLive) row.liveRevision = row.liveRevision + 1;
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
    const r = rows[i];
    const key = r.id;
    seen.add(key);
    let row = cache.get(key);
    if (row === undefined) {
      row = new ChatRow();
      row.id = key;
      cache.set(key, row);
    }
    if (r.kind === 'user') {
      fillUser(row, r);
    } else {
      fillAssistant(row, r, r.finalized === false);
    }
    out.push(row);
  }
  // 淘汰已消失的行（会话切换/回合被删）
  const stale: string[] = [];
  cache.forEach((_v: ChatRow, k: string) => {
    if (!seen.has(k)) stale.push(k);
  });
  for (let i = 0; i < stale.length; i++) cache.delete(stale[i]);
  return out;
}
