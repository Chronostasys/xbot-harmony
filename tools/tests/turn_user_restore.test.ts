/**
 * turn_user_restore.test.ts —— 后端 `5c3aec7b` 接口变更的**判别力回归守卫**。
 *
 * 契约（`protocol/events.go:302-310` TurnUser；`channel/subscription.go:712
 * relocateIncompleteTurnUsers`）：对「只下发了尾部区域窗口」（`RegionsBefore > 0`）的 turn，
 * 服务端**不再把它的 user 行放进消息流**（⛔ 消息不连续零容忍，用户 2026-10-11），
 * 而是把它挂在**该 turn 的 assistant 行**的 `turn_user` 字段上。
 *
 * 缺陷形态（修复前）：本仓 `core/types.ets:HistoryMessage` **无 `turn_user`**、
 * `core/store.ets:toChatMessages` 不还原 ⇒ 这类 user 行在原生端**静默丢失**
 * （真机症状：窗口化长 turn 的提问「消失」，用户所述「加载更多有时候不生效」）。
 *
 * 修复（对齐 web `hooks/useChatMessages.ts:200-221`）：在**边缘**（`toChatMessages`）
 * 把它还原成常规 user 行、插在该 assistant 行**之前** —— 下游（`historyToReplaced`
 * 建 turn / derive / rewind / 加载更多）零改动；是否渲染仍由 derive 的
 * 「窗口未覆盖迭代 1 ⇒ user 行不渲染」规则决定（`core/derive.ts:287 userHiddenByFold`）。
 *
 * 判别力（mutation 自证）：
 *  ① 若删掉 `toChatMessages` 里的还原块 ⇒ A1/A2/A3/A4 全红；
 *  ② 若把还原行的 `dbID` 回落成 `m.id`（assistant 行的 id）⇒ B1 红；
 *  ③ 若把还原行插在 assistant 行**之后** ⇒ A2 红；
 *  ④ 若把 `turnID` 回落链写错（恒 0）⇒ C1 红；
 *  ⑤ 若还原行与常规行**不共用** `seen` 去重表 ⇒ F1 红。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { HistoryMessage } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
    return;
  }
  fail++;
  console.log(`  \u2717 ${name}${extra !== undefined ? '  (' + extra + ')' : ''}`);
}

/** 一个「只下发了尾部区域窗口」的 turn：assistant 行携带 turn_user。 */
function windowedHistory(regionsBefore: number): HistoryMessage[] {
  return [
    {
      id: 200,
      role: 'assistant',
      turn_id: 7,
      regions_before: regionsBefore,
      content: '\u7b54',
      iterations: [],
      turn_user: { id: 199, role: 'user', content: '\u95ee', turn_id: 7, timestamp: 'T1' },
    },
  ];
}

// ── A. 还原 + 插在 assistant 行**之前** ───────────────────────────────────────
{
  const out = ChatStore.toChatMessages(windowedHistory(166));
  ok('A1 还原出 2 行（user + assistant）', out.length === 2, `len=${out.length}`);
  ok('A2 第 1 行是 user（插在 assistant 之前）', out.length === 2 && out[0].role === 'user',
    out.length === 2 ? out[0].role : 'n/a');
  ok('A3 第 2 行是 assistant', out.length === 2 && out[1].role === 'assistant',
    out.length === 2 ? out[1].role : 'n/a');
  ok('A4 user 行的内容 = turn_user 的内容', out.length === 2 && out[0].content === '\u95ee',
    out.length === 2 ? out[0].content : 'n/a');
  ok('A5 assistant 行的内容不受影响', out.length === 2 && out[1].content === '\u7b54');
  ok('A6 user 行无迭代（还原行不给迭代）', out.length === 2 && out[0].iterations.length === 0);
}

// ── B. dbID 归属：**必须**取 user 行自己的 id（⛔ 绝不能回落 assistant 行的 id）────
{
  const out = ChatStore.toChatMessages(windowedHistory(166));
  ok('B1 user 行 dbID = turn_user.id（不是 assistant 行的 id）',
    out.length === 2 && out[0].dbID === 199, out.length === 2 ? `dbID=${out[0].dbID}` : 'n/a');
  ok('B2 assistant 行 dbID 仍是自己的 id', out.length === 2 && out[1].dbID === 200,
    out.length === 2 ? `dbID=${out[1].dbID}` : 'n/a');
}

