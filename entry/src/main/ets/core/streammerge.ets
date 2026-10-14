/**
 * 流式（stream_content）与结构化（progress_structured）两类进度事件的**合并语义**。
 *
 * 为什么单独成模块：这两条路径的正确性完全由服务端契约决定，且**极易写错**（已踩）：
 *   - `channel/web/web_hub.go` 的 `normalizeSSEEvent` + `isStreamOnlyProgress`：
 *     只带流式字段的消息被**改型为 `stream_content`**，且此时
 *     **`iteration == 0`、`content == ""`、`tools` 全空**（服务端 `protocol/ws.go`：
 *     `MsgTypeProgress = "progress_structured"`、`MsgTypeStreamContent = "stream_content"`）。
 *   - `protocol/events.go` 的字段命名：流式走 `stream_content`（**检查点**，非空即整体替换）
 *     与 `stream_delta`（**增量**，追加）；推理同理 `reasoning_stream_content` /
 *     `reasoning_stream_delta`；在飞工具是 `streaming_tools`。
 *
 * ⇒ 若把两类事件当成同一种、"整体替换"迭代对象，就会出现：
 *   ① 流式文本永远读不到（字段名不对）；
 *   ② **每个流式帧都把该迭代的 tools/reasoning 清空**（工具 pill 一闪就没）；
 *   ③ 流式帧没有迭代号却按 `iteration ?? 0` 写入 ⇒ 冒出**幽灵「迭代 0」**块。
 *   真机表现即"渲染整个都是错乱的、完全用不了"。
 *
 * 本模块是**纯函数**（不依赖 SDK），由 `tools/tests/streammerge.test.ts` 守护。
 */
import { ChatRow, HistoryIteration, IterList, ProgressEvent, ToolProgress } from './types';
import { DomainEvent, EventSeq, TurnID } from './chat_types_full';
import { ST_GENERATING } from './toolstatus';
import { nonEmpty } from './guards';
// ⛔ ArkTS `arkts-no-misplaced-imports`：**所有 import 必须在文件顶部**（不能放中间）。
//    `toolmerge` 是**纯 `.ts`**（`reduce.ts` 也要用它，而 `core/*.ts` 禁 import `.ets`）。
import { mergeActiveStatus, toolRank } from './toolmerge';

/** 该事件是否"只带流式字段"（与 服务端 isStreamOnlyProgress 同判据，但更宽松：不要求 iteration==0）。 */
export function isStreamOnly(e: ProgressEvent): boolean {
  const hasStream: boolean = nonEmpty(e.stream_content) || nonEmpty(e.stream_delta)
    || nonEmpty(e.reasoning_stream_content) || nonEmpty(e.reasoning_stream_delta)
    || (e.streaming_tools !== undefined && e.streaming_tools.length > 0);
  if (!hasStream) {
    return false;
  }
  // 只要带任一"结构化"字段，就不是纯流式（例如带 iteration_history 的收尾快照）
  return !hasStructured(e);
}

/**
 * 是否携带**结构化载荷**（正文/推理/工具/历史）。
 *
 * ⛔ 迭代号**单独不能**作为判据：服务端会给**流式帧**盖 `iteration`
 * （`agent/engine_wire.go`：让前端在"新迭代只发流式事件、结构化边界事件被合并/丢失"时按迭代清状态）。
 * 若把"有迭代号"当成结构化，流式帧就会走 `applyStructured`，而该函数只认
 * `content/reasoning/tools` ⇒ `stream_content`/`stream_delta`/`reasoning_stream_*`/`streaming_tools`
 * 被**静默丢弃**，且还要过 `seq` 闸 ⇒ **整段流式（思考打字机/正文打字机/工具生成中）全不渲染**，
 * 只在收尾快照才蹦出完整迭代（真机 P0，2026-10-10）。
 */
export function hasStructured(e: ProgressEvent): boolean {
  return nonEmpty(e.content) || nonEmpty(e.reasoning)
    || (e.active_tools !== undefined && e.active_tools.length > 0)
    || (e.completed_tools !== undefined && e.completed_tools.length > 0)
    || (e.tool_calls !== undefined && e.tool_calls.length > 0)
    || (e.iteration_history !== undefined && e.iteration_history.length > 0);
}



/**
 * 取该行的**在飞迭代**（迭代号最大者；没有则按 1 建一个）。
 *
 * 为什么必须这样：`stream_content` 事件**按契约不带迭代号**（`iteration == 0`），
 * 直接按它写入就会造出幽灵「迭代 0」。
 */
