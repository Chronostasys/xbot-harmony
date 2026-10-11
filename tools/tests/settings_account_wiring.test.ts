/**
 * 设置面 · 账号用户名「接线三跳」判据（审计 G1，2026-10-11 差集补齐）。
 *
 * 背景（本仓血教训：「死消费 / 半接线」——用户操作静默无效）：
 *   `SettingsAccount.ets` 早就支持 `@Prop username` 并渲染 `accountDisplayName(this.username)`，
 *   但 **`SettingsPanel.ets` 从未把 `username` 传给 `SettingsAccount`**，页面 `Index.ets:408`
 *   又有 `@State username` 也**没透传** ⇒ 账号页**永远显示不了真实用户名**（web 有：
 *   `SettingsDialog.tsx:84-90`）＝ 典型「能力在、链路断」。
 *
 * 判据（**钉调用点计数**，⛔ 不钉"成员存在"；剥注释后再判，防注释里的 `username` 假绿）：
 *   ① **零扫描防线**：三个源文件都必须读到（否则下面全是假绿）；
 *   ② **第一跳**：`SettingsPanel` 声明 `@Prop username`；
 *   ③ **第二跳**：`SettingsAccount({...})` 实参里出现 `username: this.username`（计数 ≥1）；
 *   ④ **第三跳**：`SettingsPanel({...})` 实参里出现 `username: this.username`（计数 ≥1）；
 *   ⑤ **消费点**：`SettingsAccount` 真把 `this.username` 喂给 `accountDisplayName(...)`（计数 ≥1，
 *      防"传进来了但没人读"）；
 *   ⑥ **mutation 自证**：把 ③ 的实参抹掉 ⇒ ③ 必红；把 ⑤ 的消费改成常量 ⇒ ⑤ 必红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 * ⚠️ 本文件是纯 TS（`export {}` + `declare require` 风格，照 settings_notify_ui.test.ts）。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? ' — ' + extra : ''}`); }
}

function findRoot(start: string): string {
  let cur: string = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(cur, 'entry', 'src', 'main', 'ets'))) { return cur; }
    cur = path.join(cur, '..');
  }
  return start;
}
const root: string = findRoot(__dirname);
function read(rel: string): string {
  const p: string = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

/** 剥注释：注释里记录旧做法/示例是**文档**，不该被判据当真代码（本仓多次踩坑）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 取 `Name({ ... })` 的**实参块**（花括号配平；找不到返回 ''）。 */
function callArgs(src: string, name: string): string {
  const at: number = src.indexOf(name + '({');
  if (at < 0) { return ''; }
  const open: number = src.indexOf('{', at + name.length);
  let depth: number = 0;
  for (let i = open; i < src.length; i++) {
    const c: string = src[i];
    if (c === '{') { depth++; } else if (c === '}') {
      depth--;
      if (depth === 0) { return src.slice(open, i + 1); }
    }
  }
  return '';
}

const panelRaw: string = read('entry/src/main/ets/components/SettingsPanel.ets');
const accountRaw: string = read('entry/src/main/ets/components/SettingsAccount.ets');
const indexRaw: string = read('entry/src/main/ets/pages/Index.ets');
const panel: string = stripComments(panelRaw);
const account: string = stripComments(accountRaw);
const index: string = stripComments(indexRaw);

console.log('=== 账号用户名接线三跳（G1）===');

// ① 零扫描防线
ok('① 读到 SettingsPanel.ets', panel.length > 0);
ok('① 读到 SettingsAccount.ets', account.length > 0);
ok('① 读到 pages/Index.ets', index.length > 0);

// ② 第一跳：面板声明 @Prop username
ok('② SettingsPanel 声明 `@Prop username`', /@Prop\s+username\s*:/.test(panel));

// ③ 第二跳：面板 → 账号面板（钉调用点计数）
const acctArgs: string = callArgs(panel, 'SettingsAccount');
ok('③ 找得到 `SettingsAccount({...})` 调用点', acctArgs.length > 0);
const passToAccount: boolean = /username\s*:\s*this\.username/.test(acctArgs);
ok('③ `SettingsAccount` 实参含 `username: this.username`（未透传 ⇒ 用户永远看不到自己是谁）', passToAccount);

// ④ 第三跳：页面 → 面板
const panelArgs: string = callArgs(index, 'SettingsPanel');
ok('④ 找得到 `SettingsPanel({...})` 调用点', panelArgs.length > 0);
ok('④ `SettingsPanel` 实参含 `username: this.username`', /username\s*:\s*this\.username/.test(panelArgs));

// ⑤ 消费点：账号面板真读它（防"传进来了但没人读"）
const usesIt: number = (account.match(/accountDisplayName\s*\(\s*this\.username\s*\)/g) || []).length;
ok('⑤ `SettingsAccount` 把 `this.username` 喂给 `accountDisplayName(...)`（消费点 ≥1）', usesIt >= 1,
   `实际 ${usesIt} 处`);

// ⑥ mutation 自证：判据必须能红
const m1: string = acctArgs.replace(/username\s*:\s*this\.username/, 'username: undefined');
ok('⑥ mutation：抹掉第二跳 ⇒ ③ 的判定必红',
   !/username\s*:\s*this\.username/.test(m1) && m1 !== acctArgs);
const m2: string = account.replace(/accountDisplayName\s*\(\s*this\.username\s*\)/, "accountDisplayName('x')");
ok('⑥ mutation：消费改常量 ⇒ ⑤ 的判定必红',
   !/accountDisplayName\s*\(\s*this\.username\s*\)/.test(m2));

console.log(`\n小结：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
