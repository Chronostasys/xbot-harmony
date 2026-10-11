/**
 * **消息行入场态 · 可读性地板**门禁（用户实证缺陷 2026-10-11，最高优先）。
 *
 * ── 缺陷（用户原话：白/浅色主题下"消息正文 ≈1.2:1，看不清"）─────────────────────
 *  真机截图（极简白主题，1320×2848）实测：**同一帧里**
 *    · 消息**正文**（含 GFM 表格）最暗 `#D4D4D6` 压底 `#F2F2F2` ⇒ **1.32:1**
 *      （≈ `textPrimary` 以 **13%** 不透明度合成 —— 正是"入场动画卡在半路"的取值）；
 *    · 同一条消息的**其它块**（如 `## 这张表读出来两件事`）`#000000` ⇒ 21:1 正常。
 *  根因：`components/MessageRow.ets` 旧实现把**静息态**写成 `.opacity(entered ? 1 : 0)`
 *  （`entered` 初始 `false`），靠 `.onAppear` 里的 `animateTo` 把它拉起来
 *  ⇒ **可读性成了动画的函数**：`onAppear` 未触发 / 动画被后台冻结 / 20Hz 流式重建打断
 *  ⇒ 正文永久停在低不透明度。
 *  web 权威（`web/src/index.css:683-714`）**没有**这个毛病：`.animate-msg-in > *` 用 CSS
 *  `@keyframes`，元素自身 `opacity` 仍是 1、关键帧**没有** `forwards` ⇒ 动画没跑/被打断就停在 1。
 *
 * ── 判据（阈值一个都没放宽）────────────────────────────────────────────────────
 *  ① **地板上限**：行内容在**静息**不透明度下，正文对**该主题画布**必须 ≥ 4.5:1（全部 5 套主题）；
 *  ② **纯逻辑**：`core/msgentry.ets` 的 `entryRestOpacity()` 必须是唯一的静息出口（= 1）；
 *  ③ **源码契约**：`MessageRow.ets` 的行内容不透明度**必须**走 `entryRestOpacity()`，
 *     且**不得**存在"状态位门控不透明度"（`.opacity(cond ? 1 : 0)` / `@State entered`）；
 *     入场**必须**是「出现过渡」（`.transition(this.entryTransition())`）。
 *
 * ── mutation 自证（本文件内联执行，不是文档里的一句话）──────────────────────────
 *  · §C：把静息不透明度注入成 `0`（旧实现）/ `0.13`（用户实测值）⇒ **必须红**；
 *  · §E：把 `MessageRow.ets` 的真实源码注入成"旧实现形态"⇒ **§D 的判据必须红**；
 *        同一副本不注入 ⇒ 必须绿。这就是"注入『entered 永不置 true』必须红"的机械证明。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { Palette, paletteOf, ALL_THEMES, contrastRatio, compositeOver } from '../../entry/src/main/ets/core/theme';
import {
  ENTRY_FROM_OPACITY, ENTRY_FROM_DY, ENTRY_REST_OPACITY, BODY_CONTRAST_FLOOR,
  entryAnimates, entryRestOpacity, entryStartOpacity, entryStartDy, withOpacity, bodyReadableAt,
} from '../../entry/src/main/ets/core/msgentry';
import { MOTION_MSG_IN_MS, MOTION_SPRING_CSS, springBezier } from '../../entry/src/main/ets/core/motion';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(`${name}（got=${JSON.stringify(got)} want=${JSON.stringify(want)}）`,
    JSON.stringify(got) === JSON.stringify(want));
}

// ── §A 纯逻辑契约：静息态 = 可读；起始态 = web 的 from ──────────────────────────────
console.log('\n▶ §A core/msgentry.ets 纯逻辑契约');
eq('静息不透明度 = 1（可读性地板）', entryRestOpacity(), 1);
eq('静息常量与出口同值', ENTRY_REST_OPACITY, entryRestOpacity());
eq('起始不透明度 = 0（web `@keyframes msgIn` 的 from）', entryStartOpacity(), ENTRY_FROM_OPACITY);
eq('起始下沉 = 4vp（web `translateY(4px)`）', entryStartDy(), ENTRY_FROM_DY);
ok('只有 live 行播入场（历史行不闪入）', entryAnimates(true) === true && entryAnimates(false) === false);
ok('起始态**绝不等于**静息态（否则入场无意义；也确保"抓不到起始态"不会伪装成可读）',
  entryStartOpacity() !== entryRestOpacity());
eq('`withOpacity` 生成 ArkUI 认的 `#AARRGGBB`', withOpacity('#0F172A', 1), '#FF0F172A');
eq('`withOpacity` 半透明（13% ≈ 0x21）', withOpacity('#0F172A', 0.13), '#210F172A');

// ── §B 跨主题：静息不透明度下正文必须达 4.5:1 ────────────────────────────────────
console.log('\n▶ §B 静息态正文对比度地板（5 套主题 × 正文/画布）');
let minRest = 99, minRestTheme = '';
for (let i = 0; i < ALL_THEMES.length; i++) {
  const t: string = ALL_THEMES[i];
  const p: Palette = paletteOf(t);
  const readable: boolean = bodyReadableAt(p.textPrimary, p.surface, entryRestOpacity(), contrastRatio, compositeOver);
  const cr: number = contrastRatio(p.textPrimary, p.surface);
  if (cr < minRest) { minRest = cr; minRestTheme = t; }
  ok(`[${t}] 静息不透明度 ${entryRestOpacity()} 下 正文/画布 = ${cr.toFixed(2)} ≥ ${BODY_CONTRAST_FLOOR}`, readable);
}
console.log(`  最紧：${minRestTheme} = ${minRest.toFixed(2)}:1`);

// ── §C mutation 自证：静息态被写成 0 / 半路 ⇒ 必须红 ──────────────────────────────
console.log('\n▶ §C mutation：静息态写成 0（旧实现）与 0.13（用户实测）必须判红');
let allRedAtZero = true, allRedAtHalfway = true;
for (let i = 0; i < ALL_THEMES.length; i++) {
  const p: Palette = paletteOf(ALL_THEMES[i]);
  if (bodyReadableAt(p.textPrimary, p.surface, 0, contrastRatio, compositeOver)) { allRedAtZero = false; }
  if (bodyReadableAt(p.textPrimary, p.surface, 0.13, contrastRatio, compositeOver)) { allRedAtHalfway = false; }
}
ok('静息态 = 0（旧实现的 `entered=false`）⇒ 全主题判红（"看不见"）', allRedAtZero);
ok('静息态 = 0.13（用户截图实测 ≈13%）⇒ 全主题判红（< 4.5:1）', allRedAtHalfway);
// 复核：用户实测值本身算出来是多少（对齐报告里的数字）
{
  const p: Palette = paletteOf('porcelain');
  const eff: string = compositeOver(withOpacity(p.textPrimary, 0.13), p.surface);
  console.log(`  porcelain: 正文 @13% 合成 = ${eff}，对 surface ${p.surface} 实测 ${contrastRatio(eff, p.surface).toFixed(2)}:1`);
}

// ── §D MessageRow 源码契约（组件不进离线 harness ⇒ 读真实源码断言接线）──────────────
console.log('\n▶ §D MessageRow.ets 源码契约');
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const rowSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'MessageRow.ets'), 'utf-8');

/**
 * 判据本体（**纯函数**，§E 会把它指向"注入版源码"做 mutation 自证）。
 * ⛔ 只取**调用片段**（`grep -o` 风格）、**先剥注释** —— 不猜"行里第一个引号"、不把
 *   "注释里记录的旧写法"当违规（AGENTS.md 判据纪律；本判据第一版就踩过这个假红）。
 */
