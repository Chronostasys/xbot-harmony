/**
 * image_boundary_gate.test.ts —— **图片/多媒体的边界与可读性**审计（离线 · 2026-10-11）。
 *
 * ── 缺陷类 ────────────────────────────────────────────────────────────────────
 * 图片**没有填充色** ⇒ 浅色下"白图压白底"、深色下"深图压深底"会**消失**。
 * 故图片渲染点必须有一个**非图片**的分界手段（填充/发丝/全屏即屏幕边缘）。
 *
 * ── 枚举结果（实测，全仓 `Image(` 仅 **4** 点）────────────────────────────────────
 *  | 点 | 非图片分界手段 | 说明 |
 *  |---|---|---|
 *  | `components/AuthImage.ets:88` `Image(this.pm)` | ✅ `.backgroundColor(surfaceFillOf(p,'surface.chip'))` | **唯一内联图片渲染器**（消息/插件徽标都走它）|
 *  | `components/Lightbox.ets:174` | ——（**全屏** `width/height 100%`） | 全屏看图：**分界就是屏幕边缘**（✅ 正常设计，非缺陷）|
 *  | `pages/Index.ets:6518` `Image(this.imagePixel)` | ——（**全屏**） | 同上 |
 *  | `components/SplashOverlay.ets:164` `start_icon` | —— | **自有品牌资产**（不是任意用户内容）⇒ 见台账 |
 *
 * ── 判定（如实说 + 那个**反直觉但真**的发现）─────────────────────────────────────
 *  · **全屏看图（Lightbox / Index:6518）不需要边界** —— 图片铺满屏幕时"边界"就是屏幕边缘；
 *    ⛔ 硬给白图加描边反而是**错**的（看图体验要的是沉浸，不是相框）。⇒ 记台账，不造需求。
 *  · **内联图片卡（AuthImage）需要边界**，而它唯一的边界就是那层 `surface.chip` 填充。
 *    ⚠️ **反直觉发现**：`AuthImage` 的**失败/兜底**态**有发丝**（`hairlineOf`），而**加载成功**态**没有**
 *    ⇒ **"图片没加载出来"比"图片加载出来了"边界更清楚** —— 顺序颠倒了。这是真缺陷（一致性 + 可读性）。
 *  · 那层 `surface.chip` 的边界强度 = `contrast(sunken, appBg)`（见 §C）：浅色 1.0456/1.0788 ✅、
 *    **aurora 1.0198 / nebula 1.0173 / dark 1.0005 ✗** ⇒ 与 `docs/DESIGN-SYSTEM.md §15` 的
 *    唯一残余缺口「画布→下沉」**同一个根**（图片卡在深色系等于没有边界）。
 *
 * ── ⛔ 自证抓到的扫描器 bug（写下来防复发）──────────────────────────────────────
 * 第一版取属性链时**起始空白只跳了 `' \t'`，漏了换行** ⇒ `Image(...)` 后紧跟换行 ⇒ **链恒为空**
 * ⇒ 4 个点的 `backgroundColor` 全报 `False`（**假结论**：会误判成"全仓图片都没边界"）。
 * 修法：跳过 `' \t\r\n'`。本文件 §A 有一条断言专门守它。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(m: 'path'): { join(...parts: string[]): string; relative(a: string, b: string): string };
declare const __dirname: string;

import { paletteOf, ALL_THEMES, contrastRatio, isLightPalette } from '../../entry/src/main/ets/core/theme';
import { surfaceFillOf, hairlineOf, HAIRLINE_MIN_LIGHT, HAIRLINE_MIN_DARK } from '../../entry/src/main/ets/core/design';

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
function matchPair(s: string, i: number): number {
  let d: number = 0;
  while (i < s.length) {
    if (s.charAt(i) === '(') { d++; }
    else if (s.charAt(i) === ')') { d--; if (d === 0) { return i; } }
    i += 1;
  }
  return -1;
}
/** ⛔ 起始/续行空白必须含 `\r\n` —— 漏了它就"链恒空"（本文件头记的那个 bug）。 */
const WS: string = ' \t\r\n';
function chainAfter(s: string, i: number): string {
  while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  let out: string = '';
  while (i < s.length && s.charAt(i) === '.') {
    const j: number = s.indexOf('(', i);
    if (j < 0) { break; }
    const k: number = matchPair(s, j);
    if (k < 0) { break; }
    out += s.substring(i, k + 1);
    i = k + 1;
    while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  }
  return out;
}
function lineOf(s: string, idx: number): number { let n: number = 1; for (let i = 0; i < idx; i++) { if (s.charAt(i) === '\n') { n++; } } return n; }

