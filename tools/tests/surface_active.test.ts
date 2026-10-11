/**
 * `surface.active` —— **中性**激活/选中面 role（tokens-ux spec，2026-10-11）。
 *
 * 为什么需要：`RUNG_ACTIVE` 原来只有两个**有语义**的角色（`surface.overlayRowHover` = 浮层行悬停、
 * `surface.pillSelected` = 选中的 pill）。凡"激活/选中但既不是浮层行也不是 pill"的自由面，
 * 只能**直取 `pal().surfaceHi`** ⇒ 绕过唯一口径（`free_surface_layers` 台账里挂在 ALLOWED）。
 *
 * ⛔ 硬约束：**深色逐字节等价于现状 `pal().surfaceHi`**（走 `RUNG_ACTIVE` ⇒ 该档 = `p.surfaceHi`）。
 *
 * mutation 自证（必红）：把该 role 的 rung 改成 `RUNG_CARD`/`RUNG_RAISED` ⇒ ★①（逐字节 === surfaceHi）红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { surfaceRoles, SurfaceRole, surfaceFillOf, RUNG_ACTIVE } from '../../entry/src/main/ets/core/design';
import { paletteOf, ALL_THEMES, isLightPalette } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}
function chroma(hex: string): number {
  const h = hex.length === 9 ? hex.slice(3) : hex.slice(1);
  const c = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const max = Math.max(c[0], c[1], c[2]);
  return max === 0 ? 0 : (max - Math.min(c[0], c[1], c[2])) / max;
}

// ── ★① 登记正确：RUNG_ACTIVE + 不发丝 ───────────────────────────────────────────────
{
  const roles: SurfaceRole[] = surfaceRoles();
  let hit: SurfaceRole | undefined = undefined;
  for (let i = 0; i < roles.length; i++) { if (roles[i].name === 'surface.active') { hit = roles[i]; } }
  ok('surface.active 已登记', hit !== undefined);
  if (hit !== undefined) {
    eq('  · 落在 RUNG_ACTIVE', hit.rung, RUNG_ACTIVE);
    eq('  · 不要求发丝（中性面）', hit.hairline, false);
  }
}

// ── ★② 逐字节等价：**所有主题**下 surface.active === pal().surfaceHi ────────────────────
{
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    eq(`${t}: surfaceFillOf('surface.active') === p.surfaceHi（逐字节）`, surfaceFillOf(p, 'surface.active'), p.surfaceHi);
    if (!isLightPalette(p)) {
      ok(`  · 深色族 ${t} 与现状调用点同值（渲染不变）`, surfaceFillOf(p, 'surface.active') === p.surfaceHi);
    }
  }
  // 与同档语义 role 同值（同 rung ⇒ 同 fill，差异只在语义）
  const pp = paletteOf('porcelain');
  eq('与同档的 overlayRowHover 同值（同 rung ⇒ 同 fill）',
    surfaceFillOf(pp, 'surface.active'), surfaceFillOf(pp, 'surface.overlayRowHover'));
}

// ── ★③ 阶梯：active 与 card/raised **不同值**（"选中"确实更重）+ porcelain 近中性 ─────────
{
  const p = paletteOf('porcelain');
  ok('★③ porcelain: active ≠ card（选中态可与卡片区分）', surfaceFillOf(p, 'surface.active') !== surfaceFillOf(p, 'surface.card'));
  ok('  · active ≠ raised（与抬升级区分）', surfaceFillOf(p, 'surface.active') !== surfaceFillOf(p, 'surface.raised'));
  ok('  · active 近中性（chroma < 3%）', chroma(p.surfaceHi) < 0.03, `got ${p.surfaceHi}`);
  // 阶梯方向：active 应比 raised **更深**（"按下/选中"比"抬起"更重）
  const lum = (hex: string): number => {
    const h = hex.length === 9 ? hex.slice(3) : hex.slice(1);
    return parseInt(h.slice(0, 2), 16) * 0.299 + parseInt(h.slice(2, 4), 16) * 0.587 + parseInt(h.slice(4, 6), 16) * 0.114;
  };
  ok(`  · active 亮度 ${lum(p.surfaceHi).toFixed(1)} < raised ${lum(p.surfaceAlt).toFixed(1)}（更重）`,
    lum(p.surfaceHi) < lum(p.surfaceAlt));
}

if (fail > 0) { console.log(`  surface_active: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  surface_active: ${pass} passed, 0 failed`);
process.exit(0);
