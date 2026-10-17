/**
 * liveview —— HarmonyOS **实况窗**纯逻辑（`core/liveview.ets`）判别力测试。
 *
 * 判据分三组：
 *  ① 文案/格式化（`fmtClock`/`lvStatusWord`/`lvToolShort`）——**未知状态不许静默说成在执行**；
 *  ② 快照折叠（`liveViewSnapshotOf`）——结束态**不得携带内容**（否则 `stopLiveView` 会带上垃圾）；
 *  ③ **推送判据**（`shouldPushLiveView`）——尤其是"起/止恒推、不受节流影响"这条：
 *     实况窗该出现却没出现 / 该消失却挂着，都是用户可见事故（与 2026-10-16 的 pill 消失同族）。
 */
declare const process: { exit: (c: number) => void };

import {
  LiveViewInput, LiveViewSnapshot, fmtClock, liveViewSnapshotOf, lvStatusWord, lvToolShort,
  sameLiveView, shouldPushLiveView, LV_MIN_UPDATE_MS,
} from '../../entry/src/main/ets/core/liveview';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

console.log('\n▶ ① 文案与格式化');
eq('fmtClock(0) 空串（不显示）', fmtClock(0), '');
eq('fmtClock(-5) 空串', fmtClock(-5), '');
eq('fmtClock(65s) = 1:05', fmtClock(65000), '1:05');
eq('fmtClock(59s) = 0:59', fmtClock(59000), '0:59');
eq('fmtClock(3725s) = 1:02:05', fmtClock(3725000), '1:02:05');
eq('lvStatusWord running', lvStatusWord('running'), '正在执行');
eq('lvStatusWord pending（排队 ≠ 执行中）', lvStatusWord('pending'), '等待调度');
eq('lvStatusWord generating', lvStatusWord('generating'), '生成参数中');
eq('lvStatusWord error', lvStatusWord('error'), '失败');
eq('lvStatusWord 空 = 思考中', lvStatusWord(''), '思考中');
eq('⛔ 未知状态原样回退（不静默说成"执行中"）', lvStatusWord('weird_state'), 'weird_state');
eq('lvToolShort 剥到冒号', lvToolShort('Shell: sleep 90; echo DONE'), 'Shell');
eq('lvToolShort 无冒号原样', lvToolShort('WebSearch'), 'WebSearch');
eq('lvToolShort 空', lvToolShort(''), '');

console.log('\n▶ ② 快照折叠');
const mk = (busy: boolean, iteration: number, toolLabel: string, toolStatus: string,
  runes: number, startedAgoMs: number): LiveViewInput => {
  const i = new LiveViewInput();
  i.busy = busy; i.iteration = iteration; i.toolLabel = toolLabel; i.toolStatus = toolStatus;
  i.runes = runes; i.startedAtMs = startedAgoMs > 0 ? 1_000_000 - startedAgoMs : 0;
  return i;
};
const NOW = 1_000_000;
const idle: LiveViewSnapshot = liveViewSnapshotOf(mk(false, 3, 'Shell: x', 'running', 120, 65000), NOW);
ok('结束态 active=false', idle.active === false);
eq('⛔ 结束态不携带内容（title/line1/line2/capsule 全空）',
  [idle.title, idle.line1, idle.line2, idle.capsuleText], ['', '', '', '']);

const live: LiveViewSnapshot = liveViewSnapshotOf(mk(true, 3, 'Shell: sleep 90; echo DONE', 'running', 120, 65000), NOW);
eq('标题带真实耗时', live.title, 'xbot · 已用 1:05');
eq('第一行 = 轮次 + 在飞工具', live.line1, '第 3 轮迭代 · Shell: sleep 90; echo DONE');
eq('第二行 = 状态 + 字数', live.line2, '正在执行 · 已生成 120 字');
eq('胶囊 = 工具短名', live.capsuleText, 'Shell');

const noTool: LiveViewSnapshot = liveViewSnapshotOf(mk(true, 2, '', '', 0, 0), NOW);
eq('无工具：第一行只有轮次', noTool.line1, '第 2 轮迭代');
eq('无工具：第二行只有状态（无字数时不说"0 字"）', noTool.line2, '思考中');
eq('无工具：胶囊回退到轮次', noTool.capsuleText, '第 2 轮');
eq('无起始时刻：标题不带耗时', noTool.title, 'xbot');
const iter0: LiveViewSnapshot = liveViewSnapshotOf(mk(true, 0, '', '', 0, 0), NOW);
eq('迭代号未知 ⇒ 准备中', iter0.line1, '准备中');

console.log('\n▶ ③ 推送判据（起止恒推、内容节流）');
const s1: LiveViewSnapshot = liveViewSnapshotOf(mk(true, 1, '', '', 0, 0), NOW);
const s2: LiveViewSnapshot = liveViewSnapshotOf(mk(true, 2, '', '', 0, 0), NOW);
const s1b: LiveViewSnapshot = liveViewSnapshotOf(mk(true, 1, '', '', 0, 0), NOW);
const stop: LiveViewSnapshot = liveViewSnapshotOf(mk(false, 1, '', '', 0, 0), NOW);
ok('首帧（prev=null）必推', shouldPushLiveView(null, s1, NOW, NOW) === true);
ok('内容全等 ⇒ 不推', shouldPushLiveView(s1, s1b, NOW, NOW) === false);
ok('内容变 + 距上次 < 1s ⇒ 不推（节流）',
  shouldPushLiveView(s1, s2, NOW, NOW - (LV_MIN_UPDATE_MS - 1)) === false);
ok('内容变 + 距上次 ≥ 1s ⇒ 推',
  shouldPushLiveView(s1, s2, NOW, NOW - LV_MIN_UPDATE_MS) === true);
ok('⛔ 起（false→true）恒推：即使刚推送过（节流窗口内）',
  shouldPushLiveView(stop, s1, NOW, NOW) === true);
ok('⛔ 止（true→false）恒推：即使内容未变、节流窗口内',
  shouldPushLiveView(s1, stop, NOW, NOW) === true);
ok('真无关对照：节流窗口内、内容未变 ⇒ 不推（证明上两条不是恒真）',
  shouldPushLiveView(s1, s1b, NOW, NOW) === false);

console.log('\n▶ ④ sameLiveView 逐字段（mutation 形态：每个字段翻转都要能检出）');
const base: LiveViewSnapshot = liveViewSnapshotOf(mk(true, 1, 'Shell: a', 'running', 10, 1000), NOW);
const flip = (f: string): LiveViewSnapshot => {
  const c = new LiveViewSnapshot();
  c.active = base.active; c.title = base.title; c.line1 = base.line1;
  c.line2 = base.line2; c.capsuleText = base.capsuleText;
  if (f === 'active') { c.active = !c.active; }
  if (f === 'title') { c.title = c.title + 'X'; }
  if (f === 'line1') { c.line1 = c.line1 + 'X'; }
  if (f === 'line2') { c.line2 = c.line2 + 'X'; }
  if (f === 'capsuleText') { c.capsuleText = c.capsuleText + 'X'; }
  return c;
};
ok('同值 ⇒ true', sameLiveView(base, flip('none')) === true);
const fields: string[] = ['active', 'title', 'line1', 'line2', 'capsuleText'];
for (let i = 0; i < fields.length; i++) {
  ok(`字段 ${fields[i]} 变了必须检出`, sameLiveView(base, flip(fields[i])) === false);
}
ok('prev=null ⇒ false（未推过就不算相同）', sameLiveView(null, base) === false);

if (fail > 0) {
  console.log(`  liveview: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  liveview: ${pass} passed, 0 failed`);
process.exit(0);
