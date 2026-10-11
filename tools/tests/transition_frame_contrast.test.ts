/**
 * transition_frame_contrast.test.ts —— **过渡帧可读性**审计（用户亲报"某一帧文字看不清"的动画面）。
 *
 * ── 与 ⑨ 的分工 ────────────────────────────────────────────────────────────────
 * ⑨（`tools/lint/anim-opacity-gate.sh`）管的是**静息态**被写成隐藏（**无界** ⇒ 永久看不清，已修）。
 * 本文件管**动画进行中的帧**（**有界**：最长 220ms）。问法：**是否存在某一帧 < 阈值**。
 *
 * ── 全仓过渡清单（**内容锚，⛔ 不写行号** —— 行号会漂：本仓 `haptics.test.ts` 已因行号硬编码全失效）──
 *  ① `anim.ets` 的 `sheetTransition()` = `translate(y:260, 220ms) ⊕ OPACITY(180ms)`
 *     —— 用在**面板/弹层容器**（grep 枚举，逐文件；⛔ 不记总数/行号）：
 *        `QueueSheet` · `SettingsPanel` · `PluginsSheet` · `MenuSheets`（3 处列表格）·
 *        `StatusSheet` · `AskUserSheet` · `Index.ets`（2 处浮层）
 *  ② `anim.ets` 的 `toastTransition()` = `translate(y:65, 220ms) ⊕ OPACITY(180ms)` —— `Toast.ets`（浮条容器）
 *  ③ `MessageRow.ets` 的 `this.entryTransition()` = `OPACITY ⊕ translate(y:4)`，`animMsgIn()` 200ms
 *  ④ `SplashOverlay.ets` 的 `animateTo(animEaseOut()/animBase()/animEaseOutDelayed())` →
 *     `markOpacity` / `markScale` / `markLift` / `hintOpacity` / `overlayOpacity`
 *  ⑤ `AssistantOrb.ets` 的 `animateTo(animBase())`（仅入场 scale/alpha，非文字层）
 *
 * ── 最坏帧模型（显式写出，⛔ 不藏假设）──────────────────────────────────────────
 *  · `.transition(TransitionEffect.OPACITY…)` 作用在**整个人层**上 ⇒ 该层以 α 合成到底上
 *    ⇒ 人层里的文字对底的有效对比度 = `contrastRatio(compositeOver(textPrimary@α, canvas), canvas)`。
 *  · α 取**进度 p 的线性映射**（α = p）。⚠️ 这是**保守**的：`sheetTransition` 的曲线是
 *    `Curve.Friction`（**系统 enum，离线不可求值**），其真实前段比线性**更快**；用线性 ⇒ 本文件
 *    算出的"最坏帧"是**下界**（只会更糟，不会更好）⇒ 结论方向安全。
 *  · **最坏帧恒在 p → 0**：任何从 α=0 起的淡入，首帧对比度 **= 1.00**（完全不可读）。
 *
 * ── 判据 ──────────────────────────────────────────────────────────────────────
 *  · **允许**（记为 `allowed`，须给理由）：过渡是**整层 reveal**（面板/toast/开屏到达中，用户尚未开始
 *    阅读），且**有界**（≤220ms）⇒ 首帧不可读可接受；静息态恒可读（fail-safe）。
 *  · **不足**（须 ≥ 地板）：若某过渡被标为 `content: true`（**动画期间内容就该被读懂**），
 *    则整个过渡窗口的**不透明度地板**必须让最坏帧 ≥ 4.5（正文档，`theme_contrast` 同源阈值）。
 *  ⇒ 本文件同时**推导**该地板并**守住**这条规则（mutation：把地板调成 0 ⇒ 必红）。
 */
declare const process: { exit: (c: number) => void };

import {
  Palette, paletteOf, ALL_THEMES, contrastRatio, compositeOver, isLightPalette, parseColorRgba,
} from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function pad(s: string, n: number): string { return (s + ' '.repeat(n)).slice(0, n); }
/** 把 0..1 的不透明度折进颜色（`#AARRGGBB`）。 */
function atAlpha(hex: string, a: number): string {
  const c: number[] = parseColorRgba(hex);
  const hx: string = '0123456789ABCDEF';
  const two = (v: number): string => `${hx.charAt(Math.floor(v / 16))}${hx.charAt(v % 16)}`;
  return `#${two(Math.round(Math.max(0, Math.min(1, a)) * 255))}${two(c[0])}${two(c[1])}${two(c[2])}`;
}
/** 正文在"整层 α"下的有效对比度。 */
function frameContrast(p: Palette, layerAlpha: number): number {
  return contrastRatio(compositeOver(atAlpha(p.textPrimary, layerAlpha), p.surface), p.surface);
}

