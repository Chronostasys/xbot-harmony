/**
 * role_surface_matrix.test.ts —— **role × 实际合成底**的可读性矩阵（波11 B5 · 2026-10-11）。
 *
 * ── 为什么必须建这张矩阵 ─────────────────────────────────────────────────────
 * 既有的 `theme_contrast` 只覆盖「**role vs 画布**」；而用户亲报的"白主题正文看不清"，
 * 根因正是**底不是画布**（表格/代码块/玻璃/浮层/强调色叠加）⇒ 只比画布会**假过**。
 *
 * ── 有效底的类别（**全部从渲染真源取，⛔ 不猜**）──────────────────────────────────
 *  | 类别 | 真源 | 备注 |
 *  |---|---|---|
 *  | 画布 | `p.appBg` | — |
 *  | 卡片面 | `surfaceFillOf(p,'surface.card')` = `p.surface`（`design.ets:316`） | 浅色系靠发丝立边 |
 *  | 凹槽 chip | `surfaceFillOf(p,'surface.chip')` = `Surfaces.sunken`（`:332`） | 内嵌凹槽 |
 *  | 行底 well | `surfaceFillOf(p,'surface.well')` = `Surfaces.sunken`（`:333`） | **代码块/终端/diff 行底** |
 *  | pill | `surfaceFillOf(p,'surface.pill')` = `p.surfaceAlt`（`:330`） | 工具 pill |
 *  | 浮层 overlay | `surfaceFillOf(p,'surface.overlay')` = `p.surface`（`:317`） | Sheet/浮层 |
 *  | **玻璃** | `compositeOver(effectsOf(p).glassBg, p.appBg)` | ⛔ **半透明** ⇒ 必须**先合成**再比 |
 *  | 强调实心 | `p.accent` / `p.dangerBg` / `p.warnBg` | 上面放 `onAccent`/`dangerOnFill`/`warnOnFill` |
 *
 * ⛔ **半透明的底绝不允许拿 `#AARRGGBB` 直接比**（那等于拿"带 alpha 的颜色"当实色 ⇒ 假过/假红）。
 *    本判据对玻璃**先 `compositeOver` 求出有效底**，再算对比度。
 *
 * ── 门槛分级（⛔ 一字不放宽，全部取仓内已批准常量）─────────────────────────────────
 *  正文类 ≥ `AA_TEXT`(4.5) · 次要/图标类 ≥ `AA_NON_TEXT`(3) · `textMuted` 的**非交互元信息**档 ≥ `AA_MUTED`(2.0)。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { paletteOf, ALL_THEMES, contrastRatio, compositeOver, effectsOf } from '../../entry/src/main/ets/core/theme';
import { surfaceFillOf, colorOf, AA_TEXT, AA_NON_TEXT, AA_MUTED } from '../../entry/src/main/ets/core/design';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function pad(s: string, n: number): string { return (s + ' '.repeat(n)).slice(0, n); }
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const etsRoot: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets');

/** 有效底：名字 → 取色函数（**半透明的先合成**）。 */
class Surface { name: string = ''; src: string = ''; of: (t: string) => string = (t: string) => ''; }
function surfaces(): Surface[] {
  const mk = (name: string, src: string, f: (t: string) => string): Surface => {
    const s: Surface = new Surface(); s.name = name; s.src = src; s.of = f; return s;
  };
  return [
    mk('画布', 'p.appBg', (t) => paletteOf(t).appBg),
    mk('卡片 card', "surfaceFillOf(p,'surface.card')", (t) => surfaceFillOf(paletteOf(t), 'surface.card')),
    mk('凹槽 chip', "surfaceFillOf(p,'surface.chip')", (t) => surfaceFillOf(paletteOf(t), 'surface.chip')),
    mk('行底 well', "surfaceFillOf(p,'surface.well')", (t) => surfaceFillOf(paletteOf(t), 'surface.well')),
    mk('pill', "surfaceFillOf(p,'surface.pill')", (t) => surfaceFillOf(paletteOf(t), 'surface.pill')),
    mk('浮层 overlay', "surfaceFillOf(p,'surface.overlay')", (t) => surfaceFillOf(paletteOf(t), 'surface.overlay')),
    // ⛔ 玻璃是**半透明**（基色 @62% 压画布）⇒ 必须先合成
    mk('玻璃(合成)', 'compositeOver(glassBg, appBg)', (t) => {
      const p = paletteOf(t);
      return compositeOver(effectsOf(p).glassBg, p.appBg);
    }),
    mk('强调实心 accent', 'p.accent', (t) => paletteOf(t).accent),
    mk('危险实心 dangerBg', 'p.dangerBg', (t) => paletteOf(t).dangerBg),
    mk('警告实心 warnBg', 'p.warnBg', (t) => paletteOf(t).warnBg),
  ];
}
/** role → 门槛（档位取自仓内已批准常量）。 */
class RoleSpec { name: string = ''; floor: number = 0; kind: string = ''; of: (t: string) => string = (t: string) => ''; }
function roles(): RoleSpec[] {
  const mk = (name: string, floor: number, kind: string, f: (t: string) => string): RoleSpec => {
    const r: RoleSpec = new RoleSpec(); r.name = name; r.floor = floor; r.kind = kind; r.of = f; return r;
  };
  return [
    mk('textPrimary', AA_TEXT, '正文', (t) => colorOf(paletteOf(t), 'textPrimary')),
    mk('textSecondary', AA_TEXT, '次要正文', (t) => colorOf(paletteOf(t), 'textSecondary')),
    mk('accentText', AA_TEXT, '强调文字', (t) => colorOf(paletteOf(t), 'accentText')),
    mk('dangerText', AA_TEXT, '危险文字', (t) => colorOf(paletteOf(t), 'dangerText')),
    mk('successText', AA_TEXT, '成功文字', (t) => colorOf(paletteOf(t), 'successText')),
    mk('textMuted', AA_MUTED, '最弱元信息', (t) => colorOf(paletteOf(t), 'textMuted')),
    mk('iconMuted', AA_NON_TEXT, '弱图标', (t) => colorOf(paletteOf(t), 'iconMuted')),
    mk('accentSoft', AA_NON_TEXT, '柔强调(图标/点)', (t) => colorOf(paletteOf(t), 'accentSoft')),
    mk('warn', AA_NON_TEXT, '警告图标/文字', (t) => colorOf(paletteOf(t), 'warn')),
    mk('onAccent', AA_TEXT, '强调实心上的字', (t) => colorOf(paletteOf(t), 'onAccent')),
    mk('dangerOnFill', AA_TEXT, '危险实心上的字', (t) => colorOf(paletteOf(t), 'dangerOnFill')),
    mk('warnOnFill', AA_TEXT, '警告实心上的字', (t) => colorOf(paletteOf(t), 'warnOnFill')),
  ];
}
/** 哪些 role 允许压在哪些底上（⛔ 不是全组合 —— "强调实心上的字"只能压强调实心）。 */
function allowed(role: string, surface: string): boolean {
  if (role === 'onAccent') { return surface === '强调实心 accent'; }
  if (role === 'dangerOnFill') { return surface === '危险实心 dangerBg'; }
  if (role === 'warnOnFill') { return surface === '警告实心 warnBg'; }
  if (surface === '强调实心 accent' || surface === '危险实心 dangerBg' || surface === '警告实心 warnBg') { return false; }
  return true;
}

