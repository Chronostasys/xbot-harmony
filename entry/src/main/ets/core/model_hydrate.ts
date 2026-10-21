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
import type { Block, LegacyLine, LiveIter, State, ToolRec, TurnRec, UserLine } from './model_types';
import { newTurn } from './model_types';

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
}

export interface WireHistoryIteration {
  readonly iteration: number;
  readonly content?: string;
  readonly reasoning?: string;
  readonly tools?: readonly WireHistoryTool[];
  readonly genui?: string;
  readonly subAgents?: readonly never[];
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

function statusOf(s: string | undefined): 'generating' | 'pending' | 'running' | 'done' | 'failed' {
  if (s === 'done' || s === 'error') return 'done';
  if (s === 'failed') return 'failed';
  if (s === 'running') return 'running';
  if (s === 'generating') return 'generating';
  return 'pending';
}

function toToolRecOf(t: WireHistoryTool, iteration: number, idx: number): ToolRec {
  const rawCall: string | undefined = t.call_id !== undefined && t.call_id !== ''
    ? t.call_id : (t.callID !== undefined && t.callID !== '' ? t.callID : undefined);
  return {
    call: rawCall !== undefined ? rawCall : `${iteration}#${idx}`,
    iteration,
    meta: { name: t.name, uiMode: t.ui_mode, args: t.args, detail: t.detail, summary: t.summary, toolHints: t.tool_hints },
    state: {
      status: statusOf(t.status),
      label: t.label !== undefined ? t.label : t.name,
      genChars: t.gen_chars !== undefined ? t.gen_chars : 0,
      elapsedMs: t.elapsed_ms !== undefined ? t.elapsed_ms : 0,
    },
  };
}

function toBlock(w: WireHistoryIteration): Block {
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
        status: statusOf(t.status),
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
    subAgents: [],
    genui: w.genui !== undefined ? w.genui : '',
    cancelled: false,
  };
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
          blocks.push(toBlock(its[k]));
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
      add.push(toBlock(its[k]));
    }
    const blocks: Block[] = rec.blocks.length === 0 ? add : [...rec.blocks, ...add];
    const lastIter: number = blocks.length === 0 ? 0 : blocks[blocks.length - 1].iteration;
    turns.set(turn, {
      ...rec,
      blocks,
      final: { content: m.content, cancelled: false },
      streaming: false,
      phase: 'done',
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
  return { ...prev, seq, turns, legacy, live };
}
