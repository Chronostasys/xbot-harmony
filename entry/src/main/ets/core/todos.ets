/**
 * todos.ets —— 「Todo 拉出面板」（web `components/agent/TodoPullOut.tsx` + `hooks/useTodos.ts`）
 * 的**纯逻辑**：状态归一 / 进度统计 / 行变换（勾选·改名·删除）/ goal 行判定。
 *
 * 权威基准（web）：
 *   · 状态词汇 `"pending" | "doing" | "done"` —— **服务端权威**：
 *     `xbot/tools/todo.go:15`、`xbot/protocol/events.go:19`（`Status string // "pending" | "doing" | "done"`）
 *   · 统计 `web/src/hooks/useTodos.ts:34-43`
 *         `total = todos.length`；`doneCount = todos.filter(t => t.status === 'done').length`；
 *         `currentTask = todos.find(t => t.status !== 'done') ?? null`
 *     ⚠️ 该文件 :37-39 记了一个真实事故：`filter(t => t.status)` 对任何非空串都真
 *        ⇒ `doneCount === total` ⇒ 显示"4/4 全部完成"但展开全是圆圈 ⇒ **必须 `=== 'done'`**。
 *   · 行变换 `TodoPullOut.tsx:66-84`：
 *         `commitEdit`：trim；**空串或未变更 ⇒ 原样返回**（"清空文本会静默丢一条清单项"）；
 *         `toggleDone`：`status === 'done' ? 'pending' : 'done'`；
 *         `removeTodo`：按索引过滤。
 *   · goal 行判定 `TodoPullOut.tsx:128`：`!!goalText && goalText.trim() === todo.text.trim()`
 *   · 空列表不渲染 `:56` `if (total === 0) return null`
 *   · 持久化（**接线波用**）`web/src/components/agent/api.ts:190-198`：
 *     RPC `set_todos`，params `{channel, chat_id, todos: [{text, status}]}`（只发 text+status）
 *
 * ⛔ 本文件属 `core/`：`tools/tests/run.sh` 把它当**纯 TS** 编译 ⇒ 禁止 import ArkUI / `@ohos.*`。
 * ⚠️ `TodoItem` 是 `core/types.ets` 的协议形状（可安全引用）。
 */
import { TodoItem } from './types';

/** 服务端权威状态词汇（`xbot/tools/todo.go:15`）。 */
export const TODO_PENDING: string = 'pending';
export const TODO_DOING: string = 'doing';
export const TODO_DONE: string = 'done';

/**
 * 状态归一 → 三档之一。
 *
 * ⚠️ 兼容映射（**幂等**、不改变已合法值）：
 *   - 老后端 `done: true` 已在数据边界归一成 `'done'`（`core/normalize.ts:64-67`），这里再兜一层；
 *   - 别名 `'in_progress' → doing`、`'completed' → done'`：**仅**为容错（见下方 Pitfalls：
 *     本仓 `core/statusfmt.ets:50,62` 正是按别名判的 ⇒ 拿不到服务端的真实词汇）。
 *   - 其它未知值 ⇒ `pending`（**不当成 done**：把未知当完成会让进度虚高、列表看起来全做完）。
 */
export function todoStatusKind(status: string | undefined): string {
  const s: string = status !== undefined ? status : '';
  if (s === TODO_DONE || s === 'completed') {
    return TODO_DONE;
  }
  if (s === TODO_DOING || s === 'in_progress') {
    return TODO_DOING;
  }
  return TODO_PENDING;
}

/** 是否已完成（**只认 `done`** —— 与 web `useTodos.ts:40` 同源）。 */
export function isTodoDone(status: string | undefined): boolean {
  return todoStatusKind(status) === TODO_DONE;
}

/** 条目文本（缺省空串）。 */
export function todoText(t: TodoItem | undefined): string {
  if (t === undefined) {
    return '';
  }
  const s: string | undefined = t.text;
  return s !== undefined ? s : '';
}

/** Todo 面板的统计快照（web `useTodos.ts:23-32` 的 `TodoState`）。 */
export interface TodoState {
  /** 已完成条数（`status === 'done'`）。 */
  doneCount: number;
  /** 总条数。 */
  total: number;
  /** 第一条**未完成**的条目索引（全完成 ⇒ -1）。 */
  currentIndex: number;
  /** 当前任务文本（`currentIndex < 0` ⇒ 空串）。 */
  currentText: string;
}

/**
 * 统计（逐字对齐 web `useTodos.ts:34-43`）。
 * ⚠️ 判据用 `todoStatusKind()` 归一后的值，但**语义等同** `=== 'done'`（不做 truthy 判定）。
 */
