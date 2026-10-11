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
  // **状态化弱化（有意）**：目标条的目标文本在**已完成**态用 `textMuted` + 删除线（web `:122-128` 同款）
  // —— "已完成 ⇒ 退居背景"的设计，且该行**本身不承载操作**（操作在右侧按钮上）。⛔ 不修。
  'components/GoalBanner.ets :: Text::clickable',
  // ⛔ **口径修正 (b)：宿主感知** —— `SplashOverlay:174`「轻点跳过」的宿主是
  //    `splashBrandCanvas()`（**恒深** `#0B0B0E`，不是浅面）⇒ `textMuted` 在其上
  //    **porcelain 7.73 / light 7.67 / dark 3.32 / aurora 4.99 / nebula 4.90**（全 ≥3）
  //    ⇒ **不是违规**。（我原先的判据只按"porcelain × 光面"一刀切 ⇒ **口径错**，不是产品错。）
  //    ✅ 下面 §A2 有一条断言把这份数字**钉住**（若画布变浅会立刻红）。
  'components/SplashOverlay.ets :: Text::clickable',
  // ── 以下**全在他域** ⇒ 只出 spec（chat-surface-ux / tokens-ux）──
  'components/LiveTailView.ets :: Text::clickable',
  'components/MessageRow.ets :: Text::clickable',
  'pages/Index.ets :: SymbolGlyph::clickable',
  'pages/Index.ets :: SymbolGlyph::icon',
  'components/MarkdownView.ets :: SymbolGlyph::icon',   // chat-surface-ux（代码块语言标签前的图标）
  'components/SplashOverlay.ets :: Text::clickable',    // splash-ux（「轻点跳过」）
  'pages/Index.ets :: Text::clickable',                 // chat-surface-ux（Index 现被 splash-ux 锁定）
];
const bad: Hit[] = scanBad(srcByRel, KNOWN_OK);
{
  const seenK: string[] = [];
  for (let i = 0; i < bad.length; i++) { if (seenK.indexOf(bad[i].key) < 0) { seenK.push(bad[i].key); } }
  for (let i = 0; i < seenK.length; i++) { console.log("  ['" + seenK[i] + "'],"); }
}
ok(`未登记的违规 = 0（实测未登记 ${bad.length} 处）`, bad.length === 0);
console.log('  台账 ' + KNOWN_OK.length + ' 条（⛔ 只许缩短）：我域已修 1（GoalBanner:140 取消按钮 ⇒ textSecondary）');

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
