/**
 * 判据：在飞工具列表的**内容签名**必须能看见"就地更新"。
 *
 * 事故（2026-10-14 用户亲报「目前 tool `生成中 x 字`，这个 x 不会更新」）：
 *   `pages/Index.syncLiveTail` 原用**数组恒等**门控投递 `@Prop liveTools`，而在飞迭代的
 *   `tools` 数组是**就地更新**的（同一引用、元素字段在变）⇒ 恒等恒成立 ⇒ 永不投递
 *   ⇒ pill 的生成字数/耗时冻结在创建那一刻。
 * 修法：按 `core/streammerge.toolsSignature`（内容签名）门控，变化时才投递 `.slice()` 新数组。
 *
 * 判别力（mutation 自证）：
 *   · `toolsSignature` 改成返回常量 / 只含长度 ⇒ 「gen_chars 变化必须改变签名」必红；
 *   · 页面接线改回 `this.liveTools !== tools` ⇒ 接线断言必红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

const fs: { readFileSync(p: string, e: string): string } = require('fs');
const path: { join(...parts: string[]): string } = require('path');

// ⛔ 判据不 import 组件 `.ets`（脱机 harness 只把 `core/**` 当纯 TS 编译）⇒ 用源码文本核对接线。
const root: string = path.join(__dirname, '..', '..', '..', '..');
const pageSrc: string = fs.readFileSync(path.join(root, 'entry/src/main/ets/pages/Index.ets'), 'utf8');
const coreSrc: string = fs.readFileSync(
  path.join(root, 'entry/src/main/ets/core/streammerge.ets'), 'utf8');

let failed: number = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

console.log('tools_signature:');

// ── 零点扫防线 ────────────────────────────────────────────────────────────────
ok(coreSrc.length > 10000 && pageSrc.length > 50000, '两处源码真读到内容（零扫描防线）');

// ── 签名器本体：必须存在且**含每个可见字段** ────────────────────────────────────
ok(coreSrc.indexOf('export function toolsSignature(ts: ToolProgress[]): string {') >= 0,
  'toolsSignature 是导出的纯函数（可脱机单测）');
for (const field of ['t.status', 't.gen_chars', 't.exit_code', 't.elapsed_ms', 't.call_id',
  't.args.length', 't.detail.length']) {
  ok(coreSrc.indexOf(field) >= 0, `签名纳入 ${field}（pill 上看得见的量）`);
}
ok(coreSrc.indexOf('t.detail.length') >= 0 && coreSrc.indexOf('|${t.name}:${status}:${gen}:${code}:${ms}:${cid}:${argLen}:${detLen}') >= 0,
  '签名**只取 detail 长度**（⛔ 不拼全文：避免每帧上千字符的串）');

// ── 页面接线：必须按签名门控投递 `.slice()`（新数组）──────────────────────────
ok(pageSrc.indexOf('const toolsSig: string = toolsSignature(tools);') >= 0,
  'syncLiveTail 用签名门控');
ok(pageSrc.indexOf('if (toolsSig !== this.liveToolsSig) {') >= 0, '签名变化才投递');
ok(pageSrc.indexOf('this.liveTools = tools.slice();') >= 0,
  '投递的是**新数组**（ArkUI 才看得见"值变化"）');
ok(pageSrc.indexOf('if (this.liveTools !== tools) {') < 0,
  '旧的「数组恒等」门控已消失（正是本 bug 的根因）');

console.log(failed === 0 ? 'tools_signature: ALL PASS' : `tools_signature: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

// ⛔ 声明为模块（聚合编译把非模块测试归入同一全局作用域 ⇒ 同名 declare 会撞 TS2451/TS2393）。
export {};
