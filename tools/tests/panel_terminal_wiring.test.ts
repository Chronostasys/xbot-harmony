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

// ── 零扫描判红：链接线调用点合计必须 > 0（扫描器与真源脱节 ⇒ 红）──────────────────
ok('零扫描判红：运行面板/终端键帽接线证据合计 > 0',
  newBtn + termCall + newEmpty + minWDecl + keyBorderVia + ctrlBorderVia + roleHairline + rpQueueSet > 0);

console.log(`  panel-terminal-wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
