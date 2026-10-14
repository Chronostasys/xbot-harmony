/**
 * 「会话状态弹层 + 抽屉会话列表」层次契约测试（任务5 靶子3/4）。
 *
 * 靶子3（会话状态弹层）：弹层曾整体渲染 `statusBarText()` —— 它是「模型 · 用量 · todos · cwd」
 *   四段拼接，而模型 / 工作路径在下方**各有专属行** ⇒ 同一信息两处（"不干净"）。本波改为
 *   逐项成行，排版口径 = web `SessionInfo.tsx` 的 `InfoRow`：**标签左、值右**。
 * 靶子4（抽屉）：组头此前与行内次级文字同为 regular，读不出层次 ⇒ 补半档字重（web `font-semibold`）；
 *   会话行 `[徽标] chat_id` 在"无自定义标题"时与上一行标题**同串**（如 `web-4` / `Web web-4`）
 *   ⇒ 仅当 id ≠ 标题时才补 id。
 *
 * 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译，`pages/**` 不进这套
 * harness ⇒ 页面层无法直接 import 单测。先例见 `tools/tests/inflight_language.test.ts`。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

// 让本文件成为**模块**（否则顶层 `pass/fail/ok/…` 落进全局作用域，与其它同类测试文件冲突：
// TS6200/TS2393）。有 import 的测试天然是模块；本文件只用 `require`，故显式 `export {}`。
//
// 反查真源：组头"层次"的断言要能**真正**判定"字重比正文重半档"，而不是只匹配源码字符串
// ⇒ 引入 `core/design.ets` 的 `typeOf`（`run-one.sh`/`run.sh` 会把该路径 sed 成本目录的 `./`）。
import { typeOf, MARKER_GUTTER, SPACE_XS, SPACE_HAIR } from '../../entry/src/main/ets/core/design';
export {};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
// mutation 自证：可用 SSD_INDEX_SRC / SSD_STATUS_SRC 指向**副本**（⛔ 不改真树即可证红）。
function srcPath(envName: string, rel: string): string {
  const v: string | undefined = process.env[envName];
  return v !== undefined && v.length > 0 ? v : pathMod.join(repoRoot, rel);
}
const indexSrc: string = fsMod.readFileSync(srcPath('SSD_INDEX_SRC',
  'entry/src/main/ets/pages/Index.ets'), 'utf-8');
// ⚠️ 2026-10-11（P1 拆分后）：`StatusSheet` 已从 `pages/Index.ets` 抽为
//    `components/StatusSheet.ets`（判据留页面、组件只吃 `@Prop` 字符串 + 回调，
//    见 `docs/INDEX-SPLIT-PLAN.md` §5）⇒ 状态弹层的结构断言改读**组件源码**。
const statusSrc: string = fsMod.readFileSync(srcPath('SSD_STATUS_SRC',
  'entry/src/main/ets/components/StatusSheet.ets'), 'utf-8');
// 令牌真源（§4f 的 `MARKER_GUTTER` 派生式断言要读它）：`design.ets` 是纯 `.ets` 但**无 ArkUI 全局**
// ⇒ 可直接读数；⛔ 不改成"猜值"（猜值 = 判据与真源脱钩）。
const designSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry/src/main/ets/core/design.ets'), 'utf-8');

/** 从锚点 A 到锚点 B 之间的源码片段（找不到返回空串）。 */
function between(src: string, a: string, b: string): string {
  const i = src.indexOf(a);
  if (i < 0) { return ''; }
  const j = src.indexOf(b, i);
  return j < 0 ? '' : src.substring(i, j);
}

// ── 靶子3：会话状态弹层（标签左 / 值右，每项仅一次）──────────────────────────────
// ⚠️ 旧锚点 `between(indexSrc, 'StatusSheet() {', '.transition(this.sheetTransition())')` 已失效：
//    P1 后 `StatusSheet` 不在 `Index.ets`（且页面过渡改调 `sheetTransition()`，不再有 `this.`）
//    ⇒ 旧期望（"这段源码在页面里"）不再是契约；契约改为"组件渲染逐项行 + 页面喂权威用量值"。
const sheet: string = statusSrc;
ok('StatusSheet 可定位', sheet.length > 200);
hasNot(sheet, 'statusBarText',
  '弹层不再整体渲染 statusBarText()（其含 model/cwd ⇒ 与下方专属行重复）');
