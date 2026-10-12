/**
 * 「运行面板排版 + 终端键帽可见性」的**源码形态**门禁 —— 用户 2026-10-12（目标③/④）亲报
 * 「终端和任务管理做的很差」的两条**可判定**落点。
 *
 * ── ① 运行面板：「＋ 新建」必须在**表头**，且内容区不得再有第二处 ───────────────────────
 *   真机取证（dumpLayout）：旧实现里「＋ 新建」是**内容区一行右对齐的孤按钮**
 *   （`终端` tab 下单独占一行、上下各留 ~150px 空隙，空态再沉到最底 ⇒ 看着"没做完"）。
 *   判据 = 它在**表头 Row 内**（⇒ 源码位置早于 chips 的 `Flex({ wrap: … })`）、且**全页唯一**。
 *   ⛔ 不能用"存在就行"的形态断言：必须同时钉**唯一性**（否则重新加回内容区那份也照样绿）。
 *
 * ── ② 终端键帽：浅色主题下必须**可见** ────────────────────────────────────────────────
 *   真机取证（浅色主题截图）：键帽填充 `surface.input` 与面板底 `surface.overlay` 近乎同色
 *   ⇒ 整排退化成"裸文本"。设计系统原则 = **浅色系靠结构性发丝立边**
 *   ⇒ `keyChip` / `ctrlChip` 各补一条 `hairlineOf(...)` 发丝边。
 *   判据 = 两处 builder 都出现发丝边；且**统一最小键宽** `KEY_MIN_W` 被两处消费。
 *
 * ✅ 扫描器自证：打印扫了哪些文件 + 逐项计数；**零扫描判红**（合计 0 ⇒ 红）。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 * 🔬 mutation 自证（已做）：㈠ 把「＋ 新建」挪回内容区 ⇒ ① 顺序/唯一性断言红；
 *    ㈡ 删掉 `keyChip` 的发丝边 ⇒ ② 计数断言红；两次还原后逐字节一致且复绿。
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

const IDX: string = 'Index.ets';
const TERM: string = 'TerminalSheet.ets';
const idxSrc: string = stripComments(fs.readFileSync(path.join(PAGES, IDX), 'utf8'));
const termSrc: string = stripComments(fs.readFileSync(path.join(COMPONENTS, TERM), 'utf8'));

console.log(`  panel-scan dir=${PAGES}`);
console.log(`  panel-scan files: ${IDX}, ${TERM}`);

// ── ① 「＋ 新建」：表头唯一 ──────────────────────────────────────────────────────────
// ⚠️ 排序判据**必须先把 `PanelsSheet` builder 片段切出来**：本文件更早处还有别的
//    `Flex({ wrap: FlexWrap.Wrap })`（如设置面 tab 栏）⇒ 全文件 `indexOf` 会取到**错的那个**
//    （本轮实测：全文件取到 @111099，而 PanelsSheet 在 @195607 ⇒ 假红）。
const PS_MARK: string = 'PanelsSheet() {';
const psStart: number = idxSrc.indexOf(PS_MARK);
const psNextBuilder: number = idxSrc.indexOf('@Builder', psStart + PS_MARK.length);
const psBody: string = psStart >= 0
  ? idxSrc.slice(psStart, psNextBuilder > 0 ? psNextBuilder : idxSrc.length)
  : '';
const newBtn: number = countOf(idxSrc, "'＋ 新建'");
// ⚠️ 2026-10-12 二次演进：tab 行已从 `Flex({ wrap: FlexWrap.Wrap })` 改成
//    **`Row` + 每片 `layoutWeight(1)` 等分**（等分 ⇒ 不可能被裁、也不可能参差；见 Index.ets 头注）。
//    ⇒ 本判据的**定位锚**随之演进为「第一个内容分支」（意图不变：`＋ 新建` 必须在**表头**、
//    即早于内容区；⛔ 不删除这条断言）。
const contentAt: number = psBody.indexOf("if (this.panelTab === 'cron')");
const newBtnAt: number = psBody.indexOf("'＋ 新建'");
const termCall: number = countOf(psBody, 'this.newTerminal()');
const oldEmpty: number = countOf(idxSrc, '本会话暂无终端；点');
const newEmpty: number = countOf(idxSrc, '本会话暂无终端');
console.log(`  panel-scan ${IDX}: '＋ 新建' 全页=${newBtn} PanelsSheet片段长=${psBody.length} 内位置=${newBtnAt} 内容区=${contentAt} newTerminal()=${termCall} 旧空态=${oldEmpty} 新空态=${newEmpty}`);

ok(`PanelsSheet 片段已切出（长 ${psBody.length} > 1000）`, psBody.length > 1000);
ok(`运行面板「＋ 新建」全页唯一（${newBtn} == 1）`, newBtn === 1);
ok(`「＋ 新建」在**表头**（片段内位置 ${newBtnAt} < 内容区 ${contentAt}）`,
  newBtnAt >= 0 && contentAt >= 0 && newBtnAt < contentAt);
ok(`「＋ 新建」仍接线 newTerminal()（片段内 ${termCall} ≥ 1）`, termCall >= 1);
ok(`旧空态文案（指向已删的行内按钮）已清除（${oldEmpty} == 0）`, oldEmpty === 0);
ok(`新空态文案存在（${newEmpty} ≥ 1）`, newEmpty >= 1);

// ── ①b 面板 tab 行 = **等分**（目标③ 排版）────────────────────────────────────────
//     病根（真机量测，2026-10-12）：`Flex(wrap)` 虽不裁，但**每片宽度随标签参差**
//     （222/222/182/194/141px），行尾留白 0~200px ⇒ 看着"没排过"。
//     修法 = `Row({ space: SPACE_XS })` + 每片 `.layoutWeight(1)`（= iOS `UISegmentedControl`
//     形态：**恰得 1/n 宽、任何屏宽都齐平、不可能被裁**）+ `.textAlign(TextAlign.Center)`。
{
  const tabStart: number = psBody.indexOf('Row({ space: SPACE_XS })');
  const tabEnd: number = psBody.indexOf("if (this.panelTab === 'cron')");
  const tabRow: string = tabStart >= 0 && tabEnd > tabStart ? psBody.slice(tabStart, tabEnd) : '';
  ok(`①b tab 行切片非空（零扫描判红，len=${tabRow.length}）`, tabRow.length > 100);
  // ⚠️ `layoutWeight(1)` 在源码里只出现 **2** 次（表头标题 1 + **ForEach 体内的芯片** 1）——
  //    ForEach 体只写一遍（不是 5 遍）⇒ ⛔ 别按"5"断言。
  ok(`①b 每片 \`layoutWeight(1)\`（${countOf(tabRow, 'layoutWeight(1)')} 处：表头 1 + 芯片 1）`,
    countOf(tabRow, 'layoutWeight(1)') === 2);
  ok('①b ⛔ 不再有 wrap 形态的逐项 `.margin({ right: SPACE_XS, bottom: SPACE_XS })`',
    countOf(tabRow, '.margin({ right: SPACE_XS, bottom: SPACE_XS })') === 0);
  ok('①b tab 文字居中（`.textAlign(TextAlign.Center)`）', tabRow.indexOf('.textAlign(TextAlign.Center)') >= 0);
  ok('①b tab 命中盒 ≥44（`.constraintSize({ minHeight: HIT_TARGET_MIN })`）',
    tabRow.indexOf('.constraintSize({ minHeight: HIT_TARGET_MIN })') >= 0);
  // ── ①b-2（2026-10-13，15z12 判据演进：**下划线式页签**）────────────────────────────
  //   病根：实心 accent 芯片 ×5 读起来是"按钮墙"（用户亲报），且与 `SettingsPanel.TabBar`
  //   （早一轮已改下划线）**语言不一致**。⇒ 运行面板同改下划线；等分形态不变。
  //   ⛔ 判据演进**只加不删**：上面 4 条（等分/居中/命中盒/无 wrap 边距）继续钉住。
  //   ⚠️ 本组断言必须**只切页签 ForEach 体**（锚点 `ForEach(this.panelTabs()`）：
  //      ①b 的 `tabRow` 从**表头**那行 `Row({ space: SPACE_XS })` 起切 ⇒ 会把表头「＋ 新建」
  //      一起圈进来，而它**本来就该是** accent 实心按钮（文字 `onAccent`）⇒ 负向断言**假红**
  //      （本轮实测：`onAccent` 出现 1 次，正是表头那个按钮，不是页签）。
  //   判别力自证：页签回到实心（`backgroundColor(... ? this.pal().accent ...)` + `onAccent` 文字）
  //      ⇒ 末条必红；未选中指示器改成 `this.pal().accent`（人人上色）⇒ 第 2 条必红。
  const chipsStart: number = psBody.indexOf('ForEach(this.panelTabs()');
  const chips: string = chipsStart >= 0 && tabEnd > chipsStart ? psBody.slice(chipsStart, tabEnd) : '';
  ok(`①b-2 页签切片非空（零扫描判红，len=${chips.length}）`, chips.length > 100);
  ok('①b-2 选中 = 下划线指示器（`.height(STROKE_RAIL)` 的 Row）',
    chips.indexOf('.height(STROKE_RAIL)') >= 0);
  ok('①b-2 未选中指示器**透明**（失败方向安全：状态缺失不得读成"已选中"）',
    chips.indexOf('this.pal().transparent') >= 0);
  ok('①b-2 选中文字走 `accentSoft`（⛔ `accent` 不得做文字色）',
    chips.indexOf('this.pal().accentSoft') >= 0);
  ok('①b-2 选中文字加重（`FontWeight.Medium`）', chips.indexOf('FontWeight.Medium') >= 0);
  ok(`①b-2 ⛔ 不再是**实心 accent 芯片**（页签体内 \`onAccent\` ${countOf(chips, 'onAccent')} 次，应 0）`,
    countOf(chips, 'onAccent') === 0);
}
// ①c **不变式**：标签 ≤ 2 个汉字（含计数才放得进 1/5 宽 ≈ 63vp；见 `panelTabLabel` 头注）。
//     ⛔ 只钉"等分形态"不判别：谁把标签写长（如「子代理 12」），等分下文字会被挤/换行。
//     ⚠️ 标签定义在 `panelTabLabel`（**在 PanelsSheet 之前**）⇒ 必须换锚点切片，⛔ 别在 psBody 里找。
{
  const lblStart: number = idxSrc.indexOf('panelTabLabel(tab: string): string {');
  const lblEnd: number = idxSrc.indexOf('private panelTabs(): string[] {');
  const lblBody: string = lblStart >= 0 && lblEnd > lblStart ? idxSrc.slice(lblStart, lblEnd) : '';
  ok(`①c panelTabLabel 切片非空（零扫描判红，len=${lblBody.length}）`, lblBody.length > 100);
  const lbl: string[] = [];
  const re: RegExp = /return `([^`${]*)+\$\{suffix\}`/g;
  let m: any = re.exec(lblBody);
  while (m !== null) { lbl.push(String(m[1])); m = re.exec(lblBody); }
  ok(`①c 取到全部 tab 标签（现 ${lbl.length} 个，应 5）`, lbl.length === 5);
  let worst: string = '';
  for (let i: number = 0; i < lbl.length; i++) { if (lbl[i].length > worst.length) { worst = lbl[i]; } }
  ok(`①c 最长 tab 标签 ≤ 2 字（最长 =「${worst}」）`, worst.length > 0 && worst.length <= 2);
}

// ── ② 终端键帽：发丝边 + 统一最小键宽（**经单一取色点 `keyRoleColor`**）────────────────
// ⚠️ **不能只数全文件计数**：`hairlineOf(this.palOnce())` 全文件有 3 处（两个 builder + 面板根边）
//    ⇒ 删掉 `keyChip` 那一条仍 ≥2 ⇒ **假绿**（本轮自证时实测）。故**逐 builder 切片**断言。
// ⚠️ 2026-10-12 二次演进：为守住性能预算 **B 线 ≤1350 顶格**（只许减），两个键 builder 的 6 个
//    取色点已收进**单一取色点** `keyRoleColor(active, role)`（净 −2；实测 +3 ⇒ 1353 **真红**过一次）
//    ⇒ 判据随之演进为：**两个 builder 都经 `keyRoleColor` 取 border/bg/text**、
//    且 `keyRoleColor` 体内确实落到 `hairlineOf` / `surfaceFillOf`。⛔ 判据只演进不删除。
function builderBody(src: string, marker: string): string {
  const s: number = src.indexOf(marker);
  if (s < 0) { return ''; }
  const n: number = src.indexOf('@Builder', s + marker.length);
  return src.slice(s, n > 0 ? n : src.length);
}
/** 方法体切片：从 `签名) {` 到**下一个同级方法/`@Builder`**（够用即可，用于断言取色落点）。 */
function methodBody(src: string, marker: string): string {
  const s: number = src.indexOf(marker);
  if (s < 0) { return ''; }
  const n: number = src.indexOf('\n  }\n', s + marker.length);
  return src.slice(s, n > 0 ? n + 4 : src.length);
}
const keyChipBody: string = builderBody(termSrc, 'keyChip(label: string, seq: string) {');
const ctrlChipBody: string = builderBody(termSrc, 'ctrlChip() {');
const roleColorBody: string = methodBody(termSrc, 'private keyRoleColor(active: boolean, role: string): string {');
const minWDecl: number = countOf(termSrc, 'const KEY_MIN_W');
const keyBorderVia: number = countOf(keyChipBody, "this.keyRoleColor(false, 'border')");
const ctrlBorderVia: number = countOf(ctrlChipBody, "this.keyRoleColor(this.ctrlActive, 'border')");
const keyMinW: number = countOf(keyChipBody, 'minWidth: KEY_MIN_W');
const ctrlMinW: number = countOf(ctrlChipBody, 'minWidth: KEY_MIN_W');
const roleHairline: number = countOf(roleColorBody, 'hairlineOf(p)');
const roleSurface: number = countOf(roleColorBody, 'surfaceFillOf(p,');
const rolePalOnce: number = countOf(roleColorBody, 'this.palOnce()');
console.log(`  panel-scan ${TERM}: KEY_MIN_W=${minWDecl} keyRoleColor(长${roleColorBody.length}) palOnce=${rolePalOnce} hairline=${roleHairline} surface=${roleSurface} | keyChip 长${keyChipBody.length} borderVia=${keyBorderVia} minW=${keyMinW} | ctrlChip 长${ctrlChipBody.length} borderVia=${ctrlBorderVia} minW=${ctrlMinW}`);

