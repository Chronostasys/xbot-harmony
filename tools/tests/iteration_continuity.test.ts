/**
 * iteration_continuity.test.ts —— 「迭代进入执行中后**消失了**」的判别力判据（P0 线性一致性）。
 *
 * 用户 2026-10-21 两张截图对照（重启前 / 重启后）：重启前**少了两个迭代**（两条 Shell pill），
 * 那两条他亲眼看到「进入执行中状态」，随后**消失**；重启后从 DB 重新水合又出现。
 * 用户原话：「每条消息都有迭代号，你只要保证它迭代号是连续的，它就不可能丢数据」。
 *
 * ── 旧链路的两道客户端补偿（**已被新模型删除，不是被本测试放弃**）─────────────
 *   ① `core/reduce.ts:foldKnownToolsIntoCommitted` —— 提交边界把"客户端已知、属于该迭代"
 *      的工具折进提交块；② `core/reduce.ts:mergeIterations` —— 同号覆盖取工具并集。
 *   `docs/STATE-MODEL.md:805` 把它们列入**删除清单**：新模型的立场是
 *   「`done.block` **自带完备工具集**」（协议义务 P4）⇒ 客户端**不再**替服务端补内容
 *   （`:1122`：任何客户端替代方案都不可取）。⇒ 本文件改钉新模型**自己**的假设与不变量：
 *     · T4 提交不可回退（`blocks` 只追加）；T5(a) 块号**严格递增**（同号块不可表示）；
 *     · T5(c) 块内工具号 == 块号（`stampTools`）⇒ **结构上不可能**跨迭代串工具；
 *     · 在飞工具**恒有渲染位**（`live.tools` ⇒ 投影末尾在飞块）⇒ "进入执行中后消失"不可能。
 *   ⛔ 旧的 `foldKnownToolsIntoCommitted`/`mergeIterations` 判据（"只提交空壳时仍保留工具"）
 *      已随代码一起删除 —— 那是一条**协议违规输入**下的兜底，新链路明确不兜底。
 *
 * mutation 自证（改坏新链路 ⇒ 必红）：
 *   · 让 `model_step.onDone` 接受同号块（去掉 `iteration <= last ⇒ 丢弃`）⇒ §B 红（块数变 2）；
 *   · 去掉 `stampTools` 盖章 ⇒ §D 的工具号判据红；
 *   · 让 `onTick` 不写 `live.tools` ⇒ §A/§E 红（在飞工具无渲染位）。
 */
declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { Block, TurnRec } from '../../entry/src/main/ets/core/model_types';
import type { ChatRow, HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const TURN = 1;

/** 造一枚**线格式**工具（`iteration` 由帧携带，这里显式给）。 */
function tool(callID: string, iter: number, status: string): Record<string, Object> {
  return {
    name: 'Shell', label: 'Shell', status, callID, iteration: iter, elapsedMs: 0,
    summary: '', detail: '', args: '',
  };
}

/** 起一个 turn。 */
function started(f: ModelFeed, turn: number, seq: number): ModelFeed {
  return f.push({ type: 'turn_started', turnID: turn, requestID: null, trigger: 'user', content: null, seq });
}

/** 结构化帧：某迭代有在飞工具（执行中）。 */
function running(f: ModelFeed, iter: number, t: Record<string, Object>, seq: number): ModelFeed {
  return f.push({
    type: 'iteration', turnID: TURN, iter, seq, phase: 'tool_exec',
    content: '', reasoning: '', activeTools: [t], completedTools: [], streamingTools: [],
    iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  });
}

/** 提交某迭代：**该迭代已提交**（`iterationsDelta` 只带这一块）。 */
function commit(f: ModelFeed, iter: number, tools: Record<string, Object>[], seq: number): ModelFeed {
  return f.push({
    type: 'iteration', turnID: TURN, iter, seq, phase: 'tool_exec',
    content: '', reasoning: '', activeTools: [], completedTools: [], streamingTools: [],
    iterationsDelta: [{ iteration: iter, content: '', reasoning: '', tools, toolCount: tools.length }],
    todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  });
}

/** 推进到下一迭代（帧里没有 delta / 没有工具）。 */
function advance(f: ModelFeed, iter: number, seq: number): ModelFeed {
  return f.push({
    type: 'iteration', turnID: TURN, iter, seq, phase: 'thinking',
    content: '', reasoning: '', activeTools: [], completedTools: [], streamingTools: [],
    iterationsDelta: [], todos: undefined, subAgents: undefined, tokenUsage: undefined, streamStats: undefined,
  });
}

/** 模型里的已提交块（**块列表的唯一真源**）。 */
function blocksOf(f: ModelFeed): Block[] {
  const t: TurnRec | undefined = f.state.turns.get(TURN);
  return t === undefined ? [] : t.blocks.slice();
}

function iterNums(f: ModelFeed): number[] {
  return blocksOf(f).map((b) => b.iteration);
}

function iterTools(f: ModelFeed, iter: number): string[] {
  const bs = blocksOf(f);
  for (let i = 0; i < bs.length; i++) {
    if (bs[i].iteration === iter) {
      return bs[i].tools.map((t) => t.call);
    }
  }
  return [];
}

/** 渲染行末尾在飞块的工具（页面 `LiveTailView` 的唯一数据源）。 */
function liveToolIds(f: ModelFeed): string[] {
  const row: ChatRow | undefined = f.row(`turn-${TURN}-live`);
  if (row === undefined) {
    return [];
  }
  const its: HistoryIteration[] = row.iterations;
  if (its.length === 0) {
    return [];
  }
  const ts: ToolProgress[] | undefined = its[its.length - 1].tools;
  return ts === undefined ? [] : ts.map((t) => (t.call_id === undefined ? '' : t.call_id));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §A 提交边界：提交不得产生"洞"，迭代号必须连续（不因空壳被整条丢掉）');
{
  const f = new ModelFeed('c');
  started(f, TURN, 1);
  running(f, 1, tool('c1', 1, 'running'), 10);
  commit(f, 1, [], 20);          // 服务端提交（完备形态由 P4 保证；此处只关心块/号）
  advance(f, 2, 30);
  ok('★A 迭代 1 的块**存在**（不因"没工具"被整条丢掉）', iterNums(f).join(',') === '1');
  ok('★A 迭代号连续：[1]', blocksOf(f).length === 1);
  ok('★A 后续推进照常：live 已到迭代 2', f.state.live !== null && f.state.live.iteration === 2);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §B 同号重发：**同号块不可表示**（T5a）⇒ 已提交块不被轻快照覆盖');
{
  const f = new ModelFeed('c');
  started(f, TURN, 1);
  running(f, 1, tool('c1', 1, 'running'), 10);
  commit(f, 1, [tool('c1', 1, 'done')], 20);   // 完备提交（P4 形态）
  // 再来一帧：同号、tools 为空（服务端重发轻快照）——新模型：整块丢弃（不覆盖、不追加）
  commit(f, 1, [], 40);
  ok('★B 重发轻快照后块数仍为 1（同号不可表示）', blocksOf(f).length === 1);
  ok('★B 原块的工具**仍在**（未被轻快照抹掉）', iterTools(f, 1).join(',') === 'c1');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §C 多迭代连续：3 个迭代各自的工具都在，号连续 [1,2,3]');
{
  const f = new ModelFeed('c');
  started(f, TURN, 1);
  for (let n = 1; n <= 3; n++) {
    running(f, n, tool(`c${n}`, n, 'running'), 10 * n);
    commit(f, n, [tool(`c${n}`, n, 'done')], 10 * n + 1);
    advance(f, n + 1, 10 * n + 2);
  }
  ok('★C 迭代号连续 [1,2,3]', iterNums(f).join(',') === '1,2,3');
  ok('★C 每个迭代各保留 1 个工具',
    iterTools(f, 1).join(',') === 'c1' && iterTools(f, 2).join(',') === 'c2' && iterTools(f, 3).join(',') === 'c3');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §D 不误补：别的迭代的工具**不得**被折进本迭代（T5c：工具号恒等块号）');
{
  const f = new ModelFeed('c');
  started(f, TURN, 1);
  running(f, 1, tool('c1', 1, 'running'), 10);
  commit(f, 1, [tool('c1', 1, 'done')], 20);
  advance(f, 2, 30);
  running(f, 2, tool('c2', 2, 'running'), 40);
  commit(f, 2, [tool('c2', 2, 'done')], 50);
  ok('★D 迭代 1 只有 c1', iterTools(f, 1).join(',') === 'c1');
  ok('★D 迭代 2 只有 c2', iterTools(f, 2).join(',') === 'c2');
  const bs = blocksOf(f);
  let stamped = true;
  for (let i = 0; i < bs.length; i++) {
    for (let k = 0; k < bs[i].tools.length; k++) {
      if (bs[i].tools[k].iteration !== bs[i].iteration) {
        stamped = false;
      }
    }
  }
  ok('★D 结构判据：每枚工具的 iteration == 所在块号（跨迭代串工具不可能）', stamped);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §E 在飞工具恒有渲染位（用户"进入执行中后消失"的新链路等价保护）');
{
  const f = new ModelFeed('c');
  started(f, TURN, 1);
  running(f, 1, tool('c1', 1, 'running'), 10);
  ok('★E 模型里在飞工具在 live.tools（尚未提交的唯一去处）',
    f.state.live !== null && f.state.live.tools.length === 1 && f.state.live.tools[0].call === 'c1');
  ok('★E 渲染行末尾在飞块**含**这枚工具（"执行中"必然可见）', liveToolIds(f).join(',') === 'c1');
}

console.log('\n▶ §F mutation 自证（外部注入，逐条必红）');
console.log('   · 去掉 `onDone` 的同号丢弃（`iteration <= last`）⇒ §B 块数变 2');
console.log('   · 去掉 `stampTools` 盖章 ⇒ §D 的工具号判据红');
console.log('   · `onTick` 不写 `live.tools` ⇒ §A 的 live 推进/§E 红（在飞工具无渲染位）');

console.log(`\n  iteration_continuity: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
