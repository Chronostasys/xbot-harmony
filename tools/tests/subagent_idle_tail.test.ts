/**
 * 子代理转录**尾部迭代**判据（用户 2026-11-14：「打开 idle 的子代理视图，看不到最后输出的
 * 最后回复，只能看到倒数第二个迭代的 toolcall，似乎最后一个迭代丢失了」）。
 *
 * 真因（客户端 bug，`ChatStore.parseSubAgentMessages`）：
 *
 *     const safeIters = iters.length > 1 ? iters.slice(0, iters.length - 1) : iters;
 *
 *   这句话是 2026-11-04 为修「子代理 live 进度不渲染」加的（思路：dump 里的**在飞**迭代
 *   交给 SSE 接管，先别提交成块）。但它**按数量无条件丢最后一个**——
 *   子代理 **idle**（跑完了 / 没有 SSE）时没人接管 ⇒ 最后一个迭代（通常就是最终回复）
 *   永久丢失，用户只看到倒数第二个迭代的 toolcall。
 *
 * 修法：把"是否在飞"变成**显式入参**（`liveTail`）：
 *   · `liveTail === true`（该子代理**正在运行**）⇒ 丢最后一个，交给 SSE；
 *   · `liveTail === false`（idle / 已完成）⇒ **全部保留**。
 *
 * mutation 自证：把 `liveTail` 判断去掉（恢复无条件丢尾部）⇒ §1 红；
 *              反之永远保留（不丢）⇒ §2 红（在飞迭代会被提交成块，SSE 再也接管不了）。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { ChatMessage } from '../../entry/src/main/ets/core/chattypes';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`);
  }
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`);
}

const MSGS: Object[] = [
  { role: 'user', content: '跑一下构建' },
  { role: 'assistant', content: '' },   // v55：正文在 iterations 里
];
const ITS: Object[] = [
  { iteration: 1, content: '', tools: [{ name: 'Shell', status: 'done', summary: 'npm run build' }] },
  { iteration: 2, content: '构建通过，产物在 dist/。' },   // ← 最终回复
];

function assistantOf(msgs: ChatMessage[]): ChatMessage | null {
  for (const m of msgs) {
    if (m.role === 'assistant') {
      return m;
    }
  }
  return null;
}

console.log('\n▶ §1 idle（无 SSE 接管）⇒ 最后一个迭代必须保留');
{
  const out: ChatMessage[] = ChatStore.parseSubAgentMessages(MSGS, ITS);
  const a: ChatMessage | null = assistantOf(out);
  ok('§1 有 assistant 槽', a !== null);
  eq('§1 两个迭代都在（修复前只有 1 个）', a !== null ? a.iterations.length : -1, 2);
  eq('§1 最终回复（iter 2 正文）在', a !== null && a.iterations.length > 1 ? a.iterations[1].content : '', '构建通过，产物在 dist/。');
  eq('§1 倒数第二个迭代的 toolcall 也在', a !== null && a.iterations.length > 0
    ? a.iterations[0].tools.length : -1, 1);
}

console.log('\n▶ §2 在飞（liveTail=true）⇒ 丢最后一个交给 SSE');
{
  const out: ChatMessage[] = ChatStore.parseSubAgentMessages(MSGS, ITS, true);
  const a: ChatMessage | null = assistantOf(out);
  eq('§2 只提交已完成的 1 个迭代', a !== null ? a.iterations.length : -1, 1);
  eq('§2 被丢的是尾部那个（iter 2）', a !== null && a.iterations.length > 0 ? a.iterations[0].iteration : -1, 1);
}

console.log('\n▶ §3 单迭代的保守规则不变');
{
  const one: Object[] = [{ iteration: 1, content: '只有一轮' }];
  const idle: ChatMessage | null = assistantOf(ChatStore.parseSubAgentMessages(MSGS, one));
  eq('§3 idle 单迭代 ⇒ 保留', idle !== null ? idle.iterations.length : -1, 1);
  const running: ChatMessage | null = assistantOf(ChatStore.parseSubAgentMessages(MSGS, one, true));
  eq('§3 liveTail 单迭代 ⇒ 也保留（否则视图空壳）', running !== null ? running.iterations.length : -1, 1);
}

console.log(`\n=== subagent_idle_tail: ${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}
export {};
