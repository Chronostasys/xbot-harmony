/**
 * 会话分组**接线**契约测试（任务4）—— 把零消费者的 `core/sessiongroup.ets` 接到抽屉列表上。
 *
 * 两层（与 `empty_notice.test.ts` 同款）：
 *  A. **真判定（可执行）**：`sessionRowToGroup` / `groupSessionsFromItems` 是 `core/sessiongroup.ets` 的
 *     真函数（离线 harness 会编译 `core/**`）⇒ 用真数据跑「path/status/time × 组内排序 × SubAgent 过滤」。
 *  B. **源码形态契约**：`pages/Index.ets` 的抽屉列表必须**消费**纯逻辑（组件层不进离线 harness，
 *     按本仓既有先例 `live_tail_delivery.test.ts` 读真实源码断言）。
 *
 * 分组判据的**来源**（不许客户端私有改判）：全部来自 `GET /api/session-tree`
 * （`core/store.ets:loadSessions`）的**服务端字段** —— 权威结构见服务端
 * `channel/web/web.go:268-289` `UserChatWithPreview`：`work_dir`/`status`/`last_active`/
 * `created_at`/`sort_order`/`type`/`parent_chat_id`/`full_key`/`channel`/`label`/`chat_id`。
 * 本仓 `SessionItem`（`core/types.ets:33-39`）只声明了其中 5 个 ⇒ `core/sessiongroup.ets` 里
 * 用 `SessionGroupRow`（同一 RPC 行的加宽视图）把其余字段读出来，**原样直传**，无任何语义改写。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  DEFAULT_SESSION_CATEGORY, SESSION_CATEGORIES, SESSION_CATEGORY_PATH, SESSION_CATEGORY_STATUS,
  SESSION_CATEGORY_TIME, SessionGroup, SessionGroupRow, UNSET_WORK_PATH, collapseKey, groupSessionsFromItems,
  groupTitle, sessionCategoryLabel, sessionRowToGroup,
} from '../../entry/src/main/ets/core/sessiongroup';
import { SessionItem } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}

/** 造一条**服务端形状**的会话行（可直接当 SessionItem 传给接线层）。 */
function row(chatId: string, workDir: string, status: string, lastActive: string,
  createdAt: string, sortOrder: number, type: string, parentChatId: string): SessionItem {
  const r: SessionGroupRow = {
    chat_id: chatId, channel: 'web', label: `L-${chatId}`, work_dir: workDir,
    last_active: lastActive, created_at: createdAt, sort_order: sortOrder,
    status: status, type: type, parent_chat_id: parentChatId,
  };
  return r as SessionItem;
}

const T0 = '2026-10-11T00:30:00+08:00';   // 今天
const T1 = '2026-10-10T10:00:00+08:00';   // 昨天（相对 2026-10-11）
const T2 = '2026-10-11T01:00:00+08:00';   // 今天（比 T0 晚 ⇒ createdAt 排序用）
const T9 = '2020-01-01T00:00:00+08:00';   // 更早

// ── (A1) sessionRowToGroup：字段直传 + 缺失回落 ────────────────────────────────
const g1 = sessionRowToGroup({
  chat_id: 'a', channel: 'cli', label: 'lbl', work_dir: '/Users/x/proj/', last_active: T0,
  created_at: T9, sort_order: 3, status: 'running', type: 'main', parent_chat_id: '', full_key: 'k',
});
eq('chatId 直传', g1.chatId, 'a');
eq('workDir 直传（归一化留给 pathBucket）', g1.workDir, '/Users/x/proj/');
eq('status **原样直传**（不做客户端改判）', g1.status, 'running');
eq('sortOrder 直传', g1.sortOrder, 3);
eq('lastActive 直传', g1.lastActive, T0);
eq('createdAt 直传', g1.createdAt, T9);
// 缺失字段的回落（web 语义）
const g2 = sessionRowToGroup({ chat_id: 'b' });
eq('缺 status ⇒ idle', g2.status, 'idle');
eq('缺 sort_order ⇒ 0', g2.sortOrder, 0);
eq('缺 work_dir ⇒ 空串', g2.workDir, '');
eq('缺 last_active ⇒ 空串', g2.lastActive, '');
eq('缺 channel ⇒ 空串（sessionKey 内再回落 web）', g2.channel, '');
ok('空 status（服务端给了空串）也回落 idle', sessionRowToGroup({ chat_id: 'c', status: '' }).status === 'idle');

