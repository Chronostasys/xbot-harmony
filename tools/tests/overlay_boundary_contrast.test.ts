/**
 * overlay_boundary_contrast.test.ts —— 浮层/面板**边界可读性**的离线判据（含柔影的合成模型）。
 *
 * ── 为什么单列 ────────────────────────────────────────────────────────────────
 * `bindPopup` 的 7 处浮层（ContextRing / LiveTailView×2 / MessageRow×2 / MessageNav / TodoPanel）
 * + `MenuSheets`/`StatusSheet`/`AskUserSheet`/`TodoPanel`/`Toast` 的 `.shadow(...)` 面板
 * **只开三个口子**：`popupColor` / `radius` / `shadow`（⛔ 无描边）。
 * ⇒ 浅色下"面板 vs 页面"的边界**只能靠柔影 + 填充色差**撑。玻璃/卡片的层数已有 `brand-impl`
 * 量过，**系统绘制/自绘的浮层**这条没人量过 —— 本文件补上。
 *
 * ── 合成模型（显式写出，⛔ 不藏假设）──────────────────────────────────────────
 *  · 浮层填充 = `surfaceFillOf(p,'surface.overlay')` ⇒ `RUNG_CARD` ⇒ **`p.surface`**
 *    （`design.ets:317`；7 处 `popupColor` 全部走它 ⇒ 单一口径）。
 *  · 影色 = `elevationColorOf(p, ELEV_OVERLAY)` = `effectsOf(p).elev3`
 *      · 浅色族 = `textPrimary @16%`（中性柔影，`theme.ets:795`）
 *      · 深色族 = `#000000 @42%`（`theme.ets:817`）
 *  · 影半径 = `shadowRadiusOf(p,'overlay')` ⇒ 浅色乘 `LIGHT_SHADOW_DIFFUSION`=1.5 ⇒ 30；深色 20
 *  · **边的影强度**：对称模糊对一条**直边**的取值恒为 **半高** ⇒ `α_edge = α_authored × 0.5`。
 *    这是本模型**唯一**的近似，且方向是**乐观**的（真实影在边外更淡）⇒ 若连这个上界都不够，
 *    结论只会更强。
 *  · 边界读法（眼看到的"台阶"）= **浮层填充** 对 **被影压过的底** 的对比度。
 *
 * ── 判据（阈值**不新造**：取仓内已批准的"面 vs 面"标准）────────────────────────
 *  `SURFACE_DIFF_MIN = 1.03` —— 出处 `docs/DESIGN-SYSTEM.md §13.3`（L2 白度差），
 * 代码里已在用：`tools/tests/palette_accent_rule.test.ts:55`、`tools/tests/porcelain_layering.test.ts:47-50`。
 *  ⛔ **刻意不用** `HAIRLINE_TARGET_RATIO`=1.3201：发丝是"**线性锐边**"，浮层是"**面差**"，
 *     不同感知通道，套过来会把 5/5 全判红（那是门槛套错，不是产品坏）。
 *
 * ── 本文件给出的结论（数字见运行时输出）─────────────────────────────────────────
 *  · **浅色不比深色弱，反而明显更强**（台阶 1.238/1.259 vs 深色 1.034–1.080）：
 *    浅色的分层来自**已批准的白度差**（#FFFFFF vs #F7F7F8/#F8FAFC），深色几乎只剩"影"，
 *    而**影在已经很暗的底上几乎不可见**（净影仅 1.008–1.017）。
 *  · 因此判据钉的不是"谁更亮"，而是**"至少一条通道达标"**（填充 ∥ 影 ≥1.03）：
 *    深色的边界**全靠填充兜底**，一旦把 popup 填充调得贴近底色就会整块失去边界。
 */
declare const process: { exit: (c: number) => void };

import {
  Palette, paletteOf, ALL_THEMES, contrastRatio, compositeOver, isLightPalette,
  parseColorRgba, shadowRadiusOf,
} from '../../entry/src/main/ets/core/theme';
import { surfaceFillOf, elevationColorOf, ELEV_OVERLAY } from '../../entry/src/main/ets/core/design';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

/** 仓内已批准的"面 vs 面"标准（L2 白度差）。出处见文件头。 */
const SURFACE_DIFF_MIN: number = 1.03;

