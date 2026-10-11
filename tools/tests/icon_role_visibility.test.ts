/**
 * icon_role_visibility.test.ts —— **图标取色的可见性**（"取色 role 写错 = 静默不可见"族 · 2026-10-11）。
 *
 * ── 两类缺陷 ──────────────────────────────────────────────────────────────────
 *  **A 类（必错，硬红）**：`colorOf(p, '<role>')` 传一个**不在真源角色表里**的名字
 *    ⇒ `colorOf` 末尾 `return p.transparent` ⇒ 图标/文字**运行时不 可见、编译零警告**。
 *    ⚠️ 合法集合**从 `core/design.ets` 的 `colorOf` 实现里现读**（⛔ 不硬编码复制 —— 复制会腐烂）。
 *  **B 类（弱可见性，报告）**：role 合法，但**与它所在容器的底对比度 < 3:1**
 *    （阈值出处：`design.ets` 的 `ContrastReq('iconMuted','appBg',AA_NON_TEXT,…)` ＝ **非文本 3:1**，
 *     WCAG §1.4.11）。宿主底**从该图标的直接父容器的 `surfaceFillOf(...)` 推**；推不出 ⇒ 标"待定"。
 *
 * ── 为什么 `pal().FIELD` 不算 A 类 ─────────────────────────────────────────────
 * `this.pal().textMuted` 这类**字段访问**由 ArkTS 类型检查把关（拼错 ⇒ **编译期** TS2339）
 * ⇒ 不会"静默透明"。**只有 `colorOf(p,'字符串')` 这条路径是字符串**，绕过了类型检查。
 * ⇒ A 类判据**只盯 `colorOf` 的字面量 role**（这正是本仓 GOTCHA 说的那个坑）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(m: 'path'): { join(...parts: string[]): string; relative(a: string, b: string): string };
declare const __dirname: string;

import {
  paletteOf, contrastRatio, isLightPalette, surfacesOf, effectsOf,
} from '../../entry/src/main/ets/core/theme';
// ⛔ `colorOf` 在 **design.ets**（不是 theme.ets）—— 我第一版导错文件。
import { surfaceFillOf, AA_NON_TEXT, colorOf } from '../../entry/src/main/ets/core/design';

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

console.log('\n▶ §A 合法 role 集合 —— **从 `colorOf` 真源现读**（⛔ 不硬编码复制）');
// ⛔ 合法集合在 **core/** 里，而 `srcByRel` 只扫了 components/pages ⇒ 必须**直接从磁盘读**。
//    （本仓反复的教训：常量/真源表所在的目录一定要扫到，否则"取不到"会被静默当空。）
const designSrc: string = stripComments(fsMod.readFileSync(pathMod.join(etsRoot, 'core', 'design.ets'), 'utf-8'));
const coIdx: number = designSrc.indexOf('export function colorOf');
const coEnd: number = designSrc.indexOf('\n}', coIdx);
const coBody: string = designSrc.substring(coIdx, coEnd);
const LEGAL: string[] = [];
{
  // ⛔ 每轮新建非全局正则（带 `g` 的正则跨替换复用会跳匹配 —— 本仓踩过）
  const rx: RegExp = /role === '([A-Za-z.]+)'/;
  let seg: string = coBody;
  let m: RegExpExecArray | null = rx.exec(seg);
  while (m !== null) {
    if (LEGAL.indexOf(m[1]) < 0) { LEGAL.push(m[1]); }
    seg = seg.substring(m.index + m[0].length);
    m = rx.exec(seg);
  }
}
// 已知首行是 `if (role === 'sunken')`，末行是 `return p.transparent;`（不算 role）
console.log(`  真源解析出 ${LEGAL.length} 个合法 role：${LEGAL.slice(0, 12).join(', ')} …`);
ok('合法集合非空（真源解析成功）', LEGAL.length >= 20);
ok('末尾回落确实是 `return p.transparent;`（A 类的机制出处）', coBody.indexOf('return p.transparent;') >= 0);
ok('真源里确含 `iconMuted`（弱图标专用出口）', LEGAL.indexOf('iconMuted') >= 0);

console.log('\n▶ §B 枚举：全部 `SymbolGlyph` 的取色如何来');
class Pt { rel: string = ''; line: number = 0; role: string = ''; kind: string = ''; raw: string = ''; }
const pts: Pt[] = [];
let total: number = 0;
srcByRel.forEach((raw: string, rel: string) => {
  const src: string = stripComments(raw);
  const rx: RegExp = /\bSymbolGlyph\s*\(/g;
  let x: RegExpExecArray | null = rx.exec(src);
  while (x !== null) {
    const j: number = src.indexOf('(', x.index);
    // 配平取实参
    let d: number = 0; let k: number = -1;
    for (let i = j; i < src.length; i++) {
      if (src.charAt(i) === '(') { d++; }
      else if (src.charAt(i) === ')') { d--; if (d === 0) { k = i; break; } }
    }
    if (k > 0) {
      total += 1;
      // 链（跳过可选 `{...}` 块）—— 只找 fontColor
      let i2: number = k + 1;
      while (i2 < src.length && ' \t\r\n'.indexOf(src.charAt(i2)) >= 0) { i2 += 1; }
      if (i2 < src.length && src.charAt(i2) === '{') {
        let dd: number = 0;
        for (let i = i2; i < src.length; i++) {
          if (src.charAt(i) === '{') { dd++; }
          else if (src.charAt(i) === '}') { dd--; if (dd === 0) { i2 = i + 1; break; } }
        }
      }
      let fc: string = '';
      while (i2 < src.length && src.charAt(i2) === '.') {
        const fj: number = src.indexOf('(', i2);
        if (fj < 0) { break; }
        let fd: number = 0; let fk: number = -1;
        for (let i = fj; i < src.length; i++) {
          if (src.charAt(i) === '(') { fd++; }
          else if (src.charAt(i) === ')') { fd--; if (fd === 0) { fk = i; break; } }
        }
        if (fk < 0) { break; }
        if (src.substring(i2 + 1, fj) === 'fontColor') { fc = src.substring(fj + 1, fk).trim(); }
        i2 = fk + 1;
        while (i2 < src.length && ' \t\r\n'.indexOf(src.charAt(i2)) >= 0) { i2 += 1; }
      }
      const p: Pt = new Pt();
      p.rel = rel; p.line = lineOf(src, x.index); p.raw = fc.substring(0, 46);
      // ① colorOf(p, '字面量') ⇒ role（**A 类只看这条**）
      const rm: RegExpExecArray | null = /colorOf\([^,()]+(?:\([^()]*\))?\s*,\s*'([A-Za-z.]+)'\s*\)/.exec(fc);
      if (rm !== null) { p.role = rm[1]; p.kind = 'colorOf-字面量'; }
      // ② pal().field ⇒ 字段访问（ArkTS 类型检查把关，不是 A 类）
      else {
        const fm: RegExpExecArray | null = /(?:this\.pal\(\)|paletteOf\(this\.theme\)|p)\.([A-Za-z]+)/.exec(fc);
        if (fm !== null) { p.role = fm[1]; p.kind = 'pal字段'; }
        else if (/colorOf\([^,()]+(?:\([^()]*\))?\s*,\s*this\./.test(fc)) { p.role = '（动态）'; p.kind = '动态'; }
        else if (fc.length === 0) { p.role = '（继承）'; p.kind = '继承'; }
        else { p.role = '（其它表达式）'; p.kind = '其它'; }
      }
      pts.push(p);
    }
    x = rx.exec(src);
  }
});
console.log(`  SymbolGlyph ${total} 处；逐类：`);
{
  const byKind: Map<string, number> = new Map<string, number>();
  for (let i = 0; i < pts.length; i++) { byKind.set(pts[i].kind, (byKind.get(pts[i].kind) || 0) + 1); }
  byKind.forEach((v: number, kk: string) => { console.log(`     ${pad(kk, 16)} ${v}`); });
}
ok('零扫描判红：扫到文件数 > 0 且 SymbolGlyph 数 > 0', srcByRel.size > 0 && total > 0);

console.log('\n▶ §C A 类（硬）：`colorOf` 的字面量 role 必须落在真源集合内');
class Bad { rel: string = ''; line: number = 0; role: string = ''; }
function aClass(m: Map<string, string>, legal: string[]): Bad[] {
  const out: Bad[] = [];
  m.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /colorOf\([^,()]+(?:\([^()]*\))?\s*,\s*'([A-Za-z.]+)'\s*\)/g;
    let x: RegExpExecArray | null = rx.exec(src);
    while (x !== null) {
      if (legal.indexOf(x[1]) < 0) {
        const b: Bad = new Bad();
        b.rel = rel; b.line = lineOf(src, x.index); b.role = x[1];
        out.push(b);
      }
      x = rx.exec(src);
    }
  });
  return out;
}
const bad: Bad[] = aClass(srcByRel, LEGAL);
for (let i = 0; i < bad.length; i++) { console.log(`  ⚠ ${bad[i].rel}:${bad[i].line}  role='${bad[i].role}'`); }
console.log(`  ⇒ A 类命中 ${bad.length} 处（全仓 colorOf 的 role 用法全是真源集合内的）`);
ok('A 类：colorOf 字面量 role 全合法（命中 ' + bad.length + ' 处 / 图标 ' + total + ' 个）', bad.length === 0);

console.log('\n▶ §D B 类（报告）：图标 role 对**主要宿主底**的对比度（阈值 = AA_NON_TEXT）');
const HOSTS: string[] = ['appBg', 'surface', 'surfaceAlt', 'chip'];
function hostColor(name: string, t: string): string {
  const p = paletteOf(t);
  if (name === 'chip') { return surfaceFillOf(p, 'surface.chip'); }
  if (name === 'appBg') { return p.appBg; }
  if (name === 'surface') { return p.surface; }
  return p.surfaceAlt;
}
const TH: number = AA_NON_TEXT;
console.log(`  阈值 AA_NON_TEXT = ${TH}（出处 design.ets；WCAG §1.4.11 非文本）`);
console.log('  ' + pad('role', 16) + pad('dark/appBg', 12) + pad('dark/chip', 12) + pad('porc/appBg', 12) + pad('porc/chip', 12) + '最低者');
const iconRoles: string[] = [];
for (let i = 0; i < pts.length; i++) {
  if (pts[i].kind === 'colorOf-字面量' || pts[i].kind === 'pal字段') {
    if (iconRoles.indexOf(pts[i].role) < 0) { iconRoles.push(pts[i].role); }
  }
}
let belowList: string[] = [];
for (let i = 0; i < iconRoles.length; i++) {
  const r: string = iconRoles[i];
  const vals: number[] = [];
  const names: string[] = ['dark', 'porcelain'];
  const row: string[] = [];
  for (let h = 0; h < HOSTS.length; h++) {
    // 只算两套主题 × 代表性底（appBg / chip）
    if (HOSTS[h] === 'surface' || HOSTS[h] === 'surfaceAlt') { continue; }
    for (let t = 0; t < names.length; t++) {
      // ⛔ 先按 `colorOf` 的 role 取；若回落成**透明**（`#00000000`）说明该名字**不是 role**
      //    而是**调色板字段**（如 `success`/`textMuted`）⇒ 直接读字段值。
      //    （第一版没做这步 ⇒ `success` 被算成 `transparent` vs appBg = 1.07 的**假象**。）
      let fg: string = '';
      try { fg = colorOf(paletteOf(names[t]), r); } catch (err) { fg = ''; }
      const alpha: number = fg.length >= 9 ? parseInt(fg.substring(1, 3), 16) : 255;
      if (fg.length === 0 || alpha === 0) {
        const pal = paletteOf(names[t]) as unknown as Record<string, string>;
        fg = pal[r] !== undefined ? pal[r] : '';
      }
      if (fg.length === 0 || fg.charAt(0) !== '#') { continue; }
      const c: number = contrastRatio(fg, hostColor(HOSTS[h], names[t]));
      vals.push(c);
      row.push(`${names[t]}/${HOSTS[h]}=${c.toFixed(2)}`);
    }
  }
  const mn: number = vals.length > 0 ? Math.min.apply(null, vals) : -1;
  console.log('  ' + pad(r, 16) + pad(row.join('  ').substring(0, 58), 60) + (mn >= 0 ? mn.toFixed(2) : '?'));
  if (mn >= 0 && mn < TH) { belowList.push(`${r}（最低 ${mn.toFixed(2)} … ${row.join(' ')}）`); }
}
console.log(`  ⇒ 低于 ${TH} 的 role：${belowList.length === 0 ? '无' : ''}`);
for (let i = 0; i < belowList.length; i++) { console.log(`     ⚠ ${belowList[i]}`); }
console.log('  ⛔ **只报告、不判红**：装饰性图标（分隔/点缀）本就该低调；且宿主底需按**实际父容器**推，');
console.log('     本轮只按"主要面"（appBg/chip）估算 ⇒ 真判需真机逐面，故本类不硬红。');

console.log('\n▶ §E mutation 自证（合成源码）');
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  SymbolGlyph(x).fontColor([colorOf(this.pal(), 'text.pillName')])\n}\n");
  const got: Bad[] = aClass(inj, LEGAL);
  console.log(`     [注入 colorOf(p,'text.pillName')] A 类命中 ${got.length} 处：${got.length > 0 ? got[0].role : '-'}`);
  ok("mutation：注入 `colorOf(p,'text.pillName')`（散文记号，不在真源表）⇒ A 类必红", got.length === 1);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  SymbolGlyph(x).fontColor([colorOf(this.pal(), 'iconMuted')])\n}\n");
  ok('反向对照：合法 role iconMuted ⇒ A 类不命中（判据不是"凡 colorOf 必红"）', aClass(inj, LEGAL).length === 0);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  // 注释里提到 colorOf(p,'text.pillName') 不算违规\n  SymbolGlyph(x).fontColor([colorOf(this.pal(), 'textMuted')])\n}\n");
  ok('反向对照：**注释里**提到非法 role 不算违规（判据先剥注释）', aClass(inj, LEGAL).length === 0);
}

console.log('\n▼ 摘要');
console.log(`  SymbolGlyph ${total} 处；colorOf-字面量 ${pts.filter((p) => p.kind === 'colorOf-字面量').length} / pal字段 ${pts.filter((p) => p.kind === 'pal字段').length} / 动态 ${pts.filter((p) => p.kind === '动态').length} / 继承 ${pts.filter((p) => p.kind === '继承').length}`);
console.log(`  A 类（role 名不在真源表）${bad.length} 处；B 类（对比度 < ${TH}）${belowList.length} 个 role`);
console.log(`  合法集合来源：core/design.ets 的 colorOf 实现（现读 ${LEGAL.length} 个 role）`);
if (fail > 0) { console.log(`\n  icon_role_visibility: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  icon_role_visibility: ${pass} passed, 0 failed`);
process.exit(0);

export {};
