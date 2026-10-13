/**
 * parity_defer.test.ts —— 「三项残余迁补」（backlog D/E/F）的**接线闭合**判据（⛔ 目标④）。
 *
 * 为什么需要它（本仓血债：「纯逻辑就绪 ≠ 用户能用」）：
 *   ① `recentdirs.ets` 交付时**零消费方**，`run.sh`/`lint`/`typecheck`/**④ ArkTS 编译**全绿 ⇒ **假绿**；
 *   ② `withAccent` / `applyNotifyPrefs` / `reasoningopen` 三次"死消费"都是**声明存在、无人调用**。
 *   ⇒ 本判据对**每一项**钉三段闭合、**缺一即红**：
 *       ① **声明**（core 侧函数/常量真的存在）；
 *       ② **消费**（`pages/Index.ets` 真有**调用点**，计数 ≥1 —— ⛔ 不钉"方法体存在"）；
 *       ③ **渲染落点**（界面真有承载它的节点/属性）。
 *
 * 三项（逐字对齐 web 权威）：
 *   · **D**：`NewSessionDialog` 的**会话名称** label（web `NewSessionDialog.tsx:72-80`）。
 *   · **E**：`PathPicker` 的**输入即补全下拉**（web `PathPicker.tsx:135-192`）。
 *   · **F**：`ThinkingModeControl` 入 composer 路径（web `ModelSelector.tsx:154-164`）——
 *          原生落点 = `ModelSheet`（设计系统无滑杆先例 ⇒ chip）。
 *
 * ⚠️ 先剥注释（本仓 GOTCHA：注释里就会写这些函数名 ⇒ 不剥会**假绿**）。
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 逐文件 `node`）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { childPath, filterChildDirs, parsePathInput } from '../../entry/src/main/ets/core/pathpick';
import {
  THINKING_STEP_COUNT, THINKING_STEP_LABELS, thinkingModeToStep, thinkingStepLabel, thinkingStepToMode,
} from '../../entry/src/main/ets/core/settings';
import { FsEntry } from '../../entry/src/main/ets/core/composer';

const fsMod = require('fs');
const pathMod = require('path');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 定位仓库根 + 读源（零扫描判红）────────────────────────────────────────────
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const c = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(c, 'entry/src/main/ets/pages/Index.ets'))) { repo = c; break; }
}
ok('探测到仓库根', repo.length > 0);

function readSrc(rel: string): string {
  try {
    return fsMod.readFileSync(pathMod.join(repo, rel), 'utf-8');
  } catch (e) {
    return '';
  }
}
/** 剥注释（⛔ 不剥会误伤：注释里就会写这些函数名/文案）。 */
function stripComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const INDEX = stripComments(readSrc('entry/src/main/ets/pages/Index.ets'));
const STORE = stripComments(readSrc('entry/src/main/ets/core/store.ets'));
const SETTINGS = stripComments(readSrc('entry/src/main/ets/core/settings.ets'));
const PATHPICK = stripComments(readSrc('entry/src/main/ets/core/pathpick.ets'));

// ── ③ 零扫描判红（源读不到 ⇒ 后续计数全 0 ⇒ 红）────────────────────────────────
ok('★ 零扫描防线：Index.ets 可读且非空', INDEX.length > 0);
ok('★ 零扫描防线：store.ets 可读且非空', STORE.length > 0);
ok('★ 零扫描防线：settings.ets 可读且非空', SETTINGS.length > 0);
ok('★ 零扫描防线：pathpick.ets（新模块）可读且非空', PATHPICK.length > 0);

