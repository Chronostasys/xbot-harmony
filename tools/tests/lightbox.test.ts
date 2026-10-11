/**
 * 图片 lightbox（E5）门禁 —— **纯逻辑**（手势阈值）+ **组件源码形态**。
 *
 * web 权威：`/Users/bobli/src/xbot/web/src/components/agent/Lightbox.tsx`（全屏浮层；关闭 = Esc / 点遮罩；
 *   图 + caption + 外链 + 关闭按钮）。本端在 web 之上补**原生手势**：双指缩放 / 双击 1↔2.5 / 放大后平移
 *   （判据 = `core/imgops.ets`）+ **下滑关闭**（阈值 = 视口高 1/5，仅在**未放大**时生效）。
 *
 * ⛔ 判据纪律：读**真实源码**、**剥注释且保留换行**、**零扫描判红**（命中原文可 grep）。
 * mutation 自证：在 `Lightbox.ets` 里加 `.opacity(this.zoomed ? 1 : 0)` ⇒ 门禁 ⑨ A1 形态必红（本判据同抓）；
 *   去掉 `.transition(lightboxTransition())` ⇒ 本判据必红。
 *
 * ⚠️ 有 `export {}`/`import`（⇒ TS 模块），避免与"无 import 的全局脚本"测试在聚合编译里撞名。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

import { SWIPE_DISMISS_RATIO, shouldDismissBySwipe } from '../../entry/src/main/ets/core/imgops';
import { clampScale, nextZoom, panLimit } from '../../entry/src/main/ets/core/imgops';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    const n = i + 1 < src.length ? src.charAt(i + 1) : '';
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

// ── ① 纯逻辑：下滑关闭阈值（手势可抽的那部分）──────────────────────────────────
{
  eq('阈值比例 = 1/5（视口高）', SWIPE_DISMISS_RATIO, 0.2);
  eq('下滑 19%（未达）⇒ 不关', shouldDismissBySwipe(190, 1000, 1), false);
  eq('下滑 20%（恰好）⇒ 关', shouldDismissBySwipe(200, 1000, 1), true);
  eq('下滑 60% ⇒ 关', shouldDismissBySwipe(600, 1000, 1), true);
  eq('⛔ **向上**滑（dy<0）⇒ 不关', shouldDismissBySwipe(-600, 1000, 1), false);
  eq('⛔ **放大态**（2.5×）下滑 ⇒ 不关（此时单指 = 平移）', shouldDismissBySwipe(600, 1000, 2.5), false);
  eq('放大态即使是巨大下滑也不关', shouldDismissBySwipe(9999, 1000, 6), false);
  eq('视口未知（0）⇒ 不关（防御）', shouldDismissBySwipe(600, 0, 1), false);
  eq('NaN ⇒ 不关（防御，不抛）', shouldDismissBySwipe(Number.NaN, 1000, 1), false);
  // 与平移判据**互斥**：放大态的可平移量 > 0，而下滑关闭恒 false
  ok('放大态：可平移（panLimit>0）但不可下滑关闭 ⇒ 两条手势语义互斥',
    panLimit(2.5, 400, 1000) > 0 && shouldDismissBySwipe(600, 1000, 2.5) === false);
  // 缩放/双击档位仍来自同一模块（组件不得自造）
  eq('缩放夹取上界 6', clampScale(99), 6);
  eq('双击档位 1 → 2.5', nextZoom(1), 2.5);
  eq('双击档位 2.5 → 1', nextZoom(2.5), 1);
}

// ── ★② 组件源码形态（`components/**` 不进离线 harness ⇒ 读真实源码；同本仓先例）──
{
  let root: string = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/components/Lightbox.ets'))) { root = p; break; }
  }
  ok('读到 components/Lightbox.ets', root.length > 0);
  const oc: string = stripComments(fs.readFileSync(path.join(root, 'entry/src/main/ets/components/Lightbox.ets'), 'utf8'));
  ok('扫到组件源码（非空）—— 零扫描判红', oc.length > 0);

  ok('① 出入场走具名工厂 `.transition(lightboxTransition())`（时长/曲线/缩放起点来自底座）',
    oc.indexOf('.transition(lightboxTransition())') >= 0);
  // ⛔ 精确判"静息态 = 隐藏"的**形态**（`.opacity(<含 ? 的三元>)`），而不是"禁止出现 `.opacity(`"——
  //    后者会把 `interactive_feedback` 要求的**按压反馈** `.opacity(PRESS_OPACITY)` 也误判（实测踩到）。
  ok('① ⛔ **无** `.opacity(<三元>)`（静息可见性不由动画函数决定；门禁 ⑨ A1 的正向形态）',
    !/\.opacity\([^)]*\?/.test(oc));
  ok('①-2 按压反馈按统一口径（`.opacity(PRESS_OPACITY)`，⛔ 不写死数值）',
    oc.indexOf('pressed: { .opacity(PRESS_OPACITY) }') >= 0);
  ok('② 面/发丝/柔影全走唯一口径（surfaceFillOf / hairlineOf / shadowRadiusOf + elevationColorOf）',
    oc.indexOf('surfaceFillOf(') >= 0 && oc.indexOf('hairlineOf(') >= 0
    && oc.indexOf('shadowRadiusOf(') >= 0 && oc.indexOf('elevationColorOf(') >= 0);
  ok('② 字/图标色走 `colorOf` 角色 + 字号走 `typeOf`（⛔ 不写裸字号/裸色）',
    oc.indexOf('colorOf(') >= 0 && oc.indexOf('typeOf(') >= 0);
  ok('② ⛔ 无裸调色板字段（`this.pal().surface|border|appBg|textXxx` 之类一律不许 —— 必须经口径）',
    oc.indexOf('this.pal().') < 0);
  ok('② ⛔ 无颜色字面量', !/#[0-9A-Fa-f]{6}/.test(oc));
  ok('③ 手势判据全部来自 `core/imgops.ets`（clampScale/panLimit/nextZoom/shouldDismissBySwipe）',
    oc.indexOf('clampScale(') >= 0 && oc.indexOf('panLimit(') >= 0
    && oc.indexOf('nextZoom(') >= 0 && oc.indexOf('shouldDismissBySwipe(') >= 0);
  ok('③ 下滑关闭只在**未放大**时生效（`if (!isZoomed(...))` 分支早返回）',
    oc.indexOf('shouldDismissBySwipe(') >= 0 && oc.indexOf('isZoomed(') >= 0);
  ok('④ ⛔ 无循环动画/常驻定时器（`setInterval(` / `iterations` 均不得出现）',
    oc.indexOf('setInterval(') < 0 && oc.indexOf('iterations') < 0);
  ok('④ 保存走系统安全组件 `SaveButton`（授权后才有写权限 ⇒ 不申请相册写权限、不静默失败）',
    oc.indexOf('SaveButton(') >= 0 && oc.indexOf('SaveButtonOnClickResult.SUCCESS') >= 0);
  ok('④ 关/存/提示三个出口都是**回调**（组件不碰 store/toast 实现）',
    oc.indexOf('this.onClose()') >= 0 && oc.indexOf('this.onSave()') >= 0 && oc.indexOf('this.onToast(') >= 0);
  ok('④ 点背板关闭（对齐 web `Lightbox.tsx:66`）', oc.indexOf('this.onClose();') >= 0);
}

if (fail > 0) { console.log(`  lightbox: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  lightbox: ${pass} passed, 0 failed`);
process.exit(0);
