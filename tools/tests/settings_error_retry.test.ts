/**
 * 设置分区「错误态可重试」形态判据（目标④/⑤，2026-10-11）。
 *
 * 动机：三态（空/加载/错误）审计发现 —— 「错误态给了重试」只覆盖 4 个面，
 *   而**设置分区**此前是"能报错、不能重试"（弱网下拉失败 ⇒ 只能退出重进）。
 *   web 权威：只有 `SettingsAbout` / `SettingsAgent` / `SettingsPlugins` **三个**分区给重试
 *   （`grep -rlnE "重试|Retry|retry|刷新" web/src/components/settings/*.tsx`）
 *   ⇒ 原生**只对齐这三个**，其余五个"web 亦无 ⇒ 不报障"。
 *
 * 判据（两条，缺一即假重试）：
 *  ① `SettingsErrorBar`（`components/SettingsRows.ets`）必须**同时**含 `canRetry` 与「重试」入口；
 *  ② 三个目标分区必须把 `onRetry` **透传**给 `SettingsErrorBar`
 *     （⇒ 这才是"点得动"的机器判据；⛔ 只渲染不接线 = 假重试）。
 *
 * ⚠️ 扫描器自证 + 零扫描判红（本仓已出 4 次同类事故）。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function findRoot(start: string): string {
  let cur: string = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(cur, 'entry', 'src', 'main', 'ets'))) { return cur; }
    cur = path.join(cur, '..');
  }
  return '';
}
const ROOT: string = findRoot(__dirname);
const ETS_DIR: string = ROOT.length > 0 ? path.join(ROOT, 'entry', 'src', 'main', 'ets') : '';
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
/** ⚠️ `rel` 必须**相对 `ETS_DIR`**（血教训：前缀翻倍 ⇒ 探针全 0）。 */
function srcOf(rel: string): string {
  const p: string = path.join(ETS_DIR, rel);
  return fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf-8')) : '';
}

/** 有 web 权威、必须给重试的三分区。 */
const TARGETS: string[] = [
  'components/SettingsAbout.ets',
  'components/SettingsAgent.ets',
  'components/SettingsPlugins.ets',
];
/** 无 web 权威（web 亦无重试）⇒ **不报障**，不判（记档见 WEB-PARITY）。 */
const NO_WEB_AUTHORITY: string[] = [
  'components/SettingsLlm.ets', 'components/SettingsStorage.ets', 'components/SettingsChannels.ets',
  'components/SettingsTools.ets', 'components/SettingsWebUsers.ets',
];

const ERR_BAR_REL: string = 'components/SettingsRows.ets';

// ── 零扫描防线 + 自证（逐面命中分布）────────────────────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
eq('零扫描防线：读到 SettingsRows.ets（非空）', srcOf(ERR_BAR_REL).length > 1000, true);
{
  let missing: number = 0;
  console.log('  ── 逐面命中分布（自证扫描器）──');
  for (let i = 0; i < TARGETS.length; i++) {
    const s: string = srcOf(TARGETS[i]);
    if (s.length === 0) { missing++; }
    const passthru: number = (s.match(/onRetry: this\.onRetry/g) || []).length;
    const prop: number = (s.match(/onRetry: \(\) => void/g) || []).length;
    console.log(`    ${TARGETS[i].padEnd(34)} 读到=${s.length > 0}  onRetry 透传=${passthru}  @Prop=${prop}`);
  }
  eq('零扫描防线：三个目标分区都读到了源码', missing, 0);
  let noAuth: number = 0;
  for (let i = 0; i < NO_WEB_AUTHORITY.length; i++) {
    if (srcOf(NO_WEB_AUTHORITY[i]).length > 0) { noAuth++; }
  }
  eq('零扫描防线：五个"无 web 权威"分区也都读到（用于反向确认它们**不**该有重试）', noAuth, 5);
}

