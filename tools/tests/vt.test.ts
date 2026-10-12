/**
 * VT 终端模拟器门禁 —— 守护 `core/vt.ets`（终端渲染的**唯一**判据来源）。
 *
 * 为什么需要它：原生终端**不用** WebView、**不用** xterm.js ⇒ PTY 的光标控制字节流
 * 全靠本模块解释。它算错一格，用户看到的就是"错位的 shell"。这里逐条锁死：
 *   · 文本/CR/LF/BS/TAB（含 `\r` 重写 = 进度条）· 自动换行 · **CJK 双宽**
 *   · CSI（CUP/相对移动/ED/EL/IL/DL/DCH/ICH/ECH/滚屏/DECSTBM）· SGR（16/256/truecolor/属性）
 *   · 备用屏（1049）· 滚动区 · OSC 标题 · 增量 UTF-8（跨 chunk 断字节）· base64
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  VtTerm, vtB64ToBytes, vtBytesToB64, vtCharWidth, vtUtf8Encode,
} from '../../entry/src/main/ets/core/vt';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 便捷：造一个终端并喂文本，返回行文本数组。 */
function lines(text: string, cols: number, rows: number): string[] {
  const t = new VtTerm(cols, rows);
  t.feedText(text);
  return t.screenLines().map((l) => l.text);
}

/** 假调色板（16 槽）——用来**判别**"索引色由渲染层调色板决定"（而非模拟器写死色值）。 */
const FAKE_PAL: string[] = Array.from({ length: 16 }, (_, i) => `p${i}`);

// ── 文本流 ───────────────────────────────────────────────────────────────────
eq('CR/LF 分行', lines('ab\r\ncd', 10, 3), ['ab', 'cd', '']);
eq('孤立 LF 下移且不退列', lines('ab\nc', 10, 3), ['ab', '  c', '']);
eq('孤立 CR 覆盖行首（进度条）', lines('12345\rXY', 10, 2), ['XY345', '']);
eq('退格回退并在原位覆写', lines('ab\x08\x08X', 5, 2), ['Xb', '']);
eq('制表到下一 8 列位', lines('a\tb', 20, 2), ['a       b', '']);
eq('自动换行（第 4 个落下一行）', lines('abcd', 3, 2), ['abc', 'd']);
eq('满行不提前换行', lines('abc', 3, 2), ['abc', '']);
// 真实 VT：**LF 不回列**（`\n`⇒`\r\n` 是服务端 tty 的活儿）⇒ 裸 `\n` 会逐行缩进
eq('裸 LF 不回列', lines('1\n2', 5, 3), ['1', ' 2', '']);
eq('CRLF 才换列', lines('1\r\n2', 5, 3), ['1', '2', '']);

// ── 宽字符（CJK 占两格）──────────────────────────────────────────────────────
eq('CJK 宽度=2', vtCharWidth('中'.codePointAt(0) as number), 2);
eq('ASCII 宽度=1', vtCharWidth(65), 1);
eq('组合记号宽度=0', vtCharWidth(0x0301), 0);
{
  const t = new VtTerm(10, 2);
  t.feedText('中a');
  const l0 = t.screenLines()[0];
  eq('CJK 行文本', l0.text, '中a');
  eq('CJK 尾格不产 span（2 span：中/ a）', l0.spans.length, 2);
}

// ── CSI 定位 / 擦除 ──────────────────────────────────────────────────────────
eq('CUP 行列（2;3 ⇒ y1 x2）', lines('\x1b[2;3HZ', 5, 3), ['', '  Z', '']);
// CUU **只改行不改列**（真实 VT 语义）⇒ 'b' 落在第 1 列（x 仍是 1）
eq('CUU 上移（不动列）', lines('\x1b[2;1Ha\x1b[Ab', 5, 3), [' b', 'a', '']);
eq('CHA + EL 清到行尾', lines('abcde\x1b[3G\x1b[K', 5, 2), ['ab', '']);
eq('EL 0 从光标清到行尾', lines('abcde\x1b[4G\x1b[0K', 5, 2), ['abc', '']);
// EL 1 = 行首清到光标**含光标那格**（xterm 语义）⇒ 第 4 格 'd' 被清
eq('EL 1 从行首清到光标（含光标格）', lines('abcde\x1b[4G\x1b[1K', 5, 2), ['    e', '']);
eq('ED 2 清全屏', lines('abc\x1b[2J', 5, 2), ['', '']);
eq('ED 0 光标后清屏', lines('ab\r\ncd\x1b[1;2H\x1b[0J', 5, 2), ['a', '']);
eq('ECH 抹 N 格', lines('abcde\x1b[1;2H\x1b[2X', 5, 2), ['a  de', '']);

// ── 行插入/删除/字符插入删除 ─────────────────────────────────────────────────
eq('IL 在光标行插空行', lines('a\r\nb\r\nc\x1b[2;1H\x1b[L', 5, 3), ['a', '', 'b']);
eq('DL 删光标行', lines('a\r\nb\r\nc\x1b[2;1H\x1b[M', 5, 3), ['a', 'c', '']);
eq('DCH 删字符', lines('abcdef\x1b[1;3H\x1b[2P', 8, 2), ['abef', '']);
eq('ICH 插字符', lines('ab\x1b[1;1H\x1b[2@', 6, 2), ['  ab', '']);

