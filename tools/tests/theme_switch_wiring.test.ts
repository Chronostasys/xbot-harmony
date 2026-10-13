/**
 * theme_switch_wiring —— 主题切换「同步生效」判据（2026-10-13，用户亲报「浅色看不清 / 所有 theme
 * 都要真的起效果」的真根因）。
 *
 * ── 根因 ─────────────────────────────────────────────────────────────────
 * `setSetting(KEY_MD_THEME, value)` 切换主题时，原实现**只**乐观更新 `this.settings[key] = value`、
 * 然后 `saveSettings` 异步落盘 —— 但**没有同步更新 `this.themeName`**（`@StorageLink('appTheme')`
 * 唯一真源）。`themeName` 只在 `syncFrom`（store 变更回调）从 `store.settings` 重算，而乐观更新
 * 不触发它 ⇒ 切换后色板**冻结在旧主题**：浅色下历史行仍取深色板 = 白字白底。
 *
 * ── 判据（钉调用点，不是"存在就行"）──────────────────────────────────────
 *   ① `setSetting` 方法体里，`KEY_MD_THEME` 分支**必须**把 `themeName` 同步派生自
 *      `appPaletteForMdTheme(value)`（与 `syncFrom` 的取值**同源**，最终值一致）；
 *   ② 同步后**必须**再 `syncSystemTheme()`（系统表面/状态栏跟随，幂等）；
 * ⛔ 零扫描判红（合计 0 ⇒ 红，防扫描器与真源脱节）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

export {};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}
function sliceBetween(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  if (a < 0) { return ''; }
  const b = src.indexOf(to, a + from.length);
  if (b < 0) { return ''; }
  return src.substring(a, b);
}

const REPO: string = path.resolve(__dirname, '../../../..');
const idxPath: string = path.join(REPO, 'entry/src/main/ets/pages/Index.ets');
const idx: string = stripComments(fs.readFileSync(idxPath, 'utf8'));

// setSetting 方法体（从签名到下一个 `private ` 方法）。
const seg: string = sliceBetween(idx, 'private async setSetting(key: string, value: string)', 'private ');
// 2026-10-13：主题标识改由 `renderThemeKey(色板名, 强调色)` 组装，且 `KEY_ACCENT` 必须与
// `KEY_MD_THEME` 走**同一分支**（强调色若不进可观察真源 ⇒ 全站零重渲染 ⇒「配色没起作用」）。
const syncTheme: number = countOf(seg, 'this.themeName = renderThemeKey(');
const branch: number = countOf(seg, 'if (key === KEY_MD_THEME || key === KEY_ACCENT)');
const sysTheme: number = countOf(seg, 'this.syncSystemTheme()');
console.log(`  theme_switch: setSetting 片段=${seg.length} 同步themeName=${syncTheme} 分支=${branch} syncSystem=${sysTheme}`);

ok('setSetting 片段取到（非空）', seg.length > 0);
ok('① 主题分支存在且**同时**覆盖 KEY_MD_THEME / KEY_ACCENT（== 1）', branch === 1);
ok('① 分支里同步 themeName = renderThemeKey(…)（≥ 1）', syncTheme >= 1);
ok('② 分支里再 syncSystemTheme()（≥ 1）', sysTheme >= 1);
ok('零扫描判红：themeName 同步证据合计 > 0', syncTheme + branch + sysTheme > 0);

console.log(`  theme_switch_wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
