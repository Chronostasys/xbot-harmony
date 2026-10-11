/**
 * `contrastRatio` / `relativeLuminance` 的**单一源 + 契约**判据（2026-10-11 收敛）。
 *
 * 背景：`brand.ets` 原**复制**了一份实现（与 `theme.ets` 公式等价 —— 双方独立比对均判等价；本轮
 * **11 处采样 0 不一致**实证，含 8 位 `#AARRGGBB` 与非法输入）⇒ 已收敛为**复用 `./theme`**。
 * `brand → theme` 单向（theme 不 import brand）⇒ 无环。
 *
 * ⚠️ **契约（⛔ 不许静默改语义）**：**非法输入 ⇒ 不抛、按黑(0)**（`brand.ets` 原注释的明文契约）。
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { contrastRatio, relativeLuminance } from '../../entry/src/main/ets/core/theme';
import { contrastRatio as brandCR, relativeLuminance as brandRL } from '../../entry/src/main/ets/core/brand';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

// ── ★① 单一源：只有 theme 定义，brand 只**再导出** ───────────────────────────────────
{
  const fsMod = require('fs');
  const pathMod = require('path');
  let repo = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const cand = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/core/brand.ets'))) { repo = cand; break; }
  }
  ok('探测到仓库根', repo.length > 0);
  if (repo.length > 0) {
    const strip = (x: string): string => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const define = (rel: string, name: string): number => {
      const src: string = strip(fsMod.readFileSync(pathMod.join(repo, rel), 'utf-8'));
      return src.indexOf(`export function ${name}(`) >= 0 ? 1 : 0;
    };
    const defs: number = define('entry/src/main/ets/core/theme.ets', 'contrastRatio')
      + define('entry/src/main/ets/core/theme.ets', 'relativeLuminance')
      + define('entry/src/main/ets/core/brand.ets', 'contrastRatio')
      + define('entry/src/main/ets/core/brand.ets', 'relativeLuminance');
    eq('★① 定义点 == 2（theme 的 contrastRatio + relativeLuminance 各 1；brand 只再导出）', defs, 2);
    const brandSrc: string = strip(fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/brand.ets'), 'utf-8'));
    ok('  · brand 侧是 `export { … }` 再导出（不是复制）',
      brandSrc.indexOf('export { relativeLuminance, contrastRatio };') >= 0);
    ok('  · brand 从 ./theme 取（单向依赖，无环）',
      brandSrc.indexOf("import { Palette, darkPalette, isLightPalette, relativeLuminance, contrastRatio } from './theme';") >= 0);
  }
}

// ── ★② 契约：非法输入 ⇒ 不抛 + 按黑(0) ────────────────────────────────────────────
{
  let thrown: boolean = false;
  let v: number = -1;
  try { v = contrastRatio('#ZZZ', '#000000'); } catch (e) { thrown = true; }
  ok('★② 非法输入**不抛**', !thrown);
  eq('  · 且按黑(0)：contrastRatio(非法, 黑) == 1', v, 1);
  eq('  · brand 侧同契约（不抛 + 同值）', brandCR('#ZZZ', '#000000'), 1);
}

// ── ★③ 采样一致性：两侧**逐值相同**（含 8 位 #AARRGGBB）──────────────────────────────
{
  const S: string[] = ['#000000', '#FFFFFF', '#0B0B0E', '#7C5CFF', '#A2A2A7', '#F7F7F8',
    '#731D1D1F', '#CCFFFFFF', '#ZZZ', '', 'x', '#12345'];
  let diff: number = 0;
  for (let i = 0; i < S.length; i++) {
    if (Math.abs(contrastRatio(S[i], '#000000') - brandCR(S[i], '#000000')) > 1e-12) { diff++; }
    if (Math.abs(relativeLuminance(S[i]) - brandRL(S[i])) > 1e-12) { diff++; }
  }
  ok(`★③ 两侧采样全等（${S.length} 值 × 2 函数，实得不一致 ${diff}）`, diff === 0);
}

if (fail > 0) { console.log(`  brand_contrast_contract: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  brand_contrast_contract: ${pass} passed, 0 failed`);
process.exit(0);
