/**
 * 「工具」分区统计行 —— 文案逐字对齐 web 的判据（目标③「设置对齐 web」，2026-10-12）。
 *
 * ── 被修的真缺口（实修前）──────────────────────────────────────────────────────
 *   原生 `components/SettingsTools.ets` 的统计行**内联**了文案 `已启用 N / M 项`，
 *   而 web 真源是 `settings.tools.summary: '已激活 {{active}} / {{total}} 个工具'`
 *   （`/Users/bobli/src/xbot/web/src/i18n/zh-CN.ts:728`，渲染点
 *   `web/src/components/settings/SettingsTools.tsx:132-134`）⇒ 两处措辞漂移
 *   （「已启用」vs「已激活」、「项」vs「个工具」）。
 *
 * ── 修法（单一真源）────────────────────────────────────────────────────────────
 *   文案下沉到偏好真源 `core/settings.ets: toolsPanelSummary(active, total)`，组件只渲染，
 *   **不再各写一份**（本仓纪律：判据与渲染必须同源）。
 *
 * ── 本判据钉什么（⛔ 不钉"函数存在"，钉**形态 + 消费 + 渲染落点 + 逐字**）──────────
 *   ① 声明：`core/settings.ets` 真的导出 `toolsPanelSummary`；
 *   ② 消费：`components/SettingsTools.ets` 里 `toolsPanelSummary(` 调用点 **恰好 1 次**
 *      （⛔ 钉"方法体存在"会假绿 —— 声明了却没人调，用户看到的还是旧文案）；
 *   ③ 渲染落点：该调用在 `summary()` 内，且 `summary()` 被 `Text(this.summary())` 渲染；
 *   ④ 旧文案**已消失**（mutation 的另一面：若有人把内联串改回来，这里必红）；
 *   ⑤ 逐字对照 web 真源（**读 web 的 i18n 文件**，不硬编码 —— 真源改了我这里自动跟随）；
 *   ⑥ 零扫描判红：web i18n 或原生组件读不到 ⇒ 判红（防"正则与真源脱节 ⇒ 白绿"）。
 */

import { toolsPanelSummary } from '../../entry/src/main/ets/core/settings';

declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  existsSync(p: string): boolean;
};
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
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── 验证通道自证（断言数必须随新增而变；"改了却计数不变" ⇒ 先查早退/分支）────────
eq('SELFCHECK-1（占位：证明本文件在跑）', 1, 1);
eq('SELFCHECK-2（占位：证明计数在增）', 2, 2);

/** 仓库根（向上找 `entry/src/main/ets`）。 */
function findRoot(start: string): string {
  let cur: string = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(cur, 'entry', 'src', 'main', 'ets'))) { return cur; }
    cur = path.join(cur, '..');
  }
  return '';
}
const ROOT: string = findRoot(__dirname);

