/**
 * 「全部折叠 / 全部展开」**接线**契约测试（目标④）。
 *
 * 背景：`core/sessiongroup.ets:770 collapseAllPlan` 是 `parity-audit` 校准后
 * **唯一"纯逻辑已就绪、0 UI 消费"** 的缺口（纯逻辑在、用户点不到 = 本仓最危险的缺陷类）。
 *
 * 本测试分两层（与 `sessiongroup_wiring.test.ts` 同款）：
 *  A. **真判定（可执行）**：`collapseAllPlan` / `applyGroupsCollapsed` 是 `core/sessiongroup.ets` 的
 *     真函数（离线 harness 编译 `core/**`）⇒ 用真数据跑"点一下折叠全部 / 再点一下展开全部"的往返。
 *  B. **源码形态契约**：`pages/Index.ets`（组件层不进离线 harness，按本仓既有先例读真实源码断言）
 *     必须**消费** `collapseAllPlan`（**调用点计数 ≥1** = 本单要修的"0 消费"），
 *     且交互链完整（按钮存在 → 点击 → `applyCollapseAll` → `collapseAllPlan` + `applyGroupsCollapsed`），
 *     且折叠态读写走**既有** `@State collapsedGroups`（与单组折叠同一套，⛔ 不自造）。
 *
 * ⛔ 判据是"调用点计数 + 形态"，不是"方法体存在"（钉方法体会**假绿** —— 见 AGENTS.md『死消费』条目）。
 * ⛔ 零扫描判红：读不到源 / 0 命中 ⇒ 红（白绿防线）。
 * ⛔ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  applyGroupsCollapsed, collapseAllPlan, CollapseAllPlan,
} from '../../entry/src/main/ets/core/sessiongroup';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}

/**
 * 剥**行注释**（`// …`）后再做形态/缺席断言。
 * ⚠️ 教训（AGENTS.md「判据 ≠ 信号」）：本仓组件用注释**记录"为什么不用某做法"**
 * （如"⛔ 真机实测 responseRegion 无效"）—— 朴素 grep 会把这种**文档**当成"使用了它" ⇒ 假红。
 * 本仓源码无 URL 字面量 ⇒ 按首个 `//` 截断对源码安全（与 `tools/lint/no-color-literals.sh` 同思路）。
 */
function stripComments(src: string): string {
  const lines = src.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf('//');
    out.push(idx >= 0 ? lines[i].substring(0, idx) : lines[i]);
  }
  return out.join('\n');
}

/** 页面接线逻辑的**离线复刻**：读当前折叠集 → 算 plan → 落新折叠集。 */
function clickCollapseAll(category: string, groupKeys: string[], collapsed: string[]): string[] {
  const plan: CollapseAllPlan = collapseAllPlan(category, groupKeys, collapsed);
  return applyGroupsCollapsed(collapsed, plan.keys, plan.target);
}

// ── (A) 真判定：`collapseAllPlan` 契约（对照 web `SessionViewBar.tsx:37-39`）────────
// 契约解读：**不是**"要折叠的 id 列表"、**也不是**"下一次点击的计划"的纯动作；它是
//   「当前应显示的控件状态」+「点击后目标态」的一体化结果：
//   · keys         = groupKeys 带分类前缀（`collapseKey(category, ·)`）
//   · visible      = keys.length > 0（web：`keys.length > 0` 才渲染按钮）
//   · allCollapsed = keys 非空且**全部**已在折叠集（空集 ⇒ false，web 显式 `length > 0 &&`）
//   · target       = !allCollapsed（点击后要写入的折叠态）
// ⇒ UI 的图标/文案由 `allCollapsed` 决定，点击动作 = 把折叠集整体置为 `target`。
const keys2 = ['/a', '/b'];
const p0: CollapseAllPlan = collapseAllPlan('path', keys2, []);
eq('plan.keys 带分类前缀', p0.keys, ['path:/a', 'path:/b']);
eq('plan.visible = 有分组', p0.visible, true);
eq('未折叠时 allCollapsed=false', p0.allCollapsed, false);
eq('未折叠时 target=true（点=全部折叠）', p0.target, true);
eq('图标分支取反：allCollapsed=false ⇒ 显示"折叠"动作', p0.allCollapsed === false, true);

