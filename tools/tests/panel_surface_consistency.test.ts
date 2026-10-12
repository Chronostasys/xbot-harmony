/**
 * panel_surface_consistency —— 目标③「**所有面板同一套面语言**」形态判据（2026-10-12，15o·d）。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────────
 * 用户口径：「现在侧边栏丑的要死……**我只说了侧边栏但是你要考虑所有的面板**」。
 * 真机截图实锤一个**面语言分裂**：**8 个浮层面板**（能力面板/待发队列/会话统计/任务详情/终端/
 * 状态/文件/AskUser）根容器一律**实底** `surfaceFillOf(pal,'surface.overlay')`；
 * 而**抽屉**是唯一用玻璃的（`eff().glassBg` alpha **0.84** + `BlurStyle.Regular`）。
 * 抽屉背后恰好是**高密度正文**（代码块 + 思考段）⇒ 0.84 的玻璃把它透上来，整片糊成灰斑
 * =「脏」（大面积 ≠ 小芯片：玻璃在小面是质感、在大面是噪点）⇒ 已统一为实底 overlay 面。
 *
 * ── 本判据守什么（三条核心断言 · 各自可判别）────────────────────────────────────
 *   A. **8 个浮层组件根容器** = 实底 overlay 面（取**最后一个** `.backgroundColor(...)`——
 *      ArkUI 的根容器属性块写在 builder 末尾）。
 *   B. **抽屉根容器**（`pages/Index.ets` 的 `DrawerSheet()` 切片）= 实底 overlay 面，
 *      且切**不**得再出现 `glassBg`/`backgroundBlurStyle`（透字源）。
 *   C. **同一 role 字符串**：9 处根容器取的 role 必须是**同一个** `'surface.overlay'`
 *      （别名 `this.bgOverlay()` 亦计入，其实现见 `SessionStatsSheet.bgOverlay()`）。
 *      ⛔ 这条防的是"92% vs 94%"式的**悄悄漂移**：面语言一旦两家口径，就会再长出"脏"的面。
 *
 * ── 纪律（沿用本仓 `polish_states_press` 等形态判据的先例）──────────────────────
 *   · **剥注释**：本次抽屉切片里"唯一"的 `glassBg` 字样就在**我写的理由注释**里
 *     ⇒ 不剥会把文档当违规（假红）。剥注释走**带字符串态**的小状态机（⛔ 不能裸 `split('//')`：
 *     代码里 `'http://…'`、`'sys.symbol.xmark'` 之类的字符串会被误剥）。
 *   · **零扫描判红**：源文件读不到 / 切片为空 ⇒ 红（防"扫描器坏掉 = 白绿"）。
 *   · **扫描器自证（mutation 等价物）**：把"必红样本"（`eff().glassBg`）与"应绿样本"
 *     （overlay 面 / `bgOverlay()` 别名）喂给**同一个**判定函数，双向都要对
 *     ——⛔ 这比"改真源码再改回来"安全（共享工作树里不做注入-回滚）。
 *   · `export {}`（⇒ TS 模块）：避免与聚合编译里的兄弟测试顶层符号相撞。
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

/** 仓库根（沿用 `polish_states_press` 先例：harness 把测试编译到 `tools/tests/.out-<pid>/` ⇒ 逐级上探）。 */
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(p, 'entry/src/main/ets/components'))) { return p; }
  }
  return '';
}
const ROOT: string = findRoot();
ok('探测到仓库根（零扫描判红）', ROOT.length > 0);

