/**
 * 设置项「生效路径」判据（目标③ 第四层，2026-10-11）。
 *
 * 题目：每个设置键**运行时被改动后**是否真的生效 —— 尤其"**读了但不随变更刷新**"
 * （例如只在 `aboutToAppear`/`onPageShow` 这类**一次性钩子**里读 ⇒ 改了要重进页面，用户可感）。
 *
 * 口径：`pages/Index.ets` 里 `@State settings` 由 `syncFrom(store)` 刷新（`:1402`）
 *   ⇒ 凡在 **build / 派生方法**里读 `settingOf(…KEY_…)` 的键 ⇒ **同帧重渲染即生效**。
 *   ⛔ 一次性钩子里读 ⇒ 违反"改了就生效"。
 *
 * ⚠️ 扫描器自证 + 零扫描防线（2026-10-11 已出过 **3 次**同类事故：搜键值而非常量名 /
 *    整文件排除 / **前缀翻倍**）。本文件 `rel` 一律**相对 `ETS_DIR`**。
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
function srcOf(rel: string): string {
  const p: string = path.join(ETS_DIR, rel);
  return fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf-8')) : '';
}

/** 一次性钩子名（只在特定时机跑一次 ⇒ 在那里读设置 = 不随变更刷新）。 */
const ONE_SHOT_HOOKS: string[] = ['aboutToAppear', 'onPageShow', 'aboutToDisappear', 'onBackPress'];

/** 抽出某个钩子的**方法体**（按 2 空格缩进的闭合大括号收口；本文件统一风格）。 */
function hookBody(src: string, hook: string): string {
  const ls: string[] = src.split('\n');
  let start: number = -1;
  for (let i = 0; i < ls.length; i++) {
    if (ls[i].indexOf(`${hook}(`) >= 0 && ls[i].indexOf('{') >= 0) { start = i; break; }
  }
  if (start < 0) { return ''; }
  let out: string = '';
  for (let i = start + 1; i < ls.length; i++) {
    if (ls[i] === '  }') { break; }
    out += ls[i] + '\n';
  }
  return out;
}

const INDEX_SRC: string = srcOf('pages/Index.ets');
const SETTINGS_KEYS: string[] = [
  'KEY_MD_THEME', 'KEY_ACCENT', 'KEY_SEND_KEY', 'KEY_CODE_WRAP', 'KEY_FONT_SCALE',
  'KEY_ORB', 'KEY_REASONING_DEFAULT', 'KEY_APP_THEME', 'KEY_SURFACE',
  'KEY_STARRED', 'KEY_SESSION_CATEGORY',
];
/** 白名单：**有意**在一次性路径里读的键（每条必须给理由）。 */
const ALLOWED_ONE_SHOT: string[] = [
  // `KEY_SURFACE`：`Index.ets:1419` 的读取在 `syncFrom` 里、由 `surfaceApplied` **一次性闸门**保护
  // —— 有意设计（防"聊天进行中"被强制换面）。用户体验：**改后需重进页面生效**（已记入 WEB-PARITY）。
  // ⛔ 它不在 `aboutToAppear` 里；进白名单是为了在任何"一次性"路径出现时不误报。
  'KEY_SURFACE',
];

// ── 零扫描防线 + 自证 ───────────────────────────────────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
eq('零扫描防线：读到 pages/Index.ets 源码（非空）', INDEX_SRC.length > 1000, true);
{
  let found: number = 0;
  console.log('  ── 扫描器自证：钩子体长度 + 逐键读取分布 ──');
  for (let i = 0; i < ONE_SHOT_HOOKS.length; i++) {
    const body: string = hookBody(INDEX_SRC, ONE_SHOT_HOOKS[i]);
    console.log(`    ${ONE_SHOT_HOOKS[i].padEnd(20)} 体 ${body.length} 字符`);
    if (body.length > 0) { found++; }
  }
  // `aboutToAppear`/`onPageShow` 必须能被抽出来（否则抽体逻辑坏了 ⇒ 假绿）
  eq('零扫描防线：aboutToAppear 与 onPageShow 的体都抽到了', found >= 2, true);
  let readSites: number = 0;
  for (let i = 0; i < SETTINGS_KEYS.length; i++) {
    const n: number = (INDEX_SRC.match(new RegExp(`settingOf\\((this|store)\\.settings, ${SETTINGS_KEYS[i]}\\)`, 'g')) || []).length;
    console.log(`    ${SETTINGS_KEYS[i].padEnd(24)} 读取点 ${n}`);
    readSites += n;
  }
  eq('零扫描防线：11 个键至少各有 1 个读取点（总 >= 11）', readSites >= 11, true);
}

// ── 判定：一次性钩子里**不得**读设置键（白名单除外）────────────────────────────
{
  const bad: string[] = [];
  for (let hi = 0; hi < ONE_SHOT_HOOKS.length; hi++) {
    const body: string = hookBody(INDEX_SRC, ONE_SHOT_HOOKS[hi]);
    for (let ki = 0; ki < SETTINGS_KEYS.length; ki++) {
      const key: string = SETTINGS_KEYS[ki];
      if (body.indexOf(key) < 0) { continue; }
      let allowed = false;
      for (let ai = 0; ai < ALLOWED_ONE_SHOT.length; ai++) {
        if (ALLOWED_ONE_SHOT[ai] === key) { allowed = true; }
      }
      if (!allowed) { bad.push(`${ONE_SHOT_HOOKS[hi]} 里读了 ${key}（⇒ 改了不生效，需重进页面）`); }
    }
  }
  if (bad.length > 0) {
    console.log('  ✗ 设置键在一次性钩子里被读（应改为 build/派生方法里读）：');
    for (let i = 0; i < bad.length; i++) { console.log(`      ${bad[i]}`); }
  }
  eq('每个设置键的读取都在 build/派生方法里（⛔ 不在 aboutToAppear/onPageShow 等一次性钩子）', bad.length, 0);
}

if (fail > 0) { console.log(`  ✗ settings_apply_path: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ settings_apply_path: ${pass} passed, 0 failed（11 键；一次性钩子读取 0 处；白名单 1）`);
process.exit(0);
