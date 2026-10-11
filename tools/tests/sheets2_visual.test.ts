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
  has(src, 'elevationColorOf(this.pal(), ELEV_OVERLAY)', `${n}: 浮层柔影走 elevationColorOf(ELEV_OVERLAY)`);
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
  hasNot(src, '.animation(', `${n}: ⛔ 无 .animation(`);
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
// ④ AskUserSheet 专属：空态 / 命中区外扩 / 选中标记 / 输入面
// ════════════════════════════════════════════════════════════════════════════
has(askCode, 'responseRegion({', 'AskUserSheet: 关闭 X 用 responseRegion 外扩命中区（不改布局尺寸）');
has(askCode, '没有待确认的问题', 'AskUserSheet: questions 为空 ⇒ 一行小字空态');
hasNot(askCode, "'已选'", 'AskUserSheet: ⛔ 不再用「已选」纯文本（改勾图标）');
hasNot(askCode, "'未选'", 'AskUserSheet: ⛔ 不再用「未选」纯文本');
has(askCode, 'sys.symbol.checkmark', 'AskUserSheet: 选中态 = 一枚 checkmark');
has(askCode, 'SURFACE_COMPOSER', 'AskUserSheet: 「其他」输入面走 SURFACE_COMPOSER');
has(askCode, 'RADIUS_CARD', 'AskUserSheet: 面板圆角走 RADIUS_CARD');

// ════════════════════════════════════════════════════════════════════════════
// ⑤ StatusSheet 专属：空态 / 命中区外扩 / 层级（标签次级 / 值主色）
// ════════════════════════════════════════════════════════════════════════════
has(statusCode, 'responseRegion({', 'StatusSheet: 关闭 X 用 responseRegion 外扩命中区');
has(statusCode, '暂无会话状态', 'StatusSheet: 五路输入全空 ⇒ 一行小字空态');
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

if (fail > 0) {
  console.log(`  sheets2_visual: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  sheets2_visual: ${pass} passed, 0 failed`);
process.exit(0);
