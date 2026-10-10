/**
 * webbridge.test.ts —— ArkWeb JS 桥协议层（`core/webbridge.ets`）的**判别力**回归。
 *
 * 为什么值得单测：桥的一端是**不受信任的页面脚本**（插件 UI 是浏览器 ESM bundle，任意页面
 * 脚本都能调 `xbotNative.postMessage(任意串)`）⇒ 解析层必须"坏输入一律 null、永不抛"。
 * 这不是"测自己写的东西"，而是给**攻击面**上锁：非 JSON / 缺字段 / 类型不符 / 超长 / 注入串。
 *
 * 判别力自证（mutation，见提交信息）：把 `parseBridgeMessage` 中任一校验**改松**必红，例如
 *   · 去掉 `v !== BRIDGE_VERSION`        ⇒ 'v=2 拒（版本失配）' 与 'v 缺省拒' 红
 *   · 把 `BRIDGE_ID_RE` 放宽成匹配任意串    ⇒ 'id 含空格拒'、'id 空拒' 红
 *   · 去掉 `payload.length > MAX` 判断   ⇒ 'payload 超限拒' 红
 * 这些锚点都对应真实攻击输入，不是自证式（改了什么测什么）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };

import {
  BRIDGE_VERSION, BRIDGE_MAX_ID_LEN, BRIDGE_MAX_TYPE_LEN, BRIDGE_MAX_PAYLOAD_LEN,
  BRIDGE_TYPES, bridgeTypeIsAllowed, BridgeMessage, parseBridgeMessage,
  encodeBridgeMessage, encodeBridgeAck, makeBridgeMessage,
} from '../../entry/src/main/ets/core/webbridge';

let pass = 0;
let fail = 0;

function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}
function ok(name: string, cond: boolean): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

/** 断言 parse 返回 null（拒绝）—— 比手写 `=== null` 读起来清楚，且覆盖"抛了"的情况。 */
function rejects(name: string, raw: string): void {
  let out: BridgeMessage | null = null;
  let threw: string = '';
  try {
    out = parseBridgeMessage(raw);
  } catch (e) {
    threw = (e as Error).message;
  }
  ok(name, out === null && threw === '',
    // extra 信息在失败时才打印（避免噪音）
    );
  if (out !== null || threw !== '') {
    console.log(`      （parse 返回 ${JSON.stringify(out)}，抛出 '${threw}'）`);
  }
}

// ── (a) 正常路径 + 往返对称 ───────────────────────────────────────────────────
const good = makeBridgeMessage('req-1', 'call', '{"method":"x"}');
ok('makeBridgeMessage 合法输入出对象', good instanceof BridgeMessage);
if (good !== null) {
  eq('往返字段 v', good.v, BRIDGE_VERSION);
  eq('往返字段 id', good.id, 'req-1');
  eq('往返字段 type', good.type, 'call');
  eq('往返字段 payload', good.payload, '{"method":"x"}');

  const wire = encodeBridgeMessage(good);
  ok('encode 产出非空串', wire.length > 0);
  const back = parseBridgeMessage(wire);
  ok('encode→parse 往返成功', back !== null);
  if (back !== null) {
    eq('往返 id 一致', back.id, good.id);
    eq('往返 type 一致', back.type, good.type);
    eq('往返 payload 一致', back.payload, good.payload);
    eq('往返 v 一致', back.v, good.v);
  }
}

// 从裸 JSON 直接解析（模拟页面手搓信封）
const raw = '{"v":1,"id":"abc","type":"ready","payload":""}';
const p = parseBridgeMessage(raw);
ok('裸 JSON 解析成功', p !== null);
if (p !== null) {
  eq('裸 JSON id', p.id, 'abc');
  eq('裸 JSON type', p.type, 'ready');
  eq('裸 JSON payload 空串合法', p.payload, '');
}

// ── (b) 非 JSON / 非对象 ─────────────────────────────────────────────────────
rejects('空串拒', '');
rejects('纯文本拒', 'hello');
rejects('非法 JSON 拒', '{not json}');
rejects('JSON null 拒', 'null');
rejects('JSON 数组拒', '[1,2,3]');
rejects('JSON 数字拒', '123');
rejects('JSON 字符串拒', '"a string"');
rejects('JSON true 拒', 'true');
rejects('未闭合花括号拒', '{"v":1,"id":"a","type":"call","payload":""');

