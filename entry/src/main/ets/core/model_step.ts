/**
 * core/model/step.ts —— 会话状态机的**唯一转移函数**（纯 TS，⛔ 无 ArkUI/无 `.ets` import）。
 *
 * `step(S, f) → { state, effects }`
 *   · **总函数**：任何输入都有定义（守卫 + 六个构造子穷尽）；
 *   · **纯**：无时钟/无随机/无全局可变状态（`ts` 由调用方传入）；
 *   · **唯一外行为**：需要读权威时**只产出 effect**（`pullIter`/`pullTurn`/`snapshot`），
 *     由驱动层执行后以帧形式回灌 —— 客户端**从不**在本地重建内容。
 *
 * 不变量（`docs/STATE-MODEL.md` §4）：
 *   T2 幂等：`seq ≤ S.seq` ⇒ 状态不变（被跳过的号后到也走这一条）；
 *   T3 工具恰好一次：工具只存在于 `live.tools`（未提交）或某个 `block.tools`（已提交），二者互斥；
 *   T4 提交不可回退：`blocks` 只追加，或由 `final.blocks` 整体替换（权威）；
 *   T5 良构：(a) 块号严格递增；(b) `live.iteration > 最后已提交块号`；(c) 块内工具号 == 块号；
 *   T7 全函数：违反前置 ⇒ 丢弃（已过时）或拉权威（缺口），**不猜测**。
 */
import type {
  AckIntent, Block, ChatID, DoneFrame, Effect, FailIntent, FinalFrame, Frame, IterNum, KeepaliveFrame,
  LiveIter, OpenFrame, SendIntent, SessionFrame, State, StepResult, TickFrame, ToolMeta, ToolRec, ToolStatus,
  Seq, ToolTick, TurnID, TurnRec, UserLine, TextPatch,
} from './model_types';
import { newTurn } from './model_types';

// ─── 小工具（纯函数）─────────────────────────────────────────

const EMPTY_BLOCKS: readonly Block[] = [];
const EMPTY_TOOLS: readonly ToolRec[] = [];

/** 已提交块的最大号（0 = 还没有块）。 */
export function lastBlockIter(t: TurnRec): number {
  return t.blocks.length === 0 ? 0 : t.blocks[t.blocks.length - 1].iteration;
}

/** 工具号盖章（T5-c）：块内工具恒带块号；这是"恰好一次"判据能成立的前提。 */
function stampTools(tools: readonly ToolRec[], iteration: IterNum): readonly ToolRec[] {
  let changed = false;
  const out: ToolRec[] = [];
  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    if (t.iteration === iteration) {
      out.push(t);
    } else {
      out.push({ ...t, iteration });
      changed = true;
    }
  }
  return changed ? out : tools;
}

function stampBlock(b: Block): Block {
  const tools = stampTools(b.tools === undefined ? EMPTY_TOOLS : b.tools, b.iteration);
  return tools === b.tools ? b : { ...b, tools };
}

/** 应用文本补丁：`full` 覆盖；`delta` 要求锚接上（否则丢弃 ⇒ 返回 null，不拼接）。 */
export function applyText(cur: string, p: TextPatch | undefined): string | null {
  if (p === undefined) return cur;
  if (p.kind === 'full') return p.text;
  if (p.chunk.length === 0) return cur;
  if (p.base !== cur.length) return null;      // 锚不匹配 ⇒ DROP（由下一帧/权威修正）
  return cur + p.chunk;
}

/** 位置状态：`ticks` 是**当前迭代工具的全集**；meta 缺省时沿用已知（按 call 查）。 */
function applyToolTicks(prev: readonly ToolRec[], ticks: readonly ToolTick[],
  iteration: IterNum): readonly ToolRec[] {
  const byCall: Map<string, ToolRec> = new Map<string, ToolRec>();
  for (let i = 0; i < prev.length; i++) {
    byCall.set(prev[i].call, prev[i]);
  }
  const out: ToolRec[] = [];
  for (let i = 0; i < ticks.length; i++) {
    const tk = ticks[i];
    const known = byCall.get(tk.call);
    const meta: ToolMeta = tk.meta !== undefined ? tk.meta : (known !== undefined ? known.meta : { name: tk.call });
    out.push({ call: tk.call, iteration, meta, state: tk.state });
  }
  return out;
}

