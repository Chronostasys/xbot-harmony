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
 *   `if (arrPresent(e.streaming_tools) && xs[0]) { … }`
 * ✅ **类型谓词**（`v is T[]`）：真分支内 `v` 收窄为 `T[]` ⇒ 可直接 `.length` / 索引。
 *    语义仍为"存在且**非空**"（谓词只保证"非 null/undefined 的数组"，空数组时返回
 *    `false`，故真分支内取元素恒安全）。
 */
export function arrPresent<T>(v: T[] | null | undefined): v is T[] {
  return v !== undefined && v !== null && v.length > 0;
}

/**
 * 值存在（既非 `undefined` 也非 `null`）—— 通用三态守卫（数组/映射/对象通用）。
 *
 * ✅ **类型谓词**（`v is T`，2026-10-11 升级）：`isPresent(x) ? x : y` 在**赋值 / 成员访问 /
 *    `.length`** 位置也能通过类型检查（`x` 收窄为 `T`）。
 *
 * ⛔ 为什么必须升级：返回 `boolean` 时 TS **不做收窄**，`isPresent(cfg) ? cfg : def` 里
 *    `cfg` 仍是 `T | null | undefined` ⇒ 赋值报 TS2322、成员访问报 TS18049/TS18048。
 *    于是调用方被迫退回裸三态（`x !== undefined && x !== null`）——正是缺陷形态的来源。
 *    升级后 `isPresent` 可用于任意位置，不再需要 `as` 兜底。
 *    取证与判别力见 `tools/tests/null_boundary.test.ts`。
 */
export function isPresent<T>(v: T | null | undefined): v is T {
  return v !== undefined && v !== null;
}

/**
 * **非空字符串**守卫 —— `nonEmpty` 的**唯一出口**（2026-10-11 收敛，QA 抓到真漂移）。
 *
 * 收敛前本仓有 **3 份**同名实现，其中两份是 `s !== undefined && s.length > 0`
 * ⇒ **对 `null` 会抛**（`null.length`），而第三份（`channelscfg`）用 `isPresent` ⇒ 安全。
 * 同一事实（"是否非空串"）对 `null` 输入给出两种行为 ⇒ **真漂移**（本模块头注释那类
 * "`x !== undefined` 对 `null` 为真 ⇒ `x.length` 抛"的缺陷形态，只是这回藏在同名助手体内）。
 * 收敛到**更宽的那份**（`isPresent` 版）：对合法输入行为完全相同，对越界输入**不崩** ⇒ 兼容。
 */
export function nonEmpty(v: string | null | undefined): boolean {
  return isPresent(v) && v.length > 0;
}

/**
 * **对象**守卫 —— `asRecord` 的**唯一出口**（2026-10-11 收敛，QA 抓到"逐字重复"）。
 *
 * 收敛前 `core/normalize.ts:45` 与 `core/progress_types.ts:67` 各有一份**表达式逐字相同**的实现
 * （唯一差别是分号）⇒ 属"语义等价但重复"，两份任一被改都会静默漂移。
 * 放本模块（叶子、0 import）**无环**：`normalize.ts` 依赖 `chat_types_full`/`chattypes`，
 * `progress_types.ts` 依赖 `chattypes` ⇒ 二者引入本模块不构成环。
 *
 * 语义（**与收敛前逐字一致，未改**）：非 null 对象且非数组 ⇒ 该对象；否则 `null`
 * （⚠️ 空对象 `{}` 是**合法**结果；数组 / 标量 / null / undefined ⇒ `null`）。
 */
export function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