export function liveIterationOf(row: IterList): HistoryIteration {
  let best: HistoryIteration | undefined = undefined;
  for (let i = 0; i < row.iterations.length; i++) {
    const it: HistoryIteration = row.iterations[i];
    if (best === undefined || it.iteration > best.iteration) {
      best = it;
    }
  }
  if (best === undefined) {
    nLiveCreated++;                                 // 诊断：旧实现会在这里写迭代 0
    const created: HistoryIteration = { iteration: 1, content: '', reasoning: '', tools: [] };
    // ⛔ **必须换新数组，禁止就地 `push`**（2026-10-12 定案的真根因）：本仓的热路径指纹记忆化
    //    （`core/render.ets` 的 `convertedBlocksMemo`/`completedSigOf`/`liveBlocksSignature`、
    //    `core/streammerge.ets` 的 `blocksSignature`）**按数组/行对象"对象恒等"做缓存键**，
    //    其正确性前提写在它们的注释里：「传进来的数组**整体替换、绝不就地改**」。
    //    而这里是 `ChatRow.iterations`（`types.ets:257` `ChatRow implements IterList`）
    //    ⇒ 就地 push 后**对象没变、内容变了** ⇒ 缓存把**旧指纹**当新 ⇒ 页面那侧
    //    `blocksSig !== liveBlocksSig` **永远相等** ⇒ `@State liveBlocks` 永不重赋
    //    ⇒ **内容冻结在首帧**（真机症状：切到活跃会话整页空白 / "永远加载不完"；
    //    且只对走本条路径的**活跃**会话发作 —— 与"切一部分会话"完全吻合）。
    row.iterations = row.iterations.concat([created]);
    return created;
  }
  return best;
}

/** 按迭代号 upsert（升序插入），返回该迭代对象。 */
export function upsertIteration(row: IterList, iteration: number): HistoryIteration {
  for (let i = 0; i < row.iterations.length; i++) {
    if (row.iterations[i].iteration === iteration) {
      return row.iterations[i];
    }
  }
  const created: HistoryIteration = { iteration, content: '', reasoning: '', tools: [] };
  // ⛔ 同上（见 `liveIterationOf` 的注释）：**换新数组 + 副本排序**，⛔ 不得就地 `push`/`sort`
  //    —— 就地改会让按对象恒等的指纹记忆化返回**旧值**，页面门控永不触发（冻结在首帧）。
  const next: HistoryIteration[] = row.iterations.concat([created]);
  next.sort((a: HistoryIteration, b: HistoryIteration) => a.iteration - b.iteration);
  row.iterations = next;
  return created;
}

/**
 * `toolRank`（状态优先级）与 `mergeActiveStatus`（active 工具「状态只升不降」合并）已**收敛到
 * 纯 `.ts` 的 `./toolmerge`** —— 因为 `reduce.ts`（纯 `.ts`）同样需要它们，而
 * **`core/*.ts` 禁止 import `.ets`**（ArkTS 硬红 `10605999`，见 `docs/ARKTS-GOTCHAS.md`）。
 * 此处**原样转出**（import 在文件顶部 —— ArkTS `arkts-no-misplaced-imports`），
 * 既有调用点（含 `tools/tests/*.ts`）与判据不变。
 */
export { mergeActiveStatus, toolRank };

/**
 * 工具的去重键（同一次调用跨帧必须**稳定**）。
 *
 * · 有 `call_id` ⇒ 用它（服务端给出的真实调用身份，最精确）；
 * · 否则 `generating`（工具名已知、**参数仍在流式增长**）⇒ 只用 `name`：
 *   若把 `label` 纳入键，标签每帧都在变 ⇒ 同一次调用会被追加成**多行**
 *   （web `progressStore.ts:336` 原文："For generating tools, always use tool.name —
 *   the label is still streaming"）；
 * · 其余 ⇒ `name#label`（区分同一迭代里对同一工具的不同参数调用）。
 *
 * ⚠️ 与 web 的**唯一差异**（有据）：web 的 `dedupTools` 每次收到的是**当帧快照**，
 *   故 generating 可以"直接 push、不参与去重"；而本函数是**跨帧累积**（`it.tools`
 *   随每帧增长，见 `applyStreamFrame`/`applyStructured`）⇒ 若照搬"直接 push"，
 *   20Hz 流式帧会**每帧多出一行**（与"每个调用只一行"完全相反）。
 *   故此处对 generating 用**稳定键**就地更新 —— 达到 web "每个调用独立一行"的**同一效果**。
 */
export function toolKey(t: ToolProgress): string {
  if (t.call_id !== undefined && t.call_id.length > 0) { return t.call_id; }
  if (t.status === ST_GENERATING) { return t.name; }
  return `${t.name}#${t.label !== undefined ? t.label : ''}`;
}

/**
 * 工具去重合并 —— 逐帧累积 `prev ⊕ next`（先 prev 后 next）。
 *
 * 语义**对齐 web `progressStore.dedupTools`**：同键时**终态优先**（rank 高者胜）——
 * 陈旧的 running/pending 绝不覆盖更新的 done/error（`progressStore.ts:334-364`）。
 * generating 用稳定键（见 `toolKey`）⇒ 标签流式增长只更新同一行，不新增行。
 */
export function mergeTools(prev: ToolProgress[] | undefined, next: ToolProgress[] | undefined): ToolProgress[] {
  const out: ToolProgress[] = [];
  const indexByKey = new Map<string, number>();
  const take = (list: ToolProgress[] | undefined): void => {
    if (list === undefined) {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const t: ToolProgress = list[i];
      const key: string = toolKey(t);
      const idx: number | undefined = indexByKey.get(key);
      if (idx === undefined) {
        indexByKey.set(key, out.length);
        out.push(t);
        continue;
      }
      const old: ToolProgress = out[idx];
      // 同键：**终态优先**（running 不会被 done/error 覆盖，反之会；pending 不被 running 覆盖）。
      if (toolRank(t.status) > toolRank(old.status)) {
        out[idx] = t;
      } else if (t.status === ST_GENERATING && old.status === ST_GENERATING) {
        out[idx] = t;               // generating→generating：标签仍在流式增长，取最新
      }
      // 否则保留已存在的（更"终态"的那个）
    }
  };
  take(prev);
  take(next);
  return out;
}