ok(`键 builder 切片已切出（keyChip ${keyChipBody.length} / ctrlChip ${ctrlChipBody.length}）`,
  keyChipBody.length > 100 && ctrlChipBody.length > 100);
ok(`KEY_MIN_W 常量声明（${minWDecl} == 1）`, minWDecl === 1);
ok(`keyChip 经单一取色点拿描边色（${keyBorderVia} ≥ 1）`, keyBorderVia >= 1);
ok(`ctrlChip 经单一取色点拿描边色（${ctrlBorderVia} ≥ 1）`, ctrlBorderVia >= 1);
ok(`keyChip 消费统一最小键宽（${keyMinW} ≥ 1）`, keyMinW >= 1);
ok(`ctrlChip 消费统一最小键宽（${ctrlMinW} ≥ 1）`, ctrlMinW >= 1);
ok(`取色点落到 hairlineOf（${roleHairline} ≥ 1）`, roleHairline >= 1);
ok(`取色点落到 surfaceFillOf（${roleSurface} ≥ 1）`, roleSurface >= 1);
ok(`取色点**只取一次色**（palOnce ${rolePalOnce} == 1，B 线预算顶格）`, rolePalOnce === 1);

// ── 15g：面板刷新**绝不静默丢弃**（真机实证：切 tab 后列表停在空态，而后端同一会话有 48 条）────
const rpFrom: number = idxSrc.indexOf('private async refreshPanel()');
const rpTo: number = idxSrc.indexOf('\n  private ', rpFrom + 10);
const rp: string = rpFrom < 0 ? '' : idxSrc.substring(rpFrom, rpTo < 0 ? idxSrc.length : rpTo);
const rpQueueSet: number = countOf(rp, 'this.panelRefreshQueued = true;');
const rpQueueClear: number = countOf(rp, 'this.panelRefreshQueued = false;');
const rpQueueRead: number = countOf(rp, 'if (this.panelRefreshQueued) {');
const rpReenter: number = countOf(rp, 'this.refreshPanel();');
// ⛔ 旧的"静默丢弃"写法（`if (store === null || this.panelBusy) return;`）必须**已消失**。
const rpOldDrop: number = countOf(rp, 'if (store === null || this.panelBusy) {');
const swTabCall: number = countOf(
  idxSrc.substring(idxSrc.indexOf('private switchPanelTab'), idxSrc.indexOf('private switchPanelTab') + 200),
  'this.refreshPanel();');
