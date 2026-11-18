#!/usr/bin/env node
/**
 * `xbot.phone` 插件命令队列的**自测**（不需要手机）。
 *
 * 覆盖四种最容易写错的情形：
 *   ① 单命令：入队 → /poll 取走 → /result 回传 → 工具调用返回该输出；
 *   ② 并发：两条命令同时入队，客户端一次取走两条，回执**乱序**也必须各自对上；
 *   ③ 超时：客户端不取 ⇒ 调用方在 `XBOT_PHONE_WAIT_MS` 后被拒（不能挂死）；
 *   ④ 未知 id 回执 ⇒ 404（不误伤其它等待者）。
 *
 * 用法：node tools/phone/queue_selftest.js
 * ⛔ 自己拉起插件的独立实例（临时端口），不影响正在运行的那个。
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PLUGIN = path.join(process.env.HOME, '.xbot', 'plugins', 'xbot.phone', 'main.js');
const PORT = Number(process.env.SELFTEST_PORT || 18791);
const WAIT_MS = Number(process.env.SELFTEST_WAIT_MS || 1500);

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ''}`);
  }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

function request(method, p, body) {
  return new Promise((resolve) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 10000 },
      (res) => {
        let d = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          try { resolve({ code: res.statusCode, body: JSON.parse(d) }); } catch (e) { resolve({ code: res.statusCode, body: d }); }
        });
      },
    );
    req.on('error', (e) => resolve({ code: 0, body: { error: e.message } }));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (payload.length > 0) {
      req.write(payload);
    }
    req.end();
  });
}

/** 模拟客户端：取一批命令并回传指定结果。 */
async function clientOnce(results) {
  const r = await request('GET', '/poll?wait=500');
  const cmds = (r.body && r.body.commands) || [];
  for (const c of cmds) {
    const want = results[c.tool] || 'OK';
    await request('POST', '/result', { id: c.id, ok: true, output: want, error: '' });
  }
  return cmds;
}

async function main() {
  const child = spawn(process.execPath, [PLUGIN], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: Object.assign({}, process.env, { XBOT_PHONE_PORT: String(PORT), XBOT_PHONE_WAIT_MS: String(WAIT_MS) }),
  });
  child.stdout.on('data', () => {});   // 协议行，自测里忽略
  await new Promise((r) => setTimeout(r, 300));

  try {
    // ① 单命令
    const p1 = request('POST', '/tool', { name: 'phone_screenshot', args: {} });
    await new Promise((r) => setTimeout(r, 150));
    const got1 = await clientOnce({});
    eq('① 客户端取到 1 条', got1.length, 1);
    eq('① 工具名透传', got1[0] && got1[0].tool, 'phone_screenshot');
    const r1 = await p1;
    eq('① 输出回传正确', r1.body, { ok: true, output: 'OK', error: '' });

    // ② 并发 + 乱序回执
    const pa = request('POST', '/tool', { name: 'phone_dump_ui', args: {} });
    const pb = request('POST', '/tool', { name: 'phone_tap', args: { x: 5, y: 6 } });
    await new Promise((r) => setTimeout(r, 150));
    const poll = await request('GET', '/poll?wait=500');
    const cmds = (poll.body && poll.body.commands) || [];
    eq('② 一次取走两条', cmds.length, 2);
    const byTool = {};
    for (const c of cmds) {
      byTool[c.tool] = c.id;
    }
    // 故意乱序：先回 tap，再回 dump
    await request('POST', '/result', { id: byTool.phone_tap, ok: true, output: 'TAPPED', error: '' });
    await request('POST', '/result', { id: byTool.phone_dump_ui, ok: true, output: 'TREE', error: '' });
    const [ra, rb] = await Promise.all([pa, pb]);
    eq('② dump 拿到自己的结果', ra.body.output, 'TREE');
    eq('② tap 拿到自己的结果', rb.body.output, 'TAPPED');

    // ③ 超时（客户端不取）
    const t0 = Date.now();
    const pt = await request('POST', '/tool', { name: 'phone_key', args: { code: 4 } });
    const elapsed = Date.now() - t0;
    ok('③ 超时后返回错误而不是挂死', pt.body.ok === false && typeof pt.body.error === 'string');
    ok('③ 超时时间接近配置值', elapsed >= WAIT_MS - 300, `elapsed=${elapsed}ms wait=${WAIT_MS}ms`);

    // ④ 未知 id
    const bad = await request('POST', '/result', { id: 'cmd-does-not-exist', ok: true, output: 'x' });
    eq('④ 未知 id ⇒ 404', bad.code, 404);
  } finally {
    child.kill();
  }

  console.log(`\n=== phone_queue_selftest: ${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`自测异常：${e.message}`);
  process.exit(1);
});
