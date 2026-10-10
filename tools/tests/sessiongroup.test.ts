/**
 * 会话分组 / 分类 / 迁移 —— **判别力测试**（对应 core/sessiongroup.ets）。
 *
 * 权威基准：web `src/lib/session-grouping.ts`、`src/hooks/useSessionStore.ts:210-266`、
 * `src/components/session/SessionGroup.tsx:184-208`、`src/i18n/zh-CN.ts`。
 *
 * 判别力自证（改错任一"锚点" ⇒ 必红；提交信息里列明已实测）：
 *   · `timeBucket` 的 `>=` 改成 `>`            ⇒ '桶边界：今天 00:00:00.000 ⇒ today' 失败
 *   · `SESSION_CATEGORIES` 把 path 挪到末位     ⇒ '分类展示顺序 path 第一' 失败
 *   · path 组间排序去掉 `__unset__` 置后逻辑     ⇒ 'path 组键顺序…__unset__ 最后' 失败
 *   · `sortSessions` 把 `sb - sa` 改成 `sa - sb` ⇒ '星标浮到组内顶部' 失败
 *   · `normalizeSessionCategory` 去掉 time→path 迁移 ⇒ '老存储 time 一次性迁到 path' 失败
 *   · `groupSessions` 不过滤 SubAgent            ⇒ 'SubAgent 不进主分组' 失败
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };

import {
  GroupSession, SessionGroup,
  SESSION_CATEGORIES, SESSION_CATEGORY_PATH, SESSION_CATEGORY_STATUS, SESSION_CATEGORY_TIME,
  DEFAULT_SESSION_CATEGORY, UNSET_WORK_PATH, TIME_BUCKETS, STATUS_ORDER,
  isSessionCategory, normalizeSessionCategory, needsCategoryMigration, collapseKey,
  sessionKey, sameSession, parseAgentChatID, isSubAgentSession,
  timeBucket, pathBucket, sessionGroupKey, sortSessions, groupSessions,
  groupTitle, statusGroupKey, pathGroupTooltip, basename,
} from '../../entry/src/main/ets/core/sessiongroup';

// 顺带验证：新增的分类键真接上了「本地键 ↔ 服务端键」映射（web userSettings.ts:42）。
import { KEY_SESSION_CATEGORY, KEY_STARRED, serverKey, localKey } from '../../entry/src/main/ets/core/settings';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

/** 造一条会话（只写关心的字段，其余用类默认值）。 */
function mk(chatId: string, extra: Partial<GroupSession> = {}): GroupSession {
  const s = new GroupSession();
  s.chatId = chatId;
  Object.assign(s, extra);
  return s;
}
function keys(groups: SessionGroup[]): string[] { return groups.map((g) => g.key); }
function ids(g: SessionGroup): string[] { return g.sessions.map((s) => s.chatId); }

// ── (1) 分类常量与展示顺序 ────────────────────────────────────────────────────
eq('默认分类 = path（web DEFAULT_SESSION_CATEGORY）', DEFAULT_SESSION_CATEGORY, 'path');
eq('分类展示顺序 path 第一（web session-grouping.ts:72）', SESSION_CATEGORIES, ['path', 'status', 'time']);
eq('三个分类常量取值', [SESSION_CATEGORY_PATH, SESSION_CATEGORY_STATUS, SESSION_CATEGORY_TIME], ['path', 'status', 'time']);
eq('时间桶顺序', TIME_BUCKETS, ['today', 'yesterday', 'earlier']);
eq('状态组顺序（web STATUS_ORDER:143）', STATUS_ORDER,
  ['running', 'waiting_input', 'pending', 'unread', 'idle', 'error']);
eq('unset 组键名', UNSET_WORK_PATH, '__unset__');

eq('isSessionCategory 认识 path/status/time', [isSessionCategory('path'), isSessionCategory('status'), isSessionCategory('time')],
  [true, true, true]);
eq('isSessionCategory 拒绝脏值', [isSessionCategory('bogus' as never), isSessionCategory(undefined), isSessionCategory('')],
  [false, false, false]);

