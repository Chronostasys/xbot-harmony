/**
 * 主题可读性门禁 —— **WCAG 2.1 对比度**（5 套主题 × 生产实际出现的「前景/背景」对）。
 *
 * 为什么需要它（本波的目标）：本项目 5 套主题（dark/light/aurora/nebula/porcelain）里，
 * 「某套主题的某个前景色压在某背景上糊到看不见」这类**视觉缺陷**此前只能靠人眼在模拟器上
 * 抓（`docs/ARKTS-GOTCHAS.md` 批次 13/14 是同一类问题的两个面：门禁**查不到**、测试**测不到**）。
 * `theme.test.ts` 只钉住**色值字面量**（改了要同步快照），`theme_tokens.test.ts` 只钉**穷尽性**
 * —— **没有任何一条在问「这个字在这块底上读得出来吗」**。本文件把那个问题变成可执行的数学判据。
 *
 * 三条判据：
 *  (1) **度量本身可证**：用 WCAG 2.1 的公开参考值（黑白 = 21、#767676/白 = 4.54、
 *      #0000FF/白 = 8.59、#808080 相对亮度 = 0.21586、三通道系数 0.2126/0.7152/0.0722）
 *      反向验证 `contrastRatio()`/`relativeLuminance()` —— 公式写错（例如退化成 8bit 均值）
 *      时本段立刻红，不允许"用错的尺子量出全绿"。
 *  (2) **覆盖矩阵**：5 套主题 × 每个**真被生产消费**的前/背景对，按**分级阈值**判定：
 *      正文/承载文字 4.5:1（WCAG AA）、次要/语义色文字 3.0:1、最弱一档/装饰 2.0:1。
 *  (3) **覆盖完整性（生产接线自证）**：判定的每个角色都必须真的在 `pages/`+`components/`
 *      里被 `pal()`/`eff()` 取用（否则就是在判一组"空对"）；反过来，凡声明"无生产调用点
 *      故不判定"的角色，必须真的是 0 次引用 —— 于是"某角色没人用"是**机械核实**的，不是猜的。
 *
 * ⛔ 不重复既有断言：`theme.test.ts` / `theme_tokens.test.ts` 已覆盖「色值快照 / 字段穷尽性 /
 *    主题派发 / 效果 token 派生 / tokens 尺度」；本文件**一条色值字面量都不钉**（那是它们的活），
 *    只钉**跨色值的关系**（对比度），并把"已发现但不达标"的对记进**台账**（§C）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
};
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  Palette, Effects, Surfaces, ALL_THEMES, paletteOf, effectsOf, surfacesOf, surfacesComplete,
  themeLabel, HAIRLINE_TARGET_RATIO,
  contrastRatio, compositeOver, relativeLuminance, parseColorRgba,
} from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ════════════════════════════════════════════════════════════════════════════
// §A 度量自证：用 WCAG 2.1 的公开参考值验证尺子（不是验证色板）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 度量自证（WCAG 2.1 参考值）');

eq('黑白对比 = 21.00', contrastRatio('#000000', '#FFFFFF').toFixed(2), '21.00');
eq('同色对比 = 1.00', contrastRatio('#123456', '#123456').toFixed(2), '1.00');
// WCAG 官方例子：4.54:1（8bit 均值法会算出 ~2.05，这一步就是"尺子没退化成均值"的证）
eq('参考 #767676 / 白 = 4.54', contrastRatio('#767676', '#FFFFFF').toFixed(2), '4.54');
eq('参考 #0000FF / 白 = 8.59', contrastRatio('#0000FF', '#FFFFFF').toFixed(2), '8.59');
ok('对比度与参数顺序无关', contrastRatio('#7C5CFF', '#0B0B0E') === contrastRatio('#0B0B0E', '#7C5CFF'));

// 相对亮度：三通道系数 + 分段线性化，两条都钉（任一条被改都会红）
eq('相对亮度 白 = 1', relativeLuminance('#FFFFFF').toFixed(4), '1.0000');
eq('相对亮度 黑 = 0', relativeLuminance('#000000').toFixed(4), '0.0000');
eq('相对亮度 #808080 = 0.2159（均值法会得 0.5020）', relativeLuminance('#808080').toFixed(4), '0.2159');
eq('红通道系数 0.2126', relativeLuminance('#FF0000').toFixed(4), '0.2126');
eq('绿通道系数 0.7152', relativeLuminance('#00FF00').toFixed(4), '0.7152');
eq('蓝通道系数 0.0722', relativeLuminance('#0000FF').toFixed(4), '0.0722');
// 低端必须走 c/12.92 线性段（10/255/12.92 = 0.003035）；若全用幂函数会得 0.003037
eq('低端走 c/12.92 分段', relativeLuminance('#0A0A0A').toFixed(6), '0.003035');

// 解析：6 位补不透明 / 8 位 ARGB / 非法回落不透明黑（不返回 NaN —— NaN 会让所有比较静默为 false）
eq('parse 6 位补 alpha', parseColorRgba('#0B0B0E').join(','), '11,11,14,255');
eq('parse 8 位 ARGB', parseColorRgba('#9E0E0E14').join(','), '14,14,20,158');
eq('parse 非法 = 不透明黑', parseColorRgba('#zz').join(','), '0,0,0,255');
eq('parse 长度错 = 不透明黑', parseColorRgba('#12345').join(','), '0,0,0,255');

// 半透明合成：玻璃/半透明面必须**先合成再算对比度**（拿带 alpha 的 #AARRGGBB 直接算是错的）
eq('合成 全透明 = 底色', compositeOver('#00FF0000', '#FFFFFF'), '#FFFFFF');
eq('合成 不透明 = 上层', compositeOver('#FF123456', '#FFFFFF'), '#123456');
eq('合成 黑@50% 压白 = #7F7F7F', compositeOver('#80000000', '#FFFFFF'), '#7F7F7F');
eq('合成 白@50% 压黑 = #808080', compositeOver('#80FFFFFF', '#000000'), '#808080');
eq('合成 非法上层 = 黑底', compositeOver('nope', '#FFFFFF'), '#000000');
// 与真实 token 对齐：dark 的 glassBg = surface(#0E0E14)@62% = #9E0E0E14，压在 appBg(#0B0B0E) 上
eq('dark glassBg 压 appBg = #0D0D12', compositeOver(effectsOf(paletteOf('dark')).glassBg, '#0B0B0E'), '#0D0D12');

// ════════════════════════════════════════════════════════════════════════════
// §B 覆盖矩阵：5 套主题 × 生产实际出现的 前/背景 对（分级阈值）
// ════════════════════════════════════════════════════════════════════════════
interface Tier {
  fg: string;
  tier: number;
}
interface FillPair {
  fg: string;
  bg: string;
  tier: number;
  where: string;
}
interface Pair {
  theme: string;
  fg: string;
  bg: string;
  fgHex: string;
  bgHex: string;
  ratio: number;
  tier: number;
}

/** 阈值分级（不做一刀切）：
 *  · 4.5 = WCAG AA 正文级（必须能正常阅读：正文主色、强调填充上的文字）
 *  · 3.0 = WCAG AA 大字/图形级（次要文字、语义色文字/图标）
 *  · 2.0 = 最弱一档（"几乎不该被读到"的层级 / 纯装饰） */
