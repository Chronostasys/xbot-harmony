/**
 * 「浅色投影变无投影」的**调用点契约**（`pages/Index.ets`）—— A 项收口靶子。
 *
 * 背景（判据来源）：
 *   · E2（`2b1fc5f`）判「浅色系不出辉光」⇒ `core/theme.ets` 浅色臂 `e.glow = p.transparent`
 *     （**对的**：宪法 `docs/REDESIGN.md §3.1` 明禁"白底彩色发光"）。
 *   · **但** `pages/Index.ets` 有 4 处把 `eff().glow` 当**投影(shadow)**用
 *     （旧行号 `core/theme.ets:813` 注释点名 `:3176/:3191/:3283/:3949` = 登录徽标 ×2 / 登录 CTA / 发送钮）
 *     ⇒ 浅色下这些点从"彩色脏光"变成"**完全没有投影**"，层次丢失。
 *   · 修法（`1e3856f`）：改走**投影唯一口径** `core/theme.ets: shadowColorOf(p, tier)`
 *     （深色 = `glow` **逐字节不变**；浅色 = `elev2`/`elev3` **真投影档**，非透明 + chroma 近中性）。
 *
 * 为什么是 `shadowColorOf` 而**不是** `elevationColorOf`（`core/design.ets`）：
 *   `elevationColorOf(p,'raised')` 的**深色臂返回 `elev2`**（设计系统 §4.4：抬升档）；
 *   而这 4 处在深色下**原本就是 `glow`（彩色发光）** ⇒ 改走它会**改变深色观感**（违"深色逐字节不变"）。
 *   `shadowColorOf` 的深色臂 = `glow`（逐字节），浅色臂 = `elev*` ⇒ **只有它在深色下等价**。
 *   （另一原因：`theme → design` 反向 import 会**成环**，故口径落在 `theme.ets`。）
 *
 * 判据（本文件）：
 *   ① **形态**：`Index.ets` 每一处 `.shadow(...)` 的**取色表达式**不得引用 `glow`（逐调用片段，⛔ 非宽 grep）；
 *      且 ≥4 处走 `shadowColorOf(this.pal(), 'raised')`。**零扫描判红**（找不到 `.shadow(` ⇒ 红）。
 *   ② **语义**：浅色族 ⇒ `shadowColorOf(p,'raised')` **非透明**且合成后 chroma 近中性；
 *      深色族 ⇒ 与 `effectsOf(p).glow` **逐字节相等**（= 旧观感）。
 *   ③ **装饰不误伤**：登录顶光晕（`glowSoft`）/ 空态星形圆光（`glow`）**仍走 `radialGradient`**（装饰，不在 `.shadow` 里）。
 *
 * mutation 自证（必红，已实测）：
 *   ① 把任一 `.shadow({… shadowColorOf …})` 改回 `this.eff().glow` ⇒ 【没有一处 .shadow 把 glow 当投影色】红；
 *   ② 把 `theme.ets` 浅色臂 `e.elev2` 改成 `p.transparent` ⇒ 【浅色投影非透明】红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { paletteOf, effectsOf, isLightPalette, shadowColorOf, ALL_THEMES } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

/** 剥注释（本仓约定：注释里记代码片段/色值是允许的 ⇒ 扫源码前必须先剥；保留换行 ⇒ 行号不漂移）。 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}

class ShadowSite {
  line: number = 0;
  arg: string = '';
}

/**
 * 抽取每一处 `.shadow(...)` 的**完整调用片段**（括号配平，含引号状态）。
 * ⛔ 不取整行、不宽 grep —— 只取调用片段，避免把邻近代码/注释误判（本仓 GOTCHA）。
 */
function shadowSites(src: string): ShadowSite[] {
  const out: ShadowSite[] = [];
  const OPEN: string = '.shadow(';
  let i = 0;
  while (true) {
    const k = src.indexOf(OPEN, i);
    if (k < 0) { break; }
    let j = k + OPEN.length;
    let depth = 1;
    let quote = '';
    while (j < src.length && depth > 0) {
      const ch = src.charAt(j);
      if (quote !== '') {
        if (ch === quote && src.charAt(j - 1) !== '\\') { quote = ''; }
      } else if (ch === "'" || ch === '"') {
        quote = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
      }
      j++;
    }
    let line = 1;
    for (let x = 0; x < k; x++) { if (src.charAt(x) === '\n') { line++; } }
    const s: ShadowSite = new ShadowSite();
    s.line = line;
    s.arg = src.substring(k, j);
    out.push(s);
    i = j;
  }
  return out;
}

function chan(hex: string): number[] {
  const h: string = hex.length === 9 ? hex.slice(3) : hex.slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function alphaOf(hex: string): number {
  return hex.length === 9 ? parseInt(hex.slice(1, 3), 16) / 255 : 1;
}
function nearNeutral(hex: string): boolean {
  const c = chan(hex);
  const max = Math.max(c[0], c[1], c[2]);
  return max === 0 || (max - Math.min(c[0], c[1], c[2])) / max < 0.03;
}
function compositeOver(fg: string, bg: string): string {
  const a = alphaOf(fg), f = chan(fg), b = chan(bg);
  const m = [0, 1, 2].map((i) => Math.round(a * f[i] + (1 - a) * b[i]));
  return '#' + m.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}

const fsMod = require('fs');
const pathMod = require('path');
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const cand = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/pages/Index.ets'))) { repo = cand; break; }
}
ok('探测到仓库根', repo.length > 0);

