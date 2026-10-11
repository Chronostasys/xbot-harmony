/**
 * 浮层（`bindPopup`）**统一口径**门禁 —— C4 续（2026-10-11）。
 *
 * 背景：`bindPopup` 的**底/边/影/圆角由 ArkUI 系统绘制**，设计系统只能从**三个口子**介入：
 *   `popupColor`（面）/ `radius`（圆角）/ `shadow`（柔影）—— ⛔ 无描边口子（系统不给 popup 边框）。
 * ⇒ 规则（本判据）：
 *   **A（硬红）** 每个 `bindPopup(` 的参数字面量**必须**同时给：
 *     · `popupColor: surfaceFillOf(...)`（**唯一面口径**：⛔ 不许裸 `this.pal().surface/surfaceAlt`）；
 *     · `radius: RADIUS_*`（**语义档 token**：⛔ 不许 `R_MD/R_XL` 之类的梯级值以外的东西、更不许数字字面量）；
 *     · `shadow: { … shadowRadiusOf(…) … elevationColorOf(…) … }`（**token 柔影**）。
 *   `radius` 用 `RADIUS_*`（语义档）而非裸 `R_MD/R_XL`：后者是"梯级值"，语义在调用点丢掉了
 *   （`RADIUS_CHIP/CARD/SHEET` 才说得出"这是 chip/card 还是 sheet 的圆角"）。
 *
 * ⛔ 判据纪律（`AGENTS.md`「判据 ≠ 信号」）：**先剥注释**（本仓用注释记录"为什么这个面/这条影"）；
 *   只取**调用片段**（从 `bindPopup(` 起做**括号配对**截出参数字面量，⛔ 不"取整行"）；
 *   **零扫描判红**（扫不到 = 红）；**打印台账**（逐处 file:line + 三个值，自证不空转）。
 *
 * mutation 自证：把任一处 `popupColor: surfaceFillOf(this.pal(), 'surface.overlay')` 改回
 *   `popupColor: this.pal().surface` ⇒ 规则 A 必红；把 `radius: RADIUS_CARD` 改成 `radius: 12` 亦必红。
 *
 * ⚠️ 有 `import`/`export`（⇒ TS 模块）：⛔ 否则顶层 `declare const`/`let pass` 会与同样"无 import"的
 *   `one_inflight_motion.test.ts` 在**聚合编译**里撞名（本仓已入库 GOTCHA）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

/**
 * 剥掉 `//` 与 `/* *\/` 注释（只判**代码**；本仓注释记录设计理由，是好实践不是违规）。
 * ⛔ **必须保留换行**：否则报的行号会在真源码里对不上（本仓已入库教训：旧实现把块注释压掉 ⇒
 *    行号漂移 ~350 行，`anim-opacity-gate.sh` 头注有记）。实测本判据第一版就踩了（`:55` 实为 `:97`）。
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    const n = i + 1 < src.length ? src.charAt(i + 1) : '';
    if (c === '/' && n === '/') {
      while (i < src.length && src.charAt(i) !== '\n') { i++; }
      if (i < src.length) { out += '\n'; i++; }   // 保留行尾换行
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src.charAt(i) === '*' && i + 1 < src.length && src.charAt(i + 1) === '/')) {
        if (src.charAt(i) === '\n') { out += '\n'; }   // 保留块注释内的换行
        i++;
      }
      i += 2;
    } else { out += c; i++; }
  }
  return out;
}

function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/components'))) { return p; }
  }
  return '';
}
function walk(dir: string, out: string[]): void {
  let ents: any[] = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, out); }
    else if (e.name.endsWith('.ets')) { out.push(full); }
  }
}
/** 行号（1-based）：从起点到 idx 的换行数（剥注释**保留换行** ⇒ 行号与真源码一致，可直接 grep）。 */
function lineAt(src: string, idx: number): number {
  let n = 1;
  for (let k = 0; k < idx && k < src.length; k++) { if (src.charAt(k) === '\n') { n++; } }
  return n;
}
/** 从 `open`（`{` 的位置）做**括号配对**，返回 `{...}` 的原文（含花括号）。 */
function sliceBrace(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src.charAt(i);
    if (c === '{') { depth++; }
    else if (c === '}') { depth--; if (depth === 0) { return src.substring(open, i + 1); } }
  }
  return src.substring(open);
}
/** 取**标量**字段（值到第一个逗号/换行止）—— 用于 `popupColor`/`radius`。 */
function fieldOf(block: string, name: string): string {
  const m = new RegExp('\\b' + name + '\\s*:\\s*([^,\\n]+)').exec(block);
  return m === null ? '' : m[1].trim();
}
/**
 * 取**对象字面量**字段（值做**括号配对**）—— 用于 `shadow`。
 * ⛔ 不能用 `fieldOf`：它的 `[^,]+` 会在对象里的第一个逗号截断（实测把
 *    `{ radius: shadowRadiusOf(…), color: elevationColorOf(…) }` 截成只有 `shadowRadiusOf` ⇒
 *    对 `elevationColorOf` 的检查**恒假红**）。
 */
