/**
 * think_row_height —— P0（用户 2026-10-17 亲报）：
 *   「**思考中变成思考x字，历史会闪烁一下，本质是历史高度抖动。不能有任何抖动**」
 *
 * ── 根因 ─────────────────────────────────────────────────────────────────────
 *  「思考中…」占位行 = 16 图标 + 上下 `SPACE_XS`；思考行（ThinkingLine 头）= 20 光球 + 上下
 *  `SPACE_HAIR` ⇒ **两行高度不同** ⇒ live 行挂载 / 占位卸载那一下列表底部内容整体位移
 *  ⇒ 读作"历史闪一下"。字数变化（`思考 12 字` → `思考 1520 字`）若允许换行同样会改高度。
 *
 * ── 判据（⛔ 只钉"某处有 height"会假绿）────────────────────────────────────────
 *  ① **同源**：两行都必须用**同一个令牌** `THINK_ROW_H`（`core/tokens.ets` 唯一定义）；
 *  ② **旧写法不得回归**：占位行不得再出现 `top: SPACE_XS, bottom: SPACE_XS`；思考行头不得
 *     再出现 `top: SPACE_HAIR, bottom: SPACE_HAIR`（这两处正是高度差的来源）；
 *  ③ 思考标签必须 `maxLines(1)` + 省略号（字数变长不得换行 ⇒ 不得改高度）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const pathMod = require('path');
const fsMod = require('fs');
const root: string = pathMod.resolve(__dirname, '../../../..');
const read = (rel: string): string => fsMod.readFileSync(pathMod.join(root, rel), 'utf8');

const tokens: string = read('entry/src/main/ets/core/tokens.ets');
const page: string = read('entry/src/main/ets/pages/Index.ets');
const think: string = read('entry/src/main/ets/components/ThinkingLine.ets');

console.log('\n▶ ① 同源：思考行与占位行共用 `THINK_ROW_H`');
ok('令牌只在 tokens.ets 定义一次', (tokens.match(/export const THINK_ROW_H/g) || []).length === 1);
ok('占位行用 THINK_ROW_H 固定高度', page.indexOf('.height(THINK_ROW_H)') >= 0);
ok('思考行头用 THINK_ROW_H 固定高度', think.indexOf('.height(THINK_ROW_H)') >= 0);
ok('两处都垂直居中（高度固定后文字不悬空）',
  page.indexOf('THINK_ROW_H') >= 0 && page.indexOf('VerticalAlign.Center') >= 0
  && think.indexOf('THINK_ROW_H') >= 0 && think.indexOf('VerticalAlign.Center') >= 0);

console.log('\n▶ ② 旧写法不得回归（高度差的来源）');
// ⛔ 只扫**占位行那一块**（按首尾锚点截取；整页里有别的按钮也用 SPACE_XS 内边距，
//    扫整页会假红 —— AGENTS.md「判据要只取调用片段」的同类教训）。
const phStart: number = page.indexOf('showsBusyPlaceholder(this.busySignals())');
const phEnd: number = page.indexOf("edgeEffect(EdgeEffect.Spring).padding({ left: SPACE_XS", phStart);
const phBlock: string = phStart >= 0 && phEnd > phStart ? page.substring(phStart, phEnd) : '';
ok('占位行区块截取到（按首尾锚点）', phBlock.length > 100);
ok('占位行不再用 top/bottom SPACE_XS 撑高', phBlock.indexOf('bottom: SPACE_XS') < 0);
ok('占位行确实用了 THINK_ROW_H', phBlock.indexOf('.height(THINK_ROW_H)') >= 0);
ok('思考行头不再用 top/bottom SPACE_HAIR 撑高',
  think.indexOf('top: SPACE_HAIR, bottom: SPACE_HAIR') < 0);

console.log('\n▶ ③ 标签不得换行（字数变长不改高度）');
ok('思考标签 maxLines(1)', think.indexOf('.maxLines(1)') >= 0);
ok('思考标签省略号溢出', /TextOverflow\.Ellipsis/.test(think));

if (fail > 0) {
  console.log(`  think_row_height: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  think_row_height: ${pass} passed, 0 failed`);
process.exit(0);

export {};
