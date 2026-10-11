/**
 * 「签名微时刻」契约测试 —— 上下文环 / 子代理树（用户口令：极简 / 苹果科技感 / 干净 +
 * **原生独享白色主题 porcelain**）。这两个是**等待时盯得最久**的微时刻。
 *
 * 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译，`components/**`
 * 不进这套 harness（无法 import）。本仓既有先例：`msgflow_visual.test.ts` / `inflight_language.test.ts`
 * 同法读源码做形态断言。**每条都钉住一个具体字面量**，回退对应改动即红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

// ⛔ 必须让本文件成为 **module**（`export {}`）：否则 `declare const process/pass/fail/...` 会与
//    兄弟测试文件（同样在 run.sh 里被**同一批**编译）的顶层声明撞名（TS6200）。
//    本仓既有先例：提交 `11d9521`「msgnav_key 测试改 module（export {}）—— 消除与兄弟测试的全局声明撞名」。
export {};

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

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const COMP = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components');
const ringSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'ContextRing.ets'), 'utf-8');
const treeSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'SubAgentTree.ets'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════════
// ② 上下文环 `ContextRing.ets`  ↔  web `ContextRing.tsx`
// ════════════════════════════════════════════════════════════════════════════
// 弧色角色：web `high ? 'text-status-error' : 'text-accent'`（ContextRing.tsx:70-73）
//   ⇒ 原生必须用 **statusError**（web `--status-error`，dark #F48771），**不是** dangerText
//     （dangerText 是"危险按钮文字"角色，两者语义/取值都不同 —— 别混淆角色）。
has(ringSrc, '=== CTX_ROLE_DANGER ? this.pal().statusError : this.pal().accent',
  '弧色用 statusError（web `text-status-error`），不是 dangerText');
hasNot(ringSrc, '.dangerText', '⛔ 环不复用 dangerText（那是"危险按钮文字"角色）');
// 文件头注释也必须与代码同角色（原注释误写 dangerText ⇒ 已订正为 statusError）
has(ringSrc, '弧 = `high ? pal().statusError : pal().accent`',
  '文件头注释与代码同角色（订正 `dangerText` 混淆）');
// 按压纪律：静息态不写 normal.opacity（同 ThinkingLine / SubAgentTree；`normal` 会接管属性、
// 盖掉动态值 —— 本仓已踩过的隐患）
has(ringSrc, '.stateStyles({ pressed: { .opacity(0.75) } })', '按压唯一覆盖 opacity');
hasNot(ringSrc, 'normal: { .opacity(1) }', '⛔ 静息态不写 normal.opacity');

// ════════════════════════════════════════════════════════════════════════════
// ③ 子代理树 `SubAgentTree.ets`  ↔  web `SubAgentProgressTree.tsx`
// ════════════════════════════════════════════════════════════════════════════
// 卡片描边（web `border-border/50`）在**浅色族**必须换 hairline：白底上 `border@50%` ≈ 不可见
// ⇒ 层级整块读不出（porcelain 的口径正是"靠发丝线 + 柔影分层"）。
has(treeSrc, 'private cardBorderColor(): string {', '卡片描边收敛到一个判据（cardBorderColor）');
has(treeSrc, 'if (isLightPalette(this.pal())) {', '浅色判据按**色板亮度**（不按主题名硬判）');
has(treeSrc, 'return surfacesOf(this.pal()).hairline;', '浅色族走结构性发丝 hairline');
has(treeSrc, 'return withAlpha(this.pal().border, CARD_BORDER_ALPHA);', '深色族保留 border@50%（逐字节不变）');
// 子行虚线连接线：结构性边界 ⇒ hairline（深色族 hairline ≡ border，浅色族自动可见）
has(treeSrc, 'color: { left: surfacesOf(this.pal()).hairline,',
  '子行虚线走 hairline（深色族逐字节不变 / 浅色族可见）');
ok('卡片三边（top/right/bottom）都走 cardBorderColor()',
  treeSrc.split('this.cardBorderColor()').length - 1 === 3);
// 按压纪律统一
has(treeSrc, '.stateStyles({ pressed: { .opacity(0.75) } })', '按压唯一覆盖 opacity');
hasNot(treeSrc, 'normal: { .opacity(1) }', '⛔ 静息态不写 normal.opacity');

if (fail > 0) {
  console.log(`  moment_polish: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  moment_polish: ${pass} passed, 0 failed`);
process.exit(0);