class Site { rel: string = ''; line: number = 0; arg: string = ''; boundary: boolean = false; fullScreen: boolean = false; }
const srcByRel: Map<string, string> = new Map<string, string>();
for (const d of ['components', 'pages']) {
  const base: string = pathMod.join(etsRoot, d);
  const walk = (dir: string): void => {
    const ents: string[] = fsMod.readdirSync(dir);
    for (let i = 0; i < ents.length; i++) {
      const p: string = pathMod.join(dir, ents[i]);
      if (fsMod.statSync(p).isDirectory()) { walk(p); } else if (ents[i].endsWith('.ets')) { srcByRel.set(pathMod.relative(etsRoot, p), fsMod.readFileSync(p, 'utf-8')); }
    }
  };
  walk(base);
}
function scanImages(m: Map<string, string>): Site[] {
  const out: Site[] = [];
  m.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\bImage\s*\(/g;
    let x: RegExpExecArray | null = rx.exec(src);
    while (x !== null) {
      const j: number = src.indexOf('(', x.index);
      const k: number = matchPair(src, j);
      if (k > 0) {
        const ch: string = chainAfter(src, k + 1);
        const s: Site = new Site();
        s.rel = rel; s.line = lineOf(src, x.index); s.arg = src.substring(j + 1, k).trim();
        s.boundary = ch.indexOf('.backgroundColor(') >= 0 || ch.indexOf('.border(') >= 0;
        s.fullScreen = ch.indexOf("width('100%')") >= 0 && ch.indexOf("height('100%')") >= 0;
        out.push(s);
      }
      x = rx.exec(src);
    }
  });
  return out;
}

console.log('\n▶ §A 枚举与扫描器自证（全仓 `Image(` 点）');
const sites: Site[] = scanImages(srcByRel);
console.log(`  扫 ${srcByRel.size} 文件；Image 点 ${sites.length}`);
for (let i = 0; i < sites.length; i++) {
  const s = sites[i];
  console.log(`  ${pad(s.rel, 32)}:${pad(String(s.line), 5)} arg=${pad(s.arg, 22)} 非图片分界=${s.boundary ? '有' : '无'} ${s.fullScreen ? '（全屏）' : ''}`);
}
ok('零扫描判红：扫到文件数 > 0', srcByRel.size > 0);
ok('扫描器有效性：Image 点 > 0', sites.length > 0);
ok('⛔ 守"链抓取"那个 bug：至少有一个点被判为**有** backgroundColor（链非空才可能）',
  sites.some((s) => s.boundary));

console.log('\n▶ §B 结构判据（硬）：**内联**图片必须有非图片分界手段');
/** 台账（⛔ 只许缩短；每条给理由）。 */
const KNOWN_OK: string[] = [
  // 自有品牌资产（`start_icon`）：它的"最坏图"就是我们自己的设计稿，不是任意用户内容；
  // 且它画在开屏的品牌底上 ⇒ **不需要**图片卡那种边界。⛔ 不是"漏做"。
  'components/SplashOverlay.ets :: start_icon',
  // 同上（会话加载开屏 `SessionLoadingSplash`）：同一枚自有品牌 mark，画在**品牌底/主题底**
  // 之上（`LoadingProgress` + 两行说明文字居中），不是"内容图卡" ⇒ 一律加 `backgroundColor`
  // 反而在深色品牌底上画出一块方框。⛔ 与 SplashOverlay 同一条理由，不是新豁免类别。
  'components/SessionLoadingSplash.ets :: start_icon',
];
let inlineNoBoundary: string[] = [];
for (let i = 0; i < sites.length; i++) {
  const s = sites[i];
  if (s.fullScreen) { continue; }                      // 全屏：分界 = 屏幕边缘（正常设计）
  if (s.boundary) { continue; }                        // 已有分界手段
  const key: string = `${s.rel} :: ${s.arg.indexOf('start_icon') >= 0 ? 'start_icon' : s.arg}`;
  if (KNOWN_OK.indexOf(key) < 0) { inlineNoBoundary.push(`${s.rel}:${s.line} :: ${s.arg}`); }
}
for (let i = 0; i < inlineNoBoundary.length; i++) { console.log(`  ⚠ ${inlineNoBoundary[i]}`); }
ok(`B：内联图片都有非图片分界（未登记 ${inlineNoBoundary.length} 条；全屏 ${sites.filter((s) => s.fullScreen).length} 个免判）`,
  inlineNoBoundary.length === 0);

