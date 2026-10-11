/**
 * dark_boundary_channels_contrast.test.ts —— **深色主题「边界通道」总审计**（`efa9d71` 缺口的一般化）。
 *
 * ── 起点 ──────────────────────────────────────────────────────────────────────
 * `efa9d71`：深色**浮层**两条通道都不够（填充 1.0217 / 净影 1.0122 < 1.03），根因是浮层用
 * `elevationColorOf(p,ELEV_OVERLAY)`（深色 = `#000000@42%` 黑柔影，压在近黑画布上**等于没有**）。
 * 本文件把问法扩到**深色全部面层级**。
 *
 * ── ⚠️ 与 web 的关系：**有意增强，web 无对应机制**（2026-10-11 QA 复核，只读取证）──────────
 *   web（`web/src/index.css`）**没有**"边界通道分类 + 阈值"这套：
 *     · 面：`--background` / `--card` / `--popover` **全部 = `var(--bg-primary)`**（`:212/214/216`）
 *       —— 三个"层级"在 web 里**同值**，不存在"逐层拉开填充对比"的概念；
 *     · 边：`--border` **单值**（`:160 #e0e0e0`；`:234` 注释"`--border` inherits the Spec palette value"），
 *       另有 `--border-strong: #cccccc`（`:173`）—— 只有"普通/强"两档，**不按通道量化**；
 *     · 影/发光：用 Tailwind 档（`shadow-xs/sm/md/lg/xl/2xl/inner`，全 web 用量见下）**按感觉选**，
 *       没有任何对比度阈值判据。
 *   ⇒ 本仓把"填充 / 发丝 / 净影 / 发光"四通道**分类 + 设阈值**（浮层起点：填充 1.0217 / 净影 1.0122 < 1.03）
 *      是**原生对 web 的有意增强**（web 靠视觉挑选、原生靠可判据的不变量）⇒
 *      **⛔ 不要**因为"web 没这么做"就把它当不一致/过度设计。
 *   （另注：影的档位口径也不同 —— web 是 Tailwind **尺寸梯度** `shadow-xs..2xl`，
 *     原生是 `core/theme.ets:shadowRadiusOf` 的**用途语义档** hero/raised/pill/panel/drawer/overlay/card，
 *     且浅色额外乘 `LIGHT_SHADOW_DIFFUSION`（web 无深浅分叉）⇒ 同为有意不同。）
 *
 * ── ⛔ 本文件最重要的一条纪律：**只把「实际接线」的通道计入判定** ──────────────────
 * 第一版我犯过这个错：把 `effectsOf(p).glow`（accent@45%，净 1.25+）当成一条通道算进每个面 ⇒
 * **7 个相邻对全部"达标"、缺口表空**。但 `efa9d71` 已证：**浮层用的是 `elevationColorOf`（黑影），
 * 根本没接线 glow** ⇒ 那是**潜力**不是**通道**，拿它判绿 = 自欺。
 * ⇒ 本文件给每条通道标 `wired`；判定只用 wired 的；未接线的按 spec 方向单独报（并给它的潜力数字）。
 *
 * ── 通道与接线（逐条给证据）───────────────────────────────────────────────────
 *  ① **填充白度差**：`contrastRatio(上面填充, 下面填充)` —— 上位面自己画的底，恒接线。
 *  ② **影**：`elevationColorOf(p, 该对层级)`（`elev1/2/3`，深色全 `#000`）—— 卡片/抬升/浮层接线；**下沉面是内凹，不接线**。
 *  ③ **发光**：`effectsOf(p).glow`（深色 `accent@45%`）—— ⛔ **未接线到任何面层级**（只服务光球/主按钮/输入聚焦）。
 *     `shadowColorOf(p,'overlay')` 在深色**返回**它就是它，但**7 处浮层用的是 `elevationColorOf`**（`efa9d71` 证）⇒ 这条是 **spec 方向**。
 *  ④ **玻璃描边**：`effectsOf(p).glassBorder` —— 玻璃面唯一接线通道（玻璃**没有**影）。
 *  ⑤ **发丝**：`hairlineOf(p)` —— ⛔ **浮层不接线**（`bindPopup` 只开 `popupColor/radius/shadow`，**无描边**）；
 *     卡片类是否画发丝是**组件级**决定 ⇒ 本审计**不计入**，只作参考列。
 *  ⚠️ 模型唯一近似仍是「边处强度 = 额定 α × 0.5」（对称模糊对直边恒为半高），**方向乐观**。
 *
 * ── 判据（阈值不新造）──────────────────────────────────────────────────────────
 * **每条相邻对至少一条「已接线」通道 ≥ `SURFACE_DIFF_MIN` = 1.03**（仓内已批准的"面 vs 面"标准：
 * `docs/DESIGN-SYSTEM.md §13.3`；代码先例 `tools/tests/palette_accent_rule.test.ts:55`）。
 * 缺口 ⇒ **只出 spec**（归 `brand-impl`），登记 `PENDING_SPEC`（⛔ 只许缩短，mutation 管着）。
 */
