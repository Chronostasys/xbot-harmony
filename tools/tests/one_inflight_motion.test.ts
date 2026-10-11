/**
 * 「同一时刻只有一个在飞动效」契约测试（2026-10-11，用户报「你搞了两个思考 spinner?」）。
 *
 * 用户截图里同屏有两处在动：① `思考 N 字` 左侧紫色呼吸点（`ThinkingLine` 的 live 呼吸强调）
 * 与 ② 块首的旗舰光球（`AssistantOrb`）。二者对**同一件事**（agent 在飞）做动效 ⇒ 重复表达。
 *
 * web 取证（权威基线）——`web/src/components/agent/LiveIteration.tsx` 里，在飞指示**只可能有一个**，
 * 且**都是文字微光（`SweepText`）**、从不是图形：
 *   · 空内容 ⇒ `ShimmerThinking`（"思考中…"微光文字，`:217-219`，**整块**渲染）；
 *   · 有思考 ⇒ 思考行 **label** 微光（`:240-246`），且**仅**在 `reasoningInProgress`（无正文/
 *     无工具）窗口；有正文/工具时 label 是**静态**的 `思考 N 字`（`:246`）。
 *   ⇒ web 任何时刻只有一个元素在动。原生把"在飞指示"实现为旗舰光球（web 无此物）⇒
 *     **光球是那唯一的主角**：`思考 N 字` 恒静态（只按 `live` 改色），并且光球**并进思考行**
 *     作前导图元（读作消息的一部分，而不是"行上方飘着一个 spinner"）。
 *
 * 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译（见其 for 循环），
 * `components/**` 不进这套 harness ⇒ 组件层无法直接 import 单测。本仓既有先例：
 * `tools/tests/inflight_language.test.ts` / `live_tail_delivery.test.ts` 同法读源码。
 *
 * ⚠️ 判别力自证（提交信息已写明，回退必红）：
 *   · 把 ThinkingLine 的呼吸 `0.72 + 0.28*emphasis` 加回去 ⇒「思考行不再呼吸」红；
 *   · 把 ThinkingLine 里的 `<AssistantOrb/>` 去掉（光球回到块首独占一行）⇒「光球并进思考行」红；
 *   · 在 LiveTailView 再把 `emphasis:` 投给思考行 ⇒「LiveTailView 不再投呼吸权重」红。
 */

declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const COMP = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components');
const thinkSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'ThinkingLine.ets'), 'utf-8');
const tailSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'LiveTailView.ets'), 'utf-8');
const orbSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'AssistantOrb.ets'), 'utf-8');

// ── (1) 思考行**恒静态**：不许有任何随时间变化的属性（第二处脉动源）────────────────
hasNot(thinkSrc, '0.72 + 0.28',
  '⛔ 思考行不再呼吸（wave5e 的 0.72→1.0 脉动已移除）');
hasNot(thinkSrc, 'this.emphasis',
  '思考行不再持有 emphasis 呼吸权重');
hasNot(thinkSrc, '@Prop emphasis',
  '思考行签名里不再有 emphasis 参数');
hasNot(thinkSrc, 'setInterval(',
  '思考行不引入任何定时器（静态行不该有帧循环）');

// ── (2) 光球并进思考行作**前导图元**（位置：读作消息的一部分）─────────────────────
has(thinkSrc, "import { AssistantOrb, ORB_MODE_THINKING } from './AssistantOrb';",
  '思考行引入光球（前导图元）');
has(thinkSrc, 'if (this.orb) {',
  '光球开启时以光球作行首图元');
has(thinkSrc, 'AssistantOrb({',
  '行首渲染的是真组件 AssistantOrb（带参 @Builder 会冻在首帧）');
has(thinkSrc, 'orbMode: this.orbMode,',
  '光球运行态由调用方派生（@Prop 值变化通道）');
has(thinkSrc, 'reduceMotion: this.reduceMotion,',
  '光球降级开关透传（照相机能停表）');

// ── (3) LiveTailView 侧：光球是唯一动效源；不再向思考行投任何"会动"的权重────────────
has(tailSrc, 'orb: this.orb,',
  'LiveTailView 把光球开关投给思考行（同一开关）');
hasNot(tailSrc, 'emphasis:',
  '⛔ LiveTailView 不再向思考行投呼吸权重');
hasNot(tailSrc, 'breathAmp',
  'LiveTailView 不再持共享呼吸状态（无第二处脉动）');
hasNot(tailSrc, 'MOTION_BREATH_MS',
  'LiveTailView 不再引用主呼吸刻度（思考行呼吸已移除）');
has(tailSrc, '} else if (this.orb) {',
  '光球独占块首一行**只在无思考行时**（回退位，非主路径）');

// ── (4) 不许新增定时器 / 不把可见性绑到打字机每拍状态（性能与语义双约束）────────────
{
  const tailTimers = tailSrc.split('setInterval(').length - 1;
  ok('LiveTailView 仍只有 1 处 setInterval（既有打字机，未新增）', tailTimers === 1);
  const orbTimers = orbSrc.split('setInterval(').length - 1;
  ok('AssistantOrb 仍只有 1 处 setInterval（既有绘制循环，未新增）', orbTimers === 1);
  const thinkTimers = thinkSrc.split('setInterval(').length - 1;
  ok('ThinkingLine 零定时器（静态行）', thinkTimers === 0);
}

// ── (5) 降级 / 后台语义不退化：光球仍由 paused + reduceMotion 停表 ────────────────
has(orbSrc, 'this.ready && this.active && !this.paused && !this.reduceMotion;',
  '光球 shouldRun() 仍含 paused + reduceMotion（语义未退化）');
has(tailSrc, 'reduceMotion: this.reduceMotion(),',
  '降级唯一来源仍投给光球');

// ── (6) thinkingIsPrimary 语义未退化：仍是"有思考、无正文、无在飞工具"──────────────
has(tailSrc, 'return !this.hasLiveTool() && this.reasoning.length > 0 && this.text.length === 0;',
  'thinkingIsPrimary() 判据未变（只改色，不再触发第二处动效）');

if (fail > 0) {
  console.log(`  one_inflight_motion: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  one_inflight_motion: ${pass} passed, 0 failed`);
process.exit(0);
