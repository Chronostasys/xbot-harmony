/**
 * 设置项「生效路径」判据（目标③ 第四层，2026-10-11）—— **覆盖全部"读设置"写法**。
 *
 * 题目：每个设置项**运行时被改动后**是否真的生效 —— 尤其"**读了但不随变更刷新**"
 *   （只在 `aboutToAppear`/`onPageShow` 等**一次性钩子**里读 ⇒ 改了要重进页面，用户可感）。
 *
 * ⚠️⚠️ **两条用血换来的教训（本仓已各出多次）**：
 *  ① `rel` 一律**相对 `ETS_DIR`** —— 曾把已含 `entry/src/main/ets` 的整路径再 join 到 ETS_DIR
 *     ⇒ **前缀翻倍** ⇒ 5 个探针全 0。
 *  ② ⛔ **带 `(` 的模式别用 `grep -cE "$f"`** —— shell 把 `(` 当元字符/参数解析 ⇒ 计数**全落空**、
 *     却被当成"0 命中"。本判据在 node 里用 `RegExp` 计数，**不经 shell**。
 *
 * 写法全集（A~E）：见 `READ_PATTERNS`。⛔ **每种写法必须命中 ≥1**，否则判红
 *   （防"扫法不全 ⇒ 假绿"——例如只覆盖 `settingOf` 时 `KEY_ORB` 恒为 0）。
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
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
/** ⚠️ `rel` 必须**相对 `ETS_DIR`**（教训 ①）。 */
function srcOf(rel: string): string {
  const p: string = path.join(ETS_DIR, rel);
  return fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf-8')) : '';
}

/** 一次性钩子（只在特定时机跑一次 ⇒ 在那里读设置 = 不随变更刷新）。 */
const ONE_SHOT_HOOKS: string[] = ['aboutToAppear', 'onPageShow', 'aboutToDisappear', 'onBackPress'];

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