/** 事件里携带的工具（结构化优先 completed_tools，再 active_tools，再 tool_calls 形态）。 */
export function toolsFromEvent(e: ProgressEvent): ToolProgress[] | undefined {
  const completed: ToolProgress[] | undefined = e.completed_tools;
  const active: ToolProgress[] | undefined = e.active_tools;
  const streaming: ToolProgress[] | undefined = e.streaming_tools;
  if ((completed !== undefined && completed.length > 0)
    || (active !== undefined && active.length > 0)) {
    return mergeTools(completed, active);
  }
  if (streaming !== undefined && streaming.length > 0) {
    return streaming;
  }
  return undefined;
}

/**
 * 应用一个**流式帧**：增量追加、检查点整体替换；工具只增不减（流式帧不带工具时**绝不清空**）。
 *
 * ⚠️ 这条"只增不减"就是本模块存在的理由：违反它 = 工具 pill 在流式期间一闪就没。
 */
export function applyStreamFrame(it: HistoryIteration, e: ProgressEvent): void {
  nStreamFrames++;
  if (nonEmpty(e.stream_content)) {
    it.stream_text = e.stream_content;              // 检查点：整体替换累积文本
  } else if (nonEmpty(e.stream_delta)) {
    it.stream_text = `${it.stream_text !== undefined ? it.stream_text : ''}${e.stream_delta}`;
  }
  if (nonEmpty(e.reasoning_stream_content)) {
    it.stream_reasoning = e.reasoning_stream_content;
  } else if (nonEmpty(e.reasoning_stream_delta)) {
    it.stream_reasoning = `${it.stream_reasoning !== undefined ? it.stream_reasoning : ''}${e.reasoning_stream_delta}`;
  }
  if (e.streaming_tools !== undefined && e.streaming_tools.length > 0) {
    nToolMerges++;
    it.tools = mergeTools(it.tools, e.streaming_tools);
  }
}

/**
 * 应用一个**结构化帧**：只更新"事件里确实带了"的字段 —— 缺字段时**保留旧值**（绝不清空）。
 *
 * 权威性：结构化帧带 `content`/`reasoning` 时是**权威快照**，直接覆盖并清掉流式缓冲
 * （避免检查点与增量叠加出重复文本）。
 */
export function applyStructured(it: HistoryIteration, e: ProgressEvent): void {
  nStructuredFrames++;
  if (nonEmpty(e.content)) {
    it.content = e.content;
    it.stream_text = '';                            // 权威快照接管，清掉流式缓冲
  }
  if (nonEmpty(e.reasoning)) {
    it.reasoning = e.reasoning;
    it.stream_reasoning = '';
  }
  const tools: ToolProgress[] | undefined = toolsFromEvent(e);
  if (tools !== undefined) {
    nToolMerges++;
    it.tools = mergeTools(it.tools, tools);
  }
  if (e.tools_folded === true && tools === undefined) {
    it.tools_folded = true;
  }
}

/** 该迭代当前应显示的正文：流式缓冲优先（在飞时最新），否则落权威 content。 */
export function displayContent(it: HistoryIteration): string {
  if (nonEmpty(it.stream_text)) {
    return it.stream_text !== undefined ? it.stream_text : '';
  }
  return it.content !== undefined ? it.content : '';
}

/**
 * seq 重放判据（逐字移植 web `chat/reduce.ts` 的 `isStaleSeq`）。
 *
 * ⚠️ 背景（真机 P0：SSE 事件完全不渲染）：`ProgressEvent.Seq` 是 **per-Run** 水位 ——
 * 同一 turn 的 Run 重启后 **seq 从 1 重新计数**，而客户端保留的是旧 Run 的水位。
 * 若只按 `seq <= lastSeq` 丢弃，新 Run 的全部事件会被整批吞掉（live 行永远建不起来）。
 *
 * 证据标准（与遮蔽解除同源）：**迭代号在 turn 域内单调，后端绝不对更早的迭代重发更大号**
 * ⇒ 携带更大迭代号的事件不可能是"已应用过的重放"。
 *
 * 判据：`seq ≤ 水位` **且** 事件不携带任何新迭代信息（`p.iteration > maxKnownIter`，
 * 或 `iteration_history` 中含 `> maxKnownIter` 的迭代）才算重放。
 */
export function isStaleSeqEvent(lastSeq: number, seq: number, maxKnownIter: number,
  p: ProgressEvent): boolean {
  if (lastSeq <= 0 || seq <= 0 || seq > lastSeq) {
    return false;
  }
  if (p.iteration !== undefined && p.iteration > maxKnownIter) {
    return false;
  }
  const hist: HistoryIteration[] | undefined = p.iteration_history;
  if (hist !== undefined) {
    for (let i = 0; i < hist.length; i++) {
      if (hist[i].iteration > maxKnownIter) {
        return false;
      }
    }
  }
  return true;
}

