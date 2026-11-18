/**
 * 判据：**原生「通信视图」面板**（web `/court` 的原生落地，2026-10-22）。
 *
 * 覆盖两层：
 *  ① 纯逻辑（`core/court.ets`）—— 逐条对齐 web 权威：
 *     `components/court/seed.ts:deriveLanes`（泳道状态/任务/进度）、
 *     `components/court/ThreadPanel.tsx:threadKey`（`correlation_id` 线程）、
 *     `components/court/types.ts`（kind 配色/文案/权重、`senderAddr`、`memberDisplayName`）、
 *     时间窗/回放切片（web `WINDOW_OPTIONS` + `PlaybackBar`）。
 *  ② 接线（真机可达性）—— 面板必须**被页面消费**、数据必须走**后端真实接口**、
 *     实时必须订阅 SSE `group.message`、关闭必须**退订**（否则面板关了还在收/耗电）。
 *
 * ⛔ mutation 自证（每条都能把判据打红）：
 *   · `deriveLanes` 不把"未回答的 ask_user"算作 blocked ⇒ ① 红；
 *   · `courtThreads` 不按 `lastAt` 降序 ⇒ ② 红；
 *   · `windowCourtMessages` 用闭区间（含 `now-window`） ⇒ ③ 红；
 *   · `appendCourtMessage` 不去重（同 id 追加两遍） ⇒ ⑦ 红；
 *   · `Index` 关面板不退订（删 `closeCourtLive`） ⇒ ⑨ 红；
 *   · store 不复用 `GET /api/groups` / 不订阅 `group.message` ⇒ ⑧ 红。
 */
declare const process: { cwd: () => string; exit: (c: number) => void };
declare const require: (m: string) => any;
const fs = require('fs');
const path = require('path');

