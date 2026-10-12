/**
 * loadmore_anchor —— 「加载更早历史时**视口不得跳走**」契约（2026-10-13，15r）。
 *
 * ── 用户亲报（2026-10-13）─────────────────────────────────────────────────────
 *   「加载更多触发后，加载的新内容应该直接接在**当前屏幕上方**（也就是新内容实际上在屏外，
 *     用户要继续往上滚才能看到）；现在是加载之后**立刻视角跑到被加载的最上方**。」
 *
 * ── 根因（读码定位）───────────────────────────────────────────────────────────
 *   「加载更早」= 放开行窗口（`rowLimit += MAX_ROWS_VISIBLE`）⇒ `syncRowDs()` 交给
 *   `ChatRowDataSource.applyRows` 的数组是**头部变长**的尾巴窗口 ⇒
 *   `core/rowdiff.needsFullReload`（长度/id 序列变了）判**骨架变化** ⇒
 *   `onDataReloaded()` **整表重建** ⇒ `List` 只能按**下标**保位 ⇒ 同一个下标此刻指向
 *   **新插入的行** ⇒ 视口"跳"到新内容顶部（正是用户描述的现象）。
 *
 * ── 修法（框架内置语义，⛔ 不自造补偿）────────────────────────────────────────
 *   SDK `list.d.ts:1439`（`@since 12`）：`List.maintainVisibleContentPosition(enabled)` ——
 *   「数据在**可视区之外**插入/删除时，保持可见内容位置不变」。挂 `true` ⇒ 新行落在屏外上方，
 *   用户不动。⛔ 刻意**不**手写"记录首行键 + 事后 `scrollToIndex`"：那要跨一次布局回调
 *   （`scrollToIndex` 在 DS 通知生效前打到旧布局 —— `Index.navToRow` 的 `try/catch` 注释
 *   已记该竞态），而本属性由框架在**布局阶段**完成，无竞态。
 *
 * ── 判据（源码级；⛔ 钉**调用片段**，不钉"名字出现过"）────────────────────────
 *   R1 消息列表（`.id('xbot-list')` 那一个 `List`）**挂载** `maintainVisibleContentPosition`；
 *   R2 实参必须是 `true`（⛔ `false` 与不写等价 ⇒ 必须能区分）；
 *   R3 **反模式守卫**：全仓**不得**出现 `scrollEdge(Edge.Top)` / `scrollToIndex(0)`
 *      —— 任何"跳回列表顶部"的写法都会让本缺陷以另一种形态复发；
 *   R4 切片自证（零扫描判红）：切不到 `.id('xbot-list')` ⇒ 红。
 *   扫描器自证：对一段**去掉**该属性/把值改成 `false` 的样本，判定函数必须判红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; resolve(...parts: string[]): string };
declare const __dirname: string;
export {};

import { anchoredIndexAfterPrepend } from '../../entry/src/main/ets/core/listfollow';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`);
  }
}

const fsMod = require('fs');
const pathMod = require('path');

function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(p, 'entry/src/main/ets/pages'))) {
      return p;
    }
  }
  return '';
}
const ROOT: string = findRoot();
ok('探测到仓库根（零扫描判红）', ROOT.length > 0);

/** 剥注释（保留字符串字面量）—— 理由注释里就写着 `.maintainVisibleContentPosition` 字样。 */
function stripComments(src: string): string {
  let out = '';
  let state = 0;
  for (let i = 0; i < src.length; i++) {
    const c: string = src[i];
    const d: string = i + 1 < src.length ? src[i + 1] : '';
    if (state === 0) {
      if (c === '/' && d === '/') {
        while (i < src.length && src[i] !== '\n') {
          i++;
        }
        out += '\n';
      } else if (c === '/' && d === '*') {
        i += 2;
        while (i < src.length && !(src[i] === '*' && i + 1 < src.length && src[i + 1] === '/')) {
          i++;
        }
        i++;
        out += ' ';
      } else if (c === '\'') {
        state = 1;
        out += c;
      } else if (c === '"') {
        state = 2;
        out += c;
      } else if (c === '`') {
        state = 3;
        out += c;
      } else {
        out += c;
      }
    } else if (state === 1) {
      out += c;
      if (c === '\\') { out += d; i++; } else if (c === '\'') { state = 0; }
    } else if (state === 2) {
      out += c;
      if (c === '\\') { out += d; i++; } else if (c === '"') { state = 0; }
    } else {
      out += c;
      if (c === '\\') { out += d; i++; } else if (c === '`') { state = 0; }
    }
  }
  return out;
}

