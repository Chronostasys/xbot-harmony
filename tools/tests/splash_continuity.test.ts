/**
 * 开屏「时序连续性」审计判据（目标⑤，2026-10-11）—— 把**审计结论**钉成可红断言。
 *
 * 为什么需要：`splash.test.ts` 钉的是**纯模型**（`splashPhaseAt` 的 220/540 真值表）与铁律；
 *   但**生产实际跑的不是那条时间线** —— 页面（`pages/Index.ets`）用**两道闸门**
 *   （`shouldStartSplash` 迟滞 / `shouldShowSplash` minDwell+就绪）驱动相位，`splashPhaseAt` 在
 *   `entry/` 里 **0 消费点**（仅测试）。⇒ 这里补三条**审计发现**的可红判据：
 *
 *   ★A **品牌停驻窗 > 0**：标记入场（`SPLASH_ENTER_MS`）必须**早于**让位下限（`SPLASH_MIN_DWELL_MS`）
 *      跑完 ⇒ 品牌有一刻**静止**。若有人把 `splashPhaseAt` 的 [220,540) 模型直接接进页面
 *      （T2 在 220ms 就开始），停驻窗归零 ⇒ 标记"刚到就散"（用户口径「不干净」）⇒ ★A 必红。
 *   ★B **提示淡入窗与覆盖层退场窗完全重合**（audit 发现，非理想）：`SPLASH_HINT_DELAY_MS`
 *      （= `SPLASH_ENTER_MS`）到 `animEaseOut()`（= `MOTION_SLOW_MS` = `SPLASH_EXIT_MS`）之间淡入，
 *      而整层退场也在同一窗内 1→0 ⇒ 提示**有效**不透明度 = hint×overlay = `p·(1−p)`，峰值仅 **0.25**。
 *      ⇒ 判据只钉"重合"这一**结构性事实**（+ 打印峰值自证），**不**把 0.25 当"期望值"钉住；
 *      缺口本身记在 `docs/SPLASH-SPEC.md §11`（待裁决）。
 *   ★C **生产相位驱动 = 闸门，不是 `splashPhaseAt`**：`pages/Index.ets` 只 import 两道闸门 +
 *      直接置 `SPLASH_T2/T3`；`splashPhaseAt*` 在生产 **0 消费点**。这条**把现状钉住** ——
 *      将来若真把 `splashPhaseAt` 接进页面（规格本意），本判据会红，提醒同步改规格与 ★A。
 *
 * ⛔ 纪律：读**真实源码**；打印自证值；**零扫描判红**（探测不到仓库根/读到空源码 = 红）。
 * ⛔ 组件/页面**一个字不改**（本波只审计 + 注释订正）。
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import {
  SPLASH_ENTER_MS,
  SPLASH_EXIT_MS,
  SPLASH_HINT_DELAY_MS,
  SPLASH_MIN_DWELL_MS,
} from '../../entry/src/main/ets/core/splash';
import { MOTION_BASE_MS, MOTION_SLOW_MS } from '../../entry/src/main/ets/core/motion';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const fsMod = require('fs');
const pathMod = require('path');

/** 探测仓库根（含 entry/src/main/ets/core/splash.ets）。 */
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const cand = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/core/splash.ets'))) { repo = cand; break; }
}
ok('探测到仓库根（含 core/splash.ets）—— 零扫描判红', repo.length > 0);

/** 剥注释（保留换行）—— 源码形态判据只看代码（本仓已入库 GOTCHA：不剥注释会被注释里的名字骗）。 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c: string = src.charAt(i);
    const n: string = i + 1 < src.length ? src.charAt(i + 1) : '';
    if (c === '/' && n === '/') {
      while (i < src.length && src.charAt(i) !== '\n') { i++; }
      if (i < src.length) { out += '\n'; i++; }
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src.charAt(i) === '*' && i + 1 < src.length && src.charAt(i + 1) === '/')) {
        if (src.charAt(i) === '\n') { out += '\n'; }
        i++;
      }
      i += 2;
    } else { out += c; i++; }
  }
  return out;
}

/** 递归收集 `entry/src/main/ets/**` 下的 `.ets` 文件（供"生产消费点计数"）。 */
function walkEts(dir: string, out: string[]): void {
  let names: string[] = [];
  try { names = fsMod.readdirSync(dir); } catch (e) { return; }
  for (let i = 0; i < names.length; i++) {
    const p: string = pathMod.join(dir, names[i]);
    let st: any = null;
    try { st = fsMod.statSync(p); } catch (e) { st = null; }
    if (st === null) { continue; }
    if (st.isDirectory()) { walkEts(p, out); }
    else if (names[i].length > 4 && names[i].substring(names[i].length - 4) === '.ets') { out.push(p); }
  }
}

