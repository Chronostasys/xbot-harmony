/**
 * 「在飞视觉语言」契约测试（波5e / 2026-10-11 收敛）—— 流式期间**一个动效主角、一套节奏刻度、一个降级开关**。
 *
 * 背景（用户口令）：流式期间同时存在光球 / `思考 N 字` / 打字机光标 / 工具 pill 四个"高亮源"，
 * 它们各自的动效与节奏是分别长出来的 ⇒ 容易"两个高亮源打架"。本波把它们收敛成一套语言，
 * 本文件就是那套语言的**可红契约**（契约正文见 `docs/DESIGN-SYSTEM.md §8`）。
 *
 * ⛔ 2026-10-11 变更（用户报「你搞了两个思考 spinner?」——截图里 ① `思考 N 字` 左侧紫色呼吸点
 *   + ② 块首光球）：**同一时刻只允许一个动效**。web 的在飞指示只可能有一个、且都是文字微光
 *   （`LiveIteration.tsx:217-219` 的 `ShimmerThinking` / `:240-246` 的 label `SweepText`）。
 *   原生把"在飞指示"实现为旗舰光球 ⇒ **光球是唯一动效**；`思考 N 字` 行改为**恒静态**
 *   （只按 `live` 改色），且光球**并进思考行作前导图元**（读作消息的一部分，不"飘"）。
 *
 * 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译（见其 for 循环），
 * `components/**` 不进这套 harness ⇒ 组件层无法直接 import 单测。本仓既有先例：
 * `tools/tests/live_tail_delivery.test.ts` 同法读源码做形态断言；数值部分仍用真函数跑。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { D_SLOW } from '../../entry/src/main/ets/core/tokens';
import { ORB_BREATH_MS, orbBreath, orbParticles, ORB_SPIN_MS } from '../../entry/src/main/ets/core/orb';

/**
 * **剥注释**（本仓约定：注释里记代码片段/色值是**允许且鼓励**的 ⇒ 判据扫源码前**必须**先剥，
 * 否则两个方向都错：禁串被注释提及 ⇒ **假红**；要求串只在注释里出现 ⇒ **假绿**）。
 * ⚠️ 保留换行（不压行）⇒ 行号不漂移（本仓已入库 GOTCHA）。
 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}
/** 取某方法/函数体文本（本仓缩进约定：成员方法结束于行首两空格 + `}`）。 */
function bodyOf(src: string, sig: string): string {
  const i = src.indexOf(sig);
  if (i < 0) { return ''; }
  const j = src.indexOf('\n  }', i);
  return j < 0 ? src.substring(i) : src.substring(i, j);
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const COMP = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components');
const animSrc: string = stripSrc(fsMod.readFileSync(pathMod.join(COMP, 'anim.ets'), 'utf-8'));
const orbSrc: string = stripSrc(fsMod.readFileSync(pathMod.join(COMP, 'AssistantOrb.ets'), 'utf-8'));
const tailSrc: string = stripSrc(fsMod.readFileSync(pathMod.join(COMP, 'LiveTailView.ets'), 'utf-8'));
// ⚠️ 本文件**唯一**一条「断言对象就是注释」的判据（见下方"理由必须写在接线点旁"）⇒ 它得读**原文**：
//    否则会把"注释里有、代码里没有"误判。其余判据一律用剥过的 `tailSrc`。
const tailRaw: string = fsMod.readFileSync(pathMod.join(COMP, 'LiveTailView.ets'), 'utf-8');
const thinkSrc: string = stripSrc(fsMod.readFileSync(pathMod.join(COMP, 'ThinkingLine.ets'), 'utf-8'));

// ── (a) 共享节奏刻度：整组唯一心跳，且**全部由既有刻度派生**（禁新造时长）────────
has(animSrc, 'export const MOTION_BREATH_MS: number = ORB_BREATH_MS;',
  '主呼吸刻度 = 直接引用 core/orb 的 ORB_BREATH_MS（不复制数值）');
has(animSrc, 'export const MOTION_BEAT_MS: number = D_SLOW * 2;',
  '细节拍 = 2×D_SLOW（不是魔法数）');
has(animSrc, 'export const MOTION_QUIET_MS: number = MOTION_BREATH_MS / 4;',
  '静默窗 = 主呼吸的 1/4（不是魔法数）');
has(animSrc, "from '../core/orb'", 'anim.ets 明确 import core/orb 的刻度（同源而非巧合相等）');
// 光球侧必须**引用共享常量**，而不是各自算一份
has(orbSrc, 'import { animBase, MOTION_BREATH_MS, MOTION_QUIET_MS } from \'./anim\';',
  '光球 import 共享刻度');
has(orbSrc, 'const ORB_EASE_MS: number = MOTION_BREATH_MS / 8;', '态过渡 = 主呼吸/8（同刻度家族）');
has(orbSrc, 'const ORB_QUIET_MS: number = MOTION_QUIET_MS;', '光球静默窗 = 共享常量（与思考行同一个值）');
hasNot(orbSrc, 'const ORB_BREATH_MS', '光球不再自带一份呼吸周期常量');
// 数值：呼吸刻度本身仍锚在 tokens（真值断言）
eq('主呼吸 === 8×D_SLOW（2560ms）', ORB_BREATH_MS, D_SLOW * 8);
eq('细节拍 === 2×D_SLOW（640ms）', D_SLOW * 2, 640);
// 「同源同相」的数学保证：相位只由 t 与周期决定（两个组件各自算也必然同步）
eq('同刻同相（周期平移不变）', orbBreath(1234, ORB_BREATH_MS), orbBreath(1234 + 3 * ORB_BREATH_MS, ORB_BREATH_MS));
ok('呼吸值域 ⊆ [0,1]（可直接当权重用）', (() => {
  for (let t = 0; t < ORB_BREATH_MS; t += ORB_BREATH_MS / 128) {
    const v = orbBreath(t, ORB_BREATH_MS);
    if (v < 0 || v > 1) { return false; }
  }
  return true;
})());

// ── (b) 主高亮唯一性：谁在什么时候领读（优先级表）──────────────────────────────
const primaryBody: string = bodyOf(tailSrc, 'private thinkingIsPrimary(): boolean {');
ok('thinkingIsPrimary() 可定位', primaryBody.length > 20);
has(primaryBody, 'this.hasToolInProgress()', '判据含"无在飞工具"（§12-C：**含 pending**，= web statusVisual.ts:20-22 isToolInProgress；⛔ 与 isLiveStatus 有意分叉）');
has(primaryBody, 'this.reasoning.length > 0', '判据含"有思考"');
has(primaryBody, 'this.text.length === 0', '判据含"无正文"（对齐 web reasoningInProgress）');
// 优先级：工具在飞 ⇒ 光球领读（tool）；只有思考 ⇒ 光球让位（secondary）；其余 ⇒ thinking
has(tailSrc, 'return ORB_MODE_TOOL;', '有工具 ⇒ tool（光球领读）');
has(tailSrc, 'return this.thinkingIsPrimary() ? ORB_MODE_SECONDARY : ORB_MODE_THINKING;',
  '只有思考 ⇒ secondary（光球让位），否则 thinking');
has(tailSrc, 'orbMode: this.orbMode(),', '光球态由优先级函数驱动（非写死）');
has(tailSrc, 'live: this.thinkingIsPrimary(),', '思考行的领读身份由同一判据驱动（**只改色**）');
hasNot(tailSrc, 'emphasis: this.breathAmp,', '⛔ 思考行不再接呼吸权重（动效唯一属于光球）');
// 让位态在光球侧真实存在（三处：常量/状态/查表）
has(orbSrc, "export const ORB_MODE_SECONDARY: string = 'secondary';", '光球有 secondary 态常量');
has(orbSrc, 'const ST_SECONDARY: OrbState = new OrbState(ORB_SECONDARY_AMP, ORB_SECONDARY_HALO, ORB_SECONDARY_SPIN, 1, false);',
  'secondary 态参数：呼吸/光晕/公转都减半（"在位但不领读"）');
has(orbSrc, 'if (mode === ORB_MODE_SECONDARY) {', 'orbStateOf 认 secondary');

// ── (c) 分工不重叠：**发光体只允许光球一个** ────────────────────────────────────
hasNot(tailSrc, 'caretOn', '打字机光标不再 10Hz 硬闪（caretOn 已移除）');
// 2026-10-17：光标整体移除（用户要求「逐字显示即效果，不要单独闪」）⇒ 呼吸权重也删除。
hasNot(tailSrc, 'caretAlpha', '打字机光标已整体移除（不再有第二个呼吸源）');
hasNot(tailSrc, '.opacity(this.caretAlpha)', '不再有光标呼吸权重上屏');
hasNot(tailSrc, 'shadow(', 'LiveTailView 内不再有任何 shadow（彩色外发光只归光球）');
// 思考行：**恒静态**（不得私自发光/加动效）—— 动效唯一属于光球（2026-10-11「一个动效」）
hasNot(thinkSrc, '0.72 + 0.28', '⛔ 思考行不再呼吸（去掉第二个脉动源）');
hasNot(thinkSrc, 'this.emphasis', '思考行不再持有 emphasis 呼吸权重');
has(thinkSrc, '@Prop live: boolean = false;', 'live 默认 false ⇒ committed 迭代零行为变化');
hasNot(thinkSrc, 'shadow(', '思考行不引入第二个发光体');
// 位置：光球并进思考行作**前导图元**（不复"行上方另飘一个" —— 真机读作"两个 spinner"）
has(thinkSrc, 'AssistantOrb({', '思考行以光球作前导图元（同屏唯一在飞指示，读作消息的一部分）');
has(thinkSrc, 'if (this.orb) {', '光球开启时光球取代灯泡作为行首图元');
has(tailSrc, 'orb: this.orb,', 'LiveTailView 把光球开关投递给思考行（同一开关，两处不并存）');
has(tailSrc, '} else if (this.orb) {', '无思考行时光球独占块首一行（回退位，非主路径）');

// ── (d) 降级一致：一个开关，三处生效 ──────────────────────────────────────────
has(tailSrc, 'private reduceMotion(): boolean {', 'reduceMotion 是 LiveTailView 的单一来源');
has(tailSrc, 'reduceMotion: this.reduceMotion(),', '开关 ①：光球（停表）');
hasNot(tailSrc, 'MOTION_BREATH_MS', '思考行呼吸已移除 ⇒ LiveTailView 不再引用主呼吸刻度（无第二处脉动）');
// 2026-10-17：打字机光标已整体移除（用户要求「逐字显示即效果」）⇒ 降级只剩光球一处。
// 反向钉住"没有第二处呼吸源"：beat 刻度与 caretAlpha 都必须不在。
hasNot(tailSrc, 'MOTION_BEAT_MS', 'LiveTailView 不再引用 beat 刻度（光标呼吸已移除）');
hasNot(tailSrc, 'caretAlpha', '光标呼吸状态已删除（无第二个脉动源）');
has(orbSrc, 'this.ready && this.active && !this.paused && !this.reduceMotion && this.visible;',
  '光球 shouldRun() 含 reduceMotion（另含 visible：不可见 ⇒ 停表）');
// 降级来源的真实性：API 21 拿不到系统值（@since 23）—— 断言注释/理由留在代码里，防止被"顺手接上"
// ⚠️ 剥注释后暴露的**真缺陷**（2026-10-11 清扫）：这条要求"理由**写在接线点旁**" ⇒ 命中的本来就
//    只有**注释** ⇒ 用剥过的 `tailSrc` 会红/（修复前是）假绿。改用**原文** `tailRaw`（本条断言对象就是注释）。
has(tailRaw, '@since 23', '降级来源不可用的理由（@since 23）写在接线点旁');

// ── (e) 数值：让位/静默不该改变"既有观感"的等价性 ──────────────────────────────
// thinking 全权重时，呼吸/公转/轨道都必须是原值（= 既有观感逐值不变）
eq('公转刻度未变（tool 加速仍是同一函数）',
  orbParticles(9, 1000 * 2.2, 3, ORB_SPIN_MS), orbParticles(9, 1000, 3, ORB_SPIN_MS / 2.2));


// ── 剥注释的**判别力自证**（防"剥注释把扫描也剥没了"这类白绿）──────────────────────
{
  ok('判别力：**注释里**的禁串被剥掉（不误红）',
    stripSrc('// .fontColor([this.pal().textMuted])').indexOf('.fontColor(') < 0);
  ok('判别力：**代码里**的同一串仍在（不误绿）',
    stripSrc('const a = 1; .fontColor([this.pal().textMuted])').indexOf('.fontColor(') >= 0);
  ok('判别力：剥注释**保留换行**（行号不漂移）',
    stripSrc('a\n// x\nb').split('\n').length === 3);
}

if (fail > 0) {
  console.log(`  inflight_language: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  inflight_language: ${pass} passed, 0 failed`);
process.exit(0);

export {};