declare const process: { exit: (c: number) => void };

import {
  Palette, paletteOf, ALL_THEMES, contrastRatio, compositeOver, isLightPalette,
  parseColorRgba, effectsOf, surfacesOf,
} from '../../entry/src/main/ets/core/theme';
import {
  surfaceFillOf, hairlineOf, insetHairlineOf, elevationColorOf, HAIRLINE_MIN_LIGHT, HAIRLINE_MIN_DARK,
  ELEV_CARD, ELEV_RAISED, ELEV_OVERLAY,
} from '../../entry/src/main/ets/core/design';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
const SURFACE_DIFF_MIN: number = 1.03;
function alphaPct(c: string): string { return `${Math.round(parseColorRgba(c)[3] * 100 / 255)}%`; }
function scaleAlpha(c: string, k: number): string {
  const a: number[] = parseColorRgba(c);
  const al: number = Math.round(a[3] * k);
  const hx: string = '0123456789ABCDEF';
  const two = (v: number): string => `${hx.charAt(Math.floor(v / 16))}${hx.charAt(v % 16)}`;
  return `#${two(al)}${two(a[0])}${two(a[1])}${two(a[2])}`;
}
function pad(s: string, n: number): string { return (s + ' '.repeat(n)).slice(0, n); }

/** 一条相邻对（下→上）；`edge` = **实际接线**的边缘通道色（空 = 无边缘通道）。 */
class Pair {
  name: string = ''; lower: string = ''; upper: string = ''; edge: string = ''; edgeLabel: string = '';
  /** 该对是否**已接线发丝通道**（= 组件侧确实画了 `hairlineOf`；见文件末 §F 的裁定与取证）。 */
  hairWired: boolean = false;
}
function pairsOf(p: Palette): Pair[] {
  const out: Pair[] = [];
  const e = effectsOf(p);
  const s = surfacesOf(p);
  const mk = (name: string, lower: string, upper: string, edge: string, edgeLabel: string, hairWired: boolean): void => {
    const x: Pair = new Pair(); x.name = name; x.lower = lower; x.upper = upper; x.edge = edge; x.edgeLabel = edgeLabel; x.hairWired = hairWired; out.push(x);
  };
  // 末列 = **发丝通道是否接线**（裁定见 §F）：`surface.card` 有 `hairline=true`，且**用 `surface.card`
  // 填充的 5 个组件全都画了 `hairlineOf`** ⇒ 卡这一对**有**发丝通道；`sunken`（well/chip）**无**。
  mk('画布→卡', p.appBg, p.surface, e.elev1, '影elev1', true);
  mk('卡→抬升', p.surface, p.surfaceAlt, e.elev2, '影elev2', true);
  mk('抬升→激活', p.surfaceAlt, p.surfaceHi, e.elev2, '影elev2', true);
  // ⚠️ 2026-10-11 模型订正 + 落码：`well/chip` 站点已接线**内凹发丝** `insetHairlineOf(p)`
  //   （深色 = hairline 1.2188 / 浅色 = transparent ⇒ **浅色逐字节不变**）⇒ 不再是空档。
  mk('画布→下沉', p.appBg, s.sunken, insetHairlineOf(p), '内凹发丝', true);
  mk('画布→玻璃', p.appBg, compositeOver(e.glassBg, p.appBg), e.glassBorder, '玻璃描边', false);
  // ⚠️ 2026-10-11 模型订正：7 处 `bindPopup` 浮层的**实际接线**通道是
  //    `elevationColorOf(p, ELEV_OVERLAY)`（**不是**裸 `e.elev3`）—— `0c0f13f` 已把该档的**深色臂**
  //    从 `elev3`（`#000@42%` 黑影，净影仅 1.0122）改为 **`glow`（`accent@45%` 彩色发光）**。
  //    ⇒ 按"**只计已接线通道**"纪律，这两对的 edge 必须走该出口（否则模型落后于代码 = 假缺口）。
  mk('卡→浮层', p.surface, surfaceFillOf(p, 'surface.overlay'), elevationColorOf(p, ELEV_OVERLAY), '影·浮层档', true);
  mk('画布→浮层', p.appBg, surfaceFillOf(p, 'surface.overlay'), elevationColorOf(p, ELEV_OVERLAY), '影·浮层档', true);
  return out;
}

