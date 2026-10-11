/**
 * 转场动画**单一来源**门禁 —— E3「转场动画统一审计 + 落地」（2026-10-11）。
 *
 * 铁律：`components/anim.ets` 是全仓**唯一**允许构造**曲线 / 时长**的地方（也是唯一 import
 * `@ohos/curves` 的层）。页面/面板/抽屉/浮层一律调它的**具名工厂**
 * （`animFast()/animBase()/animMsgIn()/animSlow()/animSpring()/animEaseOut()/sheetTransition()`）。
 * ⇒ 任何**就地写**的转场参数都是**不一致点**，本判据一律判红：
 *   · `animateTo({ duration: … })`（内联参数对象，绕开工厂）；
 *   · `.animation({ duration/curve: … })`（内联过渡参数，只许在 `anim.ets` 的工厂里）；
 *   · `curve: Curve.…` / `curve: '…'`（曲线字面量，只许在 `anim.ets`）；
 *   · `.transition(TransitionEffect.…)`（就地构造过渡，须走 `anim.ets` 工厂）；
 *   · `@ohos.curves`（**点**，非斜杠）的 import 出现在 `anim.ets` 之外。
 *
 * ⛔ 判据纪律（`AGENTS.md`「判据 ≠ 信号」，本仓踩过多次）：
 *   ① **先剥注释** —— 本仓用注释记录"为什么用这条曲线/时长"（**好实践**），朴素 grep 会把**文档**
 *      当违规（实测踩过 7 处假报）；本脚本自带注释剥离（对字符串内 `//` 免疫）。
 *   ② **只匹配调用片段**（正则 `animateTo(\s*{` / `curve:\s*(Curve\.|'|")`），⛔ 不"取整行再猜"。
 *   ③ **零扫描判红**（扫不到文件/调用点 = 判红，防"白绿"）。
 *   ④ **打印扫了哪些文件 + 命中分布**（自证不是空转）。
 *
 * mutation 自证：把任一处 `.transition(sheetTransition())` 改成
 *   `.transition(TransitionEffect.OPACITY.animation({ duration: 300 }))` ⇒ 本判据必红
 *   （同时触发 D 与 B）。把某处 `animateTo(animBase(), …)` 改成 `animateTo({ duration: 220 }, …)` ⇒ A 必红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
// ⛔ **必须**：本文件若无 import/export，会被 TS 当作**全局脚本**⇒ 顶层 `__dirname`/`pass`/`fail`/`ok`
//    与同样"无 import"的 `one_inflight_motion.test.ts` **在聚合编译里撞名**（TS2451/TS2393 ⇒ 聚合判红，
//    实测踩到）。`export {}` 把本文件变成**模块** ⇒ 顶层声明进模块作用域，不再互相污染。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

/** 剥掉 `//` 与 `/* *\/` 注释 —— 只判**代码**（字符串内的 `//` 免疫见脚本头 ⓐ）。 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    const n = i + 1 < src.length ? src.charAt(i + 1) : '';
    if (c === '/' && n === '/') {
      while (i < src.length && src.charAt(i) !== '\n') { i++; }
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src.charAt(i) === '*' && i + 1 < src.length && src.charAt(i + 1) === '/')) { i++; }
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** 探测仓库根（含 `entry/src/main/ets/components/anim.ets` 的那层；层级随 harness 变化，⛔ 不硬编码）。 */
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/components/anim.ets'))) { return p; }
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

const root: string = findRoot();
ok('探测到仓库根（含 anim.ets）', root.length > 0);

const ETS: string = path.join(root, 'entry/src/main/ets');
const files: string[] = [];
for (const sub of ['components', 'pages', 'core']) {
  const d: string = path.join(ETS, sub);
  if (fs.existsSync(d)) { walk(d, files); }
}
// ⛔ 零扫描判红
ok(`扫到 .ets 文件 > 0（components/pages/core，实得 ${files.length}）`, files.length > 0);

const ANIM_OWNER: string = 'components/anim.ets';
function rel(f: string): string {
  return path.relative(ETS, f).split(path.sep).join('/');
}
function count(src: string, re: RegExp): number {
  const m = src.match(re);
  return m === null ? 0 : m.length;
}

const violations: string[] = [];
const dist: string[] = [];
let animSites = 0;
let transitionSites = 0;
let curvesImportFiles: string[] = [];

