/**
 * 「T2 淡出 → 主界面光球」**接续**契约（目标⑤，2026-10-11）。
 *
 * ── 取证（`file:line` + 数值）──────────────────────────────────────────────────
 * | 环节 | 参数 | 值 | 出处 |
 * |---|---|---|---|
 * | T2 整层退场 | 曲线/时长 | `animEaseOut()` = **`MOTION_SLOW_MS` 320ms**、ease-out（**无超调**） | `SplashOverlay.ets:145` |
 * | T2 标记让位 | `markOpacity` 1→0 + `markLift` 0→12vp | 与整层**同一** `animateTo` ⇒ 同 320ms | `SplashOverlay.ets:146-148`、`SPLASH_MARK_EXIT_LIFT_VP`(=SPACE_SM=12) |
 * | 标记位置 | 覆盖层内容区中心（真机实测 bbox 中心 y=1443 = 内容区中心） | 屏幕**竖向中心** | 布局树（前几轮实测） |
 * | 光球入场 | 曲线/时长 | `animBase()` = **`MOTION_BASE_MS` 220ms** + 全站 spring（opacity 0→1、scale 0.86→1） | `AssistantOrb.ets:397`、`:699` |
 * | 光球位置 | 挂在**消息流/领读行**里（非屏幕中心） | `LiveTailView.ets:509`、`ThinkingLine.ets:119` | — |
 *
 * ── 判定：**已连贯**（"**揭示式**交接"，不是"两段动画的拼接"）────────────────────────
 * 光球在覆盖层**背后**（页面早已渲染完）⇒ T2 的 320ms 整层淡出是**把已就位的光球揭示出来**，
 * 不存在"标记消失 → 光球凭空出现"的**跳变**（位置差异因此**不构成突兀**）。
 * ⇒ 无需"让标记飞向光球"（那反而会把品牌标记变成飞行物）；出**判据钉住**这个语义。
 *
 * ⚠️ 但有一条**必须成立**的时间关系：**退场淡出要长于光球入场**（`320 ≥ 220`）⇒ 任何"淡出中途
 * 才挂载光球"的场景，其入场都**在覆盖层背后跑完**，不会露头半截。
 *
 * mutation 自证（必红）：① `SPLASH_MARK_EXIT_LIFT_VP` 抬到 60（标记"飞走"）⇒ ★① 红；
 *   ② 退场时长改成 120ms（短于光球入场 220）⇒ ★③ 红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { SPLASH_MARK_EXIT_LIFT_VP, SPLASH_MARK_BOX_VP } from '../../entry/src/main/ets/core/splash';
import { MOTION_BASE_MS, MOTION_SLOW_MS } from '../../entry/src/main/ets/core/motion';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
const fsMod = require('fs');
const pathMod = require('path');
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const cand = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/components/SplashOverlay.ets'))) { repo = cand; break; }
}
ok('探测到仓库根', repo.length > 0);
const strip = (x: string): string => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const overlay: string = repo.length > 0
  ? strip(fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/components/SplashOverlay.ets'), 'utf-8')) : '';
const orb: string = repo.length > 0
  ? strip(fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/components/AssistantOrb.ets'), 'utf-8')) : '';

// ── ★① 退场是"**退隐**"不是"**飞走**"（标记位移 ≤ 标记盒的 10%）────────────────────────
{
  ok(`★① 标记让位位移 ${SPLASH_MARK_EXIT_LIFT_VP}vp ≤ 标记盒 ${SPLASH_MARK_BOX_VP}vp 的 10%`,
    SPLASH_MARK_EXIT_LIFT_VP <= SPLASH_MARK_BOX_VP * 0.1);
  ok('  · 退场曲线走底座具名工厂 `animEaseOut()`（⛔ 非字面量时长、非 spring 超调）',
    overlay.indexOf('animateTo(animEaseOut(),') >= 0);
  ok('  · 标记让位与整层退场**同一次** animateTo（不各跑一套时长）',
    overlay.indexOf('this.overlayOpacity = 0;') >= 0 && overlay.indexOf('this.markLift = SPLASH_MARK_EXIT_LIFT_VP;') >= 0);
  ok(`  · 退场时长 ${MOTION_SLOW_MS}ms ∈ [200, 400]（"退隐"节奏）`, MOTION_SLOW_MS >= 200 && MOTION_SLOW_MS <= 400);
}

// ── ★② 交接是"**揭示式**"：开屏**不携带任何光球状态** ⇒ 淡出不可能重播/重置光球 ────────────
{
  ok('★② SplashOverlay 不引用光球（无 orb 相关标识 ⇒ 淡出不会二次入场/重播）',
    overlay.indexOf('AssistantOrb') < 0 && overlay.indexOf('orbMode') < 0 && overlay.indexOf('orbBeat') < 0);
  ok('  · 光球入场只由**挂载**触发（`onAppear`），不由开屏状态驱动',
    orb.indexOf('animateTo(animBase(),') >= 0);
  ok('  · 光球入场走底座工厂（⛔ 无字面量时长）', orb.indexOf('animBase()') >= 0 && orb.indexOf('duration:') < 0);
}

// ── ★③ **时间关系**：退场淡出 ≥ 光球入场（淡出中途挂载也在背后跑完，不露头半截）──────────
{
  ok(`★③ 退场淡出 ${MOTION_SLOW_MS}ms ≥ 光球入场 ${MOTION_BASE_MS}ms（覆盖得住中途挂载）`,
    MOTION_SLOW_MS >= MOTION_BASE_MS);
  ok('  · 两者都是**一次性**过渡（无一者循环 ⇒ 交接期无双重在飞）',
    overlay.indexOf('iterations') < 0 && orb.indexOf('iterations') < 0);
}

if (fail > 0) { console.log(`  handoff_motion: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  handoff_motion: ${pass} passed, 0 failed`);
process.exit(0);
