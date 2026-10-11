/**
 * role_surface_floor.test.ts —— **role × 宿主面的对比度地板**（"白主题看不清"同族残留 · 2026-10-11）。
 *
 * ── 为什么要有这张表 ──────────────────────────────────────────────────────────
 * `textMuted` 在 **porcelain 下压任何面都只有 2.17–2.54**（见 §A 实测）。
 * 它的**批准档位是 `AA_MUTED` = 2.0**（`core/design.ets`）—— **那是给「非交互的元信息文本」的**。
 * ⇒ 一旦它被用在**门槛更高的语义位**上，就是真问题：
 *   · **可点元素**（按钮/行/图标按钮）⇒ 非文本门槛 **3:1**（WCAG §1.4.11）
 *   · **SymbolGlyph 图标** ⇒ 同上 **3:1**（图标专用出口是 `iconMuted`，porcelain 3.32 ✓）
 *
 * ── 判据（硬红）──────────────────────────────────────────────────────────────
 * **`textMuted` 不得作为「可点元素」或「`SymbolGlyph`」的直接取色**（porcelain 下必 < 3:1）。
 *   ⚠️ **只判直接取色**（链上出现 `.textMuted` / `colorOf(…,'textMuted')`）；
 *      经由**函数**间接取色（如 `roleColorOf(this.vis().labelRole, pal)`）**不算** ——
 *      那需要运行期才能定值，静态判会产假阳性（实测 `TodoPanel:155` 就属此类）。
 *   例外台账 `KNOWN_OK`（⛔ 只许缩短；每条给理由）。
 *
 * ── ⭐ **校准口径（铁律，血泪）**──────────────────────────────────────────────
 * 台账必须**在「已提交树」上校准**（`git worktree add --detach /tmp/x-ck HEAD` 里跑），
 * **主树只用于开发** —— 主树可能含**别人未提交的修复** ⇒ 按主树校准的台账一到干净树就"未登记"（我踩过：
 * 4 处违规被主树的在途修复掩盖）。**他域待修项登记为 `PENDING_SPEC`；谁修完谁收缩台账。**
 *
 * ── 与另两条判据的分工（⛔ 不重复判）────────────────────────────────────────────
 *  · `icon_role_visibility.test.ts`：**A 类**（role 名不在真源表 ⇒ 静默 transparent）+ 图标 role 报告；
 *  · `horizontal_overflow_gate.test.ts`：文字**横向溢出**；
 *  · 本文件：**role 用错语义位**（弱档 role 落在高门槛处）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(m: 'path'): { join(...parts: string[]): string; relative(a: string, b: string): string };
declare const __dirname: string;

import { paletteOf, contrastRatio, surfacesOf, ALL_THEMES } from '../../entry/src/main/ets/core/theme';
import { surfaceFillOf, AA_MUTED, AA_NON_TEXT, colorOf } from '../../entry/src/main/ets/core/design';
import { splashBrandCanvas } from '../../entry/src/main/ets/core/splash';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function pad(s: string, n: number): string { return (s + ' '.repeat(n)).slice(0, n); }
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const etsRoot: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets');

function stripComments(src: string): string {
  let out: string = ''; let i: number = 0; const n: number = src.length;
  while (i < n) {
    const c: string = src.charAt(i);
    if (c === '/' && i + 1 < n) {
      if (src.charAt(i + 1) === '/') { const j: string | number = src.indexOf('\n', i); i = (j as number) < 0 ? n : (j as number); continue; }
      if (src.charAt(i + 1) === '*') {
        const j: number = src.indexOf('*/', i + 2);
        if (j < 0) { break; }
        let nl: number = 0;
        for (let k = i; k < j; k++) { if (src.charAt(k) === '\n') { nl++; } }
        out += '\n'.repeat(nl); i = j + 2; continue;
      }
    }
    out += c; i += 1;
  }
  return out;
}
function matchPair(s: string, i: number, op: string, cl: string): number {
  let d: number = 0;
  while (i < s.length) {
    if (s.charAt(i) === op) { d++; }
    else if (s.charAt(i) === cl) { d--; if (d === 0) { return i; } }
    i += 1;
  }
  return -1;
}
const WS: string = ' \t\r\n';
/** 元素链（先跳过可选 `{...}` 块 —— ⛔ 漏这步会让块容器类元素的链恒为空）。 */
function chainAfter(s: string, i: number): Array<string[]> {
  while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  if (i < s.length && s.charAt(i) === '{') {
    const k: number = matchPair(s, i, '{', '}');
    i = k < 0 ? s.length : k + 1;
  }
  while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  const out: Array<string[]> = [];
  while (i < s.length && s.charAt(i) === '.') {
    const j: number = s.indexOf('(', i);
    if (j < 0) { break; }
    const k: number = matchPair(s, j, '(', ')');
    if (k < 0) { break; }
    out.push([s.substring(i + 1, j), s.substring(j + 1, k)]);
    i = k + 1;
    while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  }
  return out;
}
function lineOf(s: string, idx: number): number { let n: number = 1; for (let i = 0; i < idx; i++) { if (s.charAt(i) === '\n') { n++; } } return n; }

