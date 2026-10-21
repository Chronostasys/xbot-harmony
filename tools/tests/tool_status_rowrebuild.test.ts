/**
 * tool_status_rowrebuild.test.ts —— **工具状态变化必须落到渲染行**（2026-10-12，P0 防回归）。
 *
 * 用户亲报（原话）：「不可能一个迭代所有 tool 都排队」「**running 绝不能变回 pending**」。
 *
 * ── 旧链路真根因（历史，保留为背景）──────────────────────────────────────────
 *   live 行 pill 来自 `applyRow` 从派生行的 `activeTools/streamingTools` 即时折叠的
 *   `live:true` 块；`rowSignature` 的 live 分支只含**长度** ⇒ `pending → running`
 *   指纹不变 ⇒ `applyRow` 早退 ⇒ 块冻结在首帧 `pending` ⇒ pill 永远「排队」。
 *
 * ── 新链路（本判据）────────────────────────────────────────────────────────
 *   行源 = 模型投影（`model_bridge.applyModel`）。工具的 `status/label/genChars/elapsedMs`
 *   是**每帧字段**（`model_step` 的 tick 语义），桥接按 `ToolRec` **源对象恒等**记忆化
 *   ⇒ 状态变了的 `ToolRec` 是新对象 ⇒ 必然产出新的 `ToolProgress` ⇒ 行必须反映最新状态。
 *   判据：同一 live turn，工具状态逐帧推进 ⇒ 渲染行里的工具状态**逐帧跟随**，且不重复。
 *
 * ⚠️ 判别力自证：把 `model_bridge.toToolProgress` 的记忆化键从「ToolRec 对象」改成
 *    「call_id 字符串」⇒ ②③ 必红（状态更新被旧对象吃掉）。
 */
export {};

declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow, ToolProgress } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function tool(name: string, status: string, callId: string, elapsedMs: number): Record<string, Object> {
  return {
    name, label: name, status, call_id: callId, iteration: 1,
    elapsedMs, genChars: 0, summary: '', detail: '', args: '',
  };
}

/** 一帧 live iteration（`activeTools` = 正在跑的那批）。 */
function iter(active: Record<string, Object>[], seq: number): Record<string, Object> {
  return {
    type: 'iteration', turnID: 1, iter: 1, phase: 'tool_exec', seq,
    activeTools: active, completedTools: [], streamingTools: [],
  };
}

function assistantRow(rows: ChatRow[]): ChatRow {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role === 'assistant') {
      return rows[i];
    }
  }
  return undefined as unknown as ChatRow;
}

/** 渲染行里的 live 工具列表（页面 `syncLiveTail` 读的就是 `row.iterations` 末尾的在飞块）。 */
function liveTools(row: ChatRow): ToolProgress[] {
  const its = row.iterations;
  if (its === undefined || its.length === 0) {
    return [];
  }
  const ts = its[its.length - 1].tools;
  return ts !== undefined ? ts as ToolProgress[] : [];
}

const feed = new ModelFeed('chat_toolstatus');
feed.push({ type: 'turn_started', turnID: 1, trigger: 'user', content: 'go', requestID: 'r1', seq: 1 });

// ── ① 首帧 pending ⇒ 行里必须**看得到**这枚工具 ────────────────────────────────
feed.push(iter([tool('Shell', 'pending', 'c1', 0)], 2));
const row: ChatRow = assistantRow(feed.rows());
ok('① live 行存在且带 1 枚工具', row !== undefined && liveTools(row).length === 1);
ok('①b 首帧状态 = pending', liveTools(row)[0].status === 'pending');
ok('①c 工具身份 = call_id', liveTools(row)[0].call_id === 'c1');
// ⛔ 页面 `syncLiveTail` 靠 `iterations[i].live === true` 找到在飞块并把正文/思考/工具
//   投递给打字机（Index.ets:10320-10341）⇒ 漏标记 = 流式内容只在收尾出现。
ok('①d 在飞块必须带 live 标记（打字机路径）',
  row.iterations[row.iterations.length - 1].live === true);
ok('①e 已提交块不得带 live 标记', (row.completedBlocks !== undefined ? row.completedBlocks.length : 0) === 0);

// ── ② 【核心回归】pending → running ⇒ 行必须跟随（否则 pill 卡在「排队」）───────
feed.push(iter([tool('Shell', 'running', 'c1', 0)], 3));
ok('② ★ pending → running ⇒ 行状态必须变 running（不得冻结）', liveTools(assistantRow(feed.rows()))[0].status === 'running');
ok('②b 不产生重复条目（去重只按 call_id）', liveTools(assistantRow(feed.rows())).length === 1);

// ── ③ running → done（工具从 activeTools 消失、进 completedTools 也一样）───────
feed.push({
  type: 'iteration', turnID: 1, iter: 1, phase: 'tool_exec', seq: 4,
  activeTools: [], completedTools: [tool('Shell', 'done', 'c1', 900)], streamingTools: [],
});
ok('③ running → done ⇒ 行状态 = done', liveTools(assistantRow(feed.rows()))[0].status === 'done');

// ── ④ streamingTools 的 generating → running 同样必须跟随 ──────────────────────
const feed2 = new ModelFeed('chat_toolstatus2');
feed2.push({ type: 'turn_started', turnID: 1, trigger: 'user', content: 'go', requestID: 'r1', seq: 1 });
feed2.push({
  type: 'iteration', turnID: 1, iter: 1, phase: 'tool_gen', seq: 2,
  activeTools: [], completedTools: [],
  streamingTools: [tool('Shell', 'generating', 'c2', 0)],
});
ok('④ ★ streamingTools generating ⇒ 行里出现（generating）',
  liveTools(assistantRow(feed2.rows())).length === 1 && liveTools(assistantRow(feed2.rows()))[0].status === 'generating');
feed2.push({
  type: 'iteration', turnID: 1, iter: 1, phase: 'tool_gen', seq: 3,
  activeTools: [], completedTools: [],
  streamingTools: [tool('Shell', 'running', 'c2', 0)],
});
ok('④b ★ generating → running ⇒ 行状态跟随', liveTools(assistantRow(feed2.rows()))[0].status === 'running');

// ── ⑤ elapsedMs 是连续量：变化**不得**改变工具身份（同一 call_id 只有一条）────
const feed3 = new ModelFeed('chat_toolstatus3');
feed3.push({ type: 'turn_started', turnID: 1, trigger: 'user', content: 'go', requestID: 'r1', seq: 1 });
feed3.push(iter([tool('Shell', 'running', 'c1', 1200)], 2));
feed3.push(iter([tool('Shell', 'running', 'c1', 1500)], 3));
const ts = liveTools(assistantRow(feed3.rows()));
ok('⑤ elapsedMs 变化 ⇒ 仍只有 1 条', ts.length === 1);
ok('⑤b elapsedMs 跟随最新帧', ts[0].elapsed_ms === 1500);

// ── ⑥ 工具数量变化（新增一枚）⇒ 两枚都在 ─────────────────────────────────────
feed3.push(iter([tool('Shell', 'running', 'c1', 1600), tool('Read', 'pending', 'c3', 0)], 4));
ok('⑥ 新增工具 ⇒ 2 条（身份仍按 call_id）', liveTools(assistantRow(feed3.rows())).length === 2);

if (fail > 0) {
  console.log(`  ✗ tool_status_rowrebuild: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ tool_status_rowrebuild: ${pass} passed, 0 failed`);
process.exit(0);
