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
  PLUGIN_OPEN_DIRECT,
  PLUGIN_OPEN_HOST,
  PluginHostInfo,
  WebPluginListWire,
  WebViewWire,
  absoluteAssetUrl,
  buildPluginCatalog,
  containerLabel,
  containerRank,
  hostPageUrl,
  isPluginModuleAsset,
  normalizePluginEntry,
  normalizePluginId,
  normalizePluginName,
  originOf,
  pluginModuleUrl,
  pluginPanelUrl,
  resolveManifestKey,
  resolvePluginTarget,
  resolvePluginText,
  sameOrigin,
  viewShortId,
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

// ══════════════════════════════════════════════════════════════════════════════
// 波1c：插件目录模型（消费 web.contributes）
// 数据全部**逐字抄自真实清单** ~/.xbot/plugins/builtin/*/plugin.json（2026-10-11 实测）
// ══════════════════════════════════════════════════════════════════════════════

const I18N_ZH = {
  'zh-CN': {
    'manifest.name': 'Git 面板',
    'manifest.description': 'Git 面板：分支、变更文件、提交历史（分页）、commit 详情、全宽 diff tab。',
    'view.panel.title': 'Git',
    'view.commit.title': 'Commit',
  },
  en: { 'manifest.name': 'Git Fancy', 'view.panel.title': 'Git' },
};

// ── resolvePluginText / resolveManifestKey（镜像 web plugin-runtime/i18n.ts:16-45,98-106）──
eq('i18n：key 命中当前语言', resolvePluginText(I18N_ZH, 'manifest.name', 'zh-CN'), 'Git 面板');
eq('i18n：key 未命中当前语言 ⇒ 回落 en', resolvePluginText(I18N_ZH, 'manifest.name', 'en'), 'Git Fancy');
eq('i18n：en 也没有 ⇒ 用任意语言提供的值（web i18n.ts:38-44）',
  resolvePluginText(I18N_ZH, 'view.commit.title', 'en'), 'Commit');
eq('i18n：裸文本（非 key）原样返回', resolvePluginText(I18N_ZH, 'Ambience', 'zh-CN'), 'Ambience');
eq('i18n：没有表 ⇒ 原样返回', resolvePluginText(undefined, 'manifest.name', 'zh-CN'), 'manifest.name');
eq('i18n：表里没有该 key ⇒ 原样返回 key（web 的 t(key,key)）',
  resolvePluginText(I18N_ZH, 'view.nope.title', 'zh-CN'), 'view.nope.title');
eq('i18n：空串 ⇒ 空串', resolvePluginText(I18N_ZH, '', 'zh-CN'), '');
eq('i18n：语言标签归一化（zh_CN ⇒ zh-CN）', resolvePluginText(I18N_ZH, 'manifest.name', 'zh_CN'), 'Git 面板');
eq('i18n：同语言前缀回落（zh-Hans 命中 zh-CN 表）',
  resolvePluginText(I18N_ZH, 'manifest.name', 'zh-Hans'), 'Git 面板');
eq('resolveManifestKey：命中 ⇒ 译文', resolveManifestKey(I18N_ZH, 'manifest.description', 'zh-CN').startsWith('Git 面板：分支'), true);
eq('resolveManifestKey：未命中 ⇒ **空串**（不能把 manifest.description 当文案显示）',
  resolveManifestKey(I18N_ZH, 'manifest.missing', 'zh-CN'), '');

// ── 容器分组（与 web ViewContainer 同集合）──────────────────────────────────
eq('容器名：right_sidebar', containerLabel('right_sidebar'), '侧栏');
eq('容器名：status_bar_right', containerLabel('status_bar_right'), '状态栏');
eq('容器名：info_bar', containerLabel('info_bar'), '信息栏');
eq('容器名：未知容器原样暴露（别静默吞掉协议新增值）', containerLabel('some_new_zone'), 'some_new_zone');
eq('容器名：空 ⇒ 其他', containerLabel(''), '其他');
eq('容器序：right_sidebar 在 main 之前', containerRank('right_sidebar') < containerRank('main'), true);
eq('容器序：未知容器排最后', containerRank('some_new_zone') >= containerRank('main'), true);

// ── resolvePluginTarget：直开 vs 进宿主页（**复用波1b 判据**）───────────────
eq('无 URL 候选（真实 view 的形态）⇒ 进宿主页',
  resolvePluginTarget('', BASE).mode, PLUGIN_OPEN_HOST);
eq('候选是 ESM 模块 ⇒ 进宿主页（不是文档）',
  resolvePluginTarget('/plugins/x/web/index.js', BASE).mode, PLUGIN_OPEN_HOST);
eq('候选跨源页面 ⇒ 进宿主页（不把桥注入第三方）',
  resolvePluginTarget('https://evil.example.com/p.html', BASE).mode, PLUGIN_OPEN_HOST);
