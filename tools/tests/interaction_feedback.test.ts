/**
 * 交互完成度门禁 —— **吞异常必须"成对出现"**（每个空 `catch` 都要有说明/提示）。
 *
 * 动机（"交互起来很爽"）：最伤的一类是"**点了没反应**" —— **静默成功**（改了但无可见变化）与
 *   **静默失败**（`.catch(()=>{})` 吞掉 + 无提示 ⇒ 用户困惑）。本仓**允许**"有意吞"（例：无振动器件、
 *   通知未授权不影响启动），但**必须写明理由** —— 否则后人读不出"这是有意还是漏了"。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────────────
 *   ① **每个空 `catch` 块必须"成对"**：块内**有非空注释**，或**紧邻上一行**有注释（`// …` / `/* … *​/`）。
 *      ⛔ 空块 + 无说明 ⇒ 红（"吞了什么、为什么吞"无从得知）。
 *   ② 逐文件分布打印 + **零扫描判红**（总文件 > 0 ∧ 空 catch 总数 > 0 —— 后者防"扫描器坏掉=白绿"）。
 *   ③ **台账只许缩短**（`SWALLOW_BUDGET`：文件 → 空 catch 数）；新增**未登记**文件 ⇒ 红。
 *
 * ⚠️ 本判据**不判**"该不该吞"（那是设计与真机的事，见 spec）；它只把**可离线证伪**的那半钉住。
 * ⛔ 纪律：**剥注释前先数**（空块判定要看"块内是否只有空白"）⇒ 但"相邻注释"要用**原文**判
 *   ⇒ 两个视图**都要**（本仓 GOTCHA：锚点用原文 / 断言输入剥注释，见 `docs/CI.md`）。
 * mutation：把任一处空 catch 的说明注释删掉 ⇒ ① 必红。
 *
 * ⚠️ 有 `export {}`（⇒ TS 模块），避免与"无 import 的全局脚本"测试在聚合编译里撞名（本仓已入库 GOTCHA）。
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
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/components'))) { return p; }
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
/** 行号（1-based，按**原文**；⛔ 不剥注释 ⇒ 行号可直接 grep）。 */
function lineAt(src: string, idx: number): number {
  let n = 1;
  for (let k = 0; k < idx && k < src.length; k++) { if (src.charAt(k) === '\n') { n++; } }
  return n;
}

/**
 * **台账**（2026-10-11 首次清点；⛔ **只许缩短**）。口径 = **空 `catch` 块**的个数
 * （`catch(e) {}` / `.catch(() => {})` / `.catch((e) => {})`，块内只有空白）。
 */
const SWALLOW_BUDGET: Map<string, number> = new Map<string, number>([
  // ✅ 本轮修正（2026-10-11）：实测值 —— 原上界 37/2/1/1 是首次清点的**粗估**，实际远低。
  // 缩到实况（⛔ 只许缩短）：修好或本就没有空 catch 的文件从表里删（新增未登记 ⇒ 红）。
  ['pages/Index.ets', 3],
]);

/**
 * **已出 spec、待他域修**的"无说明吞异常"（⛔ 台账**只许缩短**：修好一处就必须删一条 ⇒ 改回即红）。
 * ✅ **本轮已清空**（2026-10-11）：`splash-ux` 报的 7 处已逐条补"有意吞 + 为什么"（块内注释 ⇒ 不再算空块）：
 *   `components/MarkdownView.ets:368` + `pages/Index.ets:1005/1057/1070/3224/4338/4633`。
 */
const PENDING_SPEC: string[] = [];

const root: string = findRoot();
ok('探测到仓库根', root.length > 0);
const ETS: string = path.join(root, 'entry/src/main/ets');
const files: string[] = [];
walk(path.join(ETS, 'components'), files);
walk(path.join(ETS, 'pages'), files);
ok(`零扫描判红：扫到 .ets > 0（实得 ${files.length}）`, files.length > 0);

const dist: string[] = [];
const noReason: string[] = [];
const undeclared: string[] = [];
const overBudget: string[] = [];
let total = 0;