// ── (c) 缺字段 ───────────────────────────────────────────────────────────────
rejects('缺 v 拒', '{"id":"a","type":"call","payload":""}');
rejects('缺 id 拒', '{"v":1,"type":"call","payload":""}');
rejects('缺 type 拒', '{"v":1,"id":"a","payload":""}');
rejects('缺 payload 拒', '{"v":1,"id":"a","type":"call"}');

// ── (d) 类型不符 ─────────────────────────────────────────────────────────────
rejects('v 是字符串拒', '{"v":"1","id":"a","type":"call","payload":""}');
rejects('id 是数字拒', '{"v":1,"id":7,"type":"call","payload":""}');
rejects('type 是数组拒', '{"v":1,"id":"a","type":[],"payload":""}');
rejects('payload 是对象拒', '{"v":1,"id":"a","type":"call","payload":{}}');
rejects('payload 是 null 拒', '{"v":1,"id":"a","type":"call","payload":null}');

// ── (e) 版本 ─────────────────────────────────────────────────────────────────
rejects('v=2 拒（版本失配）', '{"v":2,"id":"a","type":"call","payload":""}');
rejects('v=0 拒', '{"v":0,"id":"a","type":"call","payload":""}');
rejects('v=1.5 拒（非整数版本）', '{"v":1.5,"id":"a","type":"call","payload":""}');

// ── (f) id 边界（长度/字符集/注入）─────────────────────────────────────────────
rejects('id 空拒', '{"v":1,"id":"","type":"call","payload":""}');
rejects('id 含空格拒', '{"v":1,"id":"a b","type":"call","payload":""}');
rejects('id 含引号拒（注入串）', '{"v":1,"id":"a\\"b","type":"call","payload":""}');
rejects('id 含分号/括号拒（注入串）', '{"v":1,"id":"a;alert(1)//","type":"call","payload":""}');
rejects('id 含斜杠拒', '{"v":1,"id":"a/b","type":"call","payload":""}');
const longId = 'a'.repeat(BRIDGE_MAX_ID_LEN + 1);
rejects('id 超长拒', `{"v":1,"id":"${longId}","type":"call","payload":""}`);
const maxId = 'a'.repeat(BRIDGE_MAX_ID_LEN);
ok('id 恰好 = 上限 通过', parseBridgeMessage(`{"v":1,"id":"${maxId}","type":"call","payload":""}`) !== null);
ok('id 允许 . : - _', parseBridgeMessage('{"v":1,"id":"a.b:c-d_e","type":"call","payload":""}') !== null);

// ── (g) type 白名单 ──────────────────────────────────────────────────────────
rejects('type 空拒', '{"v":1,"id":"a","type":"","payload":""}');
rejects('type 不在白名单拒', '{"v":1,"id":"a","type":"execShell","payload":""}');
rejects('type 大小写敏感（Call≠call）', '{"v":1,"id":"a","type":"Call","payload":""}');
const longType = 'x'.repeat(BRIDGE_MAX_TYPE_LEN + 1);
rejects('type 超长拒', `{"v":1,"id":"a","type":"${longType}","payload":""}`);
ok('白名单内每个 type 都被 parse 接受', BRIDGE_TYPES.every((t) => {
  return parseBridgeMessage(`{"v":1,"id":"a","type":"${t}","payload":""}`) !== null;
}));
ok('bridgeTypeIsAllowed 命中白名单', bridgeTypeIsAllowed('call') && bridgeTypeIsAllowed('event'));
ok('bridgeTypeIsAllowed 拒未知', !bridgeTypeIsAllowed('nope') && !bridgeTypeIsAllowed(''));

// ── (h) payload 边界 ─────────────────────────────────────────────────────────
const maxPayload = 'p'.repeat(BRIDGE_MAX_PAYLOAD_LEN);
ok('payload 恰好 = 上限 通过',
  parseBridgeMessage(`{"v":1,"id":"a","type":"call","payload":"${maxPayload}"}`) !== null);
