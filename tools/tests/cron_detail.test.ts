/**
 * cron_detail —— **定时任务详情**的源码形态门禁（2026-10-13，目标④「任务管理」对标 web 权威）。
 *
 * ── 病根（真机 + 源码双向核对）──────────────────────────────────────────────────────
 * 运行面板「定时」tab 的 cron 行此前**点按只把一行摘要复制进剪贴板**（`copyText(...)`）；
 * 而主行是 `.maxLines(1)`（`components/PanelRows.ets`）⇒ **多行提示词正文永久不可见**，
 * 且行尾只有删除 X、没有 chevron ⇒ 整行看起来"不可打开"。
 * web 权威 `components/sidebar/TasksPanel.tsx:120-172` 恰恰相反：cron 行**可点开**，
 * 展开区给「调度 / 下次运行 / 目标(channel:chatID) / ID」——该文件里还留着一句用户报告原文
 * 「电脑 cron 也无法点开看详情」。
 *
 * ── 判据（**钉调用点**，不是"存在就行"）────────────────────────────────────────────
 *   ① cron 行的 `onTap` **确实**是 `openCronDetail(job)`，且**同一片段里 `copyText(` 已消失**
 *      （⛔ 只钉"openCronDetail 存在"会漏掉"复制仍留着/点按仍走复制"）；
 *   ② `openCronDetail` 的**每一个**字段都取自 `core/panels.ets` 的纯函数 ⇒ 行与详情同源；
 *   ③ 详情是**真门控**（`if (this.showCronDetail)` 与其间无其它 `if`）+ 组件被消费恰 1 处；
 *   ④ 返回键**先**关详情、**后**才轮到浮层栈（否则按返回会连整个运行面板一起收）；
 *   ⑤ `closeOverlaysAboveDrawer` 里登记（开抽屉前的互斥收口，唯一真源）；
 *   ⑥ 组件侧：无 `ForEach(`（预算顶格）、无 `this.pal()`（走 memo 入口）、行是真 `@Component`+`@Prop`
 *      （⛔ 带参 `@Builder` 的子树不随参数重建，见 ARKTS-GOTCHAS）、关闭 X 是真实 44 盒、
 *      消息块可复制/可任意折行/封顶滚动、空值渲染 `—`。
 *
 * ✅ 扫描器自证：打印扫了哪些文件 + 逐项计数；**零扫描判红**。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 * 🔬 mutation 自证（已做）：㈠ 把 cron 行 `onTap` 改回 `copyText(...)` ⇒ ① 红；
 *    ㈡ 把 `cronMessageText(job)` 换成 `cronPrimary(job)`（折叠）⇒ ② 红；
 *    ㈢ 删 `closeOverlaysAboveDrawer` 里那行 ⇒ ⑤ 红；三次还原后逐字节一致且复绿。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 标记为模块（顶层 pass/fail 不落全局，避免与其它脚本测试重名 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const PAGES: string = path.join(REPO, 'entry/src/main/ets/pages');
const COMPONENTS: string = path.join(REPO, 'entry/src/main/ets/components');

/** **剥注释**（块 + 行；行注释用 `(^|[^:])//` 以免剥掉 `https://`）—— 只认**生产**代码。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}
/** 取 `from` 之后 `to` 之前的片段（任一未命中 ⇒ `''` ⇒ 后续断言自然红）。 */
function sliceBetween(src: string, from: string, to: string): string {
  const i = src.indexOf(from);
  if (i < 0) { return ''; }
  const j = src.indexOf(to, i + from.length);
  return j < 0 ? '' : src.substring(i + from.length, j);
}

const IDX: string = 'Index.ets';
const SHEET: string = 'CronDetailSheet.ets';
const idxSrc: string = stripComments(fs.readFileSync(path.join(PAGES, IDX), 'utf8').replace(/i18nT\(([^()]*)\)/g, '$1'));
const sheetSrc: string = stripComments(fs.readFileSync(path.join(COMPONENTS, SHEET), 'utf8').replace(/i18nT\(([^()]*)\)/g, '$1'));

