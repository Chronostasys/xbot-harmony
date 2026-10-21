/**
 * SSE 失败分类门禁 —— `core/sse.ets` 的**终态判据**（纯函数）。
 *
 * 真机缺陷（2026-10-11，用户亲报「新建会话后一直在连接中」）的**第二个面**：
 * `requestInStream` 的完成回调对**任何**失败都 `scheduleReconnect()` ⇒ 服务端**明确拒绝**
 * （`/api/sse` 对未知/已删除会话回 404 `session not found`、无权回 403 `access denied`）时
 * 客户端会**无限重连**、界面**永久**「连接断开，正在重连…」。本波把判据抽成纯函数：
 *   · **4xx（除 408/429）= 终态** ⇒ 停止重连（判据可测）；
 *   · 其余（0 / 3xx / 5xx / 超时 / 429 限流 / 408）= 瞬态 ⇒ 退避重试。
 *
 * 守护的不变量：
 *   · 终态码**绝不**被判成瞬态（否则死循环复现）；
 *   · 瞬态码**绝不**被判成终态（否则弱网一次抖动就永久放弃）；
 *   · `failed` 状态下看门狗**不许**再踢它重连（否则终态被自己人打破）；
 *   · 终态原因**绝不空手而归**（未知码也要有可读文案）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  SSE_OUTCOME_TERMINAL,
  SSE_OUTCOME_TRANSIENT,
  SSE_STATE_FAILED,
  WATCHDOG_IDLE,
  classifyStreamOutcome,
  reasonForStreamStatus,
  watchdogDecision,
} from '../../entry/src/main/ets/core/sse';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

// ── 常量：契约钉死（收敛"终态/瞬态/失败状态"的字面量，便于跨模块引用）──────────────
eq('SSE_OUTCOME_TERMINAL 字面量', SSE_OUTCOME_TERMINAL, 'terminal');
eq('SSE_OUTCOME_TRANSIENT 字面量', SSE_OUTCOME_TRANSIENT, 'transient');
eq('SSE_STATE_FAILED 字面量', SSE_STATE_FAILED, 'failed');

// ── classifyStreamOutcome：4xx（除 408/429）= 终态；其余 = 瞬态 ─────────────────
// 终态：服务端"看懂并明确拒绝" ⇒ 重试只会拿到同一个答案。
eq('404 session not found ⇒ 终态', classifyStreamOutcome(404), SSE_OUTCOME_TERMINAL);
eq('403 access denied ⇒ 终态', classifyStreamOutcome(403), SSE_OUTCOME_TERMINAL);
eq('401 unauthorized ⇒ 终态（由调用方另行路由到登录）', classifyStreamOutcome(401), SSE_OUTCOME_TERMINAL);
eq('400 chat_id is required ⇒ 终态', classifyStreamOutcome(400), SSE_OUTCOME_TERMINAL);
eq('405 method not allowed ⇒ 终态', classifyStreamOutcome(405), SSE_OUTCOME_TERMINAL);
eq('499（4xx 边界上沿）⇒ 终态', classifyStreamOutcome(499), SSE_OUTCOME_TERMINAL);
eq('418 ⇒ 终态（任意 4xx）', classifyStreamOutcome(418), SSE_OUTCOME_TERMINAL);

// 瞬态例外：重试有意义，不能永久放弃。
eq('408 Request Timeout ⇒ 瞬态（例外）', classifyStreamOutcome(408), SSE_OUTCOME_TRANSIENT);
eq('429 Too Many Requests ⇒ 瞬态（例外，退避后可能恢复）', classifyStreamOutcome(429), SSE_OUTCOME_TRANSIENT);

// 瞬态：无响应 / 网络层失败 / 服务端临时故障 / 重定向。
eq('0（未拿到响应）⇒ 瞬态', classifyStreamOutcome(0), SSE_OUTCOME_TRANSIENT);
eq('200（写回调失败 CURLE_WRITE_ERROR 场景）⇒ 瞬态', classifyStreamOutcome(200), SSE_OUTCOME_TRANSIENT);
eq('301 ⇒ 瞬态', classifyStreamOutcome(301), SSE_OUTCOME_TRANSIENT);
eq('500 ⇒ 瞬态', classifyStreamOutcome(500), SSE_OUTCOME_TRANSIENT);
eq('502 ⇒ 瞬态', classifyStreamOutcome(502), SSE_OUTCOME_TRANSIENT);
eq('503 ⇒ 瞬态', classifyStreamOutcome(503), SSE_OUTCOME_TRANSIENT);
eq('399（3xx 上沿）⇒ 瞬态', classifyStreamOutcome(399), SSE_OUTCOME_TRANSIENT);
eq('500 边界（非 4xx 段）⇒ 瞬态', classifyStreamOutcome(600), SSE_OUTCOME_TRANSIENT);

// ── reasonForStreamStatus：终态原因"绝不空手而归" ─────────────────────────────
eq('404 ⇒ 会话不存在或已被删除', reasonForStreamStatus(404), '会话不存在或已被删除');
eq('403 ⇒ 无权访问该会话', reasonForStreamStatus(403), '无权访问该会话');
eq('400 ⇒ 请求参数不合法', reasonForStreamStatus(400), '请求参数不合法');
eq('405 ⇒ 请求方法不被支持', reasonForStreamStatus(405), '请求方法不被支持');
eq('401 ⇒ 登录已失效', reasonForStreamStatus(401), '登录已失效');
ok('未知码仍给可读文案（含状态码）',
  reasonForStreamStatus(418).indexOf('HTTP 418') >= 0, reasonForStreamStatus(418));
ok('未知码文案非空', reasonForStreamStatus(499).length > 0, reasonForStreamStatus(499));

// ── 看门狗在 failed 状态下必须罢手（否则终态会被自己人打破）─────────────────────
const NOW = 1700000000000;
eq('failed ⇒ 看门狗 IDLE（不再重连）',
  watchdogDecision(SSE_STATE_FAILED, false, 0, 0, NOW, 45000, 20000, false), WATCHDOG_IDLE);
eq('failed 且无底层连接也不 RESTART',
  watchdogDecision(SSE_STATE_FAILED, false, NOW - 100000, NOW - 100000, NOW, 45000, 20000, false), WATCHDOG_IDLE);

if (fail > 0) { console.log(`  sse_terminal: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  sse_terminal: ${pass} passed, 0 failed`);
process.exit(0);

export {};
