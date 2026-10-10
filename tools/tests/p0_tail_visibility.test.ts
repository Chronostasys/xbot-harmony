/**
 * P0 联合不变量（用户 2026-10-10 真机，第二次点名）：
 *
 *   「发送后思考中出现，**第一个 SSE 到达就消失**，直到这个 iter 结束时迭代
 *     瞬间出现，**中间看不到任何进度**」
 *
 * 形式化（**每一步**都必须成立，缺一不可）：
 *   (I1) `尾部可见内容量 > 0`  **或**  `showsBusyPlaceholder === true`
 *        —— 绝不允许两者皆假（占位让位了、渲染却空白 = 全空）。
 *   (I2) `判据说"有可见内容"` **当且仅当** `渲染层确实画出内容`
 *        —— 不允许"判据说有、渲染画不出"（同源）。
 *   (I3) 在飞期间可见内容量**单调不减**，且**不是 0 → 结束时才跳变**
 *        （内容到达那一刻就必须可见）。
 *
 * 为什么用真实 store 流水线而不是直接调 reduce：
 *   SSE → `normalizeEvent` → `reduce` → `deriveRows` → `applyRow`（对象恒等缓存）
 *   才是设备上真正跑的链；判据（`rowIsEmpty`）与 `MessageRowView` 的渲染决策都读
 *   这条链的产物。只测 reduce 测不出"判据/渲染分叉"。
 *
 * ⚠️ `renderVisibleChars` 是**独立 oracle**：逐条复刻 `components/MessageRow.ets`
 *   的 `AssistantBlock` 与 `components/LiveTailView.ets` 的 `build()`"到底画出多少
 *   字符"，**不引用任何生产判据** —— 只有这样 (I2) 才能真检出"判据与渲染不同源"。
 *
 * ⚠️ 用 async main（而不是 vitest 垫片的 `it`）：垫片的 `it` 不 await async 函数体，
 *   本用例必须真的跑完事件序列。垫片 `it` 在本文件会假绿（已踩）。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { ChatRow, HistoryIteration } from '../../entry/src/main/ets/core/types';
import { displayContent, displayReasoning, rowHasInFlightSignal, rowIsEmpty, rowVisibleChars } from '../../entry/src/main/ets/core/streammerge';
import { BusySignals, busyNow, showsBusyPlaceholder } from '../../entry/src/main/ets/core/indicators';
import type { SseListener } from '../../entry/src/main/ets/core/sse';

const CHAT = 'chat-1';

/** 独立 oracle：逐条复刻渲染层「到底画出多少字符」。 */
function renderVisibleChars(row: ChatRow): number {
  let n = 0;
  // MessageRow.AssistantBlock：row.content 仅在 iterations 为空时画
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
    // LiveTailView：reasoning>0 ⇒ 思考头(1)；text>0 ⇒ 正文；tools>0 ⇒ pill(1)
    n += (displayReasoning(live).length > 0 ? 1 : 0) + displayContent(live).length
      + (live.tools !== undefined && live.tools.length > 0 ? 1 : 0);
  }
  return n;
}

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

/** 页面 `busySignals()` 的同构（只读 store，不依赖 ArkUI）。 */
function pageSignals(store: ChatStore): BusySignals {
  const live = liveRowOf(store);
  return {
    localBusy: store.busy,
    liveHasContent: store.hasLiveRowWithContent(),
    // 与生产 `busySignals().tailShowsIndicator` 同源（在飞信号，非「行非空」）。
    tailShowsIndicator: live !== undefined && rowHasInFlightSignal(live),
    freshServerRunning: false,
    loading: false,
    rowsLen: store.rows.length,
  };
}

