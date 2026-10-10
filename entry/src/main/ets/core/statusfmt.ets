/**
 * 状态栏的**纯格式化逻辑**（可脱机单测）。
 *
 * 为什么单独抽出：这些文案要在极窄的一行里并排显示（模型 / token 用量 / todos / goal），
 * 数字与百分比算错会直接误导用户（例如把 12.3k 的 prompt 当成上下文占用）。纯函数便于钉死。
 */
import { GoalInfo, TodoItem, TokenUsage } from './types';

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

/** todos 进度：`3/7`（无 todo 返回空串）。 */
export function todoProgress(todos: TodoItem[] | undefined): string {
  if (todos === undefined || todos.length === 0) {
    return '';
  }
  let done: number = 0;
  for (let i = 0; i < todos.length; i++) {
    if (todos[i].status === 'completed') {
      done++;
    }
  }
  return `${done}/${todos.length}`;
}

/** 当前正在做的那条 todo（无则返回空串）。 */
export function currentTodo(todos: TodoItem[] | undefined): string {
  if (todos === undefined) {
    return '';
  }
  for (let i = 0; i < todos.length; i++) {
    if (todos[i].status === 'in_progress') {
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

/** 状态栏的模型名（拿不到返回空串）。 */
export function modelText(u: TokenUsage | undefined): string {
  if (u === undefined || u.model === undefined || u.model.length === 0) {
    return '';
  }
  return u.model;
}
