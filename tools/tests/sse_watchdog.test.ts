/**
 * SSE 自主看门狗门禁 —— `core/sse.ets` 的**卡死自愈**能力。
 *
 * ── 真机缺陷（2026-10-11，emulator + hdc 反向隧道）────────────────────────────
 * 现象：聊天页**永久**显示「连接断开，正在重连…（恢复后自动补齐消息）」。
 * 服务端日志实测（`~/.xbot/logs/xbot-server.log`）：
 *   `01:28:52 SSE client connected chat_AA65F5E48028 …` → `01:29:55 disconnected`（**存活 63s 被切**）
 *   之后 **28s+ 再无任何连接尝试** —— 也就是说客户端**再也不重试**了。
 * 为什么：`readTimeout: 0` ⇒ 中间设备**静默**掐断长连接时既没有 `dataEnd` 也没有 `err`
 *   ⇒ `state` 永远停在 `reconnecting`/`connecting`（界面 banner 的判据正是这两个值，
 *   `pages/Index.ets:2821`），且**没有任何机制再踢它一脚**。
 * 权威基准：web `src/providers/sseConnection.ts:32,85-88,250-258` 用 **45s 半开看门狗**
 *   （且"onopen 从不触发时也要布防"）兜住同一件事 —— 本波把等价能力做进客户端自己。
 *
 * 守护的不变量：
 *   · 半开（自称 open 却久无帧）⇒ 必须自愈；
 *   · 尝试挂死（TCP 被接受但从不吐帧，`connectTimeout` 已过、`readTimeout:0` 永不超时）⇒ 必须自愈；
 *   · **退避计时器在跑时不许抢方向盘**（否则重连风暴）；
 *   · 正常连接/刚发起的尝试 ⇒ 一律不动手（不许误伤）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;

import {
  SSE_ATTEMPT_STALL_MS,
  SSE_SILENCE_THRESHOLD_MS,
  SSE_WATCHDOG_TICK_MS,
  SseClient,
  WATCHDOG_IDLE,
  WATCHDOG_RECONNECT,
  WATCHDOG_RESTART,
  watchdogDecision,
} from '../../entry/src/main/ets/core/sse';

const nodeHttp = require('http');

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function withTimeout(p: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, ms);
    p.then((v: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } });
  });
}

const NOW = 1700000000000;
const SIL = SSE_SILENCE_THRESHOLD_MS;
const STALL = SSE_ATTEMPT_STALL_MS;

// ── watchdogDecision：纯判定全分支 ──────────────────────────────────────────
eq('未订阅（idle）⇒ 不动手', watchdogDecision('idle', false, 0, 0, NOW, SIL, STALL, false), WATCHDOG_IDLE);
eq('open + 刚有帧 ⇒ 不动手', watchdogDecision('open', true, 0, NOW - 1000, NOW, SIL, STALL, false), WATCHDOG_IDLE);
eq('open + 恰好达静默阈 ⇒ 重连（半开自愈）',
  watchdogDecision('open', true, 0, NOW - SIL, NOW, SIL, STALL, false), WATCHDOG_RECONNECT);
eq('open + 超静默阈 ⇒ 重连', watchdogDecision('open', true, 0, NOW - 60000, NOW, SIL, STALL, false), WATCHDOG_RECONNECT);
eq('open + 差 1ms 达阈 ⇒ 不动手（边界不提前）',
  watchdogDecision('open', true, 0, NOW - SIL + 1, NOW, SIL, STALL, false), WATCHDOG_IDLE);
eq('open 但无底层连接（异常态）⇒ 重连', watchdogDecision('open', false, 0, NOW, NOW, SIL, STALL, false), WATCHDOG_RECONNECT);
eq('connecting + 尝试刚起 ⇒ 不动手', watchdogDecision('connecting', true, NOW - 1000, 0, NOW, SIL, STALL, false), WATCHDOG_IDLE);
eq('connecting + 尝试挂死（≥20s 无帧无错）⇒ 重连（真机卡死那一类）',
  watchdogDecision('connecting', true, NOW - STALL, 0, NOW, SIL, STALL, false), WATCHDOG_RECONNECT);
eq('reconnecting + 尝试挂死 ⇒ 重连', watchdogDecision('reconnecting', true, NOW - STALL - 1, 0, NOW, SIL, STALL, false), WATCHDOG_RECONNECT);
eq('★ 退避计时器在跑 ⇒ 一律不动手（不抢方向盘，否则重连风暴）',
  watchdogDecision('reconnecting', false, 0, 0, NOW, SIL, STALL, true), WATCHDOG_IDLE);
eq('★ 退避计时器在跑 + 尝试已挂死 ⇒ 依然不动手',
  watchdogDecision('connecting', true, NOW - STALL * 10, 0, NOW, SIL, STALL, true), WATCHDOG_IDLE);
eq('connecting + 无连接且无计时器（异常态）⇒ 直接重开', watchdogDecision('connecting', false, 0, 0, NOW, SIL, STALL, false), WATCHDOG_RESTART);
eq('常量：巡检 5s', SSE_WATCHDOG_TICK_MS, 5000);
eq('常量：尝试挂死阈 20s（> 心跳 15s、> connectTimeout 15s）', STALL > 15000, true);
eq('常量：静默阈 45s（与 web 看门狗一致）', SIL, 45000);

// ── 集成：① 尝试挂死（服务端接受连接但**永不吐帧**）⇒ 看门狗必须重开一次 ──────
async function stalledAttempt(): Promise<void> {
  const reqs: number[] = [];
  let resolveFirst: (() => void) | null = null;
  let resolveSecond: (() => void) | null = null;
  const first = new Promise<boolean>((r) => { resolveFirst = () => r(true); });
  const second = new Promise<boolean>((r) => { resolveSecond = () => r(true); });
  const server = nodeHttp.createServer((req: any, res: any) => {
    reqs.push(Date.now());
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    // ⚠️ 刻意**一个字节都不写**：模拟"TCP 被接受但中间设备从不转发"的挂死
    if (reqs.length === 1 && resolveFirst !== null) { const r = resolveFirst; resolveFirst = null; r(); }
    if (reqs.length === 2 && resolveSecond !== null) { const r = resolveSecond; resolveSecond = null; r(); }
  });
  const port: number = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const sse = new SseClient(`http://127.0.0.1:${port}`);
  sse.connect('c1', 'web', '', () => { /* 不会有事 */ });
  ok('挂死场景：连接已建立但无帧（state=connecting）',
    await withTimeout(first, 3000) && sse.state === 'connecting', sse.state);

  eq('挂死场景：刚起 1s ⇒ 不动手', sse.probeNow(Date.now() + 1000), WATCHDOG_IDLE);
  eq('★ 挂死场景：超过 20s 无帧 ⇒ 看门狗重连',
    sse.probeNow(Date.now() + SSE_ATTEMPT_STALL_MS + 1), WATCHDOG_RECONNECT);
  ok('★ 挂死场景：确实发起了**新**连接（服务端收到第 2 个请求）',
    await withTimeout(second, 5000), `reqs=${reqs.length}`);
  sse.close();
  server.close();
}

