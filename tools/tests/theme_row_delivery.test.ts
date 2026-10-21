/**
 * 回归复现（用户 2026-10-11 亲报）：**浅色主题下「历史消息」正文仍是白色**（白底白字不可读）；
 * **live 尾部那条正常**。
 *
 * ── 根因（ArkUI V1 语义 + 本仓既有铁律）───────────────────────────────────────
 *   · 历史行由 `LazyForEach(this.rowDs, …, sessionScopedRowKey)` 承载；其 item builder
 *     **只在行键（`chatId#id#rev`）变化时**才重新执行（`core/rowdiff.ets` 的 `changedByKeys`/
 *     `needsFullReload` 是**唯一**的“哪一行变了”判据）。
 *   · 主题变更（`themeName`）**不改变任何行键** ⇒ `applyRows` **零通知** ⇒ `LazyForEach`
 *     保留已构建条目 ⇒ 行的 `@Prop theme` **冻结在创建那刻**（默认 `'dark'`）⇒ 取深色调色板
 *     = 白字（浅底不可读）。
 *   · live 行在 `LazyForEach` **之外**（页面 `LiveRowBody()`）⇒ 每次页面 build 都拿当前主题 ⇒ 正常。
 *   ⇒ 这个「历史 vs live」的**不对称**正是用户看到的现象。
 *
 * ── 本测试 ─────────────────────────────────────────────────────────────────
 *   纯逻辑测试**测不到 ArkUI 响应式** ⇒ 两条腿：
 *   ① **形态断言**（扫**真实源码**）：主题变更**能到达已存在行**必须有**具体机制** ——
 *      要么行声明了 `@StorageProp('appTheme')` 订阅，要么主题写入路径上有显式全量刷新。
 *      **零扫描判红**（regex 找不到 ⇒ 假绿防线）。
 *   ② **语义断言**（纯函数）：`paletteOf('porcelain')` 与 `paletteOf('dark')` 取色不同，且
 *      “用**创建时快照**取色”与“用**当前**主题取色”结果不同 —— 前者是**白底白字**（对比度 < 2），
 *      后者可读（≥ 4.5）。把这个不变式写成可测函数。
 *
 *   mutation 自证：把订阅机制改回“只靠 @Prop 投递”（删 `@StorageProp('appTheme')` / 把 resolver
 *   改回 `this.theme`）⇒ 形态断言必红；还原 ⇒ 绿。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { paletteOf, contrastRatio } from '../../entry/src/main/ets/core/theme';
import { appPaletteForMdTheme } from '../../entry/src/main/ets/core/mdtheme';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${label}: ${detail}`);
  }
}

/**
 * **剥注释**（本仓约定：注释里记代码片段/色值是**允许且鼓励**的 ⇒ 扫源码前**必须**先剥，
 * 否则要求串只在注释里出现 ⇒ **假绿**）。⚠️ 保留换行 ⇒ 行号不漂移。
 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}

// ─────────────── 生产接线判定（读真实源码；客观、不依赖模型） ───────────────

interface Wiring {
  indexPublishesTheme: boolean;   // Index 把 themeName 同步进 AppStorage（@StorageLink('appTheme')）
  rowSubscribesTheme: boolean;    // MessageRowView 声明 @StorageProp('appTheme')
  rowResolvesTheme: boolean;      // 取色走 resolver（appTheme 优先），不再是裸 this.theme
  userBubbleSubscribes: boolean;  // UserBubbleView 声明 @StorageProp('appTheme')
  userBubbleResolves: boolean;
  mdSubscribesTheme: boolean;     // MarkdownView 声明 @StorageProp('appTheme')
  liveSubscribes: boolean;        // LiveTailView 声明 @StorageProp('appTheme')
  rowKeyHasTheme: boolean;        // LazyForEach 行键含主题（themableRowKey）—— 2026-10-13 第二轮根因
  dsReloadsOnTheme: boolean;      // 数据源在主题变化时整表 reload（键变了必须让框架重读键）
  singleThemeSource: boolean;     // 应用色板**派生**自 md 主题（唯一主题设置）
}

function readWiring(): Wiring {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..', '..', '..');   // <repo>/tools/tests/.out-one/js → 4 级
  const comp = (name: string): string => stripSrc(fs.readFileSync(
    path.join(root, 'entry', 'src', 'main', 'ets', 'components', name + '.ets'), 'utf-8'));
  const indexSrc: string = stripSrc(fs.readFileSync(
    path.join(root, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'), 'utf-8'));
  const rowSrc: string = comp('MessageRow');
  const userSrc: string = comp('UserBubble');
  const mdSrc: string = comp('MarkdownView');
  const liveSrc: string = comp('LiveTailView');

  const subTheme = (src: string): boolean => /@StorageProp\(\s*'appTheme'\s*\)/.test(src);
  const resolver = (src: string): boolean =>
    /this\.appTheme\.length\s*>\s*0\s*\?\s*this\.appTheme\s*:\s*this\.theme/.test(src);
  return {
    indexPublishesTheme: /@StorageLink\(\s*'appTheme'\s*\)/.test(indexSrc),
    rowSubscribesTheme: subTheme(rowSrc),
    rowResolvesTheme: resolver(rowSrc) && /paletteOf\(\s*this\.themeId\(\)\s*\)/.test(rowSrc),
    userBubbleSubscribes: subTheme(userSrc),
    userBubbleResolves: resolver(userSrc) && /paletteOf\(\s*this\.themeId\(\)\s*\)/.test(userSrc),
    mdSubscribesTheme: subTheme(mdSrc),
    liveSubscribes: subTheme(liveSrc),
    // LazyForEach 的 key 生成器必须把主题带上（真源 = `core/rowdiff.themableRowKey`）
    rowKeyHasTheme: /themableRowKey\(\s*this\.currentChat\s*,\s*this\.themeName\s*,\s*row\s*\)/.test(indexSrc),
    // 数据源必须在主题变化时整表 reload（键变了 ⇒ 必须让框架重读键/重建条目）
    dsReloadsOnTheme: /applyRows\(\s*next:\s*ChatRow\[\]\s*,\s*chatId:\s*string\s*,\s*theme:\s*string\s*\)/.test(indexSrc)
      && /(const\s+themeChanged\s*:\s*boolean\s*=\s*theme\s*!==\s*this\.theme|\|\|\s*theme\s*!==\s*this\.theme)/.test(indexSrc),
    // 应用色板必须**派生**自 md 主题（唯一主题设置），而不是读第二套 KEY_APP_THEME
    // 2026-10-13：标识改由 `renderThemeKey(色板名, 强调色)` 组装（强调色必须进**可观察真源**，
    // 否则改强调色全站零重渲染 —— 用户亲报「配色根本没起作用」）。仍**唯一派生自 md 主题**。
    singleThemeSource: /this\.themeName\s*=\s*renderThemeKey\(\s*appPaletteForMdTheme\(/.test(indexSrc),
  };
}

// ─────────────── 语义模型（把不变式写成可测函数）───────────────────────────────

/**
 * 行取色所用的主题。
 *   · `subscribes === true`（生产：行声明 `@StorageProp('appTheme')`）⇒ 跟随**当前**主题；
 *   · `false`（旧形态：只靠创建时 `@Prop` 快照）⇒ **冻结在创建那一刻**（`createdWith`）。
 * 这正是“历史行 vs live 行”在主题变更后的分叉。
 */