console.log(`  cron-detail-scan dir=${PAGES}`);
console.log(`  cron-detail-scan files: ${IDX}, ${SHEET}`);
console.log(`  cron-detail-scan bytes: idx=${idxSrc.length} sheet=${sheetSrc.length}`);

// ⛔ 白绿防线：扫到 0 处判红（文件被改名/搬走时不许"静默全绿"）。
ok('零扫描防线（两个文件都非空）', idxSrc.length > 1000 && sheetSrc.length > 1000);

// ── ① cron 行的 onTap 必须"打开详情"，且同片段里不再有 copyText ──────────────────────────
// ⚠️ 必须先切**行片段**：本页别处（后台任务/终端行）也有 `onTap:`，全文件 indexOf 会取错。
// ⚠️ 起点取 `primary: cronPrimary(job),`（行**首**字段）—— 行内顺序是 [primary][secondary][trailing][onTap]，
//    从 `trailing:` 起切会漏掉主/副行（我第一版就踩了这个 ⇒ ①d/①e 假红）。
const cronRow: string = sliceBetween(idxSrc, 'primary: cronPrimary(job),', '(job: CronJob, i: number) =>');
ok('①a 切到 cron 行片段（非空）', cronRow.length > 40);
eq('①b onTap 打开详情（恰 1 处）', countOf(cronRow, 'this.openCronDetail(job)'), 1);
eq('①c 行内不再"点按只复制一行摘要"', countOf(cronRow, 'copyText('), 0);
// 行本身仍须是"主行 + 副行"（同源纯函数）——防"为了开详情把行内容删了"。
// ⚠️ 主行锚点被 `sliceBetween` 排除在片段外 ⇒ 单独钉它在全页**恰 1 处**（且就是 cron 行那处）。
eq('①d 行主行仍走 cronPrimary', countOf(idxSrc, 'primary: cronPrimary(job),'), 1);
eq('①e 行副行仍走 cronSubText', countOf(cronRow, 'cronSubText(job)'), 1);
eq('①f 行尾仍是删除入口（唯一删除点）', countOf(cronRow, 'this.removeCron('), 1);

// ── ② openCronDetail：每个字段都来自 core/panels 纯函数（行/详情同源）──────────────────────
const opener: string = sliceBetween(idxSrc, 'private openCronDetail(job: CronJob): void {',
  'this.showCronDetail = true;');
ok('②a 切到 openCronDetail 主体（非空）', opener.length > 80);
eq('②b 消息全文 cronMessageText', countOf(opener, 'cronMessageText(job)'), 1);
eq('②c 调度 scheduleText', countOf(opener, 'scheduleText(job)'), 1);
eq('②d 一次性标记', countOf(opener, "job.one_shot === true ? ' · 一次性' : ''"), 1);
eq('②e 下次运行 fmtDateTime(next_run)', countOf(opener, 'fmtDateTime(job.next_run)'), 1);
eq('②f 目标 cronTargetText', countOf(opener, 'cronTargetText(job)'), 1);
eq('②g 创建时间 fmtDateTime(created_at)', countOf(opener, 'fmtDateTime(job.created_at)'), 1);
eq('②h ID 取自 job.id', countOf(opener, 'job.id.trim()'), 1);
// ⛔ 判别点：详情若复用主行的单行归一化（`cmdOneLine`/`cronPrimary`）⇒ 多行正文又被折叠 ⇒ 必须红。
eq('②i 详情不得折叠成单行（无 cmdOneLine / cronPrimary）',
  countOf(opener, 'cmdOneLine') + countOf(opener, 'cronPrimary'), 0);

// ── ③ 真门控 + 组件被消费（恰 1 处）──────────────────────────────────────────────────
eq('③a 组件被消费恰 1 处', countOf(idxSrc, 'CronDetailSheet({'), 1);
// 门控共 **2** 处：①渲染门（弹层）②返回键分支。⛔ 少一处就是"能开不能关/能关不能开"。
eq('③b 门控 `if (this.showCronDetail)` 恰 2 处（渲染 + 返回键）',
  countOf(idxSrc, 'if (this.showCronDetail) {'), 2);
