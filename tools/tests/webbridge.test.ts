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
  NEW_WINDOW_BLOCK, NEW_WINDOW_EXTERNAL, NEW_WINDOW_IN_WEB, newWindowAction,
  BRIDGE_ACTION_CLIPBOARD, BRIDGE_MAX_CLIPBOARD_LEN, clipboardTextOf, hostActionFor,
  FILE_PICK_IMAGE, FILE_PICK_DOCUMENT, filePickKindOf, FILE_PICK_MAX_COUNT,
  DOWNLOAD_MAX_NAME_LEN, downloadFileNameOf, sanitizeFileName,
  BRIDGE_ACTION_NAV, HOST_NAV_KINDS, HOST_NAV_READY, HOST_NAV_TITLE, HOST_NAV_OPEN_FILE,
  HOST_NAV_MAX_TEXT_LEN, HostNavEvent, parseHostNavPayload, hostNavKindIsAllowed,
} from '../../entry/src/main/ets/core/webbridge';
// 跨模块同源契约：页面能一次拿到的文件数必须 == 聊天附件上限（见下方断言）。
import { MAX_ATTACH } from '../../entry/src/main/ets/core/attach';

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

// ── (n) §21.122b 新窗口代理判定（`newWindowAction`）────────────────────────────
// 为什么值得单测：这是**唯一**决定「`window.open`/`target=_blank` 点了会发生什么」的纯函数；
// 判错的两个方向都是真缺陷：① 把同源页面当外链 ⇒ 在系统浏览器里打开自己的 SPA（会话丢失）；
// ② 把 `javascript:`/`data:` 当外链 ⇒ 交给系统（**注入面**）。web 侧 9 处 `target="_blank"`
// + `MessageActions.tsx:127` 的 `window.open` 全部经过这里。
const BASE = 'http://127.0.0.1:8082';
const PAGE = 'http://127.0.0.1:8082/?xbot_view=x';
eq('(n) 绝对外链 ⇒ external', newWindowAction('https://github.com/a/b', PAGE, BASE), NEW_WINDOW_EXTERNAL);
eq('(n) 同源绝对地址 ⇒ in-web（同一 SPA 的另一页，绝不外跳）',
  newWindowAction('http://127.0.0.1:8082/plugins/x/index.html', PAGE, BASE), NEW_WINDOW_IN_WEB);
eq('(n) 同源绝对路径（/开头）⇒ in-web',
  newWindowAction('/plugins/x/index.html', PAGE, BASE), NEW_WINDOW_IN_WEB);
eq('(n) 同源带查询串 ⇒ in-web', newWindowAction('/s/abc?t=1', PAGE, BASE), NEW_WINDOW_IN_WEB);
eq('(n) mailto ⇒ external（不是 http 同源）', newWindowAction('mailto:a@b.c', PAGE, BASE), NEW_WINDOW_EXTERNAL);
eq('(n) 端口不同 ⇒ external（origin 含端口）',
  newWindowAction('http://127.0.0.1:9999/x', PAGE, BASE), NEW_WINDOW_EXTERNAL);
eq('(n) 协议不同（https vs http）⇒ external',
  newWindowAction('https://127.0.0.1:8082/x', PAGE, BASE), NEW_WINDOW_EXTERNAL);
// ⛔ 注入面：这两个**必须**只拦不跳（旧实现若把 targetUrl 直接交给 startAbility 就是漏洞）
eq('(n) javascript: ⇒ block（注入面）', newWindowAction('javascript:alert(1)', PAGE, BASE), NEW_WINDOW_BLOCK);
eq('(n) data: ⇒ block（注入面）', newWindowAction('data:text/html,<script>1</script>', PAGE, BASE), NEW_WINDOW_BLOCK);
eq('(n) file: ⇒ block', newWindowAction('file:///etc/passwd', PAGE, BASE), NEW_WINDOW_BLOCK);
eq('(n) 空 ⇒ block', newWindowAction('', PAGE, BASE), NEW_WINDOW_BLOCK);
eq('(n) 裸相对（拼不出绝对）⇒ block（宁可拒绝也不猜地址）',
  newWindowAction('foo/bar.html', PAGE, BASE), NEW_WINDOW_BLOCK);