/** `live` 是否就是 (turn, iteration)。 */
function liveAt(s: State, turn: TurnID, iteration: IterNum): LiveIter | null {
  const l = s.live;
  return l !== null && l.turn === turn && l.iteration === iteration ? l : null;
}

/** 应用后的水位：无信封输入（`seq < 0`）不推进。 */
function seqAfter(s: State, f: Frame): Seq {
  return f.seq >= 0 ? f.seq : s.seq;
}

function withTurn(s: State, id: TurnID, patch: (t: TurnRec) => TurnRec): State {
  const cur = s.turns.get(id);
  if (cur === undefined) return s;
  const next = patch(cur);
  if (next === cur) return s;
  const turns = new Map<TurnID, TurnRec>(s.turns);
  turns.set(id, next);
  return { ...s, turns };
}

function pullRange(chat: ChatID, turn: TurnID, from: number, to: number): Effect[] {
  const out: Effect[] = [];
  for (let i = from; i <= to; i++) {
    out.push({ kind: 'pullIter', chat, turn, iteration: i });
  }
  return out;
}

/** 需要拉取的号（跳过权威已回答"不存在"的号 ⇒ ⛔ 不会对同一号无限补洞）。 */
function rangeOf(s: State, turn: TurnID, from: number, to: number): number[] {
  const abs = s.absent.get(turn);
  const out: number[] = [];
  for (let i = from; i <= to; i++) {
    if (abs === undefined || !abs.has(i)) out.push(i);
  }
  return out;
}

function missingEffects(chat: ChatID, turn: TurnID, list: readonly number[]): Effect[] {
  const out: Effect[] = [];
  for (let i = 0; i < list.length; i++) out.push({ kind: 'pullIter', chat, turn, iteration: list[i] });
  return out;
}

/**
 * **按序落账**：`pending` 缓冲里"接得上的"块依次追加；`absent` 里的号视为合法跳过。
 * ⛔ 只在这里改 `blocks`（除 `final` 的整体替换）⇒ 块序恒严格递增、永不出现洞。
 */
function drain(s: State, turn: TurnID): State {
  const t = s.turns.get(turn);
  if (t === undefined) return s;
  const buf = s.pending.get(turn);
  if (buf === undefined || buf.size === 0) return s;
  const abs = s.absent.get(turn);
  let blocks = t.blocks;
  let last = blocks.length === 0 ? 0 : blocks[blocks.length - 1].iteration;
  const rest = new Map<number, Block>();
  buf.forEach((v, k) => rest.set(k, v));
  let appended = false;
  for (;;) {
    const next = rest.get(last + 1);
    if (next !== undefined) {
      blocks = [...blocks, next];
      last = last + 1;
      rest.delete(last);
      appended = true;
      continue;
    }
    if (abs !== undefined && abs.has(last + 1)) { last = last + 1; continue; }
    break;
  }
  if (!appended) return s;
  const turns = new Map<TurnID, TurnRec>(s.turns);
  turns.set(turn, { ...t, blocks });
  const pending = new Map<TurnID, ReadonlyMap<IterNum, Block>>(s.pending);
  if (rest.size === 0) pending.delete(turn); else pending.set(turn, rest);
  const live = s.live !== null && s.live.turn === turn && s.live.iteration <= last ? null : s.live;
  return { ...s, turns, pending, live };
}

/** 驱动层拿到权威 `ABSENT` ⇒ 标记该号不存在（合法跳号），随后 drain。 */
function markAbsent(s: State, turn: TurnID, iteration: IterNum): State {
  const cur = s.absent.get(turn);
  const set = new Set<IterNum>();
  if (cur !== undefined) cur.forEach((v) => set.add(v));
  set.add(iteration);
  const absent = new Map<TurnID, ReadonlySet<IterNum>>(s.absent);
  absent.set(turn, set);
  return drain({ ...s, absent }, turn);
}

