/**
 * 长按上下文菜单的**项集判据**（纯逻辑）—— 目前只有「迭代」粒度。
 *
 * ── 对齐 web（唯一权威）─────────────────────────────────────────────────────────────
 * `web/src/components/agent/MessageActions.tsx:291-301`：迭代菜单 = 思考 / 正文 / 全部 三项，
 * **空项按设计过滤**（"不给无内容的复制项"）—— 服务端会把"当前在飞迭代"（此刻往往还是空壳）
 * 记进历史 ⇒ 旧实现恒出 3 项，用户点「复制该迭代正文」只得到一个"没有可复制的内容" toast。
 *
 * 本仓的 3 项（`components/MenuSheets.ets` 的 iter 分支）语义：
 *   · `iter-reply`    = 复制该迭代**正文**   ⇒ 正文非空才给；
 *   · `iter-thinking` = 复制该迭代（**含思考**）⇒ 思考非空才给；
 *   · `iter-tools`    = 复制该迭代（**含工具**）⇒ 工具有内容才给。
 * ⛔ **判据与渲染同源**：`components/MenuSheets.ets` 直接 `ForEach(iterMenuItems(...))`，
 *   组件内**不另写**过滤。判据可脱机单测（`tools/tests/ctxmenu.test.ts`）。
 *
 * ⚠️ 本文件属 `core/`：被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ 不许 import ArkUI/`@ohos.*`。
 */

/** 迭代菜单项 code（与页面 `runCtxAction` 的分派码一致）。 */
export const ITER_REPLY: string = 'iter-reply';
export const ITER_THINKING: string = 'iter-thinking';
export const ITER_TOOLS: string = 'iter-tools';

/** 一个菜单项（code + 展示文案）。 */
export class CtxMenuItem {
  code: string = '';
  label: string = '';
}

function item(code: string, label: string): CtxMenuItem {
  const m: CtxMenuItem = new CtxMenuItem();
  m.code = code;
  m.label = label;
  return m;
}

/**
 * 迭代菜单项集（**空项过滤**，对齐 web `MessageActions.tsx:298-301`）。
 * @param canReply   该迭代**正文**是否有内容
 * @param canThinking 该迭代**思考**是否有内容
 * @param canTools   该迭代**工具**是否有内容
 * @returns 非空项（保序：正文 → 含思考 → 含工具）；三项皆空 ⇒ **空数组**（菜单只剩取消）。
 */
export function iterMenuItems(canReply: boolean, canThinking: boolean, canTools: boolean): CtxMenuItem[] {
  const out: CtxMenuItem[] = [];
  if (canReply) { out.push(item(ITER_REPLY, '复制该迭代正文')); }
  if (canThinking) { out.push(item(ITER_THINKING, '复制该迭代（含思考）')); }
  if (canTools) { out.push(item(ITER_TOOLS, '复制该迭代（含工具）')); }
  return out;
}