eq('(n) 无 pageUrl 时绝对外链仍可外跳', newWindowAction('https://x.com/', '', BASE), NEW_WINDOW_EXTERNAL);
eq('(n) 无 pageUrl 时同源地址判不出同源 ⇒ external（fail-safe：不外跳自己的 SPA 由上层兜底）',
  newWindowAction('http://127.0.0.1:8082/x', '', BASE), NEW_WINDOW_EXTERNAL);
// mutation 自证锚点：把 sameOrigin 判定去掉 ⇒ 上面 4 条 in-web 会变 external ⇒ 必红。

// ── (o) §21.122d：剪贴板写代理（`clipboard`）────────────────────────────────────
// 为什么值得钉：宿主 WebView 源是 `http://10.0.2.2:8082` = 非 secure context ⇒ 浏览器不提供
// `navigator.clipboard`，而 web 侧有 9+ 处 `writeText`（复制消息/代码/路径/URL）⇒ 修好之前
// **全部静默失效**（web 侧 `catch {}` 吞掉）。破一条的后果都是用户可见的：
//   ① `clipboard` 不在白名单 ⇒ `parseBridgeMessage` 返回 null ⇒ 桥**直接丢弃**（复制永远无效）；
//   ② 文本截断缺失 ⇒ 超大串灌进系统剪贴板（白烧内存）；③ 空串被当成合法写 ⇒ 清空用户剪贴板。
eq('clipboard 在桥类型白名单内', bridgeTypeIsAllowed('clipboard'), true);
eq('宿主动作：clipboard ⇒ 写剪贴板动作', hostActionFor(makeBridgeMessage('c1', 'clipboard', '你好') as BridgeMessage).kind, BRIDGE_ACTION_CLIPBOARD);
eq('动作文本 = payload 原文', hostActionFor(makeBridgeMessage('c1', 'clipboard', '你好，世界') as BridgeMessage).text, '你好，世界');
// ⛔ 关键契约：payload 即**原文** —— 复制一段"长得像 JSON"的文本必须逐字保留，不许被当信封解析。
eq('复制 JSON 文本逐字保留（不套二层 JSON）',
  clipboardTextOf(makeBridgeMessage('c1', 'clipboard', '{"text":"a"}') as BridgeMessage), '{"text":"a"}');
eq('多行/空白原样保留',
  clipboardTextOf(makeBridgeMessage('c2', 'clipboard', 'a\n  b\tc') as BridgeMessage), 'a\n  b\tc');
eq('空 payload ⇒ 空串（上层据此**跳过写入**，不清空用户剪贴板）',
  clipboardTextOf(makeBridgeMessage('c3', 'clipboard', '') as BridgeMessage), '');
eq('超长 ⇒ 截断到上限',
  clipboardTextOf(makeBridgeMessage('c4', 'clipboard', 'x'.repeat(BRIDGE_MAX_CLIPBOARD_LEN + 100)) as BridgeMessage).length,
  BRIDGE_MAX_CLIPBOARD_LEN);
eq('剪贴板上限 < 信封 payload 上限（剪贴板另收紧）', BRIDGE_MAX_CLIPBOARD_LEN < BRIDGE_MAX_PAYLOAD_LEN, true);
eq('null 消息 ⇒ 空串（不抛）', clipboardTextOf(null as unknown as BridgeMessage), '');
// 端到端：页面发出的信封（垫片形态）能被解析且动作正确
{
  const wire = JSON.stringify({ v: BRIDGE_VERSION, id: 'clipboard', type: 'clipboard', payload: '代码片段' });
  const parsed = parseBridgeMessage(wire);
  eq('垫片形态的信封可解析', parsed === null ? 'null' : parsed.type, 'clipboard');
  eq('垫片形态 ⇒ 动作文本正确',
    parsed === null ? 'null' : hostActionFor(parsed).text, '代码片段');
}
// 未在白名单/非法类型仍必须被拒（回归：加类型时别把校验放宽）
eq('未知类型仍被拒（write-clipboard 不是合法 type）', parseBridgeMessage(JSON.stringify({ v: BRIDGE_VERSION, id: 'x', type: 'write-clipboard', payload: 'a' })), null);