// ─── 守卫 ────────────────────────────────────────────────────

function envelope(s: State, f: Frame, sameEvent: boolean): { apply: boolean; effects: Effect[] } {
  if (f.chat !== s.chat) return { apply: false, effects: [] };            // 别的会话
  if (f.epoch !== s.epoch) return { apply: false, effects: [{ kind: 'snapshot', chat: s.chat }] };
  // ⛔ **同一个 wire 事件可以派生多帧**（`iteration` ⇒ tick + 多个 done）。它们共享同一个
  //   transport seq；若按"`seq ≤` 即重复"处理，除第一帧外全被丢 ⇒ 工具/块整批消失
  //   （`model_diff_prop` 随机差分钓出：末迭代工具丢失）。⇒ 同批（同 seq）放行。
  if (f.seq < 0) return { apply: true, effects: [] };                     // 无信封：不判新旧
  if (f.seq < s.seq) return { apply: false, effects: [] };                // 严格更旧 ⇒ 重复/后到
  if (f.seq === s.seq && !sameEvent) return { apply: false, effects: [] };
  // 跳号（f.seq > s.seq + 1）**照常应用并把水位推到最大** —— 不重放、不补帧。
  return { apply: true, effects: [] };
}

// ─── 构造子 ──────────────────────────────────────────────────

function onOpen(s: State, f: OpenFrame): StepResult {
  const cur = s.turns.get(f.turn);
  let next: State;
  if (cur !== undefined) {
    // ⛔ 幂等（§4 F-1）：只绑 user/requestID，**保留** blocks/final/phase（否则历史被清空）。
    const patched: TurnRec = { ...cur, user: f.user, requestID: f.requestID };
    const turns = new Map<TurnID, TurnRec>(s.turns);
    turns.set(f.turn, patched);
    next = { ...s, turns, live: null };
  } else {
    const turns = new Map<TurnID, TurnRec>(s.turns);
    turns.set(f.turn, newTurn(f.turn, f.user, f.requestID));
    next = { ...s, turns, live: null };
  }
  // 乐观行交给 turns（按 requestID 精确退役；⛔ 不做内容匹配）
  if (f.requestID !== null) {
    const pending = next.local.pending.filter((u) => u.requestID !== f.requestID && u.id !== f.user.id);
    if (pending.length !== next.local.pending.length) {
      next = { ...next, local: { pending } };
    }
  }
  return { state: { ...next, seq: seqAfter(s, f) }, effects: [] };
}

function onTick(s: State, f: TickFrame): StepResult {
  const t = s.turns.get(f.turn);
  if (t === undefined) {
    // 未知 turn（丢了 open）⇒ 取权威回合，不凭空造。
    return { state: { ...s, seq: seqAfter(s, f) }, effects: [{ kind: 'pullTurn', chat: s.chat, turn: f.turn }] };
  }
  const last = lastBlockIter(t);
  if (f.iteration <= last) {
    // 已提交迭代的迟到帧 ⇒ 丢弃（权威块已在，且 `done` 完备）
    return { state: { ...s, seq: seqAfter(s, f) }, effects: [] };
  }
  const missing: number[] = [];
  if (f.iteration > last + 1) {
    // ⛔ **绝不 commit 不完整迭代**，但**也不能放弃 SSE 进度**（用户口径）：
    //   缺口只触发 `pullIter`，**本帧照常应用**到 live（打字机/工具继续跑）；
    //   已完成的块由 `done` 进来后按序入账（`pending` 缓冲，见 `drain`）。
    missing.push(...rangeOf(s, f.turn, last + 1, f.iteration - 1));
  }
  const prevLive = liveAt(s, f.turn, f.iteration);
  const baseCur = prevLive !== null ? prevLive.content : '';
  const baseRea = prevLive !== null ? prevLive.reasoning : '';
  const content = applyText(baseCur, f.content);
  const reasoning = applyText(baseRea, f.reasoning);
  if (content === null || reasoning === null) {
    // 锚不匹配 ⇒ 丢弃本帧内容（不拼接、不清空）；其余字段照常（位置状态）
    const live0 = prevLive !== null ? prevLive : {
      turn: f.turn, iteration: f.iteration, content: baseCur, reasoning: baseRea, tools: EMPTY_TOOLS, genui: '',
    };
    return { state: { ...s, seq: seqAfter(s, f), live: live0 }, effects: missingEffects(s.chat, f.turn, missing) };
  }
  const prevTools = prevLive !== null ? prevLive.tools : EMPTY_TOOLS;
  const live: LiveIter = {
    turn: f.turn,
    iteration: f.iteration,
    content,
    reasoning,
    tools: applyToolTicks(prevTools, f.tools, f.iteration),
    genui: f.genui,
  };
  const turns = new Map<TurnID, TurnRec>(s.turns);
  turns.set(f.turn, {
    ...t,
    phase: f.phase,
    streaming: f.streaming,
    streamStats: f.stats !== undefined ? f.stats : t.streamStats,
    tokenUsage: f.usage !== undefined ? f.usage : t.tokenUsage,
  });
  return { state: { ...s, seq: seqAfter(s, f), turns, live }, effects: missingEffects(s.chat, f.turn, missing) };
}

