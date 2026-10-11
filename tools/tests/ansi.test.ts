/**
 * ANSI 着色门禁 —— **逐字移植** web `src/components/agent/AnsiText.tsx` 的
 * `parseAnsi()` 语义。本文件守护 `core/ansi.ets` 的纯函数（UI 只消费结果）。
 *
 * 用例分三组：
 *  · 颜色 / 属性 / 序列剥离 / `\r` 重写 —— 对齐 web 的既有断言；
 *  · 边界 —— 未闭合、截断、非法码（**逐条对齐 web 实测行为**，见对应注释）；
 *  · 流式稳定性 —— 「逐字/分块累积」与「一次喂」必须逐字一致。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  AnsiSpan, ANSI_DARK_PALETTE, ANSI_LIGHT_PALETTE, color256, incompleteTail, parseAnsi,
} from '../../entry/src/main/ets/core/ansi';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 期望值的形状：只带"被置上"的字段（便于书写）。 */
interface Exp {
  text: string; fg?: string; bg?: string; bold?: boolean; dim?: boolean;
  italic?: boolean; underline?: boolean; strike?: boolean; inverse?: boolean;
}
/** 把 AnsiSpan 投影成 Exp（丢掉 ''/false 的默认值）。 */
function proj(s: AnsiSpan): Exp {
  const o: Exp = { text: s.text };
  if (s.fg !== '') { o.fg = s.fg; }
  if (s.bg !== '') { o.bg = s.bg; }
  if (s.bold) { o.bold = true; }
  if (s.dim) { o.dim = true; }
  if (s.italic) { o.italic = true; }
  if (s.underline) { o.underline = true; }
  if (s.strike) { o.strike = true; }
  if (s.inverse) { o.inverse = true; }
  return o;
}
function projAll(segs: AnsiSpan[]): Exp[] { return segs.map(proj); }

const L = ANSI_LIGHT_PALETTE; // ['#24292f','#cf222e','#116329','#4d2d00', …]

// ── 基本前景 / 背景 / 复位 ──────────────────────────────────────────────────
eq('纯文本 ⇒ 单个无样式 span', projAll(parseAnsi('hello world', false)), [{ text: 'hello world' }]);
eq('31 红 + 0 复位', projAll(parseAnsi('\x1b[31merror\x1b[0m done', false)),
  [{ text: 'error', fg: '#cf222e' }, { text: ' done' }]);
eq('96 亮青（tsc 路径色）', projAll(parseAnsi('\x1b[96msrc/x.ts\x1b[0m', false)), [{ text: 'src/x.ts', fg: '#3198a3' }]);
eq('深色选深色板', projAll(parseAnsi('\x1b[31mx', true)), [{ text: 'x', fg: '#ff7b72' }]);
eq('背景 41 / 101', [
  proj(parseAnsi('\x1b[41mx', false)[0]).bg, proj(parseAnsi('\x1b[101mx', false)[0]).bg,
], ['#cf222e', '#a40e26']);
eq('39 / 49 复位前景背景', projAll(parseAnsi('\x1b[31;41mA\x1b[39;49mB', false)),
  [{ text: 'A', fg: '#cf222e', bg: '#cf222e' }, { text: 'B' }]);
// 自定义调色板：31 ⇒ pal[1]（映射到本仓 token 的口子）
const CUSTOM: string[] = new Array<string>(16).fill('#000000');
CUSTOM[1] = '#abcdef';
eq('注入自定义 16 色板', projAll(parseAnsi('\x1b[31mx', false, CUSTOM)), [{ text: 'x', fg: '#abcdef' }]);

// ── 属性叠加 ────────────────────────────────────────────────────────────────
eq('bold/dim/italic/underline/strike', [
  proj(parseAnsi('\x1b[1mx', false)[0]).bold,
  proj(parseAnsi('\x1b[2mx', false)[0]).dim,
  proj(parseAnsi('\x1b[3mx', false)[0]).italic,
  proj(parseAnsi('\x1b[4mx', false)[0]).underline,
  proj(parseAnsi('\x1b[9mx', false)[0]).strike,
], [true, true, true, true, true]);
eq('0 清颜色与属性；关闭码单清', projAll(parseAnsi('\x1b[31;1mx\x1b[0my\x1b[4mz', false)),
  [{ text: 'x', fg: '#cf222e', bold: true }, { text: 'y' }, { text: 'z', underline: true }]);