console.log(`  panel-scan refreshPanel(长${rp.length}) 置位=${rpQueueSet} 清除=${rpQueueClear} 判读=${rpQueueRead} 重入=${rpReenter} 旧丢弃写法=${rpOldDrop} 切tab调刷新=${swTabCall}`);

ok(`刷新切片已切出（${rp.length} > 200）`, rp.length > 200);
ok(`⛔ 旧的"静默丢弃"写法已不存在（${rpOldDrop} == 0；有 ⇒ 切 tab 又会停空态）`, rpOldDrop === 0);
ok(`busy 时记「待刷新」而非丢弃（置位 ${rpQueueSet} == 1）`, rpQueueSet === 1);
ok(`finally 里判读待刷新（${rpQueueRead} == 1）`, rpQueueRead === 1);
ok(`判读后先清标志再重入（清除 ${rpQueueClear} == 1）`, rpQueueClear === 1);
ok(`重入按当前 tab 再刷一次（${rpReenter} == 1）`, rpReenter === 1);
ok(`切 tab 会触发刷新（switchPanelTab 内调 refreshPanel ${swTabCall} == 1）`, swTabCall === 1);

// ── ③ 终端画布：ANSI **背景**必须被渲染（15z8，用户"终端做的很差"的可判定落点）────────────
//   根因取证：`AnsiSpan` 一直带 `bg`/`inverse`、`vt.ets:863` 也一直在装配背景色，但画布 spans
//   **只设了 `fontColor`** ⇒ vim/htop/less 这类全屏 TUI（靠 `\x1b[48;…m` 与反色构图）整片花屏。
//   判据 = `ansiBgOf` 落进 `textBackgroundStyle`，且**每处画前景的 span 都同时画背景**（计数相等）。
const bgPaint: number = countOf(termSrc, 'textBackgroundStyle({ color: ansiBgOf(');
const fgPaint: number = countOf(termSrc, 'ansiFgOf(');
const bgImport: number = countOf(termSrc, 'ansiBgOf');
const bgFallbackDecl: number = countOf(termSrc, 'private canvasBgC(): string {');
const bgFallbackUse: number = countOf(termSrc, 'ansiBgOf(sp, this.textPrimaryC(), this.canvasBgC())');
const spanKeyBg: number = countOf(termSrc, '${si}:${sp.fg}:${sp.bg}:${sp.inverse ? 1 : 0}:${sp.text}');
// ⛔ 反色（SGR 7）的 swap 必须落在**真实底色**上：`defBg` 传 `transparent` ⇒ 反色时它变成
//    "字色" ⇒ 文字透明不可见（且底/字双双落 fallback ⇒ 反色块整块消失，真机截图实证）。
//    ⇒ **凡 `ansiBgOf(` 调用行都不得出现 `transparent`**（全组件目录扫，不只看终端）。
const FILES: string[] = fs.readdirSync(COMPONENTS).filter((f: string) => f.endsWith('.ets'));
let transBg: number = 0;
for (const f of FILES) {
  // ⚠️ 归一化空白后再扫：调用可能**跨行**书写（`textBackgroundStyle({\n color: ansiBgOf(`）
  //    ⇒ 按原样 `indexOf` 会漏/误判（本轮实测：`ToolVisual` 的多行形态被判"未配对" = 假红）。
  const s: string = stripComments(fs.readFileSync(path.join(COMPONENTS, f), 'utf8')).replace(/\s+/g, ' ');
  const hits: RegExpMatchArray | null = s.match(/ansiBgOf\(.{0,160}?transparent/g);
  if (hits !== null) {
    transBg += hits.length;
    console.log(`    ⚠️ ANSI 默认底传了 transparent：${f}`);
  }
}
console.log(`  panel-scan ${TERM}(画布): bgPaint=${bgPaint} fgPaint=${fgPaint} ansiBgOf=${bgImport} canvasBgDecl=${bgFallbackDecl} canvasBgUse=${bgFallbackUse} spanKeyBg=${spanKeyBg} | 全目录 ansiBgOf+transparent=${transBg}`);

ok(`画布渲染 ANSI 背景（textBackgroundStyle × ansiBgOf = ${bgPaint} == 1）`, bgPaint === 1);
ok(`⛔ 每处 span 前景色都配了背景（fg ${fgPaint} == bg ${bgPaint}）`, fgPaint === bgPaint);
ok(`背景默认走单一取色入口（声明 ${bgFallbackDecl} == 1 / 消费 ${bgFallbackUse} == 1）`,
  bgFallbackDecl === 1 && bgFallbackUse === 1);
ok(`⛔ span 键含 bg/inverse（${spanKeyBg} == 1；否则换色不重建 ⇒ 颜色卡住）`, spanKeyBg === 1);
ok(`⛔ ANSI 默认底色不是 transparent（${transBg} == 0；是 ⇒ 反色时字透明/整块消失）`, transBg === 0);

// ── ④ 通用规则：**凡画 ANSI 前景的渲染器，必须同时画背景**（15z8）──────────────────────
//   缺口取证：`grep -rl ansiFgOf` 后逐文件计数发现 `TaskDetailSheet`(fg=2/bg=0) 与
//   `TerminalSheet`(fg=1/bg=0) 两处只画前景 ⇒ 用户点名的「终端和任务管理做的很差」里，
//   ANSI 输出（htop/vim/less 全屏 TUI、反色高亮）全花屏。本规则把"配对"钉死，
//   将来任何新渲染器漏画背景都会在这里红（而不是等真机截图）。
let fgFiles: number = 0, unpaired: number = 0, paired: number = 0;
for (const f of FILES) {
  const s: string = stripComments(fs.readFileSync(path.join(COMPONENTS, f), 'utf8')).replace(/\s+/g, ' ');
  if (s.indexOf('ansiFgOf(') < 0) { continue; }
  fgFiles++;
  if (s.indexOf('textBackgroundStyle({ color: ansiBgOf(') >= 0) { paired++; } else {
    unpaired++;
    console.log(`    ⚠️ 只画前景未画背景：${f}`);
  }
}
console.log(`  panel-scan 组件目录 ANSI 渲染器：画前景=${fgFiles} 已配对=${paired} 未配对=${unpaired}`);

ok(`ANSI 渲染器全配对（画前景 ${fgFiles} 个文件，未配对 ${unpaired} == 0）`, unpaired === 0);
ok(`⛔ 零扫描判红：确实扫到了 ANSI 渲染器（${fgFiles} ≥ 4，否则扫描器与真源脱节）`, fgFiles >= 4);

// ── ⑤ 终端「不许把人拽回底部」（15z9，用户长期要求 #2「绝不能人机对抗」）────────────────────
//   根因取证：`flush()` **无条件** `this.follow()` ⇒ 用户上翻读历史时，每来一行输出就被
//   `scrollEdge(Bottom)` 拽回底部 ⇒ 根本读不了日志（与消息列表当年同一缺陷）。
//   判据 = 闸门在位（`if (this.followBottom)` 恰好 1 处）+ `this.follow();` 调用点**只有闸门内那一处**
//   （反向断言：多一处 = 又有无条件跟底）+ 恢复判据走 `core/listfollow.followAfterScrollStop`
//   + 用户意图只认"非程序滚动"（`SCROLLER`/`SCROLLER_ANIMATION` 两个枚举必须出现 ⇒ 守卫不是摆设）。
const flushGate: number = countOf(termSrc, 'if (this.followBottom) {');
const followCalls: number = countOf(termSrc, 'this.follow();');
const userGuard: number = countOf(termSrc, 'ScrollSource.SCROLLER');
const stopResume: number = countOf(termSrc, 'followAfterScrollStop(this.followBottom, this.scroller.isAtEnd())');
const onScrollStop: number = countOf(termSrc, '.onScrollStop(');
console.log(`  panel-scan ${TERM}(跟随): flushGate=${flushGate} follow()=${followCalls} ScrollSource.SCROLLER×${userGuard} stopResume=${stopResume} onScrollStop=${onScrollStop}`);

ok(`跟底闸门在位（flush 里 \`if (this.followBottom)\` = ${flushGate} == 1）`, flushGate === 1);
ok(`⛔ 全文件 \`this.follow();\` 只剩 ${followCalls} 处（多 ⇒ 又有无条件跟底把人拽走）`, followCalls === 1);
ok(`用户滚动意图判据含程序滚动两枚举（SCROLLER ×${userGuard} == 2）`, userGuard === 2);
ok(`滚动停止时按"是否贴底"恢复跟随（${stopResume} == 1 / onScrollStop ${onScrollStop} == 1）`,
  stopResume === 1 && onScrollStop === 1);

// ── 零扫描判红：链接线调用点合计必须 > 0（扫描器与真源脱节 ⇒ 红）──────────────────
ok('零扫描判红：运行面板/终端键帽接线证据合计 > 0',
  newBtn + termCall + newEmpty + minWDecl + keyBorderVia + ctrlBorderVia + roleHairline + rpQueueSet
  + bgPaint + bgFallbackUse + fgFiles + flushGate + stopResume > 0);

console.log(`  panel-terminal-wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