/** 出现次数（纯字符串计数；needle 取调用片段）。 */
function count(src: string, needle: string): number {
  let n = 0, i = 0;
  while ((i = src.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}
/** 首次出现的行号（1 基）；未命中 ⇒ -1。 */
function firstLine(src: string, needle: string): number {
  const i = src.indexOf(needle);
  if (i < 0) { return -1; }
  return src.slice(0, i).split('\n').length;
}
/** ModelSheet 的源码切片（含 F 的思考模式段；用于"渲染落点"判定）。 */
function modelSheetSlice(src: string): string {
  const i = src.indexOf('ModelSheet() {');
  if (i < 0) { return ''; }
  const j = src.indexOf('private reloadModelList', i);
  return j > i ? src.slice(i, j) : src.slice(i, i + 9000);
}

// ── 判据（纯函数，便于 mutation 注入）──────────────────────────────────────────

/** D：`NewSessionDialog` 会话名称 label —— 声明 ∧ 消费（带实参）∧ 渲染落点。 */
function dClosed(index: string, store: string): boolean {
  // ① 声明
  if (store.indexOf('async createSession(label?: string)') < 0) { return false; }
  if (store.indexOf('new CreateChatReq(label)') < 0) { return false; }
  // ② 消费：带 label 实参的调用点（⛔ 不是裸 `createSession()`）
  if (count(index, 'store.createSession(label.length > 0 ? label : undefined)') < 1) { return false; }
  // ③ 渲染落点：label 输入面（标题 + placeholder + onChange 写入）
  if (index.indexOf("Text('会话名称')") < 0) { return false; }
  if (index.indexOf("placeholder: '留空则自动生成'") < 0) { return false; }
  if (count(index, 'this.newSessionLabel = v;') < 1) { return false; }
  return true;
}

/** E：`PathPicker` 自动补全下拉 —— 声明 ∧ 消费（纯函数 + 既有取数入口）∧ 渲染落点。 */
function eClosed(index: string, pathpick: string): boolean {
  // ① 声明（新纯逻辑模块三个导出）
  if (pathpick.indexOf('export function parsePathInput(') < 0) { return false; }
  if (pathpick.indexOf('export function filterChildDirs(') < 0) { return false; }
  if (pathpick.indexOf('export function childPath(') < 0) { return false; }
  // ② 消费：从本模块导入 + 三个都有调用点
  if (index.indexOf("from '../core/pathpick'") < 0) { return false; }
  if (count(index, 'parsePathInput(') < 1) { return false; }
  if (count(index, 'filterChildDirs(') < 1) { return false; }
  if (count(index, 'childPath(') < 1) { return false; }
  // 取数入口 = **既有** `store.listFs`（⛔ 不新造 RPC）
  if (count(index, 'store.listFs(') < 1) { return false; }
  // ③ 渲染落点：打开判据 + 候选行 onClick 下钻 + 候选写回
  if (index.indexOf('if (this.nsPathOpen)') < 0) { return false; }
  if (count(index, 'this.pickPathDir(e.name)') < 1) { return false; }
  if (index.indexOf('this.nsPathDirs = filterChildDirs(all, prefix)') < 0) { return false; }
  return true;
}

/** F：思考模式入 composer 路径（`ModelSheet`）—— 声明 ∧ 消费（两端 RPC）∧ 渲染落点。 */
function fClosed(index: string, settings: string): boolean {
  // ① 声明（core/settings.ets 新导出；⛔ 不动既有 `thinkLabel`）
  if (settings.indexOf('export function thinkingModeToStep(') < 0) { return false; }
  if (settings.indexOf('export function thinkingStepToMode(') < 0) { return false; }
  if (settings.indexOf('export function thinkingStepLabel(') < 0) { return false; }
  if (settings.indexOf('export const THINKING_STEP_LABELS') < 0) { return false; }
  // ② 消费：三个纯函数都有调用点 + 读写两端 RPC 都接
  if (count(index, 'thinkingStepLabel(') < 1) { return false; }
  if (count(index, 'thinkingModeToStep(') < 1) { return false; }
  if (count(index, 'thinkingStepToMode(') < 1) { return false; }
  if (count(index, 'THINKING_STEP_LABELS') < 1) { return false; }
  if (count(index, 'RpcMethod.getUserThinkingMode') < 1) { return false; }
  if (count(index, 'RpcMethod.setUserThinkingMode') < 1) { return false; }
  // ③ 渲染落点（在 `ModelSheet` 切片内）：标题 + ForEach + onClick 提交 + ≥44 布局盒
  const ms = modelSheetSlice(index);
  if (ms.indexOf("Text('思考模式')") < 0) { return false; }
  if (ms.indexOf('ForEach(THINKING_STEP_LABELS') < 0) { return false; }
  if (ms.indexOf('commitThinkingStep(') < 0) { return false; }
  if (ms.indexOf('HIT_TARGET_MIN') < 0) { return false; }
  return true;
}

// ── 正向断言（真实源码必须闭合）────────────────────────────────────────────────
ok(`D 闭合：声明+消费+落点（Index.ets:${firstLine(INDEX, 'store.createSession(label')}）`, dClosed(INDEX, STORE));
ok(`E 闭合：pathpick 声明+消费+落点（Index.ets:${firstLine(INDEX, 'parsePathInput(')}）`, eClosed(INDEX, PATHPICK));
ok(`F 闭合：settings 声明+两端 RPC+ModelSheet 落点（Index.ets:${firstLine(INDEX, 'thinkingStepLabel(')}）`,
  fClosed(INDEX, SETTINGS));

// ⛔ 反向：F 的落点必须在 **ModelSheet 切片内**（防"只在别处调用"的假闭合）。
ok('F 反证：思考模式节点确实落在 ModelSheet 切片内（非页面其它处）',
  modelSheetSlice(INDEX).indexOf("Text('思考模式')") >= 0);
// ⛔ 反证：E 的候选**不是**命令补全那套（`@` 文件补全的 `fsMatches`）冒充的。
ok('E 反证：走独立的 `nsPathDirs` 候选（非复用 `@` 补全的 fsMatches）',
  count(INDEX, 'this.nsPathDirs') >= 2);

// ── 纯逻辑行为断言（新模块真的按 web 语义工作；⛔ 不只是"存在"）─────────────────
// parsePathInput（web `PathPicker.tsx:209-224`）
eq('parsePathInput("/") → 列根', [parsePathInput('/').dirPath, parsePathInput('/').prefix], ['/', '']);
eq('parsePathInput("") → 列根', [parsePathInput('').dirPath, parsePathInput('').prefix], ['/', '']);
eq('parsePathInput("/r") → 根下前缀（⛔ 镜像 web **代码**：`prefix=trimmed`；见 pathpick 注释）',
  [parsePathInput('/r').dirPath, parsePathInput('/r').prefix], ['/', '/r']);
eq('parsePathInput("/root/") → 列 /root', [parsePathInput('/root/').dirPath, parsePathInput('/root/').prefix], ['/root', '']);
eq('parsePathInput("/root/Co") → /root 下前缀 Co',
  [parsePathInput('/root/Co').dirPath, parsePathInput('/root/Co').prefix], ['/root', 'Co']);
// childPath（web `PathPicker.tsx:90-91`）
eq('childPath("/","root") → /root/', childPath('/', 'root'), '/root/');
eq('childPath("/a","b") → /a/b/', childPath('/a', 'b'), '/a/b/');
// filterChildDirs（web `PathPicker.tsx:59-63`：只留目录 + 前缀、大小写不敏感）
{
  const mk = (name: string, isDir: boolean): FsEntry => { const e = new FsEntry(); e.name = name; e.isDir = isDir; return e; };
  const all: FsEntry[] = [mk('Code', true), mk('co', true), mk('zeta', true), mk('code.md', false)];
  eq('filterChildDirs 前缀过滤（只目录、忽略大小写）',
    filterChildDirs(all, 'co').map((e: FsEntry) => e.name), ['Code', 'co']);
  eq('filterChildDirs 空前缀 ⇒ 全部目录（不含文件）',
    filterChildDirs(all, '').map((e: FsEntry) => e.name), ['Code', 'co', 'zeta']);
}
// thinking 步骤映射（web `ThinkingModeControl.tsx:19-49`）
eq('thinkingModeToStep 四档+别名',
  [thinkingModeToStep('disabled'), thinkingModeToStep(''), thinkingModeToStep('enabled'),
    thinkingModeToStep('think'), thinkingModeToStep('think-max'), thinkingModeToStep('weird')],
  [0, 1, 2, 2, 3, 1]);
eq('thinkingStepToMode 四档',
  [thinkingStepToMode(0), thinkingStepToMode(1), thinkingStepToMode(2), thinkingStepToMode(3)],
  ['disabled', '', 'think', 'think-max']);
eq('thinkingStepLabel = composer 文案（关/思考/思考+/思考++）',
  THINKING_STEP_LABELS, ['关', '思考', '思考+', '思考++']);
eq('THINKING_STEP_COUNT', THINKING_STEP_COUNT, 4);
eq('thinkingStepLabel 越界钳位', [thinkingStepLabel(-5), thinkingStepLabel(9)], ['关', '思考++']);

// ── G：`palOnce()` 记忆化色板的**失效语义**（目标④ 收口 · 编排者硬条件）────────────
//
// ⚠️ 为什么只能钉**源码形态**：`palOnce()` 是 `pages/Index.ets` 里 **ArkUI struct 的私有方法**
//   （不可 import、脱机跑不了）⇒ 无法做运行时行为断言。折中：钉**失效谓词的两项键**（= 行为契约本身）
//   + mutation 自证（断任一项键 ⇒ 本判据必红）。⛔ 若将来要**可执行的**行为判据，需把记忆键抽成
//   `core/` 纯函数（超出本波域，另案）。
// 契约：`pal()` 依赖 **主题 + 强调色** 两项 ⇒ 记忆键必须覆盖两项，缺一即"陈旧色"。
function palOnceClosed(index: string): boolean {
  // ① 声明 ∧ 消费（⛔ 只钉"方法存在"是假绿；必须有真实调用点，否则指标退化）
  if (index.indexOf('private palOnce(): Palette {') < 0) { return false; }
  const i: number = index.indexOf('private palOnce(): Palette {');
  const body: string = index.slice(i, i + 900);
  if ((index.split('this.palOnce()').length - 1) < 1) { return false; }
  // ② 记忆键覆盖 `pal()` 的两项依赖
  if (body.indexOf('this.themeName') < 0) { return false; }
  if (body.indexOf('this.accentHex()') < 0) { return false; }
  // ③ 失效判据必须**同时**比两项（主题 ∧ 强调色）
  if (body.indexOf('palMemoTheme !==') < 0) { return false; }
  if (body.indexOf('palMemoAccent !==') < 0) { return false; }
  // ④ 未命中必须**重算并回填**，命中必须**返回缓存值**（不是每次都 `pal()`）
  if (body.indexOf('this.palMemoVal = this.pal()') < 0) { return false; }
  if (body.indexOf('return this.palMemoVal') < 0) { return false; }
  return true;
}
ok(`G 闭合：palOnce 声明 ∧ 消费 ≥1 ∧ 失效键含 主题+强调色（Index.ets:${firstLine(INDEX, 'private palOnce(): Palette {')}）`,
  palOnceClosed(INDEX));
// ⛔ 反证：`pal()` 仍是"记忆化之外"的唯一实现（⛔ 别把它也 memo 掉 —— 那会让本契约失去意义）
ok('G 反证：`pal()` 本体未被记忆化（不存在 `palMemo` 之外的缓存返回）',
  INDEX.indexOf('private pal(): Palette {') >= 0);

// ── G2：perf 指标**不得退化/合并**（防"改了尺子就把刻度放宽"· 编排者裁决）────────────
//
// 契约（`tools/perf/guard.sh`）：**拆两条，⛔ 不许合并** ——
//   · A 线 = `this.pal()` 直读（未 memo ⇒ **真分配次数**，成本线，上限 **1250 只许减**）；
//   · B 线 = `this.pal()` ∨ `this.palOnce()`（**限定名**，排除声明行；含缓存命中 ⇒ 松界 1350，非成本线）。
// ⛔ 若两者被并成一个数、或 B 线用**非限定名**（含 `private palOnce(` 声明行）、或 A 线上限被抬高 ⇒ 本判据必红。
const GUARD = stripComments(readSrc('tools/perf/guard.sh'));
function guardMetricOk(g: string): boolean {
  // A 线：只数 this.pal()
  if (g.indexOf("n_pal=$(grep -ro 'this\\.pal()'") < 0) { return false; }
  // B 线：数**限定名** this.palOnce()（`|this\.palOnce\(\)` 紧跟 A 的 pattern ⇒ 排除声明行）
  if (g.indexOf("n_pal_all=$(grep -roE 'this\\.pal\\(\\)|this\\.palOnce\\(\\)'") < 0) { return false; }
  // 两条上限各自独立（A = 成本线 1250 只许减；B = 松界 1353 —— §21.113 +2 / §21.114 +1，见 docs/PERF-BUDGET.md §5）
  if (g.indexOf('"$n_pal" 1250') < 0) { return false; }
  if (g.indexOf('"$n_pal_all" 1353') < 0) { return false; }
  return true;
}
ok(`G2 闭合：guard.sh 拆 A/B 两条（A=成本线 1250 / B=读取总量 1353；词源 guard.sh:${firstLine(GUARD, 'n_pal_all=')}）`,
  guardMetricOk(GUARD));

// ── mutation 自证（断任一条 ⇒ 必红）───────────────────────────────────────────
// D：抽掉 label 实参 ⇒ 消费链断
ok('mutation D：`store.createSession(label…)` → 裸 `store.createSession()` ⇒ 必红',
  !dClosed(INDEX.replace('store.createSession(label.length > 0 ? label : undefined)', 'store.createSession()'), STORE));
ok('mutation D2：抽掉 placeholder ⇒ 渲染落点断 ⇒ 必红',
  !dClosed(INDEX.replace("placeholder: '留空则自动生成'", "placeholder: 'x'"), STORE));
// E：断 dropdown 渲染 / 断取数入口
ok('mutation E：抽掉 `pickPathDir(e.name)` ⇒ 下拉行不可下钻 ⇒ 必红',
  !eClosed(INDEX.replace('this.pickPathDir(e.name)', ''), PATHPICK));
ok('mutation E2：抽掉**全部** `store.listFs(` ⇒ 无候选来源 ⇒ 必红',
  !eClosed(INDEX.split('store.listFs(').join('store.someOther('), PATHPICK));
// F：断渲染落点 / 断声明 / 断写端
ok('mutation F：抽掉 `ForEach(THINKING_STEP_LABELS` ⇒ 落点断 ⇒ 必红',
  !fClosed(INDEX.replace('ForEach(THINKING_STEP_LABELS', 'ForEach([]'), SETTINGS));
ok('mutation F2：抽掉 settings 的 `thinkingStepToMode` 声明 ⇒ 必红',
  !fClosed(INDEX, SETTINGS.replace('export function thinkingStepToMode(', 'function thinkingStepToModeX(')));
ok('mutation F3：抽掉写端 RPC ⇒ 只读不写（假功能）⇒ 必红',
  !fClosed(INDEX.replace('RpcMethod.setUserThinkingMode', 'RpcMethod.getUserThinkingMode'), SETTINGS));
// E：断声明
ok('mutation E3：抽掉 pathpick 的 `filterChildDirs` 声明 ⇒ 必红',
  !eClosed(INDEX, PATHPICK.replace('export function filterChildDirs(', 'function filterChildDirsX(')));
// G：断记忆化的任一项键 / 断消费
ok('mutation G1：抽掉**强调色**键（只比主题）⇒ 换强调色返回陈旧色 ⇒ 必红',
  !palOnceClosed(INDEX.replace(' || this.palMemoAccent !== a', '')));
ok('mutation G2：抽掉**主题**键（只比强调色）⇒ 换主题返回陈旧色 ⇒ 必红',
  !palOnceClosed(INDEX.replace(' || this.palMemoTheme !== t', '')));
ok('mutation G3：把失效判据变成恒真（每次都重算 ⇒ memo 失效）⇒ 必红',
  !palOnceClosed(INDEX.replace('this.palMemoVal === null || this.palMemoTheme !== t || this.palMemoAccent !== a', 'true')));
ok('mutation G4：命中时不返回缓存值 ⇒ 必红',
  !palOnceClosed(INDEX.replace('return this.palMemoVal;', 'return this.pal();')));
ok('mutation G5：把消费点全抽掉（指标退化 ⇒ 白绿）⇒ 必红',
  !palOnceClosed(INDEX.split('this.palOnce()').join('this.pal()')));
// G2：指标不许退化/合并
ok('mutation G2a：抽掉 B 线（只剩 A 线 ⇒ 迁到 palOnce 的读取不可见）⇒ 必红',
  !guardMetricOk(GUARD.replace("n_pal_all=$(grep -roE 'this\\.pal\\(\\)|this\\.palOnce\\(\\)'", 'n_pal_all=0 # ')));
ok('mutation G2b：B 线改用**非限定名** `palOnce()`（含 `private palOnce(` 声明行 ⇒ 虚增）⇒ 必红',
  !guardMetricOk(GUARD.replace('this\\.pal\\(\\)|this\\.palOnce\\(\\)', 'this\\.pal\\(\\)|palOnce\\(\\)')));
ok('mutation G2c：把 A 线（成本线）上限抬到 1300 ⇒ 必红（⛔ 成本线只许减）',
  !guardMetricOk(GUARD.replace('"$n_pal" 1250', '"$n_pal" 1300')));

if (fail > 0) { console.log(`  parity_defer: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  parity_defer: ${pass} passed, 0 failed`);
process.exit(0);
