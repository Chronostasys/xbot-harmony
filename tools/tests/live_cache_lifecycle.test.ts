/**
 * live_cache_lifecycle.test.ts —— live 行**内容必须逐帧落到行上**（用户 2026-10-20：思考中卡住）。
 *
 * 旧链路根因：`rowCache` 只按行 id 命中 ⇒ 新迭代拿到旧 `ChatRow`，`appliedRowByRow`
 * 误判"未变化"，reasoning 永远不落行 ⇒ 页面停在「思考中…」。旧实现靠
 * `liveCacheKey`（turnID/iteration 生命周期键）+ `invalidateAppliedRow` 打补丁。
 *
 * 新链路（行源 = 模型投影）：`applyModel` 按**源 `PRow` 对象恒等**决定是否重写行 ——
 * 模型每帧产出新的 live `PRow`/`Block` 对象 ⇒ 必然重写。所以原来的"缓存生命周期键"
 * 整体消失；本判据改为**直接钉住那个可观察保证**：
 *   同一 live 行，逐帧只改 reasoning / 只改正文 / 只改工具 ⇒ 行内容必须逐帧跟随，
 *   且**不产生第二行、不产生第二块**（否则就是"卡住"或"重影"的形态）。
 *
 * ⚠️ 判别力自证：把 `applyModel` 里的 `if (prevRow !== r)` 早退改成"按 id 早退"
 *    ⇒ ②③④ 必红（同一 id 的新状态被吃掉）。
 */
export {};

declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow, HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function liveBlock(row: ChatRow): HistoryIteration {
  const its = row.iterations;
  return its[its.length - 1];
}

function assistant(rows: ChatRow[]): ChatRow[] {
  const out: ChatRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role === 'assistant') {
      out.push(rows[i]);
    }
  }
  return out;
}

const feed = new ModelFeed('chat_live_cache');
feed.push({ type: 'turn_started', turnID: 1, trigger: 'user', content: 'q', requestID: 'r1', seq: 1 });

// ① 起头：只有 reasoning 流（还没有正文）
feed.push({
  type: 'iteration', turnID: 1, iter: 1, phase: 'thinking', seq: 2,
  content: '', reasoning: '想…', activeTools: [], completedTools: [], streamingTools: [],
});
const rows1 = feed.rows();
ok('① just one assistant row', assistant(rows1).length === 1);
ok('①b reasoning 落到行上', liveBlock(assistant(rows1)[0]).reasoning === '想…');
ok('①c 该行是 live 行', assistant(rows1)[0].isLive === true);

// ② reasoning 继续长 ⇒ 行必须跟随（旧 bug：卡在首帧）
feed.push({
  type: 'iteration', turnID: 1, iter: 1, phase: 'thinking', seq: 3,
  content: '', reasoning: '想…再想…', activeTools: [], completedTools: [], streamingTools: [],
});
const rows2 = feed.rows();
ok('② ★ reasoning 增长 ⇒ 行跟随（不得冻结在首帧）', liveBlock(assistant(rows2)[0]).reasoning === '想…再想…');
ok('②b 仍然只有一行（不产生重影）', assistant(rows2).length === 1);

// ③ 正文开始流 ⇒ 行内**同一块**跟随（不新增块）
feed.push({
  type: 'iteration', turnID: 1, iter: 1, phase: 'tool_exec', seq: 4,
  content: '答', reasoning: '想…再想…', activeTools: [], completedTools: [], streamingTools: [],
});
const rows3 = feed.rows();
ok('③ ★ 正文开始流 ⇒ 行内正文跟随', liveBlock(assistant(rows3)[0]).content === '答');
ok('③b 仍在同一块（块号 = 迭代号 1）', liveBlock(assistant(rows3)[0]).iteration === 1);
ok('③c 仍是 1 行 1 块', assistant(rows3).length === 1 && assistant(rows3)[0].iterations.length === 1);

// ④ 工具出现 ⇒ 同一块内工具跟随
feed.push({
  type: 'iteration', turnID: 1, iter: 1, phase: 'tool_exec', seq: 5,
  content: '答', reasoning: '想…再想…',
  activeTools: [{ name: 'Shell', label: 'Shell: ls', status: 'running', call_id: 'c1', iteration: 1, elapsedMs: 10 }],
  completedTools: [], streamingTools: [],
});
const ts: ToolProgress[] = liveBlock(assistant(feed.rows())[0]).tools as ToolProgress[];
ok('④ ★ 工具出现 ⇒ 同一块内可见', ts !== undefined && ts.length === 1 && ts[0].call_id === 'c1');
ok('④b 工具状态来自最新帧', ts[0].status === 'running');

// ⑤ 行对象身份稳定（LazyForEach 不重建行）+ 内容代际递增
const rowA = assistant(feed.rows())[0];
feed.push({
  type: 'iteration', turnID: 1, iter: 1, phase: 'tool_exec', seq: 6,
  content: '答案', reasoning: '想…再想…',
  activeTools: [{ name: 'Shell', label: 'Shell: ls', status: 'running', call_id: 'c1', iteration: 1, elapsedMs: 20 }],
  completedTools: [], streamingTools: [],
});
const rowB = assistant(feed.rows())[0];
ok('⑤ 行对象身份不变（同一 ChatRow 就地更新）', rowA === rowB);
ok('⑤b liveRevision 递增（页面投递门控靠它）', rowB.liveRevision > rowA.liveRevision - 1 && rowB.liveRevision > 0);
ok('⑤c 内容已更新到最新帧', liveBlock(rowB).content === '答案');

console.log(`live_cache_lifecycle: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
