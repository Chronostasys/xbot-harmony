/** 空气泡判据测试（真机：无正文/思考/工具的回合渲染成空卡片）。 */
declare const process: { exit: (c: number) => void };

import { rowIsEmpty } from './streammerge';
import { ChatRow } from './types';
import { HistoryIteration, ToolProgress } from './types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function row(content: string, iterations: HistoryIteration[]): ChatRow {
  const r = new ChatRow();
  r.role = 'assistant'; r.content = content; r.iterations = iterations;
  return r;
}
function it(iteration: number, content: string, reasoning: string, tools?: ToolProgress[]): HistoryIteration {
  return { iteration, content, reasoning, tools };
}

eq('全空行 = 空', rowIsEmpty(row('', [])), true);
eq('空迭代壳也算空', rowIsEmpty(row('', [it(1, '', '')])), true);
eq('有正文不算空', rowIsEmpty(row('你好', [])), false);
eq('迭代有正文不算空', rowIsEmpty(row('', [it(1, '回复', '')])), false);
eq('迭代有思考不算空', rowIsEmpty(row('', [it(1, '', '推理中')])), false);
const t1: ToolProgress = { name: 'Shell', status: 'running' };
eq('迭代有工具不算空', rowIsEmpty(row('', [it(1, '', '', [t1])])), false);
eq('流式正文不算空', rowIsEmpty(row('', [{ iteration: 1, content: '', reasoning: '', tools: [], stream_text: '流式' }])), false);
eq('流式思考不算空', rowIsEmpty(row('', [{ iteration: 1, content: '', reasoning: '', tools: [], stream_reasoning: '推' }])), false);
eq('多个空迭代仍算空', rowIsEmpty(row('', [it(1, '', ''), it(2, '', '')])), true);
eq('其一有内容不算空', rowIsEmpty(row('', [it(1, '', ''), it(2, '有', '')])), false);

if (fail > 0) { console.log(`  rowempty: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  rowempty: ${pass} passed, 0 failed`);
process.exit(0);
