/**
 * 会话选择纯逻辑测试 —— "有些会话打不开（非 web channel）"的直接根因，必须有守护。
 *
 * 真机实证：切到标签为「我」的会话报
 *   HTTP 404: {"ok":false,"data":null,"error":{"code":"not_found","message":"session not found"}}
 * 原因：`/api/session-tree` 返回**所有渠道**的会话（含飞书 `oc_` 与 `ou_` 前缀的会话），而客户端曾把
 * `channel` 恒设为 'web' ⇒ 取非 web 会话必然 404。
 */
declare const process: { exit: (c: number) => void };

import {
  channelForChat, channelLabel, visibleRows, hiddenRowCount,
  MAX_ROWS_VISIBLE, DEFAULT_CHANNEL,
  canonicalChatId, hasChannelPrefix, sessionDisplayKey,
} from '../../entry/src/main/ets/core/sessionpick';
import { SessionItem } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const sessions: SessionItem[] = [
  { chat_id: 'chat_AAA', channel: 'web', label: 'web 会话' },
  { chat_id: 'oc_58ca927a', channel: 'feishu', label: '我' },
  { chat_id: 'ou_b90fbcfd', channel: 'feishu', label: '飞书私聊' },
  { chat_id: 'chat_NOCH' },                       // 缺 channel 字段
  { chat_id: 'chat_EMPTY', channel: '' },         // 空 channel
];

// ① 核心：飞书会话必须解析成 feishu（旧实现恒返回 'web' ⇒ 本组全红）
eq('web 会话 → web', channelForChat(sessions, 'chat_AAA'), 'web');
eq('飞书群会话 → feishu', channelForChat(sessions, 'oc_58ca927a'), 'feishu');
eq('飞书私聊 → feishu', channelForChat(sessions, 'ou_b90fbcfd'), 'feishu');
eq('缺 channel 字段 → 回落 web', channelForChat(sessions, 'chat_NOCH'), 'web');
eq('空 channel → 回落 web', channelForChat(sessions, 'chat_EMPTY'), 'web');
eq('未知会话 → 回落 web', channelForChat(sessions, 'chat_UNKNOWN'), 'web');
eq('默认渠道常量 = web', DEFAULT_CHANNEL, 'web');

// ── canonicalChatId / sessionDisplayKey（2026-10-13 服务端对照实验引入）────────────────
// 真缺陷背景：本仓 `store.currentChatId` 是**全键**（会话树 `is_current` 行的 `chat_id` 字段自带
// 渠道前缀，客户端原样收下），而服务端把会话键一律组装成 `channel + ":" + chat_id`（**期望裸 id**）
// ⇒ 出网变成 `web:web:chat_…`，落到**幽灵会话**。服务端对照实验（同会话两种形态直打）：
//   `/api/cron/list` 裸 ✅ / 全键 `null`；`/api/tasks/list` 裸 ✅ 真任务 / 全键 `[]`；
//   `/api/session/status` 裸 ✅ 正确 cwd+todos / 全键 空 todos + 默认 cwd。
// ⇒ 用户可见「定时/后台任务面板结构性永远空」（"任务管理做的很差"的真根因）。
eq('canonical: 全键 ⇒ 裸 id', canonicalChatId('web', 'web:chat_AAA'), 'chat_AAA');
eq('canonical: 已是裸 id ⇒ 原样', canonicalChatId('web', 'chat_AAA'), 'chat_AAA');
eq('canonical: 子代理（`/` 尾缀）同样剥前缀', canonicalChatId('web', 'web:chat_A/explore:x'), 'chat_A/explore:x');
eq('canonical: 已写坏的双前缀也收敛', canonicalChatId('web', 'web:web:chat_AAA'), 'chat_AAA');
eq('canonical: 非该渠道前缀不动', canonicalChatId('web', 'feishu:oc_1'), 'feishu:oc_1');
eq('canonical: id 里本就含冒号（web-1 形态）不动', canonicalChatId('web', 'web-1'), 'web-1');
eq('canonical: channel 空 ⇒ 原样', canonicalChatId('', 'web:chat_AAA'), 'web:chat_AAA');
eq('canonical: chatId 空 ⇒ 空', canonicalChatId('web', ''), '');
eq('display: 全键入参不双写', sessionDisplayKey('web', 'web:chat_AAA'), 'web:chat_AAA');
eq('display: 裸 id 入参补前缀', sessionDisplayKey('web', 'chat_AAA'), 'web:chat_AAA');
eq('hasChannelPrefix: 全键 ⇒ true', hasChannelPrefix('web', 'web:chat_AAA'), true);
eq('hasChannelPrefix: 裸 id ⇒ false', hasChannelPrefix('web', 'chat_AAA'), false);

// ② 渠道展示名（抽屉里标注来源）
eq('web 标签', channelLabel('web'), 'Web');
eq('feishu 标签', channelLabel('feishu'), '飞书');
eq('cli 标签', channelLabel('cli'), 'CLI');
eq('未知渠道原样显示', channelLabel('telegram'), 'telegram');
eq('空渠道不显示空串', channelLabel(''), '未知');

// ③ 行窗口（避免 List+ForEach 一次性构建全部行）
ok('上限常量 >0', MAX_ROWS_VISIBLE > 0);
eq('行不足时限 = 全部', visibleRows([1, 2, 3], 12).length, 3);
eq('超限时取末尾 N 行', visibleRows([1, 2, 3, 4, 5], 3), [3, 4, 5]);
eq('limit=0 视为不限制', visibleRows([1, 2, 3], 0).length, 3);
eq('被挡住的条数', hiddenRowCount(30, 12), 18);
eq('未超限时隐藏 0 条', hiddenRowCount(5, 12), 0);
eq('limit=0 时隐藏 0 条', hiddenRowCount(30, 0), 0);
eq('恰好相等时隐藏 0 条', hiddenRowCount(12, 12), 0);

if (fail > 0) { console.log(`  sessionpick: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  sessionpick: ${pass} passed, 0 failed`);
process.exit(0);