const srcByRel: Map<string, string> = new Map<string, string>();
for (const d of ['components', 'pages']) {
  const base: string = pathMod.join(etsRoot, d);
  const walk = (dir: string): void => {
    const ents: string[] = fsMod.readdirSync(dir);
    for (let i = 0; i < ents.length; i++) {
      const p: string = pathMod.join(dir, ents[i]);
      if (fsMod.statSync(p).isDirectory()) { walk(p); }
      else if (ents[i].endsWith('.ets')) { srcByRel.set(pathMod.relative(etsRoot, p), fsMod.readFileSync(p, 'utf-8')); }
    }
  };
  walk(base);
}

console.log('\n▶ §A 实测地板表：弱档 role × 各标准面（⛔ 凹槽用**凹槽自身**的填充色，不用 appBg 冒充）');
const HOSTS: string[] = ['appBg', 'surface', 'surfaceAlt', 'surfaceHi', 'chip', 'well', 'sunken'];
function hostFill(name: string, t: string): string {
  const p = paletteOf(t);
  if (name === 'appBg') { return p.appBg; }
  if (name === 'surface') { return p.surface; }
  if (name === 'surfaceAlt') { return p.surfaceAlt; }
  if (name === 'surfaceHi') { return p.surfaceHi; }
  if (name === 'chip') { return surfaceFillOf(p, 'surface.chip'); }
  if (name === 'well') { return surfaceFillOf(p, 'surface.well'); }
  return surfacesOf(p).sunken;
}
console.log(`  文本最弱档 AA_MUTED = ${AA_MUTED}；非文本/可点档 AA_NON_TEXT = ${AA_NON_TEXT}`);
class Row { theme: string = ''; role: string = ''; vals: number[] = []; }
function probe(role: string, t: string): Row {
  const p = paletteOf(t);
  // ⛔ 优先走 `colorOf`（**role**，如 `iconMuted` 是计算出来的、**不是**调色板字段）；
  //    若回落成透明（说明这名字不是 role）⇒ 才读调色板字段。
  let fg: string = colorOf(p, role);
  const alpha: number = fg.length >= 9 ? parseInt(fg.substring(1, 3), 16) : 255;
  if (fg.length === 0 || alpha === 0) {
    const pal = p as unknown as Record<string, string>;
    fg = pal[role] !== undefined ? pal[role] : '';
  }
  if (fg.length === 0 || fg.charAt(0) !== '#') { fg = '#000000'; }
  const r: Row = new Row();
  r.theme = t; r.role = role;
  for (let i = 0; i < HOSTS.length; i++) { r.vals.push(contrastRatio(fg, hostFill(HOSTS[i], t))); }
  return r;
}
console.log('  ' + pad('theme/role', 22) + HOSTS.map((h) => pad(h, 9)).join(''));
for (const t of ['porcelain', 'dark']) {
  for (const role of ['textMuted', 'textSecondary', 'iconMuted']) {
    const r: Row = probe(role, t);
    console.log('  ' + pad(`${t}/${role}`, 22) + r.vals.map((v) => pad(v.toFixed(2), 9)).join(''));
  }
}
const pm: Row = probe('textMuted', 'porcelain');
const minPorc: number = Math.min.apply(null, pm.vals);
const maxPorc: number = Math.max.apply(null, pm.vals);
console.log(`  ⇒ **textMuted 在 porcelain 下全档 ${minPorc.toFixed(2)}–${maxPorc.toFixed(2)}**（均 < ${AA_NON_TEXT}）`);
ok(`事实：textMuted/porcelain 全部面 < ${AA_NON_TEXT}（⇒ 不可用于可点/图标）`, maxPorc < AA_NON_TEXT);
ok(`事实：textMuted/porcelain ≥ AA_MUTED(${AA_MUTED})（⇒ 用于**非交互元信息文本**是**合规**的，别一刀切换掉）`, minPorc >= AA_MUTED);
ok('对照：iconMuted 在 porcelain 达标非文本门槛（图标专用出口是对的）',
  Math.min.apply(null, probe('iconMuted', 'porcelain').vals) >= AA_NON_TEXT);

