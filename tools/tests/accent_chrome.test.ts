/**
 * accent_chrome.test.ts —— 目标⑤「`accent` 被当 UI 铬文本」越界落点判据（2026-10-11）。
 *
 * ── 为什么需要它（不是"重造边界扫描"）─────────────────────────────────────────────
 * `core/design.ets` 把 `accent` 判成**非文本/图形** role（`AA_NON_TEXT` 3.0，供弧/环/点/图标）。
 * 但它另有 **normal 字号（10–12）的文字落点**（跨类误用）。其中 **ANSI 终端里的用法是已登记的
 * 显式例外**（`docs/DESIGN-SYSTEM.md §15.4`）；**其余 5 处非终端 UI 铬文本**才是真越界，
 * 由 `design-matrix` 的 §6 边界扫描钓出。本判据把"这 5 处已修好"钉成**机器可判**。
 *
 * ── 判据（形态 + 计数，⛔ 不做"凡出现即红"的宽判）────────────────────────────────
 *  ★① **边界扫描归零**：`components/**`+`pages/**` 里 `accent|statusError|statusRunning` 的
 *     **非终端直接文字用法**（widget-aware，与 porcelain §6.2 同算法）必须 **== 0**。
 *     （ANSI 通道 `ansiFgOf` 放行；`SymbolGlyph`/`Progress` 等图形 widget 不算文字。）
 *  ★② **逐处形态**：5 个落点各自的 `.fontColor(...)` 必须是**文字 role**（`accentText`/`accentSoft`），
 *     且同窗口内**不得**再出现裸 `pal().accent`（mutation：回退一处 ⇒ ★①② 双红）。
 *  ★③ **三主题实算**：改后 role 压**真实宿主面**在**全部 5 主题** ≥ `AA_TEXT`(4.5)；
 *     且裸 `accent` 压同一宿主面**至少有一个主题 < 4.5**（证明"改前确实越界" ⇒ 判据有判别力）。
 *  ★④ **零扫描判红**：扫到的文件/`.fontColor(` 行数必须 > 0（否则本判据会白绿）。
 *
 * ── 判别力自证（mutation，交付回报含实跑）────────────────────────────────────────
 *   把任一落点回退成 `pal().accent`（经 `XBOT_ACCENT_CHROME_SRC` 注入**副本**，⛔ 不碰真源）
 *   ⇒ 本测试必红。用法（示例）：
 *     XBOT_ACCENT_CHROME_SRC="components/GoalBanner.ets=/tmp/mut/GoalBanner.ets" \
 *       node …/accent_chrome.test.js
 *
 * ⚠️ 本文件**只判组件落点**：⛔ 不改色板（`core/theme.ets`）、⛔ 不改 `core/design.ets` 的
 *    角色表/阈值。真源侧的角色定义与台账收缩属 `design-matrix` 域。
 */
export {};

declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; readdirSync(p: string): string[]; statSync(p: string): { isDirectory(): boolean } };
declare function require(m: 'path'): { join(...p: string[]): string };
declare const __dirname: string;

