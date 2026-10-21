/**
 * core/model_hydrate.ts —— **水合**：权威历史 → 模型 `State`（纯 TS，⛔ 无 `.ets` import）。
 *
 * 为什么水合不是"帧"（`docs/STATE-MODEL.md` §3.5）：历史快照是**权威整体**，不是增量；
 * 把它翻译成 `open/done/final` 会把"服务端权威"降级成"客户端拼接"。所以它是**构造器**：
 *   `hydrate(prev, messages, seq)` 直接重建 `turns`（权威替换）与 `legacy`（DB 前缀），
 *   并**保留**会话级字段（`goal/todos/queue/running` 属另一权威，历史里没有）。
 *
 * 适配层形状：输入是**结构**接口（不 import `.ets`），由调用方（store）传 `ChatMessage[]`。
 */
import type { Block, Compaction, LegacyLine, LiveIter, State, SubAgentNode, ToolRec, TurnRec, UserLine } from './model_types';
import { newTurn, toolStatusOf } from './model_types';

/** 历史行（结构面；与 `core/types.ChatMessage` 同形，避免 `.ts` import `.ets`）。 */
export interface WireHistoryMessage {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly turnID?: number;
  readonly dbID?: number;
  readonly timestamp?: string;
  readonly isNotification?: boolean;
  readonly iterations?: readonly WireHistoryIteration[];
  readonly regionsBefore?: number;
  readonly droppedBefore?: number;
  /** turn 内压缩点（`HistoryCompaction`：`after_iteration`/`content`/`timestamp`）。 */
  readonly compactions?: readonly { readonly after_iteration?: number; readonly content?: string }[];
}

export interface WireHistoryIteration {
  readonly iteration: number;
  readonly content?: string;
  readonly reasoning?: string;
  readonly tools?: readonly WireHistoryTool[];
  readonly genui?: string;
  readonly subAgents?: readonly WireSubAgent[];
}

/** 子代理进度（`SubAgentNode` 的线格式；历史迭代里逐迭代下发）。 */
export interface WireSubAgent {
  readonly role: string;
  readonly instance?: string;
  readonly status: string;
  readonly desc?: string;
  readonly iteration?: number;
  readonly children?: readonly WireSubAgent[];
}

/** `history_replaced.active.snapshot` 的结构面（在飞快照）。 */
export interface WireLiveSnapshot {
  readonly iter: number;
  readonly content: string;
  readonly reasoning: string;
  readonly activeTools?: readonly WireHistoryTool[];
  readonly completedTools?: readonly WireHistoryTool[];
  readonly streamingTools?: readonly WireHistoryTool[];
  readonly genui?: string;
}

interface WireHistoryTool {
  readonly name: string;
  readonly label?: string;
  readonly status?: string;
  readonly elapsed_ms?: number;
  readonly summary?: string;
  readonly detail?: string;
  readonly args?: string;
  readonly call_id?: string;
  readonly callID?: string;
  readonly iteration?: number;
  readonly ui_mode?: string;
  readonly gen_chars?: number;
  readonly tool_hints?: string;
}


function toToolRecOf(t: WireHistoryTool, iteration: number, idx: number): ToolRec {
  const rawCall: string | undefined = t.call_id !== undefined && t.call_id !== ''
    ? t.call_id : (t.callID !== undefined && t.callID !== '' ? t.callID : undefined);
  return {
    call: rawCall !== undefined ? rawCall : `${iteration}#${idx}`,
    iteration,
    meta: { name: t.name, uiMode: t.ui_mode, args: t.args, detail: t.detail, summary: t.summary, toolHints: t.tool_hints },
    state: {
      status: toolStatusOf(t.status),
      label: t.label !== undefined ? t.label : t.name,
      genChars: t.gen_chars !== undefined ? t.gen_chars : 0,
      elapsedMs: t.elapsed_ms !== undefined ? t.elapsed_ms : 0,
    },
  };
}

function wireIterToBlock(w: WireHistoryIteration): Block {
  const tools: ToolRec[] = [];
  const src: readonly WireHistoryTool[] = w.tools === undefined ? [] : w.tools;
  for (let i = 0; i < src.length; i++) {
    const t: WireHistoryTool = src[i];
    const rawCall: string | undefined = t.call_id !== undefined && t.call_id !== ''
      ? t.call_id : (t.callID !== undefined && t.callID !== '' ? t.callID : undefined);
    tools.push({
      call: rawCall !== undefined ? rawCall : `${w.iteration}#${i}`,
      iteration: w.iteration,                       // T5-c：块内工具号 == 块号
      meta: {
        name: t.name,
        uiMode: t.ui_mode,
        args: t.args,
        detail: t.detail,
        summary: t.summary,
        toolHints: t.tool_hints,
      },
      state: {
        status: toolStatusOf(t.status),
        label: t.label !== undefined ? t.label : t.name,
        genChars: t.gen_chars !== undefined ? t.gen_chars : 0,
        elapsedMs: t.elapsed_ms !== undefined ? t.elapsed_ms : 0,
      },
    });
  }
  return {
    iteration: w.iteration,
    content: w.content !== undefined ? w.content : '',
    reasoning: w.reasoning !== undefined ? w.reasoning : '',
    tools,
    subAgents: toSubAgentNodes(w.subAgents),
    genui: w.genui !== undefined ? w.genui : '',
    cancelled: false,
  };
}

