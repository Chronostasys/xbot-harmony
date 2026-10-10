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
  Palette, Effects, ALL_THEMES, paletteOf, effectsOf, themeLabel,
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

/** 画布面（`appBg`..`surfaceHi` 都是**不透明**面；`glassBg` 是半透明 ⇒ 必须先合成）。 */
const CANVAS_FACES: string[] = [
  'appBg', 'surface', 'surfaceAlt', 'surfaceHi',
  'glassBg/appBg', 'glassBg/surface',
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
  // glassBg = surface@62%（Effects 派生）⇒ 真正决定可读性的是合成结果
  m['glassBg/appBg'] = compositeOver(e.glassBg, p.appBg);
  m['glassBg/surface'] = compositeOver(e.glassBg, p.surface);
  // 填充面（当底色用）
  m['accent'] = p.accent;
  m['accentDeep'] = p.accentDeep;
  m['warnBg'] = p.warnBg;
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
  // ── 根因 E：porcelain 的 `textMuted`（Apple tertiaryLabel #AEAEB2）压 surfaceHi(#EDEDEF)
  // 只有 1.89 < 2.0；压 accentDeep(#E8F1FD) 只有 1.94 < 2.0。**纯白族最弱的一档**。
  // surfaceHi 确实被当 Text 填充用（Index.ets:4553 channelLabel），故属潜在风险
  // （实测当前无 textMuted 直呼点，见 §D 报告）。
  // 最小改动建议：porcelain 的 textMuted 压深一档（如 #8E8E93，= 它自己的 statusIdle）。
  'porcelain|textMuted|surfaceHi',
  'porcelain|textMuted|accentDeep',
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

/** §B 判定用到的角色（前景 ∪ 背景）。 */
const JUDGED_ROLES: string[] = [
  'textPrimary', 'textSecondary', 'textMuted', 'accent', 'accentSoft',
  'dangerText', 'successText', 'warn', 'statusError', 'statusRunning',
  'onAccent', 'accentText', 'appBg', 'surface', 'surfaceAlt', 'surfaceHi',
  'accentDeep', 'warnBg',
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

// ════════════════════════════════════════════════════════════════════════════
// §E 报告（给设计决策看的真数据 —— 永远打印，不只在失败时）
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
