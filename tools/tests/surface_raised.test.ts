/**
 * `surface.raised` —— **中性**抬升级面 role（tokens-ux spec，2026-10-11）。
 *
 * 为什么需要：`surfaceRoles()` 原来在 `RUNG_RAISED` 只有两个**有语义**的角色
 * （`surface.overlayRow` = 浮层行 / `surface.pill` = 工具 pill）。而 `core/todo/Progress` 的
 * **轨道底**与"**就地编辑框底**"要的是"抬起但**既不是行也不是 pill**"的中性面 ⇒ 借任一都是**错语义**，
 * 硬替又会改色。⇒ 补一个中性 role。
 *
 * ⛔ 硬约束：**深色逐字节等价于现状 `pal().surfaceAlt`**（取值走 `RUNG_RAISED` ⇒ 该档 = `p.surfaceAlt`）。
 *
 * mutation 自证（必红）：把该 role 的 rung 改成 `RUNG_CARD`/`RUNG_ACTIVE` ⇒ ★①（逐字节 === surfaceAlt）红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { surfaceRoles, SurfaceRole, surfaceFillOf, surfaceHairlineOf, RUNG_RAISED } from '../../entry/src/main/ets/core/design';
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

// ── ★① 注册正确：在 RUNG_RAISED 且**不需要发丝**（中性面）────────────────────────────
{
  const roles: SurfaceRole[] = surfaceRoles();
  let hit: SurfaceRole | undefined = undefined;
  for (let i = 0; i < roles.length; i++) { if (roles[i].name === 'surface.raised') { hit = roles[i]; } }
  ok('surface.raised 已登记', hit !== undefined);
  if (hit !== undefined) {
    eq('  · 落在 RUNG_RAISED', hit.rung, RUNG_RAISED);
    eq('  · 不要求发丝（中性面，与 card/overlay 区分）', hit.hairline, false);
  }
}

// ── ★② 逐字节等价：**所有主题**下 surface.raised === pal().surfaceAlt ──────────────────
{
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    eq(`${t}: surfaceFillOf('surface.raised') === p.surfaceAlt（逐字节）`, surfaceFillOf(p, 'surface.raised'), p.surfaceAlt);
    if (!isLightPalette(p)) {
      ok(`  · 深色族 ${t} 与现状调用点同值（渲染不变）`, surfaceFillOf(p, 'surface.raised') === p.surfaceAlt);
    }
  }
  ok('与同档的 pill/overlayRow 同值（同 rung ⇒ 同 fill，差异只在语义）',
    surfaceFillOf(paletteOf('porcelain'), 'surface.raised') === surfaceFillOf(paletteOf('porcelain'), 'surface.pill'));
}

// ── ★③ 中性：porcelain 下 chroma 近 0（不是彩色面）─────────────────────────────────
{
  const p = paletteOf('porcelain');
  ok('★③ porcelain: surface.raised 近中性（chroma < 3%）', chroma(p.surfaceAlt) < 0.03, `got ${p.surfaceAlt}`);
  ok('  · 且与 card 面不同值（"抬起"确实抬起来了）', p.surfaceAlt !== p.surface);
  eq('  · 不发丝（hairline=false ⇒ surfaceHairlineOf 视调用点而定）', surfaceHairlineOf('surface.raised'), false);
}

if (fail > 0) { console.log(`  surface_raised: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  surface_raised: ${pass} passed, 0 failed`);
process.exit(0);
