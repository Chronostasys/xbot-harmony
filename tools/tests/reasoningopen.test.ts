/**
 * 思考块展开态共享存储门禁 —— `core/reasoningopen.ts`（移植 web
 * `src/components/agent/reasoningOpenState.ts`）。
 *
 * 为什么必须有：展开态若在 live↔committed 形态切换（remount）后丢失，用户已展开的思考块
 *   会**自动收起**（web 2026-09-12 用户报告的原始缺陷）。本门禁钉死"跨形态共享 + 有界 LRU"
 *   两条契约 —— 它们是"不自动收起"和"长会话不无界增长"的唯一保证。
 *
 * mutation：`get` 把存的 `false` 当"没记录" / `reasoningKey` 不把 null 归 0 / 淘汰逻辑丢失 → 必红。
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  getReasoningOpen,
  liveIterationNo,
  reasoningKey,
  reasoningOpenSize,
  REASONING_OPEN_MAX,
  resetReasoningOpenState,
  setReasoningOpen,
} from '../../entry/src/main/ets/core/reasoningopen';
import { HistoryIteration } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ═══ ① 上限常量 ═══════════════════════════════════════════════════════════════════════
eq('上限 = 300（web MAX_ENTRIES）', REASONING_OPEN_MAX, 300);

// ═══ ② key 构造：live 与 committed 必须用同一个（`turnID:iteration`）════════════════════
// mutation：`turnID ?? 0` 写成 `turnID`（null 不归 0）⇒ null 用例必红。
eq('key: turnID=5, iter=2', reasoningKey(5, 2), '5:2');
eq('key: turnID=null ⇒ 0', reasoningKey(null, 1), '0:1');
eq('key: turnID=undefined ⇒ 0', reasoningKey(undefined, 7), '0:7');
eq('key: turnID=0, iter=3', reasoningKey(0, 3), '0:3');
// live 与 committed 传入同一 (turnID, iteration) ⇒ 必得同 key（否则 remount 后读不到）
eq('live/committed 同 key', reasoningKey(9, 4), reasoningKey(9, 4));

// ═══ ③ get/set 语义（含 `false` 必须能被区分于"无记录"）══════════════════════════════════
// mutation：`get` 用 `if (v)` 判断 ⇒ 存 `false` 会被当"没记录"返回 undefined ⇒ 必红。
resetReasoningOpenState();
eq('无记录 ⇒ undefined（回落 defaultOpen）', getReasoningOpen('1:1'), undefined);
setReasoningOpen('1:1', true);
eq('存 true ⇒ true', getReasoningOpen('1:1'), true);
setReasoningOpen('1:2', false);
eq('存 false ⇒ false（不是 undefined！）', getReasoningOpen('1:2'), false);
eq('false 被视作"有记录"', getReasoningOpen('1:2') !== undefined, true);
// 覆盖写
setReasoningOpen('1:1', false);
eq('覆盖写 true→false', getReasoningOpen('1:1'), false);

// ═══ ④ 有界性 + LRU（读也算使用）═════════════════════════════════════════════════════════
// mutation：去掉淘汰 while ⇒ size 会涨到 301 ⇒ 必红。
resetReasoningOpenState();
for (let i = 0; i < REASONING_OPEN_MAX; i++) {
  setReasoningOpen(`k${i}`, true);
}
eq('存满上限 ⇒ size = 300', reasoningOpenSize(), REASONING_OPEN_MAX);
setReasoningOpen('overflow', true);
eq('超一条 ⇒ 仍 300（淘汰最久未用）', reasoningOpenSize(), REASONING_OPEN_MAX);
eq('最老的 k0 已被淘汰', getReasoningOpen('k0'), undefined);
eq('新的 overflow 在', getReasoningOpen('overflow'), true);

// LRU：读 k1 使其"最近使用"，再溢出应淘汰 k2（而非 k1）。
resetReasoningOpenState();
for (let i = 0; i < REASONING_OPEN_MAX; i++) {
  setReasoningOpen(`r${i}`, true);
}
eq('读 r0（提到最新）', getReasoningOpen('r0'), true);
setReasoningOpen('again', true); // 溢出 ⇒ 淘汰当下最久未用的 r1
eq('r0 因刚读过而存活', getReasoningOpen('r0'), true);
eq('r1 被淘汰（最久未用）', getReasoningOpen('r1'), undefined);

// ═══ ⑤ 隔离：reset 清空 ════════════════════════════════════════════════════════════════
resetReasoningOpenState();
eq('reset 后 size=0', reasoningOpenSize(), 0);
ok('reset 后无残留', getReasoningOpen('r0') === undefined && getReasoningOpen('again') === undefined);

// ═══ ⑥ live 侧迭代号（`reasoningKey` 的 live 输入；live↔committed 同键的关键）════════════
// mutation：改成恒取「最大号」或恒 0 ⇒ 必红。
function it(n: number, live?: boolean): HistoryIteration {
  const o: HistoryIteration = { iteration: n };
  if (live === true) o.live = true;
  return o;
}
eq('无迭代 ⇒ 0', liveIterationNo([]), 0);
eq('有在飞块 ⇒ 取它的号', liveIterationNo([it(1), it(2), it(3, true)]), 3);
eq('在飞块不在末尾也取它', liveIterationNo([it(2, true), it(3)]), 2);
eq('无在飞块 ⇒ 回落最大号', liveIterationNo([it(3), it(5), it(4)]), 5);
eq('单块无 live ⇒ 该号', liveIterationNo([it(7)]), 7);
// 同键契约：live 侧号 + committed 侧同 (turnID, iteration) ⇒ 同一 key（否则 commit 后读不到）
eq('live/committed 同键', reasoningKey(42, liveIterationNo([it(1), it(2, true)])), reasoningKey(42, 2));

// ═══ ⑦ K 的**端到端往返**（web: live↔committed 共用 `reasoningKey`）══════════════════════
// 缺陷：展开 live 思考 → 等迭代 commit ⇒ 回 false（视觉突收）。
// 契约：live 侧**写下**的展开态，committed 侧用**同一 key** 必能**读回**（否则就是没收起）。
{
  resetReasoningOpenState();
  const turnID: number = 42;
  // ① live：`row.iterations` 含在飞块（`core/render.ets:342` 的 `liveIterations(r)`），块号 = 2
  const liveIters: HistoryIteration[] = [it(0), it(1), it(2, true)];
  const liveKey: string = reasoningKey(turnID, liveIterationNo(liveIters));
  setReasoningOpen(liveKey, true);        // 用户展开 live 思考
  // ② commit：同一逻辑迭代以「已完成块」形态出现（iteration 仍 = 2）
  const committedKey: string = reasoningKey(turnID, 2);
  eq('K: commit 后读同一 key ⇒ 仍展开（不自动收起）', getReasoningOpen(committedKey), true);
  eq('K: live 键 == committed 键', liveKey, committedKey);
  // 收起的反向：live 收起 ⇒ commit 后仍收起（不凭空展开）
  resetReasoningOpenState();
  setReasoningOpen(reasoningKey(turnID, liveIterationNo(liveIters)), false);
  eq('K: live 收起 ⇒ commit 后仍收起', getReasoningOpen(reasoningKey(turnID, 2)), false);
  // 不同 turnID ⇒ 不同 key（跨回合不串味）
  eq('K: 跨 turnID 不串味', getReasoningOpen(reasoningKey(43, 2)), undefined);
}

console.log(fail === 0 ? `✅ reasoningopen: ${pass} passed` : `❌ reasoningopen: ${fail} failed / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
