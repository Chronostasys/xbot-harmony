/**
 * 自由面「圆角 / 内距」字面量判据（2026-10-11，目标⑤ E1 收尾）。
 *
 * 目的：自由面（抽屉/sheet/设置面板/popover/卡片）的**圆角**与**内距**必须走 token 档，
 * ⛔ 不写字面量 —— 否则深浅主题/密集度调整时这些面会各自漂移。
 *
 * ⚠️ **扫描器自证（必做）**：零扫描防线 + 正样本命中 + 逐文件命中分布打印。
 *    （教训 2026-10-11：判据 ≠ 信号；"扫源码"型判据先自证扫描器。）
 *
 * 口径（⛔ 别口算）：**台账数是 (文件×行) 条目数**。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
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

/** 剥注释（块 + 行）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 自由面清单（与 `free_surface_layers.test.ts` 同集；抽屉在 `pages/Index.ets` 归主 agent）。 */
const FREE_SURFACES: string[] = [
  'components/ToolPopover.ets',
  'components/SettingsPanel.ets',
  'components/PluginsSheet.ets',
  'components/QueueSheet.ets',
  'components/StatusSheet.ets',
  'components/SelfCheckSheet.ets',
  'components/MenuSheets.ets',
  'components/AskUserSheet.ets',
  'components/TodoPanel.ets',
  'components/SyntheticCard.ets',
];

/** 每行的剥注释源码（行号 → 文本）。 */
function linesOf(rel: string): string[] {
  const p: string = path.join(ETS_DIR, rel);
  if (!fs.existsSync(p)) { return []; }
  return stripComments(fs.readFileSync(p, 'utf-8')).split('\n');
}

