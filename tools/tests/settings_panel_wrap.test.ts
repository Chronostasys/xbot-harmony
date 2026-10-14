/**
 * settings_panel_wrap.test.ts —— 设置面「多枚举控件」必须**换行**，⛔ 不许被容器裁切（2026-10-12）。
 *
 * 背景（真机截图确认，用户目标③「所有面板」）：设置面板顶部**分区切换条**原为
 * `Scroll` + `scrollBar(Off)` + `clip(true)` 的**单行横向滚动** —— 6+ 个分区时**末项被切在屏幕右缘**
 * （`消息渠道` 半字），且滚动条被关掉 ⇒ **没有任何"可滚动"的 affordance** ⇒ 用户看到的是"坏了"，
 * 不是"可以滑"。强调色色板同理（第 7 个圆点被切）。
 *
 * 修法 = 本仓既有约定 **`Flex({ wrap: FlexWrap.Wrap })` + 逐项 `.margin`**（见
 * `components/SettingsRows.ets:SettingsChipRow`）：任何屏宽都不切字、不需要隐藏滚动条。
 *
 * ⚠️ **判别力自证**：把任一 `Flex({ wrap: FlexWrap.Wrap })` 换回单行 `Row` ⇒ 对应断言红；
 *    把 TabBar 改回 `Scroll`+`.scrollable(ScrollDirection.Horizontal)` ⇒ 面板断言红。
 * ⛔ 断言前**剥注释**（文件里用注释记录了"旧实现为什么错"）。
 */
export {};

declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}

