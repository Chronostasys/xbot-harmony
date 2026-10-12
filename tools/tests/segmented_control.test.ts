/**
 * 分段控件形态契约 —— 「**选一个值**」全站只有一种语言（2026-10-13，目标③ 批次 15z12）。
 *
 * 病根（用户 2026-10-12 亲报「**实心芯片**」）：同一个 app 里"选一个值"长着三种脸 ——
 *   ① 运行面板页签   = **实心 accent 芯片** ×5（本批已改**下划线式**，判据在
 *      `panel_terminal_wiring.test.ts` ①b-2）；
 *   ② 思考模式（`ModelSheet` 内）= **实心 accent 芯片** ×4（**本单钉的对象**）；
 *   ③ 抽屉「分类」    = **iOS 分段控件**（下沉轨道 + 选中段浮起 + 文字加重）—— 本仓**唯一正确先例**。
 * ⇒ 本单钉：**"选值" 只许用分段控件**（③ 的形态），且两处站点**同尺寸常量**（`SEG_TRACK_H`/
 *    `SEG_PILL_H`）。⛔ 任一处回到"实心 accent 块"必须判红 —— 否则"按钮墙"会悄悄回归，
 *    而**没有单测钉形态**时它只会在真机走查里被发现（本仓血债：形态类回归全靠判据兜）。
 *
 * ⛔ 判据纪律（AGENTS.md「判据 ≠ 信号」）：
 *   · **只切调用片段**（锚点取该控件的特征文本）—— ⛔ 不整文件 grep：页面里有**多个**合法
 *     accent 实心块（表头「＋ 新建」/「＋ 新建会话」/设置「应用」按钮），整文件 grep `onAccent`
 *     会把它们算进来 ⇒ **假红**（本轮 ①b-2 实测踩过同一个坑）；
 *   · **零扫描判红**（读不到源 / 切片空 ⇒ 红，白绿防线）；
 *   · 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e`）。
 *
 * **mutation 自证（实跑过）**：
 *   · 思考模式那处改回 `palOnce().accent` 实心底 + `onAccent` 字 ⇒ ②③④ 各红一条；
 *   · 把 `SEG_TRACK_H` 换成 `RADIUS_CHIP` ⇒ 尺寸断言红；
 *   · 抽屉那处删掉 `surface.card`（选中段不浮起）⇒ ① 红。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
// ⛔ 有 `export {}`（⇒ TS 模块），避免与"无 import 的全局脚本"测试在聚合编译里撞名（本仓已入库 GOTCHA）。
export {};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function countOf(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

/** 探测仓库根（含 `entry/src/main/ets/core/design.ets` 的那层）。
 *  ⚠️ harness 会把测试**拷进** `.out-one.$$/js/` 再跑 ⇒ `__dirname` 不是 `tools/tests` ⇒
 *  必须像同族判据（`sheet_chrome.test.ts:69-76`）那样**向上探测**，⛔ 不写死相对层数。 */
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/core/design.ets'))) { return p; }
  }
  return '';
}

const root: string = findRoot();
ok('探测到仓库根（含 core/design.ets）', root.length > 0);

const IDX: string = path.join(root, 'entry/src/main/ets/pages/Index.ets');
const src: string = fs.readFileSync(IDX, 'utf8');
ok(`Index.ets 读到源码（零扫描判红，len=${src.length}）`, src.length > 1000);

/**
 * 切片辅助：从 `fromAnchor` 到 `toAnchor`（含 toAnchor 全文）。
 * ⛔ 两个锚点任一找不到 ⇒ 返回空串（调用方判红）；⛔ 不"取固定 N 字符"（会串到隔壁节点的属性上 ⇒ 假绿）。
 */
function sliceBetween(fromAnchor: string, toAnchor: string): string {
  const a: number = src.indexOf(fromAnchor);
  if (a < 0) {
    return '';
  }
  const b: number = src.indexOf(toAnchor, a);
  return b > a ? src.slice(a, b + toAnchor.length) : '';
}

