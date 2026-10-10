/**
 * 工具 pill 的**分组 / 折叠**纯逻辑门禁 —— 对齐官方 webui。
 *
 * web 权威：
 *   · `TurnBody.tsx:942-967` `mergeToolRuns` —— 连续「纯工具」迭代（含工具且无 content 且无
 *     reasoning）合并进**前一个含工具迭代**，保留 head 迭代号 ⇒ 渲染成**一行 pill**；
 *   · `FoldedToolGroup.tsx:41-42, 541-574` `MergedPills` —— 每工具一枚 pill，>8 枚时
 *     前 7 枚 + `+N` 徽标（`PILL_INLINE_MAX=8` / `PILL_INLINE_HEAD=7`）。
 *
 * 本测试守护的是**纯逻辑**（`core/streammerge.ets` 的两个纯函数）——UI 层只消费结果。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`，
 *    不退出不会自动结束（会挂住整套件）。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import {
  foldPills, mergeToolRuns, PILL_INLINE_HEAD, PILL_INLINE_MAX,
} from '../../entry/src/main/ets/core/streammerge';
import type { HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';

/** 造一枚工具（name + 可选 label，用于断言顺序）。 */
function tool(name: string, label?: string): ToolProgress {
  const t: ToolProgress = { name };
  if (label !== undefined) {
    t.label = label;
  }
  return t;
}

/** 造一个迭代（content/reasoning 缺省为空串 = 纯工具）。 */
function iter(n: number, tools: string[], content?: string, reasoning?: string): HistoryIteration {
  const its: ToolProgress[] = [];
  for (let i = 0; i < tools.length; i++) {
    its.push(tool(tools[i], `label-${tools[i]}`));
  }
  const out: HistoryIteration = { iteration: n, content: content !== undefined ? content : '', reasoning: reasoning !== undefined ? reasoning : '', tools: its };
  return out;
}

/** 工具名序列（断言顺序用）。 */
function names(ts: ToolProgress[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ts.length; i++) {
    out.push(ts[i].name);
  }
  return out;
}

describe('mergeToolRuns：连续纯工具迭代合并（对齐 web TurnBody.mergeToolRuns）', () => {
  it('(a) 连续纯工具迭代合进前一个含工具迭代 ⇒ 一行 pill、保留 head 迭代号', () => {
    // iter1 有工具、iter2/iter3 都是「纯工具」⇒ 三段合成一块（iteration 仍 = 1）
    const merged = mergeToolRuns([iter(1, ['A']), iter(2, ['B']), iter(3, ['C'])]);
    expect(merged.length, '三段纯工具合成一块').toBe(1);
    expect(merged[0].iteration, '保留 head 迭代号 = 1').toBe(1);
    expect(names(merged[0].tools !== undefined ? merged[0].tools : []), '工具顺序 A,B,C').toEqual(['A', 'B', 'C']);
  });

  it('(a2) head 可带正文/推理、仍吸收后续纯工具成员（工具与文本同属一块）', () => {
    const merged = mergeToolRuns([iter(1, ['A'], 'head-text'), iter(2, ['B'])]);
    expect(merged.length).toBe(1);
    expect(merged[0].iteration).toBe(1);
    expect(merged[0].content, 'head 正文不丢').toBe('head-text');
    expect(names(merged[0].tools !== undefined ? merged[0].tools : [])).toEqual(['A', 'B']);
  });

  it('(a3) 无工具迭代原样透传，且**不**跨文本合并（对象恒等）', () => {
    const a: HistoryIteration = iter(1, [], 'only-text');
    const b: HistoryIteration = iter(2, ['T']);
    const merged = mergeToolRuns([a, b]);
    expect(merged.length, '两块都在').toBe(2);
    expect(merged[0], '无工具块原样透传（同一对象）').toBe(a);
    expect(merged[0].content).toBe('only-text');
  });

  it('(a4) tools_folded 聚合：任一成员带标记 ⇒ 合并块带标记', () => {
    const head = iter(1, ['A']);
    const member = iter(2, ['B']);
    member.tools_folded = true;
    const merged = mergeToolRuns([head, member]);
    expect(merged.length).toBe(1);
    expect(merged[0].tools_folded, '成员带 folded ⇒ 合并块 folded').toBe(true);
  });
});

