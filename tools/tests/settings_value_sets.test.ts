/**
 * 设置键「可选值集合」判据（目标③ 第三层，2026-10-11）。
 *
 * 前两层已做：键表 parity（键名/命名空间）+ 死键审计（每键必须有消费点）。
 * 本层钉**每个带枚举/范围的键，其可选值集合与顺序**——防"悄悄删/改/换序一个档位"。
 *
 * ⛔ 断言的"期望值"都带 **出处注释**（`file:line`），不是凭空数字。
 * ⚠️ **扫描器自证（含 2026-10-11 的真实翻车记账）**：探针路径必须**相对 `ETS_DIR`**
 *    （`entry/src/main/ets`）。第一版我传了**含该前缀的整路径**再 `join(ETS_DIR, rel)`
 *    ⇒ **前缀翻倍** ⇒ 5 个探针**全部命中 0** ⇒ 零扫描防线当场判红（`got 5 want 0`）。
 *    ⇒ 这条防线正是"扫描器坏了"与"值真不一致"的分水岭，⛔ 不可省。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; basename(p: string): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

import { ACCENT_PRESETS } from '../../entry/src/main/ets/core/accent';
import { MD_THEMES, DEFAULT_MD_THEME } from '../../entry/src/main/ets/core/mdtheme';
import {
  SEND_KEY_ENTER, SEND_KEY_MOD_ENTER, normalizeSendKey, fontScalePresets, clampFontScale,
  fontScaleFrom, KEY_SURFACE,
} from '../../entry/src/main/ets/core/settings';

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
/** ⚠️ `rel` 必须**相对 `ETS_DIR`**（如 `core/accent.ets`、`components/SettingsAppearance.ets`）。 */
function srcOf(rel: string): string {
  const p: string = path.join(ETS_DIR, rel);
  return fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf-8')) : '';
}
function hits(rel: string, re: RegExp): number {
  const m: string[] | null = srcOf(rel).match(re);
  return m === null ? 0 : m.length;
}

// ── 零扫描防线（自证"真的读到了东西"）────────────────────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
console.log('  ── 扫描器自证：逐键命中分布 ──');
{
  const probes: string[][] = [
    ['accent', 'core/accent.ets', 'ACCENT_PRESETS'],
    ['mdtheme', 'core/mdtheme.ets', 'MD_THEMES'],
    ['sendkey', 'core/settings.ets', 'SEND_KEY_MOD_ENTER'],
    ['fontscale', 'core/settings.ets', 'fontScalePresets'],
    ['surface', 'components/SettingsAppearance.ets', 'SURFACE_WEB'],
  ];
  let zero = 0;
  for (let i = 0; i < probes.length; i++) {
    const n: number = hits(probes[i][1], new RegExp(`\\b${probes[i][2]}\\b`, 'g'));
    console.log(`    ${probes[i][0].padEnd(10)} ${probes[i][1]}× ${n}`);
    if (n === 0) { zero++; }
  }
  eq('零扫描防线：5 个探针都命中（有 0 ⇒ 扫描/路径坏了，先红）', zero, 0);
}

// ── ① 强调色预设（web `SettingsAppearance.tsx` ACCENT_PRESETS）────────────────
eq('accent 预设数 = 6（web 同）', ACCENT_PRESETS.length, 6);
eq('accent 预设逐值同序（web 同）',
  ACCENT_PRESETS.join(','), '#3388BB,#2563EB,#7C3AED,#DC2626,#059669,#EA580C');

// ── ② Markdown 主题（web `types/markdown-theme.ts`）──────────────────────────
eq('md 主题数 = 23（web 同）', MD_THEMES.length, 23);
eq('md 默认 = vscode-dark（web DEFAULT_MARKDOWN_THEME 同）', DEFAULT_MD_THEME, 'vscode-dark');
eq('md 首项 id = vscode-dark（同序锚点）', MD_THEMES[0].id, 'vscode-dark');
eq('md 末项 id = xbot-nebula（同序锚点；防尾部增删）', MD_THEMES[MD_THEMES.length - 1].id, 'xbot-nebula');

// ── ③ 发送键（web SEND_KEY_OPTIONS；默认 = 组合键）────────────────────────────
eq('send-key 值 1 = enter', SEND_KEY_ENTER, 'enter');
eq('send-key 值 2 = ctrl-enter', SEND_KEY_MOD_ENTER, 'ctrl-enter');
eq('send-key 默认 = ctrl-enter（⛔ 不是 enter，否则与 web 默认相反）',
  normalizeSendKey(undefined), SEND_KEY_MOD_ENTER);
eq('send-key 历史值 mod-enter ⇒ 归一 ctrl-enter', normalizeSendKey('mod-enter'), SEND_KEY_MOD_ENTER);
eq('send-key 未知值 ⇒ 默认', normalizeSendKey('zzz'), SEND_KEY_MOD_ENTER);

// ── ④ 字号（**原生独有**；web 无此设置 ⇒ 钉住集合 + 钳制区间，防漂移）────────
eq('font-scale 档 = [0.9, 1, 1.15, 1.3]', fontScalePresets().join(','), '0.9,1,1.15,1.3');
eq('font-scale 钳制下界 0.85', clampFontScale(0.1), 0.85);
eq('font-scale 钳制上界 1.4', clampFontScale(9), 1.4);
eq('font-scale 缺失 ⇒ 默认 1', fontScaleFrom(undefined), 1);
eq('font-scale 非数 ⇒ 默认 1', fontScaleFrom('abc'), 1);

// ── ⑤ 承载方式（`KEY_SURFACE`，**原生独有**：web 无此键）─────────────────────
// 出处：取值 `'native' | 'web'` 定义在 `components/SettingsAppearance.ets:51-52`
//      （SURFACE_NATIVE / SURFACE_WEB）；写入口 `pages/Index.ets:4808`
//      （pairs[KEY_SURFACE] = useWeb ? 'web' : 'native'）；读入口 `pages/Index.ets:1419`（=== 'web'）。
eq('KEY_SURFACE 本地键名', KEY_SURFACE, 'xbot-surface');
{
  const literal: number = hits('components/SettingsAppearance.ets', /SURFACE_(NATIVE|WEB)/g);
  console.log(`    surface    components/SettingsAppearance.ets SURFACE_* × ${literal}`);
  eq('surface 取值常量在 SettingsAppearance（≥4 命中：2 定义 + 2 使用）', literal >= 4, true);
  const reader: number = hits('pages/Index.ets', /KEY_SURFACE/g);
  console.log(`    surface    pages/Index.ets KEY_SURFACE × ${reader}`);
  eq('surface 有读写消费点（Index.ets ≥3）', reader >= 3, true);
}

if (fail > 0) { console.log(`  ✗ settings_value_sets: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ settings_value_sets: ${pass} passed, 0 failed（accent 6 / md 23 / send-key 2 / font-scale 4 / surface 2）`);
process.exit(0);