// ── ① 站点 A：抽屉「分类」分段控件（本仓先例）────────────────────────────────
// ⚠️ 起点锚必须**早于**轨道那行 —— 轨道是 `Row().width('100%').height(SEG_TRACK_H)` 再接
//    `.id('xbot-seg-track')`，若从 `id(` 起切就会**漏掉 `SEG_TRACK_H`**（本轮实测假红一次）。
const segA: string = sliceBetween('① 分类切换器', '(c: string) => `cat-${c}`)');
console.log(`  seg-scan A 抽屉分类 len=${segA.length}`);
ok(`① 抽屉分段控件切片非空（零扫描判红，len=${segA.length}）`, segA.length > 300);
ok('① 轨道 = `SEG_TRACK_H`（视觉 36）', segA.indexOf('SEG_TRACK_H') >= 0);
ok('① 选中段浮起 = `SEG_PILL_H`（视觉 32）', segA.indexOf('SEG_PILL_H') >= 0);
ok('① 轨道面 = `surface.chip`', segA.indexOf("'surface.chip'") >= 0);
ok('① 选中段面 = `surface.card`', segA.indexOf("'surface.card'") >= 0);
ok('① 选中段文字加重（`FontWeight.Medium`）', segA.indexOf('FontWeight.Medium') >= 0);
ok(`① ⛔ 不得是实心 accent 块（accent 出现 ${countOf(segA, 'accent')} 次，应 0）`,
  countOf(segA, 'accent') === 0);

// ── ② 站点 B：模型选择器里的「思考模式」4 档（本批由实心芯片改分段控件）────────────
const segB: string = sliceBetween("Text('思考模式')", 'this.commitThinkingStep(i)');
console.log(`  seg-scan B 思考模式 len=${segB.length}`);
ok(`② 思考模式切片非空（零扫描判红，len=${segB.length}）`, segB.length > 300);
ok('② 轨道 = `SEG_TRACK_H`（与抽屉同一尺寸常量 ⇒ 不新增第二套）', segB.indexOf('SEG_TRACK_H') >= 0);
ok('② 选中段浮起 = `SEG_PILL_H`', segB.indexOf('SEG_PILL_H') >= 0);
ok('② 轨道面 = `surface.chip`', segB.indexOf("'surface.chip'") >= 0);
ok('② 选中段面 = `surface.card`', segB.indexOf("'surface.card'") >= 0);
ok('② 选中段文字加重（`FontWeight.Medium`）', segB.indexOf('FontWeight.Medium') >= 0);
ok('② 命中盒 ≥44 是**真实布局盒**（`.height(HIT_TARGET_MIN)`，⛔ 不靠 `responseRegion` 外扩）',
  segB.indexOf('.height(HIT_TARGET_MIN)') >= 0);
ok(`② ⛔ 不得是实心 accent 块（accent 出现 ${countOf(segB, 'accent')} 次，应 0）`,
  countOf(segB, 'accent') === 0);
// 反：底座没滑杆先例、也不许为"选值"自造 chip 墙（⛔ 回归防线：旧形态的 `Flex(wrap)` 芯片行）
ok('② ⛔ 不得回到 `Flex({ wrap: FlexWrap.Wrap })` 芯片行形态',
  segB.indexOf('Flex({ wrap: FlexWrap.Wrap })') < 0);
// 逐字口径：4 档文案来自 `core/settings.ets`（⛔ 组件不自己列一遍）—— 切片里不许出现硬编码档名
ok(`② ⛔ 档名不得硬编码（「思考++」出现 ${countOf(segB, '思考++')} 次，应 0）`,
  countOf(segB, '思考++') === 0);

if (fail > 0) {
  console.log(`  ✗ segmented_control: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ segmented_control: ${pass} passed, 0 failed`);
process.exit(0);
