/**
 * 插件面 · 图标映射 parity 判据（波12，2026-10-11）。
 *
 * ── 为什么需要它（本仓血教训，与「取色 role 写错 = 运行时静默不可见」同类）────────
 *   `Text(...).fontColor(colorOf(p, '<不存在的 role>'))` 的兄弟形态：
 *   `SymbolGlyph($r('sys.symbol.<不存在的名字>'))` —— **符号名写错 = 运行时渲染空白**，
 *   编译零警告、其它测试一个都抓不到。本文件把"插件面用到的每个符号名"钉在**权威符号名册**上。
 *
 * ── 本轮修掉的**真实缺陷**（不是无病呻吟）────────────────────────────────────────
 *   ① `components/PluginsSheet.ets`（能力面板）原有一个 `pluginSymbolOrGrid`：**三条 return 全是
 *      `sys.symbol.square_grid_2x2`**（死分支）⇒ 面板里**每个插件都显示同一个图标**，且与
 *      `PluginHost` 目录的逐插件图标**不一致**。现改为消费 `PluginHost.pluginSymbol`（唯一出口）。
 *   ② `PluginHost.pluginSymbol` 原只覆盖 web `ICON_MAP` 19 键中的 14 键，`search`/`info`/`puzzle`
 *      因"没有已验证的 sys.symbol 名"而回落方块。本轮用**本机 SDK 权威名册离线实证**补上
 *      （`magnifyingglass` / `info_circle` / `puzzle`），并把**未知名回落**改成 `sys.symbol.puzzle`
 *      —— 与 web `pluginIcons.ts:76` 的 `Puzzle` 降级**同义**（此前用方块是当年没有已验证名的妥协）。
 *
 * ── 判据（均带零扫描防线；形态断言钉**调用点计数 / 逐名实证**，⛔ 不钉"方法体存在"）──────
 *   ① **唯一出口**：`PluginHost.ets` 导出 `pluginSymbol`；`PluginsSheet.ets` 的**调用点 ≥1**，
 *      且旧副本 `pluginSymbolOrGrid` **计数 = 0**（防"两份副本各自腐烂"）。
 *   ② **覆盖 web ICON_MAP 19 键**：每个 key 都是 `pluginSymbol` 分支里的**字面量**（⛔ 先剥注释，
 *      否则我上面那段注释里的 `search`/`info`/… 会**假绿**）；frozen 键表与**真源**
 *      `isKnownPluginIcon(key)` 双向一致。
 *   ③ **符号名实证**：三份插件组件里每个 `$r('sys.symbol.X')` 的 `X` 必须在**权威符号名册**里 ——
 *      存在本机 SDK ⇒ 实时查 `…/entry/resources.txt`（每行 `id:…, '0x…' 'name'`）；
 *      否则回落 **frozen verified 白名单**（每个值都写明 `0x` 码点来源）。
 *   ④ **mutation 自证**（两条）：
 *      (a) 抽掉 `search` 分支 ⇒ 判据②对 `search` 归属必红；
 *      (b) 把 `PluginsSheet` 的 `pluginSymbol(p.icon)` 换回本地 `pluginSymbolOrGrid` ⇒ 判据①消费点归零必红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 * ⚠️ 纯 TS（`export {}` + `declare require` 风格，照 `settings_notify_ui.test.ts`）。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; dirname(p: string): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare const console: { log(...a: unknown[]): void };

import { isKnownPluginIcon } from '../../entry/src/main/ets/core/pluginhost';
import { ALL_THEMES, isDarkThemeName, paletteOf } from '../../entry/src/main/ets/core/theme';
import { hairlineOf, structuralRuleOf } from '../../entry/src/main/ets/core/design';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function findRoot(start: string): string {
  let cur: string = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(cur, 'entry', 'src', 'main', 'ets'))) { return cur; }
    cur = path.join(cur, '..');
  }
  return '';
}
const ROOT: string = findRoot(__dirname);
const ETS: string = ROOT.length > 0 ? path.join(ROOT, 'entry', 'src', 'main', 'ets') : '';
const HOST: string = ETS.length > 0 ? path.join(ETS, 'components', 'PluginHost.ets') : '';
const SHEET: string = ETS.length > 0 ? path.join(ETS, 'components', 'PluginsSheet.ets') : '';
const WIDGETS: string = ETS.length > 0 ? path.join(ETS, 'components', 'PluginWidgets.ets') : '';

/** 剥注释（块 + 行）—— ⛔ 必须先剥，否则被注释掉的 key 会假绿（本仓血教训）。 */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function readRaw(p: string): string {
  return p.length > 0 && fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}
