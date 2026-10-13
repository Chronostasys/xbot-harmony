/**
 * plugin_view_link —— **通用插件视图打开**的纯判据（2026-10-13，用户架构修正）。
 *
 * ── 为什么有这么一条判据（用户原话）──────────────────────────────────────────
 * 「为什么要原生，你插件写特殊逻辑我们以后新的插件怎么办？」⇒ 宿主**不许**为具体插件写
 * 打开逻辑；必须由**插件自己声明的 view 贡献点**驱动，才能保证 web 以后新加的任何插件
 * （内置/第三方）都自动可展示。
 *
 * ── 不变量（破一条 ⇒ 用户就"打不开插件"）────────────────────────────────────
 *   ① 主视图 = 第一个**非 dynamic** 视图（dynamic 视图必须带参数 ⇒ 无参打开 = 空面板）；
 *   ② 全部都是 dynamic ⇒ 退回第一个（⛔ 不是静默失败）；无视图 ⇒ 空串（调用方回落）；
 *   ③ 深链格式与 web 侧 `parsePluginViewQuery` 严格对齐：
 *      `?xbot_view=<url-encoded>&xbot_view_title=<url-encoded>`；
 *   ④ `base` 尾斜杠归一化（⛔ 否则出现 `//?xbot_view`）；空 base/空 viewId ⇒ 空串。
 */
declare const process: { exit: (c: number) => void };

import { pluginViewDeepLink, primaryViewId, PluginViewItem } from '../../entry/src/main/ets/core/pluginhost';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 造一个 view 贡献点（只填本判据关心的字段）。 */
function view(id: string, dynamic: boolean, title: string = ''): PluginViewItem {
  const v = new PluginViewItem();
  v.id = id;
  v.dynamic = dynamic;
  v.title = title.length > 0 ? title : id;
  return v;
}

// ── ① 主视图选择（真实载荷：git-fancy = panel + commit(dynamic)；ssh-runner = panel + bar）──
eq('空列表 ⇒ 空串', primaryViewId([]), '');
eq('null ⇒ 空串（不崩）', primaryViewId(null as unknown as PluginViewItem[]), '');
eq('跳过 dynamic（git-fancy 真实形态）',
  primaryViewId([view('xbot.git-fancy.panel', false), view('xbot.git-fancy.commit', true)]),
  'xbot.git-fancy.panel');
eq('dynamic 在前也跳过',
  primaryViewId([view('a.commit', true), view('a.panel', false)]), 'a.panel');
eq('多非 dynamic ⇒ 取第一个（ssh-runner 真实形态）',
  primaryViewId([view('xbot.ssh-runner.panel', false), view('xbot.ssh-runner.bar', false)]),
  'xbot.ssh-runner.panel');
eq('id 为空的行跳过', primaryViewId([view('', false), view('ok.panel', false)]), 'ok.panel');
// ② 全部 dynamic ⇒ 退回第一个（至少试一次；⛔ 不静默什么都不做）
eq('全部 dynamic ⇒ 退回第一个', primaryViewId([view('a.one', true), view('a.two', true)]), 'a.one');

// ── ③④ 深链 ────────────────────────────────────────────────────────────────
eq('标准深链',
  pluginViewDeepLink('http://127.0.0.1:8082', 'xbot.git-fancy.panel', 'Git'),
  'http://127.0.0.1:8082/?xbot_view=xbot.git-fancy.panel&xbot_view_title=Git');
eq('尾斜杠归一化（⛔ 不出现 //?）',
  pluginViewDeepLink('http://127.0.0.1:8082/', 'a.panel', 'A'),
  'http://127.0.0.1:8082/?xbot_view=a.panel&xbot_view_title=A');
eq('多重尾斜杠也归一化',
  pluginViewDeepLink('http://h:1///', 'a.panel', 'A'),
  'http://h:1/?xbot_view=a.panel&xbot_view_title=A');
// 中文标题必须 encode（否则部分 WebView 会把原始中文当非法 URL 字符）
eq('中文标题被 URL 编码',
  pluginViewDeepLink('http://h', 'a.panel', '中文 标题'),
  `http://h/?xbot_view=a.panel&xbot_view_title=${encodeURIComponent('中文 标题')}`);
// 视图 id 含点号必须原样保留（encodeURIComponent 不转义 `.`）
eq('视图 id 点号原样', pluginViewDeepLink('http://h', 'xbot.git-fancy.panel', 'x').indexOf('xbot.git-fancy.panel') > 0, true);
eq('空 base ⇒ 空串（调用方不得当 URL 用）', pluginViewDeepLink('', 'a.panel', 'A'), '');
eq('空 viewId ⇒ 空串', pluginViewDeepLink('http://h', '', 'A'), '');
// 深链的 query 必须只带视图身份，不带 token/path 等噪声（原生侧另带 cookie 鉴权）
eq('深链只两个参数',
  pluginViewDeepLink('http://h', 'a.panel', 'A').split('?')[1].split('&').length, 2);

if (fail > 0) { console.log(`  plugin_view_link: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  plugin_view_link: ${pass} passed, 0 failed`);
process.exit(0);
