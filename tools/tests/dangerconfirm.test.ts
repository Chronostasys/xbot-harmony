/**
 * 危险操作「两段式确认」共享原语的**门禁**（`core/dangerconfirm.ets` + 两个迁移面板的形态）。
 *
 * 为什么读**真实源码**做形态断言：`components/**` 不进离线 harness（`run.sh` 只编 `core/**`），
 * 且"组件里不再自造 confirm 状态"这件事**只能**用源码形态钉住（本仓既有先例：
 * `msgflow_visual.test.ts` / `orb.test.ts`）。判据本身则由**真函数**跑数值。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
// ⚠️ 清扫记档（2026-10-11，扫源码不剥注释专项）：本文件的断言**全在纯逻辑层**（两段式状态机
//    `dangerPress` 等纯函数）；`has/hasNot(src, …)` 两个 helper **无任何调用点**（只在定义处 +
//    本注释的示例里出现）、且**无 `readFileSync` 调用** ⇒ **不扫源码** ⇒ **无需剥注释**（有意不套 `stripSrc`）。

declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  armedKeyNow, dangerPress, dangerVisualOf, DangerPress, DangerSeverity, DANGER_NO_EXPIRY,
  DANGER_ARMED_MIN_RATIO,
} from '../../entry/src/main/ets/core/dangerconfirm';
import { ALL_THEMES, paletteOf, contrastRatio } from '../../entry/src/main/ets/core/theme';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function has(src: string, needle: string, name: string): void { ok(name, src.indexOf(needle) >= 0); }
function hasNot(src: string, needle: string, name: string): void { ok(name, src.indexOf(needle) < 0); }

const fsMod = require('fs');
const pathMod = require('path');

// ══════════════════════════════════════════════════════════════════════════════
// ① 两段式状态机全链：idle → Arm → Commit；改武装；取消；忙碌
// ══════════════════════════════════════════════════════════════════════════════
const T0 = 1_000_000;
// 第一下：只武装，不执行（⛔ 若改成"第一下就执行" ⇒ 本条与下一条都红）
eq('第一下 = Arm（只武装，不执行）',
  dangerPress('', 0, 'alice', T0, DANGER_NO_EXPIRY, false), DangerPress.Arm);
// 第二下（同一目标）：执行
eq('第二下（同目标）= Commit',
  dangerPress('alice', T0, 'alice', T0 + 500, DANGER_NO_EXPIRY, false), DangerPress.Commit);
// 点了别的目标：改武装到新目标，不执行原来是那个
eq('点别的目标 = Arm（改武装）',
  dangerPress('alice', T0, 'bob', T0 + 500, DANGER_NO_EXPIRY, false), DangerPress.Arm);
// 取消：组件把武装键置空 ⇒ 再点同目标仍是第一下
eq('取消后（armedKey=\'\'）再点 = Arm',
  dangerPress('', 0, 'alice', T0 + 500, DANGER_NO_EXPIRY, false), DangerPress.Arm);
// 忙碌：既不武装也不执行
eq('忙碌中 = None（不武装）',
  dangerPress('', 0, 'alice', T0, DANGER_NO_EXPIRY, true), DangerPress.None);
eq('忙碌中 = None（即使已武装该目标，也不执行）',
  dangerPress('alice', T0, 'alice', T0 + 1, DANGER_NO_EXPIRY, true), DangerPress.None);

// ② 过期路径（ttl>0；5s 后武装失效 ⇒ 再点同目标只 Arm）
const TTL = 5000;
eq('过期前 armedKeyNow 仍有效', armedKeyNow('alice', T0, T0 + TTL - 1, TTL), 'alice');
eq('过期后 armedKeyNow 归零', armedKeyNow('alice', T0, T0 + TTL, TTL), '');
eq('过期后再点同目标 = Arm（不是 Commit）',
  dangerPress('alice', T0, 'alice', T0 + TTL, TTL, false), DangerPress.Arm);
// ttl=0（迁移前的既有语义）⇒ 永不超时
eq('DANGER_NO_EXPIRY ⇒ 永不超时', armedKeyNow('alice', T0, T0 + 999_999_999, DANGER_NO_EXPIRY), 'alice');
eq('DANGER_NO_EXPIRY = 0', DANGER_NO_EXPIRY, 0);

// ══════════════════════════════════════════════════════════════════════════════
// ③ 语义色角色与"危险度"匹配（唯一取色表；组件不得再自挑角色）
// ══════════════════════════════════════════════════════════════════════════════
const palDark = paletteOf('dark');
// 静息：不填充（surfaceAlt）+ 危险字色 + 强描边
const idleDanger = dangerVisualOf(DangerSeverity.Danger, false, false, palDark);
eq('静息·危险：底 = surfaceAlt', idleDanger.bg, palDark.surfaceAlt);
eq('静息·危险：字 = dangerText', idleDanger.fg, palDark.dangerText);
eq('静息·危险：边 = borderStrong', idleDanger.border, palDark.borderStrong);
const idleWarn = dangerVisualOf(DangerSeverity.Warning, false, false, palDark);
eq('静息·警告：字 = warn（不是 dangerText）', idleWarn.fg, palDark.warn);
// 武装：实心底 + 危险描边
const armedDanger = dangerVisualOf(DangerSeverity.Danger, true, false, palDark);
eq('武装·危险：底 = dangerBg', armedDanger.bg, palDark.dangerBg);
eq('武装·危险：边 = dangerText', armedDanger.border, palDark.dangerText);
const armedWarn = dangerVisualOf(DangerSeverity.Warning, true, false, palDark);
eq('武装·警告：底 = warnBg（裁决点：按**现状**）', armedWarn.bg, palDark.warnBg);
eq('武装·警告：边 = warn', armedWarn.border, palDark.warn);
// 忙碌不透明度
eq('忙碌 ⇒ opacity 0.5', dangerVisualOf(DangerSeverity.Danger, true, true, palDark).opacity, 0.5);
eq('非忙碌 ⇒ opacity 1', dangerVisualOf(DangerSeverity.Danger, true, false, palDark).opacity, 1);

// ④ 对比度护栏：armed 实心底上的文字，在**全 5 主题**上都必须达标
let badContrast = 0;
const sevNames = ['Danger', 'Warning'];
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const pal = paletteOf(ALL_THEMES[ti]);
  for (let si = 0; si < 2; si++) {
    const sev = si === 0 ? DangerSeverity.Danger : DangerSeverity.Warning;
    const v = dangerVisualOf(sev, true, false, pal);
    const ratio = contrastRatio(v.fg, v.bg);
    if (ratio < DANGER_ARMED_MIN_RATIO) {
      badContrast++;
      console.log(`      ${ALL_THEMES[ti]}/${sevNames[si]}: fg=${v.fg} bg=${v.bg} ratio=${ratio.toFixed(2)}`);
    }
  }
}
eq('armed 态文字对比度：全主题 ≥ 3.0', badContrast, 0);

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 两个待迁移面板的**源码形态**断言 —— ⏸ **冻结期未接线**，故此节暂缺。
//    迁移完成后应在此加（每条都能真红）：
//      has(acctSrc/ webSrc, "from '../core/dangerconfirm'") / 'dangerPress(' / 'dangerVisualOf('
//      hasNot(acctSrc, '@State private confirming: boolean') / hasNot(webSrc, '@State private confirmDelete: string')
//      hasNot(acctSrc, 'pal().dangerText') / hasNot(webSrc, 'pal().dangerBg')
//    接线说明见交接（每个文件：改哪几行、替换成什么调用）。

if (fail > 0) {
  console.log(`  dangerconfirm: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  dangerconfirm: ${pass} passed, 0 failed`);
process.exit(0);

export {};
