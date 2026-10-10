/**
 * 状态栏的**纯格式化逻辑**（可脱机单测）。
 *
 * 为什么单独抽出：这些文案要在极窄的一行里并排显示（模型 / token 用量 / todos / goal），
 * 数字与百分比算错会直接误导用户（例如把 12.3k 的 prompt 当成上下文占用）。纯函数便于钉死。
 *
 * ── 2026-10-11 波7：修 todo 状态词汇 bug + 新增 goal 展示纯逻辑 ────────────────────
 * ⛔ **原 bug**：本文件旧版用 `status === 'completed'` / `'in_progress'` 判 todo 状态，
 *    而**服务端权威词汇是 `"pending" | "doing" | "done"`**
 *    （`xbot/tools/todo.go:15`、`xbot/protocol/events.go:19`；web 侧同 `done`/`doing`，
 *    `web/src/hooks/useTodos.ts:37-41`）⇒ 状态栏「todos N/M」**恒为 `0/N`**、
 *    `currentTodo()` **恒返回空串**（永远不显示"进行中"的那条）。
 *    修法：统一走 `core/todos.ets:todoStatusKind()`（单一口径，别再抄第二份判定）。
 * ⛔ 另有一处**跨文件**缺陷（本波只报告、未修）：`core/types.ets:369` 的 `GoalInfo` 是
 *    `{text?, status?}`，而真实数据来自 `core/chattypes.ts:9` 的 `{objective, status, summary}`
 *    （`core/normalize.ts:83-94 optGoal` 产出的就是 objective 形状）⇒ 本文件的
 *    `goalText(g)` 读 `g.text` **永远 undefined**，且 `core/store.ets:126` 的
 *    `goal` 字段**从未被赋值**（全仓 grep 无赋值点）⇒ 原生 goal 现状**完全不显示**。
 *    为绕开这个「两个同名 GoalInfo 命名碰撞」，goal 的新逻辑一律**只吃原始字符串**
 *    （`objective` / `status`），由接线方从数据源直接取串。
 */
import { GoalInfo, TodoItem, TokenUsage } from './types';
import { todoStatusKind, TODO_DONE, TODO_DOING } from './todos';

/** 大数缩写：1234 → 1.2k；1234567 → 1.2M。 */
export function humanTokens(n: number): string {
  if (n <= 0) {
    return '0';
  }
  if (n < 1000) {
    return `${n}`;
  }
  if (n < 1000 * 1000) {
    return `${(n / 1000).toFixed(n < 100000 ? 1 : 0)}k`;
  }
  return `${(n / (1000 * 1000)).toFixed(1)}M`;
}

/**
 * token 用量一行：`12.3k/1.0M 1%`。
 * 拿不到真实 usage（available=false 或没有 max）时返回空串 —— **绝不估算**（项目铁律）。
 */
export function usageText(u: TokenUsage | undefined): string {
  if (u === undefined || u.available !== true) {
    return '';
  }
  const max: number = u.max_context_tokens !== undefined ? u.max_context_tokens : 0;
  const used: number = u.prompt_tokens !== undefined ? u.prompt_tokens : 0;
  if (max <= 0) {
    return '';
  }
  const pct: number = u.usage_percent !== undefined
    ? Math.round(u.usage_percent * 10) / 10
    : Math.round(used * 1000 / max) / 10;
  return `${humanTokens(used)}/${humanTokens(max)} ${pct}%`;
}

/**
 * todos 进度：`3/7`（无 todo 返回空串）。
 * ⛔ 判据**只认 `done`**（服务端词汇，`tools/todo.go:15`）—— 走 `todoStatusKind` 单一口径。
 *    绝不用 truthy 判 status（web `useTodos.ts:37-39` 的 in-flight P0：`'pending'` 也是 truthy）。
 */
export function todoProgress(todos: TodoItem[] | undefined): string {
  if (todos === undefined || todos.length === 0) {
    return '';
  }
  let done: number = 0;
  for (let i = 0; i < todos.length; i++) {
    if (todoStatusKind(todos[i].status) === TODO_DONE) {
      done++;
    }
  }
  return `${done}/${todos.length}`;
}

/**
 * 当前**正在做**的那条 todo（无则返回空串）。
 *
 * ⛔ 语义**只认"进行中"**（`doing`）—— **不**取"第一条未完成"：待办（`pending`）尚未开始，
 *    不是"正在做"。这是原生既定语义，由既有测试 `tools/tests/statusfmt.test.ts:33`
 *    （`currentTodo([{status:'pending',text:'C'}]) === ''`，"无进行中"）钉死。
 *    ⚠️ 与 web `useTodos.ts:41` 的 `currentTask`（第一条非 done，**含 pending**）**不同** ——
 *    原生的 `currentTodo` 只服务状态栏「进行中：xxx」这一处文案，故不取 pending。
 *
 * 波7 修的是**词汇**：旧版判 `'in_progress'`（服务端从不发）⇒ **恒返回空串**；
 * 服务端权威词汇是 `'doing'`（`xbot/tools/todo.go:15`）⇒ 改判 `doing`（兼容 `in_progress`）。
 */
