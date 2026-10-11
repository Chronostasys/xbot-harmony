/**
 * 触觉反馈门禁（E4）—— **"既有约定"钉成判据**（⛔ 不许到处加）。
 *
 * ── 结论（取证，2026-10-11）──────────────────────────────────────────────────────
 *   · **web 权威无任何触觉**：`/Users/bobli/src/xbot/web` 全仓 `vibrate|Vibrat|haptic` **0 命中**
 *     ⇒ 按 parity 与"别到处加"，**不引入新触觉点、不引入新 API**。
 *   · native **已有既有约定**：`pages/Index.ets` 的**单一 helper** `private buzz()`（`:4489-4500`）
 *     —— `vibrator.startVibration({ type:'time', duration: 12 }, …)`，**静默失败**
 *     （`try/catch` + `.catch(()=>{})`；无马达/无权限也绝不打断流程），由 **6 处**交互复用
 *     （`:2327/:3085/:4475/:4485/:4548/:5425`）。
 *
 * ── 本判据守什么 ────────────────────────────────────────────────────────────────
 *   ① **唯一入口**：全仓 `startVibration(` 调用点**恰好 1 处**且只在 `pages/Index.ets`
 *      ⇒ 任何人想加触觉**必须**走 `buzz()`（或显式改本台账并说明理由）。
 *   ② **组件层零触觉**：`components/**` 不得出现 `vibrator`（触觉属页面级交互，组件别自己震）。
 *   ③ **静默失败契约**：承载文件必须同时有 `try` / `catch` / `.catch(`（触觉失败 ⛔ 不得中断任何流程）。
 *   ④ **入口确实在用**：`this.buzz()` ≥ 1（防"文档里有、代码里没"）。
 *
 * ⛔ 判据纪律：读**真实源码**、**剥注释**（本仓 GOTCHA）、**零扫描判红**。
 * mutation 自证：往任意 `components/**` 里加一行 `vibrator.startVibration(...)` ⇒ ① 与 ② 必红。
 *
 * ⚠️ 有 `export {}`（⇒ TS 模块），避免与"无 import 的全局脚本"测试在聚合编译里撞名。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    const n = i + 1 < src.length ? src.charAt(i + 1) : '';
    if (c === '/' && n === '/') {
      while (i < src.length && src.charAt(i) !== '\n') { i++; }
      if (i < src.length) { out += '\n'; i++; }
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src.charAt(i) === '*' && i + 1 < src.length && src.charAt(i + 1) === '/')) {
        if (src.charAt(i) === '\n') { out += '\n'; }
        i++;
      }
      i += 2;
    } else { out += c; i++; }
  }
  return out;
}
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/pages/Index.ets'))) { return p; }
  }
  return '';
}
function walk(dir: string, out: string[]): void {
  let ents: any[] = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, out); }
    else if (e.name.endsWith('.ets')) { out.push(full); }
  }
}

/** 允许出现 `startVibration(` 的文件（**台账**：新增条目必须写理由 —— 也就是"决定加触觉点"本身要留痕）。 */
const VIBRATION_ALLOWLIST: Map<string, string> = new Map<string, string>([
  ['pages/Index.ets', '唯一入口 `buzz()`：发送/停止等 6 处复用；12ms 短震 + 静默失败'],
]);

const root: string = findRoot();
ok('探测到仓库根', root.length > 0);
const ETS: string = path.join(root, 'entry/src/main/ets');
const files: string[] = [];
walk(ETS, files);
ok(`扫到 .ets 文件 > 0（实得 ${files.length}）—— 零扫描判红`, files.length > 0);

const vibFiles: string[] = [];
let vibSites = 0;
let compVib = 0;             // 组件层触觉（应为 0）
let indexSrc = '';
let indexBuzzCalls = 0;
const ledger: string[] = [];

for (const f of files) {
  const rel: string = path.relative(ETS, f).split(path.sep).join('/');
  const src: string = stripComments(fs.readFileSync(f, 'utf8'));
  if (rel === 'pages/Index.ets') { indexSrc = src; }
  const n: number = (src.match(/startVibration\(/g) || []).length;
  if (n > 0) {
    vibFiles.push(rel);
    vibSites += n;
    ledger.push(`${rel}: startVibration ×${n}`);
    if (rel.indexOf('components/') === 0) { compVib += n; }
  }
  if (rel === 'pages/Index.ets') { indexBuzzCalls = (src.match(/this\.buzz\(\)/g) || []).length; }
}

console.log(`▶ 触觉扫描：${files.length} 个 .ets，startVibration 调用点 ${vibSites} 处`);
for (const l of ledger) { console.log(`    · ${l}`); }
console.log(`    · 唯一入口复用：this.buzz() ×${indexBuzzCalls}`);

// ① 唯一入口
eq('① 全仓 `startVibration(` 恰好 1 处（唯一入口）', vibSites, 1);
eq('① 且落在 allowlist 内', vibFiles.filter((r: string) => VIBRATION_ALLOWLIST.has(r)).length, vibFiles.length);
ok('① 落在 `pages/Index.ets`（页面级交互，非组件）', vibFiles.length === 1 && vibFiles[0] === 'pages/Index.ets',
  `实得：${vibFiles.join(', ')}`);
// ② 组件层零触觉
eq('② `components/**` 零 `startVibration`（组件别自己震）', compVib, 0);
// ③ 静默失败契约
ok('③ 承载文件有静默失败契约（try + catch + .catch）',
  indexSrc.indexOf('try {') >= 0 && indexSrc.indexOf('catch (e)') >= 0 && indexSrc.indexOf('.catch(') >= 0);
// ④ 入口确实在用
ok(`④ 唯一入口确实被复用（this.buzz() ≥ 1，实得 ${indexBuzzCalls}）`, indexBuzzCalls >= 1);

if (fail > 0) { console.log(`  haptics: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  haptics: ${pass} passed, 0 failed`);
process.exit(0);
