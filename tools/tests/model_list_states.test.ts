/**
 * 目标⑤ A4 —— 模型列表面板**三态**（加载 / 失败(+重试) / 空）判据（2026-10-11）。
 *
 * ── 缺口（本波要修的，`polish-audit` 登记 A4 / `docs/UI-AUDIT-CHECKLIST.md:728`）──────────
 *   `pages/Index.ets` 的模型列表面板旧实现只有 `if (this.llmCfg === undefined) { spinner + 「正在读取
 *   模型列表…」 } else if (空) { … } else { 列表 }` ⇒ **无错误分支** ⇒ 后端不可用/超时/报错时
 *   **永久转圈**，用户读不出"是慢还是坏了"。
 *
 * ── 口径来源（⛔ 不自创）────────────────────────────────────────────────────────
 *   · 三态标准实现 = `core/pluginview.ets:pluginPanelStatus`（加载/失败/空；失败 = `dangerText` + 可重试）；
 *   · 错误态视觉 = 一行语义色小字 + 「重试」（同 `components/SettingsRows.ets:SettingsErrorBar`）；
 *   · 「加载中」色阶 = `textMuted`（`docs/DESIGN-SYSTEM.md §16`，web 权威口径）。
 *
 * ── 判据（钉**形态 + 消费点**，⛔ 只钉"函数存在"是假绿）──────────────────────────────
 *   ① **纯逻辑真源** `core/llmfmt.ets:modelPanelStatus` 三态 + 优先级（失败 > 加载 > 空 > 列表）+ 文案；
 *   ② **形态**：Index.ets 三态分支存在（三个 `MODEL_PANEL_*` 常量都被消费）+ 都消费 `modelPanelStatusNow`；
 *   ③ **失败态真的可达**：失败来自**既有取数路径的真结果** —— `store.llmConfigState`/`llmConfigError`
 *      在 `loadLlmConfig` 的 **catch** 里被写成 `'error'`（⛔ 非 setTimeout 猜超时），页面镜像之；
 *   ④ **重试链到既有取数函数**：错误分支「重试」→ `reloadModelList()` → `store.loadLlmConfig()`（调用点计数）；
 *   ⑤ **a11y / 命中区**：重试控件有**可见文本**「重试」（非图标-only）+ 真实 ≥44 布局盒（`HIT_TARGET_MIN`）；
 *   ⑥ **零颜色字面量 / 零 `setTimeout`**：模型列表面板块内不出现 `#RRGGBB` / `setTimeout`；
 *   ⑦ **零扫描判红** + **mutation 自证**（删失败分支 / 断重试链 / 抽掉 store catch 赋值 ⇒ 各自必红）。
 *
 * ⚠️ 纯 TS（`export {}`）；结尾必须 `process.exit`。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; resolve(...parts: string[]): string };
declare const __dirname: string;
export {};

import {
  MODEL_PANEL_EMPTY, MODEL_PANEL_ERROR, MODEL_PANEL_LIST, MODEL_PANEL_LOADING,
  modelPanelEmptyText, modelPanelErrorText, modelPanelLoadingText, modelPanelStatus,
} from '../../entry/src/main/ets/core/llmfmt';

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
    if (fsMod.existsSync(pathMod.join(p, 'entry/src/main/ets/pages/Index.ets'))) { return p; }
  }
  return '';
}
const ROOT: string = findRoot();
/** 剥注释（同 `polish_states_press.test.ts`；方向只会"少口径"、不会放过违规）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function read(rel: string): string {
  const p: string = pathMod.join(ROOT, rel);
  return fsMod.existsSync(p) ? stripComments(fsMod.readFileSync(p, 'utf-8')) : '';
}

// ── ① 纯逻辑真源（`core/llmfmt.ets:modelPanelStatus`）────────────────────────────
ok('真源 A1：失败 ⇒ error / dangerText / 可重试', (() => {
  const s = modelPanelStatus('ready', 3, '连接超时');
  return s.state === MODEL_PANEL_ERROR && s.show === true && s.colorRole === 'dangerText' && s.canRetry === true
    && s.text.indexOf('连接超时') >= 0;
})());
ok('真源 A2：失败优先于"正在加载"（失败就是失败）', (() => {
  const s = modelPanelStatus('loading', 3, 'boom');
  return s.state === MODEL_PANEL_ERROR && s.canRetry === true;
})());
ok('真源 A3：空错误串 ⇒ 只留前缀（不产出悬空冒号）', modelPanelErrorText('  ') === '模型列表加载失败');
ok('真源 A4：有错误串 ⇒ 前缀 + 原因', modelPanelErrorText('x') === '模型列表加载失败：x');
ok('真源 A5：idle（从未拉过）⇒ 加载中（不是空白/空态）', (() => {
  const s = modelPanelStatus('idle', 0, '');
  return s.state === MODEL_PANEL_LOADING && s.show === true && s.canRetry === false && s.text === modelPanelLoadingText();
})());
ok('真源 A6：loading ⇒ 加载中 / textMuted', (() => {
  const s = modelPanelStatus('loading', 0, '');
  return s.state === MODEL_PANEL_LOADING && s.colorRole === 'textMuted';
})());
ok('真源 A7：ready 且 0 条 ⇒ 空态（保留既有文案）', (() => {
  const s = modelPanelStatus('ready', 0, '');
  return s.state === MODEL_PANEL_EMPTY && s.show === true && s.text === modelPanelEmptyText();
})());
ok('真源 A8：ready 且有模型 ⇒ 列表（不画状态行）', (() => {
  const s = modelPanelStatus('ready', 2, '');
  return s.state === MODEL_PANEL_LIST && s.show === false;
})());
ok('真源 A9：计数容错（NaN/负数/undefined 当 0）', (() => {
  return modelPanelStatus('ready', Number.NaN, '').state === MODEL_PANEL_EMPTY
    && modelPanelStatus('ready', -5, '').state === MODEL_PANEL_EMPTY;
})());

// ── 载入真源源码 ──────────────────────────────────────────────────────────────────
const INDEX: string = read('entry/src/main/ets/pages/Index.ets');
const STORE: string = read('entry/src/main/ets/core/store.ets');

/** 颜色字面量 = `#` 后跟 hex 数字（`#RRGGBB`/`#RGB`；⛔ 不用裸 `#` —— ForEach 键里的 `#${...}` 会假红）。 */
function hasHexColor(s: string): boolean {
  return /#[0-9A-Fa-f]{3}/.test(s);
}

