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

/** **工具（组）**菜单项 code：逐枚 `copy-tool:<下标>`；组级「复制全部工具输出」。 */
export const TOOL_ITEM_PREFIX: string = 'copy-tool:';
export const TOOL_ALL: string = 'copy-all-tools';

/** 一个菜单项（code + 展示文案 + 置灰位）。 */
export class CtxMenuItem {
  code: string = '';
  label: string = '';
  /**
   * **置灰（不可点）** —— 复用 `MenuSheets.CtxItem` 的现成 `dim` 机制（`if (dim) { return; }`
   * ⇒ 派发被拒）；用于"这项此刻不适用但仍需**可见**以解释原因"的场合。
   */
  dim: boolean = false;
}

function item(code: string, label: string): CtxMenuItem {
  const m: CtxMenuItem = new CtxMenuItem();
  m.code = code;
  m.label = label;
  return m;
}

function itemDim(code: string, label: string, dim: boolean): CtxMenuItem {
  const m: CtxMenuItem = new CtxMenuItem();
  m.code = code;
  m.label = label;
  m.dim = dim;
  return m;
}

/** 用户消息菜单项 code（与页面 `runCtxAction` 的分派码一致）。 */
export const USER_TEXT: string = 'user-text';
export const USER_REWIND: string = 'user-rewind';

/**
 * **用户消息**菜单项集（对齐 web `UserMessage.tsx:315-334`：`编辑并重发` 有 `disabled={editDisabled}`）。
 * ⚠️ 与迭代/工具不同：这里**不隐藏**"编辑并重发"，而是**置灰**——web 也一样（按钮在、灰 0.2），
 * 因为"为什么不能编辑"本身就是信息（`dim` 可见而不可点）。
 * @param canRewind 该 user 消息此刻是否可 rewind（页面判定后投递）
 */
export function userMenuItems(canRewind: boolean): CtxMenuItem[] {
  const out: CtxMenuItem[] = [];
  out.push(item(USER_TEXT, '复制文本'));
  out.push(itemDim(USER_REWIND, '编辑并重发', !canRewind));
  return out;
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

/**
 * **工具（组）**菜单项集（对齐 web `MessageActions.tsx:302-312`）：
 * 逐枚工具一项（该枚**可复制文本非空**才给 —— web `toolCopyText(tl,'output')` 非空才 push）
 * + 组级「复制全部工具输出」（拼出的 `all` 非空才给）。空项按设计过滤（同 `iterMenuItems`）。
 *
 * @param names        逐枚工具名（用于 label `复制 <name>`）
 * @param hasText      逐枚「可复制文本非空」标记（长度可与 `names` 不等，缺位按 `false`）
 * @param allHasText   组级拼接是否非空（⇒ 给「复制全部工具输出」）
 * @returns 保序：逐枚（按下标）→ 组级；皆空 ⇒ **空数组**（菜单只剩取消）。
 */
export function toolsMenuItems(names: string[], hasText: boolean[], allHasText: boolean): CtxMenuItem[] {
  const out: CtxMenuItem[] = [];
  for (let i = 0; i < names.length; i++) {
    const has: boolean = i < hasText.length ? hasText[i] : false;
    if (has) { out.push(item(`${TOOL_ITEM_PREFIX}${i}`, `复制 ${names[i]}`)); }
  }
  if (allHasText) { out.push(item(TOOL_ALL, '复制全部工具输出')); }
  return out;
}
