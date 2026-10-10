/**
 * SSE 强制探活门禁 —— `core/sse.ets` 的**判定层** + 「重连必须续传」的真实链路验证。
 *
 * 守护的不变量（对应真机症状"切后台回来消息不再更新"）：
 *   · **静默未超阈 ⇒ 不重连**：健康的连接不能被无谓掐断（掐一次要付重连 + 服务端重放）；
 *   · **超阈才重连**：`readTimeout: 0` 下被静默掐死的连接只能靠"久无帧"识破；
 *   · **连接中/重连中/未订阅 ⇒ 一律不重连**（幂等 ⇒ 不可能双连接）；
 *   · **节流窗口内不重复**（`onPageShow` 抖动）；
 *   · **重连必须带 `last_event_id` 续传**（不丢事件）—— 用**真实本地服务端 + mock 运输层**验，
 *     不是只验字符串拼接。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;

import {
  SSE_FORCE_RECONNECT_THROTTLE_MS,
  SSE_SILENCE_THRESHOLD_MS,
  SseClient,
  buildStreamUrl,
  shouldForceReconnect,
  shouldThrottleForceReconnect,
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

const NOW = 1700000000000;

// ── shouldForceReconnect：只在"看着已连上、但久无帧"时动手 ──────────────────
eq('open + 刚有帧 ⇒ 不重连（健康连接不掐）', shouldForceReconnect('open', true, NOW - 1000, NOW, 45000), false);
eq('open + 恰好达阈 ⇒ 重连', shouldForceReconnect('open', true, NOW - 45000, NOW, 45000), true);
eq('open + 超阈 ⇒ 重连', shouldForceReconnect('open', true, NOW - 60000, NOW, 45000), true);
eq('open + 差 1ms 达阈 ⇒ 不重连（边界不提前）', shouldForceReconnect('open', true, NOW - 44999, NOW, 45000), false);
eq('阈值可注入（10s 阈 + 静默 12s ⇒ 重连）', shouldForceReconnect('open', true, NOW - 12000, NOW, 10000), true);
eq('阈值可注入（60s 阈 + 静默 12s ⇒ 不重连）', shouldForceReconnect('open', true, NOW - 12000, NOW, 60000), false);
eq('connecting ⇒ 不重连（幂等，避免双连接）', shouldForceReconnect('connecting', true, NOW - 600000, NOW, 45000), false);
eq('reconnecting ⇒ 不重连（已有重连在排队）', shouldForceReconnect('reconnecting', false, NOW - 600000, NOW, 45000), false);
eq('idle ⇒ 不重连（未订阅/已关）', shouldForceReconnect('idle', false, 0, NOW, 45000), false);
eq('open 但无底层连接 ⇒ 不重连（交给既有 dataEnd 路径）', shouldForceReconnect('open', false, NOW - 600000, NOW, 45000), false);
eq('open + 从无帧记录（异常态）⇒ 重连（无法证明活着）', shouldForceReconnect('open', true, 0, NOW, 45000), true);
eq('时钟回拨（帧时刻在未来）⇒ 不重连', shouldForceReconnect('open', true, NOW + 5000, NOW, 45000), false);

// ── shouldThrottleForceReconnect：节流窗口 ─────────────────────────────────
eq('从没强探活过 ⇒ 不抑制', shouldThrottleForceReconnect(NOW, 0, 2000), false);
eq('1s 前强探活过（窗口内）⇒ 抑制', shouldThrottleForceReconnect(NOW, NOW - 1000, 2000), true);
eq('恰好出窗 ⇒ 不抑制', shouldThrottleForceReconnect(NOW, NOW - 2000, 2000), false);
eq('5s 前强探活过 ⇒ 不抑制', shouldThrottleForceReconnect(NOW, NOW - 5000, 2000), false);
eq('窗口可注入（10s 窗口 + 5s 前 ⇒ 抑制）', shouldThrottleForceReconnect(NOW, NOW - 5000, 10000), true);
eq('默认常量：静默阈 = 3×心跳(15s)', SSE_SILENCE_THRESHOLD_MS, 45000);
eq('默认常量：节流 2s（覆盖退避起步 1s）', SSE_FORCE_RECONNECT_THROTTLE_MS, 2000);

// ── buildStreamUrl：续传游标（"重连不丢事件"的唯一凭据）─────────────────────
eq('首次订阅不带 last_event_id',
  buildStreamUrl('http://h:1', 'chat-1', 'web', ''),
  'http://h:1/api/sse?chat_id=chat-1&channel=web');
eq('重连带 last_event_id',
  buildStreamUrl('http://h:1', 'chat-1', 'web', '7'),
  'http://h:1/api/sse?chat_id=chat-1&channel=web&last_event_id=7');
eq('baseUrl 尾斜杠被规整',
  buildStreamUrl('http://h:1///', 'c', 'web', ''), 'http://h:1/api/sse?chat_id=c&channel=web');
eq('chat_id/channel 做 URL 编码',
  buildStreamUrl('http://h:1', 'web:chat 1', 'a&b', ''),
  'http://h:1/api/sse?chat_id=web%3Achat%201&channel=a%26b');
eq('last_event_id 做 URL 编码',
  buildStreamUrl('http://h:1', 'c', 'web', 'a/b'), 'http://h:1/api/sse?chat_id=c&channel=web&last_event_id=a%2Fb');

// ── 集成：真实本地服务端 + mock 运输层（验 forceReconnect 真的带游标重连）────
function withTimeout(p: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(false); }
    }, ms);
    p.then((v: boolean) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(v); }
    });
  });
}

async function integration(): Promise<void> {
  const urls: string[] = [];
  let resolveFrame: (() => void) | null = null;
  let resolveSecond: (() => void) | null = null;
  const frameSeen = new Promise<boolean>((r) => { resolveFrame = () => r(true); });
  const secondReq = new Promise<boolean>((r) => { resolveSecond = () => r(true); });

  const server = nodeHttp.createServer((req: any, res: any) => {
    urls.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    // 带 id 的一帧 ⇒ 客户端记下 lastEventId='7'；随后**保持连接不结束**（模拟 readTimeout: 0）
    res.write('id: 7\nevent: text\ndata: {"n":1}\n\n');
    if (urls.length === 2 && resolveSecond !== null) {
      const r = resolveSecond; resolveSecond = null; r();
    }
  });
  const port: number = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  const sse = new SseClient(`http://127.0.0.1:${port}`);
  sse.connect('chat-1', 'web', 'xbot_session=T', (event: string, data: string) => {
    if (resolveFrame !== null) { const r = resolveFrame; resolveFrame = null; r(); }
  });

  ok('SSE 连上并收到帧（id:7 ⇒ lastEventId 已记录）', await withTimeout(frameSeen, 5000));
  eq('连接中：state=open 且持有底层连接', `${sse.state}/${sse.isOpen()}`, 'open/true');

  // ① 静默未超阈 ⇒ 不重连（真实链路：不该多出一次请求）
  eq('静默未超阈 ⇒ forceReconnect 返回 false', sse.forceReconnect(Date.now()), false);

  // ② 模拟"静默很久"（注入 nowMs，等价于后台被冻结 46s）⇒ 重连
  const forced = sse.forceReconnect(Date.now() + SSE_SILENCE_THRESHOLD_MS + 1000);
  eq('静默超阈 ⇒ forceReconnect 返回 true', forced, true);
  // ③ 节流：同一时刻再调 ⇒ 不发第二次
  eq('节流窗口内重复调用 ⇒ false（不连环拆连接）',
    sse.forceReconnect(Date.now() + SSE_SILENCE_THRESHOLD_MS + 2000), false);

  ok('重连请求确实到达服务端', await withTimeout(secondReq, 5000));
  eq('请求总数 = 2（无第三条 ⇒ 幂等，无双连接）', urls.length, 2);
  ok('重连 URL 带上 last_event_id=7（续传，不丢事件）',
    urls.length > 1 && urls[1].indexOf('last_event_id=7') >= 0,
    urls.length > 1 ? urls[1] : '(无第二次请求)');

  sse.close();
  server.close();
}

async function main(): Promise<void> {
  await integration();
  if (fail > 0) { console.log(`  sse: ${pass} passed, ${fail} failed`); process.exit(1); }
  console.log(`  sse: ${pass} passed, 0 failed`);
  process.exit(0);
}

main();