// ⚠️ 2026-10-11（本波重排）：三行改成**共享行原语** `StatusInfoRow` 承载（`label:` 参数 =
//    '用量'/'模型'/'工作路径'），⛔ 不再是页内 `Text('用量')` 字面量。旧 pin 钉的是"某处出现
//    `Text('用量')`"（实现细节），已失效；改为钉**语义 + 判别力**：同一行原语承载 + 标签左/值右
//    由**渲染顺序**（label 的 Text 在 value 之前）与**值右对齐**共同保证。
has(sheet, "label: '用量'", '用量成行（走 StatusInfoRow 行原语）');
has(sheet, "label: '模型'", '模型成行（走 StatusInfoRow 行原语）');
has(sheet, "label: '工作路径'", '工作路径成行（走 StatusInfoRow 行原语）');
has(sheet, 'textAlign(TextAlign.End)', '值右对齐（web InfoRow 口径：标签左、值右）');
ok('标签左 / 值右（行内 label 先于 value 渲染）',
  sheet.indexOf('Text(this.label)') >= 0
    && sheet.indexOf('Text(this.label)') < sheet.indexOf('Text(this.value)'));
// 权威用量值契约（拆分后）＝ 组件接收 `@Prop usageText` ⊕ 页面把 `usageText(this.usage)` 喂进去。
// 两处合起来 ⇔ 旧的 `has(sheet, 'usageText(this.usage)')`（当时在同一段源码里）。
has(sheet, '@Prop usageText', '组件用量走 @Prop usageText（判据不入组件）');
has(indexSrc, 'usageText: usageText(this.usage)', '页面喂入服务端权威用量值（usageText），不本地推算');