function readOr(p: string): string {
  return stripComments(readRaw(p));
}
/** 某片段的**出现次数**（字面子串，非正则 —— 避免元字符误伤）。 */
function countOf(src: string, marker: string): number {
  return marker.length === 0 ? 0 : src.split(marker).length - 1;
}
/** 取 `pluginSymbol` 的**函数体**（剥注释后）。 */
function pluginSymbolBody(src: string): string {
  const i: number = src.indexOf('export function pluginSymbol(');
  return i >= 0 ? src.substring(i) : '';
}

// ── 零扫描防线（扫不到文件却"全绿"是本仓反复踩过的假绿形态）────────────────────
eq('零扫描防线：仓库根解析成功（向上探到 entry/src/main/ets）', ROOT.length > 0, true);
const hostSrc: string = readOr(HOST);
const hostRaw: string = readRaw(HOST);
const sheetSrc: string = readOr(SHEET);
const widgetsSrc: string = readOr(WIDGETS);
eq('零扫描防线：含 components/PluginHost.ets', hostSrc.length > 0, true);
eq('零扫描防线：含 components/PluginsSheet.ets', sheetSrc.length > 0, true);
eq('零扫描防线：含 components/PluginWidgets.ets', widgetsSrc.length > 0, true);

// ── 判据 ①：图标映射**唯一出口**（PluginHost 导出 / PluginsSheet 消费 / 旧副本归零）────
const hostBody: string = pluginSymbolBody(hostSrc);
{
  eq('① 零扫描防线：pluginSymbol 函数体非空', hostBody.length > 0, true);
  eq('① PluginHost 导出 pluginSymbol（唯一出口）',
    hostSrc.indexOf('export function pluginSymbol(') >= 0, true);
  // ★ 消费点计数（⛔ 不钉"方法体存在"）：能力面板必须真调用它
  eq('① PluginsSheet 消费 pluginSymbol(p.icon) 的调用点 ≥1',
    countOf(sheetSrc, 'pluginSymbol(p.icon)') >= 1, true);
  // 旧副本必须已删除（否则两份映射各自腐烂 ⇒ 同一插件两处图标不一致）
  eq('① 旧副本 pluginSymbolOrGrid 计数 = 0（已删）',
    countOf(sheetSrc, 'pluginSymbolOrGrid'), 0);
  eq('① PluginsSheet 不再硬编码 square_grid_2x2', countOf(sheetSrc, 'square_grid_2x2'), 0);

  // ── ①b 行形态统一（2026-10-12 目标③ 第八批）────────────────────────────────────
  // 真机帧：能力面板里**入口行没有图标**、插件行有图标 ⇒ 同一张表里两种行形（前 3 行看着"没画完"）。
  // 契约：两类行统一为 [图标 → 标题 → 尾部 chevron]；且**不得**再出现 accent 文字动作词「打开」
  // （一张表里 6 个同色动作词既噪、又把"整行可点"读成"两个按钮"）。
  // ⚠️ 断言串一律取**带前缀的代码形态**（`EntryRow(` / `Text(`），⛔ 不取裸词 —— 否则实现注释里
  //    记录该词的那段会**假红**（本仓既有教训：形态/缺席断言必须在代码形态上做）。
  eq('①b 入口行收图标参数（EntryRow 签名）',
    countOf(sheetSrc, 'EntryRow(label: string, sym: Resource, onClick: () => void)'), 1);
  eq('①b 五条入口行都传了图标（调用点 = 5 = PANEL_FIXED_ENTRY_ROWS）', countOf(sheetSrc, "this.EntryRow('"), 5);
  eq('①b 尾部动作统一为 chevron（两类行各 1 处 = 2）',
    countOf(sheetSrc, "$r('sys.symbol.chevron_right')"), 2);
  eq('①b ⛔ 不再有文字动作词「打开」', countOf(sheetSrc, "Text('打开')"), 0);

  // ── ①d §21.115 能力面板精修（分组头 / 图标同轴 / 发丝内缩）─────────────────────────
  // ① 分组头「插件」：把 5 个原生入口与插件卡**分组可读**（Apple 分组列表语言）。
  //    ⛔ 保留 Git 固定入口（契约见 `git_panel.test.ts` ①）⇒ 这里钉"仍恰 1 处"。
  eq('①d 分组头「插件」恰 1 处', countOf(sheetSrc, "Text('插件')"), 1);
  eq('①d Git 固定入口保留（契约在 git_panel.test.ts）',
    countOf(sheetSrc, "this.EntryRow('Git 面板（原生）'"), 1);
  // ② 前导图标与首行标题**同轴**：插件行 `Row` 顶部对齐（+ 图标槽 = 标题行高）。
  eq('①d 插件行顶部对齐（图标与首行标题同轴）',
    countOf(sheetSrc, '.alignItems(VerticalAlign.Top)') >= 1, true);
  eq('①d 图标槽高 = 标题行高（lh(type.callout)）',
    countOf(sheetSrc, ".height(lh('type.callout'))") >= 2, true);
  // ③ 发丝内缩到**正文起点**（Apple insetGrouped 的 inset separator：线不穿过前导字形）。
  eq('①d 行内发丝 startMargin 内缩到文本列',
    countOf(sheetSrc, 'startMargin: INSET_ROW_X + PLUGIN_ICON + SPACE_XS'), 1);
  // 说明段（"原生渲染聊天主链路；…"）已删：它**不准**（`插件目录（原生）`/`会话统计` 是原生渲染，
  // 不属"由 ArkWeb 承载"），且 Apple 的用户面弹层不解释渲染架构（各行标签已自带该信息）。
  eq('①b ⛔ 已删实现说明段', countOf(sheetSrc, "Text('原生渲染聊天主链路"), 0);

  // ── ①c 行体 = **扁平行 + 行内发丝**（2026-10-13 目标③「对标苹果」）──────────────────
  // 真机截图：能力面板 9 条**同形卡片**（面 + 圆角 + 描边 + 行间距）读作"一堆圆角块" ⇒ 分组层级消失。
  // Apple 的分组列表 = **一张容器 + 行内发丝**；同 App 的「文件」面板（`FilesSheet`）与会话抽屉
  // 早已是这一形态 ⇒ 本面板收敛到**同一形态**（三个列表一个长相）。
  // ⛔ 只钉"行卡是否退场"会假绿（可能只是没写）⇒ 必须**同时**钉"行内发丝在"（正反两面）。
  {
    const rowCards: number = countOf(sheetSrc, 'surfaceFillOf(this.pal(), SURFACE_CARD))');
    eq('①c 面板行**不再是卡**（行卡面恰剩 1 处 = 状态行的「重试」动作按钮）', rowCards, 1);
    // ⛔ 断言一律取**调用形态**（不是裸 token）：裸 `RADIUS_CARD` / `GAP_ROW_Y` 会**连 import 行一起数**，
    //    那样"行体退场"会因 import 仍在而**假红**（本仓"取整行/取裸词"的同类教训）。
    eq('①c ⛔ 行级圆角已退场（`.borderRadius(RADIUS_CARD)` 只剩「重试」那一处）',
      countOf(sheetSrc, '.borderRadius(RADIUS_CARD)'), 1);
    eq('①c ⛔ 行间距已退场（`.margin({ bottom: GAP_ROW_Y })` = 0 —— 行与行靠发丝分隔，不靠空隙）',
      countOf(sheetSrc, '.margin({ bottom: GAP_ROW_Y })'), 0);
    eq('①c ⛔ 行级面→面描边已退场（只剩「重试」那一处）',
      countOf(sheetSrc, '.border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })'), 1);
    // 正面判据：`List` 级 `.divider(...)` 必须在，且左缘**内缩到文字起点**（Apple 的 inset separator）
    // ⚠️ §21.115：内缩量从 `INSET_ROW_X` 改为 `INSET_ROW_X + PLUGIN_ICON + SPACE_XS`（线从**正文**
    //    起画）⇒ 本处只钉**前缀**（发丝在 + startMargin 已设），精确形态由 ①d 钉。
    eq('①c 行内发丝在（`List.divider` + startMargin 已设）',
      countOf(sheetSrc, '.divider({ strokeWidth: STROKE_HAIRLINE, color: hairlineOf(this.pal()), startMargin: INSET_ROW_X'), 1);
    eq('①c 两类行统一走"无竖向内距"的行体内距 = 2（入口行 + 插件行）',
      countOf(sheetSrc, 'padding({ left: INSET_ROW_X, right: INSET_ROW_X })'), 2);
    // 同源对照：`FilesSheet`（形态基准）用的是**同一句**（若将来改基准，两处必须同时改）
    const filesSrc: string = readOr(path.join(ETS, 'components', 'FilesSheet.ets'));
    eq('①c 零扫描防线：含 components/FilesSheet.ets', filesSrc.length > 0, true);
    eq('①c 与「文件」面板同形（同一条 `startMargin` 口径）',
      filesSrc.indexOf('startMargin: INSET_ROW_X') >= 0, true);
  }
}

