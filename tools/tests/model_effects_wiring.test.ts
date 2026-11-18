/**
 * 判据：**模型的唯一外行为（effects）必须真的被执行**，且**连续性基线以模型影子为准**。
 *
 * 2026-10-22 真机：「重连后，前端卡死在老的 turn 不 resync」。日志特征（用户截图）：
 *   · `[model] DIFF#… ev=iteration blocks=296->167 live=1->1 iter=148->148`
 *   · `[model] effect=pullTurn turn=1127` —— **每帧重复刷屏**
 *   · 页面 `[iter] … src=history` 反复出现，但 `live` 永远停在旧轮
 *
 * 根因两条（都是"接线缺失"，不是判据错）：
 *   ① `runShadowModel` 只**打日志**执行 effects（注释写着"接线期由 W2 落地"）——
 *      而 effects 是模型**唯一**的外行为通道（`docs/STATE-MODEL.md` §8 W1）⇒
 *      缺口永远补不上 ⇒ 模型每帧重复发同一个 effect，`live` 永久停在旧轮（卡死）。
 *   ② `resumeContinuity` 的基线 `currentMark()` 只读 **legacy** `state.activeTurn`；
 *      而**行源是模型**（`applyModel`）。legacy 已 idle、模型仍 live 时基线 turnID=0
 *      ⇒ 判据落 `!live.active && mark.turnID===0` ⇒ **NONE（不重载）** ⇒ 不 resync。
 *
 * 修法：
 *   · `pullIter` ⇒ `fetchIterationDetail`（已有权威入口，结果经 `iterations_loaded` 回同一条管道）；
 *   · `pullTurn` ⇒ `resyncAfterResume`（唯一权威重载出口），按 turn 合并窗口（3s / 整体 10s）；
 *   · `currentMark()` 先取 `shadow.live`，再回落 legacy，取更新的那个。
 *
 * ⛔ mutation 自证：
 *   · 把 effect 处理改回"只打日志" ⇒ ① 红；
 *   · `currentMark` 改回只读 `this.state.activeTurn` ⇒ ② 红；
 *   · 删掉合并窗口 ⇒ ③ 红（每帧一枪 = 重连风暴）。
 */
declare const process: { cwd: () => string; exit: (c: number) => void };
declare const require: (m: string) => any;
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const store: string = fs.readFileSync(
  path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');

// ── ① pullIter / pullTurn 必须真的执行（不再只打日志） ─────────────────────────
ok('① effect=pullIter ⇒ 调 fetchIterationDetail（权威拉取）',
  /effect=pullIter[\s\S]{0,600}this\.pullIterationDetail\(/.test(store));
ok('① effect=pullTurn ⇒ 调 pullTurnAuthoritative（权威重载）',
  /effect=pullTurn[\s\S]{0,600}this\.pullTurnAuthoritative\(/.test(store));
ok('① 旧形态（只 log 不执行）不再存在：pullIter 日志后必须跟真实调用',
  !/effect=pullIter turn=\$\{e\.turn\} iter=\$\{e\.iteration\}`\);\s*\n\s*\} else if \(e\.kind === 'pullTurn'\) \{\s*\n\s*log\('model', `effect=pullTurn turn=\$\{e\.turn\}`\);\s*\n\s*\} else \{/.test(store));
ok('① pullIterationDetail 真的发 RPC（复用既有入口）',
  /private pullIterationDetail\([\s\S]{0,900}this\.fetchIterationDetail\(turn, iter\)/.test(store));
ok('① pullTurnAuthoritative 走唯一权威出口 resyncAfterResume',
  /private pullTurnAuthoritative\([\s\S]{0,900}this\.resyncAfterResume\(`model-pull-turn-/.test(store));

// ── ② 连续性基线以模型影子为准 ────────────────────────────────────────────────
ok('② currentMark 先取 shadow.live',
  /private currentMark\(\): ResumeMark \{[\s\S]{0,500}sh\.live !== null[\s\S]{0,200}m\.turnID = sh\.live\.turn/.test(store));
ok('② currentMark 仍回落 legacy 且取更新的那个',
  /private currentMark\(\): ResumeMark \{[\s\S]{0,1500}this\.state\.activeTurn[\s\S]{0,400}\(t as number\) > m\.turnID/.test(store));

// ── ③ 合并窗口（防每帧一枪的重连风暴）────────────────────────────────────────
ok('③ pullIter 按 (turn,iter) 2s 合并',
  /private pullIterationDetail\([\s\S]{0,900}now - last < 2000/.test(store));
ok('③ pullTurn 按 turn 3s / 整体 10s 合并',
  /private pullTurnAuthoritative\([\s\S]{0,900}turn > 0 \? 3000 : 10000/.test(store));
ok('③ 合并表有上限（不无界增长）',
  /this\.pullTurnAt\.size > 32/.test(store));

// ── ④ 重连路径本身仍走判据（回归闸：别把 resumeContinuity 又换回无条件重载）────
ok('④ SSE 重连仍走 resumeContinuity（判据驱动）',
  /state === 'open'[\s\S]{0,1200}resumeContinuity\(\s*'sse-reopen'/.test(store));

console.log(`model_effects_wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
