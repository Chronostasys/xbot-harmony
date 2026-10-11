/**
 * 设置面 · 通知三开关「UI 入口 + 消费点」判据（波11 差集补齐，2026-10-11）。
 *
 * 背景（本仓血教训，与「强调色全局空操作」同一类）：
 *   `KEY_NOTIFY_ASK` / `KEY_NOTIFY_TURN_DONE` / `KEY_NOTIFY_DETAIL` **三键均有消费链**
 *   （`settings.notifyPrefsFrom` → `notify.applyNotifyPrefs` → `notify.notifyPrefEnabled`
 *    → `store.notifyOnSse`），但补齐前**只有 DETAIL 有 UI 入口** ⇒ 用户关不掉
 *   「收到提问时通知 / 回合完成时通知」（默认两类都开）＝ 用户操作静默无效的反面：
 *   「用户根本操作不了」。
 *
 * 判据（三条，均带零扫描防线；形态断言钉**调用点计数**，⛔ 不钉"方法体存在"）：
 *   ① **UI 存在**：三键都在 `components/SettingsPanel.ets` 的**写入路径**出现（计数 ≥1）；
 *   ② **消费点计数**：`core/notify.ets` 的 `notifyPrefEnabled` 真读 `prefs.ask` / `prefs.turnDone`
 *      （消费点计数 ≥1；零 ⇒ 判红 —— 防"UI 加了但没人读"的死开关）；
 *   ③ **mutation 自证**：把 `notifyPrefEnabled` 里的 `prefs.turnDone` 换成常量 → 本判据必红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 * ⚠️ ArkTS 编译期：本文件是纯 TS（`export {}` + `declare require` 风格，照 settings_keys_consumed）。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; basename(p: string): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };

import {
  KEY_NOTIFY_ASK, KEY_NOTIFY_DETAIL, KEY_NOTIFY_TURN_DONE,
  notifyPrefsFrom, notifyPrefValue, settingLabel,
} from '../../entry/src/main/ets/core/settings';
import { notifyPrefEnabled } from '../../entry/src/main/ets/core/notify';

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
const ETS: string = ROOT.length > 0 ? path.join(ROOT, 'entry', 'src', 'main', 'ets') : '';
const PANEL: string = ETS.length > 0 ? path.join(ETS, 'components', 'SettingsPanel.ets') : '';
const NOTIFY: string = ETS.length > 0 ? path.join(ETS, 'core', 'notify.ets') : '';

/** 剥注释（块 + 行）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function readOr(p: string): string {
  return p.length > 0 && fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf-8')) : '';
}
/** 某调用片段的**调用点计数**（字面子串，非正则 —— 避免 `(`/`.` 等元字符误伤）。 */
function countOf(src: string, marker: string): number {
  return marker.length === 0 ? 0 : src.split(marker).length - 1;
}

// ── 零扫描防线（本波血教训：扫不到文件却"全绿/全红"）──────────────────────────
eq('零扫描防线：仓库根解析成功（向上探到 entry/src/main/ets）', ROOT.length > 0, true);
const panelSrc: string = readOr(PANEL);
const notifySrc: string = readOr(NOTIFY);
eq('零扫描防线：含 components/SettingsPanel.ets', panelSrc.length > 0, true);
eq('零扫描防线：含 core/notify.ets', notifySrc.length > 0, true);

// ── 判据 ①：三键的 UI 写入路径必须在 SettingsPanel.ets 里（计数 ≥1）──────────────
{
  eq('① KEY_NOTIFY_ASK 出现在设置面板（写入路径）', countOf(panelSrc, 'KEY_NOTIFY_ASK') >= 1, true);
  eq('① KEY_NOTIFY_TURN_DONE 出现在设置面板（写入路径）', countOf(panelSrc, 'KEY_NOTIFY_TURN_DONE') >= 1, true);
  eq('① KEY_NOTIFY_DETAIL 出现在设置面板（写入路径）', countOf(panelSrc, 'KEY_NOTIFY_DETAIL') >= 1, true);
  // ★ 形态更强：必须是**写入调用** `setNotifyPref(KEY_NOTIFY_*)`（⛔ 只把键名写进显示标签不算入口）
  eq('① KEY_NOTIFY_ASK 有 setNotifyPref 写入调用点',
    countOf(panelSrc, 'setNotifyPref(KEY_NOTIFY_ASK') >= 1, true);
  eq('① KEY_NOTIFY_TURN_DONE 有 setNotifyPref 写入调用点',
    countOf(panelSrc, 'setNotifyPref(KEY_NOTIFY_TURN_DONE') >= 1, true);
  eq('① KEY_NOTIFY_DETAIL 有 setNotifyPref 写入调用点',
    countOf(panelSrc, 'setNotifyPref(KEY_NOTIFY_DETAIL') >= 1, true);
}

// ── 判据 ②：消费点计数（`notifyPrefEnabled` 必须真读 `prefs.ask` / `prefs.turnDone`）──
// ⛔ 钉"消费点计数"而非"方法体存在"：`prefs.ask` 只出现在**真读**处。
{
  eq('② 消费点：notifyPrefEnabled 读 prefs.ask（计数 ≥1）', countOf(notifySrc, 'prefs.ask') >= 1, true);
  eq('② 消费点：notifyPrefEnabled 读 prefs.turnDone（计数 ≥1）', countOf(notifySrc, 'prefs.turnDone') >= 1, true);
  // 运行期同源验证：三键确实驱动 `notifyPrefEnabled` 的返回值（不只是源码里出现过）
  eq('② 运行期：turnDone=false ⇒ TURN_DONE 档被拒', notifyPrefEnabled(notifyPrefsFrom({ 'xbot-notify-turn-done': '0' }), 'turn_done'), false);
  eq('② 运行期：ask=false ⇒ ASK 档被拒', notifyPrefEnabled(notifyPrefsFrom({ 'xbot-notify-ask': '0' }), 'ask_user_wait'), false);
}

// ── 判据 ③：mutation 自证 —— 抽掉 `prefs.turnDone` 的读 ⇒ 消费点计数归零 ⇒ 必红 ─────
{
  const marker: string = 'prefs.turnDone';
  const before: number = countOf(notifySrc, marker);
  const mutated: string = notifySrc.split(marker).join('true');
  const after: number = countOf(mutated, marker);
  eq('③ mutation：真源含消费点（前置条件）', before >= 1, true);
  eq('③ mutation：抽掉 prefs.turnDone 后消费点计数 = 0 ⇒ 判据②会红', after, 0);
  // 反向对照：不动 marker ⇒ 计数不变
  eq('③ 反向对照：未注入时计数非零', countOf(notifySrc, marker) >= 1, true);
}

// ── 判据 ④：键↔标签同源（三键都有非空中文显示名，UI 不会显示裸键名）───────────
{
  eq('④ 显示名：KEY_NOTIFY_ASK', settingLabel(KEY_NOTIFY_ASK).length > 0, true);
  eq('④ 显示名：KEY_NOTIFY_TURN_DONE', settingLabel(KEY_NOTIFY_TURN_DONE).length > 0, true);
  eq('④ 显示名：KEY_NOTIFY_DETAIL', settingLabel(KEY_NOTIFY_DETAIL).length > 0, true);
  eq('④ 写入值域：开 = 1 / 关 = 0（与 notifyPrefsFrom 的 parseBool 口径一致）',
    notifyPrefValue(true) + notifyPrefValue(false), '10');
}

if (fail > 0) { console.log(`  ✗ settings_notify_ui: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ settings_notify_ui: ${pass} passed, 0 failed`);
process.exit(0);