// ── (2) 分类归一 + 历史 time→path 一次性迁移（web useSessionStore.ts:212-234）────────
eq('归一：path 原样', normalizeSessionCategory('path', true), 'path');
eq('归一：status 原样', normalizeSessionCategory('status', true), 'status');
eq('归一：用户显式选的 time 被尊重（marker 已置位）', normalizeSessionCategory('time', true), 'time');
eq('归一：老存储 time（未迁移过）⇒ 迁到 path', normalizeSessionCategory('time', false), 'path');
eq('归一：未知值回落 path', normalizeSessionCategory('bogus', true), 'path');
eq('归一：缺失回落 path', normalizeSessionCategory(undefined, true), 'path');
eq('归一：migrated 默认 true ⇒ 不误迁显式 time', normalizeSessionCategory('time'), 'time');

eq('需要迁移写盘：time + 未迁移', needsCategoryMigration('time', false), true);
eq('不需要迁移写盘：time 已迁移', needsCategoryMigration('time', true), false);
eq('不需要迁移写盘：非 time', needsCategoryMigration('path', false), false);
eq('不需要迁移写盘：缺失', needsCategoryMigration(undefined, false), false);

// ── (3) 折叠键（web session-grouping.ts:89-91）───────────────────────────────
eq('折叠键带分类前缀', collapseKey('path', '/home/user/repo'), 'path:/home/user/repo');
eq('折叠键 time 桶', collapseKey('time', 'today'), 'time:today');
eq('同名组键跨分类不串味', collapseKey('path', 'today') === collapseKey('time', 'today'), false);

// ── (4) 会话身份 / SubAgent 判定（web session-grouping.ts:13-62）──────────────
eq('sessionKey 带渠道', sessionKey(mk('same', { channel: 'web' })), 'web:same');
eq('sessionKey 渠道缺失按 web', sessionKey(mk('x')), 'web:x');
ok('sameSession 同渠道同 id', sameSession(mk('a', { channel: 'cli' }), mk('a', { channel: 'cli' })));
eq('sameSession 跨渠道不同', sameSession(mk('a', { channel: 'cli' }), mk('a', { channel: 'web' })), false);
eq('sameSession 空值安全', sameSession(undefined, mk('a')), false);

eq('解析 TUI SubAgent 全键', ((): unknown => {
  const p = parseAgentChatID('cli:/repo:Agent-main/review:1');
  return p === undefined ? null : [p.parentChannel, p.parentChatID, p.role, p.instance];
})(), ['cli', '/repo:Agent-main', 'review', '1']);
eq('解析 web 交互式租户（无 instance）', ((): unknown => {
  const p = parseAgentChatID('web:chat_123/explore');
  return p === undefined ? null : [p.parentChannel, p.parentChatID, p.role, p.instance];
})(), ['web', 'chat_123', 'explore', '']);
eq('普通 CLI 路径会话解析不出 SubAgent', parseAgentChatID('/vePFS/x/y:Agent-warm-stone') === undefined, true);

eq('type=agent ⇒ SubAgent', isSubAgentSession(mk('a', { type: 'agent' })), true);
eq('有 parentChatId ⇒ SubAgent', isSubAgentSession(mk('a', { parentChatId: '/repo:main' })), true);
eq('agent 渠道 ⇒ SubAgent', isSubAgentSession(mk('cli:/repo:main/rev:1', { channel: 'agent' })), true);
eq('普通 CLI 路径会话不是 SubAgent',
  isSubAgentSession(mk('/vePFS/x/y:Agent-warm-stone', { channel: 'cli' })), false);

// ── (5) 时间分桶边界（web session-grouping.ts:149-161）──────────────────────
const startOfToday = new Date();
startOfToday.setHours(0, 0, 0, 0);
const startOfYesterday = new Date(startOfToday.getTime());
startOfYesterday.setDate(startOfYesterday.getDate() - 1);

eq('桶边界：今天 00:00:00.000 ⇒ today', timeBucket(startOfToday.toISOString()), 'today');
eq('桶边界：今天 00:00 前 1ms ⇒ yesterday', timeBucket(new Date(startOfToday.getTime() - 1).toISOString()), 'yesterday');
eq('桶边界：昨天 00:00:00.000 ⇒ yesterday', timeBucket(startOfYesterday.toISOString()), 'yesterday');
eq('桶边界：昨天 00:00 前 1ms ⇒ earlier', timeBucket(new Date(startOfYesterday.getTime() - 1).toISOString()), 'earlier');
eq('解析失败 ⇒ earlier', timeBucket('not-a-date'), 'earlier');
eq('空串 ⇒ earlier', timeBucket(''), 'earlier');

