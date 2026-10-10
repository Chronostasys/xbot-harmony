/**
 * ② 气泡样式对齐 web —— 结构守卫（可视化无法单测，用「映射表 + 源码接线 + 判据」兜）。
 *
 * 用户 2026-10-10 ②：「现在这种气泡设计是不是有点丑？直接改一下」，要求**以 web 的类名为准
 * 逐条映射**（`core/bubble.ets` 是唯一映射表）。本用例钉死三件事：
 *   ① 映射表的**值**逐条等于 web class 换算值（rounded-2xl=16 / rounded-br-sm=2 /
 *      px-3.5=14 / py-2=8 / max-w-[85%] / .iter-block margin-top=4 / px-1=4 /
 *      py-1.5=6 / gap-1=4）；
 *   ② 组件**源码**确实引用映射表（不是散落的魔法数），且助手容器**不带** web 没有的
 *      chrome（底色/边框/圆角/阴影 —— web `AssistantMessage` 只有 `px-1`）；
 *   ③ 结构不变量：**只有一个气泡容器**（在飞块 `LiveIterationBlock` 在 `AssistantBlock`
 *      内部），且**不存在可见内容为 0 的 committed 气泡**（`build()` 有 `isEmptyBubble` 守卫）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { BUBBLE, withAlpha, userBubbleBg } from '../../entry/src/main/ets/core/bubble';
import { darkPalette, lightPalette } from '../../entry/src/main/ets/core/theme';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${label}: ${detail}`); }
}

function readSrc(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..', '..', '..');   // <repo>/tools/tests/.out/js → 4 级
  return fs.readFileSync(path.join(root, rel), 'utf-8');
}

console.log('\n▶ ② 气泡样式对齐 web（映射表 + 源码接线 + 结构守卫）');

// ── Part 1：映射表值 == web class 换算 ─────────────────────────────────────
const M = BUBBLE;
check('rounded-2xl(1rem)=16', M.userRadiusAll === 16, `userRadiusAll=${M.userRadiusAll}`);
check('rounded-br-sm(0.125rem)=2', M.userRadiusBR === 2, `userRadiusBR=${M.userRadiusBR}`);
check('px-3.5(0.875rem)=14', M.userPadX === 14, `userPadX=${M.userPadX}`);
check('py-2(0.5rem)=8', M.userPadY === 8, `userPadY=${M.userPadY}`);
check('bg-accent/15 = 0.15', M.userBubbleAlpha === 0.15, `userBubbleAlpha=${M.userBubbleAlpha}`);
check('max-w-[85%] = 85', M.userMaxWidthPct === 85, `userMaxWidthPct=${M.userMaxWidthPct}`);
check('px-1(0.25rem)=4', M.assistantPadX === 4, `assistantPadX=${M.assistantPadX}`);
check('.iter-block margin-top(0.25rem)=4', M.iterGap === 4, `iterGap=${M.iterGap}`);
check('gap-1(0.25rem)=4', M.blockInnerGap === 4, `blockInnerGap=${M.blockInnerGap}`);
check('py-1.5(0.375rem)=6', M.rowPadY === 6, `rowPadY=${M.rowPadY}`);

const r = {
  topLeft: M.userRadiusAll, topRight: M.userRadiusAll,
  bottomLeft: M.userRadiusAll, bottomRight: M.userRadiusBR,
};
check('用户气泡圆角 = 四角 16 / 右下 2',
  r.topLeft === 16 && r.topRight === 16 && r.bottomLeft === 16 && r.bottomRight === 2,
  JSON.stringify(r));

// withAlpha：'#7C3AED' @15% → '#267C3AED'（ARGB）
check('withAlpha(#7C3AED,0.15)=#267C3AED', withAlpha('#7C3AED', 0.15) === '#267C3AED',
  withAlpha('#7C3AED', 0.15));
check('withAlpha 边界（alpha=1）', withAlpha('#ABCDEF', 1) === '#FFABCDEF', withAlpha('#ABCDEF', 1));
check('userBubbleBg = 主题 accent @15%',
  userBubbleBg(darkPalette()) === withAlpha(darkPalette().accent, 0.15)
  && userBubbleBg(lightPalette()) === withAlpha(lightPalette().accent, 0.15),
  `${userBubbleBg(darkPalette())}`);

// ── Part 2：源码接线（组件引用映射表，不散落魔法数）─────────────────────────
const userSrc: string = readSrc('entry/src/main/ets/components/UserBubble.ets');
const rowSrc: string = readSrc('entry/src/main/ets/components/MessageRow.ets');
const tailSrc: string = readSrc('entry/src/main/ets/components/LiveTailView.ets');

check('UserBubble 引用映射表 userPadX/userPadY',
  /padding\(\{[\s\S]*?BUBBLE\.userPadX[\s\S]*?BUBBLE\.userPadY/.test(userSrc), '未用映射表');
check('UserBubble 引用映射表 maxWidth + radius + 底色',
  userSrc.includes('BUBBLE.userMaxWidthPct') && userSrc.includes('BUBBLE.userRadiusAll')
  && userSrc.includes('BUBBLE.userRadiusBR')
  && userSrc.includes('userBubbleBg('), 'user 气泡未走映射表');
check('UserBubble 外层 `px-1`/`py-1.5`（assistantPadX/rowPadY）',
  userSrc.includes('BUBBLE.assistantPadX') && userSrc.includes('BUBBLE.rowPadY'), '外层间距未对齐');

// 助手容器：web `AssistantMessage` = `px-1`，**无** chrome。断言 AssistantBlock 的容器
// 不再有 backgroundColor/border/shadow/borderRadius（只允许 padding/margin）。
const abStart: number = rowSrc.indexOf('AssistantBlock() {');
const abEnd: number = rowSrc.indexOf('@Builder\n  LiveIterationBlock()');
const abBody: string = (abStart >= 0 && abEnd > abStart) ? rowSrc.slice(abStart, abEnd) : '';
check('AssistantBlock 存在且可定位', abBody.length > 0, '找不到 AssistantBlock 主体');
check('助手容器无底色（对齐 web 无气泡 chrome）', !abBody.includes('.backgroundColor('),
  '助手容器仍有 backgroundColor —— web AssistantMessage 没有');
check('助手容器无边框', !/\.border\(\{/.test(abBody), '助手容器仍有 border');
check('助手容器无圆角', !abBody.includes('.borderRadius('), '助手容器仍有 borderRadius');
check('助手容器无阴影', !abBody.includes('.shadow('), '助手容器仍有 shadow');
check('助手容器 padding/margin 取映射表（px-1 / py-1.5）',
  abBody.includes('BUBBLE.assistantPadX') && abBody.includes('BUBBLE.rowPadY'),
  '助手容器间距未走映射表');

// 迭代块间距：`.iter-block{margin-top:0.25rem}` → IterationBlock/LiveIterationBlock 取 iterGap
check('IterationBlock 取 iterGap（.iter-block margin-top）',
  (rowSrc.match(/BUBBLE\.iterGap/g) || []).length >= 2, '迭代块间距未走映射表（应 ≥2 处）');
check('LiveTailView 内部 gap-1 取 blockInnerGap', tailSrc.includes('BUBBLE.blockInnerGap'),
  'LiveIteration 内部间距未对齐 web gap-1');

// ── Part 3：结构不变量（单一气泡容器 / 无空 committed 气泡）───────────────────
check('在飞块在**同一个** AssistantBlock 内（不出现第二个气泡）',
  abBody.includes('this.LiveIterationBlock()'),
  'LiveIterationBlock 不在 AssistantBlock 内 —— 会被渲染成第二个气泡');

// 在飞块自身**不带** chrome（否则就是第二个气泡）
const lbStart: number = rowSrc.indexOf('LiveIterationBlock() {');
const lbEnd: number = rowSrc.indexOf('@Builder\n  IterationBlock(');
const lbBody: string = (lbStart >= 0 && lbEnd > lbStart) ? rowSrc.slice(lbStart, lbEnd) : '';
check('在飞块无自身 chrome（不是第二个气泡）',
  lbBody.length > 0 && !lbBody.includes('.backgroundColor(') && !lbBody.includes('.borderRadius(')
  && !/\.border\(\{/.test(lbBody) && !lbBody.includes('.shadow('),
  '在飞块自带 chrome ⇒ 独立气泡');

// 不存在"可见内容为 0 的 committed 气泡"：build() 必须有 isEmptyBubble 守卫
const buildIdx: number = rowSrc.indexOf('build() {');
const buildBody: string = buildIdx >= 0 ? rowSrc.slice(buildIdx) : '';
check('committed 行有 isEmptyBubble 守卫（无空气泡）',
  /if\s*\(\s*!this\.isEmptyBubble\(\)\s*\)/.test(buildBody)
  && /isEmptyBubble\(\)\s*:\s*boolean[\s\S]*?rowIsEmpty\(this\.row\)/.test(rowSrc),
  'build() 缺少空气泡守卫或 isEmptyBubble 未与 rowIsEmpty 同源');

console.log(`\n  bubble_style: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