// ── §21.122d 余项：`<input type=file>` 代理（accept → 选择器种类）───────────────
// 判别力：`*/*`/混合/未知必须落 **document**（相册给不出 PDF）；只有"全是图片"才走相册。
eq('accept 空 ⇒ 文件选择器', filePickKindOf([]), FILE_PICK_DOCUMENT);
eq('accept ["image/*"] ⇒ 相册', filePickKindOf(['image/*']), FILE_PICK_IMAGE);
eq('accept ["image/png","image/jpeg"] ⇒ 相册', filePickKindOf(['image/png', 'image/jpeg']), FILE_PICK_IMAGE);
eq('accept [".png",".jpg"] ⇒ 相册', filePickKindOf(['.png', '.jpg']), FILE_PICK_IMAGE);
eq('accept [".heic"] ⇒ 相册', filePickKindOf(['.heic']), FILE_PICK_IMAGE);
eq('accept ["IMAGE/PNG"] ⇒ 相册（大小写不敏感）', filePickKindOf(['IMAGE/PNG']), FILE_PICK_IMAGE);
eq('accept ["image/*",""] ⇒ 相册（空 token 忽略）', filePickKindOf(['image/*', '']), FILE_PICK_IMAGE);
eq('accept ["*/*"] ⇒ 文件选择器', filePickKindOf(['*/*']), FILE_PICK_DOCUMENT);
eq('accept [".pdf"] ⇒ 文件选择器', filePickKindOf(['.pdf']), FILE_PICK_DOCUMENT);
eq('accept ["image/*",".pdf"] ⇒ 文件选择器（混合：相册选不到 PDF）',
  filePickKindOf(['image/*', '.pdf']), FILE_PICK_DOCUMENT);
eq('accept 单 token 内含逗号 ⇒ 仍按混合判文件选择器',
  filePickKindOf(['image/*,.zip']), FILE_PICK_DOCUMENT);
eq('accept 非法入参（null）⇒ 文件选择器（不抛）',
  filePickKindOf(null as unknown as string[]), FILE_PICK_DOCUMENT);

// ── §21.122d 余项：下载文件名推导（服务端意图优先 + 路径穿越必须被清）───────────
eq('Content-Disposition filename= 优先', downloadFileNameOf('http://h/api/files/download?key=k', 'attachment; filename="report.pdf"', ''), 'report.pdf');
eq('RFC 5987 filename* 百分号解码',
  downloadFileNameOf('http://h/x', "attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87.pdf", ''), '中文.pdf');
eq('无 CD ⇒ URL 路径末段（去掉 query）',
  downloadFileNameOf('http://h/files/%E4%B8%AD%E6%96%87.pdf?inline=1', '', ''), '中文.pdf');
eq('无 CD 且 mime 可判 ⇒ 补扩展名',
  downloadFileNameOf('http://h/export', '', 'application/pdf'), 'export.pdf');
eq('已有扩展名 ⇒ 不重复补', downloadFileNameOf('http://h/a.pdf', '', 'application/pdf'), 'a.pdf');
eq('全空 ⇒ 兜底名', downloadFileNameOf('http://h/', '', ''), 'xbot-download');
eq('兜底名 + mime ⇒ 兜底名带扩展名', downloadFileNameOf('', '', 'application/zip'), 'xbot-download.zip');
eq('⛔ 路径穿越必须被压平（不得含 / 或前导 ..）',
  sanitizeFileName('../../etc/passwd'), '_.._etc_passwd');
eq('⛔ 反斜杠路径同样压平', sanitizeFileName('..\\..\\win.ini'), '_.._win.ini');
eq('非法字符换成下划线', sanitizeFileName('a:b*c?.txt'), 'a_b_c_.txt');
eq('超长名被截断到上限内', sanitizeFileName('x'.repeat(300)).length <= DOWNLOAD_MAX_NAME_LEN, true);
eq('尾点被清（`x.` ⇒ `x`）', sanitizeFileName('x.'), 'x');
eq('尾点被清后按 mime 补扩展名', downloadFileNameOf('http://h/x.', '', 'text/plain'), 'x.txt');
eq('名字里的空格保留但去首尾', sanitizeFileName('  报告 v2.pdf  '), '报告 v2.pdf');

// ── 跨模块同源契约：页面能一次拿到的文件数 == 聊天附件上限 ────────────────────
// 判别力：任一侧单独改动（如把 attach.MAX_ATTACH 调大而忘了 picker 上限）必红。
// 页面选中的文件最终多半作为附件上传，两侧不一致 ⇒ 用户「选了 N 个只上去 M 个」。
eq('文件选择上限 = 聊天附件上限（同源契约）', FILE_PICK_MAX_COUNT, MAX_ATTACH);

