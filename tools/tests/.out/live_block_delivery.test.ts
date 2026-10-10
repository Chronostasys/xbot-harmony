/**
 * 回归复现（真机 2026-10-10，用户原话）：
 *   「我发消息 → iter 1 (streaming) → iter 1 的 **tool call 完成**后，**iter 1 直接消失**
 *    → 接着 **iter 2 (streaming)**，但它前面**看不到 iter 1** 了。」
 *
 * ── 与上一回归（P58「流式期间全空」）的关系 ────────────────────────────────
 *   P58 修好了「在飞块」的投递（页面 @State liveText/liveReasoning/liveTools + 无参
 *   `LiveRowBody()` + `@Prop`）。但 live 行的**已完成迭代**仍走**带参 @Builder**
 *   `AssistantBlock(this.row)` 里的 `ForEach(this.itersFor(row))` —— 参数是**同一个
 *   `ChatRow` 引用**（`core/render.ets:applyRow` 就地改它）。ArkUI V1 的「按值传参
 *   @Builder」参数不变 ⇒ 其内 UI **不重建**（docs/ARKTS-GOTCHAS.md §4）。
 *
 * ── 为什么这会「iter1 消失」而不是「不刷新」（机制，逐帧） ─────────────────
 *   · 流式期间：已完成迭代 = []（恒被冻结），在飞块（@Prop）显示 iter1 的正文/工具。
 *   · tool call 完成：服务端把 iter1 记进 `iteration_history`（`row.iterations` 变成
 *     `[iter1]`，模型完全正确 —— 见下 Part A dump），在飞块随之清空（@Prop 变空 ⇒
 *     在飞块消失）。此刻渲染**本应** = 已完成块 `[iter1]`；但已完成块区被冻结在 `[]`
 *     ⇒ 两个区都空 ⇒ **iter1 从画面消失**。
 *   · iter2 流式：在飞块（@Prop）显示 iter2，已完成块区**仍是冻结的 `[]`** ⇒
 *     **iter2 前面看不到 iter1**。
 *
 * ── 本测试（投递层判据，不是模型判据）────────────────────────────────────
 *   「模型全对、画面不对」的 bug 必须在**投递层**写判据：本用例
 *   ① 读**真实源码**判定「已完成块」的投递形态（值变化通道 vs. 就地改的对象）；
 *   ② 用真实 store（SSE → normalize → reduce → deriveRows → applyRow）跑一条
 *      「iter1 流式 → 工具 generating/running → 工具完成 + iter1 commit → iter2 流式」
 *      的真实事件序列；
 *   ③ 以**真实接线形态**重建「组件每帧渲染出的块列表」，断言：
 *      (M1) 该 turn 的渲染块列表在迭代边界前后**单调不减**；
 *      (M2) 一旦 iter1 作为**已完成块**存在于模型里，它就必须**始终**出现在渲染块列表里，
 *          且**带它的 tool pill**。
 *
 *   HEAD（形态 = row-object，已完成块只在对象引用变化时刷新）⇒ 红（1 → 0 塌陷、
 *   iter1 缺失）；修复（形态 = value-prop，已完成块按**值**投递）⇒ 绿。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { ChatStore } from './store';
import { ChatRow, HistoryIteration, ToolProgress } from './types';
import { displayContent, displayReasoning } from './streammerge';
import type { SseListener } from './sse';

const CHAT = 'chat-1';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${label}: ${detail}`);
  }
}

// ─────────────── 生产接线判定（读真实源码；客观、不依赖模型） ───────────────

interface Wiring {
  /** 页面把「live 行的已完成块列表」镜像进 @State（值变化通道的数据源）。 */
  pageBlocksState: boolean;
  /** MessageRowView 以 @Prop 接收该值。 */
  rowBlocksProp: boolean;
  /** MessageRowView 渲染已完成块时读的是**值**（this.liveBlocks），而不是被就地改的对象。 */
  rendersBlocksFromValue: boolean;
}

