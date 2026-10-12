/**
 * polish_states_press —— 目标⑤「静态态 · 命中区 · 按压值一致性」形态判据（2026-10-11）。
 *
 * 组件不进离线 harness（`run.sh` 只把 `core/**` 当纯 TS 编译）⇒ 沿用本仓既有先例
 * （`msgnav_polish.test.ts` / `interactive_feedback.test.ts`）读**真实源码**做形态断言。
 *
 * ── 本判据守什么（三条 · 各自独立 · 每条都有 mutation 自证）────────────────────
 *   A. **队列弹层空态**：`QueueSheet` 的队列可被「清空」清成 0 条（面板**仍开着**）——
 *      必须有**空态分支**（`this.queue.length === 0` ⇒ 一行小字，§10 口径：
 *      `type.callout` + `textMuted`、无填充/无边框/无发光），且 `List` 分支**保留**。
 *      ⛔ 缺陷形态 = 只剩标题「待发队列 (0)」+ 一块 300 高的空白 `List`（"一片空"读不出含义）。
 *   B. **「清空」命中区 ≥ `HIT_TARGET_MIN`(44)**：原先只靠 `padding` 撑高（≈28~32）⇒ 低于阈值
 *      （Apple HIG）。本行**零视觉变化**（同级已有 44×44 关闭盒 ⇒ 行高已 44）。
 *   C. **按压值一致性**：全仓 `components/**` 的 `pressed` 不透明度**只准**是 `PRESS_OPACITY`
 *      （或既有台账里明示豁免的档）；⛔ 不得用 `DISABLED_OPACITY`（= 禁用语义）当**按压**值，
 *      ⛔ 不得写字面量 `0.6`（与 token 同值 = 纯魔数）。修的两处：
 *      `AskUserSheet` 关闭 X（`DISABLED_OPACITY`→`PRESS_OPACITY`）、`SplashOverlay` 「轻点跳过」（`0.6`→`PRESS_OPACITY`）。
 *
 * ── 纪律 ────────────────────────────────────────────────────────────────────────
 *   · **剥注释**（注释里记"旧做法"是文档 ⇒ 不剥会把文档当违规 = 假红）。
 *   · **零扫描判红**（种子命中 = 0 ⇒ 红，防"扫描器坏掉 = 白绿"）。
 *   · **mutation 自证**：每条都有"注入必红样本 ⇒ 判红 / 同副本不注入 ⇒ 判绿"。
 *   · `export {}`（⇒ TS 模块）：避免与聚合编译里的兄弟测试顶层符号相撞（TS2451/TS2393）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; readdirSync(p: string): string[]; existsSync(p: string): boolean };
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
    if (fsMod.existsSync(pathMod.join(p, 'entry/src/main/ets/components'))) { return p; }
  }
  return '';
}
const ROOT: string = findRoot();
const COMPONENTS: string = pathMod.join(ROOT, 'entry/src/main/ets/components');

/** 剥注释（`/* *​/` 与行内 `//`；已知局限：字符串里的 `//` 会被误截，方向只会"少口径"、不会放过违规）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function read(rel: string): string {
  const p: string = pathMod.join(ROOT, rel);
  return fsMod.existsSync(p) ? stripComments(fsMod.readFileSync(p, 'utf-8')) : '';
}

// ── 检查函数（纯函数：给定源码 ⇒ 是否合规；mutation 直接喂改过的副本）────────────
/** A. 队列空态分支存在且形态合规（`type.callout` + `textMuted`），且 `List` 分支保留。 */
function checkQueueEmpty(src: string): boolean {
  const i: number = src.indexOf("Text('当前没有待发消息')");
  if (i < 0) { return false; }
  const w: string = src.slice(i, i + 420);
  const branchBefore: boolean = src.indexOf('if (this.queue.length === 0) {') >= 0
    && src.indexOf('if (this.queue.length === 0) {') < i;
  return branchBefore
    && w.indexOf("fs('type.callout')") >= 0
    && w.indexOf("fw('type.callout')") >= 0
    && w.indexOf("lh('type.callout')") >= 0
    && w.indexOf('this.pal().textMuted') >= 0
    && src.indexOf('} else {') >= 0
    // List 分支保留（不做成"空态把列表删了"）。⚠️ 2026-10-12（15o·c）：原来钉的是**魔数**
    //   `.height(300)` —— 该硬编码正是"队列长时靠后行看不到"的病根，已换成**内容自适应**的
    //   `queueListHeight(...)`（判据与渲染同源）⇒ 这里改为钉**调用片段**（只取调用，别钉实参拼写）。
    && src.indexOf('.height(queueListHeight(') >= 0;
}
/** B. 「清空」可点文本的命中区 ≥ 44（链上有 `HIT_TARGET_MIN`）。 */
function checkClearHit(src: string): boolean {
  const a: number = src.indexOf("Text('清空')");
  if (a < 0) { return false; }
  const b: number = src.indexOf('.onClick(', a);
  if (b < 0) { return false; }
  return src.slice(a, b).indexOf('HIT_TARGET_MIN') >= 0;
}
/** C1. `AskUserSheet` 关闭 X 的按压值 = `PRESS_OPACITY`（且链上无 `DISABLED_OPACITY`）。 */
function checkAskPress(src: string): boolean {
  const i: number = src.indexOf("SymbolGlyph($r('sys.symbol.xmark'))");
  if (i < 0) { return false; }
  const j: number = src.indexOf('.onClick(', i);
  if (j < 0) { return false; }
  const w: string = src.slice(i, j);
  return w.indexOf('PRESS_OPACITY') >= 0 && w.indexOf('DISABLED_OPACITY') < 0;
}
/** C2. `SplashOverlay` 「轻点跳过」的按压值 = `PRESS_OPACITY`（链上无字面量 `.opacity(0.6)`）。 */
function checkSplashPress(src: string): boolean {
  const i: number = src.indexOf("Text('轻点跳过')");
  if (i < 0) { return false; }
  const j: number = src.indexOf('.onClick(', i);
  if (j < 0) { return false; }
  const w: string = src.slice(i, j);
  return w.indexOf('PRESS_OPACITY') >= 0 && w.indexOf('.opacity(0.6)') < 0;
}
/** C3. 全仓 components：`pressed` 值不得是 `DISABLED_OPACITY` / 字面量 `0.6`。 */
function checkNoBadPressValue(sources: string[]): boolean {
  for (const s of sources) {
    if (s.indexOf('pressed: { .opacity(DISABLED_OPACITY)') >= 0) { return false; }
    if (s.indexOf('pressed: { .opacity(0.6)') >= 0) { return false; }
  }
  return true;
}