// ⛔ 已删除 `tailOwnedIteration`（bug1「一个 running turn 被渲染两遍」的根因）。
//
// 旧模型：live 行的**最后一个迭代** = 在飞迭代（store 把流式内容折进它），列表跳过它、
// 由尾块渲染 ⇒ 两处必须严格互斥（否则同一迭代画两遍或两处都不画）。
// web 模型：live 行的 `iterations` **只含已完成迭代**；在飞内容（content/reasoning/
// activeTools/streamingTools）是**独立字段**，由 LiveIteration/尾块渲染 —— 二者天然
// 不重叠、无需任何归属判据。原生端已对齐（core/render.ets + store.liveProgress +
// 页面 syncLiveTail）：列表渲染**全部**迭代，尾块渲染在飞快照。

/**
 * 该行的**在飞迭代块**（`live: true` 的那一块；无则 undefined）。
 *
 * 渲染层（`MessageRowView`）与可见性判据（`rowVisibleChars`）读**同一个**函数 ——
 * 不允许两边各自找一遍（那正是"判据/渲染分叉"的温床）。
 */
export function liveBlockOf(row: ChatRow): HistoryIteration | undefined {
  for (let i = row.iterations.length - 1; i >= 0; i--) {
    if (row.iterations[i].live === true) {
      return row.iterations[i];
    }
  }
  return undefined;
}

/**
 * 该行承载的**已完成迭代块**（排除末尾在飞块 `live: true`）。
 *
 * 与 `liveBlockOf` 成对：`完成块 ⊕ 在飞块` 即该行要渲染的全部块。
 * ⛔ 页面（`syncLiveTail` 的已完成块镜像）与渲染层（`blocksFor`）必须读**同一个**
 *   函数 —— 投递源与判据/渲染同源，杜绝"投递的内容与画的内容分叉"。
 */
export function completedBlocks(row: ChatRow): HistoryIteration[] {
  const out: HistoryIteration[] = [];
  for (let i = 0; i < row.iterations.length; i++) {
    if (row.iterations[i].live !== true) {
      out.push(row.iterations[i]);
    }
  }
  return out;
}

/**
 * 块列表的**值指纹** —— 页面把 live 行的已完成块镜像进 `@State liveBlocks` 时用它
 * 判「结构/内容是否变化」：不变则不赋值（避免每帧新数组触发无谓重建）。
 *
 * 含每块的迭代号 / 正文长度 / 思考长度 / 工具数 —— 任一变化即换值（覆盖
 * "同号权威覆盖" 更新已提交迭代内容的场景）。
 *
 * ── 按源数组**对象恒等**记忆化（性能，2026-10-11 round3）──────────────────────────
 * 页面每帧调它 **2 次**（`pages/Index.ets` 的 `blocksSignature(this.liveBlocks) !==
 * blocksSignature(completedBlocks(liveRowRef))`）。`this.liveBlocks` 在内容未变时
 * **是同一数组对象**（只在签名不同时才整体赋值）⇒ 该侧可命中缓存，省掉一次 O(块数) 拼串。
 * 实测（340 块，同一 harness）：调用点形态 **55.7 → 25.8 µs**（省约一半）。
 *
 * ⚠️ 正确性前提（与 `core/render.ets` 的 `liveBlocksMemo`、`core/derive.ts` 的
 *   `assistantRowByTurn` 同一手法）：传进来的数组**整体替换、绝不就地改**。
 *   只按对象恒等取缓存 ⇒ ① 输出逐字节不变（纯函数）；② 换数组（内容变了）必重算。
 *   `WeakMap` 键 ⇒ 数组被 GC 时条目一并回收（**无容量上限、无泄漏**）。
 *   ⛔ 现有调用点已核实**无就地改**（`this.liveBlocks` 只整体赋值；`completedBlocks`
 *   产物只读消费）—— 新增调用点务必遵守此不变量。
 */
const sigMemo = new WeakMap<object, string>();

/**
 * 指纹的**实际计算**（未缓存内核）。
 *
 * ⚠️ 导出是**为基准/判据**用：`blocksSignature` 现在按源数组对象恒等记忆化 ⇒ 对**同一数组**
 *   重复调用会命中缓存（≈0）⇒ 微基准要用"每轮新数组"或直接调本内核才能量到**真 build** 成本。
 *   生产代码请一律走 `blocksSignature`（带缓存）。判据 oracle 与本函数同源（见 stream_perf_equiv §8）。
 */
export function buildBlocksSignature(bs: HistoryIteration[]): string {
  let s: string = `${bs.length}`;
  for (let i = 0; i < bs.length; i++) {
    const b: HistoryIteration = bs[i];
    s += `|${b.iteration}:${(b.content ?? '').length}:${(b.reasoning ?? '').length}`
      + `:${b.tools !== undefined ? b.tools.length : 0}`;
  }
  return s;
}

export function blocksSignature(bs: HistoryIteration[]): string {
  const hit: string | undefined = sigMemo.get(bs);
  if (hit !== undefined) {
    return hit;
  }
  const s: string = buildBlocksSignature(bs);
  sigMemo.set(bs, s);
  return s;
}

