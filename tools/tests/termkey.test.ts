/**
 * termkey.test.ts —— P0-1 逐键输入判别测试（纯逻辑 + 接线形态断言）。
 *
 * 判别力设计：
 *  - 纯逻辑段：stdinDelta 三态全边界（尾追/尾删/中间/中文/控制字节/回灌守卫）、
 *    eraserFor 限幅与负值、sentThroughStep 三态推进量。
 *  - wire 段：TerminalSheet 必须真接线（onChange 内调 stdinDelta、submitInput
 *    含 eraserFor 擦除兜底、sentThrough 状态成员、import 断言）——
 *    ⛔ 钉调用点而非函数体：死消费（函数存在但 0 调用点）必须红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; dirname(p: string): string };
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

// ── 爬根：向上找 entry/src/main/ets（run-one 编译产物会使 __dirname 漂移）──
function root(): string {
  let dir: string = __dirname;
  for (let i = 0; i < 8; i++) {
    const probe = path.join(dir, 'entry', 'src', 'main', 'ets');
    if (fs.existsSync(probe)) {
      return probe;
    }
    const up = path.dirname(dir);
    if (up === dir) {
      break;
    }
    dir = up;
  }
  throw new Error('cannot locate entry/src/main/ets');
}
const ETS = root();

// 与 files_pure 同管线的**源相对 import**（run-one/run.sh 的 tsc+sed 改写负责落到编译产物）。
import * as tkNs from '../../entry/src/main/ets/core/termkey';
const tk = tkNs as unknown as {
  safeTypeByte: (c: string) => boolean;
  stdinDelta: (a: string, b: string) => string | null;
  eraserFor: (n: number) => string;
  sentThroughStep: (d: string | null) => number;
  TERM_BACKSPACE: string;
};

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

// ── 1. safeTypeByte ──
ok(tk.safeTypeByte('a') === true, 'safeTypeByte 可打印字母');
ok(tk.safeTypeByte(' ') === true, 'safeTypeByte 空格');
ok(tk.safeTypeByte('~') === true, 'safeTypeByte 波浪(0x7e 上界)');
ok(tk.safeTypeByte('\t') === true, 'safeTypeByte 制表');
ok(tk.safeTypeByte('\n') === false, 'safeTypeByte 换行拒绝');
ok(tk.safeTypeByte('\r') === false, 'safeTypeByte 回车拒绝');
ok(tk.safeTypeByte('\x1b') === false, 'safeTypeByte ESC 拒绝');
ok(tk.safeTypeByte('\x7f') === false, 'safeTypeByte DEL 拒绝');
ok(tk.safeTypeByte('你') === false, 'safeTypeByte 中文拒绝');
ok(tk.safeTypeByte('') === false, 'safeTypeByte 空串拒绝');

// ── 2. stdinDelta 三态 ──
// 形态 1：尾追
ok(tk.stdinDelta('', 'l') === 'l', '尾追单字符');
ok(tk.stdinDelta('l', 'ls') === 's', '尾追续打');
ok(tk.stdinDelta('ls', 'ls -la') === ' -la', '尾追含空格段');
ok(tk.stdinDelta('vim ', 'vim  ') === ' ', '尾追再空格');
ok(tk.stdinDelta('', 'ls -la /tmp') === 'ls -la /tmp', '整段粘贴纯 ASCII=尾追(可透传)');
// 尾追含非安全字节 ⇒ null
ok(tk.stdinDelta('ec', 'ec你') === null, '尾追中文 ⇒ null(落整行兜底)');
ok(tk.stdinDelta('ls', 'ls\n') === null, '尾追换行 ⇒ null(回车只走 onSubmit)');
ok(tk.stdinDelta('ls', 'ls\x01') === null, '尾追控制字节 ⇒ null');
ok(tk.stdinDelta('', '中文') === null, '纯中文整段 ⇒ null');
// 形态 2：尾删
ok(tk.stdinDelta('ls', 'l') === tk.TERM_BACKSPACE, '尾删单字符 ⇒ \\x7f');
ok(tk.stdinDelta('ls ', 'ls') === tk.TERM_BACKSPACE, '尾删空格 ⇒ \\x7f');
ok(tk.stdinDelta('a\t', 'a') === tk.TERM_BACKSPACE, '尾删制表 ⇒ \\x7f');
ok(tk.stdinDelta('ls你', 'ls') === null, '尾删中文字符 ⇒ null(字节坐标不可靠)');
// 形态 3：中间编辑/多删/重排 ⇒ null
ok(tk.stdinDelta('ls', 'lS') === null, '中间改写 ⇒ null');
ok(tk.stdinDelta('ls', 's') === null, '首删(中间态) ⇒ null');
ok(tk.stdinDelta('abc', 'a') === null, '多字删 ⇒ null');
ok(tk.stdinDelta('', 'a\r') === null, '含回车多字 ⇒ null');
// 回灌守卫
ok(tk.stdinDelta('ls', 'ls') === null, 'prev===next ⇒ null(程序赋值回灌不透传)');
ok(tk.stdinDelta('', '') === null, '空空 ⇒ null');

// ── 3. eraserFor ──
ok(tk.eraserFor(0) === '', 'eraser 0');
ok(tk.eraserFor(-1) === '', 'eraser 负值');
ok(tk.eraserFor(3) === '\x7f\x7f\x7f', 'eraser 3');
ok(tk.eraserFor(1) === '\x7f', 'eraser 1');
ok(tk.eraserFor(9999).length === 4096, 'eraser 限幅 4096');
ok(tk.eraserFor(Number.NaN) === '', 'eraser NaN 安全');

// ── 4. sentThroughStep ──
ok(tk.sentThroughStep(null) === 0, 'step null ⇒ 0');
ok(tk.sentThroughStep('') === 0, 'step 空 ⇒ 0');
ok(tk.sentThroughStep(tk.TERM_BACKSPACE) === -1, 'step 退格 ⇒ -1');
ok(tk.sentThroughStep('abc') === 3, 'step 三字符 ⇒ 3');
ok(tk.sentThroughStep(' ') === 1, 'step 空格 ⇒ 1');

// ── 5. wire 接线断言（TerminalSheet.ets 源码形态；钉调用点而非函数体）──
const sheetPath = path.join(ETS, 'components', 'TerminalSheet.ets');
const sheet = fs.readFileSync(sheetPath, 'utf8');
ok(sheet.includes('stdinDelta') === true, 'wire: TerminalSheet 引用 stdinDelta');
ok(
  /onChange\((?:[^)]*)\)\s*=>\s*\{[\s\S]*?stdinDelta\(/.test(sheet) === true,
  'wire: onChange 体内调用 stdinDelta',
);
ok(sheet.includes('sentThrough') === true, 'wire: sentThrough 状态成员存在');
ok(
  /submitInput\(\)[\s\S]{0,600}eraserFor\(/.test(sheet) === true,
  'wire: submitInput 内 eraserFor 擦除兜底',
);
ok(
  /submitInput\(\)[\s\S]{0,600}sentThrough = 0/.test(sheet) === true,
  'wire: submitInput 重置 sentThrough',
);
ok(
  sheet.includes("import { stdinDelta") === true || /import \{[^}]*stdinDelta[^}]*\} from/.test(sheet) === true,
  'wire: stdinDelta import 断言',
);

console.log(`\ntermkey: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
