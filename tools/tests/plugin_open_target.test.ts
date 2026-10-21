/**
 * plugin_open_target.test.ts —— 「打开插件」**必须**落到插件的视图，而不是 web 应用主界面。
 *
 * 缺陷形态（2026-10-13 **真机实证**，用户插话「不能让用户交互后跑 webview 的主界面之类的去了」）：
 * 本仓原生「插件目录」（`components/PluginHost.ets`）里的卡片/视图行长直接用
 * `PluginViewItem.openUrl` / `PluginCatalogItem.url` 导航，而**真实 view 贡献点不带 URL**
 * ⇒ `buildPluginCatalog` 把它们取成 **host 根页**（`pluginhost.ets:608`
 * `t.openUrl = target.url.length > 0 ? target.url : host`）⇒ 点「打开」载入的是
 * **xbot web 应用主界面（聊天页）**，而不是插件自己的面板。
 * （能力面板那条路径早有通用深链 ⇒ 同样的插件在两处行为不一致 = 典型的分叉缺陷。）
 *
 * 修复：两处都走**同一个纯函数** `core/pluginhost.ets:pluginOpenTarget`（卡片）/
 * `pluginViewTarget`（用户点名的具体视图行）⇒ 有 view 贡献点就拼 `?xbot_view=<id>` 深链；
 * 只有**完全没有 view**（如 `xbot.genui` 由宿主内联渲染）才回落插件自带 `url`。
 *
 * 判别力（mutation 自证）：
 *   · 把 `pluginOpenTarget` 的深链分支删掉（恒返回 `p.url`）⇒ A1/A2/B1/D1 红；
 *   · 把 `pluginViewTarget` 改成用 `primaryViewId`（而非用户点名的那个 id）⇒ E1/E2 红；
 *   · `base` 为空时不返回空串 ⇒ F1 红。
 */
declare const process: { exit: (c: number) => void };

import {
  PluginCatalogItem, PluginOpenTarget, PluginViewItem,
  pluginOpenTarget, pluginViewTarget,
} from '../../entry/src/main/ets/core/pluginhost';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
    return;
  }
  fail++;
  console.log(`  \u2717 ${name}${extra !== undefined ? '  (' + extra + ')' : ''}`);
}

const BASE = 'http://127.0.0.1:8082';
const HOST = 'http://127.0.0.1:8082/';   // 目录里 openUrl 的真实值（= host 根页 = 聊天页）

function view(id: string, title: string, dynamic: boolean): PluginViewItem {
  const v = new PluginViewItem();
  v.id = id;
  v.title = title;
  v.dynamic = dynamic;
  v.openUrl = HOST;        // ⛔ 关键：目录里 openUrl 恒为 host 根页（真实贡献点不带 URL）
  v.openMode = 'host';
  return v;
}

function plugin(name: string, views: PluginViewItem[]): PluginCatalogItem {
  const p = new PluginCatalogItem();
  p.id = 'xbot.demo';
  p.name = name;
  p.url = HOST;            // ⛔ 同上：插件级 url 也是 host 根页
  p.views = views;
  return p;
}

// ── A. 卡片：有 view 贡献点 ⇒ **必须**深链（绝不能是 host 根页）────────────────
{
  const t: PluginOpenTarget = pluginOpenTarget(plugin('Git \u9762\u677f', [
    view('xbot.git-fancy.commit', '\u63d0\u4ea4\u8be6\u60c5', true),
    view('xbot.git-fancy.panel', 'Git \u9762\u677f', false),
  ]), BASE);
  ok('A1 有 view ⇒ URL 含 `xbot_view=`（不是 host 根页）',
    t.url.indexOf('xbot_view=') >= 0, t.url);
  ok('A2 选中**非 dynamic** 的主视图（跳过必须带参数的 commit 视图）',
    t.url.indexOf(encodeURIComponent('xbot.git-fancy.panel')) >= 0, t.url);
  ok('A3 标题 = 插件名', t.title === 'Git \u9762\u677f', t.title);
  ok('A4 URL 不等于 host 根页（⛔ 跑回主界面的判据）',
    t.url !== HOST && t.url.indexOf('xbot_view=') > 0, t.url);
}

// ── B. 全部 view 都是 dynamic ⇒ 退回第一个（至少给一次机会，不是静默不动）──────
{
  const t = pluginOpenTarget(plugin('X', [view('xbot.d.a', 'A', true), view('xbot.d.b', 'B', true)]), BASE);
  ok('B1 全 dynamic ⇒ 深链第一个 id',
    t.url.indexOf(encodeURIComponent('xbot.d.a')) >= 0, t.url);
}

// ── C. 完全没有 view（如 xbot.genui 由宿主内联渲染）⇒ 才回落插件自带 url ────────
{
  const t = pluginOpenTarget(plugin('GenUI', []), BASE);
  ok('C1 无 view ⇒ 回落插件自带 url', t.url === HOST, t.url);
  ok('C2 标题仍是插件名', t.title === 'GenUI', t.title);
}

// ── D. 尾斜杠 / 空 base ─────────────────────────────────────────────────────
{
  const t = pluginOpenTarget(plugin('P', [view('xbot.p.panel', 'P', false)]), BASE + '/');
  ok('D1 base 尾斜杠归一化（不出现 `//?xbot_view`）',
    t.url.indexOf('//?') < 0 && t.url.indexOf('xbot_view=') > 0, t.url);

  const empty = pluginOpenTarget(plugin('P', [view('xbot.p.panel', 'P', false)]), '');
  ok('D2 base 为空 ⇒ 空 URL（调用方不得载入空页）', empty.url === '', `"${empty.url}"`);
}

// ── E. 视图行：开**用户点名的那一个** id（不走 primaryViewId）─────────────────
{
  const v = view('xbot.git-fancy.commit', '\u63d0\u4ea4\u8be6\u60c5', true);
  const t = pluginViewTarget(v, BASE);
  ok('E1 用被点的那一个 view id（不是主视图）',
    t.url.indexOf(encodeURIComponent('xbot.git-fancy.commit')) >= 0, t.url);
  ok('E2 标题 = 该视图自己的标题', t.title === '\u63d0\u4ea4\u8be6\u60c5', t.title);
  ok('E3 ⛔ 不是 openUrl（host 根页 = 聊天页）',
    t.url !== HOST && t.url.indexOf('xbot_view=') > 0, t.url);
  ok('E4 dynamic 视图行也深链（打开后是该插件自己的空态，绝不跳到宿主主界面）',
    t.url.indexOf('xbot_view=') > 0, t.url);
}

// ── F. 无 base ⇒ 空（不得把 openUrl 当兜底载入主界面）─────────────────────────
{
  const t = pluginViewTarget(view('xbot.p.panel', 'P', false), '');
  ok('F1 无 base ⇒ 空 URL', t.url === '', `"${t.url}"`);
}

console.log(`\nplugin_open_target: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

export {};