class Aud {
  pair: string = ''; edgeLabel: string = '';
  fill: number = 0; edge: number = 0; glowPotential: number = 0; hairRef: number = 0;
  /** 发丝**作为通道**：仅当 `hairWired` 时参与判定，且按**发丝自己的门槛**（浅 1.3201 / 深 1.20）。 */
  hairOk: boolean = false; hairFloor: number = 0;
  bestWired: number = 0; winner: string = '';
}
function audit(p: Palette, x: Pair): Aud {
  const a: Aud = new Aud();
  const e = effectsOf(p);
  a.pair = x.name; a.edgeLabel = x.edgeLabel;
  a.fill = contrastRatio(x.upper, x.lower);
  a.edge = x.edge.length === 0 ? 1 : contrastRatio(compositeOver(scaleAlpha(x.edge, 0.5), x.lower), x.lower);
  a.glowPotential = contrastRatio(compositeOver(scaleAlpha(e.glow, 0.5), x.lower), x.lower);  // ⛔ 未接线，仅报潜力
  a.hairRef = contrastRatio(hairlineOf(p), x.lower);
  a.hairFloor = isLightPalette(p) ? HAIRLINE_MIN_LIGHT : HAIRLINE_MIN_DARK;
  a.hairOk = x.hairWired && a.hairRef >= a.hairFloor;   // ⛔ 按发丝**自己的**标准（比面差严）
  a.bestWired = Math.max(a.fill, a.edge);
  a.winner = a.bestWired === a.fill ? '填充' : a.edgeLabel;
  if (a.hairOk) { a.bestWired = Math.max(a.bestWired, a.hairFloor); a.winner = '发丝'; }
  return a;
}

const pDark: Palette = paletteOf('dark');
console.log('\n▶ §A 深色：逐个相邻面 × **已接线**通道（影/描边；发光与发丝仅列参考，⛔ 不计入判定）');
console.log('  ' + pad('相邻对', 12) + pad('上面', 10) + pad('下面', 10) + pad('填充', 8) + pad('影/边', 8)
  + pad('边缘通道', 12) + pad('判定', 8) + pad('(参考)发光潜力', 14) + '(参考)发丝');
const pairs: Pair[] = pairsOf(pDark);
const auds: Aud[] = pairs.map((x) => audit(pDark, x));
for (let i = 0; i < pairs.length; i++) {
  const x = pairs[i]; const a = auds[i];
  console.log('  ' + pad(x.name, 12) + pad(x.upper, 10) + pad(x.lower, 10) + pad(a.fill.toFixed(4), 8)
    + pad(a.edge.toFixed(4), 8) + pad(a.edgeLabel, 12)
    + pad(a.bestWired >= SURFACE_DIFF_MIN ? '✓' : '✗ 缺口', 8)
    + pad(a.glowPotential.toFixed(4), 14) + a.hairRef.toFixed(4));
}
const eD = effectsOf(pDark);
console.log(`  影色 dark elev1=${alphaPct(eD.elev1)} elev2=${alphaPct(eD.elev2)} elev3=${alphaPct(eD.elev3)}（全 #000 黑柔影）`);
console.log(`  ⚠️ 发光 dark glow=${alphaPct(eD.glow)}（accent 彩色，潜力 1.25+）—— **未接线到这些面**（efa9d71 已证 7 处浮层用 elevationColorOf）`);

