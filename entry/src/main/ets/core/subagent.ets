/**
 * subagent.ets —— 「SubAgent 进度树」的**纯逻辑**：状态归档 + 可见性过滤 + 树 → 扁平行。
 *
 * 权威基准（web）：`web/src/components/agent/SubAgentProgressTree.tsx`
 *   · `:68-70`  顶层**只渲染 running / pending**（已完成的 SubAgent 已由 FoldedToolGroup
 *               的工具调用行展示 ⇒ 再渲染一次就是重复；`runningNodes.length === 0 ⇒ null`）
 *   · `:80-82`  状态归档：`running` = running|active|pending；`done` = done|completed；
 *               `errored` = error|failed；其余归"其它"（图标走 muted）
 *   · `:95-99`  左侧 2px 竖条配色：errored → `--destructive`（= `--status-error`，
 *               web `index.css:231`）；done → `accent` @30%；否则 → `accent`
 *   · `:127-135` 状态图标：running → Sparkles(accent)；done → Check(text-muted)；
 *               errored → AlertCircle(destructive)；其它 → Sparkles(text-muted)
 *   · `:138-146` 标签 = `role` + (instance 时 `:` + instance)；`:147-151` desc 单行截断
 *   · `:154-167` 子节点：虚线左边框 + 缩进（`ml-3 pl-3`），**不按状态过滤**（父在即渲染）
 *
 * ⛔ 为什么这里要"树 → 扁平行"：ArkUI 的 `@Component.build()` **不能递归**（没有自引用组件），
 *    嵌套树必须**预展平**成带 `depth` 的行数组再用一维 `ForEach` 渲染（web 用 React 递归）。
 *    展平是纯计算 ⇒ 放这里（可脱机单测），组件只做"照着画"。
 *
 * ⛔ 本文件属 `core/`：`tools/tests/run.sh` 把它当**纯 TS** 编译 ⇒ 禁止 import ArkUI / `@ohos.*`。
 */
import { WebSubAgentProgress } from './chattypes';

/** 状态档：running（含 pending/active）。 */
export const SUB_RUNNING: string = 'running';
/** 状态档：done（含 completed）。 */
export const SUB_DONE: string = 'done';
/** 状态档：error（含 failed）。 */
export const SUB_ERROR: string = 'error';
/** 状态档：其它（图标走 muted，配色同 running）。 */
export const SUB_OTHER: string = 'other';

/**
 * 状态字符串 → 状态档。逐字对齐 web `SubAgentProgressTree.tsx:80-82`。
 * ⚠️ 未知/空值一律归 `SUB_OTHER`（**不**当作 running，避免"幽灵进行中"）。
 */
export function subStatusKind(status: string | undefined): string {
  const s: string = status !== undefined ? status : '';
  if (s === SUB_RUNNING || s === 'active' || s === 'pending') {
    return SUB_RUNNING;
  }
  if (s === SUB_DONE || s === 'completed') {
    return SUB_DONE;
  }
  if (s === SUB_ERROR || s === 'failed') {
    return SUB_ERROR;
  }
  return SUB_OTHER;
}

/** 是否"在飞"（web `:80`）—— 决定图标用 accent 还是 muted。 */
export function isLiveSubAgent(status: string | undefined): boolean {
  return subStatusKind(status) === SUB_RUNNING;
}

/**
 * 顶层可见节点（web `:68-70`）：**只保留 running/pending**。
 * 已完成的 SubAgent 由工具调用行承担展示 ⇒ 这里再画就是重复。
 */
export function visibleRoots(nodes: WebSubAgentProgress[] | undefined): WebSubAgentProgress[] {
  const out: WebSubAgentProgress[] = [];
  if (nodes === undefined) {
    return out;
  }
  for (let i = 0; i < nodes.length; i++) {
    if (isLiveSubAgent(nodes[i].status)) {
      out.push(nodes[i]);
    }
  }
  return out;
}

/** 面板可见标签：`role` + （有 instance 时）`:` + instance（对齐 web `:138-146`）。 */
export function subAgentLabel(role: string, instance: string | undefined): string {
  const inst: string = instance !== undefined ? instance : '';
  return inst.length > 0 ? `${role}:${inst}` : role;
}

