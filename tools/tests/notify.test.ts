/**
 * 通知判定门禁 —— `core/notify.ets` 的**纯判定**部分（脱机可跑，不碰 SDK）。
 *
 * 守护的不变量：
 *   · **前台抑制**：用户在看着屏幕时绝不打扰（`shouldNotify(true, *) === false`）；
 *   · **只提醒两类**：需要用户回答（`ask_user`）与回合结束（`phase_done` / session idle），
 *     其余事件（含 heartbeat / 普通 iteration / session busy）一律不发 —— 少发是特性；
 *   · **判据同源**：回合结束取 `normalizeEvent` 产出的 `phase_done`，不另立一套判断；
 *   · **同一回合只提醒一次**：phase_done 与 session idle 会先后到达 ⇒ 去重窗口生效；
 *   · **文案兜底**：无细节时给默认文案，超长截断（通知正文有系统上限）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  NOTIFY_ID_FALLBACK,
  NOTIFY_ID_MAX,
  NOTIFY_KIND_ASK,
  NOTIFY_KIND_NONE,
  NOTIFY_KIND_TURN_DONE,
  TURN_DONE_DEDUPE_MS,
  badgeFor,
  fnv1a32,
  notificationIdFor,
  notificationIdFromHash,
  notifyBody,
  notifyKindForSse,
  notifyTitle,
  shouldNotify,
  withinDedupeWindow,
} from '../../entry/src/main/ets/core/notify';
import type { DomainEvent } from '../../entry/src/main/ets/core/chat_types_full';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function phaseDone(): readonly DomainEvent[] {
  return [{ type: 'phase_done', turnID: null, seq: null } as DomainEvent];
}
function iteration(): readonly DomainEvent[] {
  return [{ type: 'iteration', turnID: null, seq: null, iteration: 1, tools: [] } as unknown as DomainEvent];
}

// ── shouldNotify：前台抑制 + 只提醒两类 ─────────────────────────────────────
eq('前台 + 待回答 ⇒ 不发（抑制）', shouldNotify(true, NOTIFY_KIND_ASK), false);
eq('前台 + 回合结束 ⇒ 不发（抑制）', shouldNotify(true, NOTIFY_KIND_TURN_DONE), false);
eq('后台 + 待回答 ⇒ 发', shouldNotify(false, NOTIFY_KIND_ASK), true);
eq('后台 + 回合结束 ⇒ 发', shouldNotify(false, NOTIFY_KIND_TURN_DONE), true);
eq('后台 + 无档位 ⇒ 不发', shouldNotify(false, NOTIFY_KIND_NONE), false);
eq('后台 + 未知档位 ⇒ 不发（白名单，不是黑名单）', shouldNotify(false, 'some_new_event'), false);
eq('前台 + 未知档位 ⇒ 不发', shouldNotify(true, 'some_new_event'), false);

// ── notifyKindForSse：SSE 事件 → 档位 ───────────────────────────────────────
eq('ask_user ⇒ 待回答', notifyKindForSse('ask_user', '', null), NOTIFY_KIND_ASK);
eq('phase_done（归一化事件）⇒ 回合结束', notifyKindForSse('progress_structured', '', phaseDone()), NOTIFY_KIND_TURN_DONE);
eq('session idle ⇒ 回合结束', notifyKindForSse('session', 'idle', null), NOTIFY_KIND_TURN_DONE);
eq('session agent-idle ⇒ 回合结束', notifyKindForSse('session', 'agent-idle', null), NOTIFY_KIND_TURN_DONE);
eq('session busy ⇒ 不发（回合才开始）', notifyKindForSse('session', 'busy', null), NOTIFY_KIND_NONE);
eq('session 其他 action ⇒ 不发', notifyKindForSse('session', 'history_rewound', null), NOTIFY_KIND_NONE);
eq('普通 iteration ⇒ 不发', notifyKindForSse('progress_structured', '', iteration()), NOTIFY_KIND_NONE);
eq('heartbeat ⇒ 不发', notifyKindForSse('heartbeat', '', null), NOTIFY_KIND_NONE);
eq('无归一化结果 + 非 session ⇒ 不发', notifyKindForSse('progress_structured', '', null), NOTIFY_KIND_NONE);
eq('ask_user 优先于其他判据', notifyKindForSse('ask_user', 'idle', phaseDone()), NOTIFY_KIND_ASK);

// ── 去重窗口：同一回合的多个结束信号只提醒一次 ──────────────────────────────
eq('从没提醒过 ⇒ 不抑制', withinDedupeWindow(1000000, 0, TURN_DONE_DEDUPE_MS), false);
eq('1 秒前提醒过（窗口内）⇒ 抑制', withinDedupeWindow(1000000, 999000, TURN_DONE_DEDUPE_MS), true);
eq('恰好窗口处 ⇒ 不抑制', withinDedupeWindow(1000000, 1000000 - TURN_DONE_DEDUPE_MS, TURN_DONE_DEDUPE_MS), false);
eq('超过窗口 ⇒ 不抑制（新的回合该提醒）', withinDedupeWindow(1000000, 900000, TURN_DONE_DEDUPE_MS), false);

// ── 文案（纯函数）──────────────────────────────────────────────────────────
eq('标题带会话名', notifyTitle(NOTIFY_KIND_ASK, '新会话'), '需要你的回答 · 新会话');
eq('标题无会话名 ⇒ 只留主标题', notifyTitle(NOTIFY_KIND_TURN_DONE, ''), '回合已完成');
eq('标题会话名只有空白 ⇒ 只留主标题', notifyTitle(NOTIFY_KIND_TURN_DONE, '   '), '回合已完成');
eq('正文用细节', notifyBody(NOTIFY_KIND_ASK, '今天几号？'), '今天几号？');
eq('正文无细节 + 待回答 ⇒ 默认文案', notifyBody(NOTIFY_KIND_ASK, ''), '智能体在等待你的输入');
eq('正文无细节 + 回合结束 ⇒ 默认文案', notifyBody(NOTIFY_KIND_TURN_DONE, '  '), '本轮回复已完成');
eq('正文超长截断（120 + 省略号）',
  notifyBody(NOTIFY_KIND_ASK, 'x'.repeat(200)).length, 121);
eq('正文截断保留前 120 字符',
  notifyBody(NOTIFY_KIND_ASK, 'x'.repeat(200)), `${'x'.repeat(120)}…`);

// ── 通知 id 派生：哈希与 id（波3：多会话提醒并存，不再互相覆盖）──────────────

/** 教科书 FNV-1a 32 位（用 `Math.imul`）—— 只作**对拍基准**，node 里必然存在。 */
function fnv1a32Reference(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = h ^ text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const HASH_SAMPLES: string[] = [
  '', 'a', 'ab', 'chat-1', 'chat-2', 'web:chat_1730000000_abcd',
  'oc_9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c', '会话一', '🙂', 'x'.repeat(500),
  'turn_id=42', 'A', 'aa', 'aab', 'zzzzzzzzzz',
];
for (let i = 0; i < HASH_SAMPLES.length; i++) {
  const s = HASH_SAMPLES[i];
  eq(`fnv1a32 与教科书实现逐字节一致: ${JSON.stringify(s.length > 12 ? `${s.substring(0, 12)}…(${s.length})` : s)}`,
    fnv1a32(s), fnv1a32Reference(s));
}
eq('fnv1a32 空串 = offset basis', fnv1a32(''), 0x811c9dc5);
eq('fnv1a32 确定性（同输入两次相同）', fnv1a32('chat-1'), fnv1a32('chat-1'));
eq('fnv1a32 输出落在 32 位无符号', fnv1a32('🙂聊天') >= 0 && fnv1a32('🙂聊天') <= 0xFFFFFFFF, true);

// notificationIdFromHash：非负、避开 0 与回落 id、不越界
eq('哈希 0 ⇒ 让开为 1（0 是 SDK 默认值）', notificationIdFromHash(0), 1);
eq('哈希 = 回落 id ⇒ 让开 +1', notificationIdFromHash(NOTIFY_ID_FALLBACK), NOTIFY_ID_FALLBACK + 1);
eq('哈希 = 上界 ⇒ 原样', notificationIdFromHash(NOTIFY_ID_MAX), NOTIFY_ID_MAX);
eq('哈希负数（-1）⇒ 取低 31 位 = 上界', notificationIdFromHash(-1), NOTIFY_ID_MAX);
eq('哈希 = 0xFFFFFFFF ⇒ 低 31 位 = 上界', notificationIdFromHash(0xFFFFFFFF), NOTIFY_ID_MAX);
eq('回落 id 前一格不动它', notificationIdFromHash(NOTIFY_ID_FALLBACK - 1), NOTIFY_ID_FALLBACK - 1);
eq('普通哈希原样（0x1234）', notificationIdFromHash(0x1234), 0x1234);
eq('回落 id 是合法 id（≥1 且 ≤ 上界）',
  NOTIFY_ID_FALLBACK >= 1 && NOTIFY_ID_FALLBACK <= NOTIFY_ID_MAX, true);

// notificationIdFor：确定性（同会话 ⇒ 同 id ⇒ 更新而非堆叠）
eq('同一会话 id 稳定', notificationIdFor('chat-1'), notificationIdFor('chat-1'));
eq('空 chat_id ⇒ 回落 id', notificationIdFor(''), NOTIFY_ID_FALLBACK);
eq('同一会话（重复调用 3 次）恒定', [0, 1, 2].map(() => notificationIdFor('web:oc_a1b2c3')).join(','),
  [notificationIdFor('web:oc_a1b2c3'), notificationIdFor('web:oc_a1b2c3'), notificationIdFor('web:oc_a1b2c3')].join(','));
eq('不同会话 ⇒ 不同 id（样本 200 个全不撞）', (() => {
  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) { seen.add(notificationIdFor(`chat-${i}`)); }
  return seen.size;
})(), 200);
eq('所有派生 id 都在 [1, 上界]（非负、不越界、不为 0）', (() => {
  for (let i = 0; i < 200; i++) {
    const id = notificationIdFor(`c${i}`);
    if (!(id >= 1 && id <= NOTIFY_ID_MAX)) { return `bad:${id}`; }
  }
  return 'ok';
})(), 'ok');
eq('非 ASCII chat_id 也能派生（OC id / 中文）',
  notificationIdFor('oc_9f8a7b6c') !== NOTIFY_ID_FALLBACK, true);

// badgeFor：角标 = 未读提醒条数
eq('badgeFor(0) = 0', badgeFor(0), 0);
eq('badgeFor(负数) = 0', badgeFor(-3), 0);
eq('badgeFor(3) = 3', badgeFor(3), 3);
eq('badgeFor(2.7) 取整 = 2', badgeFor(2.7), 2);

// ── 组合：判据链路（事件 → 档位 → 是否发）──────────────────────────────────
function decide(appForeground: boolean, event: string, sessionAction: string, evs: readonly DomainEvent[] | null): boolean {
  return shouldNotify(appForeground, notifyKindForSse(event, sessionAction, evs));
}
eq('组合：后台 + phase_done ⇒ 发', decide(false, 'progress_structured', '', phaseDone()), true);
eq('组合：前台 + phase_done ⇒ 不发', decide(true, 'progress_structured', '', phaseDone()), false);
eq('组合：后台 + session busy ⇒ 不发', decide(false, 'session', 'busy', null), false);

if (fail > 0) { console.log(`  notify: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  notify: ${pass} passed, 0 failed`);
process.exit(0);
