/**
 * 「开抽屉 ⇒ 浮层互斥」接线门禁 —— `pages/Index.ets` 的**调用点证据**。
 *
 * ── 背景（真机实测，2026-10-12）───────────────────────────────────────────────────
 *   抽屉在渲染序里是**最底层的浮层**（build 里 `if (this.showDrawer)` 最先渲染；运行面板
 *   `if (this.showPanels)`、任务详情 `if (this.showTaskDetail)` 都在其后 ⇒ z 序更高）。
 *   而开抽屉的三条路径（抽屉按钮 / 深链 `xbot://sidebar.toggle` / 量测仪器代码）**都不收掉**
 *   更上层浮层 ⇒ 真机截到**三张浮层同屏**（会话抽屉 + 后台任务输出卡 + 运行面板），
 *   抽屉列表被盖住 ⇒ **看起来像坏了**（用户目标③「考虑所有的面板」明确的观感要求）。
 *
 * ── 钉什么（缺一即"以为修好了其实没有"）────────────────────────────────────────────
 *   ① 零扫描判红：`Index.ets` 真读到、两个切片都非空。
 *   ② **唯一开抽屉入口**：`this.showDrawer = true;` 全文件**恰 1 处**——就在 `openDrawer()` 里。
 *      ⛔ 任何"绕过 `openDrawer()` 直接开抽屉"的新代码都会让这条**变红**。
 *   ③ `openDrawer()` 内 `this.closeOverlaysAboveDrawer();` **恰 1 处**，且**先于** `showDrawer = true`。
 *   ④ 互斥清单**逐项登记**（每项 `false` 赋值在收口切片内**恰 1 处**）：
 *      newSession / queue / plugins / skills / files / selfCheck / status / model /
 *      settingsPanel / panels / taskDetail / terminal / searchHits / pluginHost / sessionStats
 *      + `sessMenuId = ''` / `ctxOpen` / `panelUrl = ''` / `pluginPageUrl = ''`。
 *      ⛔ 新增浮层忘了登记 ⇒ 这条**不会**自动红（它不是完备性证明），但"已登记项被删"必红。
 *   ⑤ 图片查看器走既有收口：切片内 `this.closeViewer();` **恰 1 处**（⛔ 不手写第二套重置）。
 *   ⑥ **反向锚**：全文件**不得**再出现旧写法 `this.showDrawer = !this.showDrawer;`（toggle 形式
 *      会绕过互斥）。
 *
 * ⚠️ 纪律：**剥注释**（注释里提到这些名字是文档，不是调用点）；计数一律**精确 `=== n`**
 *   （本仓教训：`>= n` 会假绿）；**切片内**定位（全文件 `.replace` 会打到切片外 ⇒ 判据假绿）。
 * ✅ 判据自证：mutation（切片内注入）· 删 `closeOverlaysAboveDrawer()` ⇒ 2 红 ·
 *   删一处登记（`showFiles = false`）⇒ 1 红 · 把收口搬到置位之后 ⇒ 1 红 · 还原 md5 一致。
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
// ① 零扫描判红 + 剥注释（注释里出现这些名字是文档，不是调用点）
ok('① 文件非空（零扫描判红）', raw.length > 100000, `len=${raw.length}`);
const src: string = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
ok('① 剥注释后仍非空', src.length > 100000, `len=${src.length}`);

// ② 唯一开抽屉入口
eq('② `showDrawer = true;` 全文件恰 1 处（唯一入口）', countIn(src, 'this.showDrawer = true;'), 1);
eq('② 反向锚：旧 toggle 写法 0 处', countIn(src, 'this.showDrawer = !this.showDrawer;'), 0);

// ③ openDrawer() 切片
const openMark: string = 'private openDrawer(): void {';
const i0: number = src.indexOf(openMark);
ok('③ 找得到 openDrawer()', i0 >= 0);
const i1: number = i0 >= 0 ? src.indexOf('\n  }', i0) : -1;
const openSlice: string = i0 >= 0 && i1 > i0 ? src.substring(i0, i1) : '';
ok('③ 切片非空（零扫描判红）', openSlice.length > 100, `len=${openSlice.length}`);
eq('③ 收口调用恰 1 处', countIn(openSlice, 'this.closeOverlaysAboveDrawer();'), 1);
eq('③ 置位恰 1 处', countIn(openSlice, 'this.showDrawer = true;'), 1);
const ci: number = openSlice.indexOf('this.closeOverlaysAboveDrawer();');
const si: number = openSlice.indexOf('this.showDrawer = true;');
ok('③ ⛔ 顺序：收口必须在置位之前', ci >= 0 && si >= 0 && ci < si, `ci=${ci} si=${si}`);

// ④ 互斥清单逐项登记（切片内恰 1 处）
const closeMark: string = 'private closeOverlaysAboveDrawer(): void {';
const j0: number = src.indexOf(closeMark);
ok('④ 找得到 closeOverlaysAboveDrawer()', j0 >= 0);
const j1: number = j0 >= 0 ? src.indexOf('\n  }', j0) : -1;
const closeSlice: string = j0 >= 0 && j1 > j0 ? src.substring(j0, j1) : '';
ok('④ 切片非空（零扫描判红）', closeSlice.length > 200, `len=${closeSlice.length}`);
const FLAGS: string[] = [
  'this.showNewSession = false;', 'this.showQueue = false;', 'this.showPlugins = false;',
  'this.showSkills = false;', 'this.showFiles = false;', 'this.showSelfCheck = false;',
  'this.showStatus = false;', 'this.showModel = false;', 'this.showSettingsPanel = false;',
  'this.showPanels = false;', 'this.showTaskDetail = false;', 'this.showTerminal = false;',
  'this.showSearchHits = false;', 'this.showPluginHost = false;', 'this.showSessionStats = false;',
  "this.sessMenuId = '';", 'this.ctxOpen = false;', "this.panelUrl = '';", "this.pluginPageUrl = '';",
];
for (let k = 0; k < FLAGS.length; k++) {
  eq(`④ 登记 ${FLAGS[k]}`, countIn(closeSlice, FLAGS[k]), 1);
}
// ⑤ 图片查看器走既有收口
eq('⑤ 图片走 closeViewer() 恰 1 处', countIn(closeSlice, 'this.closeViewer();'), 1);
eq('⑤ ⛔ 不手写第二套（不直接清 imagePixel）', countIn(closeSlice, 'this.imagePixel = null;'), 0);

console.log(`  drawer_exclusive_wiring: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
