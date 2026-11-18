/**
 * pill_view_consistency.test.ts —— `+N` 徽标 / 直出 pill / 溢出列表必须**同源**
 * （用户 2026-11-14 P0：「你那个变成 `+N` 的工具列表里的工具是错的，和真实的对不上」）。
 *
 * 现场形态：徽标数字、直出的 pill、点开后列出的工具**三处各算一遍** ——
 *   · 直出 pill 走 `foldPills(group).shown` **再按身份去重**（`groupShownPills`）；
 *   · 徽标 N 走 `foldPills(group).hideCount`（**不去重**）；
 *   · 溢出列表走 `foldPills(block.tools).hidden`（**整块重算、按位置切片**）。
 *   ⇒ 一旦组里出现"同一调用的残留副本"（服务端 `active_tools` 跨帧残留；`call_id` 每迭代从
 *   `call_0` 重新编号，带同迭代号的同 id 就是同一枚），三处结果就**互相对不上**：
 *   数字比列表多、列表里出现"已经直出在上面的那枚"、甚至把真工具挤进/挤出列表。
 *
 * 权威口径（web `MergedPills` + `OverflowPillsMenu`，`FoldedToolGroup.tsx:541-586`）：
 *   **一个数组 → 一次去重 → 一次切片**：
 *     `shown = deduped.slice(0, 7)`（≤8 时全量），`hidden = deduped.slice(7)`，
 *     `hideCount = hidden.length`。三处取的是同一个数组的不同切片 ⇒ 天然对齐。
 *
 * ⛔ 去重只认「同迭代 + 同 call_id」；无 `call_id` 时按「同迭代 + 名字 + 同序号」——
 *   两次**真实**同名调用（连跑两次相同命令）必须都保留（用户 2026-10-29：「新工具完成后
 *   立刻从历史消失」——那是内容级去重造成的，绝不能回退）。
 *
 * ⛔ mutation 自证：把 `pillView` 的"先 dedupe 再 fold"改成"先 fold 再 dedupe"⇒ ② 红；
 *   去掉 dedupe ⇒ ① 红；把无 call_id 的兜底键退化成"同迭代+同名"（不带序号）⇒ ③ 红。
 */
export {};

declare const process: { exit: (c: number) => void };

import { PILL_INLINE_HEAD, PILL_INLINE_MAX, pillView } from '../../entry/src/main/ets/core/streammerge';
import type { ToolProgress } from '../../entry/src/main/ets/core/types';

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

function t(name: string, iter: number, call: string): ToolProgress {
  return { name, iteration: iter, call_id: call, status: 'done' } as ToolProgress;
}

function sig(x: ToolProgress): string {
  return `${x.name}@${x.iteration}#${x.call_id !== undefined ? x.call_id : ''}`;
}

function sigs(list: ToolProgress[]): string[] {
  return list.map((x: ToolProgress) => sig(x));
}

// ── ① 同一调用的残留副本：直出 + 溢出 = 去重后的全集（各一份）────────────────
{
  const tools: ToolProgress[] = [
    t('Shell', 1, 'call_0'), t('FileCreate', 1, 'call_1'), t('Shell', 1, 'call_0'), // ← 残留副本
    t('FileReplace', 2, 'call_0'),
  ];
  const v = pillView(tools);
  eq('① 直出 + 溢出 = 去重后全集', v.shown.length + v.hidden.length, 3);
  eq('①b 徽标 N = 溢出条数', v.hideCount, v.hidden.length);
  ok('①c 溢出里不得出现"已直出的那枚"',
    v.hidden.every((h: ToolProgress) => !v.shown.some((s: ToolProgress) => sig(s) === sig(h))));
  // 逐枚只出现一次
  const all: string[] = sigs(v.shown).concat(sigs(v.hidden));
  eq('①d 每枚只出现一次', new Set(all).size, all.length);
}

// ── ② 溢出区的重复：不得占掉"真工具"的位置 ────────────────────────────────────
{
  // 10 枚（>8 ⇒ 折），其中第 8 枚是第 1 枚的残留副本
  const tools: ToolProgress[] = [
    t('Shell', 1, 'call_0'), t('Shell', 1, 'call_1'), t('Shell', 1, 'call_2'),
    t('Shell', 1, 'call_3'), t('Shell', 1, 'call_4'), t('Shell', 1, 'call_5'),
    t('Shell', 1, 'call_6'),
    t('Shell', 1, 'call_0'),            // ← 残留副本（与第 1 枚同迭代同 id）
    t('Shell', 1, 'call_7'), t('Shell', 1, 'call_8'),
  ];
  const v = pillView(tools);
  eq('② 直出 7 枚', v.shown.length, PILL_INLINE_HEAD);
  eq('②b 溢出 2 枚（重复被吸收，不占位）', v.hidden.length, 2);
  eq('②c 徽标 N = 2', v.hideCount, 2);
  ok('②d 真工具 call_7 / call_8 必须都在溢出里',
    v.hidden.some((h: ToolProgress) => h.call_id === 'call_7')
    && v.hidden.some((h: ToolProgress) => h.call_id === 'call_8'));
  ok('②e 溢出里不得有重复副本', !sigs(v.hidden).includes('Shell@1#call_0'));
}

// ── ③ 无 call_id：两次**真实**同名调用必须都保留 ──────────────────────────────
{
  const tools: ToolProgress[] = [
    { name: 'Shell', iteration: 1, status: 'done' } as ToolProgress,
    { name: 'Shell', iteration: 1, status: 'done' } as ToolProgress,
  ];
  const v = pillView(tools);
  eq('③ 同名真实调用不得被吞', v.shown.length + v.hidden.length, 2);
}

// ── ④ 边界：恰好 8 枚不折叠；9 枚折成 7+2 ─────────────────────────────────────
{
  const eight: ToolProgress[] = [];
  for (let i = 0; i < PILL_INLINE_MAX; i++) {
    eight.push(t('Shell', 1, `call_${i}`));
  }
  const v8 = pillView(eight);
  eq('④ 8 枚全直出', [v8.shown.length, v8.hideCount, v8.overflow], [8, 0, false]);
  const nine: ToolProgress[] = eight.concat([t('Shell', 1, 'call_8')]);
  const v9 = pillView(nine);
  eq('④b 9 枚折成 7+2', [v9.shown.length, v9.hideCount, v9.overflow], [7, 2, true]);
}

// ── ⑤ 幂等/引用稳定：同输入两次 ⇒ 同元素顺序（页面 ForEach key 依赖顺序）──────
{
  const tools: ToolProgress[] = [t('A', 1, 'call_0'), t('B', 2, 'call_0'), t('A', 1, 'call_0')];
  eq('⑤ 顺序稳定（去重保留先出现的）', sigs(pillView(tools).shown), ['A@1#call_0', 'B@2#call_0']);
}

console.log(`pill_view_consistency: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