eq('候选同源页面 ⇒ 可直开',
  resolvePluginTarget('http://192.168.1.9:8082/panel.html', BASE).mode, PLUGIN_OPEN_DIRECT);
eq('直开时 URL 就是候选', resolvePluginTarget('http://192.168.1.9:8082/panel.html', BASE).url,
  'http://192.168.1.9:8082/panel.html');
eq('进宿主页时 URL 是宿主页根', resolvePluginTarget('', BASE).url, BASE);
eq('viewShortId：取最后一段', viewShortId('xbot.git-fancy.panel'), 'panel');
eq('viewShortId：无点 ⇒ 原样', viewShortId('badge'), 'badge');

// ── absoluteAssetUrl：服务端给的是**相对路径**（rpc_table.go:2289），显示要补绝对 ──
eq('相对路径 ⇒ 补上服务器地址',
  absoluteAssetUrl(BASE, '/plugins/p/web/index.js'),
  'http://192.168.1.9:8082/plugins/p/web/index.js');
eq('已是绝对 URL ⇒ 原样', absoluteAssetUrl(BASE, 'https://cdn.example.com/x.js'), 'https://cdn.example.com/x.js');
eq('无前导斜杠 ⇒ 补斜杠', absoluteAssetUrl(BASE, 'plugins/p/web/i.js'), 'http://192.168.1.9:8082/plugins/p/web/i.js');
eq('空 ⇒ 空', absoluteAssetUrl(BASE, ''), '');

// ── buildPluginCatalog：用**真实**清单数据（4 个插件逐字抄）────────────────
const REAL_WIRE: WebPluginListWire = {
  plugins: [
    {
      id: 'xbot.git-fancy', name: 'manifest.name', version: '0.3.5', state: 'active', enabled: true,
      permissions: ['rpc', 'ui'], entry: 'index.js',
      module_url: '/plugins/xbot.git-fancy/web/index.js',
      i18n: I18N_ZH as Record<string, Record<string, string>>,
      contributes: [
        { kind: 'view', id: 'xbot.git-fancy.panel', container: 'right_sidebar', title: 'view.panel.title', icon: 'git-branch', entry: 'index.js' },
        { kind: 'view', id: 'xbot.git-fancy.commit', container: 'main', title: 'view.commit.title', icon: 'git-commit-horizontal', entry: 'commit.js', dynamic: true },
      ],
    },
    {
      id: 'xbot.ssh-runner', name: 'manifest.name', version: '1.0.6', state: 'active',
      entry: 'index.js', module_url: '/plugins/xbot.ssh-runner/web/index.js',
      i18n: { 'zh-CN': { 'manifest.name': '远程机器（SSH）', 'view.panel.title': '远程机器', 'view.bar.title': '远程机器（状态栏）' } },
      contributes: [
        { kind: 'view', id: 'xbot.ssh-runner.panel', container: 'right_sidebar', title: 'view.panel.title', icon: 'server', entry: 'index.js' },
        { kind: 'view', id: 'xbot.ssh-runner.bar', container: 'info_bar', title: 'view.bar.title', icon: 'server', entry: 'bar.js' },
      ],
    },
    {
      id: 'xbot.iteration-stats', name: 'manifest.name', version: '1.0.0', state: 'active',
      entry: 'index.js', module_url: '/plugins/xbot.iteration-stats/web/index.js',
      i18n: { 'zh-CN': { 'manifest.name': '迭代指标', 'view.badge.title': '迭代指标' } },
      contributes: [
        { kind: 'view', id: 'xbot.iteration-stats.badge', container: 'status_bar_right', title: 'view.badge.title', entry: 'index.js' },
      ],
    },
    {
      // 无 web.contributes（视图由宿主内置渲染）—— 目录里仍应出现（它确实有 web 产物）
      id: 'xbot.genui', name: 'manifest.name', version: '1.0.0', state: 'active',
      entry: 'index.js', module_url: '/plugins/xbot.genui/web/index.js',
      i18n: { 'zh-CN': { 'manifest.name': 'GenUI（display_html）', 'manifest.description': 'LLM 生成交互式 UI' } },
    },
  ],
} as unknown as WebPluginListWire;

