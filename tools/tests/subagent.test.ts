/**
 * SubAgent 进度树纯逻辑测试 —— 状态归档 / 可见性过滤 / 树展平 / ForEach key 契约。
 *
 * 权威基准（web）：`web/src/components/agent/SubAgentProgressTree.tsx`
 *   · `:68-70` 顶层只渲染 running/pending
 *   · `:80-82` 状态归档（running|active|pending / done|completed / error|failed）
 *   · `:95-99` 竖条配色分档；`:138-146` 标签；`:154-167` 子节点不过滤
 *
 * ⚠️ 判别力自证（提交信息）：三处 mutation 分别必红 ——
 *   ① `visibleRoots` 去掉状态过滤；② `subStatusKind` 的兜底从 OTHER 改成 RUNNING；
 *   ③ `rowKeyOf` 去掉 kind/desc 指纹。
 */
declare const process: { exit: (c: number) => void };

import {
  flattenSubAgents, hasVisibleSubAgents, isLiveSubAgent, subAgentLabel, SubAgentRow,
  SUB_DONE, SUB_ERROR, SUB_OTHER, SUB_RUNNING, subStatusKind, visibleRoots,
} from '../../entry/src/main/ets/core/subagent';
import { WebSubAgentProgress } from '../../entry/src/main/ets/core/chattypes';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 造一个 SubAgent 节点（只用到这 6 个字段）。 */
function node(role: string, status: string, instance?: string, desc?: string,
  sessionKey?: string, children?: WebSubAgentProgress[]): WebSubAgentProgress {
  const n: WebSubAgentProgress = { role, status };
  if (instance !== undefined) { n.instance = instance; }
  if (desc !== undefined) { n.desc = desc; }
  if (sessionKey !== undefined) { n.sessionKey = sessionKey; }
  if (children !== undefined) { n.children = children; }
  return n;
}

// ── ① 状态归档（web SubAgentProgressTree.tsx:80-82）──
{
  eq('running ⇒ running', subStatusKind('running'), SUB_RUNNING);
  eq('active ⇒ running', subStatusKind('active'), SUB_RUNNING);
  eq('pending ⇒ running', subStatusKind('pending'), SUB_RUNNING);
  eq('done ⇒ done', subStatusKind('done'), SUB_DONE);
  eq('completed ⇒ done', subStatusKind('completed'), SUB_DONE);
  eq('error ⇒ error', subStatusKind('error'), SUB_ERROR);
  eq('failed ⇒ error', subStatusKind('failed'), SUB_ERROR);
  // ⛔ 未知/空值**必须**归 other（归 running 会造出"幽灵进行中"，永远收不掉的卡片）
  eq('空串 ⇒ other', subStatusKind(''), SUB_OTHER);
  eq('undefined ⇒ other', subStatusKind(undefined), SUB_OTHER);
  eq('未知值 ⇒ other', subStatusKind('queued'), SUB_OTHER);
  eq('大小写敏感（Running ≠ running）', subStatusKind('Running'), SUB_OTHER);
}

// ── ② 在飞判定 ──
{
  ok('running 在飞', isLiveSubAgent('running'));
  ok('pending 在飞', isLiveSubAgent('pending'));
  ok('done 不在飞', !isLiveSubAgent('done'));
  ok('error 不在飞', !isLiveSubAgent('error'));
  ok('未知不在飞', !isLiveSubAgent('zzz'));
}

// ── ③ 顶层可见性过滤（web :68-70：只留 running/pending）──
{
  const nodes: WebSubAgentProgress[] = [
    node('explore', 'running'),
    node('reviewer', 'done'),      // 已完成 ⇒ 由工具行展示，这里不渲染
    node('qa', 'pending'),
    node('fixer', 'error'),        // 出错也**不**在顶层渲染（web 同）
    node('docs', 'weird'),
  ];
  eq('只留 running/pending（保序）', visibleRoots(nodes).map((n: WebSubAgentProgress) => n.role),
    ['explore', 'qa']);
  eq('全 done/error ⇒ 空', visibleRoots([node('a', 'done'), node('b', 'error')]), []);
  eq('undefined ⇒ 空', visibleRoots(undefined), []);
  eq('空数组 ⇒ 空', visibleRoots([]), []);
  ok('空树无可见行', !hasVisibleSubAgents([]));
  ok('有 running 即有可见行', hasVisibleSubAgents([node('a', 'running')]));
  ok('只有 done 则无可见行', !hasVisibleSubAgents([node('a', 'done')]));
}

// ── ④ 标签格式（web :138-146：`role` + (instance ? `:`+instance : '')）──
{
  eq('无 instance ⇒ 仅 role', subAgentLabel('explore', undefined), 'explore');
  eq('空串 instance ⇒ 仅 role', subAgentLabel('explore', ''), 'explore');
  eq('有 instance ⇒ role:instance', subAgentLabel('explore', 'mem-1'), 'explore:mem-1');
}

