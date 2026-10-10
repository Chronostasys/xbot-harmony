/**
 * 回归复现：live 行的「流式内容投递」—— 判据/渲染同源之外的第二根因：**投递机制本身**。
 *
 * 用户原话（2026-10-10）：「发送后『思考中…』出现 → **第一条 SSE 到达即消失** →
 * 整个迭代期间列表**全空**（没有打字机、没有进度）→ **该迭代 commit 之后才一次性出现**」。
 * 用户明确指出这是**回归**：「在重复 user msg 那个 bug 修复之前，typer 特效是好的」。
 *
 * ── git 证据定出的回归窗口 ────────────────────────────────────────────────
 *   P53 `c174364` / P54 `0a17f76`（最后可用）：页面有 `@State liveText/liveReasoning/liveTools`，
 *     由 `syncLiveTail(store)` 在**每次 store 更新**时赋值；live 尾块由页面 build
 *     **直接**创建 `LiveTailView({text: this.liveText, …})`（`grep -c liveText` = 5）。
 *   P55 `fa07632`（罪魁）：删掉 `syncLiveTail` 与三个 `@State`（`grep -c liveText` = 0），
 *     live 行改为非懒尾项 `if (this.hasLiveRow) ListItem(){ this.ChatRowBody(this.liveRowRef) }`
 *     —— 在飞内容只能由 `MessageRowView` 从**被就地修改**的 `ChatRow` 里读。
 *
 * ── 为什么这会坏（官方语义，见 docs/ARKTS-GOTCHAS.md §3/§4）────────────────
 *   R1 组件只在**收到的状态值发生变化**时重建（`@State` 赋值 / 父组件传入的 `@Prop` 新值）。
 *   R2 `@Builder` **按值传递**的参数是「调用那一刻的快照」，对象引用不变时其内容的
 *      就地变化**不驱动** @Builder 内 UI 更新（官方：按值传递 ⇒ 不刷新；需 $$ / 按引用）。
 *   R3 `ChatRow` 由 store **就地**更新（保 @ObjectLink 恒等）⇒ **不产生 R1 意义上的
 *      「收到的值变化」**；仓库自身的刷新一律靠「状态变量赋值」或「带 key 的列表项 key 变化」。
 *
 *   ⇒ HEAD 的 live 行组件，其**唯一**内容输入是 `row` 这一个**恒定引用**；整个流式期间
 *     它**一次都不重建**（实测：重建次数 = 1，仅创建那次）⇒ 渲染输入冻结在创建那一瞬
 *     （此刻 live 行是空的）⇒ 一条都画不出来（占位让位 + 列表全空），直到该 turn 离开
 *     live 路径（commit）后由带 key 的 `LazyForEach` 重建，才「一次性出现」。
 *
 * ── 本测试 ────────────────────────────────────────────────────────────────
 *   先读**真实源码**判定生产接线形态，再用对应形态的投递模型驱动真实 store 流水线，
 *   断言「live 组件每帧的渲染输入 == 当前在飞内容」。
 *   HEAD（形态 = row-object-only）⇒ 红；修复（形态 = page-state-prop）⇒ 绿。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { ChatRow, ToolProgress } from '../../entry/src/main/ets/core/types';
import { displayContent, displayReasoning } from '../../entry/src/main/ets/core/streammerge';
import type { SseListener } from '../../entry/src/main/ets/core/sse';

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
  pageState: boolean;
  syncFn: boolean;
  rowProps: boolean;
  rendersFromProp: boolean;
  paramlessBuilder: boolean;
}

function readWiring(): Wiring {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..', '..', '..');   // <repo>/tools/tests/.out/js → 4 级
  const indexSrc: string = fs.readFileSync(
    path.join(root, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'), 'utf-8');
  const rowSrc: string = fs.readFileSync(
    path.join(root, 'entry', 'src', 'main', 'ets', 'components', 'MessageRow.ets'), 'utf-8');
  return {
    pageState: /@State\s+liveText\s*:\s*string/.test(indexSrc)
      && /@State\s+liveReasoning\s*:\s*string/.test(indexSrc)
      && /@State\s+liveTools\s*:\s*ToolProgress\[\]/.test(indexSrc),
    syncFn: /private\s+syncLiveTail\s*\(/.test(indexSrc),
    rowProps: /@Prop\s+liveText\s*:\s*string/.test(rowSrc)
      && /@Prop\s+liveReasoning\s*:\s*string/.test(rowSrc)
      && /@Prop\s+liveTools\s*:\s*ToolProgress\[\]/.test(rowSrc),
    rendersFromProp: /text:\s*this\.liveText/.test(rowSrc),
    paramlessBuilder: /LiveRowBody\s*\(\s*\)/.test(indexSrc)
      && /this\.LiveRowBody\s*\(\s*\)/.test(indexSrc),
  };
}

// ─────────────── 投递模型（R1/R2/R3）───────────────────────────────

interface RowInputs {
  rowRef: ChatRow;
  liveText?: string;
  liveReasoning?: string;
  liveTools?: ToolProgress[];
}

/**
 * ArkUI V1 组件（live 行）的**重建模型**：持「上次重建时捕获的值快照」；
 * 只有**收到的值**（对象引用 或 @Prop 值）变化时才重建 —— 重建时按当前数据重算。
 * 对同一对象引用的**就地修改**不构成值变化 ⇒ 不重建（R2/R3）。
 */
