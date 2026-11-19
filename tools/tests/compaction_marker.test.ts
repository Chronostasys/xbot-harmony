/**
 * compaction_marker.test.ts —— 压缩点**必须可展开显示**，且压缩标记**绝不冒充 user 消息**
 * （用户 2026-11-19：「我们怎么不渲染压缩呀？压缩后应该有个可以展开的玩意，
 *   让用户看在哪里压缩的、压缩的摘要是什么」）。
 *
 * ## 后端两种下发形态（`channel/subscription.go:attachCompactions`）
 * 1. **turn 内**：挂在 assistant 行的 `compactions: [{after_iteration, content}]`
 *    ⇒ 客户端 `hydrate` 已支持，渲染成迭代之间的 `CompactionDividerRow`（可展开摘要）。
 * 2. **回落形态**：该 turn 的行不在本次窗口时，压缩标记写成
 *    `role:"user"` + `standalone:true` + `content:"[Compacted context]\n\n<summary>"` + `anchor_turn_id`。
 *
 * ## 真因
 * `model_hydrate` 只认形态 1，**没有**形态 2 的分支 ⇒ 那一行被当成该 turn 的 user 消息：
 *   · 顶掉真实 user 气泡（web `chat/integrate.ts:78` 记录的 P0 2026-09-26 同一形态）；
 *   · 压缩点整段消失（用户看不到"在哪里压缩、摘要是什么"）。
 *
 * ## 修法（对齐 web 权威 `chat/integrate.ts:35 isCompactMarkerRow` + `:58`）
 *   · 内容以 `[Compacted context]` 开头 ⇒ 收进 `orphanCompactions`，**绝不进 user 槽/legacy**；
 *   · 循环结束后挂到锚点 turn 的 `compactions`（`afterIteration = 0` ⇒ 渲染在该 turn 顶部），
 *     复用既有可展开分隔行；
 *   · 其它 `standalone` 行（`!cmd`）⇒ 落 legacy 并带 `standalone` 标记（不画成 user 气泡）。
 *
 * ⛔ mutation 自证：删掉 `isCompactMarker` 分支 ⇒ ①/② 红；把压缩点写成 user 行 ⇒ ① 红；
 *   删掉 standalone 分支 ⇒ ③ 红。
 */
export {};

declare const process: { exit: (c: number) => void };

import { emptyState  } from '../../entry/src/main/ets/core/model_types';
import type { State, TurnRec, UserLine } from '../../entry/src/main/ets/core/model_types';
import { hydrate } from '../../entry/src/main/ets/core/model_hydrate';
import { historyEventToWire } from '../../entry/src/main/ets/core/model_bridge';
import type { DomainEvent, LegacyRow, Turn } from '../../entry/src/main/ets/core/chat_types_full';
import type { WireHistoryMessage } from '../../entry/src/main/ets/core/model_hydrate';
import { applyModel } from '../../entry/src/main/ets/core/model_bridge';
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

const MARK = '[Compacted context]\n\n早前的对话摘要：用户要求训练孙吧 LoRA。';

// ── ① 压缩标记（standalone user 行）不得顶掉真实 user，且挂到锚点 turn ──────────
{
  const base: State = emptyState('web:chat_CP1', 1, 0);
  const wire: WireHistoryMessage[] = [
    // 真实 user 消息（该 turn 的 user 行）
    { id: 'u1', role: 'user', content: '继续', turnID: 3 },
    // 压缩标记的回落形态（standalone，锚到 turn 3）
    { id: 'cmp1', role: 'user', content: MARK, turnID: 0, dbID: 9001, standalone: true, anchorTurnID: 3 },
    {
      id: 'a1', role: 'assistant', content: '', turnID: 3,
      iterations: [{ iteration: 1, content: '正文', reasoning: '想' }],
    },
  ];
  const st: State = hydrate(base, wire, 5, null);
  const t3: TurnRec | undefined = st.turns.get(3);
  ok('① turn 3 存在', t3 !== undefined);
  eq('①b 真实 user 消息未被压缩标记顶掉', t3 !== undefined && t3.user !== null ? t3.user.content : 'MISSING', '继续');
  eq('①c 压缩点挂到 turn 3（afterIteration=0）',
    t3 !== undefined ? t3.compactions.map((c) => c.afterIteration) : [], [0]);
  ok('①d 摘要正文保留（供展开查看）',
    t3 !== undefined && t3.compactions.length > 0 && t3.compactions[0].content.indexOf('孙吧 LoRA') >= 0);
  // 不得多出一条 user 行
  const rows: ChatRow[] = applyModel(st, new Map());
  const users = rows.filter((r: ChatRow) => r.role === 'user');
  eq('①e 界面上只有 1 条 user 行（压缩标记不冒充用户）', users.length, 1);
  eq('①f 那条 user 行是"继续"', users.length > 0 ? users[0].content : 'MISSING', '继续');
}