/** `WireSubAgent[] → SubAgentNode[]`（逐层搬运；缺失 = 空数组）。 */
function toSubAgentNodes(ws: readonly WireSubAgent[] | undefined): readonly SubAgentNode[] {
  if (ws === undefined || ws.length === 0) {
    return [];
  }
  const out: SubAgentNode[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w: WireSubAgent = ws[i];
    out.push({
      role: w.role,
      instance: w.instance,
      status: w.status,
      desc: w.desc,
      iteration: w.iteration,
      children: toSubAgentNodes(w.children),
    });
  }
  return out;
}

function toUserLine(m: WireHistoryMessage): UserLine {
  return {
    id: m.id,
    content: m.content,
    timestamp: m.timestamp !== undefined ? m.timestamp : '',
    isNotification: m.isNotification === true,
    queued: false,
    sending: false,
    requestID: null,
    dbID: m.dbID,
  };
}

/**
 * 权威历史 → `State`（**替换** `turns` 与 `legacy`；保留会话级字段）。
 *
 * 规则（与旧 `history_replaced` 的可观察语义一致）：
 *  · `turnID > 0` 的 assistant 行 ⇒ 该 turn 的 assistant（块 = iterations，**每迭代一块**）；
 *    与之配对的 user 行（同 turnID）⇒ `TurnRec.user`；
 *  · `turnID == 0` / 缺失 ⇒ `legacy`（DB 前缀，按出现顺序）；
 *  · 同一 turnID 多行 assistant ⇒ 后行的块**追加**（历史分片），文本取最后一行的 content；
 *  · `live` **不动**（在飞态由 `snapshot`/`tick` 负责，历史不能覆盖）。
 */