/**
 * 树 → 扁平行（供 ArkUI 一维 ForEach）。深度 0 = 卡片；深度 ≥1 = 虚线缩进子行。
 * 子节点**不做状态过滤**（对齐 web `:154-167`：父在即渲染）。
 */
export interface SubAgentRow {
  /**
   * 稳定身份（path + role + instance）—— 用于"同一节点"的识别/未来 diff。
   * ⚠️ **不要**直接拿它当 ArkUI 的 ForEach key（见 `key`）。
   */
  id: string;
  /**
   * ArkUI `ForEach` key = `id` + **可变内容指纹**（kind/desc 长度）。
   * ⛔ 必须随内容变化：ArkUI 的 ForEach **key 不变则不重建该项**（ARKTS-GOTCHAS §3），
   *    而子组件是 `@Prop` 驱动的真组件 —— key 不变 ⇒ @Prop 不更新 ⇒ 状态图标/描述卡在首帧。
   *    这一点与 web（React 按键身份 + 每帧 re-render）语义不同，是本仓的既定适配手法
   *    （同 `rowdiff.sessionScopedRowKey` 的 `rev`）。
   */
  key: string;
  /** 缩进层级（0 = 顶层卡片）。 */
  depth: number;
  /** 显示标签（`role:instance`）。 */
  label: string;
  /** 副标题描述（可能为空串 ⇒ 不渲染该段）。 */
  desc: string;
  /** 状态档 `SUB_*`。 */
  kind: string;
  /** 是否有子节点（web `hasChildren`；当前实现子节点恒展开，保留字段供折叠能力）。 */
  hasChildren: boolean;
  /** 可跳转的 SubAgent 会话键（空串 = 不可点，web `disabled={!sessionKey}`）。 */
  sessionKey: string;
  /** 是否可点开（`sessionKey` 非空 **且** 宿主提供了 onOpen 回调）。 */
  openable: boolean;
}

function rowKeyOf(id: string, kind: string, desc: string): string {
  return `${id}#${kind}#${desc.length}`;
}

/**
 * 展平：`visibleRoots(nodes)` 的每个节点 + 其**全部后代**（任意深度）。
 *
 * @param nodes 该迭代（或 live 快照）的 SubAgent 树；undefined/空 ⇒ 返回空数组
 *              （调用方据此**零渲染**）。
 * @param withSession 宿主是否提供跳转回调（决定 `openable`；纯逻辑不关心 UI，只做布尔）。
 */
export function flattenSubAgents(
  nodes: WebSubAgentProgress[] | undefined,
  withSession: boolean,
): SubAgentRow[] {
  const out: SubAgentRow[] = [];
  const roots: WebSubAgentProgress[] = visibleRoots(nodes);
  for (let i = 0; i < roots.length; i++) {
    appendNode(out, roots[i], 0, `${i}`, withSession);
  }
  return out;
}

function appendNode(
  out: SubAgentRow[],
  node: WebSubAgentProgress,
  depth: number,
  path: string,
  withSession: boolean,
): void {
  const role: string = node.role !== undefined ? node.role : '';
  const inst: string = node.instance !== undefined ? node.instance : '';
  const desc: string = node.desc !== undefined ? node.desc : '';
  const kind: string = subStatusKind(node.status);
  const key: string = node.sessionKey !== undefined ? node.sessionKey : '';
  const kids: WebSubAgentProgress[] = node.children !== undefined ? node.children : [];
  const id: string = `${path}|${role}|${inst}`;
  out.push({
    id,
    key: rowKeyOf(id, kind, desc),
    depth,
    label: subAgentLabel(role, node.instance),
    desc,
    kind,
    hasChildren: kids.length > 0,
    sessionKey: key,
    openable: withSession && key.length > 0,
  });
  for (let j = 0; j < kids.length; j++) {
    appendNode(out, kids[j], depth + 1, `${path}.${j}`, withSession);
  }
}

/** 该树是否有任何可渲染的行（= 组件是否产出节点的**唯一**判据）。 */
export function hasVisibleSubAgents(nodes: WebSubAgentProgress[] | undefined): boolean {
  return visibleRoots(nodes).length > 0;
}
