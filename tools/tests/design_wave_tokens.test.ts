/**
 * 设计令牌层「补齐波」判别力测试（`core/design.ets`，2026-10-11）。
 *
 * 为什么单独成文件：`tools/tests/design.test.ts` 的 168 条断言**已冻结**（不许改旧期望值）；
 * 本波新增的令牌/角色单独在此**逐条钉住**，互不干扰。
 *
 * 覆盖（来源）：`chat-surface-ux` 与 `settings-ux` 交回的"组件魔数无对应语义 token"清单 +
 * `orb-ux` 申请的在飞光晕 role + `core/dangerconfirm.ets:110` 报备的危险态缺角色。
 *
 * ⚠️ **判别力自证（改动下列任一锚点 ⇒ 本测试必红；提交信息附 mutation 实跑）**：
 *   · `RADIUS_FULL` 从 999 改 998                     ⇒ 'RADIUS_FULL = 999' 红
 *   · `opticalValues()` 去掉 `INSET_GOAL_X`            ⇒ 'goal pads 进光学白名单' 红
 *   · `GOAL_ROW_TINT_LIGHT` 从 0.14 改 0.13            ⇒ 'goalRowTint alpha 深=12 浅=24' 红
 *   · `colorOf` 删掉 `role === 'inflightHalo'` 分支     ⇒ 'inflightHalo 可解析' 红
 *   · `onFillFgOf` 恒返回 `onAccent`                   ⇒ 'dangerOnFill 对 dangerBg ≥3' 红
 *   · `design.ets` 写入任意 `#RRGGBB`                  ⇒ '无 #RRGGBB 字面量' 红
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  SPACE_HAIR, SPACE_XS, SPACE_SM, SPACE_XL,
  opticalValues, ICON_SM, ICON_MD, ICON_LG,
  CONTROL_INPUT_H, CONTROL_INPUT_W_NUM, CONTROL_CHIP_PAD_X, CONTROL_CHIP_PAD_Y,
  ROW_MIN_H, ROW_GAP, ROW_INDENT, CONTROL_ROW_H, PROGRESS_W, PROGRESS_H, LIST_MAX_H,
  MENU_W, POPOVER_W, POPOVER_W_OVERFLOW, OVERLAY_ROW_H,
  INSET_GOAL_X, INSET_GOAL_Y, GOAL_BORDER_ALPHA_DARK, GOAL_BORDER_ALPHA_LIGHT,
  GOAL_BADGE_TINT, GOAL_ROW_TINT_DARK, GOAL_ROW_TINT_LIGHT,
  goalBorderOf, goalBadgeBgOf, goalRowTintOf,
  TEXT_DIM, RADIUS_FULL, RADIUS_BUBBLE_TAIL, PRESS_OPACITY,
  SURFACE_PILL, SURFACE_CHIP, SURFACE_CARD,
  INFLIGHT_HALO, inflightHaloOf, inflightPillShadowOf,
  COLOR_DANGER_BG, COLOR_WARN_BG, COLOR_DANGER_ON_FILL, COLOR_WARN_ON_FILL, onFillFgOf,
  HIT_TARGET_MIN, radiusRoles, RadiusRole, surfaceRoles, SurfaceRole, typeOf,
  designIssues, colorOf,
} from '../../entry/src/main/ets/core/design';
import {
  paletteOf, ALL_THEMES, contrastRatio, THEME_DARK, THEME_PORCELAIN,
} from '../../entry/src/main/ets/core/theme';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const pd = paletteOf(THEME_DARK);
const pl = paletteOf(THEME_PORCELAIN);

// ════════════════════════════════════════════════════════════════════════════
// A. 图标边长阶梯（GoalBanner/TodoPanel 的 ICON=14）
// ════════════════════════════════════════════════════════════════════════════
eq('ICON 阶梯 12/14/16', [ICON_SM, ICON_MD, ICON_LG], [12, 14, 16]);
ok('ICON 严格递增', ICON_SM < ICON_MD && ICON_MD < ICON_LG);
eq('icon.md = 14（web size-3.5）', ICON_MD, 14);

// ════════════════════════════════════════════════════════════════════════════
// B. 控件尺寸（settings-ux 交回）
// ════════════════════════════════════════════════════════════════════════════
eq('CONTROL_INPUT_H = 44 = HIT_TARGET_MIN', CONTROL_INPUT_H, HIT_TARGET_MIN);
eq('ROW_MIN_H = 44 = HIT_TARGET_MIN', ROW_MIN_H, HIT_TARGET_MIN);
eq('CONTROL_INPUT_W_NUM = 96', CONTROL_INPUT_W_NUM, 96);
eq('CONTROL_CHIP_PAD_X = 12 (=space.sm)', CONTROL_CHIP_PAD_X, SPACE_SM);
eq('CONTROL_CHIP_PAD_Y = 8 (=space.xs)', CONTROL_CHIP_PAD_Y, SPACE_XS);
eq('ROW_GAP = 2 (=space.hair)', ROW_GAP, SPACE_HAIR);
eq('ROW_INDENT = 24 (=space.xl)', ROW_INDENT, SPACE_XL);
eq('CONTROL_ROW_H = 28', CONTROL_ROW_H, 28);

// ════════════════════════════════════════════════════════════════════════════
// C. 面板 / 浮层尺寸（TodoPanel / MessageRow / LiveTailView）
// ════════════════════════════════════════════════════════════════════════════
eq('PROGRESS 48×6', [PROGRESS_W, PROGRESS_H], [48, 6]);
eq('LIST_MAX_H = 240', LIST_MAX_H, 240);
eq('MENU_W = 120', MENU_W, 120);
eq('POPOVER_W = 340', POPOVER_W, 340);
eq('POPOVER_W_OVERFLOW = 320', POPOVER_W_OVERFLOW, 320);
eq('OVERLAY_ROW_H = 28', OVERLAY_ROW_H, 28);
ok('面板/浮层尺寸（除进度高 6）均在 4 网格上',
  [CONTROL_ROW_H, PROGRESS_W, LIST_MAX_H, MENU_W, POPOVER_W, POPOVER_W_OVERFLOW, OVERLAY_ROW_H,
    ROW_MIN_H, ROW_INDENT, CONTROL_INPUT_W_NUM].every((v: number) => v % 4 === 0));

// ════════════════════════════════════════════════════════════════════════════
// D. 目标辅助条（GoalBanner / TodoPanel 的 goal 视觉）
// ════════════════════════════════════════════════════════════════════════════
eq('INSET_GOAL 10/6（光学档）', [INSET_GOAL_X, INSET_GOAL_Y], [10, 6]);
ok('goal pads 进光学白名单（非 4 网格已登记）',
  opticalValues().indexOf(INSET_GOAL_X) >= 0 && opticalValues().indexOf(INSET_GOAL_Y) >= 0);
eq('goal 各 alpha 表', [GOAL_BORDER_ALPHA_DARK, GOAL_BORDER_ALPHA_LIGHT, GOAL_BADGE_TINT,
  GOAL_ROW_TINT_DARK, GOAL_ROW_TINT_LIGHT], [0.3, 0.5, 0.15, 0.07, 0.14]);

// 语义出口函数：ARGB 字面量（`withAlpha` 输出 '#AARRGGBB'，α 在头两位）
eq('goalBorderOf 返回 ARGB 字面量', goalBorderOf(pd, false).length, 9);
eq('goalBorder alpha 深=4D 浅=80（替掉"浅色×0.5"硬编码）',
  [goalBorderOf(pd, false).slice(1, 3), goalBorderOf(pl, false).slice(1, 3)], ['4D', '80']);
ok('goalBorderOf completed≠ongoing（success vs accent）',
  goalBorderOf(pd, true) !== goalBorderOf(pd, false));
eq('goalBadgeBg alpha=26 (@15%)', goalBadgeBgOf(pd, false).slice(1, 3), '26');
eq('goalRowTint alpha 深=12 浅=24（7% / 14%）',
  [goalRowTintOf(pd).slice(1, 3), goalRowTintOf(pl).slice(1, 3)], ['12', '24']);
ok('goalRowTint 浅/深分叉', goalRowTintOf(pd) !== goalRowTintOf(pl));

// ════════════════════════════════════════════════════════════════════════════
// E. 规范面常量（settings-ux：让组件"引用常量"而非硬写 role 字面量）
// ════════════════════════════════════════════════════════════════════════════
eq('SURFACE_PILL/CHIP/CARD', [SURFACE_PILL, SURFACE_CHIP, SURFACE_CARD],
  ['surface.pill', 'surface.chip', 'surface.card']);
ok('面常量 ∈ 规范面表（单一来源不破）',
  [SURFACE_PILL, SURFACE_CHIP, SURFACE_CARD]
    .every((a: string) => surfaceRoles().map((s: SurfaceRole) => s.name).indexOf(a) >= 0));

// ════════════════════════════════════════════════════════════════════════════
// F. 弱化正文 / 全圆 + 既有裁决的落地确认（兼容 168 断言）
// ════════════════════════════════════════════════════════════════════════════
eq('TEXT_DIM = 0.75（弱化层历史值；⛔ 2026-10-14 起思考展开体不再用它，见 design.ets 注释）', TEXT_DIM, 0.75);
eq('RADIUS_FULL = 999（PILL_RADIUS 的语义替身）', RADIUS_FULL, 999);
ok('RADIUS_FULL 不进 radiusRoles（保住旧断言"圆角语义表 4 档"）',
  radiusRoles().map((r: RadiusRole) => r.name).indexOf('radius.full') < 0 && radiusRoles().length === 4);
eq('RADIUS_BUBBLE_TAIL = 4（裁决②：统一气泡尾角）', RADIUS_BUBBLE_TAIL, 4);
eq('PRESS_OPACITY = 0.6（裁决①：全站唯一按压不透明度）', PRESS_OPACITY, 0.6);
eq('type.micro = 10（裁决③：字阶封闭、无 9）', typeOf('type.micro').size, 10);

// ════════════════════════════════════════════════════════════════════════════
// G. 在飞光晕 role（orb-ux 申请；单一来源化到 inflightHaloOf）
// ════════════════════════════════════════════════════════════════════════════
for (const t of ALL_THEMES) {
  const p = paletteOf(t);
  ok(`[${t}] inflightHalo 可解析（非透明）`, colorOf(p, INFLIGHT_HALO).length > 0);
  ok(`[${t}] inflightHalo 与 pill 柔影同源`,
    colorOf(p, INFLIGHT_HALO) === inflightPillShadowOf(p) && inflightPillShadowOf(p) === inflightHaloOf(p));
}
ok('inflightHalo 深浅分叉（dark ≠ porcelain）',
  colorOf(pd, INFLIGHT_HALO) !== colorOf(pl, INFLIGHT_HALO));
ok('INFLIGHT_HALO 常量 == 真源字面量（lint 抽取口径一致）',
  colorOf(pd, INFLIGHT_HALO) === colorOf(pd, 'inflightHalo'));

// ════════════════════════════════════════════════════════════════════════════
// H. 危险态（dangerconfirm 报备的缺角色）—— 全主题对比度 ≥ AA_NON_TEXT(3.0)
// ════════════════════════════════════════════════════════════════════════════
eq('危险/警告实心底 role 常量', [COLOR_DANGER_BG, COLOR_WARN_BG], ['dangerBg', 'warnBg']);
for (const t of ALL_THEMES) {
  const p = paletteOf(t);
  const dFg: string = colorOf(p, COLOR_DANGER_ON_FILL);
  const wFg: string = colorOf(p, COLOR_WARN_ON_FILL);
  ok(`[${t}] dangerOnFill 可解析`, dFg.length > 0);
  ok(`[${t}] warnOnFill 可解析`, wFg.length > 0);
  ok(`[${t}] dangerOnFill 对 dangerBg ≥3.0`,
    contrastRatio(dFg, colorOf(p, COLOR_DANGER_BG)) >= 3.0);
  ok(`[${t}] warnOnFill 对 warnBg ≥3.0`,
    contrastRatio(wFg, colorOf(p, COLOR_WARN_BG)) >= 3.0);
}
ok('onFillFgOf 恒取 onAccent 或 textPrimary',
  [pd, pl].every((p) => {
    const f = onFillFgOf(p, p.dangerBg);
    return f === p.onAccent || f === p.textPrimary;
  }));

// ════════════════════════════════════════════════════════════════════════════
// I. 未破坏既有不变量 + 源码形态（禁 hex）
// ════════════════════════════════════════════════════════════════════════════
const issues = designIssues();
if (issues.length > 0) {
  for (const it of issues) { console.log(`  ✗ designIssue[${it.code}] ${it.detail}`); }
}
eq('designIssues() 仍全绿（新增不变量未破既有）', issues.length, 0);

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const designSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'core', 'design.ets'), 'utf-8');
// ⚠️ 2026-10-11 修：本扫描此前**不剥注释** ⇒ **连红两次**（作者在注释里记色值 —— 那是本仓
//    **允许且鼓励**的约定：注释提及 ≠ 代码存在）。剥注释后再判 ⇒ 只抓**真正的代码字面量**。
const designCode: string = designSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
ok('design.ets（**剥注释后**）无 #RRGGBB 字面量（新增派生色全经 withAlpha）',
  !/#[0-9a-fA-F]{6}\b/.test(designCode));
// 判别力自证（防"剥注释把扫描也剥没了"）：注入一行**代码**字面量 ⇒ 必须命中
ok('  · 判别力：代码里的 #RRGGBB 仍必须被抓到（注入样本 ⇒ 命中）',
  /#[0-9a-fA-F]{6}\b/.test('const probe: string = "#A2A2A7";'));
ok('design.ets 不 import @ohos.*（core 纯 TS 铁律）', designSrc.indexOf("from '@ohos") < 0);

if (fail > 0) { console.log(`  design_wave_tokens: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  design_wave_tokens: ${pass} passed, 0 failed`);
process.exit(0);
