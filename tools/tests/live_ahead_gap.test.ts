/**
 * P0（2026-10-15 用户实录）：**切回 iter 很多的会话 ⇒ 历史与最新迭代脱节**。
 * 本文件与 web `src/chat/p0-live-ahead-gap.test.ts` **逐字同源**（状态机是 web 的逐字移植）。
 *
 * 用户原话：「有时候切回一个 iter 很多的会话，历史会显示，例如迭代 1-1000，但是实际上
 * 最新迭代是 2000，然后此时最新迭代 2000 在迭代 1000 后渲染出来，然后迭代 2000 结束后
 * 变回只有迭代 1-1000 能看到。」
 *
 * 根因（与既有的 `lostIterGapSig` 是同一缺陷家族的**另一条形态**）：那条只在**事件**
 * 带着跳跃的迭代号到达时才可能判出（`evNumber > maxHeld + 1`）。而本例的脱节是在
 * **一次 hydration/合并内部**形成的 —— 权威快照与本地窗口各带一段，union 之后 turn 的
 * 迭代计数器已到 2000、`iterations` 只到 1000，**没有任何事件会带出跳跃** ⇒ 旧判据恒不
 * 触发 ⇒ 界面永久落后：渲染层用 `lastIter` 合成在飞块 ⇒「2000 渲染在 1000 之后」；
 * turn 结束（定格/提交）后合成块消失 ⇒「又只剩 1-1000」。
 *
 * 修复契约（用户定向："如果 live 迭代很明显的脱节，要么 catch up gap 要么直接清除 memo
 * 重新拉 api 加载会话"）：`liveAheadGapSig` =「`live.iter > maxHeldIteration(iterations)
 * + 容差`」⇒ 走**既有**的 `gapReloadToken` 出口（面板 markHistoryStale + reset + 权威
 * reload ⇒ DB 窗口 union 补洞）。判据挂在三处：① hydration 合并（用户实测触发点）；
 * ② 定格（session idle / text_final fold）；③ 提交（committed）。
 *
 * 判别力（mutation 自证）：
 *   ① `liveAheadGapSig` 恒返回 ''（永不报）⇒ T1/T3/T4/T6 红；
 *   ② 去掉同形状去重（调用点不与 `s.liveAheadGapSig` 比较）⇒ T2 红（重载风暴）；
 *   ③ 容差改成 0（把"在飞迭代尚未落进数组"的正常语义也当脱节）⇒ T5 红（假阳性）。
 */
declare const process: { exit: (c: number) => void };

import {
  EMPTY_LIVE, initialChatState, iterNum, turnID,
  type ChatState, type DomainEvent, type LiveSnapshot, type Turn,
} from '../../entry/src/main/ets/core/chat_types_full';
import { reduce } from '../../entry/src/main/ets/core/reduce';
import { WebIteration } from '../../entry/src/main/ets/core/chattypes';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const T445 = turnID(445);
const CHAT = 'chat-AE90';

function win(from: number, to: number): WebIteration[] {
  const out: WebIteration[] = [];
  for (let i = from; i <= to; i++) {
    out.push({ iteration: i, content: `iter-${i}`, reasoning: '', tools: [], toolCount: 0 });
  }
  return out;
}

/** 用户实测形态：turn 的迭代计数器已到 `counter`，但**已持有窗口**只到 `windowMax`。 */
function skew(counter: number, windowMax: number): LiveSnapshot {
  return { ...EMPTY_LIVE, iterations: win(1, windowMax) as readonly WebIteration[], iter: iterNum(counter), streaming: true };
}

function turnOf(d: LiveSnapshot): Turn {
  return { id: T445, user: null, requestID: null, phase: { kind: 'live', data: d } };
}

/** 建档：把该 turn 经 history_replaced（含 active 快照）灌进状态机 —— 即"切回会话"路径。 */
function hydrateEv(d: LiveSnapshot): DomainEvent {
  return {
    type: 'history_replaced',
    legacy: [],
    turns: [turnOf(d)],
    active: { turnID: T445, snapshot: d },
    lastSeq: null,
    todos: [],
  } as unknown as DomainEvent;
}
const hydrate = (d: LiveSnapshot): ChatState => reduce(initialChatState(CHAT), hydrateEv(d));

/** 手工建一个"正在跑"的状态（用于走定格/提交路径）。 */
function running(d: LiveSnapshot): ChatState {
  return { ...initialChatState(CHAT), turns: new Map([[T445, turnOf(d)]]), activeTurn: T445, busy: true };
}

// ── T1 核心复现 ──
{
  const s = hydrate(skew(2000, 1000));
  eq('★ T1 窗口到 1000 而计数器已到 2000 ⇒ gapReloadToken=1', s.gapReloadToken, 1);
  eq('★ T1 签名锚定洞下界 1001', s.liveAheadGapSig, `${T445}:liveAheadAt1001`);
}

// ── T2 同形状只报一次（不造成重载风暴）──
{
  const s1 = hydrate(skew(2000, 1000));
  const s2 = reduce(s1, hydrateEv(skew(2000, 1000)));
  eq('★ T2 同形状回放 ⇒ 不自增', s2.gapReloadToken, 1);
  eq('★ T2 签名保持（⛔ 不许被擦成空串 ⇒ 否则下帧又算新形状）', s2.liveAheadGapSig, `${T445}:liveAheadAt1001`);
}

// ── T3 定格路径（防"turn 结束后又只剩旧窗口"）──
{
  const s1 = reduce(running(skew(2000, 1000)), { type: 'session', busy: false } as unknown as DomainEvent);
  eq('★ T3 session(idle) 定格时同样触发', s1.gapReloadToken, 1);
}

// ── T4 提交路径（committed 的 iterations 就是这份短窗口）──
{
  const s1 = reduce(running(skew(2000, 1000)), {
    type: 'text_final', turnID: T445, seq: 900, content: '最终回复',
    progressHistory: win(1, 1000), cancelled: false,
  } as unknown as DomainEvent);
  eq('★ T4 text_final 提交时同样触发', s1.gapReloadToken, 1);
}

// ── T5 无假阳性：正常在飞语义（iter = maxHeld + 1）与容差内不得触发 ──
{
  eq('★ T5 iter=41 / 窗口到 40（正常在飞）⇒ 不触发', hydrate(skew(41, 40)).gapReloadToken, 0);
  eq('★ T5 同上有签名 = 空', hydrate(skew(41, 40)).liveAheadGapSig, '');
  eq('★ T5 容差内 iter=42 ⇒ 不触发', hydrate(skew(42, 40)).gapReloadToken, 0);
}

// ── T6 洞被补上后再脱节 ⇒ 新下界 ⇒ 重新触发 ──
{
  const s1 = hydrate(skew(2000, 1000));
  const s2 = reduce(s1, hydrateEv(skew(2000, 1500)));
  eq('★ T6 窗口补到 1500 仍脱节 ⇒ 再报一次', s2.gapReloadToken, 2);
  eq('★ T6 新下界 1501', s2.liveAheadGapSig, `${T445}:liveAheadAt1501`);
}

console.log(`\nlive_ahead_gap.test: ${pass} passed / ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
