/**
 * hit_target_gate.test.ts —— **命中区/热区**判据（"交互起来很爽"类 · 2026-10-11 离线）。
 *
 * ── 缺陷类 ────────────────────────────────────────────────────────────────────
 * 可点元素的**命中区**小于规范最小值 ⇒ 点不中/误触。规范出处**取仓内真源**，⛔ 不臆造：
 *   · `core/design.ets:757  HIT_TARGET_MIN = 44`（注释："Apple HIG ≥44pt；图标视觉尺寸可更小，
 *     命中区用 `responseRegion` 外扩"）；
 *   · 本仓既有补偿模式：`PluginsSheet` / `SplashOverlay` / `StatusSheet` 的关闭/跳过按钮 ——
 *     **视觉小、热区靠 `responseRegion` 外扩**（⛔ 不改布局/视觉尺寸）。
 *
 * ── 判据（A 类硬红）───────────────────────────────────────────────────────────
 * **可点元素（链上有 `onClick`/`bindMenu`/`bindPopup`/`bindSheet`/`gesture`/`onTouch`/`bindTips`）
 * 若显式设了 < `HIT_TARGET_MIN` 的 `height`/`width`/`size`/`constraintSize` 数值，
 * 且链上**没有** `HIT_TARGET_MIN` 也没有 `responseRegion`** ⇒ 红。
 * 例外（⛔ 只许缩短）：`PENDING_SPEC` = 本线改不动的（`pages/Index.ets`，归 main agent）。
 *
 * ── 自证（扫描器先被验）──────────────────────────────────────────────────────
 *  · 打印**扫了哪些文件** + **逐文件可点元素分布**；**零扫描判红**；`CLICKABLE_ELEMENTS > 0`。
 *  · 断言 `HIT_TARGET_MIN ≥ 44`（**门槛本身不许被下调**）—— 否则"标准被悄悄放松"而判据仍绿。
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

// ── 阈值：**从真源读**（⛔ 不新造）──────────────────────────────────────────────
const designSrc: string = fsMod.readFileSync(pathMod.join(etsRoot, 'core', 'design.ets'), 'utf-8');
const mMin: RegExpExecArray | null = /HIT_TARGET_MIN\s*:\s*number\s*=\s*(\d+)/.exec(designSrc);
const HIG_FLOOR: number = 44;                       // Apple HIG ≥44pt（design.ets:757 注释）
const MIN: number = mMin !== null ? Number(mMin[1]) : 0;

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
function skipWs(s: string, i: number): number { while (i < s.length && ' \t\r\n'.indexOf(s.charAt(i)) >= 0) { i += 1; } return i; }
/** `Name(...)` 之后的属性链（先跳过可选 `{...}` 块 —— ⚠️ 上一轮踩过"遇 `{` 就停"的假 0）。 */
function chainAfter(s: string, i: number): string {
  i = skipWs(s, i);
  if (i < s.length && s.charAt(i) === '{') { const k: number = matchPair(s, i, '{', '}'); i = k < 0 ? s.length : k + 1; }
  let out: string = ''; i = skipWs(s, i);
  while (i < s.length && s.charAt(i) === '.') {
    const j: number = s.indexOf('(', i);
    if (j < 0) { break; }
    const k: number = matchPair(s, j, '(', ')');
    if (k < 0) { break; }
    out += s.substring(i, k + 1); i = skipWs(s, k + 1);
  }
  return out;
}
const CLICK: RegExp = /\.(onClick|bindMenu|bindPopup|bindSheet|bindContextMenu|gesture|onTouch|bindTips)\s*\(/;
const SIZE: RegExp = /\.(height|width|size|constraintSize)\(\s*([^)]*)\)/g;

class Clickable {
  rel: string = ''; line: number = 0; name: string = ''; small: string = '';
}
/** 判据本体（纯函数，mutation 复用）：返回"未登记的 A 类命中"。 */
function unregisteredHits(srcByRel: Map<string, string>, registered: string[]): string[] {
  const out: string[] = [];
  srcByRel.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
    let m: RegExpExecArray | null = rx.exec(src);
    while (m !== null) {
      const j: number = src.indexOf('(', m.index);
      const k: number = matchPair(src, j, '(', ')');
      if (k > 0) {
        const ch: string = chainAfter(src, k + 1);
        if (CLICK.test(ch) && ch.indexOf('HIT_TARGET_MIN') < 0 && ch.indexOf('responseRegion') < 0) {
          const small: string[] = [];
          SIZE.lastIndex = 0;
          let sm: RegExpExecArray | null = SIZE.exec(ch);
          while (sm !== null) {
            const nums: RegExpMatchArray | null = sm[2].match(/(?<![\w.])\d+(\.\d+)?/g);
            if (nums !== null) {
              for (let q = 0; q < nums.length; q++) {
                const v: number = Number(nums[q]);
                if (v > 0 && v < MIN) { small.push(`${sm[1]}(${nums[q]})`); }
              }
            }
            sm = SIZE.exec(ch);
          }
          if (small.length > 0) {
            const key: string = `${rel} :: ${m[1]} #${small.join(',')}`;
            if (registered.indexOf(key) < 0) { out.push(key); }
          }
        }
      }
      m = rx.exec(src);
    }
  });
  return out;
}

