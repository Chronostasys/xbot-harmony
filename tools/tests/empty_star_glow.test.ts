/**
 * 空态星形「圆形辉光」契约测试（任务5 靶子1）—— **是圆不是盒**。
 *
 * 背景：空态 `sys.symbol.star_fill` 原先用 `.shadow(this.emptyStarShadow())` 做 accent 外发光。
 * `.shadow` 按**字形包围盒**渲染 ⇒ 深色底上星形外面实际是一圈"圆角方盒"而非圆光
 * （真机截图取证：亮区 x 恒为 556..763 的矩形，四角回缩）。浅色系此前已返回"无阴影"
 * 躲开白盒，深色一直漏着。
 *
 * 修法：改用**径向渐变**（`radialGradient`，与登录页顶部光晕同一手段）裁成圆 —— 中心
 * accent 辉光、边缘透明。本文件是那个决定的**可红契约**。
 *
 * 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译，`pages/**` 不进
 * 这套 harness ⇒ 页面层无法直接 import 单测。本仓既有先例：`tools/tests/inflight_language.test.ts`
 * 同法读组件源码做形态断言。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

// 让本文件成为**模块**（否则顶层 `pass/fail/ok/…` 落进全局作用域，与其它同类测试文件冲突：
// TS6200/TS2393）。有 import 的测试天然是模块；本文件只用 `require`，故显式 `export {}`。
export {};

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

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const indexSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'), 'utf-8');

/**
 * 空态块：从星形辉光的**起头注释**到该块的 `.id('xbot-empty-state')`。
 * ⚠️ 锚点必须取"辉光代码**之前**"的独特串：曾误用 `$r('sys.symbol.star_fill')`，
 *    它命中的是 `SymbolGlyph($r(...))` **内部**（在 radialGradient 之后）⇒ 抽取段漏掉辉光，
 *    断言假红。改用本波新增的独特注释做锚点。
 */
function emptyStateBlock(src: string): string {
  const start = src.indexOf('// ⛔ 星形不再用');
  if (start < 0) { return ''; }
  const end = src.indexOf(".id('xbot-empty-state')", start);
  return end < 0 ? '' : src.substring(start, end);
}

const block: string = emptyStateBlock(indexSrc);

// ── (a) 星形辉光必须是**径向渐变的圆**，不是 `.shadow` 的方盒 ────────────────────
ok('空态块可定位（星形 → xbot-empty-state）', block.length > 100);
has(block, 'radialGradient(', '空态星形辉光走 radialGradient（圆光）');
has(block, 'borderRadius(STAR_GLOW_SIZE / 2)', '辉光裁成圆（borderRadius = 半直径）');
has(block, 'radius: STAR_GLOW_SIZE / 2', '径向渐变半径 = 半直径（边缘到圆外）');
has(block, "colors: [[this.eff().glow, 0.0], [this.pal().transparent, 1.0]]",
  '渐变：中心 accent 辉光 → 边缘透明');
hasNot(block, '.shadow(', '空态星形不再有 .shadow（方盒的根因）');

// ── (b) 旧实现必须被**删除**（不是留着不用）────────────────────────────────────
hasNot(indexSrc, 'private emptyStarShadow', 'emptyStarShadow() 已删（不留死代码）');
hasNot(indexSrc, 'this.emptyStarShadow()', '调用点已改为 radialGradient');

// ── (c) 尺寸是**有名常量**（token 纪律：禁魔法数）────────────────────────────────
has(indexSrc, 'const STAR_GLOW_SIZE: number = 150;', 'STAR_GLOW_SIZE 是模块级常量');

// ── (d) 辉光与星形**同步呼吸**（读同一个 pulseOn，非静态贴图）────────────────────
has(block, '.opacity(this.pulseOn ?', '辉光按 pulseOn 呼吸（与星形同源）');

console.log(`  empty_star_glow: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
