/**
 * MessageNav **视觉/交互精修**的结构契约（与 `msgnav_key.test.ts` 互补，不重复其断言）。
 *
 * 组件不进离线 harness（`run.sh` 只把 `core/**` 当纯 TS 编译）⇒ 沿用本仓既有先例
 * （`msgnav_key.test.ts` / `live_tail_delivery.test.ts`）读**真实源码**做形态断言。
 *
 * 覆盖本轮改动：
 *   C. 触控区外扩到 ≥44×44（`responseRegion`，视觉仍是 32）；
 *   D. 按压反馈**只写 `pressed`**（`normal:` 必须彻底消失 —— 它会接管被命名的属性）；
 *   E. 位置指示：当前条目序号走 accent；
 *   F. 性能快路径：`syncRows` 结构未变时只翻高亮（`applyActive`）**不重赋 `rows`**；
 *   G. 无颜色字面量 / 不自造动效（不引 `@ohos.curves`、时长走 `animFast`）。
 *
 * mutation 自证：删掉 `responseRegion` ⇒ C 红；把 `normal: { .opacity(1) }` 加回 ⇒ D 红；
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

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const src: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'MessageNav.ets'), 'utf-8');

// ── C. 触控区 ≥44×44（视觉仍 32）──────────────────────────────────────────────
has(src, 'const HIT_PAD: number = 6;', '命中区外扩量常量（44 = 32 + 2×6）');
has(src, '.responseRegion({', '用 responseRegion 外扩触控区（不改布局/视觉尺寸）');
has(src, 'width: BTN + HIT_PAD * 2,', '触控区宽 = 32 + 2×HIT_PAD = 44');
has(src, 'height: BTN + HIT_PAD * 2,', '触控区高 = 44');

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

// ── E. 位置指示：当前条目序号走 accent ───────────────────────────────────────
has(src, '.fontColor(this.row.active ? this.pal().accent : this.pal().textMuted)',
  '当前条目序号用 accent（一眼看出"我在哪"）');

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
has(src, "import { animFast } from './anim';", '动效走既有 animFast() 工厂');

if (fail > 0) { console.log(`  msgnav_polish: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  msgnav_polish: ${pass} passed, 0 failed`);
process.exit(0);

// ⛔ `export {}` 让本文件成为 **module**（顶层 declare/let/function 收进模块作用域），
//    否则会与 run.sh 里同程序编译的兄弟测试顶层符号相撞（TS2451/TS2393）。
export {};
