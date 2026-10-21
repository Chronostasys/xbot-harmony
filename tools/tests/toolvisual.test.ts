/**
 * 工具 pill **视觉映射**门禁 —— `core/toolvisual.ets`（纯函数，可脱机单测）。
 *
 * 守护的**不变量**（都是"四信号不打架"的结构性保证）：
 *   · `paletteMemo/effectsMemo` 按主题**记忆化**（同一主题同一对象 ⇒ 稳态零构造）；
 *   · `chipBgOf ≠ pillBgOf`（选中与未选中**都**成立）—— 修"选中 pill 上 chip 消失"；
 *   · `pending ⇒ muted`、`running/generating ⇒ accent`、`error ⇒ danger`、`done ⇒ success`；
 *   · `done` **安静**（无柔影）/ 非在飞无柔影；在飞才有柔影；浅色系走**中性柔影**（不是彩色 glow）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  PILL_LIVE_GLOW_RADIUS, chipBgOf, effectsMemo, glowColorOf, paletteMemo, pillBgOf,
  pillTextColorOf, pillVisual, statusColorOf,
} from '../../entry/src/main/ets/core/toolvisual';
import { ALL_THEMES, THEME_DARK, THEME_PORCELAIN, isLightPalette } from '../../entry/src/main/ets/core/theme';
import {
  ROLE_ACCENT, ROLE_DANGER, ROLE_MUTED, ROLE_SUCCESS,
  ST_DONE, ST_ERROR, ST_GENERATING, ST_KILLED, ST_PENDING, ST_RUNNING, statusColorRole,
} from '../../entry/src/main/ets/core/toolstatus';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── ① 记忆化：同一主题同一对象（稳态零构造）────────────────────────────────
eq('paletteMemo 同主题同对象', paletteMemo(THEME_DARK) === paletteMemo(THEME_DARK), true);
eq('effectsMemo 同主题同对象', effectsMemo(THEME_DARK) === effectsMemo(THEME_DARK), true);
eq('paletteMemo 值正确（dark.surfaceAlt）', paletteMemo(THEME_DARK).surfaceAlt, '#14141C');
eq('paletteMemo 值正确（dark.surfaceHi）', paletteMemo(THEME_DARK).surfaceHi, '#1D1D28');
// 记忆化后 `statusColorOf` 仍等价于旧口径（值不变）
eq('statusColorOf(done,dark) = successText', statusColorOf(ST_DONE, THEME_DARK),
  paletteMemo(THEME_DARK).successText);

// ── ② 语义色（唯一映射 × 六档 × 五主题）────────────────────────────────────
const KINDS: string[] = [ST_DONE, ST_RUNNING, ST_GENERATING, ST_PENDING, ST_ERROR, ST_KILLED];
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  const p = paletteMemo(th);
  eq(`[${th}] done ⇒ successText`, statusColorOf(ST_DONE, th), p.successText);
  eq(`[${th}] running ⇒ accentSoft`, statusColorOf(ST_RUNNING, th), p.accentSoft);
  eq(`[${th}] generating ⇒ accentSoft`, statusColorOf(ST_GENERATING, th), p.accentSoft);
  eq(`[${th}] pending ⇒ textMuted（不是 accent）`, statusColorOf(ST_PENDING, th), p.textMuted);
  eq(`[${th}] error ⇒ dangerText`, statusColorOf(ST_ERROR, th), p.dangerText);
  eq(`[${th}] killed ⇒ textMuted`, statusColorOf(ST_KILLED, th), p.textMuted);
  // pending 与 running 的色**必须不同**（真机打脸根因：pending 曾落到 accent）
  eq(`[${th}] pending ≠ running 色`, statusColorOf(ST_PENDING, th) !== statusColorOf(ST_RUNNING, th), true);
}
// 名称色：只有失败才红
eq('名称色：error ⇒ dangerText', pillTextColorOf(ST_ERROR, THEME_DARK), paletteMemo(THEME_DARK).dangerText);
eq('名称色：running ⇒ textPrimary（中性，不抢注意力）',
  pillTextColorOf(ST_RUNNING, THEME_DARK), paletteMemo(THEME_DARK).textPrimary);
eq('名称色：pending ⇒ textPrimary（安静）',
  pillTextColorOf(ST_PENDING, THEME_DARK), paletteMemo(THEME_DARK).textPrimary);

// ── ③ chip 底色 **恒 ≠** pill 底色（选中 / 未选中，全主题）────────────────────
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  eq(`[${th}] 未选中：chipBg ≠ pillBg`,
    chipBgOf(ST_PENDING, false, th) !== pillBgOf(ST_PENDING, false, th), true);
  eq(`[${th}] 选中：chipBg ≠ pillBg（修"chip 消失"）`,
    chipBgOf(ST_PENDING, true, th) !== pillBgOf(ST_PENDING, true, th), true);
  eq(`[${th}] 选中 pill 提亮一档（surfaceHi）`, pillBgOf(ST_DONE, true, th), paletteMemo(th).surfaceHi);
  eq(`[${th}] 未选中 pill = surfaceAlt`, pillBgOf(ST_DONE, false, th), paletteMemo(th).surfaceAlt);
}

// ── ④ 在飞柔影：非在飞恒无；在飞才有；浅色走中性柔影 ─────────────────────────
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  eq(`[${th}] 非在飞 ⇒ 柔影色透明`, glowColorOf(ST_RUNNING, false, th), paletteMemo(th).transparent);
  const lc: string = glowColorOf(ST_RUNNING, true, th);
  eq(`[${th}] 在飞 ⇒ 有色柔影`, lc !== paletteMemo(th).transparent, true);
  if (isLightPalette(paletteMemo(th))) {
    eq(`[${th}] 浅色 ⇒ 中性柔影 elev2`, lc, effectsMemo(th).elev2);
  } else {
    eq(`[${th}] 深色 ⇒ 彩色 glow`, lc, effectsMemo(th).glow);
  }
}

// ── ⑤ pillVisual：一站式（形态档/色/底色/柔影）—— 四信号同源的结构保证 ────────
const vDone = pillVisual(ST_DONE, false, false, THEME_DARK);
eq('pillVisual.done 无柔影', vDone.glowRadius, 0);
eq('pillVisual.done accent = successText', vDone.accent, paletteMemo(THEME_DARK).successText);
const vRun = pillVisual(ST_RUNNING, true, true, THEME_DARK);
eq('pillVisual.running+live 柔影半径', vRun.glowRadius, PILL_LIVE_GLOW_RADIUS);
eq('pillVisual.running accent = accentSoft', vRun.accent, paletteMemo(THEME_DARK).accentSoft);
eq('pillVisual chipBg ≠ pillBg（选中）', vRun.chipBg !== vRun.pillBg, true);
eq('pillVisual.marker 透传语义档', vRun.marker, ST_RUNNING);
eq('pillVisual 与 statusColorRole 同源（档 → 色 只经一条链）',
  statusColorRole(ST_PENDING), ROLE_MUTED);
eq('角色枚举存在（danger/success/muted/accent 四档）',
  [ROLE_DANGER, ROLE_SUCCESS, ROLE_MUTED, ROLE_ACCENT].length, 4);

console.log(`  toolvisual: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
