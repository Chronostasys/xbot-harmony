/**
 * 主按钮簇「**单一 busy 源**」的源码形态门禁（§21.120）。
 *
 * ── 为什么要钉形态、而不是只钉纯函数 ─────────────────────────────────────────────
 *   纯函数 `core/composer.composerButtonState` 的**语义**由 `composer.test.ts` 钉死；
 *   但"页面**真的**只从它取那几个布尔"是另一回事 —— 2026-10-15 审计实测的缺陷正是
 *   **语义对、接线错**：主按钮读 `runningNow()`、模式 chip 读**裸 `this.busy`**
 *   ⇒ 两者分叉时用户看到「停止按钮 + 没有模式 chip」这种自相矛盾的按钮簇。
 *   ⇒ 本门禁钉**调用点形态**（本仓惯例：形态断言必须钉调用点，钉"方法体存在"会假绿）。
 *
 * ⛔ 零扫描必须判红（白绿防线）：先断言"这些锚点都被扫到了"，否则改个名字就能让门禁假绿。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 必须把本文件声明为**模块**（`export {}`）—— 否则它是"全局脚本"，顶层 `declare`/`const` 会与
//    另一个全局脚本测试（如 `one_inflight_motion.test.ts`）**共用同一全局作用域** ⇒ tsc TS2451
//    "Cannot redeclare block-scoped variable 'process'"（2026-10-15 真门禁 ① 实测抓到）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const PAGE: string = path.join(REPO, 'entry/src/main/ets/pages/Index.ets');
const CORE: string = path.join(REPO, 'entry/src/main/ets/core/composer.ets');

/** 去掉行注释与块注释（否则注释里引用的旧写法会把门禁判红/判绿）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = 0;
  while (true) {
    const j = src.indexOf(needle, i);
    if (j < 0) { break; }
    n++; i = j + needle.length;
  }
  return n;
}
/** 取某方法声明之后 `len` 个字符（够覆盖方法体；⛔ 只用于"调用点形态"断言）。 */
function bodyAfter(src: string, decl: string, len: number): string {
  const i = src.indexOf(decl);
  if (i < 0) { return ''; }
  return src.slice(i, i + decl.length + len);
}

if (!fs.existsSync(PAGE) || !fs.existsSync(CORE)) {
  console.log(`  ✗ 锚点文件不存在：${PAGE} / ${CORE}`);
  console.log('  composer-button-wiring: 0 passed, 1 failed');
  process.exit(1);
}
const pageSrc: string = stripComments(fs.readFileSync(PAGE, 'utf8'));
const coreSrc: string = stripComments(fs.readFileSync(CORE, 'utf8'));

// ── ① 纯函数存在且被页面**真消费**（不是"定义了没人用"的死消费） ───────────────
ok('core/composer 导出 composerButtonState',
  countOf(coreSrc, 'export function composerButtonState(') >= 1);
ok('core/composer 导出 ComposerButton 类', countOf(coreSrc, 'export class ComposerButton') >= 1);
ok('页面 import composerButtonState', countOf(pageSrc, 'composerButtonState') >= 2); // import + 调用
const btnDef = countOf(pageSrc, 'private composerBtn(): ComposerButton {');
ok('页面有 composerBtn() 汇聚点', btnDef === 1);
ok('composerBtn() 调 composerButtonState(', countOf(pageSrc, 'composerButtonState(running, this.composerCanSend()') >= 1);

// ── ② 三个布尔**只从汇聚点取**（⛔ 不许各自重算） ─────────────────────────────
const bodyStop = bodyAfter(pageSrc, 'private composerShowStop(): boolean {', 160);
ok('composerShowStop 体 = composerBtn().showStop', bodyStop.indexOf('composerBtn().showStop') >= 0);
ok('composerShowStop 不再自行判 runningNow()', bodyStop.indexOf('runningNow()') < 0);
const bodyCancelling = bodyAfter(pageSrc, 'private composerCancelling(): boolean {', 160);
ok('composerCancelling 体 = composerBtn().cancelling', bodyCancelling.indexOf('composerBtn().cancelling') >= 0);

// ── ③ ★核心★ 模式 chip 与占位文案必须走**同一个** running（缺陷本体） ────────────
ok('模式 chip 门槛 = composerBtn().running',
  countOf(pageSrc, 'if (this.composerBtn().running) {') === 1);
ok('⛔ 页面里已无 `if (this.busy) {`（旧的分叉门槛）', countOf(pageSrc, 'if (this.busy) {') === 0);
ok('chip 的锚点仍在（`Text(modeLabel(this.sendMode))` 紧随门槛）',
  ['this.composerBtn().running) {\n          Text(modeLabel(this.sendMode))',
    'this.composerBtn().running) {\r\n          Text(modeLabel(this.sendMode))']
    .some((s) => pageSrc.indexOf(s) >= 0));
ok('占位文案 busy 入参 = composerBtn().running',
  countOf(pageSrc, 'composerPlaceholder(this.composerBtn().running') === 1);
ok('占位文案不再用裸 this.busy',
  countOf(pageSrc, 'composerPlaceholder(this.busy') === 0);
ok('⚡ 图标判据 = composerBtn().interject',
  countOf(pageSrc, "this.composerBtn().interject ? $r('sys.symbol.bolt_fill')") === 1);

// ── ④ 零扫描判红（白绿防线）：锚点计数必须 > 0 ────────────────────────────────
ok('零扫描判红：锚点合计 > 0',
  btnDef + countOf(pageSrc, 'if (this.composerBtn().running) {') +
  countOf(coreSrc, 'export function composerButtonState(') > 0);

console.log(`  composer-button-wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
