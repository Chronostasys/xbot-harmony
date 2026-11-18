/**
 * pill_badge_single_source.test.ts —— `+N` 的**取数必须同源**（形态判据）。
 *
 * 用户 2026-11-14 P0：「`+N` 的工具列表里的工具是错的，和真实的对不上」。
 * 根因是"三处各算一遍"：直出 pill（fold 后去重）、徽标 N（fold 不去重）、溢出列表（整块重算 + 位置切片）
 * ⇒ 组里一旦有"同一调用的残留副本"，三处必然对不上（数字比列表多、列表里冒出已直出的那枚、
 * 真工具被挤出列表）。权威口径（web `MergedPills`+`OverflowPillsMenu`）：一个数组 → 一次去重 → 一次切片。
 *
 * 本判据钉**调用点**（⛔ 不钉"方法体存在"——那会假绿）：
 *   ① 组件层不得直接调 `foldPills(`（唯一入口是 `core/streammerge.pillView`）；
 *   ② `IterBlocksView` 的直出 / 徽标 / 溢出三处都走 `pillView`；
 *   ③ 溢出浮层按**被点的那一组**取数（`overGroup`）——`bindPopup` 与徽标底色都得带组下标；
 *   ④ `LiveTailView` 同源（不许自己再 fold 一遍）。
 *
 * ⛔ mutation 自证：把 `groupHideCount` 改回 `foldPills(group).hideCount` ⇒ ① 红；
 *   把 `overTools()` 改回整块取数（去掉 `overGroup`）⇒ ③ 红。
 */
export {};

declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function read(rel: string): string {
  const root: string = path.join(__dirname, '..', '..', '..', '..');
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** 去掉注释（⛔ 判据不能把注释里的字样当违规）。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/.*$/gm, '');
}

const iter = stripComments(read('entry/src/main/ets/components/IterBlocksView.ets'));
const live = stripComments(read('entry/src/main/ets/components/LiveTailView.ets'));
const pop = stripComments(read('entry/src/main/ets/components/ToolPopover.ets'));

// ── ① 组件层不得直接 foldPills ────────────────────────────────────────────────
ok('① IterBlocksView 不得直接调 foldPills（唯一入口 pillView）', iter.indexOf('foldPills(') < 0);
ok('①b LiveTailView 不得直接调 foldPills', live.indexOf('foldPills(') < 0);

// ── ② 三处取数都走 pillView ──────────────────────────────────────────────────
function count(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}
ok('② 直出走 pillView(group).shown', iter.indexOf('pillView(group).shown') >= 0);
ok('②b 徽标走 pillView(group).hideCount', iter.indexOf('pillView(group).hideCount') >= 0);
ok('②c 溢出列表走 pillView(...).hidden', count(iter, 'pillView(') >= 3 && iter.indexOf('.hidden') >= 0);
ok('②d 旧的"整块重算"入口已删除（hiddenPills 不得存在）', iter.indexOf('hiddenPills') < 0);

// ── ③ 溢出浮层必须锚到被点的那一组 ───────────────────────────────────────────
ok('③ 溢出面有组下标状态', iter.indexOf('overGroup') >= 0);
ok('③b 绑定条件含组下标', iter.indexOf('this.overIter === it.iteration && this.overGroup === gi') >= 0);
// ⚡ 2026-11-18：改为"先取数后打开" ⇒ 打开路径里直接记 （关闭路径清零）。
// ⚡ 2026-11-18 终版：`+N` 走 `toggleOverflow()`（先预取、再打开），组下标在打开时写入。
ok('③c 打开时记录组下标', iter.indexOf('this.overGroup = gi;') >= 0);
ok('③d 取数按组（capture 时按 overGroup 查组）',
  iter.indexOf('pillView(groups[this.overGroup]).hidden') >= 0);
// ⛔ 徽标与列表必须**同刻捕获**：浮层只渲染点击那一刻的 hidden（否则两处各算一次 ⇒ N 与条数差 1）
// 2026-11-18: +N 改成内联列表（popup builder 不重建 = 卡死在 loading 的根因）
//   => 取数直接是该组当前 hidden（同一个 pillView），详情由 withToolDetail 覆盖层补。
// 2026-11-18 终版：popup 子树只构建一次 ⇒ **先取数、再打开**（打开时捕获的已是带摘要的那批）；
//   浮层自身不再做"打开后刷新"（那条路在 popup 里不可靠）。
ok('③e 打开前先预取（toggleOverflow + allSettled 后打开）',
  iter.indexOf('private toggleOverflow(') >= 0 && iter.indexOf('const settle: Promise<void>[] = [];') >= 0);
