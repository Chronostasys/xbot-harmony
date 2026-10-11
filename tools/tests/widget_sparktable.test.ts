/**
 * 插件 widget · `sparkline` / `table` parity 收口判据（2026-10-11）。
 *
 * ── 权威基准（web，只读取证）──────────────────────────────────────────────────
 *   · `web/src/plugins/components.tsx:99-137` SparklineWidget：
 *     `data: number[]`（逐项 `num(v,0)`）、`color`（缺省 `#6366f1`）、`height`（`max(16,min(200,num(h,48)))`）、
 *     `type === 'bar' ? 柱 : 折线`；空数据 ⇒ 一行 `no data`；坐标系 `viewBox="0 0 100 height"`
 *     + `preserveAspectRatio="none"`；折线 = `polygon`(面积, opacity 0.1) + `polyline`(strokeWidth 2)；
 *     柱 = `rect`(opacity 0.75, `h=(v/max)*(height-8)`)。
 *   · `web/src/plugins/components.tsx:138-180` TableWidget：
 *     `columns: string[]`、`rows: Record[]`、`max_height`（`max(60,num(h,260))`）；
 *     `columns` 空 ⇒ `return null`（**整表不渲染**）；单元格对象 ⇒ tone chip，否则 `String(cell ?? '')`。
 *
 * ── 本轮修掉的**真实缺口**（非凑数）───────────────────────────────────────────
 *   原生此前把这两种类型**显式降级**（`degradeReasonForType` 特判 + `SUPPORTED_KINDS` 只有 5 种）
 *   ⇒ 与 web 的 **7 种**声明式类型不对齐。本次落地：解析/归一/几何进 `core/widgetsview.ets`（纯逻辑），
 *   渲染进 `components/PluginWidgets.ets`（折线 `Shape+Polygon/Polyline`、柱 `Row`、表 `Scroll`）。
 *
 * ── 判据（⛔ 形态断言钉**调用点计数**，不钉"方法体存在"；零扫描判红）────────────
 *   ① 契约解析：逐字段对齐 web（强制 / 夹取 / 缺省）；
 *   ② 降级边界：空数据 ⇒ `sparkEmpty`（**仍可见**，非 `empty`）；空列 ⇒ `empty`（整表不渲染）；
 *      "web 有但原生没有"那一档**已消失**；
 *   ③ **渲染接线（核心防线）**：`components/PluginWidgets.ets` 里 `this.view.kind === KIND_SPARKLINE` /
 *      `=== KIND_TABLE` 的**分支计数 ≥1**（钉消费点），且两者**从 core import 的计数 ≥1**；
 *      `SPARK_VIEW_W` / `SPARK_EMPTY_LABEL` 消费点计数 ≥1（防"core 造了但渲染层没用"的孤岛）；
 *   ④ 零扫描判红：源文件读不到、或剥注释后 0 行 ⇒ **判红**（防"路径脱节 ⇒ 白绿"）；
 *   ⑤ mutation 自证（实测，见提交信息）：把渲染分支删掉 ⇒ ③ 必红；把 `degradeReasonForType` 的
 *      `sparkline` 特判加回 ⇒ ② 必红；把 `SUPPORTED_KINDS` 改回 5 种 ⇒ ② 必红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`tools/tests/run.sh` 用 `set -e` 且逐文件 node）。
 * ⚠️ 纯 TS（照 `plugin_icons.test.ts` 的 `export {}` + `declare require` 风格）。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };
declare const console: { log(...a: unknown[]): void };

import {
  KIND_SPARKLINE, KIND_TABLE, KIND_UNSUPPORTED,
  SPARK_DEFAULT_HEIGHT, SPARK_EMPTY_LABEL, SPARK_MAX_HEIGHT, SPARK_MIN_HEIGHT, SPARK_VIEW_W,
  SUPPORTED_KINDS, TABLE_DEFAULT_MAX_HEIGHT, TABLE_MIN_MAX_HEIGHT,
  WidgetCellView, WidgetComponentView, WidgetTableRowView, WidgetsView,
  degradeReasonForType, isSupportedKind, sparkAreaPoints, sparkBarHeights, sparkDataOf,
  sparkHeightOf, sparkLinePoints, sparkMaxOf, tableCellOf, tableColumnsOf, tableMaxHeightOf,
  tableRowsOf, widgetsView,
} from '../../entry/src/main/ets/core/widgetsview';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

/** 剥注释（块 + 行；照 `plugin_icons.test.ts`）—— ⛔ 必须先剥，否则注释里的名字会**假绿**。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n')
    .map((l: string) => l.replace(/\/\/.*$/, '')).join('\n');
}
/** 子串出现次数（判"调用点计数"用）。 */
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}
function findRoot(start: string): string {
  let cur: string = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(cur, 'entry', 'src', 'main', 'ets'))) { return cur; }
    cur = path.join(cur, '..');
  }
  return '';
}