// ── (6) path 分组的组键（web session-grouping.ts:111-140）───────────────────
eq('显式 workDir 优先且去尾斜杠', pathBucket(mk('x', { channel: 'web', workDir: '/repo/' })), '/repo');
eq('根目录不去斜杠', pathBucket(mk('x', { channel: 'web', workDir: '/' })), '/');
eq('CLI chatID 抽目录', pathBucket(mk('/home/user/proj:sess', { channel: 'cli' })), '/home/user/proj');
eq('web 会话无 workDir ⇒ unset', pathBucket(mk('web-1', { channel: 'web' })), UNSET_WORK_PATH);
eq('SubAgent 继承父目录', pathBucket(mk('cli:/repo:s/review:1', {
  channel: 'agent', parentChatId: '/repo:s', parentChannel: 'cli',
})), '/repo');

// ── (7) 排序（web session-grouping.ts:174-192）──────────────────────────────
eq('星标优先，其余按 createdAt 升序', sortSessions([
  mk('a', { createdAt: '2026-06-26T08:00:00Z' }),
  mk('b', { createdAt: '2026-06-26T09:00:00Z' }),
  mk('c', { createdAt: '2026-06-26T07:00:00Z' }),
], ['web:a']).map((s) => s.chatId), ['a', 'c', 'b']);

eq('无星标 ⇒ createdAt 升序', sortSessions([
  mk('a', { createdAt: '2026-06-01T00:00:00Z' }),
  mk('b', { createdAt: '2026-06-02T00:00:00Z' }),
  mk('c', { createdAt: '2026-05-30T00:00:00Z' }),
], []).map((s) => s.chatId), ['c', 'a', 'b']);

eq('sortOrder>0 优先于 createdAt（升序）', sortSessions([
  mk('a', { createdAt: '2026-06-01T00:00:00Z', sortOrder: 3 }),
  mk('b', { createdAt: '2026-06-02T00:00:00Z', sortOrder: 1 }),
  mk('c', { createdAt: '2026-06-03T00:00:00Z', sortOrder: 2 }),
], []).map((s) => s.chatId), ['b', 'c', 'a']);

eq('sortOrder=0 的排在 sortOrder>0 之后、内部按 createdAt', sortSessions([
  mk('a', { createdAt: '2026-06-02T00:00:00Z' }),
  mk('b', { createdAt: '2026-06-01T00:00:00Z' }),
  mk('c', { createdAt: '2026-06-03T00:00:00Z', sortOrder: 2 }),
], []).map((s) => s.chatId), ['c', 'b', 'a']);

eq('sortSessions 过滤 SubAgent', sortSessions([
  mk('/repo:main', { channel: 'cli' }),
  mk('agent-x', { channel: 'cli', type: 'agent', parentChatId: '/repo:main' }),
], []).map((s) => s.chatId), ['/repo:main']);

// ── (8) 分组（web session-grouping.ts:209-236）──────────────────────────────
eq('空列表 ⇒ 无分组', keys(groupSessions([], 'path')), []);

const single = groupSessions([mk('web-1', { channel: 'web' })], 'path');
eq('单条 ⇒ 一个 unset 组', keys(single), [UNSET_WORK_PATH]);
eq('单条 ⇒ 组内就它一个', ids(single[0]), ['web-1']);

const pathGroups = groupSessions([
  mk('/b:x', { channel: 'cli', createdAt: '2026-06-01T00:00:00Z' }),
  mk('/a:y', { channel: 'cli', createdAt: '2026-06-01T00:00:00Z' }),
  mk('web-1', { channel: 'web', createdAt: '2026-06-01T00:00:00Z' }),
], 'path');
eq('path 组键顺序：目录字母序，unset 最后', keys(pathGroups), ['/a', '/b', '__unset__']);

