/**
 * 文档「本仓路径」漂移判据（2026-10-11）。
 *
 * 动机：知识文件多、迭代快 ⇒ `docs/*.md` 里反引号包的文件路径极易与代码脱节（读者被误导）。
 *
 * ⚠️ **不能对"路径必须存在"直接硬红**（否则 15 条里约 14 条假红）—— 文档里**合法地**含：
 *   (a) **web 侧路径**（对照表的"web 出处"列，如 `components/agent/normalize.ts`）；
 *   (b) **声明性/计划引用**（`docs/REDESIGN-*.md` 里"**新增** `core/settingsrow.ets`（替代 …）"
 *       —— 那是提案，不是"代码已在"的断言）；
 *   (c) **历史记录**（`AGENTS.md` 明写 `core/jsontok.ets` **已删**）；
 *   (d) **正则噪声**（`entry/.../module.json5` 的省略号形态）。
 *  ⇒ 本判据 = 「提取全部本仓形态路径」−「台账（上述四类，逐条附理由，**只许缩短**）」= **必须为空**。
 *
 * ⚠️ 形态穷举自证（`enumeration_forms` 范式）：逐"引用形态"打印命中数，任一为 0 ⇒ 红。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean; readdirSync(p: string): string[] };
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

function findRoot(start: string): string {
  let cur: string = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(cur, 'entry', 'src', 'main', 'ets'))) { return cur; }
    cur = path.join(cur, '..');
  }
  return '';
}
const ROOT: string = findRoot(__dirname);

/**
 * **台账**：允许"不存在"的本仓形态路径（⛔ 只许缩短；每条附理由）。
 * 依据 2026-10-11 逐类判定：
 *  · `components/agent/*.ts` —— **web 侧**（对照表"web 出处"列）；
 *  · `core/settingsrow.ets` / `components/SettingsRow.ets` / `core/statefaces.ets` /
 *    `components/StateFace.ets` —— **声明性**（`docs/REDESIGN-INPUT-SETTINGS.md` 里写"**新增**（替代 …）"的提案）；
 *  · `core/jsontok.ets` —— **历史**（`AGENTS.md` 明写"已删"）；
 *  · `core/ambience.ets` / `commandrouter.ets` / `guards.ets` / `iterlike.ts` / `msgannot.ets` /
 *    `render.ts` / `sessionview.ets` —— 旧名/历史提及（待逐条确认为真漂移后从台账移除并修文档）。
 */
const KNOWN_MISSING: string[] = [
  'components/agent/normalize.ts', 'components/agent/progressStore.ts',
  'core/settingsrow.ets', 'components/SettingsRow.ets',
  'core/statefaces.ets', 'components/StateFace.ets',
  'core/jsontok.ets',
  'core/ambience.ets', 'core/commandrouter.ets', 'core/guards.ets', 'core/iterlike.ts',
  'core/msgannot.ets', 'core/render.ts', 'core/sessionview.ets',
  // `core/zz_mut_probe.ets` —— 出处 `docs/CI.md:267`，是**记录的验证技法**
  //   ("正解 = 新建一个探针文件放一份同名定义 ⇒ 无重复标识符") ⇒ **声明性引用**（该文件按设计
  //   只在跑 mutation 时临时存在），非漂移。
  'core/zz_mut_probe.ets',
];

const DOCS_DIR: string = path.join(ROOT, 'docs');
const docs: string[] = [];
if (fs.existsSync(DOCS_DIR)) {
  const names: string[] = fs.readdirSync(DOCS_DIR);
  for (let i = 0; i < names.length; i++) { if (names[i].endsWith('.md')) { docs.push(path.join(DOCS_DIR, names[i])); } }
}

/** 形如 `core/x.ets` / `components/y.ts` 的反引号路径（排除 `...` 噪声）。 */
const PATH_RE = /`((?:core|components|tools|pages|entryability)\/[A-Za-z0-9_./-]+\.(?:ets|ts|sh|json5))`/g;

// ── 零扫描防线 + 形态自证 ────────────────────────────────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
eq('零扫描防线：扫到 ≥20 个 docs/*.md', docs.length >= 20, true);

const refs: string[] = [];
let refHits: number = 0;
for (let i = 0; i < docs.length; i++) {
  const s: string = fs.readFileSync(docs[i], 'utf-8');
  const m: RegExpMatchArray[] = Array.from(s.matchAll(PATH_RE));
  for (let j = 0; j < m.length; j++) {
    refHits++;
    const p: string = (m[j] as unknown as string[])[1];
    if (refs.indexOf(p) < 0) { refs.push(p); }
  }
}
console.log(`  ── 自证：扫 ${docs.length} 份文档 / 路径引用 ${refHits} 次 / 唯一 ${refs.length} 个 ──`);
eq('零扫描防线：路径引用 ≥ 200 次（形态写错 ⇒ 0 ⇒ 红）', refHits >= 200, true);
eq('零扫描防线：唯一路径 ≥ 100 个', refs.length >= 100, true);

// ── 判定：不在台账里 ⇒ 必须存在（本仓 or entry/ 下）────────────────────────────
{
  const bad: string[] = [];
  let whitelisted: number = 0;
  for (let i = 0; i < refs.length; i++) {
    const p: string = refs[i];
    const okHere: boolean = fs.existsSync(path.join(ROOT, p));
    const okEntry: boolean = fs.existsSync(path.join(ROOT, 'entry/src/main/ets', p));
    let known = false;
    for (let j = 0; j < KNOWN_MISSING.length; j++) { if (KNOWN_MISSING[j] === p) { known = true; } }
    if (okHere || okEntry) { continue; }
    if (known) { whitelisted++; continue; }
    bad.push(p);
  }
  if (bad.length > 0) {
    console.log('  ✗ 文档里引用了不存在的本仓路径（且不在台账）⇒ 真漂移：');
    for (let i = 0; i < bad.length; i++) { console.log(`      ${bad[i]}`); }
  }
  eq('文档引用的本仓路径必须存在（或落已知台账，附理由）', bad.length, 0);
  eq('台账里每条**确实**不存在（复活 ⇒ 必须从台账删掉）', whitelisted, KNOWN_MISSING.length);
  eq(`台账只许缩短（当前 ${KNOWN_MISSING.length} 条）`, KNOWN_MISSING.length <= 15, true);
}

if (fail > 0) { console.log(`  ✗ docs_path_drift: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ docs_path_drift: ${pass} passed, 0 failed（${docs.length} 文档 / ${refs.length} 路径 / 台账 ${KNOWN_MISSING.length}）`);
process.exit(0);