const W = 'web_widgets';

// ══════════════════════════════════════════════════════════════════════════════
// ① 契约解析：sparkline
// ══════════════════════════════════════════════════════════════════════════════

// 数据强制（web `num(v,0)`：非数/非有限 ⇒ 0）
eq('sparkDataOf 逐项强制（数字/数字串/非数）', sparkDataOf({ data: [1, '2.5', 'x', true] }), [1, 2.5, 0, 0]);
eq('sparkDataOf 非数组 ⇒ 空', sparkDataOf({ data: 'nope' }), []);
eq('sparkDataOf props 缺省 ⇒ 空', sparkDataOf(undefined), []);

// max 至少 1（web `Math.max(...data, 1)`）——除零安全
eq('sparkMaxOf 空 ⇒ 1', sparkMaxOf([]), 1);
eq('sparkMaxOf 全 0 ⇒ 1', sparkMaxOf([0, 0]), 1);
eq('sparkMaxOf 取最大', sparkMaxOf([0, 7, 3]), 7);

// 画布高夹取（web `max(16,min(200,num(h,48)))`）
eq('sparkHeightOf 缺省 48', sparkHeightOf(undefined), SPARK_DEFAULT_HEIGHT);
eq('sparkHeightOf 下限 16', sparkHeightOf(1), SPARK_MIN_HEIGHT);
eq('sparkHeightOf 上限 200', sparkHeightOf(9999), SPARK_MAX_HEIGHT);
eq('sparkHeightOf 合法值原样', sparkHeightOf(64), 64);
eq('sparkHeightOf 数字串可解析', sparkHeightOf('72'), 72);

// 折线几何（web `:107`：`x=(i/(n-1))*100`，`y=h-4-(v/max)*(h-10)`）
{
  const pts: number[][] = sparkLinePoints([0, 10], 48);
  eq('折线 2 点：x 铺满 0..100', [pts[0][0], pts[1][0]], [0, SPARK_VIEW_W]);
  eq('折线 2 点：y 走满绘制带', [pts[0][1], pts[1][1]], [44, 6]);   // 48-4-0=44 / 48-4-38=6
}
{
  // ⚠️ **有意修正 web 的 `n===1` 除零 NaN**（web 单点会画出 NaN）⇒ 原生单点居中。
  const one: number[][] = sparkLinePoints([5], 48);
  eq('折线单点：计数 1', one.length, 1);
  eq('折线单点：x 居中（web 此处是 NaN）', one[0][0], SPARK_VIEW_W / 2);
  eq('折线单点：y 合法有限', Number.isFinite(one[0][1]), true);
}
// 面积多边形（web `:124`：底线 + 折线 + 底线）
{
  const area: number[][] = sparkAreaPoints([[0, 10], [100, 20]], 48);
  eq('面积多边形 = 底线+点+底线', area, [[0, 46], [0, 10], [100, 20], [100, 46]]);
  eq('面积多边形：空折线 ⇒ 空', sparkAreaPoints([], 48), []);
}
// 柱高（web `:117`：`(v/max)*(height-8)`）
eq('柱高：按比例、值域 h-8', sparkBarHeights([0, 5, 10], 48), [0, 20, 40]);
eq('柱高：非有限/负值 ⇒ 0', sparkBarHeights([-3, 10], 48), [0, 40]);

