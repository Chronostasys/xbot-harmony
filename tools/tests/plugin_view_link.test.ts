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

import { nativeViewKind, parseXbotViewLink, pluginViewDeepLink, primaryViewId, PluginViewItem, WEB_PANEL_IDS, webPanelDeepLink, webPanelTitle } from '../../entry/src/main/ets/core/pluginhost';

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

// ── ⑤ 拦截协议：parseXbotViewLink（深链**解析端**，与 pluginViewDeepLink 同协议两端）──
//   协议：web 插件 `ctx.ui.openViewTab` 打开视图 ⇒ 宿主页导航到 `?xbot_view=<viewId>` 深链
//   ⇒ 原生端 `onLoadIntercept` 解析这条深链、路由到原生面板（见 nativeViewKind）。
{
  const l1 = parseXbotViewLink('http://127.0.0.1:8082/?xbot_view=xbot.git-fancy.panel&xbot_view_title=Git');
  eq('解析标准深链 → viewId', l1 !== null ? l1.viewId : '', 'xbot.git-fancy.panel');
  eq('解析标准深链 → title', l1 !== null ? l1.title : '', 'Git');
  eq('标题 URL 解码', parseXbotViewLink('http://h/?xbot_view=a.panel&xbot_view_title=%E4%B8%AD%E6%96%87') !== null
    ? (parseXbotViewLink('http://h/?xbot_view=a.panel&xbot_view_title=%E4%B8%AD%E6%96%87') as { title: string }).title : '', '中文');
  eq('无 query ⇒ null', parseXbotViewLink('http://h/') === null, true);
  eq('无 xbot_view ⇒ null', parseXbotViewLink('http://h/?foo=1') === null, true);
  eq('xbot_view 空值 ⇒ null', parseXbotViewLink('http://h/?xbot_view=&xbot_view_title=A') === null, true);
  const rt = parseXbotViewLink(pluginViewDeepLink('http://h', 'xbot.git-fancy.panel', 'Git 面板'));
  eq('round-trip：生成→解析还原 viewId', rt !== null ? rt.viewId : '', 'xbot.git-fancy.panel');
  eq('round-trip：还原中文 title', rt !== null ? rt.title : '', 'Git 面板');

  // ── xbot_view_params（web `openViewTab({ params })` 序列化进深链；git commit 的 `{ hash }`）──
  const pc = parseXbotViewLink('http://h/?xbot_view=xbot.git-fancy.commit&xbot_view_title=C&xbot_view_params='
    + encodeURIComponent('{"hash":"abc123"}'));
  eq('解析 xbot_view_params → hash', pc !== null ? (pc.params['hash'] || '') : '', 'abc123');
  const pn = parseXbotViewLink('http://h/?xbot_view=a.panel');
  eq('无 xbot_view_params ⇒ 空参数对象', pn !== null ? Object.keys(pn.params).length : -1, 0);
  const pb = parseXbotViewLink('http://h/?xbot_view=a.panel&xbot_view_params=%7Bnot-json');
  eq('坏 JSON params ⇒ 空参数对象（不崩）', pb !== null ? Object.keys(pb.params).length : -1, 0);
}

// ── ⑥ 原生落地注册表 nativeViewKind（可扩展；空 = 放行 WebView 兜底）──────────────
eq('git-fancy panel ⇒ git.panel', nativeViewKind('xbot.git-fancy.panel'), 'git.panel');
eq('git-fancy commit ⇒ git.commit', nativeViewKind('xbot.git-fancy.commit'), 'git.commit');
// ⚠️ §21.117：`xbot.ssh-runner.panel` **已**原生化（`SshRunnerSheet`）⇒ 期望值从 `''` 改为
//    `'ssh.panel'`（此前无原生落地 ⇒ 点开会落到**整个 web 宿主页**，正是用户否掉的形态）。
eq('ssh-runner panel ⇒ 原生面板（§21.117 已落地；此前为 "" = 放行整个 WebView）',
  nativeViewKind('xbot.ssh-runner.panel'), 'ssh.panel');
