/**
 * boundary_threshold_gate.test.ts —— **边界/临界值**审计（阈值漂移 / 无上界 / 矛盾边界 · 2026-10-11）。
 *
 * ── 三类缺陷（逐类给可离线判据）─────────────────────────────────────────────────
 *  ① **阈值漂移**：`design.ets` 里已定义的**语义阈值常量**，在别处又写一遍同值字面量
 *     ⇒ 改一处漏一处。只对**语义明确**的常量判（值 + 轴的匹配见 `CURATED`），
 *     ⛔ 不做"凡同值即漂移"的宽判（那会把 `SP_8=32` 与"图标 32"这种**同值不同义**全打成假红）。
 *  ② **无上界**：重试/退避/增长必须有上界。真源 = `core/sse.ets`（`retry` 夹在 6、`delay` 夹在 15000）。
 *  ③ **矛盾边界**：同一个 `constraintSize({...})` 里 `min* > max*` ⇒ 该约束**永不可满足**。
 *
 * ── 阈值来源（⛔ 不臆造）────────────────────────────────────────────────────────
 * 全部从 `core/design.ets` / `core/motion.ets` **现场解析**得到常量名与值，
 * 并断言它们仍在（防"常量被删了而判据还绿"）。
 *
 * ── 实测结果 ──────────────────────────────────────────────────────────────────
 *  ③ 矛盾边界：**0 处**（守卫）。② 上界：**有**（`retry ≤ 6` / `delay ≤ 15000`）。
 *  ① 阈值漂移：**3 处**，且**全在禁改文件** ⇒ `PENDING_SPEC`（⛔ 只许缩短）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(m: 'path'): { join(...parts: string[]): string; relative(a: string, b: string): string };
declare const __dirname: string;

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
for (const d of ['components', 'pages', 'core']) {
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

console.log('\n▶ §A 扫描器自证 + 真源常量仍在');
const designSrc: string = stripComments(srcByRel.get('core/design.ets') as string);
const constVal = (name: string): number => {
  const m: RegExpExecArray | null = new RegExp(`${name}\\s*:\\s*number\\s*=\\s*(\\d+(?:\\.\\d+)?)`).exec(designSrc);
  return m === null ? -1 : Number(m[1]);
};
console.log(`  扫 ${srcByRel.size} 文件（components + pages + core）`);
ok('零扫描判红：文件数 > 0', srcByRel.size > 0);
ok(`真源常量仍在：\`HIT_TARGET_MIN\` = ${constVal('HIT_TARGET_MIN')}`, constVal('HIT_TARGET_MIN') > 0);
ok(`真源常量仍在：\`PILL_MAX_W\` = ${constVal('PILL_MAX_W')}`, constVal('PILL_MAX_W') > 0);
ok(`真源常量仍在：\`ROW_MIN_H\` = ${constVal('ROW_MIN_H')}`, constVal('ROW_MIN_H') > 0);

// ── §B ③ 矛盾边界 ─────────────────────────────────────────────────────────────
console.log('\n▶ §B ③ 矛盾边界：同一 constraintSize 里 min* > max*（约束永不可满足）');
class Contradiction { rel: string = ''; line: number = 0; why: string = ''; }
function contradictions(m: Map<string, string>): Contradiction[] {
  const out: Contradiction[] = [];
  m.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\.constraintSize\(\{([^}]*)\}\)/g;
    let x: RegExpExecArray | null = rx.exec(src);
    while (x !== null) {
      const body: string = x[1];
      const pairs: string[][] = [['minHeight', 'maxHeight'], ['minWidth', 'maxWidth']];
      for (let i = 0; i < pairs.length; i++) {
        const lo: RegExpExecArray | null = new RegExp(pairs[i][0] + '\\s*:\\s*([0-9.]+)').exec(body);
        const hi: RegExpExecArray | null = new RegExp(pairs[i][1] + '\\s*:\\s*([0-9.]+)').exec(body);
        if (lo !== null && hi !== null && Number(lo[1]) > Number(hi[1])) {
          const c: Contradiction = new Contradiction();
          c.rel = rel; c.line = lineOf(src, x.index);
          c.why = `${pairs[i][0]}=${lo[1]} > ${pairs[i][1]}=${hi[1]}`;
          out.push(c);
        }
      }
      x = rx.exec(src);
    }
  });
  return out;
}
const contra: Contradiction[] = contradictions(srcByRel);
for (let i = 0; i < contra.length; i++) { console.log(`  ⚠ ${contra[i].rel}:${contra[i].line}  ${contra[i].why}`); }
ok(`③ 无矛盾边界（实测 ${contra.length} 处）`, contra.length === 0);

// ── §C ② 无上界 ───────────────────────────────────────────────────────────────
console.log('\n▶ §C ② 上界存在性：SSE 重试必须**双夹**（次数 + 退避时长）');
const sseSrc: string = stripComments(srcByRel.get('core/sse.ets') as string);
const retryClamp: RegExpExecArray | null = /this\.retry\s*=\s*Math\.min\(\s*this\.retry\s*\+\s*1\s*,\s*(\d+)\s*\)/.exec(sseSrc);
const delayClamp: RegExpExecArray | null = /Math\.min\(\s*1000\s*\*\s*Math\.pow\(\s*2\s*,\s*this\.retry\s*-\s*1\s*\)\s*,\s*(\d+)\s*\)/.exec(sseSrc);
console.log(`  次数上界 = ${retryClamp === null ? '（未找到！）' : retryClamp[1]}；退避上界 = ${delayClamp === null ? '（未找到！）' : delayClamp[1] + 'ms'}`);
ok('② 重试**次数**有上界（`Math.min(this.retry + 1, N)`）', retryClamp !== null && Number(retryClamp[1]) > 0);
ok('② 退避**时长**有上界（`Math.min(1000 * 2^n, N)`）—— 否则退避会指数发散到"实际上永不重连"',
  delayClamp !== null && Number(delayClamp[1]) > 0);

// ── §D ① 阈值漂移（策展语义常量）──────────────────────────────────────────────
console.log('\n▶ §D ① 阈值漂移：语义阈值常量被写死同值字面量');
/** 策展表（值 + **语义匹配的属性位**；⛔ 不做"凡同值即漂移"的宽判）。 */
class Curated { name: string = ''; val: number = 0; attrs: string[] = []; }
const CURATED: Curated[] = [];
function cur(name: string, v: number, attrs: string[]): void { const c: Curated = new Curated(); c.name = name; c.val = v; c.attrs = attrs; CURATED.push(c); }
cur('HIT_TARGET_MIN', constVal('HIT_TARGET_MIN'), ['minHeight', 'height']);
cur('ROW_MIN_H', constVal('ROW_MIN_H'), ['minHeight']);
cur('PILL_MAX_W', constVal('PILL_MAX_W'), ['maxWidth']);
cur('LIST_MAX_H', constVal('LIST_MAX_H'), ['maxHeight']);
class Drift { rel: string = ''; line: number = 0; why: string = ''; }
function drifts(m: Map<string, string>, exempt: string[]): Drift[] {
  const out: Drift[] = [];
  m.forEach((raw: string, rel: string) => {
    if (rel.indexOf('core/') === 0) { return; }              // 真源自身不算
    const src: string = stripComments(raw);
    // ① 单属性形态：.minHeight(44)
    const rx1: RegExp = /\.(minHeight|maxHeight|minWidth|maxWidth|height|width)\(\s*(\d+)\s*\)/g;
    let x: RegExpExecArray | null = rx1.exec(src);
    while (x !== null) {
      for (let i = 0; i < CURATED.length; i++) {
        const c = CURATED[i];
        if (Number(x[2]) === c.val && c.attrs.indexOf(x[1]) >= 0 && x[0].indexOf(c.name) < 0) {
          const d: Drift = new Drift();
          d.rel = rel; d.line = lineOf(src, x.index);
          d.why = `.${x[1]}(${x[2]}) == ${c.name}(${c.val})`;
          const key: string = `${rel} :: ${d.why}`;
          if (exempt.indexOf(key) < 0) { out.push(d); }
        }
      }
      x = rx1.exec(src);
    }
    // ② constraintSize 形态：{ minHeight: 44 }
    const rx2: RegExp = /\.constraintSize\(\{([^}]*)\}\)/g;
    let y: RegExpExecArray | null = rx2.exec(src);
    while (y !== null) {
      const body: string = y[1];
      for (let i = 0; i < CURATED.length; i++) {
        const c = CURATED[i];
        for (let a = 0; a < c.attrs.length; a++) {
          const hit: RegExp = new RegExp(c.attrs[a] + '\\s*:\\s*' + c.val + '\\b');
          if (hit.test(body) && body.indexOf(c.name) < 0) {
            const d: Drift = new Drift();
            d.rel = rel; d.line = lineOf(src, y.index);
            d.why = `constraintSize{${c.attrs[a]}: ${c.val}} == ${c.name}(${c.val})`;
            const key: string = `${rel} :: ${d.why}`;
            if (exempt.indexOf(key) < 0) { out.push(d); }
          }
        }
      }
      y = rx2.exec(src);
    }
  });
  return out;
}
/** `PENDING_SPEC`：本线**禁改**的文件 —— ⛔ 只许缩短。 */
const PENDING_SPEC: string[] = [
  // `components/LiveTailView.ets` 归 chat-surface-ux：pill 最大宽应走 `PILL_MAX_W`
  'components/LiveTailView.ets :: constraintSize{maxWidth: 240} == PILL_MAX_W(240)',
  // `pages/Index.ets` 归 chat-surface-ux：注册按钮最小高应走 `HIT_TARGET_MIN`（本轮报了两次，因 44 同时等于 ROW_MIN_H）
  'pages/Index.ets :: constraintSize{minHeight: 44} == HIT_TARGET_MIN(44)',
  'pages/Index.ets :: constraintSize{minHeight: 44} == ROW_MIN_H(44)',
];
const dAll: Drift[] = drifts(srcByRel, []);
const dKeys: string[] = [];
for (let i = 0; i < dAll.length; i++) { const k: string = `${dAll[i].rel} :: ${dAll[i].why}`; dKeys.push(k); }
for (let i = 0; i < dAll.length; i++) { console.log(`  ⚠ ${dAll[i].rel}:${dAll[i].line}  ${dAll[i].why}`); }
function multisetDiff(a: string[], b: string[]): string[] {
  const pool: string[] = b.slice(); const out: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const at: number = pool.indexOf(a[i]);
    if (at < 0) { out.push(a[i]); } else { pool.splice(at, 1); }
  }
  return out;
}
const unreg: string[] = multisetDiff(dKeys, PENDING_SPEC);
const stale: string[] = multisetDiff(PENDING_SPEC, dKeys);
ok(`无"未登记的阈值漂移"（未登记 ${unreg.length}${unreg.length > 0 ? '：' + unreg.slice(0, 3).join(' / ') : ''}）`, unreg.length === 0);
ok(`台账**只许缩短**（陈旧 ${stale.length}${stale.length > 0 ? '：' + stale.slice(0, 3).join(' / ') : ''}）`, stale.length === 0);

