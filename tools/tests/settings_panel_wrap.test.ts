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

const tabBar: string = between(panel, 'TabBar() {', 'build() {');
ok('TabBar 区间可定位（非空）', tabBar.length > 0);
has(tabBar, 'Flex({ wrap: FlexWrap.Wrap })', '设置分区条 = Flex(wrap)（多枚举不切字）');
hasNot(tabBar, 'ScrollDirection.Horizontal', '设置分区条 ⛔ 不再横向 Scroll（会切末项且无 affordance）');
hasNot(tabBar, 'scrollBar(BarState.Off)', '设置分区条 ⛔ 不再"关掉滚动条"');
has(tabBar, '.margin({ right: SPACE_XS, bottom: SPACE_XS })', '设置分区条每项有 margin（wrap 的间距来源）');

// ── ⑤ 芯片**同宽**（苹果式控件网格）─────────────────────────────────────────────
//    病根（真机实测）：标签自然宽 ⇒ 芯片 167/208/248/262px **四种宽度**、行尾留白 215/233/644px
//    ⇒ 看着"没排过"。修法 = 统一宽度令牌 + 文字居中（只给宽度不给居中 ⇒ 短标签在宽芯片里贴左）。
has(tabBar, '.constraintSize({ minWidth: TAB_CHIP_W, minHeight: HIT_TARGET_MIN })', '⑤ 芯片用统一宽度令牌 TAB_CHIP_W');
has(tabBar, '.textAlign(TextAlign.Center)', '⑤ 芯片文字居中（宽芯片里的短标签不贴左）');
has(panel, 'const TAB_CHIP_W: number = fs(\'type.caption\') * 4.5 + INSET_ROW_X * 2;',
  '⑤ TAB_CHIP_W = 4.5 全角字宽（文字预算）+ 两侧内距（⛔ 不是就地字面量）');

// ⑤b **不变式**：标签视觉宽度 ≤ **4.5 全角字宽** —— 这是 TAB_CHIP_W 的全部推导前提。
//     ⛔ 只钉"令牌存在"不判别：谁加一个 5 字标签，推导失效、文字被挤/换行（本仓血债形态）。
//     槽位计法（**纯算术**，不依赖字体度量 ⇒ 不会漂移）：CJK = 1 · ASCII = 0.65 · 空格 = 0.5。
//     实测校准（真机 caption=12vp）：`智能体` 37.4vp / 估 36；`Web 账号` 53.5vp / 估 53.4；
//     `消息渠道` 49.3vp / 估 48 —— 估法**略偏小**（≤1.5vp）⇒ 留 0.05 槽位余量即可。
{
  const labels: string[] = [];
  const re: RegExp = /new SettingsTabSpec\([^,]+,\s*'([^']*)'/g;
  let m: any = re.exec(panel);
  while (m !== null) { labels.push(String(m[1])); m = re.exec(panel); }
  ok(`⑤b 取到全部分区标签（现 ${labels.length} 个，应 ≥ 10）`, labels.length >= 10);
  let widest: string = '';
  let widestSlots: number = 0;
  for (let i: number = 0; i < labels.length; i++) {
    const L: string = labels[i];
    let slots: number = 0;
    for (const ch of L) {
      if (/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) { slots += 1; }
      else if (ch === ' ') { slots += 0.5; }
      else { slots += 0.65; }
    }
    if (slots > widestSlots) { widestSlots = slots; widest = L; }
  }
  ok(`⑤b 最宽标签 ≤ 4.5 全角字宽（最宽 =「${widest}」= ${widestSlots.toFixed(2)}）`, widestSlots <= 4.5);
}

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
has(swatches, 'Flex({ wrap: FlexWrap.Wrap })', '强调色色板 = Flex(wrap)（第 7 个圆点不再被切）');

if (fail > 0) {
  console.log(`  ✗ settings_panel_wrap: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ settings_panel_wrap: ${pass} passed, 0 failed`);
process.exit(0);