const T_BODY: number = 4.5;
const T_SECOND: number = 3.0;
const T_MUTED: number = 2.0;

/** 画布面上的文字角色（**语义上一定成立**的关系：这些角色存在的意义就是"被读"）。 */
const CANVAS_ROLES: Tier[] = [
  { fg: 'textPrimary', tier: T_BODY },
  { fg: 'textSecondary', tier: T_SECOND },
  { fg: 'textMuted', tier: T_MUTED },
  { fg: 'accent', tier: T_SECOND },            // ContextRing 弧色 / Circle.fill 等图形
  { fg: 'accentSoft', tier: T_SECOND },        // 链接、可点文字（38 处）
  { fg: 'dangerText', tier: T_SECOND },
  { fg: 'successText', tier: T_SECOND },
  { fg: 'warn', tier: T_SECOND },
  { fg: 'statusError', tier: T_SECOND },       // ContextRing.ets:69 用量环弧色
  { fg: 'statusRunning', tier: T_SECOND },     // AssistantOrb.ets:365 工具在飞环色
];

/** 画布面（`appBg`..`surfaceHi` 都是**不透明**面；`glassBg` 是半透明 ⇒ 必须先合成）。
 *  `sunken` = 下沉内容面（代码块 / 终端块 / diff 行底）。历史上那 5 处用的是**阴影 token**
 *  `Effects.elev1`（`ToolPopover.ets:280/303/336/370/421`，其卡底是 `surface`，见 `:383`），
 *  故 `text* × sunken` 这组对**已经在生产里成立**，只是过去用错了 token 表达。 */
const CANVAS_FACES: string[] = [
  'appBg', 'surface', 'surfaceAlt', 'surfaceHi',
  'glassBg/appBg', 'glassBg/surface',
  'sunken',
];

/**
 * 「文字压在有色的**填充**上」——这类关系**只在有真实调用点时才成立**，故逐条列证据。
 * 只判有据可查的对，避免"造一批没人用的对再宣布它通过"。
 *
 * ⚠️ 行号会随并发改动漂移 —— **以锚点文本为准**（`Index.ets` 是本波多条线共改的文件）。
 */
const FILL_PAIRS: FillPair[] = [
  { fg: 'onAccent', bg: 'accent', tier: T_BODY, where: 'Index.ets:2293 Button(登录) 同元素 fontColor(2296)+backgroundColor(2297)；亦见 4674/5231' },
  { fg: 'onAccent', bg: 'accentDeep', tier: T_BODY, where: 'Index.ets:2687+2699 选中会话标签「poolOrder ForEach」（同一 Row）' },
  { fg: 'onAccent', bg: 'surfaceHi', tier: T_BODY, where: 'Index.ets:3942+3943 sendKeyLabel 发送键标签（同一 Text）' },
  { fg: 'accentText', bg: 'accentDeep', tier: T_BODY, where: 'SettingsRows.ets:314+318 「默认」徽标 / ToolPopover.ets:345+354 hunk 标记' },
  { fg: 'accentText', bg: 'surfaceHi', tier: T_BODY, where: 'Index.ets:4551+4553 channelLabel 渠道角标（同一 Text）' },
  { fg: 'textPrimary', bg: 'accentDeep', tier: T_BODY, where: 'Index.ets:2559+2561 「↓ 回到最新」pill（同一 Text）' },
  { fg: 'textMuted', bg: 'accentDeep', tier: T_MUTED, where: 'ToolPopover.ets:348+354 HunkRow 的 hunk 尾注' },
  { fg: 'textMuted', bg: 'warnBg', tier: T_MUTED, where: 'ToolPopover.ets:325+336 DiffRow 删行的行号' },
  { fg: 'textSecondary', bg: 'warnBg', tier: T_SECOND, where: 'ToolPopover.ets:332+336 DiffRow 删行的内容' },
  { fg: 'dangerText', bg: 'warnBg', tier: T_SECOND, where: 'ToolPopover.ets:325+336 DiffRow 删行的标记' },
  { fg: 'warn', bg: 'warnBg', tier: T_SECOND, where: 'Index.ets:2611+2616 「连接断开，正在重连…」提示条（同一 Row）' },
];

function roleHex(p: Palette, name: string): string {
  const m: Record<string, string> = p as unknown as Record<string, string>;
  return m[name];
}

/** 一套主题的"面表"：画布面 + 填充面（都是**不透明**的最终颜色，玻璃已合成）。 */
function facesOf(p: Palette): Record<string, string> {
  const e: Effects = effectsOf(p);
  const m: Record<string, string> = {};
  m['appBg'] = p.appBg;
  m['surface'] = p.surface;
  m['surfaceAlt'] = p.surfaceAlt;
  m['surfaceHi'] = p.surfaceHi;
  // glassBg = glassBase@62%（Effects 派生）⇒ 真正决定可读性的是合成结果
  m['glassBg/appBg'] = compositeOver(e.glassBg, p.appBg);
  m['glassBg/surface'] = compositeOver(e.glassBg, p.surface);
  // 填充面（当底色用）
  m['accent'] = p.accent;
  m['accentDeep'] = p.accentDeep;
  m['warnBg'] = p.warnBg;
  m['sunken'] = surfacesOf(p).sunken;
  return m;
}