/** 模型列表面板的源码切片（从 `ModelSheet()` 起；用于"块内零字面量/零 setTimeout"扫描）。 */
function modelSheetSlice(src: string): string {
  const i: number = src.indexOf('ModelSheet() {');
  if (i < 0) { return ''; }
  const j: number = src.indexOf('private reloadModelList', i);
  return j > i ? src.slice(i, j) : src.slice(i, i + 6000);
}

// ── ② 形态：三态分支存在 + 消费同源纯函数 ─────────────────────────────────────────
function checkThreeBranches(src: string): boolean {
  return src.indexOf('=== MODEL_PANEL_ERROR') >= 0
    && src.indexOf('=== MODEL_PANEL_LOADING') >= 0
    && src.indexOf('=== MODEL_PANEL_EMPTY') >= 0
    && src.indexOf('this.modelPanelStatusNow()') >= 0;
}

// ── ③ 失败态真的可达（来自既有取数路径的真结果，非 setTimeout 猜）──────────────────
function checkFailureReachable(indexSrc: string, storeSrc: string): boolean {
  // 页面镜像 store 的真结果
  const pageMirror: boolean = indexSrc.indexOf('this.llmCfgState = store.llmConfigState;') >= 0
    && indexSrc.indexOf('this.llmCfgError = store.llmConfigError;') >= 0;
  // store 的既有取数路径在 **catch** 里写失败态（可读化），成功写 ready
  const i: number = storeSrc.indexOf('async loadLlmConfig(');
  if (i < 0) { return false; }
  const body: string = storeSrc.slice(i, i + 1600);
  const writesError: boolean = body.indexOf("this.llmConfigState = 'error';") >= 0
    && body.indexOf('this.llmConfigError = readableRpcError') >= 0;
  const writesReady: boolean = body.indexOf("this.llmConfigState = 'ready';") >= 0;
  return pageMirror && writesError && writesReady;
}