function onDone(s: State, f: DoneFrame): StepResult {
  const t = s.turns.get(f.turn);
  if (t === undefined) {
    return { state: { ...s, seq: seqAfter(s, f) }, effects: [{ kind: 'pullTurn', chat: s.chat, turn: f.turn }] };
  }
  const last = lastBlockIter(t);
  if (f.block.iteration <= last) {
    return { state: { ...s, seq: seqAfter(s, f) }, effects: [] };       // 已提交/回退 ⇒ 丢弃
  }
  if (f.block.iteration > last + 1) {
    // ⛔ 缺口：本块**暂不入账**（绝不让 blocks 出现洞），进 `pending` 缓冲；
    //   同时拉缺失号。补到（或权威回答"不存在"）后由 `drain` 按序落地 ——
    //   ⛔ 不阻塞后续 SSE 帧（位置状态照常推进）。
    const buf = new Map<number, Block>();
    const prevBuf = s.pending.get(f.turn);
    if (prevBuf !== undefined) prevBuf.forEach((v, k) => buf.set(k, v));
    buf.set(f.block.iteration, stampBlock(f.block));
    const pending = new Map(s.pending);
    pending.set(f.turn, buf);
    const effects = pullRange(s.chat, f.turn, last + 1, f.block.iteration - 1);
    return { state: { ...s, seq: seqAfter(s, f), pending }, effects };
  }
  const block = stampBlock(f.block);
  const turns = new Map<TurnID, TurnRec>(s.turns);
  turns.set(f.turn, { ...t, blocks: [...t.blocks, block] });
  const live = liveAt(s, f.turn, block.iteration) !== null ? null : s.live;
  const applied = drain({ ...s, seq: seqAfter(s, f), turns, live }, f.turn);
  return { state: applied, effects: [] };
}