function readWiring(): Wiring {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..', '..', '..');
  const indexSrc: string = fs.readFileSync(
    path.join(root, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'), 'utf-8');
  const rowSrc: string = fs.readFileSync(
    path.join(root, 'entry', 'src', 'main', 'ets', 'components', 'MessageRow.ets'), 'utf-8');
  return {
    pageBlocksState: /@State\s+liveBlocks\s*:\s*HistoryIteration\[\]/.test(indexSrc),
    rowBlocksProp: /@Prop\s+liveBlocks\s*:\s*HistoryIteration\[\]/.test(rowSrc),
    rendersBlocksFromValue: /blocksFor\s*\(\s*\)/.test(rowSrc) && /this\.liveBlocks/.test(rowSrc),
  };
}

// ─────────────── 模型/渲染辅助（独立 oracle）───────────────────────────────

/** 该行承载的**已完成**迭代块（排除末尾在飞块 `live:true`）。 */
function completedOf(row: ChatRow): HistoryIteration[] {
  const out: HistoryIteration[] = [];
  for (let i = 0; i < row.iterations.length; i++) {
    if (row.iterations[i].live !== true) {
      out.push(row.iterations[i]);
    }
  }
  return out;
}

/** 该行的**在飞块**（`live:true`，末尾）。 */
function liveBlockOf(row: ChatRow): HistoryIteration | undefined {
  for (let i = row.iterations.length - 1; i >= 0; i--) {
    if (row.iterations[i].live === true) {
      return row.iterations[i];
    }
  }
  return undefined;
}

/** 块列表的**值指纹**（页面 @State 镜像的判据：结构/长度变化才换值）。 */
function blocksSig(bs: HistoryIteration[]): string {
  let s: string = `${bs.length}`;
  for (let i = 0; i < bs.length; i++) {
    const b: HistoryIteration = bs[i];
    s += `|${b.iteration}:${(b.content ?? '').length}:${(b.reasoning ?? '').length}`
      + `:${b.tools !== undefined ? b.tools.length : 0}`;
  }
  return s;
}

function iterOf(bs: HistoryIteration[], n: number): HistoryIteration | undefined {
  for (let i = 0; i < bs.length; i++) {
    if (bs[i].iteration === n) {
      return bs[i];
    }
  }
  return undefined;
}

/**
 * ArkUI V1 `MessageRowView`（live 行）的**重建模型** —— 忠实复刻生产接线：
 *
 *   · 「已完成块」区：只有**驱动它的值**变化才重算。
 *     - value-prop 形态：驱动值 = 页面投递的块列表（`this.liveBlocks`）⇒ 值变即刷新。
 *     - row-object 形态（HEAD）：驱动值 = `@Builder` 的按值参数 `row`（同一引用）⇒
 *       流式期间**永不刷新**，冻结在创建那一瞬（此刻为空）。
 *   · 「在飞块」区：由 `@Prop liveText/liveReasoning/liveTools` 驱动 ⇒ 每帧随值刷新
 *     （P58 已修）。
 *   · 组件每帧**渲染出的块列表** = 已完成块（可能冻结） ⊕ 在飞块（若在飞内容非空）。
 */
class LiveRowComponentModel {
  private capturedBlocksValue: string | undefined = undefined;
  private capturedRowRef: ChatRow | undefined = undefined;
  private completed: HistoryIteration[] = [];
  refreshes: number = 0;

  /** 每帧投递（返回值 = 组件此刻**画出的块列表**）。 */
  render(row: ChatRow, byValue: boolean): HistoryIteration[] {
    // ── 已完成块区（驱动值见类注释）──
    const now: HistoryIteration[] = completedOf(row);
    if (byValue) {
      const sig: string = blocksSig(now);
      if (sig !== this.capturedBlocksValue) {
        this.completed = now;
        this.capturedBlocksValue = sig;
        this.refreshes++;
      }
    } else {
      if (row !== this.capturedRowRef) {
        this.completed = now;              // 创建/换引用那一次
        this.capturedRowRef = row;
        this.refreshes++;
      }
    }
    // ── 在飞块区（@Prop 直驱，与页面 syncLiveTail 同源）──
    const live: HistoryIteration | undefined = liveBlockOf(row);
    let inFlight: HistoryIteration | undefined = undefined;
    if (live !== undefined) {
      const hasContent: boolean = displayContent(live).length > 0
        || displayReasoning(live).length > 0
        || (live.tools !== undefined && live.tools.length > 0);
      if (hasContent) {
        inFlight = live;
      }
    }
    const out: HistoryIteration[] = this.completed.slice();
    if (inFlight !== undefined) {
      out.push(inFlight);
    }
    return out;
  }
}

// ─────────────── store 接线（同真实链路）──────────────────────────────────

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
    if (store.rows[i].isLive) {
      return store.rows[i];
    }
  }
  return undefined;
}

const P = (progress: object): object => ({ chat_id: CHAT, progress });

// ─────────────── 主流程 ───────────────

