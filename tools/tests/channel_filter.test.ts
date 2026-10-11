/**
 * 渠道过滤（`core/sessionpick.ets`）的判别力测试。
 *
 * 逐字对齐 web `web/src/components/session/ChannelPicker.tsx:53 availableChannels`：
 *   · 渠道集合由会话列表推导（channel + parentChannel），**排除内部渠道 agent**；
 *   · 排序按 `ALL_CHANNEL_ORDER`，未知渠道排末尾（稳定 ⇒ 同秩保持首见顺序）；
 *   · 过滤只作用于列表视图，不改 `channelForChat` 的"按会话取渠道"语义（见 sessionpick 顶部事故说明）。
 */
declare const process: { exit: (c: number) => void };

import {
  availableChannels, channelFilterMatches, activeChannelLabel,
  ALL_CHANNEL_ORDER, INTERNAL_CHANNEL, sessionInChannel,
} from '../../entry/src/main/ets/core/sessionpick';
import { SessionItem } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 造一个会话行（可带服务端 `parent_channel` —— SessionItem 欠声明，用 as 绕过）。 */
function s(chatId: string, channel?: string, parentChannel?: string): SessionItem {
  const o: Record<string, unknown> = { chat_id: chatId };
  if (channel !== undefined) { o.channel = channel; }
  if (parentChannel !== undefined) { o.parent_channel = parentChannel; }
  return o as unknown as SessionItem;
}

// ① 顺序：web/cli/feishu/qq/napcat，未知排末尾
eq('顺序 + 未知渠道末位', availableChannels([
  s('a', 'napcat'), s('b', 'qq'), s('c', 'web'), s('d', 'feishu'), s('e', 'cli'), s('f', 'telegram'),
]), ['web', 'cli', 'feishu', 'qq', 'napcat', 'telegram']);

// ② ★ 排除内部渠道 agent（channel 与 parent_channel 两处都要排）
eq('排除 agent', availableChannels([s('a', 'web'), s('b', 'agent'), s('c', 'cli', 'agent')]),
  ['web', 'cli']);

// ③ 纳入 parent_channel（SubAgent 行父渠道也进候选）
eq('纳入 parent_channel', availableChannels([s('a', 'web', 'feishu')]), ['web', 'feishu']);

// ④ 去重
eq('同渠道多次出现只一次', availableChannels([s('a', 'web'), s('b', 'web'), s('c', 'feishu')]),
  ['web', 'feishu']);

// ⑤ 空输入 / 缺字段 / 空串
eq('空输入 ⇒ []', availableChannels([]), []);
eq('空串 channel 忽略', availableChannels([s('a'), s('b', '', 'feishu')]), ['feishu']);

// ⑥ 过滤判据：全部 / 单渠道 / 未知
eq('全部（空 active）匹配任意渠道', channelFilterMatches('feishu', ''), true);
eq('单渠道命中', channelFilterMatches('feishu', 'feishu'), true);
eq('单渠道不命中', channelFilterMatches('web', 'feishu'), false);
eq('未知渠道按原值筛出', channelFilterMatches('telegram', 'telegram'), true);
eq('未知 active 不命中已知渠道', channelFilterMatches('web', 'telegram'), false);

// ⑦ 展示名（复用 channelLabel）
eq('全部标签 = 全部', activeChannelLabel(''), '全部');
eq('web 标签', activeChannelLabel('web'), 'Web');
eq('飞书标签', activeChannelLabel('feishu'), '飞书');
eq('未知渠道原样显示', activeChannelLabel('telegram'), 'telegram');

// ⑧ 常量锁死（顺序表是排序依据）
eq('ALL_CHANNEL_ORDER', ALL_CHANNEL_ORDER, ['web', 'cli', 'feishu', 'qq', 'napcat']);
eq('INTERNAL_CHANNEL = agent', INTERNAL_CHANNEL, 'agent');

// ⑨ ★「会话属于哪个渠道」= channel ∪ parent_channel ∪ children.parent_channel
//    （web SessionSidebar.tsx:99-106）—— 只比自身 channel 会漏父子渠道 ⇒ 筛选出空列表。
function sess(o: Record<string, unknown>): SessionItem {
  return o as unknown as SessionItem;
}

// ① 有父渠道的子会话（自身 channel='agent'）出现在**父渠道**筛选结果里
eq('① 子会话归到父渠道（feishu）',
  sessionInChannel(sess({ chat_id: 'ag', channel: 'agent', parent_channel: 'feishu' }), 'feishu'), true);
// …但自身不是 feishu 会话 ⇒ 选别的渠道不出现
eq('① 子会话不归无关渠道',
  sessionInChannel(sess({ chat_id: 'ag', channel: 'agent', parent_channel: 'feishu' }), 'web'), false);

// ② children.parentChannel 链（递归，不只看直接子）
{
  const main: SessionItem = sess({
    chat_id: 'main', channel: 'web',
    children: [
      { chat_id: 'c1', channel: 'agent', parent_channel: 'web' },
      { chat_id: 'c2', channel: 'agent', parent_channel: 'feishu',
        children: [{ chat_id: 'c2g', channel: 'agent', parent_channel: 'qq' }] },
    ],
  });
  eq('② 直接子命中 feishu', sessionInChannel(main, 'feishu'), true);
  eq('② ★ 孙子的 parent_channel（qq）也命中', sessionInChannel(main, 'qq'), true);
  eq('② 自身渠道 web 命中', sessionInChannel(main, 'web'), true);
}

// ③ 不相关渠道仍被排除（防止"越修越宽"）
eq('③ 无关渠道被排除（自身 web）',
  sessionInChannel(sess({ chat_id: 'x', channel: 'web' }), 'feishu'), false);
eq('③ 无 children 的会话只认自身/父渠道',
  sessionInChannel(sess({ chat_id: 'y', channel: 'cli', parent_channel: 'web' }), 'feishu'), false);

// ④ 空 active = 全部；缺失渠道的会话在 active 非空时不命中（与 web 同）
eq('④ 空 active ⇒ 全部（缺失渠道也含）', sessionInChannel(sess({ chat_id: 'z' }), ''), true);
eq('④ 缺失渠道 + 指定 active ⇒ 不命中', sessionInChannel(sess({ chat_id: 'z' }), 'web'), false);

if (fail > 0) { console.log(`  channel_filter: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  channel_filter: ${pass} passed, 0 failed`);
process.exit(0);
