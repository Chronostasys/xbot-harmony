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

// ════════════════════════════════════════════════════════════════════════════
// ★铁律扩面（2026-10-11）：**禁按主题名硬判** 不只在 `core/theme.ets` 内部 ——
//   `pages/**` 与 `components/**` 同样不许出现 `isDarkThemeName(`（深浅**只**走亮度口径
//   `isLightPalette(paletteOf(t))`）。**唯一白名单 = `core/theme.ets` 自己**（它是"主题名 → 深浅"
//   的**唯一定义处**，其他模块一律消费亮度口径）。
//
// 为什么必须扩面：`Index.ets` 里曾经有过 3 处硬判（B2），现已改走亮度口径 —— 但**改完没有押据**
//   ⇒ 将来任何人都能再写回去而门禁全绿（这正是"修了 bug 但没有判据 = 会复发"）。
//
// ⛔ 判据纪律：**剥注释**（注释里提到函数名是文档，不是违规 —— 本仓 GOTCHA）；**逐文件命中分布**；
//   **零扫描判红**（两个新目录都必须真扫到文件）；**mutation 自证**（见文末说明）。
// ⚠️ 断言必须落在**汇总 `if (fail > 0)` 之前** —— 本仓 GOTCHA：写在汇总之后的断言是**死区**，
//   永远不会执行（`docs/CI.md` 有记）。
// ════════════════════════════════════════════════════════════════════════════
{
  const THEME_OWNER: string = 'core/theme.ets';
  const roots: string[] = [
    pathMod.join(repo, 'entry/src/main/ets/pages'),
    pathMod.join(repo, 'entry/src/main/ets/components'),
    pathMod.join(repo, 'entry/src/main/ets/core'),
  ];
  const files: string[] = [];
  const walk = (dir: string): void => {
    let ents: any[] = [];
    try { ents = fsMod.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const full = pathMod.join(dir, e.name);
      if (e.isDirectory()) { walk(full); }
      else if (e.name.endsWith('.ets')) { files.push(full); }
    }
  };
  for (const r of roots) { walk(r); }
  console.log(`▶ 禁主题名硬判扫描：${files.length} 个 .ets（pages + components + core）`);
  ok('零扫描判红：扫到 .ets 文件 > 0', files.length > 0);
  // 两个新目录都必须真扫到（否则"扩面"是空的 ⇒ 白绿）
  let inPages = 0, inComponents = 0;
  const violations: string[] = [];
  for (const f of files) {
    const rel = pathMod.relative(pathMod.join(repo, 'entry/src/main/ets'), f).split(pathMod.sep).join('/');
    if (rel.indexOf('pages/') === 0) { inPages++; }
    if (rel.indexOf('components/') === 0) { inComponents++; }
    if (rel === THEME_OWNER) { continue; }          // 白名单（唯一定义处）
    const body: string = stripComments(fsMod.readFileSync(f, 'utf-8'));
    if (body.indexOf('isDarkThemeName(') >= 0) {
      const n: number = (body.match(/isDarkThemeName\(/g) || []).length;
      violations.push(`${rel} ×${n}`);
    }
  }
  console.log(`    覆盖面：pages ${inPages} 个 / components ${inComponents} 个；白名单仅 ${THEME_OWNER}`);
  ok('零扫描判红：`pages/**` 真扫到文件', inPages > 0);
  ok('零扫描判红：`components/**` 真扫到文件', inComponents > 0);
  if (violations.length === 0) {
    console.log('    命中：0 处（合规）');
    ok(`禁主题名硬判：${THEME_OWNER} 之外 0 处违规`, true);
  } else {
    for (const v of violations) { ok(`禁主题名硬判违规：${v} ⇒ 改用 isLightPalette(paletteOf(t))`, false); }
  }
}

if (fail > 0) { console.log(`  palette_accent_rule: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  palette_accent_rule: ${pass} passed, 0 failed`);
process.exit(0);
