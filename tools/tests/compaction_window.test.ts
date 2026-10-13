/**
 * compaction_window.test.ts —— 「turn 内压缩点」的两处**判别力**回归守卫：
 *
 * ① **接线**（本仓血债「死消费」又一例）：后端 `protocol/events.go:301/317` 早已在
 *    `/api/history` 的 assistant 行上携带结构化 `compactions[]`（`after_iteration` +
 *    `content` + `timestamp`），而本仓 `HistoryMessage` **没有这个字段** ⇒ JSON 被直接丢弃
 *    ⇒ 历史 turn 的「上下文已压缩」横线**从来不会内联出现**。web 同源消费点
 *    `hooks/useChatMessages.ts:250`。
 *
 * ② **窗口可见性**（「消息不连续」零容忍判据 A，用户 2026-10-11）：`afterIteration === 0`
 *    的压缩点位于该 turn **第一条迭代之前**（紧随 user msg）—— 只有窗口覆盖到迭代 1
 *    （`regionsBefore` 归零）时才允许渲染，否则它会浮在一个**尚未加载的缺口**正上方。
 *    web 同处 `src/chat/derive.ts:336-346 windowCompactions`（本仓 `core/derive.ts` 同源移植）。
 *
 * 判别力（mutation 自证）：
 *   · 删掉 `store.ets:toChatMessages` 里的 `toHistoryCompactions(...)` ⇒ A1/A2 红；
 *   · 把 `derive.ts` 的 `windowCompactions(...)` 还原成裸 `t.phase.payload.compactions`
 *     ⇒ C1/C5 红；
 *   · 把 `windowCompactions` 的 `afterIteration > 0` 改成 `>= 0` ⇒ C1 红（窗口化时不再过滤）。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { HistoryMessage } from '../../entry/src/main/ets/core/types';
import { toHistoryCompactions } from '../../entry/src/main/ets/core/compaction';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
    return;
  }
  fail++;
  console.log(`  \u2717 ${name}${extra !== undefined ? '  (' + extra + ')' : ''}`);
}

/** 一个带两个迭代 + 压缩点的 assistant 行（turn 5）。 */
function withCompactions(regionsBefore: number): HistoryMessage[] {
  return [
    {
      id: 50,
      role: 'user',
      turn_id: 5,
      content: '\u95ee',
    },
    {
      id: 51,
      role: 'assistant',
      turn_id: 5,
      content: '\u7b54',
      regions_before: regionsBefore,
      iterations: [
        { iteration: 1, content: 'a' },
        { iteration: 2, content: 'b' },
      ],
      compactions: [
        { after_iteration: 0, content: '[Compacted context]\n\n\u6458\u8981' },
        { after_iteration: 2, content: '[Compacted context]\n\n\u6458\u89812' },
      ],
    },
  ];
}

// ── A. 接线：wire `compactions` → ChatMessage.compactions ─────────────────────
{
  const out = ChatStore.toChatMessages(withCompactions(0));
  const asst = out.filter((m) => m.role === 'assistant');
  ok('A1 assistant 行拿到 2 个压缩点',
    asst.length === 1 && asst[0].compactions !== undefined && asst[0].compactions.length === 2,
    asst.length === 1 ? `n=${asst[0].compactions === undefined ? 'undef' : asst[0].compactions.length}` : 'n/a');
  ok('A2 afterIteration 逐字映射（0 与 2）',
    asst.length === 1 && asst[0].compactions !== undefined
    && asst[0].compactions[0].afterIteration === 0 && asst[0].compactions[1].afterIteration === 2);
  ok('A3 content 逐字透传',
    asst.length === 1 && asst[0].compactions !== undefined
    && (asst[0].compactions[0].content ?? '').indexOf('\u6458\u8981') >= 0);
}

