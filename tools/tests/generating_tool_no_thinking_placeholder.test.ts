/**
 * generating_tool_no_thinking_placeholder.test.ts —— 「生成 N 字」时**不得再叠「思考中…」**
 * （用户 2026-11-18：「有时候 tool 显示生成 xxx 字的时候，下方会渲染一个『思考中』」）。
 *
 * ## 真因
 * `core/pillflow.ts: isRunningStatus` 漏了 `generating`（和 `executing`）：
 * ```
 * return s === 'running' || 'pending' || 'streaming' || 'queued' || 'in_progress' || 'started';
 * ```
 * ⇒ `anyRunning([{status:'generating'}])` = **false** ⇒ 页面 `turnHasRunningTool()` = false
 * ⇒ `showsBusyPlaceholder` 里那条 `hasRunningTool ⇒ 不叠占位` 的守卫**失效**
 * ⇒ 「生成 N 字」pill 下面又出一条「思考中…」= 两条进度语义打架
 *   （与 2026-10-28「`task_wait: 执行中` 下面紧跟思考中」是同一纪律，判据同名同源）。
 *
 * ⛔ 为什么必须在 `isRunningStatus` 这一层修：`hasRunningTool` 的**唯一输入**就是它
 *   （`Index.turnHasRunningTool()` → `anyRunning(liveTools)` / `anyRunning(块内 tools)`）。
 *   在页面里再补 `|| status==='generating'` 会让"在飞"的判据出现第二份实现（本仓明令禁止）。
 *
 * ## 动效（第二问：生成中能不能有动效）
 * `core/toolstatus.isInFlight(kind, live)` 已经覆盖 `generating`（`isLiveStatus` 含它）⇒
 *   生成中的 pill **无论住在 live 块还是已提交块**都带扫光。本判据把它钉住：
 *   若有人把 `generating` 从 `isLiveStatus` 拿掉（"生成中不该有动效"式误改），④ 必红。
 *
 * ⛔ mutation 自证：
 *   ① 从 `isRunningStatus` 删掉 `'generating'` ⇒ ①/② 红；
 *   ② 从 `isLiveStatus` 删掉 `ST_GENERATING` ⇒ ④ 红；
 *   ③ 删掉 `showsBusyPlaceholder` 里的 `hasRunningTool` 守卫 ⇒ ③ 红。
 */
export {};

declare const process: { exit: (c: number) => void };

import { anyRunning } from '../../entry/src/main/ets/core/pillflow';
import { showsBusyPlaceholder, BusySignals } from '../../entry/src/main/ets/core/indicators';
import { isInFlight, isLiveStatus, isToolInProgress, ST_GENERATING, ST_RUNNING, ST_DONE } from '../../entry/src/main/ets/core/toolstatus';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function signals(over: Partial<BusySignals>): BusySignals {
  const base: BusySignals = {
    tailShowsIndicator: false,
    liveHasContent: false,
    localBusy: true,
    freshServerRunning: false,
    loading: false,
    rowsLen: 5,
    splashUp: false,
  };
  const out: BusySignals = { ...base };
  if (over.hasRunningTool !== undefined) out.hasRunningTool = over.hasRunningTool;
  if (over.sending !== undefined) out.sending = over.sending;
  if (over.localBusy !== undefined) out.localBusy = over.localBusy;
  return out;
}

// ── ① `generating` 必须算"在跑"（这是「思考中」误显示的根因）──────────────────────
ok('① anyRunning 认 generating', anyRunning([{ status: ST_GENERATING }]) === true);
ok('①b anyRunning 认 executing（toolstatus 归入 running 档）',
  anyRunning([{ status: 'executing' }]) === true);
ok('①c 原有六种状态仍然成立',
  anyRunning([{ status: 'running' }]) && anyRunning([{ status: 'pending' }])
  && anyRunning([{ status: 'streaming' }]) && anyRunning([{ status: 'queued' }])
  && anyRunning([{ status: 'in_progress' }]) && anyRunning([{ status: 'started' }]));
ok('①d 终态不算在跑', anyRunning([{ status: ST_DONE }]) === false
  && anyRunning([{ status: 'failed' }]) === false);

// ── ② 混合列表里有一枚 generating ⇒ 整体在跑 ──────────────────────────────────
ok('② 混合列表：done + generating ⇒ 在跑',
  anyRunning([{ status: ST_DONE }, { status: ST_GENERATING }]) === true);

// ── ③ 页面占位判据：有在飞工具 ⇒ 不渲染「思考中…」──────────────────────────────
ok('③ hasRunningTool=true ⇒ 不出占位（无 running 工具时 busy 会出）',
  showsBusyPlaceholder(signals({ hasRunningTool: true })) === false);
ok('③b 反向：没有在飞工具 + busy ⇒ 出占位（守住"该出的时候要出"）',
  showsBusyPlaceholder(signals({ hasRunningTool: false })) === true);
ok('③c sending 期间不出占位（发送中语义）',
  showsBusyPlaceholder(signals({ hasRunningTool: false, sending: true })) === false);

// ── ④ 动效：generating 在任何容器里都算在飞（扫光）─────────────────────────────
ok('④ isLiveStatus 含 generating', isLiveStatus(ST_GENERATING) === true);
ok('④b generating 住 live 块 ⇒ 在飞', isInFlight(ST_GENERATING, true) === true);
ok('④c generating 住已提交块 ⇒ **也在飞**（生成是持续进度，块提交了不该静止）',
  isInFlight(ST_GENERATING, false) === true);
ok('④d running 同口径', isInFlight(ST_RUNNING, false) === true);
ok('④e 终态永远安静', isInFlight(ST_DONE, true) === false);
ok('④f isToolInProgress 含 generating（思考领读那条判据）',
  isToolInProgress(ST_GENERATING) === true);

console.log(`generating_tool_no_thinking_placeholder: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