// ── ⑤ 树 → 扁平行（深度/顺序/子节点不过滤）──
{
  const tree: WebSubAgentProgress[] = [
    node('explore', 'running', 'e1', 'scan repo', 'agent:explore/e1', [
      node('sub-a', 'done', 's1', 'child done'),       // 子节点**不过滤**
      node('sub-b', 'error', 's2', 'child err'),
    ]),
    node('qa', 'done'),                                 // 顶层 done ⇒ 整棵不出现
    node('fix', 'pending', 'f1', 'apply patch', 'agent:fix/f1'),
  ];
  const rows: SubAgentRow[] = flattenSubAgents(tree, true);
  eq('行数 = 1 root + 2 children + 1 root', rows.length, 4);
  eq('深度序列', rows.map((r: SubAgentRow) => r.depth), [0, 1, 1, 0]);
  eq('标签序列', rows.map((r: SubAgentRow) => r.label), ['explore:e1', 'sub-a:s1', 'sub-b:s2', 'fix:f1']);
  eq('状态档序列', rows.map((r: SubAgentRow) => r.kind), [SUB_RUNNING, SUB_DONE, SUB_ERROR, SUB_RUNNING]);
  eq('描述透传', rows.map((r: SubAgentRow) => r.desc), ['scan repo', 'child done', 'child err', 'apply patch']);
  eq('hasChildren 只对第一行 true', rows.map((r: SubAgentRow) => r.hasChildren), [true, false, false, false]);
  eq('顶层 done 的整棵子树不出现（qa 不在）',
    rows.filter((r: SubAgentRow) => r.label.indexOf('qa') === 0).length, 0);
  eq('undefined ⇒ 空', flattenSubAgents(undefined, true), []);
  eq('无可见根 ⇒ 空', flattenSubAgents([node('a', 'done')], true), []);
}

// ── ⑥ 可点开（web `disabled={!sessionKey || !onOpen}`）──
{
  const withKey: WebSubAgentProgress[] = [node('a', 'running', 'i1', 'd', 'agent:a/i1')];
  eq('有 sessionKey + 宿主回调 ⇒ openable', flattenSubAgents(withKey, true)[0].openable, true);
  eq('有 sessionKey 但宿主无回调 ⇒ 不可点', flattenSubAgents(withKey, false)[0].openable, false);
  const noKey: WebSubAgentProgress[] = [node('a', 'running', 'i1', 'd')];
  eq('无 sessionKey ⇒ 不可点', flattenSubAgents(noKey, true)[0].openable, false);
  eq('sessionKey 透传', flattenSubAgents(withKey, true)[0].sessionKey, 'agent:a/i1');
}

// ── ⑦ ForEach key 契约（ARKTS-GOTCHAS §3：key 必须随内容变）──
{
  // 同身份 + 状态变化 ⇒ key 必须变（否则 ArkUI 不重建该项 ⇒ 图标/配色卡在首帧）。
  // ⚠️ 必须用**子节点**验证：顶层 done 会被 visibleRoots 过滤掉（整行消失，不是"状态变"）。
  const before: SubAgentRow[] = flattenSubAgents(
    [node('a', 'running', 'i1', 'go', undefined, [node('child', 'running', 'c1')])], true);
  const after: SubAgentRow[] = flattenSubAgents(
    [node('a', 'running', 'i1', 'go', undefined, [node('child', 'done', 'c1')])], true);
  eq('两棵树都有 2 行（父 + 子）', [before.length, after.length], [2, 2]);
  ok('子节点状态变 ⇒ key 变', before[1].key !== after[1].key);
  ok('子节点状态变 ⇒ id 不变（同一节点）', before[1].id === after[1].id);

  // 描述变化 ⇒ key 变
  const d1: SubAgentRow[] = flattenSubAgents([node('a', 'running', 'i1', 'aa')], true);
  const d2: SubAgentRow[] = flattenSubAgents([node('a', 'running', 'i1', 'bbbb')], true);
  ok('描述变 ⇒ key 变', d1[0].key !== d2[0].key);
  ok('描述同长同状态 ⇒ key 相同（幂等）',
    flattenSubAgents([node('a', 'running', 'i1', 'aa')], true)[0].key === d1[0].key);

  // 同一棵树内 key **唯一**（重复 key ⇒ ArkUI 复用错位）
  const dup: SubAgentRow[] = flattenSubAgents([
    node('x', 'running', undefined, undefined, undefined, [node('x', 'running')]),
    node('x', 'running'),
  ], true);
  const keys: string[] = dup.map((r: SubAgentRow) => r.key);
  eq('同 role 同名 ⇒ id 因 path 不同而唯一', new Set(keys).size, keys.length);

  // 兄弟顺序变化 ⇒ path 变 ⇒ id/key 变（能反映结构变化）
  const ord1: SubAgentRow[] = flattenSubAgents([node('a', 'running'), node('b', 'running')], true);
  const ord2: SubAgentRow[] = flattenSubAgents([node('b', 'running'), node('a', 'running')], true);
  ok('根顺序变 ⇒ 首行 id 变', ord1[0].id !== ord2[0].id);
}

console.log(`\nsubagent.test: ${pass} passed / ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