function alphaPct(c: string): string {
  return `${Math.round(parseColorRgba(c)[3] * 100 / 255)}%`;
}
/** 把 `#AARRGGBB` 的 alpha 乘 k（模型用：直边处只有额定 alpha 的一半）。 */
function scaleAlpha(c: string, k: number): string {
  const a: number[] = parseColorRgba(c);
  const al: number = Math.round(a[3] * k);
  const hx: string = '0123456789ABCDEF';
  const two = (v: number): string => `${hx.charAt(Math.floor(v / 16))}${hx.charAt(v % 16)}`;
  return `#${two(al)}${two(a[0])}${two(a[1])}${two(a[2])}`;
}
function pad(s: string, n: number): string { return (s + ' '.repeat(n)).slice(0, n); }

class Row {
  t: string = ''; light: boolean = false;
  fill: string = ''; canvas: string = ''; fillVs: number = 0;
  netShadow: number = 0; step: number = 0; r: number = 0;
}
/** 单主题的四个量（**纯函数**，供 §D 的 mutation 复用）。 */
function measure(t: string): Row {
  const p: Palette = paletteOf(t);
  const x: Row = new Row();
  x.t = t; x.light = isLightPalette(p);
  x.fill = surfaceFillOf(p, 'surface.overlay');
  x.canvas = p.appBg;
  const shadow: string = elevationColorOf(p, ELEV_OVERLAY);
  const edgeBg: string = compositeOver(scaleAlpha(shadow, 0.5), x.canvas);
  x.fillVs = contrastRatio(x.fill, x.canvas);
  x.netShadow = contrastRatio(edgeBg, x.canvas);      // 影**独自**能给的对比度
  x.step = contrastRatio(x.fill, edgeBg);             // 眼看到的台阶
  x.r = shadowRadiusOf(p, 'overlay');
  return x;
}

const rows: Row[] = ALL_THEMES.map(measure);

console.log('\n▶ §A 浮层边界（含柔影）：逐主题数字');
console.log('  ' + pad('主题', 11) + pad('浮层填充', 10) + pad('底(画布)', 10) + pad('填充vs底', 10)
  + pad('影@边', 8) + pad('边底合成', 10) + pad('台阶', 9) + pad('影半径', 8) + '净影(独自)');
for (let i = 0; i < rows.length; i++) {
  const x = rows[i];
  const p: Palette = paletteOf(x.t);
  console.log('  ' + pad(x.t, 11) + pad(x.fill, 10) + pad(x.canvas, 10) + pad(x.fillVs.toFixed(4), 10)
    + pad(alphaPct(scaleAlpha(elevationColorOf(p, ELEV_OVERLAY), 0.5)), 8)
    + pad(x.fill, 0) + pad('', 0)
    + pad(x.step.toFixed(4), 9) + pad(String(x.r), 8) + x.netShadow.toFixed(4));
}
console.log('  （"边底合成"= 影@边 压过画布后的色；"台阶"= 浮层填充 vs 该合成色的对比度）');

console.log('\n▶ §B 浅色 vs 深色：谁更弱 —— **结论与直觉相反**');
const lights: Row[] = rows.filter((x) => x.light);
const darks: Row[] = rows.filter((x) => !x.light);
const minL = (f: (x: Row) => number, a: Row[]): number => Math.min(...a.map(f));
console.log(`  台阶        浅色最差 ${minL((x)=>x.step, lights).toFixed(4)}  vs  深色最差 ${minL((x)=>x.step, darks).toFixed(4)}`);
console.log(`  填充vs底    浅色最差 ${minL((x)=>x.fillVs, lights).toFixed(4)}  vs  深色最差 ${minL((x)=>x.fillVs, darks).toFixed(4)}`);
console.log(`  净影(独自)  浅色最差 ${minL((x)=>x.netShadow, lights).toFixed(4)}  vs  深色最差 ${minL((x)=>x.netShadow, darks).toFixed(4)}`);
ok('浅色族的**台阶**不弱于深色族（浅色的白度差接管了分层）',
  minL((x) => x.step, lights) > minL((x) => x.step, darks));
// ⚠️ 2026-10-11 修复后**前提已反转**：深色浮层的影改走 `glow`（accent@45% 彩色发光）⇒ 净影**达标**。
//    （原断言"深色净影由 #000@42% 黑影压近黑底 ⇒ 1.0122、远达不到 1.03"描述的是**修复前**。）
ok('深色族的净影独自（发光通道）现已**达到**面差标准（修复前 1.0122 < 1.03）',
  minL((x) => x.netShadow, darks) >= SURFACE_DIFF_MIN);