// widgetsView 落点（含组件视图字段）
{
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    components: [{ widget_id: 's', slot: 'panel', component: { type: 'sparkline', props: { data: [1, 3, 2], height: 48 } } }],
  }));
  const c: WidgetComponentView = v.components.length === 1 ? v.components[0] : new WidgetComponentView();
  ok('sparkline 落点：组件计数 1（缺 ⇒ 后续断言必红，不崩）', v.components.length === 1);
  eq('sparkline ⇒ kind', c.kind, KIND_SPARKLINE);
  eq('sparkline ⇒ 非 bar（缺省折线）', c.sparkBar, false);
  eq('sparkline ⇒ 画布高', c.sparkHeight, 48);
  eq('sparkline ⇒ 有数据（非 empty-data）', c.sparkEmpty, false);
  eq('sparkline ⇒ 折线点数 = 数据点数', c.sparkPoints.length, 3);
  eq('sparkline ⇒ 面积点数 = 点数 + 2', c.sparkArea.length, 5);
  eq('sparkline ⇒ 柱高数 = 数据点数', c.sparkBars.length, 3);
  eq('sparkline ⇒ **算可见内容**（empty=false）', c.empty, false);
}
{
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    components: [{ widget_id: 'b', slot: 'panel', component: { type: 'sparkline', props: { data: [1, 2], type: 'bar' } } }],
  }));
  eq('sparkline type=bar ⇒ sparkBar', v.components[0].sparkBar, true);
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 降级边界：sparkline 空数据 / table 空列
// ══════════════════════════════════════════════════════════════════════════════
{
  // web `:106`：空数据 ⇒ 渲染 "no data"（**是可见内容**）⇒ 原生 sparkEmpty 但 **empty=false**。
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    components: [{ widget_id: 's0', slot: 'panel', component: { type: 'sparkline', props: { data: [] } } }],
  }));
  eq('空数据 sparkline ⇒ sparkEmpty', v.components[0].sparkEmpty, true);
  eq('空数据 sparkline ⇒ reason 空（不是降级）', v.components[0].reason.length, 0);
  eq('空数据 sparkline ⇒ 仍算可见内容（web 也渲染 "no data"）', v.components[0].empty, false);
  eq('空数据 sparkline ⇒ 无点/无柱', [v.components[0].sparkPoints.length, v.components[0].sparkBars.length], [0, 0]);
  eq('空数据文案非空（渲染层直接用）', SPARK_EMPTY_LABEL.length > 0, true);
  // 反例（防"恒 true"的假绿）
  const v2: WidgetsView = widgetsView(W, JSON.stringify({
    components: [{ widget_id: 's1', slot: 'panel', component: { type: 'sparkline', props: { data: [1] } } }],
  }));
  eq('反例：有 1 个数据 ⇒ sparkEmpty=false', v2.components[0].sparkEmpty, false);
}

