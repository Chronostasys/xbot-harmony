/**
 * 「苹果式」动效**物理规格**判据 —— 2026-10-12 目标⑤◆（规格立规 + 把"物理上说得通"变成机器断言）。
 *
 * 背景（用户口径）："交互起来很爽 / 有苹果那种科技感且干净"。动效唯一真源 = `core/motion.ets`。
 * 本判据守**四条物理不变量**（都来自公开的物理直觉，⛔ 未复制任何专有资源）：
 *   ① **有回弹但克制**：入场贝塞尔的**峰值超调** ∈ (0, `MOTION_OVERSHOOT_MAX`]（>0 ⇒ 不是呆板的线性缓动；
 *      有上界 ⇒ 不是乱弹）。当前曲线 `cubic-bezier(0.34,1.56,0.64,1)` 实测 ≈ 0.0978 ⇒ 等效 ζ ≈ 0.595。
 *   ② **干净收尾**：贝塞尔末端控制点 `y2 ≤ 1`（末端再起浪 ⇒ "冲过头再退回来"读作抖）。
 *   ③ **时长不拖沓**：单次过渡 ≤ `MOTION_DURATION_MAX_MS`（600ms）。
 *   ④ **行比块快**：`MOTION_MSG_IN_MS ≤ MOTION_BASE_MS`（更小的对象用更短的时长）。
 * 再加 ⑤ **接线不松**（形态断言）：`motionIssues()` 必须真的调用 `bezierIssues(..., MOTION_OVERSHOOT_MAX)`
 *   —— 防"不变量写好了但没人消费"（本仓「死消费」血债）。
 *
 * ⛔ 判据纪律（`AGENTS.md`「判据 ≠ 信号」）：
 *   · **零扫描判红**：读不到源码 / 取不到控制点 ⇒ 判红（防白绿）；
 *   · **只取调用片段**（形态断言用 `grep -o` 风格 indexOf 精确串，不"取整行再猜"）；
 *   · **mutation 自证**：`bezierIssues(...)` 是**参数化纯函数** ⇒ 本文件**当场注入坏样本**证明它有判别力
 *     （见下方 (D) 段：坏曲线必非空、当前曲线必空）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 * ⚠️ 必须 `export {}`：否则顶层声明与兄弟测试在聚合编译里撞名（TS2451/TS6200，本仓已入库 GOTCHA）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
export {};

import {
  MOTION_OVERSHOOT_MAX, MOTION_DURATION_MAX_MS,
  MOTION_FAST_MS, MOTION_BASE_MS, MOTION_MSG_IN_MS, MOTION_SLOW_MS,
  springBezier, peakOvershoot, springPeakOvershoot, dampingFromOvershoot,
  bezierY, bezierIssues, motionIssues,
} from '../../entry/src/main/ets/core/motion';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function closeTo(name: string, got: number, want: number, tol: number): void {
  const d = Math.abs(got - want);
  if (d <= tol) { pass++; } else {
    fail++;
    console.log(`  ✗ ${name}\n      got  ${got}\n      want ${want} ± ${tol}`);
  }
}
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
    } else { out += c; i++; }
  }
  return out;
}
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/core/motion.ets'))) { return p; }
  }
  return '';
}

const root: string = findRoot();
ok('探测到仓库根（含 core/motion.ets）', root.length > 0);

// ── 源码（剥注释）：形态断言 + 零扫描判红 ──────────────────────────────────────
let motionSrcRaw = '';
try {
  motionSrcRaw = fs.readFileSync(path.join(root, 'entry/src/main/ets/core/motion.ets'), 'utf8');
} catch (e) { motionSrcRaw = ''; }
ok(`零扫描判红：读到 core/motion.ets 且非空（实得 ${motionSrcRaw.length} 字节）`, motionSrcRaw.length > 0);
const motionSrc: string = stripComments(motionSrcRaw);

// ════════════════════════════════════════════════════════════════════════════
// (A) 曲线物理量：当前曲线 = 有回弹但克制（把"爽不爽"读成一个数）
// ════════════════════════════════════════════════════════════════════════════
const b = springBezier();
eq('控制点 = web 权威曲线 cubic-bezier(0.34,1.56,0.64,1)', [b.x1, b.y1, b.x2, b.y2], [0.34, 1.56, 0.64, 1]);

// 独立复算（不复用被测实现）：采样求 max y(t)-1。
let peakY = 0;
for (let i = 0; i <= 1000; i++) {
  const y = 3 * Math.pow(1 - i / 1000, 2) * (i / 1000) * b.y1
    + 3 * (1 - i / 1000) * Math.pow(i / 1000, 2) * b.y2
    + Math.pow(i / 1000, 3);
  if (y > peakY) { peakY = y; }
}
const overshootRef = peakY - 1;
ok(`独立复算取到峰值超调（实得 ${overshootRef.toFixed(6)}）`, overshootRef > 0);
closeTo('① 峰值超调 ≈ 9.78%（实测锚点，漂了就说明曲线被改）', overshootRef, 0.0978, 0.002);
closeTo('① 底座 springPeakOvershoot() 与独立复算一致（实现没写歪）', springPeakOvershoot(), overshootRef, 1e-6);
ok('① 曲线用同一个纯函数复算（peakOvershoot 与 springPeakOvershoot 同源）',
  Math.abs(peakOvershoot(b.y1, b.y2) - springPeakOvershoot()) < 1e-12);
ok('① 峰值超调 ≤ MOTION_OVERSHOOT_MAX（有回弹但克制；mutation：把 y1 改 3.0 ⇒ 必红）',
  springPeakOvershoot() <= MOTION_OVERSHOOT_MAX,
  `实测 ${springPeakOvershoot()} > 上界 ${MOTION_OVERSHOOT_MAX}`);

// 物理读法：超调 ⇄ 等效阻尼比 ζ（ζ ∈ (0,1) 才有振铃；ζ→1 临界阻尼无回弹）。
const zeta = dampingFromOvershoot(springPeakOvershoot());
ok(`② 等效阻尼比 ζ ∈ (0,1)（实得 ${zeta.toFixed(4)}）`, zeta > 0 && zeta < 1);
closeTo('② ζ ≈ 0.595（"略带回弹、收得住"）', zeta, 0.595, 0.02);
// 往返自洽：ζ ⇒ 前向裕度公式 ⇒ 回到原超调。
const forward = Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta));
closeTo('② 超调 ⇄ ζ 往返自洽（前向公式复得原值）', forward, overshootRef, 1e-6);
eq('② overshoot ≤ 0 ⇒ ζ = 1（临界阻尼边界）', dampingFromOvershoot(0), 1);
eq('② 负超调（无回弹）⇒ ζ = 1', dampingFromOvershoot(-0.3), 1);

// bezierY 与独立复算一致（防止实现把 x/y 分量搞混）。
closeTo('bezierY 与独立复算一致（t=0.6）',
  bezierY(b.y1, b.y2, 0.6), 3 * 0.16 * 0.6 * b.y1 + 3 * 0.4 * 0.36 * b.y2 + 0.216, 1e-12);

// ════════════════════════════════════════════════════════════════════════════
// (B) 时长物理量：不拖沓 + 行比块快
// ════════════════════════════════════════════════════════════════════════════
ok(`③ 单次过渡最长档（slow=${MOTION_SLOW_MS}）≤ 上界 ${MOTION_DURATION_MAX_MS}ms`,
  MOTION_SLOW_MS <= MOTION_DURATION_MAX_MS);
ok('③ 时长上界本身是"不拖沓"档（∈ (300, 800]ms）',
  MOTION_DURATION_MAX_MS > 300 && MOTION_DURATION_MAX_MS <= 800);
ok(`④ 行入场（msgIn=${MOTION_MSG_IN_MS}）≤ 块入场（base=${MOTION_BASE_MS}）`,
  MOTION_MSG_IN_MS <= MOTION_BASE_MS);
ok('④ 快速档 < 行入场 ≤ 块入场 < 抽屉档（档位单调）',
  MOTION_FAST_MS < MOTION_MSG_IN_MS && MOTION_MSG_IN_MS <= MOTION_BASE_MS && MOTION_BASE_MS < MOTION_SLOW_MS);

// ════════════════════════════════════════════════════════════════════════════
// (C) 自检：当前常量集必须"零问题"（规格对未来取值生效）
// ════════════════════════════════════════════════════════════════════════════
eq('motionIssues() 为空（当前曲线/时长全部物理上说得通）', motionIssues().map((i) => i.field), []);
ok('上界常量本身合法（0 < 超调上界 < 1）', MOTION_OVERSHOOT_MAX > 0 && MOTION_OVERSHOOT_MAX < 1);

// ════════════════════════════════════════════════════════════════════════════
// (D) **mutation 自证**（当场注入坏样本 ⇒ 判据必须"咬"）：参数化纯函数可注入
// ════════════════════════════════════════════════════════════════════════════
// D1 乱弹：y1 = 3.0（超调 ≈ 65%）⇒ 必被判"超上界 / y1 > 2"。
const badWild = bezierIssues(0.34, 3.0, 0.64, 1.0, MOTION_OVERSHOOT_MAX);
ok('mutation D1：y1=3.0（乱弹）⇒ 判非空', badWild.length > 0, JSON.stringify(badWild.map((i) => i.field)));
// D2 呆板：y1 = 1.0（无回弹 ⇒ 线性缓动感）⇒ 必被判"需 > 1"。
const badFlat = bezierIssues(0.34, 1.0, 0.64, 1.0, MOTION_OVERSHOOT_MAX);
ok('mutation D2：y1=1.0（无回弹）⇒ 判非空', badFlat.length > 0, JSON.stringify(badFlat.map((i) => i.field)));
// D3 末端起浪：y2 = 1.2（收尾再冲一下 ⇒ 抖）⇒ 必被判"y2 ≤ 1"。
const badTail = bezierIssues(0.34, 1.56, 0.64, 1.2, MOTION_OVERSHOOT_MAX);
ok('mutation D3：y2=1.2（末端起浪）⇒ 判非空', badTail.length > 0, JSON.stringify(badTail.map((i) => i.field)));
// D4 x 越界（SDK 会夹到 0/1）⇒ 必被判。
const badX = bezierIssues(1.5, 1.56, 0.64, 1.0, MOTION_OVERSHOOT_MAX);
ok('mutation D4：x1=1.5（越界）⇒ 判非空', badX.length > 0, JSON.stringify(badX.map((i) => i.field)));
// D5 上界收紧到 1% ⇒ 当前曲线（9.78%）也必须被判红（证明上界**真被消费**）。
const tight = bezierIssues(b.x1, b.y1, b.x2, b.y2, 0.01);
ok('mutation D5：把上界收紧到 1% ⇒ 当前曲线必被判红（上界真被消费）',
  tight.length > 0, JSON.stringify(tight.map((i) => i.field)));
// D6 反向：当前曲线 + 当前上界 ⇒ **必为空**（否则是假红）。
eq('mutation D6（反向）：当前曲线 + 当前上界 ⇒ 判空', bezierIssues(b.x1, b.y1, b.x2, b.y2, MOTION_OVERSHOOT_MAX).length, 0);

// ════════════════════════════════════════════════════════════════════════════
// (E) 形态断言：不变量**真被接线**（防"死消费"）
// ════════════════════════════════════════════════════════════════════════════
// 只取调用片段（indexOf 精确串），不"取整行再猜"。
ok('⑤ motionIssues() 真调用 bezierIssues(b.x1, b.y1, b.x2, b.y2, MOTION_OVERSHOOT_MAX)（接线在位）',
  motionSrc.indexOf('bezierIssues(b.x1, b.y1, b.x2, b.y2, MOTION_OVERSHOOT_MAX)') >= 0);
ok('⑤ motionIssues() 真断言时长上界（MOTION_SLOW_MS <= MOTION_DURATION_MAX_MS）',
  motionSrc.indexOf('MOTION_SLOW_MS <= MOTION_DURATION_MAX_MS') >= 0);
ok('⑤ motionIssues() 真断言"行比块快"（MOTION_MSG_IN_MS <= MOTION_BASE_MS）',
  motionSrc.indexOf('MOTION_MSG_IN_MS <= MOTION_BASE_MS') >= 0);
ok('⑤ 上界常量在源码里派生在位（mutation：删掉即红）',
  motionSrc.indexOf('export const MOTION_OVERSHOOT_MAX: number = 0.15;') >= 0
  && motionSrc.indexOf('export const MOTION_DURATION_MAX_MS: number = 600;') >= 0);

if (fail > 0) { console.log(`  motion_apple_spec: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  motion_apple_spec: ${pass} passed, 0 failed`);
process.exit(0);