// ── C. turnID 回落链：tu.turn_id → m.turn_id → 0 ──────────────────────────────
{
  const withTu: HistoryMessage[] = [
    {
      id: 11, role: 'assistant', turn_id: 3, regions_before: 5, content: 'a', iterations: [],
      turn_user: { id: 10, role: 'user', content: 'q', turn_id: 42 },
    },
  ];
  const o1 = ChatStore.toChatMessages(withTu);
  ok('C1 有 turn_user.turn_id ⇒ 用它的', o1.length === 2 && o1[0].turnID === 42,
    o1.length === 2 ? `turnID=${o1[0].turnID}` : 'n/a');

  const noTuTurn: HistoryMessage[] = [
    {
      id: 11, role: 'assistant', turn_id: 3, regions_before: 5, content: 'a', iterations: [],
      turn_user: { id: 10, role: 'user', content: 'q' },
    },
  ];
  const o2 = ChatStore.toChatMessages(noTuTurn);
  ok('C2 缺 turn_user.turn_id ⇒ 回落 assistant 行的 turn_id',
    o2.length === 2 && o2[0].turnID === 3, o2.length === 2 ? `turnID=${o2[0].turnID}` : 'n/a');

  const neither: HistoryMessage[] = [
    {
      id: 11, role: 'assistant', regions_before: 5, content: 'a', iterations: [],
      turn_user: { id: 10, role: 'user', content: 'q' },
    },
  ];
  const o3 = ChatStore.toChatMessages(neither);
  ok('C3 两边都缺 ⇒ 0（不 NaN/不 undefined）', o3.length === 2 && o3[0].turnID === 0,
    o3.length === 2 ? `turnID=${o3[0].turnID}` : 'n/a');
}

// ── D. 无 turn_user ⇒ 输出**逐字不变**（老行为回归） ──────────────────────────
{
  const plain: HistoryMessage[] = [
    { id: 200, role: 'assistant', turn_id: 7, content: '\u7b54', iterations: [] },
  ];
  const out = ChatStore.toChatMessages(plain);
  ok('D1 无 turn_user ⇒ 只 1 行', out.length === 1, `len=${out.length}`);
  ok('D2 id 仍是既有稳定键 m-<id>', out.length === 1 && out[0].id === 'm-200',
    out.length === 1 ? out[0].id : 'n/a');
  ok('D3 dbID 仍是自己的 id', out.length === 1 && out[0].dbID === 200);
}

// ── E. 守卫：role/内容不合法 ⇒ **不**还原（宁可少一行也不造脏行）────────────────
{
  const badRole: HistoryMessage[] = [
    {
      id: 1, role: 'assistant', turn_id: 1, content: 'a', iterations: [],
      turn_user: { id: 2, role: 'assistant', content: 'x' },
    },
  ];
  ok('E1 turn_user.role !== user ⇒ 不还原', ChatStore.toChatMessages(badRole).length === 1);

  const noContent: HistoryMessage[] = [
    {
      id: 1, role: 'assistant', turn_id: 1, content: 'a', iterations: [],
      turn_user: { id: 2, role: 'user' },
    },
  ];
  ok('E2 turn_user 无 content ⇒ 不还原', ChatStore.toChatMessages(noContent).length === 1);
}

// ── F. id 唯一：还原行与常规行共用 `seen`（ForEach key 血债）──────────────────
{
  const clashing: HistoryMessage[] = [
    {
      id: 200, role: 'assistant', turn_id: 7, content: 'a', iterations: [],
      // ⚠️ 故意让 turn_user.id 与 assistant 行的 id **相同** —— 真机里不可能（DB 主键唯一），
      //    但「同一批内 id 必须唯一」是**硬约束**（撞 key ⇒ 整列表子树不渲染 ⇒ 白屏）。
      turn_user: { id: 200, role: 'user', content: 'q' },
    },
  ];
  const out = ChatStore.toChatMessages(clashing);
  ok('F1 两行 id 不相同（共用去重表）',
    out.length === 2 && out[0].id !== out[1].id,
    out.length === 2 ? `${out[0].id} vs ${out[1].id}` : `len=${out.length}`);
}

// ── G. 端到端（真路径）：窗口未覆盖迭代 1 ⇒ **不渲染** user 行；归零后出现 ────────
{
  const rows = ChatStore.rowsFromHistory(windowedHistory(166));
  const userRows = rows.filter((r) => r.role === 'user');
  ok('G1 regions_before>0 ⇒ derive 不渲染 user 行（消息不连续零容忍）',
    userRows.length === 0, `userRows=${userRows.length}`);
  ok('G2 assistant 行照常渲染', rows.filter((r) => r.role === 'assistant').length === 1);

  const rows2 = ChatStore.rowsFromHistory(windowedHistory(0));
  const userRows2 = rows2.filter((r) => r.role === 'user');
  ok('G3 regions_before 归零 ⇒ user 行出现（完整时间线）',
    userRows2.length === 1, `userRows=${userRows2.length}`);
  ok('G4 归零后顺序仍是 user 在 assistant 之前',
    rows2.length >= 2 && rows2[0].role === 'user',
    rows2.length >= 1 ? rows2[0].role : 'n/a');
  ok('G5 还原行的 dbID 透传到派生行', userRows2.length === 1 && userRows2[0].id !== '');
}

console.log(`\nturn_user_restore: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

export {};
