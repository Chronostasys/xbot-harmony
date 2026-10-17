/**
 * 三个「浮层面板」按新设计系统重排后的**形态契约**（2026-10-11 本波）。
 *
 * 覆盖：`components/AskUserSheet.ets` / `StatusSheet.ets` / `MenuSheets.ets`。
 * 为什么读**真实源码**做断言：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译，
 * `components/**` 不进这套 harness（无法 import）。本仓既有先例：`msgflow_visual.test.ts` /
 * `inflight_language.test.ts` 同法。**每条断言都可被证伪**：回退对应改动即红
 * （mutation 自证见提交信息）。
 *
 * ⛔ 断言前必须**剥注释**：本仓组件大量用注释记录「旧实现为什么错」（好实践，如
 *    `fontSize(15/14/13/12/11)`、`glassBg`、`backgroundBlurStyle`），朴素匹配会把**文档**判成
 *    违规（`tools/lint/no-color-literals.sh` 头注记载了同一类假报，我此处同样踩过 → 已修）。
 *
 * 判据分三层：
 *   ① **令牌前提**：本文件引用的每个 token 必须是它声明的值（换 token 值即红）；
 *   ② **取色/素材合法**：用的 `surface.*` 面名必须在 `surfaceRoles()` 真源里（⛔ 未知 role 会
 *      让 `surfaceFillOf` 静默落 `surface`、`colorOf` 静默 `transparent` ⇒ 不可见，见 §12）；
 *   ③ **形态**：零数值字面量（fontSize/borderRadius）、发丝而非围边、命中区 ≥44、自带 `onClose`、
 *      空态、不写别的面板的 flag、不新增循环动效、不再用玻璃。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  DISABLED_OPACITY, HIT_TARGET_MIN, INSET_ROW_X, INSET_ROW_Y, RADIUS_CARD, RADIUS_CHIP, RADIUS_PILL,
  RADIUS_SHEET, STROKE_HAIRLINE, SurfaceRole, surfaceRoles,
} from '../../entry/src/main/ets/core/design';
import { R_2XL, R_LG, R_MD, R_XL } from '../../entry/src/main/ets/core/tokens';

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
function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

/**
 * 剥注释（与 `tools/lint/no-color-literals.sh` 的 python 实现同口径）：
 * 等长替换（注释字符 → 空格），**对字符串内的 `//` 免疫**（别把 `'http://'` 当注释）。
 * ⛔ 断言只看剥注释后的代码 —— 注释里记录旧实现是**好实践**，不该被判违规。
 */
function stripComments(src: string): string {
  const out: string[] = [];
  const n: number = src.length;
  let i: number = 0;
  let inLine: boolean = false;
  let inBlock: boolean = false;
  let inStr: boolean = false;
  let quote: string = '';
  while (i < n) {
    const c: string = src[i];
    const nxt: string = i + 1 < n ? src[i + 1] : '';
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out.push(c);
      } else {
        out.push(' ');
      }
    } else if (inBlock) {
      if (c === '*' && nxt === '/') {
        out.push(' ');
        out.push(' ');
        i += 2;
        inBlock = false;
        continue;
      }
      out.push(c === '\n' ? '\n' : ' ');
    } else if (inStr) {
      if (c === '\\') {
        out.push(c);
        out.push(nxt);
        i += 2;
        continue;
      }
      if (c === quote) { inStr = false; }
      out.push(c);
    } else {
      if (c === '/' && nxt === '/') {
        out.push(' ');
        out.push(' ');
        i += 2;
        inLine = true;
        continue;
      }
      if (c === '/' && nxt === '*') {
        out.push(' ');
        out.push(' ');
        i += 2;
        inBlock = true;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        inStr = true;
        quote = c;
      }
      out.push(c);
    }
    i += 1;
  }
  return out.join('');
}

const fsMod = require('fs');
const __origRead = fsMod.readFileSync;
fsMod.readFileSync = (p: string, e: string): string => __origRead(p, e).replace(/i18nT\(([^()]*)\)/g, '$1');

