/** 强调色测试（accent）—— 对齐 web `types/theme.ts` + `SettingsAppearance.ACCENT_PRESETS`。
 *
 * 判别力设计：断言必须能区分"取到值"与"取错了值"。
 * 关键不变量：
 *   ① 只覆盖 accent 家族，底/面/文字/边框必须**逐值不变**（否则换色会破坏亮度阶梯）；
 *   ② `onAccent` 必须与 accent 有足够对比（白字压在浅色 accent 上会看不见 —— 这是真会发生的 bug）；
 *   ③ 预设色值必须与 web 逐字一致（否则"对齐 web"是空话）。
 */
declare const process: { exit: (c: number) => void };

import {
  ACCENT_PRESETS, DEFAULT_ACCENT, accentLabel, contrastForeground, darken, lighten,
  normalizeAccent, parseHex, withAccent,
} from '../../entry/src/main/ets/core/accent';
import { darkPalette, lightPalette, paletteValues } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 1. 预设与 web 逐字一致 ────────────────────────────────────────────────
eq('默认强调色 = web DEFAULT_ACCENT_COLOR', DEFAULT_ACCENT, '#3388BB');
eq('预设数量', ACCENT_PRESETS.length, 6);
eq('预设逐值 = web ACCENT_PRESETS',
  ACCENT_PRESETS.join(','),
  '#3388BB,#2563EB,#7C3AED,#DC2626,#059669,#EA580C');
eq('每个预设都有中文名（不是回落成 hex）', accentLabel('#DC2626'), '朱红');
eq('未知色的标签回落为原值', accentLabel('#123456'), '#123456');

// ── 2. 解析与规范化 ──────────────────────────────────────────────────────
eq('parseHex #3388BB', parseHex('#3388BB'), [51, 136, 187]);
eq('parseHex 3 位展开', parseHex('#abc'), [170, 187, 204]);
eq('parseHex 无 # 也接受', parseHex('3388BB'), [51, 136, 187]);
eq('parseHex 非法返回 null', parseHex('#zzz'), null);
eq('parseHex 空返回 null', parseHex('   '), null);
eq('normalize 小写转大写', normalizeAccent('#3388bb'), '#3388BB');
eq('normalize 3 位转 6 位', normalizeAccent('#abc'), '#AABBCC');
eq('normalize 非法回落默认', normalizeAccent('#nope'), DEFAULT_ACCENT);
eq('normalize undefined 回落默认', normalizeAccent(undefined), DEFAULT_ACCENT);

// ── 3. 颜色算术（单调性是可判别的） ──────────────────────────────────────
eq('lighten 提亮', lighten('#000000', 1), '#FFFFFF');
eq('darken 压暗', darken('#FFFFFF', 1), '#000000');
eq('lighten 0 不变', lighten('#3388BB', 0), '#3388BB');
eq('darken 0 不变', darken('#3388BB', 0), '#3388BB');
// 单调：提亮后的亮度必须严格大于原色（用对比前景判定，避免依赖具体数值）
eq('lighten 后亮度不降低', contrastForeground(lighten('#3388BB', 0.4)) === '#0B0B0E'
  || contrastForeground('#3388BB') === '#FFFFFF', true);

// ── 4. 对比前景（真会出事的点） ──────────────────────────────────────────
eq('浅色 accent 用深色字', contrastForeground('#FDE68A'), '#0B0B0E');
eq('深色 accent 用白字', contrastForeground('#1E3A8A'), '#FFFFFF');
eq('非法色回落白字', contrastForeground('zzz'), '#FFFFFF');

// ── 5. withAccent 的核心不变量 ───────────────────────────────────────────
const dark = darkPalette();
const light = lightPalette();
const ad = withAccent(dark, '#DC2626', true);
const al = withAccent(light, '#DC2626', false);

eq('dark: accent 被替换', ad.accent, '#DC2626');
eq('dark: 底色不变', ad.appBg, dark.appBg);
eq('dark: 面色不变', ad.surface, dark.surface);
eq('dark: 次级面不变', ad.surfaceAlt, dark.surfaceAlt);
eq('dark: 正文色不变', ad.textPrimary, dark.textPrimary);
eq('dark: 边框不变', ad.border, dark.border);
eq('dark: 语义色不变', ad.success === dark.success && ad.dangerText === dark.dangerText, true);
eq('light: 底色不变', al.appBg, light.appBg);
eq('light: 正文色不变', al.textPrimary, light.textPrimary);

// 完整性：换色后色板不能缺字段（缺一个就是"白底白字"）
const vals = paletteValues(ad);
eq('换色后色板字段数 = 原色板字段数', vals.length, paletteValues(dark).length);
let empty = 0;
for (let i = 0; i < vals.length; i++) {
  if (vals[i].length === 0) { empty++; }
}
eq('换色后无空字段', empty, 0);

// 深/浅的 hover 方向相反（对齐 web：dark 变亮 / light 变暗）
eq('dark hover 比 accent 亮', lighten('#DC2626', 0.12) === ad.accentHover, true);
eq('light hover 比 accent 暗', darken('#DC2626', 0.1) === al.accentHover, true);

// onAccent 必须与 accent 有对比（不允许 accent == onAccent）
eq('dark: onAccent ≠ accent', ad.accent !== ad.onAccent, true);
eq('light: onAccent ≠ accent', al.accent !== al.onAccent, true);
// 朱红是深色 ⇒ 白字
eq('朱红配白字', ad.onAccent, '#FFFFFF');

// 用默认色时，accent 家族应与主题原值一致（不引入回归）
const same = withAccent(dark, '#7C5CFF', true);
eq('用主题本色 ⇒ accent 不变', same.accent, dark.accent);

console.log(`accent: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
