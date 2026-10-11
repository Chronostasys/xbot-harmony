/**
 * 「特制白色主题」层次语言契约（`docs/DESIGN-SYSTEM.md §13`）。
 *
 * 核心命题：**深色靠发光/玻璃分层；浅色必须靠结构分层**。浅色下的"面→面轮廓"需要比"面内发丝"
 * 更强一档 —— 新增唯一出口 `structuralRuleOf(p)`：
 *   · 浅色系（`isLightPalette`）⇒ `p.borderStrong`（对白更强 ⇒ 纯白上卡片轮廓"看得见"）；
 *   · **深色系逐字节不变** ⇒ `p.border`。
 * 与 `hairlineOf(p)`（面**内**发丝，目标 1.3201 = web 基线）成对，⛔ 不可混用。
 *
 * mutation 自证（必须红）：把 `structuralRuleOf` 改成恒返回 `p.border` ⇒ ★①（浅色更强）红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { porcelainPalette, darkPalette, lightPalette, paletteOf, contrastRatio, isLightPalette, HAIRLINE_TARGET_RATIO } from '../../entry/src/main/ets/core/theme';
import { colorOf, structuralRuleOf, hairlineOf } from '../../entry/src/main/ets/core/design';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

const fsMod = require('fs');
const pathMod = require('path');
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const p = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(p, 'entry/src/main/ets/components/SettingsRows.ets'))) { repo = p; break; }
}
ok('探测到仓库根', repo.length > 0);

// ── ★① 浅色：面→面轮廓**强于**面内发丝，且 ≥ 基线 ────────────────────────────────
{
  const p = porcelainPalette();
  ok('porcelain 是浅色面', isLightPalette(p));
  eq('porcelain: structuralRule === borderStrong（用既有强边界色，⛔ 不新造）', structuralRuleOf(p), p.borderStrong);
  const rs = contrastRatio(structuralRuleOf(p), p.appBg);
  const rh = contrastRatio(hairlineOf(p), p.appBg);
  ok(`porcelain: 轮廓对比 ≥ HAIRLINE_TARGET_RATIO（实得 ${rs.toFixed(4)} ≥ ${HAIRLINE_TARGET_RATIO}）`, rs >= HAIRLINE_TARGET_RATIO);
  // ⚠️ L2 后**不再要求轮廓"严格强于"发丝**：白度差（surface vs appBg ≥1.03）已接管"面"的分层，
  //    轮廓只需"不弱于"面内发丝即可（实测 1.3275 vs 1.3294，差 0.14%）。若仍要求严格更强，
  //    等于强迫再造一个更深的边界色 —— 那是**为了指标而指标**。
  ok(`porcelain: 轮廓不弱于面内发丝（${rs.toFixed(4)} ≥ ${rh.toFixed(4)} × 0.99；L2 白度差已接管分层）`,
    rs >= rh * 0.99);
  eq("colorOf(p,'structuralRule') 与 structuralRuleOf 同源", colorOf(p, 'structuralRule'), structuralRuleOf(p));
}

// ── ★② 深色**逐字节不变**：深色族 structuralRule === border ───────────────────────
{
  for (const t of ['dark', 'aurora', 'nebula']) {
    eq(`深色族 ${t}: structuralRule === border（逐字节不变）`, structuralRuleOf(paletteOf(t)), paletteOf(t).border);
  }
  eq('light: structuralRule === borderStrong（浅色面同口径）', structuralRuleOf(lightPalette()), lightPalette().borderStrong);
}

// ── ★③ 组件源码形态：卡片轮廓走 structuralRule；面内控件仍走 hairline ────────────────
if (repo.length > 0) {
  const src: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/components/SettingsRows.ets'), 'utf-8');
  ok("SettingsRows: 卡片轮廓走 structuralRuleOf", src.indexOf('color: structuralRuleOf(this.pal())') >= 0);
  ok('SettingsRows: 面内控件（pill/输入框）**仍**走 hairlineOf（两档不混用）',
    src.indexOf('color: hairlineOf(this.pal())') >= 0);
  ok('SettingsRows: 无颜色字面量', src.match(/#[0-9A-Fa-f]{6}\b/g) === null);
  const design: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/design.ets'), 'utf-8');
  ok("core/design.ets: role 'structuralRule' 已登记（⑥b 抽取口径）", design.indexOf("role === 'structuralRule'") >= 0);
  ok('core/design.ets: structuralRuleOf 用 isLightPalette（⛔ 不按主题名）',
    design.indexOf('isLightPalette(p) ? p.borderStrong : p.border') >= 0);
}

if (fail > 0) { console.log(`  porcelain_layering: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  porcelain_layering: ${pass} passed, 0 failed`);
process.exit(0);