// ── ① SettingsErrorBar 必须同时含 canRetry 与重试入口 ─────────────────────────
{
  const s: string = srcOf(ERR_BAR_REL);
  eq('SettingsErrorBar 有 canRetry 开关', /canRetry: boolean/.test(s), true);
  eq('SettingsErrorBar 有 onRetry 回调（非空实现由页面注入）', /onRetry: \(\) => void/.test(s), true);
  eq('重试入口受 canRetry 门控（if (this.canRetry)）', /if \(this\.canRetry\)/.test(s), true);
  eq('重试入口真的调用 onRetry()（⛔ 不是只渲染）', /this\.onRetry\(\)/.test(s), true);
  eq('重试入口保命中区（>= HIT_TARGET_MIN）', /HIT_TARGET_MIN/.test(s), true);
  eq('重试字色走唯一口径（colorOf(...)）', /colorOf\(this\.pal\(\), 'accentSoft'\)/.test(s), true);
}

// ── ② 三个目标分区必须把 onRetry 透传给 SettingsErrorBar ─────────────────────
{
  const bad: string[] = [];
  for (let i = 0; i < TARGETS.length; i++) {
    const s: string = srcOf(TARGETS[i]);
    const hasProp: boolean = /onRetry: \(\) => void/.test(s);
    const hasPassthru: boolean = /SettingsErrorBar\(\{[^}]*onRetry: this\.onRetry[^}]*\}\)/.test(s);
    const hasCanRetry: boolean = /canRetry: this\.canRetry/.test(s);
    if (!hasProp || !hasPassthru || !hasCanRetry) {
      bad.push(`${TARGETS[i]}（@Prop=${hasProp} 透传=${hasPassthru} canRetry=${hasCanRetry}）`);
    }
  }
  if (bad.length > 0) {
    console.log('  ✗ 目标分区未把 onRetry 接到 SettingsErrorBar（= 假重试）：');
    for (let i = 0; i < bad.length; i++) { console.log(`      ${bad[i]}`); }
  }
  eq('三个目标分区都必须把 onRetry/canRetry 透传到 SettingsErrorBar（否则是假重试）', bad.length, 0);
}

// ── ③ 页面层：Index 必须**注入**两个回调（防整链静默断）════════════════════════
// 取证出处：`pages/Index.ets:3058 onRetrySettings:` / `:3063-3064 onRetryPluginCatalog: → this.loadPluginCatalog()`
{
  const idx: string = srcOf('pages/Index.ets');
  eq('零扫描防线：读到 pages/Index.ets（非空）', idx.length > 1000, true);
  const injA: number = (idx.match(/onRetrySettings:/g) || []).length;
  const injB: number = (idx.match(/onRetryPluginCatalog:/g) || []).length;
  console.log(`    pages/Index.ets  onRetrySettings: × ${injA}   onRetryPluginCatalog: × ${injB}`);
  eq('Index 必须注入 onRetrySettings（About/Agent 用）', injA >= 1, true);
  eq('Index 必须注入 onRetryPluginCatalog（Plugins 用）', injB >= 1, true);
  // ⛔ **假重试红线（反面板）**：Plugins 的重试**不得**接到 loadSettings（那是设置表，不是插件目录）
  const seg: RegExpMatchArray | null = idx.match(/onRetryPluginCatalog:[\s\S]{0,240}?\n\s*\}/);
  const segText: string = seg === null ? '' : seg[0];
  eq('假重试红线：onRetryPluginCatalog 的实现段被抽到（否则无法核对 ⇒ 红）', segText.length > 0, true);
  eq('假重试红线：onRetryPluginCatalog 不得调 loadSettings(', segText.indexOf('loadSettings(') < 0, true);
  eq('假重试红线：onRetryPluginCatalog 必须调 loadPluginCatalog(', segText.indexOf('loadPluginCatalog(') >= 0, true);
}

// ── 反向确认：五个无 web 权威的分区**不该**有重试（防"超出 parity 的臆造"）──────
{
  const overreach: string[] = [];
  for (let i = 0; i < NO_WEB_AUTHORITY.length; i++) {
    const s: string = srcOf(NO_WEB_AUTHORITY[i]);
    if (/onRetry: this\.onRetry/.test(s)) { overreach.push(NO_WEB_AUTHORITY[i]); }
  }
  eq('五个"web 亦无重试"的分区不得自行加重试（超出 parity = 臆造）', overreach.length, 0);
}

if (fail > 0) { console.log(`  ✗ settings_error_retry: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ settings_error_retry: ${pass} passed, 0 failed（3 目标分区已接线；5 分区按 parity 不加）`);
process.exit(0);