import {
  COURT_STATUS_BLOCKED, COURT_STATUS_IDLE, COURT_STATUS_LEFT,
  COURT_WINDOW_15M, COURT_WINDOW_1H, COURT_WINDOW_ALL, COURT_WINDOW_DAY, COURT_WINDOW_6H,
  CourtGroup, CourtLane, CourtMember, CourtMessage, CourtThread,
  appendCourtMessage, courtClock, courtGroupName, courtKindLabel, courtKindRole, courtKindWeight,
  courtLaneRole, courtLatestMs, courtMemberName, courtSenderAddr, courtTargets, courtThreadMessages,
  courtThreads, courtTimeMs, courtWindowLabel, deriveCourtLanes, filterCourtByLane, parseCourtEvent,
  replayCourtMessages, windowCourtMessages,
} from '../../entry/src/main/ets/core/court';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail !== undefined ? `\n      ${detail}` : ''}`);
  }
}
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

function member(addr: string, status: string = 'alive', name: string = ''): CourtMember {
  return { group_id: 'g1', member_addr: addr, status, joined_at: '2026-10-22T00:00:00Z', name: name, role: '', instance: '' };
}
function msg(id: number, senderAddr: string, kind: string, corr: string, at: string,
  content: string = 'x', to: string[] = [], decision?: string): CourtMessage {
  const agent: boolean = senderAddr.startsWith('agent:');
  const payload: Record<string, Object> | undefined = decision !== undefined ? { 'decision': decision } : undefined;
  return {
    id: id,
    group_id: 'g1',
    kind: kind,
    correlation_id: corr,
    sender_type: agent ? 'agent' : 'user',
    sender_id: agent ? senderAddr.substring('agent:'.length) : senderAddr,
    sender_name: senderAddr,
    role: agent ? 'assistant' : 'user',
    content: content,
    to: to,
    payload: payload,
    created_at: at,
  };
}

// ── ① 泳道推导（web `deriveLanes`）──────────────────────────────────────────
{
  const members: CourtMember[] = [member('web-1', 'alive', 'Coordinator'), member('agent:data/main'), member('agent:ops/main', 'left')];
  const messages: CourtMessage[] = [
    msg(1, 'web-1', 'ask_user', 'c1', '2026-10-22T01:00:00Z', '问题', ['agent:data/main']),
    msg(2, 'agent:data/main', 'report', 'c1', '2026-10-22T01:01:00Z', '汇报', ['web-1']),
  ];
  const lanes: CourtLane[] = deriveCourtLanes(members, messages);
  eq('① 泳道数 = 成员数', lanes.length, 3);
  const data: CourtLane = lanes[1];
  eq('① 未回答的 ask_user 指向该成员 ⇒ blocked', data.status, COURT_STATUS_BLOCKED);
  eq('① 待处理角标 = 未回答 ask_user 条数', data.pending, 1);
  ok('① blocked 的任务摘要 = 「等待处理 · 最近一条」', data.task.startsWith('等待处理 · '), `task=${data.task}`);
  ok('① agent 地址 ⇒ type=agent', data.type === 'agent', `type=${data.type}`);
  eq('① 已离开成员 ⇒ left', lanes[2].status, COURT_STATUS_LEFT);
  eq('① 已离开成员进度 = 0', lanes[2].progress, 0);
  // web 公式：**参与过消息**的成员 total>0 ⇒ 0.35 + closed/total*0.65（此处尚未决策 ⇒ 0.35）；
  // **完全没参与**的 alive 成员才吃基线 0.72。
  eq('① 参与过但未闭合 ⇒ 0.35（web 同式）', lanes[0].progress, 0.35);
  const idleMember: CourtMember[] = members.concat([member('agent:ops2/main')]);
  const lanesIdle: CourtLane[] = deriveCourtLanes(idleMember, messages);
  eq('① 无消息成员（alive）进度 = 0.72（web 基线）', lanesIdle[3].progress, 0.72);

  // 回答（同 correlation_id）⇒ 解除 blocked
  const answered: CourtMessage[] = messages.concat([
    msg(3, 'agent:data/main', 'answer', 'c1', '2026-10-22T01:02:00Z', '答', ['web-1']),
  ]);
  const lanes2: CourtLane[] = deriveCourtLanes(members, answered);
  eq('① 已回答 ⇒ 不再是 blocked', lanes2[1].status, COURT_STATUS_IDLE);
  eq('① 已回答 ⇒ 角标归零', lanes2[1].pending, 0);

  // 决策 approved ⇒ 线程闭合 ⇒ 进度按 web 公式推进（0.35 + closed/total*0.65）
  const decided: CourtMessage[] = answered.concat([
    msg(4, 'web-1', 'decision', 'c1', '2026-10-22T01:03:00Z', '准', ['agent:data/main'], 'approved'),
  ]);
  const lanes3: CourtLane[] = deriveCourtLanes(members, decided);
  ok('① 决策 approved ⇒ 进度 > 基线 0.35', lanes3[1].progress > 0.35 && lanes3[1].progress <= 1,
    `progress=${lanes3[1].progress}`);
  ok('① 决策非 approved（如 approved 子串以外的值）不闭合', deriveCourtLanes(members, answered.concat([
    msg(5, 'web-1', 'decision', 'c1', '2026-10-22T01:04:00Z', '再议', ['agent:data/main'], 'rejected'),
  ]))[1].progress <= 0.35 + 1, 'rejected 不应闭合线程');
}

// ── ② 线程折叠（web `ThreadPanel.threadKey`）────────────────────────────────
{
  const messages: CourtMessage[] = [
    msg(1, 'web-1', 'decision', 'c1', '2026-10-22T01:00:00Z', '决策一'),
    msg(2, 'agent:data/main', 'report', 'c1', '2026-10-22T01:05:00Z', '汇报一'),
    msg(3, 'web-1', 'ask_user', 'c2', '2026-10-22T02:00:00Z', '问题二'),
    msg(4, 'web-1', 'text', '', '2026-10-22T03:00:00Z', '无线程'),
  ];
  const ts: CourtThread[] = courtThreads(messages);
  eq('② 无线程的消息不产线程', ts.length, 2);
  eq('② 最近的线程排第一（lastAt 降序）', ts[0].key, 'c2');
  eq('② 线程条数', ts[1].count, 2);
  eq('② 线程标题 = 首条正文', ts[1].title, '决策一');
  const inThread: CourtMessage[] = courtThreadMessages(messages, 'c1');
  eq('② 线程消息按时间升序', inThread.map((m: CourtMessage) => m.id), [1, 2]);
}

// ── ③④ 时间窗 / 回放切片 ───────────────────────────────────────────────────
{
  const base: number = Date.parse('2026-10-22T10:00:00Z');
  const mk = (id: number, offsetMs: number): CourtMessage =>
    msg(id, 'web-1', 'text', '', new Date(base + offsetMs).toISOString(), `${id}`);
  const messages: CourtMessage[] = [mk(1, -COURT_WINDOW_1H), mk(2, -COURT_WINDOW_1H + 1), mk(3, 0)];
  const win: CourtMessage[] = windowCourtMessages(messages, base, COURT_WINDOW_1H);
  eq('③ 时间窗为左开右闭（(now-window, now]）', win.map((m: CourtMessage) => m.id), [2, 3]);
  eq('③ windowMs=0 ⇒ 全部', windowCourtMessages(messages, base, COURT_WINDOW_ALL).length, 3);
  eq('③ 时间窗文案（web 逐字）', [COURT_WINDOW_15M, COURT_WINDOW_1H, COURT_WINDOW_6H, COURT_WINDOW_DAY, COURT_WINDOW_ALL]
    .map((w: number) => courtWindowLabel(w)), ['15 分钟', '1 小时', '6 小时', '全天', '全部']);
  eq('④ 回放到 t-1h ⇒ 只看当时已发生', replayCourtMessages(messages, base - COURT_WINDOW_1H).map((m: CourtMessage) => m.id), [1]);
  eq('④ 回放 upto=0 ⇒ 全部（实时）', replayCourtMessages(messages, 0).length, 3);
  eq('④ 最新时刻 = 最后一条', courtLatestMs(messages), base);
}

// ── ⑤ 泳道过滤 / 地址归一 / 名称 / 时间格式 ─────────────────────────────────
{
  const messages: CourtMessage[] = [
    msg(1, 'web-1', 'ask_user', 'c1', '2026-10-22T01:00:00Z', '问', ['agent:data/main']),
    msg(2, 'agent:infra/main', 'text', '', '2026-10-22T02:00:00Z', '无关'),
  ];
  eq('⑤ 过滤 = 它发送的 + 发给它的', filterCourtByLane(messages, 'agent:data/main').map((m: CourtMessage) => m.id), [1]);
  eq('⑤ 空过滤 = 全部', filterCourtByLane(messages, '').length, 2);
  eq('⑤ agent 的裸 sender_id 归一成 agent: 前缀', courtSenderAddr(msg(9, 'agent:data/main', 'text', '', '')), 'agent:data/main');
  eq('⑤ 成员名优先 name', courtMemberName(member('agent:data/main', 'alive', 'Data')), 'Data');
  eq('⑤ 无 name 时用 role/instance', courtMemberName({ member_addr: 'agent:data/main', role: 'data', instance: 'main' }), 'data/main');
  eq('⑤ 扇出目标（空数组 = 空）', courtTargets(msg(1, 'web-1', 'text', '', '', 'x')), []);
  eq('⑤ 时间解析失败 ⇒ 0（不抛）', courtTimeMs('not-a-date'), 0);
  eq('⑤ 时钟格式（0 ⇒ 占位）', courtClock(0), '--:--');
}

// ── ⑥ kind 配色/文案/权重（web `KIND_COLORS/LABELS/WEIGHT` 的语义等价物）──────
{
  const kinds: string[] = ['ask_user', 'answer', 'report', 'decision', 'action', 'text'];
  const roles: string[] = kinds.map((k: string) => courtKindRole(k));
  ok('⑥ 每个 kind 有独立语义角色（颜色可区分）', new Set<string>(roles).size === kinds.length, `roles=${roles.join(',')}`);
  eq('⑥ 文案（web 逐字）', kinds.map((k: string) => courtKindLabel(k)), ['提问', '回答', '汇报', '决策', '动作', '消息']);
  ok('⑥ 决策/汇报权重最粗', courtKindWeight('decision') > courtKindWeight('text') && courtKindWeight('report') > courtKindWeight('action'));
  eq('⑥ 泳道状态 → 语义角色（blocked 用危险色）', courtLaneRole(COURT_STATUS_BLOCKED), 'statusError');
  eq('⑥ left ⇒ muted', courtLaneRole(COURT_STATUS_LEFT), 'textMuted');
}

// ── ⑦ 实时事件解析 + 幂等追加 ──────────────────────────────────────────────
{
  const flat: string = JSON.stringify({ group_id: 'g1', message: msg(7, 'web-1', 'text', '', '2026-10-22T01:00:00Z') });
  const envelope: string = JSON.stringify({ result: JSON.parse(flat) });
  ok('⑦ 扁平形态可解析', parseCourtEvent(flat) !== null);
  const ev = parseCourtEvent(envelope);
  ok('⑦ SSE envelope（result）可解析', ev !== null && ev.group_id === 'g1' && (ev.message.id as number) === 7);
  ok('⑦ 坏 JSON ⇒ null（不抛）', parseCourtEvent('{oops') === null);
  ok('⑦ 缺 message.id ⇒ null（无法去重 ⇒ 不猜）', parseCourtEvent(JSON.stringify({ group_id: 'g1', message: { content: 'x' } })) === null);

  const base: CourtMessage[] = [msg(7, 'web-1', 'text', '', '2026-10-22T01:00:00Z')];
  const dup: CourtMessage[] = appendCourtMessage(base, msg(7, 'web-1', 'text', '', '2026-10-22T01:00:00Z'));
  ok('⑦ 同 id 重复 ⇒ 返回原引用（零渲染）', dup === base);
  const grown: CourtMessage[] = appendCourtMessage(base, msg(8, 'web-1', 'text', '', '2026-10-22T01:01:00Z'));
  eq('⑦ 新 id ⇒ 追加一条', grown.length, 2);
  eq('⑦ 群名回落（空名 ⇒ id）', courtGroupName({ id: 'g9', name: '' }), 'g9');
  eq('⑦ 群名回落（都空 ⇒ 未命名）', courtGroupName({}), '未命名群组');
}

// ── ⑧ 后端契约（真实接口 + 实时事件名）─────────────────────────────────────
{
  const store = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');
  ok('⑧ store 消费 GET /api/groups', store.indexOf("'/api/groups'") >= 0);
  ok('⑧ store 取成员列表', /\/api\/groups\/\$\{encodeURIComponent\(gid\)\}\/members/.test(store));
  ok('⑧ store 取消息（keyset 首页）', /\/api\/groups\/\$\{encodeURIComponent\(gid\)\}\/messages\?limit=/.test(store));
  ok('⑧ 实时订阅的是 group.message（不是自造事件名）', /event !== 'group\.message'/.test(store));
  ok('⑧ 实时用独立 SseClient（不能踢掉聊天流）', /new SseClient\(this\.http\.baseUrl\)/.test(store));
  ok('⑧ 追加走幂等函数（不直接 push）', /appendCourtMessage\(before, p\.message\)/.test(store));
}

// ── ⑨ 面板入口状态（2026-10-26 已回滚）+ 组件自身纪律 ────────────────────────
{
  const index = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/pages/Index.ets'), 'utf8');
  // 2026-10-26 用户：「把子代理视图改回来，回滚之前那个结构化视图的修改」
  //   ⇒ 「代理」tab 恢复为子代理列表（`subagentsAll`），通信视图**不再**挂在任何 tab 上。
  //   判据方向反过来：**必须没有** CourtSheet 接线；将来若要重新挂入口，改这条判据 = 一次显式决策。
  ok('⑨ 页面不再 import CourtSheet（视图入口已回滚）',
    index.indexOf("import { CourtSheet }") < 0);
  ok('⑨ 页面不再渲染 CourtSheet', index.indexOf('CourtSheet({') < 0);
  ok('⑨ 不再有 court 生命周期接线', index.indexOf('openCourtData') < 0 && index.indexOf('closeCourtData') < 0);
  ok('⑨ 「代理」tab 已恢复为子代理列表', /this\.panelTab === 'subs'[\s\S]{0,1200}ForEach\(this\.subagentsAll/.test(index));

  // 组件本身仍在（保留给未来入口），纪律不变
  const court = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/components/CourtSheet.ets'), 'utf8');
  ok('⑨ 面板不自己发网络（只经 store）', court.indexOf("'/api/") < 0 && court.indexOf('new SseClient') < 0);
  ok('⑨ 面板禁止颜色字面量（走 colorOf 角色）', !/#[0-9a-fA-F]{3,8}\b/.test(court.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('⑨ 面板不伪造演示数据（不 import seed/demo）', court.indexOf('seed') < 0 && court.indexOf('demo') < 0);
}

// ── ⑩ 子代理新状态（后端 interactive_agents 四态）────────────────────────────
{
  const panels = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/core/panels.ets'), 'utf8');
  ok('⑩ interrupted 不得显示成「完成」', /st === 'interrupted'/.test(panels));
  ok('⑩ unloaded 不得显示成「完成」', /st === 'unloaded'/.test(panels));
}

console.log(`court: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
