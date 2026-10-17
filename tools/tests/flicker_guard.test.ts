/**
 * flicker_guard —— 历史闪烁 + 快速切会话全空 的双向判据（2026-10-17，用户亲报双 P0）。
 *
 * ── P0-A 闪烁（用户原话「渲染了的迭代一定不能消失，迭代一定是单向增长的」）──────────────
 *   根因①：`loadSessions` 对账读 `runNode.running === true`，而服务端 `/api/session-tree`
 *   **实测不回 running 字段**（curl 全文 0 次出现）⇒ undefined 恒 false ⇒ 每次 loadSessions
 *   都发 `session_running(false)` ⇒ 状态机把仍 live 的 turn 定格（行键变 ⇒ 整行重建）⇒
 *   下一帧 SSE delta 又翻回 busy ⇒ **双重翻转 = 闪烁**。
 *   修：`typeof runNode.running === 'boolean'` 守卫 —— **字段缺失 ≠ false**，缺失即跳过。
 *   纵深②：行键含 `rev`（迭代 commit ⇒ rev++ ⇒ 整行重建），新实例的 `@State blockLimit`
 *   回落默认小窗口 ⇒ **已渲染的迭代块瞬间折叠消失**（随后 widen 又出现）。修：块窗口
 *   **外置到 @Observed 行对象**（`ChatRow.blockLimit`）—— widen 写行字段、重建后从行数据
 *   恢复 ⇒ 折叠窗口只增不减（渲染过的迭代绝不消失）。
 *
 * ── P0-B 全空（用户原话「快速频繁切换会话 ⇒ 整个应用全是空且无法自动恢复，侧栏也空」）───
 *   根因：快速切换 ⇒ 多个 openSession 并发进 loadSessions（**无去重**）⇒ N 个重复
 *   `/api/session-tree` 请求在飞（模拟器 relay backlog=8 易被打满 ⇒ 请求挂死）⇒
 *   `historyLoading` 永不复位 ⇒ 「会话加载中…」永久卡死。
 *   修：`fetchSessionsOnce` in-flight 去重（成败都清，失败绝不缓存）+ switchSession 的
 *   **8s 自愈**（仍 loading 且仍是该会话 ⇒ 自动重拉 history —— 绝不永久卡死）。
 *
 * ── 判据形态 ────────────────────────────────────────────────────────────────────────
 *   钉**调用点/形态**（剥注释后扫描，零扫描判红）；mutation 自证：删守卫 / 改回 @State
 *   写入 / 删去重 ⇒ 各断言必红；还原 ⇒ 绿。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

export {};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}
function sliceBetween(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  if (a < 0) { return ''; }
  const b = src.indexOf(to, a + from.length);
  if (b < 0) { return ''; }
  return src.substring(a, b);
}

const REPO: string = path.resolve(__dirname, '../../../..');
const store: string = stripComments(fs.readFileSync(path.join(REPO, 'entry/src/main/ets/core/store.ets'), 'utf8'));
const rowdiff: string = stripComments(fs.readFileSync(path.join(REPO, 'entry/src/main/ets/core/rowdiff.ets'), 'utf8'));
const row: string = stripComments(fs.readFileSync(path.join(REPO, 'entry/src/main/ets/components/MessageRow.ets'), 'utf8'));
const idx: string = stripComments(fs.readFileSync(path.join(REPO, 'entry/src/main/ets/pages/Index.ets'), 'utf8'));

// ── ① P0-A 主刀：对账守卫（running 缺字段=false，但新鲜意图可覆盖）──────────────
// 2026-10-17 口径收敛：服务端 `running` 已去掉 omitempty（false 总在），客户端判据
// 统一到 `core/streammerge.runningAfterReconcile`（= HTTP 权威 + 15s 意图窗口）。
const guard: number = countOf(store, 'runningAfterReconcile(runNode.running === true');
const barePush: number = countOf(store, "running: runNode !== null && runNode.running === true");
console.log(`  flicker: 对账守卫=${guard} 旧裸对账=${barePush} rowLimit=${countOf(row, 'this.rowLimit()')} widen写行=${countOf(row, 'this.row.blockLimit = next')} 去重=${countOf(store, 'fetchSessionsOnce')} 自愈=${countOf(idx, 'st.loadHistory()')}`);

ok('① 对账守卫存在（runningAfterReconcile + 意图窗口，== 1）', guard === 1);
ok('① 守卫传入 intentBusyAt/intentIdleAt/SSE_INTENT_TTL_MS',
  countOf(store, 'this.intentBusyAt') >= 1 && countOf(store, 'this.intentIdleAt') >= 1
  && countOf(store, 'SSE_INTENT_TTL_MS') >= 1);
ok('① 旧裸对账（缺失即 false 且无意图窗口）已移除（== 0）', barePush === 0);

// ── ② P0-A 照抄 web：无窗口/无哨兵/键无 rev ──────────────────────────────────────
const noWindow: number = countOf(row, 'visibleBlocks') + countOf(row, 'hiddenBlockCount') + countOf(row, 'widenBlocks') + countOf(row, 'MSG_BLOCK_SENTINEL_H');
const noSentinel: number = countOf(row, '更早的 ${this.hiddenBlocks()}');
const keyNoRev: number = countOf(rowdiff, "return chatId + '#' + r.id;");
const keyWithRev: number = countOf(rowdiff, "return chatId + '#' + r.id + '#' + r.rev;");
ok('② 窗口函数族已从 MessageRow 移除（== 0）', noWindow === 0);
ok('② 哨兵行已删除（== 0）', noSentinel === 0);
ok('② 行键不含 rev（== 1）', keyNoRev === 1);
ok('② 旧含 rev 键已移除（== 0）', keyWithRev === 0);
ok('② shownIters 直返全部（>= 1）', countOf(row, 'return this.itersFor();') >= 1);

// ── ③ P0-B：loadSessions 并发去重 ──────────────────────────────────────────────────
const dedup: number = countOf(store, 'fetchSessionsOnce');
const directPost: number = countOf(store, "await this.http.postAs<SessionTreeData>('/api/session-tree'");
ok('③ fetchSessionsOnce 定义+调用（>= 2）', dedup >= 2);
ok('③ loadSessions 不再直连 postAs session-tree（== 0）', directPost === 0);

// ── ④ P0-B：8s 自愈（绝不永久卡死）────────────────────────────────────────────────
const switchSeg: string = sliceBetween(idx, 'private async switchSession', 'settleSwitchSlide');
ok('④ switchSession 片段取到（非空）', switchSeg.length > 0);
ok('④ 8s 自愈重拉 history 存在（== 1）', countOf(switchSeg, 'st.loadHistory()') === 1);
ok('④ 自愈挂在 delay 8000（>= 1）', countOf(switchSeg, '}, 8000);') >= 1);

// ── 零扫描判红 ─────────────────────────────────────────────────────────────────────
ok('零扫描判红：守卫证据合计 > 0', guard + noWindow + keyNoRev + dedup > 0);

console.log(`  flicker_guard: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