console.log('\n▶ §A2 口径修正 (b) 的数字依据：`textMuted` 压 **恒深品牌画布** 全主题达标');
{
  const canvas: string = splashBrandCanvas();
  console.log(`  splashBrandCanvas() = ${canvas}`);
  let allOk: boolean = true;
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const p = paletteOf(ALL_THEMES[i]);
    const c: number = contrastRatio(colorOf(p, 'textMuted'), canvas);
    console.log(`     ${pad(ALL_THEMES[i], 11)} textMuted vs 品牌画布 = ${c.toFixed(2)}`);
    if (c < AA_NON_TEXT) { allOk = false; }
  }
  ok(`口径修正 (b)：splash 品牌画布上 textMuted **全主题 ≥${AA_NON_TEXT}** ⇒ 「轻点跳过」不是违规`,
    allOk && canvas.length > 0);
}

console.log('\n▶ §B 判据（硬）：`textMuted` 不得作为「可点元素」或「SymbolGlyph」的**直接**取色');
const CLICK: string[] = ['onClick', 'bindMenu', 'bindPopup', 'bindSheet', 'gesture', 'onTouch', 'bindContextMenu', 'bindTips'];
class Hit { rel: string = ''; line: number = 0; kind: string = ''; key: string = ''; }
function scanBad(m: Map<string, string>, exempt: string[]): Hit[] {
  const out: Hit[] = [];
  m.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    // ⛔ **口径 (b) 做进扫描**（不是只写台账/断言）：若该站点压在**恒深品牌画布**上
    //    （`SplashOverlay` 的根容器 `.backgroundColor(this.canvasColor())`，值来自 `core/splash.splashBrandCanvas()`）
    //    ⇒ 用**真宿主**算：`textMuted` 在 `#0B0B0E` 上全主题 ≥3 ⇒ **不计命中**。
    //    （我原先只把它登记进台账 + 加数字断言 ⇒ 扫描仍报它 ⇒ "未登记"永远挡着。口径修正必须**落到扫描**。）
    const onDarkBrandCanvas: boolean = src.indexOf('splashBrandCanvas') >= 0
      && src.indexOf('.backgroundColor(this.canvasColor())') >= 0;
    if (onDarkBrandCanvas) {
      let allOk2: boolean = true;
      for (let i = 0; i < ALL_THEMES.length; i++) {
        if (contrastRatio(colorOf(paletteOf(ALL_THEMES[i]), 'textMuted'), splashBrandCanvas()) < AA_NON_TEXT) { allOk2 = false; }
      }
      if (allOk2) { return; }   // 该文件里压在品牌画布上的 textMuted 全部达标 ⇒ 不是违规
    }
    const rx: RegExp = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
    let x: RegExpExecArray | null = rx.exec(src);
    while (x !== null) {
      const j: number = src.indexOf('(', x.index);
      const k: number = matchPair(src, j, '(', ')');
      if (k > 0) {
        const ch: Array<string[]> = chainAfter(src, k + 1);
        const clicky: boolean = ch.some((p) => CLICK.indexOf(p[0]) >= 0);
        const icon: boolean = x[1] === 'SymbolGlyph' || x[1] === 'Image';
        if (clicky || icon) {
          // ⛔ 只认**直接取色**（`.textMuted` / `colorOf(…,'textMuted')`）；函数间接取色不算（静态不可判）
          let direct: boolean = false;
          let conditional: boolean = false;   // ⛔ **禁用/降级态弱化**（三元退化分支）
          for (let i = 0; i < ch.length; i++) {
            if (ch[i][0] !== 'fontColor') { continue; }
            const v: string = ch[i][1];
            const hasMuted: boolean = /\.textMuted\b/.test(v) || /'textMuted'/.test(v);
            if (!hasMuted) { continue; }
            // ⛔ **口径修正 (a)**：`cond ? A : B` 里的 `textMuted` = **"不可用/降级时灰显"**，
            //    是**有意弱化**（禁用态的可视性要求低于可交互态，且那时**不可点**）⇒ **不算违规**。
            //    实测依据：`SettingsDeveloper:302`（`chatID.length>0 ? onAccent : textMuted`，压在 `surfaceAlt` 上）
            //    与 `SettingsLlm:1420`（`perModelEditReason(...)>0 ? textMuted : accentSoft`，
            //    源码注释原文："拿不到既有配置 ⇒ **灰显 + 不可点**"）都属此类。
            if (/\?/.test(v) && !/\bdisabled\b/.test(v)) { conditional = true; continue; }
            if (/\.textMuted\b/.test(v)) { direct = true; }
            if (/colorOf\([^,()]+(?:\([^()]*\))?\s*,\s*'textMuted'\s*\)/.test(v)) { direct = true; }
          }
          if (conditional && !direct) { direct = false; }
          if (direct) {
            const key: string = `${rel} :: ${x[1]}::${clicky ? 'clickable' : 'icon'}`;
            if (exempt.indexOf(key) < 0) {
              const h: Hit = new Hit();
              h.rel = rel; h.line = lineOf(src, x.index); h.kind = clicky ? '可点' : '图标';
              h.key = key;
              out.push(h);
            }
          }
        }
      }
      x = rx.exec(src);
    }
  });
  return out;
}
/** 例外台账（⛔ 只许缩短；每条给理由）。 */
const KNOWN_OK: string[] = [
  // ✅ 2026-10-11 **已全部收缩为空**（"谁修谁收缩"）：
  //   · `chat-surface-ux`（`8591d85`）修掉 7 处：`MessageRow` 图标×4 + 可点×1 · `LiveTailView` ·
  //     `MarkdownView` · `Index`（SymbolGlyph×2 + Text）—— 全部改走 `iconMuted`/`textSecondary`。
  //   · `GoalBanner:153`（目标文本**已完成态**的 `textMuted`+删除线）= **三元退化分支** ⇒ 被口径 (a) 覆盖，不再命中。
  //   · `SplashOverlay:174`（「轻点跳过」压**恒深品牌画布**）= 达标 ⇒ 由 §A2 的**数字断言**守着，不占台账。
  // ⛔ 本表**只许缩短**；新命中 ⇒ "未登记"必红。
];
/**
 * `PENDING_SPEC`：**他域待修**（⛔ 只许缩短；**谁修完谁收缩台账**）。
 * ⚠️ 键为 `文件 :: 元素::语义位`，同键多处**只登记一条**（豁免是**集合**语义）——
 *    但**逐条打印**会显示全部命中，别被键的去重骗了。
 * ⭐ 本表按**已提交树**（`git worktree --detach @ HEAD`）校准；主树可能含别人在途修复。
 */
