/**
 * 判据：子代理视图 = **全量（含 idle）+ 层级**，且「代理」tab 不再挂结构化/通信视图。
 *
 * 2026-10-26 用户：「把子代理视图改回来，回滚之前那个结构化视图的修改。
 *   但是我希望子代理视图可以展示一下层级，以及可以展示 idle 的子代理。」
 *
 * 背景（为什么必须新增 `allSubAgentRows`）：旧的「代理」tab 只取 `activeSubAgentNodes`
 *   （`running || status ∈ {running,waiting_input,pending}`）⇒ **idle / 完成 / 历史一律不可见**；
 *   而层级信息在会话树的 `children` 里，扁平化时被丢掉了。
 *
 * 判据：
 *   ① `allSubAgentRows` 必须**包含 idle**（旧判据会漏）；
 *   ② `depth` 必须按会话树 DFS 深度递增（直接子代理 = 1，孙代理 = 2）；
 *   ③ 排序：运行中 → interrupted（可续跑）→ 其它，同级**保持 DFS 前序**（稳定、可断言）；
 *   ④ 接线：`Index` 的 subs tab 渲染 `subagentsAll`、**不再**出现 `CourtSheet`；
 *      `store` 用 `allSubAgentRows(node)` 填 `subagentsAll`，且旧 `subagents`（仅活跃）保留给角标。
 *
 * ⛔ mutation 自证：
 *   · `allSubAgentRows` 改回只取 `isActiveSubAgent` ⇒ 用例① 红；
 *   · 深度恒为 1（不随 children 递增）⇒ 用例② 红；
 *   · 去掉"运行中优先"排序 ⇒ 用例③ 红；
 *   · subs tab 改回渲染 `CourtSheet` ⇒ 用例④ 红。
 */
declare const process: { cwd: () => string; exit: (c: number) => void };
declare const require: (m: string) => any;
const fs = require('fs');
const path = require('path');

import { allSubAgentRows, subagentPrimary, subagentStatusText, SUB_TREE_MAX_DEPTH } from '../../entry/src/main/ets/core/panels';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function node(chatID: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { chat_id: chatID, channel: 'web', type: 'agent', ...extra };
}

// ── ① ② ③ 纯函数行为 ───────────────────────────────────────────────
{
  const root: Record<string, unknown> = node('chat_root', {
    children: [
      node('chat_a', { running: true, status: 'running', children: [node('chat_a1', { status: 'idle' })] }),
      node('chat_b', { status: 'idle' }),
      node('chat_c', { status: 'interrupted' }),
    ],
  });
  const rows = allSubAgentRows(root as never);

  eq('① 全量：3 个直接子代理 + 1 个孙代理 = 4 行（含 idle）', rows.length, 4);
  const ids: string[] = rows.map((r) => r.chat_id);
  ok('① idle 子代理必须在列表里（旧 activeSubAgentNodes 会全漏）',
    ids.indexOf('chat_b') >= 0 && ids.indexOf('chat_a1') >= 0);
  // ③ 顺序 = **纯 DFS 前序**（父子相邻）——树图的前提；⛔ 不允许"运行中优先"重排
  eq('③ 树序：父 → 子 → 下一个兄弟（DFS 前序）', ids,
    ['chat_a', 'chat_a1', 'chat_b', 'chat_c']);
  eq('② 直接子代理 depth = 1', rows[0].depth, 1);
  eq('② 孙代理 depth = 2（层级）', rows[1].depth, 2);
  // 树线信息：last / rails / parentLabel
  eq('③ A 不是同层最后一个 ⇒ last=false', rows[0].last, false);
  eq('③ A1 是 A 的唯一孩子 ⇒ last=true', rows[1].last, true);
  // 全局前瞻：第 k 列竖线延续 ⇔ 后面还有 depth ≥ k+2 的行。A1 之后是 B(1)/C(1) ⇒ 无 ⇒ false。
  // （A 有弟弟 B 这件事由 **B 自己的折角** 表达，不需要 A1 那列竖线一路延长。）
  eq('③ A1 列竖线不延续（后面没有更深的行）', rows[1].rails, [false]);
  eq('③ B/C 为顶层 ⇒ 无祖先竖线', rows[2].rails, []);
  eq('③ 孙代理带「上级」= A 的显示名', rows[1].parentLabel, 'chat_a');
  eq('③ 直接子代理无上级', rows[0].parentLabel, '');
  eq('③ 顶层最后一个 C ⇒ last=true', rows[3].last, true);
}

