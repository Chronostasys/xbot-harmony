/**
 * live_tail_blocks_invariant.test.ts —— **已提交块只增不减**（用户 2026-11-18 P0 的行为级锁定）。
 *
 * ## 体感即判据
 * 用户原话：「user msg1 → agent iter1 → **iter1 执行完毕就只剩 user msg1** → iter2 出现（执行中）→
 * 执行完毕又只剩 user msg1」。换句话说：**任何时候，已完成的迭代都必须还在**。
 *
 * 本判据不看实现细节，只钉这条**单调性不变量**：
 *   · 沿真实 SSE 顺序（`turn_started` → 多个 `iteration` → `phase_done` → 下一个 `iteration` …）
 *     每一步都检查：assistant 行的**已提交块数不得减少**；
 *   · 每个已提交块的正文/思考**一旦非空就不许再变空**（轻字段提交帧不得抹掉 live 累积的内容）；
 *   · 结束时（`text_final` + idle）所有迭代仍在，且内容与流式期一致。
 *
 * ⛔ 为什么需要它：真机 P0 的形态是"块在模型里、但界面看不到"（渲染层值投递），以及
 *   "轻字段 done 把 live 内容吞掉后块被 empty 过滤"（模型层）。两者都会破坏这条单调性，
 *   而单点判据（只看某一帧）抓不到 —— 必须**逐步**检查。
 *
 * ⛔ mutation 自证：
 *   ① `enrichDoneBlock` 守卫改回 `!isShellBlock(block)` ⇒ ② 红（轻字段 done 后块被吞）；
 *   ② `onDone` 把块 append 改成整体替换 ⇒ ① 红（块数回落）。
 */
export {};

declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 一行 assistant 的已提交块快照（号 + 正文长 + 思考长）。 */
function committedShape(rows: ChatRow[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].role !== 'assistant') continue;
    const cb = rows[i].completedBlocks;
    for (let k = 0; k < cb.length; k++) {
      const one = cb[k];
      const cl: number = one.content !== undefined ? one.content.length : 0;
      const rl: number = one.reasoning !== undefined ? one.reasoning.length : 0;
      out.push(`${one.iteration}:${cl}/${rl}`);
    }
  }
  return out;
}

function committedCount(rows: ChatRow[]): number {
  return committedShape(rows).length;
}

/** 逐步喂帧并校验单调性（块数不减、已有内容不变空）。 */
class MonotonicChecker {
  private last: string[] = [];
  private label: string;
  constructor(label: string) { this.label = label; }
  step(f: ModelFeed, tag: string): void {
    const now: string[] = committedShape(f.rows());
    if (now.length < this.last.length) {
      fail++;
      console.log(`  ✗ ${this.label} 块数回落 @${tag}：${this.last.length} → ${now.length}`
        + `\n      before=${JSON.stringify(this.last)}\n      after =${JSON.stringify(now)}`);
    } else {
      // 已有块的内容不得变空（长度只能 >= 上一帧）
      let bad = false;
      for (let i = 0; i < this.last.length; i++) {
        const prevParts: string[] = (this.last[i].split(':')[1] !== undefined ? this.last[i].split(':')[1] : '0/0').split('/');
        const curStr: string = now[i] !== undefined ? (now[i].split(':')[1] !== undefined ? now[i].split(':')[1] : '0/0') : '0/0';
        const curParts: string[] = curStr.split('/');
        const pc = parseInt(prevParts[0] !== undefined ? prevParts[0] : '0', 10);
        const pr = parseInt(prevParts[1] !== undefined ? prevParts[1] : '0', 10);
        const cc = parseInt(curParts[0] !== undefined ? curParts[0] : '0', 10);
        const cr = parseInt(curParts[1] !== undefined ? curParts[1] : '0', 10);
        if (cc < pc || cr < pr) bad = true;
      }
      if (bad) {
        fail++;
        console.log(`  ✗ ${this.label} 块内容被抹短 @${tag}`
          + `\n      before=${JSON.stringify(this.last)}\n      after =${JSON.stringify(now)}`);
      } else {
        pass++;
      }
    }
    this.last = now;
  }
}

