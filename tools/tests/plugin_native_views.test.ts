/**
 * plugin_native_views.test.ts —— **插件视图的原生渲染判据**（2026-10-12）。
 *
 * 背景（用户当场否掉的做法）：原生此前对"打开某个插件视图"只有一条路 —— 把**权威宿主页
 * （= 整个 web 应用）**塞进 `WebSurface` ⇒ 点「迭代指标 → 打开」后**整屏变成 web 版聊天应用**。
 * 用户原话：「他是 web 实现你可以用 web，但是你不能把原生会话也变成 web view」。
 *
 * 修法 = **能由宿主自己出数据的视图一律原生渲染**（"只有插件本身"）：本用例钉住
 * `core/pluginviews.ets` 的判据 —— 逐字对齐插件产物
 * `~/.xbot/plugins/builtin/xbot.iteration-stats/web/index.js`：
 *   · `if (!tps || tps <= 0) return null` ⇒ 无速度**不显示**（不是显示 0）；
 *   · 手机版文案 `${tps.toFixed(0)}t/s` + （`showTTFT && ttft>0` 时）` · ${fmtMs(ttft)}`；
 *   · `fmtMs`：`ms<=0 ⇒ ''`；`<1000 ⇒ '${ms}ms'`；否则 `'${(ms/1000).toFixed(1)}s'`。
 *
 * ⚠️ **判别力自证**：把 `iterStatsText` 的 `tps<=0` 守卫删掉 ⇒ 「无速度不显示」红；
 *    把 `fmtMs` 的 1e3 阈值改成 1e4 ⇒ 「2300 → 2.3s」红；`hasIterStatsBadge` 不看 view id 而恒 true ⇒ 红。
 */
export {};

declare const process: { exit: (c: number) => void };

import { PluginCatalog, WebPluginListWire, buildPluginCatalog, isPanelContainer, pluginOpenHint } from '../../entry/src/main/ets/core/pluginhost';
import {
  ITER_STATS_CONTAINER, ITER_STATS_VIEW_ID, fmtMs, hasIterStatsBadge, iterStatsText,
} from '../../entry/src/main/ets/core/pluginviews';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── fmtMs（逐字对齐插件产物的 fmtMs）────────────────────────────────────────
eq('fmtMs：<=0 ⇒ 空串（"无数据"不是"0ms"）', fmtMs(0), '');
eq('fmtMs：负数 ⇒ 空串', fmtMs(-5), '');
eq('fmtMs：<1s ⇒ ${ms}ms', fmtMs(820), '820ms');
eq('fmtMs：恰好 1000 ⇒ 1.0s', fmtMs(1000), '1.0s');
eq('fmtMs：2300 ⇒ 2.3s（真机徽章文案实测形态）', fmtMs(2300), '2.3s');

// ── iterStatsText（无速度不显示；showTTFT 门控）──────────────────────────────
eq('徽章：无速度(0) ⇒ 空串（不渲染，对齐插件 return null）', iterStatsText(0, 2300, true), '');
eq('徽章：负速度 ⇒ 空串', iterStatsText(-1, 2300, true), '');
eq('徽章：有速度 + TTFT ⇒ "228t/s · 2.3s"（手机版形态）',
  iterStatsText(228.4, 2300, true), '228t/s · 2.3s');
eq('徽章：showTTFT=false ⇒ 只有速度', iterStatsText(228.4, 2300, false), '228t/s');
eq('徽章：TTFT=0 ⇒ 只有速度（无数据不拼分隔符）', iterStatsText(228.4, 0, true), '228t/s');
eq('徽章：整数取整（toFixed(0)）', iterStatsText(99.6, 500, true), '100t/s · 500ms');

// ── 原生渲染的启用判据：装了且声明了该视图才渲染 ────────────────────────────
const cat: PluginCatalog = buildPluginCatalog({
  plugins: [{
    id: 'xbot.iteration-stats', name: '迭代指标', entry: 'index.js', state: 'active', version: '1.0.0',
    contributes: [{ kind: 'view', id: 'xbot.iteration-stats.badge', container: 'status_bar_right', title: '迭代指标', entry: 'index.js' }],
  }],
} as unknown as WebPluginListWire, 'zh-CN', 'http://x:8082');
ok('启用判据：装了迭代指标徽章视图 ⇒ true', hasIterStatsBadge(cat) === true);
ok('启用判据：空目录 ⇒ false', hasIterStatsBadge(new PluginCatalog()) === false);
ok('启用判据：undefined ⇒ false（不抛）', hasIterStatsBadge(undefined) === false);
const otherCat: PluginCatalog = buildPluginCatalog({
  plugins: [{
    id: 'xbot.git-fancy', name: 'G', entry: 'index.js',
    contributes: [{ kind: 'view', id: 'xbot.git-fancy.panel', container: 'right_sidebar', entry: 'index.js' }],
  }],
} as unknown as WebPluginListWire, 'zh-CN', 'http://x:8082');
ok('启用判据：只有别的插件视图 ⇒ false（不误判）', hasIterStatsBadge(otherCat) === false);
ok('常量：视图 id 与容器与插件产物一致',
  ITER_STATS_VIEW_ID === 'xbot.iteration-stats.badge' && ITER_STATS_CONTAINER === 'status_bar_right');

