/**
 * 子代理会话的 **SSE 会话边界判据**（用户 2026-11-14：「感觉不是收不到而是包被过滤了/丢了」）。
 *
 * 真因：`normalize.ts` 的 `stripChannel()` **只剥第一段 `channel:` 前缀**：
 *
 *     stripChannel('agent:web:chat_T/explore:inst') === 'web:chat_T/explore:inst'
 *     stripChannel('web:chat_T/explore:inst')       === 'chat_T/explore:inst'      ← 不相等 ⇒ 丢包
 *
 * 子代理全键本身**含多段冒号**（`<channel>:<parentChat>/<role>:<instance>`）⇒ 任何
 * "剥一层前缀再字符串相等"的判据在两个方向上都会错位 ⇒ **进度包在进入状态机之前就被丢掉**，
 * 表现就是"子代理视图收不到 SSE"。
 *
 * 修法（本判据钉死）：剥掉**所有已知渠道前缀**（循环剥到稳定），再比较。
 *
 * mutation 自证：把 `stripChannel` 改回"只剥第一个冒号" ⇒ §1/§2 立刻红。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { normalizeEvent } from '../../entry/src/main/ets/core/normalize';

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

/** 一条最小可用的流式帧（chat 归属在顶层 `chat_id`）。 */
function streamRaw(chatId: string): unknown {
  return {
    type: 'stream_content',
    chat_id: chatId,
    progress: { turn_id: 2, iteration: 1, stream_content: '实时正文' },
  };
}

console.log('\n▶ §1 子代理会话：两种前缀形态都必须通过');
{
  const sub: string = 'web:chat_T/explore:inst';
  const full: string = 'agent:web:chat_T/explore:inst';
  ok('§1 面板=agent:全键，帧=裸全键 ⇒ 不丢',
    normalizeEvent(streamRaw(sub), full) !== null);
  ok('§1 面板=裸全键，帧=agent:全键 ⇒ 不丢',
    normalizeEvent(streamRaw(full), sub) !== null);
  ok('§1 两边都是 agent: 全键 ⇒ 不丢',
    normalizeEvent(streamRaw(full), full) !== null);
}

console.log('\n▶ §2 回归：普通会话的边界仍然成立');
{
  ok('§2 同会话（带/不带 web 前缀）⇒ 通过',
    normalizeEvent(streamRaw('web:chat_A'), 'chat_A') !== null
    && normalizeEvent(streamRaw('chat_A'), 'web:chat_A') !== null);
  ok('§2 ⛔ 别的会话必须丢（不能因为放宽而串台）',
    normalizeEvent(streamRaw('web:chat_B'), 'web:chat_A') === null);
  ok('§2 ⛔ 别的父会话的子代理也必须丢',
    normalizeEvent(streamRaw('web:chat_OTHER/explore:inst'), 'web:chat_T/explore:inst') === null);
  ok('§2 无 chat 归属（legacy 控制帧）⇒ 通过',
    normalizeEvent({ type: 'stream_content', progress: { turn_id: 1, stream_content: 'x' } }, 'web:chat_A') !== null);
}

console.log(`\n=== subagent_sse_filter: ${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}