/** 一个过渡（数据来自 §A 的 grep 枚举）。 */
class Tr {
  id: string = ''; where: string = ''; props: string = ''; ms: number = 0;
  /** true = 动画期间内容就该被读懂（⇒ 受地板判据管）；false = 整层 reveal（⇒ 允许） */
  content: boolean = false;
  /** 该过渡的**不透明度地板**（α=0 = 从全透明起淡入）。内容型必须 ≥ 推导出的 α_floor。 */
  floor: number = 0;
  reason: string = '';
}
const TRS: Tr[] = [];
function tr(id: string, where: string, props: string, ms: number, content: boolean, reason: string): void {
  const x: Tr = new Tr(); x.id = id; x.where = where; x.props = props; x.ms = ms; x.content = content; x.reason = reason; TRS.push(x);
}
tr('T1 sheetTransition', 'anim.ets 的 sheetTransition() → 面板/弹层容器（QueueSheet · SettingsPanel · PluginsSheet · MenuSheets×3 · StatusSheet · AskUserSheet · Index.ets×2；⛔ 内容锚不记行号）',
  'translate(y:260) 220ms ⊕ OPACITY 180ms', 220, false, '整层面板**到达中**（用户尚未开始阅读）+ 有界 220ms + 静息态可读');
tr('T2 toastTransition', 'anim.ets 的 toastTransition() → Toast.ets（浮条容器）', 'translate(y:65) 220ms ⊕ OPACITY 180ms', 220, false, '同上（小浮条到达中）+ 有界');
tr('T3 entryTransition', 'MessageRow.ets 的 this.entryTransition()', 'OPACITY ⊕ translate(y:4) 200ms', 200, false, '行入场；**有界 200ms**，且静息态恒 = entryRestOpacity()=1（fail-safe，⑨ 已钉）');
tr('T4 splash overlay', 'SplashOverlay.ets 的 overlayOpacity（animateTo(animEaseOut())）', 'OPACITY（整屏让位）', 320, false, '开屏**退出**让位：此层本就在消失，内容在它身后');
tr('T5 splash hint', 'SplashOverlay.ets 的 hintOpacity + hintLift（animateTo(animEaseOutDelayed())）', 'OPACITY + translate', 320, false, '提示文字**淡入到位**后常驻；有界且静息可读');
tr('T6 orb enter', 'AssistantOrb.ets 的 animateTo(animBase())（入场 scale/alpha）', 'alpha + scale（非文字层）', 220, false, '光球是图形，不承载文字');

console.log('\n▶ §A 全仓过渡清单（grep 枚举：`.transition(` 15 处 + `animateTo` 21 处，逐条归并）');
console.log('  ' + pad('id', 20) + pad('属性', 34) + pad('时长', 6) + '归属/判定');
for (let i = 0; i < TRS.length; i++) {
  const x = TRS[i];
  console.log('  ' + pad(x.id, 20) + pad(x.props, 34) + pad(`${x.ms}ms`, 6) + (x.content ? '**内容需可读**' : '整层 reveal ⇒ 允许'));
}
ok('清单非空（零扫描防线）', TRS.length > 0);
ok('每个过渡都给了时长与属性（无"漏登记的过渡"）',
  TRS.every((x) => x.ms > 0 && x.props.length > 0 && x.where.length > 0));
ok('所有过渡都**有界**（≤320ms）—— 这是与 ⑨（无界静息隐藏）的本质差别',
  TRS.every((x) => x.ms <= 320));

console.log('\n▶ §B 最坏帧：从 α=0 起的淡入，首帧对比度恒 = 1.00');
const p0: Palette = paletteOf('porcelain');
console.log('  ' + pad('进度 p', 10) + pad('porcelain 正文对比', 22) + 'dark 正文对比');
for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]) {
  console.log('  ' + pad(p.toFixed(2), 10) + pad(frameContrast(p0, p).toFixed(4), 22) + frameContrast(paletteOf('dark'), p).toFixed(4));
}
ok('p=0 时对比度 = 1.00（完全不可读）—— 任何"从 0 淡入"的过渡都有这一帧',
  Math.abs(frameContrast(p0, 0) - 1) < 1e-9);
ok('p=1 时为静息态（≥ 正文阈值 4.5）', frameContrast(p0, 1) >= 4.5);

console.log('\n▶ §C 推导：若"动画期间内容就该被读懂"，不透明度地板最低是多少？');
const BODY_FLOOR: number = 4.5;   // 正文档阈值（与 theme_contrast 同源）
const floors: number[] = [];
for (let i = 0; i < ALL_THEMES.length; i++) {
  const p: Palette = paletteOf(ALL_THEMES[i]);
  let f: number = 1;
  for (let a = 0; a <= 1.0001; a += 0.001) {
    if (frameContrast(p, a) >= BODY_FLOOR) { f = a; break; }
  }
  floors.push(f);
  console.log(`  ${pad(ALL_THEMES[i], 11)} 正文需地板 α ≥ ${f.toFixed(3)}`);
}
const worstFloor: number = Math.max(...floors);
console.log(`  ⇒ 全主题取最严：**α_floor = ${worstFloor.toFixed(3)}**（浅色族通常更高：白底上淡字掉得最快）`);