// ── 可开性判据（⛔ 用户原话「统计插件的面板我们看不到」的根因，2026-10-13）────────────
// 容器词表取 web 权威 `web/src/plugin-api/manifest.ts:16 ViewContainer`。
// 判别力自证：让 `isPanelContainer` 对 `status_bar_right` 返回 true ⇒ 下面第 5/6 条红；
//             openable 计算去掉 `!dynamic` ⇒ 第 10 条红；`pluginOpenHint` 恒返回 '' ⇒ 第 7/8 条红。
ok('可开容器：right_sidebar/panel/main/bottom ⇒ true',
  isPanelContainer('right_sidebar') && isPanelContainer('panel')
  && isPanelContainer('main') && isPanelContainer('bottom'));
ok('内嵌容器：info_bar/status_bar_right/iteration ⇒ false（不是面板）',
  !isPanelContainer('info_bar') && !isPanelContainer('status_bar_right')
  && !isPanelContainer('iteration'));
ok('未知容器/空 ⇒ false（安全方向：宁可信息行，不给空页）',
  !isPanelContainer('') && !isPanelContainer('sidebar_v2'));

const catIter: PluginCatalog = buildPluginCatalog({
  plugins: [{
    id: 'xbot.iteration-stats', name: '迭代指标', entry: 'index.js', version: '1.0.0',
    contributes: [{ kind: 'view', id: 'xbot.iteration-stats.badge', container: 'status_bar_right', title: 'view.badge.title', entry: 'index.js' }],
  }],
} as unknown as WebPluginListWire, 'zh-CN', 'http://x:8082');
ok('可开性：只声明状态栏徽章的插件 ⇒ 不可开（点开只能得到空页）',
  catIter.items[0].openable === false);
eq('提示：徽章类插件 ⇒ 「已挂载：状态栏」（告诉它已在哪儿生效）',
  pluginOpenHint(catIter.items[0]), '已挂载：状态栏');

const catGenui: PluginCatalog = buildPluginCatalog({
  plugins: [{ id: 'xbot.genui', name: 'GenUI', entry: 'index.js', version: '1.0.0' }],
} as unknown as WebPluginListWire, 'zh-CN', 'http://x:8082');
ok('可开性：未声明 contributes 的插件 ⇒ 不可开（视图由宿主内置渲染）',
  catGenui.items[0].openable === false);
eq('提示：无视图贡献点 ⇒ 「未声明面板」', pluginOpenHint(catGenui.items[0]), '未声明面板');

// 2026-10-17：`xbot.git-fancy` 已有**原生入口** ⇒ `buildPluginCatalog` 会整条跳过它
// （用户要求"有原生入口就不要再给 web 入口"）⇒ 可开性判据改用**非原生**的第三方插件 id。
const catGit: PluginCatalog = buildPluginCatalog({
  plugins: [{
    id: 'xbot.demo-panel', name: 'Demo', entry: 'index.js', version: '0.3.5',
    contributes: [
      { kind: 'view', id: 'xbot.demo-panel.panel', container: 'right_sidebar', entry: 'index.js' },
      { kind: 'view', id: 'xbot.demo-panel.commit', container: 'main', dynamic: true, entry: 'commit.js' },
    ],
  }],
} as unknown as WebPluginListWire, 'zh-CN', 'http://x:8082');
ok('可开性：有右栏面板（非 dynamic）⇒ 可开', catGit.items[0].openable === true);
eq('提示：可开的插件不显示提示', pluginOpenHint(catGit.items[0]), '');

const catDynOnly: PluginCatalog = buildPluginCatalog({
  plugins: [{
    id: 'xbot.dyn', name: 'D', entry: 'index.js',
    contributes: [{ kind: 'view', id: 'xbot.dyn.commit', container: 'main', dynamic: true, entry: 'commit.js' }],
  }],
} as unknown as WebPluginListWire, 'zh-CN', 'http://x:8082');
ok('可开性：只有 main+dynamic 视图 ⇒ 不可开（dynamic 只能由宿主带参打开，没有 URL 入口）',
  catDynOnly.items[0].openable === false);

const catSsh: PluginCatalog = buildPluginCatalog({
  plugins: [{
    id: 'xbot.demo-ssh', name: '远程机器', entry: 'index.js', version: '1.0.6',
    contributes: [
      { kind: 'view', id: 'xbot.demo-ssh.panel', container: 'right_sidebar', icon: 'server', entry: 'index.js' },
      { kind: 'view', id: 'xbot.demo-ssh.bar', container: 'info_bar', icon: 'server', entry: 'bar.js' },
    ],
  }],
} as unknown as WebPluginListWire, 'zh-CN', 'http://x:8082');
ok('可开性：面板 + 信息栏混合 ⇒ 可开（有面板即可）', catSsh.items[0].openable === true);

if (fail > 0) {
  console.log(`  ✗ plugin_native_views: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ plugin_native_views: ${pass} passed, 0 failed`);
process.exit(0);
