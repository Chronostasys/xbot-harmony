/**
 * font_scale_robustness_gate.test.ts —— **极端字号 + 长文案下的布局健壮性**（离线那半 · 2026-10-11）。
 *
 * ── 前提（先证，别假设）────────────────────────────────────────────────────────
 *  · `KEY_FONT_SCALE` 档 = `[0.9, 1, 1.15, 1.3]`（`core/settings.ets:182`）⇒ 最大 1.3（放大 30%）。
 *  · ⚠️ **关键发现**：`fontScale` **只作用于 `MarkdownView.sz()` 一处**
 *    （`MarkdownView.ets:349  return n * this.fontScale;`），经 MessageRow/LiveTailView 传参；
 *    设置/抽屉/sheet 走 `fs()`（**不带缩放**）⇒ **审计面 = 消息渲染那 3 个文件，不是全仓**。
 *    ⛔ 这个前提本身很脆弱（有人加第二处缩放出口 ⇒ 审计面**静默失效**）⇒ 下面有专门断言守住它。
 *
 * ── 可行性判定（如实说）───────────────────────────────────────────────────────
 * **离线的"宽度估算"不可信**：本仓**没有任何字体度量**（字宽系数/系统字体 metrics 都没有），
 * 任何 `字符数 × 系数` 的估算都是**臆造**，只会产出假绿/假红。
 * ⇒ 离线只做**结构性判据**（下面 §B 的不变量）；**定量结论必须真机 1.3 档逐面截图**（§D 给协议）。
 *
 * ── 判据（结构性，可离线）──────────────────────────────────────────────────────
 *  ① 缩放**只有一个乘子出口**（`* this.fontScale` 全仓恰 1 处）—— 否则审计面漂移；
 *  ② 缩放面内：含 `sz(` 的**多 Text Row** 必须有 `layoutWeight`/`flexShrink`（放大后要能收缩）；
 *  ③ 缩放面内：`sz(` **不得**落在带**固定数值宽**的容器里。
 *  例外台账 `KNOWN_OK` **只许缩短**。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(m: 'path'): { join(...parts: string[]): string; relative(a: string, b: string): string };
declare const __dirname: string;

import { fontScalePresets, fontScaleFrom } from '../../entry/src/main/ets/core/settings';

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

// ── 收集全部 .ets ─────────────────────────────────────────────────────────────
const all: string[] = [];
for (const d of ['components', 'pages']) {
  const base: string = pathMod.join(etsRoot, d);
  const walk = (dir: string): void => {
    const ents: string[] = fsMod.readdirSync(dir);
    for (let i = 0; i < ents.length; i++) {
      const p: string = pathMod.join(dir, ents[i]);
      if (fsMod.statSync(p).isDirectory()) { walk(p); } else if (ents[i].endsWith('.ets')) { all.push(p); }
    }
  };
  walk(base);
}
const srcByRel: Map<string, string> = new Map<string, string>();
for (let i = 0; i < all.length; i++) {
  srcByRel.set(pathMod.relative(etsRoot, all[i]), fsMod.readFileSync(all[i], 'utf-8'));
}

console.log('\n▶ §A 前提与扫描器自证');
const presets: number[] = fontScalePresets();
const maxScale: number = Math.max.apply(null, presets);
console.log(`  KEY_FONT_SCALE 档 = [${presets.join(', ')}]；最大 ${maxScale}（放大 ${Math.round((maxScale - 1) * 100)}%）`);
console.log(`  fontScaleFrom 实测：'1.3' → ${fontScaleFrom('1.3')}；空 → ${fontScaleFrom(undefined)}`);
// 缩放**作用面**：凡出现 `fontScale` 的 .ets（**自动**跟随，不写死文件名）
const surface: string[] = [];
srcByRel.forEach((raw: string, rel: string) => { if (stripComments(raw).indexOf('fontScale') >= 0) { surface.push(rel); } });
surface.sort();
console.log(`  缩放作用面（含 fontScale 的文件，共 ${surface.length}）：${surface.join(' · ')}`);
ok('零扫描判红：扫到文件数 > 0', all.length > 0);
ok(`前提成立：最大档 = 1.3（实得 ${maxScale}）`, maxScale === 1.3);
ok(`缩放作用面非空（${surface.length} 个文件）`, surface.length > 0);

console.log('\n▶ §B 结构性不变量（离线可判的那部分）');
// ① 缩放乘子**只有一个出口**
let mulSites: string[] = [];
srcByRel.forEach((raw: string, rel: string) => {
  const src: string = stripComments(raw);
  const rx: RegExp = /\*\s*this\.fontScale\b/g;
  let m: RegExpExecArray | null = rx.exec(src);
  while (m !== null) { mulSites.push(`${rel}:${lineOf(src, m.index)}`); m = rx.exec(src); }
});
console.log(`  「* this.fontScale」出现点（${mulSites.length}）：${mulSites.join(' · ')}`);
ok('① 缩放**只有一个乘子出口**（多一处 ⇒ 审计面静默漂移，本判据会漏）', mulSites.length === 1);

// ② 缩放面内：含 sz( 的多-Text Row 必须能收缩；③ sz( 不落在固定数值宽容器里
class Risk { rel: string = ''; line: number = 0; why: string = ''; }
const risks: Risk[] = [];
for (let i = 0; i < surface.length; i++) {
  const rel: string = surface[i];
  const src: string = stripComments(srcByRel.get(rel) as string);
  // ② 多-Text Row（顶层）
  const rxRow: RegExp = /\b(Row|Flex)\s*\(/g;
  let m: RegExpExecArray | null = rxRow.exec(src);
  while (m !== null) {
    const j: number = src.indexOf('(', m.index);
    const k: number = matchPair(src, j, '(', ')');
    if (k > 0) {
      const bstart: number = src.indexOf('{', k + 1);
      if (bstart > 0) {
        const bend: number = matchPair(src, bstart, '{', '}');
        if (bend > 0) {
          const body: string = src.substring(bstart + 1, bend);
          const nText: number = (body.match(/\bText\s*\(/g) || []).length;
          if (nText >= 2 && body.indexOf('sz(') >= 0
              && body.indexOf('.layoutWeight(') < 0 && body.indexOf('.flexShrink(') < 0) {
            const r: Risk = new Risk();
            r.rel = rel; r.line = lineOf(src, m.index);
            r.why = `多 Text(${nText}) 且含 sz( 但无 layoutWeight/flexShrink`;
            risks.push(r);
          }
        }
      }
    }
    m = rxRow.exec(src);
  }
  // ③ sz( 落在固定数值宽容器（粗判：sz( 之前 400 字符内最近的 .width(<数字>)）
  const rxSz: RegExp = /\bsz\(/g;
  let z: RegExpExecArray | null = rxSz.exec(src);
  while (z !== null) {
    const seg: string = src.substring(Math.max(0, z.index - 400), z.index);
    const wm: RegExpMatchArray | null = seg.match(/\.width\(\s*(\d+)\s*\)/g);
    if (wm !== null && wm.length > 0) {
      const r: Risk = new Risk();
      r.rel = rel; r.line = lineOf(src, z.index);
      r.why = `sz( 附近有固定数值宽 ${wm[wm.length - 1]}`;
      risks.push(r);
    }
    z = rxSz.exec(src);
  }
}
/** 例外台账（⛔ 只许缩短；当前为空 —— 实测确实 0 命中）。 */
const KNOWN_OK: string[] = [];
const measured: string[] = risks.map((r) => `${r.rel}:${r.line} :: ${r.why}`);
for (let i = 0; i < risks.length; i++) { console.log(`  ⚠ ${risks[i].rel}:${risks[i].line}  ${risks[i].why}`); }
let unexpected: string[] = [];
for (let i = 0; i < measured.length; i++) { if (KNOWN_OK.indexOf(measured[i]) < 0) { unexpected.push(measured[i]); } }
ok(`②③ 缩放面内无"未登记的挤压/固定宽"命中（命中 ${measured.length} / 台账 ${KNOWN_OK.length}）⇒ ${
  measured.length === 0 ? '实测本来就很干净（否定结论）' : '见上列'}`, unexpected.length === 0);

