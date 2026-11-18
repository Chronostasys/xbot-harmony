/**
 * 判据：工具 pill 的**扫光带**不得用百分比高度，且只允许出现在 **live 块**里。
 *
 * 2026-10-22 / 10-25 用户两次实测同一症状：「cancel 的一瞬间，某个 tool 高度占满整个屏幕」。
 *
 * 根因（结构性）：`components/IterBlocksView.ets` 的 `ToolPillItem` 里扫光带原为
 *   `Row().width(46).height('100%')`，父 `Stack` 高度由内容决定 ⇒ **环形约束**：
 *   百分比解析的是**父级 constraint**，不是兄弟 pill 的实际高度。
 *     · 运行中：这一枚在**非惰性 live 尾项**里（父链高度确定）⇒ 正常；
 *     · cancel 后：块被收尸进 **LazyForEach 列表**，而工具状态还没降级成 failed
 *       （`iteration done` 未到 ⇒ `toolLive()` 仍 true）⇒ 在 `ListItem` 的**无界高度约束**里
 *       解析 = 被拉到整屏 ⇒ pill 只剩一条色块、占满屏幕（"一瞬间"= 那一帧）。
 *
 * 修法（两层）：① 只对 `it.live === true` 的块画扫光（已提交块的扫光本是静态装饰）；
 *              ② 高度用 token 推导的确定值（`typeOf('type.caption').size + 2×INSET_PILL_Y`）。
 *
 * ⛔ mutation 自证：把高度改回 `height('100%')` ⇒ ① 红；去掉 `it.live === true &&` ⇒ ② 红。
 */
declare const process: { cwd: () => string; exit: (c: number) => void };
declare const require: (m: string) => any;
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const src: string = fs.readFileSync(
  path.join(process.cwd(), 'entry/src/main/ets/components/IterBlocksView.ets'), 'utf8');

// 只切 `ToolPillItem` 这一段
const start: number = src.indexOf('  ToolPillItem(');
const end: number = start >= 0 ? src.indexOf('\n  }', start) : -1;
const slice: string = start >= 0 && end > start ? src.substring(start, end) : '';
ok(` 找得到 ToolPillItem 且切片非空（len=${slice.length}）`, slice.length > 200);

ok('① 扫光带不得使用 height(\'100%\')（环形约束 ⇒ ListItem 里被拉成整屏）',
  slice.indexOf(".height('100%')") < 0);
ok('② 扫光带必须由 `it.live === true` 门控（已提交块不画）',
  /if \(it\.live === true && this\.toolLive\(t\)\) \{/.test(slice));
ok('③ 高度必须是 token 推导的确定值（防改回百分比/魔法数字）',
  /\.width\(46\)\.height\(typeOf\('type\.caption'\)\.size \+ 2 \* INSET_PILL_Y\)/.test(slice));

console.log(`tool_pill_sweep: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
