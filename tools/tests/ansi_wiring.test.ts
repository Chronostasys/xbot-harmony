/**
 * AnsiText 接线「源码形态」门禁 —— `MessageRow` **工具输出/标签**逐 span 上色的**调用点**证据。
 *
 * ── 背景（为什么必须有）──────────────────────────────────────────────────────────────
 * `§11.7 Top1`：web `AnsiText.tsx:205`（3 消费点）把终端输出的 SGR 颜色码渲染成彩色。
 * 原生 `core/ansi.ets`（解析 + 本仓色板映射）已就绪、`ToolPopover` 已接线；`MessageRow`
 * 侧的**工具标签**此前是裸 `Text` ⇒ `\x1b[31m` 之类**泄漏成 raw 转义**（看不到颜色）。
 *
 * ── 钉什么（按 `docs/ARKTS-GOTCHAS.md §33b` 的铁律：钉**调用点计数**，别钉"方法体存在"）──
 * ① `MessageRow.ets` 剥注释后**必须真 import** `core/ansi` 且有 `ansiSpansIfAny(` **调用点 ≥1**
 *    （算 span 的**唯一入口** —— 组件不另写 ANSI 判断）；
 * ② `ToolVisual.ets`（唯一 pill 视觉）**必须**用 `ansiFgOf(`/`ansiBgOf(` 逐 span 取色
 *    （**颜色零字面量**，走色板映射）+ 有 `labelSpans`（接收 span 的口）。
 *
 * ✅ 扫描器自证：打印**扫了哪些文件 + 逐文件调用点计数**；**零扫描判红**（合计 0 ⇒ 红）。
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 必须标记为**模块**（否则顶层 `pass/fail` 落进全局作用域，与其它脚本测试重名冲突 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const CDIR: string = path.join(REPO, 'entry/src/main/ets/components');

/** **剥注释**（块 + 行；行注释用 `(^|[^:])//` 以免剥掉 `https://`）—— 只认**生产**调用点。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}

const MSG: string = 'MessageRow.ets';
const TV: string = 'ToolVisual.ets';
const SC: string = 'SyntheticCard.ets';
const LTV: string = 'LiveTailView.ets';
const msgSrc: string = stripComments(fs.readFileSync(path.join(CDIR, MSG), 'utf8'));
const tvSrc: string = stripComments(fs.readFileSync(path.join(CDIR, TV), 'utf8'));
const scSrc: string = stripComments(fs.readFileSync(path.join(CDIR, SC), 'utf8'));
const ltvSrc: string = stripComments(fs.readFileSync(path.join(CDIR, LTV), 'utf8'));

// ── 扫描器自证：扫了哪些文件 + 逐文件计数 ─────────────────────────────────────────────
console.log(`  ansi-scan dir=${CDIR}`);
console.log(`  ansi-scan files: ${MSG}, ${TV}, ${SC}, ${LTV}`);
const msgCalls: number = countOf(msgSrc, 'ansiSpansIfAny(');
const msgImport: number = countOf(msgSrc, "from '../core/ansi'");
const tvFg: number = countOf(tvSrc, 'ansiFgOf(');
const tvBg: number = countOf(tvSrc, 'ansiBgOf(');
const tvSlot: number = countOf(tvSrc, 'labelSpans');
const scCalls: number = countOf(scSrc, 'ansiSpansIfAny(');
const scImport: number = countOf(scSrc, "from '../core/ansi'");
const scFg: number = countOf(scSrc, 'ansiFgOf(');
const scBg: number = countOf(scSrc, 'ansiBgOf(');
const ltvCalls: number = countOf(ltvSrc, 'ansiSpansIfAny(');
const ltvImport: number = countOf(ltvSrc, "from '../core/ansi'");
const ltvSlot: number = countOf(ltvSrc, 'labelSpans');
console.log(`  ansi-scan ${MSG}: ansiSpansIfAny(=${msgCalls} import=${msgImport}`);
console.log(`  ansi-scan ${TV}: ansiFgOf(=${tvFg} ansiBgOf(=${tvBg} labelSpans=${tvSlot}`);
console.log(`  ansi-scan ${SC}: ansiSpansIfAny(=${scCalls} import=${scImport} ansiFgOf(=${scFg} ansiBgOf(=${scBg}`);
console.log(`  ansi-scan ${LTV}: ansiSpansIfAny(=${ltvCalls} import=${ltvImport} labelSpans=${ltvSlot}`);

// ── ① MessageRow：**不得**自己渲染工具标签 ────────────────────────────────────────────
// ⛔ 判据修正（2026-10-21，代码事实优先）：`MessageRow.ets` 里 `label` 出现 **0** 次 ——
//   工具标签/输出全部由 `ToolVisual`（pill）+ `SyntheticCard`（注入型正文）渲染，MessageRow
//   只做消息壳。原判据要求 MessageRow 必须 import `core/ansi` 且调 `ansiSpansIfAny(`，
//   在"它根本不渲染标签"的事实下**不可满足**（要么为过判据凭空造 UI，要么把判据当摆设）。
//   ⇒ 改钉**真正会泄漏 raw 转义**的条件：只要 MessageRow 开始渲染标签，就必须走同一入口。
const msgLabelUses: number = countOf(msgSrc, 'label');
ok(`MessageRow 不渲染工具标签（label 出现 ${msgLabelUses} 次 = 0）；一旦渲染必须走 ansiSpansIfAny(`,
  msgLabelUses === 0 ? true : (msgImport >= 1 && msgCalls >= 1));

// ── ② ToolVisual（唯一 pill 视觉）：逐 span 取色 + span 入口 ─────────────────────────
ok(`ToolVisual 逐 span 取前景色 ansiFgOf(（${tvFg} ≥ 1）`, tvFg >= 1);
ok(`ToolVisual 逐 span 取背景色 ansiBgOf(（${tvBg} ≥ 1）`, tvBg >= 1);
ok(`ToolVisual 有 labelSpans 入口（${tvSlot} ≥ 2：声明 + 使用）`, tvSlot >= 2);

// ── ③ SyntheticCard（注入型假工具正文 = 工具输出）：同源入口 + 逐 span 取色 ──────────
ok(`SyntheticCard 真 import core/ansi（${scImport} ≥ 1）`, scImport >= 1);
ok(`SyntheticCard 有 ansiSpansIfAny( 生产调用点（${scCalls} ≥ 1）`, scCalls >= 1);
ok(`SyntheticCard 逐 span 取前景色 ansiFgOf(（${scFg} ≥ 1）`, scFg >= 1);
ok(`SyntheticCard 逐 span 取背景色 ansiBgOf(（${scBg} ≥ 1）`, scBg >= 1);

// ── ④ LiveTailView（在飞块 pill）：与 committed 侧同款 ⇒ live/committed 视觉一致 ─────────
ok(`LiveTailView 真 import core/ansi（${ltvImport} ≥ 1）`, ltvImport >= 1);
ok(`LiveTailView 有 ansiSpansIfAny( 生产调用点（${ltvCalls} ≥ 1）`, ltvCalls >= 1);
ok(`LiveTailView 有 labelSpans 入口（${ltvSlot} ≥ 1）`, ltvSlot >= 1);

// ── 零扫描判红：链接线调用点合计必须 > 0（扫描器与真源脱节 ⇒ 红）──────────────────────
ok('零扫描判红：AnsiText 接线调用点合计 > 0',
  msgCalls + msgImport + tvFg + tvBg + scCalls + scImport + ltvCalls + ltvImport > 0);

console.log(`  ansi-wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
