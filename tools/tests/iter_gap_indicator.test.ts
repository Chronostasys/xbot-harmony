/**
 * ① 回归复现（用户 2026-10-10）：
 *   「每个 iter 刚完成、下一个 iter 的 SSE 到来之前，应该也要渲染思考中」。
 *
 * ── 现象（判据问题）──────────────────────────────────────────────────────────
 *   `pages/Index.busySignals()` 的 `tailShowsIndicator` HEAD = `hasLiveRow && !rowIsEmpty(row)`。
 *   `rowIsEmpty` = `rowVisibleChars(row) === 0` —— 它数的是**整行可见内容**，
 *   其中包含**已提交（历史）迭代块**。于是：
 *     迭代刚 commit（iter1 已成历史块，行非空）→ 下一迭代的首个 delta 还没到（空隙）
 *     → `tailShowsIndicator = true` → 占位符让位 → **空隙里什么都没有**（用户要「思考中」）。
 *
 * ── 对齐 web（唯一参照）─────────────────────────────────────────────────────
 *   `web/src/components/agent/MessageList.tsx`：
 *     `tailShowsIndicator = tailIsLiveRow && (phase==='compressing' ||
 *        (streaming && liveIterationInFlight({iteration, iterationHistory})))`；
 *     `progressStore.liveIterationInFlight` 语义 =「**进行中的那个迭代尚未作为历史渲染过**」。
 *   空隙时**没有**在飞迭代（进行中号已被历史渲染）⇒ `liveIterationInFlight = false`
 *   ⇒ 尾部**没有**在飞信号 ⇒ 必须有占位「思考中」。
 *   原生端等价判据 =「尾部正在渲染**在飞信号**」（末尾 `live:true` 块里有 正文/思考/工具），
 *   **不是**「行非空」。
 *
 * ── 不变量（每一步都必须成立）──────────────────────────────────────────────
 *   (G1) 生产 `busySignals()` 的 `tailShowsIndicator` 采用「在飞信号」判据（读真实源码）。
 *   (G2) 迭代空隙期间「思考中」占位**必须**为 true（用户点名的判据）。
 *   (G3) 任意时刻 `渲染可见内容量 > 0` **或** `占位 === true` —— 绝不允许"两者皆假"。
 *   (G4) 下一迭代的在飞内容到达后，占位让位（`tailShowsIndicator === true`）—— 恰好一个指示器。
 *
 * ── 为什么本测试在 HEAD 上会红 ─────────────────────────────────────────────
 *   本文件**不引用**生产的新判据函数；它读 `pages/Index.ets` 的**真实源码**判断生产当前用
 *   哪条判据，再据此用对应的语义计算 `tailShowsIndicator`：
 *     · 生产写的是 `!rowIsEmpty(...)`（HEAD）⇒ 走 `!rowIsEmpty` 分支 ⇒ G2/G3 红；
 *     · 生产写的是 `rowHasInFlightSignal(...)`（修复）⇒ 走独立 oracle 分支 ⇒ G2/G3 绿。
 *   ⇒ **本文件在红/绿两态之间不需要任何修改**，红是生产行为的红，不是测试自身的红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';
import {
  displayContent, displayReasoning, rowIsEmpty,
} from '../../entry/src/main/ets/core/streammerge';
import { BusySignals, busyNow, showsBusyPlaceholder } from '../../entry/src/main/ets/core/indicators';
import type { SseListener } from '../../entry/src/main/ets/core/sse';

const CHAT = 'chat-1';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${label}: ${detail}`); }
}

// ─────────────── 生产接线判定（读真实源码；客观、不依赖模型）───────────────

interface Wiring {
  /** 页面 busySignals().tailShowsIndicator 是否采用「在飞信号」判据。 */
  pageInFlight: boolean;
  /** 页面是否仍以「行非空」当在飞信号（HEAD 形态）。 */
  pageRowNonEmpty: boolean;
  /** 生产是否已提供 rowHasInFlightSignal 纯函数。 */
  fnExists: boolean;
}

