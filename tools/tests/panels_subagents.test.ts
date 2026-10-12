/**
 * 面板「子代理」tab **真源**的纯逻辑门禁（15h）。
 *
 * ── 背景（用户 2026-10-12 长期目标④原话：「任务管理做的很差」）────────────────────────
 *   原实现把 `subagents` 取自会话树的 `orphan_subagents`（**孤立根**）——
 *   后端实测：`orphan_subagents` 对当前会话**恒返回 `null`**（`/api/session-tree`），
 *   而子代理**挂在当前会话节点的 `children` 下**（实测 `harmony-ui-dev` 有 19 个 `type=agent`）。
 *   ⇒ 面板那一页**结构性永远空**（web 列的是 children 展平后的活跃子代理，
 *     `TasksPanel.tsx:36-40` + `session-tree.ts:37 flattenSubAgentTree` + `:300 isActiveSubAgent`）。
 *
 * ── 钉什么 ──────────────────────────────────────────────────────────────────────
 *   ① `flattenSubAgentNodes` = **DFS 前序**（顺序即 UI 顺序；web 递归先父后子）+ 去重 + 全程 null 安全；
 *   ② `isActiveSubAgent` = `running===true || status ∈ {running, waiting_input, pending}`
 *      （⛔ `active` **不算** —— 与 `core/subagent.ets:isLiveSubAgent` 是**两条有意不同的判据**）；
 *   ③ `activeSubAgentNodes` 只留活跃者；
 *   ④ `findSessionNodeOf` 能递归找到嵌套节点；
 *   ⑤ `subAgentRowOf` 三态取值（JSON `null` → 空串）+ `running` 由 status 派生；
 *   ⑥ 标题/副行口径对齐 web（`role`/`instance` 优先；`preview` 优先当副行）。
 *
 * ⚠️ 结尾 `process.exit`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import { SessionItem } from '../../entry/src/main/ets/core/types';
import {
  activeSubAgentNodes, findSessionNodeOf, flattenSubAgentNodes, isActiveSubAgent,
  subagentPrimary, subagentSubText, subAgentRowOf,
} from '../../entry/src/main/ets/core/panels';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${detail ? ` ｜ ${detail}` : ''}`); }
}

/** 造节点（只写关心的字段）。 */
function node(chat_id: string, extra?: Partial<SessionItem>): SessionItem {
  return Object.assign({ chat_id, channel: 'web' } as SessionItem, extra || {});
}

// ── ① 展平：DFS 前序 + 去重 + null 安全 ────────────────────────────────────────────
eq('① 空根 ⇒ 空', flattenSubAgentNodes(undefined).length, 0);
eq('① null 根 ⇒ 空', flattenSubAgentNodes(null).length, 0);
eq('① 无 children ⇒ 空', flattenSubAgentNodes(node('p')).length, 0);

// p → [a → [a1, a2], b]  ⇒ 前序 = a, a1, a2, b（BFS 会给 a, b, a1, a2 ⇒ 顺序不同 ⇒ 必被这条抓住）
const tree: SessionItem = node('p', {
  children: [
    node('a', { children: [node('a1'), node('a2')] }),
    node('b'),
  ],
});
eq('① DFS 前序（不是 BFS）', flattenSubAgentNodes(tree).map((n) => n.chat_id), ['a', 'a1', 'a2', 'b']);

// 去重：同一 chat_id 重复出现（服务端异常/自引用）⇒ 只留一个且**不死循环**
const dup: SessionItem = node('p', {
  children: [node('x', { children: [node('x')] }), node('x')],
});
eq('① 重复节点去重', flattenSubAgentNodes(dup).map((n) => n.chat_id), ['x']);
const selfRef: SessionItem = node('s');
selfRef.children = [selfRef];
eq('① 自引用不死循环（去重兜住）', flattenSubAgentNodes(selfRef).length, 1);

// ── ② 活跃判据（逐字对齐 web TasksPanel.tsx:300）──────────────────────────────────
ok('② running=true ⇒ 活跃', isActiveSubAgent(node('a', { running: true })));
ok("② status='running' ⇒ 活跃", isActiveSubAgent(node('a', { status: 'running' })));
ok("② status='waiting_input' ⇒ 活跃（web 含它）", isActiveSubAgent(node('a', { status: 'waiting_input' })));
ok("② status='pending' ⇒ 活跃", isActiveSubAgent(node('a', { status: 'pending' })));
ok("② status='done' ⇒ 不活跃", !isActiveSubAgent(node('a', { status: 'done' })));
ok("② status='idle' ⇒ 不活跃", !isActiveSubAgent(node('a', { status: 'idle' })));
ok('② 无 running/无 status ⇒ 不活跃（⛔ 不许"幽灵进行中"）', !isActiveSubAgent(node('a')));
ok("② status='active' ⇒ ⛔ **不**活跃（与 core/subagent.ets:isLiveSubAgent 是两条不同判据）",
  !isActiveSubAgent(node('a', { status: 'active' })));

