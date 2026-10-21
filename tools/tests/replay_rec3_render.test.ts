/**
 * 用**真机 dump**（`/tmp/rec3.jsonl`，1001 帧）在本机跑同一套管线，打印**渲染结果**。
 * 目的：用户要求「代码都在你手上，直接定位」——不再靠真机点、不再猜帧类。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: string): any;

import { normalizeEvent } from '../../entry/src/main/ets/core/normalize';
import { reduce } from '../../entry/src/main/ets/core/reduce';
import { initialChatState } from '../../entry/src/main/ets/core/chat_types_full';
import type { ChatState, DomainEvent } from '../../entry/src/main/ets/core/chat_types_full';
import { deriveRows } from '../../entry/src/main/ets/core/derive';
import { applyRow } from '../../entry/src/main/ets/core/render';
import { mergeToolRuns, foldPills } from '../../entry/src/main/ets/core/streammerge';
import { ChatRow } from '../../entry/src/main/ets/core/types';
import type { HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';

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
let state: ChatState = initialChatState('replay');
let events = 0;
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
  for (const ev of evs) { state = reduce(state, ev as DomainEvent); events++; }
}
console.log(`  replay: events=${events} turns=${state.turns.size} active=${state.activeTurn}`);

// 逐 turn：STATE 与 RENDER 并排
for (const [, t] of state.turns) {
  const its = t.phase.kind === 'committed' ? t.phase.payload.iterations : t.phase.data.iterations;
  const tail = its.filter((x) => x.iteration >= 74 && x.iteration <= 84);
  console.log(`  turn=${t.id} phase=${t.phase.kind} iters=${its.length}`);
  for (const b of tail) console.log(`    STATE iter${b.iteration}: ${names(b.tools)}`);
}
// 渲染层（activeTurn 行）
const rows = deriveRows(state);
for (const r of rows) {
  if (r.kind !== 'live') continue;
  const cr = new ChatRow();
  cr.id = 'r';
  applyRow(cr, r);
  const merged = mergeToolRuns(cr.iterations);
  const tail = merged.filter((x) => x.iteration >= 74 && x.iteration <= 84);
  for (const b of tail) console.log(`    RENDER block iter${b.iteration}: ${names(b.tools)}`);
  // ── UI 层：`IterBlocksView` 会对每组再 `foldPills`（>8 才折叠，其余收进 `+N`）──
  // 用户报「消失」必须在这一层可判定：把每块的 shown/hidden 数打出来。
  let hiddenTotal = 0;
  for (const b of merged) {
    const ts = b.tools !== undefined ? b.tools : [];
    const slice = foldPills(ts);
    hiddenTotal += slice.hidden.length;
    if (slice.hidden.length > 0) console.log(`    UI block iter${b.iteration}: shown=${slice.shown.length} hidden(+N)=${slice.hidden.length}`);
  }
  console.log(`    UI hiddenTotal=${hiddenTotal}`);
}
// 断言：76/78/79/82 四条纯工具迭代的 Shell 在 STATE 层必须都在
{
  let all: HistoryIteration[] = [];
  for (const [, t] of state.turns) {
    all = all.concat(t.phase.kind === 'committed' ? t.phase.payload.iterations : t.phase.data.iterations);
  }
  for (const n of [76, 78, 79, 82]) {
    const b = all.filter((x) => x.iteration === n)[0];
    ok(`STATE iter${n} 存在且带 Shell`, b !== undefined && names(b.tools).indexOf('Shell') >= 0);
  }
}
console.log(`  replay_rec3_render: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
export {};