// 信息栏视图（`xbot.ssh-runner.bar`）落**同一个**原生面板（其目标切换行就是该徽章的入口）。
eq('ssh-runner bar ⇒ 同一原生面板', nativeViewKind('xbot.ssh-runner.bar'), 'ssh.panel');
eq('未来插件 ⇒ 空（协议仍通用，不写死）', nativeViewKind('xbot.future-plugin.panel'), '');
eq('空 viewId ⇒ 空', nativeViewKind(''), '');

// ── ⑥b §21.122c：宿主**直达 web 内置面板**深链（`?xbot_panel=<id>`）────────────────
// 为什么值得钉：这条 URL 是原生壳打开 **web 自己的**文件/搜索/信息/任务/终端面板的**唯一**入口
// （用户定向：渲染 web 自己的面板，⛔ 不再每个能力写一套原生实现）。
// ⛔ id 白名单必须与 web 侧 `web/src/workspace/panelRequest.ts:PANEL_DEEP_LINK_IDS` **逐字一致**
//    —— 不一致的后果是"点了没反应"（web 端白名单外直接忽略）。
eq('web 面板 id 白名单与 web 侧逐字一致（5 个）',
  JSON.stringify(WEB_PANEL_IDS), JSON.stringify(['files', 'search', 'info', 'tasks', 'terminal']));
eq('文件面板深链（恒带 embed=1 ⇒ web 只渲面板本体，chrome 由原生提供）',
  webPanelDeepLink('http://h:8082', 'files'), 'http://h:8082/?xbot_panel=files&xbot_embed=1');
eq('终端面板深链', webPanelDeepLink('http://h:8082', 'terminal'),
  'http://h:8082/?xbot_panel=terminal&xbot_embed=1');
eq('尾斜杠归一化（⛔ 不出现 //?xbot_panel）',
  webPanelDeepLink('http://h:8082/', 'tasks'), 'http://h:8082/?xbot_panel=tasks&xbot_embed=1');
eq('多个尾斜杠同样归一化', webPanelDeepLink('http://h:8082///', 'info'),
  'http://h:8082/?xbot_panel=info&xbot_embed=1');
// ⛔ 用户原话「嵌套 webview 不要做多余的渲染」：embed 参数是"去掉整壳"的**唯一**开关
// ⇒ 它从 URL 里消失 = 真机上又会出现"两层 chrome"套娃（web 自己的 `← 工具` 头 + 页签行回潮）。
// 这条断言就是那个回归的哨兵（web 侧消费点：`workspace/panelRequest.ts:parseEmbedQuery`）。
eq('⛔ embed 参数不可丢（丢了就回潮两层 chrome）',
  webPanelDeepLink('http://h:8082', 'files').indexOf('xbot_embed=1') > 0, true);
eq('⛔ 白名单外 ⇒ 空串（fail-closed：不把用户丢进 web 会忽略参数的空白页）',
  webPanelDeepLink('http://h:8082', 'nope'), '');
eq('⛔ 插件视图 id 不是面板 id（两条协议互不替代）',
  webPanelDeepLink('http://h:8082', 'xbot.git-fancy.panel'), '');
eq('空 base ⇒ 空串', webPanelDeepLink('', 'files'), '');
eq('空 id ⇒ 空串', webPanelDeepLink('http://h:8082', ''), '');
eq('标题：终端', webPanelTitle('terminal'), '终端');
eq('标题：文件', webPanelTitle('files'), '文件');
eq('标题：未知 id ⇒ 空串（调用方兜底文案）', webPanelTitle('nope'), '');

if (fail > 0) { console.log(`  plugin_view_link: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  plugin_view_link: ${pass} passed, 0 failed`);
process.exit(0);

export {};