// ── 判据 ②：覆盖 web `ICON_MAP` 19 键（与真源 isKnownPluginIcon 双向一致）────────────
/** web `plugin-runtime/pluginIcons.ts:30-56` 的 `ICON_MAP` 键（19，逐字冻结快照）。 */
const WEB_ICON_KEYS: string[] = [
  'blocks', 'boxes', 'chart', 'code', 'puzzle', 'sparkles', 'wrench', 'message',
  'files', 'search', 'info', 'tasks', 'terminal', 'activity',
  'git-branch', 'git-commit-horizontal', 'git', 'server', 'server-cog',
];
{
  eq('② 零扫描防线：冻结键表 = 19 键（与 web ICON_MAP 同长）', WEB_ICON_KEYS.length, 19);
  let covered: number = 0;
  for (const k of WEB_ICON_KEYS) {
    // (a) 真源一致：core/pluginhost 的 PLUGIN_ICON_KEYS 认这个名字
    eq(`② 真源认键 '${k}'（isKnownPluginIcon）`, isKnownPluginIcon(k), true);
    // (b) 渲染层覆盖：pluginSymbol 分支里有这个**字面量**（键可能长于 1 段，用带引号整体匹配）
    const hit: boolean = hostBody.indexOf(`'${k}'`) >= 0;
    if (hit) { covered++; }
    eq(`② pluginSymbol 分支覆盖 '${k}'`, hit, true);
  }
  eq('② 零扫描判红：覆盖数 > 0', covered > 0, true);
  eq('② 全量覆盖：19/19', covered, 19);
}