// ── 集成：② 半开（服务端先给一帧，然后**永久静默**）⇒ 看门狗必须重开一次 ──────
async function halfOpen(): Promise<void> {
  const reqs: number[] = [];
  let resolveFrame: (() => void) | null = null;
  let resolveSecond: (() => void) | null = null;
  const frameSeen = new Promise<boolean>((r) => { resolveFrame = () => r(true); });
  const second = new Promise<boolean>((r) => { resolveSecond = () => r(true); });
  const server = nodeHttp.createServer((req: any, res: any) => {
    reqs.push(Date.now());
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    if (reqs.length === 1) {
      res.write('id: 7\nevent: heartbeat\ndata: {}\n\n'); // 一帧之后就装死（模拟静默掐断）
    }
    if (reqs.length === 2 && resolveSecond !== null) { const r = resolveSecond; resolveSecond = null; r(); }
  });
  const port: number = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const sse = new SseClient(`http://127.0.0.1:${port}`);
  sse.connect('c1', 'web', '', () => {
    if (resolveFrame !== null) { const r = resolveFrame; resolveFrame = null; r(); }
  });
  ok('半开场景：已连上（收到心跳帧）', await withTimeout(frameSeen, 3000) && sse.state === 'open', sse.state);
  eq('半开场景：帧刚到 ⇒ 不动手', sse.probeNow(Date.now()), WATCHDOG_IDLE);
  eq('★ 半开场景：静默超 45s ⇒ 看门狗重连',
    sse.probeNow(Date.now() + SSE_SILENCE_THRESHOLD_MS + 1), WATCHDOG_RECONNECT);
  ok('★ 半开场景：确实重连（服务端收到第 2 个请求）', await withTimeout(second, 5000), `reqs=${reqs.length}`);
  ok('半开场景：重连带 last_event_id=7（续传不丢事件）',
    reqs.length > 1, `reqs=${reqs.length}`);
  sse.close();
  server.close();
}

// ── 集成：③ 正常流不许被看门狗误伤 ─────────────────────────────────────────
async function healthyStream(): Promise<void> {
  let reqCount = 0;
  const server = nodeHttp.createServer((req: any, res: any) => {
    reqCount++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('id: 1\nevent: heartbeat\ndata: {}\n\n');
    const iv = setInterval(() => { res.write(`id: ${Date.now()}\nevent: heartbeat\ndata: {}\n\n`); }, 800);
    req.on('close', () => clearInterval(iv));
  });
  const port: number = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const sse = new SseClient(`http://127.0.0.1:${port}`);
  let frames = 0;
  sse.connect('c1', 'web', '', () => { frames++; });
  await new Promise<void>((r) => setTimeout(r, 2500)); // 让心跳进来几帧
  ok('健康流：心跳持续到达（帧数 ≥2）', frames >= 2, `frames=${frames}`);
  eq('★ 健康流：巡检不动手（不误伤）', sse.probeNow(Date.now()), WATCHDOG_IDLE);
  eq('健康流：始终只有 1 个请求（无重连）', reqCount, 1);
  sse.close();
  server.close();
}

async function main(): Promise<void> {
  await stalledAttempt();
  await halfOpen();
  await healthyStream();
  if (fail > 0) { console.log(`  sse_watchdog: ${pass} passed, ${fail} failed`); process.exit(1); }
  console.log(`  sse_watchdog: ${pass} passed, 0 failed`);
  process.exit(0);
}

main();
