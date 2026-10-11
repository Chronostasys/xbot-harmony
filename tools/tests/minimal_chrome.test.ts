/**
 * 「极简语言：不留多余硬边框」契约测试（波5l）。
 *
 * 背景（用户口令）：「要做到极简风格，看起来很有苹果那种科技感且干净」。
 * 真机（深色 1320×2848，密度 3.0）像素取证抓到：消息流右上角一枚 32×32 **带 1px 描边**的
 * 方框按钮 = `components/MessageNav.ets` 的「用户消息导航」——它是整条流里**唯一**的硬边框
 * 控件（工具胶囊 / 工具浮层 / 思考行都没有全边框），读起来像"遗留的 box"。
 *
 * 实测（同一张截图，同一像素探针）：
 *   背景亮度 11 ／ 方框**底纹**亮度 12（Δ1，肉眼不可见）／ 方框**描边**亮度 16~17（Δ5~6）。
 *   ⇒ "突兀"100% 来自那条 1px 描边；底纹（Δ1）留着只为内容滚到按钮底下时的可读性。
 *   （对照：代码块描边实测 Δ10 —— 更强，但它框住一整块内容、有结构理由，故**保留**。）
 *
 * 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译，`components/**`
 * 不进这套 harness（无法 import）。本仓既有先例：`msgflow_visual.test.ts` /
 * `inflight_language.test.ts` 同法读源码做形态断言。**这些断言必须"能被证伪"** ——
 * 每条都钉住一个**具体字面量**，把改动回退（例如把 `.border(...)` 加回 MessageNav）即红。
 *
 * 每条断言都带 **web 权威基准 file:line**（`/Users/bobli/src/xbot/web`）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { R_MD, SP_2, SP_3 } from '../../entry/src/main/ets/core/tokens';
import { ALL_THEMES, paletteOf, surfacesOf, isLightPalette, Palette } from '../../entry/src/main/ets/core/theme';
import { insetHairlineOf } from '../../entry/src/main/ets/core/design';
import { chipBgOf, pillBgOf } from '../../entry/src/main/ets/core/toolvisual';

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

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const COMP = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components');
const navSrc: string = stripSrc(fsMod.readFileSync(pathMod.join(COMP, 'MessageNav.ets'), 'utf-8'));
const mdSrc: string = stripSrc(fsMod.readFileSync(pathMod.join(COMP, 'MarkdownView.ets'), 'utf-8'));
const popSrc: string = stripSrc(fsMod.readFileSync(pathMod.join(COMP, 'ToolPopover.ets'), 'utf-8'));
const visSrc: string = stripSrc(fsMod.readFileSync(pathMod.join(COMP, 'ToolVisual.ets'), 'utf-8'));

// ── 0. token 前提（本文件引用的每个 token 都必须是它声明的值 —— 换 token 值即红）──────────
eq('SP_2 = 8（Tailwind 2 = 8px）', SP_2, 8);
eq('SP_3 = 12（Tailwind 3 = 12px）', SP_3, 12);
eq('R_MD = 6（web `rounded-md` = 6px）', R_MD, 6);

// ════════════════════════════════════════════════════════════════════════════
// ① 消息导航按钮 `MessageNav.ets` —— 静息**无边框**（↔ web `MessageUserNav.tsx:150-164`）
// ════════════════════════════════════════════════════════════════════════════
// web 的按钮确实带 `border border-border/50`（`:157`），本端**刻意去掉**（真机像素取证：
// 描边 Δ5~6 是"方框"的唯一来源，底纹 Δ1 不可见）。回退 = 把那行 `.border({ width: 1, … })`
// 加回来 ⇒ 下面两条立刻红。
hasNot(navSrc, '.border({ width: 1, color: withAlpha(this.pal().border, BTN_BORDER_ALPHA) })',
  '⛔ 静息态无 1px 全边框（"突兀的方框"的唯一来源，回退即红）');
hasNot(navSrc, 'BTN_BORDER_ALPHA',
  '描边不透明度常量已移除（回退即红）');
// 底纹 + 磨砂**保留**：Δ1 不可见，但内容滚到按钮底下时保住图标可读性（web 同一层磨砂）。
has(navSrc, 'withAlpha(this.pal().surface, BTN_BG_ALPHA))',
  '静息底纹保留（web `bg-bg-secondary/80`；Δ1 不可见但保可读性）');
has(navSrc, '.backdropBlur(this.eff().glassBlur)',
  '玻璃磨砂保留（web `backdrop-blur`）');
// 静息低存在感 + 展开满亮（web `opacity-40` → 激活 100%）
has(navSrc, 'const BTN_IDLE_ALPHA: number = 0.4;',
  '静息不透明度 = 0.4（web `opacity-40`）；去边框后图标是唯一残留存在感');
has(navSrc, '.opacity(this.open ? 1 : BTN_IDLE_ALPHA)',
  '展开/激活 → 满不透明度（动态值，非 stateStyles 钉死）');
// 强调只在**瞬时态**：按压 = web hover 的 accent 底纹 + 满不透明度
has(navSrc, 'pressed: {',
  '按压态存在（"按压才强调"）');
has(navSrc, '.backgroundColor(withAlpha(this.pal().accent, ACCENT_TINT))',
  '按压/展开 = `bg-accent/10` 底纹（web hover 同款）');
// ⛔ 不给 `normal` 分支：`normal` 会接管 opacity/backgroundColor ⇒ 把动态 `open` 值钉死
//    （同款坑已在 `ThinkingLine.ets` 踩过并修掉，见 docs/ARKTS-GOTCHAS.md）。
//    这里**逐字钉死整个 stateStyles 块**（只含 pressed）——比 `hasNot('normal: {')` 更精确：
//    同文件的 `NavItemView`（浮层面板条目）合法地用了 `normal: { .opacity(1) }`（它没有动态
//    opacity，故不踩坑），全局 hasNot 会误伤它。
has(navSrc, '.stateStyles({\n        pressed: {\n          .backgroundColor(withAlpha(this.pal().accent, ACCENT_TINT))\n          .opacity(1)\n        },\n      })',
  '⛔ 导航按钮的 stateStyles **只含 pressed**（无 normal）—— 否则展开高亮/静息低亮被钉死（假绿）');
// 去边框**不得顺手缩热区**（命令「保持可点」）：32×32 不变（web `size-8`）
has(navSrc, 'const BTN: number = 32;',
  '按钮仍 32×32（web `size-8`）—— 去边框不缩热区');
has(navSrc, '.width(BTN)\n      .height(BTN)',
  '宽高仍走 BTN 常量（热区不被顺手改小）');

// ════════════════════════════════════════════════════════════════════════════
// ② 同类审计：消息流里的控件**不得**有 1px 全边框（工具胶囊 / 工具浮层）
// ════════════════════════════════════════════════════════════════════════════
// 工具胶囊（web `FoldedToolGroup` 的 pill）：靠 `surfaceAlt/surfaceHi` 底分层，**无边框**。
hasNot(visSrc, '.border(',
  '工具胶囊无边框（web pill 靠底分层，不靠描边）');
// 工具浮层（web `ToolCallBlock`）：**浅色靠填充差分界、不发丝**（web 原则的真实意图）；
// ⚠️ 2026-10-11 **按新事实改写**（原断言"一律无边框"的前提被测量证伪，⛔ 不是放宽、更不是删）：
//    证据出处 —— `contrast-ux` 的深色边界审计（`tools/tests/dark_boundary_channels_contrast.test.ts`
//    §C 缺口表 / §15 收敛记录）：深色**下沉面**对画布仅 **1.0005**（几乎完全重合，且**无任何**已接线
//    通道）⇒ 深色必须补一道**内凹发丝**；而浅色（porcelain 1.0456 / light 1.0788）填充差本就够
//    ⇒ **浅色不该凭空多一道线**（"极简白不发丝"）。
//    机制 = `insetHairlineOf(p)`：**深色 ⇒ `surfacesOf().hairline`（1.2188 ✅）/ 浅色 ⇒ `transparent`**。
has(popSrc, 'insetHairlineOf(',
  '工具浮层的边框走 `insetHairlineOf`（唯一的"仅深色"发丝出口，⛔ 不许随手写不透明边框色）');
{
  let lightBorderless: boolean = true;
  let darkHairline: boolean = true;
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const p: Palette = paletteOf(ALL_THEMES[i]);
    const c: string = insetHairlineOf(p);
    if (isLightPalette(p)) { if (c !== p.transparent) { lightBorderless = false; } }
    else { if (c !== surfacesOf(p).hairline) { darkHairline = false; } }
  }
  ok('工具浮层：**浅色下无边框**（`insetHairlineOf` 浅色臂 = `transparent` ⇒ 逐字节不变）', lightBorderless);
  ok('  工具浮层：**深色下允许内凹发丝**（因深色下沉面无其它通道）', darkHairline);
}
// ── 工具 pill 底分层 —— **行为断言**（不再匹配组件源码文本）────────────────────────
// 分层判据已**下沉** `core/toolvisual.ets:pillBgOf/chipBgOf`（`components/ToolVisual.ets:107,117`
// 只转发）。直接 import 纯函数断**语义**，远强于文本匹配：文本匹配既**脆**（组件改成转发就假红），
// 又**挡不住真回归**（两个底取同一个值照样能匹配上字符串）。
{
  let pillDistinct: boolean = true;   // 选中/非选中 pill 底可辨
  let chipNotPill: boolean = true;    // chip 底恒 ≠ 同态 pill 底（浮层打开时 chip 不"消失"）
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const th: string = ALL_THEMES[i];
    const pillSel: string = pillBgOf('running', true, th);
    const pillOff: string = pillBgOf('running', false, th);
    if (pillSel === pillOff) { pillDistinct = false; }
    if (chipBgOf('running', true, th) === pillSel || chipBgOf('running', false, th) === pillOff) {
      chipNotPill = false;
    }
  }
  ok(`工具 pill 选中/非选中底不同（全部 ${ALL_THEMES.length} 套主题，浅/深都判）`, pillDistinct);
  ok('工具 chip 底恒 ≠ 同态 pill 底（选中浮层打开时 chip 不消失）', chipNotPill);
}
// 单一映射（改回"两个都取 surfaceHi"即红）：选中 pill 提亮到 surfaceHi
eq('选中 pill 底 = surfaceHi', pillBgOf('running', true, 'dark'), paletteOf('dark').surfaceHi);
eq('非选中 pill 底 = surfaceAlt', pillBgOf('running', false, 'dark'), paletteOf('dark').surfaceAlt);
// chip 唯一语义（裁决 6199396 / REDESIGN §7.2）：恒 = surface.chip(sunken)，**不随选中变化**。
// ⚠️ 旧断言"选中 chip = surfaceAlt"是本次废止的**对调补丁** ⇒ 同步为"恒定性"（不再是 surfaceAlt）。
eq('chip 底恒（不随选中变化）', chipBgOf('running', true, 'dark'), chipBgOf('running', false, 'dark'));

// ════════════════════════════════════════════════════════════════════════════
// ③ 代码块内边距 = SP_3(12)（↔ web `MarkdownRenderer.tsx:204-227`）
// ════════════════════════════════════════════════════════════════════════════
// web：语言标签 `<span className="absolute left-3 …">`（`:214`，left = 12）与
//      代码 `<pre className="p-3 pt-7 …">`（`:223`，p-3 = 12）**同一左基准**。
// 原生端语言条 `left: SP_3`（12）已对齐；代码正文原为 10 ⇒ 真机走查读成"首行贴左"
// （代码比上方语言标签左移 2vp）。
has(mdSrc, '.padding({ left: SP_3, right: SP_3, top: SP_2, bottom: SP_1 })',
  '语言条左右 = SP_3(12)（web `:214` `left-3`）');
has(mdSrc, '.padding(SP_3)\n        .textAlign(TextAlign.Start)',
  '代码正文四周内边距 = SP_3(12)（web `:223` `p-3`）—— 与语言条同一左基准');
hasNot(mdSrc, '.padding(10)\n        .textAlign(TextAlign.Start)',
  '旧的 `padding(10)`（比语言条左移 2vp）已移除（回退即红）');


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
  console.log(`  minimal_chrome: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  minimal_chrome: ${pass} passed, 0 failed`);
process.exit(0);
