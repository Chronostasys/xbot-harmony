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
import { mergeToolLists } from './model_step';

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
/**
 * 快照块与**本地已知块/在飞工具**的合并：正文/思考以快照为准，**工具 meta 逐字段补**。
 *
 * ⛔ 用户 2026-10-28 P0「新的 toolcall 只要从 busy 变成 idle 就无法看详情」：
 *   idle 边沿会触发一次权威历史重载（`loadHistory` → `history_replaced` → 本函数），而
 *   历史载荷里的工具是**轻字段**（DB 只存 name/label/status）⇒ 旧实现整表替换 ⇒ 在飞时
 *   已经拿到（或刚经 `/api/iteration_detail` 补全）的 `args/detail` **在 idle 那一刻被抹掉**。
 *   web 的 `mergeIterations`（`normalize.ts:535`）明确「轻字段永不覆盖完整数据」⇒ 这里同源。
 *   ⛔ 只补工具 meta；**内容/迭代集合仍以快照为权威**（不打补丁，见下方 296-302 的纪律）。
 */
function mergeSnapshotBlock(prev: State, turn: number, block: Block): Block {
  const t: TurnRec | undefined = prev.turns.get(turn);
  let tools: readonly ToolRec[] = block.tools;
  if (t !== undefined) {
    for (let i = 0; i < t.blocks.length; i++) {
      if (t.blocks[i].iteration === block.iteration) {
        tools = mergeToolLists(t.blocks[i].tools, tools);
        break;
      }
    }
  }
  // 在飞工具按**自带迭代号**过滤（不要求 `live.iteration === block.iteration`：同一帧里
  // "上一迭代完成 + 推进到下一迭代"时，上一迭代的 rich 工具仍留在 `live.tools` 里）。
  const l: LiveIter | null = prev.live;
  if (l !== null && l.turn === turn && l.tools.length > 0) {
    const fromLive: ToolRec[] = [];
    for (let i = 0; i < l.tools.length; i++) {
      if (l.tools[i].iteration === block.iteration) {
        fromLive.push(l.tools[i]);
      }
    }
    if (fromLive.length > 0) {
      tools = mergeToolLists(fromLive, tools);
    }
  }
  return tools === block.tools ? block : { ...block, tools };
}

/** 块的"信息量"（正文/思考/工具/子代理；用于两份同号块取更完整者）。 */
function hydBlockWeight(b: Block): number {
  const c: string = b.content !== undefined && b.content !== null ? b.content : '';
  const r: string = b.reasoning !== undefined && b.reasoning !== null ? b.reasoning : '';
  const t: readonly ToolRec[] = b.tools !== undefined && b.tools !== null ? b.tools : [];
  const s = b.subAgents !== undefined && b.subAgents !== null ? b.subAgents : [];
  return c.length + r.length + t.length * 8 + s.length * 8;
}

function blockText(b: Block): string {
  const c: string = b.content !== undefined && b.content !== null ? b.content : '';
  const r: string = b.reasoning !== undefined && b.reasoning !== null ? b.reasoning : '';
  return `${c}\u0000${r}`;
}

/**
 * 把 `bs` 里的块按迭代号并进 `into`（**取更完整的那一份**，逐字相同时保留原对象）。
 * 只用于"两套回合号描述同一段历史"的合并（⛔ 不是通用 upsert）。
 */
function upsertBlocks(into: readonly Block[], add: readonly Block[]): Block[] {
  const byIter: Map<number, Block> = new Map<number, Block>();
  const order: number[] = [];
  for (let i = 0; i < into.length; i++) {
    const b: Block = into[i];
    if (byIter.get(b.iteration) === undefined) order.push(b.iteration);
    const prev: Block | undefined = byIter.get(b.iteration);
    byIter.set(b.iteration, prev === undefined || hydBlockWeight(b) >= hydBlockWeight(prev) ? b : prev);
  }
  for (let i = 0; i < add.length; i++) {
    const b: Block = add[i];
    const prev: Block | undefined = byIter.get(b.iteration);
    if (prev === undefined) {
      order.push(b.iteration);
      byIter.set(b.iteration, b);
    } else {
      byIter.set(b.iteration, hydBlockWeight(b) > hydBlockWeight(prev) ? b : prev);
    }
  }
  order.sort((a: number, b: number): number => a - b);
  const out: Block[] = [];
  for (let i = 0; i < order.length; i++) {
    const b = byIter.get(order[i]);
    if (b !== undefined) out.push(b);
  }
  return out;
}