const P = (progress: object): object => ({ chat_id: CHAT, progress });
const TS = {
  turn_id: 5, phase: 'turn_started', seq: 2,
  turn_start: { trigger: 'user', content: '跑个长任务', request_id: 'r1' },
};

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${label}: ${detail}`); }
}

async function main(): Promise<void> {
  console.log('\n▶ P0 联合不变量：尾部必须有可见「进行中」信号（判据 ∩ 渲染 同源）');
  const store = new ChatStore('http://127.0.0.1:9');
  const w = wire(store);
  await store.send('跑个长任务');

  let prevVisible = -1;
  let sawInFlightContent = false;

  const step = (label: string, atLeast: number, inFlight: boolean): void => {
    const live = liveRowOf(store);
    const s = pageSignals(store);
    const visible = live !== undefined ? renderVisibleChars(live) : -1;
    const ph = showsBusyPlaceholder(s);
    const prod = live !== undefined && !rowIsEmpty(live);
    console.log(`  [${label}] 渲染可见=${visible} 占位=${ph} 判据(非空)=${prod} busyNow=${busyNow(s)}`);
    // (I1) 尾部可见内容 > 0  ∨  占位出现
    // 无 live 行时：不在跑 ⇒ 无需信号；在跑 ⇒ 必须由占位符承担（列表空态的唯一信号）。
    const i1: boolean = live === undefined ? (ph || !busyNow(s)) : (visible > 0 || ph);
    check(label, i1, `尾部可见内容=${visible} 占位=${ph} busyNow=${busyNow(s)}`
      + ` —— 绝不允许"两者皆假"（占位让位、渲染空白）`);
    // (I2) 同源：判据说"有内容" ⟺ 渲染确实画出内容
    check(label, prod === (visible > 0),
      `判据(非空)=${prod} 但渲染可见=${visible} —— 判据与渲染必须同源`);
    // (I2') 同源的最强形式：生产的「尾部可见内容量」纯函数 == 独立渲染 oracle
    if (live !== undefined) {
      check(label, rowVisibleChars(live) === visible,
        `rowVisibleChars(${rowVisibleChars(live)}) ≠ 渲染 oracle(${visible}) —— 判据函数必须与渲染逐字符同源`);
    }
    // (I3) **在飞期间**单调不减（commit 是权威快照替换在飞草稿，不在此列）
    if (inFlight) {
      check(label, visible >= prevVisible || visible < 0,
        `在飞期间可见内容量回退：${prevVisible} → ${visible}`);
    }
    if (visible > 0) { sawInFlightContent = true; }
    if (visible >= 0) { prevVisible = visible; }
    if (live !== undefined) {
      check(label, visible >= atLeast, `可见内容量应 ≥ ${atLeast}，实为 ${visible}`);
    }
  };

  step('send（乐观发出）', 0, true);

  w.emit('progress_structured', P(TS));
  step('turn_started（live 行空 ⇒ 占位）', 0, true);

  // ── 首条 SSE：服务端把「在飞迭代快照（空）」并入 iteration_history，随后流式帧推进 ──
  // （web_hub 的 structuredProgress 会在迭代边界/工具相变时把当前在飞迭代记进
  //   iteration_history；此时 iteration 号 == maxCompleted ⇒ 在飞块被 render.ets
  //   的 `lastIter > maxCompleted` 守卫挡掉 —— P0 的机制就在这里）
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'iteration', seq: 3, iteration: 1,
    iteration_history: [{ iteration: 1, content: '', reasoning: '', tools: [] }],
  }));
  step('第一条 SSE（在飞迭代快照，空）', 0, true);

  w.emit('progress_structured', P({
    turn_id: 5, seq: 4, iteration: 1, stream_content: '思考一',
  }));
  step('第二条 SSE（正文「思考一」到达 ⇒ 必须可见）', 1, true);

  w.emit('progress_structured', P({
    turn_id: 5, seq: 5, iteration: 1, stream_content: '思考一思考二',
  }));
  step('第三条 SSE（正文变长）', 1, true);

  w.emit('progress_structured', P({
    turn_id: 5, seq: 6, iteration: 1, reasoning_stream_content: '推理推理推理',
  }));
  step('第四条 SSE（推理流）', 1, true);

  // ── 迭代 commit：内容进 iterations（权威快照）──
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'iteration', seq: 7, iteration: 1,
    iteration_history: [{ iteration: 1, content: '最终正文', reasoning: '最终思考', tools: [] }],
  }));
  step('iter1 commit（内容进迭代）', 1, false);

  w.emit('progress_structured', P({
    turn_id: 5, phase: 'done', seq: 8, iteration: 1,
    iteration_history: [{ iteration: 1, content: '最终正文', reasoning: '最终思考', tools: [] }],
  }));
  step('phase_done', 1, false);

  w.emit('text', { chat_id: CHAT, turn_id: 5, content: '最终回复' });
  console.log('  [text_final] live 行已提交（committed，内容在迭代内）');

  // (I3) 在飞期间必须真的见到过可见内容（不得 0 → commit 才跳变）
  check('I3-在飞可见', sawInFlightContent, '在飞期间从未出现可见内容（0 → commit 才跳变）');

  console.log(`  p0_tail_visibility: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
