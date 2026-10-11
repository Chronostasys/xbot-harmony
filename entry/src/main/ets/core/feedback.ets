/**
 * 交互反馈的**共享口径**（纯逻辑，可脱机单测）。
 *
 * ── 复制反馈 ────────────────────────────────────────────────────────────────
 * web 在代码块复制按钮上把图标切成 `Check`、并在 **1200ms** 后切回
 * （`web/src/components/agent/MarkdownRenderer.tsx:95-108` 的 `copied` 态 +
 *  `:364` 的 `window.setTimeout(() => setCopied(false), 1200)`）。
 * 原生用文本「已复制」表达同一反馈（图标集里没有跨主题稳定的 check 副本语义，
 * 且文本在 11px 语言条上与「复制」同宽，切换不引起抖动）。
 *
 * 纯函数 ⇒ 可脱机单测（`tools/tests/feedback.test.ts`）。本文件属 `core/`，会被
 * `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ **禁止** import ArkUI / `@ohos.*`。
 */

/** 复制后的可见反馈时长（ms）—— **对齐 web `MarkdownRenderer.tsx:364` 的 1200ms**。 */
export const COPY_FEEDBACK_MS: number = 1200;

/**
 * 复制按钮的展示文案（`copied` ⇒ 「已复制」，否则原样）。
 * @param base 静息文案（如「复制」）
 * @param copied 是否处于"刚复制完"的反馈窗口
 */
export function copyLabel(base: string, copied: boolean): string {
  return copied ? '已复制' : base;
}