// ── 判据 ③：符号名实证（防"符号名写错 ⇒ 运行时静默空白"）────────────────────────
/**
 * frozen verified 白名单 —— 每个名字都在**本机 OHOS SDK 的权威符号名册**里逐名 `0x` 命中：
 * `…/default/openharmony/previewer/common/resources/entry/resources.txt`
 * （行形如 `id:125831320, '0xF04A0' 'puzzle'`）。⛔ 新增名字必须同样实证后再登记。
 */
const VERIFIED: Record<string, string> = {
  rectangle_on_rectangle: '0xF04A2', circle_dashed: '0xF0134', line_3_horizontal: '0xF013F',
  doc_text: '0xF0A3B', list_bullet: '0xF0A91', lightbulb: '0xF029C', gearshape: '0xF0020',
  square_grid_2x2: '0xF00E3', magnifyingglass: '0xF0029', info_circle: '0xF0296',
  puzzle: '0xF04A0', xmark: '0xF0056',
  // 「Git 面板（原生）」入口行（2026-10-13）—— git 语义符号。
  // ⛔ 首版误用 `arrow_branch`（**不在名册**，真机会静默空白）⇒ 改为实证名 `arrow_triangle_merge`。
  arrow_triangle_merge: '0xF0347',
};
/** 尽力找本机 SDK 名册（找到 ⇒ 任何名册内的名字都放行；找不到 ⇒ 只用 frozen 白名单）。 */
function liveSymbolNames(): Record<string, boolean> {
  const cands: string[] = [];
  const roots: Array<string | undefined> = [
    process.env.DEVECO_SDK_HOME, process.env.HOS_SDK_HOME, process.env.OHOS_SDK_HOME,
  ];
  for (const r of roots) {
    if (r !== undefined && r.length > 0) {
      cands.push(path.join(r, 'default/openharmony/previewer/common/resources/entry/resources.txt'));
    }
  }
  const home: string | undefined = process.env.HOME;
  if (home !== undefined && home.length > 0) {
    cands.push(path.join(home, 'ohos-cli/command-line-tools/sdk/default/openharmony/previewer/common/resources/entry/resources.txt'));
    cands.push(path.join(home, 'Library/OpenHarmony/Sdk/default/openharmony/previewer/common/resources/entry/resources.txt'));
  }
  const out: Record<string, boolean> = {};
  for (const c of cands) {
    if (fs.existsSync(c)) {
      const txt: string = fs.readFileSync(c, 'utf-8');
      const re: RegExp = /'0x[0-9A-Fa-f]+' '([a-z0-9_]+)'/g;
      let m: RegExpExecArray | null = re.exec(txt);
      while (m !== null) { out[m[1]] = true; m = re.exec(txt); }
      if (Object.keys(out).length > 0) { break; }
    }
  }
  return out;
}
{
  const live: Record<string, boolean> = liveSymbolNames();
  const liveCount: number = Object.keys(live).length;
  console.log(`  ℹ️  SDK 权威名册：${liveCount > 0 ? `已实时加载 ${liveCount} 个符号名` : '未找到 ⇒ 仅用 frozen 白名单'}`);
  // 三份插件组件里用到的**全部** `sys.symbol.X`
  const files: Array<[string, string]> = [
    ['PluginHost.ets', hostSrc], ['PluginsSheet.ets', sheetSrc], ['PluginWidgets.ets', widgetsSrc],
  ];
  const used: Record<string, boolean> = {};
  for (const [name, src] of files) {
    const re: RegExp = /sys\.symbol\.([a-z0-9_]+)/g;
    let m: RegExpExecArray | null = re.exec(src);
    while (m !== null) {
      used[m[1]] = true;
      eq(`③ 零扫描防线：${name} 的符号名非空`, m[1].length > 0, true);
      const ok: boolean = VERIFIED[m[1]] !== undefined || (liveCount > 0 && live[m[1]] === true);
      eq(`③ 符号名实证：sys.symbol.${m[1]}（${name}）`, ok, true);
      m = re.exec(src);
    }
  }
  const usedCount: number = Object.keys(used).length;
  eq('③ 零扫描判红：插件面用到的符号名数 > 0', usedCount > 0, true);
  // 本轮新增的 3 名必须真的落进渲染层（否则"补了映射"是假的）
  eq('③ 本轮新增 magnifyingglass 已接线', countOf(hostSrc, 'sys.symbol.magnifyingglass') >= 1, true);
  eq('③ 本轮新增 info_circle 已接线', countOf(hostSrc, 'sys.symbol.info_circle') >= 1, true);
  eq('③ 本轮改的未知名回落 = sys.symbol.puzzle', countOf(hostSrc, 'sys.symbol.puzzle') >= 1, true);
}