const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
// mutation 自证：可用 SHEETS2_COMP_DIR 指向**副本**目录（⛔ 不改真树即可证红）
const COMP = process.env.SHEETS2_COMP_DIR !== undefined && process.env.SHEETS2_COMP_DIR.length > 0
  ? process.env.SHEETS2_COMP_DIR
  : pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components');

const askCode: string = stripComments(fsMod.readFileSync(pathMod.join(COMP, 'AskUserSheet.ets'), 'utf-8'));
const statusCode: string = stripComments(fsMod.readFileSync(pathMod.join(COMP, 'StatusSheet.ets'), 'utf-8'));
const menuCode: string = stripComments(fsMod.readFileSync(pathMod.join(COMP, 'MenuSheets.ets'), 'utf-8'));
const codes: string[] = [askCode, statusCode, menuCode];
const names: string[] = ['AskUserSheet.ets', 'StatusSheet.ets', 'MenuSheets.ets'];

// ════════════════════════════════════════════════════════════════════════════
// ① 令牌前提（换 token 值即红 —— 本文件引用的每个值都在这里钉住）
// ════════════════════════════════════════════════════════════════════════════
eq('HIT_TARGET_MIN = 44（Apple HIG）', HIT_TARGET_MIN, 44);
eq('RADIUS_CHIP = 6（R_MD）', RADIUS_CHIP, R_MD);
eq('RADIUS_PILL = 8（R_LG）', RADIUS_PILL, R_LG);
eq('RADIUS_CARD = 12（R_XL）', RADIUS_CARD, R_XL);
eq('RADIUS_SHEET = 16（R_2XL）', RADIUS_SHEET, R_2XL);
eq('STROKE_HAIRLINE = 1', STROKE_HAIRLINE, 1);
eq('INSET_ROW_X = 12 / INSET_ROW_Y = 8', [INSET_ROW_X, INSET_ROW_Y], [12, 8]);
eq('DISABLED_OPACITY = 0.4', DISABLED_OPACITY, 0.4);

// ════════════════════════════════════════════════════════════════════════════
// ② 取色/素材合法（用到的 `surface.*` 面名必须在真源 `surfaceRoles()` 里）
// ════════════════════════════════════════════════════════════════════════════
const roleNames: string[] = surfaceRoles().map((s: SurfaceRole) => s.name);
for (const r of ['surface.overlay', 'surface.overlayRow', 'surface.overlayRowHover']) {
  ok(`面 ${r} 是 surfaceRoles() 真源里的合法面`, roleNames.indexOf(r) >= 0);
}