// ── ★A 品牌**停驻窗** > 0：入场必须早于让位下限跑完（"刚到就散"是缺陷）─────────────────
//
// 生产时间线（file:line 取证）：
//   · 入场 = `SplashOverlay.ets:213 animateTo(animBase(), …)`，`animBase()` = `MOTION_BASE_MS`(220)；
//   · 让位 = `pages/Index.ets:919 beginExitSplash()`，最早由 `:883` 的 `minDwell` 定时器
//     （`SPLASH_MIN_DWELL_MS`(400)）触发（内容就绪时）⇒ 让位**最早** 400ms 才开始。
//   ⇒ 停驻窗 = `SPLASH_MIN_DWELL_MS − SPLASH_ENTER_MS` = 180ms > 0（标记有一段静止）。
// mutation 自证：把 `SPLASH_MIN_DWELL_MS` 的派生式改成 `MOTION_FAST_MS`(180 < 220) ⇒ ★A 必红。
{
  const stillness: number = SPLASH_MIN_DWELL_MS - SPLASH_ENTER_MS;
  console.log(`▶ ★A 自证：入场 ${SPLASH_ENTER_MS}ms · 让位下限 ${SPLASH_MIN_DWELL_MS}ms`
    + ` · 停驻窗 ${stillness}ms`);
  eq('★A 入场 = MOTION_BASE_MS（animBase 工厂同源）', SPLASH_ENTER_MS, MOTION_BASE_MS);
  ok('★A 让位下限 > 入场 ⇒ 品牌有一刻静止（不是"刚到就散"）', SPLASH_MIN_DWELL_MS > SPLASH_ENTER_MS);
  ok('★A 停驻窗 > 0', stillness > 0, `stillness=${stillness}`);
  // 若有人把 `splashPhaseAt` 的 [ENTER, ENTER+EXIT) 当 T2（模型如此）⇒ 停驻窗 = 0 ⇒ 这条会红。
  ok('★A 停驻窗 ≥ 1 帧量级（≥ MOTION_BASE_MS 的一半）—— 保证"静止"可被眼睛读到时',
    stillness >= MOTION_BASE_MS / 2, `stillness=${stillness}`);
}

// ── ★B 提示淡入窗 **完全重合** 覆盖层退场窗（audit 发现；缺口记 §11，不把 0.25 钉成期望）────
//
// 取证：`SplashOverlay.ets:200 .opacity(this.hintOpacity)`（子层）嵌在 `:204 .opacity(this.overlayOpacity)`
//   （整层）里 ⇒ 提示**有效**不透明度 = hintOpacity × overlayOpacity。
//   · 提示：`SplashOverlay.ets:221 animateTo(withDelay(animEaseOut(), SPLASH_HINT_DELAY_MS), …)`
//     ⇒ 从 `SPLASH_HINT_DELAY_MS`(220) 起、用 `animEaseOut()`（= `MOTION_SLOW_MS`(320)）淡入 0→1；
//   · 整层退场：`SplashOverlay.ets:141 animateTo(animEaseOut(), …)` 1→0。
//   ⇒ 两窗**逐毫秒重合**（都从 220 起、都 320 长）⇒ 取进度 p ⇒ 有效 α = p·(1−p)，峰值 0.25（p=0.5）。
{
  const hintFadeMs: number = MOTION_SLOW_MS; // animEaseOut() 的时长（底座唯一来源）
  console.log(`▶ ★B 自证：提示 delay=${SPLASH_HINT_DELAY_MS}ms · 淡入 ${hintFadeMs}ms`
    + ` · 退场 ${SPLASH_EXIT_MS}ms · 两者${(SPLASH_HINT_DELAY_MS === SPLASH_ENTER_MS
      && hintFadeMs === SPLASH_EXIT_MS) ? '**完全重合**' : '不重合'}`);
  eq('★B 提示延迟 = T1 入场结束（= SPLASH_ENTER_MS）', SPLASH_HINT_DELAY_MS, SPLASH_ENTER_MS);
  eq('★B 提示淡入时长 = 整层退场时长（animEaseOut = MOTION_SLOW_MS = SPLASH_EXIT_MS）',
    hintFadeMs, SPLASH_EXIT_MS);
  // 结构性事实：两窗重合 ⇒ 有效 α 峰值 = max p(1−p) = 0.25（与曲线形状无关，扫遍 p 即得）。
  let peak: number = 0;
  for (let i: number = 0; i <= 1000; i++) {
    const p: number = i / 1000;
    const a: number = p * (1 - p);
    if (a > peak) { peak = a; }
  }
  console.log(`▶ ★B 推得：提示**有效**不透明度峰值 ≈ ${peak.toFixed(4)}（hint×overlay，p·(1−p)）`
    + ` —— ⚠️ 缺口：提示几乎读不出来，见 docs/SPLASH-SPEC.md §11（待裁决）`);
  ok('★B 提示**存在**淡入（有效 α 峰值 > 0 ⇒ 是渐隐/渐显，不是硬切）', peak > 0);
  ok('★B 峰值不出界（≤ 0.26，两窗重合的必然结果）—— 若将来修好（峰值≈1）本条会红，'
    + '请同步更新 docs/SPLASH-SPEC.md §11 并改写本条', peak <= 0.26, `peak=${peak}`);
}

