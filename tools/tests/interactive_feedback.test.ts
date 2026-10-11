/**
 * 交互反馈一致性门禁（**静态源码扫描**）—— 防"点了像没反应"的回归。
 *
 * 判定口径（本仓既有约定）：
 *   · 凡**可点**的容器元素 ⇒ 必须有 `stateStyles({ pressed: … })` 的按压反馈；
 *   · 按压不透明度**只准引用 `PRESS_OPACITY`**（不许写死 `.opacity(0.6)`）。
 *
 * ⚠️ 扫描集**只含我负责、且当前不在他人手上的**聊天流组件。`LlmErrorNotice` / `ThinkingLine`
 *    / `TodoPanel` / `GoalBanner` 此刻是**他人在途**文件 ⇒ **不纳入**（避免把别人的在途状态
 *    算成我这边的红；那几处的 press 缺口见交付回报，只上报不改）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 必须把本文件标记为**模块**（`export {}`）：否则它是全局脚本，顶层 `process/require/pass/fail`
//    会与其它同款脚本测试（如 `one_inflight_motion.test.ts`）在 `run-all` 的全量编译里**重名冲突**
//    （TS2451 / TS2393）。`run-one.sh` 单文件编译不会暴露，只有 `run.sh`/`gate` 全量编译才红。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const CDIR: string = path.join(REPO, 'entry/src/main/ets/components');

/** 聊天流交互组件（见文件头：只扫不在他人手上的）。 */
const FILES: string[] = [
  'MessageRow.ets', 'LiveTailView.ets', 'MarkdownView.ets', 'AuthImage.ets',
  'SubAgentTree.ets', 'ToolVisual.ets',
];

/**
 * **按压值豁免**：大卡片有意用更柔的按压值（非 `PRESS_OPACITY` 的 0.6）——**不是**不统一。
 * `SubAgentTree` 用 `0.75`（大面卡片压到 0.6 过重），且该值**被既有测试钉死**
 * （`tools/tests/moment_polish.test.ts:78`）⇒ 此处豁免"必须引用 PRESS_OPACITY"这条。
 */
const PRESS_EXEMPT: string[] = ['SubAgentTree.ets'];

function countAll(s: string, re: RegExp): number {
  const m = s.match(re);
  return m === null ? 0 : m.length;
}

for (let i = 0; i < FILES.length; i++) {
  const f: string = FILES[i];
  const p: string = path.join(CDIR, f);
  let src: string;
  try {
    src = fs.readFileSync(p, 'utf8');
  } catch (e) {
    ok(`${f} 可读`, false, `读不到 ${p}`);
    continue;
  }
  const clicks: number = countAll(src, /\.onClick\(/g);
  const presses: number = countAll(src, /stateStyles\(/g);
  // ① 有可点元素 ⇒ 必须有按压反馈
  ok(`${f}：可点 ⇒ 有 press 反馈（onClick=${clicks}, stateStyles=${presses}）`,
    clicks === 0 || presses >= 1);
  // ② 有按压反馈 ⇒ 必须引用统一常量（不写死数值），或属**明示豁免**（大卡片柔压，见 PRESS_EXEMPT）
  ok(`${f}：press 走 PRESS_OPACITY（或明示豁免）`,
    presses === 0 || src.indexOf('PRESS_OPACITY') >= 0 || PRESS_EXEMPT.indexOf(f) >= 0);
  // ③ 不得写死按压不透明度
  ok(`${f}：无写死的 .opacity(0.6)`, src.indexOf('.opacity(0.6)') < 0);
}

console.log(`  interactive_feedback: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