describe('mergeToolRuns：含 content/reasoning 的迭代阻断合并', () => {
  it('(b) 带 content 的工具迭代不被前一块吸收（自成一块、并阻断后续）', () => {
    // iter2 带 content ⇒ 不能被 iter1 吸收；iter2 自己也成为 head（吸收不到 iter3？iter3 是纯工具 ⇒ 会被 iter2 吸收）
    // 故结果：{1:[A]} + {2:[B,C]}；关键是 **iter1 与 iter2 不合并**（length=2）
    const merged = mergeToolRuns([iter(1, ['A']), iter(2, ['B'], 'text-2'), iter(3, ['C'])]);
    expect(merged.length, '带 content 的块阻断合并 ⇒ 两块').toBe(2);
    expect(merged[0].iteration, '第一块 = 1').toBe(1);
    expect(names(merged[0].tools !== undefined ? merged[0].tools : []), '第一块只有 A').toEqual(['A']);
    expect(merged[1].iteration, '第二块 = 2').toBe(2);
    expect(merged[1].content, 'content 保留').toBe('text-2');
  });

  it('(b2) 带 reasoning 的工具迭代同样阻断（不能被吸收）', () => {
    const merged = mergeToolRuns([iter(1, ['A']), iter(2, ['B'], undefined, 'reason-2')]);
    expect(merged.length, 'reasoning 也阻断合并').toBe(2);
    expect(names(merged[0].tools !== undefined ? merged[0].tools : [])).toEqual(['A']);
    expect(merged[1].reasoning).toBe('reason-2');
  });
});

describe('foldPills：同迭代 pill 折叠（对齐 web MergedPills）', () => {
  it('(c) >8 枚 ⇒ 前 7 枚 + 收起 (N-7) 枚', () => {
    const ts: ToolProgress[] = [];
    for (let i = 0; i < 11; i++) {
      ts.push(tool(`t${i}`));
    }
    const slice = foldPills(ts);
    expect(slice.overflow, '11 > 8 ⇒ overflow').toBe(true);
    expect(slice.shown.length, '直出前 7 枚').toBe(PILL_INLINE_HEAD);
    expect(slice.hideCount, '收起 4 枚 (+4)').toBe(4);
    expect(slice.hidden.length).toBe(4);
    expect(names(slice.shown), '前 7 枚 = t0..t6').toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6']);
    expect(names(slice.hidden), '收起 = t7..t10').toEqual(['t7', 't8', 't9', 't10']);
  });

  it('(c2) 恰好 9 枚 ⇒ 7 + +2（边界：只多 1 枚也折叠）', () => {
    const ts: ToolProgress[] = [];
    for (let i = 0; i < 9; i++) {
      ts.push(tool(`t${i}`));
    }
    const slice = foldPills(ts);
    expect(slice.overflow).toBe(true);
    expect(slice.shown.length).toBe(7);
    expect(slice.hideCount).toBe(2);
  });

  it('(d) ≤8 枚不折叠（恰好 8 枚全部直出）', () => {
    const ts: ToolProgress[] = [];
    for (let i = 0; i < 8; i++) {
      ts.push(tool(`t${i}`));
    }
    const slice = foldPills(ts);
    expect(slice.overflow, '8 枚不折叠（web 判据 > 8）').toBe(false);
    expect(slice.shown.length).toBe(8);
    expect(slice.hideCount).toBe(0);
    expect(slice.hidden.length).toBe(0);
    expect(PILL_INLINE_MAX, '阈值 = 8').toBe(8);
  });

  it('(d2) 空列表 / 3 枚：不折叠、顺序原样', () => {
    expect(foldPills([]).overflow).toBe(false);
    expect(foldPills([]).shown.length).toBe(0);
    const three = foldPills([tool('x'), tool('y'), tool('z')]);
    expect(three.overflow).toBe(false);
    expect(names(three.shown), '顺序原样').toEqual(['x', 'y', 'z']);
  });
});

describe('分组不改变工具顺序（顺序不变量）', () => {
  it('(e) 跨迭代合并后，工具顺序 = 先出现的在前（head → 成员）', () => {
    const merged = mergeToolRuns([
      iter(1, ['a1', 'a2']), iter(2, ['b1']), iter(3, ['c1', 'c2']),
    ]);
    expect(merged.length).toBe(1);
    expect(names(merged[0].tools !== undefined ? merged[0].tools : []))
      .toEqual(['a1', 'a2', 'b1', 'c1', 'c2']);
  });

  it('(e2) 合并再折叠：顺序仍稳定（先出现的在前、被收纳的按原顺序）', () => {
    // 造 3 个连续纯工具迭代，共 10 枚 ⇒ 合并成一块 10 枚，再折叠成 7 + +3
    const merged = mergeToolRuns([iter(1, ['t0', 't1', 't2']), iter(2, ['t3', 't4']), iter(3, ['t5', 't6', 't7', 't8', 't9'])]);
    expect(merged.length).toBe(1);
    const slice = foldPills(merged[0].tools !== undefined ? merged[0].tools : []);
    expect(names(slice.shown)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6']);
    expect(names(slice.hidden)).toEqual(['t7', 't8', 't9']);
  });
});

const code = summary('toolgroup');
process.exit(code);