const indexSrc: string = repo.length > 0
  ? fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/pages/Index.ets'), 'utf-8')
  : '';
const code: string = stripSrc(indexSrc);   // 剥注释后用于断言（行号保留）

// ── ① 形态：每一处 `.shadow(...)` 的取色不得引用 glow；≥4 处走 shadowColorOf('raised') ──────────
{
  const sites = shadowSites(code);
  // 零扫描判红：抽取必须找得到调用（否则后面全"空过"= 白绿）
  ok(`零扫描判红：Index.ets 必须能定位 .shadow( 调用（找到 ${sites.length} 处）`,
    sites.length >= 6, `got ${sites.length}`);

  const glowSites = sites.filter((s) => s.arg.indexOf('glow') >= 0);
  ok('★ 没有一处 .shadow 把 glow 当投影色（浅色下 glow=transparent ⇒ 会"无投影"）',
    glowSites.length === 0,
    glowSites.length > 0 ? `违规行：${glowSites.map((s) => `:${s.line}`).join(', ')}` : '');

  const viaFn = sites.filter((s) => s.arg.indexOf("shadowColorOf(this.pal(), 'raised')") >= 0);
  ok(`★ 被改的 4 处投影走 shadowColorOf(p,'raised')（浅色真投影档 / 深色 glow 逐字节）（找到 ${viaFn.length} 处）`,
    viaFn.length >= 4,
    `got ${viaFn.length}；行：${viaFn.map((s) => `:${s.line}`).join(', ')}`);
}

// ── ② 语义：浅色 ⇒ 非透明 + 近中性；深色 ⇒ 逐字节 === glow ────────────────────────────────
{
  let lightSeen = 0, darkSeen = 0;
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    const c: string = shadowColorOf(p, 'raised');
    if (isLightPalette(p)) {
      lightSeen++;
      ok(`★ 浅色 ${t}: shadowColorOf(raised) **非透明**（否则就是"卡片没有阴影"）`,
        alphaOf(c) > 0, `got ${c}`);
      ok(`  · 合成后 chroma 近中性（投影不该是彩色辉光）`,
        nearNeutral(compositeOver(c, p.appBg)), `got ${compositeOver(c, p.appBg)}`);
    } else {
      darkSeen++;
      eq(`★ 深色 ${t}: shadowColorOf(raised) === effectsOf().glow（**逐字节不变**）`,
        c, effectsOf(p).glow);
    }
  }
  ok('浅色族样本非空（否则②全空过 = 白绿）', lightSeen > 0);
  ok('深色族样本非空', darkSeen > 0);
}

// ── ③ 装饰不误伤：登录顶光晕 / 空态星形圆光**仍走 radialGradient**（那是 (a) 装饰，浅色应保持不出）──
{
  const halo = "colors: [[this.eff().glowSoft, 0.0], [this.pal().transparent, 1.0]]";
  const star = "colors: [[this.eff().glow, 0.0], [this.pal().transparent, 1.0]]";
  ok('登录顶光晕仍是 radialGradient 装饰（glowSoft 中心 → 透明）', code.indexOf(halo) >= 0);
  ok('空态星形圆光仍是 radialGradient 装饰（glow 中心 → 透明）', code.indexOf(star) >= 0);
  // 这两处不在 `.shadow` 片段里（与①互补：装饰不算"当投影用"）
  const sites = shadowSites(code);
  const inShadow = sites.filter((s) => s.arg.indexOf(halo) >= 0 || s.arg.indexOf(star) >= 0);
  ok('上述两处装饰**不在** .shadow 内（装饰与投影语义不混）', inShadow.length === 0);
  ok('  · 装饰数量守恒：radialGradient 至少 2 处',
    (code.match(/radialGradient\(/g) || []).length >= 2);
}

// ── ④ 抽取函数判别力自证（防"假绿"：抽取/正则能否分辨 glow 与 shadowColorOf）─────────────────
{
  const bad = shadowSites(".shadow({ radius: 1, color: this.eff().glow })");
  ok('判别力：把 glow 当影的样本 ⇒ 被判出 1 处且含 glow',
    bad.length === 1 && bad[0].arg.indexOf('glow') >= 0);
  const good = shadowSites(".shadow({ radius: 1, color: shadowColorOf(this.pal(), 'raised') })");
  ok('判别力：shadowColorOf 样本 ⇒ 被判出 1 处且**不含** glow',
    good.length === 1 && good[0].arg.indexOf('glow') < 0);
  const nested = shadowSites(".shadow({ radius: shadowRadiusOf(this.pal(), 'hero'), color: shadowColorOf(this.pal(), 'raised'), offsetX: 0, offsetY: 10 })");
  ok('判别力：嵌套括号（shadowRadiusOf/shadowColorOf）能配平到调用末尾',
    nested.length === 1 && nested[0].arg.indexOf('offsetY: 10 })') >= 0);
  ok('判别力：剥注释后注释里的 .shadow(glow) 不误红',
    stripSrc("// .shadow({ color: this.eff().glow })").indexOf('.shadow(') < 0);
}

if (fail > 0) { console.log(`  porcelain_shadow_sites: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  porcelain_shadow_sites: ${pass} passed, 0 failed`);
process.exit(0);
