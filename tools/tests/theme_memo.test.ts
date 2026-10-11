/**
 * 主题记忆化（`core/theme.ets` 的 `paletteOf` / `effectsOf` / `surfacesOf`）判别力测试。
 *
 * 契约：**记忆化 = 纯缓存**（同一输入 ⇒ 同一输出；缓存命中与重新构造**逐字段等价**）。
 * 实测动机：`effectsOf` 2.1–3.3µs/次、`surfacesOf` 1.7–5.7µs/次（每次 new +
 * 十几次 `alphaHex` 合成），而 components/pages 的 build 路径有 17 处调用点。
 *
 * 四条断言：
 *   ① 同一输入 ⇒ 同一对象（记忆化的定义；不记忆化则必红）
 *   ② **纯缓存等价**：用"新建的 Palette"（不同对象标识 ⇒ 缓存未命中 ⇒ 真算一遍）
 *      与缓存值逐字段比较 —— 这是"缓存不会给出与现算不同的结果"的证明
 *   ③ 不串味：不同主题的 palette/effects/surfaces 互不相同
 *   ④ 有界：拿不到源码里的一次性键时，缓存不得无界增长（`themeMemoStats`）
 */
declare const process: { exit: (c: number) => void };

import {
  paletteOf, effectsOf, surfacesOf, themeMemoStats,
  Palette, Effects, Surfaces, ThemeMemoStats,
  THEME_DARK, THEME_LIGHT, THEME_AURORA, THEME_NEBULA, THEME_PORCELAIN,
} from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
/** 逐字段浅拷贝（值都是 string/number）—— 造一个"同值但不同对象标识"的 Palette。 */
function clonePalette(src: Palette): Palette {
  const out: Palette = new Palette();
  const from: Record<string, string> = src as unknown as Record<string, string>;
  const to: Record<string, string> = out as unknown as Record<string, string>;
  for (const k of Object.keys(from)) {
    to[k] = from[k];
  }
  return out;
}

const THEMES: string[] = [THEME_DARK, THEME_LIGHT, THEME_AURORA, THEME_NEBULA, THEME_PORCELAIN];

// ── ① 同一输入 ⇒ 同一对象 ─────────────────────────────────────────────────────
console.log('── ① 同一输入 ⇒ 同一对象（记忆化的定义）──');
for (const t of THEMES) {
  ok(`paletteOf(${t}) 两次调用是同一对象`, paletteOf(t) === paletteOf(t));
}
const pDark: Palette = paletteOf(THEME_DARK);
ok('effectsOf(同一 Palette) 两次调用是同一对象', effectsOf(pDark) === effectsOf(pDark));
ok('surfacesOf(同一 Palette) 两次调用是同一对象', surfacesOf(pDark) === surfacesOf(pDark));

// ── ② 纯缓存等价（最强守护）──────────────────────────────────────────────────
// 关键技巧：`clonePalette()` 造出**不同对象标识** ⇒ `effectsOf` 缓存**未命中** ⇒ 真的重算一遍。
// 于是可以断言"缓存给的值"与"现算的值"逐字段相同（= 缓存没有改变语义）。
console.log('── ② 缓存值 == 现算值（用新建 Palette 绕过缓存）──');
for (const t of THEMES) {
  const memoizedP: Palette = paletteOf(t);
  const freshP: Palette = clonePalette(memoizedP);
  ok(`paletteOf(${t}) 返回对象与新建副本**不是**同一对象（对照前提）`, memoizedP !== freshP);
  eq(`effectsOf 缓存值 == 现算值（${t}）`, JSON.stringify(effectsOf(memoizedP)), JSON.stringify(effectsOf(freshP)));
  eq(`surfacesOf 缓存值 == 现算值（${t}）`, JSON.stringify(surfacesOf(memoizedP)), JSON.stringify(surfacesOf(freshP)));
}
// 未命中后**再次**同一新对象 ⇒ 命中，且仍是同一值
const probe: Palette = clonePalette(paletteOf(THEME_LIGHT));
const e1: Effects = effectsOf(probe);
ok('新建 Palette 首次未命中、二次即命中同一对象', effectsOf(probe) === e1);

// ── ③ 不串味：不同主题互不相同 ────────────────────────────────────────────────
console.log('── ③ 不串味：跨主题互不相同 ──');
const seen: Record<string, number> = {};
let dup = 0;
for (const t of THEMES) {
  const key: string = JSON.stringify(paletteOf(t));
  if (seen[key] !== undefined) {
    dup++;
  }
  seen[key] = 1;
}
eq('5 个内置主题的 Palette 两两不同', dup, 0);
const effKeys: string[] = [];
for (const t of THEMES) {
  effKeys.push(JSON.stringify(effectsOf(paletteOf(t))));
}
ok('5 个内置主题的 Effects 两两不同（无跨主题串味）', new Set(effKeys).size === THEMES.length);
eq('dark 与 light 的 appBg 不同（最基本的对照）',
  paletteOf(THEME_DARK).appBg !== paletteOf(THEME_LIGHT).appBg, true);

// ── ④ 有界：拿不到一次性键时，缓存不得无界增长 ────────────────────────────────
console.log('── ④ 缓存有界（一次性键不得撑爆 Map）──');
for (let i = 0; i < 200; i++) {
  effectsOf(clonePalette(pDark));      // 每次都是新对象标识 = 一次性键
  surfacesOf(clonePalette(pDark));
}
const st: ThemeMemoStats = themeMemoStats();
ok(`effects 缓存条目有界（${st.effects} ≤ 64）`, st.effects <= 64);
ok(`surfaces 缓存条目有界（${st.surfaces} ≤ 64）`, st.surfaces <= 64);
ok(`palette 缓存条目有界（${st.palettes} ≤ 64）`, st.palettes <= 64);
ok('缓存被清空后仍能正确重算（清空不影响语义）', paletteOf(THEME_DARK).appBg === pDark.appBg);
eq('清空后 effectsOf 仍与现算等价', JSON.stringify(effectsOf(paletteOf(THEME_DARK))),
  JSON.stringify(effectsOf(clonePalette(paletteOf(THEME_DARK)))));

// ── ⑤ 判别力自证：同一断言打在"不记忆化"的参照实现上**必须**判红 ──────────────
// 真正的 mutation 是"把 paletteOf 的缓存去掉"（已在交付里给出复现命令）。这里用等价手段
// 在测试内证明：`①` 用到的判据**不是恒真**的 —— 不记忆化时它必然为 false。
console.log('── ⑤ 判别力自证（不记忆化的参照实现必须判红）──');
function noMemoPalette(theme: string): Palette {
  return clonePalette(paletteOf(theme));      // 每次新对象 = 不记忆化
}
ok('参照实现（不记忆化）在"同一对象"判据上**判红**', !(noMemoPalette(THEME_DARK) === noMemoPalette(THEME_DARK)));
ok('真实实现（记忆化）在同一判据上**判绿**', paletteOf(THEME_DARK) === paletteOf(THEME_DARK));

if (fail > 0) {
  console.log(`  theme_memo: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  theme_memo: ${pass} passed, 0 failed`);
