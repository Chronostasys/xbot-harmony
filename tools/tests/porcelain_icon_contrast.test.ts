/**
 * 白主题「弱交互图标」对比度契约（目标⑤ 系统化收口 —— A 类：对比度不足）。
 *
 * 背景（本波新发现，既有 `docs/PORCELAIN-AUDIT.md` 未覆盖的一类）：
 *   `textMuted` 的 tier 是 **2.0**（"几乎不该被读到"的**元信息**）—— porcelain 下 `#A2A2A7`
 *   压纯白仅 **2.54:1**。但 chevron（展开/收起）、关闭 ✕、拖拽把手这类**图标**是**交互指示**
 *   ⇒ 受 WCAG 2.1 §1.4.11「非文本内容」约束，浅色系必须 ≥ **3:1**。用 `textMuted` 画这些图标
 *   = 不达标（且白底上"糊"）。
 *
 * 修法：新增语义 role `iconMuted`（`core/design.ets: iconMutedOf`）——
 *   · 浅色系（`isLightPalette`）⇒ `textSecondary`（porcelain 5.07:1 ≥ 3:1 ✅）；
 *   · **深色系逐字节不变** ⇒ `textMuted`（深色下它本就够亮，无需动）。
 *   ⛔ 只用于**图标**；**文字**仍走 `textMuted`（改文字档位是另一项设计决定）。
 *
 * mutation 自证（必须红）：把 `iconMutedOf` 改回恒 `p.textMuted` ⇒ ★①（浅色 ≥3:1）与 ★②（≠textMuted）红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { porcelainPalette, darkPalette, lightPalette, paletteOf, contrastRatio, isLightPalette } from '../../entry/src/main/ets/core/theme';
import { colorOf, iconMutedOf, AA_NON_TEXT } from '../../entry/src/main/ets/core/design';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}
function near(name: string, got: number, lo: number): void {
  ok(`${name}（实得 ${got.toFixed(4)}，门槛 ${lo}）`, got >= lo);
}

const fsMod = require('fs');
const pathMod = require('path');
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const p = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(p, 'entry/src/main/ets/components/GoalBanner.ets'))) { repo = p; break; }
}
ok('探测到仓库根', repo.length > 0);

// ── ★① 纯对比度：porcelain 下 textMuted **不到**非文本 3:1（问题成立）─────────────────
{
  const p = porcelainPalette();
  const rMuted = contrastRatio(p.textMuted, p.appBg);
  const rIcon = contrastRatio(iconMutedOf(p), p.appBg);
  ok(`porcelain: textMuted 压画布 < 3:1（证明"不能拿它当图标色"，实得 ${rMuted.toFixed(4)}）`,
    rMuted < AA_NON_TEXT, `got ${rMuted}`);
  near('porcelain: iconMuted 压画布 ≥ 3:1（WCAG §1.4.11）', rIcon, AA_NON_TEXT);
  eq('porcelain: iconMuted === textSecondary（用最近一档既有令牌，不新造色值）', iconMutedOf(p), p.textSecondary);
  eq('porcelain: colorOf(p,\'iconMuted\') 与 iconMutedOf 同源', colorOf(p, 'iconMuted'), iconMutedOf(p));
  ok('porcelain 是浅色面（走提档分支）', isLightPalette(p));
}

// ── ★② 深色**逐字节不变**（铁律）：深色族 iconMuted === textMuted ────────────────────
{
  for (const t of ['dark', 'aurora', 'nebula']) {
    const p = paletteOf(t);
    eq(`深色族 ${t}: iconMuted === textMuted（逐字节不变）`, iconMutedOf(p), p.textMuted);
  }
  eq('light: iconMuted === textSecondary（同为浅色面）', iconMutedOf(lightPalette()), lightPalette().textSecondary);
}

// ── ★③ 组件源码形态：5 个自由组件的**图标**已走 iconMuted（且旧写法被删）─────────────
if (repo.length > 0) {
  const files = ['GoalBanner', 'StatusSheet', 'TodoPanel', 'ThinkingLine', 'LlmErrorNotice'];
  for (const f of files) {
    const src: string = fsMod.readFileSync(pathMod.join(repo, `entry/src/main/ets/components/${f}.ets`), 'utf-8');
    ok(`${f}: 图标走 colorOf(…, 'iconMuted')`, src.indexOf("'iconMuted'") >= 0);
  }
  // 旧写法（图标用 pal().textMuted）必须被删干净（否则是"漏网"）
  for (const f of ['GoalBanner', 'StatusSheet', 'TodoPanel']) {
    const src: string = fsMod.readFileSync(pathMod.join(repo, `entry/src/main/ets/components/${f}.ets`), 'utf-8');
    ok(`${f}: 不再有 .fontColor([this.pal().textMuted])（图标旧写法已删）`,
      src.indexOf('.fontColor([this.pal().textMuted])') < 0);
  }
  // ⛔ 组件不得自造色值：不得出现 `'iconMuted'` 之外的 hex
  for (const f of files) {
    const src: string = fsMod.readFileSync(pathMod.join(repo, `entry/src/main/ets/components/${f}.ets`), 'utf-8');
    ok(`${f}: 走令牌（无 #RRGGBB 字面量）`, src.match(/#[0-9A-Fa-f]{6}\b/g) === null);
  }
  // 入口唯一性：role 由 core/design.ets 抽（⑥b 门禁亦扫）
  const design: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/design.ets'), 'utf-8');
  ok("core/design.ets: role 'iconMuted' 已登记（⑥b 抽取口径 = role === '…'）",
    design.indexOf("role === 'iconMuted'") >= 0);
  ok('core/design.ets: iconMutedOf 用 isLightPalette 判深浅（⛔ 不按主题名）',
    design.indexOf('isLightPalette(p) ? p.textSecondary : p.textMuted') >= 0);
}

if (fail > 0) { console.log(`  porcelain_icon_contrast: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  porcelain_icon_contrast: ${pass} passed, 0 failed`);
process.exit(0);
