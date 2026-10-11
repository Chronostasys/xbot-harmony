/**
 * `core/*.ts` 导出符号「零消费」判据（B4，2026-10-11）。
 *
 * 动机（真实假绿）：migrate-ux 交的 `core/reasoningopen.ts` **零消费方**，而
 *   `run.sh` / `lint` / `typecheck` / ④ ArkTS 编译**全绿** ⇒ "修了 bug"是假的（靠读 diff 才发现）。
 * ⚠️ **分工（交叉引用，别删任何一个）**：
 *   · **模块级**（"整个模块无人 import"）由 `brand-impl` 的 `tools/tests/orphan_core_module.test.ts` 覆盖；
 *   · **符号级**（"模块被 import 但某导出没人用"）由**本文件**覆盖 —— 两者互补，不重复。
 * ⚠️ **本判据是"字符串代理"（高噪，⛔ 不以它下结论）**：`export { X } from './y'` 的 **barrel 再导出**
 *   与 **`X.y` 命名空间访问**都抓不到 ⇒ 实测"零消费"数会随判据口径在 **19↔39** 之间跳（两个数都不可信）。
 *   正解是**真 import-graph 解析**（超出本判据能力）⇒ 本判据**只作线索**，台账里每一条都要**人读**判定。
 *
 * 判据：枚举各 `core/*.ts` 的导出符号（`export function/const/class/interface`），
 *   断言每个符号在**其它文件**里有引用（剥注释；`rel` 相对 `ETS_DIR`）。
 * ⚠️ 零扫描防线 + 逐模块命中分布 + **SELFCHECK 自证断言数会随新增而变**。
 *
 * ⚠️ **插入位置铁律（`docs/CI.md`）**：本仓多数测试的汇总 log 包在 `if (fail > 0)` 内
 *   ⇒ 在其**之前**插断言 = **死区**（`chat-surface-ux` 实测 99 文件同形）⇒ 插完必须自证断言数 +1。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean; readdirSync(p: string, o: { withFileTypes: boolean }): string[] };
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
const ETS_DIR: string = ROOT.length > 0 ? path.join(ROOT, 'entry', 'src', 'main', 'ets') : '';
const CORE_DIR: string = path.join(ETS_DIR, 'core');

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function filesIn(dir: string, ext: string): string[] {
  const out: string[] = [];
  // ⚠️ `withFileTypes: true` 返回 **Dirent[]**（不是 string[]）—— 首版强转成 string[] 再判
  //    `typeof n === 'string'` ⇒ 恒 false ⇒ 扫到 **0 个文件**（零扫描防线当场判红，救了场）。
  const es = fs.readdirSync(dir, { withFileTypes: true }) as unknown as { name: string; isDirectory(): boolean }[];
  for (let i = 0; i < es.length; i++) {
    if (!es[i].isDirectory() && es[i].name.endsWith(ext)) { out.push(path.join(dir, es[i].name)); }
  }
  return out;
}

const CORE_TS: string[] = ETS_DIR.length > 0 ? filesIn(CORE_DIR, '.ts') : [];
/** 全仓 `entry/src/main/ets/**.ets|.ts`（消费者池）。 */
function collectAll(dir: string, out: string[]): void {
  const es = fs.readdirSync(dir, { withFileTypes: true }) as unknown as { name: string; isDirectory(): boolean }[];
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    const p: string = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'build' || e.name === 'oh_modules' || e.name === 'node_modules') { continue; }
      collectAll(p, out);
    } else if (e.name.endsWith('.ets') || (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts'))) {
      out.push(p);
    }
  }
}
const ALL: string[] = [];
if (ETS_DIR.length > 0) { collectAll(ETS_DIR, ALL); }

/**
 * **台账**：允许"有意零消费"的导出符号（⛔ 只许缩短；每条必须给理由）。
 * 目前为空 —— 若扫出真·零消费，先报调度者（死代码线索），**不**往这里塞。
 */
const DELIBERATE_ZERO_USE: string[] = [];

// ── SELFCHECK（自证断言数随新增而变；防"插进死区"）───────────────────────────
eq('SELFCHECK-1（证明本文件在跑）', 1, 1);
eq('SELFCHECK-2（证明计数在增）', 2, 2);

// ── 零扫描防线 ──────────────────────────────────────────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
eq('零扫描防线：扫到 ≥10 个 core/*.ts', CORE_TS.length >= 10, true);
eq('零扫描防线：消费者池 ≥100 个源文件', ALL.length >= 100, true);

/** 抽导出符号名（function/const/class/interface/enum）。 */
function exportsOf(src: string): string[] {
  const out: string[] = [];
  const re = /export (?:async )?(?:function|const|let|class|interface|enum) ([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(src);
  }
  return out;
}

console.log('  ── 自证：逐模块导出数 + 零消费数 ──');
const zero: string[] = [];
let total: number = 0;
for (let fi = 0; fi < CORE_TS.length; fi++) {
  const self: string = CORE_TS[fi];
  const src: string = stripComments(fs.readFileSync(self, 'utf-8'));
  const names: string[] = exportsOf(src);
  total += names.length;
  let z: number = 0;
  for (let ni = 0; ni < names.length; ni++) {
    const name: string = names[ni];
    let used: number = 0;
    const re = new RegExp(`\\b${name}\\b`, 'g');
    for (let ai = 0; ai < ALL.length; ai++) {
      if (ALL[ai] === self) { continue; }
      const mm: string[] | null = stripComments(fs.readFileSync(ALL[ai], 'utf-8')).match(re);
      if (mm !== null) { used += mm.length; }
    }
    if (used === 0) {
      let allowed = false;
      for (let wi = 0; wi < DELIBERATE_ZERO_USE.length; wi++) {
        if (DELIBERATE_ZERO_USE[wi] === name) { allowed = true; }
      }
      if (!allowed) { zero.push(`${path.basename(self)}:${name}`); z++; }
    }
  }
  if (z > 0) { console.log(`    ${path.basename(self).padEnd(28)} 导出 ${names.length}  零消费 ${z}`); }
}
console.log(`  · 共 ${CORE_TS.length} 个 core/*.ts / ${total} 个导出符号 / 零消费 ${zero.length}`);

if (zero.length > 0) {
  console.log('  ✗ 零消费导出（非有意 ⇒ 死代码线索，报调度者；有意 ⇒ 进台账附理由）：');
  const show: number = zero.length > 20 ? 20 : zero.length;
  for (let i = 0; i < show; i++) { console.log(`      ${zero[i]}`); }
  if (zero.length > show) { console.log(`      …（另有 ${zero.length - show} 条）`); }
}
// ⚠️ 台账语义：**只准删不准加**。**首版基线 = 19（实测）**，⚠️ **尚未逐条 triage**：
//    本判据用"符号名在其它文件的词边界出现"做消费代理 ⇒ 对**只在自身模块内使用**、
//    或**经别名/包装导出**、或**仅为测试而导出**的符号会**误报**（19 条里应含不少这类）。
//    ⇒ 下一步（下轮）：逐条 triage ⇒ 真·死代码报调度者；有意/假阳性进 DELIBERATE_ZERO_USE 附理由。
const KNOWN_ZERO_USE_COUNT: number = 19;
eq(`零消费导出数 = 台账（首版基线；⛔ 只准删不准加）实测 ${zero.length}`, zero.length, KNOWN_ZERO_USE_COUNT);

if (fail > 0) { console.log(`  ✗ core_module_consumed: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ core_module_consumed: ${pass} passed, 0 failed（${CORE_TS.length} 模块 / ${total} 导出）`);
process.exit(0);
