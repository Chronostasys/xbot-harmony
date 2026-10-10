/**
 * guards.ets —— 服务端 JSON 可选字段的**统一空值守卫**（P0 根治，2026-10-10）。
 *
 * 根因：Go 的 nil slice（`[]T(nil)`）经 encoding/json 序列化成 **JSON `null`**，而客户端
 * 接口把这类字段声明为 `T[] | undefined`（可选 = "字段可能缺失"，**不含 null 语义**）。
 * 于是 `x !== undefined` 对 `null` **为真** ⇒ 紧接着的 `x.length` 抛
 * `Cannot read property length of null`（真机：登录成功后立即「[加载会话] ...」）。
 *
 * 契约（本模块存在的理由）：**凡服务端经 JSON 回来的数组/映射字段，都可能为 null**。
 * 客户端读它们必须走本模块，而不是只判 `undefined`。
 *
 * ⚠️ ArkTS：无 any/unknown、无对象字面量作类型、无 spread；泛型函数合法
 * （参照 core/sessionpick.ets 的 `visibleRows<T>`）。
 */

/**
 * 把服务端可能为 `null`/`undefined` 的数组归一成**数组**（读循环的推荐入口）。
 *
 * 用法：`const xs: T[] = arrOrEmpty(serverField);` —— 之后 `xs.length`/`xs[i]` 恒安全，
 * 无需再写 `!== undefined` 判断（也不允许写 `!== undefined`，那正是缺陷形态）。
 */
export function arrOrEmpty<T>(v: T[] | null | undefined): T[] {
  return v === undefined || v === null ? [] : v;
}

/**
 * `x !== undefined && x.length > 0` 的 **null 安全版本**：数组存在**且非空**。
 *
 * 用法（判别式/短路场景，不想引入临时变量时）：
 *   `if (arrPresent(e.streaming_tools) && ...) { … }`
 * ⚠️ 不做类型收窄（与 TS 的 `Array.isArray` 不同）—— 取用元素仍需经 `arrOrEmpty`。
 */
export function arrPresent<T>(v: T[] | null | undefined): boolean {
  return v !== undefined && v !== null && v.length > 0;
}

/** 值存在（既非 `undefined` 也非 `null`）—— 通用三态守卫（数组/映射/对象通用）。 */
export function isPresent<T>(v: T | null | undefined): boolean {
  return v !== undefined && v !== null;
}
