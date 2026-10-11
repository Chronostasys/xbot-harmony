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

const swatches: string = between(appearance, 'AccentSwatches() {', 'AccentCustomInput() {');
ok('AccentSwatches 区间可定位（非空）', swatches.length > 0);
has(swatches, 'Flex({ wrap: FlexWrap.Wrap })', '强调色色板 = Flex(wrap)（第 7 个圆点不再被切）');

if (fail > 0) {
  console.log(`  ✗ settings_panel_wrap: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ settings_panel_wrap: ${pass} passed, 0 failed`);
process.exit(0);