const overPayload = 'p'.repeat(BRIDGE_MAX_PAYLOAD_LEN + 1);
rejects('payload 超限拒', `{"v":1,"id":"a","type":"call","payload":"${overPayload}"}`);
// 超大原始串：不进入 JSON.parse 就应被 json 长度上限挡住
rejects('原始 JSON 超长拒', 'x'.repeat(BRIDGE_MAX_PAYLOAD_LEN + 5000));

// ── (i) 注入 & 转义（协议层对 payload 无知，但编码必须正确转义）──────────────────
const tricky = 'he said "hi"\n\t\\ end';
const trickyMsg = makeBridgeMessage('id-1', 'log', tricky);
ok('payload 含特殊字符仍可构造', trickyMsg !== null);
if (trickyMsg !== null) {
  const wire = encodeBridgeMessage(trickyMsg);
  const back = parseBridgeMessage(wire);
  ok('含引号/换行/反斜杠 payload 往返无损', back !== null && back.payload === tricky);
  // 编码结果必须是**合法 JSON**（可被再次 JSON.parse）
  let reparsedOk = false;
  try {
    JSON.parse(wire);
    reparsedOk = true;
  } catch (e) {
    reparsedOk = false;
  }
  ok('encode 产物是合法 JSON 串', reparsedOk);
}
// 注入尝试：payload 里塞 JS 结束序列 —— 协议层照收（它是字符串），
// 防注入的职责在 WebSurface.evalToPage/postToPage（JSON.stringify 转义），不在这里。
const inj = makeBridgeMessage('id-2', 'log', '");alert(1);//');
ok('payload 注入串被当作不透明字符串接受', inj !== null && inj.payload === '");alert(1);//');

// ── (j) 出站编码对称校验 ─────────────────────────────────────────────────────
eq('encode(null 语义) 空串', encodeBridgeMessage(null as unknown as BridgeMessage), '');
eq('encode(非法 type) 空串', encodeBridgeMessage(new BridgeMessage(1, 'a', 'nope', '')), '');
eq('encode(非法 id) 空串', encodeBridgeMessage(new BridgeMessage(1, 'a b', 'call', '')), '');
eq('encode(版本错) 空串', encodeBridgeMessage(new BridgeMessage(2, 'a', 'call', '')), '');

// ── (k) makeBridgeMessage 与 parse 同源（判据不漂移）─────────────────────────
eq('make(非法 id) → null', makeBridgeMessage('a b', 'call', ''), null);
eq('make(非法 type) → null', makeBridgeMessage('a', 'nope', ''), null);
ok('make(合法) 与 parse 编码结果一致', (() => {
  const m = makeBridgeMessage('zz', 'notify', '{}');
  if (m === null) {
    return false;
  }
  const a = encodeBridgeMessage(m);
  const b = parseBridgeMessage(a);
  return b !== null && b.id === 'zz' && b.type === 'notify';
})());

// ── (l) 结构化回执 ───────────────────────────────────────────────────────────
eq('ack ok 形状', encodeBridgeAck(true, ''), '{"ok":true,"error":""}');
eq('ack error 形状', encodeBridgeAck(false, 'invalid bridge message'),
  '{"ok":false,"error":"invalid bridge message"}');
// 回执错误串含引号也必须转义成合法 JSON
let ackOk = false;
try {
  JSON.parse(encodeBridgeAck(false, 'he said "x"'));
  ackOk = true;
} catch (e) {
  ackOk = false;
}
ok('ack 含引号错误串仍是合法 JSON', ackOk);

// ── (m) 永不抛（fuzz 一撮怪输入）─────────────────────────────────────────────
const weird: string[] = [
  '', ' ', '\n', 'undefined', 'NaN', '{}', '[]', '{"v":1}', '\u0000', '{"v":1,"id":"a","type":"call","payload":""}',
  '{"v":1,"id":"a","type":"call","payload":"","extra":1}', '{"v":1,"id":"a","type":"call","payload":"","nested":{"a":1}}',
];
ok('全部怪输入均不抛（null 或对象）', weird.every((w) => {
  try {
    const r = parseBridgeMessage(w);
    return r === null || r instanceof BridgeMessage;
  } catch (e) {
    return false;
  }
}));

if (fail > 0) {
  console.log(`  webbridge: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  webbridge: ${pass} passed, 0 failed`);
process.exit(0);
