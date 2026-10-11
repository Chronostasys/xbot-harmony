/**
 * 自由面「层级 → 通道」一体化判据（目标⑤ E1 续，2026-10-11）。
 *
 * 真源（⛔ 本测试不复制口径，只**从组件的真实调用形态回归**，见 `docs/DESIGN-SYSTEM.md §13.4/§13.5`）：
 *   · **L1 顶层弹层/浮层/抽屉根** → 边界 = `hairlineOf(p)`（结构性发丝；"浮起"由柔影承担）
 *   · **L2 内嵌卡（面到面轮廓）** → 边界 = `structuralRuleOf(p)`
 *       （浅色族 = `borderStrong`（比面内强一档）；深色族 = `border`，与 `hairlineOf(深)` **逐字节相同**）
 *   · **L3 内嵌凹槽（well / chip）** → 边界 = `insetHairlineOf(p)`（深色才有值、浅色 transparent）
 *
 * 为什么要有它：`structuralRuleOf` 此前**只在部分面被消费**（`SettingsRows`/`PluginHost`/`PluginWidgets`/
 * `PluginsSheet`），其余同层级的卡仍手写 `hairlineOf`（甚至裸面/裸 `pal().borderStrong`）⇒ 同一层级的面
 * 在不同弹层里表现不一致（有的发丝、有的柔影、有的裸面）。本判据把"同层级 = 同通道"钉住。
 *
 * ⚠️ **扫描器自证（每次都要过）**：① 零扫描防线（文件数 / marker 命中数 / 逐处 `file:line` 计数）；
 *    ② mutation 自证（把某处 L2 卡通道改回 `hairlineOf` ⇒ 扫描器必须报出 `hairlineOf`）。
 *    （教训 2026-10-11：判据 ≠ 信号；"扫源码"型判据必须先自证扫描器。）
 *
 * ⚠️ **台账口径**：`KNOWN_*` 只**只准缩短**——修好一处 ⇒ 违规数下降 ⇒ 计数不等 ⇒ 红，逼你删台账；
 *    新增一处 ⇒ 违规数上升 ⇒ 红，逼你上报。⛔ 不许为"让测试变绿"往台账里灌。
 */
export {};

declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  existsSync(p: string): boolean;
  readdirSync(p: string, o: { withFileTypes: boolean }): { name: string; isDirectory(): boolean }[];
};
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

/** 剥注释（块 + 行）。⚠️ **保留换行**（块注释按行数换成空格）⇒ 行号与真源对齐（`file:line` 计数才准）。
 *  ⛔ 行注释前导空白必须用 `[^\S\n]*`（**不含换行**）：用 `\s*` 会贪婪吃掉换行 ⇒ 连续注释行被并成一行 ⇒ 行号漂移。 */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/^[^\S\n]*\/\/.*$/gm, '');
}
function linesOf(rel: string): string[] {
  const p: string = path.join(ETS_DIR, rel);
  if (!fs.existsSync(p)) { return []; }
  return stripComments(fs.readFileSync(p, 'utf-8')).split('\n');
}

// ── 层级 → 唯一通道（真源 = `core/design.ets` 的出口函数；⛔ 不在此复制它们的实现）────────────
const LEVEL_FN: Record<string, string> = {
  L1: 'hairlineOf',        // 顶层弹层/浮层/抽屉根
  L2: 'structuralRuleOf',  // 内嵌卡（面到面轮廓）
  L3: 'insetHairlineOf',   // 内嵌凹槽（well / chip）
};

/**
 * 站点台账：每个"自由面容器"由**面线 marker**（唯一子串，取 `surfaceFillOf(...)` 的调用片段）
 * 定位；`expect` = 其后 6 行内应出现的**边界通道调用次数**。
 * ⛔ marker 只用**调用片段**（不取整行），且必须能唯一落位到"该容器的面线"。
 */
