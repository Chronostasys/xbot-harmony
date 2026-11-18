/**
 * 判据：**子代理转录必须建 turn 结构**（否则渲染顺序错）。
 *
 * 用户 2026-10-27 P0：子代理历史渲染成「agent 历史 → 用户消息 → 思考中」，
 *   正确应是「用户消息 → agent 历史 → 思考中」。
 *
 * 根因：旧实现把 dump 的所有行 `turnID: 0` ⇒ 整批进 `historyToReplaced` 的 **legacy 段**，
 *   而 legacy 在渲染上**排在 turns 之前**（锚点无效即沉底）⇒ 顺序必然反转。
 *
 * 修法（`ChatStore.parseSubAgentMessages`）：按 dump 行序建 turn —— `user` 开一轮
 *   （`turnSeq++`），其后 `assistant` 归该轮；连续多条 assistant 合并进同一条
 *   （一个 turn 只有一个 assistant 槽）；`iterations` 挂最后一条 assistant，该轮没有
 *   assistant（v55 空壳被跳过）⇒ **追加到当前 turn**（顺序 = user → assistant）。
 *
 * ⛔ mutation 自证：
 *   · `turnID` 改回恒 0 ⇒ 用例① 红（又回 legacy）；
 *   · 不合并连续 assistant ⇒ 用例③ 红（同一 turn 出现两条 assistant，渲染只有一个槽）；
 *   · iterations 追加时不带当前 turnID（用 0/1 固定）⇒ 用例② 红。
 */
declare const process: { cwd: () => string; exit: (c: number) => void };
declare const require: (m: string) => any;

import { ChatStore } from '../../entry/src/main/ets/core/store';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function row(role: string, content: string): Record<string, Object> {
  return { role: role, content: content } as Record<string, Object>;
}

// ── ① user 开一轮、assistant 归该轮（顺序与 turnID 都对）─────────────────────
{
  const parsed = ChatStore.parseSubAgentMessages([
    row('user', '问题一'), row('assistant', '回答一'),
    row('user', '问题二'), row('assistant', '回答二'),
  ], []);
  eq('① 行序 = user → assistant → user → assistant',
    parsed.map((m) => `${m.role}:${m.content}`), ['user:问题一', 'assistant:回答一', 'user:问题二', 'assistant:回答二']);
  eq('① turnID = 1,1,2,2', parsed.map((m) => m.turnID), [1, 1, 2, 2]);
  ok('① 不再有 turnID=0 的行（那会掉进 legacy 段 ⇒ 排到最前）',
    parsed.every((m) => m.turnID > 0));
}

// ── ② 只有 user + iterations（v55 空壳被跳过）⇒ assistant 追加到**当前** turn ─────
{
  const parsed = ChatStore.parseSubAgentMessages([
    row('user', '问题'), row('assistant', ''),   // 空壳被跳过
  ], [{ iteration: 1, content: '思考A', reasoning: '', tools: [] }]);
  eq('② 行数 = 2（user + 承载 iterations 的 assistant）', parsed.length, 2);
  eq('② 顺序 = user 在前', parsed.map((m) => m.role), ['user', 'assistant']);
  eq('② 承载行与 user 同一 turn（顺序才对）',
    [parsed[0].turnID, parsed[1].turnID], [1, 1]);
  eq('② iterations 传给了该 assistant 行', parsed[1].iterations.length, 1);
}

// ── ③ 同一 turn 的多条 assistant 合并（一个 turn 只有一个 assistant 槽）────────
{
  const parsed = ChatStore.parseSubAgentMessages([
    row('user', '问题'), row('assistant', '第一段'), row('assistant', '第二段'),
  ], []);
  eq('③ 合并成一条 assistant', parsed.filter((m) => m.role === 'assistant').length, 1);
  eq('③ 两段内容都在（用空行连接）', parsed[1].content, '第一段\n\n第二段');
}

// ── ④ 首行就是 assistant（没有 user）也要有 turn 身份（不许回 legacy）─────────
{
  const parsed = ChatStore.parseSubAgentMessages([row('assistant', '孤儿回答')], []);
  eq('④ 首行 assistant 也落 turn 1', parsed[0].turnID, 1);
  ok('④ 不是 legacy（turnID > 0）', parsed[0].turnID > 0);
}

// ── ⑤ 接线：dump 路径必须用 turn 化的解析（不是恒 0 的旧实现）──────────────────
{
  const store: string = require('fs').readFileSync(
    require('path').join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');
  ok('⑤ 解析器是 `static parseSubAgentMessages`（可单测）',
    /static parseSubAgentMessages\(raw: Object\[\], rawIterations\?: Object\[\], liveTail: boolean = false\): ChatMessage\[\]/.test(store));
  ok('⑤ 不再出现 `turnID: 0` 的整批塞 legacy 写法（子代理转录段内）',
    /parseSubAgentMessages[\s\S]{0,4000}turnID: 0,/.test(store) === false);
  ok('⑤ dump 路径调用同一解析器',
    /ChatStore\.parseSubAgentMessages\(messages, dumpIts\)/.test(store));
}

console.log(`subagent_transcript_order: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