// ── 扫描 ─────────────────────────────────────────────────────────────────────
const files: string[] = [];
const dirs: string[] = ['components', 'pages'];
for (let d = 0; d < dirs.length; d++) {
  const base: string = pathMod.join(etsRoot, dirs[d]);
  const walk = (dir: string): void => {
    const ents: string[] = fsMod.readdirSync(dir);
    for (let i = 0; i < ents.length; i++) {
      const p: string = pathMod.join(dir, ents[i]);
      if (fsMod.statSync(p).isDirectory()) { walk(p); } else if (ents[i].endsWith('.ets')) { files.push(p); }
    }
  };
  walk(base);
}
const srcByRel: Map<string, string> = new Map<string, string>();
for (let i = 0; i < files.length; i++) {
  srcByRel.set(pathMod.relative(etsRoot, files[i]), fsMod.readFileSync(files[i], 'utf-8'));
}

console.log('\n▶ §A 扫描器自证');
console.log(`  阈值来源：core/design.ets 的 \`HIT_TARGET_MIN = ${MIN}\`（注释出处：Apple HIG ≥44pt）`);
let clickable: number = 0;
const perFile: string[] = [];
srcByRel.forEach((raw: string, rel: string) => {
  const src: string = stripComments(raw);
  const rx: RegExp = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null = rx.exec(src);
  let c: number = 0;
  while (m !== null) {
    const j: number = src.indexOf('(', m.index);
    const k: number = matchPair(src, j, '(', ')');
    if (k > 0 && CLICK.test(chainAfter(src, k + 1))) { c += 1; }
    m = rx.exec(src);
  }
  clickable += c;
  if (c > 0) { perFile.push(`  ${pad(rel, 46)} 可点元素 ${c}`); }
});
perFile.sort();
console.log(`  扫到 .ets 文件 ${files.length}；可点元素 ${clickable}`);
console.log('  逐文件分布（前 10）：');
for (let i = 0; i < perFile.length && i < 10; i++) { console.log(perFile[i]); }
ok('零扫描判红：扫到文件数 > 0', files.length > 0);
ok('扫描器有效性：可点元素数 > 0', clickable > 0);
ok('阈值真源可读（`HIT_TARGET_MIN` 解析成功）', MIN > 0);
ok(`⚠️ 门槛本身不许被下调：HIT_TARGET_MIN(${MIN}) ≥ Apple HIG 地板 ${HIG_FLOOR}`, MIN >= HIG_FLOOR);

console.log('\n▶ §B A 类命中：显式尺寸 < 阈值且无补偿（HIT_TARGET_MIN / responseRegion）');
/** 本线**改不动**、已出 spec 的（`pages/Index.ets` 归 main agent）。 */
const PENDING_SPEC: string[] = [
  'pages/Index.ets :: Button #constraintSize(42)',   // 「测试连接」minHeight 42
  'pages/Index.ets :: Button #constraintSize(38)',   // 「重试/重新登录」minHeight 38
];
const hits: string[] = unregisteredHits(srcByRel, []);
for (let i = 0; i < hits.length; i++) { console.log(`  ${hits[i]}`); }
ok(`命中数 == 已登记 spec 数（实测 ${hits.length} / 登记 ${PENDING_SPEC.length}）`, hits.length === PENDING_SPEC.length);
ok('命中集与登记集一一对应（同一集合）', ((): boolean => {
  const a: string = hits.slice().sort().join('|');
  const b: string = PENDING_SPEC.slice().sort().join('|');
  return a === b;
})());
ok('components/** 侧已清零（改动落地的部分）', !hits.some((h) => h.indexOf('components/') === 0));

console.log('\n▶ §C mutation 自证：把某处尺寸改到阈值下 ⇒ 必红');
{
  const inj: Map<string, string> = new Map<string, string>();
  srcByRel.forEach((v: string, k: string) => inj.set(k, v));
  const target: string = 'components/SelfCheckSheet.ets';
  const s0: string = inj.get(target) as string;
  inj.set(target, s0.replace('.constraintSize({ minHeight: HIT_TARGET_MIN })', '.constraintSize({ minHeight: 40 })'));
  // ⚠️ 断言应是"出现**新的未登记命中**"（基线带 PENDING_SPEC = 0，注入后 ≥1）。
  //    我第一版写成 `> PENDING_SPEC.length`（2）⇒ 1 > 2 = false ⇒ 假红（判据本身写错，不是产品错）。
  const got: string[] = unregisteredHits(inj, PENDING_SPEC);
  ok('mutation：SelfCheckSheet 撤回 40 ⇒ 出现未登记命中（必红）', got.length > 0);
}
{
  const inj: Map<string, string> = new Map<string, string>();
  srcByRel.forEach((v: string, k: string) => inj.set(k, v));
  const target: string = 'components/SettingsDeveloper.ets';
  const s0: string = inj.get(target) as string;
  inj.set(target, s0.replace('.constraintSize({ minHeight: HIT_TARGET_MIN })', '.height(32)'));
  ok('mutation：SettingsDeveloper 撤回 32 ⇒ 出现未登记命中（必红）', unregisteredHits(inj, PENDING_SPEC).length > 0);
}
ok('真实源码判绿（防"判据恒红"）', unregisteredHits(srcByRel, PENDING_SPEC).length === 0);

console.log('\n▼ 摘要');
console.log(`  扫 ${files.length} 文件 / ${clickable} 个可点元素；阈值 HIT_TARGET_MIN = ${MIN}（出处 core/design.ets）`);
console.log(`  A 类命中 ${hits.length}（= PENDING_SPEC，全在 pages/Index.ets，归 main agent）`);
if (fail > 0) { console.log(`\n  hit_target_gate: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  hit_target_gate: ${pass} passed, 0 failed`);
process.exit(0);

export {};