// table 列 / 行解析
eq('tableColumnsOf 只认字符串（数字列 ⇒ 空串）', tableColumnsOf({ columns: ['a', 1, 'b'] }), ['a', '', 'b']);
eq('tableColumnsOf 非数组 ⇒ 空', tableColumnsOf({ columns: 'x' }), []);
eq('tableMaxHeightOf 缺省 260', tableMaxHeightOf(undefined), TABLE_DEFAULT_MAX_HEIGHT);
eq('tableMaxHeightOf 下限 60', tableMaxHeightOf(1), TABLE_MIN_MAX_HEIGHT);
eq('tableMaxHeightOf 合法值原样', tableMaxHeightOf(300), 300);
{
  const cols: string[] = ['id', 'status'];
  const propObj: Record<string, Object> = {
    columns: cols,
    rows: [
      { id: '#128', status: { text: '✓', tone: 'success' } },
      { id: '#127' },   // 缺 status 列 ⇒ 空单元格（web `row[c]` ⇒ undefined ⇒ ''）
    ],
  };
  const rows: WidgetTableRowView[] = tableRowsOf(propObj, cols);
  eq('tableRowsOf 行数', rows.length, 2);
  eq('tableRowsOf 每行宽 = 列数', [rows[0].cells.length, rows[1].cells.length], [2, 2]);
  eq('普通单元 ⇒ 纯文本', [rows[0].cells[0].badge, rows[0].cells[0].text], [false, '#128']);
  eq('对象单元 ⇒ 徽标（text/tone）', [rows[0].cells[1].badge, rows[0].cells[1].text, rows[0].cells[1].tone], [true, '✓', 'success']);
  eq('缺列 ⇒ 空文本、非徽标', [rows[1].cells[1].badge, rows[1].cells[1].text], [false, '']);
  eq('空列 ⇒ 不产行（web `return null`）', tableRowsOf(propObj, []).length, 0);
}
// 单元格强制（web `renderCell`）
{
  const cNum: WidgetCellView = tableCellOf(7);
  eq('数字单元 ⇒ String(7) 纯文本', [cNum.badge, cNum.text], [false, '7']);
  const cBool: WidgetCellView = tableCellOf(true);
  eq('布尔单元 ⇒ "true" 纯文本', [cBool.badge, cBool.text], [false, 'true']);
  const cNull: WidgetCellView = tableCellOf(null);
  eq('null 单元 ⇒ 空文本', [cNull.badge, cNull.text], [false, '']);
  const cUndef: WidgetCellView = tableCellOf(undefined);
  eq('undefined 单元 ⇒ 空文本', [cUndef.badge, cUndef.text], [false, '']);
  const cObj: WidgetCellView = tableCellOf({ text: 'ok', tone: 'warning' });
  eq('对象单元 tone 缺省回落 normal', tableCellOf({ text: 'x' }).tone, 'normal');
  eq('对象单元 tone 保留', cObj.tone, 'warning');
}
// widgetsView 落点
{
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    components: [{
      widget_id: 't1', slot: 'panel',
      component: { type: 'table', props: { columns: ['a', 'b'], rows: [{ a: '1', b: '2' }], max_height: 300 } },
    }],
  }));
  const c: WidgetComponentView = v.components.length === 1 ? v.components[0] : new WidgetComponentView();
  ok('table 落点：组件计数 1（缺 ⇒ 后续断言必红，不崩）', v.components.length === 1);
  eq('table ⇒ kind', c.kind, KIND_TABLE);
  eq('table ⇒ 列', c.tableColumns, ['a', 'b']);
  eq('table ⇒ 行计数', c.tableRows.length, 1);
  eq('table ⇒ 单元格计数 = 列数', c.tableRows.length === 1 ? c.tableRows[0].cells.length : -1, 2);
  eq('table ⇒ max_height 透传', c.tableMaxHeight, 300);
  eq('table ⇒ 可见内容', [c.empty, c.reason.length], [false, 0]);
}
{
  // 空列 ⇒ web `return null`（整表不渲染）⇒ 原生 empty（不计入可见内容）
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    components: [{ widget_id: 't0', slot: 'panel', component: { type: 'table', props: { columns: [], rows: [] } } }],
  }));
  eq('空列表格 ⇒ empty=true（不计可见内容）', v.components[0].empty, true);
  eq('空列表格 ⇒ reason 空（不是降级）', v.components[0].reason.length, 0);
  // 只有空列表格 ⇒ 整份载荷不可见（不产空壳）
  eq('仅空列表格 ⇒ visible=false', v.visible, false);
}
{
  // 有列无行 ⇒ 只有表头（web 也渲染 thead）⇒ 可见
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    components: [{ widget_id: 't2', slot: 'panel', component: { type: 'table', props: { columns: ['a'], rows: [] } } }],
  }));
  eq('有列无行 ⇒ 可见（只表头）', [v.components[0].empty, v.visible], [false, true]);
}