console.log('\n▶ §C 最坏图数字 + "图片卡唯一边界"的强度');
console.log('  ' + pad('主题', 12) + pad('chip vs 画布', 14) + pad('纯白图 vs chip', 16) + pad('纯黑图 vs chip', 16) + '发丝 vs chip');
for (let i = 0; i < ALL_THEMES.length; i++) {
  const p = paletteOf(ALL_THEMES[i]);
  const chip: string = surfaceFillOf(p, 'surface.chip');
  console.log('  ' + pad(ALL_THEMES[i], 12)
    + pad(contrastRatio(chip, p.appBg).toFixed(4), 14)
    + pad(contrastRatio('#FFFFFF', chip).toFixed(4), 16)
    + pad(contrastRatio('#000000', chip).toFixed(4), 16)
    + contrastRatio(hairlineOf(p), chip).toFixed(4));
}
const weak: string[] = [];
for (let i = 0; i < ALL_THEMES.length; i++) {
  const p = paletteOf(ALL_THEMES[i]);
  if (contrastRatio(surfaceFillOf(p, 'surface.chip'), p.appBg) < 1.03) { weak.push(ALL_THEMES[i]); }
}
console.log(`  ⇒ "图片卡唯一边界"（chip vs 画布）不达 1.03 的主题：${weak.join(', ')}`);
console.log('  ⚠️ 与 `DESIGN-SYSTEM.md §15` 的唯一残余缺口「画布→下沉」**同一个根**（图片卡在深色系等于没边界）。');

console.log('\n▶ §D mutation 自证（合成源码）');
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Image(x)\n    .width('100%')\n}\n");
  const got: Site[] = scanImages(inj);
  ok('mutation：内联 Image 去掉 backgroundColor/border ⇒ B 必红',
    got.length === 1 && !got[0].boundary && !got[0].fullScreen);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Image(x)\n    .width('100%')\n    .height('100%')\n}\n");
  const got: Site[] = scanImages(inj);
  ok('mutation：全屏 Image ⇒ 判为 fullScreen（免判边界，符合"全屏即屏幕边缘"）',
    got.length === 1 && got[0].fullScreen);
}
{
  // ⛔ mutation：把"跳过空白"退回只跳 `' \\t'`（复现本文件头记的那个 bug）⇒ 链会恒空 ⇒ 判据失效
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Image(x)\n    .backgroundColor(c)\n}\n");
  const src: string = stripComments(inj.get('components/Fake.ets') as string);
  const j: number = src.indexOf('(');
  const k: number = matchPair(src, j);
  let i: number = k + 1;
  while (i < src.length && ' \t'.indexOf(src.charAt(i)) >= 0) { i += 1; }   // 退化成只跳空格/制表
  const broken: boolean = src.charAt(i) !== '.';
  ok('mutation：退化"只跳空格/制表"（漏换行）⇒ 链起点不是 `.` ⇒ 证明那条 bug 会真的让链为空',
    broken);
}

console.log('\n▼ 摘要');
console.log(`  Image 点 ${sites.length}（内联 ${sites.filter((s) => !s.fullScreen).length} / 全屏 ${sites.filter((s) => s.fullScreen).length}）；B 未登记 ${inlineNoBoundary.length}`);
console.log(`  图片卡唯一边界（chip vs 画布）弱主题：${weak.join(', ') || '无'}`);
if (fail > 0) { console.log(`\n  image_boundary_gate: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  image_boundary_gate: ${pass} passed, 0 failed`);
process.exit(0);

export {};
