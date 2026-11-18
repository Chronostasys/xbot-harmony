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
  AckIntent, Block, ChatID, DetailInput, DoneFrame, Effect, FailIntent, FinalFrame, Frame, IterNum, KeepaliveFrame,
  LiveIter, OpenFrame, SendIntent, SessionFrame, State, StepResult, TickFrame, ToolMeta, ToolRec, ToolStatus,
  Seq, ToolTick, TurnID, TurnRec, UserLine, TextPatch,
} from './model_types';
import { newTurn } from './model_types';
import { rememberToolDetail } from './toollayer';

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

/** 取"有内容的那一个"：`next` 非空优先，否则 `prev`（两者都空 ⇒ 保留 `next` 的空值语义）。 */
function pickStr(next: string | undefined, prev: string | undefined): string | undefined {
  if (next !== undefined && next !== '') return next;
  if (prev !== undefined && prev !== '') return prev;
  return next;
}

/**
 * 工具 `meta` 的**字段级合并**（新值优先，空则保留旧值）。
 *
 * ⛔ 根因（用户 2026-10-27 P0「新的迭代所有 tool 完成后都看不到参数和结果」）：
 *   wire 上 `args`/`detail`/`summary`/`tool_hints` **只在部分帧携带**（流式的
 *   `streaming_tools`/`completed_tools` 有，提交帧 `iterations_delta` 与
 *   `progress_history` 是**轻字段**）。模型此前把 meta 当**整体替换**
 *   ⇒ 迭代一提交，详情就被轻 meta 覆盖掉（在飞时能看到、完成后消失；
 *   最后一条工具曾"能看"是因为它还挂在 `live` 里没提交）。
 *   web 的 `progressStore.dedupTools` 是对象展开合并（`{...prev, ...next}` 语义）
 *   ⇒ 原生必须同源：**逐字段补**，绝不整体替换。
 *
 * 返回**原引用** = 零变化（幂等 ⇒ 不触发重渲染）。
 */
export function mergeToolMeta(prev: ToolMeta | undefined, next: ToolMeta | undefined): ToolMeta {
  if (prev === undefined) return next !== undefined ? next : { name: '' };
  if (next === undefined) return prev;
  const name: string = next.name !== undefined && next.name !== '' ? next.name : prev.name;
  const args: string | undefined = pickStr(next.args, prev.args);
  const detail: string | undefined = pickStr(next.detail, prev.detail);
  const summary: string | undefined = pickStr(next.summary, prev.summary);
  const toolHints: string | undefined = pickStr(next.toolHints, prev.toolHints);
  const uiMode: string | undefined = pickStr(next.uiMode, prev.uiMode);
  const uiLibs: string | undefined = pickStr(next.uiLibs, prev.uiLibs);
  if (name === next.name && args === next.args && detail === next.detail
    && summary === next.summary && toolHints === next.toolHints
    && uiMode === next.uiMode && uiLibs === next.uiLibs) {
    return next;
  }
  return { name, uiMode, uiLibs, toolHints, args, detail, summary };
}

/** 工具可变态的合并：状态/标签以**新值**为准；`exitCode` 缺省保留旧值（轻帧不带它）。 */
/** 工具状态序（只许单向推进：用户 2026-10-29「generating 之后只能是 running 或 done」）。 */
function statusRank(status: ToolStatus): number {
  // ⛔ **未知状态必须排在最前**（用户 2026-10-29：「卡在生成中，即使已经 running」）。
  //   旧实现把一切未知状态当"终态"（rank 3）⇒ 服务端发来 `queued`/`executing`/其它拼写时，
  //   后续的 `running`/`done` **永远被挡回去** ⇒ 界面卡在旧状态（看起来像"状态延迟更新"）。
  if (status === 'pending') return 0;
  if (status === 'generating') return 1;
  if (status === 'running') return 2;
  if (status === 'done' || status === 'failed' || status === 'error' || status === 'cancelled'
    || status === 'canceled' || status === 'timeout') {
    return 3;
  }
  return 0;   // 未知/其它：当作最早阶段，绝不阻断后续推进
}

function mergeToolState(prev: ToolRec['state'], next: ToolRec['state']): ToolRec['state'] {
  // ⛔ **状态只许前进**：`done` 不能被迟到的 `running`/`generating` 覆盖（否则 pill 会
  //   在"完成"与"执行中"之间来回跳，用户 2026-10-29 P0）。
  const status: ToolStatus = statusRank(next.status) >= statusRank(prev.status) ? next.status : prev.status;
  const exitCode: number | undefined = next.exitCode !== undefined ? next.exitCode : prev.exitCode;
  if (status === next.status && exitCode === next.exitCode) {
    return next;
  }
  return { ...next, status, exitCode };
}

/**
 * 工具列表合并：按 `call` 匹配（缺 call/换 id 时按**同下标同名**兜底），逐项合并 meta/state。
 *
 * ⛔ 用途：在飞工具（rich）→ 提交块（light）时保住 `args/detail`；`done`/`final`/`detail`
 *   四条路共用这一个语义（判据与渲染同源，⛔ 别各写一份"空就保留"的局部规则）。
 * 返回**原引用** = 零变化。
 */
export function mergeToolLists(prevIn: readonly ToolRec[] | undefined,
  nextIn: readonly ToolRec[] | undefined): readonly ToolRec[] {
  // ⛔ 宽进：历史/测试夹具里可能缺 `tools`（老 wire 的"缺字段=未携带"形态）⇒ 一律当空表，
  //   绝不让一次水合因为某个块没有 tools 字段而抛（那会整条历史渲染中断）。
  const prev: readonly ToolRec[] = prevIn !== undefined && prevIn !== null ? prevIn : [];
  const next: readonly ToolRec[] = nextIn !== undefined && nextIn !== null ? nextIn : [];
  // ⛔ **`next` 为空 = "未携带"，不是"清空"**（用户 2026-10-28 P0：「新的工具完成后直接消失」）。
  //   `done` / `final`(progressHistory) / history 快照经常**不带 tools**（P5 缺字段形态）
  //   ⇒ 旧实现 `return next`（空表）把已拿到的工具整批抹掉 ⇒ 工具在"完成"那一刻消失。
  //   语义：空 next ⇒ 保留 prev；prev 也空 ⇒ 空。
  if (next.length === 0) return prev;
  if (prev.length === 0) return next;
  const byCall: Map<string, ToolRec> = new Map<string, ToolRec>();
  for (let i = 0; i < prev.length; i++) byCall.set(prev[i].call, prev[i]);
  let changed: boolean = prev.length !== next.length;
  const out: ToolRec[] = [];
  for (let i = 0; i < next.length; i++) {
    const n: ToolRec = next[i];
    let p: ToolRec | undefined = byCall.get(n.call);
    if (p === undefined) {
      const cand: ToolRec | undefined = prev[i];
      if (cand !== undefined && cand.meta.name === n.meta.name) p = cand;
    }
    if (p === undefined) { out.push(n); changed = true; continue; }
    const meta: ToolMeta = mergeToolMeta(p.meta, n.meta);
    const state = mergeToolState(p.state, n.state);
    if (sameMeta(meta, p.meta) && sameState(state, p.state)
      && n.call === p.call && n.iteration === p.iteration) {
      out.push(p);             // 值完全一致 ⇒ 保留**旧引用**（幂等：二次应用不产生新状态）
      continue;
    }
    changed = true;
    out.push({ call: n.call, iteration: n.iteration, meta, state });
  }
  return changed ? out : prev;
}

function sameMeta(a: ToolMeta, b: ToolMeta): boolean {
  return a.name === b.name && a.args === b.args && a.detail === b.detail
    && a.summary === b.summary && a.toolHints === b.toolHints
    && a.uiMode === b.uiMode && a.uiLibs === b.uiLibs;
}

function sameState(a: ToolRec['state'], b: ToolRec['state']): boolean {
  return a.status === b.status && a.label === b.label && a.genChars === b.genChars
    && a.elapsedMs === b.elapsedMs && a.exitCode === b.exitCode;
}