export function todoState(todos: TodoItem[] | undefined): TodoState {
  const list: TodoItem[] = todos !== undefined ? todos : [];
  let done: number = 0;
  let currentIndex: number = -1;
  for (let i = 0; i < list.length; i++) {
    const k: string = todoStatusKind(list[i].status);
    if (k === TODO_DONE) {
      done++;
    } else if (currentIndex < 0) {
      currentIndex = i;
    }
  }
  return {
    doneCount: done,
    total: list.length,
    currentIndex,
    currentText: currentIndex >= 0 ? todoText(list[currentIndex]) : '',
  };
}

/** 完成百分比（web `TodoPullOut.tsx:58` 的 `Math.round(doneCount/total*100)`；total=0 ⇒ 0）。 */
export function todoPercent(s: TodoState): number {
  if (s.total <= 0) {
    return 0;
  }
  return Math.round((s.doneCount / s.total) * 100);
}

/** `3/7` 文案（web `:106-108`）。 */
export function todoCountLabel(s: TodoState): string {
  return `${s.doneCount}/${s.total}`;
}

/**
 * 勾选/取消勾选第 i 条。
 * ⚠️ 逐字对齐 web `:76-80`：**只**在 `done` 与 `pending` 之间翻转（`doing` 也会被翻成 `done`）。
 */
export function toggleTodoAt(todos: TodoItem[], i: number): TodoItem[] {
  const out: TodoItem[] = [];
  for (let k = 0; k < todos.length; k++) {
    if (k !== i) {
      out.push(todos[k]);
      continue;
    }
    const cur: TodoItem = todos[k];
    const next: TodoItem = { text: todoText(cur) };
    next.status = isTodoDone(cur.status) ? TODO_PENDING : TODO_DONE;
    if (cur.id !== undefined) {
      next.id = cur.id;
    }
    out.push(next);
  }
  return out;
}

/**
 * 重命名第 i 条（web `:66-74` 的 `commitEdit`）。
 * ⛔ 两条**必须**保留的语义（web 注释明写）：文本 trim 后为空 ⇒ **原样返回**（不丢条目）；
 *    与原文相同 ⇒ 原样返回（不产生无谓写）。
 */
export function renameTodoAt(todos: TodoItem[], i: number, text: string): TodoItem[] {
  if (i < 0 || i >= todos.length) {
    return todos;
  }
  const next: string = text.trim();
  const prev: string = todoText(todos[i]);
  if (next.length === 0 || next === prev) {
    return todos;
  }
  const out: TodoItem[] = [];
  for (let k = 0; k < todos.length; k++) {
    if (k !== i) {
      out.push(todos[k]);
      continue;
    }
    const cur: TodoItem = todos[k];
    const repl: TodoItem = { text: next };
    if (cur.status !== undefined) {
      repl.status = cur.status;
    }
    if (cur.id !== undefined) {
      repl.id = cur.id;
    }
    out.push(repl);
  }
  return out;
}

/** 删除第 i 条（web `:82-84`；越界 ⇒ 原样返回）。 */
export function removeTodoAt(todos: TodoItem[], i: number): TodoItem[] {
  if (i < 0 || i >= todos.length) {
    return todos;
  }
  const out: TodoItem[] = [];
  for (let k = 0; k < todos.length; k++) {
    if (k !== i) {
      out.push(todos[k]);
    }
  }
  return out;
}

/**
 * 该条是否就是当前 goal（web `:128`）—— 用于行尾 `is goal` 徽标。
 * ⛔ goalText 为空 ⇒ **恒 false**（`!!goalText` 守卫；空串 trim 后会等于空文本条目，不能误标）。
 */
export function isGoalTodo(text: string, goalText: string | undefined): boolean {
  const g: string = goalText !== undefined ? goalText : '';
  if (g.length === 0) {
    return false;
  }
  const gt: string = g.trim();
  if (gt.length === 0) {
    return false;
  }
  return gt === text.trim();
}

/** `set_todos` 的请求体条目（web `api.ts:196-197` 只发 `{text, status}`，**不带 id**）。 */
export interface TodoPayloadRow {
  text: string;
  status: string;
}

/**
 * 变换成 `set_todos` 的 `todos` 数组（供接线波直接 `JSON.stringify`）。
 * ⚠️ status 先归一到服务端词汇（`todoStatusKind`）—— 避免把别名/未知值写回服务端。
 */
export function todoPayloadRows(todos: TodoItem[]): TodoPayloadRow[] {
  const out: TodoPayloadRow[] = [];
  for (let i = 0; i < todos.length; i++) {
    out.push({ text: todoText(todos[i]), status: todoStatusKind(todos[i].status) });
  }
  return out;
}

/** 面板是否该渲染（web `:56`：`total === 0 ⇒ null`）。 */
export function hasTodos(todos: TodoItem[] | undefined): boolean {
  return todos !== undefined && todos.length > 0;
}
