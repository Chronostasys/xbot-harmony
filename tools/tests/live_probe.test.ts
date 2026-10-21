/**
 * live_probe.test.ts —— 「切回前台必须立刻用**轻量接口**判断自己是否 stall」的判据。
 *
 * 用户 2026-10-21 原话：
 *   「只要从别的应用切回来**必须立刻检查会话状态**，后端应该有可以立刻拿到最新迭代的接口吧？
 *     是不是会有个 live 接口之类的，每次切回来必须要调这种轻量接口 检查自己是否 stall」。
 *
 * 真机症状：切后台一段时间回来，界面停在「运行中…／思考中…」，SSE 已断，**没有**任何 resync。
 *
 * 判据分两层：
 *   ① 纯逻辑（`core/liveprobe.ets:liveProbeVerdict`）—— 真值表；
 *   ② 接线（本文件 grep 源码）—— `onAppResumed`/`onPageShow` **必须**先打探针；
 *      脉冲里的 stall 检测**不得**被滚动/触摸早退挡住（那次早退曾让 busy 永久卡死）。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
import { liveProbeVerdict, probePhaseActive, PROBE_OK, PROBE_STALL } from '../../entry/src/main/ets/core/liveprobe';

const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n▶ §A 真值表：服务端/本地不一致 ⇒ stall；本地领先 ⇒ ok（不得反清）');
{
  // 服务端在跑、本地以为空闲（错过了 turn_started）
  ok('★A 服务端 active + 本地 idle ⇒ stall', liveProbeVerdict(false, 0, 0, true, 9, 2) === PROBE_STALL);
  // 服务端已结束、本地还 busy（幽灵 busy，用户截图那种）
  ok('★A 服务端 idle + 本地 busy ⇒ stall', liveProbeVerdict(true, 9, 2, false, 0, 0) === PROBE_STALL);
  // 双方在跑但迭代落后（SSE 断了，错过了几个迭代）
  ok('★A 同 turn、服务端迭代更靠前 ⇒ stall', liveProbeVerdict(true, 9, 2, true, 9, 5) === PROBE_STALL);
  // 服务端快照滞后于本地（本地更靠前）⇒ 绝不能反清本地
  ok('★A 服务端迭代落后（快照滞后）⇒ ok', liveProbeVerdict(true, 9, 5, true, 9, 2) === PROBE_OK);
  // 完全一致
  ok('★A 完全一致 ⇒ ok', liveProbeVerdict(true, 9, 5, true, 9, 5) === PROBE_OK);
  // 都空闲
  ok('★A 双方都空闲 ⇒ ok', liveProbeVerdict(false, 0, 0, false, 0, 0) === PROBE_OK);
  // 服务端换了 turn（新回合已开始而本地还停在旧 turn）
  ok('★A 服务端 turn 更新 ⇒ stall', liveProbeVerdict(true, 8, 3, true, 9, 1) === PROBE_STALL);
  // 本地 turn 更新（服务端快照还是旧 turn）⇒ ok
  ok('★A 本地 turn 更新 ⇒ ok', liveProbeVerdict(true, 9, 1, true, 8, 3) === PROBE_OK);
}

console.log('\n▶ §B phase 语义：服务端 `done` = 没有在飞（否则每次切回来都误判 stall）');
{
  ok('★B phase=done ⇒ 无在飞', probePhaseActive('done') === false);
  ok('★B phase=thinking ⇒ 有在飞', probePhaseActive('thinking') === true);
  ok('★B phase 缺失 ⇒ 保守当作有在飞（只多判一次，不漏）', probePhaseActive(undefined) === true);
}

console.log('\n▶ §C 接线：切回前台**先**打探针（轻量），脉冲 stall 检测不被滚动挡住');
{
  const page = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/pages/Index.ets'), 'utf8');
  const store = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');
  ok('★C `onAppResumed` 调 `probeActiveStall`',
    /probeActiveStall\('foreground'\)/.test(page));
  ok('★C `onPageShow` 也调（两条 show 路径都覆盖）',
    /probeActiveStall\('pageshow'\)/.test(page));
  ok('★C 探针在 `loadHistory` 之前（`resyncAfterResume` 里先 loadSessions→loadHistory，探针更早触发）',
    page.indexOf("probeActiveStall('foreground')") < page.indexOf("store.resyncAfterResume('ability-foreground')"));
  ok('★C 脉冲里 `checkLiveSignalStall()` **先于**滚动/触摸早退',
    /this\.checkLiveSignalStall\(\);[\s\S]{0,200}if \(this\.userScrolling \|\| this\.userTouchActive\)/.test(page));
  ok('★C store 用轻量 RPC `RPC_GET_ACTIVE_PROGRESS`（不是重历史）',
    /RPC_GET_ACTIVE_PROGRESS/.test(store) && /ActiveProgressReq/.test(store));
  ok('★C 探针失败静默（不是 stall 的证据）', /catch \(e\) \{\s*\n\s*return;   \/\/ 旧服务端\/弱网/.test(store));
  ok('★C 判 stall 时触发**强制** resync（绕过 1.2s 节流）',
    /this\.resyncAfterResume\(`probe-\$\{reason\}`, true\)/.test(store));
}

console.log('\n▶ §D mutation 自证（外部注入）');
console.log('   · `liveProbeVerdict` 的 `!serverHasActive && localBusy` 分支返回 OK ⇒ §A 幽灵 busy 那条必红');
console.log('   · 把探针移动 `resyncAfterResume` 之后 ⇒ §C 顺序断言必红');
console.log('   · 把 `checkLiveSignalStall()` 放回早退之后 ⇒ §C 必红');

console.log(`\n  live_probe: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