/** 剥注释：带字符串态（单/双/模板）扫描 ⇒ 只丢真注释，不误伤 `'http://…'` 这类字符串。 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 0; // 0=代码 1='…' 2="…" 3=`…`
  while (i < n) {
    const c: string = src.charAt(i);
    const d: string = i + 1 < n ? src.charAt(i + 1) : '';
    if (mode === 0) {
      if (c === '/' && d === '/') { while (i < n && src.charAt(i) !== '\n') { i++; } continue; }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < n && !(src.charAt(i) === '*' && src.charAt(i + 1) === '/')) { i++; }
        i += 2;
        continue;
      }
      if (c === "'") { mode = 1; } else if (c === '"') { mode = 2; } else if (c === '`') { mode = 3; }
      out += c; i++; continue;
    }
    if (c === '\\') { out += c; if (i + 1 < n) { out += src.charAt(i + 1); } i += 2; continue; }
    if ((mode === 1 && c === "'") || (mode === 2 && c === '"') || (mode === 3 && c === '`')) { mode = 0; }
    out += c; i++;
  }
  return out;
}

/** 取**最后一个** `.backgroundColor(` 的实参（括号配对扫描；根容器属性块在 builder 末尾）。 */
function lastBgArg(src: string): string {
  const key = '.backgroundColor(';
  const at: number = src.lastIndexOf(key);
  if (at < 0) { return ''; }
  let i: number = at + key.length;
  let depth = 1;
  let out = '';
  while (i < src.length && depth > 0) {
    const c: string = src.charAt(i);
    if (c === '(') { depth++; }
    if (c === ')') { depth--; if (depth === 0) { break; } }
    out += c; i++;
  }
  return out.trim();
}

/** 判定：该实参是否是**实底 overlay 面**（真源 role 或本仓既有别名）。 */
function isOverlaySurface(arg: string): boolean {
  return roleOf(arg) === 'surface.overlay';
}

/**
 * 实参 ⇒ **面语言 role**（比拼写更粗、但不放过换材质）。
 * `pal()` / `palOnce()` / `bgOverlay()` 是**同一 role 的合法别名**（都取 `surface.overlay`）
 * ⇒ 归一化到 role 才能判"有没有第二家口径"；⛔ 否则会把 `pal` vs `palOnce` 的合法差异误判成漂移。
 */
function roleOf(arg: string): string {
  const a: string = arg.replace(/\s/g, '');
  if (a === 'this.bgOverlay()' || a === 'this.palOnce().bgOverlay()' || a === 'this.pal().bgOverlay()') { return 'surface.overlay'; }
  const m: number = a.indexOf("surfaceFillOf(");
  if (m >= 0 && a.indexOf("'surface.overlay'") >= 0) { return 'surface.overlay'; }
  return a; // 未识别 ⇒ 原样（必 ≠ 'surface.overlay' ⇒ 判红）
}

// ── 扫描器自证（双向 · 未跑真源码前先证判定函数有判别力）────────────────────────────
{
  ok('自证 · 实底 overlay 面 ⇒ 判绿', isOverlaySurface("surfaceFillOf(this.pal(), 'surface.overlay')"));
  ok('自证 · palOnce 变体 ⇒ 判绿', isOverlaySurface("surfaceFillOf(this.palOnce(), 'surface.overlay')"));
  ok('自证 · 别名 bgOverlay() ⇒ 判绿', isOverlaySurface('this.bgOverlay()'));
  ok('自证 · ⛔ 玻璃 glassBg ⇒ 判红（这正是"透字成脏"的形态）', !isOverlaySurface('this.eff().glassBg'));
  ok('自证 · 别的实底面（surface.input）⇒ 判红', !isOverlaySurface("surfaceFillOf(this.pal(), 'surface.input')"));
  ok('自证 · 空实参 ⇒ 判红', !isOverlaySurface(''));
  ok('自证 · lastBgArg 取最后一处', lastBgArg(".backgroundColor('a')\n  .backgroundColor('b')") === "'b'");
  ok('自证 · 剥注释：注释里的 glassBg 不算违规',
    stripComments('// 旧做法 .backgroundColor(this.eff().glassBg)\nX').indexOf('glassBg') < 0);
  ok('自证 · 剥注释不误伤字符串里的 http://',
    stripComments("const u = 'http://localhost:8082/';").indexOf("'http://localhost:8082/'") >= 0);
}

// ── 真源码断言 ─────────────────────────────────────────────────────────────────
/** [显示名, 相对路径]*/
const PANELS: string[][] = [
  ['AskUserSheet（提问卡）', 'entry/src/main/ets/components/AskUserSheet.ets'],
  ['PluginsSheet（能力面板）', 'entry/src/main/ets/components/PluginsSheet.ets'],
  ['QueueSheet（待发队列）', 'entry/src/main/ets/components/QueueSheet.ets'],
  ['SessionStatsSheet（会话统计）', 'entry/src/main/ets/components/SessionStatsSheet.ets'],
  ['TaskDetailSheet（任务详情）', 'entry/src/main/ets/components/TaskDetailSheet.ets'],
  ['TerminalSheet（终端）', 'entry/src/main/ets/components/TerminalSheet.ets'],
  ['StatusSheet（状态）', 'entry/src/main/ets/components/StatusSheet.ets'],
  ['FilesSheet（文件）', 'entry/src/main/ets/components/FilesSheet.ets'],
];