const PAIRS: Pair[] = [];
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(theme);
  const faces: Record<string, string> = facesOf(p);
  for (let ri = 0; ri < CANVAS_ROLES.length; ri++) {
    for (let fi = 0; fi < CANVAS_FACES.length; fi++) {
      const fgName: string = CANVAS_ROLES[ri].fg;
      const bgName: string = CANVAS_FACES[fi];
      const fgHex: string = roleHex(p, fgName);
      const bgHex: string = faces[bgName];
      PAIRS.push({
        theme: theme, fg: fgName, bg: bgName, fgHex: fgHex, bgHex: bgHex,
        ratio: contrastRatio(fgHex, bgHex), tier: CANVAS_ROLES[ri].tier,
      });
    }
  }
  for (let pi = 0; pi < FILL_PAIRS.length; pi++) {
    const fp: FillPair = FILL_PAIRS[pi];
    const fgHex: string = roleHex(p, fp.fg);
    const bgHex: string = faces[fp.bg];
    PAIRS.push({
      theme: theme, fg: fp.fg, bg: fp.bg, fgHex: fgHex, bgHex: bgHex,
      ratio: contrastRatio(fgHex, bgHex), tier: fp.tier,
    });
  }
}

// ── §B.2 结构性边界（`hairline`）与下沉面（`sunken`）的生产接线判定（波3b-6） ──────────────
// `sunken` 作为"**面**"已在 CANVAS_FACES 里（其上的文字角色被 §B 判定）。
// `hairline` 是"**边界**"，只与**相邻的底**相接（`appBg`/`surface`），**不**与 `surfaceHi`/`surfaceAlt`
// 相接 ⇒ 故**不**并入 CANVAS_ROLES×CANVAS_FACES 的叉乘（边界贴 surfaceHi 的对比度 ~1.0 是无意义的对，
// 硬判只会逼出一条假台账）。这里给 `hairline` 单列**阈值/判定表**，阈值**分族**：
//   · 浅色族（light/porcelain）：必须达到 `HAIRLINE_TARGET_RATIO`（web 权威基线，与 §E3 同源）；
//   · 深色族（dark/aurora/nebula）：必须**至少与它替代的 `border` 一样可见**（`hairline ≡ border`
//     ⇒ 恰好达标；若哪天有人破坏这个逐字节等价，本段立刻红）。
const DARK_FAMILY: string[] = ['dark', 'aurora', 'nebula'];
const LIGHT_FAMILY: string[] = ['light', 'porcelain'];