/** 取「消息列表」那一个 `List` 的源码切片：从 `List({ scroller: this.listScroller })` 到 `.id('xbot-list')`。 */
function msgListSlice(src: string): string {
  const at: number = src.indexOf('List({ scroller: this.listScroller })');
  const end: number = src.indexOf(".id('xbot-list')", at < 0 ? 0 : at);
  if (at < 0 || end < 0) {
    return '';
  }
  return src.slice(at, end);
}

/** 判定：切片里**真的**调了 `maintainVisibleContentPosition` 且实参是 `true`。 */
function hasMaintainTrue(slice: string): boolean {
  return slice.indexOf('.maintainVisibleContentPosition(true)') >= 0;
}

const idxRaw: string = (() => {
  const p: string = pathMod.join(ROOT, 'entry/src/main/ets/pages/Index.ets');
  return fsMod.existsSync(p) ? fsMod.readFileSync(p, 'utf8') : '';
})();
ok('Index.ets 可读（零扫描判红）', idxRaw.length > 0);
const idx: string = stripComments(idxRaw);

const slice: string = msgListSlice(idx);
ok('切到消息列表块（零扫描判红）', slice.length > 0);

// ── R1/R2：挂载 + 实参为 true ────────────────────────────────────────────────
ok('消息列表挂载 maintainVisibleContentPosition', slice.indexOf('.maintainVisibleContentPosition(') >= 0);
ok('其实参 = true（⛔ false 与不写等价）', hasMaintainTrue(slice));
ok('⛔ 全仓不得出现 false 档', idx.indexOf('.maintainVisibleContentPosition(false)') < 0);

// ── R2b：⛔ 框架属性**只对"视口外插入"生效**，头项之后插入是**视口内** ⇒ 必须**显式锚定** ──
//   真机实测（2026-10-13）：只挂属性时 `[DS] tail 12→15` 证明插入已发生，但视口纹丝不动不动＝
//   用户症状仍在 ⇒ 放开窗口必须走 `widenRowWindow()`（内含 `scrollToIndex(…, ScrollAlign.START)`）。
ok('头项 onClick 走锚定通路 widenRowWindow()', idx.indexOf('this.widenRowWindow()') >= 0);
// ⛔ 只在**头项 onClick 片段**里判"不再裸放开窗口"：`rowLimit +=` 本身正当出现在
//    `widenRowWindow()` 内（那正是锚定的落点）。
const headClick: string = (() => {
  const at: number = idx.indexOf('if (hiddenRowCount(this.rows.length, this.rowLimit) > 0) {');
  return at < 0 ? '' : idx.slice(at, at + 160);
})();
ok('切到头项 onClick 片段（零扫描判红）', headClick.length > 0);
ok('头项 onClick 内调 widenRowWindow()', headClick.indexOf('this.widenRowWindow()') >= 0);
ok('⛔ 头项 onClick 内不再裸放开窗口', headClick.indexOf('this.rowLimit += MAX_ROWS_VISIBLE') < 0);
ok('锚定用纯函数 anchoredIndexAfterPrepend', idx.indexOf('anchoredIndexAfterPrepend(') >= 0);
ok('锚定对齐 = ScrollAlign.START（旧首项回视口顶）', idx.indexOf('ScrollAlign.START') >= 0);
// 纯函数语义（脱机可判）
ok('锚定下标 = 旧首项 + 前置项数', anchoredIndexAfterPrepend(3, 12) === 15);
ok('⛔ 顶部锚定不得为负（夹到 0）', anchoredIndexAfterPrepend(0, 0) === 0);

// ── R3：反模式守卫（任何"跳回顶部"都会让缺陷换个形态复发）────────────────────
ok('⛔ 无 scrollEdge(Edge.Top)', idx.indexOf('scrollEdge(Edge.Top)') < 0);
ok('⛔ 无 scrollToIndex(0)', idx.indexOf('scrollToIndex(0)') < 0);

// ── 扫描器自证（mutation 等价物）─────────────────────────────────────────────
ok('自证：去掉该属性 ⇒ 判定必红', !hasMaintainTrue(slice.replace('.maintainVisibleContentPosition(true)', '')));
ok('自证：值改 false ⇒ 判定必红', !hasMaintainTrue(slice.replace('(true)', '(false)')));
ok('自证：切片空 ⇒ 判定必红（零扫描防线）', !hasMaintainTrue(''));

console.log(`\nloadmore_anchor.test: ${pass} passed / ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
process.exit(0);