// ── 零扫描防线 ──────────────────────────────────────────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
{
  let missing: number = 0;
  for (let i = 0; i < FREE_SURFACES.length; i++) {
    if (linesOf(FREE_SURFACES[i]).length === 0) { missing++; }
  }
  eq(`零扫描防线：${FREE_SURFACES.length} 个自由面全部读到源码（缺 ${missing}）`, missing, 0);
  // 正样本：圆角档必须**有命中**（R_* / RADIUS_*），否则说明扫描/口径名写错
  let radiusHits: number = 0;
  for (let i = 0; i < FREE_SURFACES.length; i++) {
    const s: string = linesOf(FREE_SURFACES[i]).join('\n');
    if (/borderRadius\((R_|RADIUS_)/.test(s)) { radiusHits++; }
  }
  eq('正样本自证：≥4 个自由面确实在用圆角档常量', radiusHits >= 4, true);
  console.log(`  · 正样本：${radiusHits}/${FREE_SURFACES.length} 个自由面命中圆角档`);
}

/**
 * **内距字面量台账**（只准删不准加）。
 * 理由：`6`/`10` 是 **2px 级半档**，为**命中区 / 角标几何**服务；`SP` 缩放档（4/8/12/16/20…）不覆盖，
 *   已有 `INSET_GOAL_X=10`/`INSET_GOAL_Y=6` 但**语义是 goal 专用** ⇒ 借用到"标签角标/行内命中区"
 *   是**语义错配**（本仓铁律：语义面 role），新建档又要动 `core/design.ets`（brand-impl 禁改）
 *   ⇒ 主 agent 2026-10-11 裁决：**记档不改**（半档受控例外）。
 */
/** **按文件的内距字面量行数台账**（只准删不准加；口径 = 出现**行数**，⛔ 别口算）。
 * 理由：`6`/`10` 是 **2px 级半档**，为**命中区 / 角标几何**服务；`SP` 缩放档（4/8/12/16/20…）不覆盖；
 *   已有 `INSET_GOAL_X=10`/`INSET_GOAL_Y=6` 但**语义是 goal 专用** ⇒ 借用到"标签角标/行内命中区"是
 *   **语义错配**（本仓铁律：语义面 role），新建档又要动 `core/design.ets`（brand-impl 禁改）
 *   ⇒ 主 agent 2026-10-11 裁决：**记档不改**（半档受控例外）。 */
interface InsetLedger { readonly file: string; readonly lines: number; }
const KNOWN_INSET_LEDGER: InsetLedger[] = [
  { file: 'ToolPopover.ets', lines: 2 },
  // ⚠️ 2026-10-11 收紧（只准删不准加）：`QueueSheet` 的行内 4 个小按钮改用**真实 44 布局盒**
  //    （去 `responseRegion` 时同时删掉了 `.padding(6)`）⇒ 内距字面量 5 → 1（仅剩「清空」那行的半档）。
  { file: 'QueueSheet.ets', lines: 1 },
  { file: 'TodoPanel.ets', lines: 1 },
  { file: 'SelfCheckSheet.ets', lines: 3 },
];

const radiusViolations: string[] = [];
const insetCount: Record<string, number> = {};
let insetLines: number = 0;
console.log('  ── 逐自由面命中分布（自证扫描器）──');
for (let i = 0; i < FREE_SURFACES.length; i++) {
  const rel: string = FREE_SURFACES[i];
  const ls: string[] = linesOf(rel);
  const rv: string[] = [];
  let ins: number = 0;
  for (let li = 0; li < ls.length; li++) {
    const line: string = ls[li];
    // ① 圆角字面量：`borderRadius(<纯数字>)` ⇒ 必须走档
    if (/borderRadius\([0-9]+\)/.test(line)) { rv.push(`${rel}:${li + 1}  ${line.trim()}`); }
    // ② 内距字面量：`padding(<纯数字>)` 或 `padding({ ... : <纯数字> ... })`
    if (/padding\([0-9]+\)/.test(line) || /padding\(\{[^}]*[: ]\s*[0-9]/.test(line)) {
      ins++;
      insetLines++;
      const bn: string = path.basename(rel);
      insetCount[bn] = (insetCount[bn] !== undefined ? insetCount[bn] : 0) + 1;
    }
  }
  for (let j = 0; j < rv.length; j++) { radiusViolations.push(rv[j]); }
  console.log(`    ${path.basename(rel).padEnd(22)} 圆角字面量 ${rv.length}   内距字面量 ${ins}`);
}

// ── ① 圆角：零字面量（硬红；已达成）──────────────────────────────────────────
if (radiusViolations.length > 0) {
  console.log('  ✗ 自由面出现圆角字面量（应走 R_* 档）：');
  for (let i = 0; i < radiusViolations.length; i++) { console.log(`      ${radiusViolations[i]}`); }
}
eq('自由面圆角必须走档常量（零 borderRadius(<数字>) 字面量）', radiusViolations.length, 0);

// ── ② 内距：按文件**行数**必须与台账逐字一致（只准删不准加）────────────────────
{
  const bad: string[] = [];
  for (let i = 0; i < KNOWN_INSET_LEDGER.length; i++) {
    const e: InsetLedger = KNOWN_INSET_LEDGER[i];
    const got: number = insetCount[e.file] !== undefined ? insetCount[e.file] : 0;
    if (got !== e.lines) { bad.push(`${e.file}: 实测 ${got} != 台账 ${e.lines}`); }
  }
  const keys: string[] = Object.keys(insetCount);
  for (let i = 0; i < keys.length; i++) {
    let known = false;
    for (let j = 0; j < KNOWN_INSET_LEDGER.length; j++) {
      if (KNOWN_INSET_LEDGER[j].file === keys[i]) { known = true; }
    }
    if (!known) { bad.push(`${keys[i]}: 不在台账（新增字面量 ⇒ 立刻红）`); }
  }
  if (bad.length > 0) {
    console.log('  ✗ 内距字面量与台账不一致（只准删不准加）：');
    for (let i = 0; i < bad.length; i++) { console.log(`      ${bad[i]}`); }
  }
  eq('每个文件的内距字面量行数 = 台账（只准删不准加）', bad.length, 0);
  eq(`内距字面量总行数 = 台账合计 7：实测 ${insetLines}`, insetLines, 7);
}

if (fail > 0) { console.log(`  ✗ free_surface_tokens: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ free_surface_tokens: ${pass} passed, 0 failed（10 个自由面；圆角字面量 0；内距台账 7 行）`);
process.exit(0);