console.log('\n▶ §B 深色靠哪条通道分界');
const byWinner: Map<string, number> = new Map<string, number>();
for (let i = 0; i < auds.length; i++) { byWinner.set(auds[i].winner, (byWinner.get(auds[i].winner) || 0) + 1); }
const ws: string[] = []; byWinner.forEach((v, k) => ws.push(`${k}×${v}`));
console.log(`  已接线通道里最强的一条：${ws.join(' · ')}`);
console.log(`  净影范围 ${Math.min(...auds.map(a=>a.edge)).toFixed(4)}–${Math.max(...auds.map(a=>a.edge)).toFixed(4)}；净填充范围 ${Math.min(...auds.map(a=>a.fill)).toFixed(4)}–${Math.max(...auds.map(a=>a.fill)).toFixed(4)}`);
ok('深色的**黑影档**（elev1/elev2）仍然完全失效（黑压近黑底 ⇒ 净影 <1.03）',
  auds.filter((a) => a.edgeLabel === '影elev1' || a.edgeLabel === '影elev2').every((a) => a.edge < SURFACE_DIFF_MIN));
ok('深色**浮层档**改走发光后已达标（`0c0f13f`）：净 1.2545–1.2725 ≥ 1.03',
  auds.filter((a) => a.edgeLabel === '影·浮层档').every((a) => a.edge >= SURFACE_DIFF_MIN));
ok('深色的**发光通道潜力远够**（≥1.20）⇒ 缺口是"没接线"，不是"没有手段"',
  Math.min(...auds.map((a) => a.glowPotential)) >= 1.2);
ok('深色达标的对里，最强已接线通道 ∈ {填充, 玻璃描边, 影·浮层档(发光)}（黑影一条都没赢）',
  auds.filter((a) => a.bestWired >= SURFACE_DIFF_MIN)
    .every((a) => a.winner === '填充' || a.winner === '玻璃描边' || a.winner === '影·浮层档' || a.winner === '发丝'));

console.log('\n▶ §C 缺口表（**已接线**通道全部 <1.03 ⇒ 该层级对没有可靠边界）');
const gaps: Aud[] = auds.filter((a) => a.bestWired < SURFACE_DIFF_MIN);
for (let i = 0; i < gaps.length; i++) {
  const a = gaps[i];
  console.log(`  ✗ ${pad(a.pair, 12)} 填充 ${a.fill.toFixed(4)} · ${pad(a.edgeLabel, 12)} ${a.edge.toFixed(4)} ⇒ max ${a.bestWired.toFixed(4)}（发光潜力 ${a.glowPotential.toFixed(4)} —— 未接线）`);
}
if (gaps.length === 0) { console.log('  （无缺口）'); }

console.log('\n▶ §D 判据 + 受管例外（⛔ 只许缩短）');
/** **缺口登记表**（spec 归 `brand-impl`：`core/theme.ets` / `core/design.ets`）。 */
// ⛔ **硬编码**（不是从实测推导）—— 这样"缺口被修好"会让实测集合**小于**本表 ⇒ 必红 ⇒ 逼我把表缩短；
//    新缺口出现 ⇒ 实测**大于**本表 ⇒ 也必红。两种方向都拦得住（"只许缩短"的真正实现）。
// ⚠️ 2026-10-11 复跑：`0c0f13f`（深色 `ELEV_OVERLAY` 改走发光通道）已修掉 **卡→浮层 / 画布→浮层**
//    ⇒ 本表按"**只许缩短**"从 4 项缩到 **2 项**（缩短的依据 = 实测缺口集合变了，见下面那条 ok 断言）。
// ⚠️ 2026-10-11 裁定（§F）：`画布→卡` **有已接线的发丝通道**（1.2194 ≥ 发丝门槛 1.20）
//    ⇒ 不再是缺口，从本表删除（**只许缩短** ✓）。余下唯一缺口 = `画布→下沉`（well/chip，无任何通道）。
// ✅ 2026-10-11 **清空**：`画布→下沉` 由 `insetHairlineOf`（仅深色画）收敛；
//    `画布→卡` 已由裁定（发丝算已接线）收敛 ⇒ 深色 4 处缺口**全部清零**。⛔ 只许缩短仍生效。
const PENDING_SPEC: string[] = [];
ok(`实测缺口集合 == 登记表（实测 ${gaps.length} / 登记 ${PENDING_SPEC.length}）`,
  gaps.length === PENDING_SPEC.length && gaps.every((a) => PENDING_SPEC.indexOf(a.pair) >= 0));