/** 剥注释 —— ⛔ 本判据的 key 名会出现在注释里（防"注释命中 ⇒ 假绿"）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function readNative(rel: string): string {
  const p: string = path.join(ROOT, 'entry', 'src', 'main', 'ets', rel);
  return fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf-8')) : '';
}

// ── 零扫描防线：三份真源都必须读到 ────────────────────────────────────────────
const SETTINGS_SRC: string = readNative('core/settings.ets');
const TOOLS_SRC: string = readNative('components/SettingsTools.ets');
const WEB_I18N: string = '/Users/bobli/src/xbot/web/src/i18n/zh-CN.ts';
const WEB_SRC: string = fs.existsSync(WEB_I18N) ? fs.readFileSync(WEB_I18N, 'utf-8') : '';

eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
ok('零扫描防线：core/settings.ets 读到源码', SETTINGS_SRC.length > 0);
ok('零扫描防线：components/SettingsTools.ets 读到源码', TOOLS_SRC.length > 0);
ok('零扫描防线：web i18n 真源读到（zh-CN.ts）', WEB_SRC.length > 0);

// ── ① 声明：偏好真源真的导出 toolsPanelSummary ─────────────────────────────────────
ok('① core/settings.ets 导出 toolsPanelSummary（declaration）',
  /export\s+function\s+toolsPanelSummary\s*\(\s*active\s*:\s*number\s*,\s*total\s*:\s*number\s*\)\s*:\s*string/.test(SETTINGS_SRC));

// ── ② 消费：调用点**恰好 1 处**（形态断言必须钉调用点计数）─────────────────────
{
  const calls: RegExpMatchArray | null = TOOLS_SRC.match(/toolsPanelSummary\s*\(/g);
  const n: number = calls === null ? 0 : calls.length;
  console.log(`    SettingsTools.ets 里 toolsPanelSummary( 调用点 = ${n} 处`);
  eq('② 组件消费点恰好 1 处（声明了没人调 = 假绿）', n, 1);
  ok('② 组件 import 了 toolsPanelSummary（来自 core/settings）',
    /import\s*\{[^}]*\btoolsPanelSummary\b[^}]*\}\s*from\s*'\.\.\/core\/settings'/.test(TOOLS_SRC));
}

// ── ③ 渲染落点：调用在 summary() 内，summary() 被 Text 渲染 ────────────────────
ok('③ toolsPanelSummary 调用落在 summary() 方法体内', /summary\s*\(\s*\)\s*:\s*string\s*\{[\s\S]{0,400}?toolsPanelSummary\s*\(/.test(TOOLS_SRC));
ok('③ 渲染落点：Text(this.summary()) 存在（读 this 的无参 Builder/方法 ⇒ 随状态重建）',
  /Text\s*\(\s*this\.summary\s*\(\s*\)\s*\)/.test(TOOLS_SRC));

// ── ④ 旧文案已消失（mutation 的另一面）────────────────────────────────────────
eq('④ 内联旧文案「已启用 N / M 项」已删除', /已启用\s*\$\{/.test(TOOLS_SRC), false);

// ── ⑤ 逐字对照 web 真源（读 web 文件，⛔ 不硬编码）────────────────────────────
{
  // web `settings.tools.summary: '已激活 {{active}} / {{total}} 个工具',`
  const m: RegExpMatchArray | null = WEB_SRC.match(/summary:\s*'([^']*\{\{active\}\}[^']*\{\{total\}\}[^']*)'/);
  ok('⑤ web 真源含 settings.tools.summary（{{active}}/{{total}} 双占位）', m !== null);
  if (m !== null) {
    const tmpl: string = m[1];
    console.log(`    web 模板: ${JSON.stringify(tmpl)}`);
    // 用与 web 相同的插值语义渲染（{{k}} ⇒ 值），再与原生纯函数逐字比。
    const rendered: string = tmpl
      .replace(/\{\{active\}\}/g, '3')
      .replace(/\{\{total\}\}/g, '10');
    eq('⑤ 原生 toolsPanelSummary(3,10) 与 web 渲染结果**逐字相同**', toolsPanelSummary(3, 10), rendered);
    eq('⑤ 零值边界也逐字相同', toolsPanelSummary(0, 0), tmpl.replace(/\{\{active\}\}/g, '0').replace(/\{\{total\}\}/g, '0'));
  }
}

// ── ⑥ 纯函数本身：形状（非空、双数字都进文案、不夹带未替换占位）──────────────────
ok('⑥ 输出非空', toolsPanelSummary(1, 2).length > 0);
ok('⑥ 两个入参都出现在输出里', toolsPanelSummary(7, 42).indexOf('7') >= 0 && toolsPanelSummary(7, 42).indexOf('42') >= 0);
eq('⑥ 不残留模板占位符', /\{\{/.test(toolsPanelSummary(1, 2)), false);

if (fail > 0) { console.log(`  ✗ settings_tools_summary: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ settings_tools_summary: ${pass} passed, 0 failed（声明 ∧ 消费 1 ∧ 渲染落点 ∧ 旧文案消失 ∧ 逐字对齐 web:728）`);
process.exit(0);

export {};
