/**
 * bubbleview.test.ts —— 用户气泡"面"的**唯一判据**（`core/bubbleview.ets`）+ 源码接线守卫。
 *
 * 修的两处**结构性错误**（web 权威 `web/src/components/agent/UserMessage.tsx`）：
 *   ① **底色两个打架的来源**：映射表 `core/bubble.ets` 给 `bg-accent/15`（对齐 web `:272`），
 *      组件却**又**叠了一层不透明 `linearGradient`（`accent→accentSoft`）把它盖住
 *      ⇒ 真机呈"饱和 accent 色块"。修法：底色**收敛到一处**（`userBubbleFace().bg`）。
 *   ② **文字色角色用错**：用 `onAccent`（角色 = "实心 accent 之上的字"），而真实底色是
 *      **淡色**（accent @15%）⇒ 角色不匹配。修法：用与淡色底配对的 `textPrimary`（web `:272`）。
 *
 * ── 判别力自证（mutation，各自必红）─────────────────────────────────────────────
 *   M1 把 `userBubbleFace` 的 `textColor` 改回 `p.onAccent`      ⇒ ②「textColor==textPrimary」+「≠onAccent」红；
 *   M2 把 `bg` 改成 `p.accent`（不透明实心）                      ⇒ ①「bg==accent@15%」红；
 *   M3 在 `UserBubble.ets` 里重新加回 `.linearGradient({...})`    ⇒ 源码守卫「无 linearGradient」红；
 *   M4 把 `.fontColor(this.face().textColor)` 改回 `.fontColor(this.pal().onAccent)` ⇒ 源码守卫红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { userBubbleFace, UserBubbleFace } from '../../entry/src/main/ets/core/bubbleview';
import {
  ALL_THEMES, Palette, paletteOf, contrastRatio, compositeOver,
} from '../../entry/src/main/ets/core/theme';
import { withAlpha } from '../../entry/src/main/ets/core/bubble';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function readSrc(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..', '..', '..');   // <repo>/tools/tests/.out.$$/js → 4 级
  return fs.readFileSync(path.join(root, rel), 'utf-8');
}

/** 剥掉注释再判源码 —— 否则注释里提到 API 名会造成**假阳性**（本轮就踩到一次）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

console.log('\n▶ 用户气泡"面"唯一判据（core/bubbleview）+ 源码接线守卫');

// ── Part 1：逐主题（含浅色 porcelain / light）断言"底色一处 + 文字角色配对" ──────────
for (let i = 0; i < ALL_THEMES.length; i++) {
  const theme: string = ALL_THEMES[i];
  const p: Palette = paletteOf(theme);
  const f: UserBubbleFace = userBubbleFace(p);

  // ① 底色 = accent @15%（唯一来源，对齐 web `bg-accent/15`）
  ok(`${theme}: bg == withAlpha(accent, 0.15)`, f.bg === withAlpha(p.accent, 0.15));

  // ② 文字色 = textPrimary（对齐 web `text-text-primary`）——**不是** onAccent
  ok(`${theme}: textColor == textPrimary`, f.textColor === p.textPrimary);
  ok(`${theme}: textColor != onAccent（角色正确）`, f.textColor !== p.onAccent);

  // ③ 可读性：文字压在**合成后**的淡色底上必须 ≥ 4.5:1（WCAG AA 正文）
  const onCanvas: string = compositeOver(f.bg, p.appBg);
  const ratio: number = contrastRatio(f.textColor, onCanvas);
  ok(`${theme}: 文字/合成底 对比度 ≥ 4.5（实测 ${ratio.toFixed(2)}）`, ratio >= 4.5);

  // ④ 旧行为的反面：底不能是**不透明**的实心 accent（那正是"饱和色块"的来源）
  ok(`${theme}: bg != 实心 accent（alpha 不是 FF）`, f.bg.charAt(0) === '#' && f.bg.substring(1, 3) !== 'FF');
}

// ── Part 2：源码接线守卫（组件只消费纯函数 / 无渐变 / 无 onAccent）──────────────────
const userSrc: string = readSrc('entry/src/main/ets/components/UserBubble.ets');
// 剥注释再判结构：注释里提到被禁 API 名不应造成假阳性
const userCode: string = stripComments(userSrc);

ok('组件走唯一判据 userBubbleFace(', /userBubbleFace\(/.test(userCode));
ok('底色来自 face().bg（不是散落的 userBubbleBg）',
  userCode.includes('.backgroundColor(this.face().bg)') && !userCode.includes('userBubbleBg('));
ok('文字色来自 face().textColor', /\.fontColor\(\s*this\.face\(\)\.textColor\s*\)/.test(userCode));

// ① 结构守卫：不得再叠加渐变（web 气泡没有渐变）
ok('组件无 .linearGradient（不许两处底叠加）', !/\.linearGradient\(/.test(userCode));
// ② 角色守卫：不得再把 onAccent 当气泡字色（看的是代码里的 `.onAccent`，注释不算）
ok('组件不再用 .onAccent 作字色', !/\.onAccent\b/.test(userCode));

console.log(`\n  bubbleview: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