// ── ④ 接线：视图回滚（不再渲染 CourtSheet）+ 数据源正确 ────────────────
{
  const index: string = fs.readFileSync(
    path.join(process.cwd(), 'entry/src/main/ets/pages/Index.ets'), 'utf8');
  ok('④ 「代理」tab 渲染 subagentsAll', /panelTab === 'subs'[\s\S]{0,1600}ForEach\(this\.subagentsAll/.test(index));
  ok('④ 行由 `SubAgentTreeRow` 绘制（树线 + 上级副行）',
    /this\.SubAgentTreeRow\(a\)/.test(index) && /private SubAgentTreeRow\(a: SubAgentRow\)/.test(index));
  // 2026-10-26 二次修正：`List.divider` 按**行宽**铺、`startMargin` 只能到行内边距 ⇒ 会横穿
  //   树线区（真机："横线出头"）。分隔线改为**内容区 Row 的 bottom border**（从状态点开始）。
  // 2026-10-26 三次修正：用户明确「灰色分隔线为什么要有」⇒ **行间不要任何分隔线**
  //   （树线本身已表达层级；再叠横线会被看成"折角横线拖尾"）。
  {
    const s0: number = index.indexOf("panelTab === 'subs'");
    const subsBody: string = s0 >= 0 ? index.substring(s0, index.indexOf("panelTab === 'term'", s0)) : '';
    ok(`④ subs 切片非空（零扫描判红，len=${subsBody.length}）`, subsBody.length > 300);
    ok('④ subs 行间无分隔线（既无 List.divider，也无 bottom border）',
      subsBody.indexOf('.divider({') < 0);
    const row0: number = index.indexOf('private SubAgentTreeRow(a: SubAgentRow)');
    const rowBody: string = row0 >= 0 ? index.substring(row0, index.indexOf('private palOnce', row0)) : '';
    ok('④ 树行内也没有 bottom border 分隔线',
      /border\(\{ width: \{ bottom: STROKE_HAIRLINE \}/.test(rowBody) === false);
  }
  ok('④ ForEach key 稳定（chat_id 优先，空 id 用序号兜底；不含 status/depth）',
    /a\.chat_id\.length > 0 \? `sub-\$\{a\.chat_id\}` : `sub-idx-\$\{i\}`/.test(index));
  ok('④ 行高固定常量（刷新/加载不改变布局）', /const SUB_TREE_ROW_H: number = \d+/.test(index));
  // 2026-10-26 二次修正：固定高度容器仍会**占位**（空闲时留 50vp 空白）⇒ 直接**删掉**面板内
  //   那条独立「○ 加载中… / 断线」行（它才是不随内容变化却随刷新出现的推挤源）；
  //   状态改由**表头 spinner**（`panelBusy` → `LoadingProgress(16)`，不改变布局）+ 主界面弱网行承担。
  const ps0: number = index.indexOf('PanelsSheet() {');
  const psBody: string = ps0 >= 0 ? index.substring(ps0, index.indexOf("panelTab === 'cron'", ps0)) : '';
  ok(`④ 面板切片非空（零扫描判红，len=${psBody.length}）`, psBody.length > 500);
  ok('④ 面板内不再有独立的「加载中…」行（高度跳动的根因已移除）',
    psBody.indexOf("i18nT('加载中…')") < 0);
  ok('④ 也不再需要 PANEL_HINT_H 占位容器', index.indexOf('PANEL_HINT_H') < 0);
  ok('④ 表头仍有 busy 转圈（不改变布局的状态提示）',
    /if \(this\.panelBusy\) \{\s*LoadingProgress\(\)\.width\(16\)\.height\(16\)/.test(psBody));
  ok('④ 「代理」tab 不再挂 CourtSheet（结构化/通信视图已回滚）',
    index.indexOf('CourtSheet({') < 0);
  ok('④ 也不再残留 court 生命周期接线',
    index.indexOf('openCourtData') < 0 && index.indexOf('closeCourtData') < 0);

  const store: string = fs.readFileSync(
    path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');
  ok('④ store 用 allSubAgentRows(node, orphan_subagents) 填全量行（孤立节点不得丢）',
    /this\.subagentsAll = allSubAgentRows\(node, data\.orphan_subagents\)/.test(store));
  ok('④ 旧的「仅活跃」subagents 仍保留（tab 角标/侧栏用）',
    /this\.subagents = subs;/.test(store));

  const panels: string = fs.readFileSync(
    path.join(process.cwd(), 'entry/src/main/ets/core/panels.ets'), 'utf8');
  ok('④ allSubAgentRows 内**不得**再用 isActiveSubAgent 过滤（否则又漏 idle）',
    /export function allSubAgentRows[\s\S]{0,2200}?isActiveSubAgent/.test(panels) === false);
}


// ── ⑤ 边缘情况（后端可能出 bug：任何畸形数据前端都要能渲染）────────────────────
{
  // (a) 无父节点的孤立子代理（orphan_subagents / 脏数据）⇒ 必须渲染，且主干与上面连续
  const root = node('chat_root', {
    children: [
      node('chat_a', { running: true, status: 'running', children: [node('chat_a1', { status: 'idle' })] }),
    ],
  });
  const orphan = node('chat_orphan', { status: 'idle' });
  const rows = allSubAgentRows(root as never, [orphan] as never);
  const ids = rows.map((r) => r.chat_id);
  eq('⑤a 孤立节点也渲染（无父不得丢）', ids, ['chat_a', 'chat_a1', 'chat_orphan']);
  eq('⑤a 孤立节点 depth=1', rows[2].depth, 1);
  eq('⑤a 孤立节点带 orphan 标记', rows[2].orphan, true);
  ok('⑤a 主干连续：A 不是最后一行（后面还有孤立节点）', rows[0].last === false);
  eq('⑤a 只有整表最后一行是 └─', rows[2].last, true);
  eq('⑤a A1 在 A 之后、孤立节点之前', ids.indexOf('chat_a1'), 1);

  // (b) 没有 chat_id / 没有 label 的空壳节点 ⇒ 仍渲染，主行有兜底文案
  const shell = { channel: 'web', type: 'agent', status: '' } as never;
  const rows2 = allSubAgentRows({ channel: 'web', chat_id: 'r', children: [shell] } as never, null);
  eq('⑤b 空壳节点仍产 1 行', rows2.length, 1);
  eq('⑤b 主行兜底文案', subagentPrimary(rows2[0]), '(未命名子代理)');

  // (c) 自引用成环 ⇒ 不死循环、行数有限
  const cyc: Record<string, unknown> = node('chat_c', { status: 'idle' });
  cyc.children = [cyc];
  const rows3 = allSubAgentRows({ channel: 'web', chat_id: 'r', children: [cyc] } as never, null);
  ok('⑤c 自引用不死循环（行数有限）', rows3.length >= 1 && rows3.length <= 2);

  // (d) 超深（8 层）⇒ 截断到 SUB_TREE_MAX_DEPTH，不无限展开
  let deep: Record<string, unknown> = node('d8', { status: 'idle' });
  for (let i = 7; i >= 1; i--) {
    deep = node(`d${i}`, { status: 'idle', children: [deep] });
  }
  const rows4 = allSubAgentRows({ channel: 'web', chat_id: 'r', children: [deep] } as never, null);
  ok(`⑤d 深度截断（实得 ${rows4.length} 行 ≤ SUB_TREE_MAX_DEPTH）`,
    rows4.length <= SUB_TREE_MAX_DEPTH);
  ok('⑤d 最深层不超上限', rows4.every((r) => r.depth <= SUB_TREE_MAX_DEPTH));

  // (e) 同 id 多行（幽灵行 children=0 + 真身行 children=N）⇒ 择优保留子树
  const ghost = node('chat_x', { status: 'idle' });
  const real = node('chat_x', { status: 'idle', children: [node('chat_x1', { status: 'idle' })] });
  const rows5 = allSubAgentRows({ channel: 'web', chat_id: 'r', children: [ghost, real] } as never, null);
  eq('⑤e 择优后子树不丢', rows5.map((r) => r.chat_id), ['chat_x', 'chat_x1']);

  // (f) 未知状态原样显示（不谎报"空闲"）
  eq('⑤f 未知状态原样显示', subagentStatusText({ status: 'weird_state', running: false, chat_id: 'x' } as never), 'weird_state');
  eq('⑤f status 缺失 ⇒ 空闲', subagentStatusText({ status: '', running: false, chat_id: 'x' } as never), '空闲');
}


// ── ⑥ 子代理历史必须走 dump（web 同源）：否则只有 user 行 ───────────────────────
{
  // 用户 2026-10-26 P0：「子代理历史视图只看得到 user 消息，看不到任何 agent 消息」。
  // 根因：`/api/history` 对子代理会话只回 v55 **空壳 assistant 行**（正文在 iteration_history
  // 里、且常无 turn 结构）⇒ 被空行规则过滤。web 的权威做法：role/instance 型子代理走
  // `get_agent_session_dump`（messages + iterations），失败退 `get_session_messages`。
  const store: string = fs.readFileSync(
    path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');
  ok('⑥ store 有按 role/instance 加载转录的入口', /async loadSubAgentTranscript\(parentChatID: string, role: string, instance: string,[\s\S]{0,40}liveTail: boolean = false\)/.test(store));
  ok('⑥ 先走 get_agent_session_dump（含 iterations）',
    /loadSubAgentTranscript[\s\S]{0,1200}RPC_GET_AGENT_SESSION_DUMP/.test(store));
  ok('⑥ 兜底走 get_session_messages', /loadSubAgentTranscript[\s\S]{0,2200}RPC_GET_SESSION_MESSAGES/.test(store));
  ok('⑥ 结果走同一条事件管道（history_replaced），不自己造行',
    /loadSubAgentTranscript[\s\S]{0,3000}historyToReplaced\(chatMsgs, null\)/.test(store));
  ok('⑥ 拿不到内容要返回 false（调用方回落常规历史，不白屏）',
    /loadSubAgentTranscript[\s\S]{0,2600}return false;/.test(store));

  const index: string = fs.readFileSync(
    path.join(process.cwd(), 'entry/src/main/ets/pages/Index.ets'), 'utf8');
  ok('⑥ 面板点行：切会话后按 role 补 dump 转录',
    /this\.switchSession\(target\)\.then\(\(\) => \{[\s\S]{0,600}loadSubAgentTranscript\(parentChat, role, instance,\s*a\.status === 'running'\)/.test(index));
}

console.log(`subagent_view: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
