/**
 * `model_hydrate` 判据：权威历史 → `State`（`docs/STATE-MODEL.md` §3.5 水合）。
 *
 * 断言：
 *  ① `turnID > 0` 的 user+assistant 组成一个 `TurnRec`（user 绑定、块=iterations、final=最后一段文本）；
 *  ② `turnID == 0` 的行进 `legacy`（DB 前缀），保持顺序；
 *  ③ 同一 turn 的分片 assistant 行 ⇒ 块**追加**，文本取最后一段；
 *  ④ 会话级字段（goal/todos/running）**不被历史覆盖**（历史里没有它们）；
 *  ⑤ `live` 不被历史清掉（在飞态由 snapshot/tick 负责）。
 */
declare const process: { exit: (c: number) => void };

import { hydrate } from '../../entry/src/main/ets/core/model_hydrate';
import type { WireHistoryMessage } from '../../entry/src/main/ets/core/model_hydrate';
import { emptyState } from '../../entry/src/main/ets/core/model_types';
import type { State } from '../../entry/src/main/ets/core/model_types';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const base: State = emptyState('c1', 7, 42);
const withSession: State = {
  ...base,
  sess: { running: true, todos: ['a'], goal: { kind: 'value', objective: 'g', status: 'doing' }, queue: [] },
  live: { turn: 9, iteration: 3, content: 'live', reasoning: '', tools: [], genui: '' },
};

const MSGS: readonly WireHistoryMessage[] = [
  // legacy（无 turn）
  { id: 'm1', role: 'user', content: 'old q', dbID: 1 },
  { id: 'm2', role: 'assistant', content: 'old a', dbID: 2, iterations: [{ iteration: 1, content: 'old a' }] },
  // turn 3：user + assistant（两迭代）
  { id: 'm3', role: 'user', content: 'q3', turnID: 3, dbID: 3 },
  {
    id: 'm4', role: 'assistant', content: 'a3', turnID: 3, dbID: 4,
    iterations: [
      { iteration: 1, content: '', tools: [{ name: 'Shell', status: 'done', call_id: 'c1' }] },
      { iteration: 2, content: 'a3' },
    ],
  },
  // turn 4：分片助手（两段）
  { id: 'm5', role: 'user', content: 'q4', turnID: 4, dbID: 5 },
  { id: 'm6', role: 'assistant', content: 'part1', turnID: 4, dbID: 6, iterations: [{ iteration: 1, content: 'part1' }] },
  { id: 'm7', role: 'assistant', content: 'part2', turnID: 4, dbID: 7, iterations: [{ iteration: 2, content: 'part2' }] },
];

const s: State = hydrate(withSession, MSGS, 99);

eq('① 水位推进到快照 seq', s.seq, 99);
eq('① legacy 两行', s.legacy.length, 2);
eq('① legacy 顺序/角色', s.legacy.map((l) => `${l.role}:${l.content}`), ['user:old q', 'assistant:old a']);
eq('② turn 3 存在', s.turns.has(3), true);
eq('② turn 3 的 user 绑定', s.turns.get(3)?.user?.content, 'q3');
eq('② turn 3 的块数', s.turns.get(3)?.blocks.length, 2);
eq('② turn 3 的 final 文本', s.turns.get(3)?.final?.content, 'a3');
eq('③ turn 3 块内工具号==块号', s.turns.get(3)?.blocks[0].tools[0].iteration, 1);
eq('③ turn 3 工具 call_id 透传', s.turns.get(3)?.blocks[0].tools[0].call, 'c1');
eq('④ 分片助手的块追加（2 块）', s.turns.get(4)?.blocks.length, 2);
eq('④ 分片助手的终稿取最后一段', s.turns.get(4)?.final?.content, 'part2');
eq('⑤ 会话级字段不被历史覆盖（running）', s.sess.running, true);
eq('⑤ 会话级字段不被历史覆盖（todos）', s.sess.todos.length, 1);
eq('⑤ 会话级字段不被历史覆盖（goal）', s.sess.goal.kind, 'value');
eq('⑤ live 不被历史清掉', s.live === null ? null : s.live.iteration, 3);

console.log(`\nmodel_hydrate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
