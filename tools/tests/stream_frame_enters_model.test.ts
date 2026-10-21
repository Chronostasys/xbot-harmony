/**
 * stream_frame_enters_model.test.ts —— **`stream` 帧必须进模型**（打字机/在飞工具的唯一来源）。
 *
 * 根因（本轮审计抓到）：`normalize` 产出的 `stream` DomainEvent 用字段 **`iteration`**
 * （`normalize.ts:207/412`），而 `model_adapter` 只读 **`iter`** ⇒ 迭代号恒 0 ⇒
 * **不产生 tick** ⇒ 正文/思考/`streamingTools` 全丢（只有已提交块，页面"卡在上一迭代"）。
 * 这条一度被"页面尾块仍读旧 `ChatState.liveProgress()`"掩盖 —— 行源切换后就是 P0。
 *
 * 判据：同一段 wire 事件，`stream`（iteration 字段）与 `iteration`（iter 字段）**等价**地
 * 驱动同一 live 块。
 *
 * ⚠️ 判别力自证：把 `model_adapter` 的 `iteration` 兜底删掉（只认 `iter`）⇒ §A/§B 必红。
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

function assistant(rows: ChatRow[]): ChatRow {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role === 'assistant') { return rows[i]; }
  }
  throw new Error('没有 assistant 行');
}

function liveBlock(row: ChatRow): HistoryIteration {
  const its = row.iterations;
  return its[its.length - 1];
}

// ── §A `stream`（字段名 iteration）必须驱动 live 正文/思考 ────────────────────
const f = new ModelFeed('chat_stream');
f.push({ type: 'turn_started', turnID: 1, trigger: 'user', content: 'q', requestID: 'r1', seq: 1 });
f.push({
  type: 'stream', turnID: 1, iteration: 1, seq: 2,
  content: '边想边写', reasoning: '思考中', streamingTools: [],
});
const b = liveBlock(assistant(f.rows()));
ok('★A stream 帧的正文进入 live 块', b.content === '边想边写');
ok('★A stream 帧的思考进入 live 块', b.reasoning === '思考中');
ok('★A live 块的迭代号 = 帧里的 iteration', b.iteration === 1);
ok('★A live 块带打字机标记', b.live === true);

// ── §B 与 `iteration`（字段名 iter）等价：同一正文落到同一形状 ─────────────────
const g = new ModelFeed('chat_stream2');
g.push({ type: 'turn_started', turnID: 1, trigger: 'user', content: 'q', requestID: 'r1', seq: 1 });
g.push({ type: 'iteration', turnID: 1, iter: 1, seq: 2, content: '边想边写', reasoning: '思考中',
  activeTools: [], completedTools: [], streamingTools: [] });
const bg = liveBlock(assistant(g.rows()));
ok('★B iteration 帧与 stream 帧等价（正文）', bg.content === b.content);
ok('★B iteration 帧与 stream 帧等价（思考）', bg.reasoning === b.reasoning);

// ── §C stream 帧里的 streamingTools 必须在 live 块可见 ────────────────────────
f.push({
  type: 'stream', turnID: 1, iteration: 1, seq: 3,
  content: '边想边写', reasoning: '思考中',
  streamingTools: [{ name: 'Shell', label: 'Shell: ls', status: 'generating', call_id: 'c9', iteration: 1, elapsedMs: 0, genChars: 3 }],
});
const ts = liveBlock(assistant(f.rows())).tools as ToolProgress[];
ok('★C streamingTools 进入 live 块', ts !== undefined && ts.length === 1 && ts[0].call_id === 'c9');
ok('★C 生成态（generating）不被改写', ts[0].status === 'generating');

// ── §D 陈旧工具（自带 iteration 更小）不得被重新盖章成当前迭代 ────────────────
const h = new ModelFeed('chat_stream3');
h.push({ type: 'turn_started', turnID: 1, trigger: 'user', content: 'q', requestID: 'r1', seq: 1 });
h.push({ type: 'iteration', turnID: 1, iter: 1, seq: 2, content: '', reasoning: '',
  activeTools: [{ name: 'Shell', label: 'Shell', status: 'done', call_id: 'old1', iteration: 1, elapsedMs: 9 }],
  completedTools: [], streamingTools: [],
  iterationsDelta: [{ iteration: 1, content: '', reasoning: '', tools: [] }] });
h.push({ type: 'iteration', turnID: 1, iter: 2, seq: 3, content: 'new', reasoning: '',
  activeTools: [{ name: 'Shell', label: 'Shell', status: 'pending', call_id: 'old1', iteration: 1, elapsedMs: 9 }],
  completedTools: [], streamingTools: [] });
const liveRow = assistant(h.rows());
const liveIter: number = liveBlock(liveRow).iteration;
ok('★D live 块在迭代 2', liveIter === 2);
const liveTools2: ToolProgress[] = liveBlock(liveRow).tools !== undefined
  ? liveBlock(liveRow).tools as ToolProgress[] : [];
ok('★D 陈旧（iteration=1）的工具不落到迭代 2 的 live 块',
  liveTools2.length === 0 || liveTools2[0].iteration === 1);

console.log(`  stream_frame_enters_model: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