ok('  · 浅色族仍靠 `elev3` 柔影达标（两条通道各有主题依赖，不是"谁永远更强"）',
  minL((x) => x.netShadow, lights) >= SURFACE_DIFF_MIN);

console.log('\n▶ §C 判据：**至少一条通道** ≥ 1.03（面 vs 面已批准标准）');
/**
 * **待路由的 spec 名单**（⛔ 只许**缩短**，不许新增 —— 下一步会断言"实际不达标集合 == 本表"）。
 *
 * `dark`：实测 `max(填充vs底 1.0217, 净影 1.0122) = 1.0217 < 1.03` ⇒ **两条通道都不达标**。
 *   根因（本文件量出来的）：`elevationColorOf(p, ELEV_OVERLAY)` 在深色族给的是
 *   **`#000000@42%`**（`theme.ets:817`）—— 黑影压在近黑画布 `#0B0B0E` 上，边处净效果只有
 *   **1.0122**（等于没有）；同时填充 `#0E0E14` 对画布只有 **1.0217**。
 *   ⚠️ 仓里另有 `shadowColorOf(p,'overlay')`（`theme.ets:893+`）在深色族返回 **`glow`
 *   = accent@45%**（彩色发光）—— 7 处浮层**都没用它**，用的是 `elevationColorOf`。
 *   ⇒ spec 归 **brand-impl**（`core/theme.ets`/`core/design.ets`）：深色浮层要么走发光档，
 *     要么抬填充白度差；⛔ 本线不改 theme/design。
 */
// ✅ 2026-10-11 **已清空**：`dark` 修好（深色浮层改走发光通道 ⇒ 净影达标）⇒ 按纪律从名单**删掉**。
//    ⛔ 本表**只许缩短**（断言"实际不达标集合 == 本表"仍生效 ⇒ 再冒新的不达标主题会立刻红）。
const PENDING_SPEC: string[] = [];

let bad: Row[] = [];
for (let i = 0; i < rows.length; i++) {
  const x = rows[i];
  const best: number = Math.max(x.fillVs, x.netShadow);
  const good: boolean = best >= SURFACE_DIFF_MIN;
  if (!good) { bad.push(x); }
  console.log(`  [${pad(x.t, 11)}] max(填充vs底 ${x.fillVs.toFixed(4)}, 净影 ${x.netShadow.toFixed(4)}) = ${best.toFixed(4)} ≥ ${SURFACE_DIFF_MIN} ⇒ ${good ? '✓' : '✗ 待 spec'}`);
}
ok(`不达标集合 == 已登记 spec 集合 {${PENDING_SPEC.join(',')}}（实际 {${bad.map((x)=>x.t).join(',')}}）`,
  bad.length === PENDING_SPEC.length && bad.every((x) => PENDING_SPEC.indexOf(x.t) >= 0));
ok(`未登记的其它主题全部达标（${rows.length - PENDING_SPEC.length} 套）`,
  rows.filter((x) => PENDING_SPEC.indexOf(x.t) < 0).every((x) => Math.max(x.fillVs, x.netShadow) >= SURFACE_DIFF_MIN));
ok('"影半径"浅色族确实更大（LIGHT_SHADOW_DIFFUSION=1.5 生效）',
  minL((x) => x.r, lights) > Math.max(...darks.map((x) => x.r)));
// ⚠️ 修复后：深色浮层影 = `glow`（accent@45%）⇒ α 由 42% → **45%**，且净影**不再更弱**。
//    "影更浓 ≠ 边界更清楚"这条**洞见仍成立**（正是它把深色从 `#000@42%` 推到发光通道）。
ok('深色浮层影 = 发光档（α 45%）/ 浅色 = 柔影档（α 16%）',
  alphaPct(elevationColorOf(paletteOf('dark'), ELEV_OVERLAY)) === '45%'
  && alphaPct(elevationColorOf(paletteOf('porcelain'), ELEV_OVERLAY)) === '16%');
ok('  · 且深色净影 **不低于** 浅色（修复前是"更浓却更弱"）',
  minL((x) => x.netShadow, darks) >= minL((x) => x.netShadow, lights) - 1e-9);