interface BoundaryPair {
  theme: string;
  role: string;
  base: string;
  hex: string;
  baseHex: string;
  ratio: number;
  tier: number;
}
const BOUNDARY_BASES: string[] = ['appBg', 'surface'];
const BOUNDARY_PAIRS: BoundaryPair[] = [];
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const bTheme: string = ALL_THEMES[ti];
  const bp: Palette = paletteOf(bTheme);
  const bs: Surfaces = surfacesOf(bp);
  const lightFam: boolean = LIGHT_FAMILY.indexOf(bTheme) >= 0;
  for (let bi = 0; bi < BOUNDARY_BASES.length; bi++) {
    const base: string = BOUNDARY_BASES[bi];
    const baseHex: string = base === 'appBg' ? bp.appBg : bp.surface;
    const tier: number = lightFam ? HAIRLINE_TARGET_RATIO : contrastRatio(bp.border, baseHex);
    BOUNDARY_PAIRS.push({
      theme: bTheme, role: 'hairline', base: base, hex: bs.hairline, baseHex: baseHex,
      ratio: contrastRatio(bs.hairline, baseHex), tier: tier,
    });
  }
}
for (let i = 0; i < BOUNDARY_PAIRS.length; i++) {
  const b: BoundaryPair = BOUNDARY_PAIRS[i];
  if (b.ratio >= b.tier) { pass++; } else {
    fail++;
    console.log(`  ✗ 结构性边界不达标 ${b.theme} · ${b.role} 贴 ${b.base}` +
      ` = ${b.ratio.toFixed(4)}:1 (< ${b.tier.toFixed(4)}；${b.hex} on ${b.baseHex})`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// §C 台账（已知不达标的对）—— **只准删不准加**
//
// 为什么用台账而不是直接红：本波不许改色值（那是 UI 决策，交回主 agent），若把这些对直接
// 断言成"必须达标"，`tools/gate.sh` 就永远是红的 ⇒ 门禁失去意义。台账把"已知欠债"钉成
// **白名单**：凡**不在台账**里的不达标对 ⇒ 立刻红（新增视觉回归跑不掉）；
// 台账里的对**修好后**会打印"可移出台账"（不红）⇒ 欠债只减不增。
// ⚠️ 往台账里加一行 = 承认"新引入了一处读不出来的文字"，PR 里是显式可见的。
// ════════════════════════════════════════════════════════════════════════════
const LEDGER: string[] = [
  // ── 根因 A：`onAccent`（定义是"主按钮上的文字"）被用在**中性面** surfaceHi 上 ──────────
  // 证据：pages/Index.ets:3942-3943（同一 Text：fontColor(onAccent) + backgroundColor(surfaceHi)
  // = sendKeyLabel 发送键标签）。浅色系/霓虹主题的 surfaceHi 与 onAccent **明暗相反** ⇒ 几乎不可见。
  // 最小改动建议（交回主 agent）：该处改用 `textPrimary`（浅底可读），或把底换成 `accent`。
  'light|onAccent|surfaceHi',
  'aurora|onAccent|surfaceHi',
  'nebula|onAccent|surfaceHi',
  'porcelain|onAccent|surfaceHi',
  // ── 根因 B：浅色系主题的 `accentDeep` 是**浅填充**（`core/accent.ets` 的 light 分支
  // = lighten(a, 0.78)），却承载 `onAccent`（白）⇒ 白底白字。
  // 证据：pages/Index.ets:2687 + 2699（选中会话标签，同一 Row）。
  // 最小改动建议：选中态文字改 `accentText`（该角色就是为"强调色浅底上的文字"定义的）。
  'light|onAccent|accentDeep',
  'porcelain|onAccent|accentDeep',
  // ── 根因 C：`accentDeep` 当 hunk/徽标底时，与 accentText / textMuted / textPrimary 的组合
  // 在**霓虹主题**不达标（accentDeep 是"主色压暗一档"，仍偏亮/偏灰）。
  // 证据：ToolPopover.ets:345+354（accentText）、ToolPopover.ets:348+354（textMuted）、
  //       Index.ets:2559+2561（textPrimary）、Index.ets:2687+2699（onAccent）。
  // 最小改动建议：霓虹主题的 `accentDeep` 单独压暗（它现在是 accent 系派生，没跟底色一起校准）。
  'aurora|accentText|accentDeep',
  'aurora|textMuted|accentDeep',
  'aurora|textPrimary|accentDeep',
  'aurora|onAccent|accentDeep',
  'nebula|accentText|accentDeep',
  'nebula|textMuted|accentDeep',
  'nebula|onAccent|accentDeep',
  // ── 根因 D：dark 主题主按钮上的白字（#FFFFFF / #7C5CFF）只有 4.35，**略低于** AA 4.5 ────
  // 证据：Index.ets:2293/4674/5231。最小改动建议：accent 压暗一档（如 #6B4AE6）或按钮字色用 #F5F5FF。
  'dark|onAccent|accent',
  // ── 根因 E（**已修**：2026-10-11 波5h）──────────────────────────────────────────────
  // porcelain 的 `textMuted` 曾是 Apple tertiaryLabel `#AEAEB2`：压 surfaceHi(#EDEDEF) 1.89、
  // 压 accentDeep(#E8F1FD) 1.94、压 sunken(#F2F2F2) 1.98 —— 三处都 < 2.0（"更弱的一档"糊掉）。
  // 已改为 `#A2A2A7`（取值依据 = 两条约束一起解，见 `core/theme.ets` 的 porcelainPalette 注释）。
  // ⛔ 这三条**不许加回台账**：它们现在由 §F 直接断言（比台账强 —— 台账只保证"不新增"，
  //    §F 保证"确实达标且留有余量"）。重新登记 = 承认重新引入可读性缺陷。
];

const ledgerSet: Record<string, boolean> = {};
for (let i = 0; i < LEDGER.length; i++) { ledgerSet[LEDGER[i]] = true; }

const seenKeys: Record<string, boolean> = {};
const failures: Pair[] = [];
for (let i = 0; i < PAIRS.length; i++) {
  const pr: Pair = PAIRS[i];
  const key: string = `${pr.theme}|${pr.fg}|${pr.bg}`;
  seenKeys[key] = true;
  if (pr.ratio < pr.tier) {
    failures.push(pr);
    if (ledgerSet[key] === true) { pass++; } else {
      fail++;
      console.log(`  ✗ 未登记的可读性缺陷 ${pr.theme} · ${pr.fg} 压 ${pr.bg}` +
        ` = ${pr.ratio.toFixed(2)}:1 (< ${pr.tier}；${pr.fgHex} on ${pr.bgHex})`);
    }
  } else {
    pass++;
  }
}

// 台账自检：键必须真是模型里的对（拼错 ⇒ 门禁空转、假绿），且未修复的不许写在台账里又不红
for (let i = 0; i < LEDGER.length; i++) {
  ok(`台账键有效：${LEDGER[i]}`, seenKeys[LEDGER[i]] === true);
}

// ════════════════════════════════════════════════════════════════════════════
// §D 覆盖完整性（生产接线自证）
//
// 「这个角色没人用，所以不判」必须是**机械核实**的：直接扫 pages/ + components/ 的源码，
// 数每个角色被 `.xxx` 取用的次数。任何被生产消费的角色都必须在 §B 的判定范围内
// （新增角色用法 ⇒ 本段红 ⇒ 强迫补判定）；反过来，声明"无调用点"的角色必须真的是 0。
// ════════════════════════════════════════════════════════════════════════════
const ALL_ROLE_NAMES: string[] = [
  'appBg', 'surface', 'surfaceAlt', 'surfaceHi',
  'textPrimary', 'textSecondary', 'textMuted', 'foreground3',
  'accent', 'accentHover', 'accentSoft', 'accentSoftFade', 'accentDeep', 'accentText', 'onAccent',
  'bubbleUser', 'border', 'borderStrong',
  'success', 'successText', 'warn', 'warnBg', 'dangerBg', 'dangerText',
  'statusRunning', 'statusWaiting', 'statusIdle', 'statusError',
  'transparent', 'glassBg', 'glassBorder', 'glassBlur',
  'glow', 'glowSoft', 'gradientFrom', 'gradientTo', 'sheen', 'elev1', 'elev2', 'elev3',
  // 2026-10-11 新增的 Surfaces 角色（本波只建设色板，接线留给下一波）
  'hairline', 'sunken', 'glassBase',
];

function listEts(dir: string): string[] {
  const fs = require('fs');
  const path = require('path');
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (let i = 0; i < entries.length; i++) {
    const full: string = path.join(dir, entries[i].name);
    if (entries[i].isDirectory()) {
      const sub: string[] = listEts(full);
      for (let j = 0; j < sub.length; j++) { out.push(sub[j]); }
    } else if (entries[i].name.length > 4 && entries[i].name.slice(-4) === '.ets') {
      out.push(full);
    }
  }
  return out;
}

function countRoleUses(src: string, role: string): number {
  // 只数 `.role` 形式（`pal().textMuted` / `pal.textRunning` / `this.eff().glassBg` 都命中）
  let n: number = 0;
  let from: number = 0;
  const needle: string = `.${role}`;
  while (true) {
    const at: number = src.indexOf(needle, from);
    if (at < 0) { break; }
    const after: string = src.charAt(at + needle.length);
    // 词边界：后面不能还是标识符字符（`textMutedX` 不算），前面必须是 `.`（已是）
    const isWord: boolean = (after >= 'a' && after <= 'z') || (after >= 'A' && after <= 'Z')
      || (after >= '0' && after <= '9') || after === '_';
    if (!isWord) { n++; }
    from = at + needle.length;
  }
  return n;
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');   // <repo>/tools/tests/.out/js → 4 级
const scanFiles: string[] = [];
const dirs: string[] = [
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'pages'),
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components'),
];
for (let i = 0; i < dirs.length; i++) {
  const got: string[] = listEts(dirs[i]);
  for (let j = 0; j < got.length; j++) { scanFiles.push(got[j]); }
}
let srcAll: string = '';
for (let i = 0; i < scanFiles.length; i++) { srcAll += fsMod.readFileSync(scanFiles[i], 'utf-8') + '\n'; }

const roleUses: Record<string, number> = {};
for (let i = 0; i < ALL_ROLE_NAMES.length; i++) {
  roleUses[ALL_ROLE_NAMES[i]] = countRoleUses(srcAll, ALL_ROLE_NAMES[i]);
}

ok(`源码扫描到 pages/+components/ 的 .ets（${scanFiles.length} 个文件）`, scanFiles.length > 0);

/** §B 判定用到的角色（前景 ∪ 背景 ∪ 边界）。
 *  波3b-6 接线：`hairline`（边界，§B.2 判定）/ `sunken`（面，CANVAS_FACES 判定）已进生产
 *  （`pages/`+`components/`）⇒ 从 PENDING 移入本表。 */
const JUDGED_ROLES: string[] = [
  'textPrimary', 'textSecondary', 'textMuted', 'accent', 'accentSoft',
  'dangerText', 'successText', 'warn', 'statusError', 'statusRunning',
  'onAccent', 'accentText', 'appBg', 'surface', 'surfaceAlt', 'surfaceHi',
  'accentDeep', 'warnBg',
  'hairline', 'sunken',
];
for (let i = 0; i < JUDGED_ROLES.length; i++) {
  const r: string = JUDGED_ROLES[i];
  ok(`判定的角色 ${r} 确有生产调用点（非空对）`, roleUses[r] > 0);
}

/** 声明"无生产调用点 ⇒ 不判定"的角色（本段机械核实它们真的是 0 次引用）。
 *  ⛔ 一旦有人开始用它们，本段会红 —— 那时请把它们纳入 §B 并给出阈值，别只改这里。 */
const ZERO_USE_ROLES: string[] = ['foreground3', 'accentHover', 'bubbleUser', 'statusWaiting', 'statusIdle'];
for (let i = 0; i < ZERO_USE_ROLES.length; i++) {
  const r: string = ZERO_USE_ROLES[i];
  ok(`${r} 声明"无生产调用点"（实测 ${roleUses[r]} 次）`, roleUses[r] === 0);
}

/** 波5f 新增、**尚未接线**的面角色（本波只建色板；消费者接线已由波3b-6 完成 `hairline`/`sunken`）。
 *  ⛔ `hairline`/`sunken` 已于波3b-6 接进 `components/`，故**已从本表移入 §B.2 / JUDGED_ROLES**；
 *  剩 `glassBase` 仍为 0 引用 —— 它只喂 `effectsOf.glassBg`（组件不直呼），属**设计如此**。
 *  若哪天有组件直呼 `.glassBase`，本段会红：那时请把它移入 §B 并给出阈值，别只改这里。 */
const PENDING_WIRING_ROLES: string[] = ['glassBase'];
for (let i = 0; i < PENDING_WIRING_ROLES.length; i++) {
  const r: string = PENDING_WIRING_ROLES[i];
  ok(`${r} 本波尚未接线（实测 ${roleUses[r]} 次引用；接线后请移入 §B）`, roleUses[r] === 0);
}

// ════════════════════════════════════════════════════════════════════════════
// §E 补齐的三处语义缺失（`Surfaces`：hairline / sunken / glassBase）
//
// 背景：另一条线（task5-orb-wire）在真机 + 代码审查里认定三处**语义缺失**，
// 本波在色板层补齐。本段的判据分两类：
//  (a) **零回归等价性**：新角色对**深色**的取值必须与它替代的现值逐字节/逐公式等价
//      （否则就是未授权的视觉回归）—— 逐字节断言，不靠"我保证"；
//  (b) **浅色系达标**：新角色存在的意义就是修浅色系的糊 —— 必须真的达标，
//      且必须**严格强于**它替代的旧值（否则补了等于没补）。
// ════════════════════════════════════════════════════════════════════════════
console.log('\n▶ §E 补齐的三处语义缺失（hairline / sunken / glassBase）');

// ── E1 完整性 + 与 `Effects` 的字段数各自独立（新增面不能漏填） ─────────────
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  const s: Surfaces = surfacesOf(paletteOf(th));
  ok(`${th} surfaces 完整（hairline/sunken/glassBase 都非空）`, surfacesComplete(s));
  eq(`${th} Surfaces 字段数 = 3`, Object.keys(s).length, 3);
}

// ── E2 `hairline`：深色族 = `border` 逐字节等价（观感已批准，不许动） ────────
// 为什么深色可以等价：深色系底色暗，`border` 本身对画布的可见度已够（dark 1.22 / aurora 1.44 /
// nebula 1.35），真机观感是批准过的 ⇒ 新角色只改"浅色系命名的语义"，不改深色的像素。
// （`DARK_FAMILY`/`LIGHT_FAMILY` 已在 §B.2 定义，供 §B 与 §E 共用。）
for (let i = 0; i < DARK_FAMILY.length; i++) {
  const th: string = DARK_FAMILY[i];
  const p: Palette = paletteOf(th);
  eq(`${th} hairline ≡ border（逐字节等价 ⇒ 零回归）`, surfacesOf(p).hairline, p.border);
}

// ── E3 `hairline`：浅色系必须达到 web 权威基线的可见度，且严格强于旧 border ──
// 基线 = `web/src/index.css:160` 浅色 `--border: #e0e0e0` on `:153 --bg-primary: #ffffff`
eq('门禁常量 HAIRLINE_TARGET_RATIO = web 浅色 border 实测值',
  HAIRLINE_TARGET_RATIO.toFixed(4), contrastRatio('#e0e0e0', '#FFFFFF').toFixed(4));
for (let i = 0; i < LIGHT_FAMILY.length; i++) {
  const th: string = LIGHT_FAMILY[i];
  const p: Palette = paletteOf(th);
  const h: string = surfacesOf(p).hairline;
  const bases: string[] = [p.appBg, p.surface];
  for (let bi = 0; bi < bases.length; bi++) {
    const got: number = contrastRatio(h, bases[bi]);
    ok(`${th} hairline 对 ${bi === 0 ? 'appBg' : 'surface'} 达 web 基线`
      + `（${got.toFixed(4)} >= ${HAIRLINE_TARGET_RATIO}）`, got >= HAIRLINE_TARGET_RATIO);
    // 严格强于旧值：证明"补这个角色"不是空转（数字必须真的变好）
    ok(`${th} hairline 严格强于旧 border（对 ${bi === 0 ? 'appBg' : 'surface'}）`,
      got > contrastRatio(p.border, bases[bi]));
  }
  ok(`${th} hairline ≠ border（是真的另一个角色）`, h !== p.border);
}
// 旧值的实测（把这些数字钉住 ⇒ 若哪天有人"顺手"把 border 调亮，本段立刻红）
eq('light 旧 border 可见度（1.1783，弱于 web 基线）',
  contrastRatio(paletteOf('light').border, paletteOf('light').appBg).toFixed(4), '1.1783');
eq('porcelain 旧 border 可见度（1.1798，弱于 web 基线）',
  contrastRatio(paletteOf('porcelain').border, paletteOf('porcelain').appBg).toFixed(4), '1.1798');
// 浅色系 hairline 的**快照**（推导结果必须可见、可复核；换了推导规则就会红）
eq('light hairline 快照', surfacesOf(paletteOf('light')).hairline, '#D5DBE2');
eq('porcelain hairline 快照（中性无色相偏移）', surfacesOf(paletteOf('porcelain')).hairline, '#DFDFE1');

// ── E4 `sunken`：与"旧的 elev1 当底色"**逐字节等价** ─────────────────────────
// 等价性构造在 `theme.ets` 里（共用 `legacyElev1Of`）；这里独立复算一遍：
// `compositeOver(effectsOf(p).elev1, p.surface)` 必须与 `surfacesOf(p).sunken` 逐字节相同。
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(th);
  eq(`${th} sunken ≡ compositeOver(旧 elev1, surface)（逐字节）`,
    surfacesOf(p).sunken, compositeOver(effectsOf(p).elev1, p.surface));
}
// 深色族的 elev1 逐字节不动（其他线依赖其观感）+ sunken 快照
eq('dark elev1 仍为黑@24%（逐字节未动）', effectsOf(paletteOf('dark')).elev1, '#3D000000');
eq('dark sunken 快照', surfacesOf(paletteOf('dark')).sunken, '#0B0B0F');
eq('aurora sunken 快照', surfacesOf(paletteOf('aurora')).sunken, '#080F1B');
eq('nebula sunken 快照', surfacesOf(paletteOf('nebula')).sunken, '#0B0817');
eq('light sunken 快照', surfacesOf(paletteOf('light')).sunken, '#F1F1F2');
eq('porcelain sunken 快照', surfacesOf(paletteOf('porcelain')).sunken, '#F2F2F2');
// 下沉面必须真与卡面**可分辨**（否则"下沉"看不出来 —— 这正是它要修的东西）
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(th);
  const r: number = contrastRatio(surfacesOf(p).sunken, p.surface);
  ok(`${th} sunken 与 surface 可分辨（${r.toFixed(4)} > 1.0）`, r > 1.0);
}

