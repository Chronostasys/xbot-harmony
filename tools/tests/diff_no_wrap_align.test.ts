/**
 * diff_no_wrap_align.test.ts —— 两条**观感=正确性**的不变量（用户 2026-11-18）：
 *
 * ① 「diff 似乎强制换行了？但是代码你不能这么做，这是正确性 bug」
 *    ⇒ diff 正文**必须按自然宽度渲染**（行宽 = 最长行），横向溢出由 diff 卡的横向 `Scroll` 承担；
 *      **绝不 `layoutWeight(1)`**（那会把它压成"视口剩余宽度" ⇒ 长行折到下一视觉行 = hard wrap）。
 *      同理 diff 卡本体的宽必须能**超过一屏**（`minWidth:'100%'`，不是 `width('100%')`）。
 *
 * ② 「task_wait 之类的工具输出，当他很短的时候，内容会居中渲染，这不对，应该左对齐」
 *    ⇒ ArkUI `Scroll` 的子内容小于视口时**默认居中** ⇒ 每个**横向** `Scroll` 必须显式
 *      `.align(Alignment.TopStart)`。
 *
 * ⛔ mutation 自证：给 diff 正文加回 `layoutWeight(1)` ⇒ ① 红；删任一处横向 Scroll 的
 *    `.align(Alignment.TopStart)` ⇒ ② 红。
 */
export {};

declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...p: string[]): string };
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const root: string = path.join(__dirname, '..', '..', '..', '..');
const src: string = fs.readFileSync(path.join(root, 'entry/src/main/ets/components/ToolPopover.ets'), 'utf8');

/** 剥注释（⛔ 判据不能把注释里的字样当违规）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
}
const code: string = stripComments(src);

// ── ① diff 正文不得 layoutWeight；diff 卡不得 width('100%') ────────────────────
// 取 `DiffRow` builder 的函数体（到下一个 @Builder 为止）
function builderBody(name: string): string {
  const i = code.indexOf(`@Builder\n  ${name}(`);
  if (i < 0) return '';
  const j = code.indexOf('@Builder', i + 10);
  return code.substring(i, j > 0 ? j : code.length);
}
const diffRow: string = builderBody('DiffRow');
ok('① 找得到 DiffRow（零扫描防线）', diffRow.length > 100);
ok('①b diff 正文不得 layoutWeight(1)（否则长行被压折行）', diffRow.indexOf('layoutWeight(1)') < 0);

const diffCard: string = builderBody('DiffFileCard');
ok('①c 找得到 DiffFileCard', diffCard.length > 100);
// ⛔ 卡**根节点**必须是 minWidth（可超过一屏）；header 行可以用 width('100%')（它是子节点）。
ok("①d diff 卡根节点用 minWidth:'100%'（可超过一屏）", diffCard.indexOf("constraintSize({ minWidth: '100%' })") >= 0);
ok("①e diff 卡保留 minWidth:'100%'（至少一屏）", diffCard.indexOf("minWidth: '100%'") >= 0);

// ── ② 横向 Scroll 必须 TopStart（短内容不得居中）───────────────────────────────
const horiz: number = (code.match(/scrollable\(ScrollDirection\.Horizontal\)/g) || []).length;
const aligned: number = (code.match(/\.align\(Alignment\.TopStart\)/g) || []).length;
ok('② 存在横向 Scroll（零扫描防线）', horiz > 0);
ok(`②b 每个横向 Scroll 都有 align(TopStart)（横向 ${horiz} / align ${aligned}）`, aligned >= horiz);

console.log(`diff_no_wrap_align: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
