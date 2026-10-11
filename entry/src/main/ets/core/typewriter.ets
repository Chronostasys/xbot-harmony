/**
 * 打字机特效的**纯逻辑**（可脱机单测）。
 *
 * 算法逐条对齐 Web（`web/src/hooks/useTypewriter.ts`）与 TUI（`channel/cli/cli_animation.go`）：
 *   · 50ms 一拍；
 *   · **指数追赶**：每拍前进 `gap / 3`（至少 1 个字符）⇒ 无论落后多少，都在 log 级拍数内追平；
 *   · **CJK 半速**：CJK 字符每隔一拍才前进一次（否则中文会"哗"地一下全出来，失去打字机观感）；
 *   · `isTyping` = 可见字符数 < 目标字符数。
 *
 * 为什么要按"码点"而不是 `substring`：emoji/增补平面字符是代理对，用 UTF-16 下标切会切出半个字符
 * （真机上就是一个"乱码方块"）。
 */

export const TICK_MS: number = 50;

/** CJK 码点判定（与 TUI `isCJK` 同范围）。 */
export function isCJK(code: number): boolean {
  return (code >= 0x1100 && code <= 0x11ff)
    || (code >= 0x2e80 && code <= 0x9fff)
    || (code >= 0xa000 && code <= 0xa4ff)
    || (code >= 0xac00 && code <= 0xd7af)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xff00 && code <= 0xffef);
}

/** 把文本切成码点数组（代理对算一个）。 */
export function toRunes(text: string): string[] {
  const out: string[] = [];
  let i: number = 0;
  while (i < text.length) {
    const c: number = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      out.push(text.substring(i, i + 2));
      i += 2;
    } else {
      out.push(text.charAt(i));
      i += 1;
    }
  }
  return out;
}

/**
 * 从 `i` 起的**下一个码点占几个 UTF-16 单元**（代理对 = 2，其它 = 1）。
 * 判据与 `toRunes` **逐字同源**（含"末位孤立高代理按单单元处理"这一分支）——
 * 抽出来是为了让 `runeCount`/`clipRunes` **不分配整个码点数组**（流式每拍/每次 build 都调）。
 */
function runeWidthAt(text: string, i: number): number {
  const c: number = text.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
    return 2;
  }
  return 1;
}

/** 码点数（"思考 N 字"要用它，而不是 `length`）。 */
export function runeCount(text: string): number {
  // ⛔ 纯计数，**不建码点数组**：本函数在每次 build 里对每个块的思考文本各调一次
  //    （`components/MessageRow.ets` 的「思考 N 字」）；旧实现 `toRunes(text).length`
  //    为一个整数分配长度 ∝ 文本的 `string[]`（实测 8K 文本 ≈38 µs 里绝大部分是分配）。
  let n: number = 0;
  let i: number = 0;
  while (i < text.length) {
    i += runeWidthAt(text, i);
    n += 1;
  }
  return n;
}

/** 取前 n 个码点（n<=0 返回空串；n 超长返回原串）。 */
export function clipRunes(text: string, n: number): string {
  if (n <= 0) {
    return '';
  }
  // ⛔ 只**扫出第 n 个码点的 UTF-16 边界**再切一刀（单次 `substring`）：旧实现先建整个
  //    码点数组、再逐码点 `out += runes[i]` 拼串（≈文本长度次字符串拼接）。打字机每拍
  //    渲染都调它（`components/LiveTailView.ets` 的 `shownText`/`shownReason`）。
  let count: number = 0;
  let i: number = 0;
  while (i < text.length && count < n) {
    i += runeWidthAt(text, i);
    count += 1;
  }
  // 扫到了串尾（n ≥ 码点总数）⇒ 原样返回（与旧实现 `n >= runes.length` 分支一致）。
  if (i >= text.length) {
    return text;
  }
  return text.substring(0, i);
}

/** CJK 半速的"近追平"门限：基础步伐 ≤ 此值（web `useTypewriter.ts:106` `advance <= 3`）。 */
export const CJK_SLOW_ADVANCE_MAX: number = 3;
/** CJK 半速的"近追平"门限：剩余 gap ≤ 此值（web `useTypewriter.ts:106` `gap <= 20`）。 */
export const CJK_SLOW_GAP_MAX: number = 20;

/**
 * 一拍之后应该显示多少个码点。
 *
 * ⛔ **CJK 半速门限收在本函数内部**（对齐 web `useTypewriter.ts:98-113`，唯一判据）——
 *   调用方**不得**自行决定"任意 gap 都隔拍跳过"。web 权威：
 *     `if (nextIsCJK && advance <= 3 && gap <= 20) { flip; if (flip) return visible }`
 *   ⇒ 只有**近追平**窗口（落后很少）才做半速；落后很多时全速追赶（否则大段中文要等
 *   两倍拍数才出完）。
 *
 * ⛔ **跳过 = 前进 0**（不是"走一半"）。旧实现跳过时前进 `gap/6`（≥1），与 web 不符
 *   —— 大 gap 下反而比全速还快/乱，且 `advanceVisible(0,300,true)` 会得到 25（web 语义
 *   下门限不成立 ⇒ 应为 100）。
 *
 * @param visible 当前可见码点数
 * @param target  目标（已收到的全部码点数）
 * @param cjkSkip 调用方观测到：**下一枚码点是 CJK** 且 **本拍处于"隔拍"相位**（前进拍）
 * @returns 新的可见码点数（不会超过 target；跳过的拍原样返回 `visible`）
 */
export function advanceVisible(visible: number, target: number, cjkSkip: boolean): number {
  if (visible >= target) {
    return target;
  }
  const gap: number = target - visible;
  const advance: number = Math.max(1, Math.floor(gap / 3));
  // CJK 半速：**仅近追平**才隔拍跳过；跳过 = 本拍前进 0（web 同款）。
  if (cjkSkip && advance <= CJK_SLOW_ADVANCE_MAX && gap <= CJK_SLOW_GAP_MAX) {
    return visible;
  }
  const next: number = visible + advance;
  return next > target ? target : next;
}

/** 目标是否还在增长（用于判断"是否还在打字"）。 */
export function isTyping(visible: number, target: number): boolean {
  return visible < target;
}

/** 打字机速度的直观刻度（调试/自检展示用）。 */
export function catchUpTicks(gap: number): number {
  if (gap <= 0) {
    return 0;
  }
  let v: number = 0;
  let t: number = 0;
  while (v < gap && t < 1000) {
    v = advanceVisible(v, gap, false);
    t += 1;
  }
  return t;
}
