/**
 * 判据：**权威快照不得被"永久丢弃"** —— `isStaleSnapshot` 必须有单调逃生口。
 *
 * 2026-10-24 用户 P0（锁屏恢复）：「实际进度已经远远不在这个 turn 了，还是显示老 turn；
 *   我在 web 端发的 user 消息与 agent 中间的回复都看不到，一直卡死也不触发重新加载」。
 *
 * 根因：旧实现只看「每回合块数是否减少 / 回合是否缺失」，**没有"谁更新"的概念**。
 *   一旦本地某轮的块数**多于** DB（流式期累积、服务端中断/压缩、该轮已被新回合取代），
 *   **之后每一份权威快照都会被丢弃** ⇒ 重载在跑但永远不落地 ⇒ 永久停在旧 turn
 *   （真机日志特征：`DIFF … blocks=296->167` 反复出现却不动）。
 *
 * 三条逃生口（任一成立 ⇒ **接受**快照，DB 是权威）：
 *   ① 快照出现**比本地更新的回合**（`incMaxTurn > maxLocal`）；
 *   ② 同回合块数少，但服务端声明了窗口（`iterations + regionsBefore >= 本地块数`）；
 *   ③ 快照里**已有该回合的 assistant 行**（该轮产出已落库）。
 * 反向（必须**继续拒绝**）：同回合、块数更少、无窗口、无 assistant 行、也无更新回合
 *   —— 这正是 2026-10-22「cancel 后 agent 消息闪掉又回来」要保护的那一段。
 *
 * ⛔ mutation 自证：
 *   · 删掉逃生① ⇒ 用例① 红；
 *   · 删掉逃生② ⇒ 用例② 红；
 *   · 删掉逃生③ ⇒ 用例③ 红；
 *   · 把反向保护也删掉（一律接受）⇒ 用例④ 红。
 */
declare const process: { cwd: () => string; exit: (c: number) => void };
declare const require: (m: string) => any;
const fs = require('fs');
const path = require('path');

import { emptyState, newTurn, State, TurnRec } from '../../entry/src/main/ets/core/model_types';
import { isStaleSnapshot } from '../../entry/src/main/ets/core/model_bridge';
import { WireHistoryMessage } from '../../entry/src/main/ets/core/model_hydrate';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

/** 前置：本地回合 1041 在飞、已累积 296 块（= 真机现场的量级）。 */
function localLiveWith296(): State {
  const base: State = emptyState('c1', 1, 0);
  const t: TurnRec = newTurn(1041 as never, null, null);
  const blocks: object[] = [];
  for (let i = 1; i <= 296; i++) {
    blocks.push({ iteration: i });
  }
  const flying: TurnRec = { ...t, blocks: blocks as never, final: null, streaming: true, phase: 'tool_exec' };
  const turns = new Map<number, TurnRec>();
  turns.set(1041, flying);
  // ⛔ 现场形状：模型 `live` **停在 1041**（这正是"卡在旧 turn"的样子）⇒ 逃生③的第二个
  //   条件（"本地不再把它当在飞"）不成立 ⇒ 必须由①/②来放行。
  return {
    ...base, turns,
    live: { turn: 1041, iteration: 296, content: '', reasoning: '', tools: [], genui: '' },
  } as State;
}

function assistantRow(turn: number, its: number): WireHistoryMessage {
  const iterations: object[] = [];
  for (let i = 1; i <= its; i++) {
    iterations.push({ iteration: i });
  }
  return { id: `a${turn}`, role: 'assistant', content: 'x', turnID: turn, iterations: iterations as never };
}

// ── ① 逃生①：快照已出现**更新的回合** ⇒ 必须接受（本次 P0 的主形态）────────────
{
  const wire: WireHistoryMessage[] = [
    { id: 'a1041', role: 'assistant', content: 'x', turnID: 1041, iterations: [] },
    { id: 'u1042', role: 'user', content: 'web 端发的消息', turnID: 1042 },
  ];
  ok('① 出现更新回合（1042 > 1041）⇒ 不得判 stale',
    isStaleSnapshot(localLiveWith296(), wire) === false);
}

// ⛔ 2026-10-28 P-1 改口径：**块数不再参与判定**。`hydrate` 已改为**回合级合并**
//   （`prev.turns` 为底 + 块按迭代 upsert）⇒ 快照"块更少/少了某个回合"**不会删本地数据**，
//   所以不再需要"缩表即拒绝"（那正是"别的端的消息永远进不来"的根因）。
//   现在只有一种落后形态会拒绝：**快照最新回合 < 本地最新回合，且本地最新回合已收尾**。
{
  const wire: WireHistoryMessage[] = [assistantRow(1041, 167)];
  const withRb: WireHistoryMessage[] = [{
    id: 'a1041', role: 'assistant', content: 'x', turnID: 1041,
    iterations: [] as never, regionsBefore: 200,
  }];
  // 本地 1041 仍在飞（final=null）⇒ 快照只是"还没落库/窗口更小" ⇒ 一律接受
  ok('② 同回合缩表（本地仍在飞）⇒ 接受（合并保证不丢块）',
    isStaleSnapshot(localLiveWith296(), wire) === false);
  ok('② 有 regionsBefore 的更小窗口 ⇒ 接受',
    isStaleSnapshot(localLiveWith296(), withRb) === false);
}