// ── ④ 重试链到既有取数函数（调用点计数，⛔ 只钉"字段存在"是假绿）──────────────────
function checkRetryWiring(src: string): boolean {
  const e: number = src.indexOf('=== MODEL_PANEL_ERROR');
  if (e < 0) { return false; }
  const next: number = src.indexOf('=== MODEL_PANEL_LOADING', e);
  if (next < 0) { return false; }
  const branch: string = src.slice(e, next);
  // 错误分支：可见文本「重试」+ 真实 ≥44 布局盒 + onClick → reloadModelList
  if (!(branch.indexOf("Text('重试')") >= 0
        && branch.indexOf('HIT_TARGET_MIN') >= 0
        && branch.indexOf('this.reloadModelList();') >= 0)) { return false; }
  // reloadModelList 体内 = 既有取数入口 store.loadLlmConfig()
  const r: number = src.indexOf('private reloadModelList(): void {');
  if (r < 0) { return false; }
  const rBody: string = src.slice(r, r + 700);
  if (!(rBody.indexOf('store.loadLlmConfig()') >= 0)) { return false; }
  // 调用点计数：打开面板 + 失败态重试 ⇒ ≥ 2（⛔ 只定义不调用 = 假重试）
  const calls: number = src.split('this.reloadModelList();').length - 1;
  return calls >= 2;
}

// ── ⑥ 块内零颜色字面量 / 零 setTimeout ────────────────────────────────────────────
function checkNoLiteralOrTimer(slice: string): boolean {
  return slice.length > 0 && !hasHexColor(slice) && slice.indexOf('setTimeout') < 0;
}

const MS: string = modelSheetSlice(INDEX);

// ── ⑦ 零扫描判红（扫描器先被验：源在、种子命中 > 0）──────────────────────────────
ok('探测到仓库根', ROOT.length > 0, `ROOT='${ROOT}'`);
ok(`零扫描判红：Index.ets 非空（${INDEX.length} 字符）`, INDEX.length > 0);
ok(`零扫描判红：store.ets 非空（${STORE.length} 字符）`, STORE.length > 0);
ok(`零扫描判红：ModelSheet 切片非空（${MS.length} 字符）`, MS.length > 0);
let seeds = 0;
if (INDEX.indexOf('=== MODEL_PANEL_ERROR') >= 0) { seeds++; }
if (INDEX.indexOf('this.modelPanelStatusNow()') >= 0) { seeds++; }
if (INDEX.indexOf('private reloadModelList(): void {') >= 0) { seeds++; }
if (STORE.indexOf('async loadLlmConfig(') >= 0) { seeds++; }
ok(`零扫描判红：关键种子命中 ${seeds}/4（> 0）`, seeds > 0);

// ── 正向断言（真实源码必须合规）────────────────────────────────────────────────────
ok('② Index.ets 三态分支存在且消费 modelPanelStatusNow', checkThreeBranches(INDEX));
ok('③ 失败态来自既有取数路径的真结果（store catch 写 error / 页面镜像）', checkFailureReachable(INDEX, STORE));
ok('④ 重试 → reloadModelList → store.loadLlmConfig（调用点 ≥2）', checkRetryWiring(INDEX), (() => {
  const calls: number = INDEX.split('this.reloadModelList();').length - 1;
  return `调用点计数=${calls}`;
})());
ok('⑥ 模型列表面板块内零颜色字面量 / 零 setTimeout', checkNoLiteralOrTimer(MS));

// ── mutation 自证（注入必红样本 ⇒ 必须判红）──────────────────────────────────────
const mBranch: string = INDEX.replace('=== MODEL_PANEL_ERROR', '=== MODEL_PANEL_LIST');
ok('mutation ②：抹掉失败分支 ⇒ 必红', !checkThreeBranches(mBranch));

