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
const __origRead = fs.readFileSync;
fs.readFileSync = (p: string, e: string): string => __origRead(p, e).replace(/i18nT\(([^()]*)\)/g, '$1');


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
// 2026-10-17 P0 第五修（用户五连怒报「不能有哪怕一秒看不清」）：主题分支**只写 themeName 不够** ——
// LazyForEach 行键（themableRowKey 含 @theme）只在数据源通知时被重读：setSetting 不投 rowDs ⇒
// 历史行冻结旧色板、直到下一次 SSE 驱动的常规投递才恢复（用户症状「一个迭代结束才恢复正常」）。
// 钉**调用点计数**（乐观路径 + 保存失败回滚路径，== 2）。
const rowPush: number = countOf(seg, 'this.rowDs.applyRows(tailRows(this.rows, this.rowLimit), this.currentChat, this.themeName)');
console.log(`  theme_switch: setSetting 片段=${seg.length} 同步themeName=${syncTheme} 分支=${branch} syncSystem=${sysTheme} rowDs投递=${rowPush}`);

ok('setSetting 片段取到（非空）', seg.length > 0);
// 2026-10-17 P0 第五修：主题分支现在有**两处** —— 乐观切换 + 保存失败回滚（两处都必须当场
// 派生 themeName 并强制投 rowDs，缺一处就是「秒级不可读」的另一条复活路径）。
ok('① 主题分支存在且覆盖 MD_THEME/ACCENT（乐观 + 回滚 == 2）', branch === 2);
ok('① 分支里同步 themeName = renderThemeKey(…)（≥ 1）', syncTheme >= 1);
ok('② 分支里再 syncSystemTheme()（≥ 1）', sysTheme >= 1);
ok('③ 主题分支当场强制投 rowDs.applyRows（乐观 + 回滚 == 2）', rowPush === 2);
ok('零扫描判红：themeName 同步证据合计 > 0', syncTheme + branch + sysTheme > 0);
ok('零扫描判红：行投递证据 > 0', rowPush > 0);

console.log(`  theme_switch_wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
