/**
 * termkey —— 终端「逐键输入」三态 diff 纯逻辑（面板 P0-1，目标④）。
 *
 * 背景（2026-10-13 面板差距审计 P0-1）：`TerminalSheet.submitInput` 只有回车整行
 * （`stdin: <行>\r`）一种通路 ⇒ vim / python REPL / ssh 密码 / shell 交互式 y-n
 * **全部收不到中间按键**（用户亲报「终端做的很差」）。web 侧 xterm.js 是全双工
 * 逐键（keydown→ws.send），原生没有.KeyEvent/IME 透传口，唯一可靠信号源是
 * 受控 `TextInput.onChange` 的前后值 diff。
 *
 * 三态判定（`stdinDelta(prev, next)`）——只认两种「对 PTY 行编辑安全」的形态：
 *  1. **纯 ASCII 尾追**：`next === prev + add` 且 add 全部是可直发字节
 *     （0x20..0x7E + '\t'）⇒ 返回 add，调用方即时 `stdin` 透传。
 *     —— 覆盖 vim 普通模式按键、REPL 逐字符、ssh 密码、y/n 单击等主场景。
 *  2. **单字 ASCII 尾删**：`prev === next + ch`（删一个可打印 ASCII）⇒ 返回 '\x7f'
 *     （DEL/退格），PTY readline 会回退一格，与文本框视觉同步。
 *  3. **其余一切**（中间编辑、多字删、粘贴重排、中文/emoji IME 组合）⇒ `null`：
 *     不透传，`sentThrough` 不动 —— 回车时由 `submitInput` 的擦除兜底接管。
 *
 * ⛔ 防「双发/丢字」两难的兜底设计（submitInput 侧，与 delta 配套）：
 *   回车时若 `sentThrough > 0`，先发 `'\x7f' × sentThrough` 把已透传的头部
 *   从 PTY 行上擦掉，再整行 `\r`。透传越多，擦得越多；完全没透传（旧版行为，
 *   全程 diff=null）⇒ 擦除为空 = 原样整行回车。**任何 diff 失配路径下都恒对**：
 *   中间插入的字符、中文、粘贴重排都在整行里被补齐，不会像「只发尾巴」那样
 *   静默丢插入内容，也不会像「整行直发」那样把已透传头部重复成双。
 *
 * 本文件纯逻辑（判据与渲染同源原则）；⛔ 禁 import ArkUI/@ohos.*（run.sh 纯 TS 编译）。
 */

/**
 * 该字节能否作为「安全直发」内容（PTY 行编辑不会吞/不会触发重排）。
 * 可打印 ASCII（0x20-0x7E）+ 水平制表。⛔ 不含 '\r' '\n'（回车属提交语义，
 * 由 onSubmit 走 submitInput），不含控制字节（Ctrl 组合另走 keyChip 编码）。
 */
export function safeTypeByte(ch: string): boolean {
  const c: number = ch.length === 1 ? ch.charCodeAt(0) : -1;
  return (c >= 0x20 && c <= 0x7e) || c === 0x09;
}

/** 退格 wire 字节（DEL）。PTY readline 收到即回退一格。 */
export const TERM_BACKSPACE: string = '\x7f';

/** 由 sentThrough 生成回车兜底的擦除前缀：`'\x7f' × max(0, sent)`。 */
export function eraserFor(sent: number): string {
  if (!Number.isFinite(sent) || sent <= 0) {
    return '';
  }
  const n: number = Math.min(Math.floor(sent), 4096);
  let out: string = '';
  for (let i: number = 0; i < n; i++) {
    out += TERM_BACKSPACE;
  }
  return out;
}

/**
 * 三态 diff：prev（上一次 onChange 的受控值）→ next（本次值）。
 *
 * @return 尾追段（可空串 = 无变化 → 调用方按无变化处理）、TERM_BACKSPACE、
 *         或 null（不安全形态 → 调用方只记录不透传）。
 *         ⚠️ prev===next 时返回 null 而非 ''（程序赋值回灌守卫：受控
 *         TextInput 在程序改 this.input 时也会回调 onChange，prev===next
 *         是回灌信号，必须当成「无事发生」处理而不是空串追加）。
 */
export function stdinDelta(prev: string, next: string): string | null {
  if (prev === next) {
    return null;
  }
  // 形态 1：纯 ASCII 尾追
  if (next.length > prev.length && next.startsWith(prev)) {
    const add: string = next.slice(prev.length);
    for (let i: number = 0; i < add.length; i++) {
      if (!safeTypeByte(add[i])) {
        return null;
      }
    }
    return add;
  }
  // 形态 2：单字 ASCII 尾删
  if (prev.length === next.length + 1 && prev.startsWith(next)) {
    const ch: string = prev.slice(prev.length - 1);
    if (safeTypeByte(ch)) {
      return TERM_BACKSPACE;
    }
    return null;
  }
  // 形态 3：中间编辑 / IME 组合 / 多字删除 —— 回退整行兜底
  return null;
}

/**
 * onChange 接线用的推进量：成功透传 delta 后 sentThrough 应增/减多少。
 * 尾追段按字符数累加；退格 wire 在字符串坐标上回退一格（'\x7f' 不占文本坐标）。
 * @return delta=null 或空 ⇒ 0（不推进）。
 */
export function sentThroughStep(delta: string | null): number {
  if (delta === null || delta.length === 0) {
    return 0;
  }
  if (delta === TERM_BACKSPACE) {
    return -1;
  }
  return delta.length;
}