const mStoreNoCatch: string = STORE.replace("this.llmConfigState = 'error';", "this.llmConfigState = 'idle';");
ok('mutation ③：抽掉 store catch 里的失败赋值 ⇒ 必红', !checkFailureReachable(INDEX, mStoreNoCatch));

const mPageNoMirror: string = INDEX.replace('this.llmCfgError = store.llmConfigError;', '');
ok('mutation ③b：断页面镜像 ⇒ 必红', !checkFailureReachable(mPageNoMirror, STORE));

const mRetry: string = INDEX.replace('this.reloadModelList();', 'this.showModel = true;');
ok('mutation ④：断重试链（onClick 不再调 reloadModelList）⇒ 必红', !checkRetryWiring(mRetry));

const mFetch: string = INDEX.replace('store.loadLlmConfig()', 'this.modelGroups()');
ok('mutation ④b：reloadModelList 不再走既有取数入口 ⇒ 必红', !checkRetryWiring(mFetch));

const mLiteral: string = `${MS}\n.color('#FF00FF')`;
ok('mutation ⑥：注入颜色字面量 ⇒ 必红', !checkNoLiteralOrTimer(mLiteral));

// ── ⑧ 命中区 ≥44 + 根面统一（批次 13e，Apple HIG / L1 顶层弹层语言）────────────────
// 取证（2026-10-12 真机截图）：`ModelSheet` 的 ctx 预设 chip（`padding(…5)`≈22vp）、「应用」按钮
//   （≈28vp）、模型行（`padding(SPACE_XS)`≈29vp）都**低于** HIT_TARGET_MIN(44) —— 与本面板
//   「思考模式」chip（已 ≥44）及全仓浮层口径**内部不一致**；根面又是**裸 `pal().appBg` + 裸 `border`**
//   （同层级 `StatusSheet`/`QueueSheet`/`SelfCheckSheet` 一律 `surfaceFillOf(p,'surface.overlay')`
//   + `hairlineOf` + 两层柔影）⇒ 本轮补齐。
function countIn(s: string, sub: string): number { return s.split(sub).length - 1; }
/** ⑧a：≥44 布局盒 ≥4 处（ctx 预设 / 应用 / 输入框 / 重试 / 模型行 / 思考 chip）。 */
function checkHitTargets(slice: string): boolean {
  return countIn(slice, 'constraintSize({ minHeight: HIT_TARGET_MIN })') >= 4;
}
/** ⑧b：根面走 overlay 语言（overlay 面 + 发丝），且**不再**用裸 appBg。 */
function checkRootFace(slice: string): boolean {
  return slice.indexOf("surfaceFillOf(this.pal(), 'surface.overlay')") >= 0
    && slice.indexOf('hairlineOf(this.pal())') >= 0
    && slice.indexOf('.backgroundColor(this.pal().appBg)') < 0;
}
ok('⑧a ModelSheet 命中区 ≥44 布局盒 ≥4 处（ctx 预设/应用/输入框/重试/模型行）', checkHitTargets(MS),
  `实得 ${countIn(MS, 'constraintSize({ minHeight: HIT_TARGET_MIN })')} 处`);
ok('⑧b ModelSheet 根面统一 overlay（surface.overlay + hairline，无裸 appBg）', checkRootFace(MS));

// mutation ⑧：注入必红样本 ⇒ 必须判红
ok('mutation ⑧a：全抽掉 ≥44 布局盒 ⇒ 必红',
  !checkHitTargets(MS.split('constraintSize({ minHeight: HIT_TARGET_MIN })').join('constraintSize({ minHeight: 36 })')));
ok('mutation ⑧b：根面改回裸 appBg（overlay 面全替换）⇒ 必红',
  !checkRootFace(MS.split("surfaceFillOf(this.pal(), 'surface.overlay')").join('this.pal().appBg')));

if (fail > 0) { console.log(`  model_list_states: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  model_list_states: ${pass} passed, 0 failed`);
process.exit(0);