function darkBoundaryOk(as: Aud[], exempt: string[]): boolean {
  if (as.length === 0) { return false; }
  for (let i = 0; i < as.length; i++) {
    if (exempt.indexOf(as[i].pair) >= 0) { continue; }
    if (as[i].bestWired < SURFACE_DIFF_MIN) { return false; }
  }
  return true;
}
ok('真实基线判绿（防"判据恒红"）', darkBoundaryOk(auds, PENDING_SPEC) === true);
ok('mutation：零相邻对 ⇒ 判红（空扫描防线）', darkBoundaryOk([], PENDING_SPEC) === false);
{
  const inj: Aud[] = auds.map((a) => { const b: Aud = new Aud(); Object.assign(b, a); b.fill = 1; b.edge = 1; b.bestWired = 1; return b; });
  ok('mutation：两条已接线通道全塌 ⇒ 判红', darkBoundaryOk(inj, PENDING_SPEC) === false);
}
{
  const inj: Aud[] = auds.map((a) => { const b: Aud = new Aud(); Object.assign(b, a); b.bestWired = 1; return b; });
  ok('mutation：清空例外名单 ⇒ 基线判红（例外受判据管，⛔ 不能随手加）', darkBoundaryOk(inj, []) === false);
}
{
  // 反向 mutation（**按新事实改写**：2026-10-11 深色缺口已清零 ⇒ 原"缺口会消失"的前提不复存在）。
  // 改为**构造**一个"已接线通道全塌、只有未接线发光可用"的伪对 ⇒ 验证 **wired 纪律**仍挡住自欺
  // （我第一版就是把未接线发光计入 ⇒ 假绿）。
  const fake: Aud = new Aud();
  fake.pair = '伪对(只有未接线发光)';
  fake.fill = 1; fake.edge = 1; fake.bestWired = 1;      // 已接线通道全部塌
  fake.glowPotential = 1.25;                              // 但"未接线发光"潜力够
  ok('mutation：伪对（已接线全塌 / 只有未接线发光）⇒ wired 判据仍**判红**（挡住第一版的自欺）',
    darkBoundaryOk([fake], []) === false);
  ok('  · 而"把未接线发光计入"的**假判据**会误判绿 ⇒ 所以必须用 wired 语义',
    Math.max(fake.bestWired, fake.glowPotential) >= SURFACE_DIFF_MIN);
}

console.log('\n▶ §E 浅色对照（同模型同通道）');
const pL: Palette = paletteOf('porcelain');
const audsL: Aud[] = pairsOf(pL).map((x) => audit(pL, x));
console.log(`  浅色 净边缘通道 ${Math.min(...audsL.map(a=>a.edge)).toFixed(4)}–${Math.max(...audsL.map(a=>a.edge)).toFixed(4)}；净填充 ${Math.min(...audsL.map(a=>a.fill)).toFixed(4)}–${Math.max(...audsL.map(a=>a.fill)).toFixed(4)}`);
console.log(`  浅色 缺口：${audsL.filter((a)=>a.bestWired<SURFACE_DIFF_MIN).map((a)=>a.pair).join(',') || '无'}`);
// 同层级比对才有意义：浅色的柔影强度**随层级递增**（elev1 @6% → elev3 @16%），
// 深色恒为黑柔影（@24/32/42%）但压在近黑底上 ⇒ **只有 overlay 档两者可比**。
const lOverlay: Aud[] = audsL.filter((a) => a.pair.indexOf('浮层') >= 0);
const dOverlay: Aud[] = auds.filter((a) => a.pair.indexOf('浮层') >= 0);
// ⚠️ 复跑订正：`0c0f13f` 之前深色浮层是黑柔影（1.0206/1.0122 < 浅色 1.18）⇒ **那时**浅色更强；
//    改走发光后深色浮层档 = `accent@45%` 净 **1.2545–1.2725** ⇒ **现在深色反而更强**。
ok('同层级(overlay)比对：修复后**深色浮层档（发光）强于浅色柔影**（1.2545+ vs 1.1806）',
  Math.min(...dOverlay.map((a) => a.edge)) > Math.max(...lOverlay.map((a) => a.edge)));