// ── ① 三个迭代全流程：每步块数单调不减、内容不缩 ──────────────────────────────
{
  const f = new ModelFeed('chat_mono_1');
  const chk = new MonotonicChecker('①');
  f.push({ type: 'turn_started', turnID: 1, requestID: 'r1', trigger: 'user', content: 'q' });
  chk.step(f, 'turn_started');

  // iter 1：思考 + 工具，工具跑完，轻字段 done
  f.push({ type: 'iteration', turnID: 1, iter: 1, phase: 'thinking', seq: 11, content: '', reasoning: '思考一' });
  chk.step(f, 'iter1-think');
  f.push({
    type: 'iteration', turnID: 1, iter: 1, phase: 'tool_exec', seq: 12, content: '', reasoning: '思考一',
    streamingTools: [{ name: 'Shell', label: 'A', status: 'running', iteration: 1 }],
  });
  chk.step(f, 'iter1-tool-running');
  f.push({
    type: 'iteration', turnID: 1, iter: 1, phase: 'tool_exec', seq: 13, content: '', reasoning: '思考一',
    streamingTools: [], completedTools: [{ name: 'Shell', label: 'A', status: 'done', iteration: 1 }],
  });
  chk.step(f, 'iter1-tool-done');
  // ⛔ 轻字段提交（正文/思考都空）—— 这正是会"吞块"的形态
  f.push({
    type: 'phase_done', turnID: 1, seq: 14,
    finalIteration: { iteration: 1, content: '', reasoning: '', tools: [{ name: 'Shell', label: 'A', status: 'done', iteration: 1 }] },
  });
  chk.step(f, 'iter1-done(light)');

  // iter 2：只有正文
  f.push({ type: 'iteration', turnID: 1, iter: 2, phase: 'stream', seq: 21, content: '正文二', reasoning: '' });
  chk.step(f, 'iter2-stream');
  f.push({
    type: 'phase_done', turnID: 1, seq: 22,
    finalIteration: { iteration: 2, content: '正文二', reasoning: '', tools: [] },
  });
  chk.step(f, 'iter2-done');

  // iter 3：思考 + 正文 + 工具
  f.push({
    type: 'iteration', turnID: 1, iter: 3, phase: 'stream', seq: 31,
    content: '正文三', reasoning: '思考三',
    streamingTools: [{ name: 'FileReplace', label: 'B', status: 'done', iteration: 3 }],
  });
  chk.step(f, 'iter3-stream');
  f.push({
    type: 'phase_done', turnID: 1, seq: 32,
    finalIteration: { iteration: 3, content: '', reasoning: '', tools: [{ name: 'FileReplace', label: 'B', status: 'done', iteration: 3 }] },
  });
  chk.step(f, 'iter3-done(light)');

  // 收尾
  f.push({ type: 'session', running: false, turnID: 1, seq: 40 });
  chk.step(f, 'idle');
  f.push({ type: 'text_final', turnID: 1, seq: 41, content: '正文三' });
  chk.step(f, 'final');

  const rows: ChatRow[] = f.rows();
  const shape = committedShape(rows);
  eq('① 三个迭代都还在', shape.length, 3);
  eq('①b 迭代号连续', shape.map((x) => x.split(':')[0]), ['1', '2', '3']);
  ok('①c 迭代 1 的思考没被轻字段 done 抹掉', shape[0].indexOf('/') > 0 && !shape[0].endsWith('/0'));
  ok('①d 迭代 3 的正文没被轻字段 done 抹掉', parseInt(shape[2].split(':')[1].split('/')[0], 10) === 3);
}

// ── ② 仅思考的迭代：done 后 reasoning 不丢（曾整块消失）──────────────────────
{
  const f = new ModelFeed('chat_mono_2');
  f.push({ type: 'turn_started', turnID: 2, requestID: 'r2', trigger: 'user', content: 'q' });
  f.push({ type: 'iteration', turnID: 2, iter: 1, phase: 'thinking', seq: 11, content: '', reasoning: '只有思考' });
  f.push({
    type: 'phase_done', turnID: 2, seq: 12,
    finalIteration: { iteration: 1, content: '', reasoning: '', tools: [] },
  });
  const shape = committedShape(f.rows());
  eq('② 仅思考的迭代 done 后仍是一个块', shape.length, 1);
  ok('②b 思考内容保留', shape.length > 0 && !shape[0].endsWith('/0'));
}

// ── ③ 空闲后不能再出现新块（idle 之后 append 非法）─────────────────────────────
{
  const f = new ModelFeed('chat_mono_3');
  f.push({ type: 'turn_started', turnID: 3, requestID: 'r3', trigger: 'user', content: 'q' });
  f.push({ type: 'iteration', turnID: 3, iter: 1, phase: 'stream', seq: 11, content: 'x', reasoning: '' });
  f.push({
    type: 'phase_done', turnID: 3, seq: 12,
    finalIteration: { iteration: 1, content: 'x', reasoning: '', tools: [] },
  });
  f.push({ type: 'session', running: false, turnID: 3, seq: 13 });
  f.push({ type: 'text_final', turnID: 3, seq: 14, content: 'x' });
  const before = committedCount(f.rows());
  // 重放的旧 done 帧（服务端周期性重发）不得改变块表
  f.push({
    type: 'phase_done', turnID: 3, seq: 15,
    finalIteration: { iteration: 1, content: '', reasoning: '', tools: [] },
  });
  eq('③ 重放旧 done 不改变块数', committedCount(f.rows()), before);
}

console.log(`live_tail_blocks_invariant: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