export function hydrate(prev: State, messages: readonly WireHistoryMessage[], seq: number, active?: { readonly turnID: number; readonly snapshot: WireLiveSnapshot } | null): State {
  const turns: Map<number, TurnRec> = new Map<number, TurnRec>();
  const legacy: LegacyLine[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m: WireHistoryMessage = messages[i];
    const turn: number = m.turnID !== undefined && m.turnID !== null ? m.turnID : 0;
    if (turn <= 0) {
      if (m.role === 'user') {
        legacy.push({
          id: m.id, role: 'user', content: m.content, blocks: [], timestamp: m.timestamp !== undefined ? m.timestamp : '',
          dbID: m.dbID,
        });
      } else {
        const blocks: Block[] = [];
        const its: readonly WireHistoryIteration[] = m.iterations === undefined ? [] : m.iterations;
        for (let k = 0; k < its.length; k++) {
          blocks.push(wireIterToBlock(its[k]));
        }
        legacy.push({
          id: m.id, role: 'assistant', content: m.content, blocks,
          timestamp: m.timestamp !== undefined ? m.timestamp : '', dbID: m.dbID,
          droppedBefore: m.droppedBefore, regionsBefore: m.regionsBefore,
        });
      }
      continue;
    }
    let rec: TurnRec | undefined = turns.get(turn);
    if (rec === undefined) {
      rec = newTurn(turn, null, null);
      turns.set(turn, rec);
    }
    if (m.role === 'user') {
      turns.set(turn, { ...rec, user: toUserLine(m) });
      continue;
    }
    // assistant：块追加（分片历史），终稿 = 最后一段
    const add: Block[] = [];
    const its: readonly WireHistoryIteration[] = m.iterations === undefined ? [] : m.iterations;
    for (let k = 0; k < its.length; k++) {
      add.push(wireIterToBlock(its[k]));
    }
    const blocks: Block[] = rec.blocks.length === 0 ? add : [...rec.blocks, ...add];
    // ⛔ **在跑的回合不能被水合成"已收尾"**：`active.turnID` 指向的那一轮仍在飞
    //   （该轮的历史 assistant 行只是"到目前为止的正文"）⇒ `final` 保持 null，
    //   由 `live`（来自 `active.snapshot`）继续驱动 typewriter / 工具 pill。
    //   真机对照实证：否则行 id 从 `turn-N-live` 变成 `turn-N`、`isLive` 1→0 ⇒ 界面空白。
    // ⛔ 判定"仍在跑"有两个来源（缺一不可，真机 `[diag]` 实证）：
    //   ① 本事件携带 `active.turnID`；② **本地已知在飞**（`prev.live.turn`，来自更早的
    //   `history_replaced`/`tick`）。后发的历史重载**不携带** `active`（`act=-1`），
    //   若只看 ①，就会把正在跑的回合重新定型成"已收尾" ⇒ live 行消失、界面空白。
    const running: boolean = (active !== undefined && active !== null && active.turnID === turn)
      || (prev.live !== null && prev.live.turn === turn);
    // 压缩点（turn 级，渲染成迭代之间的横线）
    const comps: Compaction[] = [];
    if (m.compactions !== undefined) {
      for (let i = 0; i < m.compactions.length; i++) {
        const hc = m.compactions[i];
        const after: number = hc.after_iteration === undefined ? 0 : hc.after_iteration;
        const text: string = hc.content === undefined ? '' : hc.content;
        comps.push({ afterIteration: after, content: text });
      }
    }
    turns.set(turn, {
      ...rec,
      blocks,
      compactions: comps.length > 0 ? comps : rec.compactions,
      final: running ? null : { content: m.content, cancelled: false },
      streaming: running,
      phase: running ? 'tool_exec' : 'done',
      droppedBefore: m.droppedBefore !== undefined ? m.droppedBefore : rec.droppedBefore,
      regionsBefore: m.regionsBefore !== undefined ? m.regionsBefore : rec.regionsBefore,
    });
  }
  // ⛔ **在飞态必须从 `active` 恢复**（老管线同源）：`history_replaced` 的 `active.snapshot`
  //   是"这一轮正在跑"的权威快照；不恢复 ⇒ 打字机/工具 pill/迭代进度在打开会话时消失
  //   （真机 `[MODEL-DIFF]` 直接钓出：`live=1→0`、`iter=288→0`）。
  let live: LiveIter | null = prev.live;
  if (active !== undefined && active !== null) {
    const snap: WireLiveSnapshot = active.snapshot;
    const tools: ToolRec[] = [];
    const push = (list: readonly WireHistoryTool[] | undefined): void => {
      if (list === undefined) return;
      for (let i = 0; i < list.length; i++) {
        const t = toToolRecOf(list[i], snap.iter, tools.length);
        let dup = false;
        for (let k = 0; k < tools.length; k++) {
          if (tools[k].call === t.call) { dup = true; break; }
        }
        if (!dup) tools.push(t);
      }
    };
    push(snap.streamingTools);
    push(snap.activeTools);
    push(snap.completedTools);
    live = {
      turn: active.turnID,
      iteration: snap.iter,
      content: snap.content !== undefined ? snap.content : '',
      reasoning: snap.reasoning !== undefined ? snap.reasoning : '',
      tools,
      genui: snap.genui !== undefined ? snap.genui : '',
    };
  }
  // ⛔ **在飞回合不能被"迟到的空/滞后历史"抹掉**：历史重载是权威，但它只描述**已落库**的行；
  //   正在跑的回合还没落库（服务端 `history` 里没有它）⇒ 若整表替换后 `live.turn` 不在
  //   `turns` 里，模型就有一条指向空气的 live（投影遍历 `turns` ⇒ 无行 ⇒ 页面"正文全没了"）。
  //   修法：把上一帧的那一轮**原样保留**（它的块/live 由 tick 继续驱动），仅当历史确实包含该
  //   回合时才以历史为准。
  // ⛔ **历史滞后不得丢刚收尾的回合**：`/api/history` 可能还没落库刚结束的 turn（服务端写入延迟，
  //   或本端先收到 `text_final`）。整表替换会把用户刚看到的消息**抹掉**（判据 `user_row_integrity`
  //   「历史合并后仍恰 1 条 user 行」）。判据只用**回合号**（历史里最大的 turn）——不比内容。
  let maxHistoryTurn: number = 0;
  turns.forEach((_t, id) => {
    if (id > maxHistoryTurn) maxHistoryTurn = id;
  });
  prev.turns.forEach((t, id) => {
    if (t.final !== null && id > maxHistoryTurn) {
      turns.set(id, t);
    }
  });
  if (live !== null && !turns.has(live.turn)) {
    const kept: TurnRec | undefined = prev.turns.get(live.turn);
    if (kept !== undefined) {
      turns.set(live.turn, kept.final === null ? kept : { ...kept, final: null, phase: 'tool_exec', streaming: true });
    }
  }
  return { ...prev, seq, turns, legacy, live };
}
