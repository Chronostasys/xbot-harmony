/**
 * tool_status_rowrebuild.test.ts —— **行指纹必须含工具状态**（2026-10-12，P0 防回归）。
 *
 * 用户亲报（原话）：「不可能一个迭代所有 tool 都排队」「**running 绝不能变回 pending**」。
 *
 * ── 真根因（真机 + hilog 探针实证，非推理）──────────────────────────────────────
 *   live 行渲染的 pill 来自页面 `@State liveTools`，而它由页面 `syncLiveTail()` 从
 *   **`ChatRow.iterations` 末尾的 `live:true` 块**读出；该块由 `core/render.ets` 的
 *   `liveIterations(r)` 从派生行的 **`r.activeTools`/`r.streamingTools` 即时折叠**出来
 *   （**不在** `r.iterations` 里 —— 所以指纹加在 `last.tools` 上是**死分支**，实测无效）。
 *   而 `rowSignature()` 的 live 分支此前只含这两个数组的**长度**：
 *     `...#${r.activeTools.length}#${r.streamingTools.length}#...`
 *   ⇒ 同一个工具 `pending → running` 时**指纹不变** ⇒ `applyRow` 判定"行没变"直接 return
 *   ⇒ `ChatRow.iterations` 里的 live 块**冻结在首帧的 `pending`** ⇒ pill 永远显示「排队」。
 *   （hilog 实测：修复前 `[LIVETOOL] Shell:pending;` 持续 ~25s；修复后
 *     `generating → running` 正确推进。）
 *
 * 判据：**同一 live 行，仅某工具的 `status` 变化 ⇒ `applyRow` 必须返回 true（行需要重建）**。
 *
 * ⚠️ **判别力自证**：把 live 分支里的 `toolsStatusSig(...)` 两段删掉 ⇒ 本用例必红
 *    （这正是修复前的形态）。
 */
export {};

declare const process: { exit: (c: number) => void };

import { applyRow } from '../../entry/src/main/ets/core/render';
import { ChatRow } from '../../entry/src/main/ets/core/types';
import type { LiveRowView } from '../../entry/src/main/ets/core/derive';
import type { WebToolProgress } from '../../entry/src/main/ets/core/chattypes';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function tw(name: string, status: string, callId: string, elapsedMs: number = 0): WebToolProgress {
  return {
    name, label: name, status, elapsedMs, summary: '', detail: '', args: '', toolHints: '',
    callID: callId,
  } as unknown as WebToolProgress;
}

/** 造一个 live 派生行（只填 `rowSignature` live 分支读的字段）。 */
function lv(active: WebToolProgress[], streaming: WebToolProgress[]): LiveRowView {
  return {
    kind: 'live', id: 'live', turnID: 1, isPartial: true, streaming: true,
    content: '', reasoning: '', iterations: [], activeTools: active, streamingTools: streaming,
    genui: '', subAgents: [], todos: [], lastIter: 1,
  } as unknown as LiveRowView;
}

function fresh(): ChatRow {
  const row = new ChatRow();
  row.id = 'live';
  return row;
}

// ── ① 首次 applyRow 必定"变了" ────────────────────────────────────────────────
const r1: ChatRow = fresh();
ok('① 首次 applyRow ⇒ true', applyRow(r1, lv([tw('Shell', 'pending', 'c1')], [])) === true);

// ── ② 完全同值 ⇒ false（幂等；保住 memo）────────────────────────────────────
ok('② 同值重复 applyRow ⇒ false（幂等，不产生多余重建）',
  applyRow(r1, lv([tw('Shell', 'pending', 'c1')], [])) === false);

// ── ③ 【核心回归】仅 activeTools[0].status 变化 ⇒ 必须 true ──────────────────
//    修复前：长度为 1 不变 ⇒ 指纹不变 ⇒ **false**（pill 永久冻结在"排队"）。
ok('③ ★ 工具 pending → running（长度不变）⇒ **必须 true**（否则 pill 卡在「排队」）',
  applyRow(r1, lv([tw('Shell', 'running', 'c1')], [])) === true);
ok('③b 工具 running → done ⇒ 必须 true',
  applyRow(r1, lv([tw('Shell', 'done', 'c1')], [])) === true);

// ── ④ streamingTools 的 status 变化同样必须触发重建（generating → running）──
const r2: ChatRow = fresh();
applyRow(r2, lv([], [tw('Shell', 'generating', 'c1')]));
ok('④ ★ streamingTools 状态 generating → running ⇒ 必须 true',
  applyRow(r2, lv([], [tw('Shell', 'running', 'c1')])) === true);

// ── ⑤ 生成字数（gen_chars 不在 web 形状里）与 elapsedMs：elapsed **不入**指纹 ──
//    ⛔ 刻意排除 `elapsedMs`（running 时长每帧变 ⇒ 纳入会让 live 行每帧重建）。
const r3: ChatRow = fresh();
applyRow(r3, lv([tw('Shell', 'running', 'c1', 1200)], []));
ok('⑤ 仅 elapsedMs 变化 ⇒ **不**触发重建（刻意排除连续量，避免每帧重建）',
  applyRow(r3, lv([tw('Shell', 'running', 'c1', 1500)], [])) === false);

// ── ⑥ 工具数量变化仍触发（既有行为不回退）───────────────────────────────────
const r4: ChatRow = fresh();
applyRow(r4, lv([tw('Shell', 'running', 'c1')], []));
ok('⑥ activeTools 新增一条 ⇒ true',
  applyRow(r4, lv([tw('Shell', 'running', 'c1'), tw('Read', 'pending', 'c2')], [])) === true);

if (fail > 0) {
  console.log(`  ✗ tool_status_rowrebuild: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ tool_status_rowrebuild: ${pass} passed, 0 failed`);
process.exit(0);
