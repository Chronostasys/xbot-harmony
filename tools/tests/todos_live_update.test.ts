/** 判据：todos/goal 必须**在流式帧**里就生效（用户 2026-10-21：不能等 turn end）。 */
declare const process: { exit: (c: number) => void };
import { normalizeEvent } from '../../entry/src/main/ets/core/normalize';
import { reduce } from '../../entry/src/main/ets/core/reduce';
import { ChatState, DomainEvent, initialChatState } from '../../entry/src/main/ets/core/chat_types_full';

let pass = 0, fail = 0;
function ok(n: string, c: boolean): void { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`); } }

// 一条**带 stream_content** 的帧 + todos（turn 进行中的真实形态）
const raw = {
  type: 'progress_structured',
  progress: {
    chat_id: 'c', phase: '', turn_id: 1, seq: 7, stream_content: 'hi',
    todos: [{ text: '写代码', status: 'in_progress' }, { text: '跑测试', status: 'pending' }],
  },
};
const evs = normalizeEvent(raw, 'c');
let s: ChatState = initialChatState('c');
if (evs !== null) { for (const e of evs) { s = reduce(s, e); } }
ok('流式帧产出事件', evs !== null && evs.length > 0);
ok('★ todos 在**流式帧**里就进状态机（不是等 phase_done）', s.todos.length === 2 && s.todos[0].status === 'in_progress');
ok('★ 且流式正文同时生效（两件事互不影响）',
  evs !== null && (evs[0] as unknown as { type: string }).type === 'stream');

console.log(`\n  todos_live_update: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
export {};