/**
 * ⛔ **平行回合集去重**（用户 2026-11-14 P0「子代理的 shell 转后台之后，该迭代被重复渲染」，
 *   截图为同一个「思考 N 字」出现两遍，逐字相同）。
 *
 * 根因：一段子代理历史有**两套回合号** —— `/api/history` 的 DB 回合（如 1127）与
 *   `get_agent_session_dump` 派生出来的本地回合（`parseSubAgentMessages` 的 `turnSeq` = 1..N）。
 *   `hydrate` 以 `prev.turns` 为底**合并**（不是替换）⇒ 两套回合并存 ⇒ 同一条迭代被投影成
 *   **两行**（两套回合各一份）。这不是"数据重复"，而是**同一回合的两套 id**。
 *
 * 判据（严格，宁可漏合并也不误合）：两个回合的块按迭代号**逐字相同**（正文与思考都相同，
 *   `\u0000` 拼接后逐字节比较）且至少一块有正文/思考；允许一个是另一个的子集（一边多几块）。
 *   合并时：有 user 行的那一份当宿主（user 行不丢），块按号取更完整者，`final` 取非空者。
 */
/**
 * 是否**子代理会话**（`agent:<parent>` 或 `<channel>:<parent>/<role>:<instance>` 形状）。
 *
 * ⛔ 与 `model_step.isSubChat` 同源（不能互相 import：两边都是 `.ts`，而真正的解析在 `.ets`）——
 *   这里只需要"是不是子代理"，用于把**平行回合集去重**限制在子代理会话内。
 */
export function isSubChatKey(chat: string): boolean {
  if (chat === undefined || chat === null) return false;
  if (chat.indexOf('agent:') === 0) return true;
  const slash: number = chat.lastIndexOf('/');
  if (slash <= 0 || slash === chat.length - 1) return false;
  const parent: string = chat.substring(0, slash);
  const roleInstance: string = chat.substring(slash + 1);
  const channelSep: number = parent.indexOf(':');
  const roleSep: number = roleInstance.lastIndexOf(':');
  return channelSep > 0 && channelSep < parent.length - 1
    && roleSep > 0 && roleSep < roleInstance.length - 1;
}

function sameTurnHistory(a: readonly Block[], b: readonly Block[]): boolean {
  const aMap: Map<number, string> = new Map<number, string>();
  const bMap: Map<number, string> = new Map<number, string>();
  for (let i = 0; i < a.length; i++) {
    const txt: string = blockText(a[i]);
    if (txt !== '\u0000') aMap.set(a[i].iteration, txt);
  }
  for (let i = 0; i < b.length; i++) {
    const txt: string = blockText(b[i]);
    if (txt !== '\u0000') bMap.set(b[i].iteration, txt);
  }
  if (aMap.size === 0 || bMap.size === 0) return false;
  const small: Map<number, string> = aMap.size <= bMap.size ? aMap : bMap;
  const large: Map<number, string> = aMap.size <= bMap.size ? bMap : aMap;
  let matched = 0;
  let same = true;
  small.forEach((txt: string, iter: number): void => {
    const other: string | undefined = large.get(iter);
    if (other === undefined || other !== txt) {
      same = false;
    } else {
      matched++;
    }
  });
  return same && matched > 0;
}

function dedupeParallelTurns(turns: Map<number, TurnRec>): Map<number, TurnRec> {
  let cur: Map<number, TurnRec> = turns;
  let changed: boolean = true;
  let guard: number = 0;
  while (changed && guard < 20) {
    changed = false;
    guard++;
    const ids: number[] = [];
    cur.forEach((_t: TurnRec, id: number): void => { ids.push(id); });
    for (let i = 0; i < ids.length && !changed; i++) {
      for (let k = i + 1; k < ids.length && !changed; k++) {
        const a: TurnRec | undefined = cur.get(ids[i]);
        const b: TurnRec | undefined = cur.get(ids[k]);
        if (a === undefined || b === undefined) continue;
        const ab: readonly Block[] = a.blocks !== undefined && a.blocks !== null ? a.blocks : [];
        const bb: readonly Block[] = b.blocks !== undefined && b.blocks !== null ? b.blocks : [];
        if (!sameTurnHistory(ab, bb)) continue;
        const host: TurnRec = a.user !== null ? a : (b.user !== null ? b : (ab.length >= bb.length ? a : b));
        const other: TurnRec = host.id === a.id ? b : a;
        const merged: TurnRec = {
          ...host,
          blocks: upsertBlocks(host.blocks !== undefined && host.blocks !== null ? host.blocks : [],
            other.blocks !== undefined && other.blocks !== null ? other.blocks : []),
          final: host.final !== null ? host.final : other.final,
          streaming: host.streaming || other.streaming,
          user: host.user !== null ? host.user : other.user,
        };
        const next: Map<number, TurnRec> = new Map<number, TurnRec>(cur);
        next.set(host.id, merged);
        next.delete(other.id);
        console.info(`[TURN-MERGE] ${other.id}->${host.id} blocks=${merged.blocks.length}`);
        cur = next;
        changed = true;
      }
    }
  }
  return cur;
}

