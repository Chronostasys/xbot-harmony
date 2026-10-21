/**
 * busy 占位符**文案**的判别测试（修 §12 #5 / 本轮 ①）。
 *
 * 用户可见缺陷：压缩期（`phase === 'compressing'`）原生恒显示「思考中…」，
 * 而 web 显示「正在压缩上下文…」（`web/src/components/agent/MessageList.tsx:1679-1686`）。
 * 根因：原生透传了 `ProgressSnapshot.phase` 但**零 UI 消费者** ⇒ 判据缺失。
 *
 * 本用例把「文案由 phase 决定」钉死 —— 任何把两条文案合并/写死的改动都会立刻变红
 * （mutation：把 busyLabel 实现改成 `return BUSY_LABEL_THINKING;` ⇒ 第 3 条红）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  BUSY_LABEL_COMPRESSING, BUSY_LABEL_THINKING, PHASE_COMPRESSING, busyLabel,
} from '../../entry/src/main/ets/core/indicators';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── ① 断言（**能红**）：压缩期文案 ≠ 普通「思考中…」 ────────────────────────────
ok('busyLabel(compressing) ≠ 普通「思考中…」', busyLabel('compressing') !== BUSY_LABEL_THINKING);
eq('busyLabel(compressing) = 正在压缩上下文…', busyLabel('compressing'), '正在压缩上下文…');

// ── ② web 权威文案逐字（`i18n/zh-CN.ts:235` / `agent.thinking`）──────────────────
eq('压缩文案 = web t(agent.compressing) 逐字', BUSY_LABEL_COMPRESSING, '正在压缩上下文…');
eq('思考文案 = 占位符文案逐字', BUSY_LABEL_THINKING, '思考中…');
eq('PHASE_COMPRESSING 与服务端词汇一致', PHASE_COMPRESSING, 'compressing');

// ── ③ 非压缩一律回落「思考中…」（undefined / '' / 其它 phase 都不得伪装成压缩）──
eq('undefined ⇒ 思考中…', busyLabel(undefined), BUSY_LABEL_THINKING);
eq("'' ⇒ 思考中…", busyLabel(''), BUSY_LABEL_THINKING);
eq("'thinking' ⇒ 思考中…", busyLabel('thinking'), BUSY_LABEL_THINKING);
eq("'tool_exec' ⇒ 思考中…", busyLabel('tool_exec'), BUSY_LABEL_THINKING);
eq("'done' ⇒ 思考中…", busyLabel('done'), BUSY_LABEL_THINKING);
// 大小写/前缀不得误命中（服务端词汇是精确小写，客户端不模糊匹配）
ok("'Compressing' 不误判为压缩期", busyLabel('Compressing') === BUSY_LABEL_THINKING);
ok("'compressing ' 不误判为压缩期", busyLabel('compressing ') === BUSY_LABEL_THINKING);

// ── 生产消费点（源码形态）──────────────────────────────────────────────────────
// ⛔ 判据≠信号：**剥注释**后按**调用点**计数；**零扫描判红**（消费点为 0 即红 —— 那正是
//    本缺陷的原状：`busyLabel` 只有测试消费、零生产消费者，门禁 ⑧ 警告）。
// 背景：`busyLabel` 曾是"纯逻辑已就绪、UI 未接线"（§12-E）；本轮 R1 把页面占位行接上。
{
  const fsMod = require('fs');
  const pathMod = require('path');
  const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
  const pagePath = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets');
  const raw: string = fsMod.readFileSync(pagePath, 'utf-8');
  const noBlock: string = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines: string[] = noBlock.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln: string = lines[i];
    const idx: number = ln.indexOf('//');
    out.push(idx >= 0 && (idx === 0 || ln.charAt(idx - 1) !== ':') ? ln.substring(0, idx) : ln);
  }
  const code: string = out.join('\n');
  const re = new RegExp('busyLabel\\(', 'g');
  let n = 0;
  let m = re.exec(code);
  while (m !== null) { n++; m = re.exec(code); }
  ok('零扫描判红：pages/Index.ets 有 busyLabel( 的**生产调用点**', n > 0);
  eq('生产调用点 ≥1（门禁 ⑧：busyLabel 不再是"仅测试消费"）', n >= 1, true);
  ok('pages/Index.ets 确实 import 了 core/indicators 的 busyLabel',
    code.indexOf('busyLabel') >= 0 && code.indexOf("from '../core/indicators'") >= 0);
  // 反面板：占位行不得再写死资源串（否则等于回到"零消费"）
  ok('占位行不再用写死的 $r(app.string.thinking_placeholder)',
    code.indexOf("$r('app.string.thinking_placeholder')") < 0);
}

if (fail > 0) { console.log(`  busy_label: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  busy_label: ${pass} passed, 0 failed`);
process.exit(0);

export {};
