/**
 * rewind 编辑目标「**单一来源**」门禁 —— `pages/Index.ets` 只许存**行 id**。
 *
 * ── 背景（2026-10-11「状态双写/派生不一致」审计）────────────────────────────────────
 * 该状态曾是**三个来源**：`rewindEditRowId` + `rewindEditTurnID` + `rewindEditOriginal`
 * （同一行、两份拷贝）⇒ `begin/cancel/submit` **三处必须同步**，漏一处就漂移（"脆"迟早变"漂移"）。
 * 收敛：**只存行 id**，`turnID`/`content` 用时由 `core/rowquery.rowById` **查得**。
 *
 * 两条腿：
 *  ① **纯逻辑**：`rowById` 命中/未命中/空 id（不得返回"第一个空 id 行"）/同 id 多行取首。
 *  ② **源码形态**（扫描器**自证** + **反向断言** + **零扫描判红**）：`Index.ets` 剥注释后
 *     `rewindEditTurnID` / `rewindEditOriginal` **零出现**（旧字段不得残留）+ `rowById(` 有真调用 + 真 import。
 *
 * ⚠️ 汇总**无条件打印** + `process.exit(fail>0?1:0)`（勿包进 `if`，见 `docs/CI.md` 的死区坑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 必须标记为**模块**（否则顶层 pass/fail 落进全局作用域，与其它脚本测试重名冲突 TS2451）。
export {};

import { rowById } from '../../entry/src/main/ets/core/rowquery';
import { ChatRow } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function row(id: string, turnID: number, content: string): ChatRow {
  const r: ChatRow = new ChatRow();
  r.id = id;
  r.turnID = turnID;
  r.content = content;
  return r;
}

// ── ① 纯逻辑：rowById 是"行 id → 行"的**唯一**查询 ────────────────────────────────
const rows: ChatRow[] = [row('a', 11, 'A'), row('b', 22, 'B'), row('c', 0, 'C')];
eq('命中：a ⇒ turnID/content 与行一致', [rowById(rows, 'a')?.turnID, rowById(rows, 'a')?.content], [11, 'A']);
eq('命中：c（turnID=0 的本地行）仍可查出', rowById(rows, 'c')?.content, 'C');
eq('未命中 ⇒ undefined', rowById(rows, 'zzz'), undefined);
eq('空 id ⇒ undefined（静息态**不得**返回第一个空 id 行）', rowById([row('', 9, '空')], ''), undefined);
eq('同 id 多行 ⇒ 取首个（与行顺序一致）', rowById([row('x', 1, 'first'), row('x', 2, 'second')], 'x')?.content, 'first');
eq('空表 ⇒ undefined', rowById([], 'a'), undefined);
// 收敛后的等价性：由 id 查出的 (turnID, content) == 原先**存两份副本**时的值
{
  const r: ChatRow = row('r7', 77, '原文');
  const derived: ChatRow | undefined = rowById([r], 'r7');
  eq('收敛等价：id ⇒ (turnID, content) 与行一致', [derived?.turnID, derived?.content], [r.turnID, r.content]);
}

// ── ② 源码形态（扫描器自证 + 反向断言 + 零扫描判红）────────────────────────────────
const REPO: string = path.resolve(__dirname, '../../../..');
const IX: string = 'entry/src/main/ets/pages/Index.ets';
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}
const ixSrc: string = stripComments(fs.readFileSync(path.join(REPO, IX), 'utf8'));
const ixTurnId: number = countOf(ixSrc, 'rewindEditTurnID');
const ixOriginal: number = countOf(ixSrc, 'rewindEditOriginal');
const ixRowId: number = countOf(ixSrc, 'rewindEditRowId');
const ixRowById: number = countOf(ixSrc, 'rowById(');
const ixImport: number = countOf(ixSrc, "from '../core/rowquery'");
console.log(`  rewind-scan ${IX}`);
console.log(`  rewind-scan rewindEditRowId=${ixRowId} rewindEditTurnID=${ixTurnId}`
  + ` rewindEditOriginal=${ixOriginal} rowById(=${ixRowById} import=${ixImport}`);
// ⛔ **反向断言**：旧的两个拷贝字段**必须零出现**（残留 ⇒ 说明又有人存了第二份 ⇒ 红）
ok(`Index 不再有 rewindEditTurnID（${ixTurnId} === 0，旧拷贝字段不得残留）`, ixTurnId === 0);
ok(`Index 不再有 rewindEditOriginal（${ixOriginal} === 0，同上）`, ixOriginal === 0);
// 正向：仍用行 id，且**用时查得**
ok(`Index 仍以 rewindEditRowId 记编辑目标（${ixRowId} ≥ 3：声明 + begin + submit/cancel）`, ixRowId >= 3);
ok(`Index 用 rowById( 查行（${ixRowById} ≥ 1）`, ixRowById >= 1);
ok(`Index 真 import core/rowquery（${ixImport} ≥ 1）`, ixImport >= 1);
// 零扫描判红（扫描器与真源脱节 ⇒ 红）
ok(`零扫描判红：Index.ets 非空（${ixSrc.length} > 0）`, ixSrc.length > 0);
ok('零扫描判红：逆否自证——探针串必能被 countOf 数到', countOf('xxrewindEditTurnIDxx', 'rewindEditTurnID') === 1);

console.log(`  rewind_target_single_source: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