// ── E5 `glassBase` / `glassBg`：浅色系玻璃底不能与画布恒等 ────────────────────
// 根因：`effectsOf.glassBg = 基色@62%`，porcelain 里 `surface == appBg == #FFFFFF`
// ⇒ 合成结果 == 画布 ⇒ **玻璃面板在白底上恒等不可见**（实测 1.0000）。
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(th);
  const e: Effects = effectsOf(p);
  const s: Surfaces = surfacesOf(p);
  const glassHex: string = compositeOver(e.glassBg, p.appBg);
  // (a) 恒等不可见 ⇒ 红（"玻璃底等于画布"这种 bug 不许再出现）
  ok(`${th} 玻璃底不与画布恒等（${glassHex} ≠ ${p.appBg}）`, glassHex !== p.appBg);
  // (b) 浅色系玻璃底必须有**可辨**的可见度（实测地板 = light 的 1.0274 ⇒ 门禁取 1.02）
  if (LIGHT_FAMILY.indexOf(th) >= 0) {
    ok(`${th} 浅色族玻璃底可见度 >= 1.02（${contrastRatio(glassHex, p.appBg).toFixed(4)}）`,
      contrastRatio(glassHex, p.appBg) >= 1.02);
  }
  // (c) 深色四套逐字节不变（glassBase == surface ⇒ 与旧公式同值）
  if (DARK_FAMILY.indexOf(th) >= 0 || th === 'light') {
    eq(`${th} 玻璃基色未改（零回归）`, s.glassBase, p.surface);
  }
}
eq('dark glassBg 逐字节不变', effectsOf(paletteOf('dark')).glassBg, '#9E0E0E14');
eq('aurora glassBg 逐字节不变', effectsOf(paletteOf('aurora')).glassBg, '#9E0B1424');
eq('nebula glassBg 逐字节不变', effectsOf(paletteOf('nebula')).glassBg, '#9E0F0A1E');
eq('light glassBg 逐字节不变（surface≠appBg ⇒ 无需切换）', effectsOf(paletteOf('light')).glassBg, '#9EFFFFFF');
eq('porcelain 玻璃基色切换为次级面 surfaceAlt', surfacesOf(paletteOf('porcelain')).glassBase, '#F6F6F7');
eq('porcelain glassBg 由恒白变为次级面', effectsOf(paletteOf('porcelain')).glassBg, '#9EF6F6F7');
ok('porcelain 玻璃底不再恒等（1.0000 → 真有差异）',
  contrastRatio(compositeOver(effectsOf(paletteOf('porcelain')).glassBg, '#FFFFFF'), '#FFFFFF') > 1.0);