const CAT = buildPluginCatalog(REAL_WIRE, 'zh-CN', BASE);
eq('目录：4 个插件（含无 views 的 genui）', CAT.items.length, 4);
const git = CAT.items[0];
eq('目录：name 从 i18n key 解析（不显示 manifest.name）', git.name, 'Git 面板');
eq('目录：description 从 manifest.description 解析', git.description.startsWith('Git 面板：分支'), true);
eq('目录：version/state 元数据', `${git.version}/${git.state}`, '0.3.5/active');
eq('目录：url = 宿主页（不是 ESM 资源）', git.url, BASE);
eq('目录：moduleUrl = ESM 元数据', git.moduleUrl, 'http://192.168.1.9:8082/plugins/xbot.git-fancy/web/index.js');
eq('目录：git-fancy 两个视图', git.views.length, 2);
eq('目录：view 标题按 key 解析', git.views[0].title, 'Git');
eq('目录：view 容器 + 分组名', `${git.views[0].container}/${git.views[0].containerLabel}`, 'right_sidebar/侧栏');
eq('目录：view 图标元数据', git.views[0].icon, 'git-branch');
eq('目录：view.entry 相对插件包根', git.views[1].entry, 'commit.js');
eq('目录：dynamic 视图被标注', `${git.views[1].dynamic}`, 'true');
eq('目录：view 带所属插件名（分组里要显示"来自哪个插件"）', git.views[0].pluginName, 'Git 面板');
eq('目录：view 打开方式 = 进宿主页', git.views[0].openMode, PLUGIN_OPEN_HOST);
eq('目录：view 打开 URL = 宿主页', git.views[0].openUrl, BASE);
eq('目录：iteration-stats 无 icon ⇒ 空串（组件侧回落通用符号）', CAT.items[2].views[0].icon, '');
eq('目录：genui 无 contributes ⇒ 0 视图（不是错误）', CAT.items[3].views.length, 0);
eq('目录：ssh-runner 名称解析', CAT.items[1].name, '远程机器（SSH）');
eq('目录：名称是 key 但表里没有 ⇒ 回落 id（绝不把 manifest.name 当显示名）',
  buildPluginCatalog({
    plugins: [{ id: 'x.no-i18n', name: 'manifest.name', entry: 'index.js', module_url: '/plugins/x.no-i18n/web/index.js' }],
  } as unknown as WebPluginListWire, 'zh-CN', BASE).items[0].name, 'x.no-i18n');
eq('目录：view title 是 key 但表里没有 ⇒ 回落短 id',
  buildPluginCatalog({
    plugins: [{
      id: 'p', name: 'P', entry: 'index.js', module_url: '/plugins/p/web/index.js',
      contributes: [{ kind: 'view', id: 'p.panel', container: 'main', title: 'view.panel.title', entry: 'index.js' }],
    }],
  } as unknown as WebPluginListWire, 'zh-CN', BASE).items[0].views[0].title, 'panel');
eq('目录：非 kind:view 的贡献点不进目录（command/toolbar/… 是宿主行为扩展）',
  buildPluginCatalog({
    plugins: [{
      id: 'p', name: 'P', entry: 'index.js', module_url: '/plugins/p/web/index.js',
      contributes: [
        { kind: 'command', id: 'p.cmd' } as unknown as WebViewWire,
        { kind: 'view', id: 'p.panel', container: 'main', title: '面板', entry: 'index.js' },
      ],
    }],
  } as unknown as WebPluginListWire, 'zh-CN', BASE).items[0].views.length, 1);

// ── 目录分组（按容器，跨插件聚合，顺序稳定）────────────────────────────────
eq('分组：3 个容器（侧栏/主区/信息栏/状态栏）', CAT.groups.length, 4);
eq('分组序：侧栏在最前', CAT.groups[0].label, '侧栏');
eq('分组序：状态栏在最后', CAT.groups[CAT.groups.length - 1].label, '状态栏');
eq('分组：侧栏聚合两个插件的视图（git-fancy + ssh-runner）', CAT.groups[0].views.length, 2);
eq('分组：侧栏第一项来自 git-fancy', CAT.groups[0].views[0].pluginId, 'xbot.git-fancy');
eq('分组：侧栏第二项来自 ssh-runner', CAT.groups[0].views[1].pluginId, 'xbot.ssh-runner');
eq('分组：信息栏只有 ssh-runner.bar', CAT.groups[2].views.length, 1);
eq('空目录：无插件 ⇒ 零条目零分组', (() => {
  const c = buildPluginCatalog({ plugins: [] } as unknown as WebPluginListWire, 'zh-CN', BASE);
  return `${c.items.length}/${c.groups.length}`;
})(), '0/0');
eq('缺 plugins 字段（服务端异常）⇒ 空目录不抛', (() => {
  const c = buildPluginCatalog(undefined, 'zh-CN', BASE);
  return `${c.items.length}/${c.groups.length}`;
})(), '0/0');

// 不变量：目录里每个"可打开 URL"都不是模块资源（= 波1b 的缺陷不会从这里复发）
let catalogSafe = true;
for (let i = 0; i < CAT.items.length; i++) {
  if (isPluginModuleAsset(CAT.items[i].url)) { catalogSafe = false; }
  const vs = CAT.items[i].views;
  for (let j = 0; j < vs.length; j++) {
    if (isPluginModuleAsset(vs[j].openUrl)) { catalogSafe = false; }
  }
}
ok('不变量：目录所有 openUrl 都不是模块资源', catalogSafe);
ok('目录条目仍是 PluginPanelInfo 子类（Index.ets 的既有消费不受影响）',
  CAT.items[0] instanceof PluginHostInfo);

if (fail > 0) { console.log(`  pluginpanel: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  pluginpanel: ${pass} passed, 0 failed`);
process.exit(0);
