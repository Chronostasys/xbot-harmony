/**
 * 目标⑤ B6 —— 代码块「复制」反馈落点统一为**品牌 toast** 判据（2026-10-11）。
 *
 * ── 缺口（`polish-audit` B6 / `docs/UI-AUDIT-CHECKLIST.md` B6 行）─────────────────────
 *   `components/MarkdownView.ets` 代码块「复制」走**系统** `promptAction.showToast`，而页面级复制走
 *   **自绘** `Toast`（`components/Toast.ets` 头注："取代系统 `promptAction.showToast`"）
 *   ⇒ **同一动作两种落点**，且系统 toast **不读** `pal()`/`effectsOf`（面/字/圆角/位置与设计系统不同族）。
 *
 * ── 判据（钉**形态 + 消费点计数**，⛔ 只钉"声明存在"是假绿）──────────────────────────
 *   ① **三跳闭合**（`onToast` 链）：`MarkdownView` 定义**且真调用** → `MessageRow`/`LiveTailView`
 *      **各真透传** → `Index.ets` **注入**页面品牌 toast（`this.toast(msg, TOAST_KIND_COPY)`）；
 *   ② **目的达成**：`MarkdownView.ets` 内 `promptAction` **计数归 0**（系统 toast 从该文件消失）；
 *   ③ **文案不变**：复制成功提示仍是 `copyLabel('复制', true)`（=「已复制」）—— 只改落点不改文案；
 *   ④ **零扫描判红** + **mutation 自证**（断任一跳 / 重新引入 promptAction ⇒ 各自必红）。
 *
 * ⚠️ 组件不进离线 harness（`run.sh` 只把 `core/**` 当纯 TS 编译）⇒ 沿用本仓既有先例
 *    （`polish_states_press.test.ts` / `msgnav_polish.test.ts`）读**真实源码**做形态断言。
 * ⚠️ 纯 TS（`export {}`）；结尾必须 `process.exit`。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; resolve(...parts: string[]): string };
declare const __dirname: string;
export {};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

const fsMod = require('fs');
const pathMod = require('path');

function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(p, 'entry/src/main/ets/components/MarkdownView.ets'))) { return p; }
  }
  return '';
}
const ROOT: string = findRoot();
/** 剥注释（同 `polish_states_press.test.ts`；否则本文件新写的文档注释会把 `promptAction` 当"仍在用"）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function read(rel: string): string {
  const p: string = pathMod.join(ROOT, rel);
  return fsMod.existsSync(p) ? stripComments(fsMod.readFileSync(p, 'utf-8')) : '';
}
function countOf(s: string, needle: string): number {
  return s.split(needle).length - 1;
}

// ── 检查函数（纯函数：给定源码 ⇒ 是否合规；mutation 直接喂改过的副本）────────────
/** 跳 1：`MarkdownView` 定义 `onToast` 且**真消费**（`this.onToast(...)` 调用点 ≥1 ⇒ 非死 prop）。 */
function checkHop1(md: string): boolean {
  return md.indexOf('onToast: (msg: string) => void = ') >= 0
    && countOf(md, 'this.onToast(') >= 1;
}
/** 目的：`MarkdownView.ets` 内系统 `promptAction` 计数 = 0（import + 调用都算）。 */
function checkNoSystemToast(md: string): boolean {
  return countOf(md, 'promptAction') === 0;
}
/** 文案不变：复制成功提示仍是 `copyLabel('复制', true)`。 */
function checkLabelUnchanged(md: string): boolean {
  return md.indexOf("this.onToast(copyLabel('复制', true))") >= 0;
}
/** 跳 2：`MessageRow`（≥3 处：2× MarkdownView + 1× LiveTailView）+ `LiveTailView`（≥1 处）真透传。 */
function checkHop2(mr: string, lt: string): boolean {
  return mr.indexOf('onToast: (msg: string) => void = ') >= 0
    && countOf(mr, 'onToast: this.onToast,') >= 3
    && lt.indexOf('onToast: (msg: string) => void = ') >= 0
    && countOf(lt, 'onToast: this.onToast,') >= 1;
}
/** 跳 3：`Index.ets` 在 ≥2 处 `MessageRowView` 注入页面**品牌 toast**（复制档）。 */
function checkHop3(ix: string): boolean {
  return countOf(ix, 'onToast: (msg: string) => {') >= 2
    && countOf(ix, 'this.toast(msg, TOAST_KIND_COPY)') >= 2;
}

