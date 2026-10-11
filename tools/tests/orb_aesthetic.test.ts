/**
 * 光球「美学可判」离线判据（目标⑤"比 Siri 好看"；⛔ 不占设备、纯逻辑）。
 *
 * ── 取证（`file:line` + 实测值，2026-10-11）──────────────────────────────────────
 * | 维度 | 参数 | 值 | 出处 |
 * |---|---|---|---|
 * | 几何 | 粒子数 / 环基准半径 / 粒子带 | 9 / 0.9 / [0.78, 0.96] | `AssistantOrb.ets:75` / `core/orb.ets:40` / `:48,:50` |
 * | | 粒子尺寸 / 透明度 / 角抖动 | [0.85,1.75] / [0.45,1.0] / 0.08 | `core/orb.ets:52,:54` / `:56,:58` / `:60` |
 * | | 核渐变 stop（实心/中/晕衰减） | 0.28 / 0.68 / 0.82 | `core/orb.ets:68,:73,:78` |
 * | 动势 | 呼吸周期 / 公转周期 | `D_SLOW*8`=2560ms / `D_SLOW*20`=6400ms | `core/orb.ets:26,:28` |
 * | | 呼吸幅度 / 透明度幅度 | [0.82,1.06] / [0.55,1.0] | `:32,:34` / `:36,:38` |
 * | | **吸气占空比 / 公转缓动深度** | **0.4 / 0.35** | `:128` / `:175` |
 * | | 帧率档 主/思考/让位/静默 | 30 / 20 / 18 / 12 | `:241,:256,:263,:265` |
 * | 色彩 | 环/核/晕/细环 | `statusRunning` / `accent` 家族 / `inflightHaloOf` / `hairlineOf` | `AssistantOrb.ets:515,525,528,531,536` |
 *
 * 「苹果科技感/干净」的可量化特征（本判据的三条）：
 *   ① **快吸慢呼的不对称呼吸**（对称 = 节拍器/机械感）；且**克制**（幅度不过 1.35×，不是脉冲）。
 *   ② **单一色相家族**（核/环/晕的色相偏离小 ⇒ "干净"；杂色 = 廉价）。
 *   ③ **让位/静默档降频**（不抢注意力；D3）。
 *
 * mutation 自证（必红）：① `ORB_BREATH_INHALE` 改 0.5（对称）或幅度改 1.6 ⇒ ★① 红；
 *   ② 给某主题的 accent 家族注入异色相（或改判定阈值）⇒ ★② 红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import {
  ORB_BREATH_INHALE, ORB_BREATH_MIN, ORB_BREATH_MAX, ORB_BREATH_MS,
  ORB_FPS_MAIN, ORB_FPS_THINKING, ORB_FPS_SECONDARY, ORB_FPS_IDLE,
  orbBreath,
} from '../../entry/src/main/ets/core/orb';
import { paletteOf, ALL_THEMES } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

// ── ★① 呼吸：**不对称**（快吸慢呼）+ **克制**（幅度不过大）+ 单峰单调 ──────────────────
{
  // 不对称：吸气占 30%~45%（⛔ 0.5 = 对称正弦 = 节拍器；两端留时长否则成锯齿）
  ok(`★① 吸气占空比 ∈ [0.30,0.45]（快吸慢呼，非对称；实得 ${ORB_BREATH_INHALE}）`,
    ORB_BREATH_INHALE >= 0.30 && ORB_BREATH_INHALE <= 0.45);
  ok('  · ⛔ 不是 0.5（对称 = 机械节拍）', ORB_BREATH_INHALE !== 0.5);
  // 克制：幅度比 ≤ 1.35（"呼吸"不是"脉冲"）
  const amp: number = ORB_BREATH_MAX / ORB_BREATH_MIN;
  ok(`  · 幅度比 ${amp.toFixed(3)} ≤ 1.35（克制，非脉冲）`, amp <= 1.35);
  // 周期够慢（≥2s；快 = 焦虑）
  ok(`  · 呼吸周期 ${ORB_BREATH_MS}ms ≥ 2000（慢）`, ORB_BREATH_MS >= 2000);
  // 波形：单峰 + 两段各自单调（快吸：升；慢呼：降）
  const P: number = ORB_BREATH_MS;
  const peak: number = ORB_BREATH_INHALE * P;
  let monoUp = true, monoDown = true, peakV = -1, peakT = -1;
  let prev = -1;
  // 两段**各自**采样（⛔ 不在 peak 处跨界比较 —— 那是采样伪影，不是函数非单调）
  for (let t = 0; t <= peak; t += peak / 32) {
    const v: number = orbBreath(t, P);
    if (v < prev - 1e-6) { monoUp = false; }
    if (v > peakV) { peakV = v; peakT = t; }
    prev = v;
  }
  prev = orbBreath(peak, P);
  for (let t = peak; t <= P; t += (P - peak) / 32) {
    const v: number = orbBreath(t, P);
    if (v > prev + 1e-6) { monoDown = false; }
    prev = v;
  }
  ok('  · [0, inhale×P] 单调不减（快吸段）', monoUp);
  ok('  · [inhale×P, P] 单调不增（慢呼段）', monoDown);
  ok(`  · 峰值时刻 ≈ inhale×P（实得 ${peakT.toFixed(0)} vs ${peak.toFixed(0)}）`, Math.abs(peakT - peak) <= P / 32);
  ok('  · 峰值 = 1、谷值 = 0（在峰值/零时刻求值，满量程不塌）',
    Math.abs(orbBreath(peak, P) - 1) < 1e-9 && Math.abs(orbBreath(0, P)) < 1e-9);
}

// ── ★② 单一色相家族（核/环/晕同色相 ⇒ "干净"；杂色 = 廉价）──────────────────────────
{
  /** 色相（度）。 */
  const hueOf = (hex: string): number => {
    const h = hex.length === 9 ? hex.slice(3) : hex.slice(1);
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) { return -1; }   // 无彩色（灰/黑白）⇒ 不入色相判定
    let hh = 0;
    if (mx === r) { hh = ((g - b) / d) % 6; } else if (mx === g) { hh = (b - r) / d + 2; } else { hh = (r - g) / d + 4; }
    hh = hh * 60; return hh < 0 ? hh + 360 : hh;
  };
  /** 环形色差（°）。 */
  const hueGap = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    const hs: number[] = [];
    // ⛔ 只判 **accent 家族**（核/环的主体色）：`statusRunning` 是**语义状态色**（工具在飞"一眼可辨"，
    //    见 DESIGN-SYSTEM §7 的态表）⇒ 设计上**本就该异色相**，纳入会误伤（见下方单独判据）。
    const names: string[] = ['accent', 'accentSoft'];
    const cols: string[] = [p.accent, p.accentSoft];
    for (let j = 0; j < cols.length; j++) {
      const hh = hueOf(cols[j]);
      if (hh >= 0) { hs.push(hh); } else { failures0(names[j]); }
    }
    let maxGap = 0;
    for (let a = 0; a < hs.length; a++) {
      for (let b = a + 1; b < hs.length; b++) { maxGap = Math.max(maxGap, hueGap(hs[a], hs[b])); }
    }
    // ⚠️ 阈值**来自实测基线 + 余量**（⛔ 不是为好看调的）：5 主题实测最大 = **39.1°（light）**
    //    （其余 ≤ 2.5°）；+余量 ⇒ 45°。它表达"同一色相家族，允许明度/饱和档带来的色相漂移"。
    ok(`★② ${t}: accent 家族色相最大偏离 ${maxGap.toFixed(1)}° ≤ 45°（单一色相家族，基线 39.1+余量）`, maxGap <= 45,
      `accent=${p.accent} accentSoft=${p.accentSoft}`);
    // 语义状态色**允许**异色相（它是"态"的信号，不是品牌色）；但仍须**有彩色**（不是灰）
    ok(`  · ${t}.statusRunning 有彩色（状态色不该是灰）`, hueOf(p.statusRunning) >= 0, `got ${p.statusRunning}`);
    for (let j = 0; j < cols.length; j++) {
      ok(`  · ${t}.${names[j]} 非无彩色（不能是灰 ⇒ 光球该有"色"）`, hueOf(cols[j]) >= 0, `got ${cols[j]}`);
    }
  }

  // 源码形态：光球只引用 accent 家族的色 role（⛔ 不引第二个色相 ⇒ 无杂色）
  const fsMod = require('fs');
  const pathMod = require('path');
  let repo = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const cand = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/components/AssistantOrb.ets'))) { repo = cand; break; }
  }
  if (repo.length > 0) {
    const src: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/components/AssistantOrb.ets'), 'utf-8');
    const stripped: string = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const usedRoles: string[] = ['pal.accent', 'pal.accentSoft', 'pal.statusRunning', 'hairlineOf(', 'inflightHaloOf('];
    ok('★② 光球取色只用 accent 家族 / 中性（无第二个色相 role）',
      (stripped.match(/pal(etteOf\([^)]*\))?\.[a-zA-Z]+/g) || []).every((x: string) => usedRoles.some((r: string) => x.indexOf(r.replace('pal.', '').replace('(', '')) >= 0)
        || ['accent', 'accentSoft', 'accentHover', 'statusRunning', 'border', 'transparent'].some((a: string) => x.endsWith('.' + a))));
  }
  function failures0(_n: string): void { /* 占位：无彩色由下方逐列断言覆盖 */ }
}