console.log('\n▶ §D mutation 自证（纯函数，逐条注入）');
// 判据本体：**已登记例外之外**的主题，至少一条通道达标。
function boundaryOk(rs: Row[], exempt: string[]): boolean {
  if (rs.length === 0) { return false; }
  for (let i = 0; i < rs.length; i++) {
    if (exempt.indexOf(rs[i].t) >= 0) { continue; }
    if (Math.max(rs[i].fillVs, rs[i].netShadow) < SURFACE_DIFF_MIN) { return false; }
  }
  return true;
}
ok('真实基线判绿（防"判据恒红"）', boundaryOk(rows, PENDING_SPEC) === true);
ok('mutation：零主题 ⇒ 判红（空扫描防线）', boundaryOk([], PENDING_SPEC) === false);
{
  // 注入 ①：浮层填充=底 且 无影（"面板没有面、影也没有"）⇒ 两条通道同时塌
  const inj: Row[] = rows.map((r) => {
    const y: Row = new Row(); Object.assign(y, r); y.fillVs = 1; y.netShadow = 1; return y;
  });
  ok('mutation：浮层填充=底 且 无影 ⇒ 判红', boundaryOk(inj, PENDING_SPEC) === false);
}
{
  // 注入 ②a：只塌**靠影兜底**的那两套（light/porcelain）的填充 ⇒ 应**仍绿**（影独自够）
  const shadowBacked: string[] = rows.filter((r) => r.netShadow >= SURFACE_DIFF_MIN).map((r) => r.t);
  const injA: Row[] = rows.map((r) => {
    const y: Row = new Row(); Object.assign(y, r);
    if (shadowBacked.indexOf(r.t) >= 0) { y.fillVs = 1; }
    return y;
  });
  ok(`mutation：只塌「靠影兜底」的 ${shadowBacked.join('/')} 的填充 ⇒ 仍绿（影独自够）`,
    boundaryOk(injA, PENDING_SPEC) === true);
}
{
  // 注入 ②b：只塌**靠填充兜底**的那几套的填充 ⇒ 应**判红**（它们没有第二通道）
  // ⚠️ 修复后"靠填充兜底（无影通道）"的集合**已空**（深色也走发光）⇒ 改为**构造**一个两通道都塌的主题，
  //    验证判据仍然抓得住（注入 ① 是"全部塌"，这里只塌**一套**）。
  const injB: Row[] = rows.map((r) => {
    const y: Row = new Row(); Object.assign(y, r);
    if (r.light === false) { y.fillVs = 1; y.netShadow = 1; }   // 只把所有深色套两通道塌掉
    return y;
  });
  ok('mutation：只塌深色族的两条通道 ⇒ 判红（单套注入也抓得住）',
    boundaryOk(injB, PENDING_SPEC) === false);
}
{
  // 注入 ③（**本笔修复的载荷性守卫**）：把深色的影塌回"无影"（模拟回退到 `#000@42%` 的旧行为）
  //   ⇒ 基线立刻红（深色只有填充 1.0217 < 1.03）⇒ 证明"深色改走发光"**是承重的**，不是装饰。
  const injC: Row[] = rows.map((r) => {
    const y: Row = new Row(); Object.assign(y, r);
    if (r.t === 'dark') { y.netShadow = 1; }
    return y;
  });
  ok('mutation：深色影塌回旧行为（#000@42%）⇒ 基线判红（本笔修复承重）',
    boundaryOk(injC, PENDING_SPEC) === false);
}

console.log('\n▼ 摘要');
console.log(`  面差标准 SURFACE_DIFF_MIN = ${SURFACE_DIFF_MIN}（出处 docs/DESIGN-SYSTEM.md §13.3；代码先例 palette_accent_rule.test.ts:55）`);
console.log(`  台阶：浅色 ${minL((x)=>x.step, lights).toFixed(4)} / 深色 ${minL((x)=>x.step, darks).toFixed(4)}`);
console.log(`  净影：浅色 ${minL((x)=>x.netShadow, lights).toFixed(4)} / 深色 ${minL((x)=>x.netShadow, darks).toFixed(4)}`);
console.log('  ⇒ 浅色：白度差 + 柔影；深色：填充(1.0217) + **发光通道**(修复后) ⇒ 两族各有可靠边界。');

if (fail > 0) { console.log(`\n  overlay_boundary_contrast: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  overlay_boundary_contrast: ${pass} passed, 0 failed`);
process.exit(0);

export {};