for (const f of files) {
  const rel: string = path.relative(ETS, f).split(path.sep).join('/');
  const raw: string = fs.readFileSync(f, 'utf8');       // ⛔ 原文：判"相邻注释"
  const lines: string[] = raw.split('\n');
  // 找**空块**（原文里匹配，块内只有空白）
  const re = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;
  let m: RegExpExecArray | null = re.exec(raw);
  let n = 0;
  while (m !== null) {
    n++;
    const ln: number = lineAt(raw, m.index);
    // "成对"：块内非空（本正则已保证空）⇒ 看**紧邻上一行**是不是注释
    const prev: string = ln >= 2 ? lines[ln - 2].trim() : '';
    const prev2: string = ln >= 3 ? lines[ln - 3].trim() : '';
    const paired: boolean = prev.indexOf('//') === 0 || prev.indexOf('/*') === 0 || prev.indexOf('* ') === 0
      || prev2.indexOf('//') === 0 || prev.endsWith('*/') || prev2.endsWith('*/');
    if (!paired) { noReason.push(`${rel}:${ln}`); }
    m = re.exec(raw);
  }
  // `.catch(() => {})` 形态（链式；上一行可能是调用行 ⇒ 允许该块"整行形如 .catch(() => {})" +
  //   该行**行尾**有注释）
  const re2 = /\.catch\(\s*\([^)]*\)\s*=>\s*\{\s*\}\s*\)/g;
  let m2: RegExpExecArray | null = re2.exec(raw);
  while (m2 !== null) {
    n++;
    const ln: number = lineAt(raw, m2.index);
    const cur: string = lines[ln - 1];
    const prev: string = ln >= 2 ? lines[ln - 2].trim() : '';
    const paired: boolean = cur.indexOf('//', m2.index - (m2.index - (m2.index))) >= 0
      || prev.indexOf('//') === 0 || prev.indexOf('/*') === 0 || prev.indexOf('* ') === 0;
    if (!paired) { noReason.push(`${rel}:${ln}`); }
    m2 = re2.exec(raw);
  }
  if (n === 0) { continue; }
  total += n;
  dist.push(`${rel}: ${n}（台账 ${SWALLOW_BUDGET.has(rel) ? SWALLOW_BUDGET.get(rel) : '未登记'}）`);
  if (!SWALLOW_BUDGET.has(rel)) { undeclared.push(rel); }
  else if (n > (SWALLOW_BUDGET.get(rel) as number)) { overBudget.push(`${rel}: ${n} > 台账 ${SWALLOW_BUDGET.get(rel)}`); }
}

console.log(`▶ 吞异常台账扫描：${files.length} 个 .ets，空 catch 共 ${total} 处`);
for (const d of dist) { console.log(`    · ${d}`); }
ok('零扫描判红：空 catch 总数 > 0（⛔ 防"扫描器坏掉=白绿"）', total > 0);
ok('③ 无文件超出台账（新增吞异常必须显式登记）', overBudget.length === 0, overBudget.join('\n      '));
ok('③ 无**未登记**文件', undeclared.length === 0, undeclared.join('\n      '));
if (noReason.length === 0 && PENDING_SPEC.length === 0) {
  ok('① 每个空 catch 都"成对"（块内或紧邻上有说明）', true);
} else {
  // 双向一一对应（本仓 `hit_target_gate` 同款）：修好一处必须同步删掉 PENDING_SPEC 里那条 ⇒ 否则红
  const a: string = noReason.slice().sort().join('|');
  const b: string = PENDING_SPEC.slice().sort().join('|');
  ok(`① 无说明吞异常集合 == 已登记 PENDING_SPEC 集合（实测 ${noReason.length} / 登记 ${PENDING_SPEC.length}）`,
    a === b && (noReason.length === PENDING_SPEC.length),
    a === b ? '（数量不符）' : `实测：${noReason.join(', ')}\n      登记：${PENDING_SPEC.join(', ')}`);
}

if (fail > 0) { console.log(`  interaction_feedback: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  interaction_feedback: ${pass} passed, 0 failed`);
process.exit(0);
