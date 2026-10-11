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

/**
 * **剥注释**（本仓约定：注释里记代码片段/色值是**允许且鼓励**的 ⇒ 判据扫源码前**必须**先剥）。
 * ⚠️ 保留换行 ⇒ 行号不漂移。
 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}

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

// ⚠️ 新形态（本轮实测）：本文件的**抽取锚点本身就是注释**（`emptyStateBlock` 用 '// ⛔ 星形不再用' 定位）
//    ⇒ ⛔ 不能先把整份源码剥注释（锚点会消失 ⇒ 抽取断裂，实测 6 红）。分工：
//    **锚点用原文 `indexSrc`** / **断言输入用剥过的 `stripSrc(...)`**（两件事分离）。
const block: string = stripSrc(emptyStateBlock(indexSrc));
const indexCode: string = stripSrc(indexSrc);   // 整文件级断言用这个

// ── (a) 星形辉光必须是**径向渐变的圆**，不是 `.shadow` 的方盒 ────────────────────
ok('空态块可定位（星形 → xbot-empty-state）', block.length > 100);
has(block, 'radialGradient(', '空态星形辉光走 radialGradient（圆光）');
has(block, 'borderRadius(STAR_GLOW_SIZE / 2)', '辉光裁成圆（borderRadius = 半直径）');
has(block, 'radius: STAR_GLOW_SIZE / 2', '径向渐变半径 = 半直径（边缘到圆外）');
has(block, "colors: [[this.eff().glow, 0.0], [this.pal().transparent, 1.0]]",
  '渐变：中心 accent 辉光 → 边缘透明');
hasNot(block, '.shadow(', '空态星形不再有 .shadow（方盒的根因）');

// ── (b) 旧实现必须被**删除**（不是留着不用）────────────────────────────────────
hasNot(indexCode, 'private emptyStarShadow', 'emptyStarShadow() 已删（不留死代码）');
hasNot(indexSrc, 'this.emptyStarShadow()', '调用点已改为 radialGradient');

// ── (c) 尺寸是**有名常量**（token 纪律：禁魔法数）────────────────────────────────
has(indexSrc, 'const STAR_GLOW_SIZE: number = 150;', 'STAR_GLOW_SIZE 是模块级常量');

// ── (d) 辉光**静态**（⛔ 不呼吸）────────────────────────────────────────────────
// pin **反向**（2026-10-11）：页面级 `pulseOn` 心跳按动效铁律**已删除**（同一时刻只允许一个
// "在飞动效" = 光球，见 `core/design.ets §4.1` / `docs/DESIGN-SYSTEM.md §8`）⇒ 空态辉光不再呼吸。
// ★ 判别力（mutation 必红）：把 `.opacity(1)` 改回 `this.pulseOn`、或加回 `.animation(...)` ⇒ 本段红。
hasNot(block, 'pulseOn', '空态辉光**不读** pulseOn（静态；唯一在飞动效 = 光球）');
hasNot(block, '.animation(', '空态辉光**无**内联/循环动效（静态呈现）');
has(block, '.opacity(1)', '辉光不透明度为常量（静态）');

// ── 剥注释的**判别力自证** ──────────────────────────────────────────────────────
{
  ok('判别力：**注释里**的禁串被剥掉（不误红）',
    stripSrc('// .fontColor([this.pal().textMuted])').indexOf('.fontColor(') < 0);
  ok('判别力：**代码里**的同一串仍在（不误绿）',
    stripSrc('const a = 1; .fontColor([this.pal().textMuted])').indexOf('.fontColor(') >= 0);
  ok('判别力：剥注释**保留换行**（行号不漂移）',
    stripSrc('a\n// x\nb').split('\n').length === 3);
}

console.log(`  empty_star_glow: ${pass} passed, ${fail} failed`);


process.exit(fail === 0 ? 0 : 1);