// ── ③ 只留活跃者 ───────────────────────────────────────────────────────────────
const mixed: SessionItem = node('p', {
  children: [
    node('r1', { status: 'running' }),
    node('d1', { status: 'done' }),
    node('w1', { running: true }),
    node('h1', { historical: true }),
  ],
});
eq('③ 只留活跃（r1/w1）', activeSubAgentNodes(mixed).map((n) => n.chat_id), ['r1', 'w1']);
eq('③ 无活跃 ⇒ 空', activeSubAgentNodes(node('p', { children: [node('d', { status: 'done' })] })).length, 0);

// ── ④ 递归查找 ─────────────────────────────────────────────────────────────────
eq('④ 找嵌套节点', findSessionNodeOf([tree], 'a1')?.chat_id, 'a1');
eq('④ 找根节点', findSessionNodeOf([tree], 'p')?.chat_id, 'p');
eq('④ 找不到 ⇒ null', findSessionNodeOf([tree], 'nope'), null);
eq('④ null 入参 ⇒ null', findSessionNodeOf(null, 'a'), null);

// ── ⑤ 行映射：三态取值 + running 派生 ────────────────────────────────────────────
const jnull = { chat_id: 'c', channel: null, label: null, role: null, instance: null, status: null, preview: null } as unknown as SessionItem;
const r0 = subAgentRowOf(jnull);
eq('⑤ JSON null 全归一空串（chat_id 除外）', [r0.label, r0.role, r0.instance, r0.status, r0.preview], ['', '', '', '', '']);
ok('⑤ JSON null 不炸且 running=false', r0.running === false);
const rw = subAgentRowOf(node('c', { status: 'waiting_input' }));
ok("⑤ running 由 status 派生（waiting_input ⇒ true）", rw.running === true);
const rd = subAgentRowOf(node('c', { status: 'done' }));
ok("⑤ status='done' ⇒ running=false", rd.running === false);

// ── ⑥ 标题 / 副行（对齐 web subAgentTitle / 副行文案）────────────────────────────
eq('⑥ 标题：role/instance 优先', subagentPrimary(subAgentRowOf(node('c', { role: 'explore', instance: 'ui-markdown', label: 'x' }))), 'explore/ui-markdown');
eq('⑥ 标题：只有 role', subagentPrimary(subAgentRowOf(node('c', { role: 'explore', label: 'x' }))), 'explore');
eq('⑥ 标题：无 role ⇒ label', subagentPrimary(subAgentRowOf(node('c', { label: 'tester-1' }))), 'tester-1');
eq('⑥ 标题：无 role/label ⇒ chat_id', subagentPrimary(subAgentRowOf(node('sub-9'))), 'sub-9');

eq('⑥ 副行：preview 优先', subagentSubText(subAgentRowOf(node('c', { preview: '正在读文件', status: 'running' }))), '正在读文件');
eq("⑥ 副行：waiting_input", subagentSubText(subAgentRowOf(node('c', { status: 'waiting_input' }))), '等待输入');
eq("⑥ 副行：pending", subagentSubText(subAgentRowOf(node('c', { status: 'pending' }))), '排队中');
eq('⑥ 副行：running', subagentSubText(subAgentRowOf(node('c', { status: 'running' }))), '运行中');
eq('⑥ 副行：historical', subagentSubText(subAgentRowOf(node('c', { historical: true }))), '历史');
eq('⑥ 副行：兜底完成', subagentSubText(subAgentRowOf(node('c'))), '完成');

// ── 零扫描判红：本文件必须真扫到东西（fixture 自证）────────────────────────────────
ok('零扫描判红：树节点数 > 0（扫描器与 fixture 脱节 ⇒ 红）', flattenSubAgentNodes(tree).length > 0);

if (fail > 0) { console.log(`  panels_subagents: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  panels_subagents: ${pass} passed, 0 failed`);
process.exit(0);