console.log('\n▶ §D 判定：允许 / 不足');
const contentTrs: Tr[] = TRS.filter((x) => x.content);
console.log(`  **允许**（${TRS.length - contentTrs.length} 项）：整层 reveal 且**有界**，用户尚未开始阅读；静息态恒可读（fail-safe）`);
for (let i = 0; i < TRS.length; i++) { if (!TRS[i].content) { console.log(`     · ${pad(TRS[i].id, 20)} ${TRS[i].reason}`); } }
console.log(`  **不足**（${contentTrs.length} 项）：${contentTrs.length === 0 ? '无 —— 当前没有任何过渡被标为"动画期间内容就该被读懂"' : contentTrs.map((x) => x.id).join(', ')}`);
ok('当前无"内容需在动画期间可读"的过渡 ⇒ 无真缺陷（全部为有界 reveal）', contentTrs.length === 0);

console.log('\n▶ §E 判据 + mutation（把规则钉死，防将来引入"内容型淡入")');
/**
 * 判据：**内容型**过渡（`content: true`）的不透明度地板必须 ≥ α_floor（否则动画期间内容不可读）；
 * **reveal 型**只要求有界（≤ 320ms）。⛔ 例外名单只许缩短。
 */
function transitionsOk(ts: Tr[], floorMin: number, exempt: string[]): boolean {
  if (ts.length === 0) { return false; }
  for (let i = 0; i < ts.length; i++) {
    const x = ts[i];
    if (exempt.indexOf(x.id) >= 0) { continue; }
    if (x.content && x.floor < floorMin) { return false; } // 内容型：地板必须 ≥ α_floor，否则动画期间不可读
    if (!x.content && x.ms > 320) { return false; }        // reveal 型：必须有界
  }
  return true;
}
const PENDING_SPEC: string[] = [];   // 当前无缺口；⛔ 只许缩短（此处已空）
ok('真实基线判绿（防"判据恒红"）', transitionsOk(TRS, worstFloor, PENDING_SPEC) === true);
ok('mutation：清单清空 ⇒ 判红（零扫描防线）', transitionsOk([], worstFloor, PENDING_SPEC) === false);
{
  // mutation ①：把一个 reveal 型改成"内容型"（即声明"动画期间内容就该被读懂"）⇒ 必红
  const inj: Tr[] = TRS.map((x) => { const y: Tr = new Tr(); Object.assign(y, x); if (y.id === 'T3 entryTransition') { y.content = true; } return y; });
  ok('mutation：把行入场标成"内容型"但地板仍 0 ⇒ 判红（这就是"把可读性押在动画上"的复发形态）',
    transitionsOk(inj, worstFloor, PENDING_SPEC) === false);
  const fixed: Tr[] = TRS.map((x) => { const y: Tr = new Tr(); Object.assign(y, x); if (y.id === 'T3 entryTransition') { y.content = true; y.floor = worstFloor + 0.01; } return y; });
  ok('反向对照：同样内容型但**给了 ≥ α_floor 的地板** ⇒ 判绿（证明判据不是"内容型一律红"）',
    transitionsOk(fixed, worstFloor, PENDING_SPEC) === true);
}
{
  // mutation ②：引入一个"无界"的 reveal 过渡（>320ms）⇒ 必红
  const inj: Tr[] = TRS.map((x) => { const y: Tr = new Tr(); Object.assign(y, x); if (y.id === 'T1 sheetTransition') { y.ms = 600; } return y; });
  ok('mutation：把面板过渡拉成 600ms（超出有界上限）⇒ 判红', transitionsOk(inj, worstFloor, PENDING_SPEC) === false);
}
{
  const inj: Tr[] = TRS.map((x) => { const y: Tr = new Tr(); Object.assign(y, x); y.content = true; return y; });
  ok('mutation：全部标成"内容型"⇒ 判红（当前无一项有地板）', transitionsOk(inj, worstFloor, PENDING_SPEC) === false);
}

console.log('\n▼ 摘要');
console.log(`  过渡 ${TRS.length} 项，全部有界（≤320ms）；最坏帧恒在 p→0（对比度 1.00）`);
console.log(`  ⇒ 有界 reveal 归**允许**（静息态可读 = fail-safe）；`);
console.log(`  ⇒ 若将来出现"内容需在动画期间可读"的过渡：**不透明度地板 α ≥ ${worstFloor.toFixed(3)}**（正文档 4.5 反解）`);
if (fail > 0) { console.log(`\n  transition_frame_contrast: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  transition_frame_contrast: ${pass} passed, 0 failed`);
process.exit(0);

export {};
