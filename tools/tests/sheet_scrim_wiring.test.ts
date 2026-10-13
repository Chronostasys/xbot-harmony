/**
 * 「模态遮罩」接线门禁 —— `pages/Index.ets` 的**调用点证据**（2026-10-13）。
 *
 * ── 背景（真机取证）─────────────────────────────────────────────────────────────
 *   用户目标③要求"考虑**所有**面板"。审终端 sheet 时在卡片左缘发现一个**孤字 `d`**：
 *   页面底部状态行 `deepseek-flash · /Users/bobli` 从 x=33 起，而终端卡片左缘在 x=53
 *   ⇒ 首字母左半截从卡片旁露出来（BMP 逐像素：y≈2468、x≈52、`#9e9fa9`）。
 *   根因不是终端，而是**每个浮层各自的点击捕获层都完全透明**（`Row(){Blank()}.width('100%')
 *   .height('100%').onClick(close)`，无 `backgroundColor`），只有抽屉那一处恰好带了 scrim
 *   ⇒ 除观感故障外还**没有模态感**（背后页面看起来还能点）。
 *
 * ── 钉什么（缺一即"以为修好了其实没有"）──────────────────────────────────────────
 *   ① 零扫描判红：`Index.ets` 真读到、切片非空、抽出的浮层旗标数 ≥ 10。
 *   ② **遮罩层恰 1 处**：`backgroundColor(this.eff().elev2)` 全文件**恰 1 处**
 *      （⛔ 逐浮层各加一份 = 叠成双倍黑；删掉 = 回到透明 ⇒ 都必红）。
 *   ③ **层级纪律**：该处必须**先于** `if (this.showDrawer)` 出现（ArkUI Stack 后声明者在上）
 *      ⇒ 遮罩盖住页面/WebSurface，又被每个浮层的捕获层盖住。
 *   ④ **完备性**：`build` 里**每一个** `if (this.showX)` 浮层旗标都必须被 `anyModalOpen()`
 *      消费（`showSplash` 除外 —— 开屏是不透明品牌画布，背后无可见内容）。
 *      ⛔ 这条是真防线：我第一版用 `core/overlays.hasOverlay(overlayState())`（**返回键链路的
 *      子集契约**）⇒ 终端/任务详情/定时详情/Git/文件/技能/统计/新建会话**全部漏掉**，装机量测
 *      当场否掉（终端打开时页面状态行仍 `#9e9fa9`，与修复前逐像素相同）。
 *
 * ⚠️ 纪律：**剥注释**（注释里提到这些名字是文档，不是调用点）；计数一律**精确 `=== n`**；
 *   `anyModalOpen()` 体按**括号配对**切出（切片外 `.replace` 会假绿）。
 * ✅ 判据自证（mutation）：从谓词里删 `this.showTerminal` ⇒ ④ 红；再删 `backgroundColor(
 *   this.eff().elev2)` ⇒ ② 红；把遮罩块挪到 `if (this.showDrawer)` 之后 ⇒ ③ 红；还原 ⇒ 全绿。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

// ⛔ 标记为模块（顶层变量不落全局，避免与其它脚本测试重名 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}`); }
}
function eq(name: string, got: number, want: number): void {
  ok(`${name}（期望 ${want}，实得 ${got}）`, got === want);
}

const REPO: string = path.resolve(__dirname, '../../../..');
const FILE: string = path.join(REPO, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets');
const raw: string = fs.readFileSync(FILE, 'utf8');

/** 剥注释：块注释 + 行注释（注释里写这些名字是文档，不是调用点）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const src: string = stripComments(raw);

// ── ① 零扫描判红 ──────────────────────────────────────────────────────────────
ok('① Index.ets 读到', src.length > 100000);

// 抽出所有浮层旗标：`if (this.showX)` / `if (this.ctxOpen)` / `if (this.sessMenuId...)`
const flags = new Set<string>();
const reIf = /if \(this\.([A-Za-z]+)/g;
let m: RegExpExecArray | null;
while ((m = reIf.exec(src)) !== null) {
  const name = m[1];
  if (name.startsWith('show') || name === 'ctxOpen' || name === 'sessMenuId') flags.add(name);
}
ok(`① 抽到浮层旗标 ${flags.size} 个（≥10）`, flags.size >= 10);

// ── ② 遮罩层恰 1 处 ───────────────────────────────────────────────────────────
const SCRIM = 'backgroundColor(this.eff().elev2)';
function countOcc(s: string, needle: string): number {
  return s.split(needle).length - 1;
}
eq('② 统一遮罩层恰 1 处', countOcc(src, SCRIM), 1);

const iScrim = src.indexOf(SCRIM);
// ── ③ 层级纪律：遮罩先于 build() 里**第一个浮层声明** ──────────────────────────
// ⛔ 切片纪律（我第一版踩了）：全文件 `indexOf('if (this.showDrawer)')` 会命中 L1408 的
//    **命令处理器**（`COMMAND_SIDEBAR_TOGGLE` 里 `if (this.showDrawer) { … } else { openDrawer() }`），
//    那不是浮层声明 ⇒ 假红。判据必须**只在 `build()` 体内**找浮层声明块。
const iBuild = src.indexOf('  build() {');
ok('③ 找到页面 build()', iBuild >= 0);
const buildSlice = iBuild >= 0 ? src.slice(iBuild) : '';
const iDrawerRel = buildSlice.indexOf('if (this.showDrawer)');
ok('③ build() 体内有抽屉浮层块', iDrawerRel >= 0);
ok('③ 遮罩层先于 build() 里的第一个浮层（z 序更低）',
  iScrim >= 0 && iDrawerRel >= 0 && iScrim > iBuild && (iScrim - iBuild) < iDrawerRel);

// ── ④ 完备性：每个浮层旗标都被 anyModalOpen() 消费 ─────────────────────────────
const iFn = src.indexOf('private anyModalOpen()');
ok('④ 找到 `anyModalOpen()`', iFn >= 0);
let body = '';
if (iFn >= 0) {
  const iOpen = src.indexOf('{', iFn);
  let depth = 0, i = iOpen;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  body = src.slice(iOpen, i + 1);
}
ok('④ anyModalOpen() 体切片非空', body.length > 100);

const EXCLUDE: string[] = ['showSplash'];
let checked = 0;
const missing: string[] = [];
flags.forEach((f: string) => {
  if (EXCLUDE.indexOf(f) >= 0) return;
  checked++;
  if (body.indexOf(`this.${f}`) < 0) missing.push(f);
});
ok(`④ 覆盖 ${checked} 个旗标（≥10）`, checked >= 10);
ok(`④ 漏掉的旗标 = 空（实为 [${missing.join(', ')}]）`, missing.length === 0);
ok('④ 非 show* 的三项也在内（ctxOpen/sessMenuId/askUser）',
  body.indexOf('this.ctxOpen') >= 0 && body.indexOf('this.sessMenuId') >= 0
  && body.indexOf('this.askUser') >= 0);

// ── ⑤ 反向锚：浮层捕获层不再各自带色（否则双倍黑）─────────────────────────────
const catchers = countOcc(src, ".width('100%').height('100%').onClick");
ok(`⑤ 捕获层仍保留点击收起（${catchers} 处 ≥ 10）`, catchers >= 10);

console.log(`  sheet_scrim_wiring: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
