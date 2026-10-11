/**
 * 设计令牌层判别力测试（`core/design.ets`，2026-10 重做）。
 *
 * 这是 `docs/REDESIGN.md`（设计语言宪法）的**可执行部分**：宪法里每一条"必须"，
 * 在这里都有一条能"红"的断言。
 *
 * ⚠️ **判别力自证（改动下列任一锚点 ⇒ 本测试必红；提交信息已写明）**：
 *   · 把 `type.body` 行高从 1.55 改成 1.2        ⇒ 'type.bodyLeading' 红（designIssues）
 *   · 把 `type.micro` 字号从 10 改成 12（与 caption 撞）⇒ 'type.dup' 红
 *   · 把 `SPACE_MD` 从 16 改成 15                ⇒ 'space.grid' 红
 *   · 把 `surface.chip` 的 rung 从 SUNKEN 改成 RAISED（= 与 pill 同面）
 *     ⇒ 'surface.nesting' 红（这正是历史真 bug「chip 消失」的根因）
 *   · 把 `motion.beat` 的 owner 改成 'pill'      ⇒ 'motion.inflightOwner' 红（第二套在飞节拍）
 *   · 把 `MOTION_BEAT_MS` 改成 500（不在允许档） ⇒ 'motion.duration' 红
 *   · 把 `contrastReqs` 里 `textSecondary|sunken` 的阈值从 4.5 提到 5.0 ⇒ porcelain 对比度红
 *   · 把 `design.ets` 里写入任意 `#RRGGBB`       ⇒ 'no hex literal' 红
 *
 * 为什么能测：`core/design.ets` 属 `core/` ⇒ `run.sh` 把它当**纯 TS** 编译 ⇒ 可真跑。
 * 组件层不进离线 harness，故"禁止字面量"这类**源码形态**断言读真实源码（本仓既有先例：
 * `tools/tests/minimal_chrome.test.ts` / `one_inflight_motion.test.ts`）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  SPACE_HAIR, SPACE_XXS, SPACE_XS, SPACE_SM, SPACE_MD, SPACE_LG, SPACE_XL, SPACE_XXL,
  RADIUS_CHIP, RADIUS_PILL, RADIUS_CARD, RADIUS_SHEET, STROKE_HAIRLINE, STROKE_RAIL,
  WEIGHT_REGULAR, WEIGHT_MEDIUM, WEIGHT_SEMIBOLD,
  typeRoles, typeOf, TypeRole,
  mdHeadings, MdHeading, MD_BODY_LEADING, MD_HEADING_LEADING, MD_CODE_LEADING, MD_BLOCK_GAP,
  spaceRoles, SpaceRole, radiusRoles, RadiusRole,
  surfaceRoles, SurfaceRole, surfaceFillOf, surfaceHairlineOf, fillOfRung, hairlineOf, wellOf,
  RUNG_CANVAS, RUNG_CARD, RUNG_RAISED, RUNG_ACTIVE, RUNG_SUNKEN,
  motionRoles, MotionRole, allowedDurations, MOTION_BREATH_MS, MOTION_BEAT_MS,
  INFLIGHT_OWNER_ORB, DUR_PRESS,
  INSET_PILL_X, INSET_PILL_Y, MARKER_SLOT, MARKER_GLYPH, MARKER_GLYPH_DASHED, MARKER_SPINNER,
  PILL_MAX_W, opticalValues,
  ELEV_CARD, ELEV_RAISED, ELEV_OVERLAY, elevationColorOf, elevationLevelOf,
  MIN_LEVEL_DELTA, HAIRLINE_ASSIST_BELOW, levelDeltaIssue, chipNeedsHairline,
  SURFACE_THINKING, SURFACE_TODO, SURFACE_TODO_ACTIVE, SURFACE_GOAL, SURFACE_GOAL_BADGE, SURFACE_COMPOSER,
  TYPE_THINKING, TYPE_TODO, TYPE_GOAL, TYPE_PILL_NAME, TYPE_CHIP,
  INFLIGHT_PILL_SURFACE, INFLIGHT_PILL_GLOW_RADIUS, INFLIGHT_OWNER_PILL, inflightPillShadowOf,
} from '../../entry/src/main/ets/core/design';
import { paletteOf, ALL_THEMES, contrastRatio, THEME_DARK, THEME_LIGHT, THEME_PORCELAIN } from '../../entry/src/main/ets/core/theme';
import { designIssues, contrastAudit, contrastFailures, nestingPairsDistinct, ladderDirectionOk, themeOk, colorOf, knownContrastLedger, AA_TEXT, AA_NON_TEXT, AA_MUTED, PRESS_OPACITY, PRESS_SCALE, HIT_TARGET_MIN, LONG_PRESS_MS } from '../../entry/src/main/ets/core/design';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}

// ════════════════════════════════════════════════════════════════════════════
// A. 全量自检：令牌层必须自洽（唯一出口）
// ════════════════════════════════════════════════════════════════════════════
const issues = designIssues();
if (issues.length > 0) {
  for (const it of issues) { console.log(`  ✗ designIssue[${it.code}] ${it.detail}`); }
}
eq('designIssues() 全绿（令牌层自洽）', issues.length, 0);

// ════════════════════════════════════════════════════════════════════════════
// B. 空间尺度（4pt 网格）
// ════════════════════════════════════════════════════════════════════════════
eq('SPACE_HAIR 是唯一光学半档', SPACE_HAIR, 2);
eq('空间 4 的倍数', [SPACE_XXS, SPACE_XS, SPACE_SM, SPACE_MD, SPACE_LG, SPACE_XL, SPACE_XXL].every((v: number) => v % 4 === 0), true);
eq('空间严格递增', SPACE_HAIR < SPACE_XXS && SPACE_XXS < SPACE_XS && SPACE_XS < SPACE_SM
  && SPACE_SM < SPACE_MD && SPACE_MD < SPACE_LG && SPACE_LG < SPACE_XL && SPACE_XL < SPACE_XXL, true);
const sr: SpaceRole[] = spaceRoles();
eq('空间语义表 8 档', sr.length, 8);

// ════════════════════════════════════════════════════════════════════════════
// C. 形状
// ════════════════════════════════════════════════════════════════════════════
eq('圆角 chip<pill<card<sheet', RADIUS_CHIP < RADIUS_PILL && RADIUS_PILL < RADIUS_CARD && RADIUS_CARD < RADIUS_SHEET, true);
eq('chip 圆角 = 6', RADIUS_CHIP, 6);
eq('pill 圆角 = 8', RADIUS_PILL, 8);
eq('card 圆角 = 12', RADIUS_CARD, 12);
eq('sheet 圆角 = 16', RADIUS_SHEET, 16);
eq('发丝 1vp', STROKE_HAIRLINE, 1);
eq('栅栏 2vp', STROKE_RAIL, 2);
eq('圆角语义表 4 档', radiusRoles().length, 4);

// ════════════════════════════════════════════════════════════════════════════
// D. 排版阶梯（严格递减、无重复、行高合规）
// ════════════════════════════════════════════════════════════════════════════
const ty: TypeRole[] = typeRoles();
eq('排版阶梯 8 档', ty.length, 8);
eq('字重只用 400/500/600', [WEIGHT_REGULAR, WEIGHT_MEDIUM, WEIGHT_SEMIBOLD], [400, 500, 600]);
let strictlyDown = true;
for (let i = 1; i < ty.length; i++) { if (ty[i].size >= ty[i - 1].size) { strictlyDown = false; } }
eq('字号阶梯严格递减（层级不塌陷）', strictlyDown, true);
const uniqSizes = new Set(ty.map((t: TypeRole) => t.size));
eq('字号无重复', uniqSizes.size, ty.length);
eq('正文 15fp', typeOf('type.body').size, 15);
eq('正文行高 ≥1.5', typeOf('type.body').lineHeight >= 1.5, true);
eq('微型档 = 10（消灭散落的 10/11）', typeOf('type.micro').size, 10);
eq('未知角色回落正文', typeOf('nope').name, 'type.body');
eq('排版角色带语义色（非空）', ty.every((t: TypeRole) => t.colorRole.length > 0), true);

// Markdown 排版组
const mh: MdHeading[] = mdHeadings();
eq('md 标题 4 档', mh.length, 4);
eq('md 标题非递增', mh[0].size > mh[1].size && mh[1].size > mh[2].size && mh[2].size >= mh[3].size, true);
eq('md h4 == 正文（web 1em 原义）', mh[3].size, typeOf('type.body').size);
eq('md 正文行高 ∈[1.5,1.7]', MD_BODY_LEADING >= 1.5 && MD_BODY_LEADING <= 1.7, true);
eq('md 标题行高 1.28', MD_HEADING_LEADING, 1.28);
eq('md 代码行高 1.5', MD_CODE_LEADING, 1.5);
eq('md 块间距 = 8（原凹口 6）', MD_BLOCK_GAP, SPACE_XS);

// ════════════════════════════════════════════════════════════════════════════
// E. 材质：分层表面（**底里有底不许撞色**）
// ════════════════════════════════════════════════════════════════════════════
const sroles: SurfaceRole[] = surfaceRoles();
eq('语义面表 10 项', sroles.length, 10);
eq('chip = 内嵌凹槽（SUNKEN）', surfaceFillOf(paletteOf(THEME_DARK), 'surface.chip') === wellOf(paletteOf(THEME_DARK)), true);

for (const t of ALL_THEMES) {
  const p = paletteOf(t);
  eq(`[${t}] 可嵌套面两两不同`, nestingPairsDistinct(p), true);
  eq(`[${t}] 层级方向自洽`, ladderDirectionOk(p), true);
  // chip 恒 ≠ pill（含选中）
  const pill = surfaceFillOf(p, 'surface.pill');
  const pillSel = surfaceFillOf(p, 'surface.pillSelected');
  const chip = surfaceFillOf(p, 'surface.chip');
  eq(`[${t}] chip ≠ pill`, chip !== pill, true);
  eq(`[${t}] chip ≠ 选中 pill`, chip !== pillSel, true);
  eq(`[${t}] 选中 pill ≠ pill`, pill !== pillSel, true);
  eq(`[${t}] 全绿（面 + 对比度）`, themeOk(t), true);
  // 层级递增（深色族显式校验填充亮度序）
  eq(`[${t}] 层级 fill 各自可解析`, fillOfRung(p, RUNG_CANVAS).length > 0
    && fillOfRung(p, RUNG_CARD).length > 0 && fillOfRung(p, RUNG_RAISED).length > 0
    && fillOfRung(p, RUNG_ACTIVE).length > 0 && fillOfRung(p, RUNG_SUNKEN).length > 0, true);
  eq(`[${t}] 发丝可解析`, hairlineOf(p).length > 0, true);
  eq(`[${t}] 卡片/浮层需要发丝`, surfaceHairlineOf('surface.card') && surfaceHairlineOf('surface.overlay'), true);
  eq(`[${t}] pill 不需要发丝`, surfaceHairlineOf('surface.pill'), false);
}

// ════════════════════════════════════════════════════════════════════════════
// F. 动效：时长 ∈ 允许档位；**在飞 owner 唯一**（铁律的可判定形式）
// ════════════════════════════════════════════════════════════════════════════
const mr: MotionRole[] = motionRoles();
eq('在飞角色恰好 2 个（breath / beat）', mr.filter((m: MotionRole) => m.inFlight).length, 2);
const owners = new Set(mr.filter((m: MotionRole) => m.inFlight).map((m: MotionRole) => m.owner));
eq('在飞 owner 唯一 = orb（铁律）', Array.from(owners), [INFLIGHT_OWNER_ORB]);
eq('非在飞角色没有 owner', mr.filter((m: MotionRole) => !m.inFlight).every((m: MotionRole) => m.owner === ''), true);
for (const m of mr) {
  ok(`[${m.name}] 时长 ${m.ms} ∈ 允许档位`, allowedDurations().indexOf(m.ms) >= 0);
}
eq('主呼吸 = 8×D_SLOW = 2560', MOTION_BREATH_MS, 2560);
eq('细节拍 = 主呼吸/4 = 640', MOTION_BEAT_MS, 640);
eq('按压时长 = 180', DUR_PRESS, 180);
eq('一次性过渡不占用在飞档（press）', mr.filter((m: MotionRole) => m.name === 'motion.press')[0].inFlight, false);

// ════════════════════════════════════════════════════════════════════════════
// G. 交互反馈
// ════════════════════════════════════════════════════════════════════════════
eq('按压不透明度 0.6（全站唯一）', PRESS_OPACITY, 0.6);
eq('按压缩放 0.97', PRESS_SCALE, 0.97);
eq('最小命中区 44vp（Apple HIG）', HIT_TARGET_MIN, 44);
eq('长按 400ms', LONG_PRESS_MS, 400);

// ════════════════════════════════════════════════════════════════════════════
// H. 对比度门禁（WCAG 2.1）：台账之外不得有缺口；关键比值实测达 AA
// ════════════════════════════════════════════════════════════════════════════
eq('AA 文本阈值 4.5', AA_TEXT, 4.5);
eq('AA 非文本阈值 3.0', AA_NON_TEXT, 3.0);
eq('最弱一档阈值 2.0', AA_MUTED, 2.0);
for (const t of ALL_THEMES) {
  const fails = contrastFailures(t);
  if (fails.length > 0) {
    for (const f of fails) { console.log(`  ✗ [${t}] ${f.fg}/${f.bg}=${f.ratio.toFixed(3)} < ${f.min}`); }
  }
  eq(`[${t}] 台账之外无对比度缺口`, fails.length, 0);
}
// 白色主题（porcelain）逐条实测达 AA（把 DESIGN-SYSTEM §11.3 的台账口径搬进设计层）
const por = paletteOf(THEME_PORCELAIN);
ok('porcelain 正文/画布 ≥4.5', contrastRatio(por.textPrimary, por.appBg) >= 4.5);
ok('porcelain 正文/卡片 ≥4.5', contrastRatio(por.textPrimary, por.surface) >= 4.5);
ok('porcelain 次要正文/卡片 ≥4.5', contrastRatio(por.textSecondary, por.surface) >= 4.5);
ok('porcelain 关键 CTA 白字/主色 ≥4.5', contrastRatio(por.onAccent, por.accent) >= 4.5);
ok('porcelain 强调文字/卡片 ≥4.5', contrastRatio(por.accentText, por.surface) >= 4.5);
ok('porcelain chip 文字/凹槽 ≥4.5', contrastRatio(por.textSecondary, wellOf(por)) >= 4.5);
ok('porcelain 深色族反之（dark 台账内）', contrastFailures(THEME_DARK).length === 0);
// 台账条目不许被删（删 = 放宽阈值）
eq('台账含 dark onAccent|accent', knownContrastLedger().indexOf('dark|onAccent|accent') >= 0, true);

// 两两可区分：语义面在两套极端主题下都不同色
{
  const pd = paletteOf(THEME_DARK), pl = paletteOf(THEME_PORCELAIN);
  const dd = new Set([surfaceFillOf(pd, 'surface.canvas'), surfaceFillOf(pd, 'surface.card'),
    surfaceFillOf(pd, 'surface.overlayRow'), surfaceFillOf(pd, 'surface.overlayRowHover'),
    surfaceFillOf(pd, 'surface.chip')]);
  eq('dark 五个语义面互不同色', dd.size, 5);
  const ll = new Set([surfaceFillOf(pl, 'surface.overlayRow'), surfaceFillOf(pl, 'surface.overlayRowHover'),
    surfaceFillOf(pl, 'surface.chip')]);
  eq('porcelain 浮层/凹槽三者互不同色', ll.size, 3);
}

// ════════════════════════════════════════════════════════════════════════════
// I. 源码形态契约：令牌层**禁颜色字面量**
// ════════════════════════════════════════════════════════════════════════════
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const etsDir = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets');
const designSrc: string = fsMod.readFileSync(pathMod.join(etsDir, 'core', 'design.ets'), 'utf-8');
hasNot(designSrc, '#FFF', 'design.ets 无 #FFF 字面量');
// 用正则式（避免把本条断言自身的字面量算进去）
ok('design.ets 无 #RRGGBB 字面量', !/#[0-9a-fA-F]{6}\b/.test(designSrc));
hasNot(designSrc, "from '@ohos", 'design.ets 不 import @ohos.*（core 纯 TS 铁律）');
hasNot(designSrc, 'Curve.', 'design.ets 不引用 ArkUI Curve');
hasNot(designSrc, 'FontWeight.', 'design.ets 不引用 ArkUI FontWeight（字重用数字）');

// ════════════════════════════════════════════════════════════════════════════
// J. 字面量棘轮（重新设计必须逐波清零；本测试保证**只减不增**）
// ════════════════════════════════════════════════════════════════════════════
// 现状基线（2026-10-11 实测）：components/ + pages/ 共 70 处 `borderRadius(<数字>)`。
// ⛔ 重构每拆掉一批就下调本上限；**上调即红**（防"边重构边新增字面量"）。
const RADIUS_LITERAL_MAX = 70;
function countMatches(dir: string, re: RegExp): number {
  let n = 0;
  const walk = (d: string): void => {
    let entries: string[] = [];
    try { entries = fsMod.readdirSync(d); } catch (e) { return; }
    for (const e of entries) {
      const full = pathMod.join(d, e);
      let st: { isDirectory(): boolean } | null = null;
      try { st = fsMod.statSync(full); } catch (err) { st = null; }
      if (st === null) { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (full.slice(full.length - 4) !== '.ets') { continue; }
      const src: string = fsMod.readFileSync(full, 'utf-8');
      const m = src.match(re);
      if (m) { n += m.length; }
    }
  };
  walk(dir);
  return n;
}
const radiusLiterals = countMatches(
  pathMod.join(etsDir, 'components'), /borderRadius\(\s*\d+\s*\)/g)
  + countMatches(pathMod.join(etsDir, 'pages'), /borderRadius\(\s*\d+\s*\)/g);
ok(`圆角字面量 ${radiusLiterals} ≤ 棘轮上限 ${RADIUS_LITERAL_MAX}（只减不增）`, radiusLiterals <= RADIUS_LITERAL_MAX);

// ════════════════════════════════════════════════════════════════════════════
// K. 工具/状态面 7 条缺口的收编断言（2026-10-11，来自 docs/mockups/03-tool-states.html）
// ════════════════════════════════════════════════════════════════════════════
// 1) 在飞"静态表达"（⛔ 不含动画）
eq('在飞 pill 面 = 提升一档（pillSelected）', INFLIGHT_PILL_SURFACE, 'surface.pillSelected');
eq('在飞柔影半径 12', INFLIGHT_PILL_GLOW_RADIUS, 12);
ok('在飞工具面不拥有任何在飞动效（owner 只是标记，不是 motion owner）',
  INFLIGHT_OWNER_PILL === 'pill' && motionRoles().filter((m: MotionRole) => m.owner === INFLIGHT_OWNER_PILL).length === 0);
for (const t of ALL_THEMES) {
  const p = paletteOf(t);
  ok(`[${t}] 在飞柔影可解析（静态色）`, inflightPillShadowOf(p).length > 0);
}
// 2) pill 自身内距 + 命中区外扩策略
eq('INSET_PILL_X = 8', INSET_PILL_X, 8);
eq('INSET_PILL_Y = 5（光学档）', INSET_PILL_Y, 5);
ok('光学档白名单含 5 且 5 不是 4 的倍数', opticalValues().indexOf(5) >= 0 && 5 % 4 !== 0);
ok('pill 视觉高度 < 命中区 44（须由调用方 responseRegion 外扩）',
  (MARKER_SLOT + 2 * INSET_PILL_Y) < HIT_TARGET_MIN);
// 3) 标记槽 / glyph 尺寸
eq('MARKER_SLOT = 14', MARKER_SLOT, 14);
eq('MARKER_GLYPH = 13', MARKER_GLYPH, 13);
eq('MARKER_GLYPH_DASHED = 12', MARKER_GLYPH_DASHED, 12);
eq('MARKER_SPINNER = 13', MARKER_SPINNER, 13);
eq('PILL_MAX_W = 240', PILL_MAX_W, 240);
// 4) 浮层阴影（语义出口，不再直接 effectsOf）
eq('阴影档名', [ELEV_CARD, ELEV_RAISED, ELEV_OVERLAY], ['elev1', 'elev2', 'elev3']);
eq('浮层面 ⇒ overlay 阴影档', elevationLevelOf('surface.overlay'), ELEV_OVERLAY);
eq('卡片面 ⇒ card 阴影档', elevationLevelOf('surface.card'), ELEV_CARD);
for (const t of ALL_THEMES) {
  const p = paletteOf(t);
  eq(`[${t}] elev1/2/3 均可解析`, [ELEV_CARD, ELEV_RAISED, ELEV_OVERLAY]
    .every((lv: string) => elevationColorOf(p, lv).length > 0), true);
}
// 5) 思考行 / 待办 / 目标条 的别名**必须**指向规范面/规范排版档（单一来源不破）
const canonicalSurfaceNames = surfaceRoles().map((s: SurfaceRole) => s.name);
const canonicalTypeNames = ty.map((t: TypeRole) => t.name);
for (const a of [SURFACE_THINKING, SURFACE_TODO, SURFACE_TODO_ACTIVE, SURFACE_GOAL, SURFACE_GOAL_BADGE, SURFACE_COMPOSER]) {
  ok(`面别名 ${a} ∈ 规范面`, canonicalSurfaceNames.indexOf(a) >= 0);
}
for (const a of [TYPE_THINKING, TYPE_TODO, TYPE_GOAL, TYPE_PILL_NAME, TYPE_CHIP]) {
  ok(`排版别名 ${a} ∈ 规范档`, canonicalTypeNames.indexOf(a) >= 0);
}
// 6) 纯白主题的层级下限（最小可辨差 + 何时补发丝）
eq('MIN_LEVEL_DELTA = 1.025', MIN_LEVEL_DELTA, 1.025);
eq('HAIRLINE_ASSIST_BELOW = 1.05', HAIRLINE_ASSIST_BELOW, 1.05);
ok('porcelain 的 pill↔chip 落在"需补发丝"区（1.037 < 1.05）', chipNeedsHairline(paletteOf(THEME_PORCELAIN)));
ok('light 的 pill↔chip 层级差达标', levelDeltaIssue(paletteOf(THEME_LIGHT), 'surface.pill', 'surface.chip') === '');
// 7) chip 唯一语义裁决：**恒 = 内嵌凹槽**，不随选中变化（消灭"选中对调"补丁）
for (const t of ALL_THEMES) {
  const p = paletteOf(t);
  eq(`[${t}] chip 与选中无关（恒 sunken）`,
    surfaceFillOf(p, 'surface.chip') === wellOf(p), true);
}

if (fail > 0) { console.log(`  design: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  design: ${pass} passed, 0 failed`);
process.exit(0);
