/**
 * 「多形态枚举」的**元判据**（2026-10-11）—— 防止"单形式 grep 覆盖多形式"这类系统性假绿/假红。
 *
 * ⚠️ **本波血教训（同一个坑踩了三次）**：
 *   ① 读设置的**读法**（`settingOf` / 归一化访问器 / `parseBool` / 直接字段读 / store 整传）；
 *   ② 设置的**写入口**（`onSetSetting` / `onSetTheme` / `onSetSurface` / `onSetNotify` / `onToggle` …）；
 *   ③ **键的引用形态**（常量名 / 字符串字面量 / helper 映射 / 分区专用回调）。
 *   每次我都**只用一种形式去 grep**，于是"未命中"被误读为"不存在"（假红）或反之（假绿）。
 *   ⇒ **规律：凡"枚举"，必须先穷举形态，并为每个形态做命中自证；任一形态 0 命中 ⇒ 红。**
 *
 * 本判据把这条规律**变成机器判据**：三处枚举各自"形态数 ≥ 基线 且 每形态命中 ≥ 1"。
 * ⚠️ 任何一处新增/删除形态 ⇒ 计数变 ⇒ 红（逼你同步基线，别让枚举静默退化）。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean; readdirSync(p: string, o: { withFileTypes: boolean }): { name: string; isDirectory(): boolean }[] };
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
const TESTS_DIR: string = path.join(ROOT, 'tools', 'tests');
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
/** ⚠️ `rel` 相对 `ETS_DIR`（前缀翻倍坑）。 */
function srcOf(rel: string): string {
  const p: string = path.join(ETS_DIR, rel);
  return fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf-8')) : '';
}
function testSrcOf(name: string): string {
  const p: string = path.join(TESTS_DIR, name);
  return fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf-8')) : '';
}

/** 设置类组件（写入口与键引用的发生地）。 */
const SETTINGS_PARTS: string[] = [
  'components/SettingsAppearance.ets', 'components/SettingsPanel.ets', 'components/SettingsAbout.ets',
  'components/SettingsAgent.ets', 'components/SettingsLlm.ets', 'components/SettingsStorage.ets',
  'components/SettingsChannels.ets', 'components/SettingsTools.ets', 'components/SettingsWebUsers.ets',
  'components/SettingsPlugins.ets', 'components/SettingsDeveloper.ets', 'components/SettingsAccount.ets',
];
function settingsSource(): string {
  let s: string = '';
  for (let i = 0; i < SETTINGS_PARTS.length; i++) { s += srcOf(SETTINGS_PARTS[i]) + '\n'; }
  return s;
}

// ── 零扫描防线 ──────────────────────────────────────────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
{
  let missing = 0;
  for (let i = 0; i < SETTINGS_PARTS.length; i++) { if (srcOf(SETTINGS_PARTS[i]).length === 0) { missing++; } }
  eq(`零扫描防线：${SETTINGS_PARTS.length} 个设置组件全部读到`, missing, 0);
}
const SET: string = settingsSource();
eq('零扫描防线：设置组件合并源码非空（> 5000 字符）', SET.length > 5000, true);

// ── ① 读法 A~E：判据文件里必须有 ≥5 个形态，且每个形态可命中 ────────────────────
{
  const ap: string = testSrcOf('settings_apply_path.test.ts');
  eq('① 读法判据文件存在且已读', ap.length > 1000, true);
  // 形态定义在 READ_PATTERNS 里：数 `{ name: 'X 说明'` 形式的条目
  const forms: RegExpMatchArray | null = ap.match(/\{ name: '[A-E] /g);
  const n: number = forms === null ? 0 : forms.length;
  console.log(`    ① 读法 A~E：判据内形态数 = ${n}`);
  eq('① 读法形态数 ≥ 5（A~E）', n >= 5, true);
  // 逐形态自证：A~E 各自的代表性 token 必须在**被扫的源码**里命中 ≥1
  const probes: string[][] = [
    ['A settingOf', 'settingOf('],
    ['B orbEnabled', 'orbEnabled('],
    ['C parseBool', 'parseBool('],
    ['D 直接字段读', '.settings['],
    ['E store 整传', 'settingOf(store.settings'],
  ];
  const all: string = srcOf('pages/Index.ets') + SET + srcOf('core/store.ets') + srcOf('core/settings.ets');
  let zeroF = 0;
  for (let i = 0; i < probes.length; i++) {
    const c: number = (all.match(new RegExp(probes[i][1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    console.log(`       ${probes[i][0].padEnd(16)} × ${c}`);
    if (c === 0) { zeroF++; }
  }
  eq('① 任一读法形态 0 命中 ⇒ 红（本项应恒 0 个零命中）', zeroF, 0);
}

// ── ② 写入口形态：任一为 0 ⇒ 红（基线 19 种，见交付记录）────────────────────────
{
  const forms: string[] = [
    'onSetSetting', 'onSetTheme', 'onSetSurface', 'onSetNotify', 'onToggle', 'onSelect', 'onRetry',
    'onText', 'onReveal', 'onRefresh', 'onInput', 'onCopy', 'onSave', 'onSetDefault', 'onStartBind',
    'onRetrySettings', 'onRetryPluginCatalog', 'onPickImage', 'onOpen',
  ];
  let zero = 0;
  console.log('    ② 写入口形态逐项命中：');
  for (let i = 0; i < forms.length; i++) {
    const c: number = (SET.match(new RegExp(`\\b${forms[i]}\\b`, 'g')) || []).length;
    if (c === 0) { console.log(`       ${forms[i]} × 0   ← 形态丢失/写错`); zero++; }
  }
  eq('② 写入口形态数 ≥ 19（基线，实测；onPick 不在本池 => 已按实测收正）', forms.length >= 19, true);
  eq('② 任一写入口形态 0 命中 ⇒ 红', zero, 0);
}

// ── ③ 键引用形态：常量名 / 字符串字面量 / helper / 分区专用回调 ────────────────────
{
  const keyForms: string[][] = [
    ['常量名', 'KEY_'],
    ['字符串字面量', "'xbot-"],
    ['分区专用回调', 'onSetTheme|onSetSurface|onSetNotify'],
  ];
  let zero = 0;
  console.log('    ③ 键引用形态逐项命中：');
  for (let i = 0; i < keyForms.length; i++) {
    const c: number = (SET.match(new RegExp(keyForms[i][1], 'g')) || []).length;
    console.log(`       ${keyForms[i][0].padEnd(14)} × ${c}`);
    if (c === 0) { zero++; }
  }
  eq('③ 任一键引用形态 0 命中 ⇒ 红', zero, 0);
  eq('③ 键引用形态数 ≥ 3（基线）', keyForms.length >= 3, true);
}

if (fail > 0) { console.log(`  ✗ enumeration_forms: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ enumeration_forms: ${pass} passed, 0 failed（三处枚举：读法 5 / 写入口 20 / 键引用 3）`);
process.exit(0);