// ══════════════════════════════════════════════════════════════════════════════
// ③ 收口断言：7 种全覆盖；"web 有但原生没有"这一档**已消失**
// ══════════════════════════════════════════════════════════════════════════════
eq('支持集 = 7（web `components.tsx:236-259` 全部）', SUPPORTED_KINDS.length, 7);
ok('sparkline/table 在支持集内', isSupportedKind(KIND_SPARKLINE) && isSupportedKind(KIND_TABLE));
ok('降级函数**不再**对 sparkline/table 特判（旧文案 "暂未实现" 已删）',
  degradeReasonForType(KIND_SPARKLINE).indexOf('暂未实现') < 0
  && degradeReasonForType(KIND_TABLE).indexOf('暂未实现') < 0);
{
  // 未知类型仍**显式降级**（可见占位 + reason）—— 收口没有把"未知"也吞掉
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    components: [{ widget_id: 'x', slot: 'panel', component: { type: 'quantum_flux', props: {} } }],
  }));
  eq('未知类型仍降级', v.components[0].kind, KIND_UNSUPPORTED);
  ok('未知类型 reason 非空且含类型名', v.components[0].reason.indexOf('quantum_flux') >= 0);
}
{
  // 零扫描防线（判据自身）：剥注释后必须还有内容，否则扫描器与真源脱节
  const probe: string = stripComments('a // 注释\n/* 块 */ b');
  ok('零扫描防线：剥注释后仍有代码字符', probe.indexOf('a') >= 0 && probe.indexOf('b') >= 0);
  ok('零扫描防线：剥注释确实去掉了注释文本', probe.indexOf('注释') < 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// ④ 渲染接线（**核心防线**）：钉"调用点计数"，不钉"方法体存在"
// ══════════════════════════════════════════════════════════════════════════════
{
  const ROOT: string = findRoot(__dirname);
  ok('零扫描判红：能找到仓库根（找不到 ⇒ 本判据无效，必须红）', ROOT.length > 0);
  const rendererPath: string = ROOT.length > 0
    ? path.join(ROOT, 'entry', 'src', 'main', 'ets', 'components', 'PluginWidgets.ets') : '';
  ok('零扫描判红：渲染层文件存在', rendererPath.length > 0 && fs.existsSync(rendererPath));
  const raw: string = rendererPath.length > 0 ? fs.readFileSync(rendererPath, 'utf8') : '';
  const src: string = stripComments(raw);
  ok('零扫描判红：渲染层源码非空（>1000 字符）', src.length > 1000);

  // 分支消费点（各 ≥1）——支线若被删/被注释 ⇒ 必红
  ok('渲染层有 sparkline 分支（`this.view.kind === KIND_SPARKLINE`）',
    countOf(src, 'this.view.kind === KIND_SPARKLINE') >= 1);
  ok('渲染层有 table 分支（`this.view.kind === KIND_TABLE`）',
    countOf(src, 'this.view.kind === KIND_TABLE') >= 1);
  // core import 消费点（各 ≥1）——防"core 造了类型但渲染层没接线"
  ok('渲染层从 core import KIND_SPARKLINE', countOf(src, 'KIND_SPARKLINE') >= 2);
  ok('渲染层从 core import KIND_TABLE', countOf(src, 'KIND_TABLE') >= 2);
  // 几何/文案单源：core 造的常量必须在渲染层被消费（防孤岛）
  ok('渲染层消费 SPARK_VIEW_W（viewPort 归一坐标系）', countOf(src, 'SPARK_VIEW_W') >= 1);
  ok('渲染层消费 SPARK_EMPTY_LABEL（空数据文案）', countOf(src, 'SPARK_EMPTY_LABEL') >= 1);
  // 形状/滚动原语（折线/面积 + 表格滚动）
  ok('渲染层用 Polygon/Polyline 画折线+面积',
    countOf(src, 'Polygon()') >= 1 && countOf(src, 'Polyline()') >= 1);
  ok('渲染层用 Shape.viewPort 归一缩放', countOf(src, '.viewPort(') >= 1);
  ok('渲染层表格受 maxHeight 约束（可滚动）',
    countOf(src, 'constraintSize({ maxHeight: this.view.tableMaxHeight })') >= 1);
  // 取色纪律：渲染层不得出现 hex 颜色字面量（本组件应**零** hex）。
  // ⚠️ 必须用**hex 形状**正则，不能数 `#` —— ForEach key 里到处是 `#`（`th#${ci}`），
  //    数 `#` 会**假红**（我本人第一版就踩了，正是本仓「判据 ≠ 信号」血教训）。
  const hexHits: string[] = (src.match(/#[0-9a-fA-F]{3,8}\b/g) || []);
  ok('渲染层无 hex 颜色字面量（取色只走 colorOf/surfaceFillOf）', hexHits.length === 0);
  // 反例自证（防"正则写死 ⇒ 恒绿"）：把 hex 注入样本，正则必须抓到
  ok('判据自证：同一 hex 正则在**注入样本**上必命中',
    (('#ffffff').match(/#[0-9a-fA-F]{3,8}\b/g) || []).length === 1);
}

if (fail > 0) { console.log(`  widget_sparktable: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  widget_sparktable: ${pass} passed, 0 failed`);
process.exit(0);