// 点一下：全部折叠
const afterCollapse = clickCollapseAll('path', keys2, []);
eq('点击后折叠集 = 全部键', afterCollapse, ['path:/a', 'path:/b']);
const p1: CollapseAllPlan = collapseAllPlan('path', keys2, afterCollapse);
eq('再读：allCollapsed=true', p1.allCollapsed, true);
eq('再读：target=false（点=全部展开）', p1.target, false);
// 再点一下：全部展开（往返闭合）
const afterExpand = clickCollapseAll('path', keys2, afterCollapse);
eq('展开后折叠集清空', afterExpand, []);
eq('往返闭合：allCollapsed=false', collapseAllPlan('path', keys2, afterExpand).allCollapsed, false);

// 边界：无分组 ⇒ 不显示按钮（web `keys.length > 0`）
const pEmpty: CollapseAllPlan = collapseAllPlan('path', [], []);
eq('无分组 ⇒ visible=false（不渲染按钮）', pEmpty.visible, false);
eq('无分组 ⇒ allCollapsed=false（空集不算"全折叠"）', pEmpty.allCollapsed, false);

// 边界：部分折叠 ⇒ allCollapsed=false（按钮应变"全部折叠"）
eq('部分折叠 ⇒ 不是 allCollapsed',
  collapseAllPlan('path', keys2, ['path:/a']).allCollapsed, false);
// 边界：分类串味不容忍（web：键必须带分类前缀）
eq('分类隔离：time 的键不会命中 path 的折叠集',
  collapseAllPlan('time', ['today'], ['path:today']).allCollapsed, false);

// ── (B) 页面接线形态（源码断言；改坏即红）────────────────────────────────────
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const pagePath = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets');

// (B0) 零扫描判红：读不到源 ⇒ 红（白绿防线）
let pageSrc = '';
try {
  pageSrc = fsMod.readFileSync(pagePath, 'utf-8');
} catch (e) {
  pageSrc = '';
}
ok('读得到 pages/Index.ets（零扫描判红）', pageSrc.length > 10000);

// 行号工具：找出 needle 出现的 1-based 行号（只取**调用片段**，避免 `collapseAllPlanNow` 误命中）
function lineNumbersOf(src: string, needle: string): number[] {
  const lines = src.split('\n');
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(needle) >= 0) {
      out.push(i + 1);
    }
  }
  return out;
}

// (B1) ⭐ 核心判据：`collapseAllPlan(` 的**调用点计数 ≥1**（本单要修的"0 消费"）+ 打印 file:line。
//   ⚠️ 只匹配带 `(` 的调用片段：`collapseAllPlanNow(` 里没有 `collapseAllPlan(` 子串 ⇒ 不误命中。
const callLines = lineNumbersOf(pageSrc, 'collapseAllPlan(');
ok(`① Index.ets 消费 collapseAllPlan（调用点计数 ${callLines.length} ≥1）`, callLines.length >= 1);
console.log(`    · collapseAllPlan( 调用点：entry/src/main/ets/pages/Index.ets:${callLines.join(',')}`);
const applyLines = lineNumbersOf(pageSrc, 'applyGroupsCollapsed(');
ok(`① Index.ets 消费 applyGroupsCollapsed（调用点计数 ${applyLines.length} ≥1）`, applyLines.length >= 1);
console.log(`    · applyGroupsCollapsed( 调用点：entry/src/main/ets/pages/Index.ets:${applyLines.join(',')}`);

