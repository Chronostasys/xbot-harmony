/**
 * 消息流主体「骨肉」观感的**契约测试**（波5k）—— 思考行 / 正文 / 上下文环 / 工具浮层。
 *
 * 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译，`components/**`
 * 不进这套 harness（无法 import）。本仓既有先例：`inflight_language.test.ts` 同法读源码做
 * 形态断言。**这些断言必须"能被证伪"** —— 每条都钉住一个**具体数值/字面量**，回退对应改动即红
 * （见提交信息里的 mutation 实测输出）。
 *
 * 每条断言都带 **web 权威基准 file:line**（`/Users/bobli/src/xbot/web`），
 * 数值不是"看着顺眼"，而是"web 同构组件/`.markdown-body` 就是这么写的"。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { R_SM, R_MD, SP_1, SP_2, SP_3, FS_CAPTION } from '../../entry/src/main/ets/core/tokens';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const COMP = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components');
const thinkSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'ThinkingLine.ets'), 'utf-8');
const mdSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'MarkdownView.ets'), 'utf-8');
const ringSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'ContextRing.ets'), 'utf-8');
const popSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'ToolPopover.ets'), 'utf-8');

// ── 0. token 前提（本文件引用的每个 token 都必须是它声明的值 —— 换 token 值即红）──────────
eq('R_MD = 6（web `rounded-md` = 6px）', R_MD, 6);
eq('R_SM = 4（web `rounded` = 4px）', R_SM, 4);
eq('SP_1 = 4（Tailwind 1 = 4px）', SP_1, 4);
eq('SP_2 = 8（Tailwind 2 = 8px）', SP_2, 8);
eq('SP_3 = 12（Tailwind 3 = 12px）', SP_3, 12);

// ════════════════════════════════════════════════════════════════════════════
// ① 思考行 `ThinkingLine.ets`  ↔  web `ThinkingLine.tsx`
// ════════════════════════════════════════════════════════════════════════════
// 展开体：web `ThinkingLine.tsx:72` `<div className="mt-1 border-l-2 pl-2.5 ...">`
has(thinkSrc, '.margin({ top: SP_1 })',
  '展开体上间距 = SP_1(4)（web `:72` `mt-1`）');
has(thinkSrc, '.padding({ left: 10, right: 0, top: 0, bottom: 0 })',
  '展开体左缩进 = 10（web `:72` `pl-2.5`）+ 去掉 web 没有的上下内边距');
// 静息态不得覆盖动态 opacity：web 按钮静息态无 opacity 规则（`:63` 只有 hover/active 过渡）
has(thinkSrc, '.stateStyles({ pressed: { .opacity(0.6) } })',
  '按压态唯一覆盖 opacity（与 web `:active` 同语义）');
hasNot(thinkSrc, 'normal: { .opacity(1) }',
  '⛔ 静息态不写 `normal.opacity`（本行已无动态值，仍只写 pressed —— 与 web 一致）');
// 2026-10-11 波：思考行**静态**（去呼吸）—— 同一时刻只有一个在飞动效 = 光球。
// 旧 wave5e 的 `.opacity(0.72 + 0.28*emphasis)` 呼吸与光球同屏 ⇒ 用户报「两个思考 spinner」。
hasNot(thinkSrc, '0.72 + 0.28',
  '⛔ 思考行不再呼吸（无 0.72+0.28 脉搏）——「同一时刻只有一个动效」的核心判据');
hasNot(thinkSrc, 'this.emphasis',
  '思考行不再持有 emphasis 呼吸权重（动效唯一属于光球）');
has(thinkSrc, '.fontColor(this.live ? paletteOf(this.theme).accentSoft : paletteOf(this.theme).textMuted)',
  '领读仅以**颜色**（accentSoft）表达，不承载动效');

// ════════════════════════════════════════════════════════════════════════════
// ② 正文 `MarkdownView.ets`  ↔  web `MarkdownRenderer.tsx` + `index.css .markdown-body`
// ════════════════════════════════════════════════════════════════════════════
// 代码块视觉 = **设计系统值**（`docs/WEB-ALIGNMENT.md §16.2 #13`：功能以 web 为权威、**视觉以设计系统为权威**
//   ⇒ 底 = `surface.well`(sunken) + 圆角 = `RADIUS_CARD`；旧的 web `rounded-md`(R_MD) 期望值按裁决**作废**）。
has(mdSrc, '.backgroundColor(wellOf(this.pal()))\n    .borderRadius(RADIUS_CARD)',
  '代码块底 = surface.well（sunken）+ 圆角 = RADIUS_CARD（§16.2 #13）');
has(mdSrc, '.borderRadius({ topLeft: RADIUS_CARD, topRight: RADIUS_CARD })',
  '代码块语言条上圆角 = RADIUS_CARD（与块体同档，§16.2 #13）');
// 语言标签：web `:214` `font-mono text-[11px]` + `index.css:199 --md-code-lang-text = var(--text-muted)`
has(mdSrc, "          .fontSize(11)\n          .fontFamily('monospace')\n          .fontColor(this.pal().textMuted)",
  '语言标签 = 等宽 11 + textMuted（web `:214` + `index.css:199`）');
// 引用块：web `index.css:566` `padding: 0 0.75em` / `:569` `border-radius: 0 4px 4px 0`
//          `:190/567` 文字 = text-secondary
has(mdSrc, '.padding({ left: 11, right: SP_3, top: SP_1, bottom: SP_1 })',
  '引用块内边距对齐 web `:566`（左右 12；上下给 SP_1 呼吸）');
has(mdSrc, '.borderRadius({ topRight: R_SM, bottomRight: R_SM })',
  '引用块只有右侧两角 4vp 圆角（web `:569` `0 4px 4px 0`）');
has(mdSrc, 'this.Inline(b.text, this.pal().textSecondary)',
  '引用正文 = textSecondary（web `:190/567`）—— 层次弱于正文');
has(mdSrc, 'export function inlineStyles(text: string, pal: Palette, mdTheme: string, baseColor?: string)',
  'inlineStyles 支持 baseColor（引用/正文分档的载体）');
has(mdSrc, 'st.color = baseColor !== undefined ? baseColor : pal.textPrimary;',
  'baseColor 只覆盖普通文字（行内码/链接各自分支不受影响）');
// 分隔线：web `index.css:583` `hr { margin: 1em 0 }`
has(mdSrc, '.margin({ top: SP_2, bottom: SP_2 })',
  '分隔线上下 = SP_2（web `:583` 1em≈14 ≈ 8 + Column space 6）');
hasNot(mdSrc, ".strokeWidth(1).margin({ top: 6, bottom: 6 })",
  '旧的"6/6 过挤"写法已移除（回退即红）');
// 表格：**故意不改**（web 表头底 = --bg-secondary = surface，原生若照搬会与卡片底同色而不可见）
ok('表格表头仍用 surfaceAlt（原生保可见性，非疏漏）',
  mdSrc.indexOf('.backgroundColor(this.pal().surfaceAlt)\n        .borderRadius({ topLeft: R_LG, topRight: R_LG })') >= 0);

// ════════════════════════════════════════════════════════════════════════════
// ③ 上下文环 `ContextRing.ets`  ↔  web `ContextRing.tsx`
// ════════════════════════════════════════════════════════════════════════════
has(ringSrc, ".fontFamily('monospace')",
  '浮层文案等宽（web `ContextRing.tsx:79` `className="font-mono"`）');
has(ringSrc, '.width(SP_5).height(SP_5)',
  '环 20vp（web `:47` `size-5`）');
has(ringSrc, '.width(SP_7).height(SP_7)',
  '点击热区 28vp（web `:45` `size-7`）');
// 环的字号用 FS_CAPTION（浮层文案 = 说明级）；这里顺带钉住常量存在
ok('浮层文案字号 = FS_CAPTION(12)', FS_CAPTION === 12);

// ════════════════════════════════════════════════════════════════════════════
// ④ 工具浮层 `ToolPopover.ets`  ↔  web `ToolCallBlock.tsx` / `FoldedToolGroup.tsx`
// ════════════════════════════════════════════════════════════════════════════
// 代码行 / 终端输出行：web `ToolCallBlock.tsx:66`（ArgsView）、`:98`（输出块）都是 `text-[12px]`
has(popSrc, ".fontSize(12)\n    .fontFamily('monospace')",
  '代码行等宽 12（web `ToolCallBlock.tsx:66`）');
has(popSrc, ".fontSize(12)\n      .fontFamily('monospace')",
  '终端输出行等宽 12（web `ToolCallBlock.tsx:98`）');
// 块内边距：web `px-2.5 py-1.5`（左右 10 / 上下 6）
eq('代码/输出块内边距出现 2 次（CodeBlock + OutBlock）',
  popSrc.split('.padding({ left: 10, right: 10, top: 6, bottom: 6 })').length - 1, 2);
hasNot(popSrc, '.constraintSize({ maxHeight: BODY_MAX_H })\n      .padding(SP_2)',
  '旧的"SP_2 四周等距"写法已移除（回退即红）');

if (fail > 0) {
  console.log(`  msgflow_visual: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  msgflow_visual: ${pass} passed, 0 failed`);
process.exit(0);
