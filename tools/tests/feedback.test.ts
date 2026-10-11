/**
 * 复制反馈口径门禁 —— 守护 `core/feedback.ets`（复制按钮的可见反馈模型）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import { COPY_FEEDBACK_MS, copyLabel } from '../../entry/src/main/ets/core/feedback';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// 时长**逐字对齐 web**（`MarkdownRenderer.tsx:364` 的 1200ms）——改动即 UI 观感漂移。
eq('COPY_FEEDBACK_MS 对齐 web = 1200', COPY_FEEDBACK_MS, 1200);
eq('时长 > 0（否则反馈不可见）', COPY_FEEDBACK_MS > 0, true);

// 文案：静息原样、反馈窗口切「已复制」
eq('copyLabel 静息 ⇒ base', copyLabel('复制', false), '复制');
eq('copyLabel 反馈 ⇒ 已复制', copyLabel('复制', true), '已复制');
eq('copyLabel 不吞自定义 base', copyLabel('Copy', false), 'Copy');
eq('copyLabel 反馈恒定（与 base 无关）', copyLabel('任意', true), '已复制');

console.log(`  feedback: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
