/**
 * 强调色叠加后的 `onAccent` 必须达 AA（`core/theme.ets: contrastForeground`）。
 *
 * 背景（tokens-ux 实测，2026-10-11）：旧实现用 **BT.601 `lum > 150` 二值阈值**选黑/白前景，
 * 而 BT.601 亮度与实际对比度**非线性** ⇒ 阈值附近会**选错候选**：强调色叠加后 `onAccent` 压
 * `accent` 有 **15 组**只有 **3.5–3.9**（例 `porcelain + #3388BB = 3.90`）。
 * 修法（本波）：改成**在"深/浅两候选"中取对比度更高者**（口径 = WCAG 相对亮度，由 `contrastRatio`
 * 实现，与全仓对比度判据**同源**）⇒ 数学上必为两候选最优解，且随 accent **连续**、无阈值跳变。
 * 候选与旧值**同色**（`#0B0B0E` / `#FFFFFF`）⇒ ⛔ 未新造色值，只改"怎么选"。
 *
 * ⚠️ `tools/tests/theme_contrast_matrix.test.ts`（tokens-ux 的**台账**）里 `KNOWN_BAD_ONACCENT_COUNT`
 *    记的正是这 15 组 —— **本修把它清成 0** ⇒ 那份台账的计数断言会红（"修好 ⇒ 计数变 ⇒ 红"，
 *    是其设计意图）。该文件归 tokens-ux，本波**不碰**，由主 agent 路由更新。
 *
 * mutation 自证（必红）：把 `contrastForeground` 改回 BT.601 二值 ⇒ ★①（porcelain+#3388BB ≥4.5）红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { paletteOf, withAccent, isLightPalette, contrastRatio, ALL_THEMES } from '../../entry/src/main/ets/core/theme';
import { AA_TEXT } from '../../entry/src/main/ets/core/design';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

/** tokens-ux 台账用的那 6 个强调色（覆盖蓝/紫/红/绿/橙，含点名的 `#3388BB`）。 */
const ACCENTS: string[] = ['#3388BB', '#2563EB', '#7C3AED', '#DC2626', '#059669', '#EA580C'];

// ── ★① 硬约束：**每个**主题 × 强调色 ⇒ `onAccent` 压 `accent` ≥ AA(4.5) ───────────────
{
  let worst = 99, worstN = '';
  let below = 0;
  for (let ti = 0; ti < ALL_THEMES.length; ti++) {
    const th: string = ALL_THEMES[ti];
    const base = paletteOf(th);
    const isDark: boolean = !isLightPalette(base);
    for (let ai = 0; ai < ACCENTS.length; ai++) {
      const p = withAccent(base, ACCENTS[ai], isDark);
      const r: number = contrastRatio(p.onAccent, p.accent);
      if (r < AA_TEXT) { below++; console.log(`      ${th}|${ACCENTS[ai]}|${r.toFixed(4)} ← 不达标`); }
      if (r < worst) { worst = r; worstN = `${th}|${ACCENTS[ai]}`; }
    }
  }
  ok(`★① 全 ${ALL_THEMES.length * ACCENTS.length} 组 onAccent×accent 全 ≥ ${AA_TEXT}（实得最差 ${worstN} = ${worst.toFixed(4)}）`,
    below === 0, `不达标 ${below} 组`);
}

// ── ★② 判别力：旧 BT.601 二值**必然判错**的那一组（porcelain + #3388BB = 3.90）────────
{
  const base = paletteOf('porcelain');
  // BT.601 二值：lum(#3388BB) = (51*299+136*587+187*114)/1000 = 116.0 ≤ 150 ⇒ 选白
  const lum: number = (0x33 * 299 + 0x88 * 587 + 0xBB * 114) / 1000;
  ok('判别力：BT.601 在 #3388BB 上会选**白**（lum ≤150）', lum <= 150);
  ok('  · 白压 #3388BB 只有 <4.5（旧实现的 3.90）', contrastRatio('#FFFFFF', '#3388BB') < AA_TEXT);
  ok('  · 黑压 #3388BB 却 ≥4.5 ⇒ **取更高者**才选对', contrastRatio('#0B0B0E', '#3388BB') >= AA_TEXT);
  const p = withAccent(base, '#3388BB', false);
  ok('★② 修后 porcelain + #3388BB 的 onAccent 压 accent ≥ 4.5', contrastRatio(p.onAccent, p.accent) >= AA_TEXT);
}

// ── ★③ 源码形态：口径在 theme.ets；⛔ 不得回退成 BT.601 二值；不新造色值 ────────────────
{
  const fsMod = require('fs');
  const pathMod = require('path');
  let repo = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const cand = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/core/theme.ets'))) { repo = cand; break; }
  }
  ok('探测到仓库根', repo.length > 0);
  if (repo.length > 0) {
    const src: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/theme.ets'), 'utf-8');
    // ⛔ 先剥注释再判：我在注释里**引用了**旧写法 `lum > 150`（本仓 GOTCHA：注释提及 ≠ 代码存在）
    const strip = (x: string): string =>
      x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const start: number = src.indexOf('export function contrastForeground(');
    const body: string = strip(src.substring(start, src.indexOf('\n}', start)));
    ok('contrastForeground 函数体可定位', body.length > 40);
    ok('★③ 不再出现 BT.601 的二值阈值 `lum > 150`', body.indexOf('lum > 150') < 0);
    ok('  走 contrastRatio 比两候选（WCAG 相对亮度口径）', body.indexOf('contrastRatio(') >= 0);
    ok('  两候选与旧值同色（#0B0B0E / #FFFFFF）⇒ 未新造色值',
      src.indexOf("FOREGROUND_CANDIDATE_DARK: string = '#0B0B0E'") >= 0 && body.indexOf("'#FFFFFF'") >= 0);
  }
}

if (fail > 0) { console.log(`  accent_foreground: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  accent_foreground: ${pass} passed, 0 failed`);
process.exit(0);
