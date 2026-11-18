/**
 * 工具 pill 浮层**横向溢出必须能滚**（用户 2026-11-13：
 * 「优化一下工具 pill 点开的样式，窗口内容如果横向溢出要加横向滚动条」）。
 *
 * 现状问题（真机）：`ToolPopover` 的正文块（参数/内容、输出、diff）**已经有**横向 `Scroll`，
 * 但外层是**纵向 Scroll**（整卡单一滚动源）⇒ ArkUI 的默认嵌套滚动里外层优先 ⇒
 * 横向拖动被纵向容器吃掉：用户看到右侧被裁，**滑不动、也看不到滚动条**。
 *
 * 修法（本判据钉死）：每个横向 `Scroll` 必须显式声明
 *   `.nestedScroll({ scrollForward: NestedScrollMode.SELF_FIRST,
 *                    scrollBackward: NestedScrollMode.SELF_FIRST })`
 * —— 让**内层（横向）先消费**手势，横向溢出时才真的能滑、滚动条才会出现。
 *
 * mutation 自证：删掉任一处 `nestedScroll` ⇒ §1 计数不足 ⇒ 红。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`);
  }
}

const fsMod = require('fs');
const pathMod = require('path');
let repo: string = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const c: string = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(c, 'entry/src/main/ets/components'))) {
    repo = c;
    break;
  }
}
const src: string = fsMod.readFileSync(
  pathMod.join(repo, 'entry/src/main/ets/components/ToolPopover.ets'), 'utf8');

function count(needle: string): number {
  let n = 0;
  let i = src.indexOf(needle);
  while (i >= 0) {
    n++;
    i = src.indexOf(needle, i + needle.length);
  }
  return n;
}

// ── §1 横向 Scroll 与 nestedScroll 一一配对 ────────────────────────────────
console.log('\n▶ §1 横向滚动可被手势命中');
{
  const hScroll: number = count('.scrollable(ScrollDirection.Horizontal)');
  const nested: number = count('NestedScrollMode.SELF_FIRST');
  ok('§1 ToolPopover 至少 3 处横向滚动（参数/输出/diff）', hScroll >= 3, `实测 ${hScroll}`);
  // 每个横向 Scroll 的 `scrollForward` 与 `scrollBackward` 各算一次 SELF_FIRST
  ok('§1 每处横向 Scroll 都声明了 nestedScroll（SELF_FIRST ×2）',
    nested >= hScroll * 2, `hScroll=${hScroll} SELF_FIRST=${nested}`);
  ok('§1 nestedScroll 用对象字面量（scrollForward/scrollBackward 都在）',
    count('scrollForward: NestedScrollMode.SELF_FIRST') >= hScroll
    && count('scrollBackward: NestedScrollMode.SELF_FIRST') >= hScroll);
}

// ── §2 滚动条可见性：横向块都开 Auto 条 ──────────────────────────────────
console.log('\n▶ §2 滚动条');
{
  const hScroll: number = count('.scrollable(ScrollDirection.Horizontal)');
  ok('§2 每个横向 Scroll 都设了 scrollBar(BarState.Auto)',
    count('.scrollBar(BarState.Auto)') >= hScroll,
    `bar=${count('.scrollBar(BarState.Auto)')} hScroll=${hScroll}`);
  ok('§2 横向块都 clip(true)（超宽裁在块内，不撑破浮层）',
    count('.clip(true)') >= hScroll, `clip=${count('.clip(true)')}`);
}

// ── §3 块外壳一致（样式统一）──────────────────────────────────────────────
console.log('\n▶ §3 块样式统一');
{
  ok('§3 参数/输出块共用 `surface.well` 底（不是裸底色）',
    count("surfaceFillOf(this.pal(), 'surface.well')") >= 2);
  ok('§3 块内补内凹发丝（insetHairlineOf）', count('insetHairlineOf(this.pal())') >= 3);
}

console.log(`\n=== tool_popover_scroll: ${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}