ok('③f 列表是内联的（不再依赖 popup 捕获快照）', iter.indexOf('ToolOverflowList({') >= 0);
// ⛔ 用户 2026-11-17「有时候 +N 的 N 会多 1 个」：浮层内容是**打开那一刻**构建的，徽标却是每帧重算
//   ⇒ 开着的时候来一帧就出现「数字比列表多 1」。修法：打开期间徽标显示**列表那一份的长度**。
ok('③g 徽标数字走 badgeCount（打开期间与列表同长）', iter.indexOf('Text(`+${this.badgeCount(group, it, gi)}`)') >= 0);
ok('③h 徽标可见性也用同一数字', iter.indexOf('|| this.badgeCount(group, it, gi) > 0)') >= 0);
ok('③i 在飞尾项同口径（badgeN 捕获）',
  live.indexOf('Text(`+${this.badgeN()}`)') >= 0 && live.indexOf('private badgeN(): number') >= 0
  && live.indexOf('return this.overOpen && this.overList.length > 0 ? this.overList.length : this.hideN();') >= 0);
ok('③j 在飞尾项同口径（传捕获列表）',
  live.indexOf('tools: this.overList,') >= 0);
// ⛔ 用户 2026-11-17「第一次点开看不到参数/输出，关闭再打开才有」：
//   popup 子树不重建 ⇒ 浮层必须**自订阅**详情代数，并在渲染前合上覆盖层。
ok('③k 溢出浮层自订阅详情代数', pop.indexOf("@StorageProp('toolDetailGen') toolGen: number = 0;") >= 0);
// ⛔ 用户 2026-11-18：「新工具完成了 `+N` 的数字还是老的，点一下变一下、再点变回来」——
//   根因：浮层被**点外部/返回**关闭时没清 `overIter` ⇒ `badgeCount()` 一直认为"还开着"
//   ⇒ 数字永远取冻结的 `overList.length`。⇒ 溢出浮层必须配 `onWillDismiss` 清状态。
ok('③l0 溢出浮层关闭时清 overIter（徽标回到实时值）',
  iter.indexOf('onWillDismiss: (action: DismissPopupAction) => {') >= 0
  && iter.indexOf('this.overList = [];') >= 0);
ok('③l 渲染前仍合覆盖层（字段级保鲜）',
  pop.indexOf('withToolDetail(this.tools[i])') >= 0);
// 严禁轮询（用户 2026-11-18 批注）：等 flush 走 store 的同步 rebuildRows，不 setTimeout
ok('③l2 单枚 pill 先取数再打开（toggleToolPop → await → 直接打开）',
  iter.indexOf('private toggleToolPop(') >= 0 && iter.indexOf('this.popPendingSlot = slot;') >= 0
  && iter.indexOf('openPopWhenReady') < 0);
// 2026-11-18: 缺详情 ⇒ 渲染**紧凑 loading**（不是把 label 当正文铺开）
// 2026-11-18（用户：有数据就显示摘要，别拿 loading 盖住）=> loading 只给「彻底空心」的工具
// ⛔ 用户 2026-11-18：「loading 一旦显示就永远不消失」的根因 = loading 是**数据内容的函数**
//   （对没有 iteration_detail 的合成工具恒真）。⇒ loading 只许由**请求在飞**决定（`busyIdx`），
//   且必须在 `finally` 里无条件清除。
ok('③n 单行展开也会兜底取数', pop.indexOf('this.onEnsure(') >= 0);
// ⛔ 用户 2026-11-18 P0「加载中永远不会结束，要第二次点开才正常」：
//   浮层一旦打开就不再重建 ⇒ 必须**先取数、后打开**（缺详情时徽标转圈，数据到了自动打开）。
// 用户 2026-11-18 P0: 绝不能"缺详情就不打开"（那会永久卡在加载）
// 交互回到 popup（用户 2026-11-18：统一 popup）——但浮层内容自订阅详情代数，后到详情即时刷新。
ok('③p 溢出浮层 = popup（统一交互）',
  iter.indexOf('builder: this.OverflowPopBody') >= 0 && iter.indexOf('private overTools(): ToolProgress[] {') >= 0);
ok('③q 徽标不再有永久转圈分支（点击必开）',
  iter.indexOf('overWaitIter === it.iteration && this.overWaitGi === gi') < 0);

// ── ④ 分组也同源（记忆化纯函数）─────────────────────────────────────────────
ok('④ 分组走 core 纯函数 toolPillGroups', iter.indexOf('toolPillGroups(') >= 0);

console.log(`pill_badge_single_source: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
