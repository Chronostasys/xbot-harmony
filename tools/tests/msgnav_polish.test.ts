/**
 * MessageNav **视觉/交互精修**的结构契约（与 `msgnav_key.test.ts` 互补，不重复其断言）。
 *
 * 组件不进离线 harness（`run.sh` 只把 `core/**` 当纯 TS 编译）⇒ 沿用本仓既有先例
 * （`msgnav_key.test.ts` / `live_tail_delivery.test.ts`）读**真实源码**做形态断言。
 *
 * 覆盖本轮改动：
 *   C. 触控区 ≥44×44（**真实布局盒** = `HIT_TARGET_MIN`，视觉仍是 32；⛔ 不用 `responseRegion` 外扩）；
 *   D. 按压反馈**只写 `pressed`**（`normal:` 必须彻底消失 —— 它会接管被命名的属性）；
 *   E. 位置指示：当前条目序号走 accent；
 *   F. 性能快路径：`syncRows` 结构未变时只翻高亮（`applyActive`）**不重赋 `rows`**；
 *   G. 无颜色字面量 / 不自造动效（不引 `@ohos.curves`、时长走 `animFast`）。
 *
 * mutation 自证：把 44 布局盒退回 32 / 把 `responseRegion` 加回 ⇒ C 红；把 `normal: { .opacity(1) }` 加回 ⇒ D 红；
 *               把 `syncRows` 的快路径删掉（直接重建）⇒ F 红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(`${name}（应含 ${needle}）`, src.indexOf(needle) >= 0);
}
// 剥注释（本仓 GOTCHA：注释里记"旧做法"是文档 ⇒ 禁串扫源码前必须先剥，否则把文档当违规=假红）。
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const src: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'MessageNav.ets'), 'utf-8');

// ── C. 触控区 ≥44（**真实布局盒**；视觉仍 32）───────────────────────────────────
// ⛔ 2026-10-11 **按真机事实改写**（旧口径 `responseRegion` 负偏移外扩已被主 agent 装机对照实验推翻：
//    点 X 视觉中心 ✓ / 点框外 11–15px ✗ ⇒ 外扩等于没修）。新口径 = **元素自身布局盒 ≥ HIT_TARGET_MIN**
//    （`Row()/Stack().width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)` + `onClick` 落在该盒）。
//    ⛔ 这不是放宽：仍钉住"触控区 ≥ 44"这一**意图**，只是把可静态验证的形态换成本机真有效的那个。
has(src, '.width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)', '命中区 = 真实 HIT_TARGET_MIN(44) 布局盒（承载 onClick）');
ok('⛔ 全文件无 `responseRegion`（负偏移外扩真机无效 ⇒ 静态禁止；剥注释后判）',
  stripComments(src).indexOf('responseRegion') < 0);
has(src, 'const BTN: number = 32;', '视觉盒边长常量 = 32（web `size-8`，热区靠布局盒而非改视觉）');

// ── A. key 稳定性（回归护栏，与 msgnav_key 同源但独立复核）────────────────────
has(src, '(r: NavRow) => `${r.rowIndex}#${r.seq}`', '条目 key 恒为 行下标#序号');
ok('无含 active 的 key 生成器',
  !/\(.*\)\s*=>\s*`[^`]*active[^`]*`/.test(src));

// ── B. 高亮通道：@Observed + @ObjectLink（不变）───────────────────────────────
has(src, '@ObjectLink row: NavRow;', '子组件用 @ObjectLink 观察行对象');
has(src, 'this.row.active', '高亮读对象字段（@ObjectLink 可观测）');

// ── D. 按压反馈：只写 pressed，normal **彻底消失** ───────────────────────────
ok('全文件无 stateStyles `normal:` 分支（杜绝属性接管）', src.indexOf('normal:') < 0);
has(src, '.stateStyles({ pressed: { .opacity(0.7) } })', '条目按压反馈只写 pressed');
has(src, '.backgroundColor(withAlpha(this.pal().accent, ACCENT_TINT))', '按钮按下切 accent 底纹（web hover 等价）');

// ── E. 位置指示：当前条目序号走强调色 ────────────────────────────────────────
// ⛔ 2026-10-11 目标⑤改写：序号是 **normal 字号（10）文字** ⇒ 需 AA_TEXT 4.5；
//    `accent` 是**非文本/图形** role（3.0）⇒ 压激活底纹 porcelain 仅 4.10、dark 4.05 ⇒ 越界。
//    改走语义等价的**文字** role `accentText`（"强调文字"4.5 档，三主题实算全 ≥4.5）。
//    ⛔ 意图不变：当前条目序号仍走强调色（一眼看出"我在哪"）；变的只是"用哪一个合法 role"。
//    判据见 `tools/tests/accent_chrome.test.ts`。
has(src, '.fontColor(this.row.active ? this.pal().accentText : this.pal().textMuted)',
  '当前条目序号用 accentText（一眼看出"我在哪"，且达 AA 4.5）');

// ── F. 性能快路径：结构未变 ⇒ 只翻高亮，不重赋 rows ──────────────────────────
has(src, 'private sameStructure(): boolean {', '存在结构一致性判定');
has(src, 'private applyActive(): void {', '存在 O(1) 高亮翻转');
has(src, 'if (this.sameStructure()) {', 'syncRows 先走结构判定');
// 快路径必须**先于**遍历（否则等于没优化）：sameStructure 出现在 `const list: NavRow[]` 之前
ok('快路径在重建之前（先判定再决定是否重建）',
  src.indexOf('if (this.sameStructure()) {') < src.indexOf('const list: NavRow[] = [];'));

// ── G. 无颜色字面量 / 不自造动效 ─────────────────────────────────────────────
ok('无颜色字面量（禁硬编码 hex）', !/#[0-9a-fA-F]{3,8}\b/.test(src));
ok('不引入 @ohos.curves（动效只走 anim.ets 工厂）', src.indexOf('@ohos.curves') < 0);
has(src, 'animFast', '动效走既有 animFast() 工厂');
has(src, "from './anim';", '动效工厂从 ./anim 引入（允许与 animBase 同批导入）');

if (fail > 0) { console.log(`  msgnav_polish: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  msgnav_polish: ${pass} passed, 0 failed`);
process.exit(0);

// ⛔ `export {}` 让本文件成为 **module**（顶层 declare/let/function 收进模块作用域），
//    否则会与 run.sh 里同程序编译的兄弟测试顶层符号相撞（TS2451/TS2393）。
export {};