// ── (A2) path 分组（默认分类）：work_dir 决定组，缺则 __unset__ 且**永远最后** ──────
const pItems: SessionItem[] = [
  row('w1', '/Users/b/src/zeta', 'idle', T0, T1, 0, '', ''),
  row('w2', '/Users/b/src/alpha', 'idle', T0, T2, 0, '', ''),
  row('w3', '', 'idle', T0, T0, 0, '', ''),                       // 无 work_dir
  row('cli1', '', 'idle', T0, T0, 0, '', ''),                      // 无 work_dir（cli 也无从 chat_id 抽取 ⇒ unset）
];
const pGroups: SessionGroup[] = groupSessionsFromItems(pItems, SESSION_CATEGORY_PATH, []);
eq('path：未设置组排最后', pGroups[pGroups.length - 1].key, UNSET_WORK_PATH);
eq('path：目录字母序（alpha 在 zeta 前）', pGroups.map((g: SessionGroup) => g.key),
  ['/Users/b/src/alpha', '/Users/b/src/zeta', UNSET_WORK_PATH]);
eq('path：无 work_dir 的两条都进 __unset__', pGroups[2].sessions.length, 2);
eq('path 组标题 = 末段目录名', groupTitle('/Users/b/src/alpha', SESSION_CATEGORY_PATH), 'alpha');
eq('path 未设置组标题', groupTitle(UNSET_WORK_PATH, SESSION_CATEGORY_PATH), '未设置工作路径');

// ── (A3) status 分组：**服务端 status 原样** + 固定组序；未知状态丢弃（web 同款静默面）──
const sItems: SessionItem[] = [
  row('s1', '/x', 'idle', T0, T0, 0, '', ''),
  row('s2', '/x', 'running', T0, T0, 0, '', ''),
  row('s3', '/x', 'bogus_status', T0, T0, 0, '', ''),
];
const sGroups: SessionGroup[] = groupSessionsFromItems(sItems, SESSION_CATEGORY_STATUS, []);
eq('status：只产出 STATUS_ORDER 里的组，未知状态被丢弃', sGroups.length, 2);
eq('status：running 在 idle 之前（STATUS_ORDER 序）', sGroups.map((g: SessionGroup) => g.key),
  ['running', 'idle']);
eq('status 组标题', groupTitle('waiting_input', SESSION_CATEGORY_STATUS), '等待输入');

// ── (A4) time 分组：last_active 分桶（今天/昨天/更早）────────────────────────────
const tItems: SessionItem[] = [
  row('t1', '/x', 'idle', T9, T0, 0, '', ''),
  row('t2', '/x', 'idle', T0, T0, 0, '', ''),
  row('t3', '/x', 'idle', T1, T0, 0, '', ''),
];
const tGroups: SessionGroup[] = groupSessionsFromItems(tItems, SESSION_CATEGORY_TIME, []);
eq('time：桶序 today → yesterday → earlier', tGroups.map((g: SessionGroup) => g.key),
  ['today', 'yesterday', 'earlier']);
eq('time 组标题', groupTitle('yesterday', SESSION_CATEGORY_TIME), '昨天');

// ── (A5) 组内排序：星标 → sort_order → createdAt 升序；SubAgent 不进主分组 ────────
const oItems: SessionItem[] = [
  row('o1', '/x', 'idle', T0, '2026-01-01T00:00:00+08:00', 0, '', ''),
  row('o2', '/x', 'idle', T0, '2026-01-02T00:00:00+08:00', 0, '', ''),
  row('o3', '/x', 'idle', T0, '2026-01-09T00:00:00+08:00', 5, '', ''),   // 有自定义序 ⇒ 前
  row('sub1', '/x/sub', 'idle', T0, T0, 0, 'agent', 'parent-1'),         // SubAgent
];
const oGroups: SessionGroup[] = groupSessionsFromItems(oItems, SESSION_CATEGORY_PATH, []);
const joined: string = oGroups.reduce((acc: string, g: SessionGroup) => {
  return acc + g.sessions.map((s) => s.chatId).join(',');
}, '');
eq('组内：自定义序在最前，其余按 createdAt 升序', joined, 'o3,o1,o2');
ok('SubAgent（type=agent/parent_chat_id）不出现在任何主分组', joined.indexOf('sub1') < 0);
// 星标优先（键命中 chat_id 也算 —— 与 core/stars.ets 的 chat_id 语义一致）
const starred: SessionGroup[] = groupSessionsFromItems(oItems, SESSION_CATEGORY_PATH, ['o2']);
ok('星标组内浮到顶部', starred[0].sessions[0].chatId === 'o2');
// 空输入不抛
eq('空会话列表 ⇒ 无组', groupSessionsFromItems([], SESSION_CATEGORY_PATH, []).length, 0);