function stripComments(src: string): string {
  const out: string[] = [];
  const lines: string[] = src.split('\n');
  let inBlock: boolean = false;
  for (let i = 0; i < lines.length; i++) {
    let ln: string = lines[i];
    const t: string = ln.trim();
    if (inBlock) {
      const end: number = ln.indexOf('*/');
      if (end < 0) { continue; }
      inBlock = false;
      ln = ln.substring(end + 2);
      if (ln.trim().length === 0) { continue; }
      out.push(ln);
      continue;
    }
    if (t.indexOf('/*') === 0) {
      if (t.indexOf('*/') < 0) { inBlock = true; }
      continue;
    }
    if (t.indexOf('//') === 0 || t.indexOf('*') === 0) { continue; }   // 全行注释（含块注释体）
    out.push(ln);
  }
  return out.join('\n');
}

function rowEntryIsFailSafe(rawSrc: string): boolean {
  const src: string = stripComments(rawSrc);
  // ① 必须存在"静息不透明度走纯逻辑出口"的那一次调用
  if (src.indexOf('.opacity(entryRestOpacity())') < 0) { return false; }
  // ② 必须存在「出现过渡」——入场的唯一承载
  if (src.indexOf('.transition(this.entryTransition())') < 0) { return false; }
  // ③ ⛔ 不得存在"状态位门控不透明度"（旧的 `.opacity(cond ? 1 : 0)` 反模式）
  const gated: RegExpMatchArray | null = src.match(/\.opacity\([^)]*\?\s*1\s*:\s*0\s*\)/g);
  if (gated !== null && gated.length > 0) { return false; }
  // ④ ⛔ 不得再出现 `entered` 这个状态位（旧实现的载体）
  if (/@State\s+entered\b/.test(src)) { return false; }
  return true;
}