/** 位置状态：`ticks` 是**当前迭代工具的全集**；meta **逐字段**沿用已知（按 call 查）。 */
/** `p` 在其迭代内的"同名序号"。 */
function prevNameOrdinalBefore(p: ToolRec, prev: readonly ToolRec[], iteration: IterNum): number {
  let n: number = 0;
  for (let i = 0; i < prev.length; i++) {
    const q: ToolRec = prev[i];
    if (q.iteration !== iteration || q.meta.name !== p.meta.name) {
      continue;
    }
    if (q.call === p.call) {
      return n;
    }
    n++;
  }
  return n;
}

/** 该 tick 是否已经通过 call 匹配给别的 prev 项（避免一个 tick 被认领两次）。 */

/**
 * 同一枚工具的**跨帧身份**：名字相同 **且** 参数只增长（生成期 args 为空/是后来者的前缀）。
 *
 * ⛔ 用户 2026-10-29 截图实证（同一枚出现两枚：`Shell 生成中 1646 字` + `Shell: cd /… 执行中`）：
 *   工具从 `generating` 转 `running` 时服务端会给它**新的 call_id**（生成期是临时 id）
 *   ⇒ 只按 call 匹配认不出是同一枚 ⇒ 旧记录留在列表 + 新记录追加 = 重复渲染。
 *   判据必须是**内容单调性**：参数只会增长，所以「旧 args 为空」或「新 args 以旧 args 开头」
 *   ⇒ 同一枚（就地更新 call/状态）；否则是两个不同工具（如两次不同命令）⇒ 各自保留。
 */
function sameToolAcrossFrames(prev: ToolRec, tk: ToolTick): boolean {
  const tkMeta: ToolMeta | undefined = tk.meta;
  const nm: string = tkMeta !== undefined && tkMeta !== null ? tkMeta.name : '';
  if (nm.length > 0 && nm !== prev.meta.name) {
    return false;
  }
  const oldArgs: string = prev.meta.args !== undefined && prev.meta.args !== null ? prev.meta.args : '';
  const newArgs: string = tkMeta !== undefined && tkMeta.args !== undefined && tkMeta.args !== null ? tkMeta.args : '';
  // ⛔ **必须有"新参数"作为证据**：`generating`（args 空）→ `running`（args 到货）才是同一枚。
  //   若新旧参数都为空（两个都没开始执行的工具），**绝不认领** —— 那是两个不同工具
  //   （`sse_tool_protocol P2`：分桶帧只带另一桶时，不能把已出现的工具吃掉）。
  if (newArgs.length === 0) {
    return false;
  }
  if (oldArgs.length === 0) {
    return true;
  }
  return newArgs.indexOf(oldArgs) === 0 && newArgs !== oldArgs ? true : false;
}

function applyToolTicks(prev: readonly ToolRec[], ticks: readonly ToolTick[],
  iteration: IterNum): readonly ToolRec[] {
  const byCall: Map<string, ToolTick> = new Map<string, ToolTick>();
  const tickOrdinal: Map<string, number> = new Map<string, number>();
  const byName: Map<string, ToolTick> = new Map<string, ToolTick>();
  for (let i = 0; i < ticks.length; i++) {
    const tk: ToolTick = ticks[i];
    byCall.set(tk.call, tk);
    const nm: string = tk.meta !== undefined && tk.meta !== null ? tk.meta.name : '';
    const n: number = tickOrdinal.get(nm) !== undefined ? (tickOrdinal.get(nm) as number) : 0;
    tickOrdinal.set(nm, n + 1);
    byName.set(`${nm}#${n}`, tk);
  }
  // ⛔ **同名同序兜底**（用户 2026-10-29 P0：「生成完变执行中会渲染出两个工具」）：
  //   工具从 `generating` 转 `running` 时，服务端可能**给它分配新的 call_id**
  //   （生成期是临时 id），只按 call 匹配会认不出是同一枚 ⇒ 旧的留在列表里 + 新的追加
  //   ⇒ 同一枚工具被渲染两遍。⇒ call 匹配不到时，按「名字 + 同名序号」对齐。
  const prevNameOrdinal: Map<string, number> = new Map<string, number>();
  const prevNameSeen: Map<string, ToolRec> = new Map<string, ToolRec>();
  for (let k = 0; k < prev.length; k++) {
    if (prev[k].iteration !== iteration) {
      continue;
    }
    const nm: string = prev[k].meta.name;
    const n: number = prevNameOrdinal.get(nm) !== undefined ? (prevNameOrdinal.get(nm) as number) : 0;
    prevNameOrdinal.set(nm, n + 1);
    prevNameSeen.set(`${nm}#${n}`, prev[k]);
  }
  const out: ToolRec[] = [];
  const seen: Set<string> = new Set<string>();
  const mergeOne = (known: ToolRec | undefined, tk: ToolTick): ToolRec => {
    // ⛔ 逐字段补（不是"tk.meta 缺省才用 known"）：adapter 每帧都构造 meta（字段可能全空），
    //   按整体替换会让后到的轻帧抹掉已经拿到的 args/detail（见 `mergeToolMeta` 的根因注释）。
    const meta: ToolMeta = mergeToolMeta(known !== undefined ? known.meta : undefined, tk.meta);
    // ⛔ 工具归属 = **它自己的**迭代号（陈旧条目自带更小的号）。
    const ownIter: IterNum = tk.iteration !== undefined && tk.iteration > 0 ? tk.iteration : iteration;
    const state = known !== undefined ? mergeToolState(known.state, tk.state) : tk.state;
    return { call: tk.call, iteration: ownIter, meta, state };
  };
  // ① 先按**既有顺序**输出本迭代的工具（本帧带到的就地更新；没带到的原样保留 —— 单调增）
  const consumedTicks: Set<string> = new Set<string>();
  for (let k = 0; k < prev.length; k++) {
    const p: ToolRec = prev[k];
    if (p.iteration !== iteration) {
      continue;   // 跨迭代残留一律丢（防上一迭代的排队条目复活）
    }
    let tk: ToolTick | undefined = byCall.get(p.call);
    if (tk !== undefined && consumedTicks.has(tk.call)) {
      tk = undefined;   // 同一 tick 已被认领
    }
    if (tk === undefined) {
      // ⛔ call 变了（生成期临时 id → 执行期真 id）⇒ 按**内容单调性**认领同一枚
      for (let t = 0; t < ticks.length; t++) {
        const cand: ToolTick = ticks[t];
        if (consumedTicks.has(cand.call)) {
          continue;
        }
        if (sameToolAcrossFrames(p, cand)) {
          tk = cand;
          break;
        }
      }
    }
    if (tk !== undefined) {
      consumedTicks.add(tk.call);
      seen.add(tk.call);
    }
    out.push(tk !== undefined ? mergeOne(p, tk) : p);
    seen.add(p.call);
  }
  // ② 本帧新增的工具追加在尾部（顺序稳定 ⇒ 不会因为"先新后旧"造成视觉跳动）
  for (let i = 0; i < ticks.length; i++) {
    if (seen.has(ticks[i].call)) {
      continue;
    }
    out.push(mergeOne(undefined, ticks[i]));
    seen.add(ticks[i].call);
  }
  return out;
}

/**
 * **不变量（P0，用户 2026-10-28 反复回归的根因）**：`live.tools` 只允许
 * `iteration === live.iteration` 的工具。
 *
 * 为什么必须是**等于**，而不是 web 的 `> maxCompletedIter`：
 *   服务端 `active_tools` 会**整批先标 pending 并把陈旧条目带进后续帧**
 *   （`agent/engine_run_tools.go:49-64`，其注释明确要求前端按 `iteration` 过滤），残留副本
 *   **保留原始迭代号**。而"已提交块"渲染在 `IterBlocksView`、"在飞工具"渲染在
 *   `LiveTailView` —— **两个不同容器** ⇒ 只要同一枚工具同时出现在 `blocks` 与 `live.tools`，
 *   界面上必然出现两枚 pill（用户看到的确切形态：`行1: tool1` / `行2: tool1 tool2`）。
 *   ⇒ 任何"渲染层去重"都治不住（两个组件互相看不见）；**唯一正确的层是模型**：
 *   进在飞列表前按"自己的迭代号 == 在飞迭代号"过滤，旧号一律丢弃（它们属于提交块/缺口）。
 *
 * ⛔ 不要放宽成 `>=`/`>`：`>` 会在 live 推进到 N+1 时把 N 的工具继续带在列表里，
 *   等 `done(N)` 落地后两处各画一枚 —— 这正是本 P0 的复发路径。
 */