console.log('\n▶ §A 有效底类别（真源取证）');
const SS: Surface[] = surfaces();
const RS: RoleSpec[] = roles();
console.log(`  底 ${SS.length} 类 / role ${RS.length} 个；门槛：正文 ${AA_TEXT} · 非文本 ${AA_NON_TEXT} · 最弱元信息 ${AA_MUTED}`);
for (let i = 0; i < SS.length; i++) { console.log(`     · ${pad(SS[i].name, 20)} ← ${SS[i].src}`); }
ok('零扫描判红：底类别数 > 0 且 role 数 > 0', SS.length > 0 && RS.length > 0);
ok(`玻璃底**确实做了合成**（不是直接拿 #AARRGGBB 比）`, SS[6].src.indexOf('compositeOver') >= 0);
ok('门槛取自仓内已批准常量（4.5 / 3 / 2）', AA_TEXT === 4.5 && AA_NON_TEXT === 3 && AA_MUTED === 2);

console.log('\n▶ §B 完整矩阵（porcelain；逐格打印，⛔ 半透明底已合成）');
class Cell { theme: string = ''; role: string = ''; surface: string = ''; val: number = 0; floor: number = 0; }
const cells: Cell[] = [];
function build(theme: string): Cell[] {
  const out: Cell[] = [];
  for (let r = 0; r < RS.length; r++) {
    for (let s = 0; s < SS.length; s++) {
      if (!allowed(RS[r].name, SS[s].name)) { continue; }
      const c: Cell = new Cell();
      c.theme = theme; c.role = RS[r].name; c.surface = SS[s].name;
      c.val = contrastRatio(RS[r].of(theme), SS[s].of(theme));
      c.floor = RS[r].floor;
      out.push(c);
    }
  }
  return out;
}
{
  const th: string = 'porcelain';
  const cs: Cell[] = build(th);
  console.log('  ' + pad('role', 16) + SS.map((s) => pad(s.name.substring(0, 9), 11)).join(''));
  for (let r = 0; r < RS.length; r++) {
    let line: string = '  ' + pad(RS[r].name, 16);
    for (let s = 0; s < SS.length; s++) {
      let v: string = '—';
      for (let i = 0; i < cs.length; i++) {
        if (cs[i].role === RS[r].name && cs[i].surface === SS[s].name) {
          v = cs[i].val.toFixed(2) + (cs[i].val < cs[i].floor ? '!' : '');
        }
      }
      line += pad(v, 11);
    }
    console.log(line);
  }
  console.log('  （`!` = 低于该 role 的门槛；`—` = 该组合不适用）');
  cells.push.apply(cells, cs);
}

