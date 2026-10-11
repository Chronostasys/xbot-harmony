/**
 * 开屏**生命周期阶段契约**（T0→T1→T2→T3→首屏）—— 单一清单式判据。
 *
 * 四条不变量（每条都有**独立**的失败故事，都是本仓真实修过的缺陷）：
 *   ① **T0↔T1 同色**：`startWindowBackground`（base / dark 各一）与 `splashBrandCanvas()` **逐字节相等**。
 *      漂移即红。失败故事：T1 曾跟**应用主题** ⇒ 浅色用户看到"深 T0 → 白 T1"**硬切**（真机实证）。
 *   ② **T2 是渐隐、不是硬切**：`splashExitOpacityAt` 端点正确 / 值域 [0,1] / 单调不增 / **存在中间态**。
 *   ③ **交棒唯一性**：splash 卸载**只有一个位点**（`showSplash = false`），且**由淡出完成回调**触发。
 *   ④ **首屏不得在 splash 之后才挂载**（"淡出揭示的是**已渲染**的首屏"）——
 *      形态代理：`this.showSplash` 的**引用点总数固定**（声明 / `if` 守卫 / 唯一赋值）⇒ 任何人拿它去
 *      **gate 主内容**（多一处引用）即红。失败故事：若主内容被 `showSplash` 包着 ⇒ 淡出后会见到
 *      "空一下再填"的跳变（而不是平滑揭示）。
 *
 * ⛔ 纪律：读**真实源码**；**先自证扫描器**（打印每个不变量读到的实际值/计数）；**零扫描判红**；
 *   断言全部落在文件末尾汇总 `if (fail > 0)` **之外**（本仓 GOTCHA：写在汇总后 = **死区**）。
 * mutation：四条各一（改 T0 色 / 渐隐改硬切 / 增第二处卸载 / 多一处 `showSplash` 引用）。
 *   ⚠️ **备份要取"改后"版本**（`tokens-ux` 踩过：用改前备份还原会吃掉未提交补丁）。
 *
 * ⚠️ 有 `export {}`（⇒ TS 模块），避免与"无 import 的全局脚本"测试在聚合编译里撞名（本仓已入库 GOTCHA）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

import { splashBrandCanvas, splashExitOpacityAt, SPLASH_EXIT_MS } from '../../entry/src/main/ets/core/splash';
import { paletteOf } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    const n = i + 1 < src.length ? src.charAt(i + 1) : '';
    if (c === '/' && n === '/') {
      while (i < src.length && src.charAt(i) !== '\n') { i++; }
      if (i < src.length) { out += '\n'; i++; }
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src.charAt(i) === '*' && i + 1 < src.length && src.charAt(i + 1) === '/')) {
        if (src.charAt(i) === '\n') { out += '\n'; }
        i++;
      }
      i += 2;
    } else { out += c; i++; }
  }
  return out;
}
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/core/splash.ets'))) { return p; }
  }
  return '';
}
const root: string = findRoot();
ok('探测到仓库根', root.length > 0);
const R = (p: string): string => path.join(root, p);

// ── ① T0 ↔ T1 逐字节同色 ─────────────────────────────────────────────────────
{
  const readColor = (rel: string): string => {
    const j: any = JSON.parse(fs.readFileSync(R(rel), 'utf8'));
    for (const c of j.color) { if (c.name === 'start_window_background') { return String(c.value).toUpperCase(); } }
    return '';
  };
  const baseC: string = readColor('entry/src/main/resources/base/element/color.json');
  const darkC: string = readColor('entry/src/main/resources/dark/element/color.json');
  const t1: string = splashBrandCanvas().toUpperCase();
  console.log(`▶ ① 色值自证：base=${baseC} · dark=${darkC} · splashBrandCanvas=${t1}`);
  ok('① 两个 color.json 都能读到 start_window_background（零扫描判红）', baseC.length > 0 && darkC.length > 0);
  eq('① base 的 T0 底色 == T1 品牌画布（逐字节）', baseC, t1);
  eq('① dark 的 T0 底色 == T1 品牌画布（逐字节）', darkC, t1);
}

// ── ①b **C6：画布**不得跟应用主题**（方向 (b) 品牌开屏恒深）─────────────────────────
//   失败故事：T1 若跟应用主题 ⇒ 浅色用户看到 T0(恒深 `#0B0B0E`) → T1(白) **硬切**。
//   ⛔ 契约 = `splashBrandCanvas()` **无入参**且取值**不等于任何浅色主题的画布**（只等于深色档）。
{
  const src: string = fs.readFileSync(R('entry/src/main/ets/core/splash.ets'), 'utf8');
  const sig: string = 'export function splashBrandCanvas(): string {';
  ok('①b 画布函数**无入参**（结构上不可能跟主题）', src.indexOf(sig) >= 0);
  const at: number = src.indexOf(sig);
  const body: string = at >= 0 ? src.substring(at, src.indexOf('}', at)) : '';
  ok('①b 函数体**不含 `theme`**（⛔ 不得读主题）', body.indexOf('theme') < 0);
  const canvas: string = splashBrandCanvas().toUpperCase();
  console.log(`▶ ①b 画布不随主题自证：canvas=${canvas} · porcelain=${paletteOf('porcelain').appBg.toUpperCase()}`
    + ` · light=${paletteOf('light').appBg.toUpperCase()} · dark=${paletteOf('dark').appBg.toUpperCase()}`);
  ok('①b **不等于** porcelain 的画布（浅色主题下不翻白）', canvas !== paletteOf('porcelain').appBg.toUpperCase());
  ok('①b **不等于** light 的画布', canvas !== paletteOf('light').appBg.toUpperCase());
  eq('①b **等于** dark 的画布（恒深档）', canvas, paletteOf('dark').appBg.toUpperCase());
}

// ── ② T2 是渐隐（不是硬切）──────────────────────────────────────────────────
{
  eq('② 起点 α=1', splashExitOpacityAt(0, false), 1);
  eq('② 终点 α=0', splashExitOpacityAt(SPLASH_EXIT_MS, false), 0);
  let bounded = true, mono = true, sawMid = false, prev = 2;
  for (let i = 0; i <= 100; i++) {
    const v: number = splashExitOpacityAt((SPLASH_EXIT_MS * i) / 100, false);
    if (!(v >= 0 && v <= 1)) { bounded = false; }
    if (v > prev + 1e-12) { mono = false; }
    if (v > 0.02 && v < 0.98) { sawMid = true; }
    prev = v;
  }
  console.log(`▶ ② 轨迹自证：EXIT=${SPLASH_EXIT_MS}ms · 值域有界=${bounded} · 单调=${mono} · 有中间态=${sawMid}`);
  ok('② 值域 [0,1]（无超调 ⇒ 合成色不亮于目的地 ⇒ 无白闪）', bounded);
  ok('② 单调不增', mono);
  ok('② **存在中间态**（⇒ 是渐隐，不是硬切）', sawMid);
}

// ── ③ 交棒唯一性：`showSplash = false` 只有一个位点，且在 `onSplashDone` 里 ──────────
// ── ④ 首屏不得被 `showSplash` gate：`this.showSplash` 引用点总数固定 ────────────────
{
  const idx: string = stripComments(fs.readFileSync(R('entry/src/main/ets/pages/Index.ets'), 'utf8'));
  const assignSites: number = (idx.match(/this\.showSplash\s*=\s*false/g) || []).length;
  const refs: number = (idx.match(/this\.showSplash/g) || []).length;
  const doneFn: number = idx.indexOf('private onSplashDone(): void');
  const guardSites: number = (idx.match(/if \(this\.showSplash\)/g) || []).length;
  console.log(`▶ ③④ 形态自证：showSplash=false ×${assignSites} · this.showSplash 引用 ×${refs}`
    + ` · if(this.showSplash) 守卫 ×${guardSites} · onSplashDone 定位=${doneFn >= 0}`);
  ok('③ 卸载位点**恰好 1 处**（`this.showSplash = false`）', assignSites === 1);
  ok('③ `onSplashDone()` 存在，且**它是**那个唯一赋值点（交棒由回调触发）',
    doneFn >= 0 && idx.substring(doneFn, doneFn + 400).indexOf('this.showSplash = false') >= 0);
  ok('④ `this.showSplash` 只用作"splash 覆盖层的守卫"（守卫恰好 1 处 `if (this.showSplash)`）', guardSites === 1);
  // ④ 直接判"这个守卫**只**gate 覆盖层" —— ⛔ 我第一版用"引用点恰好 3 个"做代理 ⇒ **错**（实测 6 处：
  //    `startSplash`/`beginExitSplash`/`skipSplash` 等都合法地读写它）⇒ 代理必须**贴着真属性**写：
  //    取 `if (this.showSplash) { … }` 的**块体**（括号配对），断言"里头只有 SplashOverlay，没有别的内容渲染"。
  let guardBody: string = '';
  const gi: number = idx.indexOf('if (this.showSplash)');
  if (gi >= 0) {
    const open: number = idx.indexOf('{', gi);
    let depth = 0;
    for (let i: number = open; i < idx.length; i++) {
      const ch: string = idx.charAt(i);
      if (ch === '{') { depth++; } else if (ch === '}') { depth--; if (depth === 0) { guardBody = idx.substring(open, i + 1); break; } }
    }
  }
  console.log(`▶ ④ 守卫块体长度=${guardBody.length}（应是小块：只包覆盖层）`);
  ok('④ 守卫块体能定位（零扫描判红）', guardBody.length > 0);
  ok('④ 守卫块体里**有** `SplashOverlay(`（它 gate 的正是覆盖层）', guardBody.indexOf('SplashOverlay(') >= 0);
  ok('④ 守卫块体里**没有**内容渲染（⛔ 不得 gate 主内容：无 `ForEach(`/`ListView(`/`Toast(`）—— 否则'
    + '淡出后会"空一下再填"，不是平滑揭示',
    guardBody.indexOf('ForEach(') < 0 && guardBody.indexOf('ListView(') < 0 && guardBody.indexOf('Toast(') < 0);
  ok('④ 守卫块体足够小（≤ 600 字符 = 只有一个覆盖层调用）', guardBody.length <= 600);
}

if (fail > 0) { console.log(`  splash_lifecycle_contract: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  splash_lifecycle_contract: ${pass} passed, 0 failed`);
process.exit(0);