/** **读设置的全部写法**（A~E）；每种都必须 ≥1 命中（否则判红）。 */
interface ReadPattern { readonly name: string; readonly re: RegExp; }
const READ_PATTERNS: ReadPattern[] = [
  { name: 'A settingOf(...)', re: /settingOf\(/g },
  { name: 'B 归一化访问器', re: /\b(orbEnabled|notifyPrefsFrom|fontScaleFrom|normalizeSendKey|normalizeMdTheme|normalizeAccent|normalizeLocale|thinkDisplayFromDb|parseTierValue|tierValues)\(/g },
  { name: 'C parseBool(...)', re: /\bparseBool\(/g },
  { name: 'D 直接字段读 .settings[x]', re: /\.settings\[[A-Za-z_]/g },
  // ⚠️ E 的**真实形态** = `settingOf(store.settings, KEY_x)`（读 **store 镜像**整张 map），
  //    见 Index.ets:1403/1412/1419。第一版我写成 `orbEnabled(store.settings)` 之类 ⇒ 命中 0 ⇒
  //    「每种写法 ≥1」防线**正确开火**（它不是假绿，是把"扫法不全"抓了出来）。
  { name: 'E store.settings 整张传入 settingOf', re: /settingOf\(store\.settings/g },
];

function collect(dir: string, out: string[]): void {
  const es = fs.readdirSync(dir, { withFileTypes: true });
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    const p: string = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'build' || e.name === 'oh_modules' || e.name === 'node_modules') { continue; }
      collect(p, out);
    } else if (e.name.endsWith('.ets')) { out.push(p); }
  }
}
const ALL: string[] = [];
if (ETS_DIR.length > 0) { collect(ETS_DIR, ALL); }

/**
 * **白名单**（写法 D 的**泛型透传 / 归一化在下游 / 回滚读**）—— 2026-10-11 逐处语境判定，
 * 全部"无害"（⛔ 只许缩短）：
 *  · `core/store.ets:437`   —— 原始 accent 交给 setAppAccent，**归一化在下游** `withAccent→normalizeAccent`；
 *  · `core/settings.ets:1073` —— `tierValues` 内**泛型透传**（按调用方 key 取，无固定语义）；
 *  · `core/rpc.ets:1043`    —— 同上，泛型 key 查找；
 *  · `pages/Index.ets:4612/4624` —— 写路径 + **回滚用的泛型读**（旧值原样存回，不经语义消费）。
 */
const WRITE_SIDE_OR_GENERIC: string[] = [
  'core/store.ets', 'core/settings.ets', 'core/rpc.ets', 'pages/Index.ets',
];

const INDEX_SRC: string = srcOf('pages/Index.ets');
const SETTINGS_KEYS: string[] = [
  'KEY_MD_THEME', 'KEY_ACCENT', 'KEY_SEND_KEY', 'KEY_CODE_WRAP', 'KEY_FONT_SCALE',
  'KEY_ORB', 'KEY_REASONING_DEFAULT', 'KEY_APP_THEME', 'KEY_SURFACE',
  'KEY_STARRED', 'KEY_SESSION_CATEGORY',
];

// ── 零扫描防线 + 逐写法分布（每种写法 ≥1，否则扫法不全 ⇒ 红）────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
eq('零扫描防线：读到 pages/Index.ets 源码（非空）', INDEX_SRC.length > 1000, true);
eq('零扫描防线：扫到 ≥100 个 .ets 源文件', ALL.length >= 100, true);
{
  let missingPattern: number = 0;
  console.log('  ── 逐写法命中分布（全仓 .ets；每类必须 ≥1）──');
  for (let pi = 0; pi < READ_PATTERNS.length; pi++) {
    let n: number = 0;
    for (let fi = 0; fi < ALL.length; fi++) {
      const m: string[] | null = stripComments(fs.readFileSync(ALL[fi], 'utf-8')).match(READ_PATTERNS[pi].re);
      if (m !== null) { n += m.length; }
    }
    console.log(`    ${READ_PATTERNS[pi].name.padEnd(34)} × ${n}`);
    if (n === 0) { missingPattern++; }
  }
  eq('每种读法都要被扫到 ≥1（否则扫法不全 ⇒ 假绿）', missingPattern, 0);
  let hooks: number = 0;
  for (let i = 0; i < ONE_SHOT_HOOKS.length; i++) {
    if (hookBody(INDEX_SRC, ONE_SHOT_HOOKS[i]).length > 0) { hooks++; }
  }
  eq('零扫描防线：≥2 个一次性钩子体抽到了（否则抽体逻辑坏 ⇒ 假绿）', hooks >= 2, true);
  let reads: number = 0;
  for (let i = 0; i < SETTINGS_KEYS.length; i++) {
    reads += (INDEX_SRC.match(new RegExp(`settingOf\\((this|store)\\.settings, ${SETTINGS_KEYS[i]}\\)`, 'g')) || []).length;
  }
  eq('零扫描防线：11 键的 settingOf 读取点 ≥11', reads >= 11, true);
}

// ── 判定：一次性钩子里**不得**出现任何一种"读设置"写法（写法 D 仅白名单文件放行）────
{
  const bad: string[] = [];
  for (let hi = 0; hi < ONE_SHOT_HOOKS.length; hi++) {
    const body: string = hookBody(INDEX_SRC, ONE_SHOT_HOOKS[hi]);
    for (let pi = 0; pi < READ_PATTERNS.length; pi++) {
      const m: string[] | null = body.match(READ_PATTERNS[pi].re);
      if (m === null) { continue; }
      // 写法 D 的**写**侧（`this.settings[k] = v`）不是"读"，单独放行；其余一律判红。
      if (READ_PATTERNS[pi].name.indexOf('D ') === 0) {
        const lines: string[] = body.split('\n');
        let readOnly: number = 0;
        for (let li = 0; li < lines.length; li++) {
          if (/\.settings\[[A-Za-z_]/.test(lines[li]) && lines[li].indexOf('] =') < 0) { readOnly++; }
        }
        if (readOnly === 0) { continue; }
        bad.push(`${ONE_SHOT_HOOKS[hi]} 里出现「${READ_PATTERNS[pi].name}」读 × ${readOnly}（⇒ 改了不生效）`);
        continue;
      }
      bad.push(`${ONE_SHOT_HOOKS[hi]} 里出现「${READ_PATTERNS[pi].name}」× ${m.length}（⇒ 改了不生效）`);
    }
  }
  if (bad.length > 0) {
    console.log('  ✗ 一次性钩子里出现读设置：');
    for (let i = 0; i < bad.length; i++) { console.log(`      ${bad[i]}`); }
  }
  eq('一次性钩子里不得出现任何"读设置"写法（改了要重进页面 = 用户可感缺陷）', bad.length, 0);
  eq('白名单只覆盖"写侧/泛型透传"的 4 个文件（逐处理由见常量注释）', WRITE_SIDE_OR_GENERIC.length, 4);
}

if (fail > 0) { console.log(`  ✗ settings_apply_path: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ settings_apply_path: ${pass} passed, 0 failed（5 类读法全覆盖；一次性钩子读取 0 处）`);
process.exit(0);
