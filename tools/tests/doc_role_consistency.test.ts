/**
 * **文档 ↔ 代码 的 role 集合双向一致性**（防"散文记号 role"复发；2026-10-11）。
 *
 * ── 文档侧抽取规则（本判据的可机读口径，写死在此以自证）────────────────────────────
 * `docs/DESIGN-SYSTEM.md §12` **故意不列合法集合**（原文："合法集合**从真源自动抽取**……此处不复制
 * 粘贴以免两处漂移"）⇒ 故本判据取**文档唯一可机读的 role 断言** = **§12.2 的映射表**：
 *   `` `text.pillName → textPrimary`｜`text.chip → textSecondary`｜… ``
 * 抽取正则：`` `([a-z][a-zA-Z]*\.[a-zA-Z]+)\s*→\s*([a-zA-Z_]+(?:\(\))?)` ``（**限 §12.2 那行**，防把
 * 别处的散文记号当映射）。
 * 语义（双向，各一条）：
 *   · **方向 A**：映射的**真 role 侧**（`textPrimary`/`dangerText`/… **无点**）必须∈代码合法集合；
 *   · **方向 B（反例自检）**：映射的**记号侧**（`text.pillName`/… **带点**）必须∉代码合法集合
 *     —— 否则文档的"⛔ 陷阱"警告本身是错的（那记号其实是合法的）。
 * 代码侧合法集合：**现场解析** `core/design.ets` 的 `colorOf`（`role === '…'`）+ `new SurfaceRole('…')`
 *   + `new TypeRole('…')`（与门禁 ⑥b 同口径）；⛔ 不硬编码复制。
 * 阈值/来源：无阈值（集合相等性）；**零扫描判红**（任一侧解析到 0 ⇒ 红）。
 * mutation：① 把某映射的真 role 侧改成假 role（如 `status.danger`）⇒ ★① 红；
 *   ② 把某映射的记号侧改成**合法** role（如 `text.pillName → textPrimary` 的左改成 `textPrimary`）⇒ ★② 红。
 * ⚠️ 断言插在 `if (fail > 0)` **之外**。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
const fsMod = require('fs');
const pathMod = require('path');
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const c = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(c, 'docs/DESIGN-SYSTEM.md'))) { repo = c; break; }
}
ok('探测到仓库根', repo.length > 0);

if (repo.length > 0) {
  const strip = (x: string): string => x.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // ── 代码侧：现场解析合法集合（与 ⑥b 同口径）────────────────────────────────────
  const design: string = strip(fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/design.ets'), 'utf-8'));
  const legal: string[] = [];
  const push = (s: string): void => { if (legal.indexOf(s) < 0) { legal.push(s); } };
  let m: RegExpExecArray | null;
  const reRole = /role === '([^']+)'/g;
  while ((m = reRole.exec(design)) !== null) { push(m[1]); }
  const reFace = /new SurfaceRole\('([^']+)'/g;
  while ((m = reFace.exec(design)) !== null) { push(m[1]); }
  const reType = /new TypeRole\('([^']+)'/g;
  while ((m = reType.exec(design)) !== null) { push(m[1]); }
  ok(`★零扫描判红（代码侧）：解析到合法 role ${legal.length} 个`, legal.length > 0);

  // ── 文档侧：抽 §12.2 的映射表 ────────────────────────────────────────────────
  const doc: string = fsMod.readFileSync(pathMod.join(repo, 'docs/DESIGN-SYSTEM.md'), 'utf-8');
  // ⚠️ 2026-10-11 修：整段 §12.2 会混入**跨行散文块**与 `colorOf(p,'warn')` 之类的**散文提及**
  //    （实测 9 条里后 3 条不是映射）⇒ **只取"常用映射"那一行**（该行以 `常用映射：` 起、以空行止）
  //    —— 这是文档里**唯一**的"记号 → 真 role"清单。
  // 抽取规则（写死在此以自证）：只取 §12.2 里 `` `记号 → 真role` `` 形状的**成对**条目 ——
  //   记号侧**必须有点**（`text.pillName`）、真侧**必须无点**（`textPrimary`）或函数形态（`brandAccent()`）。
  //   ⚠️ 形状预过滤会**静默跳过畸形映射** ⇒ 因此**必须配"条数台账"**（见下），否则白绿。
  const MAP_BASELINE: number = 7;   // 实测：形状过滤后正好 7 条（只许缩短）
  const sect: string = doc.substring(doc.indexOf('### 12.2'), doc.indexOf('### 12.3'));
  const maps: string[][] = [];
  const reMap = /`([a-z][a-zA-Z]*\.[a-zA-Z]+)\s*→\s*([a-zA-Z_]+(?:\(\))?)`/g;
  while ((m = reMap.exec(sect)) !== null) { maps.push([m[1], m[2]]); }
  ok(`★零扫描判红（文档侧）：抽到映射 ${maps.length} 条`, maps.length > 0);
  ok(`★台账：映射条数 == ${MAP_BASELINE}（⛔ 只许缩短；畸形/丢失映射 ⇒ 必红）`, maps.length === MAP_BASELINE);

  // ★① 方向 A：真 role 侧（无点）必须合法
  let badA: string[] = [];
  for (let i = 0; i < maps.length; i++) {
    const real: string = maps[i][1];
    if (real.indexOf('(') >= 0) { continue; }          // 函数形态（brandAccent()）不是 role
    if (legal.indexOf(real) < 0) { badA.push(`${maps[i][0]} → ${real}`); }
  }
  ok(`★① 方向 A：映射的"真 role 侧"全部∈代码合法集合（${maps.length} 条）`, badA.length === 0,
    badA.join(' | '));

  // ★② 方向 B：记号侧（带点）必须**非法**（反例自检）
  let badB: string[] = [];
  for (let i = 0; i < maps.length; i++) {
    const mark: string = maps[i][0];
    if (legal.indexOf(mark) >= 0) { badB.push(mark); }
  }
  ok(`★② 方向 B：映射的"记号侧"全部∉代码合法集合（散文记号不得合法；${maps.length} 条）`, badB.length === 0,
    badB.join(' | '));
}
if (fail > 0) { console.log(`  doc_role_consistency: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  doc_role_consistency: ${pass} passed, 0 failed`);
process.exit(0);