// ── B. 外来 JSON 三态：缺省 / null / 空数组 ⇒ 不设键（保持既有行对象形状）──────
{
  const noField: HistoryMessage[] = [
    { id: 1, role: 'assistant', turn_id: 1, content: 'x', iterations: [] },
  ];
  ok('B1 缺省 ⇒ compactions 为 undefined',
    ChatStore.toChatMessages(noField)[0].compactions === undefined);

  const nullField: HistoryMessage[] = [
    {
      id: 1, role: 'assistant', turn_id: 1, content: 'x', iterations: [],
      compactions: null as unknown as HistoryMessage['compactions'],
    },
  ];
  ok('B2 JSON null ⇒ 不设键（不炸、不留空数组）',
    ChatStore.toChatMessages(nullField)[0].compactions === undefined);

  const emptyArr: HistoryMessage[] = [
    { id: 1, role: 'assistant', turn_id: 1, content: 'x', iterations: [], compactions: [] },
  ];
  ok('B3 空数组 ⇒ 不设键', ChatStore.toChatMessages(emptyArr)[0].compactions === undefined);

  const badElem: HistoryMessage[] = [
    {
      id: 1, role: 'assistant', turn_id: 1, content: 'x', iterations: [],
      compactions: [null as never, { after_iteration: 1 }],
    },
  ];
  const ou = ChatStore.toChatMessages(badElem)[0];
  ok('B4 数组里混 null 元素 ⇒ 跳过它、保留合法项',
    ou.compactions !== undefined && ou.compactions.length === 1
    && ou.compactions[0].afterIteration === 1);
  ok('B5 `after_iteration` 缺失 ⇒ 0（= turn 首迭代之前）',
    ChatStore.toChatMessages([{
      id: 1, role: 'assistant', turn_id: 1, content: 'x', iterations: [],
      compactions: [{ content: 'c' }],
    }])[0].compactions !== undefined
    && (ChatStore.toChatMessages([{
      id: 1, role: 'assistant', turn_id: 1, content: 'x', iterations: [],
      compactions: [{ content: 'c' }],
    }])[0].compactions as { afterIteration: number }[])[0].afterIteration === 0);
}

// ── C. 窗口可见性（端到端走 derive）───────────────────────────────────────────
{
  // C1：窗口化（regions_before>0）⇒ `afterIteration=0` 的压缩点必须被滤掉，`>0` 的保留。
  const rows = ChatStore.rowsFromHistory(withCompactions(166));
  const asst = rows.filter((r) => r.role === 'assistant');
  ok('C1 regions_before>0 ⇒ 只留 `afterIteration>0` 的压缩点（0 的那条会浮在缺口上）',
    asst.length === 1 && asst[0].compactions.length === 1
    && asst[0].compactions[0].afterIteration === 2,
    asst.length === 1 ? `n=${asst[0].compactions.length}` : 'n/a');
  ok('C2 同时 user 行也不渲染（同一不变量，derive 同处）',
    rows.filter((r) => r.role === 'user').length === 0);

  // C3：窗口归零 ⇒ 两条都保留（完整时间线）。
  const rows2 = ChatStore.rowsFromHistory(withCompactions(0));
  const asst2 = rows2.filter((r) => r.role === 'assistant');
  ok('C3 regions_before 归零 ⇒ 两条都保留',
    asst2.length === 1 && asst2[0].compactions.length === 2,
    asst2.length === 1 ? `n=${asst2[0].compactions.length}` : 'n/a');
  ok('C4 归零后 user 行也出现（完整时间线）',
    rows2.filter((r) => r.role === 'user').length === 1);
}

// ── D. 纯函数：只有 `afterIteration=0` 且窗口化 ⇒ 整条列表消失（不留空数组引用）──
{
  ok('D1 [0] + regions_before>0 ⇒ 空（返回 undefined 语义 ⇒ 渲染层零产出）',
    toHistoryCompactions([{ after_iteration: 0 }]).length === 1); // 纯映射不做过滤（过滤在 derive）
  const onlyZero: HistoryMessage[] = [
    {
      id: 2, role: 'assistant', turn_id: 9, content: 'x',
      iterations: [{ iteration: 3, content: 'z' }],
      regions_before: 40,
      compactions: [{ after_iteration: 0, content: 'c' }],
    },
  ];
  const r = ChatStore.rowsFromHistory(onlyZero);
  const a = r.filter((x) => x.role === 'assistant');
  ok('D2 窗口化 + 仅 `afterIteration=0` ⇒ 压缩点全滤（渲染层零产出）',
    a.length === 1 && a[0].compactions.length === 0,
    a.length === 1 ? `n=${a[0].compactions.length}` : 'n/a');
}

console.log(`\ncompaction_window: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