// ── §21.122f：面板**导航意图**代理（`nav`）────────────────────────────────────
// 用户原话：「这种嵌套 web view 应该代理原 web 的导航事件…然后文件面板应该代理后触发原生 ui」。
// 判别力（mutation 锚点）：① 把 kind 白名单判定去掉 ⇒ '未知 kind 拒' 红；
//   ② 去掉 text 截断 ⇒ 'text 超长截断' 红；③ 把 `typeof k !== 'string'` 去掉 ⇒ 'kind 非字符串拒' 红。
eq('三个 kind 与 web 侧 hostBridge.ts:HostNavKind 同源',
  JSON.stringify(HOST_NAV_KINDS), JSON.stringify(['ready', 'title', 'openFile']));
eq('kind 白名单判定：ready/title/openFile 可', 
  [hostNavKindIsAllowed(HOST_NAV_READY), hostNavKindIsAllowed(HOST_NAV_TITLE),
    hostNavKindIsAllowed(HOST_NAV_OPEN_FILE)], [true, true, true]);
eq('⛔ 未知 kind 拒（fail-closed：不猜语义，坏包不触发任何原生动作）',
  hostNavKindIsAllowed('nope'), false);
eq('正常 ready（面板 id 作 text）',
  JSON.stringify(parseHostNavPayload('{"kind":"ready","text":"files"}')),
  JSON.stringify(new HostNavEvent(HOST_NAV_READY, 'files')));
eq('正常 title', JSON.stringify(parseHostNavPayload('{"kind":"title","text":"src/"}')),
  JSON.stringify(new HostNavEvent(HOST_NAV_TITLE, 'src/')));
eq('正常 openFile（路径作 text；原生据此开原生预览）',
  JSON.stringify(parseHostNavPayload('{"kind":"openFile","text":"/w/a.ts"}')),
  JSON.stringify(new HostNavEvent(HOST_NAV_OPEN_FILE, '/w/a.ts')));
eq('缺 text ⇒ 空串（不是 null：ready 本就不需要 text）',
  JSON.stringify(parseHostNavPayload('{"kind":"ready"}')),
  JSON.stringify(new HostNavEvent(HOST_NAV_READY, '')));
eq('⛔ 缺 kind ⇒ null', parseHostNavPayload('{"text":"x"}'), null);
eq('⛔ kind 非字符串 ⇒ null', parseHostNavPayload('{"kind":123,"text":"x"}'), null);
eq('⛔ 未知 kind ⇒ null（绝不兜底成某个 kind）', parseHostNavPayload('{"kind":"nope"}'), null);
eq('⛔ text 非字符串 ⇒ 收敛成空串（不把对象塞进标题）',
  JSON.stringify(parseHostNavPayload('{"kind":"title","text":{"a":1}}')),
  JSON.stringify(new HostNavEvent(HOST_NAV_TITLE, '')));
eq('⛔ 非 JSON / 空 / null / 数组 ⇒ null 且不抛',
  [parseHostNavPayload('not json'), parseHostNavPayload(''), parseHostNavPayload('null'),
    parseHostNavPayload('[1,2]')], [null, null, null, null]);
eq('⛔ text 超长 ⇒ 截断（页面不受信任，别把巨串灌进标题/日志）',
  parseHostNavPayload(`{"kind":"title","text":"${'a'.repeat(HOST_NAV_MAX_TEXT_LEN + 50)}"}`)!.text.length,
  HOST_NAV_MAX_TEXT_LEN);
eq('⛔ payload 超信封上限 ⇒ null（先于 JSON.parse 挡住）',
  parseHostNavPayload(`{"kind":"title","text":"${'a'.repeat(BRIDGE_MAX_PAYLOAD_LEN + 10)}"}`), null);
eq('信封级判定：type=nav ⇒ 动作 nav（结构化解析留给纯函数）',
  hostActionFor(new BridgeMessage(BRIDGE_VERSION, 'nav', 'nav', '{"kind":"ready","text":"files"}')).kind,
  BRIDGE_ACTION_NAV);
eq('信封级判定：nav 的 text 原样带出（⛔ 组件不二次解析/不猜语义）',
  hostActionFor(new BridgeMessage(BRIDGE_VERSION, 'nav', 'nav', '{"kind":"ready"}')).text,
  '{"kind":"ready"}');

if (fail > 0) {
  console.log(`  webbridge: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  webbridge: ${pass} passed, 0 failed`);
process.exit(0);

export {};