// ── 判据 ④：mutation 自证 ───────────────────────────────────────────────────────
{
  // (a) 抽掉 `search` 分支 ⇒ 判据②对 'search' 的覆盖必红
  const marker: string = "k === 'search'";
  const before: number = countOf(hostBody, marker);
  const mutated: string = hostBody.split(marker).join("k === 'nope'");
  eq('④(a) 前置条件：真源含 search 分支', before >= 1, true);
  eq('④(a) 抽掉 search 分支后 ⇒ 覆盖断言会红（字面量消失）',
    mutated.indexOf("'search'") >= 0, false);
  eq('④(a) 反向对照：未注入时覆盖仍在', hostBody.indexOf("'search'") >= 0, true);

  // (b) 把能力面板换回本地副本 ⇒ 判据①消费点归零 ⇒ 必红
  const consumed: number = countOf(sheetSrc, 'pluginSymbol(p.icon)');
  const reverted: string = sheetSrc.split('pluginSymbol(p.icon)').join('pluginSymbolOrGrid(p.icon)');
  eq('④(b) 前置条件：PluginsSheet 真消费 pluginSymbol', consumed >= 1, true);
  eq('④(b) 换回本地副本后 ⇒ 消费点计数 = 0 ⇒ 判据①会红',
    countOf(reverted, 'pluginSymbol(p.icon)'), 0);
}