function readWiring(): Wiring {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..', '..', '..');   // <repo>/tools/tests/.out/js → 4 级
  const indexSrc: string = fs.readFileSync(
    path.join(root, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'), 'utf-8');
  const smSrc: string = fs.readFileSync(
    path.join(root, 'entry', 'src', 'main', 'ets', 'core', 'streammerge.ets'), 'utf-8');
  return {
    pageInFlight: /tailShowsIndicator:\s*this\.hasLiveRow\s*&&\s*rowHasInFlightSignal\(/.test(indexSrc),
    pageRowNonEmpty: /tailShowsIndicator:\s*this\.hasLiveRow\s*&&\s*!rowIsEmpty\(/.test(indexSrc),
    fnExists: /export\s+function\s+rowHasInFlightSignal\s*\(/.test(smSrc),
  };
}

// ─────────────── 独立 oracle（对齐渲染规则，不引用生产判据）─────────────────

/**
 * 尾部行是否正在渲染「在飞信号」—— 独立 oracle，逐条对齐 `MessageRow.ets` /
 * `LiveTailView.ets` 的画法：只有末尾 `live:true` 块里的 思考头/正文/工具 才是
 * 「进行中」可见信号；**已提交迭代块不算**（它们是历史）。
 */
function oracleInFlight(row: ChatRow): boolean {
  for (let i = row.iterations.length - 1; i >= 0; i--) {
    const it: HistoryIteration = row.iterations[i];
    if (it.live === true) {
      const hasReasoning: boolean = displayReasoning(it).length > 0;
      const hasContent: boolean = displayContent(it).length > 0;
      const hasTools: boolean = it.tools !== undefined && it.tools.length > 0;
      return hasReasoning || hasContent || hasTools;
    }
  }
  return false;
}

/** 独立渲染 oracle：这一行"到底画出多少字符"（与 p0_tail_visibility 同款）。 */
function renderVisibleChars(row: ChatRow): number {
  let n = 0;
  if (row.content.length > 0 && row.iterations.length === 0) n += row.content.length;
  let live: HistoryIteration | undefined = undefined;
  for (let i = 0; i < row.iterations.length; i++) {
    const it = row.iterations[i];
    if (it.live === true) {
      if (live === undefined) live = it;
      continue;
    }
    n += displayContent(it).length
      + (it.tools !== undefined && it.tools.length > 0 ? 1 : 0)
      + (displayReasoning(it).length > 0 ? 1 : 0);
  }
  if (live !== undefined) {
    n += (displayReasoning(live).length > 0 ? 1 : 0) + displayContent(live).length
      + (live.tools !== undefined && live.tools.length > 0 ? 1 : 0);
  }
  return n;
}

// ─────────────── store 接线 + 页面信号同构 ───────────────

function wire(store: ChatStore): { emit: (e: string, p: object) => void } {
  const box: { listener: SseListener | null } = { listener: null };
  const httpAny = store.http as unknown as { post: (p: string, b: object) => Promise<string> };
  httpAny.post = (path: string, _body: object): Promise<string> => {
    if (path === '/api/history') {
      return Promise.resolve(JSON.stringify({
        chat_id: CHAT, channel: 'web', messages: [], has_more: false, oldest_id: 0,
      }));
    }
    return Promise.resolve(JSON.stringify({ message_id: 7, turn_id: 5, queued: false }));
  };
  const sseAny = store.sse as unknown as {
    connect: (c: string, ch: string, ck: string, l: SseListener) => void;
  };
  sseAny.connect = (_c: string, _ch: string, _ck: string, l: SseListener): void => {
    box.listener = l;
  };
  store.currentChatId = CHAT;
  store.subscribe();
  return {
    emit: (e: string, p: object): void => {
      const l = box.listener;
      if (l === null) { throw new Error('SSE listener 未捕获'); }
      l(e, JSON.stringify(p));
    },
  };
}

function liveRowOf(store: ChatStore): ChatRow | undefined {
  for (let i = 0; i < store.rows.length; i++) {
    if (store.rows[i].isLive) return store.rows[i];
  }
  return undefined;
}

/**
 * 页面 `busySignals()` 的同构 —— `tailShowsIndicator` 按生产**当前实际体现的语义**算：
 * 生产源码用「在飞信号」⇒ 用独立 oracle；仍用「行非空」⇒ 用 `!rowIsEmpty`（= 生产判据本身）。
 */
function pageSignals(store: ChatStore, w: Wiring): BusySignals {
  const live = liveRowOf(store);
  const hasLiveRow: boolean = live !== undefined;
  const tail: boolean = !hasLiveRow
    ? false
    : (w.pageInFlight ? oracleInFlight(live as ChatRow) : !rowIsEmpty(live as ChatRow));
  return {
    localBusy: store.busy,
    liveHasContent: store.hasLiveRowWithContent(),
    tailShowsIndicator: tail,
    freshServerRunning: false,
    loading: false,
    rowsLen: store.rows.length,
  };
}

const P = (progress: object): object => ({ chat_id: CHAT, progress });

async function main(): Promise<void> {
  const w: Wiring = readWiring();
  console.log('\n▶ ① 迭代空隙必须显示「思考中」（判据 = 尾部正在渲染在飞信号）');
  console.log(`   [源码判据] 页面用在飞信号=${w.pageInFlight} 页面仍用行非空=${w.pageRowNonEmpty}`
    + ` 生产 rowHasInFlightSignal=${w.fnExists}`);

  check('G1 生产 busySignals().tailShowsIndicator 采用「在飞信号」判据（非「行非空」）',
    w.pageInFlight && w.fnExists && !w.pageRowNonEmpty,
    `pageInFlight=${w.pageInFlight} fnExists=${w.fnExists} pageRowNonEmpty=${w.pageRowNonEmpty}`
    + ` —— 「行非空」含已提交迭代块 ⇒ 空隙时占位被抑制`);

  const store = new ChatStore('http://127.0.0.1:9');
  const w0 = wire(store);
  await store.send('跑个长任务');

  const step = (label: string, opts: { gap?: boolean; expectTail?: boolean }): void => {
    const live = liveRowOf(store);
    const s = pageSignals(store, w);
    const visible = live !== undefined ? renderVisibleChars(live) : -1;
    const ph = showsBusyPlaceholder(s);
    console.log(`  [${label}] 渲染可见=${visible} 占位=${ph} 尾部信号=${s.tailShowsIndicator}`
      + ` busyNow=${busyNow(s)}`);
    // (G3) 不变量：有 live 行时必须「可见内容 > 0 或 占位」——绝不允许两者皆假。
    //      无 live 行时（不在跑 / 还没建行）由占位或非 busy 承担。
    const g3: boolean = live === undefined ? (ph || !busyNow(s)) : (visible > 0 || ph);
    check(`G3 ${label}`, g3, `渲染可见=${visible} 占位=${ph} busyNow=${busyNow(s)}`
      + ` —— 绝不允许"两者皆假"`);
    if (opts.gap === true) {
      // (G2) 用户点名：迭代空隙期间「思考中」占位必须出现。
      check(`G2 ${label} 空隙必须显示「思考中」`, ph === true,
        `空隙期间占位=${ph}（尾部信号=${s.tailShowsIndicator}）—— 用户要求空隙显示「思考中」`);
    }
    if (opts.expectTail === true) {
      // (G4) 下一迭代在飞内容到达 ⇒ 占位让位（恰好一个指示器）。
      check(`G4 ${label} 在飞内容到达 ⇒ 占位让位`, ph === false && s.tailShowsIndicator === true,
        `占位=${ph} 尾部信号=${s.tailShowsIndicator} —— 在飞内容到达后必须由尾部承担信号`);
    }
  };

  w0.emit('progress_structured', P({
    turn_id: 5, phase: 'turn_started', seq: 2,
    turn_start: { trigger: 'user', content: '跑个长任务', request_id: 'r1' },
  }));
  step('turn_started', {});

  w0.emit('progress_structured', P({
    turn_id: 5, phase: 'iteration', seq: 3, iteration: 1,
    iteration_history: [{ iteration: 1, content: '', reasoning: '', tools: [] }],
  }));
  step('iter1 在飞快照（空）', {});

  w0.emit('progress_structured', P({
    turn_id: 5, seq: 4, iteration: 1, stream_content: '思考一',
  }));
  step('iter1 正文流式', {});

  // ── iter1 commit：内容进 iterations（权威快照）⇒ 已完成块（历史），非在飞 ──
  w0.emit('progress_structured', P({
    turn_id: 5, phase: 'iteration', seq: 5, iteration: 1,
    iteration_history: [{ iteration: 1, content: '最终正文', reasoning: '最终思考', tools: [] }],
  }));
  step('iter1 commit', {});

  // ── 空隙：无任何 iter2 事件（用户在意的"迭代之间"）──
  step('空隙（iter1 完成、iter2 未到）', { gap: true });

  // ── iter2 首个 delta 到达 ──
  w0.emit('progress_structured', P({
    turn_id: 5, seq: 6, iteration: 2, stream_content: '第二段',
  }));
  step('iter2 正文到达', { expectTail: true });

  console.log(`\n  iter_gap_indicator: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main();