// ════════════════════════════════════════════════════════════════════════════
// §F 文字层级与余量不变量（波5h：`porcelain.textMuted` 数值决策的守护）
//
// 为什么单列一段：§C 的台账只能表达"已知欠债"，表达不了另外两件事 ——
//  ① 修好之后**不许退回**（台账项一删，就没有东西拦着它变回去了）；
//  ② 修的时候**不许把文字层级压塌**：porcelain 有四级文字
//     （textPrimary / textSecondary / textMuted / foreground3），
//     "把 textMuted 压深到能看清" 与 "次级/更弱还分得出来" 是**一对冲突约束** ——
//     压过头（例如直接借用它自己的 `statusIdle #8E8E93`）会让 `textMuted↔textSecondary`
//     的间距跌到**全场最紧**（1.555，其他四套最小是 1.845）⇒ 丢一级文字层级。
//     "一改消 3 条台账"若以丢层级为代价，那是亏不是赚 ⇒ 本段把两条约束**同时**断言。
// ⛔ 阈值一个都没放宽（T_MUTED 仍是 2.0）；下面全是**新增的更强断言**。
// ════════════════════════════════════════════════════════════════════════════
console.log('\n▶ §F 文字层级与余量不变量（porcelain.textMuted = #A2A2A7）');

const POR: Palette = paletteOf('porcelain');
const POR_SUNKEN: string = surfacesOf(POR).sunken;
/** porcelain 白底族的**全部**文字落点：画布/卡片/次级面/悬停面/下沉面/强调浅底。 */
const POR_FACES: string[] = ['appBg', 'surface', 'surfaceAlt', 'surfaceHi', 'sunken', 'accentDeep'];
const POR_FACE_HEX: Record<string, string> = {
  appBg: POR.appBg, surface: POR.surface, surfaceAlt: POR.surfaceAlt,
  surfaceHi: POR.surfaceHi, sunken: POR_SUNKEN, accentDeep: POR.accentDeep,
};
/** 同族灰的判据：Apple 自家 label 家族是 `R=G` 且 `B=R+5` 的轻微冷偏（不是纯无彩色）。 */
function isAppleGrayFamily(hex: string): boolean {
  const c: number[] = parseColorRgba(hex);
  return c[0] === c[1] && c[2] === c[0] + 5;
}

