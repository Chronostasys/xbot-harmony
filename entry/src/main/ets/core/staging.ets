/**
 * staging —— 「待发队列托盘」的**纯判据**（渲染侧 `components/StagingTray.ets` 只画）。
 *
 * ── 为什么单开一个模块 ─────────────────────────────────────────────────────────
 *   web 权威 `components/agent/StagingTray.tsx` 是**唯一没有原生对应物**的用户可见组件
 *   （`docs/WEB-PARITY.md` 表里的 `StagingTray` 行）—— 原生此前只在**顶栏**画一枚
 *   `队列 N` chip（点了开 `components/QueueSheet.ets`）。托盘把队列**提到输入区上方**
 *   （web 的位置：`MessageList` 与 `MessageInput` **之间**）⇒ 用户不必开面板就知道
 *   "还有几条排在后面、下一条是什么"。
 *
 * ── 铁律（同仓口径）────────────────────────────────────────────────────────────
 *   · 本文件属 `core/`：被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ ⛔ 不许 import
 *      ArkUI / `@ohos.*` / `.ets`。只吃 `core/types` 的 `QueueItem`（interface，纯类型）。
 *   · 判据与渲染**同源**：折叠预览 / 计数文案 / 条目 id / 列表高度**只此一处**，
 *     组件不另写一份（`tools/tests/staging.test.ts` 钉住）。
 *   · `QueueItem` 的 id 口径与 `components/QueueSheet.ets` 的 `idOf` **逐字一致**
 *     （`msg_id` 优先、其次 `id`）—— QueueSheet 已改为消费本函数（单一真源）。
 */

import { QueueItem } from './types';

/**
 * 队列条目的稳定 id（`msg_id` 优先，其次 `id`；都缺 ⇒ 空串）。
 *
 * ⚠️ 与 `components/QueueSheet.ets` 原 `idOf` **逐字一致**（该处已改为 import 本函数）。
 */
export function stagingItemId(q: QueueItem): string {
  return q.msg_id !== undefined ? q.msg_id : (q.id !== undefined ? q.id : '');
}

/** 条目可选正文（`content` 优先，回落 `text`）——同 `QueueSheet.textOf`。 */
export function stagingText(q: QueueItem): string {
  return q.content !== undefined && q.content.length > 0
    ? q.content
    : (q.text !== undefined ? q.text : '');
}

/**
 * 队列条目数文案（折叠态头部）：`N 条待发`。
 *
 * ⚠️ 中文量词用「条」（消息/待发）；⛔ 不写死单复数（`n === 1 ? '条' : '条'` 无意义）。
 */
export function stagingCountLabel(n: number): string {
  return `${n} 条待发`;
}

/** 数**码点**长度（代理对算 1）—— ⛔ ArkTS 禁 spread（`[...s]` = `arkts-no-spread`）⇒ 手数。 */
function codePointLen(s: string): number {
  let n: number = 0;
  for (let i = 0; i < s.length; i++) {
    const c: number = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      const d: number = s.charCodeAt(i + 1);
      if (d >= 0xDC00 && d <= 0xDFFF) {
        i++;   // 跳过低位代理 ⇒ 一个码点
      }
    }
    n++;
  }
  return n;
}

/** 取前 `maxCp` 个**码点**（不劈代理对；⛔ 不用 spread/slice-on-code-points）。 */
function truncateCodePoints(s: string, maxCp: number): string {
  let n: number = 0;
  let i: number = 0;
  while (i < s.length && n < maxCp) {
    const c: number = s.charCodeAt(i);
    i++;
    if (c >= 0xD800 && c <= 0xDBFF && i < s.length) {
      const d: number = s.charCodeAt(i);
      if (d >= 0xDC00 && d <= 0xDFFF) {
        i++;
      }
    }
    n++;
  }
  return s.substring(0, i);
}

/**
 * 折叠态一行的**预览**：取**首个非空行**、把连续空白压成单空格、按**码点**截断加省略号。
 *
 * 为什么按码点：ArkTS 的 `String.length` 是 UTF-16 单元数 ⇒ 直接 `slice` 会把代理对
 * （emoji / 罕见汉字）**劈成半个**（渲染成 �）。
 * ⛔ ArkTS 禁 spread（`arkts-no-spread`）⇒ 不能 `[...s]`；用 `codePointLen`/`truncateCodePoints`。
 *
 * @param text   原始正文（可多行）
 * @param maxLen 最大码点数（含省略号）；`maxLen <= 0` ⇒ 返回空串
 */
export function stagingPreview(text: string, maxLen: number): string {
  if (maxLen <= 0) {
    return '';
  }
  // 首个非空行（`split` 与 `trim` 都是纯标准库）。
  const lines: string[] = text.split('\n');
  let first: string = '';
  for (let i = 0; i < lines.length; i++) {
    const t: string = lines[i].trim();
    if (t.length > 0) {
      first = t;
      break;
    }
  }
  // 连续空白 → 单空格（含 tab / 全角空格 U+3000）—— ⛔ 用下标遍历（同禁 spread 的纪律）。
  let collapsed: string = '';
  let prevSpace: boolean = false;
  for (let i = 0; i < first.length; i++) {
    const ch: string = first.charAt(i);
    const isSpace: boolean = ch === ' ' || ch === '\t' || ch === '\u3000' || ch === '\r';
    if (isSpace) {
      if (!prevSpace) {
        collapsed += ' ';
      }
      prevSpace = true;
    } else {
      collapsed += ch;
      prevSpace = false;
    }
  }
  collapsed = collapsed.trim();
  // 码点截断（代理对安全）。
  if (codePointLen(collapsed) <= maxLen) {
    return collapsed;
  }
  // 留一位给省略号 ⇒ 正文取 maxLen-1 个码点。
  return truncateCodePoints(collapsed, maxLen - 1) + '…';
}

/**
 * 展开态列表的**有界高度**（vp）：条目越少越矮，超过上限则内部滚动。
 *
 * web 权威 `StagingTray.tsx` 头注：「长队列由列表容器的**内部滚动**（有界 max-h +
 * overflow-y-auto）容纳」—— 原生同口径（`List` + `constraintSize.maxHeight`）。
 *
 * 单条行高（vp）≈ `ROW_H`（`type.subhead` 单行 + 上下 `SPACE_SM`），上限 `MAX_H`。
 * ⚠️ 故意**不**引入 `HIT_TARGET_MIN` 作为行高：条目行只有「插队/取消」两枚 44 盒，
 *    行体本身**整行可点=取消**会与按钮冲突，故行高由内容定（≥44 由按钮撑）。
 */
export const STAGING_ROW_H: number = 44;
export const STAGING_MAX_H: number = 264;   // = 6 行

export function stagingListHeight(n: number): number {
  if (n <= 0) {
    return 0;
  }
  const h: number = n * STAGING_ROW_H;
  return h < STAGING_MAX_H ? h : STAGING_MAX_H;
}

/**
 * 折叠态是否应当展示「下一条」预览 —— 只有队首（`index === 0`）且预览非空。
 * 抽出来是为了让「有没有可展示的预览」这条判据也**单一真源**（组件不写 `index===0 && …`）。
 */
export function stagingHeadPreview(q: QueueItem | undefined, maxLen: number): string {
  if (q === undefined || q === null) {
    return '';
  }
  return stagingPreview(stagingText(q), maxLen);
}