// ⚠️ 取**渲染**门 = `lastIndexOf`（返回键在文件更早处，indexOf 会取到它 ⇒ ③d 假红）。
const gateIdx: number = idxSrc.lastIndexOf('if (this.showCronDetail) {');
const callIdx: number = idxSrc.indexOf('CronDetailSheet({');
ok('③c 调用点落在门控之后', gateIdx >= 0 && callIdx > gateIdx);
// 门控与调用之间**不得**再出现别的 `if (`（否则"门控"可能是别人的）
// ⚠️ 从门控**之后**起切（含门控自身会数到 1 ⇒ 假红，我第一版就踩了）。
const GATE: string = 'if (this.showCronDetail) {';
eq('③d 门控与调用之间无其它 if',
  countOf(idxSrc.substring(gateIdx + GATE.length, callIdx), 'if ('), 0);
// 组件声明的 6 个字段全部接线（缺一个 ⇒ 详情页显示空/—，用户以为没数据）
eq('③e 接线 message', countOf(idxSrc, 'message: this.cronDetailMessage'), 1);
eq('③f 接线 schedule', countOf(idxSrc, 'schedule: this.cronDetailSchedule'), 1);
eq('③g 接线 nextText', countOf(idxSrc, 'nextText: this.cronDetailNext'), 1);
eq('③h 接线 targetText', countOf(idxSrc, 'targetText: this.cronDetailTarget'), 1);
eq('③i 接线 createdText', countOf(idxSrc, 'createdText: this.cronDetailCreated'), 1);
eq('③j 接线 idText', countOf(idxSrc, 'idText: this.cronDetailId'), 1);
eq('③k onClose 归页面所有', countOf(idxSrc, 'this.showCronDetail = false;') >= 3, true);

// ── ④ 返回键：详情先于浮层栈（⛔ 否则"按返回"连运行面板一起收）──────────────────────────
const back: string = sliceBetween(idxSrc, 'onBackPress(): boolean {', 'const code: OverlayCode = topOverlay(');
ok('④a 切到 onBackPress 前段（非空）', back.length > 40);
eq('④b 详情在浮层栈之前关闭', countOf(back, 'this.showCronDetail = false;'), 1);
// ⛔ 方向保护：详情必须先于 `panels`（同一分支里先 return true 才轮到 topOverlay）
ok('④c 详情分支在 topOverlay 之前', idxSrc.indexOf('if (this.showCronDetail) {')
  < idxSrc.indexOf('const code: OverlayCode = topOverlay('));

// ── ⑤ 开抽屉前的互斥收口（唯一真源）────────────────────────────────────────────────
const above: string = sliceBetween(idxSrc, 'private closeOverlaysAboveDrawer(): void {', 'this.sessMenuId =');
ok('⑤a 切到 closeOverlaysAboveDrawer（非空）', above.length > 40);
eq('⑤b 详情已登记收口', countOf(above, 'this.showCronDetail = false;'), 1);

// ── ⑥ 组件侧形态 ───────────────────────────────────────────────────────────────────
// ⑥q 绘制顺序（⛔ 真机实证过的缺陷）：三层详情都从运行面板里开出 ⇒ 必须渲染在 `PanelsSheet()`
//     **之后**（ArkUI 后者盖前者）。此前排在之前 ⇒ 60% 面板**盖住详情卡下半屏**（调度/下次/目标/ID 全看不见）。
const panelCall: number = idxSrc.indexOf('this.PanelsSheet()');
const cronCall: number = callIdx;
ok('⑥q 零扫描防线：找得到 PanelsSheet() 调用', panelCall > 0);
ok('⑥q 详情渲染在运行面板**之后**（绘制顺序 = 后者在上）', panelCall > 0 && cronCall > panelCall);
// 同一条链上另两层也必须在其后（同一处缺陷的三个面，⛔ 只修一个不算修）。
const taskCall: number = idxSrc.indexOf('TaskDetailSheet({');
const termCall: number = idxSrc.indexOf('TerminalSheet({');
ok('⑥q TaskDetailSheet 也在面板之后', taskCall > panelCall);
ok('⑥q TerminalSheet 也在面板之后', termCall > panelCall);
eq('⑥a 无 ForEach（预算顶格，本文件不得新增）', countOf(sheetSrc, 'ForEach('), 0);
// ⛔ 面板级读取必须走 memo 入口 `palOnce()`（未 memo 的 `this.pal()` 每次重建调色板，成本线只许减）。
eq('⑥b 面板不直读 this.pal()', countOf(sheetSrc, 'this.pal()'), 0);
ok('⑥c 确有 palOnce 定义与消费', countOf(sheetSrc, 'palOnce()') >= 3);
// ⛔ B 线（`pal() ∨ palOnce()`）是**松但有限**的读取总量界：本文件读取点必须压到 2 处
//    （`skin()` 一次取齐 5 个色值 + `sheetLayers()`）—— 这 2 处是**文本计数**，不随 build 增长。
eq('⑥c1 面板读取点恰 2（skin / sheetLayers 各 1）', countOf(sheetSrc, 'this.palOnce()'), 2);
ok('⑥c1b skin() 一次取齐并缓存（含主题失效检查）', countOf(sheetSrc, 'this.skinCache') >= 2
  && countOf(sheetSrc, 'this.skin()') >= 4);