// ── F1「已修的 3 条台账」⇒ 改成**直接断言**（比台账强：台账只保证"不新增"） ────────
// 这 6 条就是 porcelain.textMuted 的全部落点；任何一条掉到线下 ⇒ 红（不会再被台账吞掉）。
for (let i = 0; i < POR_FACES.length; i++) {
  const f: string = POR_FACES[i];
  const r: number = contrastRatio(POR.textMuted, POR_FACE_HEX[f]);
  ok(`porcelain textMuted 压 ${f} 达标（${r.toFixed(3)} >= ${T_MUTED}；${POR.textMuted} on ${POR_FACE_HEX[f]}）`,
    r >= T_MUTED);
}

// ── F2 余量（不贴线）：最紧的一面要比阈值留出 ≥0.15 ───────────────────────────
// 为什么 0.15：2.0 是"最弱文字档"的硬阈值，**贴线意味着相邻色板任何一次微调都会把它顶到线下**
// （下一条主题/强调色的改动不该连带打红另一套主题）。0.15 = 阈值的 7.5% 余量。
let porMin: number = 99;
let porMinFace: string = '';
for (let i = 0; i < POR_FACES.length; i++) {
  const r: number = contrastRatio(POR.textMuted, POR_FACE_HEX[POR_FACES[i]]);
  if (r < porMin) { porMin = r; porMinFace = POR_FACES[i]; }
}
ok(`porcelain textMuted 最紧面留有余量（${porMinFace} = ${porMin.toFixed(3)} >= 2.15）`, porMin >= 2.15);

// ── F3 层级不塌陷（冲突约束 ②）：与相邻档的间距不得小于**其他四套主题的最小值** ──
// 判据取自色板自身（不发明新尺度）：porcelain 不许成为"次级↔更弱最分不出"的那一套。
const OTHER_THEMES: string[] = ['dark', 'light', 'aurora', 'nebula'];
let otherGapSec: number = 99;
let otherGapFg3: number = 99;
for (let i = 0; i < OTHER_THEMES.length; i++) {
  const q: Palette = paletteOf(OTHER_THEMES[i]);
  otherGapSec = Math.min(otherGapSec, contrastRatio(q.textSecondary, q.textMuted));
  otherGapFg3 = Math.min(otherGapFg3, contrastRatio(q.textMuted, q.foreground3));
}
const porGapSec: number = contrastRatio(POR.textSecondary, POR.textMuted);
const porGapFg3: number = contrastRatio(POR.textMuted, POR.foreground3);
ok(`porcelain 次级↔更弱 间距不塌陷（${porGapSec.toFixed(3)} >= 其他四套最小 ${otherGapSec.toFixed(3)}）`,
  porGapSec >= otherGapSec);
ok(`porcelain 更弱↔最弱 间距不塌陷（${porGapFg3.toFixed(3)} >= 其他四套最小 ${otherGapFg3.toFixed(3)}）`,
  porGapFg3 >= otherGapFg3);
// 顺带钉住"压过头"的边界：直接借用 statusIdle(#8E8E93) 会跌破这条线 —— 显式留证据
ok('压过头会被拦下（#8E8E93 的次级↔更弱间距 1.555 < 其他四套最小）',
  contrastRatio(POR.textSecondary, '#8E8E93') < otherGapSec);

// ── F4 四级阶梯**严格有序**（对纯白画布，对比度严格递减） ──────────────────────
const POR_LADDER: string[] = [POR.textPrimary, POR.textSecondary, POR.textMuted, POR.foreground3];
for (let i = 1; i < POR_LADDER.length; i++) {
  const hi: number = contrastRatio(POR_LADDER[i - 1], POR.appBg);
  const lo: number = contrastRatio(POR_LADDER[i], POR.appBg);
  ok(`porcelain 四级阶梯严格递减（第 ${i} 级 ${lo.toFixed(3)} < ${hi.toFixed(3)}）`, lo < hi);
}

// ── F5 色相：三个灰阶必须同族（`R=G`、`B=R+5`）────────────────────────────────
// 为什么不是 R=G=B：Apple 自家 label / secondaryLabel / tertiaryLabel / quaternaryLabel
// 都带 `B=+2..+5` 的轻微冷偏 —— 与**既有** porcelain 值保持一致比追求"纯无彩色"更不割裂。
for (let i = 1; i < POR_LADDER.length; i++) {
  const name: string = i === 1 ? 'textSecondary' : (i === 2 ? 'textMuted' : 'foreground3');
  ok(`porcelain ${name} 属 Apple 灰族（R=G、B=R+5）`, isAppleGrayFamily(POR_LADDER[i]));
}

// ── F6 零回归：其他四套主题逐字节不动 + 本波唯一改动的值钉成快照 ────────────────
eq('dark textMuted 逐字节不动', paletteOf('dark').textMuted, '#63636F');
eq('light textMuted 逐字节不动', paletteOf('light').textMuted, '#94A3B8');
eq('aurora textMuted 逐字节不动', paletteOf('aurora').textMuted, '#6b8399');
eq('nebula textMuted 逐字节不动', paletteOf('nebula').textMuted, '#8577ad');
eq('porcelain 本波唯一改动的值 = #A2A2A7', POR.textMuted, '#A2A2A7');
eq('porcelain textSecondary 未动', POR.textSecondary, '#6E6E73');
eq('porcelain foreground3 未动', POR.foreground3, '#C7C7CC');