/**
 * 在飞**工具列表**的内容签名（纯函数，可脱机单测）。
 *
 * ⛔ 为什么必须有（2026-10-14 用户亲报：「目前 tool `生成中 x 字`，这个 x 不会更新」）：
 *    `pages/Index.syncLiveTail` 原本用**数组恒等**门控投递 `@Prop liveTools`
 *    （`if (this.liveTools !== tools)`），而在飞迭代的 `tools` 数组是**就地更新**的
 *    （同一引用、元素字段在变）⇒ 恒等成立 ⇒ **永不投递** ⇒ `LiveTailView` 收到的是
 *    创建那一刻的引用 ⇒ pill 的 `生成中 N 字`（`t.gen_chars`）、耗时、参数长度全部冻结。
 *    （同族血债见 AGENTS.md「LazyForEach + 最小通知键」与 `blocksSignature` 的门手艺：
 *      **会变的值必须走"内容变化"而非"引用变化"**。）
 *
 * 计入字段 = pill 上**看得见**的一切：状态 / 生成字数 / 退出码 / 耗时 / 调用 id /
 * 参数与输出的长度（长度足以驱动"生成中"字数与详情懒加载的存在性判断）。
 * ⚠️ 刻意**不计** `detail` 全文：那会让每帧拼上千字符的串（`detail` 只在点开浮层时才读）。
 */
export function toolsSignature(ts: ToolProgress[]): string {
  let s: string = `${ts.length}`;
  for (let i = 0; i < ts.length; i++) {
    const t: ToolProgress = ts[i];
    const status: string = t.status !== undefined ? t.status : '';
    const gen: number = t.gen_chars !== undefined ? t.gen_chars : -1;
    const code: number = t.exit_code !== undefined ? t.exit_code : -1;
    const ms: number = t.elapsed_ms !== undefined ? t.elapsed_ms : -1;
    const cid: string = t.call_id !== undefined ? t.call_id : '';
    const argLen: number = t.args !== undefined ? t.args.length : 0;
    const detLen: number = t.detail !== undefined ? t.detail.length : 0;
    s += `|${t.name}:${status}:${gen}:${code}:${ms}:${cid}:${argLen}:${detLen}`;
  }
  return s;
}

/**
 * 「尾部可见内容量」—— 本行**渲染后会真正画出来**的字符数（工具 pill 计 1）。
 *
 * ⛔ 这是「可见性判据」与「渲染内容」的**唯一同源点**（用户 2026-10-10 P0 定稿：
 *   「发送后第一个 SSE 到达占位就消失、中间看不到任何进度」）。
 *   判据点：`rowIsEmpty`（→ `core/indicators.showsBusyPlaceholder` 的
 *   `tailShowsIndicator`）；渲染守卫点：`pages/Index.ChatRowBody` 与
 *   `components/MessageRow.MessageRowView.build`。两处**都**用它
 *   ⇒ 结构上不可能再出现"判据说有、渲染画不出"（占位让位 + 一行空白 = 全空）。
 *
 * 逐条对应 `components/MessageRow.ets` 的 `AssistantBlock`（**改渲染必须同步改这里**）：
 *   · `row.content` **仅当 `iterations` 为空时**才画（有迭代 ⇒ 内容在迭代内渲染，
 *     与 web `AssistantMessage.finalContent = !hasIterations && !liveHasContent` 同判据）；
 *   · 每个迭代块 → `IterationBlock`：思考头(displayReasoning>0) + 正文 + 工具 pill；
 *   · 末尾在飞块（`live:true`）→ `LiveTailView`：同上。
 *
 * ⚠️ 计数按**默认（折叠）态**与渲染逐条对齐：思考只计"头"1 个字符量（展开正文时
 *   渲染更多 —— 故这是**下界**，`>0` 判据不受影响）；正文计全部字符；工具 pill 计 1。
 *   测试 `p0_tail_visibility.test.ts` 用独立 oracle 断言本函数与渲染**逐字同源**。
 */
export function rowVisibleChars(row: ChatRow): number {
  let n: number = 0;
  if (row.content.length > 0 && row.iterations.length === 0) {
    n += row.content.length;
  }
  for (let i = 0; i < row.iterations.length; i++) {
    const it: HistoryIteration = row.iterations[i];
    if (displayReasoning(it).length > 0) {
      n += 1;
    }
    n += displayContent(it).length;
    if (it.tools !== undefined && it.tools.length > 0) {
      n += 1;
    }
  }
  return n;
}

/**
 * 行是否没有任何**可见**内容（渲染出来就是一张空气泡卡片 / 占位符该顶上）。
 *
 * ⛔ 必须是 `rowVisibleChars(row) === 0`（与渲染同源）—— 旧实现无条件把
 *   `row.content` 算作内容，而渲染层只在 `iterations` 为空时才画它 ⇒ 在飞内容
 *   落在 `row.content` 时，判据说"有"、渲染空白（P0）。
 */
export function rowIsEmpty(row: ChatRow): boolean {
  return rowVisibleChars(row) === 0;
}

/** 服务端中断标记的**逐字**形态（`agent/interactive.go:1452` 前置；`:2296-2300` 无正文时用它开头）。 */
export const INTERRUPTED_MARKER: string = '[interrupted]';