// ── ★③ 让位/静默档：降频（不抢注意力；D3）─────────────────────────────────────────
{
  ok(`★③ 帧率档满足 主(${ORB_FPS_MAIN}) ≥ 思考(${ORB_FPS_THINKING}) > 让位(${ORB_FPS_SECONDARY}) > 静默(${ORB_FPS_IDLE})`,
    ORB_FPS_MAIN >= ORB_FPS_THINKING && ORB_FPS_THINKING > ORB_FPS_SECONDARY && ORB_FPS_SECONDARY > ORB_FPS_IDLE);
  ok('  · 让位档 ≤ 主档的 2/3（明显"让"，不是差一点）', ORB_FPS_SECONDARY <= Math.floor(ORB_FPS_MAIN * 2 / 3) + 1);
  ok('  · 静默档 ≤ 一半主档（"静止也是设计"）', ORB_FPS_IDLE <= ORB_FPS_MAIN / 2 + 1);
}

// ── ★④ D3「让位/静默」的**视觉强度上限**（"不抢注意力"的可判化；⛔ 不重复 ★③ 的帧率）──────
// 取证（`AssistantOrb.ets:154-162` 的具名常量）：让位 `SECONDARY_AMP=0.5 / HALO=0.55 / SPIN=0.5`、
// 静默 `IDLE_AMP=0.25 / SPIN=0`；主态（thinking）幅度/光晕/自转均 = 1.0（锚点）。
// ⚠️ 阈值 = **实测基线 + 余量**（⛔ 不为好看调）。
{
  const fsMod = require('fs');
  const pathMod = require('path');
  let repo = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const cand = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/components/AssistantOrb.ets'))) { repo = cand; break; }
  }
  ok('★④ 找到 AssistantOrb.ets（态乘子是组件内 const ⇒ 只能按源码形态取）', repo.length > 0);
  if (repo.length > 0) {
    const src: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/components/AssistantOrb.ets'), 'utf-8');
    const num = (name: string): number => {
      const m = src.match(new RegExp(`const ${name}: number = ([0-9.]+);`));
      return m === null ? -1 : Number(m[1]);
    };
    const secAmp: number = num('ORB_SECONDARY_AMP');
    const idleAmp: number = num('ORB_IDLE_AMP');
    const secHalo: number = num('ORB_SECONDARY_HALO');
    const secSpin: number = num('ORB_SECONDARY_SPIN');
    ok(`  · 三个乘子可解析（sec ${secAmp} / idle ${idleAmp} / halo ${secHalo} / spin ${secSpin}）`,
      secAmp > 0 && idleAmp > 0 && secHalo > 0 && secSpin > 0);
    ok(`★④ 让位幅度 ≤ 0.6（基线 0.5 + 余量；实得 ${secAmp}）⇒ 别处才是主角`, secAmp <= 0.6);
    ok(`  · 静默幅度 ≤ 0.35 且 **< 让位**（基线 0.25；实得 ${idleAmp}）⇒ 只剩一丝"还活着"`,
      idleAmp <= 0.35 && idleAmp < secAmp);
    ok(`  · 让位光晕 ≤ 0.7（基线 0.55；实得 ${secHalo}）⇒ 光晕也退让`, secHalo <= 0.7);
    ok(`  · 让位自转 ≤ 0.6（基线 0.5；实得 ${secSpin}）⇒ 转得慢`, secSpin <= 0.6);
    // 静默：自转**冻结**（`new OrbState(…, 0, …)` 的第三个实参）
    const stIdle = src.match(/new OrbState\(ORB_IDLE_AMP, [^,]+,\s*([0-9.]+),/);
    ok('  · 静默态自转 = 0（冻结 ⇒ "静止也是设计"）',
      stIdle !== null && Number(stIdle[1]) === 0, `got ${stIdle === null ? 'n/a' : stIdle[1]}`);

    // ★⑤ 注意力色**只保留给"工具在飞"**：`ringTool=true` 的态恰一个（tool）；让位/静默必须是 false
    const toolTrue: number = (src.match(/new OrbState\([^)]*,\s*true\)/g) || []).length;
    ok(`★⑤ ringTool=true 的态**恰 1 个**（` + '`statusRunning` 是"一眼可辨"的注意力色，只服务工具在飞' + `；实得 ${toolTrue}）`,
      toolTrue === 1);
    const secLine = src.match(/new OrbState\(ORB_SECONDARY_AMP[^)]*\)/);
    const idleLine = src.match(/new OrbState\(ORB_IDLE_AMP[^)]*\)/);
    ok('  · 让位态 ringTool = false（不抢注意力色）', secLine !== null && secLine[0].indexOf('true') < 0);
    ok('  · 静默态 ringTool = false', idleLine !== null && idleLine[0].indexOf('true') < 0);
  }
}

if (fail > 0) { console.log(`  orb_aesthetic: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  orb_aesthetic: ${pass} passed, 0 failed`);
process.exit(0);