// ── (A6) 折叠键必须带分类前缀（不同分类下的同名组不能串味）──────────────────────
ok('collapseKey 带前缀', collapseKey('path', '/x') !== collapseKey('time', '/x'));
eq('默认分类 = path（web 同值）', DEFAULT_SESSION_CATEGORY, SESSION_CATEGORY_PATH);
eq('分类清单顺序（切换器唯一来源）', SESSION_CATEGORIES,
  [SESSION_CATEGORY_PATH, SESSION_CATEGORY_STATUS, SESSION_CATEGORY_TIME]);
eq('分类标签（web i18n 逐字）', [sessionCategoryLabel(SESSION_CATEGORY_PATH),
  sessionCategoryLabel(SESSION_CATEGORY_STATUS), sessionCategoryLabel(SESSION_CATEGORY_TIME)],
  ['项目', '状态', '时间']);

// ── (B) 页面接线形态（源码断言；改坏即红）────────────────────────────────────
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const pageSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'), 'utf-8');

// (B1) 抽屉列表消费纯逻辑（唯一入口）
has(pageSrc, 'groupSessionsFromItems(', '抽屉接线层调用 core/sessiongroup 的分组函数');
has(pageSrc, 'ForEach(this.drawerGroups()', '抽屉列表遍历分组视图（不再直接遍历 filteredSessions）');
has(pageSrc, 'private drawerGroups(): DrawerGroup[] {', '分组视图入口存在');
// (B2) 分类来自**与 web 共用的服务端设置键**，并归一化（不私有改判）
has(pageSrc, 'normalizeSessionCategory(settingOf(this.settings, KEY_SESSION_CATEGORY), true)',
  '分类读服务端设置键 xbot:session-category 并归一化');
has(pageSrc, 'this.setSetting(KEY_SESSION_CATEGORY, cat);', '切分类写回服务端（同一条设置路径）');
// (B3) 切换器**只从 SESSION_CATEGORIES 渲染**（模块注释要求：组件里不得再列一遍分类）
has(pageSrc, 'ForEach(SESSION_CATEGORIES, (c: string) => {', '切换器遍历 SESSION_CATEGORIES');
has(pageSrc, 'sessionCategoryLabel(c)', '切换器标签走纯逻辑文案');
// (B4) 折叠键带分类前缀；组头有计数；chevron 随开合旋转
has(pageSrc, 'collapseKey(cat, key)', '折叠键经 collapseKey（带分类前缀）');
has(pageSrc, 'this.toggleGroup(this.sessionCategory(), g.key);', '点组头 = 折叠/展开');
has(pageSrc, 'this.isGroupCollapsed(this.sessionCategory(), g.key)', '展开态判据同源');
has(pageSrc, 'Text(`${g.items.length}`)', '组头显示会话计数');
has(pageSrc, "SymbolGlyph($r('sys.symbol.chevron_right'))", '组头 chevron 用系统符号');
// (B5) 行体**未被改动**（key 生成器原样保留 = 行卡渲染没有被我重构）
has(pageSrc, '(s: SessionItem) => `${s.chat_id}#${s.label}#${s.running}`',
  '行卡 key 生成器保持原样（行体未重构）');
// (B6) ⛔ 铁律：**抽屉**（会话列表所在区间）绝不出现"点击加载更多"
const drawerStart: number = pageSrc.indexOf('DrawerSheet() {');
const drawerEnd: number = pageSrc.indexOf('SettingsSheet() {', drawerStart);
const drawerSrc: string = pageSrc.substring(drawerStart, drawerEnd > drawerStart ? drawerEnd : pageSrc.length);
ok('抽屉区间可定位', drawerStart > 0 && drawerSrc.length > 1000);
hasNot(drawerSrc, '加载更多', '抽屉内无「加载更多」');
hasNot(drawerSrc, 'loadMore', '抽屉内无 loadMore 触发器');
hasNot(drawerSrc, 'has_more', '抽屉不消费分页字段（服务端一次给全量主会话）');
// (B7) 组头不加额外按钮（用户要求）；标题来自纯逻辑 groupTitle（页面不另写文案规则）
has(pageSrc, 'dg.title = groupTitle(g.key, cat);', '组标题来自纯逻辑 groupTitle');
ok('标题赋值只出现一处（页面没有第二套标题规则）', (pageSrc.match(/dg\.title = /g) || []).length === 1);

if (fail > 0) {
  console.log(`  sessiongroup_wiring: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  sessiongroup_wiring: ${pass} passed, 0 failed`);
process.exit(0);