interface Site { readonly file: string; readonly level: string; readonly marker: string; readonly expect: number; }
const SITES: Site[] = [
  // ── L1 顶层弹层根（边界 = hairlineOf）────────────────────────────────────────
  { file: 'components/MenuSheets.ets', level: 'L1', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))", expect: 3 },
  { file: 'components/StatusSheet.ets', level: 'L1', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))", expect: 1 },
  { file: 'components/AskUserSheet.ets', level: 'L1', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))", expect: 1 },
  { file: 'components/Toast.ets', level: 'L1', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))", expect: 1 },
  { file: 'components/Lightbox.ets', level: 'L1', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))", expect: 1 },
  { file: 'components/PluginsSheet.ets', level: 'L1', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))", expect: 1 },
  { file: 'components/QueueSheet.ets', level: 'L1', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))", expect: 1 },
  { file: 'components/SelfCheckSheet.ets', level: 'L1', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))", expect: 1 },
  // ── L2 内嵌卡（面到面轮廓 = structuralRuleOf）────────────────────────────────
  { file: 'components/SettingsRows.ets', level: 'L2', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))", expect: 1 },
  { file: 'components/PluginHost.ets', level: 'L2', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))", expect: 2 },
  { file: 'components/PluginWidgets.ets', level: 'L2', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))", expect: 1 },
  { file: 'components/PluginsSheet.ets', level: 'L2', marker: 'backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))', expect: 3 },
  { file: 'components/SettingsPanel.ets', level: 'L2', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))", expect: 1 },
  { file: 'components/SelfCheckSheet.ets', level: 'L2', marker: 'backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))', expect: 8 },
  { file: 'components/TodoPanel.ets', level: 'L2', marker: 'backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))', expect: 1 },
  { file: 'components/QueueSheet.ets', level: 'L2', marker: 'backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))', expect: 1 },
  { file: 'components/SyntheticCard.ets', level: 'L2', marker: 'backgroundColor(surfaceFillOf(this.pal(), SURFACE_PILL))', expect: 1 },
  // ── L3 内嵌凹槽（well / chip = insetHairlineOf）──────────────────────────────
  { file: 'components/ToolPopover.ets', level: 'L3', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.well'))", expect: 4 },
  { file: 'components/PluginHost.ets', level: 'L3', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.chip'))", expect: 1 },
];

/** 边界窗口（面线之后多少行内找第一个 `.border(`/`.borderColor(`）。 */
const WINDOW: number = 6;
/** 通道函数抽取（`color: <fn>(this.pal())` / `.borderColor(<fn>(this.pal()))`）。 */
const FN_RE: RegExp = /(?:color:\s*|borderColor\()([A-Za-z]+)\(this\.pal\(\)\)/;

/** 从 `faceIdx`（面线）起，取其后 WINDOW 行内**第一个**边界块的通道函数名；'' = 窗口内没有边界。 */
function channelAfter(lines: string[], faceIdx: number): string {
  const end: number = Math.min(lines.length - 1, faceIdx + WINDOW);
  for (let i = faceIdx + 1; i <= end; i++) {
    const ln: string = lines[i];
    if (ln.indexOf('.border(') >= 0 || ln.indexOf('.borderColor(') >= 0) {
      const stop: number = Math.min(lines.length - 1, i + 4);
      for (let j = i; j <= stop; j++) {
        const m = lines[j].match(FN_RE);
        if (m !== null && m.length > 1) { return m[1]; }
      }
      return '';
    }
  }
  return '';
}

// ── 零扫描防线 + ① 逐处 file:line 计数 ─────────────────────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);

const fnsByLevel: Record<string, string[]> = { L1: [], L2: [], L3: [] };
let missingFiles: number = 0;
let emptySites: number = 0;
let reported: number = 0;
const seenFiles: Record<string, boolean> = {};
const siteReport: string[] = [];

console.log('  ── 逐自由面容器命中分布（自证扫描器）──');
for (let i = 0; i < SITES.length; i++) {
  const st: Site = SITES[i];
  const lines: string[] = linesOf(st.file);
  if (lines.length === 0) { missingFiles++; continue; }
  seenFiles[st.file] = true;
  const fns: string[] = [];
  const where: string[] = [];
  for (let li = 0; li < lines.length; li++) {
    if (lines[li].indexOf(st.marker) >= 0) {
      const fn: string = channelAfter(lines, li);
      if (fn.length > 0) { fns.push(fn); where.push(`${st.file}:${li + 1}`); }
    }
  }
  if (fns.length === 0) { emptySites++; }
  eq(`① ${st.file} 的 ${st.level} 面（...${st.marker.slice(-22)}）应有 ${st.expect} 处通道`, fns.length, st.expect);
  for (let k = 0; k < fns.length; k++) {
    eq(`   ① ${where[k]} 的通道 = ${LEVEL_FN[st.level]}`, fns[k], LEVEL_FN[st.level]);
    fnsByLevel[st.level].push(fns[k]);
    siteReport.push(`${st.file}:${where[k].split(':').pop()}  ${st.level} → ${fns[k]}`);
    reported++;
  }
}

eq(`零扫描防线：全部 ${SITES.length} 组站点读到源码（缺 ${missingFiles}）`, missingFiles, 0);
eq('零扫描防线：无"marker 命中 0 处"的站点', emptySites, 0);
eq('零扫描防线：站点组数 ≥ 18', SITES.length >= 18, true);
eq('零扫描防线：消费点（逐处）≥ 28 处', reported >= 28, true);
console.log('  ── ① 逐处消费点（file:line → 层级 → 通道函数）──');
for (let i = 0; i < siteReport.length; i++) { console.log(`    ${siteReport[i]}`); }
console.log(`  · 逐处消费点：${reported} 处（${Object.keys(seenFiles).length} 个文件）`);

// ── ② 同一层级 → 同一函数名（跨文件断言）────────────────────────────────────
for (const lv of ['L1', 'L2', 'L3']) {
  const set: string[] = [];
  const arr: string[] = fnsByLevel[lv];
  for (let i = 0; i < arr.length; i++) { if (set.indexOf(arr[i]) < 0) { set.push(arr[i]); } }
  eq(`② 同层级 → 同函数名：[${lv}] 的通道集合 = {${LEVEL_FN[lv]}}`, set.join(','), LEVEL_FN[lv]);
  eq(`   且 [${lv}] 有 ≥1 处消费点`, arr.length > 0, true);
}

// ── ③ L2 卡轮廓全景扫描（components/** + pages/Index.ets）⇒ 违规 = 台账（只许缩短）──────
/** 卡面 marker（同层级的两条等价写法）。 */
const CARD_MARKERS: string[] = [
  'backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))',
  "backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))",
];
/** 已登记的卡轮廓缺口（键 = `文件|marker`；每条必须写明为什么可留 ⇒ 只许缩短）。 */
interface Gap { readonly file: string; readonly marker: string; readonly why: string; }
const KNOWN_CARD_GAPS: Gap[] = [
  {
    file: 'pages/Index.ets', marker: "backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))",
    why: '品牌登录瓦片（108×108 squircle + `hero` 柔影）：§13.6「品牌标记不随主题」+ 该处 `hairlineOf` 是浅色面**唯一**'
      + '立层手段（旧注释明写）⇒ 换 `structuralRuleOf` 会改浅色品牌面观感 ⇒ 待拍板（非本波）。',
  },
];

const sweepFiles: string[] = [];
{
  const compDir: string = path.join(ETS_DIR, 'components');
  const ents = fs.readdirSync(compDir, { withFileTypes: true });
  for (let i = 0; i < ents.length; i++) {
    if (!ents[i].isDirectory() && ents[i].name.length > 4 && ents[i].name.slice(-4) === '.ets') {
      sweepFiles.push('components/' + ents[i].name);
    }
  }
  sweepFiles.push('pages/Index.ets');
}

const cardViolations: string[] = [];
for (let fi = 0; fi < sweepFiles.length; fi++) {
  const rel: string = sweepFiles[fi];
  const lines: string[] = linesOf(rel);
  for (let li = 0; li < lines.length; li++) {
    let isCardFace = false;
    for (let mi = 0; mi < CARD_MARKERS.length; mi++) { if (lines[li].indexOf(CARD_MARKERS[mi]) >= 0) { isCardFace = true; } }
    if (!isCardFace) { continue; }
    const fn: string = channelAfter(lines, li);
    // 无边界（嵌套/有意不描边）不算违规；**有边界但通道错**才算。
    if (fn.length > 0 && fn !== LEVEL_FN.L2) {
      let allowed = false;
      for (let gi = 0; gi < KNOWN_CARD_GAPS.length; gi++) {
        if (KNOWN_CARD_GAPS[gi].file === rel && lines[li].indexOf(KNOWN_CARD_GAPS[gi].marker) >= 0) { allowed = true; }
      }
      if (!allowed) { cardViolations.push(`${rel}:${li + 1}  卡轮廓 = ${fn}（应 ${LEVEL_FN.L2}）`); }
    }
  }
}
if (cardViolations.length > 0) {
  console.log('  ✗ L2 卡轮廓未走 structuralRuleOf：');
  for (let i = 0; i < cardViolations.length; i++) { console.log(`      ${cardViolations[i]}`); }
}
eq('③ L2 卡轮廓通道统一（违规数 = 台账 0）', cardViolations.length, 0);
eq(`零扫描防线：L2 扫描覆盖文件 ≥ 30（实测 ${sweepFiles.length}）`, sweepFiles.length >= 30, true);

// ── ⑤ 登记待批台账（未统一的站点，**只许缩短**）──────────────────────────────
interface Pending { readonly file: string; readonly marker: string; readonly why: string; }
const KNOWN_PENDING: Pending[] = [
  {
    file: 'components/SubAgentTree.ets', marker: 'withAlpha(this.pal().border, CARD_BORDER_ALPHA)',
    why: 'L2 卡轮廓走**辅助函数** `cardBorderColor()`（浅 `hairlineOf` / 深 `withAlpha(border, 50%)`）——'
      + 'web `border-border/50` 的**有意弱化**；收编到 `structuralRuleOf` 会改深色观感 ⇒ 待拍板。',
  },
  {
    file: 'components/GoalBanner.ets', marker: 'goalBorderOf(this.pal()',
    why: '横幅边界是**语义色**（完成 = success / 进行中 = accent），**不是**结构通道 ⇒ 有意例外（非"未统一"）。',
  },
  {
    file: 'components/AuthImage.ets', marker: 'backgroundColor(surfaceFillOf(this.pal(), SURFACE_CHIP))',
    why: '图片卡坐在 `surface.chip`（RUNG_SUNKEN）面上：卡面 rung 与普通 `surface.card` 卡不同 ⇒ 通道待定（待拍板）。',
  },
  {
    file: 'components/MarkdownView.ets', marker: 'backgroundColor(wellOf(this.pal()))',
    why: '代码块坐在 `wellOf`（凹槽面）上 ⇒ 属 L3 语义，但当前用 `hairlineOf`；well 的边界通道待统一口径（待拍板）。',
  },
  // ✅ 2026-10-11（目标⑤ E1 待批 #1 落定）：`PluginsSheet` / `QueueSheet` / `SelfCheckSheet` 三面板的
  //    **L1 根面**已迁到 `surfaceFillOf(p,'surface.overlay')` + 两层柔影（`shadowLayersOf(p,'overlay')`）
  //    ⇒ 与同层级 `StatusSheet`/`AskUserSheet`/`MenuSheets` 同通道 ⇒ 台账**收缩**，三条已删。
  //    （改回裸 `pal().appBg` ⇒ 本文件 §6「根面无裸 appBg」必红，见下方。）
];

let pendingMissing: number = 0;
for (let i = 0; i < KNOWN_PENDING.length; i++) {
  const pg: Pending = KNOWN_PENDING[i];
  const lines: string[] = linesOf(pg.file);
  if (lines.length === 0) { pendingMissing++; continue; }
  let found = false;
  for (let li = 0; li < lines.length; li++) { if (lines[li].indexOf(pg.marker) >= 0) { found = true; } }
  // 缺口**仍存在**才允许留在台账（修好 ⇒ 必须删条目 ⇒ 红）。
  eq(`⑤ 待批缺口仍在：${pg.file}（${pg.marker.slice(0, 28)}…）`, found, true);
}
eq('零扫描防线：待批台账文件全部可读', pendingMissing, 0);
eq(`⑤ 待批台账条数 = ${KNOWN_PENDING.length}（只许缩短）`, KNOWN_PENDING.length, 4);

// ── ④ mutation 自证（扫描器必须有判别力）──────────────────────────────────────
{
  // mutation A（L2）：把 `SettingsRows` 卡的通道改回 `hairlineOf` ⇒ 扫描器必须报出 `hairlineOf`。
  const cardMarker: string = "backgroundColor(surfaceFillOf(this.pal(), 'surface.card'))";
  const src: string = linesOf('components/SettingsRows.ets').join('\n');
  let idx = -1;
  const base: string[] = linesOf('components/SettingsRows.ets');
  for (let i = 0; i < base.length; i++) { if (base[i].indexOf(cardMarker) >= 0) { idx = i; } }
  const baseFn: string = idx >= 0 ? channelAfter(base, idx) : '';
  eq('④ mutation 基线：SettingsRows 卡通道 = structuralRuleOf', baseFn, 'structuralRuleOf');
  const mutated: string = src.replace('structuralRuleOf(this.pal())', 'hairlineOf(this.pal())');
  const mutFn: string = idx >= 0 ? channelAfter(mutated.split('\n'), idx) : '';
  eq('④ mutation A：注入 hairlineOf ⇒ 扫描器报出 hairlineOf（判别力自证）', mutFn, 'hairlineOf');
  eq('④ mutation A：注入后 ≠ 基线（判别器真的分辨得出来）', mutFn !== baseFn, true);
}
{
  // mutation B（L1）：把 `Toast` 根的通道改回 `structuralRuleOf` ⇒ 扫描器必须报出 `structuralRuleOf`。
  const rootMarker: string = "backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))";
  const base: string[] = linesOf('components/Toast.ets');
  // ⛔ 取**带通道**的那个根面 marker（G1 后 Toast 的"背板 Stack"也有同面 marker，
  //    旧的"取最后一个"会把背板误当根 ⇒ 基线恒 ''。带通道的那个才是真正的根面容器）。
  let idx = -1;
  for (let i = 0; i < base.length; i++) {
    if (base[i].indexOf(rootMarker) >= 0 && channelAfter(base, i).length > 0) { idx = i; break; }
  }
  const baseFn: string = idx >= 0 ? channelAfter(base, idx) : '';
  eq('④ mutation 基线：Toast 根通道 = hairlineOf', baseFn, 'hairlineOf');
  const mutated: string = base.join('\n').replace('color: hairlineOf(this.pal())', 'color: structuralRuleOf(this.pal())');
  const mutFn: string = idx >= 0 ? channelAfter(mutated.split('\n'), idx) : '';
  eq('④ mutation B：注入 structuralRuleOf ⇒ 扫描器报出 structuralRuleOf', mutFn, 'structuralRuleOf');
}

// ── ⑥ L1 顶层弹层「根面 = surfaceFillOf(p,'surface.overlay')」逐处消费点（⛔ 不得裸 pal().appBg）──
//  背景（目标⑤ E1 待批 #1，2026-10-11）：`PluginsSheet` / `QueueSheet` / `SelfCheckSheet` 三面板的
//  L1 根面曾是**裸** `backgroundColor(this.pal().appBg)`（RUNG_CANVAS）+ **无柔影**，与同层级
//  `StatusSheet`/`AskUserSheet`/`MenuSheets`（现走 `surfaceFillOf(p,'surface.overlay')` + 两层柔影）不一致。
//  修后 = 同层级同通道（面 = `surface.overlay`；影 = `shadowLayersOf(p,'overlay')` 的两元素两层落法）。
//  本块把"**消费点计数 + 真值**"钉住：① overlay 面 marker 在（非死码）；② 裸 `pal().appBg` 归零。
function occurrencesOf(s: string, sub: string): number {
  let n = 0, i = 0;
  while ((i = s.indexOf(sub, i)) >= 0) { n++; i += sub.length; }
  return n;
}
const L1_ROOT_FILES: string[] = [
  'components/PluginsSheet.ets', 'components/QueueSheet.ets', 'components/SelfCheckSheet.ets',
];
const OVERLAY_MARKER: string = "backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))";
const BARE_APPBG_MARKER: string = 'backgroundColor(this.pal().appBg)';
let l1Overlay: number = 0;
let l1Bare: number = 0;
const l1Report: string[] = [];
for (let i = 0; i < L1_ROOT_FILES.length; i++) {
  const src: string = linesOf(L1_ROOT_FILES[i]).join('\n');
  const ov: number = occurrencesOf(src, OVERLAY_MARKER);
  const ba: number = occurrencesOf(src, BARE_APPBG_MARKER);
  l1Overlay += ov;
  l1Bare += ba;
  l1Report.push(`${L1_ROOT_FILES[i]}  overlay=${ov}  裸appBg=${ba}`);
  eq(`⑥ ${L1_ROOT_FILES[i]} 根面走 surfaceFillOf('surface.overlay')（≥1 处，逐处计数）`, ov >= 1, true);
  eq(`⑥ ${L1_ROOT_FILES[i]} 根面**无**裸 pal().appBg（同层级统一）`, ba, 0);
}
console.log('  ── ⑥ 三面板 L1 根面（逐处消费点 + 真值）──');
for (let i = 0; i < l1Report.length; i++) { console.log(`    ${l1Report[i]}`); }
eq('零扫描判红：三面板 L1 overlay 面消费点合计 > 0', l1Overlay > 0, true);
eq('⑥ 三面板 L1 裸 appBg 合计 = 0（全部收敛到 overlay 面）', l1Bare, 0);
{
  // mutation：把某面板的 overlay 根面改回裸 `pal().appBg` ⇒ "无裸 appBg" 判据必须**必红**。
  const baseSrc: string = linesOf(L1_ROOT_FILES[0]).join('\n');
  eq('⑥ mutation 前提：基线该文件确有 overlay 面 marker', occurrencesOf(baseSrc, OVERLAY_MARKER) > 0, true);
  const mutated: string = baseSrc.replace(OVERLAY_MARKER, BARE_APPBG_MARKER);
  eq('⑥ mutation：根面改回裸 pal().appBg ⇒ 裸 appBg 计数 > 0（判别力自证，必红）',
    occurrencesOf(mutated, BARE_APPBG_MARKER) > 0, true);
}

if (fail > 0) {
  console.log(`  ✗ free_surface_unify: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ free_surface_unify: ${pass} passed, 0 failed（${SITES.length} 组站点 · ${reported} 处消费点 · `
  + `台账 卡轮廓 ${KNOWN_CARD_GAPS.length} / 待批 ${KNOWN_PENDING.length}）`);
process.exit(0);
