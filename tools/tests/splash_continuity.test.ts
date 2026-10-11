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
 *   ★B **提示「有效可见度」= hint × overlay 的乘积**（`docs/SPLASH-SPEC.md §15 F2` 修复后）：
 *      渲染侧提示的 `.opacity(hintOpacity)` **嵌在**整层 `.opacity(overlayOpacity)` 内 ⇒ 用户看到的
 *      有效 α = 两者**乘积**（⛔ 只断言单层 opacity 会假绿）。修法 = 把提示淡入窗**收进**
 *      `[0, SPLASH_MIN_DWELL_MS)`（`delay + fade = 220 + 180 = 400`）⇒ 退场开始前满显 ⇒ 峰值 **1**。
 *      ⚠️ 审计 §14.1 ⑩ 的 "峰值 0.25" 是把退场锚在 `SPLASH_ENTER_MS`(220)（§4.1 纯模型）算的；
 *      **生产**退场锚在 `SPLASH_MIN_DWELL_MS`(400) ⇒ 旧实现真实峰值 **0.8808**（仍 < 1）。本判据用
 *      **生产锚点**并钉"峰值必须 == 1"（旧值 0.8808 ⇒ 必红）。
 *   ★C **生产相位驱动 = 闸门，不是 `splashPhaseAt`**：`pages/Index.ets` 只 import 两道闸门 +
 *      直接置 `SPLASH_T2/T3`；`splashPhaseAt*` 在生产 **0 消费点**。这条**把现状钉住** ——
 *      将来若真把 `splashPhaseAt` 接进页面（规格本意），本判据会红，提醒同步改规格与 ★A。
 *      同时守护 §15 F3：死判据 `splashOrbAllowed` **不得复活**（0 消费点、与实际"揭示式交接"冲突）。
 *
 * ⛔ 纪律：读**真实源码**；打印自证值；**零扫描判红**（探测不到仓库根/读到空源码 = 红）。
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
  SPLASH_HINT_FADE_MS,
  SPLASH_MIN_DWELL_MS,
  curveProgressAt,
} from '../../entry/src/main/ets/core/splash';
import { MOTION_BASE_MS, MOTION_FAST_MS, MOTION_SLOW_MS } from '../../entry/src/main/ets/core/motion';
import { EASE_OUT_CSS } from '../../entry/src/main/ets/core/tokens';

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

