/**
 * 自由面层次一体化判据（目标⑤ E1，2026-10-11）—— 自由面必须走**唯一口径族**。
 *
 * 口径族（`core/design.ets`）：`surfaceFillOf(p, role)` / `hairlineOf(p)` / `structuralRuleOf(p)` /
 * `elevationColorOf(p, level)`。文件顶部注释里写着 `surfaceFillOf + hairlineOf` 的组件，
 * 正文里却可能还留着 `pal().border` 围边 / `pal().surface` 直取 —— 本判据把这种**言行不一**钉住。
 *
 * ⚠️ **扫描器自证（每次都要过）**：
 *    ① 零扫描防线（扫到文件数 ≥ 下限 / 必含下列已知自由面 / 正样本命中 > 0）；
 *    ② 打印**逐文件命中分布** ⇒ 扫描器坏了先在这里红，而不是误报违规。
 *    （教训 2026-10-11：判据 ≠ 信号；"扫源码"型判据必须先自证扫描器。）
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; readdirSync(p: string, o: { withFileTypes: boolean }): { name: string; isDirectory(): boolean }[]; existsSync(p: string): boolean };
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

/** 自由面清单（抽屉在 `pages/Index.ets`，归主 agent ⇒ 不在此判，另出 spec）。 */
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

/** 读一个自由面的剥注释源码；返回 '' 表示**没找到**（零扫描防线会抓）。 */
function srcOf(rel: string): string {
  const p: string = path.join(ETS_DIR, rel);
  if (!fs.existsSync(p)) { return ''; }
  return stripComments(fs.readFileSync(p, 'utf-8'));
}

// ── 零扫描防线 ──────────────────────────────────────────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
{
  let missing: number = 0;
  for (let i = 0; i < FREE_SURFACES.length; i++) {
    if (srcOf(FREE_SURFACES[i]).length === 0) { missing++; }
  }
  eq(`零扫描防线：${FREE_SURFACES.length} 个自由面全部读到源码（缺 ${missing}）`, missing, 0);
}
// 正样本自证：口径族函数在自由面里**必须**有命中（若全为 0 ⇒ 扫描器/口径族名写错）
{
  let hits: number = 0;
  for (let i = 0; i < FREE_SURFACES.length; i++) {
    const s: string = srcOf(FREE_SURFACES[i]);
    if (s.indexOf('surfaceFillOf(') >= 0 || s.indexOf('hairlineOf(') >= 0) { hits++; }
  }
  eq('正样本自证：至少 6 个自由面确实在用口径族', hits >= 6, true);
  console.log(`  · 正样本：${hits}/${FREE_SURFACES.length} 个自由面命中口径族`);
}

// ── 违规扫描 ────────────────────────────────────────────────────────────────
/** 违规模式：① `pal().border` 当**边框色**（边界过重/不同源，应用 `hairlineOf`）；② `pal().surface` 直取当**卡片底**（应用 `surfaceFillOf`）。
 *
 * ⚠️ 2026-10-11 修正两处（自证扫描器时钓出）：
 *  ① 正则**必须加 `\b` 锚定** —— 否则 `pal().borderStrong` 被误判成 `pal().border`（假阳性，计数不干净）；
 *  ② **不再判 `pal().surfaceAlt` / `pal().surfaceHi`**：它们在真实调用点上**没有恒等 role**
 *     （`RUNG_RAISED` 只有 `'surface.overlayRow'`/`'surface.pill'` 两个候选，语境是"进度条轨道"/"就地编辑框底"
 *     时**都不符**；硬替要么改色、要么静默落 `RUNG_CARD`）⇒ 这是"**口径族缺一个 RUNG_RAISED 中性面 role**"，
 *     不是组件违规 ⇒ 已报 `brand-impl`（`core/theme.ets`）排 spec。⛔ 不为让测试变绿而在此硬判。 */
interface Rule { readonly name: string; readonly re: RegExp; readonly fix: string; }
const RULES: Rule[] = [
  { name: 'pal().border 当边框色', re: /\.border\(\{[^}]*pal\(\)\.border\b/g, fix: 'hairlineOf(p)（结构性发丝）' },
  { name: 'pal().surface 直取当底色', re: /\.backgroundColor\(this\.pal\(\)\.surface\)/g, fix: "surfaceFillOf(p, 'surface.card'|'surface.overlay')" },
  // ToolPopover 收敛（2026-10-11 主 agent 裁决）：不再走 surfacesOf 取底色，一律 surfaceFillOf
  { name: 'surfacesOf/surf().sunken 直取当底色', re: /this\.surf\(\)\.sunken/g, fix: "surfaceFillOf(p, 'surface.well')" },
];

/** 白名单（每条必须写明**为什么可留**）。键 = `文件|规则名`。 */
const ALLOWED: string[] = [
  // `pal().surfaceAlt`/`pal().surfaceHi`：**口径族缺 RUNG_RAISED 中性 role**（已报 brand-impl）⇒ 暂不判。
];

const violations: string[] = [];
console.log('  ── 逐自由面命中分布（自证扫描器）──');
for (let i = 0; i < FREE_SURFACES.length; i++) {
  const rel: string = FREE_SURFACES[i];
  const s: string = srcOf(rel);
  const dist: string[] = [];
  for (let ri = 0; ri < RULES.length; ri++) {
    const hits = s.match(RULES[ri].re);
    if (hits !== null) {
      const key: string = `${rel}|${RULES[ri].name}`;
      let allowed = false;
      for (let ai = 0; ai < ALLOWED.length; ai++) { if (ALLOWED[ai] === key) { allowed = true; } }
      if (!allowed) { violations.push(`${rel} · ${RULES[ri].name} × ${hits.length} ⇒ 应改 ${RULES[ri].fix}`); }
      dist.push(`${RULES[ri].name}×${hits.length}`);
    }
  }
  const unified: string = (s.indexOf('surfaceFillOf(') >= 0 && s.indexOf('hairlineOf(') >= 0) ? '口径族✓' : '口径族缺';
  console.log(`    ${path.basename(rel).padEnd(22)} ${unified}   ${dist.length > 0 ? dist.join(', ') : '（无违规）'}`);
}

if (violations.length > 0) {
  console.log('  ✗ 自由面未走唯一口径族：');
  for (let i = 0; i < violations.length; i++) { console.log(`      ${violations[i]}`); }
}
/**
 * **已知违规台账**（只准删不准加）：本波先记账（budget 只够落 1 处修），后续逐条修掉、
 * 并把对应计数同步下调 ⇒ 计数一变就红（修好 ⇒ 逼你删台账；新增 ⇒ 逼你上报）。
 * ⛔ 不许为"让测试变绿"往这里灌；每条都必须是**真违规**（走不到唯一口径族）。
 * 明细见测试运行时打印的 `✗ 自由面未走唯一口径族` 列表。
 */
const KNOWN_VIOLATIONS_COUNT: number = 0;
eq('违规数 = 台账（只准删不准加；修好/新增 ⇒ 计数变 ⇒ 红）', violations.length, KNOWN_VIOLATIONS_COUNT);

if (fail > 0) { console.log(`  ✗ free_surface_layers: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ free_surface_layers: ${pass} passed, 0 failed（${FREE_SURFACES.length} 个自由面）`);
process.exit(0);