// (B2) 交互形态：按钮存在 + 点击链 → 该函数。
//   按钮区间 = `if (this.collapseAllPlanNow().visible) {` … `this.applyCollapseAll();`
const btnStart = pageSrc.indexOf('if (this.collapseAllPlanNow().visible) {');
const btnEnd = pageSrc.indexOf('this.applyCollapseAll();', btnStart);
const btnRaw = pageSrc.substring(btnStart, btnEnd > btnStart ? btnEnd + 24 : pageSrc.length);
// ⛔ 形态/缺席断言一律在**剥注释后**的代码上做（否则源码里"解释为何不用 X"的注释会假红）。
const btnSrc = stripComments(btnRaw);
ok('② 按钮区间可定位（未被删除/改名）', btnStart > 0 && btnRaw.length > 200 && btnRaw.length < 2500);
// 可见性由 plan.visible 决定（web `keys.length > 0` 才渲染）
has(pageSrc, 'if (this.collapseAllPlanNow().visible) {', '② 按钮可见性走 plan.visible（不另判一次）');
// 图标由 plan.allCollapsed 决定（web 图标随 allCollapsed 切）
has(pageSrc, 'if (this.collapseAllPlanNow().allCollapsed) {', '② 图标分支走 plan.allCollapsed');
has(btnSrc, 'sys.symbol.chevron_up', '② 「全部展开」分支用系统符号（同 chevron 族）');
has(btnSrc, 'sys.symbol.chevron_down', '② 「全部折叠」分支用系统符号（同 chevron 族）');
// 点击链：`.onClick(() => { this.applyCollapseAll(); })`
has(btnSrc, '.onClick(', '② 按钮有点击处理器');
has(btnSrc, 'this.applyCollapseAll();', '② 点击链到 applyCollapseAll');
has(pageSrc, 'private applyCollapseAll(): void {', '② applyCollapseAll 存在');
// applyCollapseAll 体内：算 plan + 落新折叠集（判据与动作同源）
const applyStart = pageSrc.indexOf('private applyCollapseAll(): void {');
const applySrc = stripComments(pageSrc.substring(applyStart, applyStart + 400));
has(applySrc, 'collapseAllPlanNow()', '② applyCollapseAll 调 collapseAllPlanNow');
has(applySrc, 'applyGroupsCollapsed(', '② applyCollapseAll 走 applyGroupsCollapsed（同源合成）');
has(applySrc, 'this.collapsedGroups =', '② applyCollapseAll 写既有 collapsedGroups');

// (B2b) 可点元素真实 ≥44×44 布局盒（⛔ 不用 responseRegion 负偏移外扩 —— 真机已证无效）
has(btnSrc, 'HIT_TARGET_MIN', '② 按钮布局盒走 HIT_TARGET_MIN（≥44）');
has(btnSrc, '.width(', '② 按钮有明确宽度（真实布局盒）');
has(btnSrc, '.height(', '② 按钮有明确高度（真实布局盒）');
hasNot(btnSrc, 'responseRegion', '② ⛔ 不用 responseRegion 外扩热区（真机无效）');
// ⛔ 不加动效（「只许减」）
hasNot(btnSrc, 'animateTo', '② 按钮不加动效（animateTo）');
hasNot(btnSrc, '.transition(', '② 按钮不加入场动效（transition）');
// 视觉走既有 token/role（⛔ 零颜色字面量；计算型 role iconMuted 只能走 colorOf）
has(btnSrc, "colorOf(this.pal(), 'iconMuted')", '② 图标色走 colorOf(计算型 role)，非 Palette 字段');

// (B3) 折叠态读写走**同一套既有状态**（⛔ 不自造状态）
eq('③ @State collapsedGroups 声明唯一',
  lineNumbersOf(pageSrc, '@State collapsedGroups: string[] = [];').length, 1);
eq('③ 写 this.collapsedGroups = 的处数 = 2（单组 toggleGroup + 全部折叠 applyCollapseAll）',
  lineNumbersOf(pageSrc, 'this.collapsedGroups =').length, 2);
has(pageSrc, 'private toggleGroup(cat: string, key: string): void {', '③ 单组折叠（既有）仍在');
has(pageSrc, 'this.isGroupCollapsed(this.sessionCategory(), g.key)', '③ 列表展开态读同一份 collapsedGroups');
has(pageSrc, 'this.toggleGroup(this.sessionCategory(), g.key);', '③ 组头点击仍走既有单组折叠');
// 页面里没有第二套"全部折叠"判据（只读 collapseAllPlanNow，不再复现 allCollapsed 逻辑）
ok('③ 页面没有第二套 allCollapsed 判据（every/has 组合不出现）',
  pageSrc.indexOf('collapsedGroups.length > 0 &&') < 0);

if (fail > 0) {
  console.log(`  collapse_all_wiring: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  collapse_all_wiring: ${pass} passed, 0 failed`);
process.exit(0);