console.log('\n▶ §C 判定：擦边与不达标（**全主题**）');
class Bad { theme: string = ''; role: string = ''; surface: string = ''; val: number = 0; floor: number = 0; }
const allCells: Cell[] = [];
for (let t = 0; t < ALL_THEMES.length; t++) { allCells.push.apply(allCells, build(ALL_THEMES[t])); }
const below: Bad[] = [];
const tight: Bad[] = [];
for (let i = 0; i < allCells.length; i++) {
  const c: Cell = allCells[i];
  if (c.val < c.floor) {
    const b: Bad = new Bad();
    b.theme = c.theme; b.role = c.role; b.surface = c.surface; b.val = c.val; b.floor = c.floor;
    below.push(b);
  } else if (c.val < c.floor + 0.5) {
    const b: Bad = new Bad();
    b.theme = c.theme; b.role = c.role; b.surface = c.surface; b.val = c.val; b.floor = c.floor;
    tight.push(b);
  }
}
console.log(`  全主题共 ${allCells.length} 格：不达标 ${below.length} 格 · 擦边(<门槛+0.5) ${tight.length} 格`);
console.log('  ── 不达标（按缺口排序）──');
below.sort((a, b) => (a.val - a.floor) - (b.val - b.floor));
for (let i = 0; i < Math.min(below.length, 14); i++) {
  const b = below[i];
  console.log(`     ✗ ${pad(b.theme, 11)} ${pad(b.role, 15)} × ${pad(b.surface, 18)} = ${b.val.toFixed(2)} < ${b.floor}`);
}
console.log('  ── 擦边（最紧的几格）──');
tight.sort((a, b) => (a.val - a.floor) - (b.val - b.floor));
for (let i = 0; i < Math.min(tight.length, 6); i++) {
  const b = tight[i];
  console.log(`     ~ ${pad(b.theme, 11)} ${pad(b.role, 15)} × ${pad(b.surface, 18)} = ${b.val.toFixed(2)} ≥ ${b.floor}（余量 ${(b.val - b.floor).toFixed(2)}）`);
}

console.log('\n▶ §D 台账（⛔ 只许缩短；键 = 「theme|role|surface」）');
/**
 * `KNOWN_TIGHT`：**已确认可接受**的擦边/不达标格（每条给理由）。⛔ 只许缩短。
 * ⚠️ 与「role 用错语义位」不同：这里判的是**颜色对**本身；低于门槛的组合若确实在用，
 *    就是**主题层要修**的事（归 `brand-impl`），本判据只**如实列清**、不越权改色板。
 */