function objectFieldOf(block: string, name: string): string {
  const m = new RegExp('\\b' + name + '\\s*:\\s*\\{').exec(block);
  if (m === null) { return ''; }
  return sliceBrace(block, block.indexOf('{', m.index));
}

const root: string = findRoot();
ok('探测到仓库根', root.length > 0);
const ETS: string = path.join(root, 'entry/src/main/ets');
const files: string[] = [];
for (const sub of ['components', 'pages']) {
  const d: string = path.join(ETS, sub);
  if (fs.existsSync(d)) { walk(d, files); }
}
ok(`扫到 .ets 文件 > 0（components/pages，实得 ${files.length}）`, files.length > 0);

const violations: string[] = [];
const ledger: string[] = [];
let sites = 0;

for (const f of files) {
  const src: string = stripComments(fs.readFileSync(f, 'utf8'));
  const rel: string = path.relative(ETS, f).split(path.sep).join('/');
  let from: number = 0;
  for (;;) {
    const i: number = src.indexOf('bindPopup(', from);
    if (i < 0) { break; }
    from = i + 'bindPopup('.length;
    const open: number = src.indexOf('{', from);
    if (open < 0) { continue; }
    const block: string = sliceBrace(src, open);
    sites++;
    const color: string = fieldOf(block, 'popupColor');
    const radius: string = fieldOf(block, 'radius');
    const shadow: string = objectFieldOf(block, 'shadow');
    const at: string = `${rel}:${lineAt(src, i)}`;
    ledger.push(`${at}  popupColor=${color || '(缺)'} · radius=${radius || '(缺)'} · shadow=${shadow.length > 0 ? 'token' : '(缺)'}`);
    if (color.indexOf('surfaceFillOf(') !== 0) {
      violations.push(`${at} 的 popupColor=${color || '(缺)'} —— 必须 popupColor: surfaceFillOf(this.pal(), …)（唯一面口径）`);
    }
    if (!/^RADIUS_[A-Z_]+$/.test(radius)) {
      violations.push(`${at} 的 radius=${radius || '(缺)'} —— 必须用语义档 token（RADIUS_CHIP|CARD|SHEET|…）`);
    }
    if (shadow.indexOf('shadowRadiusOf(') < 0 || shadow.indexOf('elevationColorOf(') < 0) {
      violations.push(`${at} 的 shadow 缺 token —— 必须 shadow: { radius: shadowRadiusOf(p, 'overlay'), color: elevationColorOf(p, ELEV_OVERLAY), … }`);
    }
  }
}

// ── 台账（自证：扫了哪些文件、逐处三个值）──────────────────────────────────
console.log(`▶ bindPopup 统一口径台账（${sites} 处）：`);
for (const l of ledger) { console.log(`    · ${l}`); }
ok(`扫到 bindPopup 调用点 ≥ 7（实得 ${sites}）—— 零扫描判红`, sites >= 7);

if (violations.length === 0) {
  ok('全部 bindPopup 的 面/圆角/柔影 均取自设计系统口径', true);
} else {
  for (const v of violations) { ok(`浮层口径违规：${v}`, false); }
}

// 兜底：全仓不得再有裸 `popupColor: this.pal()...`
let raw = 0;
for (const f of files) {
  const src: string = stripComments(fs.readFileSync(f, 'utf8'));
  raw += (src.match(/popupColor:\s*this\.pal\(\)/g) || []).length;
}
ok(`无裸 \`popupColor: this.pal()…\`（实得 ${raw}）`, raw === 0);

if (fail > 0) { console.log(`  popup_uniform: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  popup_uniform: ${pass} passed, 0 failed`);
process.exit(0);