// ════════════════════════════════════════════════════════════════════════════
// ③ 形态 —— 逐文件通用（只看剥注释后的代码）
// ════════════════════════════════════════════════════════════════════════════
for (let i = 0; i < codes.length; i++) {
  const src: string = codes[i];
  const n: string = names[i];
  // 零数值字面量：字号 / 圆角一律走令牌
  ok(`${n}: 无 .fontSize(<数字>)`, src.search(/\.fontSize\(\s*[0-9]/) < 0);
  ok(`${n}: 无 .borderRadius(<数字>)`, src.search(/\.borderRadius\(\s*[0-9]/) < 0);
  hasNot(src, '.border({ width: 1', `${n}: ⛔ 无装饰性 .border({width:1})（改 STROKE_HAIRLINE）`);
  hasNot(src, 'this.pal().border', `${n}: ⛔ 不用 pal().border 当结构边界（改 hairlineOf）`);
  // 结构性发丝 + 语义面 + 浮层柔影
  has(src, 'hairlineOf(this.pal())', `${n}: 结构边界走 hairlineOf(p)`);
  has(src, 'STROKE_HAIRLINE', `${n}: 发丝宽度走 STROKE_HAIRLINE`);
  has(src, "surfaceFillOf(this.pal(), 'surface.overlay')", `${n}: 面板面 = surface.overlay`);
  // G1（2026-10-11）：浮层柔影从 `elevationColorOf(ELEV_OVERLAY)` 单层升级为 `shadowLayersOf(p,'overlay')`
  //   多层柔影（浅色贴合+环境；浅色 far 仍 = 原 `elev3`、深色 far 仍 = 原 `glow` ⇒ 深色逐字节不变）。
  has(src, 'shadowLayersOf(', `${n}: 浮层柔影走 shadowLayersOf（G1 多层柔影）`);
  // 命中区
  has(src, 'HIT_TARGET_MIN', `${n}: 命中区走 HIT_TARGET_MIN（≥44）`);
  // 关闭路径：面板自带 onClose
  has(src, 'onClose', `${n}: 面板自带 onClose（@Prop）`);
  // ⛔ 不在面板内部写别的面板的 flag
  hasNot(src, 'this.ctxOpen', `${n}: ⛔ 不写 ctxOpen`);
  hasNot(src, 'this.sessMenuId', `${n}: ⛔ 不写 sessMenuId`);
  hasNot(src, 'this.showSearchHits', `${n}: ⛔ 不写 showSearchHits`);
  hasNot(src, 'this.showStatus', `${n}: ⛔ 不写 showStatus`);
  hasNot(src, 'this.askUser =', `${n}: ⛔ 不写 askUser`);
  // 唯一在飞动效 = 光球（⛔ 禁新增循环/装饰性 spinner）
  hasNot(src, 'setInterval(', `${n}: ⛔ 无 setInterval`);
  hasNot(src, 'animateTo(', `${n}: ⛔ 无 animateTo`);
  // 2026-10-20：上下文菜单 danger 项的**颜色缓动**走 anim.ets 工厂 `animBase()`
  // （讲"危险项切换"的状态关系，非装饰性 spinner）⇒ 允许该唯一形态；
  // 其它任何就地 `.animation(...)` 仍红。
  const srcNoFactoryAnim: string = src.split('.animation(animBase())').join('');
  hasNot(srcNoFactoryAnim, '.animation(', `${n}: ⛔ 无工厂外的 .animation(`);
  hasNot(src, 'SymbolEffect', `${n}: ⛔ 无符号动效`);
  hasNot(src, 'LoadingProgress', `${n}: ⛔ 无自造 spinner`);
  // 排版走角色
  has(src, "fs('type.", `${n}: 字号走 type.* 角色`);
  // 不再用玻璃（菜单/弹层改不透明浮层面）
  hasNot(src, 'glassBg', `${n}: ⛔ 不用 glassBg`);
  hasNot(src, 'glassBorder', `${n}: ⛔ 不用 glassBorder`);
  hasNot(src, 'backgroundBlurStyle', `${n}: ⛔ 不用 backgroundBlurStyle`);
  hasNot(src, 'isDarkThemeName', `${n}: ⛔ 不按主题名分叉（用 isLightPalette 或语义令牌）`);
}

// ════════════════════════════════════════════════════════════════════════════
// ④ AskUserSheet 专属：空态 / 命中区（**真实 44 布局盒**）/ 选中标记 / 输入面
// ════════════════════════════════════════════════════════════════════════════
// ⛔ 2026-10-11 **按真机事实改写**（旧断言钉 `responseRegion(` 外扩 —— 该做法已被主 agent 装机对照实验
//    推翻：点 X 视觉中心 ✓ / 点框外 11–15px ✗）。新口径 = 关闭 X 的**自身布局盒 ≥ HIT_TARGET_MIN(44)**。
//    ⛔ 不是放宽：仍钉住"命中区 ≥44"这一意图，并反向禁止旧拐杖。
has(askCode, '.width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)', 'AskUserSheet: 关闭 X 命中区 = 真实 HIT_TARGET_MIN(44) 布局盒');
hasNot(askCode, 'responseRegion', 'AskUserSheet: ⛔ 不用 responseRegion 外扩（真机实测负偏移外扩无效）');
has(askCode, "Text('没有待确认的问题')", 'AskUserSheet: questions 为空 ⇒ 一行小字空态（⛔ 无全角括号括注）');
hasNot(askCode, "'已选'", 'AskUserSheet: ⛔ 不再用「已选」纯文本（改勾图标）');
hasNot(askCode, "'未选'", 'AskUserSheet: ⛔ 不再用「未选」纯文本');
has(askCode, 'sys.symbol.checkmark', 'AskUserSheet: 选中态 = 一枚 checkmark');
has(askCode, 'SURFACE_COMPOSER', 'AskUserSheet: 「其他」输入面走 SURFACE_COMPOSER');
has(askCode, 'RADIUS_CARD', 'AskUserSheet: 面板圆角走 RADIUS_CARD');

// ════════════════════════════════════════════════════════════════════════════
// ⑤ StatusSheet 专属：空态 / 命中区（**真实 44 布局盒**）/ 层级（标签次级 / 值主色）
// ════════════════════════════════════════════════════════════════════════════
// ⛔ 2026-10-11 **按真机事实改写**（同 ④：旧 `responseRegion` 外扩已证无效）。
has(statusCode, '.width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)', 'StatusSheet: 关闭 X 命中区 = 真实 HIT_TARGET_MIN(44) 布局盒');
hasNot(statusCode, 'responseRegion', 'StatusSheet: ⛔ 不用 responseRegion 外扩（真机实测负偏移外扩无效）');
has(statusCode, "Text('暂无会话状态')", 'StatusSheet: 五路输入全空 ⇒ 一行小字空态（⛔ 无全角括号括注）');
has(statusCode, "'type.callout'", 'StatusSheet: 行标签走 type.callout（次级色）');
has(statusCode, 'sys.symbol.chevron_right', 'StatusSheet: 切换入口是「行 + chevron」（非实心色块）');
hasNot(statusCode, 'FontWeight.Bold', 'StatusSheet: ⛔ 标题不再写死 FontWeight.Bold（走 type.headline 字重）');

// ════════════════════════════════════════════════════════════════════════════
// ⑥ MenuSheets 专属：三面板各自带 onClose / 关闭哨兵 / 空态 / 不可点态
// ════════════════════════════════════════════════════════════════════════════
ok('MenuSheets: 三个面板各有一个 onClose（≥3 处）', count(menuCode, 'onClose: () => void') >= 3);
has(menuCode, 'MENU_CLOSE', 'MenuSheets: 关闭走哨兵码 MENU_CLOSE（⛔ 不再塞进 onItem 派发）');
hasNot(menuCode, "this.onItem('cancel')", "MenuSheets: ⛔ 取消项不再回调 onItem('cancel')");
hasNot(menuCode, "'cancel-hits'", 'MenuSheets: ⛔ 关闭项不再回调 cancel-hits');
has(menuCode, '没有匹配的消息', 'MenuSheets: 搜索命中为 0 ⇒ 一行小字空态');
has(menuCode, 'DISABLED_OPACITY', 'MenuSheets: 不可点的项走 DISABLED_OPACITY');
has(menuCode, 'constraintSize({ minHeight: HIT_TARGET_MIN })', 'MenuSheets: 菜单行命中区 ≥44');
has(menuCode, 'RADIUS_SHEET', 'MenuSheets: 底部 sheet 圆角走 RADIUS_SHEET（只收上两角）');
has(menuCode, 'borderWidth({ top: STROKE_HAIRLINE })', 'MenuSheets: 边界 = 上边一条结构性发丝');

// ════════════════════════════════════════════════════════════════════════════
// ⑦ 会话操作菜单（SessSheet）菜单项 = **图标 + 文字**；破坏性项走 `dangerText`（2026-10-12 本波）
//    ⛔ 字形名逐个经字体真源（`HMSymbolVF.ttf` 的 `post` 表）核对，不许凭空造名；
//    ⛔ 弱图标色必须走 `colorOf(p,'iconMuted')`（`iconMuted` **不是** `Palette` 字段）。
// ════════════════════════════════════════════════════════════════════════════
has(menuCode, 'SymbolGlyph(this.iconOf(code))', 'MenuSheets: 菜单项渲染图标（iconOf 按动作码映射）');
has(menuCode, 'private iconOf(code: string): Resource {', 'MenuSheets: 有 iconOf 映射（$r 只能字面量 ⇒ 用 switch 而非拼串）');
has(menuCode, "return $r('sys.symbol.trash');", 'MenuSheets: 删除动作 → trash 字形');
has(menuCode, 'return this.starred ? $r(\'sys.symbol.star_fill\') : $r(\'sys.symbol.star\');',
  'MenuSheets: 标星随状态切 star/star_fill');
has(menuCode, 'private dangerOf(code: string): boolean {', 'MenuSheets: 破坏性动作有 dangerOf 判据');
has(menuCode, "colorOf(this.pal(), 'dangerText')", 'MenuSheets: 破坏性项（删除）走 dangerText 红');
has(menuCode, "colorOf(this.pal(), 'iconMuted')", 'MenuSheets: 图标弱色走 colorOf iconMuted（⛔ 非 Palette 字段）');
has(menuCode, '.fontSize(ICON_MD)', 'MenuSheets: 图标尺寸走 ICON_MD token（零字面量）');

// ════════════════════════════════════════════════════════════════════════════
// ⑧ 「居中浮动卡」浮层**根容器**契约（2026-10-12 本轮：从 ③ 的 3 文件扩面到同族全部 8 个）
//    背景：③ 的逐文件断言只覆盖 AskUser/Status/MenuSheets。本轮把**同族**（居中浮动卡）的
//    其余 sheet 也纳入，抓出并修掉两类此前漏网的缺陷：
//      · 根 Stack 写成 `100%×100%`（不透明 `surface.overlay`）⇒ **整屏盖住聊天**、far 柔影落在
//        屏幕边缘（真机实测 `SessionStatsSheet`/`TaskDetailSheet` 曾如此，与 `PluginsSheet`
//        「居中浮动卡 + 背后可见聊天」观感不一致）；
//      · 面板边界用**装饰性** `pal().border` + 裸宽 `1`（真机实测 `TerminalSheet`）——
//        ⛔ 结构边界必须走 `hairlineOf`（浅色系才有足够可见度）。
//    判据 = **承载 `.transition(sheetTransition())` 的外层容器，其最后一个宽度声明**必须是
//      **卡片宽度**。⚠️ 2026-10-12 **判据演进**（目标③「所有面板一个设计系统」）：8 个居中浮层
//      的宽口径曾**两套**（4×裸 `94%` + 4×裸 `92%`）⇒ 本轮统一到令牌 `SHEET_WIDTH`（= 92%，
//      证据见 `tools/tests/panel_surface_consistency.test.ts` D 组）⇒ 本判据从"逐文件钉分档字面"
//      演进为"钉**同一个令牌**"（⛔ 不再钉分档 —— 那正是本轮修掉的缺陷形态）。
//      mutation 自证：把任一 sheet 根改回 `width('100%').height('100%')` ⇒ `outerWidthSpec`
//      由 `SHEET_WIDTH` 变 `100%` ⇒ 红（见提交信息）。
// ════════════════════════════════════════════════════════════════════════════
/** 取浮层根（`.transition(sheetTransition())` 之前）**最靠后**的一个宽度声明，规范成可比较的串。 */
function outerWidthSpec(code: string): string {
  const idx: number = code.lastIndexOf('.transition(sheetTransition())');
  const pre: string = idx >= 0 ? code.substring(0, idx) : code;
  let bestIdx: number = -1;
  let bestVal: string = '';
  const litRe = /\.width\('(\d+)%'\)/g;
  let m: RegExpExecArray | null;
  while ((m = litRe.exec(pre)) !== null) {
    if (m.index > bestIdx) { bestIdx = m.index; bestVal = m[1] + '%'; }
  }
  const tok = '.width(SHEET_WIDTH)';
  let i: number = pre.indexOf(tok);
  while (i >= 0) { if (i > bestIdx) { bestIdx = i; bestVal = 'SHEET_WIDTH'; } i = pre.indexOf(tok, i + tok.length); }
  return bestVal;
}
// 自证（mutation 等价物）：喂"必红/应绿"样本给**同一个**判定函数，双向都要对。
ok('自证 · 根 = 令牌 SHEET_WIDTH', outerWidthSpec(".width(SHEET_WIDTH)\n.transition(sheetTransition())") === 'SHEET_WIDTH');
ok('自证 · ⛔ 根 = 100% 全屏 ⇒ 判红', outerWidthSpec(".width('100%').height('100%')\n.transition(sheetTransition())") === '100%');
ok('自证 · 令牌优先于更早的百分比字面量（内层 100% 不算根）',
  outerWidthSpec(".width('100%').width(SHEET_WIDTH)\n.transition(sheetTransition())") === 'SHEET_WIDTH');
ok('自证 · 令牌之后又被百分比字面量覆盖 ⇒ 取更后者（根 = 该字面量）',
  outerWidthSpec(".width(SHEET_WIDTH).width('94%')\n.transition(sheetTransition())") === '94%');

// 8 个居中浮层（同族）：宽口径**统一**为令牌 `SHEET_WIDTH`（92%）—— 判据**不再**逐文件钉分档。
const CARD_SHEETS: string[] = [
  'AskUserSheet.ets', 'StatusSheet.ets', 'QueueSheet.ets', 'SelfCheckSheet.ets',
  'PluginsSheet.ets', 'SessionStatsSheet.ets', 'TaskDetailSheet.ets', 'TerminalSheet.ets',
];
for (let i = 0; i < CARD_SHEETS.length; i++) {
  const rel: string = CARD_SHEETS[i];
  const code: string = stripComments(fsMod.readFileSync(pathMod.join(COMP, rel), 'utf-8'));
  // ① 浮层根 = 卡片宽度（令牌 `SHEET_WIDTH`=92%，⛔ 不是 100% 全屏 ⇒ 不会整屏遮挡聊天）
  eq(`${rel}: 浮层根宽度 = 令牌 SHEET_WIDTH（92%，非 100% 全屏）`, outerWidthSpec(code), 'SHEET_WIDTH');
  // ② 结构边界 = 结构性发丝（⛔ 不是装饰性 pal().border / 裸宽 1）
  hasNot(code, '.border({ width: 1', `${rel}: ⛔ 无装饰性 .border({width:1})`);
  hasNot(code, 'pal().border', `${rel}: ⛔ 不用 pal().border 当结构边界`);
  hasNot(code, 'palOnce().border', `${rel}: ⛔ 不用 palOnce().border 当结构边界`);
  has(code, 'STROKE_HAIRLINE', `${rel}: 发丝宽度走 STROKE_HAIRLINE`);
  has(code, 'hairlineOf(', `${rel}: 结构边界走 hairlineOf`);
  has(code, 'surface.overlay', `${rel}: 面板面 = surface.overlay`);
  ok(`${rel}: 无 .borderRadius(<数字>)`, code.search(/\.borderRadius\(\s*[0-9]/) < 0);
  ok(`${rel}: 无 .fontSize(<数字>)`, code.search(/\.fontSize\(\s*[0-9]/) < 0);
  // ③ 圆角走**语义 token**（Queue/SelfCheck 此前裸写 tokens 的 `R_XL`；同值 12 但丢语义）
  if (rel === 'QueueSheet.ets' || rel === 'SelfCheckSheet.ets') {
    has(code, 'RADIUS_CARD', `${rel}: 面板圆角走语义 token RADIUS_CARD`);
    hasNot(code, 'R_XL', `${rel}: ⛔ 不再裸写 R_XL（改 RADIUS_CARD，同值 12）`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ⑨ 底部操作菜单三件套（MenuSheets）**文案/标题**契约（2026-10-12 批次 13f）
//    真机取证发现三类缺陷（会话/搜索/上下文菜单同族）：
//      · `ContextSheet.headerLabel` 只判 `'tool'` ⇒ 工具**组**菜单（`ctxKind==='tools'`，
//        `openToolsCtx` 真机可达）落到兜底 `'消息操作'`（长按工具组时标题与内容不符）；
//      · `SearchHitsSheet` 头部**无条件**显示「（点一条复制片段）」⇒ 0 命中时是**假指令**、
//        且与正文「没有匹配的消息」重复（`runSearch` 无条件 `showSearchHits=true`）；
//      · `SessSheet` 分支项 label 含**英文开发者语** `fork`（web 权威 = `session.fork='分叉会话'`）。
//    mutation 自证：回退任一处 ⇒ 对应断言红（见提交信息）。
// ════════════════════════════════════════════════════════════════════════════
// ⑨a headerLabel 必须同时覆盖 'tool' 与 'tools'（都 → '工具操作'）
const hlStart: number = menuCode.indexOf('private headerLabel(): string {');
const hlEnd: number = hlStart >= 0 ? menuCode.indexOf('\n  }', hlStart) : -1;
const hlBody: string = hlStart >= 0 && hlEnd > hlStart ? menuCode.substring(hlStart, hlEnd) : '';
ok('MenuSheets: 找到 headerLabel 函数体（零扫描判红）', hlBody.length > 0);
has(hlBody, "'tool'", 'headerLabel: 覆盖单枚工具菜单 tool');
has(hlBody, "'tools'", 'headerLabel: 覆盖工具**组**菜单 tools（⛔ 否则落兜底「消息操作」）');
has(hlBody, '工具操作', 'headerLabel: tool/tools 同源出「工具操作」');
has(hlBody, "'消息操作'", 'headerLabel: 其余（消息/用户）仍落「消息操作」兜底');

// ⑨b SearchHitsSheet 头部按命中数分档（0 命中不给「点一条复制片段」假指令）
const htStart: number = menuCode.indexOf('private hitsTitle(): string {');
const htEnd: number = htStart >= 0 ? menuCode.indexOf('\n  }', htStart) : -1;
const htBody: string = htStart >= 0 && htEnd > htStart ? menuCode.substring(htStart, htEnd) : '';
ok('MenuSheets: 找到 hitsTitle 函数体（零扫描判红）', htBody.length > 0);
const qIdx: number = htBody.indexOf('n > 0 ?');
const colonIdx: number = qIdx >= 0 ? htBody.indexOf(' : ', qIdx) : -1;
const trueBranch: string = qIdx >= 0 && colonIdx > qIdx ? htBody.substring(qIdx, colonIdx) : '';
const falseBranch: string = colonIdx > 0 ? htBody.substring(colonIdx) : '';
ok('hitsTitle: 按命中数 >0 分档（三元）', qIdx >= 0 && colonIdx > qIdx);
has(trueBranch, '点一条复制片段', 'hitsTitle: 操作提示只在**有命中**的真分支');
has(falseBranch, '搜索结果', 'hitsTitle: 0 命中的假分支 = 中性标题「搜索结果」');
hasNot(falseBranch, '点一条复制片段', 'hitsTitle: ⛔ 假分支（0 命中）不含操作提示');
// 头部渲染改用函数（⛔ 不再是无条件模板串）
has(menuCode, 'Text(this.hitsTitle())', 'SearchHitsSheet: 头部走 hitsTitle()（按命中数分档）');
hasNot(menuCode, '命中 ${this.hits.length} 条（点一条复制片段）`',
  'SearchHitsSheet: ⛔ 不再无条件显示操作提示');

// ⑨c **一般规则**：菜单项 label 不含英文开发者语（本轮抓到 `fork`）
const menuLabels: string[] = [];
const labRe = /this\.CtxItem\(([^,]+?),/g;
let lm: RegExpExecArray | null = labRe.exec(menuCode);
while (lm !== null) { menuLabels.push(lm[1].trim()); lm = labRe.exec(menuCode); }
ok('MenuSheets: 扫到菜单项 label > 0（零扫描判红）', menuLabels.length > 0);
const leakedLabels: string[] = menuLabels.filter((s) => /fork/i.test(s));
ok('MenuSheets: 无菜单项 label 含英文开发者语 fork（一般规则）', leakedLabels.length === 0);
const forkRe = /this\.CtxItem\(\s*([^,]+?)\s*,\s*'fork'/g;
let forkLabel: string = '';
let fm: RegExpExecArray | null = forkRe.exec(menuCode);
while (fm !== null) { forkLabel = fm[1]; fm = forkRe.exec(menuCode); }
ok('MenuSheets: 找到 SessSheet 分支菜单项（零扫描判红）', forkLabel.length > 0);
has(forkLabel, '分叉', 'SessSheet 分支项用 web 词根「分叉」');

if (fail > 0) {
  console.log(`  sheets2_visual: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  sheets2_visual: ${pass} passed, 0 failed`);
process.exit(0);
