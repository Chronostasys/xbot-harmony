/**
 * 后台对账纯判定层测试（**判别力**）—— `core/reconcile.ets`。
 *
 * 判别力自证（改错必红；提交信息已写明）：
 *   · 去掉 `!memo.initialized` 闸              ⇒ '未立基线不判完成' 红（冷启动误报）
 *   · 去掉 ask 去重（`!== memo.lastAskId`）     ⇒ '同一 request_id 只提醒一次' 红
 *   · 去掉 `!next.busy`                        ⇒ '回合还在跑不提醒' 红
 *   · 把 `!== lastSeenTurnKey` 改成 `===`/去掉 ⇒ '没见过的已完成回合要提醒' 红（漏报）
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };

import {
  RECONCILE_NONE, RECONCILE_TURN_DONE, RECONCILE_ASK,
  RECONCILE_INTERVAL_MS, RECONCILE_WORK_ID, RECONCILE_ABILITY,
  RECONCILE_BACKOFF_FACTOR, RECONCILE_MAX_BACKOFF_STEPS, RECONCILE_GIVE_UP_FAILURES,
  reconcileIntervalMs, reconcileShouldGiveUp, ReconcileOutcome, nextFailureCount,
  MISSED_MAX_NAMED, MissedItem, MissedSummary, summarizeMissed,
  ReconcileMark, ReconcileMemo, ReconcileDecision,
  reconcileDecision, applyDecision, markSeen, turnKeyOf,
} from '../../entry/src/main/ets/core/reconcile';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── (a) 常量：节奏/标识必须与 spec 同源（改错 ⇒ 红）──────────────────────────────
eq('间隔 = 15 分钟', RECONCILE_INTERVAL_MS, 900000);
eq('workId = 1001', RECONCILE_WORK_ID, 1001);
eq('扩展名与 module.json5 逐字一致', RECONCILE_ABILITY, 'NotifyReconcileAbility');
ok('kind 三值互异', RECONCILE_NONE !== RECONCILE_TURN_DONE && RECONCILE_TURN_DONE !== RECONCILE_ASK
  && RECONCILE_NONE !== RECONCILE_ASK);

// ── (b) turnKeyOf：前台与扩展必须同源（对不上 ⇒ "见过没见过"永远失配）────────────
eq('turnKeyOf 正常', turnKeyOf('chat_A', 12), 'chat_A#12');
eq('lastSeq<=0 ⇒ 空（"还没有回合"）', turnKeyOf('chat_A', 0), '');
eq('chatId 空 ⇒ 空', turnKeyOf('', 12), '');
eq('chatId null/undefined 不抛', [turnKeyOf(null as unknown as string, 5), turnKeyOf(undefined as unknown as string, 5)],
  ['', '']);

// ── (c) ASK：新 request_id ⇒ 提醒；同一个只提醒一次 ──────────────────────────────
function memo0(): ReconcileMemo { return new ReconcileMemo(false, '', ''); }
const mAsk = memo0();
const askMark = new ReconcileMark(false, 'c#1', 'req-1', '', '');
const d1: ReconcileDecision = reconcileDecision(askMark, mAsk);
eq('新 ask ⇒ ASK', d1.kind, RECONCILE_ASK);
eq('ASK 带回 request_id（供去重落盘）', d1.askId, 'req-1');
applyDecision(mAsk, d1);
eq('⛔ 同一 request_id 再来 ⇒ 不提醒（去重）', reconcileDecision(askMark, mAsk).kind, RECONCILE_NONE);
eq('不同 request_id ⇒ 再提醒', reconcileDecision(new ReconcileMark(false, 'c#1', 'req-2', '', ''), mAsk).kind, RECONCILE_ASK);

// ── (d) TURN_DONE：**没见过的已完成回合**才提醒 ────────────────────────────────
const mSeen = new ReconcileMemo(true, 'c#7', '');
eq('⛔ 没见过的已完成回合 ⇒ 提醒（后台/被杀期间完成都靠这条）',
  reconcileDecision(new ReconcileMark(false, 'c#9', '', '', ''), mSeen).kind, RECONCILE_TURN_DONE);
eq('已见过的回合 ⇒ 不提醒（不重复打扰）',
  reconcileDecision(new ReconcileMark(false, 'c#7', '', '', ''), mSeen).kind, RECONCILE_NONE);
eq('回合还在跑（busy）⇒ 不提醒（等它跑完）',
  reconcileDecision(new ReconcileMark(true, 'c#9', '', '', ''), mSeen).kind, RECONCILE_NONE);
eq('还没有任何回合（turnKey 空）⇒ 不提醒',
  reconcileDecision(new ReconcileMark(false, '', '', '', ''), mSeen).kind, RECONCILE_NONE);

// ── (e) 冷启动闸：前台从没看过 ⇒ 不判"完成"（防把历史回合当刚完成）───────────────
eq('⛔ 未立基线 + 已完成 + 没见过 ⇒ NONE（冷启动误报防线）',
  reconcileDecision(new ReconcileMark(false, 'c#99', '', '', ''), memo0()).kind, RECONCILE_NONE);
eq('但**待答**不受该闸限制（用户要做动作，冷启动也该提醒）',
  reconcileDecision(new ReconcileMark(false, 'c#99', 'req-x', '', ''), memo0()).kind, RECONCILE_ASK);

// ── (f) 优先级：同一次快照里"新待答"优先于"回合完成"──────────────────────────────
eq('ASK 优先于 TURN_DONE',
  reconcileDecision(new ReconcileMark(false, 'c#9', 'req-new', '', ''), mSeen).kind, RECONCILE_ASK);

// ── (g) applyDecision：幂等落盘 ⇒ 第二次不再打扰 ────────────────────────────────
const m2 = new ReconcileMemo(true, 'c#1', '');
const dd: ReconcileDecision = reconcileDecision(new ReconcileMark(false, 'c#2', '', '', ''), m2);
eq('先判出 TURN_DONE', dd.kind, RECONCILE_TURN_DONE);
applyDecision(m2, dd);
eq('落盘后 lastSeenTurnKey 前移到该回合', m2.lastSeenTurnKey, 'c#2');
eq('再对同一快照 ⇒ NONE（幂等）', reconcileDecision(new ReconcileMark(false, 'c#2', '', '', ''), m2).kind, RECONCILE_NONE);
ok('applyDecision 把备忘标为已立基线', m2.initialized);

// ── (h) markSeen：前台"只记见过"，不产生任何提醒 ────────────────────────────────
const m3 = new ReconcileMemo(false, '', '');
markSeen(m3, new ReconcileMark(true, 'c#5', 'req-9', '', ''));
ok('markSeen 立基线', m3.initialized);
eq('markSeen 记下回合键', m3.lastSeenTurnKey, 'c#5');
eq('markSeen 记下 askId（前台已看到的问句不再由后台重复提醒）', m3.lastAskId, 'req-9');
eq('markSeen 的回合键生效：该回合完成时不提醒',
  reconcileDecision(new ReconcileMark(false, 'c#5', '', '', ''), m3).kind, RECONCILE_NONE);
eq('markSeen 不推进到空回合（不许把已有基线擦掉）', (() => {
  markSeen(m3, new ReconcileMark(false, '', '', '', ''));
  return m3.lastSeenTurnKey;
})(), 'c#5');

// ── (i) 周期 / 退避 / 放弃（纯策略；改坏必红）────────────────────────────────────
eq('无失败 ⇒ 基准 15min', reconcileIntervalMs(0), 900000);
eq('负数按 0 处理（不产生负间隔）', reconcileIntervalMs(-3), 900000);
eq('失败 1 次 ⇒ ×2', reconcileIntervalMs(1), 900000 * RECONCILE_BACKOFF_FACTOR);
eq('失败 2 次 ⇒ ×4', reconcileIntervalMs(2), 900000 * 4);
eq('⛔ 退避封顶（步数上限 ' + RECONCILE_MAX_BACKOFF_STEPS + ' ⇒ 不再无限拉长）',
  reconcileIntervalMs(99), 900000 * 8);
ok('间隔对失败次数**单调不减**', reconcileIntervalMs(0) <= reconcileIntervalMs(1)
  && reconcileIntervalMs(1) <= reconcileIntervalMs(3));
ok('⛔ 未达阈值不放弃（否则后台对账会被静默关掉）',
  !reconcileShouldGiveUp(RECONCILE_GIVE_UP_FAILURES - 1));
ok('达阈值 ⇒ 放弃', reconcileShouldGiveUp(RECONCILE_GIVE_UP_FAILURES));
eq('⛔ 成功 ⇒ 失败数归零（立即回到基准间隔）', nextFailureCount(4, new ReconcileOutcome(true, false)), 0);
eq('失败 ⇒ 失败数 +1', nextFailureCount(2, new ReconcileOutcome(false, false)), 3);
eq('首次失败（prev<=0）⇒ 1', nextFailureCount(0, new ReconcileOutcome(false, true)), 1);
eq('负 prev 不产生负值', nextFailureCount(-5, new ReconcileOutcome(false, false)), 1);

// ── (j) 漏通知摘要 summarizeMissed（任务A-⑤；改坏必红）────────────────────────────
eq('空输入 ⇒ count=0 且 text 空（调用方据此不发通知）', [summarizeMissed([]).count, summarizeMissed([]).text], [0, '']);
const s1: MissedSummary = summarizeMissed([new MissedItem('A', 'k1')]);
eq('一条 ⇒ count=1', s1.count, 1);
eq('点名该会话', s1.named, ['A']);
eq('正文含条数与会话名', s1.text, '有 1 条新消息（A）');
const s2: MissedSummary = summarizeMissed([new MissedItem('A', 'k1'), new MissedItem('B', 'k2')]);
eq('两条不同会话 ⇒ 都点名', s2.named, ['A', 'B']);
eq('两条 ⇒ 无“等”', s2.text, '有 2 条新消息（A、B）');
const s3: MissedSummary = summarizeMissed([new MissedItem('A', 'k1'), new MissedItem('B', 'k2'), new MissedItem('C', 'k3')]);
eq('⛔ 超过上限只点名前 N 个', s3.named.length, MISSED_MAX_NAMED);
eq('⛔ 其余用“等”收尾', s3.text, '有 3 条新消息（A、B 等）');
eq('⛔ 同一 turnKey 重复喂入 ⇒ 只算一次（对账可能重复读同一快照）',
  summarizeMissed([new MissedItem('A', 'k1'), new MissedItem('A', 'k1')]).count, 1);
eq('同名会话不重复点名（named 去重）',
  summarizeMissed([new MissedItem('A', 'k1'), new MissedItem('A', 'k2')]).named, ['A']);
eq('会话名相同但两条 ⇒ 仍计 2 条', summarizeMissed([new MissedItem('A', 'k1'), new MissedItem('A', 'k2')]).count, 2);
eq('无名字仍计数（宁可少点名不可少计数）',
  summarizeMissed([new MissedItem('', 'k1'), new MissedItem('', 'k2')]).text, '有 2 条新消息');
eq('turnKey 为空不参与去重（两条空键 = 两条）',
  summarizeMissed([new MissedItem('A', ''), new MissedItem('A', '')]).count, 2);

if (fail > 0) {
  console.log(`  reconcile: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  reconcile: ${pass} passed, 0 failed`);
process.exit(0);

// ⛔ `export {}` 让本文件成为 module（顶层声明收进模块作用域），避免与兄弟测试撞名。
export {};