const PENDING_SPEC: string[] = [
  // ✅ 2026-10-11 **已收缩为空**：原先登记的两条 `MessageRow`（`SymbolGlyph::icon` / `Text::clickable`）
  //    已由 `chat-surface-ux`（`8591d85`）修复 ⇒ 按"谁修谁收缩"删除（留着会被**陈旧断言**判红）。
  // ⛔ 本表**只许缩短**；他域新命中 ⇒ 登记在此（并注明归属线）。
];
const bad: Hit[] = scanBad(srcByRel, KNOWN_OK.concat(PENDING_SPEC));
// ⛔ **逐条打印全部**（第一版只打印**去重后的键** ⇒ 4 处违规只显示 1 行 ⇒ "摘要掩盖真数"，
//    定位不到是哪 4 处。判据的输出必须**能定位到每一处**。）
let printed: number = 0;
for (let i = 0; i < bad.length; i++) {
  console.log(`  ⚠ ${bad[i].rel}:${bad[i].line}  [${bad[i].kind}]  key=${bad[i].key}`);
  printed += 1;
}
ok(`未登记的违规 = 0（实测未登记 ${bad.length} 处）`, bad.length === 0);
// ⛔ **白绿防线（针对"摘要掩盖真数"）**：有违规时，打印行数必须 ≥ 违规数，否则本判据自己的输出不可信。
ok(`打印完整度：违规 ${bad.length} 处，逐条打印 ${printed} 行（必须 ≥ 违规数）`, printed >= bad.length);
/**
 * ⛔ **「谁修谁收缩」必须被强制，不能只靠约定**（2026-10-11 补）：
 * 台账若挂着**已修好**的条目 ⇒ 本条**必红**（陈旧）。
 * ⚠️ 我原先只断言了"未登记 == 0"，**没断言"陈旧 == 0"** ⇒ `chat-surface-ux` 修完这 5 处后，
 *    我的 `PENDING_SPEC` 仍静静留着 ⇒ **没有任何东西逼我收缩**（这正是"台账悄悄腐烂"的入口）。
 *    ⭐ 校准树 = **已提交树**（`git worktree --detach @ HEAD`），不是主树。
 */