// ── 靶子4a：组头层次（web 是 font-semibold；中文以字重补半档）────────────────────
// ⚠️ anchor 2026-10-11 更新：sidebar-ux 的 DrawerSheet 重排（`bce3dcf`）把徽标圆角 `8` 换成
//    语义令牌 `RADIUS_PILL`（= `R_LG` = 8，**同值**）⇒ 旧 anchor 失效、`between` 返回空串（假红）。
// ⚠️ anchor 2026-10-13 更新（侧栏形状语言统一）：计数徽章由「`surfaceAlt` 药丸底 + 内边距」改为
//    **纯次级文字**（药丸底读起来像按钮，与折叠箭头抢注意力）⇒ 旧终点针（`backgroundColor(...surfaceAlt)
//    .borderRadius(RADIUS_PILL)`）在源码里已不存在、`between` 返回空串（假红）。
//    ⛔ 不是放宽：终点仍是**同块的稳定锚点**（计数 `Text`），切片范围仍只覆盖组头（含标题字重）。
const grpHead: string = between(indexSrc, 'Text(g.title)', 'Text(`${g.items.length}`)');
ok('组头块可定位', grpHead.length > 20);
// ⚠️ 字重 pin 同步为**语义出口**：`.fontWeight(typeOf('type.subhead').weight)`。
//    ⛔ **不是回归**（已核真源）：`type.subhead.weight` = `WEIGHT_MEDIUM` = **500** = 旧
//    `FontWeight.Medium` —— 同值、且从"写死字重"升级为"语义指引"（`design.ets:206`）。
//    判别力升级：不只匹配字符串，而是**反查真源角色字重 ≥ medium**（若被拉平成 regular ⇒ 红）。
const semMatch: RegExpMatchArray | null = grpHead.match(/fontWeight\(typeOf\('([^']+)'\)\.weight\)/);
const semWeight: number = semMatch !== null ? typeOf(semMatch[1]).weight : 0;
ok('组头字重走语义出口 typeOf(...).weight', semMatch !== null);
ok('组头字重 ≥ medium（读得出"上一级"层次）', semWeight >= 500);
hasNot(grpHead, 'FontWeight.Regular', '⛔ 组头不得回落 regular（层次会被拉平）');

// ── 靶子4b：会话行**单行化**（对齐 web `SessionItem.tsx:1-8` "Single-line layout"）──────
// 历史：此处原为"第二行 `id == 标题` 时不重复打一遍 id"的去重判据。2026-10-12 升级为**整行单行**：
//   第二行（渠道 chip + 裸 `chat_id`）对用户零信息量，而 web 权威明确是单行
//   （`[status dot] + title + relative time`，无左侧装饰条）⇒ 直接删除该行。
// ⚠️ 判据随之**加强**：不再只断言"去重条件存在"，而是断言**结构不存在**（一个字符都不渲染）
//    + 新能力（相对时间）**真的接上了**（页面单出口 → 纯函数）。这样"删掉第二行但忘了接时间"
//    与"接了时间但第二行还在"两种半成品都必红。
const relHelper: string = between(indexSrc, 'private relTimeOf(', '}');
ok('相对时间出口可定位', relHelper.length > 20);
has(relHelper, 'relativeTimeLabel(', '页面只做时钟注入 ⇒ 规则全在纯函数（判据与渲染同源）');
has(relHelper, 'Date.now()', '时钟在**页面**注入（纯函数不读全局时钟 ⇒ 可测）');
has(indexSrc, 'Text(this.relTimeOf(s.last_active))', '会话行渲染相对时间（唯一时间出口）');
hasNot(indexSrc, 'Text(s.chat_id)', '⛔ 会话行不再渲染裸 chat_id（开发者噪音，web 权威无此项）');
hasNot(indexSrc, 'Text(channelLabel(', '⛔ 会话行不再渲染渠道 chip（同上；渠道过滤条仍在）');

// ── 靶子4c：抽屉**筛选工具条 = 单行**（2026-10-12 目标③ 第二批）─────────────────────
// 形态契约（只认"结构"，不认"观感"）：
//   ① 侧栏渠道筛选走**平台菜单原语** `bindMenu`（ArkUI 自管开合）。原 `bindPopup` + 自持
//      `@State` + `onClick` toggle 在真机上"从关到开"约 **25% 漏点**（与 ArkUI 的 dismiss 回调
//      竞态；`mask: true` 又 4/4 打不开）⇒ 换原语是**修缺陷**、不是换风格。
//   ② 旧的**渠道 chips 行**（`chfilter-` 键 + 外层 `Flex(wrap)`）必须消失 —— 它与分段控件构成
//      "两条并列筛选条"（同一份数据两种容器、IA 重复；web `ChannelPicker` 本身是**下拉**）。
//   ③ 分段控件的**轨道内不得再出现折叠动作**（`collapseAllPlanNow`）：分段控件只装**互斥选项**，
//      把"全部折叠"塞进轨道 = 控制类型混用（用户点它会以为切换了分组维度）。
const track: string = between(indexSrc, 'Row({ space: SPACE_HAIR }) {', '.borderRadius(RADIUS_PILL)');
ok('分段控件轨道块可定位（零扫描判红）', track.length > 100);
hasNot(track, 'collapseAllPlanNow', '⛔ 折叠动作不在分段控件轨道内（控制类型不混用）');
has(indexSrc, 'bindMenu(this.ChannelPickerMenu', '渠道筛选走平台菜单原语 bindMenu（自管开合）');
hasNot(indexSrc, 'chfilter-', '⛔ 旧渠道 chips 行已删（两条并列筛选条 ⇒ 单条）');
hasNot(indexSrc, "this.activeChannel.length === 0 ? 'surface.pillSelected' : 'surface.chip'",
  '⛔ 渠道触发器**不再**填凹槽/芯片面（web 权威 `ChannelPicker.tsx:93-101` = 幽灵按钮：无边框无底色；'
  + '本仓原填充形态正是 web 2026-09-15 用户已否决的"描边/填充方块"，且与分段轨道同面 ⇒ 读成"第 4 段"）');
// 正向形态（防"删掉填充"被判据漏掉 ⇒ 变成随便什么形态都绿）：幽灵按钮 = 透明底 + 无边框。
const chTrigger: string = between(indexSrc, 'Text(activeChannelLabel(this.activeChannel))',
  '.bindMenu(this.ChannelPickerMenu');
ok('渠道触发器块可定位（零扫描判红）', chTrigger.length > 100);
has(chTrigger, 'Color.Transparent', '触发器**无底色**（幽灵按钮；web `ChannelPicker.tsx:99` 静息无底、hover 才浮起）');
hasNot(chTrigger, 'surface.chip', '⛔ 也不填 chip 面（与左侧分段轨道同族 ⇒ 读成"分段控件第 4 段"）');
hasNot(chTrigger, 'border(', '⛔ 幽灵按钮**不描边**（web 原文：塞描边方块会喧宾夺主）');

// ── 靶子4d：分组头节奏 · 行密度 · 搜索框（2026-10-12 目标③ 第三批）─────────────────
// ① 分组头 **居中 + 仅非首组显式留白**（2026-10-12 第二次修，原实现 = 「44vp 盒**底对齐**」）：
//    44vp 可点盒（硬约束，`hit_target_gate` 的 PENDING_SPEC 已清空 ⇒ 页面也在管）装 ~12vp
//    文字时——**居中**会把空气均分到上下；**底对齐**则把全部 ~26vp 堆到组头**上方**。
//    底对齐对"组与组之间"正是想要的，但**首个组**上方没有"上一组" ⇒ 那 26vp 直接顶在
//    筛选条下面（真机量测：筛选条底 y≈700 → 首组标题 y≈864 = **~150px 空带**，看起来像
//    布局断了 —— 用户 2026-10-12 亲报「这么丑的排版」的场景之一）。
//    ⇒ 改：居中 + **非首组** 加 `SPACE_MD` 上边距 ⇒ 组间空带**不变**（改为显式 margin），
//      首组紧贴筛选条（真机复测：首组标题 y **864 → 809**，空带 -55px）。
const grpRow: string = between(indexSrc, 'Text(`${g.items.length}`)', 'this.toggleGroup(');
ok('分组头行块可定位（零扫描判红）', grpRow.length > 40);
has(grpRow, '.alignItems(VerticalAlign.Center)', '分组头内容居中（上下空气均分，⛔ 不把空气全堆在组头上方）');
has(grpRow, '.padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: gIdx > 0 ? SPACE_MD : 0 })',
  '组间空带在**组头底色盒内**（padding）且 ⛔ 首组不留白 —— 吸顶时无缝（margin 会成透明缝，见靶子4f）');
has(indexSrc, 'ForEach(this.drawerGroups(), (g: DrawerGroup, gIdx: number) => {', '组序号入 ForEach（"首组"判定所需）');

// ② 会话行密度：行高 = 尾部 `⋯` 的 44vp 真实热区盒 + 上下 `SPACE_XXS`(4) ⇒ **52vp**。
//    原用 `INSET_ROW_Y`(8) ⇒ 60vp（比 Apple 44pt 单行列表高 39%）。判据钉**精确内边距串**。
has(indexSrc, '.padding({ left: INSET_ROW_X, right: INSET_ROW_X })',
  '会话行**无**竖向内边距 ⇒ 行高 == 44vp == Apple 单行列表高度（真机 178px → 149px）');
hasNot(between(indexSrc, 'this.renamingId === s.chat_id', 'Divider()'), 'top: SPACE_XXS',
  '⛔ 行内不再有竖向 padding（有 ⇒ 行高回涨 52vp，密度红利丢失）');

// ③ 搜索框：行内**放大镜**（提示"这是搜索"）+ **条件清空键**（Apple `UISearchBar` 的 clear 同为
//    条件出现）。清空键必须是**真实 44 布局盒**（⛔ `responseRegion` 外扩真机已证无效）+ 有 a11y 文案。
//    ⚠️ 区间限定：`xmark_circle_fill` 在页面另有一处用途 ⇒ 不许用全局 `has`（会假绿）。
//    ⚠️ 区间起点取 `if (this.sessQuery.length > 0) {`（= **注释之后**）：若起点取 TextInput，会把我写在
//    清空键上方的注释（里面**就写着** `responseRegion` 字样）卷进区间 ⇒ `hasNot` **假红**
//    （本仓既有教训：形态/缺席断言必须只在**剥注释后的代码**上做）。
const sbox: string = between(indexSrc, 'if (this.sessQuery.length > 0) {', "Text('搜本会话')");
ok('搜索框清空键块可定位（零扫描判红）', sbox.length > 100);
has(between(indexSrc, 'SymbolGlyph($r(\'sys.symbol.magnifyingglass\'))', "Text('搜本会话')"),
  "TextInput({ placeholder: '筛选会话…'", '放大镜在搜索框**之前**（同块内、视觉上"在框里"）');
has(sbox, 'sys.symbol.xmark_circle_fill', '非空时出现清空键（条件渲染）');
has(sbox, 'HIT_TARGET_MIN', '清空键是真实 ≥44 布局盒（⛔ 不用 responseRegion 外扩）');
has(sbox, "accessibilityText('清空筛选')", '清空键有 a11y 文案（图标-only 控件的既有约定）');
hasNot(sbox, 'responseRegion', '⛔ 清空键不靠 responseRegion 外扩热区（真机无效）');

// ── 靶子4e：搜索钮语义/禁态 + 新建会话弹层分组排版（2026-10-12 目标③ 第四批）───────
// 抽屉里「搜索消息」的语义 = 服务端 `/api/search`，**仅当前会话**（见 `runSearch` 注释），与左侧
// "本地即时筛选会话列表"是**两件事** ⇒ 文案必须明示（`搜本会话`，⛔ 不能是含糊的 `搜消息`），
// 且**空查询时置灰**（Apple：无效果的动作不能看起来可点）。
const sbtn: string = between(indexSrc, 'Row({ space: SPACE_XXS }) {',
  "accessibilityText('在当前会话的消息中搜索（服务端）')");
ok('搜索钮块可定位（零扫描判红）', sbtn.length > 60);
// ⚠️ 2026-10-12（目标③ 侧栏排版重设）**判据演进**（⛔ 不是放宽）：字形从裸放大镜改成
//   `text_and_magnifyingglass`（"搜索正文"）。原因（真机截图）：同排出现**两个同形**放大镜
//   ⇒ 用户读成"第二个搜索框"（左边筛会话 vs 右边搜正文是两件事，必须**外形可辨**）。
has(sbtn, 'sys.symbol.text_and_magnifyingglass', '搜索钮带"搜索正文"图标（⛔ 不与筛选框同形）');
hasNot(sbtn, "SymbolGlyph($r('sys.symbol.magnifyingglass'))",
  '⛔ 搜索钮不用与筛选框同形的裸放大镜（否则像第二个搜索框）');
has(sbtn, 'this.sessQuery.trim().length > 0', '空查询置灰判据在位');
has(sbtn, "colorOf(this.palOnce(), 'iconMuted')", '置灰态图标走 iconMuted（⛔ 不硬写 Palette 字段）');
// ⚠️ 取色一律 `palOnce()`（与 `pal()` **同值**、按 `主题|强调色` memo）：本页 `this.pal()` 调用点受
//    `tools/perf/guard.sh` 硬线（≤1250）约束 ⇒ **新增 UI 必须走 memo 入口**（判据因此按 palOnce 钉）。
has(sbtn, 'this.palOnce().accentSoft', '激活态文字走 accentSoft（文字 accent 口径）');

// 新建会话弹层：最近目录 = **iOS inset grouped**（一个圆角容器 + 行间发丝）⛔ 不是 N 个独立药丸；
// 半径在整张 sheet 内统一到 `RADIUS_CARD`（原 `RADIUS_CHIP` 在该尺寸下发方）。
const nsheet: string = between(indexSrc, 'NewSessionSheet() {', 'PanelsSheet() {');
ok('新建会话弹层块可定位（零扫描判红）', nsheet.length > 1500);
has(nsheet, 'hairlineOf(this.palOnce())', '最近目录行间有发丝分隔（inset grouped 结构语言）');
has(nsheet, '.clip(true)', '分组容器裁圆角（末行不溢出容器圆角）');
hasNot(nsheet, '.borderRadius(RADIUS_CHIP)', '⛔ sheet 内不再残留 RADIUS_CHIP（半径统一 RADIUS_CARD）');
// ⚠️ 计数必须**限定到最近目录块**：整张 sheet 里字段面/补全下拉面也用 `surface.chip`（各 1 层）
// ⇒ 用整张 sheet 计数会把它们算进来（我第一版就是这么误写的：得 4）。判据只关心"行有没有各自披底"。
const recent: string = between(indexSrc, "Text('最近使用的工作路径')", '// 取消 / 创建（自绘行按钮');
ok('最近目录块可定位（零扫描判红）', recent.length > 200);
has(recent, 'hairlineOf(this.palOnce())', '最近目录行间有发丝分隔（inset grouped 结构语言）');
{
  const pills: number =
    (recent.match(/backgroundColor\(surfaceFillOf\(this\.palOnce?\(\), 'surface\.chip'\)\)/g) || []).length;
  ok(`最近目录只剩 1 层容器底（surface.chip×${pills}，应为 1）—— 退回每行药丸 ⇒ N ⇒ 红`, pills === 1);
}

// ── 靶子4f：行**前导标记槽**（2026-10-12 目标③ 第七批：修"标题参差"）────────────────
// 真机 dump 实证（同一帧两条会话）：跑动行标题左缘 **134px**、静息行 **80px** ⇒ 差 **16vp**。
// 根因：状态点/星标是**条件渲染**（`if (running)` / `if (starred)`）⇒ 有标记的行把标题顶右。
// 契约：标记住进**恒占位**的 `MARKER_GUTTER` 槽 ⇒ 标题左缘与"有没有标记"**无关**；同一槽同时
//      给**组头折叠箭头**复用 ⇒ 组头标题与行标题落在**同一条竖轴**上。
// ⚠️ 2026-10-13：起点锚由 `if (s.running === true) {` 改为**状态点现判据**（`sessDotRole`）——
//    状态点不再只看 `running` 布尔（改由 `core/sessiongroup.sessionStatusRole` 统一判
//    running/waiting/error），槽本身（`MARKER_GUTTER` 恒占位 + 居中）**契约未变**。
const gutter: string = between(indexSrc, 'if (this.sessDotRole(s).length > 0) {', 'Text(this.tabLabel(s.chat_id))');
ok('标记槽块可定位（零扫描判红）', gutter.length > 100);
has(gutter, '.width(MARKER_GUTTER)', '状态点/星标收进恒宽槽（⛔ 不再条件渲染把标题顶开）');
has(gutter, 'justifyContent(FlexAlign.Center)', '槽内居中（点/星/空三态的标题左缘一致）');
// 槽宽必须装得下**最坏内容**：运行中 **且** 已标星 = 点 `SPACE_XS` + `SPACE_HAIR` + 星
// `typeOf('type.subhead').size`。装不下 ⇒ 槽内挤压 ⇒ 标记溢出、标题又位移（变相回归）。
ok(`槽宽 ≥ 最坏内容（点 ${SPACE_XS} + ${SPACE_HAIR} + 星 ${typeOf('type.subhead').size} = ${SPACE_XS + SPACE_HAIR + typeOf('type.subhead').size}；实得 ${MARKER_GUTTER}）`,
  MARKER_GUTTER >= SPACE_XS + SPACE_HAIR + typeOf('type.subhead').size);
{
  // 全文件**恰好 2 处** `MARKER_GUTTER` 宽槽：行内 1 + 组头 1。
  // 少一处 ⇒ 组头又跑偏（红）；多一处 ⇒ 有人另造了第三处槽（红）。
  const n: number = (indexSrc.match(/\.width\(MARKER_GUTTER\)/g) || []).length;
  ok(`MARKER_GUTTER 宽槽恰 2 处（行 + 组头；实得 ${n}）`, n === 2);
}
// 行分隔线左缘内缩到**文字起点**（= 行内边距 + 槽宽 + 行内间距）—— Apple 的 inset separator
// （线只从正文起画，前导标记槽那片留白不画线）。
has(indexSrc, '.margin({ left: INSET_ROW_X + MARKER_GUTTER + SPACE_XS, right: INSET_ROW_X })',
  '行分隔线左缘 = 文字起点（⛔ 不再从行内容左缘起画）');
// 组头左右内边距 = **行内边距** ⇒ 组头标题与行标题同轴、计数徽标右缘与行尾 `⋯` 右缘对齐。
// ⚠️ 15e 演进：组头内边距串多了一段 `top`（组间空带进底色盒，见靶子4d）⇒ 断言串随之带上 `top`，
//    仍是**逐字**钉住（⛔ 不是放宽成"含 left/right 即可"）。
has(between(indexSrc, 'Text(`${g.items.length}`)', 'this.toggleGroup('),
  '.padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: gIdx > 0 ? SPACE_MD : 0 })',
  '组头左右内边距 = 行内边距（同一条竖轴）');
// 令牌真源：`MARKER_GUTTER` 定义在 design.ets 且**由空间档派生**（⛔ 不是就地新造的魔数）。
has(designSrc, 'export const MARKER_GUTTER: number = SPACE_XL;',
  'MARKER_GUTTER 定义在 design.ets 并取空间档（⛔ 页面不写死数字）');
has(designSrc, 'import', 'design.ets 可读（零扫描防线）');

// ── 靶子4f：抽屉组头**吸顶**（2026-10-12 15e 目标③）─────────────────────────────
// 为什么：Apple 列表语义 —— 滚动长会话列表时分区名（今天/昨天）**始终可见**；web 侧栏不吸顶
// ⇒ 原生**超越**项。ArkUI 里**只有** `ListItemGroup.header` 会吸（普通 `ListItem` 写了
// `.sticky()` 也**静默无效**）⇒ 必须同时钉住三层，缺一即"以为吸了其实没吸"：
//   ① 组头是 `ListItemGroup` 的 `header` 构件；② List 上真有 `.sticky(StickyStyle.Header)`；
//   ③ 吸顶底**不透明**且与抽屉根**同材质**（否则行会从组头下面 / 留白缝里透出来）。
// ⚠️ `between()` 的**终点是排他**的 ⇒ 切片终点必须取 `.sticky()` **之后**的锚（否则"List 真的开了吸顶"
//    那条会切不到 `.sticky` 而**假红** —— 本轮首跑即踩，实测 65 passed / 1 failed）。
const drawerList: string = between(indexSrc,
  'ListItemGroup({ header: this.DrawerGroupHeader(g, gIdx) }) {', '// ── 底部动作');
ok('抽屉列表块可定位（零扫描判红）', drawerList.length > 200);
has(drawerList, 'ListItemGroup({ header: this.DrawerGroupHeader(g, gIdx) })',
  '组头 = ListItemGroup.header（吸顶的**唯一**前提）');
has(drawerList, '.sticky(StickyStyle.Header)', 'List 真的开了吸顶');
has(indexSrc, 'DrawerGroupHeader(g: DrawerGroup, gIdx: number) {', '组头构件定义在位（零扫描防线）');
const grpDef: string = between(indexSrc, 'DrawerGroupHeader(g: DrawerGroup, gIdx: number) {', 'this.toggleGroup(');
ok('组头构件块可定位（零扫描判红）', grpDef.length > 200);
has(grpDef, ".backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))",
  '吸顶组头底色 = 抽屉根**同材质**（实底 overlay；⛔ 不能玻璃/透明 ⇒ 吸顶露色差接缝 + 透字成脏）');
hasNot(grpDef, 'backgroundBlurStyle',
  '吸顶组头**不带玻璃模糊**（实底 ⇒ 无透字成脏、与实底抽屉逐像素无缝）');
has(drawerList, '${this.isGroupCollapsed(this.sessionCategory(), g.key)}`)',
  '组头 ForEach 键**含折叠态**（header 参数是快照 ⇒ 否则 chevron 卡初值）');

// ── 靶子4g：会话行**两行式**（2026-10-12 15o·e 目标③「所有面板 · 对标苹果」）────────────────
// 真机 dump 实得（单行时）：行宽 999px 被切走 `[点槽 81][标题 509][时间 179][⋯ 149]`
// ⇒ 标题只拿 **51%** ⇒ `手机NPU部署30B-MoE`（需 ~712px）被截成 `手机NPU部署30B-…`（截图实锤）。
// 契约：**次级信息（相对时间）降为第二行**（Apple Files/Notes 列表惯例，原生惯例而非复刻 web）
//       ⇒ 标题拿满剩余宽（≈761px，+50%）；行高仍 = `⋯` 的 44vp 盒（两行合计 106px < 149px）
//       ⇒ **密度零损失**。
{
  const body: string = between(indexSrc, '// ── 标题 + 时间：**两行**', "Text('⋯')");
  ok('两行行体可定位（零扫描判红）', body.length > 200);
  has(body, 'Column({ space: SPACE_HAIR })', '标题 + 时间同住一个 Column（两行）');
  has(body, '.layoutWeight(1).alignItems(HorizontalAlign.Start)',
    'Column 吃满行内剩余宽（标题不再与时间争同一行）');
  // 标题必须**自己**占满该列宽——否则 ellipsis 仍会截长名（正是本次要修的缺陷形态）。
  {
    const titleBlock: string = between(body, 'Text(this.tabLabel(s.chat_id))', 'if (this.relTimeOf');
    ok('标题块可定位（零扫描判红）', titleBlock.length > 50);
    has(titleBlock, ".width('100%')", "标题 Text 占满列宽（`.width('100%')`）");
    hasNot(titleBlock, '.layoutWeight(1)', '标题不再与时间抢同一行（weight 已上移到 Column）');
  }
  // 空串**不渲染**时间行：两行布局下渲染空串会白留一行高 ⇒ 行高参差。
  has(body, 'if (this.relTimeOf(s.last_active).length > 0)', '空 last_active ⇒ 不渲染时间行（不留空行）');
}

console.log(`  status_sheet_drawer: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