console.log('\n▶ §C mutation 自证');
/** 判据本体（纯函数）：给源码表 ⇒ 返回"未登记的挤压风险"。 */
function squeezeRisks(m: Map<string, string>, surfaceList: string[], exempt: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < surfaceList.length; i++) {
    const rel: string = surfaceList[i];
    const raw: string | undefined = m.get(rel);
    if (raw === undefined) { continue; }
    const src: string = stripComments(raw);
    const rxRow: RegExp = /\b(Row|Flex)\s*\(/g;
    let mm: RegExpExecArray | null = rxRow.exec(src);
    while (mm !== null) {
      const j: number = src.indexOf('(', mm.index);
      const k: number = matchPair(src, j, '(', ')');
      if (k > 0) {
        const bstart: number = src.indexOf('{', k + 1);
        if (bstart > 0) {
          const bend: number = matchPair(src, bstart, '{', '}');
          if (bend > 0) {
            const body: string = src.substring(bstart + 1, bend);
            const nText: number = (body.match(/\bText\s*\(/g) || []).length;
            if (nText >= 2 && body.indexOf('sz(') >= 0
                && body.indexOf('.layoutWeight(') < 0 && body.indexOf('.flexShrink(') < 0) {
              const key: string = `${rel}:${lineOf(src, mm.index)} :: 多 Text 且 sz( 无收缩`;
              if (exempt.indexOf(key) < 0) { out.push(key); }
            }
          }
        }
      }
      mm = rxRow.exec(src);
    }
  }
  return out;
}
ok('真实源码判绿（防"判据恒红"）', squeezeRisks(srcByRel, surface, KNOWN_OK).length === 0);
{
  // mutation ①：把一个 Row 注入成"含 sz( 且无收缩" ⇒ 必红
  const inj: Map<string, string> = new Map<string, string>();
  srcByRel.forEach((v: string, k: string) => inj.set(k, v));
  const t: string = 'components/MessageRow.ets';
  const s0: string = inj.get(t) as string;
  inj.set(t, s0.replace('        Row({ space: 6 }) {', '        Row({ space: 6 }) {\n          Text(String(this.sz(11)))') );
  // 该 Row 仍需含 sz(；把 sz( 注入 body 内
  const t2: string = 'components/MarkdownView.ets';
  const s2: string = inj.get(t2) as string;
  inj.set(t2, s2.replace(/Row\((\{[^}]*\})?\)\s*\{/, (mm: string) => mm + '\n          Text(String(this.sz(12)))\n          Text(String(this.sz(12)))'));
  ok('mutation：往多-Text Row 注入 sz( 且不给收缩 ⇒ 必红', squeezeRisks(inj, surface, KNOWN_OK).length > 0);
}
{
  // mutation ②：**审计面漂移** —— 假设有人加第二个缩放乘子出口（本判据只看"含 fontScale 的文件"，
  //            新出口若也在这些文件里则会被覆盖；此处验证"乘子出口数 > 1"这条断言能抓到）
  const inj: Map<string, string> = new Map<string, string>();
  srcByRel.forEach((v: string, k: string) => inj.set(k, v));
  const t: string = 'components/MessageRow.ets';
  inj.set(t, (inj.get(t) as string) + '\n// second scaling site\nfunction sneaky(n: number, f: number): number { return n * this.fontScale; }\n');
  let cnt: number = 0;
  inj.forEach((raw: string) => {
    const s: string = stripComments(raw);
    const rx: RegExp = /\*\s*this\.fontScale\b/g;
    let q: RegExpExecArray | null = rx.exec(s);
    while (q !== null) { cnt++; q = rx.exec(s); }
  });
  ok('mutation：注入**第二个缩放乘子出口** ⇒ "出口唯一"断言必红（防审计面静默漂移）', cnt > 1);
}

console.log('\n▶ §D 可行性判定（如实说）+ 真机协议');
console.log('  ⛔ **离线的宽度估算不可信**：本仓**没有任何字体度量**（字宽系数 / 系统字体 metrics 都没有）');
console.log('     ⇒ `字符数 × 系数` 是**臆造**，只会产假绿/假红。故离线只做上面的结构性判据。');
console.log('  ⇒ **定量结论必须真机**：`KEY_FONT_SCALE=1.3` 下逐面截图（协议见 docs/UI-AUDIT-CHECKLIST.md）。');

console.log('\n▼ 摘要');
console.log(`  缩放档最大 ${maxScale}；作用面 ${surface.length} 文件；乘子出口 ${mulSites.length} 处`);
console.log(`  结构性命中 ${measured.length}（台账 ${KNOWN_OK.length}）⇒ 当前**干净**（否定结论，非"没扫"）`);
if (fail > 0) { console.log(`\n  font_scale_robustness_gate: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  font_scale_robustness_gate: ${pass} passed, 0 failed`);
process.exit(0);

export {};
