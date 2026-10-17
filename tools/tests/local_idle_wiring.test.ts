/**
 * 「turn 结束 ⇒ 立刻本地置 idle」接线的**源码形态**门禁 —— 调用点计数证据。
 *
 * ── 背景（用户 2026-10-12 目标②，原话）──────────────────────────────────────────────
 *   *"iter 结束如果最后没 tool，那么代表整个 turn 结束了，应该立刻进入 idle"*。
 *   服务端 `PhaseDone`（`progress.phase === 'done'`）是 turn 结束的**最快**权威信号，
 *   而 `session(idle)` 要等 `Run()` **完全退出后**才发（`agent/agent.go:3531` 的 defer）。
 *   web 因此专门在 PhaseDone 时 `dispatchAgentIdle`（`useProgressStream.ts:1190-1198`）把会话
 *   **内存内**置 idle。原生此前只等 `session(idle)` → REST `loadSessions()` 往返
 *   ⇒ composer 的 busy 拖后。
 *
 * ── 钉什么（按 `docs/ARKTS-GOTCHAS.md` 的铁律：钉**调用点计数**，别钉"方法体存在"）─────
 * ① `core/store.ets` 剥注释后**必须真 import** `hasFreshPhaseDone` 且**有调用点 ≥1**；
 * ② `core/store.ets` 的 `applyLocalIdle(` **调用点 ≥ 2**（PhaseDone 路 + session(idle) 路）——
 *    这是"死消费"缺陷的反面：判据存在但没人调 = 用户操作静默无效。
 * ③ `core/streammerge.ets` **必须导出** `hasFreshPhaseDone(` 的**定义**（≥1）。
 *
 * ✅ 扫描器自证：打印扫了哪些文件 + 逐文件计数；**零扫描判红**（合计 0 ⇒ 红）。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 标记为模块（顶层 pass/fail 不落全局，避免与其它脚本测试重名 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const CORE: string = path.join(REPO, 'entry/src/main/ets/core');

/** **剥注释**（块 + 行；行注释用 `(^|[^:])//` 以免剥掉 `https://`）—— 只认**生产**调用点。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}

const STORE: string = 'store.ets';
const SM: string = 'streammerge.ets';
const storeSrc: string = stripComments(fs.readFileSync(path.join(CORE, STORE), 'utf8'));
const smSrc: string = stripComments(fs.readFileSync(path.join(CORE, SM), 'utf8'));

console.log(`  idle-scan dir=${CORE}`);
console.log(`  idle-scan files: ${STORE}, ${SM}`);
const storeSmImport: number = countOf(storeSrc, "from './streammerge'");
const storeName: number = countOf(storeSrc, 'hasFreshPhaseDone');
const storeCall: number = countOf(storeSrc, 'hasFreshPhaseDone(evs, lastSeqBefore');
const storeIdleCalls: number = countOf(storeSrc, 'this.applyLocalIdle(');
const smDef: number = countOf(smSrc, 'export function hasFreshPhaseDone(');
console.log(`  idle-scan ${STORE}: smImport=${storeSmImport} name=${storeName} hasFreshPhaseDone(=${storeCall} applyLocalIdle(=${storeIdleCalls}`);
console.log(`  idle-scan ${SM}: export hasFreshPhaseDone(=${smDef}`);

// ── ① store：真 import + hasFreshPhaseDone 调用点 ─────────────────────────────────
// ⛔ 钉"真 import"用两段（`from './streammerge'` + 名字总数 ≥2 = import + 调用），
//    而非整条 import 字面（顺序一变就假红 —— 本仓 GOTCHA：判据 ≠ 信号）。
ok(`store 真 import core/streammerge（${storeSmImport} ≥ 1）`, storeSmImport >= 1);
ok(`store 出现 hasFreshPhaseDone ≥2（import + 调用；实测 ${storeName}）`, storeName >= 2);
ok(`store 有 hasFreshPhaseDone(evs, lastSeqBefore…) 调用点（${storeCall} ≥ 1）`, storeCall >= 1);

// ── ② store：applyLocalIdle 调用点 ≥ 2（PhaseDone 路 + session(idle) 路）──────────
// ⛔ 钉计数而非"方法存在"：只留 1 处 = 只覆盖一条路（PhaseDone 或 session idle），
//    用户点名的"立刻进入 idle"会有一半场景落空。
ok(`store applyLocalIdle( 调用点 ≥ 2（PhaseDone + session(idle)；实测 ${storeIdleCalls}）`,
  storeIdleCalls >= 2);

// ── ③ streammerge：必须导出 hasFreshPhaseDone 定义 ──────────────────────────────
ok(`streammerge 导出 hasFreshPhaseDone 定义（${smDef} ≥ 1）`, smDef >= 1);

// ── ④ store.cancel：**乐观进 idle**（用户 2026-10-12：*"点了 cancel … 请求成功立刻进入 idle"*）──
//    判据（web `useChatMessages.ts:870-884`）：成功后立即 push 两条状态机事件 ——
//    `session_running(false)`（清权威闸门 + 定格）与 `session(busy=false)`（清 coarse busy）。
//    ⛔ 钉调用点：这两条**必须**在 cancel 生效路径里（否则 composer 要等 SSE session(idle)）。
const cancelOptimistic: number = countOf(storeSrc, "{ type: 'session', busy: false }");
console.log(`  idle-scan ${STORE}: cancel 乐观 idle push=${cancelOptimistic}`);
ok(`store.cancel 乐观 idle push（session busy=false）≥ 1（实测 ${cancelOptimistic}）`, cancelOptimistic >= 1);

// ── ⑤ **乐观置 running**（用户 2026-10-17 P0「mid-turn idle 冻结」的根因接线）──────────────
//    判据：`send()` 回执后按 `sendStartsTurn` 门控推 `session_running(true)`（对齐 web
//    `AgentPanel.tsx:177-180` 的 `setStatus(selector,'running')`）。缺它 ⇒ turn 行进中
//    `sessionRunning` 恒 false ⇒ 粗粒度 idle 闸门（reduce/store 两处）恒失效 ⇒ 迟到 idle
//    冻结在飞 turn。⛔ 钉**调用点**（判据存在但没人调 = 静默无效）—— 判据在
//    `tools/tests/send_optimistic_running.test.ts`（端到端）。
const smSendStartsTurnExport: number = countOf(smSrc, 'export function sendStartsTurn(');
const storeSendStartsTurnName: number = countOf(storeSrc, 'sendStartsTurn');
const storeSendStartsTurnCall: number = countOf(storeSrc, 'sendStartsTurn(ack.turn_id');
const storeOptRunningPush: number = countOf(storeSrc, "'session_running', running: true");
console.log(`  idle-scan ${STORE}: sendStartsTurn name=${storeSendStartsTurnName} call=${storeSendStartsTurnCall} optRunning=${storeOptRunningPush}`);
console.log(`  idle-scan ${SM}: export sendStartsTurn(=${smSendStartsTurnExport}`);
ok(`streammerge 导出 sendStartsTurn 定义（${smSendStartsTurnExport} ≥ 1）`, smSendStartsTurnExport >= 1);
ok(`store 真用 sendStartsTurn（import + 调用 ≥2；实测 ${storeSendStartsTurnName}）`, storeSendStartsTurnName >= 2);
ok(`store.send 按 sendStartsTurn 门控（调用点 ${storeSendStartsTurnCall} ≥ 1）`, storeSendStartsTurnCall >= 1);
ok(`store.send 乐观推 session_running(true)（调用点 ${storeOptRunningPush} ≥ 1）`, storeOptRunningPush >= 1);

// ── 零扫描判红：链接线调用点合计必须 > 0（扫描器与真源脱节 ⇒ 红）──────────────────
ok('零扫描判红：本地置 idle 接线调用点合计 > 0',
  storeSmImport + storeCall + storeIdleCalls + smDef > 0);

console.log(`  local-idle-wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
