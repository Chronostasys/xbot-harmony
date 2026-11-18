/**
 * 判据：**连续性判定**（后台→前台 / SSE 重连共用）—— `core/resume.resumeVerdict`。
 *
 * 用户 2026-10-22 定向：
 *   「转后台要记录当前 iter + turn id，转回来要请求一下 live 的信息对比，如果有 gap 要补 hole，
 *     如果 turn 都不同了要重加载」+「重新连接也必须看情况触发 resync」。
 *
 * 覆盖（每条都有明确的现场形状）：
 *   ① 服务端 `resync_required` ⇒ RELOAD（唯一权威"必须重载"）
 *   ② 没有基线（首次进前台/冷启）⇒ NONE（交给既有 `probeActiveStall`）
 *   ③ 服务端无在飞 + 基线里有回合 ⇒ RELOAD（**后台期间跑完了**，final/尾部可能全丢）
 *   ④ 服务端无在飞 + 基线无回合 ⇒ NONE
 *   ⑤ 换轮且更快 ⇒ RELOAD（错过整轮开始）
 *   ⑥ 换轮但本地更靠前 ⇒ NONE（快照滞后，**绝不反向清本地**）
 *   ⑦ 同轮、服务端迭代更靠前 ⇒ GAP（补 `[mark.iter+1 .. live.iter]`）
 *   ⑧ 同轮、一致/本地领先 ⇒ NONE
 *   ⑨ 快照拿不到（弱网/旧服务端）⇒ NONE（不重历史）
 *
 * ⛔ mutation 自证：
 *   · 把 ⑦ 改成 RELOAD ⇒ ⑦ 红（把"补洞"退化成"整表重载"= 用户明令禁止的打补丁形态）；
 *   · 把 ⑤ 改成 NONE ⇒ ⑤ 红（换轮不重载 = 本次 bug 的原形）；
 *   · 删掉 ① ⇒ ① 红（服务端唯一权威信号被吞）。
 */
declare const process: { exit: (c: number) => void };

import {
  RESUME_GAP, RESUME_NONE, RESUME_RELOAD, ResumeLive, ResumeMark, ResumeVerdict, resumeVerdict,
} from '../../entry/src/main/ets/core/resume';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function mark(turnID: number, iter: number): ResumeMark {
  const m = new ResumeMark();
  m.turnID = turnID;
  m.iter = iter;
  m.atMs = 1;
  return m;
}
function live(turnID: number, iter: number, active: boolean, resync: boolean = false): ResumeLive {
  return { turnID, iter, active, resyncRequired: resync } as ResumeLive;
}

// ① 服务端要求重载（最高优先级，即使一切看起来一致）
{
  const v: ResumeVerdict = resumeVerdict(mark(3, 5), live(3, 5, true, true), 3);
  eq('① resync_required ⇒ RELOAD', v.action, RESUME_RELOAD);
  eq('① 原因 = server-resync-required', v.reason, 'server-resync-required');
}

// ② 没有基线
{
  const v: ResumeVerdict = resumeVerdict(null, live(3, 5, true), 3);
  eq('② 无基线 ⇒ NONE（不拿被污染的本地状态冒充基线）', v.action, RESUME_NONE);
  eq('② 原因 = no-baseline', v.reason, 'no-baseline');
}

// ③ 后台期间回合跑完（基线有回合、服务端明确无在飞）
{
  const v: ResumeVerdict = resumeVerdict(mark(3, 5), live(3, 5, false), 3);
  eq('③ 基线有在飞、回前台已无在飞 ⇒ RELOAD（跑完了）', v.action, RESUME_RELOAD);
  eq('③ 原因 = run-ended-while-away', v.reason, 'run-ended-while-away');
}

// ④ 本来就空闲
{
  const v: ResumeVerdict = resumeVerdict(mark(0, 0), live(0, 0, false), 3);
  eq('④ 基线无回合 + 服务端无在飞 ⇒ NONE', v.action, RESUME_NONE);
  eq('④ 原因 = idle', v.reason, 'idle');
}

// ⑤ 换轮（服务端更快）= 本次 bug 原形
{
  const v: ResumeVerdict = resumeVerdict(mark(3, 2), live(4, 1, true), 3);
  eq('⑤ 换轮且服务端更靠前 ⇒ RELOAD', v.action, RESUME_RELOAD);
  eq('⑤ 原因 = turn-advanced', v.reason, 'turn-advanced');
}

// ⑥ 换轮但本地更靠前（快照滞后）⇒ 绝不反向清本地
{
  const v: ResumeVerdict = resumeVerdict(mark(5, 2), live(4, 9, true), 5);
  eq('⑥ 本地领先 ⇒ NONE', v.action, RESUME_NONE);
  eq('⑥ 原因 = local-ahead', v.reason, 'local-ahead');
}

// ⑦ 同轮落后 ⇒ 补洞（区间含端点）
{
  const v: ResumeVerdict = resumeVerdict(mark(3, 4), live(3, 9, true), 3);
  eq('⑦ 同轮落后 ⇒ GAP', v.action, RESUME_GAP);
  eq('⑦ 补洞区间 from = mark.iter + 1', v.fromIter, 5);
  eq('⑦ 补洞区间 to = live.iter', v.toIter, 9);
  // 基线 iter=0（刚 turn_started 就转后台）⇒ 从第 1 个迭代补
  const v2: ResumeVerdict = resumeVerdict(mark(3, 0), live(3, 2, true), 3);
  eq('⑦ 基线 iter=0 ⇒ from=1', v2.fromIter, 1);
  eq('⑦ 基线 iter=0 ⇒ to=2', v2.toIter, 2);
}

// ⑧ 一致 / 本地领先
{
  eq('⑧ 完全一致 ⇒ NONE', resumeVerdict(mark(3, 9), live(3, 9, true), 3).action, RESUME_NONE);
  eq('⑧ 本地迭代更靠前（快照滞后）⇒ NONE',
    resumeVerdict(mark(3, 12), live(3, 9, true), 3).action, RESUME_NONE);
}

// ⑨ 快照拿不到
{
  const v: ResumeVerdict = resumeVerdict(mark(3, 4), null, 3);
  eq('⑨ 无快照 ⇒ NONE（不重历史）', v.action, RESUME_NONE);
  eq('⑨ 原因 = no-snapshot', v.reason, 'no-snapshot');
}

// 元判据：GAP 必须真的给出可用区间（防"给了 GAP 但区间为空"⇒ 补洞静默失败）
{
  const v: ResumeVerdict = resumeVerdict(mark(3, 4), live(3, 5, true), 3);
  ok('GAP 区间非空（to >= from）', v.action === RESUME_GAP && v.toIter >= v.fromIter);
}

console.log(`resume_verdict: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
