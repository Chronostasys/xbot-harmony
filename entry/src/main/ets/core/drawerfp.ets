/**
 * 抽屉分组视图的**求值缓存**判据（纯逻辑，可脱机单测；⛔ 不 import ArkUI —— run.sh 当纯 TS 编译）。
 *
 * 根因（线 A 审计 2026-10-14，用户亲报「agent 工作时滚侧边栏，极卡，几秒一帧」）：
 * 流式期间页级 build 每圈重跑 ⇒ `drawerGroups()`（含 `filteredSessions` O(n)×5 遍 + 3 次
 * `JSON.parse` + O(n log n) 排序，n≈684）被拖着每帧重算 22-33 次/秒。但**抽屉观察的输入
 * 在 token 帧内不变**（`sessions` 引用只在回合边界/重连换新数组；settings 仅用户操作换；
 * sessQuery/activeChannel 仅 UI 交互换）⇒ 同输入缓存命中即可 O(1) 返回，分帧成本归零。
 *
 * 失效键两条（缺一不可）：
 *  · `sessions` **数组对象引用恒等**——`loadSessions` 恒换新数组、无 mutate 路径 ⇒ 引用相同时
 *    内容必相同（引用判据失效只可能来自"原地改数组"，本仓无此路径）；
 *  · **四元指纹**：星标原始串（⛔ 用原始 setting 串参与指纹——真重算时才发生 parse，命中时
 *    **零 JSON 解析**）+ 分组分类 + 搜索词 + 渠道。
 * ⛔ 折叠态（collapsedGroups）**不在**失效键里：折叠只影响「组内行显隐」（渲染层
 * `isGroupCollapsed` 分支），不改变分组数据本身 ⇒ 分组内容不变，缓存不必失效。
 *
 * 手法复刻：`AnchorsMemo`（PERF-BUDGET §1.6h，流式每帧重建导航锚点表⇒结构指纹记忆化）、
 * `liveBlocksMemo`（§1.6b/d WeakMap 签名）——同款「判据纯函数 + 调用点接线 + 判别测试」。
 */

/**
 * 分组结果的四元指纹。任何一项变化 ⇒ 分组结果**必然**不同（每个输入都在求值路径上）：
 * 星标（参与 starredFirst 星标优先排序）、分类（路径/时间桶的切换决定分组函数本身）、
 * 搜索词与渠道（filteredSessions 的两个过滤判据）。
 */
export function drawerFingerprint(starredRaw: string, category: string, query: string,
  channel: string): string {
  return `${starredRaw}|${category}|${query}|${channel}`;
}

/**
 * 缓存命中判据：**引用恒等 + 指纹相等**才命中（首调 `prevRef === null` 恒 miss）。
 * 消费点：`pages/Index.ets` 的 `drawerGroups()` —— 命中返回缓存、未命中走全量求值后回填。
 */
export function drawerCacheHit(prevRef: object | null, nextRef: object,
  prevFp: string, nextFp: string): boolean {
  return prevRef === nextRef && prevFp === nextFp;
}
