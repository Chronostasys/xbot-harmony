/**
 * 语言（locale）清单 —— 对齐 web `src/i18n/`（`zh-CN` / `en` / `ja`）。
 *
 * ⚠️ **当前范围（诚实说明）**：原生端只做「读取 + 展示 + 透传」——
 * UI 文案仍是中文（硬编码在各组件里）。把全部文案抽成 i18n 表是一次**独立重构**
 * （原生端 ~100+ 处字符串，涉及 Index.ets / components/*），不宜混在视觉改造里半做。
 * 因此这里**不提供**可点的语言切换（避免出现"点了没反应"的假功能）。
 *
 * 纯数据 ⇒ 可脱机单测（`tools/tests/locale.test.ts`）。
 */

export class LocaleItem {
  id: string = '';
  label: string = '';
}

/** web `Locale` 的取值（顺序一致）。 */
export const LOCALES: LocaleItem[] = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
];

/** web 默认语言。 */
export const DEFAULT_LOCALE: string = 'zh-CN';

/** 规范化（未知回落默认）。 */
export function normalizeLocale(v: string | undefined): string {
  if (v === undefined) { return DEFAULT_LOCALE; }
  for (let i = 0; i < LOCALES.length; i++) {
    if (LOCALES[i].id === v) { return v; }
  }
  return DEFAULT_LOCALE;
}

/** 显示名（未知则原样返回，便于暴露脏数据而不是静默掩盖）。 */
export function localeLabel(id: string): string {
  for (let i = 0; i < LOCALES.length; i++) {
    if (LOCALES[i].id === id) { return LOCALES[i].label; }
  }
  return id;
}