function onFinal(s: State, f: FinalFrame): StepResult {
  const t = s.turns.get(f.turn);
  if (t === undefined) {
    return { state: { ...s, seq: seqAfter(s, f) }, effects: [{ kind: 'pullTurn', chat: s.chat, turn: f.turn }] };
  }
  const effects: Effect[] = [];
  let blocks: readonly Block[] = t.blocks;
  if (f.blocks !== undefined) {
    // 整体替换（服务端权威；可能头部截断）—— 唯一允许的"回填"。
    // ⛔ **缺字段 = 未携带（P5）**：老 wire 的 `progressHistory` 元素可能省略 `tools`/`content`
    //   （后端 P4 完备性尚未上线）⇒ 同号块的"空工具/空正文"不得覆盖本地已有的值，
    //   否则提交瞬间工具/正文整批消失（`model_diff_prop` 判据当场钓出）。
    const prevByIter: Map<number, Block> = new Map<number, Block>();
    for (let i = 0; i < t.blocks.length; i++) {
      prevByIter.set(t.blocks[i].iteration, t.blocks[i]);
    }
    // ⛔ 还要查 `pending` 缓冲：缺口期间已到达但尚未入账的块也在"本地已有值"里
    //   （否则 `final` 用空工具的 progressHistory 覆盖它 ⇒ 提交瞬间工具消失）。
    const pend: ReadonlyMap<IterNum, Block> | undefined = s.pending.get(f.turn);
    if (pend !== undefined) {
      pend.forEach((v: Block, k: IterNum) => {
        if (!prevByIter.has(k)) {
          prevByIter.set(k, v);
        }
      });
    }
    const stamped: Block[] = [];
    for (let i = 0; i < f.blocks.length; i++) {
      const inc: Block = f.blocks[i];
      const prev: Block | undefined = prevByIter.get(inc.iteration);
      let merged: Block = inc;
      if (prev !== undefined) {
        const tools = inc.tools.length === 0 && prev.tools.length > 0 ? prev.tools : inc.tools;
        const content = inc.content.length === 0 && prev.content.length > 0 ? prev.content : inc.content;
        const reasoning = inc.reasoning.length === 0 && prev.reasoning.length > 0 ? prev.reasoning : inc.reasoning;
        merged = { ...inc, tools, content, reasoning };
      }
      stamped.push(stampBlock(merged));
    }
    blocks = stamped;
  } else {
    // 完备性：`final` 必须覆盖**所有**已开始的迭代（`live` 的那一轮也算已开始）
    const liveIter = s.live !== null && s.live.turn === f.turn ? s.live.iteration : 0;
    const last = blocks.length === 0 ? 0 : blocks[blocks.length - 1].iteration;
    const maxSeen = Math.max(last, liveIter);
    if (last < maxSeen) {
      effects.push(...pullRange(s.chat, f.turn, last + 1, maxSeen));
    }
  }
  const turns = new Map<TurnID, TurnRec>(s.turns);
  turns.set(f.turn, {
    ...t,
    blocks,
    final: { content: f.content, cancelled: f.cancelled },
    phase: f.phase,
    streaming: false,
    droppedBefore: f.droppedBefore !== undefined ? f.droppedBefore : t.droppedBefore,
  });
  const live = s.live !== null && s.live.turn === f.turn ? null : s.live;
  const applied = drain({ ...s, seq: seqAfter(s, f), turns, live }, f.turn);
  return { state: applied, effects };
}

function onSession(s: State, f: SessionFrame): StepResult {
  const sess = s.sess;
  const next = {
    running: f.running !== undefined ? f.running : sess.running,
    todos: f.todos !== undefined ? f.todos : sess.todos,
    goal: f.goal === undefined ? sess.goal : (f.goal === null ? { kind: 'cleared' as const } : { kind: 'value' as const, objective: f.goal.objective, status: f.goal.status, summary: f.goal.summary }),
    queue: f.queue !== undefined ? f.queue : sess.queue,
  };
  return { state: { ...s, seq: seqAfter(s, f), sess: next }, effects: [] };
}

function onKeepalive(s: State, f: KeepaliveFrame): StepResult {
  return { state: { ...s, seq: seqAfter(s, f) }, effects: [] };
}

// ─── 本机意图 ────────────────────────────────────────────────

function onSend(s: State, f: SendIntent, ts: string): StepResult {
  const row: UserLine = f.row.timestamp !== '' ? f.row : { ...f.row, timestamp: ts };
  return { state: { ...s, local: { pending: [...s.local.pending, row] } }, effects: [] };
}

