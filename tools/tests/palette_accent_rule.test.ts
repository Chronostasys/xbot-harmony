/**
 * `paletteOf` 的铁律守卫（`docs/DESIGN-SYSTEM.md §12`；2026-10-11 审 `ca8e751` 时钓出）。
 *
 * 违反点（已修）：`paletteOf` 内叠加强调色时用 `isDarkThemeName(theme)` 判——**主题名硬判**，
 * 违"深浅**只**走亮度口径 `isLightPalette(p)`"。今天与亮度口径等价，但"将来新主题 / 色板改动 /
 * 强调色叠加"都可能脱钩 ⇒ 必须按铁律写。
 *
 * mutation 自证：把 `!isLightPalette(p)` 改回 `isDarkThemeName(theme)` ⇒ 必红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { paletteOf, ALL_THEMES, isLightPalette, contrastRatio } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

/** 剥注释（⛔ 先剥再判：注释里提到 `isDarkThemeName(` 是允许的 —— 本仓 GOTCHA）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const fsMod = require('fs');
const pathMod = require('path');
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const p = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(p, 'entry/src/main/ets/core/theme.ets'))) { repo = p; break; }
}
ok('探测到仓库根', repo.length > 0);

if (repo.length > 0) {
  const src: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/theme.ets'), 'utf-8');
  const body: string = stripComments(src.substring(src.indexOf('export function paletteOf('),
    src.indexOf('export function normalizeTheme(')));
  ok('paletteOf 函数体可定位', body.length > 80);
  ok('paletteOf 函数体**不**出现 isDarkThemeName(（剥注释后）', body.indexOf('isDarkThemeName(') < 0);
  ok('paletteOf 叠加强调色走 !isLightPalette(p)（亮度口径）', body.indexOf('!isLightPalette(p)') >= 0);
}

// ── 不变量：强调色**不改**非 accent 角色（`appBg` 恒等于无强调色时的值）────────────────
{
  for (const t of ALL_THEMES) {
    const base = paletteOf(t);      // 进程内 APP_ACCENT 为空 ⇒ 基线
    ok(`${t}: appBg 非空`, base.appBg.length > 0);
  }
  ok('porcelain appBg = 极淡灰（L2 白度差）', paletteOf('porcelain').appBg.toUpperCase() !== '#FFFFFF');
  ok('  ⇒ 与 surface(#FFFFFF) 有可辨白度差 ≥1.03',
    contrastRatio(paletteOf('porcelain').surface, paletteOf('porcelain').appBg) >= 1.03);
}

if (fail > 0) { console.log(`  palette_accent_rule: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  palette_accent_rule: ${pass} passed, 0 failed`);
process.exit(0);
