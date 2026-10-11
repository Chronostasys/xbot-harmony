/**
 * orb_porcelain_motion —— 光球白主题「零彩色发光」核验 + 动效底座档位清单（波2 · 本名领域）。
 *
 * ── 两条独立核验（一为真值、一为源码形态）─────────────────────────────────────
 *  B. **porcelain（原生独享白主题）「零彩色发光」**：用 `colorOf(paletteOf('porcelain'), role)`
 *     与 `inflightHaloOf()` **实调**证明光球的**外光晕**在浅色面落**中性柔影** `elev2`
 *     （= `#1A1D1D1F` = `textPrimary@10%`），而**不是**彩色 `glow`（= `accent@45%` = `#730071E3`）。
 *     + porcelain 的**静态可辨性**事实：`statusRunning ≡ accent ≡ #0071E3` ⇒ 颜色维度静帧
 *     不可辨 ⇒ 唯一非颜色维度是"细环强度"（`docs/mockups/porcelain.html` 面 ⑤）。
 *  C. **动效底座「唯一曲线出口」铁律**：全 `entry/src/main/ets` 里**只有**
 *     `components/anim.ets` import `@ohos/curves`（`core/motion.ets` 保持纯 TS、可脱机单测）。
 *     + 打印**全部实际存在的时长/缓动档位**（供 `docs/SPLASH-SPEC.md` 取用；审计**只报不造**）。
 *
 * ⚠️ 判别力自证（改错必红）：
 *   · 把 `core/design.ets:inflightHaloOf` 的浅色分支从 `elev2` 改回 `glow` ⇒ B 组"浅色 ⇒ elev2"红；
 *   · 在任一**其它**文件写 `import ... '@ohos/curves'` ⇒ C 组"只有 anim.ets"红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 * ⚠️ `export {}` 让本文件成为 module（顶层 declare 收进模块作用域，免与兄弟测试撞名）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(m: 'path'): { join(...parts: string[]): string; basename(p: string): string };
declare const __dirname: string;

import {
  colorOf, inflightHaloOf, elevationColorOf, ELEV_RAISED, allowedDurations, motionRoles,
} from '../../entry/src/main/ets/core/design';
import { paletteOf, effectsOf, isLightPalette, ALL_THEMES } from '../../entry/src/main/ets/core/theme';
import {
  MOTION_FAST_MS, MOTION_BASE_MS, MOTION_MSG_IN_MS, MOTION_SLOW_MS,
} from '../../entry/src/main/ets/core/motion';
import { ORB_BREATH_MS, ORB_SPIN_MS } from '../../entry/src/main/ets/core/orb';
import { D_FAST, D_BASE, D_SLOW } from '../../entry/src/main/ets/core/tokens';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ════════════════════════════════════════════════════════════════════════════
// B. porcelain「零彩色发光」—— **实调** colorOf / inflightHaloOf
// ════════════════════════════════════════════════════════════════════════════
const P = paletteOf('porcelain');

console.log('\n▶ B. porcelain 角色实测（colorOf(paletteOf(\'porcelain\'), role)）');
const roles: string[] = [
  'appBg', 'surface', 'accent', 'accentSoft', 'accentText', 'statusRunning',
  'textPrimary', 'textSecondary', 'textMuted', 'border', 'hairline', 'inflightHalo',
];
for (let i = 0; i < roles.length; i++) {
  console.log(`     ${roles[i]} = ${colorOf(P, roles[i])}`);
}
console.log(`     effectsOf.elev2 = ${effectsOf(P).elev2}    effectsOf.glow = ${effectsOf(P).glow}`);

// 光球外光晕 = `inflightHaloOf`（`core/design.ets:511`）：浅色 ⇒ elev2、深色 ⇒ glow。
eq('porcelain 光晕 = 中性柔影 elev2 = #1A1D1D1F（textPrimary@10%）', inflightHaloOf(P), '#1A1D1D1F');
eq('porcelain 彩色 glow = accent@45% = #730071E3（**光球不用它**）', effectsOf(P).glow, '#730071E3');
ok('porcelain 光晕 ≠ 彩色 glow（零彩色发光）', inflightHaloOf(P) !== effectsOf(P).glow);
eq('colorOf(P,\'inflightHalo\') === inflightHaloOf(P)（取色唯一入口同源）',
  colorOf(P, 'inflightHalo'), inflightHaloOf(P));
eq('elevationColorOf(P, ELEV_RAISED) === elev2（语义出口同源）',
  elevationColorOf(P, ELEV_RAISED), effectsOf(P).elev2);
// 分叉判据必须按**色板亮度**（浅色一律 elev2；深色一律 glow）
for (let i = 0; i < ALL_THEMES.length; i++) {
  const t: string = ALL_THEMES[i];
  const p = paletteOf(t);
  if (isLightPalette(p)) {
    ok(`${t}: 浅色 ⇒ inflightHalo = elev2 中性（非彩色 glow）`,
      inflightHaloOf(p) === effectsOf(p).elev2 && inflightHaloOf(p) !== effectsOf(p).glow);
  } else {
    ok(`${t}: 深色 ⇒ inflightHalo = glow 彩色外发光`, inflightHaloOf(p) === effectsOf(p).glow);
  }
}
// 静态可辨性事实（porcelain）：颜色维度不可辨 ⇒ 唯一非颜色维度 = 细环强度（样张面 ⑤）
eq('porcelain statusRunning ≡ accent（均 #0071E3）⇒ 颜色维度静帧不可辨',
  colorOf(P, 'statusRunning'), colorOf(P, 'accent'));

// ════════════════════════════════════════════════════════════════════════════
// C. 动效底座：档位清单（只打印，供 SPLASH-SPEC 取用）+ 唯一曲线出口
// ════════════════════════════════════════════════════════════════════════════
console.log('\n▶ C. 动效时长 / 缓动档位清单（audit for docs/SPLASH-SPEC.md）');
console.log(`     core/tokens.ets    D_FAST=${D_FAST}  D_BASE=${D_BASE}  D_SLOW=${D_SLOW}`);
console.log(`     core/motion.ets    MOTION_FAST_MS=${MOTION_FAST_MS}  MOTION_MSG_IN_MS=${MOTION_MSG_IN_MS}`
  + `  MOTION_BASE_MS=${MOTION_BASE_MS}  MOTION_SLOW_MS=${MOTION_SLOW_MS}`);
console.log(`     core/orb.ets       ORB_BREATH_MS=${ORB_BREATH_MS}（8×D_SLOW）  ORB_SPIN_MS=${ORB_SPIN_MS}（20×D_SLOW）`);
const allowed: number[] = allowedDurations();
console.log(`     design.allowedDurations() = [${allowed.join(', ')}]`);
const RS = motionRoles();
for (let i = 0; i < RS.length; i++) {
  console.log(`       ${RS[i].name} = ${RS[i].ms}ms  curve=${RS[i].curve}`
    + `  inFlight=${RS[i].inFlight}  owner=${RS[i].owner}`);
}

// 稳定不变量（加档不会红）：严格递增、全为正；在飞 owner 唯一
let mono = true;
for (let i = 1; i < allowed.length; i++) { if (!(allowed[i] > allowed[i - 1])) { mono = false; } }
ok('allowedDurations() 严格递增', mono);
ok('allowedDurations() 全为正', allowed.every((v) => v > 0));
let owners: string[] = [];
for (let i = 0; i < RS.length; i++) {
  if (RS[i].inFlight && owners.indexOf(RS[i].owner) < 0) { owners.push(RS[i].owner); }
}
eq('在飞角色的 owner 唯一（= orb）', owners, ['orb']);

// 「唯一曲线出口」铁律：全仓只有 components/anim.ets import @ohos/curves
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const ETS = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets');

/** 递归收集 .ets/.ts 源文件。 */
function walk(dir: string, out: string[]): void {
  const names: string[] = fsMod.readdirSync(dir);
  for (let i = 0; i < names.length; i++) {
    const p: string = pathMod.join(dir, names[i]);
    if (fsMod.statSync(p).isDirectory()) {
      walk(p, out);
    } else if (names[i].endsWith('.ets') || names[i].endsWith('.ts')) {
      out.push(p);
    }
  }
}
const srcFiles: string[] = [];
walk(ETS, srcFiles);
const curvesFiles: string[] = [];
for (let i = 0; i < srcFiles.length; i++) {
  // ⛔ 判据用 `import curves`（完整模块标识符会被沙箱隐去 ⇒ 搜完整串会恒 0 命中）
  if (fsMod.readFileSync(srcFiles[i], 'utf-8').indexOf('import curves') >= 0) {
    curvesFiles.push(pathMod.basename(srcFiles[i]));
  }
}
console.log(`     扫 ${srcFiles.length} 个源文件；含 'import curves' 的 = [${curvesFiles.join(', ')}]`);
eq('全仓只有 components/anim.ets 出现 import curves（唯一曲线出口）', curvesFiles, ['anim.ets']);

if (fail > 0) {
  console.log(`  orb_porcelain_motion: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  orb_porcelain_motion: ${pass} passed, 0 failed`);
process.exit(0);

export {};
