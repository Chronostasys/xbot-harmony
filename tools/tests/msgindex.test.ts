/**
 * 用户消息导航（MessageUserNav）纯逻辑测试 —— 锚点抽取 / 当前锚点判定 / 前后边界 / 预览文本。
 *
 * 权威基准（web）：
 *   · `web/src/components/agent/MessageList.tsx:656-662`  userMessageIndices（role==='user'）
 *   · `web/src/components/agent/MessageUserNav.tsx:82-89`  activeSeq（visibleStart + 容差 2）
 *   · `web/src/components/agent/MessageUserNav.tsx:35-48`  extractTurnPreview
 *   · `web/src/components/agent/MessageUserNav.tsx:138`    < 2 锚点 ⇒ 不渲染
 *
 * ⚠️ 判别力自证（提交信息）：把 `nearestSeq` 的 `idx <= visibleStart + ACTIVE_ANCHOR_ROWS`
 *   改成 `idx < …`（或把 `prevSeq/nextSeq` 改成**环绕**），本文件的对应用例**必红**。
 */
declare const process: { exit: (c: number) => void };

import {
  ACTIVE_ANCHOR_ROWS, buildAnchors, NavAnchor, nearestSeq, nextSeq, prevSeq,
  rowIndexAtSeq, seqLabel, shouldShowNav, userAnchorRows, userTextOrPlaceholder,
} from '../../entry/src/main/ets/core/msgindex';
import { ChatRow } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 造一行（只用到 role/content —— 与 web `rows[i].role/.content` 同源）。 */
function row(role: string, content: string): ChatRow {
  const r = new ChatRow();
  r.role = role;
  r.content = content;
  return r;
}
/** u/a 交替：u1 a1 u2 a2 …（web `makeMessages` 的同形）。 */
function dialogue(turns: number): ChatRow[] {
  const out: ChatRow[] = [];
  for (let i = 1; i <= turns; i++) {
    out.push(row('user', `u${i}`));
    out.push(row('assistant', `a${i}`));
  }
  return out;
}

// ── ① 常量对齐（web MessageUserNav.tsx:20）──
eq('容差 = 2（对齐 web ACTIVE_ANCHOR_ROWS）', ACTIVE_ANCHOR_ROWS, 2);

