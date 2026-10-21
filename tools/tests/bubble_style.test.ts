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

/**
 * **剥注释**（本仓约定：注释里记代码片段/色值是**允许且鼓励**的 ⇒ 判据扫源码前**必须**先剥，
 * 否则两个方向都错：禁串被注释提及 ⇒ **假红**；要求串只在注释里出现 ⇒ **假绿**）。
 * ⚠️ 保留换行 ⇒ 行号不漂移。
 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail: string): void {
  if (cond) { pass++; } else { fail++; 
// ── 剥注释的**判别力自证** ──────────────────────────────────────────────────────
{
  check('判别力：**注释里**的禁串被剥掉（不误红）',
    stripSrc('// .fontColor([this.pal().textMuted])').indexOf('.fontColor(') < 0, '');
  check('判别力：**代码里**的同一串仍在（不误绿）',
    stripSrc('const a = 1; .fontColor([this.pal().textMuted])').indexOf('.fontColor(') >= 0, '');
  check('判别力：剥注释**保留换行**（行号不漂移）',
    stripSrc('a\n// x\nb').split('\n').length === 3, '');
}

console.log(`  ✗ ${label}: ${detail}`); }
}

function readSrc(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..', '..', '..');   // <repo>/tools/tests/.out/js → 4 级
  return stripSrc(fs.readFileSync(path.join(root, rel), 'utf-8'));
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

// 内距/圆角/行带间距：2026-10-11 迁移到**语义令牌层** `core/design.ets`（等值迁移，
// 值 == 原映射表 `px-3.5 py-2` / `rounded-2xl` / `py-1.5`）⇒ 组件不再直接引用这些 BUBBLE 字段。
// 等值性由 `tools/tests/token_migration.test.ts` 逐行断言（本文件只守"接线形态"）。
check('UserBubble 内距走语义令牌 INSET_BUBBLE_X/Y',
  userSrc.includes('INSET_BUBBLE_X') && userSrc.includes('INSET_BUBBLE_Y'), '内距未走令牌');
check('UserBubble 四角圆角走 RADIUS_BUBBLE', userSrc.includes('RADIUS_BUBBLE'), '圆角未走令牌');
check('UserBubble 行带间距走 GAP_ROW_Y', userSrc.includes('GAP_ROW_Y'), '行带间距未走令牌');
check('UserBubble 仍走映射表 maxWidth / 右下角 / 助手外框',
  userSrc.includes('BUBBLE.userMaxWidthPct') && userSrc.includes('BUBBLE.userRadiusBR')
  && userSrc.includes('BUBBLE.assistantPadX'), 'user 气泡映射表字段缺失');
// 底色：2026-10-11 收敛为**唯一来源**（`core/bubbleview.ets` 的 `userBubbleFace()` →
// `userBubbleBg()`）。组件不再自己叠渐变/自己取底 ⇒ 断言"走唯一判据"而非"组件里出现 userBubbleBg"。
check('UserBubble 底色走唯一判据（core/bubbleview → userBubbleBg）',
  userSrc.includes('userBubbleFace(')
  && readSrc('entry/src/main/ets/core/bubbleview.ets').includes('userBubbleBg('),
  'user 气泡底色未收敛到唯一来源');

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

// ── Part 2b：用户气泡**内容定宽**（短消息自动收窄，对齐 web `flex` 内容定宽）──────────
// 真机缺陷（2026-10-12，/tmp/chat2.jpeg）：「只回复一个字：好」/「sleep40」等短消息的气泡**恒撑满
// `max-w-[85%]`**、不随内容收窄。根因 = markdown 分支 `Row{ Column{MarkdownView}.layoutWeight(1) }`
// ⇒ `MarkdownView` 根 + 段落 `Text` 的 `width('100%')` 必撑满。修法 = `MarkdownView.fitContent`
// 模式：根容器与行内正文改用 ArkUI 原生 `LayoutPolicy.wrapContent`（`width` 的
// `Length | LayoutPolicy` 重载，API 20+）——**随内容收窄**、上限由父 `constraintSize` 约束。
const mdSrc: string = readSrc('entry/src/main/ets/components/MarkdownView.ets');
check('MarkdownView 有 fitContent @Prop（内容定宽开关）',
  /@Prop\s+fitContent\s*:\s*boolean/.test(mdSrc), 'MarkdownView 缺 fitContent');
check('MarkdownView 用 LayoutPolicy.wrapContent 恰两处（根 + 行内正文）',
  (mdSrc.match(/LayoutPolicy\.wrapContent/g) || []).length === 2,
  `wrapContent 出现 ${(mdSrc.match(/LayoutPolicy\.wrapContent/g) || []).length} 次（应 2）`);
check('两处 wrapContent 都由 fitContent 三元门控（否则助手正文回归收窄）',
  (mdSrc.match(/this\.fitContent\s*\?\s*LayoutPolicy\.wrapContent\s*:\s*'100%'/g) || []).length === 2,
  'wrapContent 未由 fitContent 门控');
check('UserBubble 传 fitContent: this.fitWidth()（开启内容定宽）',
  userSrc.includes('fitContent: this.fitWidth()'), 'UserBubble 未开启内容定宽');
check('fitWidth 判据 = 全段落（含块级时撑满，防 wrapContent 折叠成 0）',
  /MdBlockKind\.Paragraph/.test(userSrc) && /parseMarkdownCached\(/.test(userSrc),
  'fitWidth 未按段落判据');

console.log(`\n  bubble_style: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