// ════════════════════════════════════════════════════════════════════════════
// §G 报告（给设计决策看的真数据 —— 永远打印，不只在失败时）
// ════════════════════════════════════════════════════════════════════════════
function pad(s: string, n: number): string {
  let out: string = s;
  while (out.length < n) { out += ' '; }
  return out;
}
function num(x: number, n: number): string {
  const s: string = x.toFixed(2);
  return pad(s, n);
}

console.log('\n▼ 判定表（角色压填充 · 有生产调用点才判）');
console.log('   ' + pad('前景', 14) + pad('背景', 12) + pad('阈值', 6) + '证据');
for (let i = 0; i < FILL_PAIRS.length; i++) {
  const fp: FillPair = FILL_PAIRS[i];
  console.log('   ' + pad(fp.fg, 14) + pad(fp.bg, 12) + pad(String(fp.tier), 6) + fp.where);
}
console.log('\n   ⛔ 未纳入判定的角色（实测 0 次生产引用 ⇒ 判它没有意义）：');
console.log('   ' + ZERO_USE_ROLES.join(', '));
console.log('   ⏳ 仍未接线（设计如此：只喂派生、组件不直呼）：');
console.log('   ' + PENDING_WIRING_ROLES.join(', '));

console.log('\n▼ 补齐的三处语义缺失（Surfaces）实测表');
console.log('   ' + pad('主题', 11) + pad('hairline', 10) + pad('对画布', 9) + pad('sunken', 10)
  + pad('对卡面', 9) + pad('玻璃底基色', 12) + pad('玻璃合成', 10) + '对画布');
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  const p: Palette = paletteOf(th);
  const s: Surfaces = surfacesOf(p);
  const e: Effects = effectsOf(p);
  const gh: string = compositeOver(e.glassBg, p.appBg);
  console.log('   ' + pad(th, 11) + pad(s.hairline, 10)
    + pad(contrastRatio(s.hairline, p.appBg).toFixed(4), 9)
    + pad(s.sunken, 10) + pad(contrastRatio(s.sunken, p.surface).toFixed(4), 9)
    + pad(s.glassBase, 12) + pad(gh, 10) + contrastRatio(gh, p.appBg).toFixed(4));
}
console.log('   （hairline 目标 = ' + HAIRLINE_TARGET_RATIO + ' = web 浅色 --border #e0e0e0 / #ffffff；'
  + '深色族 ≡ border ⇒ 逐字节零回归）');

console.log('\n▼ 结构性边界（hairline）判定表（波3b-6：接线后新增判定）');
console.log('   ' + pad('主题', 11) + pad('贴', 10) + pad('实测', 9) + pad('阈值', 9) + pad('判定', 8) + '色值');
for (let i = 0; i < BOUNDARY_PAIRS.length; i++) {
  const b: BoundaryPair = BOUNDARY_PAIRS[i];
  const verdict: string = b.ratio >= b.tier ? '✓ 通过' : '✗ 不达标';
  console.log('   ' + pad(b.theme, 11) + pad(b.base, 10) + pad(b.ratio.toFixed(4), 9)
    + pad(b.tier.toFixed(4), 9) + pad(verdict, 8) + `${b.hex} on ${b.baseHex}`);
}
console.log('   （浅色族阈值 = HAIRLINE_TARGET_RATIO（web 基线）；深色族 = 它替代的 border 可见度，≡ ⇒ 恰好达标）');

console.log('\n▼ 每套主题最差 5 对（按 实测/阈值 升序；比值 < 1.0 即不达标）');
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const rows: Pair[] = [];
  for (let i = 0; i < PAIRS.length; i++) { if (PAIRS[i].theme === theme) { rows.push(PAIRS[i]); } }
  rows.sort((a: Pair, b: Pair) => (a.ratio / a.tier) - (b.ratio / b.tier));
  let badN: number = 0;
  for (let i = 0; i < rows.length; i++) { if (rows[i].ratio < rows[i].tier) { badN++; } }
  console.log(`\n   ── ${theme}（${themeLabel(theme)}）· 不达标 ${badN} / ${rows.length} ──`);
  console.log('     ' + pad('前景', 14) + pad('背景', 16) + pad('实测', 8) + pad('阈值', 8) + pad('判定', 10) + '色值');
  const top: number = rows.length < 5 ? rows.length : 5;
  for (let i = 0; i < top; i++) {
    const r: Pair = rows[i];
    const verdict: string = r.ratio >= r.tier ? '✓ 通过' : '✗ 不达标';
    console.log('     ' + pad(r.fg, 14) + pad(r.bg, 16) + num(r.ratio, 8) + pad(String(r.tier), 8)
      + pad(verdict, 10) + `${r.fgHex} on ${r.bgHex}`);
  }
}

console.log('\n▼ 不达标清单（已登记台账 = 交回主 agent 的改动决策）');
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const theme: string = ALL_THEMES[ti];
  const bad: Pair[] = [];
  for (let i = 0; i < failures.length; i++) { if (failures[i].theme === theme) { bad.push(failures[i]); } }
  if (bad.length === 0) { console.log(`   ✓ ${theme}：无`); continue; }
  bad.sort((a: Pair, b: Pair) => a.ratio - b.ratio);
  for (let i = 0; i < bad.length; i++) {
    const r: Pair = bad[i];
    console.log(`   · ${pad(theme, 10)} ${pad(r.fg, 14)} 压 ${pad(r.bg, 16)} = ${num(r.ratio, 6)}:1`
      + ` (< ${r.tier})${ledgerSet[`${r.theme}|${r.fg}|${r.bg}`] === true ? '  [已登记]' : '  [未登记!!]'}`);
  }
}

// 已修复的台账项 ⇒ 提示移除（不红：欠债变少是好事，但不许台账悄悄过期）
console.log('\n▼ 台账维护');
let fixedN: number = 0;
for (let i = 0; i < LEDGER.length; i++) {
  const key: string = LEDGER[i];
  let stillBad: boolean = false;
  for (let j = 0; j < failures.length; j++) {
    if (`${failures[j].theme}|${failures[j].fg}|${failures[j].bg}` === key) { stillBad = true; }
  }
  if (!stillBad) { fixedN++; console.log(`   ✅ 已修复，请从 LEDGER 移除：${key}`); }
}
console.log(`   台账 ${LEDGER.length} 项，其中已修复 ${fixedN} 项；判定共 ${PAIRS.length} 对`);

if (fail > 0) {
  console.log(`\n  theme_contrast: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n  theme_contrast: ${pass} passed, 0 failed`);
process.exit(0);
