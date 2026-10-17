/**
 * 登录页「白主题收尾」契约测试（`/tmp/wave6-porcelain.md` 的 🟡-V1 / 🟡-V2）。
 *
 * 两处**可见**项（都在 `pages/Index.ets` 的 `LoginView()`）：
 *   · 🟡-V1 应用徽标：porcelain 下 `eff().gradientFrom/To` = `#0071E3→#0066CC` ⇒ 纯白画布上一块
 *     **蓝渐变牌**（与"极简白"的干净气质冲突，且违 `docs/REDESIGN.md §3.4`"白底禁彩色渐变当牌"）。
 *   · 🟡-V2 登录底垂直渐变：porcelain 下 `#FFFFFF→#F6F6F7→#FFFFFF`（对比度 ≈1.0，肉眼零差）
 *     ⇒ 纯空转一次全屏渐变，且违 §3.4"白底不靠渐变立层次"。
 *
 * 修法：**浅色面**改中性（`surface.card` + `hairlineOf` + `brandAccentFor(p)` glyph）/ 不画底渐变；
 * **深色面逐字节不变**（本仓铁律）。
 *
 * 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译，`pages/**` 不进 harness
 * ⇒ 页面层无法直接 import 单测。本仓先例：`tools/tests/empty_star_glow.test.ts`、
 * `tools/tests/inflight_language.test.ts`（读源码做形态断言）。
 *
 * mutation 自证（两条都必须红）：
 *   ① 把浅色分支改回 `.linearGradient({ angle: 135, colors: [[this.eff().gradientFrom …` ⇒ ★V1 红；
 *   ② 把底渐变的 `if (!isLightPalette(this.pal())) {` 去掉 ⇒ ★V2 红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { porcelainPalette, darkPalette, isLightPalette, effectsOf } from '../../entry/src/main/ets/core/theme';
import { brandAccentFor } from '../../entry/src/main/ets/core/brand';
import { surfaceFillOf, hairlineOf } from '../../entry/src/main/ets/core/design';

function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
// `eq` 定义在下方（用 pass/fail，故此处不重复声明）
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}

const fsMod = require('fs');
const pathMod = require('path');

// `run.sh`/`run-one.sh` 把测试编到 `<repo>/tools/tests/.out-*/` 下（层级随 harness 变化）
// ⇒ 从 `__dirname` 向上探测到真正含 `entry/src/...` 的那层（⛔ 不硬编码层级）。
let repo: string = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const p: string = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(p, 'entry/src/main/ets/pages/Index.ets'))) { repo = p; break; }
}
ok('探测到仓库根（用于读 Index.ets）', repo.length > 0);
const indexSrc: string = repo.length > 0
  ? fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/pages/Index.ets'), 'utf-8').replace(/i18nT\(([^()]*)\)/g, '$1')
  : '';

/** 取块：从 `start` 锚点到 `end` 锚点（都不含 end）。 */
function block(src: string, startAnchor: string, endAnchor: string): string {
  const s: number = src.indexOf(startAnchor);
  if (s < 0) { return ''; }
  const e: number = src.indexOf(endAnchor, s + startAnchor.length);
  return e < 0 ? '' : src.substring(s, e);
}

// 徽标块：从「应用徽标」注释到它之后的说明文字（`Text('连接你的 xbot 服务端` 之前）。
const logo: string = block(indexSrc, '// 应用徽标：ArkUI 的', "Text('连接你的 xbot 服务端");
// 登录底块：从「深空底」注释到「顶部光晕」注释之前。
const backdrop: string = block(indexSrc, '// ── 深空底：垂直渐变', '// ── 顶部光晕');

// ═══ 🟡-V1 应用徽标 ═══════════════════════════════════════════════════════════
ok('徽标块可定位', logo.length > 400);
// 浅/深分叉存在，且**唯一**判据是亮度口径（⛔ 不按主题名硬判）
has(logo, 'isLightPalette(this.pal())', 'V1: 浅/深按 isLightPalette 分叉（亮度口径）');
hasNot(logo, 'isDarkThemeName(', 'V1: 不按主题名硬判（isDarkThemeName 不得出现在此块）');
// 浅色分支：中性面 + 结构性发丝 + 品牌色 glyph（= 本主题 accent，porcelain #0071E3）
has(logo, "surfaceFillOf(this.pal(), 'surface.card')", 'V1: 浅色面用中性面 surface.card（白底靠发丝+柔影）');
has(logo, 'hairlineOf(this.pal())', 'V1: 浅色面用结构性发丝 hairlineOf');
has(logo, 'brandAccentFor(this.pal())', 'V1: 浅色面 glyph 用本主题品牌色 brandAccentFor(p)');
// 深色分支**逐字节不变**：品牌渐变 + onAccent glyph + glassBorder
has(logo, 'colors: [[this.eff().gradientFrom, 0.0], [this.eff().gradientTo, 1.0]]',
  'V1: 深色面仍是 brand 渐变（gradientFrom→gradientTo，取值未动）');
has(logo, ".fontColor(this.pal().onAccent)", 'V1: 深色面 glyph 仍是 onAccent');
has(logo, "color: this.eff().glassBorder", 'V1: 深色面描边仍是 glassBorder');
// 浅色面**不得**再刷彩色渐变牌：整个徽标块只在【深色分支】里允许出现一处分叉后的 linearGradient
ok('V1: 徽标块内恰好 1 处 linearGradient（= 深色分支那一处；浅色面零渐变）',
  (logo.match(/\.linearGradient\(/g) || []).length === 1);
// 颜色字面量：由下方「剥注释后零 #RRGGBB」通用检查覆盖（⛔ 注释里记色值是允许的）

// ═══ 🟡-V2 登录底垂直渐变（仅深色）═══════════════════════════════════════════
ok('登录底块可定位', backdrop.length > 80);
has(backdrop, 'if (!isLightPalette(this.pal())) {', 'V2: 底渐变被"非浅色"分支包住 ⇒ 仅深色渲染');
// 深色那支的参数**逐字节不变**（三端 appBg→surfaceAlt→appBg，angle 180）
has(backdrop, 'angle: 180', 'V2: 深色底渐变 angle 未动（180）');
has(backdrop, 'colors: [[this.pal().appBg, 0.0], [this.pal().surfaceAlt, 0.52], [this.pal().appBg, 1.0]]',
  'V2: 深色底渐变三端未动（appBg→surfaceAlt→appBg）');
hasNot(backdrop, 'isDarkThemeName(', 'V2: 不按主题名硬判');

// ═══ 通用：这两块的**代码**都不得出现颜色字面量（⛔ 注释里记色值是允许/鼓励的 ⇒ 先剥注释）═══
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
{
  const code: string = stripComments(logo + '\n' + backdrop);
  const hits = code.match(/#[0-9A-Fa-f]{6}\b/g);
  ok('两块的取色全走令牌（剥注释后零 #RRGGBB）', hits === null);
  // 剥注释后**仍必须**能看到品牌色入口（证明是真调用、不是只写在注释里）
  has(stripComments(logo), 'brandAccentFor(this.pal())', 'V1: brandAccentFor 是**代码**调用（非注释）');
}

// ═══ 纯数值：两条分支各自的**实际取值**（真函数跑，非手抄）═══════════════════════════
{
  const pc = porcelainPalette();
  const dk = darkPalette();
  // 分支判据（唯一口径 = 亮度）
  ok('porcelain 走**浅色**分支（isLightPalette）', isLightPalette(pc));
  ok('dark 走**深色**分支（!isLightPalette）', !isLightPalette(dk));
  // 浅色分支：glyph 色 = 本主题品牌色 = porcelain accent（Apple Blue）；底 = 中性白面
  eq('浅色 glyph = brandAccentFor(porcelain) = #0071E3', brandAccentFor(pc), '#0071E3');
  eq('浅色徽标底 = surface.card = #FFFFFF（中性，非蓝）', surfaceFillOf(pc, 'surface.card'), '#FFFFFF');
  eq('浅色发丝 = hairlineOf(porcelain) ≠ 画布（真看得见）',
    hairlineOf(pc) === '#FFFFFF' ? 'INVISIBLE' : 'ok', 'ok');
  // 浅色面**不得**是彩色（对比 ① 的"实心品牌色"口径）：底就是白，零彩色
  ok('浅色徽标底**无彩色**（= 纯白 ⇒ 不是"蓝块"）', surfaceFillOf(pc, 'surface.card') === '#FFFFFF');
  // 深色分支：品牌渐变两端仍是深色主题的 Effects 值（我**未改** theme.ets ⇒ 取值由构造保证不变；
  // 这里钉住"它们仍是非空且来自 Effects"，配合全量门禁里 theme/brand 测试全绿 = 无回归）
  const de = effectsOf(dk);
  ok('深色品牌渐变两端非空（来自 effectsOf(dark)，theme.ets 未改动）',
    de.gradientFrom.length > 0 && de.gradientTo.length > 0);
  ok('深色 onAccent 非空（glyph 仍是反色）', dk.onAccent.length > 0);
}

if (fail > 0) { console.log(`  porcelain_login: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  porcelain_login: ${pass} passed, 0 failed`);
process.exit(0);