const rowCode: string = stripComments(rowSrc);

ok('① 行内容不透明度走 `entryRestOpacity()`（唯一静息出口）',
  rowCode.indexOf('.opacity(entryRestOpacity())') >= 0);
ok('② 入场走「出现过渡」`.transition(this.entryTransition())`',
  rowCode.indexOf('.transition(this.entryTransition())') >= 0);
ok('③ 无「状态位门控不透明度」反模式（`.opacity(x ? 1 : 0)`）',
  (rowCode.match(/\.opacity\([^)]*\?\s*1\s*:\s*0\s*\)/g) || []).length === 0);
ok('④ 无 `@State entered`（旧的隐藏态载体）', !/@State\s+entered\b/.test(rowCode));
ok('⑤ `entryTransition` 只对 live 行生效（历史行恒等过渡，不逐行闪入）',
  rowCode.indexOf('entryAnimates(this.row.isLive)') >= 0 && rowCode.indexOf('TransitionEffect.IDENTITY') >= 0);
ok('★★ 判据本体对**真实源码**判定为绿（防"白绿防线"）', rowEntryIsFailSafe(rowSrc) === true);

// ── §E mutation 自证：注入"entered 永不置 true"（旧实现形态）⇒ §D 必须红 ─────────────
console.log('\n▶ §E mutation：把真实源码注入成旧实现形态 ⇒ §D 必须判红');
const injected: string = rowSrc
  .replace('.opacity(entryRestOpacity())', '.opacity(this.entered ? 1 : 0)')
  .replace('.transition(this.entryTransition())', '.translate({ y: this.entered ? 0 : 4 })')
  + '\n@State entered: boolean = false;\n';
ok('注入后 §D③ 变红（`entered ? 1 : 0` 门控）',
  (stripComments(injected).match(/\.opacity\([^)]*\?\s*1\s*:\s*0\s*\)/g) || []).length > 0);
ok('注入后 §D④ 变红（`@State entered` 复活）', /@State\s+entered\b/.test(stripComments(injected)));
ok('注入后 §D 判据本体整体判红', rowEntryIsFailSafe(injected) === false);
ok('未注入的同一副本仍判绿（排除"判据恒红"的假红）', rowEntryIsFailSafe(rowSrc) === true);

// ── §F 入场过渡**参数**与 web `msgIn` 对齐（web 数字作期望值）──────────────────────────
// 来源（权威）：`/Users/bobli/src/xbot/web/src/index.css:683-714`，原文：
//   .animate-msg-in > * { animation: msgIn 200ms cubic-bezier(0.34, 1.56, 0.64, 1); }
//   @keyframes msgIn {
//     from { opacity: 0; transform: translateY(4px); }
//     to   { opacity: 1; transform: none; }
//   }
// ⇒ 200ms · spring(0.34,1.56,0.64,1) · opacity 0→1 · translateY 4px→0 · **无 `forwards`**（天然 fail-safe）。
console.log('\n▶ §F 入场过渡参数对齐 web `msgIn`（index.css:683-714）');
eq('① 时长 = 200ms（web `msgIn 200ms`）', MOTION_MSG_IN_MS, 200);
{
  const b = springBezier();
  eq('② 曲线控制点 = web `cubic-bezier(0.34,1.56,0.64,1)`', [b.x1, b.y1, b.x2, b.y2], [0.34, 1.56, 0.64, 1]);
  eq('③ 曲线 CSS 文本同源（`tokens.EASE_SPRING_CSS`）', MOTION_SPRING_CSS, 'cubic-bezier(0.34, 1.56, 0.64, 1)');
}
const animSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'anim.ets'), 'utf-8');
const animCode: string = stripComments(animSrc);
ok('④ `animMsgIn()` 走 `MOTION_MSG_IN_MS` + `springCurve()`（⛔ 不自造时长/曲线字面量）',
  /function animMsgIn\(\)[\s\S]{0,160}?duration:\s*MOTION_MSG_IN_MS/.test(animCode)
  && /function animMsgIn\(\)[\s\S]{0,160}?curve:\s*springCurve\(\)/.test(animCode));

