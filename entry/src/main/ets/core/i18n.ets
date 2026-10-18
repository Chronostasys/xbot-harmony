/**
 * 语言（locale）清单 + 运行时翻译（对齐 web `src/i18n/`：`zh-CN` / `en` / `ja`）。
 *
 * 数据源：`core/i18n_table.ets`（由 web `src/i18n/{zh-CN,en,ja}.ts` 自动生成，键/文案
 * 与 web **逐字同源**）。本文件只做纯查找（可脱机单测）⇒ UI 组件/页面用 `t('中文')`
 * 或 `tKey('common.close')`；`setLocale` 改变当前语言并通知订阅者重渲。
 */
import { I18N_KEYS, I18N_ZH, I18N_EN, I18N_JA } from './i18n_table';
import { NATIVE_ZH, NATIVE_EN, NATIVE_JA } from './i18n_native';

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

// ── 运行时翻译 ────────────────────────────────────────────────────────────────

let activeLocale: string = DEFAULT_LOCALE;

/** 中文原文 → 表下标（web zh 表里同一中文可能对应多个 key；取首个，语义足够）。 */
const zhIndex: Map<string, number> = new Map<string, number>();
const keyIndex: Map<string, number> = new Map<string, number>();

/** 归一化（去标点/空白、统一省略号）——web 表与原生硬编码文案的标点常差一个字符。 */
function normZh(x: string): string {
  let s: string = x.trim().toLowerCase();
  s = s.replace(/[\s\u3000]+/g, '');
  s = s.replace(/…/g, '.').replace(/⋯/g, '.').replace(/\.\.\./g, '.');
  s = s.replace(/[。！？!?,，、；;：:（）()【】\[\]“”"'`]/g, '');
  return s;
}

const zhNormIndex: Map<string, number> = new Map<string, number>();
for (let i = 0; i < I18N_KEYS.length; i++) {
  keyIndex.set(I18N_KEYS[i], i);
  if (!zhIndex.has(I18N_ZH[i])) {
    zhIndex.set(I18N_ZH[i], i);
  }
  const n: string = normZh(I18N_ZH[i]);
  if (n.length > 0 && !zhNormIndex.has(n)) {
    zhNormIndex.set(n, i);
  }
}

/**
 * 原生独有文案（web 表没有）的补充翻译。键 = 中文原文，值 = [en, ja]。
 * ⚠️ 只放**短 UI 标签**；长诊断文案保持中文回退（可后续补）。
 */
const nativeIndex: Map<string, number> = new Map<string, number>();
for (let i = 0; i < NATIVE_ZH.length; i++) {
  nativeIndex.set(NATIVE_ZH[i], i);
}

/** 语言切换订阅者（页面/长生命周期模块用于重建；组件本身在 build 时调用 `t`）。 */
const listeners: Array<() => void> = [];

function valueAt(i: number): string {
  if (activeLocale === 'en') {
    return I18N_EN[i].length > 0 ? I18N_EN[i] : I18N_ZH[i];
  }
  if (activeLocale === 'ja') {
    return I18N_JA[i].length > 0 ? I18N_JA[i] : I18N_ZH[i];
  }
  return I18N_ZH[i];
}

/** 按**中文原文**翻译（原生 overlay → web 精确 → web 归一化；都没有 ⇒ 原样返回）。 */
export function t(zh: string): string {
  const n: number | undefined = nativeIndex.get(zh);
  if (n !== undefined) {
    if (activeLocale === 'en') return NATIVE_EN[n];
    if (activeLocale === 'ja') return NATIVE_JA[n];
    return zh;
  }
  let i: number | undefined = zhIndex.get(zh);
  if (i === undefined) {
    i = zhNormIndex.get(normZh(zh));
  }
  return i === undefined ? zh : valueAt(i);
}

/** 按 web i18n key 翻译（`common.close` 等；缺 key ⇒ 返回 key 便于定位）。 */
export function tKey(key: string): string {
  const i: number | undefined = keyIndex.get(key);
  return i === undefined ? key : valueAt(i);
}

/**
 * 后台通知正文的**运行时本地化**（服务端 `FormatBgTaskCompletion` / cron / 合并通知生成，
 * 内容本身不是 i18n key，无法走 `t()`）。只翻译**协议标签/前后缀**；任务 ID、命令、
 * 输出正文原样保留（⛔ 不能把 shell 输出当文案改写）。
 *
 * 覆盖：`[System Notification] Background task … completed/failed/killed`、`Command/Status/
 * Elapsed/Exit Code/Error/Output`、`(no output)`、`⏰ [定时任务触发]`、`🔔 合并通知 ×N`、
 * 分节来源 `后台任务/子代理/定时任务/异步消息`。
 */
export function tNotification(text: string): string {
  if (text.length === 0) {
    return text;
  }
  let out: string = text;
  const pairs: string[][] = activeLocale === 'en'
    ? NOTIFICATION_EN
    : (activeLocale === 'ja' ? NOTIFICATION_JA : NOTIFICATION_ZH);
  for (let i = 0; i < pairs.length; i++) {
    const from: string = pairs[i][0];
    if (out.indexOf(from) >= 0) {
      out = out.split(from).join(pairs[i][1]);
    }
  }
  return out;
}

/** 中文通知 → 英文。 */
const NOTIFICATION_EN: string[][] = [
  ['[系统通知]', '[System Notification]'],
  ['后台子代理', 'Background subagent'],
  ['后台任务', 'Background task'],
  ['已完成。', 'completed.'],
  ['失败。', 'failed.'],
  ['被用户终止。', 'killed by user.'],
  ['定时任务触发', 'Scheduled task triggered'],
  ['合并通知', 'Merged notifications'],
  ['子代理', 'Subagent'],
  ['定时任务', 'Scheduled task'],
  ['异步消息', 'Async message'],
  ['命令：', 'Command: '],
  ['状态：', 'Status: '],
  ['耗时：', 'Elapsed: '],
  ['退出码：', 'Exit Code: '],
  ['错误：', 'Error: '],
  ['输出：', 'Output: '],
  ['输出（已截断', 'Output (truncated'],
  ['（无输出）', '(no output)'],
];

/** 英文/中文通知 → 日文。 */
const NOTIFICATION_JA: string[][] = [
  ['[System Notification]', '[システム通知]'],
  ['[系统通知]', '[システム通知]'],
  ['Background subagent', 'バックグラウンドサブエージェント'],
  ['Background task', 'バックグラウンドタスク'],
  ['后台子代理', 'バックグラウンドサブエージェント'],
  ['后台任务', 'バックグラウンドタスク'],
  [' completed.', ' が完了しました。'],
  [' failed.', ' が失敗しました。'],
  [' killed by user.', ' はユーザーにより停止されました。'],
  ['已完成。', ' が完了しました。'],
  ['失败。', ' が失敗しました。'],
  ['被用户终止。', ' はユーザーにより停止されました。'],
  ['[定时任务触发]', '[定期タスク実行]'],
  ['定时任务触发', '定期タスク実行'],
  ['合并通知', '統合通知'],
  ['子代理', 'サブエージェント'],
  ['定时任务', '定期タスク'],
  ['异步消息', '非同期メッセージ'],
  ['Command:', 'コマンド:'],
  ['命令：', 'コマンド:'],
  ['Status:', 'ステータス:'],
  ['状态：', 'ステータス:'],
  ['Elapsed:', '経過:'],
  ['耗时：', '経過:'],
  ['Exit Code:', '終了コード:'],
  ['退出码：', '終了コード:'],
  ['Error:', 'エラー:'],
  ['错误：', 'エラー:'],
  ['Output (truncated', '出力（切り詰め'],
  ['输出（已截断', '出力（切り詰め'],
  ['Output:', '出力:'],
  ['输出：', '出力:'],
  ['(no output)', '（出力なし）'],
  ['（无输出）', '（出力なし）'],
];

/** 英文/日文通知 → 中文（中文用户看到服务端英文模板时）。 */
const NOTIFICATION_ZH: string[][] = [
  ['[System Notification]', '[系统通知]'],
  ['Background subagent', '后台子代理'],
  ['Background task', '后台任务'],
  [' completed.', ' 已完成。'],
  [' failed.', ' 失败。'],
  [' killed by user.', ' 已被用户终止。'],
  ['Command:', '命令：'],
  ['Status:', '状态：'],
  ['Elapsed:', '耗时：'],
  ['Exit Code:', '退出码：'],
  ['Error:', '错误：'],
  ['Output (truncated', '输出（已截断'],
  ['Output:', '输出：'],
  ['(no output)', '（无输出）'],
];

export function getLocale(): string {
  return activeLocale;
}

/** 设置当前语言并通知订阅者（幂等：同值不通知）。 */
export function setLocale(id: string): void {
  const next: string = normalizeLocale(id);
  if (next === activeLocale) {
    return;
  }
  activeLocale = next;
  for (let i = 0; i < listeners.length; i++) {
    listeners[i]();
  }
}

/** 启动时用服务端/本地保存的值初始化（不通知：尚未渲染）。 */
export function initLocale(saved: string | undefined): void {
  activeLocale = normalizeLocale(saved);
}

/** 订阅语言变化；返回退订函数。 */
export function onLocaleChanged(fn: () => void): () => void {
  listeners.push(fn);
  return (): void => {
    const at: number = listeners.indexOf(fn);
    if (at >= 0) {
      listeners.splice(at, 1);
    }
  };
}
