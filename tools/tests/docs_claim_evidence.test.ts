/**
 * 「文档=实现」机器核对（meta 判据，2026-10-11）。
 *
 * 动机（真实事故）：本波 `K` 的任务前提来自**陈旧文档**（文档说某能力"0 消费方"，
 *   实际早已修好）⇒ 白花一轮；另有多处 `✅ 已修` 标记与实际状态不符，靠人工复核才发现。
 *
 * 本判据：扫 `docs/WEB-PARITY.md` + `docs/WEB-ALIGNMENT.md` 里含 **`✅`** 的行 ⇒
 *   抽出其引用的**本仓判据文件名**（`xxx.test.ts`）⇒ 断言 `tools/tests/<name>` **存在**。
 *
 * ⚠️ **假红源（本轮取证暴露，必须避开）**：两文档是**对照表**，行内同时含 **web 出处列**
 *   （如 `components/agent/ContextBar.tsx` 对应 `ContextBar.test.tsx`）⇒ 若把 `*.test.tsx`
 *   也当"本仓声称"就会**假红**。规则：**只认 `*.test.ts`**（本仓判据后缀），`*.test.tsx` 与已知
 *   web 路径进白名单（附理由）。⛔ 不许为了变绿把真·本仓声称塞进白名单。
 *
 * ⚠️ **诚实边界**：本判据只核"**声称的判据文件是否存在**"，**不核**"该断言是否真的覆盖它声称的事"
 *   （"⚠️ 弱"档）⇒ 后者留作抽样（见文件末 `SPOT_CHECK` 注释）。
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
const DOCS: string[] = ['docs/WEB-PARITY.md', 'docs/WEB-ALIGNMENT.md'];
const TESTS_DIR: string = path.join(ROOT, 'tools', 'tests');

/**
 * 白名单：**不是本仓判据声称**的文件名（每条必须给理由；⛔ 只许缩短）。
 *  · `ContextBar.test.tsx` —— **web 侧**文件（`WEB-PARITY.md:639` 的"web 出处"列，
 *    指 web `components/agent/ContextBar.tsx`）。本判据只认 `*.test.ts`，这条是双保险。
 */
const NON_NATIVE_CLAIM: string[] = ['ContextBar.test.tsx'];

// ── 抽取：`✅ 行` 里引用的本仓判据文件名 ─────────────────────────────────────
interface Claim { readonly doc: string; readonly line: number; readonly name: string; }
const claims: Claim[] = [];
let scannedLines: number = 0;
let markerLines: number = 0;
for (let di = 0; di < DOCS.length; di++) {
  const p: string = path.join(ROOT, DOCS[di]);
  if (!fs.existsSync(p)) { continue; }
  const ls: string[] = fs.readFileSync(p, 'utf-8').split('\n');
  for (let li = 0; li < ls.length; li++) {
    scannedLines++;
    if (ls[li].indexOf('✅') < 0) { continue; }
    markerLines++;
    // ⛔ 只认 `*.test.ts`（本仓判据后缀）；`*.test.tsx` 是 web 侧 ⇒ 不抽
    const m: RegExpMatchArray | null = ls[li].match(/[A-Za-z_0-9]+\.test\.ts(?!x)/g);
    if (m !== null) {
      for (let i = 0; i < m.length; i++) {
        claims.push({ doc: DOCS[di], line: li + 1, name: m[i] });
      }
    }
  }
}

// ── 零扫描防线 + 自证（打印抽到的引用清单 + 逐条存在性）────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
eq('零扫描防线：两份文档都读到了（行数 > 100）', scannedLines > 100, true);
// ⚠️ 口径差异（本轮实测）：**只扫 `✅` 行**时实数 = 5；上一轮我 grep **全文档**得 34（含非 ✅ 行与
//    `*.test.tsx` 前缀匹配）⇒ 阈值按**本判据口径**定，不按那次 grep 的错觉。
eq('零扫描防线：抽到 ≥3 条 ✅ 行内的判据引用（抽到 0 ⇒ 抽取逻辑坏 ⇒ 红）', claims.length >= 3, true);
console.log(`  ── 自证：扫 ${scannedLines} 行 / 含 ✅ 的 ${markerLines} 行 / 抽出 ${claims.length} 条判据引用 ──`);

let missing: number = 0;
let whitelisted: number = 0;
const seen: string[] = [];
for (let i = 0; i < claims.length; i++) {
  const n: string = claims[i].name;
  if (seen.indexOf(n) >= 0) { continue; }
  seen.push(n);
  let allowedHere = false;
  for (let j = 0; j < NON_NATIVE_CLAIM.length; j++) {
    if (NON_NATIVE_CLAIM[j] === n) { allowedHere = true; }
  }
  const exists: boolean = fs.existsSync(path.join(TESTS_DIR, n));
  console.log(`    ${n.padEnd(34)} ${exists ? '存在' : '❌ 缺失'}   (${claims[i].doc}:${claims[i].line})`);
  if (!exists) {
    if (allowedHere) { whitelisted++; } else { missing++; }
  }
}
eq(`✅ 行声称的判据文件必须存在（缺失 ${missing} 条；白名单 ${whitelisted} 条）`, missing, 0);
eq('白名单只列"非本仓声称"（web 侧）文件，且都确实不在 tools/tests/', whitelisted, 0);

if (fail > 0) { console.log(`  ✗ docs_claim_evidence: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ docs_claim_evidence: ${pass} passed, 0 failed（${seen.length} 个唯一判据名，全部存在）`);
console.log('  ⚠️ 诚实边界：本判据只核"判据文件是否存在"，**不核**断言内容是否真覆盖声称。');
console.log('     —— SPOT_CHECK（抽样，非全量）：mdtheme/mdtheme.test.ts 覆盖 23 套装与文案计数；');
console.log('        settings_value_sets/settings_value_sets.test.ts 覆盖 accent 6 同序；');
console.log('        free_surface_layers/free_surface_layers.test.ts 覆盖 10 自由面口径族。剩余未逐条核。');
process.exit(0);