// ── 载入真源 ─────────────────────────────────────────────────────────────────────
const QUEUE: string = read('entry/src/main/ets/components/QueueSheet.ets');
const ASK: string = read('entry/src/main/ets/components/AskUserSheet.ets');
const SPLASH: string = read('entry/src/main/ets/components/SplashOverlay.ets');

const ALL: string[] = [];
if (fsMod.existsSync(COMPONENTS)) {
  for (const f of fsMod.readdirSync(COMPONENTS)) {
    if (f.endsWith('.ets')) { ALL.push(stripComments(fsMod.readFileSync(pathMod.join(COMPONENTS, f), 'utf-8'))); }
  }
}

// ── 零扫描判红（扫描器先被验：源在、种子命中 > 0）──────────────────────────────
ok('探测到仓库根', ROOT.length > 0);
ok(`零扫描判红：扫到 components/*.ets（实得 ${ALL.length} > 0）`, ALL.length > 0);
let seeds = 0;
if (QUEUE.indexOf("Text('当前没有待发消息')") >= 0) { seeds++; }
if (QUEUE.indexOf("Text('清空')") >= 0) { seeds++; }
if (ASK.indexOf("SymbolGlyph($r('sys.symbol.xmark'))") >= 0) { seeds++; }
if (SPLASH.indexOf("Text('轻点跳过')") >= 0) { seeds++; }
ok(`零扫描判红：关键种子命中 ${seeds}/4（> 0）`, seeds > 0);
console.log(`  （扫描：components/*.ets=${ALL.length}，种子=${seeds}/4）`);

// ── 正向断言（真实源码必须合规）────────────────────────────────────────────────
ok('A. QueueSheet 有队列空态分支（一行小字，§10 口径）', checkQueueEmpty(QUEUE));
ok('B. QueueSheet 「清空」命中区 ≥ HIT_TARGET_MIN(44)', checkClearHit(QUEUE));
ok('C1. AskUserSheet 关闭 X 按压值 = PRESS_OPACITY', checkAskPress(ASK));
ok('C2. SplashOverlay 「轻点跳过」按压值 = PRESS_OPACITY（无字面量）', checkSplashPress(SPLASH));
ok('C3. 全仓 components 无 DISABLED_OPACITY / 字面量 0.6 作 pressed 值', checkNoBadPressValue(ALL));

// ── mutation 自证（注入必红样本 ⇒ 必须判红；同副本不注入 ⇒ 已判绿）──────────────
const mQueue: string = QUEUE.replace('if (this.queue.length === 0) {', 'if (this.queue.length < 0) {');
ok('mutation A：删掉队列空态分支 ⇒ 必红', !checkQueueEmpty(mQueue));

const mClear: string = QUEUE.replace('.constraintSize({ minHeight: HIT_TARGET_MIN })', '.constraintSize({ minHeight: 32 })');
ok('mutation B：撤回「清空」命中区 ⇒ 必红', !checkClearHit(mClear));

const ai: number = ASK.indexOf("SymbolGlyph($r('sys.symbol.xmark'))");
const aj: number = ASK.indexOf('.onClick(', ai);
const mAsk: string = ASK.slice(0, ai) + ASK.slice(ai, aj).replace('PRESS_OPACITY', 'DISABLED_OPACITY') + ASK.slice(aj);
ok('mutation C1：AskUserSheet X 按压值退回 DISABLED_OPACITY ⇒ 必红', !checkAskPress(mAsk));

const si: number = SPLASH.indexOf("Text('轻点跳过')");
const sj: number = SPLASH.indexOf('.onClick(', si);
const mSplash: string = SPLASH.slice(0, si) + SPLASH.slice(si, sj).replace('PRESS_OPACITY', '0.6') + SPLASH.slice(sj);
ok('mutation C2：SplashOverlay 跳过提示退回字面量 0.6 ⇒ 必红', !checkSplashPress(mSplash));

const mAll: string[] = ALL.slice();
if (mAll.length > 0) { mAll[0] = `${mAll[0]}\n.stateStyles({ pressed: { .opacity(0.6) } })`; }
ok('mutation C3：注入 pressed 字面量 0.6 ⇒ 必红', !checkNoBadPressValue(mAll));

if (fail > 0) { console.log(`  polish_states_press: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  polish_states_press: ${pass} passed, 0 failed`);
process.exit(0);