const allMeasured: Hit[] = scanBad(srcByRel, []);              // 不过滤 ⇒ 全部实测命中
const measuredKeys: string[] = [];
for (let i = 0; i < allMeasured.length; i++) { if (measuredKeys.indexOf(allMeasured[i].key) < 0) { measuredKeys.push(allMeasured[i].key); } }
const registered: string[] = KNOWN_OK.concat(PENDING_SPEC);
const stale: string[] = [];
for (let i = 0; i < registered.length; i++) { if (measuredKeys.indexOf(registered[i]) < 0) { stale.push(registered[i]); } }
for (let i = 0; i < stale.length; i++) { console.log(`  [stale] ${stale[i]}`); }
ok(`台账只许缩短：无"已修好却仍留着"的陈旧条目（陈旧 ${stale.length} 条）`, stale.length === 0);
console.log('  台账：KNOWN_OK ' + KNOWN_OK.length + '（已证良性/有意）+ PENDING_SPEC ' + PENDING_SPEC.length + '（他域待修）—— ⛔ 都只许缩短');

console.log('\n▶ §C mutation 自证（合成源码）');
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Text('取消').fontColor(this.pal().textMuted).onClick(() => {})\n}\n");
  ok('mutation：可点元素用 `textMuted` ⇒ 必红', scanBad(inj, []).length === 1);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  SymbolGlyph(x).fontColor([this.pal().textMuted])\n}\n");
  ok('mutation：`SymbolGlyph` 用 `textMuted` ⇒ 必红', scanBad(inj, []).length === 1);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Text('取消').fontColor(this.pal().textSecondary).onClick(() => {})\n}\n");
  ok('反向对照：可点元素用达标档 `textSecondary` ⇒ 不命中', scanBad(inj, []).length === 0);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Text(this.label).fontColor(this.roleColorOf(x, this.pal()))\n}\n");
  ok('反向对照：**函数间接取色**（静态不可判）⇒ 不命中（⛔ 不产假阳性）', scanBad(inj, []).length === 0);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Text('元信息').fontColor(this.pal().textMuted)\n}\n");
  ok(`反向对照：**非交互元信息文本**用 textMuted ⇒ 不命中（它的批准档 AA_MUTED=${AA_MUTED}）`, scanBad(inj, []).length === 0);
}

console.log('\n▼ 摘要');
console.log(`  textMuted/porcelain 全档 ${minPorc.toFixed(2)}–${maxPorc.toFixed(2)}（< ${AA_NON_TEXT}）；iconMuted/porcelain 最低 ${Math.min.apply(null, probe('iconMuted', 'porcelain').vals).toFixed(2)}`);
console.log(`  违规：未登记 ${bad.length} 处；台账 ${KNOWN_OK.length} 条`);
if (fail > 0) { console.log(`\n  role_surface_floor: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  role_surface_floor: ${pass} passed, 0 failed`);
process.exit(0);

export {};
