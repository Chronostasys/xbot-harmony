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
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;

import {
  APP_ICON_PX,
  BRAND_CANVAS,
  BUBBLE_X0, BUBBLE_X1, BUBBLE_Y0, BUBBLE_Y1,
  ICON_INSCRIBED_RADIUS,
  LAYERED_SAFE_RADIUS,
  START_ICON_PX,
  TAIL_TIP_ROUND, TAIL_TIP_X, TAIL_TIP_Y,
  appIconSvg,
  brandAccent,
  brandOnAccent,
  bubblePath,
  fitsInscribedCircle,
  fitsLayeredSafeZone,
  markBounds,
  markMaxRadius,
  splashMarkSvg,
  starPath,
} from '../../entry/src/main/ets/core/brand';
import { darkPalette, lightPalette } from '../../entry/src/main/ets/core/theme';

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

// ── 汇总 ────────────────────────────────────────────────────────────────────
if (fail > 0) { console.log(`  brand: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  brand: ${pass} passed, 0 failed`);
process.exit(0);
