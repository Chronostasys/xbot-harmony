/**
 * md_list_nesting.test.ts —— 列表的**类型/层级切换**与**有序编号**必须对齐 web
 * （用户 2026-11-20：「手机端 markdown 渲染全是 bug，你就不能和 web 对齐吗」，
 *   截图：`2. 评论 #3` 之后的无序子项被渲染成 `3. 4. 5.` 连续编号，嵌套层次也没了）。
 *
 * ## 真因（两条腿）
 * 1. **解析层不切块**：`parseMarkdown` 的列表循环把「有序项」与「无序项」、以及不同缩进层级，
 *    全部塞进同一个 `MdBlock`，块上只有一个 `ordered`（首项决定）⇒ 无序列出成有序编号。
 * 2. **渲染层编号用块内下标**：`Text(b.ordered ? `${k + 1}.` : '•')`
 *    ⇒ 一个块里混入不同层级/类型时编号必然串（web 走 GFM 的 `start` 语义 + 独立子列表）。
 *
 * ## 修法
 * - 解析：`ordered`/`level` 与当前块不同 ⇒ **切块**（对齐 remark 的「有序→无序、顶层→嵌套各自成表」）；
 * - `MdBlock.itemNumbers` 记录有序项**原始序号**（`2.` ⇒ 2）；
 * - 渲染：`Text(b.ordered ? `${liNumber(b,k)}.` : '•')`。
 *
 * ⛔ mutation 自证：删掉切块条件 ⇒ ①/② 红；渲染改回 `${k + 1}.` ⇒ ③ 红。
 */
export {};

declare const process: { exit: (c: number) => void };

import { MdBlock, MdBlockKind, parseMarkdown } from '../../entry/src/main/ets/core/markdown';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function lists(md: string): MdBlock[] {
  return parseMarkdown(md).filter((b: MdBlock) => b.kind === MdBlockKind.List);
}

// ── ① 用户截图原形态：有序 2. + 两个无序子项 ⇒ **2 个块**，各按自己的类型/层级 ──────
{
  const md: string = [
    '2. 评论 #3（关于“只有最后 128 个 token 影响后续生成”的歧义）：',
    '   - 评论意见：原句容易被误读。',
    '   - 已修改：明确写为一段英文说明。',
    '',
  ].join('\n');
  const ls: MdBlock[] = lists(md);
  eq('① 切成 2 个列表块（有序父项 + 无序子项）', ls.length, 2);
  eq('①b 首块是有序', ls.length > 0 ? ls[0].ordered : null, true);
  eq('①c 有序块只含父项', ls.length > 0 ? ls[0].items.length : -1, 1);
  eq('①d 有序项原始序号 = 2（不是 1）', ls.length > 0 ? ls[0].itemNumbers : [], [2]);
  eq('①e 次块是**无序**（不再被编成 3./4.）', ls.length > 1 ? ls[1].ordered : null, false);
  eq('①f 无序块含 2 个子项', ls.length > 1 ? ls[1].items.length : -1, 2);
  eq('①g 无序块无编号', ls.length > 1 ? ls[1].itemNumbers : [], [0, 0]);
  ok('①h 子项层级 ≥ 1（缩进保留）', ls.length > 1 && ls[1].itemLevels.length > 0 && ls[1].itemLevels[0] >= 1);
}

// ── ② 顶层连续有序 `1./2./3.` ⇒ 仍是**同一个块**（不能切碎）──────────────────────
{
  const md: string = ['1. 甲', '2. 乙', '3. 丙', ''].join('\n');
  const ls: MdBlock[] = lists(md);
  eq('② 顶层连续有序 = 1 个块', ls.length, 1);
  eq('②b 三个项', ls.length > 0 ? ls[0].items.length : -1, 3);
  eq('②c 原始序号 1/2/3', ls.length > 0 ? ls[0].itemNumbers : [], [1, 2, 3]);
}

// ── ③ 渲染语义：liNumber 用原始号；缺省回落 k+1（有序块从 5. 起时必须显示 5,6）──
{
  const md: string = ['5. 戊', '6. 己', ''].join('\n');
  const ls: MdBlock[] = lists(md);
  eq('③ 起始号 5 ⇒ 序号 [5,6]（不是 [1,2]）', ls.length > 0 ? ls[0].itemNumbers : [], [5, 6]);
}

// ── ④ 层级变化**不切块**（由 `itemLevels` 逐项表达，渲染按 level 缩进）─────────────
// ⛔ 只在「有序↔无序」类型变化时切块：层级若也切块，会把 `markdown.test` 的
//   「单块逐项级别」语义（[A,A1,A2,B] / [0,1,2,0]）打散。
{
  const md: string = [
    '- 顶层',
    '  - 二层',
    '    - 三层',
    '',
  ].join('\n');
  const ls: MdBlock[] = lists(md);
  eq('④ 同类型嵌套 = 1 个块', ls.length, 1);
  eq('④b 逐项级别 [0,1,2]', ls.length > 0 ? ls[0].itemLevels : [], [0, 1, 2]);
}

// ── ⑤ 无序连续（同层级）不切块 ────────────────────────────────────────────────
{
  const md: string = ['- 甲', '- 乙', '- 丙', ''].join('\n');
  const ls: MdBlock[] = lists(md);
  eq('⑤ 同层级无序 = 1 个块', ls.length, 1);
  eq('⑤b 三项', ls.length > 0 ? ls[0].items.length : -1, 3);
}

console.log(`md_list_nesting: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