// ── §E mutation ───────────────────────────────────────────────────────────────
console.log('\n▶ §E mutation 自证（合成源码）');
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Row().constraintSize({ minHeight: 60, maxHeight: 40 })\n}\n");
  ok('mutation：`minHeight 60 > maxHeight 40` ⇒ ③ 必红', contradictions(inj).length === 1);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Row().constraintSize({ minHeight: 44 })\n}\n");
  ok('mutation：`constraintSize({minHeight: 44})` ⇒ ① 必红（该用 HIT_TARGET_MIN）', drifts(inj, []).length >= 1);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Row().constraintSize({ minHeight: HIT_TARGET_MIN })\n}\n");
  ok('反向对照：走常量 ⇒ ① 不命中（判据不是"凡 44 必红"）', drifts(inj, []).length === 0);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('core/sse.ets', "this.retry = this.retry + 1;\nconst delay = 1000 * Math.pow(2, this.retry - 1);\n");
  const rc: RegExpExecArray | null = /this\.retry\s*=\s*Math\.min\(\s*this\.retry\s*\+\s*1\s*,\s*(\d+)\s*\)/.exec(stripComments(inj.get('core/sse.ets') as string));
  ok('mutation：拿掉上界夹取（`retry + 1` 直赋值）⇒ ② 的"次数有上界"必红', rc === null);
}

console.log('\n▼ 摘要');
console.log(`  ③ 矛盾边界 ${contra.length} 处；② 上界 retry≤${retryClamp === null ? '?' : retryClamp[1]} / delay≤${delayClamp === null ? '?' : delayClamp[1]}ms；① 漂移 ${dAll.length} 处（全在禁改文件 ⇒ PENDING_SPEC ${PENDING_SPEC.length}）`);
if (fail > 0) { console.log(`\n  boundary_threshold_gate: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  boundary_threshold_gate: ${pass} passed, 0 failed`);
process.exit(0);

export {};
