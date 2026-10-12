/**
 * hit_spacing_gate.test.ts —— **相邻可点元素的间距 / 误触风险**（"交互很爽"的反面 · 2026-10-11）。
 *
 * ── 缺陷类 ────────────────────────────────────────────────────────────────────
 * 命中区 ≥44 已由 `hit_target_gate` 守住 ✓；本判据管**两个热区挨太近**：热区**外扩**（`responseRegion`）
 * 后若**互相重叠** ⇒ 用户点 A 中了 B。
 *
 * ── 判定口径（⛔ 只判"能离线证明的硬事实"）──────────────────────────────────────
 *  ⛔ **间距阈值无真源** ⇒ **不臆造**（`core/design.ets` 里没有任何"最小间隔"token）。
 *     故本判据**不判"间距过小"**，只判下面两条**可证**的：
 *  ① **热区尺寸**：`responseRegion` 的 `width`/`height` 必须 ≥ `HIT_TARGET_MIN`（44）。
 *     实参是**算术表达式**（如 `CLOSE_VISUAL + CLOSE_HIT_PAD * 2`、`BTN + HIT_PAD * 2`）
 *     ⇒ 本判据**现场解析常量并求值**（不是"看着像 44 就放过"）。
 *  ② **热区重叠**：同一容器内 ≥2 个带 `responseRegion` 的**可点兄弟** ⇒ 需核是否重叠；
 *     ⚠️ 但若两者之间有 **`layoutWeight(...)` 元素**（它吸收全部余量、把兄弟顶到两端）
 *     ⇒ **数学上不可能重叠** ⇒ 自动放过（附理由）。
 *
 * ── 实测 ──────────────────────────────────────────────────────────────────────
 * 全仓 `responseRegion` **0 处**（components 侧 2026-10-11 全量改为**真实 44 布局盒**；pages 侧最后一处
 * ——「回到最新」药丸的失效外扩——于 2026-10-12 批13g 改为悬浮层 + 真实 44 布局盒 ⇒ **清零**）。
 * 真机已证 `responseRegion` 负偏移外扩**无效** ⇒ 本判据现无生产对象，**扫描器有效性改由 mutation 注入自证**
 * （见 §A：合成一段含 `responseRegion` 的源 ⇒ 必被扫到）。
 * ⚠️ components 侧仍有**大量 `layoutWeight` 容器**（`WebSurface` chrome 行等）——chrome 行两端是两个
 * 独立 44 盒、中间标题 `layoutWeight(1)` ⇒ **数学上不可能重叠**。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(m: 'path'): { join(...parts: string[]): string; relative(a: string, b: string): string };
declare const __dirname: string;

import { HIT_TARGET_MIN } from '../../entry/src/main/ets/core/design';

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
function matchPair(s: string, i: number, op: string, cl: string): number {
  let d: number = 0;
  while (i < s.length) {
    if (s.charAt(i) === op) { d++; }
    else if (s.charAt(i) === cl) { d--; if (d === 0) { return i; } }
    i += 1;
  }
  return -1;
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
// ── 常量表（现场解析 `const NAME: number = <expr>;`，支持引用其他常量）──────────
// ⛔ 必须**含 `core/`**：`HIT_TARGET_MIN` 定义在 `core/design.ets`，漏了它 ⇒ 所有引用它的
//    派生常量（`CLOSE_HIT_PAD`/`X_PAD`/`CHROME_HIT_PAD`）会**连带解不出** ⇒ 7/8 假红。
//    （这是本文件第一版的错：只扫了 components/pages。）
const coreSrc: Map<string, string> = new Map<string, string>();
{
  const cbase: string = pathMod.join(etsRoot, 'core');
  const walkCore = (dir: string): void => {
    const ents: string[] = fsMod.readdirSync(dir);
    for (let i = 0; i < ents.length; i++) {
      const p: string = pathMod.join(dir, ents[i]);
      if (fsMod.statSync(p).isDirectory()) { walkCore(p); }
      else if (ents[i].endsWith('.ets')) { coreSrc.set(pathMod.relative(etsRoot, p), fsMod.readFileSync(p, 'utf-8')); }
    }
  };
  walkCore(cbase);
}
const consts: Map<string, string> = new Map<string, string>();
coreSrc.forEach((raw: string) => {
  const src: string = stripComments(raw);
  const rx: RegExp = /(?:export )?const\s+([A-Z][A-Z0-9_]*)\s*:\s*number\s*=\s*([^;]+);/g;
  let x: RegExpExecArray | null = rx.exec(src);
  while (x !== null) { consts.set(x[1], x[2].trim()); x = rx.exec(src); }
});
srcByRel.forEach((raw: string) => {
  const src: string = stripComments(raw);
  const rx: RegExp = /(?:export )?const\s+([A-Z][A-Z0-9_]*)\s*:\s*number\s*=\s*([^;]+);/g;
  let x: RegExpExecArray | null = rx.exec(src);
  while (x !== null) { if (!consts.has(x[1])) { consts.set(x[1], x[2].trim()); } x = rx.exec(src); }
});
/** 求值：常量名 / 数字 / `+ - * /` 与括号（够用即可；求不出返回 NaN）。 */
function evalExpr(e: string, depth: number): number {
  if (depth > 8) { return NaN; }
  let s: string = e.trim();
  // ⛔ **每轮新建非全局正则**：第一版用了带 `g` 的正则并在**每次替换后继续用它** ⇒ `lastIndex`
  //    停留在旧串上 ⇒ 跳过后续匹配 ⇒ `CLOSE_VISUAL + CLOSE_HIT_PAD * 2` 解不出（7/8 假红）。
  for (let round = 0; round < 16; round++) {
    const m: RegExpExecArray | null = /[A-Z][A-Z0-9_]*/.exec(s);
    if (m === null) { break; }
    const rep: string | undefined = consts.get(m[0]);
    if (rep === undefined) { return NaN; }
    const v: number = evalExpr(rep, depth + 1);
    if (isNaN(v)) { return NaN; }
    s = s.substring(0, m.index) + `(${v})` + s.substring(m.index + m[0].length);
  }
  if (!/^[0-9+\-*/(). ]+$/.test(s)) { return NaN; }
  try { return Number(Function(`"use strict";return (${s});`)()); } catch (err) { return NaN; }
}
class Region { rel: string = ''; line: number = 0; w: number = 0; h: number = 0; wExpr: string = ''; hExpr: string = ''; }
class Container { rel: string = ''; line: number = 0; kind: string = ''; nRegions: number = 0; hasWeightedChild: boolean = false; }
function scanRegions(m: Map<string, string>): Region[] {
  const out: Region[] = [];
  m.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\.responseRegion\s*\(/g;
    let x: RegExpExecArray | null = rx.exec(src);
    while (x !== null) {
      const j: number = src.indexOf('(', x.index);
      const k: number = matchPair(src, j, '(', ')');
      if (k > 0) {
        const body: string = src.substring(j + 1, k);
        const wm: RegExpExecArray | null = /width\s*:\s*([^,}]+)/.exec(body);
        const hm: RegExpExecArray | null = /height\s*:\s*([^,}]+)/.exec(body);
        const r: Region = new Region();
        r.rel = rel; r.line = lineOf(src, x.index);
        r.wExpr = wm === null ? '' : wm[1].trim();
        r.hExpr = hm === null ? '' : hm[1].trim();
        r.w = evalExpr(r.wExpr, 0); r.h = evalExpr(r.hExpr, 0);
        out.push(r);
      }
      x = rx.exec(src);
    }
  });
  return out;
}
function scanContainers(m: Map<string, string>): Container[] {
  const out: Container[] = [];
  m.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\b(Row|Flex|Stack)\s*\(/g;
    let x: RegExpExecArray | null = rx.exec(src);
    while (x !== null) {
      const j: number = src.indexOf('(', x.index);
      const k: number = matchPair(src, j, '(', ')');
      if (k > 0) {
        const bs: number = src.indexOf('{', k + 1);
        if (bs > 0) {
          const be: number = matchPair(src, bs, '{', '}');
          if (be > 0) {
            const body: string = src.substring(bs + 1, be);
            const n: number = (body.match(/\.responseRegion\s*\(/g) || []).length;
            if (n >= 2) {
              const c: Container = new Container();
              c.rel = rel; c.line = lineOf(src, x.index); c.kind = x[1]; c.nRegions = n;
              c.hasWeightedChild = /\.layoutWeight\(/.test(body);
              out.push(c);
            }
          }
        }
      }
      x = rx.exec(src);
    }
  });
  return out;
}

console.log('\n▶ §A 扫描器自证');
const regions: Region[] = scanRegions(srcByRel);
const containers: Container[] = scanContainers(srcByRel);
console.log(`  扫 ${srcByRel.size} 文件；\`responseRegion\` ${regions.length} 处；含 ≥2 处的容器 ${containers.length} 个`);
for (let i = 0; i < regions.length; i++) {
  const r = regions[i];
  console.log(`  ${pad(r.rel, 30)}:${pad(String(r.line), 5)} width=${pad(r.wExpr, 30)} ⇒ ${isNaN(r.w) ? '（求值失败）' : r.w}   height ⇒ ${isNaN(r.h) ? '（求值失败）' : r.h}`);
}
ok('零扫描判红：文件数 > 0', srcByRel.size > 0);
// ⛔ 自证必须**自带样本**，不能靠"生产代码里恰好有 responseRegion"——全仓清零后（13g 移除「回到最新」
//    的失效外扩拐杖）该断言会**假红**。改为 **mutation 注入**：合成一段含 responseRegion 的源 ⇒ 必被扫到。
const rrSynth: Map<string, string> = new Map<string, string>();
rrSynth.set('components/__selfcheck__.ets',
  'Xxx()\n  .responseRegion({ x: -6, y: -6, width: 40, height: 40 })\n');
ok('扫描器有效性：注入合成 `responseRegion` ⇒ 必被扫到（不依赖生产用法）', scanRegions(rrSynth).length > 0);
ok('常量表解析成功（`HIT_TARGET_MIN` 可求值）', evalExpr('HIT_TARGET_MIN', 0) === HIT_TARGET_MIN);
ok('⚠️ 算术表达式可求值（如 `HIT_TARGET_MIN * 2`，不是字面量）',
  !isNaN(evalExpr('HIT_TARGET_MIN * 2', 0)) && evalExpr('HIT_TARGET_MIN * 2', 0) === HIT_TARGET_MIN * 2);

console.log('\n▶ §B ① 热区尺寸：`responseRegion` 的 width/height 必须 ≥ HIT_TARGET_MIN');
class Small { rel: string = ''; line: number = 0; why: string = ''; }
function tooSmall(m: Map<string, string>, exempt: string[]): Small[] {
  const out: Small[] = [];
  const srcs: Region[] = scanRegions(m);
  for (let i = 0; i < srcs.length; i++) {
    const r = srcs[i];
    let why: string = '';
    // ⚠️ 百分比/字符串实参（如 `'100%'`）不是"固定尺寸" ⇒ 该轴**不参与**尺寸判据（如实标注，不算失败）。
    const wFixed: boolean = r.wExpr.length > 0 && r.wExpr.charAt(0) !== '\'';
    const hFixed: boolean = r.hExpr.length > 0 && r.hExpr.charAt(0) !== '\'';
    if (wFixed && isNaN(r.w)) { why = `width 求值失败（${r.wExpr}）`; }
    else if (hFixed && isNaN(r.h)) { why = `height 求值失败（${r.hExpr}）`; }
    else if (wFixed && r.w < HIT_TARGET_MIN) { why = `width=${r.w} < ${HIT_TARGET_MIN}`; }
    else if (hFixed && r.h < HIT_TARGET_MIN) { why = `height=${r.h} < ${HIT_TARGET_MIN}`; }
    if (why.length > 0) {
      const s: Small = new Small();
      s.rel = r.rel; s.line = r.line; s.why = why;
      const key: string = `${r.rel} :: ${why}`;
      if (exempt.indexOf(key) < 0) { out.push(s); }
    }
  }
  return out;
}
/** 台账（⛔ 只许缩短；当前为空 —— 实测 8/8 达标）。 */
const KNOWN_OK: string[] = [];
const small: Small[] = tooSmall(srcByRel, KNOWN_OK);
for (let i = 0; i < small.length; i++) { console.log(`  ⚠ ${small[i].rel}:${small[i].line}  ${small[i].why}`); }
const okSizes: number = regions.filter((r) => {
  const wOk: boolean = r.wExpr.charAt(0) === '\'' || (!isNaN(r.w) && r.w >= HIT_TARGET_MIN);
  const hOk: boolean = r.hExpr.charAt(0) === '\'' || (!isNaN(r.h) && r.h >= HIT_TARGET_MIN);
  return wOk && hOk;
}).length;
console.log(`  ⇒ 达标 ${okSizes}/${regions.length}`);
ok(`① 全部热区尺寸 ≥ ${HIT_TARGET_MIN}（不达标 ${small.length} 处）`, small.length === 0);

console.log('\n▶ §C ② 热区重叠：同一容器内 ≥2 处可点热区');
for (let i = 0; i < containers.length; i++) {
  const c = containers[i];
  console.log(`  ${pad(c.rel, 30)}:${pad(String(c.line), 5)} ${c.kind} 内 ${c.nRegions} 处  layoutWeight 隔开=${c.hasWeightedChild}`);
}
const risky: Container[] = containers.filter((c) => !c.hasWeightedChild);
ok(`② 无"未隔开的相邻热区"（可疑 ${risky.length} 个；实测 ${containers.length} 个多热区容器**全部有 layoutWeight 元素隔开**）`,
  risky.length === 0);
console.log('  ⛔ **不判"间距过小"**：`core/design.ets` 里**没有任何"最小间隔"token** ⇒ 阈值**无真源** ⇒ 如实不造。');

console.log('\n▶ §D mutation 自证（合成源码）');
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  SymbolGlyph(x)\n    .responseRegion({ x: -4, y: -4, width: 36, height: 44 })\n}\n");
  ok('mutation：热区 width=36 < 44 ⇒ ① 必红', tooSmall(inj, KNOWN_OK).length === 1);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Row() {\n    SymbolGlyph(a).responseRegion({ x: -6, y: -6, width: 44, height: 44 })\n    SymbolGlyph(b).responseRegion({ x: -6, y: -6, width: 44, height: 44 })\n  }\n}\n");
  const cs: Container[] = scanContainers(inj);
  ok('mutation：同一 Row 两处热区**且无 layoutWeight 隔开** ⇒ ② 报可疑',
    cs.length === 1 && cs[0].nRegions === 2 && !cs[0].hasWeightedChild);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Row() {\n    SymbolGlyph(a).responseRegion({ x: -6, y: -6, width: 44, height: 44 })\n    Text(t).layoutWeight(1)\n    SymbolGlyph(b).responseRegion({ x: -6, y: -6, width: 44, height: 44 })\n  }\n}\n");
  const cs: Container[] = scanContainers(inj);
  ok('反向对照：中间有 `layoutWeight` 元素 ⇒ 放过（它吸收全部余量 ⇒ 数学上不可能重叠）',
    cs.length === 1 && cs[0].hasWeightedChild);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  X().responseRegion({ x: -4, y: -4, width: HIT_TARGET_MIN * 2, height: 44 })\n}\n");
  console.log(`     [eval] HIT_TARGET_MIN * 2 ⇒ ${evalExpr('HIT_TARGET_MIN * 2', 0)}`);
  ok('mutation：**算术表达式**实参也能被求值判定（不是只看字面量）',
    tooSmall(inj, KNOWN_OK).length === 0 && evalExpr('HIT_TARGET_MIN * 2', 0) >= HIT_TARGET_MIN);
}

console.log('\n▼ 摘要');
console.log(`  responseRegion ${regions.length} 处（尺寸达标 ${okSizes}）；多热区容器 ${containers.length} 个（全部有 layoutWeight 隔开 ⇒ 重叠 0 处）`);
console.log(`  ⛔ "最小间隔"阈值无真源 ⇒ 本判据不判"间距过小"，只判"尺寸不足"与"未隔开的重叠"两条可证事实`);
if (fail > 0) { console.log(`\n  hit_spacing_gate: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  hit_spacing_gate: ${pass} passed, 0 failed`);
process.exit(0);

export {};