const roles: string[] = [];
let scanned = 0;

for (const pair of PANELS) {
  const name: string = pair[0];
  const rel: string = pair[1];
  const abs: string = pathMod.join(ROOT, rel);
  if (!fsMod.existsSync(abs)) {
    ok(`${name} 源存在（零扫描判红）`, false, `missing ${rel}`);
    continue;
  }
  const src: string = stripComments(fsMod.readFileSync(abs, 'utf-8'));
  if (src.length === 0) {
    ok(`${name} 源非空（零扫描判红）`, false, rel);
    continue;
  }
  scanned++;
  ok(`${name} 是组件（@Component 存在）`, src.indexOf('@Component') >= 0, rel);
  const arg: string = lastBgArg(src);
  ok(`A. ${name} 根容器 = 实底 overlay 面`, isOverlaySurface(arg), `got: ${arg}`);
  roles.push(roleOf(arg));  // ⛔ 存 **role**（不是拼写）：pal/palOnce/bgOverlay 是同一 role 的别名
}

// ── B/C. 抽屉（唯一曾是玻璃的那张面）─────────────────────────────────────────────
{
  const idxRel = 'entry/src/main/ets/pages/Index.ets';
  const idxSrc: string = stripComments(fsMod.readFileSync(pathMod.join(ROOT, idxRel), 'utf-8'));
  const start: number = idxSrc.indexOf('DrawerSheet() {');
  const endAt: number = idxSrc.indexOf('@Builder', start + 10);
  const slice: string = start >= 0 ? idxSrc.substring(start, endAt > start ? endAt : start + 9000) : '';
  ok('B0. 抽屉切片非空（零扫描判红）', slice.length > 1000, `len=${slice.length}`);
  ok('B1. 抽屉根容器 = 实底 overlay 面', isOverlaySurface(lastBgArg(slice)), `got: ${lastBgArg(slice)}`);
  ok('B2. ⛔ 抽屉已无 glassBg（透字源之一）', slice.indexOf('glassBg') < 0);
  ok('B3. ⛔ 抽屉已无 backgroundBlurStyle（透字源之二）', slice.indexOf('backgroundBlurStyle') < 0);
  // ⚠️ B4 一度写成只钉**令牌名**（`indexOf('STROKE_HAIRLINE')`）⇒ 假绿：我改面语言时误删了整行
  //    `.borderWidth({ right: STROKE_HAIRLINE })`，而抽屉切片里**别处**也有该令牌 ⇒ 判据没红。
  //    ⇒ 改钉**调用片段**（⛔ 本仓 GOTCHA：判据要取调用片段，别取"出现过这个词"）。
  ok('B4. 抽屉根容器仍保留右缘发丝线（调用片段）',
    slice.indexOf(".borderWidth({ right: STROKE_HAIRLINE })") >= 0);
  ok('B4b. 发丝线颜色走 hairlineOf（不写字面量）',
    slice.indexOf('.borderColor(hairlineOf(this.pal()))') >= 0);
  ok('B5. 抽屉仍保留投影（层次不丢）', slice.indexOf(".shadow(") >= 0);
  ok('B6. 抽屉仍走底座过渡 drawerTransition()', slice.indexOf('drawerTransition()') >= 0);
  if (slice.length > 1000) { roles.push(roleOf(lastBgArg(slice))); scanned++; }
}

// ── C. 同一 role 口径（防"两家口径"式漂移）───────────────────────────────────────
{
  ok('C0. 零扫描判红：扫到 9 个浮层根容器', scanned === 9, `scanned=${scanned}`);
  const uniq: string[] = [];
  for (const r of roles) { if (uniq.indexOf(r) < 0) { uniq.push(r); } }
  ok('C1. 9 处根容器面语言**唯一**（无第二家口径）', uniq.length === 1, `uniq=${JSON.stringify(uniq)}`);
  ok('C2. 该唯一口径 = 实底 overlay 面', uniq.length === 1 && uniq[0] === 'surface.overlay', `uniq=${JSON.stringify(uniq)}`);
}

console.log(`  panel_surface_consistency: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