// ── 判据 ⑤：Task B 层次一致性（PluginHost 卡片面/药丸分工 + :47 注释不自相矛盾）──────────
// ⚠️ 与 `porcelain_layering.test.ts ★④` 有意重叠（那支管三文件总分布，本支管"注释 vs 代码"）。
{
  eq('⑤ PluginHost 卡片面（RADIUS_CARD）走 structuralRuleOf ×2',
    countOf(hostSrc, 'structuralRuleOf(this.pal())'), 2);
  eq('⑤ PluginHost 面内「打开」药丸仍走 hairlineOf ×1（面内控件，⛔ 不误改）',
    countOf(hostSrc, 'hairlineOf(this.pal())'), 1);
  // 旧注释曾把**卡片面**说成 `hairlineOf`（与 :362/:426 的代码相反）⇒ 必须已订正
  // ⚠️ 注释断言必须读**未剥注释**的原文（hostRaw），否则扫不到。
  eq('⑤ :47 注释已订正（卡片面 = structuralRuleOf）',
    hostRaw.indexOf('**结构性轮廓** `structuralRuleOf`') >= 0, true);
  eq('⑤ :47 旧表述（卡片面 = 结构性发丝 hairlineOf）已消失',
    hostRaw.indexOf('**结构性发丝** `hairlineOf` + `RADIUS_CARD`') >= 0, false);
}

// ── 判据 ⑥：E1 的**深色逐字节不变**证据（Task B 要求；可脱机重放）────────────────────
// 规则（`docs/DESIGN-SYSTEM.md §13.4/§13.5`）：`structuralRuleOf` 深色臂 = `p.border`，
// `hairlineOf` 深色臂 = `surfacesOf(p).hairline` ⇒ 深色下二者**必须逐字节相等**（改浅色不动深色）；
// 浅色下 `structuralRuleOf` = `p.borderStrong`（强一档）⇒ 两者**必须不同**。
// ⚠️ 这条是本轮"改浅色不碰深色"的**机器证据**（不靠肉眼看截图）。
{
  let dark = 0, light = 0;
  for (const t of ALL_THEMES) {
    const p = paletteOf(t);
    const hr: string = hairlineOf(p);
    const sr: string = structuralRuleOf(p);
    if (isDarkThemeName(t)) {
      dark++;
      eq(`⑥ 深色主题 '${t}'：structuralRuleOf === hairlineOf（逐字节零变化）`, sr, hr);
    } else {
      light++;
      eq(`⑥ 浅色主题 '${t}'：structuralRuleOf ≠ hairlineOf（强一档）`, sr === hr, false);
    }
  }
  eq('⑥ 零扫描判红：校验到的深色主题数 ≥3', dark >= 3, true);
  eq('⑥ 零扫描判红：校验到的浅色主题数 ≥1', light >= 1, true);
}

if (fail > 0) { console.log(`  ✗ plugin_icons: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ plugin_icons: ${pass} passed, 0 failed`);
process.exit(0);
