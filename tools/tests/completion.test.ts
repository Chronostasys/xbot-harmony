/**
 * 补全浮层（`/` 命令 · `@` 文件）的**选中态 / 键盘导航 / 过滤**判据。
 *
 * 两半：
 *  ① **纯语义**（`core/composer.ets`）：选中索引越界、键盘动作映射、`@a/b` 子路径过滤
 *     —— 全是可脱机判定、可 mutation 的数值/字符串语义；
 *  ② **形态（调用点计数）**：新接线必须**真被页面消费**（本仓血教训：函数体存在 ≠ 有人调用 ⇒
 *     `matchFiles` 曾长期"存在且被测"但**页面零调用** ⇒ `@` 补全根本不按前缀过滤）。
 *
 * ⚠️ 汇总**无条件打印** + `process.exit(fail>0?1:0)`（勿包进 `if`，见 `docs/CI.md` 死区坑）。
 * ⚠️ 形态扫描**剥注释**（行注释 + 块注释）后只认生产代码，避免"注释里写了就当消费了"。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 标记为**模块**（否则顶层变量落进全局作用域，与其它脚本测试重名冲突 TS2451）。
export {};

import {
  clampSel, CMD_ROWS, completionKeyAction, FS_ROWS, FsEntry, matchFiles, mentionFilter, selNext, selPrev,
} from '../../entry/src/main/ets/core/composer';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function fs2(n: string, isDir: boolean): FsEntry { const e = new FsEntry(); e.name = n; e.isDir = isDir; return e; }

// ─────────────────────────── ① 纯语义 ───────────────────────────

// clampSel：越界夹回；空候选 ⇒ 0。
eq('clampSel 空候选', clampSel(3, 0), 0);
eq('clampSel 负索引', clampSel(-1, 5), 0);
eq('clampSel 超上界', clampSel(9, 5), 4);
eq('clampSel 合法值不动', clampSel(2, 5), 2);

// selNext（web `useCompletion.ts:375` `(i+1)%len`）：末尾回 0。
eq('↓ 末尾回 0', selNext(4, 5), 0);
eq('↓ 常规推进', selNext(0, 5), 1);
eq('↓ 空候选不越界', selNext(0, 0), 0);
eq('↓ 单候选恒 0', selNext(0, 1), 0);
eq('↓ 入参越界先夹回', selNext(9, 5), 0);

// selPrev（web `:380` `(i-1+len)%len`）：0 回末尾。
eq('↑ 0 回末尾', selPrev(0, 5), 4);
eq('↑ 常规后退', selPrev(3, 5), 2);
eq('↑ 空候选不越界', selPrev(0, 0), 0);
eq('↑ 单候选恒 0', selPrev(0, 1), 0);
eq('↑ 入参越界先夹回', selPrev(9, 5), 3);

// completionKeyAction（web `:369-397`）：键 → 语义。
eq('↓ = next', completionKeyAction('ArrowDown', false, false), 'next');
eq('↑ = prev', completionKeyAction('ArrowUp', false, false), 'prev');
eq('Tab = accept（命令）', completionKeyAction('Tab', false, false), 'accept');
eq('Tab = accept（文件）', completionKeyAction('Tab', true, false), 'accept');
eq('Enter 文件 = accept', completionKeyAction('Enter', true, false), 'accept');
// ⭐ 判别力样本：Enter 在**命令**补全上**不得**接受（web `:383` 仅 file）——否则回车就没法发送了。
eq('Enter 命令 ≠ accept', completionKeyAction('Enter', false, false), '');
eq('shift+Enter ≠ accept（换行）', completionKeyAction('Enter', true, true), '');
eq('Esc = close', completionKeyAction('Escape', false, false), 'close');
eq('普通字符不消费', completionKeyAction('a', true, false), '');

// mentionFilter：只取最后一个 `/` 之后（web `:286` filterText）。
eq('filter 无路径', mentionFilter('@abc'), 'abc');
eq('filter 子路径', mentionFilter('@a/b'), 'b');
eq('filter 下钻后空段', mentionFilter('@a/b/'), '');
eq('filter 纯 @', mentionFilter('@'), '');
eq('filter 空串', mentionFilter(''), '');

// matchFiles 子路径：⭐ 判别力样本 —— 条目是**当前目录内相对名** ⇒ 只该按最后一段匹配。
//   （改坏 mentionFilter ⇒ 拿整个 `a/b` 当前缀 ⇒ 这里必红。）
eq('子路径按末段前缀匹配', matchFiles([fs2('b.md', false), fs2('a.md', false)], '@a/b').map((e) => e.name), ['b.md']);
eq('子路径不误命同前缀父名', matchFiles([fs2('a.md', false)], '@a/b').length, 0);
eq('无路径仍全列', matchFiles([fs2('x', false), fs2('y', true)], '@').length, 2);
eq('目录优先 + 末段前缀', matchFiles([fs2('src', true), fs2('s.md', false)], '@s').map((e) => e.name), ['src', 's.md']);
// 行数上限常量（页面渲染 + 选中环绕共用，必须是正整数）。
ok(`CMD_ROWS 为正整数（${CMD_ROWS}）`, CMD_ROWS > 0 && CMD_ROWS === Math.floor(CMD_ROWS));
ok(`FS_ROWS 为正整数（${FS_ROWS}）`, FS_ROWS > 0 && FS_ROWS === Math.floor(FS_ROWS));

// ─────────────────────── ② 形态：调用点计数 ───────────────────────
const REPO: string = path.resolve(__dirname, '../../../..');
const IX_REL: string = 'entry/src/main/ets/pages/Index.ets';
const IX_PATH: string = path.join(REPO, IX_REL);

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}

const ix: string = stripComments(fs.readFileSync(IX_PATH, 'utf8'));

// 扫描器自证 + 零扫描判红
ok(`零扫描判红：Index.ets 非空（${ix.length} 字符）`, ix.length > 0);
ok('扫描器自证：countOf 能数到探针', countOf('x.onSubmit(', '.onSubmit(') === 1);

// ⭐ 本波要修的**真缺陷**：`matchFiles` 曾"存在且被测"但页面零调用 ⇒ `@` 补全不过滤。
const cMatchFiles: number = countOf(ix, 'matchFiles(');
const cKeyAction: number = countOf(ix, 'completionKeyAction(');
const cNext: number = countOf(ix, 'selNext(');
const cPrev: number = countOf(ix, 'selPrev(');
const cClamp: number = countOf(ix, 'clampSel(');
const cCmdRows: number = countOf(ix, 'CMD_ROWS');
const cFsRows: number = countOf(ix, 'FS_ROWS');
const cOnKeyEvent: number = countOf(ix, '.onKeyEvent(');
const cCmdSel: number = countOf(ix, 'this.cmdSel');
console.log(`  completion-scan ${IX_REL}: matchFiles=${cMatchFiles} keyAction=${cKeyAction}`
  + ` next=${cNext} prev=${cPrev} clamp=${cClamp} CMD_ROWS=${cCmdRows} FS_ROWS=${cFsRows}`
  + ` onKeyEvent=${cOnKeyEvent} cmdSel=${cCmdSel}`);

ok(`matchFiles 被页面消费（${cMatchFiles} ≥ 1）—— 修「存在但零调用」`, cMatchFiles >= 1);
ok(`completionKeyAction 被消费（${cKeyAction} ≥ 1）`, cKeyAction >= 1);
ok(`selNext 被消费（${cNext} ≥ 1）`, cNext >= 1);
ok(`selPrev 被消费（${cPrev} ≥ 1）`, cPrev >= 1);
ok(`clampSel 被消费（${cClamp} ≥ 1）`, cClamp >= 1);
ok(`CMD_ROWS 被消费（${cCmdRows} ≥ 2：import + 使用）`, cCmdRows >= 2);
ok(`FS_ROWS 被消费（${cFsRows} ≥ 2：import + 使用）`, cFsRows >= 2);
ok(`TextArea 挂了 onKeyEvent（${cOnKeyEvent} ≥ 1）`, cOnKeyEvent >= 1);
ok(`选中态状态位 cmdSel 被读写（${cCmdSel} ≥ 1）`, cCmdSel >= 1);

console.log(`  completion: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