function onlyOwnIterTools(tools: readonly ToolRec[], iteration: IterNum,
  assigned?: Set<string>): readonly ToolRec[] {
  let changed: boolean = false;
  const out: ToolRec[] = [];
  for (let i = 0; i < tools.length; i++) {
    const t: ToolRec = tools[i];
    // ① 必须属于本迭代；② 该 call 不得已被某个已提交块/pending 占用（单一归属）
    const taken: boolean = assigned !== undefined && assigned.has(t.call);
    if (t.iteration === iteration && !taken) {
      out.push(t);
    } else {
      changed = true;
    }
  }
  return changed ? out : tools;
}

/**
 * 一轮内**已归属**的 call 集合（已提交块 + pending 缓冲）。
 *
 * ⛔ 用作"单一归属"判据：同一轮里每个 `call` 只能出现在**一个**位置（某个块 **或** 在飞列表），
 *   否则它会被**两个容器**各画一枚（`IterBlocksView` × `LiveTailView`）—— 用户 2026-10-28
 *   看到的 `行1: tool1` / `行2: tool1 tool2` 就是这种形态。
 */
function assignedCalls(s: State, turn: TurnID): Set<string> {
  const out: Set<string> = new Set<string>();
  const t: TurnRec | undefined = s.turns.get(turn);
  if (t !== undefined) {
    for (let i = 0; i < t.blocks.length; i++) {
      const bl: Block = t.blocks[i];
      for (let k = 0; k < bl.tools.length; k++) {
        out.add(bl.tools[k].call);
      }
    }
  }
  const pend: ReadonlyMap<IterNum, Block> | undefined = s.pending.get(turn);
  if (pend !== undefined) {
    pend.forEach((bl: Block) => {
      for (let k = 0; k < bl.tools.length; k++) {
        out.add(bl.tools[k].call);
      }
    });
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
  // ⛔ **回合号复用 / 已收尾回合**（用户 2026-11-18 P0：cancel 一轮再发消息 ⇒ 「继续」跑到上面、
  //   整段错位：期望 `user1 → agent1(cancelled) → user2 → agent2`，实测 `user2 → user1 → agent1 → agent2`）：
  //   新消息的 `turn_started` 可能带一个**已收尾（cancel）或已有内容**的回合号。此时
  //   · 旧实现①直接 `{...cur, user}` ⇒ 顶掉旧 user、旧回复排到新 user 后面；
  //   · 旧实现②（我上一版）把旧回合**归档到 maxId+1** ⇒ 换位 ⇒ 旧回合排到新回合之后 ⇒ 同样错位。
  //   ⇒ 正确做法：**什么都不动**。乐观 user 行继续留在 `local.pending`（`project` 永远渲染在最后），
  //     等真正的**新回合**（不同号 / 空回合）到来再绑 —— 顺序天然正确，且不丢任何数据。
  const staleOpen: boolean = cur !== undefined && cur.requestID !== f.requestID
    && (cur.blocks.length > 0 || cur.final !== null);
  if (staleOpen) {
    let kept: UserLine[] = [];
    for (let i = 0; i < s.local.pending.length; i++) {
      const u: UserLine = s.local.pending[i];
      kept.push(u.requestID === f.requestID ? { ...u, sending: false } : u);
    }
    const localNext = { pending: kept };
    return { state: { ...s, local: localNext, seq: seqAfter(s, f) }, effects: [] };
  }
  const base: State = s;  const cur2: TurnRec | undefined = base.turns.get(f.turn);
  let next: State;
  if (cur2 !== undefined) {
    // ⛔ 幂等（§4 F-1）：只绑 user/requestID，**保留** blocks/final/phase（否则历史被清空）。
    const patched: TurnRec = { ...cur2, user: f.user, requestID: f.requestID };
    const turns = new Map<TurnID, TurnRec>(base.turns);
    turns.set(f.turn, patched);
    next = { ...base, turns, live: null };
  } else {
    const turns = new Map<TurnID, TurnRec>(base.turns);
    turns.set(f.turn, newTurn(f.turn, f.user, f.requestID));
    next = { ...base, turns, live: null };
  }
  // ⛔ turn 水位随 `open` 推进（P0）：新轮开始 ⇒ 水位抬到该轮，之后**任何更旧的** busy/idle
  //   信号都会被 `onSession` 的 stale 闸门丢弃（这就是「cancel(T1) 后 T2 立刻出队」不再被
  //   T1 的迟到 idle 压平的结构保证）。
  // ⛔ `open(T)` 语义 = "T 这一轮开始了" ⇒ 会话**必然在跑**（这也正是迟到 idle 压不平它的原因：
  //   水位被抬到 T 之后，任何 `turn < T` 的 busy/idle 都会被 `onSession` 的 stale 闸门丢弃）。
  const openTurn: number = next.sess.runningTurn as number;
  if ((f.turn as number) > openTurn) {
    next = { ...next, sess: { ...next.sess, running: true, runningTurn: f.turn } };
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

/** 是否**子代理会话**（chat 形如 `agent:<parentChannel>:<parentChat>/<role>:<instance>`）。 */
function isSubChat(chat: ChatID): boolean {
  const c: string = chat as string;
  if (c === undefined || c === null) {
    return false;
  }
  if (c.indexOf('agent:') === 0) {
    return true;
  }
  // ⛔ 语境（用户 2026-11-13「进入 subagent 视图不会渲染 sse 的进度」）：
  //   会话树里 `children[].chat_id` 的**全键**可能是 `web:chat_T/explore:inst`
  //   ——**不带** `agent:` 前缀（渠道由 store 解析成 agent，但 state.chat 仍是全键）。
  //   旧实现只认 `agent:` 前缀 ⇒ 这类子代理会话被当成普通会话 ⇒ 未知 turn 的进度帧
  //   全被 `pullTurn` 吞掉、永远没有 live ⇒ 子代理窗口看不到流式进度。
  //   判据 `subagent_live_progress.test.ts §4`（修复前实测 3 条红）。
  // 形状判定（与 core/sessiongroup.parseAgentChatID 的条件逐条一致；⛔ 不能 import：它是 .ets）
  const slash: number = c.lastIndexOf('/');
  if (slash <= 0 || slash === c.length - 1) {
    return false;
  }
  const parent: string = c.substring(0, slash);
  const roleInstance: string = c.substring(slash + 1);
  const channelSep: number = parent.indexOf(':');
  const roleSep: number = roleInstance.lastIndexOf(':');
  return channelSep > 0 && channelSep < parent.length - 1
    && roleSep > 0 && roleSep < roleInstance.length - 1;
}

function onTick(s: State, f: TickFrame): StepResult {
  const t0 = s.turns.get(f.turn);
  let t = t0;
  if (t === undefined) {
    // ⛔ 用户 2026-11-04：「子代理看不到 live 进度」。
    //   根因：子代理转录来自 `get_agent_session_dump`（turn 号由 user 行数派生 1..N），
    //   而子代理的 SSE progress 帧带**服务端自己的 turn_id**（`agent/interactive.go:373`
    //   的 `buildPayload`，注释明确要求携带）⇒ 两者不一致时这里「未知 turn ⇒ 不凭空造」
    //   会把**整帧流式进度丢掉** ⇒ live 永远不出现。
    //   语义：**子代理会话（chat 以 `agent:` 开头）允许现场建空回合**（只用于承载 live）；
    //   普通会话保持原纪律（不造，交给 `pullTurn` 权威拉取）。
    if (!isSubChat(s.chat)) {
      // 未知 turn（丢了 open）⇒ 取权威回合，不凭空造。
      return { state: { ...s, seq: seqAfter(s, f) }, effects: [{ kind: 'pullTurn', chat: s.chat, turn: f.turn }] };
    }
    t = newTurn(f.turn, null, null);
    const seeded = new Map<TurnID, TurnRec>(s.turns);
    seeded.set(f.turn, t);
    s = { ...s, turns: seeded };
  }
  const last = lastBlockIter(t);
  const lastIsShell: boolean = last > 0
    && isShellBlock((t.blocks[indexOfBlock(t.blocks, last)] as Block));
  if (f.iteration === last && !lastIsShell) {
    // ⛔ **已提交的前沿迭代收到迟到帧**（用户 2026-11-14 P0「子代理 shell 转后台之后，
    //   该迭代被重复渲染」）：旧实现在这里**整帧丢弃** ⇒ 后台工具投递带来的
    //   `delivered_message`/新 Shell 状态全丢；若该迭代另有 `live` 副本（跨回合对齐前
    //   的残留），界面就变成"块一份 + 尾项一份"重复。⇒ 改成**并进前沿块**（幂等，不删数据），
    //   并清掉同号 `live`（前沿唯一）。
    const idx: number = indexOfBlock(t.blocks, last);
    if (idx < 0) {
      return { state: { ...s, seq: seqAfter(s, f) }, effects: [] };
    }
    const b: Block = t.blocks[idx];
    const pc: string = patchText(f.content);
    const pr: string = patchText(f.reasoning);
    const content: string = pc.length > b.content.length ? pc : b.content;
    const reasoning: string = pr.length > b.reasoning.length ? pr : b.reasoning;
    const tools: readonly ToolRec[] = f.tools !== undefined && f.tools.length > 0
      ? applyToolTicks(b.tools, f.tools, b.iteration) : b.tools;
    const live: LiveIter | null = liveAt(s, f.turn, f.iteration) !== null ? null : s.live;
    if (content === b.content && reasoning === b.reasoning && tools === b.tools) {
      return { state: { ...s, seq: seqAfter(s, f), live }, effects: [] };   // 无变化 ⇒ 零重建
    }
    const blocks: Block[] = t.blocks.slice();
    blocks[idx] = { ...b, content, reasoning, tools };
    const turns = new Map<TurnID, TurnRec>(s.turns);
    turns.set(f.turn, { ...t, blocks });
    return { state: { ...s, seq: seqAfter(s, f), turns, live }, effects: [] };
  }
  if (f.iteration < last) {
    // 已提交迭代的迟到帧 ⇒ 丢弃（权威块已在，且 `done` 完备）。
    // ⛔ 例外：末块只是**空壳**（服务端迭代边界的在飞快照）⇒ 同号流式帧必须能把它顶成 live，
    //   否则打字机/工具 pill 永远不出现（判据 `p0_tail_visibility`）。
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
  // ⛔ 推进到新迭代 ⇒ 先把**上一在飞迭代**的可见内容物化成块（见 `materializeLive`）。
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
    // ⛔ 只保留**本迭代**的工具（见 `onlyOwnIterTools` 的 P0 注释：旧号会与已提交块重复渲染）
    tools: onlyOwnIterTools(applyToolTicks(prevTools, f.tools, f.iteration), f.iteration,
      assignedCalls(s, f.turn)),
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


/** 块是否**空壳**（无正文/思考/工具/子代理且未取消）——"在飞快照"的占位形态。 */
function isShellBlock(b: Block): boolean {
  return !b.cancelled && b.content.length === 0 && b.reasoning.length === 0
    && b.tools.length === 0 && b.subAgents.length === 0;
}

/** 块列表里指定迭代号的下标（找不到 −1）。 */
function indexOfBlock(bs: readonly Block[], iteration: IterNum): number {
  for (let i = 0; i < bs.length; i++) {
    if (bs[i].iteration === iteration) return i;
  }
  return -1;
}

/**
 * 提交块的**工具详情富化**：把在飞/已有块里更完整的工具 meta 并进提交块。
 *
 * ⛔ 用户 2026-10-27 P0「新的迭代所有 tool 完成后都看不到参数和结果」的落点：
 *   提交帧（`iterations_delta`/`progress_history`）里的工具是**轻字段**，而在飞帧
 *   （`streaming_tools`/`completed_tools`）里已经拿到了 `args/detail`。旧实现直接
 *   `stampBlock(f.block)` 整体替换 ⇒ 提交瞬间详情全丢（在飞时能看到、完成后看不到）。
 *   ⇒ 提交前按 `call`（缺 id 时按同下标同名）**逐字段合并**，绝不整体替换。
 */
function enrichDoneBlock(s: State, turn: TurnID, block: Block): Block {
  // ⛔ 取在飞工具**不只认"当前 live 迭代"**（用户 2026-10-28：「所有 live progress iter
  //   结束后的 toolcall 都看不到详情」）：服务端常在**同一个帧**里既给"上一迭代完成"又推进
  //   到下一迭代 ⇒ `done(N)` 到达时 `s.live.iteration` 已经是 N+1 ⇒ 旧写法 `liveAt(N)`
  //   恒 null ⇒ 拿不到在飞那一份 rich meta ⇒ 提交块只有轻字段。
  //   修法：从 `s.live.tools` 里按**工具自带迭代号**过滤（它们本就带自己的号），再与已有块合并。
  const t: TurnRec | undefined = s.turns.get(turn);
  const idx: number = t !== undefined ? indexOfBlock(t.blocks, block.iteration) : -1;
  const fromLive: ToolRec[] = [];
  if (s.live !== null && s.live.turn === turn) {
    for (let i = 0; i < s.live.tools.length; i++) {
      const lt: ToolRec = s.live.tools[i];
      if (lt.iteration === block.iteration) {
        fromLive.push(lt);
      }
    }
  }
  const blockTools: readonly ToolRec[] = t !== undefined && idx >= 0 ? t.blocks[idx].tools : EMPTY_TOOLS;
  const prevTools: readonly ToolRec[] = fromLive.length > 0
    ? mergeToolLists(blockTools, fromLive) : blockTools;
  // ⛔ 同号 `live` 里**更完整的正文/思考**必须并进块（用户 2026-11-14 P0）：提交帧是快照，
  //   在飞帧才是逐字累积的真相；块比 live 短 ⇒ 用户会看到"提交瞬间掉字"。
  let out: Block = block;
  if (!block.cancelled && s.live !== null && s.live.turn === turn && s.live.iteration === block.iteration) {
    const lc: string = s.live.content;
    const lr: string = s.live.reasoning;
    if (lc.length > block.content.length || lr.length > block.reasoning.length) {
      out = {
        ...block,
        content: lc.length > block.content.length ? lc : block.content,
        reasoning: lr.length > block.reasoning.length ? lr : block.reasoning,
      };
    }
  }
  if (prevTools.length === 0) return out;
  // 提交帧**完全没带** tools（老 wire 的 P5 缺字段形态）⇒ 保留在飞那一份，绝不"提交即清空"。
  if (out.tools.length === 0) return { ...out, tools: prevTools };
  const tools: readonly ToolRec[] = mergeToolLists(prevTools, out.tools);
  return tools === out.tools ? out : { ...out, tools };
}

/**
 * **块内只允许自己的迭代的工具**（P0 不变量，另一条腿）。
 *
 * `live.tools` 已在 `onlyOwnIterTools` 过滤；但提交帧（`iterations_delta` / `progress_history`）
 * 同样可能带着**上一迭代的残留副本**（服务端 `active_tools` 跨帧残留）。块与块是两个渲染
 * 容器 ⇒ 同一枚 pill 会各画一次（用户 2026-10-28：`行1: tool1` / `行2: tool1 tool2`）。
 * ⇒ 提交时按**工具自带迭代号**丢掉 `iteration < block.iteration` 的条目，再 `stampBlock`。
 */
function dropForeignTools(block: Block): Block {
  // ⛔ **绝不按迭代号删工具**（用户 2026-10-28：「不是渲染重复了，是渲染丢了，tool 不见了」）。
  //   之前这里丢 `tool.iteration < block.iteration` 的条目，本意是吸收服务端 `active_tools`
  //   的跨帧残留；但线上工具号可能落后于块号（服务端在迭代边界重排/补写）⇒ **真工具被删掉**，
  //   界面上就是"思考 29 字之后工具整个消失"。⇒ 模型层一律**保留**数据；重复只在渲染层吸收
  //   （`IterBlocksView.groupShownPills` + `MessageRow` 的跨容器去重）。这里是恒等，留名以
  //   标记"该处曾因删数据出过 P0"。
  return block;
}

function onDone(s: State, f: DoneFrame): StepResult {
  const t0 = s.turns.get(f.turn);
  let t = t0;
  if (t === undefined) {
    // ⛔ 子代理会话：turn 号由服务端 progress 携带，可能与 dump 派生的本地 turn 不一致
    //   ⇒ 现场建回合（只用于承载该轮的块）；普通会话保持"不凭空造"。
    if (!isSubChat(s.chat)) {
      return { state: { ...s, seq: seqAfter(s, f) }, effects: [{ kind: 'pullTurn', chat: s.chat, turn: f.turn }] };
    }
    t = newTurn(f.turn, null, null);
    const seeded = new Map<TurnID, TurnRec>(s.turns);
    seeded.set(f.turn, t);
    s = { ...s, turns: seeded };
  }
  const last = lastBlockIter(t);
  if (f.block.iteration <= last) {
    if (!isShellBlock(f.block) && !f.block.cancelled) {
      const idx: number = indexOfBlock(t.blocks, f.block.iteration);
      if (idx >= 0 && isShellBlock(t.blocks[idx])) {
        const blocks: Block[] = t.blocks.slice();
        blocks[idx] = stampBlock(enrichDoneBlock(s, f.turn, dropForeignTools(f.block)));
        const turns = new Map<TurnID, TurnRec>(s.turns);
        turns.set(f.turn, { ...t, blocks });
        // ⛔ 升级也是**该迭代的收尾** ⇒ 同号 live 必须清（否则行里留着一个内容为空的
        //   `live` 块 ⇒ `rowHasInFlightSignal` 假阳性 ⇒ 空隙的「思考中」占位被吞，
        //   判据 `iter_gap_indicator` G2）。
        const live = liveAt(s, f.turn, f.block.iteration) !== null ? null : s.live;
        return { state: { ...s, seq: seqAfter(s, f), turns, live }, effects: [] };
      }
    }
    return { state: { ...s, seq: seqAfter(s, f) }, effects: [] };       // 已提交/回退 ⇒ 丢弃
  }
  if (f.block.iteration > last + 1) {
    // ⛔ 缺口：本块**暂不入账**（绝不让 blocks 出现洞），进 `pending` 缓冲；
    //   同时拉缺失号。补到（或权威回答"不存在"）后由 `drain` 按序落地 ——
    //   ⛔ 不阻塞后续 SSE 帧（位置状态照常推进）。
    const buf = new Map<number, Block>();
    const prevBuf = s.pending.get(f.turn);
    if (prevBuf !== undefined) prevBuf.forEach((v, k) => buf.set(k, v));
    buf.set(f.block.iteration, stampBlock(enrichDoneBlock(s, f.turn, dropForeignTools(f.block))));
    const pending = new Map(s.pending);
    pending.set(f.turn, buf);
    const effects = pullRange(s.chat, f.turn, last + 1, f.block.iteration - 1);
    return { state: { ...s, seq: seqAfter(s, f), pending }, effects };
  }
  const block = stampBlock(enrichDoneBlock(s, f.turn, dropForeignTools(f.block)));
  const turns = new Map<TurnID, TurnRec>(s.turns);
  turns.set(f.turn, { ...t, blocks: [...t.blocks, block] });
  // ⛔ 空壳块（边界/取消快照）**不得吞掉 live**：同号 live 里的正文/思考是此刻唯一的可见内容。
  const live = isShellBlock(block) ? s.live : (liveAt(s, f.turn, block.iteration) !== null ? null : s.live);
  const applied = drain({ ...s, seq: seqAfter(s, f), turns, live }, f.turn);
  return { state: applied, effects: [] };
}

function onFinal(s: State, f: FinalFrame): StepResult {
  const t0 = s.turns.get(f.turn);
  let t = t0;
  if (t === undefined) {
    // ⛔ 子代理会话：同 `onTick`/`onDone` —— 服务端 turn 号与 dump 派生的本地 turn 可能不一致
    //   ⇒ 现场建回合承载收尾块；普通会话保持"不凭空造"（交给 pullTurn 权威拉取）。
    if (!isSubChat(s.chat)) {
      return { state: { ...s, seq: seqAfter(s, f) }, effects: [{ kind: 'pullTurn', chat: s.chat, turn: f.turn }] };
    }
    t = newTurn(f.turn, null, null);
    const seeded = new Map<TurnID, TurnRec>(s.turns);
    seeded.set(f.turn, t);
    s = { ...s, turns: seeded };
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
    const seen: Set<IterNum> = new Set<IterNum>();
    for (let i = 0; i < f.blocks.length; i++) {
      const inc: Block = dropForeignTools(f.blocks[i]);
      const prev: Block | undefined = prevByIter.get(inc.iteration);
      let merged: Block = inc;
      if (prev !== undefined || (s.live !== null && s.live.turn === f.turn && s.live.iteration === inc.iteration)) {
        // ⛔ 工具**逐字段**合并（不是"空才保留"）：progressHistory 里的工具是轻字段（无 args/detail），
        //   而本地已有（块或同号 live）可能是完整 meta ⇒ 整体替换会让提交瞬间详情消失。
        const liveTools: readonly ToolRec[] = s.live !== null && s.live.turn === f.turn
          && s.live.iteration === inc.iteration ? s.live.tools : EMPTY_TOOLS;
        const mergedTools = mergeToolLists(
          prev !== undefined ? mergeToolLists(liveTools, prev.tools) : liveTools, inc.tools);
        const content = inc.content.length === 0 && prev !== undefined && prev.content.length > 0
          ? prev.content : inc.content;
        const reasoning = inc.reasoning.length === 0 && prev !== undefined && prev.reasoning.length > 0
          ? prev.reasoning : inc.reasoning;
        merged = { ...inc, tools: mergedTools, content, reasoning };
      }
      stamped.push(stampBlock(merged));
      seen.add(merged.iteration);
    }
    // ⛔ **并集，不是替换**（用户 2026-10-28 P0「漏迭代，重启之后历史迭代才完整」）：
    //   `progressHistory` 是**可能截断/滞后**的快照。旧实现 `blocks = stamped` 整表替换 ⇒
    //   本地已提交、快照里没有的迭代被**删掉**（busy 期间少好几块，重启走 hydrate 才补回）。
    //   ⇒ 本地已有（`t.blocks`）与 pending 缓冲里的迭代只要快照没带，就**保留**。
    for (let i = 0; i < t.blocks.length; i++) {
      const local: Block = t.blocks[i];
      if (!seen.has(local.iteration)) {
        stamped.push(local);
        seen.add(local.iteration);
      }
    }
    if (pend !== undefined) {
      pend.forEach((v: Block, k: IterNum) => {
        if (!seen.has(k)) {
          // 缺口期间的块：`final` 是"这一轮已经收尾"的权威信号 ⇒ 补不上的缺口也按已知内容落地
          stamped.push(stampBlock(v));
          seen.add(k);
        }
      });
    }
    stamped.sort((a: Block, b: Block): number => a.iteration - b.iteration);
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
  // ⛔ **半截迭代落地**（用户 2026-10-28：「请求异常、SSE 只输出一半就结束，导致有些迭代
  //   只有 reasoning，你好像不会显示这种迭代」）：
  //   生成中被中断的迭代**没有 `done` 帧** ⇒ 内容只存在于 `live`；`progressHistory` 也不含它
  //   （未落库）⇒ 收尾时清 live = 这段思考**彻底消失**。⇒ 收尾前把 live 里"尚未成为块"且
  //   **有可见内容**的部分物化成一个块（无内容的空壳不物化，避免空气卡）。
  let blocksOut: readonly Block[] = blocks;
  const liveHere: LiveIter | null = s.live !== null && s.live.turn === f.turn ? s.live : null;
  if (liveHere !== null) {
    let exists: boolean = false;
    for (let i = 0; i < blocksOut.length; i++) {
      if (blocksOut[i].iteration === liveHere.iteration) {
        exists = true;
        break;
      }
    }
    const visible: boolean = liveHere.content.length > 0 || liveHere.reasoning.length > 0
      || liveHere.tools.length > 0;
    if (!exists && visible) {
      const tail: Block = {
        iteration: liveHere.iteration,
        content: liveHere.content,
        reasoning: liveHere.reasoning,
        tools: liveHere.tools,
        subAgents: [],
        genui: liveHere.genui,
        cancelled: false,
      };
      const withTail: Block[] = [];
      for (let i = 0; i < blocksOut.length; i++) {
        withTail.push(blocksOut[i]);
      }
      withTail.push(tail);
      withTail.sort((a: Block, b: Block): number => a.iteration - b.iteration);
      blocksOut = withTail;
    }
  }
  const turns = new Map<TurnID, TurnRec>(s.turns);
  turns.set(f.turn, {
    ...t,
    blocks: blocksOut,
    final: { content: f.content, cancelled: f.cancelled },
    phase: f.phase,
    streaming: false,
    droppedBefore: f.droppedBefore !== undefined ? f.droppedBefore : t.droppedBefore,
  });
  const live = s.live !== null && s.live.turn === f.turn ? null : s.live;
  // ⛔ `final` = 这一轮已收尾 ⇒ 该轮的 pending 缓冲**必须清空**（上面的并集已把它们落地；
  //   若仍有残留，说明缺口永远不会补齐 —— 留在缓冲里等于永久丢迭代，用户 2026-10-28 P0）。
  let pendingNext: ReadonlyMap<TurnID, ReadonlyMap<IterNum, Block>> = s.pending;
  if (s.pending.has(f.turn)) {
    const p2 = new Map<TurnID, ReadonlyMap<IterNum, Block>>(s.pending);
    p2.delete(f.turn);
    pendingNext = p2;
  }
  const applied = drain({ ...s, seq: seqAfter(s, f), turns, live, pending: pendingNext }, f.turn);
  return { state: applied, effects };
}

function onSession(s: State, f: SessionFrame): StepResult {
  const sess = s.sess;
  // ⛔ **turn 水位**（P0）：`running` 是会话级字段，必须锚到具体一轮，否则迟到的旧轮信号会
  //   压掉正在跑的新轮（用户 2026-10-24：「状态机没考虑 turn，bug 全是 turn 造成的」）。
  //   规则：`running=true(T)` ⇒ 水位=T；`running=false(T)` 仅在 `T >= 水位` 时生效，
  //   `T < 水位`（旧轮的迟到 idle）⇒ **整帧丢弃**（幂等返回原状态，零渲染）。
  let running: boolean = sess.running;
  let runningTurn: TurnID = sess.runningTurn;
  // idle 帧携带的回合号（0 = 未携带）—— 用于判定"陈旧 live"（见下）。
  let idleTurnSig: number = 0;
  if (f.running !== undefined) {
    const sigTurn: TurnID = f.turn !== undefined && f.turn !== null ? f.turn : (0 as TurnID);
    const watermark: number = sess.runningTurn as number;
    const stale: boolean = sigTurn > 0 && watermark > 0 && (sigTurn as number) < watermark;
    if (!stale) {
      running = f.running;
      if (f.running && sigTurn > 0) {
        runningTurn = sigTurn;
      } else if (!f.running) {
        // idle 生效后水位归零（下一轮从 0 重新起算；迟到的更旧 idle 仍由上面 stale 分支挡）
        runningTurn = 0 as TurnID;
        idleTurnSig = sigTurn as number;
      }
    }
  }
  const next = {
    running,
    runningTurn,
    todos: f.todos !== undefined ? f.todos : sess.todos,
    goal: f.goal === undefined ? sess.goal : (f.goal === null ? { kind: 'cleared' as const } : { kind: 'value' as const, objective: f.goal.objective, status: f.goal.status, summary: f.goal.summary }),
    queue: f.queue !== undefined ? f.queue : sess.queue,
  };
  // ⛔ **陈旧 live 必须清空**（用户 2026-11-05 截图：空闲会话末尾还挂着上一轮的「思考 95 字 +
  //   两枚工具」，看起来就是"两个 agent turn 连着渲染"，且那段思考是**老 turn 的**）。
  //   机理：`live` 只在"同号收尾"时被清（`onDone`/`onFinal` 判 `live.turn === f.turn`）；边缘情况下
  //   （跳过 done / 断流重放 / 跨端推进）上一轮的 live 会残留，而它挂在自己的旧回合上 ⇒
  //   该回合的行 = 已提交块 ⊕ 陈旧在飞块 ⇒ 末尾多一段。
  //   ⚠️ 判据必须**窄**：只有「idle 帧携带的回合号 **严格大于** live.turn」才清（= 它收尾的是
  //   更新的回合，旧 live 必然陈旧）。⛔ 不能无条件清：`session(busy=false)` 不带 turn 时，
  //   live 行必须保留（判据 `reduce F1`：idle 只停流，generating 工具不得消失）。
  const staleLive: boolean = idleTurnSig > 0 && s.live !== null
    && (s.live.turn as number) < idleTurnSig;
  const live = staleLive ? null : s.live;
  return { state: { ...s, seq: seqAfter(s, f), sess: next, live }, effects: [] };
}

function onKeepalive(s: State, f: KeepaliveFrame): StepResult {
  return { state: { ...s, seq: seqAfter(s, f) }, effects: [] };
}

// ─── 本机意图 ────────────────────────────────────────────────

function onSend(s: State, f: SendIntent, ts: string): StepResult {
  const row: UserLine = f.row.timestamp !== '' ? f.row : { ...f.row, timestamp: ts };
  // ⛔ **同一条消息只能有一行**（用户 2026-11-16 P0「发消息的一瞬间会弹出两个 user msg」）。
  //   现场：本地乐观行 `user_sent`（requestID = R）之后，服务端还会回显 `user_echo`
  //   （后端把 requestID 序列化进 `WSMessage.ID`，`normalizeUserEcho` 已解析成同一个 R）
  //   ⇒ 旧实现**无条件 append** ⇒ `local.pending` 里同一 R 两行 ⇒ 投影出两条气泡
  //   （直到 `turn_started` 才一起退役，用户看到的就是"发出去一瞬间两个"）。
  //   语义与 web `chat/reduce.ts:1822-1838` **逐字同源**：
  //     ① 该 R 已绑定到某回合的 `user`（`turn_started` 先到）⇒ 零副作用返回；
  //     ② `pending` 里已有同 R 行（乐观行/更早的回显）⇒ **就地替换**（回填权威字段、
  //        清 `sending`、保留原 `id` 以稳定行身份），绝不新增第二行；
  //     ③ 才允许 append。
  //   ⛔ 绝不按**内容**去重（用户连发两条"继续"是两次真消息，必须两行）。
  const rid: string = row.requestID !== undefined && row.requestID !== null ? row.requestID : '';
  if (rid.length > 0) {
    const bound: { v: boolean } = { v: false };
    s.turns.forEach((t: TurnRec): void => {
      if (!bound.v && t.user !== null && t.user.requestID === rid) {
        bound.v = true;
      }
    });
    if (bound.v) {
      return { state: s, effects: [] };
    }
    for (let i = 0; i < s.local.pending.length; i++) {
      const u: UserLine = s.local.pending[i];
      if (u.requestID === rid) {
        const pending: UserLine[] = s.local.pending.slice();
        pending[i] = { ...u, ...row, id: u.id };
        return { state: { ...s, local: { pending } }, effects: [] };
      }
    }
  }
  return { state: { ...s, local: { pending: [...s.local.pending, row] } }, effects: [] };
}

function onAck(s: State, f: AckIntent): StepResult {
  const pending = s.local.pending.filter((u) => u.requestID !== f.requestID);
  const local = pending.length === s.local.pending.length ? s.local : { pending };
  // ⛔ 排队（`queued`）：**只退役 pending 行**，绝不再绑 turn。
  //   2026-10-22 用户亲报「busy 时发消息没被当成排队、按没排队渲染 ⇒ 状态混乱」：
  //   旧实现根本没有这个分支（`adapt` 把 `queued` 吞了）⇒ 这条消息一直挂在消息流里当普通
  //   气泡（还带着「发送中/已送达」语义），而服务端已把它入队 ⇒ 与 StagingTray 的队列视图
  //   互相矛盾。语义与 `reduce.ts:2565`（`queued ⇒ 从 pendingUsers 移除`，StagingTray 是
  //   唯一渲染面）和 web（`useChatMessages.ts:870` 打 `queued:true`）一致。
  if (f.how === 'queued') {
    return { state: { ...s, local }, effects: [] };
  }
  if (f.how === 'delivered' && f.turn === undefined) {
    // ⛔ 已送达但**回包没带 turn_id**：不能把行退役掉（否则用户刚发的消息在 ack 后消失，
    //   直到 `turn_started` 才回来）。保留该行并标 `sending=false`，等 `onOpen` 绑定/清除。
    const kept: UserLine[] = [];
    for (let i = 0; i < s.local.pending.length; i++) {
      const u = s.local.pending[i];
      kept.push(u.requestID === f.requestID ? { ...u, sending: false } : u);
    }
    return { state: { ...s, local: { pending: kept } }, effects: [] };
  }
  if (f.how === 'delivered' && f.turn !== undefined) {
    // ⛔ 已送达 = 该消息**属于 turn N**（权威）⇒ 即使 `turn_started` 还没到，也必须立刻落成
    //   该回合的 user 行：只退役 pending 而不建行 ⇒ 用户自己刚发的消息在 ack 后**消失**，
    //   直到 turn_started 才回来（闪烁；判据 `rowids`「乐观 user 行各一行」）。
    const bound = s.local.pending.find((u) => u.requestID === f.requestID);
    // ⛔ **不把新消息塞进"已经有内容"的旧回合**（用户 2026-11-17 P0）：ack 的 `turn_id` 指向
    //   已收尾/有块的旧回合（服务端忙、号复用、重启后重排）时，旧实现 `turns.set(turn, {...,user})`
    //   会顶掉旧回合的 user 行、旧回复仍排在后面 ⇒ 视觉上「两个 user 连在一起、下面是旧回复」。
    //   ⇒ 这种情况**不绑**（乐观行继续留在 pending ⇒ 永远渲染在最后），等真正的空回合到来再绑。
    const tgt = bound !== undefined ? s.turns.get(f.turn) : undefined;
    const occupied: boolean = tgt !== undefined && (tgt.blocks.length > 0 || tgt.final !== null)
      && (tgt.user === null || tgt.user.requestID !== f.requestID);
    if (bound !== undefined && occupied) {
      const kept: UserLine[] = [];
      for (let i = 0; i < s.local.pending.length; i++) {
        const u: UserLine = s.local.pending[i];
        kept.push(u.requestID === f.requestID ? { ...u, sending: false } : u);
      }
      return { state: { ...s, local: { pending: kept } }, effects: [] };
    }
    if (bound !== undefined) {
      const user: UserLine = { ...bound, sending: false, dbID: f.dbID !== undefined ? f.dbID : bound.dbID };
      const turns = new Map<TurnID, TurnRec>(s.turns);
      const t = s.turns.get(f.turn);
      if (t !== undefined) {
        turns.set(f.turn, { ...t, user });
      } else {
        turns.set(f.turn, newTurn(f.turn, user, f.requestID));
      }
      return { state: { ...s, turns, local }, effects: [] };
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
/**
 * ⛔ **子代理回合号对齐**（用户 2026-11-14 P0「子代理的 shell 转后台之后，该迭代被重复渲染」）。
 *
 * 现场：同一条迭代在界面上出现**两份** —— 一份是**已提交的块**（较早，工具少），另一份是
 *   `live` 尾项（较新，带着后台投递的 `delivered_message` 与新的 Shell 状态），两份的
 *   「思考 N 字」逐字相同。⇒ 说明服务端把**同一条迭代**用**另一个 turn 号**重放过来了。
 *
 * 根因：子代理会话的 turn 号有**两套来源** —— `dump`/`history` 派生的本地回合（1..N）、
 *   SSE `progress` 携带的服务端回合（任意大数）。`onTick/onDone/onFinal` 在"turn 号不认"
 *   时**现场建新回合** ⇒ 同一条迭代被画进两个回合（块进老回合、live 进新回合）⇒ 重复渲染。
 *
 * 修法（只做**保守对齐**，不猜、不删数据）：新回合号的帧若与该 chat 已有回合里**同号迭代**
 *   的正文/思考**逐字相同**（或与当前 `live` 逐字相同）⇒ 归一回合号，交给原有纪律处理
 *   （前沿块由 `onTick` 的迟到帧**合并**吸收）。text 不同则照旧建新回合（可能是真新回合）。
 */
/**
 * `TextPatch` → 纯文本（只有 `full` 能直接取；`delta` 需要基线，调用点用 `applyText`）。
 * 迟到帧合并进块时只吸收 `full` 形态（`delta` 的基线是 live，不适合作块内容）。
 */
function patchText(p: TextPatch | undefined): string {
  if (p === undefined || p === null) return '';
  if (typeof p === 'string') return p as string;
  const t: TextPatch = p;
  return t.kind === 'full' ? t.text : '';
}

function alignSubChatTurn(s: State, f: Frame): Frame {
  if (!isSubChat(s.chat)) return f;
  if (f.kind !== 'tick' && f.kind !== 'done') return f;
  if (s.turns.get(f.turn) !== undefined) return f;
  let iteration: number = 0;
  let content: string = '';
  let reasoning: string = '';
  if (f.kind === 'tick') {
    iteration = f.iteration;
    content = patchText(f.content);
    reasoning = patchText(f.reasoning);
  } else {
    iteration = f.block.iteration;
    content = f.block.content;
    reasoning = f.block.reasoning;
  }
  if (iteration <= 0 || (content.length === 0 && reasoning.length === 0)) return f;
  const hit: { v: TurnID | null } = { v: null };
  s.turns.forEach((t: TurnRec, id: TurnID): void => {
    if (hit.v !== null) return;
    for (let i = 0; i < t.blocks.length; i++) {
      const b: Block = t.blocks[i];
      if (b.iteration !== iteration) continue;
      // ⛔ 只认**该回合的最后一块**：漂移重放的一定是"当前/最后的迭代"，否则会把新内容
      //   嫁接进旧历史中段（`dump` 派生的回合常常已 `final`，也必须允许匹配）。
      if (i !== t.blocks.length - 1) continue;
      // 逐字相同（**所有非空维度都要相等**，避免"通用短句恰好一样"的误对齐）
      const sameContent: boolean = content.length === 0 || b.content === content;
      const sameReason: boolean = reasoning.length === 0 || b.reasoning === reasoning;
      if (sameContent && sameReason && (content.length > 0 || reasoning.length > 0)) {
        hit.v = id;
        return;
      }
    }
  });
  if (hit.v === null && s.live !== null) {
    const l: LiveIter = s.live;
    const liveOpenTurn: TurnRec | undefined = s.turns.get(l.turn);
    const liveOpen: boolean = liveOpenTurn !== undefined && liveOpenTurn.final === null;
    const sameContent: boolean = content.length === 0 || l.content === content;
    const sameReason: boolean = reasoning.length === 0 || l.reasoning === reasoning;
    if (liveOpen && l.iteration === iteration && sameContent && sameReason) {
      hit.v = l.turn;
    }
  }
  if (hit.v === null) {
    // 诊断（保留）：子代理会话要为**不认识的 turn 号**现场建回合 —— 这是重复渲染的唯一入口，
    // 打印出来就能区分"服务端真新回合"与"同一条迭代换了 turn 号重放"。
    console.info(`[SUBCHAT-NEWTURN] turn=${f.turn} iter=${iteration} kind=${f.kind}`);
    return f;
  }
  const turn: TurnID = hit.v;
  // 诊断（保留）：子代理回合号漂移被归一 ⇒ 这条正是"同一迭代被换了 turn 号重放"的证据。
  console.info(`[SUBCHAT-ALIGN] ${f.turn}->${turn} iter=${iteration}`);
  if (f.kind === 'tick') {
    return { ...f, turn } as TickFrame;
  }
  if (f.kind === 'done') {
    return { ...f, turn } as DoneFrame;
  }
  return f;
}

export function step(s: State, input: Frame | SendIntent | AckIntent | FailIntent | DetailInput | { kind: 'resync' } | { kind: 'absent'; turn: TurnID; iteration: IterNum }, ts: string, allowSameSeq: boolean = false): StepResult {
  if (isFrame(input)) {
    const g = envelope(s, input, allowSameSeq);
    if (!g.apply) return { state: s, effects: g.effects };
    const fr: Frame = alignSubChatTurn(s, input);
    switch (fr.kind) {
      case 'open': return onOpen(s, fr);
      case 'tick': return onTick(s, fr);
      case 'done': return onDone(s, fr);
      case 'final': return onFinal(s, fr);
      case 'session': return onSession(s, fr);
      case 'keepalive': return onKeepalive(s, fr);
      default: return { state: s, effects: [] };
    }
  }
  switch (input.kind) {
    case 'send': return onSend(s, input, ts);
    case 'ack': return onAck(s, input);
    case 'fail': return onFail(s, input);
    case 'detail': return onDetail(s, input);
    case 'resync': return { state: s, effects: [{ kind: 'snapshot', chat: s.chat }] };
    case 'absent': return { state: markAbsent(s, (input as { turn: TurnID }).turn, (input as { iteration: IterNum }).iteration), effects: [] };
    default: return { state: s, effects: [] };
  }
}

/**
 * **按号覆盖已提交块**（`/api/iteration_detail`、`/api/regions` 的 hydrate 产物）。
 *
 * ⛔ 为什么必须有它（用户 2026-10-27 P0「历史工具调用打开全是暂无详情」）：`adapt` 曾对
 *   `iterations_loaded` 没有分支 ⇒ 事件被丢弃；而**行源是模型** ⇒ 详情只落到旧管线，
 *   模型块永远没有 `args/detail`。
 *
 * 语义（与 `reduce.ts` 的 `iterations_loaded` 逐条同源）：
 *   · 只动**同号**块，顺序/其余块/`live`/`final`/`user` 一律不变；
 *   · **轻字段永不覆盖已有完整数据**：详情里为空的字段保留原值（防御半截载荷把 pills/正文抹掉）；
 *   · 无变化 ⇒ 返回**同一 state 引用**（幂等，零重渲染）。
 */
function onDetail(s: State, input: DetailInput): StepResult {
  const t: TurnRec | undefined = s.turns.get(input.turn);
  if (t === undefined || input.blocks.length === 0) return { state: s, effects: [] };
  const byIter: Map<IterNum, Block> = new Map<IterNum, Block>();
  for (let i = 0; i < input.blocks.length; i++) {
    byIter.set(input.blocks[i].iteration, input.blocks[i]);
  }
  let changed = false;
  const out: Block[] = [];
  for (let i = 0; i < t.blocks.length; i++) {
    const cur: Block = t.blocks[i];
    const fresh: Block | undefined = byIter.get(cur.iteration);
    if (fresh === undefined) {
      out.push(cur);
      continue;
    }
    const merged: Block = mergeDetailBlock(cur, fresh);
    if (merged !== cur) changed = true;
    out.push(merged);
  }
  // ── **在飞迭代**同样要能补详情（用户 2026-10-28：「最后一个完成的工具看不到详情」）──
  // 根因：一轮的**最后**一次迭代常常仍挂在 `live`（提交可能只来一份轻快照、甚至还没提交），
  //   而 `onDetail` 旧实现只遍历 `t.blocks` ⇒ 拉回来的详情**被丢掉**（在飞 pill 永远无详情）。
  let live: LiveIter | null = s.live;
  if (live !== null && live.turn === input.turn) {
    const freshLive: Block | undefined = byIter.get(live.iteration);
    if (freshLive !== undefined && freshLive.tools.length > 0) {
      const merged: readonly ToolRec[] = mergeToolLists(live.tools, stampTools(freshLive.tools, freshLive.iteration));
      // 兜底再过滤一次：只留**本在飞迭代**的工具（不变量见 `onlyOwnIterTools`）
      const tools: readonly ToolRec[] = onlyOwnIterTools(merged, live.iteration, assignedCalls(s, input.turn));
      if (tools !== live.tools) live = { ...live, tools };
    }
  }
  // ⛔ **详情覆盖层**（用户 2026-11-17：「`+N` 第一次点开看不到参数/输出，关闭再打开才有」）：
  //   `bindPopup` 的子树在打开那一刻构建、之后不会重建 ⇒ 详情对象换了也渲染不到。
  //   ⇒ 权威详情一到就按身份记进覆盖层；浮层组件订阅 `AppStorage('toolDetailGen')` 自渲染，
  //     并用 `withToolDetail` 合上它（字段级补全，不覆盖已有非空值）。
  for (let i = 0; i < input.blocks.length; i++) {
    const fb: Block = input.blocks[i];
    for (let k = 0; k < fb.tools.length; k++) {
      const tr: ToolRec = fb.tools[k];
      rememberToolDetail({
        name: tr.meta.name,
        label: tr.state.label,
        status: tr.state.status,
        summary: tr.meta.summary,
        args: tr.meta.args,
        detail: tr.meta.detail,
        tool_hints: tr.meta.toolHints,
        elapsed_ms: tr.state.elapsedMs,
        exit_code: tr.state.exitCode,
        call_id: tr.call,
        iteration: tr.iteration,
      });
    }
  }

  if (!changed && live === s.live) return { state: s, effects: [] };
  let next: State = s;
  if (changed) {
    const turns = new Map(s.turns);
    turns.set(input.turn, { ...t, blocks: out });
    next = { ...next, turns };
  }
  if (live !== s.live) {
    next = { ...next, live };
  }
  return { state: next, effects: [] };
}

/** 详情块并入已有块（**只补不抹**：空字段保留原值；工具号按块号盖章）。 */
function mergeDetailBlock(cur: Block, fresh: Block): Block {
  const content: string = fresh.content.length > 0 ? fresh.content : cur.content;
  const reasoning: string = fresh.reasoning.length > 0 ? fresh.reasoning : cur.reasoning;
  // ⛔ 逐字段合并（不是整体替换）：详情端点理论上给完整数据，但**轻字段永不覆盖完整数据**
  //   （`/api/regions` 段同样是 `iterations_loaded`，其工具是轻字段）⇒ 同一个合并语义。
  const tools: readonly ToolRec[] = fresh.tools.length > 0
    ? mergeToolLists(cur.tools, stampTools(fresh.tools, fresh.iteration)) : cur.tools;
  const subAgents = fresh.subAgents.length > 0 ? fresh.subAgents : cur.subAgents;
  const genui: string = fresh.genui.length > 0 ? fresh.genui : cur.genui;
  if (content === cur.content && reasoning === cur.reasoning && tools === cur.tools
    && subAgents === cur.subAgents && genui === cur.genui) {
    return cur;
  }
  return {
    iteration: cur.iteration,
    content,
    reasoning,
    tools,
    subAgents,
    genui,
    cancelled: cur.cancelled || fresh.cancelled,
  };
}

/** 应用一批输入（同一批内 effect 去重：同一 (kind,turn,iteration) 只请求一次）。 */
export function stepAll(s: State, inputs: readonly (Frame | SendIntent | AckIntent | FailIntent | DetailInput | { kind: 'resync' })[], ts: string): StepResult {
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