function onAck(s: State, f: AckIntent): StepResult {
  const pending = s.local.pending.filter((u) => u.requestID !== f.requestID);
  const local = pending.length === s.local.pending.length ? s.local : { pending };
  if (f.how === 'delivered' && f.turn !== undefined) {
    const t = s.turns.get(f.turn);
    if (t !== undefined) {
      const bound = s.local.pending.find((u) => u.requestID === f.requestID);
      if (bound !== undefined) {
        const turns = new Map<TurnID, TurnRec>(s.turns);
        turns.set(f.turn, { ...t, user: { ...bound, sending: false, dbID: f.dbID !== undefined ? f.dbID : bound.dbID } });
        return { state: { ...s, turns, local }, effects: [] };
      }
    }
  }
  return { state: { ...s, local }, effects: [] };
}

function onFail(s: State, f: FailIntent): StepResult {
  const pending = s.local.pending.filter((u) => u.requestID !== f.requestID);
  return pending.length === s.local.pending.length ? { state: s, effects: [] } : { state: { ...s, local: { pending } }, effects: [] };
}

// ─── 入口 ────────────────────────────────────────────────────

function isFrame(x: Frame | { kind: string }): x is Frame {
  const k = (x as { kind: string }).kind;
  return k === 'open' || k === 'tick' || k === 'done' || k === 'final' || k === 'session' || k === 'keepalive';
}

/**
 * 唯一转移函数。
 * @param ts 本机时间戳（仅 `send` 需要；由调用方提供 ⇒ `step` 保持纯）
 */
export function step(s: State, input: Frame | SendIntent | AckIntent | FailIntent | { kind: 'resync' } | { kind: 'absent'; turn: TurnID; iteration: IterNum }, ts: string, allowSameSeq: boolean = false): StepResult {
  if (isFrame(input)) {
    const g = envelope(s, input, allowSameSeq);
    if (!g.apply) return { state: s, effects: g.effects };
    switch (input.kind) {
      case 'open': return onOpen(s, input);
      case 'tick': return onTick(s, input);
      case 'done': return onDone(s, input);
      case 'final': return onFinal(s, input);
      case 'session': return onSession(s, input);
      case 'keepalive': return onKeepalive(s, input);
      default: return { state: s, effects: [] };
    }
  }
  switch (input.kind) {
    case 'send': return onSend(s, input, ts);
    case 'ack': return onAck(s, input);
    case 'fail': return onFail(s, input);
    case 'resync': return { state: s, effects: [{ kind: 'snapshot', chat: s.chat }] };
    case 'absent': return { state: markAbsent(s, (input as { turn: TurnID }).turn, (input as { iteration: IterNum }).iteration), effects: [] };
    default: return { state: s, effects: [] };
  }
}

/** 应用一批输入（同一批内 effect 去重：同一 (kind,turn,iteration) 只请求一次）。 */
export function stepAll(s: State, inputs: readonly (Frame | SendIntent | AckIntent | FailIntent | { kind: 'resync' })[], ts: string): StepResult {
  let cur = s;
  const seen: Set<string> = new Set<string>();
  const effects: Effect[] = [];
  let lastSeq: number = -1;
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    const seqOf: number = isFrame(inp) ? inp.seq : -1;
    const sameEvent: boolean = seqOf >= 0 && seqOf === lastSeq && seqOf === cur.seq;
    const r = step(cur, inp, ts, sameEvent);
    if (seqOf >= 0) {
      lastSeq = seqOf;
    }
    cur = r.state;
    for (let k = 0; k < r.effects.length; k++) {
      const e = r.effects[k];
      const key = e.kind === 'pullIter' ? `i:${e.turn}:${e.iteration}` : e.kind === 'pullTurn' ? `t:${e.turn}` : 's';
      if (seen.has(key)) continue;
      seen.add(key);
      effects.push(e);
    }
  }
  return { state: cur, effects };
}

/** 工具状态是否合法迁移（只前进；`generating→pending→running→done|failed`）。 */
export function isLegalTransition(from: ToolStatus, to: ToolStatus): boolean {
  const rank: Map<ToolStatus, number> = new Map<ToolStatus, number>([
    ['generating', 1], ['pending', 2], ['running', 3], ['done', 4], ['failed', 4],
  ]);
  return (rank.get(to) as number) >= (rank.get(from) as number);
}