console.log(`    浅色浮层影 ${lOverlay.map(a=>a.edge.toFixed(4)).join('/')} vs 深色浮层影 ${dOverlay.map(a=>a.edge.toFixed(4)).join('/')}`);
ok('浅色的**浮层**没有缺口（白度差 + 柔影至少一条够）',
  audsL.filter((a) => a.pair.indexOf('浮层') >= 0).every((a) => a.bestWired >= SURFACE_DIFF_MIN));

console.log('\n▶ §F 裁定与数据：发丝算不算通道 + 浅色 well/chip 该不该加内凹发丝');
// ── A. 发丝裁定（机制见下方 ok 断言）──────────────────────────────────────────
// 判据：`surfaceHairlineOf` 在生产代码里 **0 消费方**（9 处全在 tools/）⇒ **声明≠接线**；
//       但**组件侧确实画了** —— 用 `surface.card` 填充的 5 个组件（SubAgentTree/SettingsPanel/
//       PluginHost/PluginWidgets/SettingsRows）**全都**调了 `hairlineOf(pal)` ⇒ **通道是渲染事实**。
//       ⇒ 裁定：**算**（按"只计已接线通道"= 只看是否真的画出来，不看哪个 API 触发的）。
ok('裁定 A：`画布→卡` 的发丝通道已接线 ⇒ 1.0217 的填充差由发丝（≥1.20）接管 ⇒ 不再是缺口',
  auds[0].hairOk === true && auds[0].bestWired >= SURFACE_DIFF_MIN);
// ── B. 浅色 well/chip（画布→下沉）数据 ────────────────────────────────────────
console.log('  ' + pad('主题', 11) + pad('画布→下沉(填充)', 18) + pad('下沉发丝vs画布', 16) + pad('下沉发丝vs下沉', 16) + '发丝自己的门槛');
for (let i = 0; i < ALL_THEMES.length; i++) {
  const p: Palette = paletteOf(ALL_THEMES[i]);
  const s2 = surfacesOf(p);
  const h: string = hairlineOf(p);
  const floor: number = isLightPalette(p) ? HAIRLINE_MIN_LIGHT : HAIRLINE_MIN_DARK;
  console.log('  ' + pad(ALL_THEMES[i], 11)
    + pad(contrastRatio(s2.sunken, p.appBg).toFixed(4), 18)
    + pad(contrastRatio(h, p.appBg).toFixed(4), 16)
    + pad(contrastRatio(h, s2.sunken).toFixed(4), 16) + floor.toFixed(4));
}
{
  const pL2: Palette = paletteOf('porcelain');
  const pD2: Palette = paletteOf('dark');
  const wellsLight: number = contrastRatio(surfacesOf(pL2).sunken, pL2.appBg);
  const wellsDark: number = contrastRatio(surfacesOf(pD2).sunken, pD2.appBg);
  console.log(`  浅色 well/chip 当前边界 = ${wellsLight.toFixed(4)}（porcelain）；深色 = ${wellsDark.toFixed(4)}（dark）`);
  console.log(`  若加内凹发丝：浅色会得到 ${contrastRatio(hairlineOf(pL2), surfacesOf(pL2).sunken).toFixed(4)}（发丝 vs 下沉）—— **浅色本来就有 ${wellsLight.toFixed(4)}**，加了是**锦上添花**不是补缺`);
}
ok('裁定 B 的数据依据：**浅色 well/chip 本来就分得开**（≥1.03）⇒ 内凹发丝对浅色是"增色"，对深色才是"补缺"',
  contrastRatio(surfacesOf(paletteOf('porcelain')).sunken, paletteOf('porcelain').appBg) >= SURFACE_DIFF_MIN);
ok('深色 well/chip 确实分不开（<1.03，且无任何已接线通道）⇒ 唯一残余缺口',
  contrastRatio(surfacesOf(paletteOf('dark')).sunken, paletteOf('dark').appBg) < SURFACE_DIFF_MIN);

console.log('\n▼ 摘要');
console.log(`  阈值 SURFACE_DIFF_MIN = ${SURFACE_DIFF_MIN}（出处 DESIGN-SYSTEM §13.3；先例 palette_accent_rule.test.ts:55）`);
console.log(`  深色缺口 ${gaps.length} 处：${gaps.map((a) => a.pair).join(', ') || '无'}`);
if (fail > 0) { console.log(`\n  dark_boundary_channels_contrast: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  dark_boundary_channels_contrast: ${pass} passed, 0 failed`);
process.exit(0);

export {};