// ── ② 锚点抽取（web MessageList.tsx:656-662）──
eq('空列表 ⇒ 无锚点', userAnchorRows([]), []);
eq('无 user ⇒ 无锚点', userAnchorRows([row('assistant', 'a'), row('assistant', 'b')]), []);
eq('10 轮对话 ⇒ user 下标 0,2,4…18', userAnchorRows(dialogue(10)),
  [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
eq('全 user ⇒ 全部下标', userAnchorRows([row('user', 'a'), row('user', 'b'), row('user', 'c')]),
  [0, 1, 2]);
// 乱序 role（脏历史）：仍按**出现顺序**取 role==='user' 的下标（不排序、不合并）
eq('乱序 role ⇒ 按出现顺序', userAnchorRows([
  row('assistant', 'x'), row('user', 'u'), row('assistant', 'y'), row('user', 'v'),
]), [1, 3]);

// ── ③ 当前锚点判定（web MessageUserNav.tsx:82-89）──
{
  // ⚠️ 与 web MessageList.test.tsx:784-788 精确对齐：web 的 `orderMessageRows` 把
  //   role=user 全排前 ⇒ `userRowIndexes = [0,1,2,…,9]`（**连续**）⇒ 容差 2 ⇒ activeSeq=3。
  const consecutive: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  eq('连续索引 visibleStart=0 ⇒ activeSeq=3（web 同用例）', nearestSeq(consecutive, 0), 3);
  eq('连续索引 visibleStart=1 ⇒ 4', nearestSeq(consecutive, 1), 4);
  eq('连续索引 visibleStart=18 ⇒ 10（末项）', nearestSeq(consecutive, 18), 10);

  // 间隔索引（原生真实形态：u/a 交替 ⇒ user 下标 0,2,4…）：容差 2 只覆盖 0 与 2
  const idx: number[] = userAnchorRows(dialogue(10));
  eq('交替索引 = 0,2,4…18', idx, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  eq('交替索引 visibleStart=0 ⇒ 2（0 与 2 在容差内，4 超出）', nearestSeq(idx, 0), 2);
  eq('交替索引 visibleStart=5 ⇒ 4', nearestSeq(idx, 5), 4);

  eq('visibleStart 远超列表 ⇒ 全部', nearestSeq(consecutive, 9999), 10);
  eq('无锚点 ⇒ 0', nearestSeq([], 5), 0);
  // 首个锚点就超出容差 ⇒ 0（可视顶部之上没有锚点）
  eq('首个锚点超出容差 ⇒ 0', nearestSeq([50, 60], 0), 0);
  // 边界：idx 恰等于 visibleStart + 容差 ⇒ 计入
  eq('idx == visibleStart+2 ⇒ 计入', nearestSeq([2], 0), 1);
  eq('idx == visibleStart+3 ⇒ 不计入', nearestSeq([3], 0), 0);
}

// ── ④ prev/next 边界（**不环绕**，与 activeSeq 的 clamp 同源）──
{
  eq('prev(1) 停在 1（不环绕）', prevSeq(1, 5), 1);
  eq('prev(3) ⇒ 2', prevSeq(3, 5), 2);
  eq('next(5) 停在 5（不环绕）', nextSeq(5, 5), 5);
  eq('next(3) ⇒ 4', nextSeq(3, 5), 4);
  eq('next(1) ⇒ 2', nextSeq(1, 5), 2);
  eq('无锚点 prev ⇒ 0', prevSeq(1, 0), 0);
  eq('无锚点 next ⇒ 0', nextSeq(0, 0), 0);
  // 脏输入：seq 越界 ⇒ clamp
  eq('prev(99,5) ⇒ 5', prevSeq(99, 5), 5);
  eq('next(-3,5) ⇒ 1', nextSeq(-3, 5), 1);
}

// ── ⑤ 序号 → 行下标（越界 ⇒ -1，绝不误跳）──
{
  const idx: number[] = [0, 2, 4];
  eq('seq=2 ⇒ 行下标 2', rowIndexAtSeq(idx, 2), 2);
  eq('seq=3 ⇒ 行下标 4', rowIndexAtSeq(idx, 3), 4);
  eq('seq=0 ⇒ -1', rowIndexAtSeq(idx, 0), -1);
  eq('seq=4 ⇒ -1（越界）', rowIndexAtSeq(idx, 4), -1);
  eq('空锚点 seq=1 ⇒ -1', rowIndexAtSeq([], 1), -1);
}

// ── ⑥ 预览文本（web extractTurnPreview，:35-48）──
{
  const rows: ChatRow[] = [
    row('user', '问题一'),
    row('assistant', ''),          // 空回复 ⇒ 跳过
    row('assistant', '回答一'),    // 首个非空 ⇒ 取它
    row('user', '问题二'),
    row('assistant', '回答二'),
    row('user', '问题三（末个）'), // 之后到 rows 末尾都没有 assistant
    row('assistant', '回答三'),
  ];
  const anchors: NavAnchor[] = buildAnchors(rows, userAnchorRows(rows));
  eq('锚点数量 = 3', anchors.length, 3);
  eq('seq 1-based 递增', anchors.map((a: NavAnchor) => a.seq), [1, 2, 3]);
  eq('rowIndex 指向 user 行', anchors.map((a: NavAnchor) => a.rowIndex), [0, 3, 5]);
  eq('userText 全文', anchors.map((a: NavAnchor) => a.userText), ['问题一', '问题二', '问题三（末个）']);
  eq('assistantText = 首个**非空**回复', anchors.map((a: NavAnchor) => a.assistantText),
    ['回答一', '回答二', '回答三']);
  // 末个锚点扫到 rows 末尾（web: nextUserRow = rows.length）
  eq('末个锚点也能取到其后的回复', anchors[2].assistantText, '回答三');

  // 无 assistant 回复 ⇒ 空串（面板不显示第二行）
  const only: NavAnchor[] = buildAnchors([row('user', 'x')], [0]);
  eq('无回复 ⇒ assistantText 空', only[0].assistantText, '');
  // 空锚点列表 ⇒ 空结果（不崩）
  eq('无锚点 ⇒ 空结果', buildAnchors(rows, []), []);
}

// ── ⑦ 显示守卫（web :138）──
{
  ok('0 锚点 ⇒ 不渲染', !shouldShowNav(0));
  ok('1 锚点 ⇒ 不渲染（web：< 2）', !shouldShowNav(1));
  ok('2 锚点 ⇒ 渲染', shouldShowNav(2));
  ok('3 锚点 ⇒ 渲染', shouldShowNav(3));
}

// ── ⑧ 序号文字 / 空文案占位（web :194-198）──
{
  eq('1 ⇒ 01', seqLabel(1), '01');
  eq('9 ⇒ 09', seqLabel(9), '09');
  eq('12 ⇒ 12（不截断）', seqLabel(12), '12');
  eq('0 ⇒ 00（脏输入不崩）', seqLabel(0), '00');
  eq('空 userText ⇒ (empty)', userTextOrPlaceholder(''), '(empty)');
  eq('非空 ⇒ 原样', userTextOrPlaceholder('hi'), 'hi');
}

console.log(`\nmsgindex.test: ${pass} passed / ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
