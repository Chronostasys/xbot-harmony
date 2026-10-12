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

import { PluginCatalog, WebPluginListWire, buildPluginCatalog } from '../../entry/src/main/ets/core/pluginhost';
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

if (fail > 0) {
  console.log(`  ✗ plugin_native_views: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ plugin_native_views: ${pass} passed, 0 failed`);
process.exit(0);