/** 抽 `private entryTransition()` 的方法体（花括号到行尾 `\n  }`）。 */
function transitionBody(src: string): string {
  const i: number = src.indexOf('private entryTransition');
  if (i < 0) { return ''; }
  const j: number = src.indexOf('\n  }', i);
  return j > i ? src.substring(i, j + 4) : src.substring(i, i + 400);
}
/** 判据本体（纯函数；§G 指向"注入版"做 mutation）：组合必须 = web 的两条（opacity ⊕ translateY），
 *  且两条都走**同一** `animMsgIn()` 工厂（⛔ 不许出现自造 `AnimateParam` 的 `duration:` 字面量）。 */
function transitionAlignsWeb(src: string): boolean {
  const t: string = transitionBody(src);
  return t.indexOf('TransitionEffect.OPACITY') >= 0
    && t.indexOf('TransitionEffect.translate({ y: entryStartDy() })') >= 0
    && (t.match(/animMsgIn\(\)/g) || []).length >= 2
    && t.indexOf('duration:') < 0;
}
const transBody: string = transitionBody(rowCode);
ok('★F0 零扫描判红：抽到 `entryTransition()` 方法体（长度 > 0）', transBody.length > 0);
ok('⑤ 组合 = `TransitionEffect.OPACITY` ⊕ `translate({y: entryStartDy()})`（web 的 opacity + translateY）',
  transBody.indexOf('TransitionEffect.OPACITY') >= 0
  && transBody.indexOf('TransitionEffect.translate({ y: entryStartDy() })') >= 0);
ok('⑥ 两条过渡共用**同一** `animMsgIn()` 工厂 + 无自造 `duration:` 字面量',
  (transBody.match(/animMsgIn\(\)/g) || []).length >= 2 && transBody.indexOf('duration:') < 0);
ok('★★ 判据本体 `transitionAlignsWeb` 对**真实源码**为绿（防"白绿防线"）', transitionAlignsWeb(rowCode) === true);

// ── §G mutation 自证（§F）：过渡参数漂移 / 静息不可见 ⇒ 必红 ─────────────────────────
console.log('\n▶ §G mutation：过渡自造字面量 / 静息改 0 ⇒ §F / §D 必红');
{
  const badLiteral: string = rowCode.split('animMsgIn()').join('{ duration: 300, curve: Curve.Friction }');
  ok('★G1 mutation：过渡改自造 `AnimateParam` 字面量 ⇒ `transitionAlignsWeb` 必红',
    transitionAlignsWeb(badLiteral) === false);
  const badInvisible: string = rowCode.replace('.opacity(entryRestOpacity())', '.opacity(0)');
  ok('★G2 mutation：静息写成 `.opacity(0)`（不可见）⇒ `rowEntryIsFailSafe` 必红',
    rowEntryIsFailSafe(badInvisible) === false);
  const badNoTranslate: string = rowCode.replace(
    'TransitionEffect.translate({ y: entryStartDy() })', 'TransitionEffect.translate({ y: 0 })');
  ok('★G3 mutation：`translateY` 起点改成 0（丢 web 的 4px）⇒ `transitionAlignsWeb` 必红',
    transitionAlignsWeb(badNoTranslate) === false);
}

// ── 摘要 ─────────────────────────────────────────────────────────────────────
console.log('\n▼ 摘要');
console.log(`  静息不透明度 = ${entryRestOpacity()}（可读性地板）；起始 = ${entryStartOpacity()} / ${entryStartDy()}vp`);
console.log(`  5 套主题静息正文对比度最紧 = ${minRest.toFixed(2)}:1（${minRestTheme}）≥ ${BODY_CONTRAST_FLOOR}`);
console.log(`  旧实现静息态 0 / 半路 0.13 ⇒ 全主题 < 4.5:1（§C 已机械证明）`);

if (fail > 0) {
  console.log(`\n  msg_entry_contrast: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n  msg_entry_contrast: ${pass} passed, 0 failed`);
process.exit(0);

export {};
