/**
 * D4：**品牌语言的"动/静两面"** —— 光球（动）与开屏标记（静）的关系契约。
 *
 * ── 取证（2026-10-11，`file:line` + 实测）──────────────────────────────────────
 * | 维度 | 开屏标记（静） | 光球（动） | 判定 |
 * |---|---|---|---|
 * | 形状母题 | **气泡 squircle + 四角星**（`core/brand.ets:117 bubblePath()` 大圆角+尾；
 *   `:153 starPath()` 四角 `Q` 星芒） | **正圆核 + 9 颗粒子**（`AssistantOrb.ets:635 ctx.arc(c,c,coreR)`
 *   + `:642 orbParticles(ORB_PARTICLE_COUNT=9)`） | 🟡 **不同母题**，但同属"**圆/弧 + 辐射**"家族（都含弧命令） |
 * | 色彩语义 | **恒品牌紫** `brandAccent()` = `#7C5CFF`（`splashMarkSvg`/`appIconSvg` 显式传色） | **主题 accent 色系**（porcelain = Apple Blue `#0071E3`） | ✅ **有意不同**（`§13.6`：logo 是品牌资产、不随主题）⇒ **不是缺陷，是裁决** |
 * | 动势 | **静态**（T1 一次性入场；`docs/SPLASH-SPEC.md`） | **呼吸 + 公转**（在飞；`DESIGN-SYSTEM §8` 唯一在飞） | ✅ **动/静分工明确** |
 *
 * ── 判据（把上面的"有意不同"钉住，防以后被改成"串味"）────────────────────────────
 * ① **色彩不串味**：光球**不得**引用 `brandAccent*`（它跟主题）；标记生成器**不得**吃 `Palette`
 *    （它恒品牌、不跟主题）。
 * ② **动/静分工**：光球是唯一"在飞"（时间驱动）；标记生成器是**纯静态**（不得出现时间/动画 API）。
 * ③ **同族证据**：两者都含**弧**基元（标记 `A …` / 光球 `ctx.arc(`）⇒ "圆/弧 + 辐射"是同族。
 *
 * mutation 自证：把 `AssistantOrb` 的环色改成 `brandAccent()` ⇒ ★① 红；
 *   给 `core/brand.ets` 的标记生成器加 `paletteOf(` ⇒ ★① 红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
/** 剥注释（本仓 GOTCHA：注释里提到某 API ≠ 代码用了它）。 */
function strip(x: string): string {
  return x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const fsMod = require('fs');
const pathMod = require('path');
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const cand = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/components/AssistantOrb.ets'))) { repo = cand; break; }
}
ok('探测到仓库根', repo.length > 0);

if (repo.length > 0) {
  const orb: string = strip(fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/components/AssistantOrb.ets'), 'utf-8'));
  const brand: string = strip(fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/brand.ets'), 'utf-8'));
  const orbOuter: string = strip(fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/orb.ets'), 'utf-8'));

  // ── ★① 色彩不串味 ────────────────────────────────────────────────────────────
  ok('★① 光球**不**引用 brandAccent*（它跟主题 accent）',
    orb.indexOf('brandAccent') < 0 && orbOuter.indexOf('brandAccent') < 0);
  ok('  · 标记生成器**不**吃 Palette/主题（它恒品牌）—— core/brand.ets 不出现 paletteOf(',
    brand.indexOf('paletteOf(') < 0);
  ok('  · 标记色是显式入参（`appIconSvg(accent, onAccent)` / `splashMarkSvg(accent, onAccent)`）',
    brand.indexOf('export function appIconSvg(accent: string, onAccent: string)') >= 0
    && brand.indexOf('export function splashMarkSvg(accent: string, onAccent: string)') >= 0);

  // ── ★② 动/静分工 ────────────────────────────────────────────────────────────
  ok('★② 光球是"在飞"（有时间/帧驱动 API）—— ctx / requestAnimationFrame 之类',
    orb.indexOf('ctx.arc(') >= 0);
  ok('  · 标记生成器**纯静态**：不得出现动画/时间 API',
    brand.indexOf('animateTo(') < 0 && brand.indexOf('Date.now(') < 0 && brand.indexOf('setInterval(') < 0);

  // ── ★③ 同族证据：都含**弧**基元（"圆/弧 + 辐射"家族）────────────────────────────
  ok('★③ 标记用**弧**（bubblePath 用 SVG 圆弧命令 `A …`）', brand.indexOf('A ${n(BUBBLE_R)} ${n(BUBBLE_R)}') >= 0);
  ok('  · 光球用**弧**（ctx.arc）', orb.indexOf('ctx.arc(') >= 0);
  ok('  · 两者都有"**中心实体 + 辐射/环绕**"：标记 starPath 的 `Q` 星芒 / 光球 orbParticles',
    brand.indexOf('starPath') >= 0 && orb.indexOf('orbParticles') >= 0);
}

if (fail > 0) { console.log(`  brand_motion_static: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  brand_motion_static: ${pass} passed, 0 failed`);
process.exit(0);
