/**
 * plugin_view_intercept —— 「插件视图导航拦截协议」的 **wiring 判据**（2026-10-13）。
 *
 * ── 为什么有这条判据（用户原话）───────────────────────────────────────────
 * 「当然如果只有 git 插件是特殊逻辑倒是可以接受，但是你要有一套专门的协议吧，比如
 *   git 插件之类的插件交互会要求打开 web 的别的页面，而原生端应该拦截这些打开原生的」
 * ⇒ 宿主**不许**为具体插件写死打开逻辑；必须有一套**通用协议**：web 插件 `ctx.ui.openViewTab`
 *   打开视图 ⇒ 宿主页导航到 `?xbot_view=<viewId>` 深链 ⇒ 原生端 `onLoadIntercept` 拦截、
 *   `nativeViewKind` 注册表路由到原生面板（无原生落地 ⇒ 放行 WebView 兜底）。
 *
 * ── 判据（三层接线，缺一层 ⇒ 协议断）─────────────────────────────────────
 *   ① WebSurface 拦截层：`onLoadIntercept` + `parseXbotViewLink` + `nativeViewKind` + `onOpenView` 回调；
 *   ② Index 路由层：`routePluginView`（`nativeViewKind` → `openGitPanel`）+ 三处接线（2 个 WebSurface + 1 个 PluginHost）；
 *   ③ PluginHost 透传层：`onNativeView` 回调 prop → WebSurface 的 `onOpenView`。
 * ⛔ 零扫描判红（合计 0 ⇒ 红，防扫描器与真源脱节）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

export {};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}

const REPO: string = path.resolve(__dirname, '../../../..');
const COMP: string = path.join(REPO, 'entry/src/main/ets/components');
const PAGES: string = path.join(REPO, 'entry/src/main/ets/pages');

const webSrc: string = stripComments(fs.readFileSync(path.join(COMP, 'WebSurface.ets'), 'utf8'));
const idxSrc: string = stripComments(fs.readFileSync(path.join(PAGES, 'Index.ets'), 'utf8'));
const hostSrc: string = stripComments(fs.readFileSync(path.join(COMP, 'PluginHost.ets'), 'utf8'));

// ── ① WebSurface 拦截层 ────────────────────────────────────────────────────
const intercept: number = countOf(webSrc, '.onLoadIntercept(');
const webParse: number = countOf(webSrc, 'parseXbotViewLink(');
const webKind: number = countOf(webSrc, 'nativeViewKind(');
const webOnOpenView: number = countOf(webSrc, 'onOpenView: (viewId: string, title: string, url: string)');
console.log(`  intercept: onLoadIntercept=${intercept} parse=${webParse} kind=${webKind} onOpenView=${webOnOpenView}`);

ok(`① WebSurface 有 onLoadIntercept（${intercept} == 1）`, intercept === 1);
ok(`① 拦截里调 parseXbotViewLink（${webParse} ≥ 1）`, webParse >= 1);
ok(`① 拦截里调 nativeViewKind（${webKind} ≥ 1）`, webKind >= 1);
ok(`① WebSurface 暴露 onOpenView 回调（${webOnOpenView} ≥ 1）`, webOnOpenView >= 1);

// ── ② Index 路由层 ────────────────────────────────────────────────────────
const routeDef: number = countOf(idxSrc, 'private routePluginView(viewId: string, title: string, url: string)');
const routeKind: number = countOf(idxSrc, 'nativeViewKind(viewId)');
const routeGit: number = countOf(idxSrc, 'this.openGitPanel();');
const routeCalls: number = countOf(idxSrc, 'this.routePluginView(viewId, title, url);');
const idxOnOpenView: number = countOf(idxSrc, 'onOpenView: (viewId: string, title: string, url: string)');
const idxOnNativeView: number = countOf(idxSrc, 'onNativeView: (viewId: string, title: string, url: string)');
console.log(`  route: def=${routeDef} kind=${routeKind} openGit=${routeGit} calls=${routeCalls} onOpenView=${idxOnOpenView} onNativeView=${idxOnNativeView}`);

ok(`② Index 有 routePluginView 方法（${routeDef} == 1）`, routeDef === 1);
ok(`② 路由里按 nativeViewKind 分发（${routeKind} ≥ 1）`, routeKind >= 1);
ok(`② git 落地 → openGitPanel（${routeGit} ≥ 1）`, routeGit >= 1);
ok(`② 三处接线（2 个 WebSurface + 1 个 PluginHost = ${routeCalls} ≥ 3）`, routeCalls >= 3);
ok(`② WebSurface 调用点接线 onOpenView（${idxOnOpenView} ≥ 2）`, idxOnOpenView >= 2);
ok(`② PluginHost 注入点接线 onNativeView（${idxOnNativeView} ≥ 1）`, idxOnNativeView >= 1);

// ── ③ PluginHost 透传层 ──────────────────────────────────────────────────
const hostProp: number = countOf(hostSrc, 'onNativeView: (viewId: string, title: string, url: string)');
const hostFwd: number = countOf(hostSrc, 'this.onNativeView(viewId, title, url);');
console.log(`  host: onNativeViewProp=${hostProp} forward=${hostFwd}`);

ok(`③ PluginHost 有 onNativeView 回调 prop（${hostProp} ≥ 1）`, hostProp >= 1);
ok(`③ WebSurface.onOpenView 透传到 onNativeView（${hostFwd} ≥ 1）`, hostFwd >= 1);

// ── 零扫描判红 ────────────────────────────────────────────────────────────
ok('零扫描判红：协议接线证据合计 > 0',
  intercept + webParse + webKind + routeDef + routeKind + routeGit + routeCalls + hostProp + hostFwd > 0);

console.log(`  plugin_view_intercept: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