import { paletteOf, ALL_THEMES, contrastRatio, compositeOver, Palette } from '../../entry/src/main/ets/core/theme';
import { withAlpha } from '../../entry/src/main/ets/core/bubble';
import {
  colorOf, goalBadgeBgOf, goalRowTintOf, AA_TEXT,
} from '../../entry/src/main/ets/core/design';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail: string = ''): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${detail.length > 0 ? `\n      ${detail}` : ''}`); }
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const etsRoot: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets');

/** 剥注释（保留换行 ⇒ 行号不漂移；仓内约定：注释里记色值/role 是允许且鼓励的）。 */
function stripComments(src: string): string {
  let out: string = ''; let i: number = 0; const n: number = src.length;
  while (i < n) {
    const c: string = src.charAt(i);
    if (c === '/' && i + 1 < n) {
      if (src.charAt(i + 1) === '/') { const j: number = src.indexOf('\n', i); i = j < 0 ? n : j; continue; }
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

// ── 源覆盖（mutation 用：注入**副本**，⛔ 不碰真源）──────────────────────────────
// 格式：`rel1=abs1;rel2=abs2`（rel 相对 etsRoot；abs 是替换内容文件）
const OVERRIDES: Map<string, string> = new Map<string, string>();
{
  const raw: string = process.env.XBOT_ACCENT_CHROME_SRC !== undefined
    ? (process.env.XBOT_ACCENT_CHROME_SRC as string) : '';
  if (raw.length > 0) {
    const pairs: string[] = raw.split(';');
    for (let i = 0; i < pairs.length; i++) {
      const eq: number = pairs[i].indexOf('=');
      if (eq > 0) {
        OVERRIDES.set(pairs[i].slice(0, eq), pairs[i].slice(eq + 1));
      }
    }
  }
}
function readRel(rel: string): string {
  if (OVERRIDES.has(rel)) { return fsMod.readFileSync(OVERRIDES.get(rel) as string, 'utf-8').replace(/i18nT\(([^()]*)\)/g, '$1'); }
  return fsMod.readFileSync(pathMod.join(etsRoot, rel), 'utf-8').replace(/i18nT\(([^()]*)\)/g, '$1');
}

function walkEts(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: string[] = [];
    try { entries = fsMod.readdirSync(d); } catch (ee) { return; }
    for (let i = 0; i < entries.length; i++) {
      const full: string = pathMod.join(d, entries[i]);
      let st: { isDirectory(): boolean } | null = null;
      try { st = fsMod.statSync(full); } catch (ee2) { st = null; }
      if (st === null) { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (full.slice(full.length - 4) === '.ets') { out.push(full); }
    }
  };
  walk(dir);
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// ★① 边界扫描：非终端「accent 家族」直接文字用法 == 0（widget-aware）
// ════════════════════════════════════════════════════════════════════════════
const TEXT_ROLES: string = 'accent|statusError|statusRunning';
const reRole: RegExp = new RegExp(`pal\\(\\)\\.(${TEXT_ROLES})\\b|'(${TEXT_ROLES})'`);
const reWidget: RegExp = /\b(Text|Span|SymbolGlyph|Progress|LoadingProgress)\s*\(/;

function scanLeaks(): string[] {
  const files: string[] = walkEts(pathMod.join(etsRoot, 'components'))
    .concat(walkEts(pathMod.join(etsRoot, 'pages')));
  const out: string[] = [];
  for (let fi = 0; fi < files.length; fi++) {
    const f: string = files[fi];
    const rel: string = f.indexOf(etsRoot) === 0 ? f.slice(etsRoot.length + 1) : f;
    let lines: string[] = [];
    try { lines = readRel(rel).split('\n'); } catch (ee) { continue; }
    for (let i = 0; i < lines.length; i++) {
      const ln: string = lines[i];
      if (ln.indexOf('.fontColor(') < 0) { continue; }
      if (!reRole.test(ln)) { continue; }
      if (ln.indexOf('ansiFgOf') >= 0) { continue; }       // ANSI 通道 = 被认可的例外
      let kind: string = 'graphic';
      for (let j = i; j >= Math.max(0, i - 12); j--) {
        const m: RegExpMatchArray | null = lines[j].match(reWidget);
        if (m !== null) { kind = (m[1] === 'Text' || m[1] === 'Span') ? 'text' : 'graphic'; break; }
      }
      if (kind !== 'text') { continue; }
      out.push(`${rel}:${i + 1}`);
    }
  }
  return out.sort();
}

// 零扫描判红：先证明扫描非空（文件 > 0）
const compFiles: string[] = walkEts(pathMod.join(etsRoot, 'components'));
const pageFiles: string[] = walkEts(pathMod.join(etsRoot, 'pages'));
ok('★④ 零扫描判红：扫到组件源码 > 0 文件', compFiles.length > 0, `got ${compFiles.length}`);
ok('★④ 零扫描判红：扫到页面源码 > 0 文件', pageFiles.length > 0, `got ${pageFiles.length}`);

// 证明"扫到过 .fontColor( 行"（否则本判据无论源码如何都会白绿）
let fontColorLines: number = 0;
{
  const all: string[] = compFiles.concat(pageFiles);
  for (let i = 0; i < all.length; i++) {
    const rel: string = all[i].indexOf(etsRoot) === 0 ? all[i].slice(etsRoot.length + 1) : all[i];
    let lines: string[] = [];
    try { lines = readRel(rel).split('\n'); } catch (ee) { continue; }
    for (let j = 0; j < lines.length; j++) { if (lines[j].indexOf('.fontColor(') >= 0) { fontColorLines++; } }
  }
}
ok('★④ 零扫描判红：扫到 .fontColor( 行 > 0（扫描窗口非空）', fontColorLines > 0, `got ${fontColorLines}`);

const leaks: string[] = scanLeaks();
console.log('  · ★① 边界扫描（非终端 accent 家族直接文字用法，应为 0）:');
if (leaks.length === 0) { console.log('      （无）'); }
for (let i = 0; i < leaks.length; i++) { console.log(`      ${leaks[i]}`); }
ok('★① 非终端「accent 家族」直接文字用法 == 0（回退任一落点 ⇒ 红）',
  leaks.length === 0, `got ${JSON.stringify(leaks)}`);

// ════════════════════════════════════════════════════════════════════════════
// ★② 逐处形态：5 个落点各用哪个**文字 role**（同窗口内不得再有裸 pal().accent）
// ════════════════════════════════════════════════════════════════════════════
class Site {
  id: string; file: string; anchor: string; expect: string; role: string;
  constructor(id: string, file: string, anchor: string, expect: string, role: string) {
    this.id = id; this.file = file; this.anchor = anchor; this.expect = expect; this.role = role;
  }
}
const SITES: Site[] = [
  new Site('1 GoalBanner 保存', 'components/GoalBanner.ets',
    "Text('保存')", '.fontColor(this.pal().accentText)', 'accentText'),
  new Site('2 GoalBanner 状态徽标', 'components/GoalBanner.ets',
    'Text(this.display().badge)',
    '.fontColor(this.display().completed ? this.pal().success : this.pal().accentText)', 'accentText'),
  new Site('3 MessageNav 序号', 'components/MessageNav.ets',
    '.fontColor(this.row.active ? this.pal().accentText : this.pal().textMuted)',
    '.fontColor(this.row.active ? this.pal().accentText : this.pal().textMuted)', 'accentText'),
  new Site('4 SettingsAbout 发布说明', 'components/SettingsAbout.ets',
    "Text('发布说明')", '.fontColor(this.pal().accentSoft)', 'accentSoft'),
  new Site('5 TodoPanel goal 徽标', 'components/TodoPanel.ets',
    "Text('goal')", '.fontColor(this.pal().accentText)', 'accentText'),
];
ok('★② 落点清单冻结 = 5 处', SITES.length === 5, `got ${SITES.length}`);

const reBareAccent: RegExp = /pal\(\)\.accent\b/;   // 裸 accent（不匹配 accentText/accentSoft）
for (let i = 0; i < SITES.length; i++) {
  const s: Site = SITES[i];
  let src: string = '';
  try { src = stripComments(readRel(s.file)); } catch (ee) { src = ''; }
  ok(`★② [${s.id}] 源文件可读且非空`, src.length > 0, s.file);
  const at: number = src.indexOf(s.anchor);
  ok(`★② [${s.id}] 锚点存在（${s.anchor.slice(0, 32)}…）`, at >= 0, `${s.file}`);
  // 锚点之后 ~600 字符窗口 = 该 widget 的样式链
  const win: string = at >= 0 ? src.substr(at, 600) : '';
  ok(`★② [${s.id}] 该落点用文字 role ${s.role}（${s.expect}）`,
    win.indexOf(s.expect) >= 0, `${s.file}`);
  ok(`★② [${s.id}] 该落点窗口内**不再**出现裸 pal().accent（mutation 判据）`,
    !reBareAccent.test(win), `${s.file}`);
}

// ════════════════════════════════════════════════════════════════════════════
// ★③ 三主题实算：改后 role 压真实宿主面 ≥ 4.5，且裸 accent 至少一主题 < 4.5
// ════════════════════════════════════════════════════════════════════════════
// 真宿主面（每处都是"该文字实际坐在什么底上"）：
//   · GoalBanner 保存/徽标：`goalBadgeBgOf`(= accent@15%) over `surface`（横幅底 `surface`）
//   · MessageNav 序号：激活行底纹 `accent@10%` over `surface`（浮层面 = `surface.overlay` = `surface`）
//   · SettingsAbout 发布说明：卡片面 `surface`
//   · TodoPanel goal 徽标：行底 `goalRowTintOf` 已 tint + 徽标自身再 tint ⇒ **双层**，再落卡片 `surface`
function surfaceOf(p: Palette): string { return colorOf(p, 'surface'); }
function hostBadge(p: Palette): string { return compositeOver(goalBadgeBgOf(p, false), surfaceOf(p)); }
function hostNav(p: Palette): string { return compositeOver(withAlpha(p.accent, 0.1), surfaceOf(p)); }
function hostCard(p: Palette): string { return surfaceOf(p); }
function hostTodoBadge(p: Palette): string {
  const card: string = surfaceOf(p);
  const row: string = compositeOver(goalRowTintOf(p), card);       // 行底目标底纹
  return compositeOver(goalRowTintOf(p), row);                      // 徽标自身再叠一层（现状 U.I.）
}

class HostSite {
  id: string; role: string; host: (p: Palette) => string;
  constructor(id: string, role: string, host: (p: Palette) => string) {
    this.id = id; this.role = role; this.host = host;
  }
}
const HOST_SITES: HostSite[] = [
  new HostSite('1 GoalBanner 保存', 'accentText', hostBadge),
  new HostSite('2 GoalBanner 状态徽标（进行中分支）', 'accentText', hostBadge),
  new HostSite('3 MessageNav 序号（激活）', 'accentText', hostNav),
  new HostSite('4 SettingsAbout 发布说明', 'accentSoft', hostCard),
  new HostSite('5 TodoPanel goal 徽标', 'accentText', hostTodoBadge),
];
ok('★③ 宿主面清单冻结 = 5 处', HOST_SITES.length === 5, `got ${HOST_SITES.length}`);
ok('★③ ALL_THEMES 覆盖 5 主题', ALL_THEMES.length === 5, `got ${ALL_THEMES.length}`);

console.log('  · ★③ 逐处三主题实算（改后 role 档 = AA_TEXT 4.5）：');
for (let i = 0; i < HOST_SITES.length; i++) {
  const s: HostSite = HOST_SITES[i];
  let accentMin: number = 99;
  let roleMin: number = 99;
  const cells: string[] = [];
  for (let ti = 0; ti < ALL_THEMES.length; ti++) {
    const th: string = ALL_THEMES[ti];
    const p: Palette = paletteOf(th);
    const host: string = s.host(p);
    // role 必须是**合法** colorOf 角色（拼错 ⇒ 静默 transparent ⇒ 这里直接红）
    ok(`★③ [${s.id}][${th}] colorOf('${s.role}') 是合法角色（非 transparent）`,
      colorOf(p, s.role) !== p.transparent, `got ${colorOf(p, s.role)}`);
    const rRole: number = contrastRatio(colorOf(p, s.role), host);
    const rAcc: number = contrastRatio(p.accent, host);
    if (rRole < roleMin) { roleMin = rRole; }
    if (rAcc < accentMin) { accentMin = rAcc; }
    cells.push(`${th}:${s.role}=${rRole.toFixed(3)}${rRole < AA_TEXT ? '!' : ''}/accent=${rAcc.toFixed(3)}${rAcc < AA_TEXT ? '!' : ''}`);
    ok(`★③ [${s.id}][${th}] ${s.role} 压真实宿主面 ≥ 4.5（${rRole.toFixed(3)}）`,
      rRole >= AA_TEXT, `got ${rRole.toFixed(4)}`);
  }
  console.log(`      ${s.id}`);
  console.log(`        ${cells.join('  ')}`);
  // 判别力：裸 accent 至少要有一个主题压该宿主面 < 4.5（否则"改前确实越界"不成立）
  ok(`★③ [${s.id}] 裸 accent 压同一宿主面存在主题 < 4.5（证明改前越界，min=${accentMin.toFixed(3)}）`,
    accentMin < AA_TEXT, `min=${accentMin.toFixed(4)}`);
}

console.log(`\n  accent_chrome: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
