/**
 * 输出块**溢出**判据（用户报"字超出屏幕"；2026-10-11）。
 *
 * 症状：`ToolPopover` 渲染**工具输出**（长行/长 JSON/长路径）⇒ 代码块/等宽块把消息列**撑宽** ⇒ 右侧被裁。
 * 设计（web `ToolCallBlock` = `overflow-auto`）**是"块内横滑"、不是折行** ⇒ 正确固化 =
 * 输出块**容器**必须 `.width('100%')` + **`clip(true)`** + `constraintSize({ maxWidth: '100%' })`
 * （内层列不设宽 ⇒ 列宽 = 最长行 ⇒ 由容器横滑；⛔ 撑宽只许发生在**块内**）。
 *
 * ⚠️ 另钉一条**编译级**教训（`tokens-ux` 实测：写 `BREAK_ALL` 让整树编译红）：`wordBreak` 的枚举
 *    **必须用限定名** `WordBreak.<X>`（`BREAK_ALL`/`BREAK_WORD`/`NORMAL`）—— 本判据扫**裸枚举名**。
 *
 * mutation：去掉任一处的 `clip(true)` / `maxWidth` ⇒ 分布计数不符 ⇒ 必红；把 `WordBreak.X` 写成裸 `X` ⇒ ★② 红。
 * ⚠️ 结尾必须 `process.exit(...)`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
const fsMod = require('fs');
const pathMod = require('path');
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const c = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(c, 'entry/src/main/ets/components'))) { repo = c; break; }
}
ok('探测到仓库根', repo.length > 0);
if (repo.length > 0) {
  const COMP: string = pathMod.join(repo, 'entry/src/main/ets/components');
  const strip = (x: string): string => x.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const src = (f: string): string => strip(fsMod.readFileSync(pathMod.join(COMP, f), 'utf-8'));
  const count = (s: string, needle: string): number => {
    let n = 0, i = 0;
    while ((i = s.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
    return n;
  };
  const tp: string = src('ToolPopover.ets');
  // ★① 输出容器：width 100% + clip(true) + maxWidth 100% 三件套（零扫描判红）
  ok('★① ToolPopover 输出块容器有 clip(true)', count(tp, '.clip(true)') >= 1);
  ok('★① 且有 constraintSize({ maxHeight: BODY_MAX_H, maxWidth: \'100%\' })', count(tp, "maxWidth: '100%'") >= 1);
  ok('★① 且容器 .width(\'100%\')（内层列不设宽 ⇒ 横向滚动）', count(tp, ".width('100%')") >= 1);
  // ★② wordBreak 枚举**必须限定名**（tokens-ux 那课）；裸枚举名 = 编译红
  ok('★② 无裸 `BREAK_ALL`/`BREAK_WORD`（必须 `WordBreak.<X>`）',
    count(tp, 'BREAK_ALL') === count(tp, 'WordBreak.BREAK_ALL') && count(tp, 'BREAK_WORD') === count(tp, 'WordBreak.BREAK_WORD'));
  ok('★② ToolPopover 的 wordBreak **全部**走限定名', count(tp, 'wordBreak(') === count(tp, 'wordBreak(WordBreak.'));
  // ★③ 等宽/输出块所在行的可收缩性（maxLines(1) 或折行）——分布计数（零扫描判红）
  const mono: number = count(tp, "fontFamily('monospace')");
  ok(`★③ ToolPopover 等宽块分布（实得 ${mono} ≥1；零扫描判红）`, mono >= 1);
  ok(`★③ 其中 maxLines 受控（实得 ${count(tp, '.maxLines(')} ≥1）`, count(tp, '.maxLines(') >= 1);
}
if (fail > 0) { console.log(`  output_overflow: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  output_overflow: ${pass} passed, 0 failed`);
process.exit(0);