// 字段行（子组件）按本仓既有形态直接 `paletteOf(this.theme)`（同 `PanelRows`），不计入页面预算。
// 计数 = 面板 `palOnce()` 里 1 处 + 字段行 2 处 = 3。
ok('⑥c2 字段行走 paletteOf(this.theme)', countOf(sheetSrc, 'paletteOf(this.theme)') === 3);
// 行必须是真 @Component + @Prop（带参 @Builder 的子树不随参数重建 —— ARKTS-GOTCHAS）
eq('⑥d 两个 @Component（面板 + 字段行）', countOf(sheetSrc, '@Component'), 2);
ok('⑥e 字段行是真 @Prop 组件', countOf(sheetSrc, '@Prop') >= 5);
eq('⑥f 不用带参 @Builder 承载会变内容', countOf(sheetSrc, '@Builder'), 0);
// 关闭 X：真 44 命中盒（⛔ responseRegion 负偏移真机实测无效）
ok('⑥g 关闭 X 有读屏文案', countOf(sheetSrc, "accessibilityText('关闭定时任务详情')") === 1);
ok('⑥h 关闭 X 是真实 44 命中盒', countOf(sheetSrc, '.width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)') >= 1);
// 消息块：可复制 / 任意折行 / 封顶滚动（长提示词要把面板顶出屏幕）
ok('⑥i 消息可长按复制', countOf(sheetSrc, 'copyOption(CopyOptions.LocalDevice)') >= 2);
ok('⑥j 消息任意位置折行', countOf(sheetSrc, 'wordBreak(WordBreak.BREAK_ALL)') === 1);
ok('⑥k 消息块封顶可滚', countOf(sheetSrc, 'constraintSize({ maxHeight: CRON_MSG_MAX_H })') === 1);
ok('⑥l 消息块空则不渲染', countOf(sheetSrc, 'if (this.message.length > 0)') === 1);
// 空值统一 `—`（与 web `|| '—'` 同口径）
ok('⑥m 空值渲染 —', countOf(sheetSrc, "'—'") === 1);
// 出场过渡走底座工厂（⛔ 不自造第二套入场语言）
ok('⑥n 过渡走 sheetTransition()', countOf(sheetSrc, 'sheetTransition()') === 1);
// L2 内嵌卡轮廓：面到面（⛔ 不许走 L1 的 hairlineOf）
ok('⑥o 消息块用 structuralRuleOf（L2 面到面）', countOf(sheetSrc, 'structuralRuleOf(') === 1);
// 字段齐全（调度 / 下次运行 / 目标 / 创建时间 / ID）
for (const label of ['调度', '下次运行', '目标', '创建时间', 'ID']) {
  ok(`⑥p 字段「${label}」在组件内`, sheetSrc.indexOf(`label: '${label}'`) >= 0);
}

if (fail > 0) { console.log(`  cron_detail: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  cron_detail: ${pass} passed, 0 failed`);
process.exit(0);