eq('22 关加粗', projAll(parseAnsi('\x1b[1mb\x1b[22mx', false)), [{ text: 'b', bold: true }, { text: 'x' }]);
eq('21 也关加粗暗淡', proj(parseAnsi('\x1b[1;2mc\x1b[21mx', false)[1]).bold ?? false, false);
eq('23/24/27/29 单关', projAll(parseAnsi('\x1b[3;4;7;9mX\x1b[23;24;27;29mY', false)),
  [{ text: 'X', italic: true, underline: true, strike: true, inverse: true }, { text: 'Y' }]);

// 反色（7）：**解析层不 swap**，只置 inverse 标记（web 在渲染期 swap；见 core/ansi.ets 头注）
eq('反色保留 raw fg/bg + inverse 标记', projAll(parseAnsi('\x1b[31;44;7mx', false)),
  [{ text: 'x', fg: '#cf222e', bg: '#0550ae', inverse: true }]);
eq('单独反色（无前景背景）不产生颜色', projAll(parseAnsi('\x1b[7mx', false)), [{ text: 'x', inverse: true }]);

// ── 256 色 / truecolor ──────────────────────────────────────────────────────
eq('256 立方 196 ⇒ rgb(255,0,0)', proj(parseAnsi('\x1b[38;5;196mx', false)[0]).fg, 'rgb(255,0,0)');
eq('256 灰阶起点 232 ⇒ rgb(8,8,8)', proj(parseAnsi('\x1b[38;5;232mx', false)[0]).fg, 'rgb(8,8,8)');
eq('256 背景 48;5;21', proj(parseAnsi('\x1b[48;5;21mx', false)[0]).bg, 'rgb(0,0,255)');
eq('color256 直接调用：16=黑 / 231=白 / 0-15 走板 / 越界回退 pal[7]', [
  color256(16, L), color256(231, L), color256(1, L), color256(999, L),
], ['rgb(0,0,0)', 'rgb(255,255,255)', L[1], L[7]]);
eq('truecolor 38;2', proj(parseAnsi('\x1b[38;2;10;20;30mx', false)[0]).fg, 'rgb(10,20,30)');
eq('truecolor 背景 48;2', proj(parseAnsi('\x1b[48;2;1;2;3mx', false)[0]).bg, 'rgb(1,2,3)');
// web 不支持冒号分参的 T.416 truecolor ⇒ 整段当纯文本保留（不"修"）
eq('冒号 truecolor 不支持 ⇒ 原样保留', projAll(parseAnsi('\x1b[38:2:10:20:30mx', false)),
  [{ text: '38:2:10:20:30mx' }]);

// ── 其它转义一律剥离 ────────────────────────────────────────────────────────
eq('光标移动 / 清屏剥离', projAll(parseAnsi('\x1b[2Jhello\x1b[1B', false)), [{ text: 'hello' }]);
eq('OSC（BEL 收尾）剥离', projAll(parseAnsi('\x1b]0;title\x07hi', false)), [{ text: 'hi' }]);
eq('OSC（ESC\\ 收尾）剥离', projAll(parseAnsi('\x1b]2;title\x1b\\hi', false)), [{ text: 'hi' }]);
eq('私有模式 ?25l 剥离', projAll(parseAnsi('\x1b[?25lhi', false)), [{ text: 'hi' }]);
eq('连续多序列各自成立', projAll(parseAnsi('\x1b[1;31;44mX\x1b[0mY', false)),
  [{ text: 'X', fg: '#cf222e', bg: '#0550ae', bold: true }, { text: 'Y' }]);
eq('Tab 原样保留（不展开）', projAll(parseAnsi('a\tb', false)), [{ text: 'a\tb' }]);

// ── `\r` 重写（进度条）────────────────────────────────────────────────────────
eq('后写覆盖前写（10%→20%）', projAll(parseAnsi('prog 10%\rprog 20%', false)), [{ text: 'prog 20%' }]);
eq('裸 \\r 无颜色码也覆盖', projAll(parseAnsi('10%\r20%\r30%', false)), [{ text: '30%' }]);
eq('CRLF 是行结束、不吞行', projAll(parseAnsi('line1\r\nline2\r\nline3', false)), [{ text: 'line1\nline2\nline3' }]);
eq('行尾孤立 \\r 保留该行', projAll(parseAnsi('abc\r', false)), [{ text: 'abc' }]);
eq('\\r + ESC[K 清行后重写', projAll(parseAnsi('prog 10%\r\x1b[Kprog 20%', false)), [{ text: 'prog 20%' }]);
eq('只影响所在行', projAll(parseAnsi('a\r\x1b[Kb\ncxx\rd', false)), [{ text: 'b\nd' }]);

