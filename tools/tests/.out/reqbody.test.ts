/**
 * 请求体**契约测试** —— 字段集必须与服务端结构逐字一致。
 *
 * 服务端 `decodeJSONBody` 是严格模式（DisallowUnknownFields）⇒ 多一个字段就 400。
 * 真机事故：/api/message 带了服务端不存在的 turn_id ⇒「你好」发不出去 + 约一半接口 400。
 * 这些断言就是那次事故的回归守卫。
 */
declare const process: { exit: (c: number) => void };

import {
  AskRespondReq, ChannelReq, CreateChatReq, CronRemoveReq, EmptyReq, ForkReq, FsListReq, HistoryReq,
  IterationDetailReq, LlmModelReq, MaxContextReq, MessageReq, QueueCancelReq, QueueReorderReq,
  RegionsReq, RenameReq, RpcReq, SearchReq, SessionReq, SettingsReq,
} from './reqbody';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
/** 把对象序列化成 JSON 后取键集（与真机发送完全同一路径）。 */
function keysOf(o: object): string[] {
  return Object.keys(JSON.parse(JSON.stringify(o)) as Record<string, unknown>).sort();
}

// ⛔ 最关键的回归守卫：/api/message 绝不能出现 turn_id（真机 400 的根因）
eq('消息体键集（无 turn_id）', keysOf(new MessageReq('web', 'c1', '你好')),
  ['channel', 'chat_id', 'content']);
// 客户端 requestID 必须能随请求体发出（服务端回声/回合据它把乐观行与回显收敛为
// 同一条 user 行 —— 缺它 = 真机「你好渲染两次」根因）。服务端 WSClientMessage 的
// `ID json:"id,omitempty"` 是合法字段，严格解码不拒。
eq('消息体：携带客户端 requestID（id）',
  keysOf(new MessageReq('web', 'c1', '你好', undefined, undefined, undefined, false, 'req-1')),
  ['channel', 'chat_id', 'content', 'id']);
eq('消息体：空 requestID 不发 id 字段',
  keysOf(new MessageReq('web', 'c1', '你好', undefined, undefined, undefined, false, '')),
  ['channel', 'chat_id', 'content']);
eq('消息体：无附件不出现 upload 字段',
  keysOf(new MessageReq('web', 'c1', 'hi', undefined, undefined, undefined, false)),
  ['channel', 'chat_id', 'content']);
eq('消息体：带附件',
  keysOf(new MessageReq('web', 'c1', 'hi', ['k1'], ['a.png'], [12], true)),
  ['channel', 'chat_id', 'content', 'file_names', 'file_sizes', 'interrupt', 'upload_keys']);
eq('消息体：带附件 + requestID',
  keysOf(new MessageReq('web', 'c1', 'hi', ['k1'], ['a.png'], [12], true, 'req-1')),
  ['channel', 'chat_id', 'content', 'file_names', 'file_sizes', 'id', 'interrupt', 'upload_keys']);

eq('会话体键集', keysOf(new SessionReq('web', 'c1')), ['channel', 'chat_id']);
eq('仅 channel 体', keysOf(new ChannelReq('web')), ['channel']);
eq('空体', keysOf(new EmptyReq()), []);
eq('历史体', keysOf(new HistoryReq('web', 'c1', 30, 0)), ['before_id', 'channel', 'chat_id', 'limit']);
eq('区域体', keysOf(new RegionsReq('web', 'c1', 3, 7, 100)),
  ['before_iteration', 'channel', 'chat_id', 'region_limit', 'turn_id']);
eq('迭代详情体', keysOf(new IterationDetailReq('web', 'c1', 3, 7)),
  ['channel', 'chat_id', 'iteration', 'turn_id']);
eq('AskUser 应答体', keysOf(new AskRespondReq('web', 'c1', 'q1', 'yes', {}, false)),
  ['answer', 'answers', 'cancelled', 'channel', 'chat_id', 'question_id']);
eq('队列取消体', keysOf(new QueueCancelReq('web', 'c1', 'm1')), ['channel', 'chat_id', 'msg_id']);
eq('队列排序体', keysOf(new QueueReorderReq('web', 'c1', ['a'])), ['channel', 'chat_id', 'msg_ids']);

// 搜索：服务端只认 query/limit（旧实现发 channel/chat_id/q ⇒ 400）
eq('搜索体键集', keysOf(new SearchReq('集群')), ['query']);
eq('搜索体带 limit', keysOf(new SearchReq('集群', 20)), ['limit', 'query']);

// 改名：chat_id 在路径上，body 只有 channel + label（旧实现多发 chat_id ⇒ 400）
eq('改名体键集', keysOf(new RenameReq('web', '新名字')), ['channel', 'label']);

// 建会话：服务端是 {label, subscription_id, model}（旧实现发 channel/chat_id ⇒ 400）
eq('建会话体：空', keysOf(new CreateChatReq()), []);
eq('建会话体：带名字', keysOf(new CreateChatReq('新会话')), ['label']);

eq('cron 删除体', keysOf(new CronRemoveReq('web', 'c1', 'j1')), ['channel', 'chat_id', 'job_id']);
eq('列目录体', keysOf(new FsListReq('/a')), ['path']);
eq('列目录体默认根', keysOf(new FsListReq('')), ['path']);
eq('RPC 体', keysOf(new RpcReq('runner_list')), ['method']);
eq('模型体', keysOf(new LlmModelReq('sub-a', 'm1')), ['model', 'sub_id']);
eq('上下文体', keysOf(new MaxContextReq(200000)), ['max_context']);
eq('分支体', keysOf(new ForkReq('web', 'c1', '分支')), ['label', 'source_channel', 'source_chat_id']);
eq('分支体无名字', keysOf(new ForkReq('web', 'c1')), ['source_channel', 'source_chat_id']);
eq('设置体', keysOf(new SettingsReq({})), ['settings']);

if (fail > 0) { console.log(`  reqbody: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  reqbody: ${pass} passed, 0 failed`);
process.exit(0);