for (const f of files) {
  const r: string = rel(f);
  const src: string = stripComments(fs.readFileSync(f, 'utf8'));

  // A. `animateTo({ … })` —— 内联参数对象（绕开工厂）
  const a: number = count(src, /animateTo\(\s*\{/g);
  if (a > 0) { violations.push(`${r}: animateTo({...}) ×${a} —— 须用 anim.ets 工厂 \`animateTo(animBase(), …)\``); }
  // B. `.animation({ … })` —— 内联过渡参数（只许 anim.ets 的工厂里）
  const b: number = count(src, /\.animation\(\s*\{/g);
  if (b > 0) { dist.push(`${r}: .animation({...}) ×${b}`); if (r !== ANIM_OWNER) { violations.push(`${r}: .animation({...}) ×${b} —— 内联时长/曲线只许在 ${ANIM_OWNER}`); } }
  // C. `curve: <字面量/枚举>` —— 曲线只许 anim.ets 造
  const c: number = count(src, /curve:\s*(Curve\.|'|")/g);
  if (c > 0) { dist.push(`${r}: curve: <literal> ×${c}`); if (r !== ANIM_OWNER) { violations.push(`${r}: curve: <literal> ×${c} —— 曲线唯一出口 = ${ANIM_OWNER}`); } }
  // D. `.transition(TransitionEffect…)` —— 就地构造过渡
  const d: number = count(src, /\.transition\(\s*TransitionEffect/g);
  if (d > 0) { violations.push(`${r}: .transition(TransitionEffect…) ×${d} —— 须走 anim.ets 工厂`); }
  // 覆盖/分布（自证用）
  const et: number = count(src, /\.transition\(/g);
  if (et > 0) { transitionSites += et; dist.push(`${r}: .transition(...) ×${et}`); }
  const ea: number = count(src, /animateTo\(/g);
  if (ea > 0) { animSites += ea; dist.push(`${r}: animateTo(...) ×${ea}`); }
  // E. `@ohos.curves` import 只许 anim.ets
  //    ⚠️ 模块名是 **`@ohos.curves`（点）**，不是 `@ohos/curves`（斜杠）—— 多条文档把点写成了斜杠，
  //    照抄进正则 ⇒ 恒扫不到 ⇒ **假绿**（本判据落地时实测踩到，见提交信息）。
  if (/from\s+['"]@ohos[./]curves['"]/.test(src)) { curvesImportFiles.push(r); }
}

// ── 自证打印：扫了哪些文件 + 命中分布（⛔ 不空转）────────────────────────────
console.log(`▶ 转场动画单一来源扫描：${files.length} 个 .ets（components/pages/core）`);
console.log(`  命中分布（${dist.length} 条）：`);
for (const h of dist) { console.log(`    · ${h}`); }

// ── 判据 ───────────────────────────────────────────────────────────────────
if (violations.length === 0) {
  ok('转场动画单一来源：无违规（实现里无就地时长/曲线/过渡）', true);
} else {
  for (const v of violations) { ok(`转场动画单一来源违规：${v}`, false); }
}

// 覆盖：确实扫到了"走工厂"的调用（防"文件挪走/正则失效"式白绿）
ok(`扫到 animateTo(...) 调用点 > 0（实得 ${animSites}）`, animSites > 0);
ok(`扫到 .transition(...) 调用点 > 0（实得 ${transitionSites}）`, transitionSites > 0);
ok('扫到 .animation({...})（anim.ets 的过渡工厂，实得 ≥1）', dist.some((s: string) => s.indexOf('.animation({...})') >= 0));
// `@ohos/curves` 唯一出口
ok(`@ohos/curves 只被 ${ANIM_OWNER} import（实得 ${curvesImportFiles.length} 处：${curvesImportFiles.join(', ') || '无'}）`,
  curvesImportFiles.length === 1 && curvesImportFiles[0] === ANIM_OWNER);
// 各弹层确实复用同一个 `sheetTransition()`（E3 统一的核心断言）
let sheetUse = 0;
for (const f of files) {
  const src: string = stripComments(fs.readFileSync(f, 'utf8'));
  sheetUse += count(src, /sheetTransition\(\)/g);
}
ok(`sheetTransition() 被多处复用（≥ 4，实得 ${sheetUse}）`, sheetUse >= 4);

if (fail > 0) { console.log(`  motion_uniform: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  motion_uniform: ${pass} passed, 0 failed`);
process.exit(0);
