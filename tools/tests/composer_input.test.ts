/**
 * composer 输入态门禁 —— 把"键盘/输入"的几个**结构不变量**做成可判定（源码形态）。
 *
 * ── 为什么（本轮"键盘/输入态审计"的产物）──────────────────────────────────────────────
 * 输入是最高频交互面，它的"不爽"最伤。可离线判定的四类：
 *   ① **高度自适应有上限**（`constraintSize{minHeight,maxHeight}`）—— 多行增长、超高内部滚动；<br>
 *   ② **键盘避让已配置**（`KeyboardAvoidMode.RESIZE`，在 `EntryAbility`）—— 输入框不被键盘遮；
 *   ③ **焦点 id 单一来源**（`COMPOSER_INPUT_ID` 定义一处、`.id()` 用同一常量）；
 *   ④ **深链 `input.focus` 必须"挂载后"聚焦**（`aboutToAppear→bootstrap` 早于 `build()` ⇒
 *      同步 `requestFocus` 会静默失败）—— 反向断言：**不得**存在"同步调用后紧跟 return"的旧形态。
 *
 * ✅ 扫描器自证：打印扫的文件 + 逐项命中；✅ **零扫描判红**（文件非空）。
 * ⚠️ 汇总**无条件打印** + `process.exit(fail>0?1:0)`（勿包进 `if`，见 `docs/CI.md` 死区坑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 必须标记为**模块**（否则顶层 pass/fail 落进全局作用域，与其它脚本测试重名冲突 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const IX: string = 'entry/src/main/ets/pages/Index.ets';
const EA: string = 'entry/src/main/ets/entryability/EntryAbility.ets';

/** 剥注释（块 + 行；行注释 `(^|[^:])//`）—— 只认生产代码。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}
const ix: string = stripComments(fs.readFileSync(path.join(REPO, IX), 'utf8'));
const ea: string = stripComments(fs.readFileSync(path.join(REPO, EA), 'utf8'));

// ── 扫描器自证 ──────────────────────────────────────────────────────────────────
const cDef: number = countOf(ix, 'export const COMPOSER_INPUT_ID');
const cUse: number = countOf(ix, '.id(COMPOSER_INPUT_ID)');
const cCap: number = countOf(ix, 'constraintSize({ minHeight: 40, maxHeight: 150 })');
const cAvoid: number = countOf(ea, 'KeyboardAvoidMode.RESIZE');
const cFocus: number = countOf(ix, 'focusControl.requestFocus(COMPOSER_INPUT_ID)');
const cDelayConst: number = countOf(ix, 'FOCUS_AFTER_MOUNT_MS');
const cSyncForm: number = countOf(ix, 'focusControl.requestFocus(COMPOSER_INPUT_ID);\n      return;');
console.log(`  input-scan files: ${IX}, ${EA}`);
console.log(`  input-scan id-def=${cDef} id-use=${cUse} heightCap=${cCap} kbAvoid=${cAvoid}`
  + ` focus=${cFocus} focusDelayConst=${cDelayConst} syncOldForm=${cSyncForm}`);

// ① 高度自适应有上限（多行增长；超高内部滚动）
ok(`composer TextArea 有高度上限（constraintSize min40/max150，${cCap} ≥ 1）`, cCap >= 1);
// ② 键盘避让已配置（RESIZE ⇒ 页面收缩，输入框不被遮）
ok(`EntryAbility 配了 KeyboardAvoidMode.RESIZE（${cAvoid} ≥ 1）`, cAvoid >= 1);
// ③ 焦点 id 单一来源（定义一处 + 用常量挂 id）
ok(`COMPOSER_INPUT_ID 定义一处（${cDef} === 1）`, cDef === 1);
ok(`TextArea 用同一常量挂 id（.id(COMPOSER_INPUT_ID) ${cUse} ≥ 1）`, cUse >= 1);
// ④ 深链聚焦**必须延后**：有延迟常量 + 无"同步调用紧跟 return"的旧形态
ok(`深链聚焦有挂载后延迟常量（FOCUS_AFTER_MOUNT_MS ${cDelayConst} ≥ 2：声明 + 使用）`, cDelayConst >= 2);
ok(`requestFocus 调用点存在（${cFocus} ≥ 1）`, cFocus >= 1);
ok(`**不得**存在"同步 requestFocus 后紧跟 return"的旧形态（${cSyncForm} === 0）`, cSyncForm === 0);
// 零扫描判红
ok(`零扫描判红：两文件非空（${ix.length}+${ea.length} > 0）`, ix.length + ea.length > 0);
ok('零扫描判红：逆否自证——countOf 能数到探针', countOf('afocusControl.requestFocus(COMPOSER_INPUT_ID)', 'focusControl.requestFocus(COMPOSER_INPUT_ID)') === 1);

console.log(`  composer_input: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