const pathGrouped = groupSessions([
  mk('/a:new', { channel: 'cli', createdAt: '2026-06-02T00:00:00Z' }),
  mk('/a:old', { channel: 'cli', createdAt: '2026-06-01T00:00:00Z' }),
], 'path');
eq('同目录归同一组', keys(pathGrouped), ['/a']);
eq('组内按 createdAt 升序', ids(pathGrouped[0]), ['/a:old', '/a:new']);

const statusGroups = groupSessions([
  mk('a', { status: 'idle' }),
  mk('b', { status: 'running' }),
  mk('c', { status: 'error' }),
], 'status');
eq('status 组按 STATUS_ORDER 且跳空组', keys(statusGroups), ['running', 'idle', 'error']);

const timeGroups = groupSessions([
  mk('today-s', { lastActive: new Date(startOfToday.getTime() + 60000).toISOString() }),
  mk('yesterday-s', { lastActive: new Date(startOfYesterday.getTime() + 60000).toISOString() }),
  mk('earlier-s', { lastActive: new Date(startOfYesterday.getTime() - 86400000).toISOString() }),
], 'time');
eq('time 组顺序 today→yesterday→earlier', keys(timeGroups), ['today', 'yesterday', 'earlier']);

const popped = groupSessions([
  mk('a', { createdAt: '2026-06-01T00:00:00Z', status: 'idle' }),
  mk('b', { createdAt: '2026-06-02T00:00:00Z', status: 'idle' }),
], 'status', ['web:a']);
eq('星标浮到组内顶部', ids(popped[0]), ['a', 'b']);

const noSub = groupSessions([
  mk('/repo:main', { channel: 'cli', createdAt: '2026-06-01T00:00:00Z' }),
  mk('cli:/repo:main/review:1', {
    channel: 'agent', type: 'agent', parentChatId: '/repo:main', parentChannel: 'cli',
    createdAt: '2026-06-01T00:00:00Z',
  }),
], 'path');
eq('SubAgent 不进主分组', keys(noSub), ['/repo']);
eq('SubAgent 不进主分组（组内只剩父）', ids(noSub[0]), ['/repo:main']);

eq('未知分类安全回落 path（不抛错）', keys(groupSessions([mk('/a:x', { channel: 'cli' })], 'bogus')), ['/a']);

eq('sessionGroupKey 各分类', [
  sessionGroupKey(mk('/a:x', { channel: 'cli' }), 'path'),
  sessionGroupKey(mk('a', { status: 'running' }), 'status'),
  sessionGroupKey(mk('a', { lastActive: startOfToday.toISOString() }), 'time'),
], ['/a', 'running', 'today']);

// ── (9) 组标题文案（web SessionGroup.tsx:184-208 + i18n/zh-CN.ts）────────────
eq('time 组标题', [groupTitle('today', 'time'), groupTitle('yesterday', 'time'), groupTitle('earlier', 'time')],
  ['今天', '昨天', '更早']);
eq('status 组标题（waiting_input → 等待输入）',
  [groupTitle('running', 'status'), groupTitle('waiting_input', 'status'), groupTitle('idle', 'status'), groupTitle('error', 'status')],
  ['运行中', '等待输入', '空闲', '异常']);
eq('status 键改写只影响 waiting_input', [statusGroupKey('waiting_input'), statusGroupKey('running')], ['waiting', 'running']);
eq('path 组标题取末段', groupTitle('/home/user/proj', 'path'), 'proj');
eq('path unset 组标题', groupTitle(UNSET_WORK_PATH, 'path'), '未设置工作路径');
eq('basename 根目录原样', [basename('/'), basename('/a/b')], ['/', 'b']);
eq('path 组 tooltip 仅 path 分类且非 unset', [pathGroupTooltip('/a/b', 'path'), pathGroupTooltip(UNSET_WORK_PATH, 'path'), pathGroupTooltip('today', 'time')],
  ['/a/b', '', '']);

// ── (10) 设置键映射（新增项，web userSettings.ts:42）────────────────────────
eq('分类键本地名', KEY_SESSION_CATEGORY, 'xbot:session-category');
eq('分类键 → 服务端键', serverKey(KEY_SESSION_CATEGORY), 'web:session:category');
eq('服务端键 → 本地键', localKey('web:session:category'), KEY_SESSION_CATEGORY);
eq('既有星标键未被改动', serverKey(KEY_STARRED), 'web:session:starred');

console.log(`sessiongroup: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
