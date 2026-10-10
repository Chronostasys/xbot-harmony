/**
 * 上下文压缩点（compaction）纯逻辑测试 —— 判定 / 摘要拆分 / 迭代锚定。
 *
 * 权威基准（web）：
 *   · `web/src/components/agent/CompactionDivider.tsx:20-27`  splitMarker
 *   · `web/src/components/agent/TurnBody.tsx:992-1013`        compactionByIter（锚定 + 窗口外挂起）
 *
 * ⚠️ 判别力自证（提交信息）：把 `compactionAnchors` 的 `n <= after` 改成 `n < after`
 *   （或删掉窗口外挂起那行），本文件的锚定用例**必红**（见下方 ④⑤ 与 ⑦）。
 */
declare const process: { exit: (c: number) => void };

import {
  anchorsAt, COMPACTED_LABEL, compactionAnchors, CompactMarker, DEFAULT_MARKER_TITLE,
  hasExpandableBody, NO_COMPACTIONS, splitMarker,
} from '../../entry/src/main/ets/core/compaction';
import { WebCompaction } from '../../entry/src/main/ets/core/chattypes';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function mk(afterIteration: number, content?: string): WebCompaction {
  const c: WebCompaction = { afterIteration };
  if (content !== undefined) { c.content = content; }
  return c;
}
/** anchors 表 → 便于断言的「anchor → 压缩点 index 列表」。 */
function dump(m: Map<number, WebCompaction[]>): string {
  const keys: number[] = [];
  m.forEach((_v: WebCompaction[], k: number) => { keys.push(k); });
  keys.sort((a: number, b: number) => a - b);
  const parts: string[] = [];
  for (const k of keys) {
    const arr: WebCompaction[] = anchorsAt(m, k);
    const idx: number[] = [];
    for (const c of arr) { idx.push(c.afterIteration); }
    parts.push(`${k}:[${idx.join(',')}]`);
  }
  return parts.join(' ');
}

// ── ① 文案 / 常量（对齐 web i18n `agent.compacted` = zh-CN.ts:236）──
eq('文案 = 上下文已压缩', COMPACTED_LABEL, '上下文已压缩');
eq('标题兜底 = [Compacted context]', DEFAULT_MARKER_TITLE, '[Compacted context]');

// ── ② splitMarker 边界（逐字对齐 web CompactionDivider.tsx:20-27）──
{
  const m0: CompactMarker = splitMarker(undefined);
  eq('无 content ⇒ 兜底标题 + 空正文', [m0.title, m0.body], [DEFAULT_MARKER_TITLE, '']);

  const m1: CompactMarker = splitMarker('');
  eq('空串 ⇒ 兜底标题 + 空正文', [m1.title, m1.body], [DEFAULT_MARKER_TITLE, '']);

  const m2: CompactMarker = splitMarker('[Compacted context]');
  eq('只有标题行 ⇒ title=标记、body 空', [m2.title, m2.body], ['[Compacted context]', '']);

  const m3: CompactMarker = splitMarker('[Compacted context]\n\n这里是摘要正文\n第二行');
  eq('标题 + 正文（trim）', [m3.title, m3.body], ['[Compacted context]', '这里是摘要正文\n第二行']);

  // 前导空白/换行：trimStart 后首行为标题
  const m4: CompactMarker = splitMarker('\n\n  [Compacted context]\n  正文  ');
  eq('前导换行被 trimStart、正文右侧 trim', [m4.title, m4.body], ['[Compacted context]', '正文']);

  // ⚠️ trimStart 会吃掉**全部**前导空白（含换行）⇒ "首行为空白"不可达；
  //    全空白内容 ⇒ trim 后为空 ⇒ 兜底标题（与 web `title || '[Compacted context]'` 同源）。
  const m5: CompactMarker = splitMarker('   \n  ');
  eq('全空白 ⇒ 兜底标题 + 空正文', [m5.title, m5.body], [DEFAULT_MARKER_TITLE, '']);
}

// ── ③ hasExpandableBody（决定是否显示展开箭头）──
ok('无正文 ⇒ 不可展开', !hasExpandableBody(mk(0, '[Compacted context]')));
ok('有正文 ⇒ 可展开', hasExpandableBody(mk(0, '[Compacted context]\n\n摘要')));
ok('undefined ⇒ 不可展开', !hasExpandableBody(undefined));

// ── ④ 无压缩 ⇒ 空表；缺省 anchor ⇒ 共享空数组（零渲染契约）──
{
  const empty: Map<number, WebCompaction[]> = compactionAnchors([1, 2, 3], undefined);
  eq('undefined ⇒ 空表', empty.size, 0);
  eq('空数组 ⇒ 空表', compactionAnchors([1, 2, 3], []).size, 0);
  ok('缺省 anchor ⇒ 返回共享空数组（无分配）', anchorsAt(empty, 7) === NO_COMPACTIONS);
}

