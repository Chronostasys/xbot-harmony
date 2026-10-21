/**
 * 判据：`loadMore`（加载更早历史）**失败不静默 + 游标失效自愈**。
 *
 * 事故（2026-10-15 用户亲报「加载不出更早」）：头部提示按 `hasMore` 渲染
 * 「下拉到底部自动加载更早消息」⇒ 客户端自述"还有更早"，但滑到顶**列表纹丝不动、零反馈**。
 * 根因形态（代码级确证）：
 *   · `core/store.ets:loadMore()` 三道闸门 `!hasMore || loadingMore || oldestId <= 0` **全部静默 `return`**；
 *   · 且整段**无 catch** ⇒ 请求失败时异常直接抛进 `onScrollIndex` 回调（无人接）⇒ 用户看不到任何东西。
 * 修法（本判据钉住）：
 *   ① `loadMoreErr` 字段（真结果可见）+ `LOADMORE_ERR_NOCURSOR` 哨兵（游标失效）；
 *   ② `loadMore()` 的**守卫里不得再有 `oldestId <= 0`**（它必须是"落哨兵 + 返回"，而不是静默）；
 *   ③ `loadMore()` 必须有 catch 并落 `loadMoreErr`；
 *   ④ 页面（`pages/Index.ets`）必须**消费**哨兵：重拉首页（`openSession`）自愈 + 真实失败 toast。
 *
 * 判别力（mutation 自证）：
 *   · 删掉 store 的 `loadMoreErr` 字段 ⇒ ① 红；
 *   · 把守卫改回 `|| this.oldestId <= 0` 且去掉 catch ⇒ ②/③ 红；
 *   · 删掉页面的 `LOADMORE_ERR_NOCURSOR` 分支 ⇒ ④ 红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

const fs: { readFileSync(p: string, e: string): string } = require('fs');
const path: { join(...parts: string[]): string } = require('path');
const repoRoot: string = path.join(__dirname, '..', '..', '..', '..');
const storePath: string = path.join(repoRoot, 'entry/src/main/ets/core/store.ets');
const pagePath: string = path.join(repoRoot, 'entry/src/main/ets/pages/Index.ets');

const storeSrc: string = fs.readFileSync(storePath, 'utf8');
const pageSrc: string = fs.readFileSync(pagePath, 'utf8');

let failed: number = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

/** 取 `loadMore()` 方法体切片（从声明行到下一个方法边界），避免全文误匹配。 */
function loadMoreBody(src: string): string {
  const start: number = src.indexOf('async loadMore(): Promise<void> {');
  if (start < 0) {
    return '';
  }
  // 到下一个顶层方法声明（4 空格缩进的 `async ` 或 `private`）为止——取一个足够长的窗口，
  // 只要覆盖守卫 + catch 即可（多取无害：下面的断言都是"必须存在"型）。
  const rest: string = src.substring(start, start + 4000);
  return rest;
}

console.log('loadmore_resilience:');

// ── ① store：真结果字段 + 哨兵码 ────────────────────────────────────────────────
ok(storeSrc.indexOf('loadMoreErr: string = \'\';') >= 0,
  'store 有 loadMoreErr 字段（真结果可见，⛔ 不静默）');
ok(/export const LOADMORE_ERR_NOCURSOR: string = '\S+';/.test(storeSrc),
  'store 导出 LOADMORE_ERR_NOCURSOR 哨兵码');

const body: string = loadMoreBody(storeSrc);
ok(body.length > 0, 'store 里能定位到 loadMore() 方法体');

// ② 守卫里**不得**再有 oldestId 静默闸门
ok(body.indexOf('if (!this.hasMore || this.loadingMore) {') >= 0,
  'loadMore 守卫只留 hasMore/loadingMore（不含 oldestId 静默闸门）');
ok(body.indexOf('!this.loadingMore || this.oldestId <= 0') < 0
  && body.indexOf('this.loadingMore || this.oldestId <= 0') < 0,
  'loadMore 守卫**不得**内联 oldestId <= 0（旧静默闸门）');

// ③ 游标失效 ⇒ 落哨兵（而非静默 return）
const cursorIdx: number = body.indexOf('if (this.oldestId <= 0) {');
ok(cursorIdx >= 0, 'loadMore 对 oldestId <= 0 有显式分支');
ok(cursorIdx >= 0 && body.substring(cursorIdx, cursorIdx + 200).indexOf('LOADMORE_ERR_NOCURSOR') >= 0,
  '该分支落 LOADMORE_ERR_NOCURSOR（而不是静默 return）');

// ④ 失败必须 catch 并落 loadMoreErr
ok(/\} catch \(e\) \{/.test(body), 'loadMore 有 catch（失败绝不静默）');
ok(body.indexOf('this.loadMoreErr = msg.length > 0 ? msg : ') >= 0,
  'catch 里把可读原因落进 loadMoreErr');

// ── ⑤ 页面：消费哨兵（自愈）+ 真实失败 toast ────────────────────────────────────
ok(pageSrc.indexOf('import { ChatStore, LOADMORE_ERR_NOCURSOR }') >= 0,
  '页面 import 了 LOADMORE_ERR_NOCURSOR（判据与动作同源）');
ok(pageSrc.indexOf('if (err === LOADMORE_ERR_NOCURSOR) {') >= 0,
  '页面区分哨兵：游标失效走自愈分支');
// ⛔ 锚点修正（2026-10-21）：`openSession` 现在带 channel（规范键必需，`web:chat_X` 否则成
//   幽灵会话）⇒ 旧正则（无参形态）恒不匹配 ⇒ 假红。只钉"await 调用 openSession 且以
//   `this.currentChat` 开头"，参数个数不作判据。
ok(/await store\.openSession\(\s*this\.currentChat\b/.test(pageSrc),
  '自愈分支重拉首页（openSession 重建游标）');
ok(pageSrc.indexOf('加载更早失败：${err}') >= 0,
  '真实失败给可读 toast（⛔ 不静默）');

// ── ⑥ 零扫描防线：必须有扫描到东西（防止路径写错导致"全绿假象"）───────────────
ok(storeSrc.length > 10000 && pageSrc.length > 10000,
  '两处源码都真的读到了内容（零扫描防线）');

console.log(failed === 0 ? 'loadmore_resilience: ALL PASS' : `loadmore_resilience: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

// ⛔ 必须把本文件声明为**模块**（`tools/tests/run.sh` 的聚合编译把非模块测试文件归入**同一全局
//    作用域** ⇒ 两个文件都 `declare const process/__dirname` + 同名顶层函数会撞 TS2451/TS2393
//    —— 实测踩到：本文件与 `one_inflight_motion.test.ts` 互撞、整条 ① 步编译失败）。
//    `export {}` 后各文件作用域独立（同仓 `nav_seq_storage_wiring.test.ts` 同款处置）。
export {};
