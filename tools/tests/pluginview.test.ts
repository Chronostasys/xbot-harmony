/**
 * 插件三个面的**展示判据**（`core/pluginview.ets`）的判别力测试。
 *
 * 为什么必须有：这三个面（`PluginHost`/`PluginWidgets`/`WebSurface`）此前把"该不该显示 /
 * 怎么夹取 / 文案怎么拼"**写在组件 `build()` 里** ⇒ 组件不进离线 harness ⇒ **不可测**
 * （`docs/REDESIGN.md §11` 铁律：判据必须住 `core/`）。本文件把每条判据钉住。
 *
 * ⚠️ 判别力自证（见交付）：把 `pluginStateBadge` 的 active 判删掉 ⇒ ★A 红；
 *    把 `widgetPercent` 的夹取删掉 ⇒ ★B 红；把 `widgetDeltaRole` 的正负判反过来 ⇒ ★C 红；
 *    把 `webStatusOf` 的 error 分支删掉 ⇒ ★D 红；把产物角色改成非法（如 `statusWaiting`）⇒ ★E 红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  PLUGIN_STATE_ACTIVE, PLUGIN_STATE_ERROR, WIDGET_UNSUPPORTED_LABEL, WEB_PHASE_ERROR, WEB_PHASE_IDLE, WEB_PHASE_LOADING,
  WEB_PHASE_READY,
  PluginBadge, WebStatus,
  pluginCatalogEmptyNotice, pluginCatalogSummaryText, pluginViewBadge, pluginStateBadge,
  pluginViewCountText, webErrorDetail, webStatusOf, widgetDegradeDetail, widgetDeltaRole, widgetLabel,
  widgetPercent,
  PANEL_STATE_EMPTY, PANEL_STATE_ERROR, PANEL_STATE_LOADING, PANEL_STATE_NONE,
  pluginPanelEmptyText, pluginPanelErrorText, pluginPanelStatus, pluginMetaText,
  webHttpErrorDetail,
  PANEL_ENTRY_ROW_H, PANEL_FIXED_ENTRY_ROWS, PANEL_LIST_MAX_H, PANEL_LIST_MIN_H, PANEL_PLUGIN_ROW_H,
  PANEL_SECTION_HEADER_H,
  pluginPanelListHeight,
} from '../../entry/src/main/ets/core/pluginview';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── ★A 插件状态徽标 ────────────────────────────────────────────────────────────
{
  const active: PluginBadge = pluginStateBadge(PLUGIN_STATE_ACTIVE);
  eq('★A active ⇒ 不显示（成功要安静）', active.show, false);
  eq('★A 空 state ⇒ 不显示', pluginStateBadge('').show, false);
  eq('★A 空白 state ⇒ 不显示（trim）', pluginStateBadge('   ').show, false);
  const dis: PluginBadge = pluginStateBadge('disabled');
  eq('★A 非 active ⇒ 显示', dis.show, true);
  eq('★A 非 active 文案 = state 原文（不自造中文）', dis.text, 'disabled');
  eq('★A 非 active 语气中性', dis.colorRole, 'textSecondary');
  eq('★A 未知 state 原样暴露（不静默吞）', pluginStateBadge('weird-state').text, 'weird-state');
  eq('★A state 去空白', pluginStateBadge('  inactive ').text, 'inactive');
  // ⚠️ 2026-10-12（用户拍板「加载失败的不管，ui 给个提示就行」）：`error` 是**已知档** ⇒ 中文提示。
  //    判别力：去掉 `PLUGIN_STATE_ERROR` 分支 ⇒ 前两条立刻红（会退回英文原文 + 中性色）。
  const err: PluginBadge = pluginStateBadge(PLUGIN_STATE_ERROR);
  eq('★A error ⇒ 显示', err.show, true);
  eq('★A error ⇒ 中文提示（不给用户看英文 token）', err.text, '未启动');
  eq('★A error ⇒ 语气 = dangerText（失败要显眼）', err.colorRole, 'dangerText');
  eq('★A error 带空白也识别（trim）', pluginStateBadge(' error ').text, '未启动');
  eq('★A meta 行拼装：v1.0.0 · 未启动', pluginMetaText('1.0.0', PLUGIN_STATE_ERROR), 'v1.0.0 · 未启动');
  eq('★A meta 行 active 不带状态后缀', pluginMetaText('1.0.0', PLUGIN_STATE_ACTIVE), 'v1.0.0');
}

// ── 视图「按需」徽标 / 计数 ────────────────────────────────────────────────────
eq('dynamic ⇒ 显示「按需」', [pluginViewBadge(true).show, pluginViewBadge(true).text], [true, '按需']);
eq('非 dynamic ⇒ 不显示', pluginViewBadge(false).show, false);
eq('视图数文案', pluginViewCountText(3), '3 个视图');
eq('视图数 0', pluginViewCountText(0), '0 个视图');
eq('视图数坏值夹 0', pluginViewCountText(-5), '0 个视图');
eq('目录概览标题', pluginCatalogSummaryText(4), '插件目录（4）');
eq('目录概览标题坏值', pluginCatalogSummaryText(NaN), '插件目录（0）');
ok('空态文案非空（不静默）', pluginCatalogEmptyNotice().length > 0);

// ── ★B widget 百分比夹取 ───────────────────────────────────────────────────────
eq('★B 正常比例', widgetPercent(50, 200), 25);
eq('★B >100% 夹到 100', widgetPercent(999, 100), 100);
eq('★B 负值夹到 0', widgetPercent(-3, 100), 0);
eq('★B max≤0 ⇒ 视作 100', widgetPercent(50, 0), 50);
eq('★B value=NaN ⇒ 0', widgetPercent(NaN, 100), 0);
eq('★B max=NaN ⇒ 视作 100', widgetPercent(25, NaN), 25);
eq('★B value=Infinity ⇒ 0（非有限与 NaN 同档）', widgetPercent(Infinity, 100), 0);

// ── ★C metric delta 正负 ───────────────────────────────────────────────────────
eq('★C 空 delta ⇒ textMuted', widgetDeltaRole(''), 'textMuted');
eq('★C "-N" ⇒ dangerText', widgetDeltaRole('-3'), 'dangerText');
eq('★C "+N"/"N" ⇒ successText', widgetDeltaRole('+3'), 'successText');
eq('★C "3" ⇒ successText', widgetDeltaRole('3'), 'successText');

// ── widget 标题回落 / 降级行拼接 ───────────────────────────────────────────────
eq('有 title 用 title', widgetLabel('标题', 'w.id'), '标题');
eq('无 title 回落 widget_id', widgetLabel('', 'w.id'), 'w.id');
eq('都空 ⇒ 空串（调用方不画）', widgetLabel('', ''), '');
eq('降级行 kind · reason', widgetDegradeDetail('unsupported', '原生未实现'), 'unsupported · 原生未实现');
eq('降级行 仅 reason', widgetDegradeDetail('', '缺 component.type'), '缺 component.type');
eq('降级行 仅 kind', widgetDegradeDetail('unsupported', ''), 'unsupported');
eq('降级行 都空 ⇒ 空串', widgetDegradeDetail('', ''), '');
ok('降级前缀固定（可见、绝不静默）', WIDGET_UNSUPPORTED_LABEL === '暂不支持');

// ── ★D 承载面 加载 / 就绪 / 失败 三态条 ───────────────────────────────────────
{
  eq('★D idle ⇒ 不显示', webStatusOf(WEB_PHASE_IDLE, '').show, false);
  eq('★D ready ⇒ 不显示', webStatusOf(WEB_PHASE_READY, '').show, false);
  const load: WebStatus = webStatusOf(WEB_PHASE_LOADING, '');
  eq('★D loading ⇒ 显示「正在加载…」', [load.show, load.text], [true, '正在加载…']);
  eq('★D loading 不可重试 + 中性色', [load.canRetry, load.colorRole], [false, 'textMuted']);
  const errNoDetail: WebStatus = webStatusOf(WEB_PHASE_ERROR, '');
  eq('★D error 无原因 ⇒ 「加载失败」', [errNoDetail.show, errNoDetail.text], [true, '加载失败']);
  eq('★D error 可重试 + 危险色', [errNoDetail.canRetry, errNoDetail.colorRole], [true, 'dangerText']);
  const errWith: WebStatus = webStatusOf(WEB_PHASE_ERROR, 'net::ERR_CONNECTION_REFUSED');
  ok('★D error 带内核原因', errWith.text.indexOf('ERR_CONNECTION_REFUSED') >= 0);
  eq('★D 未知 phase ⇒ 不显示（安全兜底）', webStatusOf('zzz', '').show, false);
}

// ── ★D2 内核错误明细（`webErrorDetail`）────────────────────────────────────────
eq('★D2 有 info 用 info', webErrorDetail('net::ERR_CONNECTION_REFUSED', -2), 'net::ERR_CONNECTION_REFUSED');
eq('★D2 无 info 有 code ⇒ 错误码', webErrorDetail('', -6), '错误码 -6');
eq('★D2 都无 ⇒ 空串', webErrorDetail('', 0), '');
eq('★D2 info 去空白', webErrorDetail('  oops  ', 0), 'oops');

// ── ★E 产物角色必须都在 colorOf 合法集合内（防"未知 role ⇒ 静默 transparent"陷阱）──
//    唯一合法来源：`core/design.ets:colorOf` 的解析表（`docs/DESIGN-SYSTEM.md §12.2`）。
{
  const LEGAL: string[] = ['textSecondary', 'dangerText', 'textMuted', 'successText'];
  const produced: string[] = [
    pluginStateBadge('disabled').colorRole,
    pluginStateBadge('active').colorRole,
    pluginViewBadge(true).colorRole,
    widgetDeltaRole(''), widgetDeltaRole('-1'), widgetDeltaRole('1'),
    webStatusOf(WEB_PHASE_LOADING, '').colorRole,
    webStatusOf(WEB_PHASE_ERROR, '').colorRole,
  ];
  let clean = true;
  for (let i = 0; i < produced.length; i++) {
    if (LEGAL.indexOf(produced[i]) < 0) { clean = false; }
  }
  ok('★E 产出的 colorRole 全在合法集合（否则运行时静默 transparent）', clean);
  // ⛔ 反向钉死：状态"标记/点色"绝不能当正文色（浅底仅 1.7–2.1:1，读不出）。
  let noDotColors = true;
  for (let i = 0; i < produced.length; i++) {
    const r: string = produced[i];
    if (r === 'statusWaiting' || r === 'statusRunning' || r === 'statusIdle' || r === 'statusError') {
      noDotColors = false;
    }
  }
  ok('★E 绝不产出状态标记/点色当正文', noDotColors);
}

// ── ★F 能力面板三态（加载 / 空 / 失败）＋行元信息（`components/PluginsSheet.ets` 的判据源）──
// 背景：旧实现"关抽屉 → await RPC → 才显示面板"（慢网零反馈），且数据层把错误吞成空目录
//       ⇒ 面板分不清"空"与"失败"。此处钉住三态选择与可重试性。
{
  // 加载中：显示 / textMuted / **不可重试**（静态一行字，不是 spinner）
  const loading = pluginPanelStatus(true, 0, 0, '');
  eq('★F 加载中：显示', loading.show, true);
  eq('★F 加载中：state=loading', loading.state, PANEL_STATE_LOADING);
  eq('★F 加载中：textMuted', loading.colorRole, 'textMuted');
  eq('★F 加载中：不可重试', loading.canRetry, false);
  eq('★F 加载中：文案非空', loading.text.length > 0, true);

  // 失败：dangerText + **可重试** + 带上可读原因（调用方已 readableRpcError）
  const err = pluginPanelStatus(false, 0, 0, '连接超时');
  eq('★F 失败：显示', err.show, true);
  eq('★F 失败：state=error', err.state, PANEL_STATE_ERROR);
  eq('★F 失败：dangerText', err.colorRole, 'dangerText');
  eq('★F 失败：可重试', err.canRetry, true);
  eq('★F 失败：文案含可读原因', err.text, '插件目录加载失败：连接超时');
  eq('★F 失败：空/空白原因 ⇒ 不留悬空冒号', pluginPanelErrorText('   '), '插件目录加载失败');
  eq('★F 失败：去首尾空白', pluginPanelErrorText('  x  '), '插件目录加载失败：x');

  // 失败优先于加载（正在重试中又失败 ⇒ 显示失败，不给"两个按钮"的歧义）
  eq('★F 失败 > 加载（优先级）', pluginPanelStatus(true, 0, 0, 'boom').state, PANEL_STATE_ERROR);

  // 空：仅当 items 与 groups **都**空；不可重试（空不是错误）
  const empty = pluginPanelStatus(false, 0, 0, '');
  eq('★F 空：显示', empty.show, true);
  eq('★F 空：state=empty', empty.state, PANEL_STATE_EMPTY);
  eq('★F 空：不可重试（不是错误）', empty.canRetry, false);
  eq('★F 空：有引导文案', empty.text.length > 0, true);
  eq('★F 空：文案 = pluginPanelEmptyText', empty.text, pluginPanelEmptyText());

  // 有数据 ⇒ 无状态行
  const ready = pluginPanelStatus(false, 3, 0, '');
  eq('★F 有插件：state=none', ready.state, PANEL_STATE_NONE);
  eq('★F 有插件：不显示状态行', ready.show, false);
  // groups 参与空态判据（有视图无插件也算有数据）
  eq('★F 有视图无插件：不算空', pluginPanelStatus(false, 0, 2, '').state, PANEL_STATE_NONE);
  // 负/NaN 计数不得被当成有数据
  eq('★F 负计数 ⇒ 空', pluginPanelStatus(false, -1, 0, '').state, PANEL_STATE_EMPTY);
  eq('★F NaN 计数 ⇒ 空', pluginPanelStatus(false, NaN as unknown as number, 0, '').state, PANEL_STATE_EMPTY);

  // 行元信息：`v<版本>` + 非 active 状态（active 要安静，不显示）
  eq('★F 元信息：版本 + 非 active', pluginMetaText('1.2.0', 'disabled'), 'v1.2.0 · disabled');
  eq('★F 元信息：仅版本（active 不显示）', pluginMetaText('1.0.0', 'active'), 'v1.0.0');
  eq('★F 元信息：仅状态', pluginMetaText('', 'disabled'), 'disabled');
  eq('★F 元信息：空白版本 + active ⇒ 空串（调用方不画）', pluginMetaText('   ', 'active'), '');

  // 角色合法性（★E 同款防线：非法 role ⇒ 运行时 colorOf 静默 transparent）
  const produced = [loading.colorRole, err.colorRole, empty.colorRole, ready.colorRole];
  const allowed = ['textSecondary', 'textMuted', 'dangerText', 'accentSoft', 'successText', 'warn'];
  let clean = true;
  for (let i = 0; i < produced.length; i++) {
    if (allowed.indexOf(produced[i]) < 0) { clean = false; }
  }
  ok('★F 三态产出的 colorRole 全在合法集合', clean);
  // ⛔ 反向钉死：状态"标记/点色"绝不能当正文色。
  let noDot = true;
  for (let i = 0; i < produced.length; i++) {
    const r: string = produced[i];
    if (r === 'statusWaiting' || r === 'statusRunning' || r === 'statusIdle' || r === 'statusError') {
      noDot = false;
    }
  }
  ok('★F 绝不产出状态标记/点色当正文', noDot);
}

// ── ★G HTTP 层错误明细（`WebSurface.onHttpErrorReceive`；补齐 404/401/5xx 的解释）──────
{
  eq('★G 状态码 + 原因', webHttpErrorDetail(404, 'Not Found'), 'HTTP 404 Not Found');
  eq('★G 仅状态码', webHttpErrorDetail(500, ''), 'HTTP 500');
  eq('★G 状态码 + 空白原因 ⇒ 仅状态码', webHttpErrorDetail(401, '   '), 'HTTP 401');
  eq('★G 无状态码 + 有原因 ⇒ 原样原因', webHttpErrorDetail(0, 'net::ERR_CONNECTION_REFUSED'),
    'net::ERR_CONNECTION_REFUSED');
  eq('★G 都没有 ⇒ 空串（调用方落回「加载失败」）', webHttpErrorDetail(0, ''), '');
  eq('★G NaN 状态码不产出 "HTTP NaN"', webHttpErrorDetail(NaN, ''), '');
  // 与 webStatusOf 串起来：error 档 ⇒ 红字 + 可重试（承载面状态条的最终形态）
  const st = webStatusOf(WEB_PHASE_ERROR, webHttpErrorDetail(404, 'Not Found'));
  eq('★G 错误条显示 + 文案前缀', st.show, true);
  eq('★G 文案 = 加载失败：HTTP 404 Not Found', st.text, '加载失败：HTTP 404 Not Found');
  eq('★G 可重试', st.canRetry, true);
  eq('★G 色角色 = dangerText', st.colorRole, 'dangerText');
}

// ── ★H 能力面板「列表高度」（`pluginPanelListHeight`；真机缺陷：硬编码 320 会裁掉靠后的插件行）──
{
  // 回归钉（**本用例存在的理由**）：后端当时 4 个插件 ⇒ 旧硬编码 320 把第 4 个
  // （`xbot.ssh-runner`）整条裁掉（真机 dump 侧证：其两行文本**完全不在**可见区）。
  const h4: number = pluginPanelListHeight(PANEL_FIXED_ENTRY_ROWS, 4, 0);
  ok('★H 4 个插件时列表高度**必须大于**旧硬编码 320（否则靠后的插件行被裁）', h4 > 320);
  // 且要真的装得下（未触上限时，估计高度 ≥ 行数 × 行高估值）
  // ⚠️ §21.115：有插件时**再加分组头**（`PANEL_SECTION_HEADER_H`，与组件 `if (plugins.length>0)` 同源）。
  eq('★H 未触上限 ⇒ 恰为 N×入口行 + M×插件行 + 分组头',
    h4, PANEL_FIXED_ENTRY_ROWS * PANEL_ENTRY_ROW_H + 4 * PANEL_PLUGIN_ROW_H + PANEL_SECTION_HEADER_H);
  ok('★H 该高度 ≥ 各行估值之和（装得下，不裁行）',
    h4 >= PANEL_FIXED_ENTRY_ROWS * PANEL_ENTRY_ROW_H + 4 * PANEL_PLUGIN_ROW_H + PANEL_SECTION_HEADER_H);

  // 下限：行少/零行 ⇒ 不缩水（保持现状观感）
  eq('★H 零行 ⇒ 下限', pluginPanelListHeight(0, 0, 0), PANEL_LIST_MIN_H);
  eq('★H 仅 3 条固定入口 ⇒ 下限（198 < 320）', pluginPanelListHeight(3, 0, 0), PANEL_LIST_MIN_H);
  eq('★H ⛔ 无插件 ⇒ **不计**分组头（与组件条件渲染同源）',
    pluginPanelListHeight(3, 0, 1), PANEL_LIST_MIN_H);

  // 上限：行多 ⇒ 到顶后表内滚动（卡片不再长高）
  eq('★H 100 个插件 ⇒ 上限', pluginPanelListHeight(3, 100, 0), PANEL_LIST_MAX_H);
  eq('★H 状态行/重试行也计入（各 1 行入口高 + 分组头）', pluginPanelListHeight(3, 2, 2),
    3 * PANEL_ENTRY_ROW_H + 2 * PANEL_PLUGIN_ROW_H + 2 * PANEL_ENTRY_ROW_H + PANEL_SECTION_HEADER_H);

  // 单调性：插件越多**绝不更矮**（否则"加插件反而看不见"）
  let mono = true;
  let prev: number = pluginPanelListHeight(3, 0, 0);
  for (let n = 1; n <= 40; n++) {
    const cur: number = pluginPanelListHeight(3, n, 0);
    if (cur < prev) { mono = false; }
    prev = cur;
  }
  ok('★H 单调不减（0→40 个插件）', mono);

  // 上下限自洽 + 防御怪值（NaN/负数/Infinity ⇒ 按 0 计，不产出 NaN 高度）
  ok('★H MAX ≥ MIN', PANEL_LIST_MAX_H >= PANEL_LIST_MIN_H);
  eq('★H NaN 计数 ⇒ 下限（不产出 NaN）', pluginPanelListHeight(NaN, NaN, NaN), PANEL_LIST_MIN_H);
  eq('★H 负数计数 ⇒ 下限', pluginPanelListHeight(3, -5, -1), PANEL_LIST_MIN_H);
  eq('★H Infinity 计数 ⇒ 下限（非有限数按 0 计，语义与注释一致）',
    pluginPanelListHeight(3, Infinity, 0), PANEL_LIST_MIN_H);
}

// ── ★I 组件**必须消费**该判据（否则"判据绿、面板仍裁行"＝假绿）────────────────────────
{
  const fs = require('fs');
  const path = require('path');
  // ⛔ `run-one.sh` 把测试编译到 `.out.$$/js/` 下再跑 ⇒ `__dirname` 不是 `tools/tests/`；
  //    必须**向上查找仓库根**（含 `entry/src/main/ets`）。
  let root: string = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(root, 'entry', 'src', 'main', 'ets'))) { break; }
    root = path.join(root, '..');
  }
  const sheetPath: string = path.join(root, 'entry', 'src', 'main', 'ets', 'components', 'PluginsSheet.ets');
  const raw: string = fs.existsSync(sheetPath) ? fs.readFileSync(sheetPath, 'utf-8') : '';
  const sheetSrc: string = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const consumers: number = (sheetSrc.match(/pluginPanelListHeight\(/g) || []).length;

  ok('★I 零扫描防线：读到 PluginsSheet 源码', sheetSrc.length > 1000);
  ok('★I 面板**消费**判据（调用点 ≥ 1；钉"方法体存在"会假绿）', consumers >= 1);
  ok('★I ⛔ 不得再出现硬编码 `.height(320)`（正是会裁行的旧缺陷）', sheetSrc.indexOf('.height(320)') < 0);
}

console.log(`\npluginview.test.ts: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