// ── 载入真源 ─────────────────────────────────────────────────────────────────────
const MD: string = read('entry/src/main/ets/components/MarkdownView.ets');
const MR: string = read('entry/src/main/ets/components/MessageRow.ets');
const LT: string = read('entry/src/main/ets/components/LiveTailView.ets');
const IX: string = read('entry/src/main/ets/pages/Index.ets');

// ── 零扫描判红（扫描器先被验：源在、种子命中 > 0）──────────────────────────────
ok('探测到仓库根', ROOT.length > 0, `ROOT='${ROOT}'`);
ok(`零扫描判红：MarkdownView.ets 非空（${MD.length} 字符）`, MD.length > 0);
ok(`零扫描判红：MessageRow.ets 非空（${MR.length} 字符）`, MR.length > 0);
ok(`零扫描判红：LiveTailView.ets 非空（${LT.length} 字符）`, LT.length > 0);
ok(`零扫描判红：Index.ets 非空（${IX.length} 字符）`, IX.length > 0);
let seeds = 0;
if (MD.indexOf('this.onToast(') >= 0) { seeds++; }
if (MR.indexOf('onToast: this.onToast,') >= 0) { seeds++; }
if (LT.indexOf('onToast: this.onToast,') >= 0) { seeds++; }
if (IX.indexOf('this.toast(msg, TOAST_KIND_COPY)') >= 0) { seeds++; }
ok(`零扫描判红：关键种子命中 ${seeds}/4（> 0）`, seeds > 0);

// ── 正向断言（真实源码必须合规）────────────────────────────────────────────────────
ok('① 跳1：MarkdownView 定义 onToast 且真调用（≥1 消费点）', checkHop1(MD), `调用点=${countOf(MD, 'this.onToast(')}`);
ok('① 跳2：MessageRow(≥3) + LiveTailView(≥1) 真透传',
  checkHop2(MR, LT), `MR=${countOf(MR, 'onToast: this.onToast,')} LT=${countOf(LT, 'onToast: this.onToast,')}`);
ok('① 跳3：Index.ets ≥2 处注入品牌 toast',
  checkHop3(IX), `注入=${countOf(IX, 'this.toast(msg, TOAST_KIND_COPY)')}`);
ok('② 目的达成：MarkdownView.ets 内 promptAction 计数归 0', checkNoSystemToast(MD),
  `promptAction 计数=${countOf(MD, 'promptAction')}`);
ok('③ 文案不变：成功提示仍是 copyLabel(\'复制\', true)', checkLabelUnchanged(MD));

// ── mutation 自证（注入必红样本 ⇒ 必须判红）────────────────────────────────────────
const mHop1: string = MD.replace('this.onToast(', 'this.noToast(');
ok('mutation ①：断 MarkdownView 的消费点（改调用名）⇒ 必红', !checkHop1(mHop1));

const mSys: string = `${MD}\npromptAction.showToast({ message: 'x' });`;
ok('mutation ②：重新引入系统 promptAction ⇒ 必红', !checkNoSystemToast(mSys));

const mLabel: string = MD.replace("copyLabel('复制', true)", "'已复制'");
ok('mutation ③：文案来源不再是 copyLabel ⇒ 必红', !checkLabelUnchanged(mLabel));

const mHop2Mr: string = MR.replace('onToast: this.onToast,', '');
ok('mutation ①：MessageRow 少一处透传（<3）⇒ 必红', !checkHop2(mHop2Mr, LT));

const mHop2Lt: string = LT.replace('onToast: this.onToast,', '');
ok('mutation ①：LiveTailView 断透传 ⇒ 必红', !checkHop2(MR, mHop2Lt));

const mHop3: string = IX.split('this.toast(msg, TOAST_KIND_COPY)').join('');
ok('mutation ①：Index 注入体不再调品牌 toast ⇒ 必红', !checkHop3(mHop3));

if (fail > 0) { console.log(`  toast_wiring: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  toast_wiring: ${pass} passed, 0 failed`);
process.exit(0);
