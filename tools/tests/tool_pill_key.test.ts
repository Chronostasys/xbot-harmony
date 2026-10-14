/**
 * 判据：工具 pill 的 `ForEach` key 必须覆盖**会变的可见内容**（`status` + `gen_chars`）。
 *
 * 事故（2026-10-16 用户第二次亲报「tool 生成中 x 字，这个 x 不更新」）：
 *   上一轮修了**投递门控**（`toolsSignature`，见 `tools_signature.test.ts`），但真机双量具对齐
 *   实证仍冻结：组件侧 `@Prop tools` **逐帧收到** `FileCreate:4340→5748`（探针 hilog），而渲染出的
 *   chip 连续 14 帧停在「生成中 39 字」。⇒ 断点在 `ForEach` 的 **key**：旧 key 只含
 *   `name#call_id`（`LiveTailView` 为 `lt-${i}#…`）⇒ 参数流式期间 key **恒定** ⇒ ArkUI 判
 *   "条目未变" ⇒ **条目子树不重建** ⇒ chip 冻在创建那一刻。
 *   （同族血债：AGENTS.md「LazyForEach + 最小通知键 ⇒ 已存在行永不更新」。）
 *
 * 判别力（mutation 自证）：把 key 模板改回只含 `name#call_id` ⇒ 本判据必红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

const fs: { readFileSync(p: string, e: string): string } = require('fs');
const path: { join(...parts: string[]): string } = require('path');

// ⛔ 判据不 import 组件 `.ets`（脱机 harness 只把 `core/**` 当纯 TS 编译）⇒ 用源码文本核对接线。
const root: string = path.join(__dirname, '..', '..', '..', '..');

let passed: number = 0;
let failed: number = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

/** 剥注释（避免注释里的示例 key 被误当接线）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 取锚点之后的 `n` 个字符（只看**该 ForEach 的 key 表达式**那一段）。 */
function bodyAfter(src: string, anchor: string, n: number): string {
  const i: number = src.indexOf(anchor);
  return i < 0 ? '' : src.slice(i, i + n);
}

/** key 模板是否覆盖"会变的可见内容"——判据本体（可被 mutation 反例证伪）。 */
function keyCoversLiveFields(keyExpr: string): boolean {
  return keyExpr.indexOf('gen_chars') >= 0 && keyExpr.indexOf('status') >= 0;
}

const liveSrc: string = stripComments(
  fs.readFileSync(path.join(root, 'entry/src/main/ets/components/LiveTailView.ets'), 'utf8'));
const rowSrc: string = stripComments(
  fs.readFileSync(path.join(root, 'entry/src/main/ets/components/MessageRow.ets'), 'utf8'));

// ── live pill（LiveTailView，在飞迭代块）────────────────────────────────────────────
const liveKey: string = bodyAfter(liveSrc, '}, (t: ToolProgress, i: number) => `lt-', 520);
ok(liveKey.length > 0, 'live pill 的 ForEach key 锚点仍存在（`lt-${i}#…`；⛔ 改结构需同步本判据）');
ok(liveKey.indexOf('gen_chars') >= 0, 'live pill key 含 `gen_chars`（否则字数冻结在创建那一刻）');
ok(liveKey.indexOf('status') >= 0, 'live pill key 含 `status`（否则 pending→running 不重绘）');

// ── committed pill（MessageRow，迭代块）───────────────────────────────────────────
const rowKey: string = bodyAfter(rowSrc, '(t: ToolProgress, ti: number) => `${this.toolKey(', 620);
ok(rowKey.length > 0, 'committed pill 的 ForEach key 锚点仍存在（⛔ 改结构需同步本判据）');
ok(rowKey.indexOf('gen_chars') >= 0, 'committed pill key 含 `gen_chars`');
ok(rowKey.indexOf('status') >= 0, 'committed pill key 含 `status`');

// ── 判别力（mutation 自证）：旧式 key 必须被判红 ─────────────────────────────────────
const oldLiveKey: string = '}, (t: ToolProgress, i: number) => `lt-${i}#${t.name}#${t.call_id}`';
const newLiveKey: string = '}, (t: ToolProgress, i: number) => `lt-${i}#${t.name}#${t.call_id}'
  + '#${t.status}#${t.gen_chars}`';
ok(keyCoversLiveFields(oldLiveKey) === false,
  'mutation 自证：只含 name#call_id 的旧 key 被判红（判据有判别力，不是恒真）');
ok(keyCoversLiveFields(newLiveKey) === true, 'mutation 自证：含 status+gen_chars 的新 key 判绿');
ok(keyCoversLiveFields(liveKey) === true, 'live pill 的真实 key 通过判据本体');

console.log(`  tool-pill-key: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

// ⛔ 必须导出：聚合 harness 把**全部** `.test.ts` 编进同一输出目录 ⇒ 没这份导出时本文件的
//    `declare const process/__dirname` 是**全局**声明 ⇒ 与其它测试文件撞名
//    （`TS2451 Cannot redeclare block-scoped variable 'process'`，门禁 ① 直接判红）。
export {};