async function main(): Promise<void> {
  const w0: Wiring = readWiring();
  const byValue: boolean = w0.pageBlocksState && w0.rowBlocksProp && w0.rendersBlocksFromValue;
  const production: string = byValue ? 'value-prop' : 'row-object';
  console.log(`\n▶ live 已完成块投递回归：生产接线形态 = ${production}`);
  console.log(`   [源码判据] 页面@State(liveBlocks)=${w0.pageBlocksState}`
    + ` 行@Prop(liveBlocks)=${w0.rowBlocksProp} 由值渲染=${w0.rendersBlocksFromValue}`);

  // Part B：接线判据（生产必须把「已完成块」走**值变化**这条唯一可靠的投递路）
  check('B1 页面把 live 行的已完成块镜像进 @State（值变化通道）', w0.pageBlocksState,
    '已完成块没有任何「值变化」驱动 —— 只能从被就地改的对象里读（P58 之后的新回归根因）');
  check('B2 MessageRowView 以 @Prop 接收已完成块', w0.rowBlocksProp,
    '页面 @State 无法投递到渲染组件');
  check('B3 已完成块由**值**渲染（this.liveBlocks，paramless）', w0.rendersBlocksFromValue,
    '已完成块仍经带参 @Builder 从被就地修改的行对象读 —— 参数不变 ⇒ 其内 UI 不重建');

  // Part A：投递模型 —— 用**生产实际接线**驱动，断言渲染块列表跨迭代边界不塌陷
  console.log('▶ Part A：真实 store 事件序列下，渲染块列表必须单调不减且 iter1 始终在');
  const store = new ChatStore('http://127.0.0.1:9');
  const w = wire(store);
  await store.send('跑个长任务');
  const comp = new LiveRowComponentModel();
  let prevN = -1;
  let sawIter1Completed = false;
  let iter1ToolSeen = false;

  const step = (label: string): void => {
    const live = liveRowOf(store);
    if (live === undefined) { return; }
    const rendered: HistoryIteration[] = comp.render(live, byValue);
    const n: number = rendered.length;
    // (M1) 渲染块列表单调不减（迭代边界前后都不许塌陷）
    check(label, n >= prevN, `渲染块列表回退：${prevN} → ${n}（iter1 从画面消失）`);
    // (M2) 模型一旦有已完成的 iter1，渲染列表就必须有它（且带 tool pill）
    const modelIter1 = iterOf(completedOf(live), 1);
    if (modelIter1 !== undefined) {
      sawIter1Completed = true;
      const got = iterOf(rendered, 1);
      check(label, got !== undefined, `已完成的 iter1 不在渲染块列表里（画面丢块）`);
      if (got !== undefined) {
        if ((got.tools ?? []).length > 0) { iter1ToolSeen = true; }
        check(label, (got.tools ?? []).length === (modelIter1.tools ?? []).length,
          `iter1 块的 tool pill 数量不一致（渲染 ${(got.tools ?? []).length}`
          + ` vs 模型 ${(modelIter1.tools ?? []).length}）`);
      }
    }
    console.log(`   [${label}] 模型块=${JSON.stringify(completedOf(live).map((b) => b.iteration))}`
      + ` 渲染块=${JSON.stringify(rendered.map((b) => `${b.iteration}${b.live === true ? '*' : ''}`))}`);
    prevN = n;
  };

  w.emit('progress_structured', P({ turn_id: 5, phase: 'turn_started', seq: 2, turn_start: { trigger: 'user', content: '跑个长任务', request_id: 'r1' } }));
  step('turn_started');
  // iter1 流式（正文）
  w.emit('progress_structured', P({ turn_id: 5, seq: 3, iteration: 1, stream_content: '正文一' }));
  step('iter1 stream正文');
  // 工具参数流式生成中
  w.emit('progress_structured', P({ turn_id: 5, seq: 4, iteration: 1, stream_content: '正文一', streaming_tools: [{ name: 'bash', status: 'generating', label: 'bash', gen_chars: 3 }] }));
  step('iter1 tool generating');
  // 工具执行中
  w.emit('progress_structured', P({ turn_id: 5, phase: 'tool_exec', seq: 5, iteration: 1, active_tools: [{ name: 'bash', status: 'running', label: 'bash', elapsed_ms: 12 }] }));
  step('iter1 tool running');
  // 工具完成 + iter1 记入 iteration_history（服务端权威快照）
  w.emit('progress_structured', P({ turn_id: 5, phase: 'iteration', seq: 6, iteration: 1, active_tools: [], completed_tools: [{ name: 'bash', status: 'done', label: 'bash' }], iteration_history: [{ iteration: 1, content: '正文一', reasoning: '', tools: [{ name: 'bash', status: 'done', label: 'bash' }] }] }));
  step('iter1 tool 完成 + commit（真机崩点）');
  // iter2 流式
  w.emit('progress_structured', P({ turn_id: 5, seq: 7, iteration: 2, stream_content: '正文二' }));
  step('iter2 stream（前面必须仍有 iter1）');

  check('A-E2E 模型确实产生过已完成的 iter1', sawIter1Completed, '事件序列未产生已完成的 iter1（用例前提不成立）');
  check('A-E2E 已完成的 iter1 必须在渲染块列表里存活', sawIter1Completed && iter1ToolSeen,
    'iter1（含 tool pill）从未在渲染块列表里出现 —— 真机「tool call 完成后 iter1 消失」');
  console.log(`   已完成块区刷新次数=${comp.refreshes}（HEAD 形态恒为 1 = 仅创建那次）`);

  console.log(`\n  live_block_delivery: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main();
