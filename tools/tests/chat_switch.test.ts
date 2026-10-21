/**
 * 会话切换（`POST /api/chats/{chatID}/switch`）契约门禁 —— `core/sessionops.ets` 的纯逻辑。
 *
 * 为什么必须有（真机 bug 复盘）：服务端 `handleSearch`（`web_api.go:1120`）搜的是
 *   `GetCurrentSession(senderID)`（`userCurrentSession[senderID]`），**不是**请求里带的会话。
 *   该 map 唯一写入点 = `handleChatSwitch`（`web_api.go:1459-1504`）。原生切会话若不发本请求
 *   ⇒ 服务端 active session 停在上一次（web/别人）设的会话 ⇒ **搜消息查错会话**（真机：抽屉搜
 *   `CI` 点「搜消息」⇒ 0 命中，而当前会话明明含 CI 文本）。本门禁钉死"路径 encode + channel 口径 + 响应解析"。
 *
 * 服务端契约（逐字核对）：
 *   · 路由 `web.go:946` → `handleChatSwitchPOST`（`web_rest.go:706-720`）：
 *     body `{channel}` → 转成 query（**在 URL 上发 `?channel=` 会被 body 重建覆盖**）。
 *   · `handleChatSwitch`（`web_api.go:1459-1504`）：channel 缺省 `web`（`:1475-1478`）；
 *     非 web 仅管理员（`:1481-1484`，本仓恒 admin）；返回 `{ok, chat_id, channel, todos}`（`:1503`）。
 *
 * mutation：路径不 encode / channel 缺省丢 / 失败当成功 → 必红。
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  chatSwitchPath,
  chatSwitchChannel,
  ChatSwitchResult,
  parseChatSwitch,
} from '../../entry/src/main/ets/core/sessionops';
import { ChannelReq } from '../../entry/src/main/ets/core/reqbody';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ═══ ① 路径：/api/chats/{encodeURIComponent(chatID)}/switch ══════════════════════════════
// mutation：把 `encodeURIComponent(chatID)` 换成裸 `chatID` ⇒ 含 `/`/空格/中文的用例必红。
eq('普通 chatID 路径', chatSwitchPath('Agent-calm-zephyr'), '/api/chats/Agent-calm-zephyr/switch');
eq('chatID 含斜杠 ⇒ encode 成 %2F', chatSwitchPath('a/b'), '/api/chats/a%2Fb/switch');
eq('chatID 含空格 ⇒ encode 成 %20', chatSwitchPath('hello world'), '/api/chats/hello%20world/switch');
eq('chatID 含中文 ⇒ encode', chatSwitchPath('会话1'), `/api/chats/${encodeURIComponent('会话1')}/switch`);
eq('chatID 含 ?#& ⇒ encode（防注入）', chatSwitchPath('x?y#z&w'), `/api/chats/${encodeURIComponent('x?y#z&w')}/switch`);
eq('含 `?` ⇒ 编码成 %3F（否则会被当 query 切断路由）', chatSwitchPath('a?b'), '/api/chats/a%3Fb/switch');

// ═══ ② channel 口径：空串 ⇒ `web`（镜像服务端缺省）════════════════════════════════════
// mutation：把 `channel.length > 0 ? channel : 'web'` 改成恒 `channel` ⇒ 空串用例必红。
eq('空 channel ⇒ web', chatSwitchChannel(''), 'web');
eq('web 原样', chatSwitchChannel('web'), 'web');
eq('非 web 原样（飞书）', chatSwitchChannel('feishu'), 'feishu');

// ═══ ③ 请求体形状：`{channel}`（服务端 handleChatSwitchPOST 读 body.channel）══════════════
eq('body 只有 channel 键', Object.keys(new ChannelReq('web')).sort(), ['channel']);
eq('body 字面量', JSON.stringify(new ChannelReq(chatSwitchChannel(''))), '{"channel":"web"}');

// ═══ ④ 响应解析：{ok, chat_id, channel, todos}；防御字段缺失/类型不符 ═══════════════════
// mutation：`todos` 不判 Array.isArray（给 `todos:"x"` 时返回 "x"）⇒ 必红。
const full = { ok: true, chat_id: 'Agent-calm-zephyr', channel: 'web', todos: [{ text: 'T', status: 'pending' }] };
const r: ChatSwitchResult = parseChatSwitch(full);
eq('ok=true 解析', r.ok, true);
eq('chat_id 解析', r.chatID, 'Agent-calm-zephyr');
eq('channel 解析', r.channel, 'web');
eq('todos 解析', r.todos, [{ text: 'T', status: 'pending' }]);
// 缺字段 / 类型不符 ⇒ 安全默认（绝不抛）
eq('无 todos ⇒ []', parseChatSwitch({ ok: true, chat_id: 'x', channel: 'web' }).todos, []);
eq('todos 非数组 ⇒ []', parseChatSwitch({ ok: true, todos: 'oops' }).todos, []);
eq('ok 非 true ⇒ false', parseChatSwitch({ ok: 'yes' }).ok, false);
eq('chat_id 非串 ⇒ 空', parseChatSwitch({ chat_id: 5 }).chatID, '');
eq('data=null ⇒ 全默认', parseChatSwitch(null as unknown as Object), { ok: false, chatID: '', channel: '', todos: [] });

console.log(fail === 0 ? `✅ chat_switch: ${pass} passed` : `❌ chat_switch: ${fail} failed / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);

export {};