/**
 * 剥掉正文**开头**的中断标记（纯函数，可脱机单测）。
 *
 * 为什么必须有（真机缺陷，2026-10-14）：用户点 cancel 后，服务端把中断标记**前置进 assistant
 * 正文**（`agent/interactive.go:1452` `content = "[interrupted] " + content`；无正文时
 * `:2296-2300` 为 `"[interrupted] Agent was interrupted."`；亦有恰好等于标记的落库行 ——
 * 见 `storage/sqlite/migrations.go:3434` 与 `agent/turn_id_persist_test.go:100`）。
 * web 权威**不把它当用户可见正文**：有 live 流式内容时**优先显示 live**（`messageStore.ts:626-640`
 * 「`[interrupted]` 只是中断标记」），纯标记行按 `display_only` 语义处理
 * （`useChatMessages.ts:132`）。本仓此前对两者**零消费**（`core/chattypes.ts:247` 只声明了
 * `displayOnly` 字段，全仓无消费点）⇒ 中文界面里漏出一行裸英文 token `[interrupted]`
 * （真机截图 `/tmp/s3_chat.jpeg`：用户气泡正下方）。
 *
 * 语义（⛔ 只剥**开头**那一个标记 + 紧随其后的空白，不改写其余内容 —— 不许发明文案）：
 *   · 不以标记开头 ⇒ **原样返回**（零副作用）；
 *   · 开头是标记 ⇒ 去掉标记与紧随的空格/换行；剩余正文**逐字保留**（如 `Agent was interrupted.`）。
 */
export function stripInterruptedMarker(content: string): string {
  if (!content.startsWith(INTERRUPTED_MARKER)) {
    return content;
  }
  let i: number = INTERRUPTED_MARKER.length;
  while (i < content.length) {
    const c: string = content.charAt(i);
    if (c !== ' ' && c !== '\n' && c !== '\t') {
      break;
    }
    i += 1;
  }
  return content.substring(i);
}

/**
 * 尾部行是否正在渲染**在飞信号**（末尾 `live:true` 块里有 思考/正文/工具）。
 *
 * 这是「尾部有没有『进行中』信号」的**唯一判据**（用户 2026-10-10 点名 ①）：
 *   「每个 iter 刚完成、下一个 iter 的 SSE 到来之前，应该也要渲染思考中」。
 *
 * ⛔ **绝不是「行非空」**（`!rowIsEmpty`）：`rowVisibleChars` 数的是**整行**可见内容，
 *   其中包含**已提交（历史）迭代块**。迭代刚 commit、下一迭代首个 delta 还没到（空隙）时，
 *   行非空（历史块在）但**没有任何在飞信号** —— 用「行非空」当在飞判据 ⇒ 占位符被抑制
 *   ⇒ 空隙里什么都没有。
 *
 * 对齐 web（唯一参照）：`MessageList.tailShowsIndicator` 用
 *   `tailIsLiveRow && (compressing || (streaming && liveIterationInFlight(...)))`；
 *   `progressStore.liveIterationInFlight` 语义 =「**进行中的那个迭代尚未作为历史渲染过**」。
 *   空隙时进行中号已被历史渲染 ⇒ `false` ⇒ 尾部**无在飞信号** ⇒ 由列表尾「思考中…」占位承担。
 *   原生端等价物 = 末尾在飞块（`live:true`，由 `core/render.ets` 从在飞字段折叠）里
 *   确有可见内容 —— 与渲染同源（同一个 `liveBlockOf`）。
 *
 * 不变量（恰好一个指示器）：有在飞信号 ⇒ 占位让位；无 ⇒ 占位出现；
 *   任何时刻不允许「两者皆无」。
 */
export function rowHasInFlightSignal(row: ChatRow): boolean {
  const b: HistoryIteration | undefined = liveBlockOf(row);
  if (b === undefined) {
    return false;
  }
  if (displayReasoning(b).length > 0) {
    return true;
  }
  if (displayContent(b).length > 0) {
    return true;
  }
  if (b.tools !== undefined && b.tools.length > 0) {
    return true;
  }
  return false;
}

/** 该迭代当前应显示的推理文本。 */
export function displayReasoning(it: HistoryIteration): string {
  if (nonEmpty(it.stream_reasoning)) {
    return it.stream_reasoning !== undefined ? it.stream_reasoning : '';
  }
  return it.reasoning !== undefined ? it.reasoning : '';
}

/**
 * 整条**助手消息**的「回复」取文 —— **逐字对齐 web `MessageActions.resolveCopyText`**
 * （`web/src/components/agent/MessageActions.tsx:31-41`）：
 *   ① 顶层 `rowContent` 非空 ⇒ 用它；
 *   ② 否则**从最后一个迭代往前扫**：该迭代的正文非空 ⇒ 用它，否则**再看它的推理**，
 *      两者皆空才退到前一个迭代。
 *
 * ⛔ 为什么不能用"只看最后一个迭代"（原实现）：末迭代常常是「**工具收尾**」或「**仅思考**」
 *   （本目标要求②里"iter 结束如果最后没 tool 则 turn 结束"那类行的近亲）⇒ 其 `content` 为空，
 *   而该行**明明有正文**（在更早的迭代里）⇒ 长按「复制回复」产出空串
 *   （用户 2026-10-13 亲报「长按复制会提示没有可复制的内容」的**取文侧根因**；
 *   菜单侧另有一层"空项过滤"，见 `core/ctxmenu.rowMenuItems` —— 但过滤只是把死项藏起来，
 *   取文侧不修用户**仍复制不到正文**，故两层都要）。
 */
export function resolveRowReply(rowContent: string, its: HistoryIteration[]): string {
  if (nonEmpty(rowContent)) {
    return rowContent;
  }
  for (let i = its.length - 1; i >= 0; i--) {
    const it: HistoryIteration = its[i];
    const c: string = displayContent(it);
    if (nonEmpty(c)) {
      return c;
    }
    const r: string = displayReasoning(it);
    if (nonEmpty(r)) {
      return r;
    }
  }
  return '';
}