export function hydrate(prev: State, messages: readonly WireHistoryMessage[], seq: number, active?: { readonly turnID: number; readonly snapshot: WireLiveSnapshot } | null): State {
  // ⛔ **回合级合并，不是整表替换**（用户 2026-10-28 P-1：「别的端看得到的消息我们看不到；
  //   甚至所有消息都消失 / 一个完整 turn 消失」）。
  //   `/api/history` 是**窗口化**的（默认 100 条 + 上拉分页），快照里没有的回合 = **在窗口之外**，
  //   不等于被删除。旧实现 `new Map()` 从零重建 ⇒ 每次窗口快照都会把窗口外的回合**删掉**
  //   （所有消息消失）；同一回合的快照块数少时也会丢块（turn 半截消失）。
  //   ⇒ 以 `prev.turns` 为底：快照里出现的回合**更新**（块按迭代 upsert，见下），
  //     快照里没有的回合**保留**。唯一权威真相仍是服务端：它给了什么就更新什么。
  let turns: Map<number, TurnRec> = new Map<number, TurnRec>(prev.turns);
  const legacy: LegacyLine[] = [];
  // ⛔ **单调性证据**：快照里出现的最大回合号。若它**大于** `prev.live.turn`，说明服务端
  //   早已进入更新的一轮 ⇒ 本地记忆里的"在飞"**必然已结束**（用户 2026-10-22：重新连接时
  //   历史推进到下一个 turn ⇒ 旧轮被复活成 running、新轮不流式的 bug 的根因）。
  //   ⛔ 只用结构（回合号单调），不比内容、不看时间。
  let maxSnapTurn: number = 0;
  for (let i = 0; i < messages.length; i++) {
    const t: number = messages[i].turnID !== undefined && messages[i].turnID !== null
      ? messages[i].turnID as number : 0;
    if (t > maxSnapTurn) {
      maxSnapTurn = t;
    }
  }
  const liveOvertaken: boolean = prev.live !== null && maxSnapTurn > prev.live.turn;
  // ⛔ **无回合号的 user 消息**（用户 2026-11-18 冷启动 P0：重启后 user 气泡跑到最上面/丢失，
  //   切一次会话又正常）：DB 里 user 行可能没有 `turnID`（0），而它后面紧跟的 assistant 消息**有**。
  //   旧实现把这类 user 直接塞进 `legacy`（渲染在**最顶部**）⇒ 视觉上"回复上面没有提问、整段错位"，
  //   而切会话走的是另一条装配路径（回合内配对）所以看起来正常。
  //   ⇒ 先在本地**暂存**，遇到下一个带号 assistant 回合时认领为它的 `user`；
  //   到最后仍无人认领的（真正的独立消息 / 通知）才落 `legacy`（保持原语义）。
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
    // ⛔ **单一归属**（用户 2026-10-28：「重连后红框里又重复了」）：
    //   重连 = `history_replaced` → 本函数**按快照重建**块；快照里同样可能有残留副本
    //   （同一 call 出现在两个迭代）或与已提交块重复 ⇒ 必须与 `model_step` 同一不变量：
    //   ① 块内只留 `tool.iteration >= block.iteration`；② 该 call 不得已被本 turn 里
    //   **其它块**占用（本轮已存在的块 + 本批先前块）。否则同一枚 pill 会在两个容器各画一次。
    for (let k = 0; k < its.length; k++) {
      // ⛔ 见 `mergeSnapshotBlock`：快照里的工具是轻字段，必须与本地已知（块/在飞）逐字段合并，
      //   否则 idle 边沿的这次重载会把 busy 期间拿到的 args/detail 抹掉。
      // ⛔ **不在这里删工具**（用户 2026-10-28：「不是渲染重复了，是渲染丢了，tool 不见了」）：
      //   按 call/内容删会误杀"服务端补写/重排"的真工具。模型层只做**upsert 去重迭代**，
      //   工具重复一律留给渲染层（`MessageRow` 跨容器 + `groupShownPills` 组内）。
      add.push(mergeSnapshotBlock(prev, turn, wireIterToBlock(its[k])));
    }
    // ⛔ **同一迭代只许一块**（用户 2026-10-28 P0「连续思考」：思考 25/38/50 字三条叠着）。
    //   历史里同一条回合可能有多行 assistant 快照（或重连重放），每行都带同一个 `iteration`
    //   ⇒ 旧实现 `[...rec.blocks, ...add]` 直接**追加** ⇒ 同一迭代被画成多条思考行
    //   （字数递增 = 不同时刻的快照）。⇒ 按 `iteration` upsert：后到者覆盖正文/思考
    //   （取非空的新值），工具仍逐字段合并（`mergeToolLists`，不倒退）。
    // ⛔ 宽进：`prev.turns` 里的 TurnRec 可能来自别的路径（`send`/`open`），`blocks` 未必是数组
    //   ⇒ 统一当空表（否则回合级合并会在"已有旧回合"时抛，整条历史渲染中断）。
    const prevBlocks: readonly Block[] = rec.blocks !== undefined && rec.blocks !== null ? rec.blocks : [];
    const blocks: Block[] = prevBlocks.length === 0 ? [] : [...prevBlocks];
    for (let i = 0; i < add.length; i++) {
      const inc: Block = add[i];
      let hit: number = -1;
      for (let k = 0; k < blocks.length; k++) {
        if (blocks[k].iteration === inc.iteration) {
          hit = k;
          break;
        }
      }
      if (hit < 0) {
        blocks.push(inc);
        continue;
      }
      const prevB: Block = blocks[hit];
      blocks[hit] = {
        iteration: inc.iteration,
        // 后到者优先；为空则保留旧值（快照可能逆序/截断）
        content: inc.content.length > 0 ? inc.content : prevB.content,
        reasoning: inc.reasoning.length > 0 ? inc.reasoning : prevB.reasoning,
        tools: mergeToolLists(prevB.tools, inc.tools),
        subAgents: inc.subAgents.length > 0 ? inc.subAgents : prevB.subAgents,
        genui: inc.genui.length > 0 ? inc.genui : prevB.genui,
        cancelled: prevB.cancelled || inc.cancelled,
      };
    }
    // ⛔ **在跑的回合不能被水合成"已收尾"**：`active.turnID` 指向的那一轮仍在飞
    //   （该轮的历史 assistant 行只是"到目前为止的正文"）⇒ `final` 保持 null，
    //   由 `live`（来自 `active.snapshot`）继续驱动 typewriter / 工具 pill。
    //   真机对照实证：否则行 id 从 `turn-N-live` 变成 `turn-N`、`isLive` 1→0 ⇒ 界面空白。
    // ⛔ 判定"仍在跑"有两个来源（缺一不可，真机 `[diag]` 实证）：
    //   ① 本事件携带 `active.turnID`；② **本地已知在飞**（`prev.live.turn`，来自更早的
    //   `history_replaced`/`tick`）。后发的历史重载**不携带** `active`（`act=-1`），
    //   若只看 ①，就会把正在跑的回合重新定型成"已收尾" ⇒ live 行消失、界面空白。
    // ⛔ **但 ② 必须带单调性闸门**（2026-10-22 用户亲报「重新连接时历史推进到下一个 turn
    //   有 bug」的根因）：快照里已经出现**比 `prev.live.turn` 更大的回合**时，那一轮
    //   在服务端**必然已结束**。旧实现无条件信 ② ⇒ 断线/切后台期间跑完的旧轮被复活成
    //   `running`（`final=null` / `streaming=true` / `phase='tool_exec'`），`live` 也仍指向它
    //   ⇒ 表现：**旧轮一直转、新轮（已到）不流式**，直到下一次权威快照才可能自愈。
    const running: boolean = (active !== undefined && active !== null && active.turnID === turn)
      || (prev.live !== null && prev.live.turn === turn && !liveOvertaken);
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
  // ⛔ **在飞态必须从  恢复**（老管线同源）：`history_replaced` 的 `active.snapshot`
  //   是"这一轮正在跑"的权威快照；不恢复 ⇒ 打字机/工具 pill/迭代进度在打开会话时消失
  //   （真机 `[MODEL-DIFF]` 直接钓出：`live=1→0`、`iter=288→0`）。
  // ⛔ 被越过的在飞记忆必须**作废**（同上单调性）：否则行仍是 `turn-N-live`（isLive），
  //   页面把它当"在飞尾项"渲染，而新的那一轮反而不流式（用户 2026-10-22 现场）。
  let live: LiveIter | null = liveOvertaken ? null : prev.live;
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
    // 在飞快照同样是轻/全混合 ⇒ 与本地已知的同一 iter 工具逐字段合并（详情不倒退）。
    const prevLiveTools: readonly ToolRec[] = prev.live !== null && prev.live.turn === active.turnID
      && prev.live.iteration === snap.iter ? prev.live.tools : [];
    const mergedTools: readonly ToolRec[] = prevLiveTools.length > 0
      ? (mergeToolLists(prevLiveTools, tools) as ToolRec[]) : tools;
    // ⛔ 与 `model_step.onlyOwnIterTools` 同一不变量：在飞列表只许**本迭代**的工具
    //   （快照里的陈旧条目 / 残留副本带旧迭代号 ⇒ 会与已提交块重复渲染）。
    const ownTools: ToolRec[] = [];
    for (let i = 0; i < mergedTools.length; i++) {
      if (mergedTools[i].iteration === snap.iter) {
        ownTools.push(mergedTools[i]);
      }
    }
    live = {
      turn: active.turnID,
      iteration: snap.iter,
      content: snap.content !== undefined ? snap.content : '',
      reasoning: snap.reasoning !== undefined ? snap.reasoning : '',
      tools: ownTools,
      genui: snap.genui !== undefined ? snap.genui : '',
    };
  }
  // ⛔ **历史是权威替换**（不是合并）：本函数只负责"这份快照描述的状态"。
  //   「快照是否过时」由**调用方**用单调性判据拒绝（`model_bridge.isStaleSnapshot`：
  //   回合不丢、同回合块数不减 —— append-only 不变量），**不在这里做内容/回合合并**
  //   （那类 merge 是补丁，会让状态与权威分叉：用户 2026-10-22「不要打补丁，确保状态对」）。
  //
  //   唯一保留项：**正在飞的回合**。它尚未落库 ⇒ 快照里必然没有它 ⇒ 整表替换会让
  //   投影遍历时找不到 live 指向的回合（页面「正文全没了」）。
  if (live !== null && !turns.has(live.turn)) {
    const kept: TurnRec | undefined = prev.turns.get(live.turn);
    if (kept !== undefined) {
      turns.set(live.turn, kept.final === null ? kept : { ...kept, final: null, phase: 'tool_exec', streaming: true });
    }
  }
  // ⛔ **平行回合集去重**（用户 2026-11-14 P0「子代理的 shell 转后台之后，该迭代被重复渲染」）：
  //   同一段历史会有**两套回合号**：`/api/history` 的 DB 回合（如 1127）、`get_agent_session_dump`
  //   派生出来的本地回合（1..N，`parseSubAgentMessages` 的 `turnSeq`）。而 `hydrate` 以
  //   `prev.turns` 为底**合并**（不是替换）⇒ 两套回合并存 ⇒ 同一条迭代被投影成**两行**
  //   （逐字相同的「思考 N 字」两份），用户看到的就是"重复渲染"。
  //   ⇒ 判据：两个回合的块**按迭代号逐字相同**（或一个是另一个的子集）且至少一块有正文/思考
  //   ⇒ 判为同一回合，合并成一份（块按号取更完整者；有 user 行的那一份当宿主，user 行不丢）。
  // ⛔ **只在子代理会话**做平行回合集去重（用户 2026-11-18 冷启动 P0：普通会话被误合并 ⇒ 消息错乱）。
  //   普通会话里"两轮正文恰好相同"完全合法（用户连发两次「继续」），而且只有一个回合号体系——
  //   任何内容级合并都会**吞掉一整轮**。⇒ 去重只服务于子代理（dump 1..N vs DB/SSE 两套号）。
  const deduped: Map<number, TurnRec> = isSubChatKey(prev.chat as string)
    ? dedupeParallelTurns(turns) : turns;
  turns = deduped;
  if (live !== null && !turns.has(live.turn)) {
    const kept2: TurnRec | undefined = prev.turns.get(live.turn);
    if (kept2 !== undefined) {
      turns.set(live.turn, kept2.final === null ? kept2 : { ...kept2, final: null, phase: 'tool_exec', streaming: true });
    }
  }
  // ⛔ **前沿唯一**（用户 2026-10-28 P0「思考后有思考中」）：`live` 指向的迭代若**已经在块里**
  //   （或比块最大号更旧），它就是一个"已提交迭代的在飞副本" ⇒ 同一迭代会被画两遍
  //   （块里「思考 29 字」+ 尾部「思考中…」）。⇒ 直接清 live，由块自己渲染。
  if (live !== null) {
    const rec: TurnRec | undefined = turns.get(live.turn);
    if (rec !== undefined) {
      // ⛔ 宽进：`prev.turns` 的块可能来自别的构造路径（字段可能缺省）⇒ 一律按空串处理。
      const liveBlocks: readonly Block[] = rec.blocks !== undefined && rec.blocks !== null ? rec.blocks : [];
      for (let i = 0; i < liveBlocks.length; i++) {
        const b: Block = liveBlocks[i];
        // ⛔ 只在"该迭代已经有**实质内容**的块"时才清 live：空壳块（cancel/边界快照）
        //   并不代表内容已经渲染过 —— 清掉会让 cancel 期间的正文整段闪没
        //   （`hydrate_liveness ③` 当场钓出）。实质内容 = 正文/思考/工具/子代理任一非空。
        const bc: string = b.content !== undefined && b.content !== null ? b.content : '';
        const br: string = b.reasoning !== undefined && b.reasoning !== null ? b.reasoning : '';
        const btools: readonly ToolRec[] = b.tools !== undefined && b.tools !== null ? b.tools : [];
        const bsub = b.subAgents !== undefined && b.subAgents !== null ? b.subAgents : [];
        const real: boolean = bc.length > 0 || br.length > 0 || btools.length > 0 || bsub.length > 0;
        if (b.iteration === live.iteration && real) {
          live = null;
          break;
        }
        if (b.iteration > live.iteration && real) {
          // 更新迭代已落地且**有内容** ⇒ 这个 live 已经落后（前沿唯一）
          live = null;
          break;
        }
      }
    }
  }
  // ⛔ **跨回合兜底（前沿唯一）**（用户 2026-11-14 P0「子代理的 shell 转后台之后，该迭代被
  //   重复渲染」）：上面只查了 `live.turn` 这一个回合。子代理会话里 `active.turnID`（服务端在飞
  //   回合）与快照块所属回合**可能不是同一个**（dump 派生回合 vs SSE 回合）⇒ 同一条迭代在
  //   A 回合已提交成块、live 却指向 B 回合 ⇒ 投影出**两行**（各一份，逐字相同）。
  //   判据：**逐字相同**（正文/思考任一非空且与被比较块相等，其余维度为空或不比较）+ 同号迭代
  //   ⇒ 判为同一迭代的副本 ⇒ 清 live（块是权威）。text 不同则保留（可能是真的新迭代）。
  if (live !== null) {
    const lc: string = live.content !== undefined && live.content !== null ? live.content : '';
    const lr: string = live.reasoning !== undefined && live.reasoning !== null ? live.reasoning : '';
    const liveIter: number = live.iteration;
    if (lc.length > 0 || lr.length > 0) {
      const found: { v: boolean } = { v: false };
      turns.forEach((rec2: TurnRec): void => {
        if (found.v) return;
        const bs: readonly Block[] = rec2.blocks !== undefined && rec2.blocks !== null ? rec2.blocks : [];
        for (let i = 0; i < bs.length; i++) {
          const b: Block = bs[i];
          if (b.iteration !== liveIter) continue;
          const bc: string = b.content !== undefined && b.content !== null ? b.content : '';
          const br: string = b.reasoning !== undefined && b.reasoning !== null ? b.reasoning : '';
          const sameC: boolean = lc.length === 0 || bc === lc;
          const sameR: boolean = lr.length === 0 || br === lr;
          if (sameC && sameR) {
            found.v = true;
            return;
          }
        }
      });
      if (found.v) {
        live = null;
      }
    }
  }
  return { ...prev, seq, turns, legacy, live };
}