// ── SGR ──────────────────────────────────────────────────────────────────────
{
  const t = new VtTerm(10, 2);
  t.feedText('\x1b[31mR\x1b[0mN');
  const s = t.screenLines(FAKE_PAL)[0].spans;
  eq('16 色前景 = 调色板[1]', s[0].fg, 'p1');
  eq('SGR 0 复位前景（空 = 渲染层继承）', s[1].fg, '');
}
{
  const t = new VtTerm(10, 2);
  t.feedText('\x1b[38;5;196mX');
  eq('256 色走 xterm 立方（196 ⇒ 红）', t.screenLines(FAKE_PAL)[0].spans[0].fg, 'rgb(255,0,0)');
}
{
  const t = new VtTerm(10, 2);
  t.feedText('\x1b[38;2;10;20;30mY');
  eq('truecolor 前景 = #rrggbb', t.screenLines()[0].spans[0].fg, '#0a141e');
}
{
  const t = new VtTerm(10, 2);
  t.feedText('\x1b[1;4;7mZ');
  const s = t.screenLines()[0].spans[0];
  eq('粗体/下划线/反色三个属性位', [s.bold, s.underline, s.inverse], [true, true, true]);
}
{
  const t = new VtTerm(10, 2);
  t.feedText('\x1b[1mB\x1b[22mN');
  eq('SGR 22 关粗体', t.screenLines()[0].spans[1].bold, false);
}

// ── 滚动 / scrollback ────────────────────────────────────────────────────────
{
  const t = new VtTerm(5, 2);
  t.feedText('1\r\n2\r\n3\r\n');
  eq('整屏滚动顶行进 scrollback', t.scrollbackCount(), 2);
  eq('scrollback 首行 = 最早滚出的行', t.scrollbackLines(10)[0].text, '1');
  eq('dump 含 scrollback + 屏幕', t.dumpText(), '1\n2\n3\n');
}
{
  const t = new VtTerm(5, 3);
  t.feedText('\x1b[2;3rX\n\n'); // 滚动区 2..3（0-based 1..2）
  eq('区内滚动不进 scrollback', t.scrollbackCount(), 0);
}

// ── 备用屏（1049）────────────────────────────────────────────────────────────
{
  const t = new VtTerm(8, 2);
  t.feedText('main\x1b[?1049hALT');
  eq('进入备用屏后只有备用屏内容', t.screenLines()[0].text, 'ALT');
  t.feedText('\x1b[?1049l');
  eq('退出备用屏恢复到主屏', t.screenLines()[0].text, 'main');
}

// ── OSC 标题 ─────────────────────────────────────────────────────────────────
{
  const t = new VtTerm(20, 2);
  t.feedText('\x1b]0;my-title\x07visible');
  eq('OSC 0 设标题', t.title, 'my-title');
  eq('OSC 内容不进屏幕', t.screenLines()[0].text, 'visible');
}

// ── 增量 UTF-8（跨 chunk 断字节）─────────────────────────────────────────────
{
  const t = new VtTerm(10, 2);
  const bytes = vtUtf8Encode('中');
  eq('中 = 3 字节', bytes.length, 3);
  t.feed(new Uint8Array([bytes[0], bytes[1]]));
  eq('半个字符不渲染', t.screenLines()[0].text, '');
  t.feed(new Uint8Array([bytes[2]]));
  eq('补齐后渲染', t.screenLines()[0].text, '中');
}
{
  const t = new VtTerm(10, 2);
  t.feedText('\x1b[');
  t.feedText('31mR'); // CSI 跨 chunk 断开
  eq('CSI 跨 chunk 仍生效', t.screenLines(FAKE_PAL)[0].spans[0].fg, 'p1');
}

// ── base64 ───────────────────────────────────────────────────────────────────
{
  const b = vtUtf8Encode('Man');
  eq('base64 编码已知向量', vtBytesToB64(b), 'TWFu');
  const back = vtB64ToBytes('TWFu');
  eq('base64 解码逐字节', Array.from(back), [0x4d, 0x61, 0x6e]);
}
{
  const src = new Uint8Array([0, 1, 2, 250, 255, 128]);
  eq('base64 往返', Array.from(vtB64ToBytes(vtBytesToB64(src))), Array.from(src));
}
{
  const b = vtUtf8Encode('中文');
  eq('base64 往返多字节 UTF-8', Array.from(vtB64ToBytes(vtBytesToB64(b))), Array.from(b));
}

// ── 尺寸变化 ─────────────────────────────────────────────────────────────────
{
  const t = new VtTerm(10, 3);
  t.feedText('abcdef');
  t.resize(3, 2);
  eq('缩小后按新宽截断', t.screenLines()[0].text, 'abc');
  eq('缩小后行数', t.screenLines().length, 2);
}

console.log(`vt.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