// ── 工具 pill 的**分组 / 折叠**（逐字移植 web，纯函数 ⇒ 可脱机单测）──────────────
// web 权威：
//   · 同一迭代内 `MergedPills`（`FoldedToolGroup.tsx:541-574`）——每工具一枚 pill，
//     全部塞进一个 flex-wrap 行；>8 枚时前 7 枚 + `+N` 徽标（`:41-42, 551-552`）。
//   · 跨迭代 `mergeToolRuns`（`TurnBody.tsx:942-967`）——把**连续「纯工具」迭代**
//     （含工具且无 content 且无 reasoning）吸收进**前一个**含工具迭代，保留 head 迭代号。
// 由 `tools/tests/toolgroup.test.ts` 守护；UI 层（MessageRow/LiveTailView）只消费结果。

/** 折叠行 pill 上限：**超过** 8 枚 ⇒ 前 7 枚 + `+N`（web `PILL_INLINE_MAX`/`PILL_INLINE_HEAD`）。 */
export const PILL_INLINE_MAX: number = 8;
export const PILL_INLINE_HEAD: number = 7;

/** pill 行的折叠结果（`shown` = 直出的 pill；`hidden` = 收进 `+N` 的 pill）。 */
export interface PillSlice {
  shown: ToolProgress[];
  hidden: ToolProgress[];
  overflow: boolean;
  hideCount: number;
}

/**
 * 把一段工具列表折成「≤8 全量；>8 前 7 + `+N`」——逐字移植 web `MergedPills`。
 *
 * ⚠️ 边界：`length === 8` **不折叠**（web 判据是 `tools.length > PILL_INLINE_MAX`）；
 * 顺序**原样保留**（先出现的在 `shown` 里、被收纳的按原顺序进 `hidden`）。
 */
export function foldPills(tools: ToolProgress[]): PillSlice {
  const overflow: boolean = tools.length > PILL_INLINE_MAX;
  const shown: ToolProgress[] = [];
  const hidden: ToolProgress[] = [];
  for (let i = 0; i < tools.length; i++) {
    if (overflow && i >= PILL_INLINE_HEAD) {
      hidden.push(tools[i]);
    } else {
      shown.push(tools[i]);
    }
  }
  return { shown, hidden, overflow, hideCount: hidden.length };
}

/** 该迭代是否"含工具"（web `mergeToolRuns.hasTools`）。 */
function iterHasTools(it: HistoryIteration): boolean {
  return it.tools !== undefined && it.tools.length > 0;
}

/** 该迭代是否"纯工具"（含工具且无正文且无推理）——可被前一个含工具迭代吸收（web `absorbs`）。 */
function iterAbsorbable(it: HistoryIteration): boolean {
  return iterHasTools(it) && !nonEmpty(it.content) && !nonEmpty(it.reasoning);
}

/** 把 head 的字段与吸收来的工具合成合并块（⛔ ArkTS 禁 spread ⇒ 逐字段拷贝）。 */
function mergeIntoHead(head: HistoryIteration, tools: ToolProgress[], blockFolded: boolean): HistoryIteration {
  const out: HistoryIteration = {
    iteration: head.iteration,
    content: head.content,
    reasoning: head.reasoning,
    tools,
    tools_folded: head.tools_folded === true || blockFolded,
  };
  // 保留 head 的其它渲染字段（live / 流式缓冲 / 创建时间）——渲染层仍要读它们。
  if (head.created_at !== undefined) {
    out.created_at = head.created_at;
  }
  if (head.live !== undefined) {
    out.live = head.live;
  }
  if (head.stream_text !== undefined) {
    out.stream_text = head.stream_text;
  }
  if (head.stream_reasoning !== undefined) {
    out.stream_reasoning = head.stream_reasoning;
  }
  return out;
}

/**
 * 连续「纯工具」迭代合并进前一个含工具的迭代 —— **逐字移植** web `TurnBody.mergeToolRuns`
 * （`TurnBody.tsx:942-967`）。
 *
 * 规则（与 web 一一对应）：
 *   · 头部迭代**可以**带 reasoning/content（工具行与文本块同属该迭代）；只有**后续成员**
 *     才要求"只有工具"（`!content && !reasoning`）⇒ 文本不合并、不丢失；
 *   · 合并后**保留头部迭代号**（高度缓存 / 窗口 key 稳定）；
 *   · 工具**顺序** = 先 head 后各成员（先出现的在前）；
 *   · `tools_folded` **聚合**（任一成员带标记 ⇒ 合并块带标记）——成员 pill 的详情 gate 不失明。
 *
 * ⚠️ 无工具迭代原样透传（**不做**跨文本合并）。返回新数组；未合并的 head 保持**对象恒等**
 *   （ArkUI ForEach 复用友好）。
 */