// ── ② turn 内形态（`compactions` 字段）继续可用 ────────────────────────────────
{
  const base: State = emptyState('web:chat_CP2', 1, 0);
  const wire: WireHistoryMessage[] = [
    { id: 'u2', role: 'user', content: 'q', turnID: 4 },
    {
      id: 'a2', role: 'assistant', content: '', turnID: 4,
      iterations: [{ iteration: 1, content: '甲', reasoning: '' }, { iteration: 2, content: '乙', reasoning: '' }],
      compactions: [{ after_iteration: 1, content: '[Compacted context]\n\n摘要甲' }],
    },
  ];
  const st: State = hydrate(base, wire, 6, null);
  const t4: TurnRec | undefined = st.turns.get(4);
  eq('② turn 内压缩点保留（afterIteration=1）',
    t4 !== undefined ? t4.compactions.map((c) => c.afterIteration) : [], [1]);
  ok('②b 摘要可用', t4 !== undefined && t4.compactions.length > 0 && t4.compactions[0].content.indexOf('摘要甲') >= 0);
}

// ── ③ 命令 standalone 行：落 legacy 且带 standalone 标记（不画成 user 气泡）──────
{
  const base: State = emptyState('web:chat_CP3', 1, 0);
  const wire: WireHistoryMessage[] = [
    { id: 'cmd1', role: 'user', content: '!ls', turnID: 0, dbID: 7001, standalone: true, anchorTurnID: 2 },
  ];
  const st: State = hydrate(base, wire, 7, null);
  const legacyCmds = st.legacy.filter((l) => l.standalone === true);
  eq('③ 命令行落 legacy 且带 standalone', legacyCmds.length, 1);
  eq('③b 锚点保留', legacyCmds.length > 0 ? legacyCmds[0].anchorTurn : -1, 2);
  // 压缩标记不能落进 legacy（否则会被画成 user 气泡）
  const legacyMarkers = st.legacy.filter((l) => l.content.indexOf('[Compacted context]') === 0);
  eq('③c 压缩标记不得落 legacy', legacyMarkers.length, 0);
}

// ── ④ 幂等：同一压缩标记重复下发只挂一次 ─────────────────────────────────────
{
  const base: State = emptyState('web:chat_CP4', 1, 0);
  const wire: WireHistoryMessage[] = [
    { id: 'u5', role: 'user', content: 'q', turnID: 5 },
    { id: 'a5', role: 'assistant', content: '', turnID: 5, iterations: [{ iteration: 1, content: 'x', reasoning: '' }] },
    { id: 'cmp5', role: 'user', content: MARK, turnID: 0, dbID: 9005, standalone: true, anchorTurnID: 5 },
  ];
  const once: State = hydrate(base, wire, 8, null);
  const twice: State = hydrate(once, wire, 9, null);
  const t5: TurnRec | undefined = twice.turns.get(5);
  eq('④ 重复水合不重复挂压缩点', t5 !== undefined ? t5.compactions.length : -1, 1);
  ok('④b 真实 user 仍在', t5 !== undefined && t5.user !== null && (t5.user as UserLine).content === 'q');
}

// ── ⑤ 端到端： → wire 必须**带上** compactions / standalone（真因）──────
// ⛔ 用户 2026-11-20：「看不到压缩点位，看不到展开按钮」。真因 = 
//   把  与 legacy 的 standalone/anchor 丢了 ⇒ hydrate 永远收不到。
{
  const legacyRow: LegacyRow = {
    id: 'cmp9', role: 'user', content: MARK, iterations: [], timestamp: 't', dbID: 9100,
    standalone: true, anchorTurnID: 7,
  };
  const turn: Turn = {
    id: 7 as never,
    user: { content: '继续', timestamp: 't', isNotification: false } as never,
    phase: {
      kind: 'committed',
      payload: {
        via: 'text', content: '正文', iterations: [],
        compactions: [{ afterIteration: 2, content: MARK }],
        regionsBefore: 0,
      },
    } as never,
  } as never;
  const ev: DomainEvent = {
    type: 'history_replaced', lastSeq: null, legacy: [legacyRow], turns: [turn], standalone: [],
  } as never;
  const wire = historyEventToWire(ev);
  const asst = wire.filter((w) => w.role ===
    'assistant');
  ok('⑤ wire 的 assistant 行必须带 compactions',
    asst.length > 0 && asst[0].compactions !== undefined && (asst[0].compactions as unknown[]).length === 1);
  const lg = wire.filter((w) => w.id === 'cmp9');
  ok('⑤b wire 的 standalone 行必须带 standalone + anchorTurnID',
    lg.length > 0 && lg[0].standalone === true && lg[0].anchorTurnID === 7);
}

console.log(`compaction_marker: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
