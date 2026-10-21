/**
 * 用**真机 dump**（`/tmp/rec3.jsonl`，1001 帧）在本机跑同一套管线，打印**渲染结果**。
 * 目的：用户要求「代码都在你手上，直接定位」——不再靠真机点、不再猜帧类。
 *
 * ── 链路（2026-10-21 迁移）────────────────────────────────────────────────────
 *   旧判据走 `reduce + deriveRows + applyRow`（已废弃）。现走**新模型链路**
 *   （`model_harness.ModelFeed` = 生产 `model_bridge.stepEvent` + `applyModel`）。
 *
 * ⚠️ dump 里**只有 SSE 帧**（`iteration` / `stream` / `session`，3186 条，全部 turn=1041），
 *   没有 `turn_started`。真实驱动在收到这些帧之前一定先由 REST 历史（`history_replaced`）
 *   把回合开出来；新模型**不从 tick 造回合**（`model_step.onTick`：未知 turn ⇒ 只发 `pullTurn`）
 *   ⇒ 本用例按真实前置条件补一条 `turn_started(1041)`（dump 里没有，故在此显式构造）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: string): any;

import { ModelFeed } from './model_harness';
import { normalizeEvent } from '../../entry/src/main/ets/core/normalize';
import { foldPills } from '../../entry/src/main/ets/core/streammerge';
import type { ChatRow, HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';

const fs = require('fs');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++ } else { fail++; console.log(`  ✗ ${name}`) }
}
function names(ts: ToolProgress[] | undefined): string {
  const a: ToolProgress[] = ts !== undefined ? ts : [];
  return a.map((t) => `${t.name}@${t.iteration !== undefined ? t.iteration : '-'}${t.call_id !== undefined ? '' : '!NOID'}`).join(',');
}

if (!fs.existsSync('/tmp/rec3.jsonl')) {
  console.log('  (skip) /tmp/rec3.jsonl 不存在');
  process.exit(0);
}
const raw: string = fs.readFileSync('/tmp/rec3.jsonl', 'utf8');
const feed = new ModelFeed('replay');
let events = 0;
let openedTurn = -1;
for (const ln of raw.split('\n')) {
  if (!ln) continue;
  let o: any;
  try { o = JSON.parse(ln); } catch (e) { continue; }
  const datas: string[] = String(o.r ?? '').split('\n').filter((x: string) => x.startsWith('data:'))
    .map((x: string) => x.replace(/^data:\s?/, ''));
  if (datas.length === 0) continue;
  let payload: any;
  try { payload = JSON.parse(datas.join('\n')); } catch (e) { continue; }
  const env = payload.progress ?? payload;
  const chatId: string = env.chat_id ?? payload.route_chat_id ?? 'replay';
  const evs = normalizeEvent(payload, chatId);
  if (evs === null) continue;
  for (const ev of evs) {
    const tid: any = (ev as any).turnID;
    if (openedTurn < 0 && tid !== undefined && tid !== null) {
      openedTurn = tid as number;
      // 真实前置：回合已由 REST 历史开出（dump 只含 SSE 帧）
      feed.push({ type: 'turn_started', turnID: openedTurn, requestID: null, trigger: 'user', content: 'go' });
    }
    feed.push(ev as never);
    events++;
  }
}
console.log(`  replay: events=${events} turns=${feed.state.turns.size} live=${feed.state.live === null ? 'null' : `${(feed.state.live as never as { iteration: number }).iteration}`}`);

// 逐 turn：STATE 与 RENDER 并排
for (const [id, t] of feed.state.turns) {
  const its = t.blocks;
  const tail = its.filter((x) => x.iteration >= 74 && x.iteration <= 84);
  console.log(`  turn=${id} phase=${t.phase} finalized=${t.final !== null} iters=${its.length}`);
  for (const b of tail) console.log(`    STATE iter${b.iteration}: ${names(b.tools.map((x) => ({ name: x.meta.name, iteration: x.iteration, call_id: x.call }) as never))}`);
}
// 渲染层（每一行都打印；live 行的在飞块在末尾）
const rows: ChatRow[] = feed.rows();
for (const r of rows) {
  const tail = r.iterations.filter((x) => x.iteration >= 74 && x.iteration <= 84);
  for (const b of tail) console.log(`    RENDER row=${r.id} live=${r.isLive} block iter${b.iteration}: ${names(b.tools)}`);
  // ── UI 层：`IterBlocksView` 会对每组再 `foldPills`（>8 才折叠，其余收进 `+N`）──
  // 用户报「消失」必须在这一层可判定：把每块的 shown/hidden 数打出来。
  let hiddenTotal = 0;
  for (const b of r.iterations) {
    const ts: ToolProgress[] = b.tools !== undefined ? b.tools : [];
    const slice = foldPills(ts);
    hiddenTotal += slice.hidden.length;
    if (slice.hidden.length > 0) console.log(`    UI row=${r.id} block iter${b.iteration}: shown=${slice.shown.length} hidden(+N)=${slice.hidden.length}`);
  }
  if (r.role === 'assistant') console.log(`    UI row=${r.id} hiddenTotal=${hiddenTotal}`);
}

// 断言：76/78/79/82 四条纯工具迭代的 Shell 在 STATE 层必须都在
{
  let all: never[] = [];
  for (const [, t] of feed.state.turns) {
    all = all.concat(t.blocks as never[]);
  }
  const blocks = all as unknown as { iteration: number; tools: { meta: { name: string } }[] }[];
  for (const n of [76, 78, 79, 82]) {
    const b = blocks.filter((x) => x.iteration === n)[0];
    ok(`STATE iter${n} 存在且带 Shell`,
      b !== undefined && b.tools.map((x) => x.meta.name).indexOf('Shell') >= 0);
  }
}

// 断言（渲染层，同一保证）：同样四条迭代在**页面会画出来的行**上必须有 Shell
{
  const assistant: ChatRow[] = rows.filter((r) => r.role === 'assistant');
  let all: HistoryIteration[] = [];
  for (let i = 0; i < assistant.length; i++) { all = all.concat(assistant[i].iterations); }
  for (const n of [76, 78, 79, 82]) {
    const b = all.filter((x) => x.iteration === n)[0];
    ok(`RENDER iter${n} 存在且带 Shell`, b !== undefined && names(b.tools).indexOf('Shell') >= 0);
  }
}

console.log(`  replay_rec3_render: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
export {};
