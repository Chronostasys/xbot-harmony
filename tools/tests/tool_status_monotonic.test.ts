/**
 * tool_status_monotonic.test.ts —— **active 工具状态「只升不降」**（2026-10-12，P0）。
 *
 * 用户亲报（原话）：「不可能一个迭代所有 tool 都排队」「**running 绝不能变回 pending，参考 web**」。
 *
 * 根因：本仓是**跨帧累积**，而 `reduce.ts` 对 `activeTools` 曾是**整表替换** ⇒ 服务端
 * 整批先标 `pending`（`agent/engine_run_tools.go:49-64`）且这些条目**残留进后续帧**，
 * 于是陈旧快照里同键的 `pending` 把已 `running` 的**打回排队**。
 * web 侧不会回退：`progressStore.dedupTools:339-364` 对同键取 **rank 更高**者
 * （error/done=3 > running=2 > generating=2 > pending=1）。本仓把该规则等价应用在
 * **跨帧合并**上（`streammerge.mergeActiveStatus`）。
 *
 * ⚠️ **判别力自证**：把 `mergeActiveStatus` 里的 `toolRank(old) > toolRank(new)` 改成 `<`
 *    ⇒「running 不被 pending 打回」红；把「未替换则返回 next 引用」去掉 ⇒ 引用判等红。
 */
export {};

declare const process: { exit: (c: number) => void };

import { mergeActiveStatus, toolRank } from '../../entry/src/main/ets/core/streammerge';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// 最小结构（`ActiveToolLike`）：name/label/status/callID（web 形状）。
const t = (name: string, label: string, status: string, callID?: string) =>
  callID !== undefined ? { name, label, status, callID } : { name, label, status };

// ── rank 表（本仓 `toolRank` 的档位；**序**与 web `dedupTools` 一致：
//    error/done > running > generating > pending > 未知）──────────────────────
eq('rank：error = done = 4（终态最高）', [toolRank('error'), toolRank('done')], [4, 4]);
eq('rank：running = executing = 3', [toolRank('running'), toolRank('executing')], [3, 3]);
eq('rank：generating = 2 > pending = 1', [toolRank('generating'), toolRank('pending')], [2, 1]);
eq('rank：未知 = 0', toolRank('whatever'), 0);

// ── 核心不变量：running 绝不被 pending 打回 ─────────────────────────────────
const prevRun = [t('Shell', 'Shell: ls', 'running')];
const nextPend = [t('Shell', 'Shell: ls', 'pending')];
eq('running 不被 pending 打回（用户亲报的 P0）',
  mergeActiveStatus(prevRun, nextPend).map((x) => x.status), ['running']);
eq('generating 不被 pending 打回（用户 2026-10-11 同款根因）',
  mergeActiveStatus([t('Read', 'Read: a', 'generating')], [t('Read', 'Read: a', 'pending')])
    .map((x) => x.status), ['generating']);
eq('done 不被 running 打回',
  mergeActiveStatus([t('Shell', 'Shell: x', 'done')], [t('Shell', 'Shell: x', 'running')])
    .map((x) => x.status), ['done']);

// ── 单调推进（低 → 高：必须采纳新值）────────────────────────────────────────
eq('pending → running 采纳新值',
  mergeActiveStatus([t('Shell', 'Shell: x', 'pending')], [t('Shell', 'Shell: x', 'running')])
    .map((x) => x.status), ['running']);
eq('running → done 采纳新值',
  mergeActiveStatus([t('Shell', 'Shell: x', 'running')], [t('Shell', 'Shell: x', 'done')])
    .map((x) => x.status), ['done']);

// ── 成员集合以**新列表**为准（不滞留已完成工具）──────────────────────────────
eq('成员取自新列表：新列表没有的键 ⇒ 不再出现',
  mergeActiveStatus([t('Shell', 'a', 'running'), t('Read', 'b', 'running')], [t('Read', 'b', 'running')])
    .map((x) => x.name), ['Read']);
eq('新列表新增的键 ⇒ 出现（并保留其状态）',
  mergeActiveStatus([t('Shell', 'a', 'running')], [t('Shell', 'a', 'running'), t('Grep', 'c', 'pending')])
    .map((x) => x.status), ['running', 'pending']);

// ── 键的身份：callID 优先，缺省 name#label ──────────────────────────────────
eq('callID 相同 ⇒ 视为同一调用（跨 label 变化也保序）',
  mergeActiveStatus([t('Shell', 'old', 'running', 'c1')], [t('Shell', 'new', 'pending', 'c1')])
    .map((x) => x.status), ['running']);
eq('callID 不同 ⇒ 不同调用；成员取自新列表 ⇒ 只出现新列表那条（保留其状态）',
  mergeActiveStatus([t('Shell', 'a', 'running', 'c1')], [t('Shell', 'a', 'pending', 'c2')])
    .map((x) => x.status), ['pending']);

// ── 空输入 ─────────────────────────────────────────────────────────────────
eq('prev 空 ⇒ 原样 next', mergeActiveStatus([], nextPend).map((x) => x.status), ['pending']);
eq('next 空 ⇒ 空', mergeActiveStatus(prevRun, []).length, 0);
eq('两者空 ⇒ 空', mergeActiveStatus(undefined, undefined).length, 0);

// ── 引用恒等（渲染层 memo / `unchanged` 判等依赖）────────────────────────────
const nextRef = [t('Shell', 'a', 'running')];
ok('无回退时返回 next **同一引用**', mergeActiveStatus([t('Shell', 'a', 'pending')], nextRef) === nextRef);
const prev2 = [t('Shell', 'a', 'running')];
const next2 = [t('Shell', 'a', 'pending')];
ok('有回退时返回**新数组**', mergeActiveStatus(prev2, next2) !== next2);

if (fail > 0) {
  console.log(`  ✗ tool_status_monotonic: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ tool_status_monotonic: ${pass} passed, 0 failed`);
process.exit(0);
