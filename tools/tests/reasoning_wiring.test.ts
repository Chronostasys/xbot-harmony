/**
 * K 接线「源码形态」门禁 —— 思考展开态 live↔committed **共用 `reasoningKey`** 的**调用点**证据。
 *
 * ── 为什么必须有（`docs/ARKTS-GOTCHAS.md §33b` 的教训）────────────────────────────
 * 「思考展开态」曾被记为**死消费**（`reasoningopen` 0 消费方 ⇒ "修了 live→commit 自动收起"是**假的**、
 * 门禁却全绿）。该节的**铁律**：
 *   > 源码形态断言必须钉 **调用点计数**（`grep -c` 数量），**别钉"方法体存在"** —— 否则假绿。
 * 本文件即按此铁律：**数调用点**（且**先剥注释**，免得把注释里的提及当调用）。
 *
 * ── 钉什么 ──────────────────────────────────────────────────────────────────────
 * ① live 侧（`LiveTailView`）与 committed 侧（`MessageRow`）**都必须**用 `reasoningKey(...)` 造键
 *    （同一个构造函数 ⇒ 同一 key ⇒ commit 后读得到）；
 * ② 唯一形态组件 `ThinkingLine` **必须**读 `getReasoningOpen(` + 写 `setReasoningOpen(`
 *    （只写不读 / 只读不写都收不了/存不住）；
 * ③ live 侧**不得**再有**无键**的局部展开 `@State`（旧缺陷形态：`LiveTailView.reasonOpen`）。
 *
 * ✅ 扫描器自证：打印**扫了哪些文件 + 每个文件的调用点计数**；**零扫描判红**（总计数 0 ⇒ 红）。
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 必须标记为**模块**（否则顶层 `pass/fail` 落进全局作用域，与其它脚本测试重名冲突 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const CDIR: string = path.join(REPO, 'entry/src/main/ets/components');

/** **剥注释**（块 + 行；行注释用 `(^|[^:])//` 以免剥掉 `https://`）—— 免得注释里的提及被当调用。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}

const LIVE: string = 'LiveTailView.ets';
const MSG: string = 'MessageRow.ets';
const LINE: string = 'ThinkingLine.ets';

function read(f: string): string {
  return stripComments(fs.readFileSync(path.join(CDIR, f), 'utf8'));
}
const liveSrc: string = read(LIVE);
const msgSrc: string = read(MSG);
const lineSrc: string = read(LINE);

// ── 扫描器自证：扫了哪些文件 ─────────────────────────────────────────────────────────
console.log(`  K-scan dir=${CDIR}`);
console.log(`  K-scan files: ${LIVE}, ${MSG}, ${LINE}`);

const liveKeys: number = countOf(liveSrc, 'reasoningKey(');
const msgKeys: number = countOf(msgSrc, 'reasoningKey(');
const lineGets: number = countOf(lineSrc, 'getReasoningOpen(');
const lineSets: number = countOf(lineSrc, 'setReasoningOpen(');
// 逐文件计数（自证）
console.log(`  K-scan ${LIVE}: reasoningKey(=${liveKeys}`);
console.log(`  K-scan ${MSG}: reasoningKey(=${msgKeys}`);
console.log(`  K-scan ${LINE}: getReasoningOpen(=${lineGets} setReasoningOpen(=${lineSets}`);

// ── ① 两侧都造键（调用点计数，钉"有人用"而非"函数在"）────────────────────────────
ok(`live 侧用 reasoningKey 造键（count=${liveKeys} ≥ 1）`, liveKeys >= 1);
ok(`committed 侧用 reasoningKey 造键（count=${msgKeys} ≥ 1）`, msgKeys >= 1);
// ── ② 唯一形态：必须既读又写共享 store ───────────────────────────────────────────────
ok(`ThinkingLine 读共享 store（getReasoningOpen=${lineGets} ≥ 1）`, lineGets >= 1);
ok(`ThinkingLine 写共享 store（setReasoningOpen=${lineSets} ≥ 1）`, lineSets >= 1);
// ── ③ live 侧**不得**有**无键**局部思考展开 @State（旧缺陷形态：`LiveTailView.reasonOpen`）──────
// ⚠️ 只针对**思考/推理 + 展开**的局部态：
//    · `overOpen`（工具 "+N" 溢出浮层）—— 与思考无关，**不算**；
//    · `visReason`（打字机可见字符数，number）—— 不是展开态，**不算**。
//    ⇒ 名字必须**同时**含 (reason|think) 与 (open|expand|fold)，且是 `boolean`。
const keylessLocal: RegExp = /@State\s+\w*(?:[Rr]eason|[Tt]hink)\w*(?:[Oo]pen|[Ee]xpand|[Ff]old)\w*\s*:\s*boolean/g;
const liveLocals: string[] = liveSrc.match(keylessLocal) === null ? [] : (liveSrc.match(keylessLocal) as string[]);
ok(`live 侧无无键局部思考展开 @State（命中=${JSON.stringify(liveLocals)}）`, liveLocals.length === 0);

// ── 零扫描判红：三项合计必须 > 0（扫描器与真源脱节 ⇒ 红）──────────────────────────────
ok('零扫描判红：接线调用点合计 > 0', liveKeys + msgKeys + lineGets + lineSets > 0);

console.log(`  K-wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