export function currentTodo(todos: TodoItem[] | undefined): string {
  if (todos === undefined) {
    return '';
  }
  for (let i = 0; i < todos.length; i++) {
    if (todoStatusKind(todos[i].status) === TODO_DOING) {
      // 显式收窄：带变量下标的元素访问不做类型收窄（content?: string 的同类坑）
      const t: string | undefined = todos[i].text;
      return t !== undefined ? t : '';
    }
  }
  return '';
}

/** goal 一行（纯文字状态前缀，无 emoji —— 设计系统 §2.8；无 goal 返回空串）。 */
export function goalText(g: GoalInfo | undefined): string {
  if (g === undefined || g.text === undefined || g.text.length === 0) {
    return '';
  }
  const done: boolean = g.status === 'completed' || g.status === 'done';
  return `${done ? '已完成：' : '目标：'}${g.text}`;
}

// ─── Goal 横幅（web `components/agent/GoalBanner.tsx`）──────────────────────────
//
// ⛔ 只吃**原始字符串**（objective / status），**不**吃 `GoalInfo`：`core/types.ets` 与
//    `core/chattypes.ts` 各有一个同名但字段不同的 `GoalInfo`（`text` vs `objective`，
//    见文件头说明），而 ArkTS 禁结构化类型 ⇒ 用一个类型就会在另一个数据源上编译失败。
//    接线方从数据源直接取串即可绕开（`progress.goal.objective` / `.status`）。

/** goal 状态徽标：进行中（web i18n `agent.goal.inProgress`，`i18n/zh-CN.ts:299`）。 */
export const GOAL_BADGE_ACTIVE: string = '进行中';
/** goal 状态徽标：已完成（web i18n `agent.goal.completed`，`i18n/zh-CN.ts:298`）。 */
export const GOAL_BADGE_DONE: string = '已完成';

/** Goal 横幅的展示模型（web `GoalBanner.tsx` 的形态判定）。 */
export class GoalDisplay {
  /** 目标原文（**单行截断由组件做**，web `:122-128`）。 */
  objective: string = '';
  /** 已完成（web `:37` `goal.status === 'completed'`）。 */
  completed: boolean = false;
  /** 进行中（有目标且未完成 ⇒ 显示编辑入口 + 呼吸点，web `:78-85,145`）。 */
  active: boolean = false;
  /** 状态徽标文案（web `:141`）。 */
  badge: string = '';
  /** 是否应渲染整个横幅（无 objective ⇒ **零节点**）。 */
  visible: boolean = false;
}

/**
 * goal 展示模型 —— 逐条对齐 web `GoalBanner.tsx`：
 *   · `completed = status === 'completed'`（`:37`；web 只认这一个值）
 *   · 文案为空 ⇒ **不渲染**（组件据此短路，web 由父级条件挂载）
 *   · 徽标：completed ? 已完成 : 进行中（`:141`）
 */
export function goalDisplay(objective: string | undefined, status: string | undefined): GoalDisplay {
  const out: GoalDisplay = new GoalDisplay();
  const obj: string = objective !== undefined ? objective : '';
  if (obj.length === 0) {
    return out;   // visible=false
  }
  const st: string = status !== undefined ? status : '';
  out.objective = obj;
  out.completed = st === 'completed';
  out.active = !out.completed;
  out.badge = out.completed ? GOAL_BADGE_DONE : GOAL_BADGE_ACTIVE;
  out.visible = true;
  return out;
}

/**
 * goal 就地编辑的**提交判据**（web `GoalBanner.tsx:52-58`）：
 * trim 后**非空且与原值不同** ⇒ 返回新值；否则返回 `null`（= 不提交，**保留原目标**）。
 * ⛔ 空串必须拒绝：清空会让 goal 静默消失（web 用 `if (trimmed && trimmed !== objective)` 同一守卫）。
 */
export function goalEditCommit(draft: string, original: string): string | null {
  const trimmed: string = draft.trim();
  if (trimmed.length === 0 || trimmed === original) {
    return null;
  }
  return trimmed;
}

/** 已完成的目标**不可点进编辑**（web `:120` `onClick={() => !completed && setEditing(true)}`）。 */
export function goalEditable(completed: boolean): boolean {
  return !completed;
}

/** 状态栏的模型名（拿不到返回空串）。 */
export function modelText(u: TokenUsage | undefined): string {
  if (u === undefined || u.model === undefined || u.model.length === 0) {
    return '';
  }
  return u.model;
}