export function mergeToolRuns(iters: HistoryIteration[]): HistoryIteration[] {
  const out: HistoryIteration[] = [];
  let i: number = 0;
  while (i < iters.length) {
    const head: HistoryIteration = iters[i];
    const headTools: ToolProgress[] = head.tools !== undefined ? head.tools : [];
    if (headTools.length === 0) {
      out.push(head);
      i++;
      continue;
    }
    const tools: ToolProgress[] = [];
    for (let k = 0; k < headTools.length; k++) {
      tools.push(headTools[k]);
    }
    let j: number = i;
    let blockFolded: boolean = head.tools_folded === true;
    while (j + 1 < iters.length && iterAbsorbable(iters[j + 1])) {
      j++;
      const member: HistoryIteration = iters[j];
      const mt: ToolProgress[] = member.tools !== undefined ? member.tools : [];
      for (let k = 0; k < mt.length; k++) {
        tools.push(mt[k]);
      }
      if (member.tools_folded === true) {
        blockFolded = true;
      }
    }
    if (j === i) {
      out.push(head);
    } else {
      out.push(mergeIntoHead(head, tools, blockFolded));
    }
    i = j + 1;
  }
  return out;
}


// ── 会话状态事件（`session`）的语义 ─────────────────────────────────────────
/**
 * 服务端 `SessionEvent` 的状态字段是 **`action`**（`protocol/events.go`：`Action string json:"action"`），
 * 取值实测含 `idle` / `busy` / `history_rewound` / `subagent_started|stopped` / `user_msg` /
 * `agent_msg` / `progress` / `sync_progress` …
 *
 * ⚠️ 客户端曾读 `ev.state` ⇒ 恒为 `undefined` ⇒ **整条会话状态更新是死代码**
 * （收尾后界面可能一直停在"运行中/停止"）。此处把判定抽成纯函数，由单测锁死。
 */
export function isIdleAction(action: string): boolean {
  return action === 'idle' || action === 'agent-idle';
}

export function isBusyAction(action: string): boolean {
  return action === 'busy' || action === 'agent-busy';
}

/** 历史被回退（rewind）⇒ 必须重载历史，否则界面停留在被撤销的内容上。 */
export function shouldReloadHistory(action: string): boolean {
  return action === 'history_rewound';
}

/**
 * 本批归一化事件里是否含**新鲜**（非回放）的 `phase_done` —— 即"这一帧就是 turn 结束"。
 *
 * 为什么需要它（用户 2026-10-12 目标②：*"iter 结束如果最后没 tool … 应该立刻进入 idle"*）：
 *   服务端 `PhaseDone`（`progress.phase === 'done'`）是 turn 结束的**最快**权威信号，
 *   而 `session(idle)` 要等 `Run()` **完全退出后**才发（`agent/agent.go:3531` 的 defer）。
 *   web 因此专门在 PhaseDone 时 `dispatchAgentIdle`（`useProgressStream.ts:1190-1198`）把会话
 *   **内存内**置 idle；原生此前完全缺这一路 ⇒ composer 的 busy 只能等 `session(idle)` → REST 往返。
 *
 * 判据（逐字对齐 web `useProgressStream.ts:1154/1166-1176`）：
 *   ① 有 `phase_done` 事件；
 *   ② 它**不陈旧**：`seq` 缺失（宽容）或 `seq > 上一帧水位`（重放事件 seq ≤ 水位 ⇒ 跳过，
 *      否则切到 busy 会话时回放的**上一回合** PhaseDone 会把在跑回合误置 idle）；
 *   ③ 它指向**当前活动 turn**（`turnID === null` 回退 activeTurn；turnID 与 activeTurn 不符
 *      ⇒ 属别的 turn，不动本会话）。
 *
 * 由 `tools/tests/streammerge.test.ts` 守护（判别力：去掉任一守卫 ⇒ 对应断言必红）。
 *
 * @param evs 本帧归一化结果（`pushEvents` 的入参）
 * @param lastSeqBefore 必须是 `pushEvents` **之前**的水位（事件应用后水位会前移）
 * @param activeTurn 当前活动 turn（`state.activeTurn`）
 */
export function hasFreshPhaseDone(
  evs: readonly DomainEvent[] | null,
  lastSeqBefore: EventSeq | null,
  activeTurn: TurnID | null,
): boolean {
  if (evs === null) {
    return false;
  }
  for (let i = 0; i < evs.length; i++) {
    const ev: DomainEvent = evs[i];
    if (ev.type !== 'phase_done') {
      continue;
    }
    if (ev.seq !== null && lastSeqBefore !== null && ev.seq <= lastSeqBefore) {
      continue; // 陈旧/回放 —— 不置 idle
    }
    if (ev.turnID !== null && activeTurn !== null && ev.turnID !== activeTurn) {
      continue; // 属别的 turn
    }
    return true;
  }
  return false;
}


// ── 运行计数（诊断用：让一张自检页截图就能证明"两条路真的走对了"）──────────────
let nStreamFrames: number = 0;      // 收到的流式帧数
let nStructuredFrames: number = 0;  // 收到的结构化帧数
let nToolMerges: number = 0;        // 工具合并次数（>0 说明工具没被清空过）
let nLiveCreated: number = 0;       // 由流式帧首次建出"在飞迭代"的次数（旧实现会在此写 0）

/**
 * 一行计数摘要（自检页显示）。
 * 判读：**结构化帧数 > 0 且工具合并 > 0** = 工具 pill 走了正确的合并路径（不会被清空）；
 * 若"流式帧数 > 0 但结构化帧数 == 0"，说明只有流、没有结构化 ⇒ 需检查服务端是否在发 progress_structured。
 */
export function streamStatsText(): string {
  return `流式帧=${nStreamFrames} 结构化帧=${nStructuredFrames} 工具合并=${nToolMerges}`
    + ` 在飞迭代新建=${nLiveCreated}`;
}
