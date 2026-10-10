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

/** 码点数（"思考 N 字"要用它，而不是 `length`）。 */
export function runeCount(text: string): number {
  return toRunes(text).length;
}

/** 取前 n 个码点（n<=0 返回空串；n 超长返回原串）。 */
export function clipRunes(text: string, n: number): string {
  if (n <= 0) {
    return '';
  }
  const runes: string[] = toRunes(text);
  if (n >= runes.length) {
    return text;
  }
  let out: string = '';
  for (let i = 0; i < n; i++) {
    out += runes[i];
  }
  return out;
}

/**
 * 一拍之后应该显示多少个码点。
 *
 * @param visible 当前可见码点数
 * @param target  目标（已收到的全部码点数）
 * @param cjkSkip true = 本拍因"CJK 半速"而跳过（前进 0 或不推进）
 * @returns 新的可见码点数（不会超过 target）
 */
export function advanceVisible(visible: number, target: number, cjkSkip: boolean): number {
  if (visible >= target) {
    return target;
  }
  const gap: number = target - visible;
  if (cjkSkip) {
    // CJK 半速：这一拍最多只走"基础步伐的一半"（四舍五入到至少 1，避免中文卡住不动）
    const half: number = Math.max(1, Math.floor(gap / 3 / 2));
    const next: number = visible + half;
    return next > target ? target : next;
  }
  const step: number = Math.max(1, Math.floor(gap / 3));
  const next: number = visible + step;
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
