/**
 * chip 底色的**令牌唯一语义**契约测试。
 *
 * 裁决来源（已落盘）：`docs/REDESIGN.md §7.2` + `core/design.ets:320`
 *   「chip 的**唯一语义** = `surface.chip`（= 内嵌凹槽 `sunken`），**不随选中变化**」
 *   ⇒ `core/toolvisual.chipBgOf` 的旧"选中对调"补丁**已删除**，改走
 *     `surfaceFillOf(palette, 'surface.chip')`（一处、可测、与 design 同源）。
 *
 * 判别力（每条都能被"改回旧对调补丁"弄红）：
 *  ① **令牌唯一来源**：`chipBg === surfaceFillOf(p,'surface.chip') === wellOf(p)`（全主题 × 全语义档 × 选中/未选中）。
 *  ② **不与 pill 撞色**：`chipBg ≠ 同态 pillBg`（选中/未选中都判）—— 历史缺陷"chip 消失"的防线。
 *  ③ **恒定**：`chipBg` 不随 `selected` 变化（裁决核心：两者正交），也不随 `kind` 变化。
 *  ④ **旧对调值不得复现**：选中态不得再等于 `surfaceAlt`、未选中态不得再等于 `surfaceHi`。
 *
 * ⚠️ ② 与 `tools/tests/tool_legibility.test.ts ④` 及 `toolvisual.test.ts` **有意重叠**
 *    （它们已断言 `chipBg ≠ pillBg`）—— 这里在"令牌语义"框架下再钉一条，**不重复**它们的
 *    对比度/形态可辨性断言；③/④ 是既有门禁**没有**的新不变式（本次裁决引入）。
 *
 * mutation 自证：把 `chipBgOf` 改回 `selected ? p.surfaceAlt : p.surfaceHi` ⇒ ①③④ 真红。
 */
declare const process: { exit: (c: number) => void };

import { chipBgOf, pillBgOf } from '../../entry/src/main/ets/core/toolvisual';
import { surfaceFillOf, wellOf } from '../../entry/src/main/ets/core/design';
import { ALL_THEMES, Palette, paletteOf } from '../../entry/src/main/ets/core/theme';
import {
  ST_DONE, ST_ERROR, ST_GENERATING, ST_KILLED, ST_PENDING, ST_RUNNING,
} from '../../entry/src/main/ets/core/toolstatus';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const KINDS: string[] = [ST_PENDING, ST_RUNNING, ST_GENERATING, ST_DONE, ST_ERROR, ST_KILLED];
const CHIP_ROLE: string = 'surface.chip';

// ── ① 令牌唯一来源：chip 底 = surface.chip（= sunken），全主题 × 全档 × 选中两态 ──
for (let i = 0; i < ALL_THEMES.length; i++) {
  const th: string = ALL_THEMES[i];
  const p: Palette = paletteOf(th);
  const want: string = surfaceFillOf(p, CHIP_ROLE);
  // surface.chip 就是内嵌凹槽（sunken）—— 令牌层的自洽（不是本文件在造判据）
  eq(`① [${th}] surface.chip = wellOf(sunken)`, want, wellOf(p));
  for (let s = 0; s < 2; s++) {
    const sel: boolean = s === 1;
    for (let k = 0; k < KINDS.length; k++) {
      eq(`① [${th}] chipBgOf(${KINDS[k]},sel=${sel}) = 令牌 surface.chip`, chipBgOf(KINDS[k], sel, th), want);
    }
  }
}

// ── ② 不与 pill 撞色（历史缺陷防线：chip 与选中 pill 同色 ⇒ 浮层打开时 chip 消失）──
for (let i = 0; i < ALL_THEMES.length; i++) {
  const th: string = ALL_THEMES[i];
  for (let k = 0; k < KINDS.length; k++) {
    const kind: string = KINDS[k];
    ok(`② [${th}] ${kind} 选中 chipBg ≠ pillBg`,
      chipBgOf(kind, true, th) !== pillBgOf(kind, true, th));
    ok(`② [${th}] ${kind} 未选中 chipBg ≠ pillBg`,
      chipBgOf(kind, false, th) !== pillBgOf(kind, false, th));
  }
}

// ── ③ 恒定：chip 底不随 selected / kind 变化（裁决核心：chip 与"是否选中"正交）──
for (let i = 0; i < ALL_THEMES.length; i++) {
  const th: string = ALL_THEMES[i];
  const base: string = chipBgOf(ST_RUNNING, false, th);
  ok(`③ [${th}] chip 与选中无关（恒 sunken）`, chipBgOf(ST_RUNNING, true, th) === base);
  for (let k = 0; k < KINDS.length; k++) {
    ok(`③ [${th}] ${KINDS[k]} chip 与 kind 无关`, chipBgOf(KINDS[k], true, th) === base);
    ok(`③ [${th}] ${KINDS[k]} chip 与 kind 无关（未选中）`, chipBgOf(KINDS[k], false, th) === base);
  }
}

// ── ④ 旧"对调补丁"的值不得再出现（选中曾 = surfaceAlt / 未选中曾 = surfaceHi）──
{
  const pd: Palette = paletteOf('dark');
  ok('④ 选中 chipBg 不再是 surfaceAlt（旧对调）', chipBgOf(ST_RUNNING, true, 'dark') !== pd.surfaceAlt);
  ok('④ 未选中 chipBg 不再是 surfaceHi（旧缺陷）', chipBgOf(ST_RUNNING, false, 'dark') !== pd.surfaceHi);
  eq('④ 选中 chipBg = sunken（令牌）', chipBgOf(ST_RUNNING, true, 'dark'), wellOf(pd));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} toolvisual chip 令牌语义契约测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

export {};
