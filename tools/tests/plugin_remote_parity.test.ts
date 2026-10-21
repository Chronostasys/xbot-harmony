/**
 * 插件 parity 门禁（**真实服务器 payload** 版）—— `core/pluginhost.ets` 的目录模型。
 *
 * 与 `pluginpanel.test.ts` 的分工：那边用手抄的清单数据守护 URL/桥语义；本文件把
 * `https://xbot.pivotlang.tech`（`plugins.enabled:true`）真实 `web_plugin_list` 响应
 * （`plugin_remote_payload.ts`，逐字快照）灌进 `buildPluginCatalog`，**断言真实字段
 * ⇒ 解析结果**，把「i18n 必须解析 / 只列带 web 的插件 / module_url 拼绝对 / 图标归一化」
 * 四条 parity 点钉死为回归门禁。
 *
 * 守护的核心不变量（对应用户症状「界面显示 manifest.name / view.panel.title 字面量」）：
 *   · 下发的 `name` / `contributes[].title` 是 **i18n key**（同 payload 的 `i18n[loc][key]`
 *     才是字面量）⇒ 目录里的 `name` / `title` **绝不能**再出现 `manifest.` / `view.` 字面量；
 *   · 只有带 web 声明的插件进目录（真实服务器 6 active 里只有 4 个带 web）；
 *   · `module_url` 是相对路径 ⇒ `moduleUrl` 必须是绝对 URL（拼当前会话 baseUrl）；
 *     而"可打开的 URL"（`url` / `openUrl`）**永远不是** ESM 模块资源（波1b 缺陷不复发）；
 *   · 图标名归一化（trim+小写）后才是 lucide 键——与 web `pluginIcons.ts:63` 同规则。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import { PLUGIN_REMOTE_RESPONSE } from './plugin_remote_payload';
import {
  PluginCatalog,
  PluginCatalogItem,
  PLUGIN_OPEN_HOST,
  WebPluginListWire,
  absoluteAssetUrl,
  buildPluginCatalog,
  containerLabel,
  isKnownPluginIcon,
  isPluginModuleAsset,
  normalizePluginIcon,
} from '../../entry/src/main/ets/core/pluginhost';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

// 真实服务器地址（权威 baseUrl；`module_url` 相对路径要拼到它上面）。
const REMOTE = 'https://xbot.pivotlang.tech';

// ── 夹具解析：真实 RPC 信封 ⇒ data ──────────────────────────────────────────
const ENV: { ok: boolean; data: WebPluginListWire } = PLUGIN_REMOTE_RESPONSE as { ok: boolean; data: WebPluginListWire };
eq('夹具：真实响应 ok', ENV.ok, true);
const WIRE: WebPluginListWire = ENV.data;
eq('夹具：web_plugin_list 下发 4 个插件（6 active 里只 4 个带 web）', WIRE.plugins!.length, 4);
eq('夹具：插件 id 顺序',
  WIRE.plugins!.map((p) => p.id).join(','),
  'xbot.genui,xbot.git-fancy,xbot.iteration-stats,xbot.ssh-runner');

// ── 前提验证：payload 里 name/title **确实是 i18n key**（否则本门禁守护的是空气）──
let allNamesAreKeys = true;
let allTitlesAreKeys = true;
for (let i = 0; i < WIRE.plugins!.length; i++) {
  const p = WIRE.plugins![i];
  if (p.name !== 'manifest.name') { allNamesAreKeys = false; }
  const cs = p.contributes !== undefined && p.contributes !== null ? p.contributes : [];
  for (let j = 0; j < cs.length; j++) {
    const t = cs[j].title;
    if (t === undefined || t.indexOf('view.') !== 0) { allTitlesAreKeys = false; }
  }
}
ok('前提：真实 payload 的 name 全是 i18n key（manifest.name）', allNamesAreKeys,
  `names=${JSON.stringify(WIRE.plugins!.map((p) => p.name))}`);
ok('前提：真实 payload 的 view title 全是 i18n key（view.*）', allTitlesAreKeys);

// ── 真实 payload 各插件是否带 web.contributes（决定目录里的视图面）──────────
let genuiContributes: unknown = WIRE.plugins![0].contributes;
ok('真实：xbot.genui 无 web.contributes（视图由宿主内置渲染）⇒ 0 视图',
  genuiContributes === undefined || genuiContributes === null);

// ══════════════════════════════════════════════════════════════════════════════
// ① 目录构建（zh-CN）：真实字段 ⇒ 解析结果
// ══════════════════════════════════════════════════════════════════════════════
const CAT: PluginCatalog = buildPluginCatalog(WIRE, 'zh-CN', REMOTE);

// 2026-10-17：有**原生入口**的插件（git-fancy / ssh-runner）按入口去重策略
// **整条不进 web 目录**（用户要求"一个插件只给一个入口"）⇒ 只余 genui + iteration-stats。
eq('目录：2 个 web 插件条目（git/ssh 已有原生入口 ⇒ 不进 web 目录）', CAT.items.length, 2);
ok('目录：git-fancy / ssh-runner 不出现（原生入口接管）',
  CAT.items.map((p) => p.id).indexOf('xbot.git-fancy') < 0
  && CAT.items.map((p) => p.id).indexOf('xbot.ssh-runner') < 0);

// ── parity 点 A：i18n 解析（name/title 不再是字面量 key）────────────────────
eq('目录：genui 名从 i18n key 解析', CAT.items[0].name, 'GenUI（display_html）');
eq('目录：iteration-stats 名从 i18n key 解析', CAT.items[1].name, '迭代指标');

let anyLiteralKey = false;
for (let i = 0; i < CAT.items.length; i++) {
  if (CAT.items[i].name === 'manifest.name' || CAT.items[i].name.indexOf('manifest.') === 0) { anyLiteralKey = true; }
  const vs = CAT.items[i].views;
  for (let j = 0; j < vs.length; j++) {
    if (vs[j].title.indexOf('view.') === 0) { anyLiteralKey = true; }
  }
}
ok('不变量：目录里 name/title **绝不**残留 i18n key 字面量', !anyLiteralKey);

eq('目录：genui 描述从 manifest.description 解析',
  CAT.items[0].description.startsWith('LLM 生成交互式 UI'), true);

// ── parity 点 A（续）：视图标题也按 key 解析 ────────────────────────────────
const iter: PluginCatalogItem = CAT.items[1];
eq('目录：iteration-stats.badge 标题解析 = 插件名', iter.views[0].title, '迭代指标');
eq('目录：iteration-stats.badge 容器', iter.views[0].containerLabel, '状态栏');

// ── parity 点 B：只列带 web 产物的插件（ambience/qq 不在）──────────────────
const ids: string[] = CAT.items.map((p) => p.id);
ok('目录：不含纯后端插件 xbot.ambience', ids.indexOf('xbot.ambience') < 0);
ok('目录：不含纯后端插件 xbot.qq', ids.indexOf('xbot.qq') < 0);

// ── parity 点 C：module_url（相对路径）⇒ 绝对（拼当前会话 baseUrl）─────────
eq('目录：genui moduleUrl 补绝对',
  CAT.items[0].moduleUrl, 'https://xbot.pivotlang.tech/plugins/xbot.genui/web/index.js');
ok('目录：moduleUrl 确为绝对 URL（带 scheme）', CAT.items[0].moduleUrl.indexOf('https://') === 0);

// 不变量：可打开 URL 永远不是模块资源（波1b 缺陷不复发）
let openUrlSafe = true;
for (let i = 0; i < CAT.items.length; i++) {
  const it = CAT.items[i];
  if (isPluginModuleAsset(it.url)) { openUrlSafe = false; }
  if (it.url !== REMOTE) { openUrlSafe = false; }
  for (let j = 0; j < it.views.length; j++) {
    if (isPluginModuleAsset(it.views[j].openUrl)) { openUrlSafe = false; }
    if (it.views[j].openMode !== PLUGIN_OPEN_HOST) { openUrlSafe = false; }
  }
}
ok('不变量：所有 url/openUrl 都是权威宿主页根（不是 ESM 资源、不是 module_url）', openUrlSafe);

// ── parity 点 D：图标名归一化（web pluginIcons.ts:63 同规则）───────────────
eq('图标：iteration-stats 未声明 ⇒ 空串（组件回落通用符号）', iter.views[0].icon, '');
eq('图标：归一化去空白', normalizePluginIcon('  Server  '), 'server');
eq('图标：归一化小写（"Git-Branch" ⇒ "git-branch"，与 web 同）',
  normalizePluginIcon('Git-Branch'), 'git-branch');
eq('图标：已知名（大小写不敏感）', isKnownPluginIcon('Server'), true);
eq('图标：未知名 ⇒ false', isKnownPluginIcon('totally-unknown'), false);
eq('图标：空 ⇒ false', isKnownPluginIcon(''), false);
eq('图标：目录里大小写混写的 icon 被归一化（否则原生掉进降级分支而 web 命中）',
  buildPluginCatalog({
    plugins: [{
      id: 'p', name: 'P', entry: 'index.js', module_url: '/plugins/p/web/index.js',
      contributes: [{ kind: 'view', id: 'p.v', container: 'main', title: '标题', icon: 'Server', entry: 'index.js' }],
    }],
  } as unknown as WebPluginListWire, 'zh-CN', REMOTE).items[0].views[0].icon, 'server');

// ── 语言回退：同一真实 payload 换 locale ⇒ 换语言的字面量 ──────────────────
const EN: PluginCatalog = buildPluginCatalog(WIRE, 'en', REMOTE);
eq('i18n 回退：en ⇒ iteration-stats = Iteration Stats', EN.items[1].name, 'Iteration Stats');
eq('i18n 回退：en ⇒ genui = GenUI (display_html)', EN.items[0].name, 'GenUI (display_html)');
const JA: PluginCatalog = buildPluginCatalog(WIRE, 'ja', REMOTE);
eq('i18n 回退：ja ⇒ iteration-stats = イテレーション統計', JA.items[1].name, 'イテレーション統計');
eq('i18n 回退：未知语言（fr）⇒ 回落 en',
  buildPluginCatalog(WIRE, 'fr', REMOTE).items[1].name, 'Iteration Stats');
eq('i18n 回退：语言前缀（zh-Hans 命中 zh-CN 表）',
  buildPluginCatalog(WIRE, 'zh-Hans', REMOTE).items[1].name, '迭代指标');

// ── 分组：按容器聚合（原生入口去重后只剩 non-native 的 iteration-stats 徽章）──
eq('分组：1 个容器（状态栏；git/ssh 已由原生入口接管）', CAT.groups.length, 1);
eq('分组：状态栏', CAT.groups[0].container, 'status_bar_right');
eq('分组：状态栏只有 iteration-stats.badge', CAT.groups[0].views.length, 1);

// ── 与 web+服务端同构的拼法（守住 baseUrl 不被本地映射污染：远程地址即权威）──
eq('拼法：绝对化不会把远程地址换成别的 host',
  absoluteAssetUrl(REMOTE, '/plugins/xbot.genui/web/index.js'),
  'https://xbot.pivotlang.tech/plugins/xbot.genui/web/index.js');
eq('拼法：容器名回落容器自身（协议新增值不静默吞掉）', containerLabel('some_new_zone'), 'some_new_zone');

if (fail > 0) { console.log(`  plugin_remote_parity: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  plugin_remote_parity: ${pass} passed, 0 failed`);
process.exit(0);

export {};
