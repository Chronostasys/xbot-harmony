/**
 * widget_dock.test.ts —— **常驻信息栏（infoBar dock）** 的判别力测试。
 *
 * 被钉住的缺陷类别（P0 缺口）：插件声明式 widget 此前**只在插件目录浮层里可见**
 * （`components/PluginHost.ets:172-186` 是 `PluginWidgets` 的唯一挂载点）⇒ 正常聊天路径
 * **完全看不到**。本轮在聊天页底部补了一个常驻信息栏落点。
 *
 * 权威基准（web，逐条核对）：
 *   · 落点：`web/src/layouts/MobileAppShell.tsx:483-487`（`main` **下方**常驻 `<InfoBar/>`）
 *   · 内容：`web/src/plugins/InfoBar.tsx:15-27`（`WidgetZone zone="infoBar" excludePrefixes={['git:']}`）
 *   · 显示：`web/src/plugins/WidgetZone.tsx:56-69`（无 span ⇒ 渲染 `empty`，缺省 null ⇒ **零节点**）
 *
 * ── 三条硬判据 ─────────────────────────────────────────────────────────────────
 *  ① **空态零占位**：无 `infoBar` 内容 ⇒ `widgetDockView().visible === false`（调用方零节点/零高度）；
 *  ② **有 widget 才出现**：只有 `infoBar` zone 的非排除 span 才让它可见（别的 zone 不算）；
 *  ③ **判据与渲染同源**：`widgetDockView` 的 spans == `widgetsView` 里 `infoBar` zone 过滤后的 spans
 *     （同一次解析的**投影**，不是第二次解析 JSON）；且渲染层只读 `view.visible`。
 *
 * ── 纪律（本仓已入库的 GOTCHA）──────────────────────────────────────────────────
 *  · **剥注释**再扫源码（注释里记片段是允许且鼓励的 ⇒ 不剥会双向出错）；
 *  · **零扫描判红**（文件读不到 / 合法样本解不出 span ⇒ 直接红，防白绿）；
 *  · **mutation 自证**（注入"常驻占位 / 不看空态 / 不接线" ⇒ 必须红）；
 *  · 取色 role **必须**落在 `core/design.ets:colorOf` 的合法集合内（未知 role 运行时**静默不可见** ⇒ 门禁 ⑥b 同源）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  DOCK_EXCLUDE_PREFIXES, DOCK_ZONE, WidgetDockView, WidgetSpanView, WidgetZoneView,
  dockSpanExcluded, widgetsView, widgetDockView,
} from '../../entry/src/main/ets/core/widgetsview';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eqJson(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
/** 剥注释（保留换行 ⇒ 行号不漂移）—— 本仓约定。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}

const fsMod = require('fs');
const pathMod = require('path');
// run.sh 把测试编到 `<repo>/tools/tests/.out.<pid>/js/` ⇒ 4 层到仓根（同 `horizontal_overflow_gate.test.ts`）。
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const DOCK_ETS: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'WidgetDock.ets');
const INDEX_ETS: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets');
const DESIGN_ETS: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'core', 'design.ets');

function readOr(src: string): string {
  try { return fsMod.readFileSync(src, 'utf8'); } catch (e) { return ''; }
}
const dockRaw: string = readOr(DOCK_ETS);
const indexRaw: string = readOr(INDEX_ETS);
const designRaw: string = readOr(DESIGN_ETS);
const dockSrc: string = stripComments(dockRaw);
const indexSrc: string = stripComments(indexRaw);

function payload(o: object): string { return JSON.stringify(o); }

// ── §0 零扫描判红（防"范围写空 = 白绿"）─────────────────────────────────────────
console.log('\n▶ §0 零扫描判红');
ok('读到 components/WidgetDock.ets（否则下面全是假绿）', dockSrc.length > 0);
ok('读到 pages/Index.ets', indexSrc.length > 0);
ok('读到 core/design.ets（取色 role 真源）', designRaw.length > 0);

// ── §1 ① 空态零占位 ────────────────────────────────────────────────────────────
console.log('\n▶ §1 空态零占位（无 infoBar 内容 ⇒ 不可见）');
{
  const none: WidgetDockView = widgetDockView('web_widgets', '');
  eqJson('★ 没收到载荷（content=""）⇒ visible=false', none.visible, false);
  eqJson('  ⇒ spans 为空', none.spans.length, 0);
}
{
  const emptyObj: WidgetDockView = widgetDockView('web_widgets', '{}');
  eqJson('★ 合法空载荷 {} ⇒ visible=false（不产空壳）', emptyObj.visible, false);
}
{
  const bad: WidgetDockView = widgetDockView('web_widgets', 'not-json{{');
  eqJson('★ 坏 JSON ⇒ visible=false（信息栏不产降级行，降级由插件目录浮层承载）', bad.visible, false);
}
{
  // 只有别处的 zone、infoBar 缺席 ⇒ 仍不可见（"别的 zone ≠ 信息栏内容"）
  const other: WidgetDockView = widgetDockView('web_widgets', payload({
    zones: { titleBarLeft: [{ text: '标题' }], statusBarRight: [{ text: '状态' }] },
  }));
  eqJson('★ 只有 titleBarLeft/statusBarRight ⇒ visible=false（只取 infoBar）', other.visible, false);
}
{
  const emptyZone: WidgetDockView = widgetDockView('web_widgets', payload({ zones: { infoBar: [] } }));
  eqJson('★ infoBar 存在但空数组 ⇒ visible=false', emptyZone.visible, false);
}

// ── §2 ② 有 widget 才出现 + 排除前缀 ───────────────────────────────────────────
console.log('\n▶ §2 有 widget 才出现 / 排除前缀（web `InfoBar.tsx:24` excludePrefixes）');
{
  const v: WidgetDockView = widgetDockView('web_widgets', payload({
    zones: { infoBar: [{ text: '会话 A', style: 'accent' }, { text: '12 条新消息', style: 'dim' }] },
  }));
  eqJson('★ 有 infoBar span ⇒ visible=true', v.visible, true);
  eqJson('  ⇒ span 数与顺序保持服务端推送序', v.spans.map((s: WidgetSpanView) => s.text), ['会话 A', '12 条新消息']);
  eqJson('  ⇒ style 已被解析成语义色 role', v.spans.map((s: WidgetSpanView) => s.colorRole), ['accentSoft', 'textMuted']);
}
{
  const onlyGit: WidgetDockView = widgetDockView('web_widgets', payload({
    zones: { infoBar: [{ text: 'git:main Δ2' }] },
  }));
  eqJson('★ infoBar 只有被排除的 git: span ⇒ visible=false（零占位）', onlyGit.visible, false);
}
{
  const mixed: WidgetDockView = widgetDockView('web_widgets', payload({
    zones: {
      infoBar: [
        { text: 'git:main Δ2', style: 'accent' },
        { text: '构建通过', style: 'success' },
      ],
    },
  }));
  eqJson('★ 混合 ⇒ git: 被剔除，其余保留', mixed.spans.map((s: WidgetSpanView) => s.text), ['构建通过']);
  eqJson('  ⇒ visible=true', mixed.visible, true);
}
ok('排除前缀常量 = [\'git:\']（web `InfoBar.tsx:24` 逐字）', DOCK_EXCLUDE_PREFIXES.length === 1 && DOCK_EXCLUDE_PREFIXES[0] === 'git:');
ok('消费的 zone = \'infoBar\'（web `InfoBar.tsx:24`）', DOCK_ZONE === 'infoBar');
ok('dockSpanExcluded 只按前缀判（不分大小写、不误伤）',
  dockSpanExcluded('git:main') && !dockSpanExcluded('构建通过') && !dockSpanExcluded('Git:main'));

// ── §3 ③ 判据与渲染同源（不是第二次解析）───────────────────────────────────────
console.log('\n▶ §3 判据与渲染同源（dock 视图 = widgetsView 里 infoBar zone 的投影）');
{
  const content: string = payload({
    zones: {
      titleBarLeft: [{ text: '别处' }],
      infoBar: [{ text: 'git:x' }, { text: 'A', style: 'info' }, { text: 'B' }],
    },
    components: [{ widget_id: 'w1', component: { type: 'metric', props: { value: '7' } } }],
    revision: 3,
  });
  const base = widgetsView('web_widgets', content);
  const zone: WidgetZoneView[] = base.zones.filter((z: WidgetZoneView) => z.name === DOCK_ZONE);
  const expected: string[] = [];
  if (zone.length === 1) {
    for (let i = 0; i < zone[0].spans.length; i++) {
      if (!dockSpanExcluded(zone[0].spans[i].text)) { expected.push(zone[0].spans[i].text); }
    }
  }
  const dock: WidgetDockView = widgetDockView('web_widgets', content);
  eqJson('★ dock.spans == widgetsView(infoBar).spans 过滤后（同一份解析的投影）',
    dock.spans.map((s: WidgetSpanView) => s.text), expected);
  ok('★ 同源自证：base 解析出的 zone 数 ≥ 2（说明确实在两个 zone 里挑，不是碰巧）', base.zones.length >= 2);
  eqJson('★ 声明式 components **不**进信息栏（那条由插件目录浮层承载）',
    dock.spans.map((s: WidgetSpanView) => s.text), ['A', 'B']);
}

// ── §4 取色 role 合法（未知 role ⇒ 运行时静默不可见）────────────────────────────
console.log('\n▶ §4 信息栏 span 的取色 role 必须合法（门禁 ⑥b 同源）');
{
  const legal: string[] = [];
  const re: RegExp = /role === '([^']+)'/g;
  let m: RegExpExecArray | null = re.exec(designRaw);
  while (m !== null) { legal.push(m[1]); m = re.exec(designRaw); }
  ok('零扫描判红：design.ets 抽到 ≥10 个合法 role', legal.length >= 10);
  const styles: string[] = ['', 'normal', 'dim', 'accent', 'success', 'warning', 'error', 'info', 'muted', 'unknown-style'];
  const spans: WidgetSpanView[] = [];
  for (let i = 0; i < styles.length; i++) {
    const v: WidgetDockView = widgetDockView('web_widgets',
      payload({ zones: { infoBar: [{ text: `s${i}`, style: styles[i] }] } }));
    for (let j = 0; j < v.spans.length; j++) { spans.push(v.spans[j]); }
  }
  ok('零扫描判红：9 种 style 必须各解出 1 个 span', spans.length === styles.length);
  let bad: string = '';
  for (let i = 0; i < spans.length; i++) {
    if (legal.indexOf(spans[i].colorRole) < 0) { bad = spans[i].colorRole; }
  }
  ok('★ 所有 style（含未知档）映射出的 role 都在 colorOf 合法集合内', bad === '',
    bad.length > 0 ? `非法 role: ${bad}` : '');
  ok('★ 未知 style 回落 textPrimary（绝不置 transparent ⇒ 不会静默不可见）',
    spans[spans.length - 1].colorRole === 'textPrimary');
}

// ── §5 渲染层形态（源码级，防"回退即假绿"）────────────────────────────────────
console.log('\n▶ §5 渲染层形态（源码级钉死）');
/** 渲染层**必须**把整个 build 内容包在 `if (this.view.visible)` 里（否则空态就占位）。 */
function dockGatesOnVisible(src: string): boolean {
  return /if\s*\(\s*this\.view\.visible\s*\)\s*\{/.test(src);
}
/** 渲染层**必须**经唯一纯逻辑入口取值（否则是"判据各写一份"）。 */
function dockUsesSharedLogic(src: string): boolean {
  return /widgetDockView\s*\(\s*this\.event\s*,\s*this\.content\s*\)/.test(src);
}
/** 渲染层**不得**把 `content.length > 0` 当显示判据（那正是"不看空态"的退路）。 */
function dockAvoidsNaiveGate(src: string): boolean {
  return !/content\.length\s*>\s*0/.test(src) && dockGatesOnVisible(src);
}
/** 聊天页**必须**真实例化（ArkTS 不检查无消费者组件 ⇒ 不接线 = 假绿 + 孤儿）。 */
function indexMountsDock(src: string): boolean {
  return /WidgetDock\s*\(\s*\{/.test(src);
}
ok('★ 渲染层以 `if (this.view.visible)` 为唯一显示判据', dockGatesOnVisible(dockSrc));
ok('★ 渲染层经 `widgetDockView(this.event, this.content)` 取值（判据同源）', dockUsesSharedLogic(dockSrc));
ok('★ 渲染层不用 `content.length > 0` 当显示判据', dockAvoidsNaiveGate(dockSrc));
ok('★ 渲染层不带 `@Prop` 驱动的 `@Watch(\'syncView\')`（数据变了必须重算）',
  /@Watch\(\s*'syncView'\s*\)/.test(dockSrc) && /private syncView\(\)/.test(dockSrc));
ok('★ pages/Index.ets 真的挂了 `WidgetDock({...})`（消孤儿 + 真实编译覆盖）', indexMountsDock(indexSrc));

// ── §6 mutation 自证（注入必红样本）────────────────────────────────────────────
console.log('\n▶ §6 mutation 自证');
{
  // M1：把显示判据换成 `if (true)`（= 常驻占位，空态也画条）⇒ 形态判据必红
  const m1: string = dockSrc.replace(/if\s*\(\s*this\.view\.visible\s*\)\s*\{/, 'if (true) {');
  ok('M1 mutation：`if (this.view.visible)` ⇒ `if (true)` 必红', !dockGatesOnVisible(m1) && m1 !== dockSrc);
  // M2：显示判据改用 `content.length > 0`（= 不看空态 ⇒ 空载荷也占位）⇒ 必红
  const m2: string = dockSrc.replace(/if\s*\(\s*this\.view\.visible\s*\)\s*\{/, 'if (this.content.length > 0) {');
  ok('M2 mutation：改用 `content.length > 0` 必红', !dockAvoidsNaiveGate(m2));
  // M3：纯逻辑不看空态（visible 恒 true）⇒ 空态断言必须能抓到
  const mutantAlwaysVisible = (event: string, content: string): WidgetDockView => {
    const v: WidgetDockView = widgetDockView(event, content);
    v.visible = true;   // 注入缺陷：常驻占位
    return v;
  };
  ok('M3 mutation：`visible` 恒 true ⇒ 与真判据在空载荷上**可区分**',
    mutantAlwaysVisible('web_widgets', '').visible !== widgetDockView('web_widgets', '').visible);
  // M4：不接线（Index 里删掉实例化）⇒ 消孤儿判据必红
  const m4: string = indexSrc.replace(/WidgetDock\s*\(\s*\{/, 'Whatever(');
  ok('M4 mutation：Index 去掉 `WidgetDock({` 必红', !indexMountsDock(m4) && m4 !== indexSrc);
  // M5：把排除前缀去掉（git: 会重复显示）⇒ 前缀断言必红
  const m5: WidgetDockView = widgetDockView('web_widgets',
    payload({ zones: { infoBar: [{ text: 'git:main' }] } }));
  ok('M5 反向对照：真实现下 git: 被排除（与"不排除"可区分）', !m5.visible && dockSpanExcluded('git:main'));
}

if (fail > 0) {
  console.log(`\n  widget_dock: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n  widget_dock: ${pass} passed, 0 failed`);
process.exit(0);

export {};
