#!/usr/bin/env node
/**
 * xbot 插件：把**鸿蒙客户端**的手机操作能力注册成 agent 工具。
 *
 * ⛔ 架构（用户 2026-11-08 纠正）：**不允许**用手机内网 IP 直连（手机可能不可达）。
 *    正确链路 = 服务端下发 / 客户端自取：
 *
 *      agent 调 phone_* 工具
 *            → 本插件把命令入队，阻塞等待
 *      客户端（xbot-harmony）**拉取**命令（GET /poll）
 *            → 在设备内执行（hdcd 自连 → uitest）
 *            → POST /result 回传
 *      插件唤醒等待者 → 工具返回
 *
 *    客户端只需能访问**本机 xbot 后端所在的同一台 Mac**（它本来就连着），不需要手机有公网/IP 可达。
 *
 * 端口：8791（插件自己监听，绑定 0.0.0.0 供同网段客户端访问）。
 */
const readline = require('readline');
const http = require('http');

const PORT = Number(process.env.XBOT_PHONE_PORT || 8791);
/** 单个工具调用的最长等待（客户端不在线时快速失败，而不是挂死）。 */
const WAIT_MS = Number(process.env.XBOT_PHONE_WAIT_MS || 20000);

/** 待执行命令队列：{id, tool, args, createdAt, resolve, reject, timer} */
const pending = [];
/** 长轮询挂起的客户端响应。 */
const waiters = [];
function removeWaiter(w) {
  const i = waiters.indexOf(w);
  if (i >= 0) { waiters.splice(i, 1); }
  clearTimeout(w.timer);
}
function wakeWaiters() {
  while (waiters.length > 0) {
    const w = waiters.shift();
    clearTimeout(w.timer);
    w.reply();
  }
}
let seq = 0;

function tool(name, description, params) {
  return { name, description, parameters: params };
}

const TOOLS = [
  tool('phone_dump_ui', '读取手机当前整屏的控件树（JSON：text/type/bounds/clickable）。操作前先 dump 看清界面。', []),
  tool('phone_tap', '按坐标点击手机屏幕。', [
    { name: 'x', type: 'number', description: '横坐标(px)', required: true },
    { name: 'y', type: 'number', description: '纵坐标(px)', required: true },
  ]),
  tool('phone_swipe', '滑动手机屏幕。', [
    { name: 'x1', type: 'number', description: '起点 x', required: true },
    { name: 'y1', type: 'number', description: '起点 y', required: true },
    { name: 'x2', type: 'number', description: '终点 x', required: true },
    { name: 'y2', type: 'number', description: '终点 y', required: true },
  ]),
  tool('phone_input_text', '向当前焦点输入框输入文本。', [
    { name: 'text', type: 'string', description: '要输入的文本', required: true },
  ]),
  tool('phone_key', '发送系统按键（2=HOME，4=BACK）。', [
    { name: 'code', type: 'number', description: '按键码', required: true },
  ]),
  tool('phone_screenshot', '截屏（保存到手机 /data/local/tmp/xbot-shot.png，返回文件信息）。', []),
];

// ── 命令队列 ────────────────────────────────────────────────────────────────
function enqueue(toolName, args) {
  return new Promise((resolve, reject) => {
    const id = `cmd-${++seq}`;
    const item = { id, tool: toolName, args: args || {}, resolve, reject, timer: null };
    item.timer = setTimeout(() => {
      const i = pending.indexOf(item);
      if (i >= 0) {
        pending.splice(i, 1);
      }
      reject(new Error('客户端未在超时内取走/回传命令（xbot-harmony 客户端在线吗？）'));
    }, WAIT_MS);
    pending.push(item);
    wakeWaiters();
  });
}

function drainForClient() {
  // 客户端每次取走**全部**待执行命令（它自己串行执行）
  return pending.splice(0, pending.length);
}

function resolveOne(id, ok, output, error) {
  const idx = pending.findIndex((p) => p.id === id);
  // 已被 drain 取走的命令不在 pending 里 ⇒ 需要按"已派发"表找回
  const item = idx >= 0 ? pending.splice(idx, 1)[0] : inflight.get(id);
  if (!item) {
    return false;
  }
  inflight.delete(id);
  clearTimeout(item.timer);
  if (ok) {
    item.resolve(typeof output === 'string' ? output : JSON.stringify(output));
  } else {
    item.reject(new Error(error || '手机执行失败'));
  }
  return true;
}

/** 已派发给客户端、等待回传的命令。 */
const inflight = new Map();

// ── HTTP：客户端拉命令 + 回结果 ──────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  };
  if (req.method === 'GET' && url.pathname === '/health') {
    send(200, { ok: true, pending: pending.length, inflight: inflight.size });
    return;
  }
  // 客户端拉取待执行命令
  if (req.method === 'GET' && url.pathname === '/poll') {
    const waitMs = Math.min(Number(url.searchParams.get('wait') || 0), 25000);
    const reply = () => {
      const batch = drainForClient();
      for (const c of batch) { inflight.set(c.id, c); }
      send(200, { commands: batch.map((c) => ({ id: c.id, tool: c.tool, args: c.args })) });
    };
    if (pending.length > 0 || waitMs <= 0) { reply(); return; }
    // 长轮询：挂起，等 enqueue 唤醒
    const waiter = { reply, timer: setTimeout(() => { removeWaiter(waiter); reply(); }, waitMs) };
    waiters.push(waiter);
    return;
  }
  // 同步调用（MCP / 其它本地消费者用）：入队并等待客户端回传
  if (req.method === 'POST' && url.pathname === '/tool') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(body); } catch (e) { send(400, { ok: false, error: 'bad json' }); return; }
      try {
        const output = await enqueue(msg.name, msg.args || {});
        send(200, { ok: true, output, error: '' });
      } catch (e) {
        send(200, { ok: false, output: '', error: e.message });
      }
    });
    return;
  }
  // 客户端回传结果
  if (req.method === 'POST' && url.pathname === '/result') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch (e) {
        send(400, { ok: false, error: 'bad json' });
        return;
      }
      const ok = resolveOne(msg.id, !!msg.ok, msg.output, msg.error);
      send(ok ? 200 : 404, { ok });
    });
    return;
  }
  send(404, { ok: false, error: 'not found' });
});
server.listen(PORT, '0.0.0.0', () => {
  process.stderr.write(`[xbot.phone] command port ${PORT} listening\n`);
});

// ── stdio 协议 ──────────────────────────────────────────────────────────────
function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const text = line.trim();
  if (text.length === 0) {
    return;
  }
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (e) {
    return;
  }
  const id = msg.id;
  const method = msg.method;
  if (method === 'activate') {
    send({ id, tools: TOOLS });
    return;
  }
  if (method === 'config_changed') {
    send({ id, result: 'ok' });
    return;
  }
  if (method === 'execute_tool') {
    const p = msg.params || {};
    let input = {};
    try {
      input = typeof p.input === 'string' ? JSON.parse(p.input) : (p.input || {});
    } catch (e) {
      input = {};
    }
    try {
      const result = await enqueue(p.toolName, input);
      send({ id, result });
    } catch (e) {
      send({ id, error: e.message });
    }
    return;
  }
  send({ id, error: `unknown method: ${method}` });
});
