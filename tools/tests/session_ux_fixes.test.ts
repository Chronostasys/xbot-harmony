/**
 * 判据：本轮四条用户报障的**形态契约**（用户 2026-10-14 亲报）。
 *
 * ① 三处「更早」提示视觉语言收敛（页面头项 / 「更早的 N 个区域」/「更早的 N 个迭代块」）
 * ② cancel 后「上下文已压缩」跑到最下方 ⇒ 压缩点**越界挂起**（不在不存在的两迭代之间画线）
 * ③ 切会话拉历史期间要有「会话加载中」splash（且失败也必撤）
 * ④ 主题**全局单一真源**：切到池里另一个 store 时，缺 `md-theme` 键**不得**用默认色板覆盖
 *
 * 判别力（mutation 自证）：
 *   · 头项写回 `'下拉到底部自动加载更早消息'` ⇒ ① 红；
 *   · 删 `compaction.ets` 的越界守卫 ⇒ ② 红；
 *   · 删 `switchSplash` 的置位/复位/渲染任一处 ⇒ ③ 红；
 *   · 主题判据写回 `Object.keys(store.settings).length > 0` ⇒ ④ 红；源码读不到 ⇒ 零扫描防线红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

const fs: { readFileSync(p: string, e: string): string } = require('fs');
const path: { join(...parts: string[]): string } = require('path');

const root: string = path.join(__dirname, '..', '..', '..', '..');
const indexSrc: string = fs.readFileSync(path.join(root, 'entry/src/main/ets/pages/Index.ets'), 'utf8');
const msgRowSrc: string = fs.readFileSync(
  path.join(root, 'entry/src/main/ets/components/MessageRow.ets'), 'utf8');
const compactionSrc: string = fs.readFileSync(
  path.join(root, 'entry/src/main/ets/core/compaction.ets'), 'utf8');

let failed: number = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

console.log('session_ux_fixes:');

// ── 零扫描防线（路径写错 ⇒ 立刻红，防"全绿假象"）────────────────────────────────
ok(indexSrc.length > 50000, 'Index.ets 真读到了内容（零扫描防线）');
ok(msgRowSrc.length > 20000, 'MessageRow.ets 真读到了内容（零扫描防线）');
ok(compactionSrc.length > 3000, 'compaction.ets 真读到了内容（零扫描防线）');

// ── ① 三处「更早」提示同一视觉语言 ─────────────────────────────────────────────
ok(indexSrc.indexOf("'下拉底部自动加载更早消息'") < 0
  && indexSrc.indexOf('下拉到底部自动加载更早消息') < 0,
  '头项不再用「下拉到底部自动加载更早消息」这种**另一套**文案');
ok(indexSrc.indexOf("Text(this.hasMore ? '更早的历史消息' : '已到最早')") >= 0,
  '头项改用与行内哨兵同族的「更早的…」文案');
ok(indexSrc.indexOf("Text('正在加载更早…')") >= 0, '头项加载态与行内同为「正在加载……」形态');
// 三处的字形/字号/取色必须一致（两处行内哨兵 + 页面头项）
ok(msgRowSrc.indexOf("Text(`更早的 ${this.row.regionsBefore} 个区域`)") >= 0
  && msgRowSrc.indexOf("Text(`更早的 ${this.hiddenBlocks()} 个迭代块`)") >= 0,
  '两处行内哨兵在位（区域 / 迭代块）');
const chevronUp: number = (
  msgRowSrc.split("$r('sys.symbol.chevron_up')").length - 1
) + (indexSrc.split("$r('sys.symbol.chevron_up')").length - 1);
ok(chevronUp >= 3, `三处「更早」都用同一枚 chevron_up 字形（实测 ${chevronUp} 处）`);
ok(msgRowSrc.indexOf("Text(`更早的 ${this.hiddenBlocks()} 个迭代块`).fontSize(FS_META)") >= 0
  && indexSrc.indexOf("Text(this.hasMore ? '更早的历史消息' : '已到最早')\n                  .fontSize(FS_META)") >= 0,
  '三处同字号（FS_META）');

// ── ② 压缩点越界挂起（不在不存在的两迭代之间画线）──────────────────────────────
ok(compactionSrc.indexOf('iterNums[iterNums.length - 1] < after') >= 0,
  'compaction.ets 有「afterIteration 超出末迭代 ⇒ 挂起」守卫');
ok(compactionSrc.indexOf('iterNums[0] > after') >= 0,
  '原「窗口外（早于首迭代）⇒ 挂起」守卫仍在（web :1003 同源）');
ok(compactionSrc.indexOf('anchor = n') >= 0, '锚定扫描（max{n ≤ after}）仍在（web 逐字）');

// ── ③ 切会话 splash ───────────────────────────────────────────────────────────
ok(indexSrc.indexOf('@State switchSplash: boolean = false;') >= 0, 'switchSplash 状态位已声明');
ok(indexSrc.indexOf('this.switchSplash = true;') >= 0, '真网络等待路径上置位');
ok(indexSrc.indexOf('this.switchSplash = false;') >= 0, '收尾（含失败）复位');
ok(indexSrc.indexOf("Text('会话加载中…')") >= 0, 'splash 文案在位');
ok(indexSrc.indexOf(".id('xbot-session-splash')") >= 0, 'splash 有稳定 id（装机 dump 可判）');
ok(indexSrc.indexOf('if (!this.switchSplash\n        && showsHistorySkeleton(') >= 0,
  'splash 与骨架屏互斥（不同时渲染两套加载态）');

// ── ④ 主题全局单一真源 ────────────────────────────────────────────────────────
ok(indexSrc.indexOf('const mdRaw: string = settingOf(store.settings, KEY_MD_THEME);') >= 0,
  '主题判据取自**权威原值**（mdRaw）');
// 2026-10-17 单会话主题回退 p0：判定收紧为「缺该键 **或** settings 未确认（旧缓存）都不动」
//（store.settingsFresh——loadSettings 完成才 true；池里 store 的旧深值不再覆盖全局
// themeName——「切部分会话突然变回深色，开设置又变浅」的根治）。
ok(indexSrc.indexOf('if (mdRaw.length > 0 && store.settingsFresh) {') >= 0, '缺该键/未确认 ⇒ 不动主题（继承全局值）');
ok(indexSrc.indexOf('this.themeName = renderThemeKey(appPaletteForMdTheme(settingOf(store.settings, KEY_MD_THEME))') < 0,
  '旧的「settings 非空就重算」写法已消失（那正是"突变又变回"的根因）');

console.log(failed === 0 ? 'session_ux_fixes: ALL PASS' : `session_ux_fixes: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

// ⛔ 必须把本文件声明为**模块**（`run.sh` 的聚合编译把非模块测试文件归入**同一全局作用域**
//    ⇒ 两个文件都 `declare const process/__dirname` + 同名顶层函数会撞 TS2451/TS2393）。
export {};