class LiveRowComponentModel {
  private capturedRowRef: ChatRow | undefined = undefined;
  private capturedLive: string | undefined = undefined;
  renderedText: string = '';
  updates: number = 0;

  update(inputs: RowInputs): boolean {
    const liveTuple: string | undefined = inputs.liveText === undefined
      ? undefined
      : `${inputs.liveText}||${inputs.liveReasoning !== undefined ? inputs.liveReasoning : ''}`
        + `||${inputs.liveTools !== undefined ? inputs.liveTools.length : 0}`;
    const refChanged: boolean = inputs.rowRef !== this.capturedRowRef;
    const liveChanged: boolean = inputs.liveText !== undefined && liveTuple !== this.capturedLive;
    if (!refChanged && !liveChanged) {
      return false;                                  // 无「值变化」⇒ 不重建（R1）
    }
    this.capturedRowRef = inputs.rowRef;
    this.capturedLive = liveTuple;
    this.renderedText = inputs.liveText !== undefined
      ? inputs.liveText
      : liveBlockTextOf(inputs.rowRef);              // 重建时读**当前**数据
    this.updates++;
    return true;
  }
}

function liveBlockTextOf(row: ChatRow): string {
  for (let i = row.iterations.length - 1; i >= 0; i--) {
    if (row.iterations[i].live === true) { return displayContent(row.iterations[i]); }
  }
  return row.content;
}
function currentLiveText(row: ChatRow): string {
  for (let i = row.iterations.length - 1; i >= 0; i--) {
    if (row.iterations[i].live === true) { return displayContent(row.iterations[i]); }
  }
  return '';
}
function currentLiveReasoning(row: ChatRow): string {
  for (let i = row.iterations.length - 1; i >= 0; i--) {
    if (row.iterations[i].live === true) { return displayReasoning(row.iterations[i]); }
  }
  return '';
}
function currentLiveTools(row: ChatRow): ToolProgress[] {
  for (let i = row.iterations.length - 1; i >= 0; i--) {
    if (row.iterations[i].live === true) {
      const t: ToolProgress[] | undefined = row.iterations[i].tools;
      return t !== undefined ? t : [];
    }
  }
  return [];
}

