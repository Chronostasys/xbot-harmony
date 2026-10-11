/**
 * reasoningopen —— 思考块展开态的**跨形态共享**存储（逐字移植 web
 * `src/components/agent/reasoningOpenState.ts`）。
 *
 * 背景（web 用户 2026-09-12 报告，本仓同病）：live 迭代 commit 成历史迭代时，
 * 已展开的思考块会**自动收起**。根因是形态切换必然 remount（流式由 `LiveTailView`
 * 渲染、commit 后由 `MessageRow` 渲染），而展开态原本各自是组件内部 `@State`
 * （本仓现状：`LiveTailView.reasonOpen` vs `MessageRow.openReasonKey`，两组件互不相通）
 * ⇒ remount 即丢失。
 *
 * 方案（与 web 同构）：把展开态按「逻辑迭代」在**模块级共享**（key = `turnID:iteration`），
 * live 与 committed 两种形态读写同一份状态 ⇒ remount 后初始值即用户此前的选择，
 * 视觉上不发生收起。
 *
 * 有界：最多 `REASONING_OPEN_MAX` 条，**LRU 淘汰**（读也算使用）—— 长会话/切会话不无界增长。
 *
 * ⚠️ 本文件属 `core/`：被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ 不许 import ArkUI/`@ohos.*`。
 * ⚠️ 模块级单例（同 `core/sserec.ets` 的 `sseRecorder`）⇒ 测试之间用 `resetReasoningOpenState()`
 *    隔离（web 叫 `__resetReasoningOpenState`，本仓去掉下划线前缀以过 lint）。
 */

/** 展开态最大条目数（web `MAX_ENTRIES`）。 */
export const REASONING_OPEN_MAX: number = 300;

/** key → 是否展开（Map 迭代序 = LRU 序：末尾最新）。 */
const openByKey: Map<string, boolean> = new Map<string, boolean>();

/**
 * 读取某迭代思考块的展开态。
 * @returns 有记录 ⇒ 该布尔值（并把该 key 移到 LRU 末尾）；无记录 ⇒ `undefined`
 *          （调用方据此回落 `defaultOpen` —— 与 web 一致，**不**凭空造默认值）。
 */
export function getReasoningOpen(key: string): boolean | undefined {
  const v: boolean | undefined = openByKey.get(key);
  if (v !== undefined) {
    // 重新插入以保持"最近使用"顺序（Map 迭代顺序 = 插入顺序）。
    openByKey.delete(key);
    openByKey.set(key, v);
  }
  return v;
}

/** 记录某迭代思考块的展开态（超上限 ⇒ 淘汰最久未用的）。 */
export function setReasoningOpen(key: string, open: boolean): void {
  if (openByKey.has(key)) {
    openByKey.delete(key);
  }
  openByKey.set(key, open);
  while (openByKey.size > REASONING_OPEN_MAX) {
    const oldest: string | undefined = openByKey.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    openByKey.delete(oldest);
  }
}

/**
 * 思考块展开态的共享 key —— **live 与 committed 必须用同一个构造函数**
 * （web `reasoningKey`；`turnID` 空/`null` ⇒ 0，与原实现 `turnID ?? 0` 一致）。
 */
export function reasoningKey(turnID: number | null | undefined, iteration: number): string {
  const t: number = turnID === null || turnID === undefined ? 0 : turnID;
  return `${t}:${iteration}`;
}

/** 当前条目数（诊断/测试用）。 */
export function reasoningOpenSize(): number {
  return openByKey.size;
}

/** 测试用：清空（模块级单例，跨用例必须隔离）。 */
export function resetReasoningOpenState(): void {
  openByKey.clear();
}