// ── ⑤ 锚定：afterIteration ∈ iterNums ⇒ 落在**该迭代之后** ──
{
  const m: Map<number, WebCompaction[]> = compactionAnchors([1, 2, 3, 4], [mk(3)]);
  eq('after=3 且 3 在窗口内 ⇒ anchor=3', dump(m), '3:[3]');
  ok('anchor=3 处有压缩点', anchorsAt(m, 3).length === 1);
  ok('anchor=0 处无压缩点', anchorsAt(m, 0) === NO_COMPACTIONS);
}

// ── ⑥ afterIteration=0 ⇒ 第一个迭代之前（turn 顶部 leading）──
{
  const m: Map<number, WebCompaction[]> = compactionAnchors([1, 2, 3], [mk(0)]);
  eq('after=0 ⇒ anchor=0', dump(m), '0:[0]');
}

// ── ⑦ 折叠跳号：afterIteration 落在**两个已渲染块之间** ⇒ 落到最近的更早块 ──
{
  // 迭代 2 被工具 only 折叠吸收 ⇒ 已渲染块号 = [1, 3, 4]；after=2 ⇒ anchor=1
  const m: Map<number, WebCompaction[]> = compactionAnchors([1, 3, 4], [mk(2)]);
  eq('跳号：after=2 ⇒ anchor=1（压缩点不丢）', dump(m), '1:[2]');
  // after=5（> 最后一个块 4）⇒ anchor=4
  eq('after=5 超过末块 ⇒ anchor=4', dump(compactionAnchors([1, 3, 4], [mk(5)])), '4:[5]');
}

// ── ⑧ 窗口外挂起（web TurnBody.tsx:996-1003）：after 落在全部已渲染块之前 ⇒ 不渲染 ──
{
  const m: Map<number, WebCompaction[]> = compactionAnchors([5, 6, 7], [mk(2)]);
  eq('after=2 早于窗口首块 5 ⇒ 挂起（不渲染）', m.size, 0);
  // 但 after=0（真·turn 开头）不被挂起
  eq('after=0 属于窗口顶 ⇒ 不挂起', dump(compactionAnchors([5, 6, 7], [mk(0)])), '0:[0]');
  // 边界：after 恰等于窗口首块 ⇒ 不挂起
  eq('after=5 恰为窗口首块 ⇒ 不挂起', dump(compactionAnchors([5, 6, 7], [mk(5)])), '5:[5]');
}

// ── ⑨ 同一 anchor 多个压缩点 ⇒ 归组、保序 ──
{
  const a: WebCompaction = mk(3, 'A');
  const b: WebCompaction = mk(3, 'B');
  const m: Map<number, WebCompaction[]> = compactionAnchors([1, 2, 3], [a, b]);
  eq('同 anchor 归组、保持出现顺序', dump(m), '3:[3,3]');
  eq('归组后同数组（顺序 A,B）', anchorsAt(m, 3).map((c: WebCompaction) => c.content), ['A', 'B']);
}

// ── ⑩ 多次压缩 + 多 anchor 混合 ──
{
  const list: WebCompaction[] = [mk(0), mk(2), mk(4), mk(9)];
  const m: Map<number, WebCompaction[]> = compactionAnchors([1, 2, 3, 4], list);
  // after=9 超过末块 4 ⇒ anchor=4（与 after=4 同组）
  eq('混合：0 / 2 / 4 / 9(→4)', dump(m), '0:[0] 2:[2] 4:[4,9]');
}

// ── ⑪ 字段缺失 / 迭代号错位（脏数据不崩、判定正确）──
{
  // afterIteration 为负数（脏数据）：<= 任何块 ⇒ anchor=0（不抛、不丢）
  eq('负 afterIteration ⇒ anchor=0', dump(compactionAnchors([1, 2], [mk(-3)])), '0:[-3]');
  // 已渲染块为空（无迭代）⇒ 一律 anchor=0
  eq('无已渲染块 ⇒ anchor=0', dump(compactionAnchors([], [mk(2)])), '0:[2]');
  // 无 content 字段：splitMarker 兜底、body 空
  const c: WebCompaction = mk(1);
  eq('缺 content ⇒ body 空', splitMarker(c.content).body, '');
  ok('缺 content ⇒ 不可展开', !hasExpandableBody(c));
}

console.log(`\ncompaction.test: ${pass} passed / ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
