/**
 * live_iter_dedupe —— P0（用户 2026-10-17 亲报）：**迭代完成后突然变成两个一模一样的 iter，
 * 再下一个迭代时恢复正常**。
 *
 * ── 定位（渲染层，非状态机）────────────────────────────────────────────────────
 *  "同一个 iteration 号"在语义上**永远是同一个迭代**。原实现里两处会并排渲染两次：
 *   ① `liveIterations` 在「已提交同号块是空壳」分支（`shellSameNum`）直接 **append**
 *      一个 `iteration = r.lastIter` 的在飞块 ⇒ 同号两块；
 *   ② 上游任何路径（状态机 merge / fold / finalizer / 增量 delta）让同一个号出现两次，
 *      渲染层**当时没有任何兜底**。
 *  ⇒ 修在渲染边界：同号就地**合并**（工具按 key 并集、正文/思考非空者胜），并加
 *    `collapseSameNumberBlocks` 兜底收敛（导出、可脱机断言）。
 *  下一迭代 `lastIter` 前进后不再同号 ⇒ 现象"自动恢复" ✓（与用户描述一致）。
 *
 * ⛔ 为什么不改 `reduce.ts`：它是 web 逐字移植（铁律）⇒ 只能改渲染层。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { ChatRow, HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';
import { collapseSameNumberBlocks } from '../../entry/src/main/ets/core/render';
import type { SseListener } from '../../entry/src/main/ets/core/sse';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── ① 纯判据：同号重复 ⇒ 收敛为一块（工具并集 / 正文非空者胜 / live 取或）────────────

// ⛔ `ToolProgress`/`HistoryIteration` 在 types 里是**类型**（interface）⇒ 不能 `new`；
//    用字面量 + 断言（harness 以 TS 编译，字面量合法）。
const tool = (callId: string, label: string): ToolProgress => ({
  name: 'Shell', label, status: 'done', call_id: callId,
} as unknown as ToolProgress);

const block = (n: number, content: string, reasoning: string,
  tools: ToolProgress[], live: boolean): HistoryIteration => ({
  iteration: n, content, reasoning, tools, tools_folded: false, live,
} as unknown as HistoryIteration);

console.log('\n▶ ① 同号收敛（collapseSameNumberBlocks）');
const dup1 = collapseSameNumberBlocks([
  block(3, '', '', [], false),                       // 空壳（早提交）
  block(3, '真正文', '真思考', [tool('c1', 'Shell: a')], true),  // 在飞（真内容）
]);
eq('同号两块 ⇒ 收敛成 1 块', dup1.length, 1);
eq('正文取自非空者（不丢）', dup1[0].content, '真正文');
eq('思考取自非空者', dup1[0].reasoning, '真思考');
eq('工具保留', (dup1[0].tools ?? []).length, 1);
eq('live 取或（合并后仍在飞）', dup1[0].live, true);

const dup2 = collapseSameNumberBlocks([
  block(7, '旧正文', '', [tool('c1', 'Shell: a')], false),
  block(7, '', '', [tool('c2', 'Shell: b')], false),
]);
eq('同号两块（都有工具）⇒ 1 块', dup2.length, 1);
eq('工具并集（不同 callId 两次调用都要在）', (dup2[0].tools ?? []).length, 2);
eq('并集顺序：已提交优先', (dup2[0].tools ?? [])[0].call_id, 'c1');
eq('正文不被空串覆盖', dup2[0].content, '旧正文');

const dup3 = collapseSameNumberBlocks([
  block(1, 'A', '', [], false),
  block(1, 'A', '', [tool('c9', 'Shell: x')], true),
  block(1, 'A', '', [tool('c9', 'Shell: x')], true),
]);
eq('三块同号 ⇒ 1 块', dup3.length, 1);
eq('同一 callId 不因合并而重复（toolKey 去重）', (dup3[0].tools ?? []).length, 1);

const keep = collapseSameNumberBlocks([
  block(1, 'a', '', [], false), block(2, 'b', '', [], false), block(3, 'c', '', [], false),
]);
eq('不同号原样保留（顺序不变）', keep.map((i: HistoryIteration) => i.iteration), [1, 2, 3]);
eq('空表恒等', collapseSameNumberBlocks([]).length, 0);

// ── ② 黑盒：喂完一帧"完成态"后，渲染出的 live 行不得同号 ─────────────────────────

const CHAT = 'chat-iter-dedupe';
function wire(store: ChatStore): { emit: (e: string, p: object) => void } {
  const box: { listener: SseListener | null } = { listener: null };
  const httpAny = store.http as unknown as { post: (p: string, b: object) => Promise<string> };
  httpAny.post = (path: string, _b: object): Promise<string> => {
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
const P = (progress: object): object => ({ chat_id: CHAT, progress });
function liveRowOf(store: ChatStore): ChatRow | undefined {
  for (let i = 0; i < store.rows.length; i++) {
    if (store.rows[i].isLive) { return store.rows[i]; }
  }
  return undefined;
}
function maxSameNumber(row: ChatRow | undefined): number {
  const m: Map<number, number> = new Map<number, number>();
  if (row === undefined) { return 0; }
  for (let i = 0; i < row.iterations.length; i++) {
    const n: number = row.iterations[i].iteration;
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  let mx = 0;
  m.forEach((v: number) => { if (v > mx) { mx = v; } });
  return mx;
}

async function main(): Promise<void> {
  console.log('\n▶ ② 黑盒：完成帧之后 live 行不得出现同号重复');
  const store = new ChatStore('http://127.0.0.1:9');
  const w = wire(store);
  await store.send('触发一轮');
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'turn_started', seq: 2,
    turn_start: { trigger: 'user', content: '触发一轮', request_id: 'r1' },
  }));
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'iteration', iteration: 1, seq: 10, stream_content: '第一轮正文ABC',
  }));
  ok('流式期无同号', maxSameNumber(liveRowOf(store)) <= 1);
  // "完成"帧：同号迭代被提交（空壳/早提交形态）+ live 行仍持有该迭代内容
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'iteration', iteration: 1, seq: 11,
    stream_content: '第一轮正文ABC',
    iteration_history: [{ iteration: 1, content: '', reasoning: '', tools: [] }],
  }));
  w.emit('text_final', {
    chat_id: CHAT, turn_id: 5, seq: 12,
    final_iteration: { iteration: 1, content: '', reasoning: '', tools: [] },
  });
  ok('⛔ 完成帧之后仍无同号（P0 回归判据）', maxSameNumber(liveRowOf(store)) <= 1);
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'iteration', iteration: 2, seq: 13, stream_content: '第二轮…',
  }));
  ok('下一迭代推进后无同号', maxSameNumber(liveRowOf(store)) <= 1);

  if (fail > 0) {
    console.log(`  live_iter_dedupe: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  console.log(`  live_iter_dedupe: ${pass} passed, 0 failed`);
  process.exit(0);
}

main();

export {};