/** 剥注释（等长替换；对字符串内 `//` 免疫）—— 断言只看剥注释后的代码。 */
function stripComments(src: string): string {
  const out: string[] = [];
  const n: number = src.length;
  let i: number = 0;
  while (i < n) {
    const c: string = src.charAt(i);
    if (c === '/' && i + 1 < n && src.charAt(i + 1) === '/') {
      const j: number = src.indexOf('\n', i);
      i = j < 0 ? n : j;
      continue;
    }
    if (c === '/' && i + 1 < n && src.charAt(i + 1) === '*') {
      const j: number = src.indexOf('*/', i + 2);
      const end: number = j < 0 ? n : j;
      for (let k: number = i; k < end; k++) { if (src.charAt(k) === '\n') { out.push('\n'); } }
      i = end + 2;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

const fsMod = require('fs');
const pathMod = require('path');
/** 稳健定位仓库根（编译产物落在 `tools/tests/.out-<pid>` 下 ⇒ 层级不固定，别用固定 `..` 数）。 */
function findRoot(start: string): string {
  let cur: string = start;
  for (let i: number = 0; i < 10; i++) {
    if (fsMod.existsSync(pathMod.join(cur, 'entry', 'src', 'main', 'ets'))) { return cur; }
    cur = pathMod.join(cur, '..');
  }
  return '';
}
const ROOT: string = findRoot(__dirname);
const COMP: string = pathMod.join(ROOT, 'entry', 'src', 'main', 'ets', 'components');
const panel: string = stripComments(fsMod.readFileSync(pathMod.join(COMP, 'SettingsPanel.ets'), 'utf-8'));
const appearance: string = stripComments(fsMod.readFileSync(pathMod.join(COMP, 'SettingsAppearance.ets'), 'utf-8'));

// 区间：`TabBar() {` → `build() {`；`AccentSwatches() {` → `AccentCustomInput() {`
function between(src: string, a: string, b: string): string {
  const i: number = src.indexOf(a);
  if (i < 0) { return ''; }
  const j: number = src.indexOf(b, i);
  return j < 0 ? src.substring(i) : src.substring(i, j);
}

// ── ① 分区呈现 = **根列表（分组 + 钻取）**，⛔ 不再是页签条 ──────────────────────
//    2026-10-16（目标③「所有面板对标 Apple」）：原「4 列 × 3 行下划线标签网格」被真机截图
//    （`/tmp/panel_settings2.jpeg`）实锤读作"标签墙" —— 12 枚裸文字排三行、选中态只有一条线、
//    **进面板先吃掉 ~250vp 才见第一项内容**；且下划线页签是 **Material** 语言（Apple 设置面
//    恒为"分组列表 + 主从钻取"）⇒ 改分组列表 + 钻取。
//    ⛔ 反向断言（判别力自证）：把页签条/芯片网格加回来 ⇒ 本组必红。
ok('设置面不再有 TabBar 页签条', panel.indexOf('TabBar()') < 0);
ok('设置面不再有分区芯片宽度令牌 TAB_CHIP_W', panel.indexOf('TAB_CHIP_W') < 0);
ok('设置面不再用 Flex(wrap) 铺分区（那是标签网格的容器：多枚举控件才需要它）',
  panel.indexOf('Flex({ wrap: FlexWrap.Wrap })') < 0);
has(panel, 'RootList()', '设置面第一层 = 根列表（RootList）');
has(panel, 'settingsRootRows(', '分组/行序取自 core 真源 `settingsRootRows()`（⛔ 组件不自写映射）');
has(panel, 'sys.symbol.chevron_right', '根列表行带钻取箭头 `chevron_right`');
has(panel, 'sys.symbol.chevron_left', '钻入分区后页头带返回箭头 `chevron_left`');
has(panel, "this.active = '';", '返回键把 `active` 清空 ⇒ 回到根列表');

// ── ⑦ 死空间（真机实测 121px = 35.7vp）──────────────────────────────────────────
//    根因 = 三层间距叠加：芯片底 margin 8 + 根 Column `space: SPACE_SM` 12 + 分组标题自带 top 16。
//    修法 = 根 Column `space: 0`（间隙改显式）+ 页头底距 SPACE_SM ⇒ 「芯片条 → 首个分组标题」24vp。
//    ⛔ 反向断言：谁再把 `space` 加回根 Column 就红（死空间会回来）。
{
  const buildBody: string = between(panel, 'build() {', '\n  }\n}');
  ok('⑦ build 区间可定位（非空）', buildBody.length > 200);
  has(buildBody, 'Column({ space: 0 })', '⑦ build 根 Column `space: 0`');
  hasNot(buildBody, 'Column({ space: SPACE_SM })', '⑦ 反向：build 里不许再叠 SPACE_SM 的 Column 间隙');
  has(panel, 'left: SPACE_LG, right: SPACE_XS, top: SPACE_XS, bottom: SPACE_SM })',
    '⑦ 页头底距 = SPACE_SM（「页头 → 芯片条」的唯一间距）');
}

const swatches: string = between(appearance, 'AccentSwatches() {', 'AccentCustomInput() {');
ok('AccentSwatches 区间可定位（非空）', swatches.length > 0);
// ⚠️ 2026-10-13（15z5，判据演进；⛔ 不是删判据）：色板由 `Flex(wrap)` 改 **`Row` + `SpaceBetween`**。
//    真机量测（`uitest dumpLayout`，密度 149px = 44vp）：色板可用宽 **350vp**；原实现每圆点
//    = 44 + 右 margin 8 = **52vp 步距** ⇒ 7 枚 = **364vp > 350vp** ⇒ 必然换行，第 7 枚
//    （「跟随主题」）**独占第二行** = 视觉孤儿（装机截图可见）。
//    ⛔ 不能缩小圆点（44 = `HIT_TARGET_MIN` 是真机命中下限）⇒ 去逐项右 margin、由 `SpaceBetween`
//    分配 ⇒ **7 × 44 = 308vp ≤ 350vp ⇒ 恒一行**，首尾与上方标签对齐（Apple palette 行口径）。
has(swatches, 'Row() {', '强调色色板 = 单行 Row（调色板一行到底）');
has(swatches, '.justifyContent(FlexAlign.SpaceBetween)', '强调色色板 = SpaceBetween 分配间距');
ok('反：色板不再用 Flex(wrap)（wrap 会在 350vp 下把第 7 枚挤到第二行）',
  swatches.indexOf('Flex({ wrap: FlexWrap.Wrap })') < 0);
ok('反：色圈不再带右 margin（末项右 margin 会把行尾内缩、与上方标签错位）',
  swatches.indexOf('.margin({ right: SPACE_XS, bottom: SPACE_XS })') < 0);
// 白绿防线：色板必须真的是 Row（不是别的容器）+ 圆点仍守 44 命中下限
has(swatches, '.width(HIT_TARGET_MIN)\n      .height(HIT_TARGET_MIN)',
  '色圈仍为 44×44 命中盒（真机命中下限，⛔ 不许缩小）');

if (fail > 0) {
  console.log(`  ✗ settings_panel_wrap: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ settings_panel_wrap: ${pass} passed, 0 failed`);
process.exit(0);