// ── ★B 提示**有效可见度**（= hint × overlay 的**乘积**）—— §15 F2 修复后可红判据 ──────────────
//
// 口径（为什么是**乘积**而非单层 opacity）：渲染侧跳过提示的不透明度**嵌在整层**里 ——
//   `SplashOverlay.ets` 的 `.opacity(this.hintOpacity)` 在 `.opacity(this.overlayOpacity)` 之内
//   ⇒ 用户真正看到的**有效 α = hintOpacity × overlayOpacity**（⛔ 只断言单层会假绿：单层到 1 时整层可能已 0.3）。
//
// 时间锚点（**生产**，见 §15 F1：唯一主人 = 两道闸门，不是 §4.1 纯模型）：
//   · 提示淡入窗 = `[SPLASH_HINT_DELAY_MS, SPLASH_HINT_DELAY_MS + SPLASH_HINT_FADE_MS]`
//     （`SplashOverlay.ets` 的 `withTiming(animEaseOut(), …)`，曲线无超调 = `EASE_OUT_CSS`）；
//   · 整层退场窗 = 自 `SPLASH_MIN_DWELL_MS`（让位**最早**的触发点）起、`SPLASH_EXIT_MS` 长、`EASE_OUT_CSS` 1→0。
//   ⚠️ 审计 §14.1 ⑩ 的 "峰值 0.25" 是把退场锚在 `SPLASH_ENTER_MS`(220)（§4.1 纯模型）算的；
//      **生产**退场锚在 `SPLASH_MIN_DWELL_MS`(400) ⇒ 旧实现真实峰值 ≈ 0.8808（仍 < 1：
//      提示**从未**在整层退场前满显）。⇒ 本判据用生产锚点，并额外钉"峰值必须 == 1"。
//
// mutation 自证：把 `SPLASH_HINT_FADE_MS` 改回 `MOTION_SLOW_MS`（旧窗 [220,540]）⇒ 峰值 0.8808 < 1 ⇒ 必红。
{
  const exitAnchor: number = SPLASH_MIN_DWELL_MS; // 让位**最早**的触发点（生产锚点）
  const hintEnd: number = SPLASH_HINT_DELAY_MS + SPLASH_HINT_FADE_MS;
  console.log(`▶ ★B 自证：提示 delay=${SPLASH_HINT_DELAY_MS}ms · 淡入 ${SPLASH_HINT_FADE_MS}ms`
    + `（窗 [${SPLASH_HINT_DELAY_MS}, ${hintEnd}]）· 退场锚 ${exitAnchor}ms · 退场 ${SPLASH_EXIT_MS}ms`
    + ` · ${hintEnd <= exitAnchor ? '淡入**在退场前跑完**' : '淡入**跨过退场点**（缺陷）'}`);

  // 有效 α 的可测推演（与渲染**同源**：同一 delay/fade/exit 常量 + 同一 `EASE_OUT_CSS`）
  const hintAt = (t: number): number => {
    if (t < SPLASH_HINT_DELAY_MS) { return 0; }
    if (t >= hintEnd) { return 1; }
    return curveProgressAt(EASE_OUT_CSS, (t - SPLASH_HINT_DELAY_MS) / SPLASH_HINT_FADE_MS);
  };
  const overlayAt = (t: number): number => {
    if (t < exitAnchor) { return 1; }
    if (t >= exitAnchor + SPLASH_EXIT_MS) { return 0; }
    return 1 - curveProgressAt(EASE_OUT_CSS, (t - exitAnchor) / SPLASH_EXIT_MS);
  };
  let peak: number = 0;
  let peakAt: number = 0;
  let bounded: boolean = true;
  const tEnd: number = exitAnchor + SPLASH_EXIT_MS;
  for (let i: number = 0; i <= 2000; i++) {
    const t: number = (tEnd * i) / 2000;
    const a: number = hintAt(t) * overlayAt(t);
    if (!(a >= 0 && a <= 1)) { bounded = false; }
    if (a > peak) { peak = a; peakAt = t; }
  }
  console.log(`▶ ★B 推得：提示**有效**不透明度峰值 = ${peak.toFixed(4)}（@t=${peakAt.toFixed(1)}ms）`
    + ` · 值域[0,1]=${bounded} · 首帧有效 α=${(hintAt(0) * overlayAt(0)).toFixed(4)}`);

  // 同源（值来自底座常量，零自造）
  eq('★B 提示延迟 == SPLASH_ENTER_MS（标记入场结束才提示）', SPLASH_HINT_DELAY_MS, SPLASH_ENTER_MS);
  eq('★B 提示淡入时长 == MOTION_FAST_MS（底座唯一"快速"档，零自造）', SPLASH_HINT_FADE_MS, MOTION_FAST_MS);
  eq('★B 退场时长 == MOTION_SLOW_MS（派生自底座 motion.ets）', SPLASH_EXIT_MS, MOTION_SLOW_MS);
  // ① 有效 α **真满显过**（== 1）—— 提示必须在整层退场开始前（或恰在开始时）达到满显。
  //    ⛔ 只断言"峰值 > 0.25"会被**旧实现**（≈0.88）蒙混过关 ⇒ 这里钉"必须 == 1"。
  ok('★B 提示**有效 α 峰值 == 1**（真满显过；旧实现 ≈0.8808 ⇒ 必红）', peak >= 0.999, `peak=${peak}`);
  ok('★B 峰值 ≤ 1（乘积不出界，无"叠加过曝"）', peak <= 1 + 1e-9, `peak=${peak}`);
  ok('★B 峰值 **显著 > 0.25**（§14.1 ⑩ 的缺陷阈值，"读得出"的底线）', peak > 0.25, `peak=${peak}`);
  // ② 结构不变量（§15 F2 裁决原文）：提示淡入**在整层退场开始前跑完**。
  ok('★B 提示淡入窗在整层退场开始前跑完（delay + fade ≤ SPLASH_MIN_DWELL_MS）',
    hintEnd <= exitAnchor, `delay+fade=${hintEnd} · minDwell=${exitAnchor}`);
  ok('★B 值域 [0,1]（无超调 ⇒ 有效 α 不越界）', bounded);
  ok('★B 首帧提示不可见（先给纯品牌，§4.6「顺序不反」）', hintAt(0) * overlayAt(0) === 0);
  // ③ 零扫描判红：必须真读到组件源码（否则上面"同源"的论证是空的）
  const ovSrc: string = repo.length > 0
    ? stripComments(fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/components/SplashOverlay.ets'), 'utf8'))
    : '';
  ok('★B 读到 SplashOverlay.ets 源码（零扫描判红）', ovSrc.length > 0);
  ok('★B 组件真消费 SPLASH_HINT_FADE_MS（判据与渲染同源）', ovSrc.indexOf('SPLASH_HINT_FADE_MS') >= 0);
  // ⛔ 提示的不透明度**仍嵌在整层内**（§15 F2：不许把它从整层摘出来 —— 整层退场必须连它一起淡）
  ok('★B 提示不透明度**仍嵌在整层内**（有效 α 仍是乘积，⛔ 未被摘出）',
    ovSrc.indexOf('.opacity(this.hintOpacity)') >= 0 && ovSrc.indexOf('.opacity(this.overlayOpacity)') >= 0);
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
  const names: string[] = ['splashPhaseAt', 'splashPhaseStartMs', 'splashPhaseDurationMs'];
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
  // §15 F3：死判据 `splashOrbAllowed` **已删除**（0 消费点、与实际"揭示式交接"冲突）—— 不得复活。
  let coreSrc: string = '';
  if (fsMod.existsSync(selfPath)) { coreSrc = stripComments(fsMod.readFileSync(selfPath, 'utf8')); }
  ok('★C 读到 core/splash.ets 源码（F3 守卫）', coreSrc.length > 0);
  ok('★C 死判据 `splashOrbAllowed` 已删除、不得复活（§15 F3）', coreSrc.indexOf('splashOrbAllowed') < 0);
  ok('★C `splashPhaseIsInFlight` 仍在（"开屏不是在飞"的恒值判据，仍成立）',
    coreSrc.indexOf('splashPhaseIsInFlight') >= 0);
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