// ── ③ assistant 行存在 ⇒ 接受（无论本地是否仍当在飞）──────────────────────────
{
  const advanced: State = { ...localLiveWith296(), live: { turn: 1042, iteration: 1, content: '', reasoning: '', tools: [], genui: '' } } as State;
  ok('③ 快照有 assistant 行 + 本地 live 已前进 ⇒ 接受',
    isStaleSnapshot(advanced, [assistantRow(1041, 100)]) === false);
  ok('③ 快照有 assistant 行 + 本地仍把它当在飞 ⇒ 接受（块并集，不丢）',
    isStaleSnapshot(localLiveWith296(), [assistantRow(1041, 100)]) === false);
}

/** 本地最新回合**已收尾**（final 非空）的状态。 */
function localFinished(turn: number): State {
  const base: State = emptyState('c1', 1, 0);
  const t: TurnRec = newTurn(turn as never, null, null);
  const blocks: object[] = [{ iteration: 1 }];
  const done: TurnRec = {
    ...t, blocks: blocks as never, final: { content: 'ok', cancelled: false },
    streaming: false, phase: 'done',
  };
  const turns = new Map<number, TurnRec>();
  turns.set(turn, done);
  return { ...base, turns, live: null } as State;
}

// ── ④ 真正落后的形态：快照最新回合更小 且 本地最新已收尾 ⇒ 拒绝 ─────────────────
{
  ok('④ 只有 user 行的更旧快照 ⇒ stale（防回退）',
    isStaleSnapshot(localFinished(1041), [{ id: 'u1040', role: 'user', content: 'u', turnID: 1040 }]) === true);
}

// ── ⑤ 整回合缺失 + 本地最新已收尾 ⇒ 仍判 stale ────────────────────────────────
{
  ok('⑤ 本地最新回合在快照里缺失（且快照更旧）⇒ stale',
    isStaleSnapshot(localFinished(1041), [assistantRow(1040, 10)]) === true);
  ok('⑤ 但快照含本地最新回合 ⇒ 接受（窗口只带 user 行也不算落后）',
    isStaleSnapshot(localFinished(1041), [{ id: 'u1041', role: 'user', content: 'u', turnID: 1041 }]) === false);
}

// ── ⑥ 接线：恢复判定的触发点必须是**帧到达边沿**，⛔ 不是定时器/脉冲轮询 ──────────────
{
  const index: string = fs.readFileSync(
    path.join(process.cwd(), 'entry/src/main/ets/pages/Index.ets'), 'utf8');
  const store: string = fs.readFileSync(
    path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');
  // ① 边沿触发：帧到达时判"上一帧距今是否隔了一个长静默" ⇒ 这一次就是恢复边沿
  ok('⑥ store：`onSse` 里按**帧间隔**判恢复边沿（SSE_GAP_RESUME_MS）',
    /SSE_GAP_RESUME_MS: number = 10000/.test(store)
    && /private onSse\(event: string, data: string\): void \{[\s\S]{0,1200}gapNow - this\.lastEventAtMs >= ChatStore\.SSE_GAP_RESUME_MS/.test(store));
  ok('⑥ 边沿触发真的去对账（resumeContinuity)，不只是一行日志',
    /gapNow - this\.lastEventAtMs >= ChatStore\.SSE_GAP_RESUME_MS[\s\S]{0,400}this\.resumeContinuity\('silence-gap'\)/.test(store));
  ok('⑥ 该判定在 heartbeat 早退**之前**（心跳也算帧 ⇒ 解锁后第一帧必命中）',
    store.indexOf('gapNow - this.lastEventAtMs >= ChatStore.SSE_GAP_RESUME_MS')
    < store.indexOf("if (event === SseEventType.heartbeat)"));
  // ② 反向：⛔ 不得再回到"脉冲/定时器里周期判静默"的轮询形态
  ok('⑥ ⛔ 页面不再有脉冲式静默轮询（SILENCE_RESUME_MS 已删）',
    index.indexOf('SILENCE_RESUME_MS') < 0);
  ok('⑥ ⛔ 恢复不靠新增定时器：store 的 SETTIMEOUT 不是为它而加',
    store.indexOf('setInterval') < 0);
}

console.log(`stale_snapshot_escape: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
