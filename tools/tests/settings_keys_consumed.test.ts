/**
 * 设置键「死键」判据（⑧ 的设置版，2026-10-11）—— **每个键都必须有消费点**。
 *
 * 动机（与「强调色全局空操作」「通知 3 开关是死开关」同一类）：本仓反复出现
 * 「键表里定义了、UI 里能改、但**没人读**」的设置 ⇒ 用户改了没反应。
 *
 * ⚠️ **扫描器自证（必做，2026-10-11 第一版就在这里翻车）**：
 *    第一版 `consumersOf()` 搜的是**键的值**（`xbot-notify-ask` —— 它只出现在 `settings.ets`
 *    的声明里）⇒ 15 个键全部**假报死键**。**必须搜常量名**（`KEY_NOTIFY_ASK`）。
 *    教训：判据 ≠ 信号 —— 写"扫源码"型判据前先打印**扫到哪些文件 + 逐键命中分布**自证。
 *    根解析用"向上探 `entry/src/main/ets`"，⛔ 不假设 `__dirname` 深度
 *    （`run-one.sh` 产物在 `.out-one.X/js/`，聚合 `run.sh` 在 `.out-all.X/`，深度不同）。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; readdirSync(p: string, o: { withFileTypes: boolean }): { name: string; isDirectory(): boolean }[]; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; basename(p: string): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };

import {
  KEY_MD_THEME, KEY_ACCENT, KEY_LOCALE, KEY_SEND_KEY, KEY_CODE_WRAP, KEY_UI_MODE, KEY_STARRED,
  KEY_FONT_SCALE, KEY_REASONING_DEFAULT, KEY_APP_THEME, KEY_SURFACE, KEY_SESSION_CATEGORY,
  KEY_ORB, KEY_NOTIFY_ASK, KEY_NOTIFY_TURN_DONE, KEY_NOTIFY_DETAIL, serverKey,
} from '../../entry/src/main/ets/core/settings';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 根解析：向上探（⛔ 不写死深度）────────────────────────────────────────────
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

function collect(dir: string, out: string[]): void {
  const es = fs.readdirSync(dir, { withFileTypes: true });
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    const p: string = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'build' || e.name === 'oh_modules' || e.name === 'node_modules') { continue; }
      collect(p, out);
    } else if (e.name.endsWith('.ets') || (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts'))) {
      out.push(p);
    }
  }
}
const FILES: string[] = [];
if (ETS_DIR.length > 0) { collect(ETS_DIR, FILES); }

const SETTINGS_PATH: string = ETS_DIR.length > 0 ? path.join(ETS_DIR, 'core', 'settings.ets') : '';

/** 剥注释（块 + 行）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 从 `settings.ets` 源码里**只**挖掉"键表"那几个函数（`serverKey`/`localKey`/`settingLabel`）——
 * 它们的引用**不算消费**（把键名写进 table 不等于有人在读它）。
 * ⛔ 不能整个文件排除：`KEY_NOTIFY_ASK` 的真实消费在 `notifyPrefsFrom`（**同在 settings.ets**）
 * —— 第一版整文件排除 ⇒ 误报它俩是死键（第二处假信号的来源）。
 */
function stripKeyTables(src: string): string {
  let s: string = src;
  const fns: string[] = ['serverKey', 'localKey', 'settingLabel'];
  for (let i = 0; i < fns.length; i++) {
    const re = new RegExp(`export function ${fns[i]}\\([\\s\\S]*?\\n\\}`, 'g');
    s = s.replace(re, '');
  }
  // 键清单常量（`export const KEYS… = [...]`）
  s = s.replace(/export const KEYS[\s\S]*?(\];|\];\n)/g, '');
  // ⛔ 键的**声明行**也不算消费（`export const KEY_X: string = 'xbot-x';`）——
  //    否则每个键都会因声明而 +1，白名单永远无法成立（第二处假信号）。
  s = s.replace(/^export const KEY_[A-Z_]+: string = '[^']*';\s*$/gm, '');
  return s;
}

/** **常量名**的消费点计数（剥注释；`settings.ets` 只挖掉键表）。⛔ 传常量名，不传键值。 */
function consumersOf(constName: string): number {
  let n: number = 0;
  const re = new RegExp(`\\b${constName}\\b`, 'g');
  for (let i = 0; i < FILES.length; i++) {
    let src: string = stripComments(fs.readFileSync(FILES[i], 'utf-8'));
    if (FILES[i] === SETTINGS_PATH) { src = stripKeyTables(src); }
    const hits = src.match(re);
    if (hits !== null) { n += hits.length; }
  }
  return n;
}

/** 命中分布（诊断用：自证扫描器真的在数东西）。 */
function distributionOf(constName: string): string {
  const parts: string[] = [];
  const re = new RegExp(`\\b${constName}\\b`, 'g');
  for (let i = 0; i < FILES.length; i++) {
    let src: string = stripComments(fs.readFileSync(FILES[i], 'utf-8'));
    if (FILES[i] === SETTINGS_PATH) { src = stripKeyTables(src); }
    const hits = src.match(re);
    if (hits !== null) { parts.push(`${path.basename(FILES[i])}×${hits.length}`); }
  }
  return parts.join(', ');
}