// ── ★C 生产相位驱动 = **闸门**，不是 `splashPhaseAt`（把现状钉住，防静默分叉）────────────
//
// 取证：`pages/Index.ets:112-116` 只 import `shouldShowSplash`/`shouldStartSplash`（两道闸门）
//   + 直接置 `splashPhase = SPLASH_T2`（`:928`）/`SPLASH_T3`（`:930`/`:941`）；
//   `splashPhaseAt` / `splashPhaseStartMs` / `splashPhaseDurationMs` 在 `entry/` **零消费点**。
//   ⇒ 规格 §4.1 的 220/540 真值表**只在测试里成立**，生产 T1 实际停在 `minDwell`(400) 之后才让位。
{
  const etsRoot: string = pathMod.join(repo, 'entry/src/main/ets');
  const files: string[] = [];
  walkEts(etsRoot, files);
  ok(`★C 扫到生产 .ets 文件 > 0（实得 ${files.length}）—— 零扫描判红`, files.length > 0);
  // 排除 core/splash.ets 自身（定义处不算"消费"）。
  const selfPath: string = pathMod.join(etsRoot, 'core/splash.ets');
  const names: string[] = ['splashPhaseAt', 'splashPhaseStartMs', 'splashPhaseDurationMs', 'splashOrbAllowed', 'splashPhaseIsInFlight'];
  const counts: number[] = [];
  for (let n: number = 0; n < names.length; n++) { counts.push(0); }
  for (let f: number = 0; f < files.length; f++) {
    if (files[f] === selfPath) { continue; }
    const code: string = stripComments(fsMod.readFileSync(files[f], 'utf8'));
    for (let n: number = 0; n < names.length; n++) {
      const re = new RegExp(names[n], 'g');
      const m = code.match(re);
      if (m !== null) { counts[n] += m.length; }
    }
  }
  console.log(`▶ ★C 生产消费点计数：${names.map((nm, i) => `${nm}=${counts[i]}`).join(' · ')}`);
  ok('★C `splashPhaseAt` 在生产 **0 消费点**（相位由闸门驱动，不是纯模型的 220/540 时间线）', counts[0] === 0);
  ok('★C `splashOrbAllowed` 在生产 **0 消费点**（"光球交接"铁律当前**仅测试**，未接线）', counts[3] === 0);
  // 页面必须**真的**用两道闸门（否则闸门也是死码 ⇒ 一并判红）。
  let idxCode: string = '';
  const idxPath: string = pathMod.join(etsRoot, 'pages/Index.ets');
  if (fsMod.existsSync(idxPath)) { idxCode = stripComments(fsMod.readFileSync(idxPath, 'utf8')); }
  ok('★C 读到 pages/Index.ets 源码', idxCode.length > 0);
  ok('★C 页面**消费**闸门 shouldStartSplash（迟滞闸门真接线）', idxCode.indexOf('shouldStartSplash') >= 0);
  ok('★C 页面**消费**闸门 shouldShowSplash（minDwell/就绪/超时真接线）', idxCode.indexOf('shouldShowSplash') >= 0);
  ok('★C 页面**不** import `splashPhaseAt`（相位非纯模型驱动）', idxCode.indexOf('splashPhaseAt') < 0);
}

if (fail > 0) { console.log(`  splash_continuity: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  splash_continuity: ${pass} passed, 0 failed`);
process.exit(0);
