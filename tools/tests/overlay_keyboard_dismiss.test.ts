/**
 * 「开浮层 ⇒ 先收软键盘」接线门禁 —— `pages/Index.ets` 的**调用点证据**。
 *
 * ── 背景（真机实测，2026-10-12）───────────────────────────────────────────────────
 *   聊天页 composer 常驻焦点 ⇒ 软键盘弹起。此时打开任何浮层（抽屉 / 运行面板 / 任务详情卡 /
 *   工具浮层 / 文件 / 技能 / 会话统计）而**不撤销焦点**时，键盘会**盖住浮层下半**：
 *   真机实证 —— 键盘弹起时抽屉底部 5 键从 `y2667` 被顶到 `y1719`（我按旧坐标点击直接打在
 *   键盘上 ⇒ 点不开面板）；运行面板「终端」tab 只剩标题 + 芯片，正文与输入行全在键盘之下
 *   （用户点名「终端和任务管理做的很差」的硬点之一）。
 *   Apple 语义：打开新浮层 ⇒ 旧上下文的输入焦点一并撤销（composer 的键盘随浮层一起退出）。
 *
 * ── 钉什么（缺一即"以为修好了其实没有"）────────────────────────────────────────────
 *   ① 零扫描判红：`Index.ets` 真读到、剥注释后非空。
 *   ② **总调用点数 == 9**：8 个浮层入口各 1 处 + `sendDraft()` 里发送后收键盘那 1 处
 *      （⛔ 那处是 2026-10-12 用户亲报的另一诉求，**不许**被这次改动挤掉）。
 *   ③ 八个入口**逐个**钉：切片内 `this.dismissKeyboard();` **恰 1 处**。
 *      ⛔ 任何"新加的浮层入口忘了收键盘"不会自动红（非完备性证明），但**已登记项被删必红**。
 *   ④ **顺序锚**：`openDrawer()` 内收键盘必须在 `this.showDrawer = true;` **之前**
 *      （放到之后等于"抽屉已经带着键盘弹出来了"，症状不变）。
 *   ⑤ `dismissKeyboard()` 本体走 `FocusController.clearFocus()`（唯一出口）——
 *      形状断言：定义切片内 `getFocusController().clearFocus()` 恰 1 处。
 *
 * ⚠️ 纪律：**剥注释**（注释里提到这些名字是文档，不是调用点）；计数一律**精确 `=== n`**
 *   （本仓教训：`>= n` 会假绿）；**切片内**定位（全文件 `.replace` 会打到切片外 ⇒ 判据假绿）。
 * ✅ 判据自证：mutation（切片内注入）· 删 `openPanels()` 里的调用 ⇒ 2 红 ·
 *   把 `openDrawer()` 的调用搬到置位之后 ⇒ 1 红 · 还原 md5 一致。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 标记为模块（顶层变量不落全局，避免与其它脚本测试重名 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` ｜ ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function countIn(s: string, needle: string): number {
  return s.split(needle).length - 1;
}

const REPO: string = path.resolve(__dirname, '../../../..');
const file: string = path.join(REPO, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets');
let raw: string = '';
try {
  raw = fs.readFileSync(file, 'utf8');
} catch (e) {
  console.log(`  ✗ 读不到 ${file}`);
  process.exit(1);
}
// ① 零扫描判红 + 剥注释
ok('① 文件非空（零扫描判红）', raw.length > 100000, `len=${raw.length}`);
const src: string = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
ok('① 剥注释后仍非空', src.length > 100000, `len=${src.length}`);

const CALL: string = 'this.dismissKeyboard();';

// ② 总调用点数（**9** 个入口 + sendDraft 里 1 处 = 10）
//    ⚠️ 2026-10-13（目标④ 任务管理收尾）：新增「定时任务详情」入口 `openCronDetail()` —— 它同样是
//    浮层入口，必须收键盘（详情卡占下半屏、被键盘压住就看不见内容）⇒ 计数 9 → **10**（恰 +1，留空档会假绿）。
eq('② 总调用点数恰 10（9 入口 + sendDraft 发送后）', countIn(src, CALL), 10);

// ③ 九个浮层入口逐个钉（切片内恰 1 处）
const OPENERS: string[] = [
  'private openDrawer(): void {',
  'private openPanels(): void {',
  'private openTaskDetail(t: BgTask): void {',
  // 定时任务详情（2026-10-13）：与后台任务详情**同一处置**（开卡前收键盘）。
  'private openCronDetail(job: CronJob): void {',
  'private openCtx(kind: string, rowId: string, iter: number, tool: string): void {',
  'private openToolsCtx(rowId: string, iter: number): void {',
  'private openFiles(): void {',
  'private openSkills(): void {',
  'private openSessionStats(): void {',
];
for (let k = 0; k < OPENERS.length; k++) {
  const mark: string = OPENERS[k];
  const a: number = src.indexOf(mark);
  ok(`③ 找得到 ${mark}`, a >= 0);
  const b: number = a >= 0 ? src.indexOf('\n  }', a) : -1;
  const slice: string = a >= 0 && b > a ? src.substring(a, b) : '';
  ok(`③ 切片非空（零扫描判红） ${mark}`, slice.length > 20, `len=${slice.length}`);
  eq(`③ 收键盘恰 1 处 ${mark}`, countIn(slice, CALL), 1);
}

// ④ 顺序锚：openDrawer() 内收键盘必须早于置位（否则"抽屉已带键盘弹出"，症状不变）
{
  const a: number = src.indexOf('private openDrawer(): void {');
  const b: number = a >= 0 ? src.indexOf('\n  }', a) : -1;
  const slice: string = a >= 0 && b > a ? src.substring(a, b) : '';
  const di: number = slice.indexOf(CALL);
  const si: number = slice.indexOf('this.showDrawer = true;');
  ok('④ ⛔ 顺序：openDrawer 内收键盘在置位之前', di >= 0 && si >= 0 && di < si, `di=${di} si=${si}`);
}

// ⑤ 唯一出口：dismissKeyboard 本体走 FocusController.clearFocus()
{
  const a: number = src.indexOf('private dismissKeyboard(): void {');
  ok('⑤ 找得到 dismissKeyboard()', a >= 0);
  const b: number = a >= 0 ? src.indexOf('\n  }', a) : -1;
  const slice: string = a >= 0 && b > a ? src.substring(a, b) : '';
  eq('⑤ 走 getFocusController().clearFocus() 恰 1 处', countIn(slice, 'getFocusController().clearFocus()'), 1);
}

console.log(`  overlay_keyboard_dismiss: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