// ── 零扫描防线（本次翻车的坑：扫不到文件却"全绿/全红"）──────────────────────
eq('零扫描防线：仓库根解析成功（向上探到 entry/src/main/ets）', ROOT.length > 0, true);
eq('零扫描防线：扫到 ≥100 个 ets/ts 源文件', FILES.length >= 100, true);
eq('零扫描防线：确实含 pages/Index.ets', FILES.some((f) => f.endsWith('pages/Index.ets')), true);
eq('零扫描防线：确实含 components/SettingsAppearance.ets', FILES.some((f) => f.endsWith('components/SettingsAppearance.ets')), true);
// 正样本自证：这些键**必须**有消费（若扫描器坏了 ⇒ 这里先红，而不是误报死键）
eq('扫描器自证：KEY_ACCENT 消费点 > 0', consumersOf('KEY_ACCENT') > 0, true);
eq('扫描器自证：KEY_ORB 消费点 > 0', consumersOf('KEY_ORB') > 0, true);

/** 全部键的**常量名**（⛔ 不是键值）。 */
const KEY_CONSTS: string[] = [
  'KEY_MD_THEME', 'KEY_ACCENT', 'KEY_LOCALE', 'KEY_SEND_KEY', 'KEY_CODE_WRAP', 'KEY_UI_MODE',
  'KEY_STARRED', 'KEY_FONT_SCALE', 'KEY_REASONING_DEFAULT', 'KEY_APP_THEME', 'KEY_SURFACE',
  'KEY_SESSION_CATEGORY', 'KEY_ORB', 'KEY_NOTIFY_ASK', 'KEY_NOTIFY_TURN_DONE', 'KEY_NOTIFY_DETAIL',
];
/** 常量名 → 键值（`serverKey` 打印用）。 */
const KEY_VALUES: string[] = [
  KEY_MD_THEME, KEY_ACCENT, KEY_LOCALE, KEY_SEND_KEY, KEY_CODE_WRAP, KEY_UI_MODE, KEY_STARRED,
  KEY_FONT_SCALE, KEY_REASONING_DEFAULT, KEY_APP_THEME, KEY_SURFACE, KEY_SESSION_CATEGORY,
  KEY_ORB, KEY_NOTIFY_ASK, KEY_NOTIFY_TURN_DONE, KEY_NOTIFY_DETAIL,
];
eq('键清单一维对齐（常量名 ↔ 键值）', KEY_CONSTS.length, KEY_VALUES.length);

/**
 * **有意保留的死键白名单**（每条必须给理由；⛔ 不许为"让测试变绿"往里塞）。
 * `KEY_UI_MODE`：原生是**单手机布局**，无 desktop shell ⇒ `auto/desktop/mobile` 无处消费。
 *   保留键（不删）是因为**它与 web 共享** `web:ui:ui-mode` —— 删了会让 web 侧设置丢/串。
 * `KEY_APP_THEME`：**原生第二套主题**（深/浅/极光/星云/极简白）已被删除 —— 用户 2026-10-13 拍板
 *   「只有一种主题设置，就是你从后端接口拉的那种」；web 权威 `providers/theme.tsx:101` 里应用明暗
 *   是 `modeForTheme(mdTheme)` 的**派生量**，`SettingsAppearance.tsx` 只暴露 mdTheme + accent
 *   ⇒ 应用色板改由 `core/mdtheme.appPaletteForMdTheme` 从 `xbot-md-theme` 派生。保留常量只为
 *   **不删服务端遗留值**（`web:ui:app-theme` 不在 web 的 `SETTING_MAP` 里，无人读它）。
 */
const DELIBERATE_DEAD: string[] = ['KEY_UI_MODE', 'KEY_APP_THEME'];
const DELIBERATE_REASON: string = 'KEY_UI_MODE：原生单手机布局（无 desktop shell），保留键只为与 web 共享的 key 表一致/不丢键；KEY_APP_THEME：主题真源已并为 xbot-md-theme（appPaletteForMdTheme 派生），保留常量只为不删服务端遗留值';

console.log('  ── 扫描器自证：逐键命中分布 ──');
const dead: string[] = [];
const alive: string[] = [];
for (let i = 0; i < KEY_CONSTS.length; i++) {
  const constName: string = KEY_CONSTS[i];
  const n: number = consumersOf(constName);
  let deliberate = false;
  for (let j = 0; j < DELIBERATE_DEAD.length; j++) {
    if (DELIBERATE_DEAD[j] === constName) { deliberate = true; }
  }
  console.log(`    ${constName.padEnd(24)} ${n} 处   ${distributionOf(constName)}`);
  if (deliberate) {
    // 白名单里的键若"复活" ⇒ 逼你从白名单删掉（保持白名单诚实）
    if (n > 0) { dead.push(`${constName} 已有 ${n} 个消费点 ⇒ 必须从 DELIBERATE_DEAD 删除`); }
  } else if (n === 0) {
    dead.push(`${constName} (serverKey=${serverKey(KEY_VALUES[i])}) —— 无任何消费点`);
  }
  if (n > 0) { alive.push(constName); }
}
if (dead.length > 0) {
  console.log('  ✗ 死键 / 白名单不一致：');
  for (let i = 0; i < dead.length; i++) { console.log(`      ${dead[i]}`); }
}
eq('每个设置键都要有消费点（或落在有意保留白名单里，且白名单里的键确实无消费）', dead.length, 0);
eq('白名单必须写明理由（非空）', DELIBERATE_REASON.length > 0, true);
console.log(`  · 有消费的键 ${alive.length} / 共 ${KEY_CONSTS.length}；白名单 ${DELIBERATE_DEAD.length}`);

if (fail > 0) { console.log(`  ✗ settings_keys_consumed: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ settings_keys_consumed: ${pass} passed, 0 failed（扫 ${FILES.length} 源 / ${KEY_CONSTS.length} 键）`);
process.exit(0);
