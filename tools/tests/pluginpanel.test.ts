/**
 * 插件面板门禁 —— `core/pluginhost.ets`（URL 语义）+ `core/webbridge.ets`（宿主动作判定）。
 *
 * 守护的不变量（对应用户症状「打开插件面板只看到 JS 源码」）：
 *   · **ESM 模块 URL 永不作为文档 URL**：`web_plugin_list` 的 `module_url` 是
 *     `/plugins/<id>/web/<entry>`（宿主同页 `import()` 用的资源），旧实现把它交给 WebView
 *     ⇒ 面板显示 JS 源码；`pluginPanelUrl` 必须把它换成**权威宿主页**；
 *   · **宿主页 = 服务端根地址**（插件 UI 只能在 web 应用页里跑：产物顶层读 `window.React` /
 *     `window.__xbot_*` —— 见 core/pluginhost.ets 文件头证据）；
 *   · **跨源候选 URL 一律回落**（本组件把 `window.xbotNative` 注入所有 frame，不该注给第三方页）；
 *   · **同源页面 URL 仍可用**（为将来声明式「URL 面板」留门）；
 *   · 宿主动作判定**只碰 chrome 级**（close/log/ready），业务类型一律 ignore（不编造语义）；
 *   · 页面日志正文**截断**（不受信任输入不得灌爆日志）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  PLUGIN_DEFAULT_ENTRY,
  PluginHostInfo,
  hostPageUrl,
  isPluginModuleAsset,
  normalizePluginEntry,
  normalizePluginId,
  normalizePluginName,
  originOf,
  pluginModuleUrl,
  pluginPanelUrl,
  sameOrigin,
} from '../../entry/src/main/ets/core/pluginhost';
import {
  BRIDGE_ACTION_CLOSE,
  BRIDGE_ACTION_IGNORE,
  BRIDGE_ACTION_LOG,
  BRIDGE_ACTION_READY,
  bridgeInitPayload,
  hostActionFor,
  makeBridgeMessage,
} from '../../entry/src/main/ets/core/webbridge';
import type { BridgeMessage } from '../../entry/src/main/ets/core/webbridge';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

const BASE = 'http://192.168.1.9:8082';

// ── originOf / sameOrigin（纯字符串，core 禁 @ohos.url）──────────────────────
eq('originOf 剥路径', originOf('http://h:8082/a/b?q=1'), 'http://h:8082');
eq('originOf 无路径', originOf('http://h:8082'), 'http://h:8082');
eq('originOf 相对路径 ⇒ 空', originOf('/plugins/x/web/index.js'), '');
eq('originOf 空 ⇒ 空', originOf(''), '');
eq('同源判定 true', sameOrigin('http://h:8082/plugins/x/web/i.js', 'http://h:8082/'), true);
eq('同源判定 false（端口不同）', sameOrigin('http://h:8083/a', 'http://h:8082/'), false);
eq('同源判定 false（相对 vs 绝对）', sameOrigin('/a', 'http://h:8082/'), false);

// ── isPluginModuleAsset：模块资源**不可**当文档 ─────────────────────────────
eq('ESM 入口是模块资源', isPluginModuleAsset('/plugins/xbot.genui/web/index.js'), true);
eq('chunk 是模块资源', isPluginModuleAsset('/plugins/x/web/chunk-ABCD1234.js'), true);
eq('带 query 仍是模块资源', isPluginModuleAsset('/plugins/x/web/index.js?v=abc'), true);
eq('带 hash 仍是模块资源', isPluginModuleAsset('/plugins/x/web/index.js#frag'), true);
eq('.mjs 也算模块资源', isPluginModuleAsset('http://h:1/plugins/x/web/index.mjs'), true);
eq('/plugins/<id>/web/ 目录下非 .js 也算模块资源（服务端该前缀只服务 ESM）',
  isPluginModuleAsset('/plugins/x/web/style.css'), true);
eq('大写扩展名也识别', isPluginModuleAsset('/plugins/x/web/INDEX.JS'), true);
eq('普通页面不是模块资源', isPluginModuleAsset('http://h:1/panel.html'), false);
eq('宿主根不是模块资源', isPluginModuleAsset('http://h:1/'), false);
eq('空串不是模块资源', isPluginModuleAsset(''), false);
eq('非 /plugins/ 的 js 仍按 .js 判为资源', isPluginModuleAsset('http://h:1/static/app.js'), true);

// ── pluginPanelUrl：修语义的核心 ────────────────────────────────────────────
const MODULE_URL = '/plugins/xbot.iteration-stats/web/index.js';
eq('模块 URL ⇒ 回落宿主页（**修语义**）', pluginPanelUrl(BASE, MODULE_URL), BASE);
eq('模块 URL（绝对形态）⇒ 回落宿主页',
  pluginPanelUrl(BASE, 'http://192.168.1.9:8082/plugins/x/web/index.js'), BASE);
eq('空候选 ⇒ 宿主页', pluginPanelUrl(BASE, ''), BASE);
eq('跨源页面 ⇒ 回落宿主页（不把 xbotNative 注给第三方）',
  pluginPanelUrl(BASE, 'https://evil.example.com/panel.html'), BASE);
eq('同源非模块页面 ⇒ 用它（为声明式 URL 面板留门）',
  pluginPanelUrl(BASE, 'http://192.168.1.9:8082/panel.html'), 'http://192.168.1.9:8082/panel.html');
eq('baseUrl 带尾斜杠也规整', pluginPanelUrl('http://h:1///', ''), 'http://h:1');
eq('baseUrl 带路径 ⇒ 只取 origin', pluginPanelUrl('http://h:1/some/path', ''), 'http://h:1');

// 不变量：产出的"面板 URL"永远不是模块资源（把缺陷钉死在测试里）
const CASES: string[] = [MODULE_URL, '', 'http://h:1/a.js', 'http://h:1/page.html', '/plugins/x/web/i.js?v=1'];
let allSafe = true;
for (let i = 0; i < CASES.length; i++) {
  const out = pluginPanelUrl(BASE, CASES[i]);
  if (isPluginModuleAsset(out)) { allSafe = false; console.log(`      面板 URL 落在模块资源上: ${CASES[i]} → ${out}`); }
}
ok('不变量：任何候选都产出"非模块资源"的面板 URL', allSafe);

// ── hostPageUrl / pluginModuleUrl（与 web+服务端同构）───────────────────────
eq('hostPageUrl 规整', hostPageUrl('http://h:1/'), 'http://h:1');
eq('模块 URL 拼法（与 serverapp/rpc_table.go:2289 同构）',
  pluginModuleUrl('http://h:1', 'xbot.genui', 'index.js'), 'http://h:1/plugins/xbot.genui/web/index.js');
eq('模块 URL：entry 前导斜杠被剥',
  pluginModuleUrl('http://h:1', 'p', '/dist/main.js'), 'http://h:1/plugins/p/web/dist/main.js');
eq('模块 URL：entry 缺省 index.js',
  pluginModuleUrl('http://h:1', 'p', ''), 'http://h:1/plugins/p/web/index.js');
eq('模块 URL：缺 id ⇒ 空串（不产出坏地址）', pluginModuleUrl('http://h:1', '', 'index.js'), '');
eq('模块 URL：缺 base ⇒ 空串', pluginModuleUrl('', 'p', 'index.js'), '');

// ── 归一化（服务端字段历史差异）────────────────────────────────────────────
eq('id 优先', normalizePluginId('a', 'b'), 'a');
eq('id 缺失回落 plugin_id', normalizePluginId('', 'b'), 'b');
eq('id/plugin_id 都空 ⇒ 空', normalizePluginId('', ''), '');
eq('id 去空白', normalizePluginId('  a  ', ''), 'a');
eq('name 优先', normalizePluginName('N', 'L', 'id'), 'N');
eq('name 缺失回落 label', normalizePluginName('', 'L', 'id'), 'L');
eq('name/label 都空回落 id', normalizePluginName('', '', 'id'), 'id');
eq('entry 去前导斜杠', normalizePluginEntry('/a.js'), 'a.js');
eq('entry 空回落默认', normalizePluginEntry(''), PLUGIN_DEFAULT_ENTRY);

// ── 宿主动作判定（纯函数）──────────────────────────────────────────────────
eq('close ⇒ 关承载页', hostActionFor(makeBridgeMessage('1', 'close', '')!).kind, BRIDGE_ACTION_CLOSE);
eq('log ⇒ 转原生日志', hostActionFor(makeBridgeMessage('1', 'log', 'hello')!).kind, BRIDGE_ACTION_LOG);
eq('log 正文透传', hostActionFor(makeBridgeMessage('1', 'log', 'hello')!).text, 'hello');
eq('ready ⇒ 握手（回 init）', hostActionFor(makeBridgeMessage('1', 'ready', '')!).kind, BRIDGE_ACTION_READY);
eq('call 是业务类型 ⇒ ignore（不替上层编造语义）',
  hostActionFor(makeBridgeMessage('1', 'call', '{}')!).kind, BRIDGE_ACTION_IGNORE);
eq('notify 是业务类型 ⇒ ignore', hostActionFor(makeBridgeMessage('1', 'notify', '{}')!).kind, BRIDGE_ACTION_IGNORE);
eq('theme ⇒ ignore（主题由页面/宿主各自管，不顺手实现）',
  hostActionFor(makeBridgeMessage('1', 'theme', '{}')!).kind, BRIDGE_ACTION_IGNORE);
eq('init（原生→页面方向）意外回环 ⇒ ignore', hostActionFor(makeBridgeMessage('1', 'init', '{}')!).kind, BRIDGE_ACTION_IGNORE);
eq('null 消息 ⇒ ignore（防御）', hostActionFor(null as unknown as BridgeMessage).kind, BRIDGE_ACTION_IGNORE);
eq('log 正文超长被截断（不受信任输入不得灌爆日志）',
  hostActionFor(makeBridgeMessage('1', 'log', 'x'.repeat(2000))!).text.length, 512);

// ── init payload（防注入 + 恒合法 JSON）────────────────────────────────────
eq('init payload 含主题', JSON.parse(bridgeInitPayload('dark')), { theme: 'dark' });
eq('init payload 空主题可用', JSON.parse(bridgeInitPayload('')), { theme: '' });
eq('init payload 对引号/换行转义（防注入）',
  JSON.parse(bridgeInitPayload('a"b\nc')), { theme: 'a"b\nc' });
eq('init payload 非字符串 ⇒ 空主题', JSON.parse(bridgeInitPayload(undefined as unknown as string)), { theme: '' });

// ── 条目模型：url 与 moduleUrl 分工 ─────────────────────────────────────────
const entry: PluginHostInfo = new PluginHostInfo();
entry.id = 'xbot.genui';
entry.name = 'GenUI';
entry.moduleUrl = pluginModuleUrl(BASE, 'xbot.genui', 'index.js');
entry.url = pluginPanelUrl(BASE, entry.moduleUrl);
eq('条目 url = 宿主页', entry.url, BASE);
eq('条目 moduleUrl = ESM 资源（元数据）',
  entry.moduleUrl, 'http://192.168.1.9:8082/plugins/xbot.genui/web/index.js');
ok('条目 url 不是模块资源（"打开"按钮不可能再打开裸 JS）', !isPluginModuleAsset(entry.url));
ok('PluginHostInfo 是 PluginPanelInfo 的子类（消费方无需改动）',
  entry instanceof PluginHostInfo);

if (fail > 0) { console.log(`  pluginpanel: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  pluginpanel: ${pass} passed, 0 failed`);
process.exit(0);