// ── 边界：未闭合 / 截断 / 非法码（**逐条对齐 web 实测**）────────────────────
// 未闭合 CSI：ESCAPE_RE 的 `\x1b.` 兜底吃掉 `\x1b[`，残留参数当文本（web 原样）
eq('未闭合 \\x1b[31 ⇒ 残留 "31"', projAll(parseAnsi('\x1b[31', false)), [{ text: '31' }]);
eq('未闭合 \\x1b[ ⇒ 空', projAll(parseAnsi('\x1b[', false)), []);
eq('孤立 ESC ⇒ 保留', projAll(parseAnsi('\x1b', false)), [{ text: '\x1b' }]);
// \x1b[31r 被当完整 CSI（终止字母 r）丢弃 ⇒ 余 "ed"
eq('截断 \\x1b[31red ⇒ 余 "ed"', projAll(parseAnsi('\x1b[31red', false)), [{ text: 'ed' }]);
eq('非法码 999 忽略、不吞字', projAll(parseAnsi('\x1b[999mhi', false)), [{ text: 'hi' }]);
// web 怪癖：38;9 的 mode=9 落入 strike（两端必须一致，不"修"）
eq('怪癖 38;9 落到删除线', projAll(parseAnsi('\x1b[38;9mhi', false)), [{ text: 'hi', strike: true }]);
eq('空参数 0 复位', projAll(parseAnsi('\x1b[mhi', false)), [{ text: 'hi' }]);
eq('空段参数忽略（;31）', projAll(parseAnsi('\x1b[;31mhi', false)), [{ text: 'hi', fg: '#cf222e' }]);
// 任何长度的截断前缀都不能抛
let threw = false;
try {
  const full = '\x1b[38;2;10;20;30mabcdef\x1b[0m\x1b]0;t';
  for (let k = 0; k <= full.length; k++) { parseAnsi(full.substring(0, k), false); }
} catch (e) { threw = true; }
eq('任意截断前缀都不抛异常', threw, false);

// ── 流式稳定性：逐字 / 分块累积 == 一次喂 ────────────────────────────────────
const FULL = '\x1b[31mred';
let acc = '';
for (let i = 0; i < FULL.length; i++) { acc += FULL[i]; } // 逐字追加（8 段）
eq('逐字累积结果正确', projAll(parseAnsi(acc, false)), [{ text: 'red', fg: '#cf222e' }]);
eq('逐字累积 == 一次喂（逐字一致）',
  JSON.stringify(projAll(parseAnsi(acc, false))), JSON.stringify(projAll(parseAnsi(FULL, false))));
// 任意二分点：两半拼接结果 == 一次喂
let mismatch = 0;
for (let k = 0; k <= FULL.length; k++) {
  const joined = FULL.substring(0, k) + FULL.substring(k);
  if (JSON.stringify(projAll(parseAnsi(joined, false))) !== JSON.stringify(projAll(parseAnsi(FULL, false)))) { mismatch++; }
}
eq('任意切点拼接 == 一次喂', mismatch, 0);
// 多序列 + \r 的逐字累积
const FULL2 = '\x1b[1;96mfoo\x1b[0m bar\r\x1b[Kdone';
let acc2 = '';
for (let i = 0; i < FULL2.length; i++) { acc2 += FULL2[i]; }
eq('逐字累积（多序列+\\r）== 一次喂',
  JSON.stringify(projAll(parseAnsi(acc2, false))), JSON.stringify(projAll(parseAnsi(FULL2, false))));

// ── incompleteTail：尾部未完成转义边界 ──────────────────────────────────────
eq('未完成 CSI 的起点', incompleteTail('\x1b[31'), 0);
eq('未完成 CSI（只到 [）', incompleteTail('\x1b['), 0);
eq('孤立 ESC', incompleteTail('\x1b'), 0);
eq('未完成 OSC', incompleteTail('\x1b]0;title'), 0);
eq('前置文本的未完成 CSI', incompleteTail('abc\x1b[38;5;'), 3);
eq('完整 CSI ⇒ -1', incompleteTail('a\x1b[31m'), -1);
eq('完整 OSC(BEL) ⇒ -1', incompleteTail('\x1b]0;t\x07'), -1);
eq('无 ESC ⇒ -1', incompleteTail('plain text'), -1);

console.log(`  ansi: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
