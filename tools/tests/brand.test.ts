/**
 * 品牌门禁 —— `core/brand.ets` 的几何 / 配色 / 安全区 / **生成产物一致性**。
 *
 * 为什么必须有守护：
 *   · 品牌色/几何一旦脱离 token 或越出安全区，是"桌面图标被裁掉一角 / 开屏 logo 糊成一团"
 *     这类**只在真机才发现**的问题；
 *   · `start_icon.png` 是二进制 ⇒ 唯一能防"手改二进制导致与源漂移"的办法是：
 *     生成的 SVG 与已提交资源**逐字节比对**（本测试读回资源做断言）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
// ⚠️ 清扫记档（2026-10-11，扫源码不剥注释专项）：本文件读的是**生成资产**（`brand_*.svg` / `brand_*.png`
//    / `layered_image.json` 等**产物**），⛔ **不是源码** ⇒ 「剥注释」在这里不适用（强行剥会破坏
//    SVG/JSON 的**字节比对**语义）。⇒ **有意不套 `stripSrc`**；判据的"锚点"是**字节相等**，不是文本匹配。

declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;

import {
  APP_ICON_PX,
  BRAND_CANVAS,
  BUBBLE_X0, BUBBLE_X1, BUBBLE_Y0, BUBBLE_Y1,
  BrandSurface,
  ICON_INSCRIBED_RADIUS,
  LAYERED_SAFE_RADIUS,
  MARK_GRAPHIC_MIN_RATIO,
  MARK_LADDER_FULL,
  MARK_LADDER_OUTLINE,
  MARK_LADDER_SOLID,
  MARK_LADDER_WORDMARK,
  MARK_MIN_GLYPH_VP,
  OUTLINE_STROKE_W,
  START_ICON_PX,
  SUGGESTED_MAX_RADIUS,
  TAIL_TIP_ROUND, TAIL_TIP_X, TAIL_TIP_Y,
  appIconSvg,
  brandAccent,
  brandAccentFor,
  brandOnAccent,
  brandOnAccentFor,
  bubblePath,
  contrastRatio,
  fitsInscribedCircle,
  fitsLayeredSafeZone,
  foregroundFitsLayeredSafeZone,
  foregroundMarkMaxRadius,
  layeredBackgroundSvg,
  layeredForegroundScale,
  layeredForegroundSvg,
  markBounds,
  markLadder,
  markLevelFor,
  markMaxRadius,
  outlineMarkSvg,
  outlineMaxRadius,
  relativeLuminance,
  splashMarkSvg,
  starPath,
} from '../../entry/src/main/ets/core/brand';
import { darkPalette, lightPalette, porcelainPalette, isLightPalette } from '../../entry/src/main/ets/core/theme';

const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** WCAG 2.1 相对亮度。 */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.substring(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const ACCENT = brandAccent();
const ON_ACCENT = brandOnAccent();

// ── ① 配色：只从 token 取（无字面量漂移）──────────────────────────────────────
{
  eq('品牌主色 == darkPalette().accent（逐字）', ACCENT, darkPalette().accent);
  eq('标记反色 == darkPalette().onAccent（逐字）', ON_ACCENT, darkPalette().onAccent);
  eq('品牌主色字面量（契约钉死）', ACCENT, '#7C5CFF');
}

// ── ② 对比度：标记在浅/深两种开屏底色上都够看 ─────────────────────────────
{
  const lightBg = lightPalette().appBg;   // #F8FAFC（开屏浅色变体）
  const darkBg = darkPalette().appBg;     // #0B0B0E（开屏深色变体）
  const cl = contrast(ACCENT, lightBg);
  const cd = contrast(ACCENT, darkBg);
  ok(`主色 vs 浅底对比度 ≥ 3:1（实得 ${cl.toFixed(2)}:1）`, cl >= 3.0);
  ok(`主色 vs 深底对比度 ≥ 3:1（实得 ${cd.toFixed(2)}:1）`, cd >= 3.0);
  // 白星在紫气泡里（图形）：白 vs 主色。实测 4.35:1 —— 图形阈值 3:1 富余，但**不到** AA 正文 4.5:1
  // （星芒是图形不是文字 ⇒ 按 WCAG 1.4.11 非文本对比度 3:1 判）。
  const cStar = contrast(ON_ACCENT, ACCENT);
  ok(`反色 vs 主色对比度 ≥ 3:1（图形阈值；实得 ${cStar.toFixed(2)}:1）`, cStar >= 3.0);
}

// ── ③ 几何：安全区（不被圆形/分层蒙版裁坏）──────────────────────────────────
{
  eq('画布 = 1024', BRAND_CANVAS, 1024);
  eq('启动器图标源尺寸 = 1024', APP_ICON_PX, 1024);
  eq('开屏标记尺寸 = 512', START_ICON_PX, 512);
  eq('内切圆半径 = 512', ICON_INSCRIBED_RADIUS, 512);

  const r = markMaxRadius();
  ok(`标记最大半径 < 内切圆半径（圆/方/圆角蒙版都不裁） 实得 ${r.toFixed(1)}`,
    r < ICON_INSCRIBED_RADIUS, `r=${r}`);
  ok('标记最大半径由尾巴尖主导（≈394）', Math.abs(r - 393.9) < 3, `r=${r}`);
  ok('圆形蒙版安全', fitsInscribedCircle());
  // 分层图标前景安全区（108dp 里的 66dp）—— 当前**单层**图标不依赖它；这里把结论钉死：
  // 一旦有人把图标改成分层，这条会提醒"前景必须缩进安全区"。
  ok('分层安全区：当前设计**未**满足（已知，需分层时缩进前景）', !fitsLayeredSafeZone());
  ok(`分层安全区半径常量 = 313（66/108×1024）`, Math.abs(LAYERED_SAFE_RADIUS - 313) <= 1);

  const b = markBounds();
  eq('包围盒 x0', b.x0, BUBBLE_X0);
  eq('包围盒 x1', b.x1, BUBBLE_X1);
  eq('包围盒 y0', b.y0, BUBBLE_Y0);
  eq('包围盒 y1（尾巴尖）', b.y1, TAIL_TIP_Y);
  ok('左右边距对称', (BUBBLE_X0 - 0) === (BRAND_CANVAS - BUBBLE_X1), `${BUBBLE_X0} vs ${BRAND_CANVAS - BUBBLE_X1}`);
}

// ── ④ path 生成：确定性 + 圆角尾 + 螺旋不变式 ─────────────────────────────────
{
  const p1 = bubblePath(), p2 = bubblePath();
  eq('bubblePath 幂等（同输入同串）', p1, p2);
  const s1 = starPath(), s2 = starPath();
  eq('starPath 幂等', s1, s2);
  ok('尾巴尖已倒圆（TAIL_TIP_ROUND>0 ⇒ 尾巴段含 Q）', TAIL_TIP_ROUND > 0 && p1.indexOf('Q') >= 0);
  ok('气泡含左右两个大圆角弧（A 148 148）', (p1.match(/A 148 148/g) || []).length === 4);
  ok('星芒是四段 Q（sparkle）', (s1.match(/Q/g) || []).length === 4);
  ok('path 以 M 起、Z 收（闭合）', p1.startsWith('M ') && p1.endsWith('Z'));
  ok('无未取整的浮点噪声（最多一位小数）', !/\d+\.\d{2,}/.test(p1 + s1), p1);
}

// ── ⑤ SVG：启动器图标（满幅）vs 开屏标记（透明底）────────────────────────────
{
  const icon = appIconSvg(ACCENT, ON_ACCENT);
  const splash = splashMarkSvg(ACCENT, ON_ACCENT);

  ok('图标 = 1024 画布', icon.indexOf('width="1024" height="1024"') >= 0 && icon.indexOf('viewBox="0 0 1024 1024"') >= 0);
  ok('图标：满幅底色 rect', icon.indexOf('<rect x="0" y="0" width="1024" height="1024"') >= 0);
  ok('开屏标记 = 512 画布', splash.indexOf('width="512" height="512"') >= 0 && splash.indexOf('viewBox="0 0 1024 1024"') >= 0);
  ok('开屏标记：**无**底色 rect（透明底，背景由 startWindowBackground 给）', splash.indexOf('<rect') < 0);
  ok('两份都含气泡 + 星芒两条 path', (icon.match(/<path /g) || []).length === 2 && (splash.match(/<path /g) || []).length === 2);

  // ⛔ 配色纪律：SVG 里出现的六位十六进制**只能**是两个 token 值
  const hexes = (icon.match(/#[0-9A-Fa-f]{6}/g) || []);
  const uniq: string[] = [];
  for (let i = 0; i < hexes.length; i++) { if (uniq.indexOf(hexes[i]) < 0) { uniq.push(hexes[i]); } }
  uniq.sort();
  const want: string[] = [ACCENT, ON_ACCENT].sort();
  eq('SVG 只出现两个 token 色（无自造色）', uniq, want);
  ok('未用渐变/滤镜（渲染器风险）', icon.indexOf('url(') < 0 && icon.indexOf('<filter') < 0 && icon.indexOf('Gradient') < 0);

  eq('appIconSvg 幂等', appIconSvg(ACCENT, ON_ACCENT), icon);
  eq('splashMarkSvg 幂等', splashMarkSvg(ACCENT, ON_ACCENT), splash);
}

// ── ⑥ 生成产物一致性（防"手改二进制 / 与源漂移"）────────────────────────────
{
  const repo = path.resolve(__dirname, '../../../..');
  const iconSvg = path.join(repo, 'entry/src/main/resources/base/media/app_icon.svg');
  const appScopeSvg = path.join(repo, 'AppScope/resources/base/media/app_icon.svg');
  const startPng = path.join(repo, 'entry/src/main/resources/base/media/start_icon.png');

  try {
    const want = appIconSvg(ACCENT, ON_ACCENT);
    const gotEntry = fs.readFileSync(iconSvg, 'utf8');
    const gotScope = fs.readFileSync(appScopeSvg, 'utf8');
    eq('entry app_icon.svg == 生成器输出', gotEntry, want);
    eq('AppScope app_icon.svg == 生成器输出（两份同源）', gotScope, want);
  } catch (e) {
    ok('读取 app_icon.svg 失败（应存在）', false, (e as Error).message);
  }

  try {
    const buf: any = fs.readFileSync(startPng);
    // PNG IHDR: 8 字节签名 + 4 长度 + 4 类型 + 宽(4) 高(4)
    const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
    const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    ok('start_icon.png 是合法 PNG', isPng);
    eq('start_icon.png 宽 = 512', w, START_ICON_PX);
    eq('start_icon.png 高 = 512', h, START_ICON_PX);
    ok('start_icon.png 带 alpha（透明底）', buf[25] === 6, `colorType=${buf[25]}`);
  } catch (e) {
    ok('读取 start_icon.png 失败（应存在）', false, (e as Error).message);
  }
}

// ── ⑦ 对比度口径自洽（brand.ets 的纯函数 == 本测试的本地实现）──────────────────
{
  ok('relativeLuminance 白 = 1', Math.abs(relativeLuminance('#FFFFFF') - 1) < 1e-9);
  ok('relativeLuminance 黑 = 0', Math.abs(relativeLuminance('#000000') - 0) < 1e-9);

  const a: string = brandAccent();
  const lightBg: string = lightPalette().appBg;
  const darkBg: string = darkPalette().appBg;
  ok('contrastRatio 与本地实现逐值一致（浅底）',
    Math.abs(contrastRatio(a, lightBg) - contrast(a, lightBg)) < 1e-9,
    `${contrastRatio(a, lightBg)} vs ${contrast(a, lightBg)}`);
  ok('contrastRatio 与本地实现逐值一致（深底）',
    Math.abs(contrastRatio(a, darkBg) - contrast(a, darkBg)) < 1e-9);
  ok('8 位 ARGB 取末 6 位（#AARRGGBB）',
    Math.abs(relativeLuminance('#FF7C5CFF') - relativeLuminance('#7C5CFF')) < 1e-12);
  ok('非法输入不抛（按黑 0）', relativeLuminance('zzz') === 0);
}

// ── ⑦b 主题感知品牌色 `brandAccentFor`（2026-10-11 ①：白主题标记改用自己的 accent）─────
// 动机：`brandAccent()` = #7C5CFF 对纯白仅 4.35 < AA 文本线 4.5（mark 是"非文本"，但白主题
// 开屏/标记是"第一眼"面，且 porcelain 界面主色本就是 Apple Blue）⇒ 浅色面改用该主题的 accent。
// ⛔ 深色品牌主色 #7C5CFF 不动（brandAccent() 语义零改动，逐字节）。
{
  const dp = darkPalette();
  const pp = porcelainPalette();
  const lp = lightPalette();
  eq('dark ⇒ brandAccentFor = brandAccent() = #7C5CFF（深色语义不动）', brandAccentFor(dp), '#7C5CFF');
  eq('porcelain ⇒ brandAccentFor = 该主题 accent #0071E3（Apple Blue）', brandAccentFor(pp), '#0071E3');
  eq('porcelain ⇒ brandOnAccentFor = onAccent #FFFFFF', brandOnAccentFor(pp), '#FFFFFF');
  ok('porcelain 标记色对纯白 >= AA 文本线 4.5（旧 #7C5CFF 仅 4.35）',
    contrastRatio(brandAccentFor(pp), '#FFFFFF') >= 4.5,
    `got ${contrastRatio(brandAccentFor(pp), '#FFFFFF').toFixed(4)}`);
  ok('porcelain 标记色严格优于旧品牌紫（对白）',
    contrastRatio(brandAccentFor(pp), '#FFFFFF') > contrastRatio(brandAccent(), '#FFFFFF'));
  ok('light 主题 ⇒ 用该主题 accent，对自身画布 >= 4.5',
    brandAccentFor(lp) === lp.accent && contrastRatio(brandAccentFor(lp), lp.appBg) >= 4.5);
  ok('brandAccent() 语义零改动（对白仍 4.3461）',
    Math.abs(contrastRatio(brandAccent(), '#FFFFFF') - 4.3461) < 0.001);
  // 判据按色板亮度（不按主题名）：aurora/nebula 是深色面 ⇒ 仍走 brandAccent()
  ok('浅色判据 = isLightPalette（porcelain/light 为真，dark 为假）',
    isLightPalette(pp) && isLightPalette(lp) && !isLightPalette(dp));
}

// ── ⑧ 降级链（markLevelFor）—— 品牌呈现的**唯一判据** ─────────────────────────
{
  eq('链顺序 = 满幅→实心→轮廓→wordmark', markLadder(),
    [MARK_LADDER_FULL, MARK_LADDER_SOLID, MARK_LADDER_OUTLINE, MARK_LADDER_WORDMARK]);
  eq('深色面 ⇒ 满幅', markLevelFor(new BrandSurface(true, false, 512, 4.43)), MARK_LADDER_FULL);
  eq('浅色面（白主题）⇒ 实心标记', markLevelFor(new BrandSurface(false, false, 512, 4.20)), MARK_LADDER_SOLID);
  eq('单色/无障碍 ⇒ 轮廓', markLevelFor(new BrandSurface(false, true, 512, 4.20)), MARK_LADDER_OUTLINE);
  eq('对比不足（已测 <3）⇒ 轮廓', markLevelFor(new BrandSurface(false, false, 512, 2.5)), MARK_LADDER_OUTLINE);
  eq('边长过小（<24vp）⇒ wordmark', markLevelFor(new BrandSurface(true, false, 20, 4.43)), MARK_LADDER_WORDMARK);
  eq('边长未知（0）不降级', markLevelFor(new BrandSurface(false, false, 0, 4.20)), MARK_LADDER_SOLID);
  eq('对比未测（0）不降级', markLevelFor(new BrandSurface(true, false, 512, 0)), MARK_LADDER_FULL);
  // ⛔ 白色主题（浅色面）**永不**满幅色块（宪法 §3.1）
  const lv: string = markLevelFor(new BrandSurface(false, false, 512, 4.20));
  ok('浅色面绝不返回 full', lv !== MARK_LADDER_FULL, lv);
  ok('阈值常量 = 24vp / 3:1', MARK_MIN_GLYPH_VP === 24 && MARK_GRAPHIC_MIN_RATIO === 3.0);
}

// ── ⑨ 降级链资源：单色轮廓 / 分层前景 & 背景 ────────────────────────────────
{
  const outline: string = outlineMarkSvg(ACCENT);
  ok('轮廓：有品牌色描边', outline.indexOf(`stroke="${ACCENT}"`) >= 0);
  ok('轮廓：零填充（两条 path 各 fill="none"）', (outline.match(/fill="none"/g) || []).length === 2);
  ok('轮廓：零发光/零渐变（无 url(/filter/Gradient）',
    outline.indexOf('url(') < 0 && outline.indexOf('<filter') < 0 && outline.indexOf('Gradient') < 0);
  const oHex: string[] = [];
  const oMatches: string[] = (outline.match(/#[0-9A-Fa-f]{6}/g) || []);
  for (let i = 0; i < oMatches.length; i++) { if (oHex.indexOf(oMatches[i]) < 0) { oHex.push(oMatches[i]); } }
  eq('轮廓只出现一个 token 色（单色）', oHex, [ACCENT]);
  eq('轮廓幂等', outlineMarkSvg(ACCENT), outline);
  ok('描边居中 ⇒ 轮廓最大半径 = 几何半径 + 1/2 描边',
    Math.abs(outlineMaxRadius() - (markMaxRadius() + OUTLINE_STROKE_W / 2)) < 1e-9);
  ok(`轮廓不超"建议最大半径 ${SUGGESTED_MAX_RADIUS}"（实得 ${outlineMaxRadius().toFixed(1)}）`,
    outlineMaxRadius() <= SUGGESTED_MAX_RADIUS);

  // 分层前景：把标记缩进 313 安全区（当前几何 393.9 超界 ⇒ 必须缩）
  ok('分层前景缩放 < 1（标记原本超安全区）', layeredForegroundScale() < 1);
  ok(`分层前景半径 ≤ 安全区 ${LAYERED_SAFE_RADIUS}（实得 ${foregroundMarkMaxRadius().toFixed(1)}）`,
    foregroundFitsLayeredSafeZone());
  ok('分层前景半径 = 缩放 × 几何半径',
    Math.abs(foregroundMarkMaxRadius() - markMaxRadius() * layeredForegroundScale()) < 1e-9);
  const fg: string = layeredForegroundSvg(ACCENT, ON_ACCENT);
  ok('前景：含绕画布中心缩放的分组', fg.indexOf('translate(512 512) scale(') >= 0);
  ok('前景：气泡 + 星芒两条 path', (fg.match(/<path /g) || []).length === 2);
  ok('前景：无底色 rect（透明底，底色来自 background 层）', fg.indexOf('<rect') < 0);
  eq('前景幂等', layeredForegroundSvg(ACCENT, ON_ACCENT), fg);
  // ⛔ 分层可见性硬判据（真机事故回填）：前景气泡**不得**与背景层同色 ——
  // 背景层是满幅 `accent`；前景气泡若也取 `accent` ⇒ 桌面上气泡隐形，只剩星芒（品牌标记丢失）。
  const fgFills: string[] = fg.match(/fill="[^"]*"/g) || [];
  eq('前景恰好两个色（气泡 + 星芒）', fgFills.length, 2);
  eq('前景气泡 = 反色（与 appIconSvg glyph 层一致）', fgFills[0], `fill="${ON_ACCENT}"`);
  eq('前景星芒 = 主色', fgFills[1], `fill="${ACCENT}"`);
  ok('前景气泡色 ≠ 背景层色（否则桌面图标上气泡隐形）', fgFills[0] !== `fill="${ACCENT}"`);
  const bg: string = layeredBackgroundSvg(ACCENT);
  ok('背景：满幅色底 rect', bg.indexOf('<rect x="0" y="0" width="1024" height="1024"') >= 0);
  eq('背景只出现主色', (bg.match(/#[0-9A-Fa-f]{6}/g) || []), [ACCENT]);
  eq('背景幂等', layeredBackgroundSvg(ACCENT), bg);
}

// ── ⑩ 生成产物一致性（降级链 3 资源：entry + AppScope 两侧 + 分层描述符）─────────
{
  const repo = path.resolve(__dirname, '../../../..');
  const entryMedia = path.join(repo, 'entry/src/main/resources/base/media');
  const scopeMedia = path.join(repo, 'AppScope/resources/base/media');

  // entry 侧：全部 3 个降级链资源
  const entryCases: string[][] = [
    ['brand_mark_outline.svg', outlineMarkSvg(ACCENT)],
    ['brand_foreground.svg', layeredForegroundSvg(ACCENT, ON_ACCENT)],
    ['brand_background.svg', layeredBackgroundSvg(ACCENT)],
  ];
  for (let i = 0; i < entryCases.length; i++) {
    try {
      const got: string = fs.readFileSync(path.join(entryMedia, entryCases[i][0]), 'utf8');
      eq(`entry/${entryCases[i][0]} == 生成器输出`, got, entryCases[i][1]);
    } catch (e) {
      ok(`读取 entry/${entryCases[i][0]} 失败（应存在）`, false, (e as Error).message);
    }
  }

  // AppScope 侧：分层前景/背景（`layered_image.json` 引用的是 AppScope 的 $media）
  // —— 与 entry 侧**由同一真源生成、逐字节相同**（两份不一致 = 桌面图标前景/背景打架）。
  const scopeCases: string[][] = [
    ['brand_foreground.svg', layeredForegroundSvg(ACCENT, ON_ACCENT)],
    ['brand_background.svg', layeredBackgroundSvg(ACCENT)],
  ];
  for (let i = 0; i < scopeCases.length; i++) {
    try {
      const got: string = fs.readFileSync(path.join(scopeMedia, scopeCases[i][0]), 'utf8');
      eq(`AppScope/${scopeCases[i][0]} == 生成器输出（与 entry 侧同源）`, got, scopeCases[i][1]);
    } catch (e) {
      ok(`读取 AppScope/${scopeCases[i][0]} 失败（应存在）`, false, (e as Error).message);
    }
  }

  // 分层描述符（静态资源，不被引用时惰性；引用的 $media 名不得与生成器产出一致性脱钩）
  try {
    const li: string = fs.readFileSync(path.join(scopeMedia, 'layered_image.json'), 'utf8');
    ok('layered_image.json 有 "layered-image" 包裹', li.indexOf('"layered-image"') >= 0);
    ok('layered_image.json 背景指向 $media:brand_background', li.indexOf('$media:brand_background') >= 0);
    ok('layered_image.json 前景指向 $media:brand_foreground', li.indexOf('$media:brand_foreground') >= 0);
  } catch (e) {
    ok('读取 AppScope/.../layered_image.json 失败（应存在）', false, (e as Error).message);
  }
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
if (fail > 0) { console.log(`  brand: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  brand: ${pass} passed, 0 failed`);
process.exit(0);

export {};