function rowTheme(createdWith: string, current: string, subscribes: boolean): string {
  return subscribes ? current : createdWith;
}

// ─────────────── 主流程 ───────────────

function main(): void {
  const w: Wiring = readWiring();
  console.log('\n▶ 主题投递：浅色历史白字回归');
  console.log(`   [源码判据] Index@StorageLink=${w.indexPublishesTheme}`
    + ` 行订阅=${w.rowSubscribesTheme} 行resolver=${w.rowResolvesTheme}`
    + ` 用户气泡订阅=${w.userBubbleSubscribes} md订阅=${w.mdSubscribesTheme}`
    + ` live订阅=${w.liveSubscribes}`);

  // ── ① 形态：主题变更必须能到达“已存在行” ────────────────────────────────
  check('F1 Index 把主题同步进 AppStorage（@StorageLink(\'appTheme\')）', w.indexPublishesTheme,
    '主题没有可被行订阅的全局通道 ⇒ 变更只能靠 LazyForEach 重投递 @Prop（历史行收不到）');
  check('F2 MessageRowView 订阅 @StorageProp(\'appTheme\')', w.rowSubscribesTheme,
    '历史行（LazyForEach 条目）没有自己订阅主题 ⇒ @Prop theme 冻结在创建那刻 = 浅色下白字');
  check('F3 MessageRowView 取色走 resolver（appTheme 优先，非裸 this.theme）', w.rowResolvesTheme,
    '订阅值没被真正消费（pal() 仍读裸 @Prop）⇒ 订阅形同虚设');
  check('F4 UserBubbleView 订阅 @StorageProp(\'appTheme\') 且取色走 resolver',
    w.userBubbleSubscribes && w.userBubbleResolves, '用户气泡同样受 LazyForEach 冻结（同罪）');
  check('F5 MarkdownView 订阅 @StorageProp(\'appTheme\')', w.mdSubscribesTheme,
    '正文实际取色点没订阅 ⇒ 历史正文仍可能冻结');
  check('F6 LiveTailView 订阅 @StorageProp(\'appTheme\')', w.liveSubscribes,
    'live 行为同一机制的一致性订阅');

  // ── ①b 形态：**主题必须进 LazyForEach 的行键**（2026-10-13 用户亲报「深色 theme 看不清字」）──
  //    行内任何取色点（含第三方子组件、带参 @Builder 子树 —— 后者参数是快照）都躲不掉
  //    「条目只在键变化时重建」这条框架语义。✅ 正解 = 让主题变更本身成为一次行身份变更。
  check('F7 LazyForEach 行键含主题（themableRowKey(currentChat, themeName, row)）', w.rowKeyHasTheme,
    '主题不进键 ⇒ 主题变更零通知 ⇒ 已存在行冻结在创建那刻的色板（深色下暗字、浅色下白字）');
  check('F8 数据源 applyRows 接收主题并在变化时整表 reload', w.dsReloadsOnTheme,
    '键已变却不 reload ⇒ 框架不重读键 ⇒ 只有可见行的键变了、条目仍是旧色板');
  check('F9 应用色板派生自 md 主题（唯一主题设置，无第二套 KEY_APP_THEME）', w.singleThemeSource,
    '两套主题真源 ⇒ 用户报「你搞出两种主题设置是错的」（web 权威 modeForTheme(mdTheme)）');

  // ── ② 语义：快照取色 vs 当前取色 ────────────────────────────────────────
  const dark = paletteOf('dark');
  const porcelain = paletteOf('porcelain');
  check('S1 浅色与深色正文色不同', dark.textPrimary !== porcelain.textPrimary,
    `dark=${dark.textPrimary} porcelain=${porcelain.textPrimary}`);

  // 旧形态（不订阅）：行用**创建时**主题（dark）取色 ⇒ 在浅色画布上是“白底白字”。
  const staleText: string = paletteOf(rowTheme('dark', 'porcelain', false)).textPrimary;
  // 修复（订阅）：行用**当前**主题（porcelain）取色 ⇒ 可读。
  const freshText: string = paletteOf(rowTheme('dark', 'porcelain', true)).textPrimary;
  check('S2 “创建时快照”与“当前主题”取色结果不同', staleText !== freshText,
    `两者相同 ⇒ 说明主题根本没到行上`);
  const staleContrast: number = contrastRatio(staleText, porcelain.appBg);
  const freshContrast: number = contrastRatio(freshText, porcelain.appBg);
  check('S3 快照取色 = 白底白字（对比度 < 2，不可读）', staleContrast < 2.0,
    `深色正文色压在浅色画布上对比度=${staleContrast.toFixed(2)}（预期 ≈1）`);
  check('S4 当前主题取色可读（对比度 ≥ 4.5）', freshContrast >= 4.5,
    `浅色正文对比度=${freshContrast.toFixed(2)}`);

  // ── ③ 语义：**唯一主题设置**的派生（md 主题 → 应用色板）────────────────────
  check('S5 md 主题 → 应用色板的派生（light/dark/两个品牌主题/未知回落）',
    appPaletteForMdTheme('github-light') === 'light'
    && appPaletteForMdTheme('vscode-dark') === 'dark'
    && appPaletteForMdTheme('monokai') === 'dark'
    && appPaletteForMdTheme('xbot-aurora') === 'aurora'
    && appPaletteForMdTheme('xbot-nebula') === 'nebula'
    && appPaletteForMdTheme('不存在的主题') === 'dark',
    `未知 id 必须回落默认主题的色板（默认 vscode-dark ⇒ dark），实测=${appPaletteForMdTheme('不存在的主题')}`);
  // 派生出来的色板必须**可读**（否则「唯一主题设置」会把用户带进不可读状态）
  const derivedLight: string = appPaletteForMdTheme('one-light');
  check('S6 派生色板的正文可读（≥ 4.5）',
    contrastRatio(paletteOf(derivedLight).textPrimary, paletteOf(derivedLight).appBg) >= 4.5,
    `派生色板 ${derivedLight} 的正文对比度=${contrastRatio(paletteOf(derivedLight).textPrimary, paletteOf(derivedLight).appBg).toFixed(2)}`);

  console.log(`\n  theme_row_delivery: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();

export {};