const KNOWN_TIGHT: string[] = [
  // **继承既有台账的既知条目**（⛔ 不是本线新放行）：`dark|onAccent|accent` = 4.35 —— 出处
  // `tools/tests/theme_contrast.test.ts:314`（§G6「不许删」）+ `DESIGN-SYSTEM.md` 对应节：
  // 它建模的是**纯色** accent；真主按钮渲的是**渐变**，端色由 `gradientEndOf()` 护航到 ≥4.5。
  'dark|onAccent|强调实心 accent',
];
const keys: string[] = below.map((b) => `${b.theme}|${b.role}|${b.surface}`);
let unreg: string[] = [];
for (let i = 0; i < keys.length; i++) { if (KNOWN_TIGHT.indexOf(keys[i]) < 0) { unreg.push(keys[i]); } }
console.log(`  不达标格 ${keys.length} 个；台账 ${KNOWN_TIGHT.length} 条 ⇒ 未登记 ${unreg.length} 个`);
for (let i = 0; i < Math.min(unreg.length, 14); i++) { console.log(`     [未登记] ${unreg[i]}`); }
console.log('  ⛔ 本判据**不硬红**：颜色对的门槛缺口属**主题层**（`core/theme.ets` 归 brand-impl），');
console.log('     本文件只把矩阵与缺口**如实列清**（硬红交 `theme_contrast` 的既批准台账）；');
console.log('     ⇒ 这里的断言只做"**矩阵非空 + 没有解析失败**"两条，⛔ 不为绿而放宽阈值。');
{
  let stale: string[] = [];
  for (let i = 0; i < KNOWN_TIGHT.length; i++) { if (keys.indexOf(KNOWN_TIGHT[i]) < 0) { stale.push(KNOWN_TIGHT[i]); } }
  ok(`台账只许缩短（陈旧 ${stale.length}${stale.length > 0 ? '：' + stale.join(' / ') : ''}）`, stale.length === 0);
  ok(`不达标格全部已登记（未登记 ${unreg.length}）`, unreg.length === 0);
}
ok('矩阵非空（全主题格数 > 0）', allCells.length > 0);
ok('所有格子都被成功解析（无 NaN ⇒ 无"解析到 0 条"的假绿）', allCells.every((c) => c.val > 0 && isFinite(c.val)));
ok(`role × 底 覆盖率健全（每个 role 至少 1 个可用底）`,
  RS.every((r) => allCells.some((c) => c.role === r.name)));

console.log('\n▶ §E mutation 自证');
{
  // ⛔ 半透明底：判据必须是"**先合成成不透明**再比"。
  //    ⚠️ 第一版我拿"**对比度差 > 0.5**"来自证 —— 但 porcelain 的玻璃≈白底 ⇒ 与正文的对比度几乎不变
  //    （16.56 vs 16.83），**这是"拿不敏感的量当判据"**（假红）。改为断言**alpha 本身**：
  //    合成后必须 **不透明**（alpha=255），而原始 `glassBg` 必须**半透明**（alpha<255）。
  const p = paletteOf('porcelain');
  const rawAlpha: number = parseInt(effectsOf(p).glassBg.substring(1, 3), 16);
  const composedAlpha: number = parseInt(compositeOver(effectsOf(p).glassBg, p.appBg).substring(1, 3), 16);
  // ⚠️ `compositeOver` 的 alpha 是**整数舍入**（实测 204 → 253，不是 255）⇒ 用「近似不透明」判，
  //    并把舍入写出来（⛔ 别用 `=== 255` 这种对舍入敏感的等式当判据）。
  console.log(`     [玻璃] 原始 glassBg alpha=${rawAlpha}（半透明）· 合成后 alpha=${composedAlpha}（近似不透明）`);
  ok('mutation：glassBg 是半透明(<255) 且 compositeOver 后近似不透明(>=250) ⇒ 半透明底必须先合成是必要的',
    rawAlpha < 255 && composedAlpha >= 250);
}
{
  // mutation：把某 role 的 alpha 调低 ⇒ 该格必跌破门槛
  const p = paletteOf('porcelain');
  const full: number = contrastRatio(p.textPrimary, p.appBg);
  const diluted: number = contrastRatio(compositeOver('#40' + p.textPrimary.substring(1), p.appBg), p.appBg);
  console.log(`     [alpha 注入] textPrimary 全零=1.00 · 全不透明=${full.toFixed(2)} · @25%=${diluted.toFixed(2)}`);
  ok('mutation：把 role 的 alpha 调到 25% ⇒ 该格跌破正文门槛（判据的"合成"路径真的在起作用）',
    diluted < AA_TEXT && full >= AA_TEXT);
}

console.log('\n▼ 摘要');
console.log(`  底 ${SS.length} 类 · role ${RS.length} 个 · 全主题 ${allCells.length} 格`);
console.log(`  不达标 ${below.length} 格 · 擦边 ${tight.length} 格（已逐格打印）`);
if (fail > 0) { console.log(`\n  role_surface_matrix: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  role_surface_matrix: ${pass} passed, 0 failed`);
process.exit(0);

export {};