function wire(store: ChatStore): { emit: (e: string, p: object) => void } {
  const box: { listener: SseListener | null } = { listener: null };
  const httpAny = store.http as unknown as { post: (p: string, b: object) => Promise<string> };
  httpAny.post = (path: string, _body: object): Promise<string> => {
    if (path === '/api/history') {
      return Promise.resolve(JSON.stringify({ chat_id: CHAT, channel: 'web', messages: [], has_more: false, oldest_id: 0 }));
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
    if (store.rows[i].isLive) { return store.rows[i]; }
  }
  return undefined;
}

// ─────────────── 主流程 ───────────────

async function main(): Promise<void> {
  const w0: Wiring = readWiring();
  const production: string = (w0.pageState && w0.syncFn && w0.rowProps && w0.rendersFromProp)
    ? 'page-state-prop' : 'row-object-only';
  console.log(`\n▶ live 行投递回归：生产接线形态 = ${production}`);
  console.log(`   [源码判据] 页面@State=${w0.pageState} syncLiveTail=${w0.syncFn}`
    + ` 行@Prop=${w0.rowProps} 由@Prop渲染=${w0.rendersFromProp} 无参Builder=${w0.paramlessBuilder}`);

  // Part B：接线判据（生产必须走「值变化」这条唯一可靠的投递路）
  check('B1 页面持有 @State liveText/liveReasoning/liveTools', w0.pageState,
    'live 内容没有任何「值变化」驱动重建（P55 回归根因）');
  check('B2 页面每帧同步在飞内容（syncLiveTail）', w0.syncFn, '页面 @State 不会被更新');
  check('B3 MessageRowView 声明 @Prop liveText/liveReasoning/liveTools', w0.rowProps,
    '页面 @State 无法投递到渲染组件');
  check('B4 在飞块由 @Prop 渲染（LiveTailView 读 this.liveText）', w0.rendersFromProp,
    '仍在读被就地修改的行对象 —— 不产生「值变化」⇒ 组件不重建');
  check('B5 live 行由无参 @Builder 创建（避免 by-value 参数快照）', w0.paramlessBuilder,
    'live 行仍经带参 @Builder（按值传参 = 调用瞬间快照）创建');

  // Part A：投递模型 —— 用**生产实际接线**驱动，断言渲染输入每帧跟上在飞内容
  console.log('▶ Part A：live 组件每帧的渲染输入必须 == 当前在飞内容');
  const store = new ChatStore('http://127.0.0.1:9');
  const w = wire(store);
  await store.send('跑个长任务');
  const P = (progress: object): object => ({ chat_id: CHAT, progress });

  const comp = new LiveRowComponentModel();
  let sawContent = false;
  let staleFrames = 0;
  let contentFrames = 0;

  const frame = (label: string): void => {
    const live = liveRowOf(store);
    if (live === undefined) { return; }
    const want: string = currentLiveText(live);
    if (production === 'page-state-prop') {
      comp.update({
        rowRef: live,
        liveText: currentLiveText(live),
        liveReasoning: currentLiveReasoning(live),
        liveTools: currentLiveTools(live),
      });
    } else {
      comp.update({ rowRef: live });                 // HEAD：唯一内容输入是恒定引用
    }
    if (want.length > 0) {
      contentFrames++;
      if (comp.renderedText.length > 0) { sawContent = true; }
      if (comp.renderedText !== want) { staleFrames++; }
    }
    check(`A ${label}`, comp.renderedText === want,
      `live 组件渲染输入="${comp.renderedText}" ≠ 当前在飞正文="${want}"`
      + ` —— 内容已到达却画不出（真机「第一条 SSE 到达就消失、中间全空、commit 才出现」）`);
  };

  frame('send');
  w.emit('progress_structured', P({ turn_id: 5, phase: 'turn_started', seq: 2, turn_start: { trigger: 'user', content: '跑个长任务', request_id: 'r1' } }));
  frame('turn_started');
  w.emit('progress_structured', P({ turn_id: 5, phase: 'iteration', seq: 3, iteration: 1, iteration_history: [{ iteration: 1, content: '', reasoning: '', tools: [] }] }));
  frame('iter1-shell');
  w.emit('progress_structured', P({ turn_id: 5, seq: 4, iteration: 1, stream_content: '思考一' }));
  frame('stream-1');
  w.emit('progress_structured', P({ turn_id: 5, seq: 5, iteration: 1, stream_content: '思考一思考二' }));
  frame('stream-2');
  w.emit('progress_structured', P({ turn_id: 5, seq: 6, iteration: 1, reasoning_stream_content: '推理推理推理' }));
  frame('reason-1');

  check('A-E2E 流式期间必须真的把在飞内容画出来（不得 0 → commit 才跳变）',
    sawContent && staleFrames === 0 && contentFrames > 0,
    `sawContent=${sawContent} staleFrames=${staleFrames} contentFrames=${contentFrames}`);
  console.log(`   live 组件重建次数=${comp.updates}（HEAD 形态恒为 1 = 仅创建那次）`);

  console.log(`\n  live_tail_delivery: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main();
