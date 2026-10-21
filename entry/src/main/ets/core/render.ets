/**
 * render.ets —— 派生行（`deriveRows` 的 `Row` 判别联合）→ 原生渲染行 `ChatRow` 的适配层。
 *
 * 对齐 web：渲染行一律来自 `deriveRows(state)`（`useChatMessages` 的同一模型）。
 * 原生渲染组件（MessageRowView / LiveTailView）消费的是 `ChatRow`（@Observed class），
 * 字段与 web `ChatMessage` 一一对应 —— 本模块做**受控映射**（纯函数），
 * 是状态机（web 语义）与既有 ArkUI 组件之间的唯一形状转换点。
 *
 * ⚠️ 与 web 的差异（唯一一处，理由充分）：web 的 live 行把「在飞内容」
 * （content/reasoning/activeTools/streamingTools）放在 Row 的顶层字段、`iterations`
 * 只含**已完成**迭代；原生把在飞内容交给列表尾的 `LiveTailView`（页面 @State），
 * 所以 `ChatRow.iterations` = 已完成迭代、在飞内容不进 `iterations` —— **同一语义的
 * 两种承载**：任何迭代都只被渲染一次（列表 or 尾块），不存在尾块"占用最后一个迭代"
 * 的重叠（这正是 bug1「一个 running turn 被渲染两遍」的根治点）。
 */
import { ChatRow, HistoryIteration, IterBlocks, IterList, ToolProgress } from './types';
import { WebCompaction, WebIteration, WebSubAgentProgress, WebToolProgress } from './chattypes';
import type { LiveRowView, Row } from './derive';
import { completedBlocks, mergeToolRuns, mergeTools, toolKey } from './streammerge';

/** 共享空压缩点列表（live/user 行无压缩点 ⇒ 零分配）。 */
const NO_COMPACTIONS: WebCompaction[] = [];

/**
 * 维护「已完成块列表」持有者（`ChatRow.iterBlocks`，`@Observed`）。
 *
 * ⛔ 判据/不变量（见 `docs/PERF-BOUNDS.md §3`）：**只在块列表/压缩点真正变化时赋值**。
 *   订阅者 `IterBlocksView` 因此**零重建**地跨越整个流式回合 —— 每帧成本与块数 N 无关。
 *   等价性是**引用判等**（`mergeToolRuns` / `completedBlocks` 都按源数组恒等记忆化）
 *   ⇒ 没有字符串指纹、没有 O(N) 比较。
 */
function syncIterBlocks(row: ChatRow, blocks: HistoryIteration[], comps: WebCompaction[],
  turnID: number): void {
  const holder: IterBlocks = row.iterBlocks;
  const merged: HistoryIteration[] = mergeToolRuns(blocks);
  if (holder.blocks !== merged) {
    holder.blocks = merged;
    holder.rev = holder.rev + 1;
  }
  if (holder.compactions !== comps) {
    holder.compactions = comps;
    holder.rev = holder.rev + 1;
  }
  if (holder.rowID !== row.id) {
    holder.rowID = row.id;
  }
  if (holder.turnID !== turnID) {
    holder.turnID = turnID;
  }
}


/** WebToolProgress（web 形状）→ 原生 ToolProgress（渲染层形状）。 */
export function toToolProgress(t: WebToolProgress): ToolProgress {
  const out: ToolProgress = {
    name: t.name,
    label: t.label,
    status: t.status,
    elapsed_ms: t.elapsedMs,
    summary: t.summary,
    detail: t.detail,
    args: t.args,
    call_id: t.callID,
    ui_mode: t.uiMode,
    gen_chars: t.genChars,
    tool_hints: t.toolHints,
  };
  if (t.uiLibs !== undefined) {
    out.ui_libs = t.uiLibs;
  }
  return out;
}

/**
 * 该工具是否属于「当前（**未提交**）迭代」—— web `LiveIteration.tsx` `toolDeriv` **逐字**：
 *   `t.iteration === undefined || t.iteration === null || t.iteration > maxCompletedIter`
 * （`null` 分支由 `normalizeWebTool` 统一收敛成 `undefined`，故此处只需判 `undefined`。）
 *
 * ⛔ 缺这一步 ⇒ 陈旧 `pending`/`generating` 工具永久渲染在最新在飞块
 *    （服务端整批先标 `pending`：`agent/engine_run_tools.go:49-64`；
 *     服务端点名此过滤必须由前端承担：`agent/engine_wire.go:2436-2445`）。
 *    用户亲报症状：「所有 tool 都渲染为排队 / executing 的 tool 被渲染成排队」。
 */
export function isCurrentIterTool(t: WebToolProgress, maxCompletedIter: number): boolean {
  // ⛔ **在飞的工具永不按迭代号过滤**（2026-10-12 真机 P0 用户实拍：迭代里
  //    `tool1(排队) tool2(排队)` 而**没有任何 executing**）：
  //    服务端整批先标 `pending` 且**可能带着上一迭代的号**（`agent/engine_run_tools.go:49-64`
  //    到 goroutine 启动才翻 `running`；`engine_wire.go:2436-2445` 点名"必须由前端按 iteration
  //    过滤"），于是 **`running` 但号陈旧的那一个被滤掉，而号为空(`null`)的 `pending` 全留下**
  //    ⇒ 画面上就是"清一色排队"💥。而 `running`/`generating` 按定义**就是此刻在执行的那一个**
  //    ①它必须可见 ②用户明确要求"不可能所有 tool 都在排队"。
  //    ⇒ 只有**非在飞**（`pending`/终态）才走迭代号过滤（那正是滤掉"过去迭代残留 pending"的本意）。
  const s: string = t.status !== undefined ? t.status : '';
  if (s === 'running' || s === 'executing' || s === 'generating') {
    return true;
  }
  const it: number | undefined = t.iteration;
  if (it === undefined) {
    return true;
  }
  return it > maxCompletedIter;
}

/** `WebToolProgress[]` → `ToolProgress[]`（页面 live 尾块的工具列表用）。 */
export function toNativeTools(ws: readonly WebToolProgress[]): ToolProgress[] {
  const out: ToolProgress[] = [];
  for (let i = 0; i < ws.length; i++) {
    out.push(toToolProgress(ws[i]));
  }
  return out;
}

/**
 * `readonly WebSubAgentProgress[]`（状态机形状，只读）→ 渲染层**可变拷贝**。
 *
 * 与 `toHistoryIterations` 同款：JS/ArkTS 侧 `readonly T[]` 与 `T[]` 不通用 ⇒ 显式拷贝。
 * 元素本身**透传引用**（`WebSubAgentProgress` 只读消费，不就地改源）。
 * 缺省/空 ⇒ 空数组（**不新增键**的判定由调用方做，见 `toHistoryIteration`）。
 */
function toSubAgents(ws: readonly WebSubAgentProgress[] | undefined): WebSubAgentProgress[] {
  const out: WebSubAgentProgress[] = [];
  if (ws !== undefined) {
    for (let i = 0; i < ws.length; i++) {
      out.push(ws[i]);
    }
  }
  return out;
}

/**
 * ⛔ **已删除 `subAgentSig` / `subAgentsFingerprint`（字符串指纹）**：
 * 页面投递 `liveSubAgents` 改为比较 `ChatRow.liveRevision`（整数，见 applyRow）
 * —— 变化判据是 Row 对象恒等，不再拼树描述字符串（O(子代理数×描述长度)/帧）。
 */

/**
 * 渲染块的**整数版本号分配器**。
 *
 * ⛔ 只用单调整数，**绝不**拼内容字符串/比较正文：源 `WebIteration` 对象不变 ⇒
 * 复用同一个 `HistoryIteration`（连同 rev）⇒ 内层 ForEach key 不变 ⇒ 零重建。
 */
let iterRevSeq: number = 0;

/** 源 `WebIteration` → 渲染块（按**对象恒等**记忆化）。 */
const iterBlockBySource = new WeakMap<object, HistoryIteration>();

/** WebIteration（web 形状）→ HistoryIteration（渲染层形状）。 */
export function toHistoryIteration(w: WebIteration): HistoryIteration {
  const hit: HistoryIteration | undefined = iterBlockBySource.get(w);
  if (hit !== undefined) {
    return hit;
  }
  const tools: ToolProgress[] = [];
  for (let i = 0; i < w.tools.length; i++) {
    tools.push(toToolProgress(w.tools[i]));
  }
  const out: HistoryIteration = {
    iteration: w.iteration,
    content: w.content,
    reasoning: w.reasoning,
    tools,
    tools_folded: w.toolsFolded === true,
    rev: ++iterRevSeq,
  };
  // SubAgent 树：**只在有值时新增键**（无 SubAgent 的迭代保持既有形状不变 —— 零回归）。
  const subs: WebSubAgentProgress[] = toSubAgents(w.subAgents);
  if (subs.length > 0) {
    out.subAgents = subs;
  }
  iterBlockBySource.set(w, out);
  return out;
}

/** WebIteration[] → HistoryIteration[]。 */
export function toHistoryIterations(ws: readonly WebIteration[]): HistoryIteration[] {
  const out: HistoryIteration[] = [];
  for (let i = 0; i < ws.length; i++) {
    out.push(toHistoryIteration(ws[i]));
  }
  return out;
}

/**
 * live 行的**在飞迭代块** —— 从 live Row 的在飞字段（content/reasoning/
 * activeTools/streamingTools）折叠出的最后一个迭代块。
 *
 * 对齐 web：`TurnBody` 在渲染完 `iterations`（已完成）之后，**在同一气泡内**
 * 追加 `<LiveIteration progress=…>`；native 的一行 = 一条消息 = 一个气泡 ⇒
 * 等价做法是把这块并进 `ChatRow.iterations` 的**末尾**（`live: true`），
 * 由同一套块渲染器画出（只有它带打字机/占位）。**不是**第二个气泡/第二行 ——
 * 这正是真机 bug ②「live 迭代是单独的气泡」的根治点。
 *
 * ⛔ P0（2026-10-10 第二次点名「第一个 SSE 到达占位就消失、中间看不到任何进度、
 *   直到迭代结束才一次性蹦出」）根因与修法：
 *   旧实现**只在 `lastIter > maxCompleted` 时**追加在飞块。但服务端会在迭代边界 /
 *   工具相变时把**当前在飞迭代**（此刻往往还是**空壳**）记进 `iteration_history`
 *   ⇒ `maxCompleted === lastIter` ⇒ 在飞块**永不追加**；而在飞内容（content /
 *   reasoning / streamingTools）照常落在 live Row 的顶层字段。于是
 *   `rowIsEmpty`（旧实现无条件数 `row.content`）说"有内容" ⇒ 占位让位；渲染层
 *   （`AssistantBlock` 只在 `iterations` 为空时画 `row.content`，且没有在飞块）
 *   **画不出任何东西** ⇒ 占位没了 + 内容不可见 = 全空。
 *   修法：只要在飞字段有**尚未被历史渲染**的内容就追加在飞块（给它一个渲染位）；
 *   内容为空（无正文/思考/工具）时不追加（空态由列表尾「思考中…」占位承担 ——
 *   与 web 的"恰好一个指示器"不变量同构）。
 *
 * 字段级去重**逐字对齐** web `LiveIteration` 的 `effectiveStreamContent` /
 * `effectiveReasoning`：与**任一**已完成迭代的对应字段相同 ⇒ 该内容已被历史块渲染
 * ⇒ 置空，避免同一段文本在历史块与在飞块各渲染一份（双渲染）。
 */
export function inFlightBlock(r: LiveRowView, completed: HistoryIteration[]): HistoryIteration | null {
  // ⛔ **禁止用字符串比较内容去重**：旧实现在这里把 `r.content` 与每条已完成迭代的
  //   `content` 逐字比较（O(总字数)/帧），既慢又违反"禁止内容比较去重"。
  //   正确性由**调用条件**保证：只有 `lastIter > maxCompleted`（新迭代，必无同号块）
  //   或 `shellSameNum`（同号已完成块是**空壳**——无正文/思考/工具）才进入本函数 ⇒
  //   同号块即使存在也没有可重复的内容。因此无需任何正文比较。
  // ⛔ 2026-10-21 P0 兜底（用户截图：同一段「思考 1400 字」在历史块与在飞块各渲染一次）：
  //   转后台等场景下，服务端的**推进事件**会把刚提交那一迭代的正文/思考再带一遍，
  //   reduce 侧的等长判据（`isCommittedCopy`）在"提交与推进分属两条事件"时可能漏
  //   （事件的 `iter` 已经先前进、delta 又晚到）。这里在**渲染层**再加一道**等长**判据：
  //   在飞文字若与**最新已提交块**同名字段等长 ⇒ 它已经在历史块里渲染过 ⇒ 置空。
  //   只比长度（与 `sameRowEssence` 同一纪律，禁止全文比较）；误判代价只是晚一拍
  //   （下一帧 delta 会带来新长度），绝不丢内容（历史块那份额度还在）。
  // ⛔ 兜底判据：与**任意**已提交块的同名字段等长 ⇒ 视为重复（不能只比最后一页：
  //   真实形态是「B 迭代有 1400 字思考 → C 迭代只有工具没有思考 → 在飞块继承了 1400」，
  //   只比 C（长度 0）会漏判）。从**末尾往前**找第一个非空者，通常一步命中 ⇒ 常态 O(1)。
  // ⛔ 用户 2026-10-21（`ui-state` 审计）：判据范围必须是**同号迭代**，不能是"任意已提交块"——
  //   否则新一轮输出与某个更早的已提交块逐字相同（重试同一条回答、短答「好的」）时，
  //   在飞块会被整块判成"重复" ⇒ `return null` ⇒ **该页在飞期永久不可见**（只看到「思考中…」）。
  //   真实重复形态只有一种：**刚提交的那一迭代**（转后台/推进帧回带它的正文或思考），
  //   其迭代号 = `r.lastIter`（同号提交）。⇒ 只跟 `iteration === r.lastIter` 的块比。
  let sameNumReasonLen: number = -1;
  let sameNumContentLen: number = -1;
  let sameNumReasoning: string = '';
  let sameNumContent: string = '';
  for (let i = 0; i < completed.length; i++) {
    const blk: HistoryIteration = completed[i];
    if (blk.iteration !== r.lastIter) {
      continue;
    }
    sameNumReasoning = blk.reasoning !== undefined ? blk.reasoning : '';
    sameNumContent = blk.content !== undefined ? blk.content : '';
    sameNumReasonLen = sameNumReasoning.length;
    sameNumContentLen = sameNumContent.length;
    break;
  }
  const rawContent: string = r.content;
  const rawReasoning: string = r.reasoning;
  // 先比长度（O(1) 快路），**等长且全等**才判重复（极少命中）⇒ 不是每帧全文比较。
  const dupContent: boolean = rawContent.length > 0 && rawContent.length === sameNumContentLen
    && sameNumContent === rawContent;
  const dupReasoning: boolean = rawReasoning.length > 0 && rawReasoning.length === sameNumReasonLen
    && sameNumReasoning === rawReasoning;
  const content: string = dupContent ? '' : rawContent;
  const reasoning: string = dupReasoning ? '' : rawReasoning;
  const tools: ToolProgress[] = [];
  // ── live 工具列表 = web `LiveIteration.tsx` `toolDeriv` 的**三步**（本仓曾缺第 ① 步）──
  // ① **按 `iteration` 滤掉陈旧工具**（web 逐字：`t.iteration > maxCompletedIter`）；
  // ② 按 `toolKey` 去重（web `dedupTools`；本仓复用 `streammerge.mergeTools` ⇒ 同一调用只一行）；
  // ③ 滤掉**已提交迭代里**的同名同标签工具（web `completedIterToolKeys`）—— 否则陈旧 active/streaming
  //    与刚提交的迭代会各渲染一枚 pill（真机上「同一工具两行」，见 WEB-PARITY §12-B）。
  //
  // ⛔ 为什么第 ① 步**必须**有（用户 2026-10-11 亲报「所有 tool 都渲染为排队 / executing 的 tool
  //    被渲染成排队」的根因）：
  //    · 服务端在整批派发工具时把 `active_tools` **全部先标 `pending`**
  //      （`agent/engine_run_tools.go:49-64`），到各自 goroutine 启动才翻 `running`（`:150`）；
  //    · 这些工具会经 `updateStreamState` 合并 / catchup 重放 / `get_active_progress`
  //      快照**残留在后续帧里**——服务端自己在 `agent/engine_wire.go:2436-2445` 写明：
  //      「每个工具必须盖当前迭代号……**否则前端无法把它从当前在飞迭代的渲染里滤掉**」
  //      （原文：the frontend cannot filter it from the current iteration's live rendering）。
  //    ⇒ 缺第 ① 步时，**过去迭代的 `pending` 工具永久渲染在最新在飞块**，看起来就是
  //      「所有 tool 都在排队」，且把真正在执行的 tool 挤成同一档。
  //    判据与渲染同源：过滤逻辑收敛在 `isCurrentIterTool`（导出的纯函数，可脱机断言）。
  let maxCompletedIter: number = -1;
  for (let i = 0; i < completed.length; i++) {
    if (completed[i].iteration > maxCompletedIter) {
      maxCompletedIter = completed[i].iteration;
    }
  }
  const live: ToolProgress[] = [];
  for (let i = 0; i < r.streamingTools.length; i++) {
    if (isCurrentIterTool(r.streamingTools[i], maxCompletedIter)) {
      live.push(toToolProgress(r.streamingTools[i]));
    }
  }
  for (let i = 0; i < r.activeTools.length; i++) {
    if (isCurrentIterTool(r.activeTools[i], maxCompletedIter)) {
      live.push(toToolProgress(r.activeTools[i]));
    }
  }
  // ③′ 当前迭代**已完成**的工具（web `toolDeriv` 第三个数组 `completedTools`）——
  //   ⛔ 本仓曾只并 activeTools+streamingTools：工具完成后服务端把它移入
  //   `completed_tools`（移出 activeTools）⇒ 不并它 ⇒ 该工具从 live 列表**消失**
  //   （用户亲报：「一个迭代调 filereplace+shell，filereplace 完成后只剩 shell」）。
  //   兜底 `?? []`：部分手写/旧序列化的 live 行没有该字段（防御，避免整表崩）。
  const cTools: readonly WebToolProgress[] = r.completedTools !== undefined ? r.completedTools : [];
  for (let i = 0; i < cTools.length; i++) {
    if (isCurrentIterTool(cTools[i], maxCompletedIter)) {
      live.push(toToolProgress(cTools[i]));
    }
  }
  const deduped: ToolProgress[] = mergeTools([], live);
  // 已提交迭代的**工具键集合** —— 用 `Set` 而非数组 `indexOf`：后者对每枚在飞工具线性扫全表
  // ⇒ O(在飞工具数 × 已提交工具键数)。live 行**每帧**都跑此段（`liveIterations`），真实单行
  // 已完成工具数可达数十枚 ⇒ 这是随 turn 增长的每帧成本。`Set` 的成员判定是 O(1)。
  // ⛔ **输出逐字节不变**：键比较同为字符串全等（`Set.has` ≡ `indexOf(...) < 0` 的取反）。
  const completedKeys: Set<string> = new Set<string>();
  for (let i = 0; i < completed.length; i++) {
    const it: HistoryIteration = completed[i];
    if (it.tools === undefined) {
      continue;
    }
    for (let j = 0; j < it.tools.length; j++) {
      completedKeys.add(toolKey(it.tools[j]));
    }
  }
  for (let i = 0; i < deduped.length; i++) {
    if (!completedKeys.has(toolKey(deduped[i]))) {
      tools.push(deduped[i]);
    }
  }
  if (content.length === 0 && reasoning.length === 0 && tools.length === 0) {
    return null;
  }
  const out: HistoryIteration = {
    iteration: r.lastIter,
    content,
    reasoning,
    tools,
    tools_folded: false,
    live: true,
  };
  return out;
}

/** 迭代块是否**空壳**（无可见正文/思考/工具）。 */
function isShell(it: HistoryIteration): boolean {
  if (it.content !== undefined && it.content.length > 0) {
    return false;
  }
  if (it.reasoning !== undefined && it.reasoning.length > 0) {
    return false;
  }
  if (it.tools !== undefined && it.tools.length > 0) {
    return false;
  }
  return true;
}

// ── live 行**已完成块**的转换记忆化（按源数组对象恒等）─────────────────────────
/**
 * `LiveSnapshot.iterations`（WebIteration[]）→ `HistoryIteration[]` 的**按源数组记忆化**。
 *
 * 流式期间 `r.iterations` 是同一数组对象（reducer 字段级合并直接沿用 prev）⇒
 * 命中缓存 ⇒ **每帧 0 分配**。变化信号是**源数组引用**，不是任何字符串指纹。
 *
 * ⚠️ 不变量：源数组一律整体替换、绝不就地改（`mergeIterations` /
 * `foldInFlightToIterations` 都产新数组）⇒ 换数组即换键 ⇒ 结构上不可能陈旧。
 */
const liveBlocksMemo = new WeakMap<object, HistoryIteration[]>();
let liveConvHits = 0;
let liveConvMisses = 0;
let liveConvBlocks = 0;      // 累计**转换过的块数**（= 每帧真实工作量；命中不计）

/** 按源数组对象恒等取「已完成块」的转换结果（**共享**数组 —— 调用方只读）。 */
function convertedBlocksMemo(src: readonly WebIteration[]): HistoryIteration[] {
  const hit: HistoryIteration[] | undefined = liveBlocksMemo.get(src);
  if (hit !== undefined) {
    liveConvHits++;
    return hit;
  }
  liveConvMisses++;
  liveConvBlocks += src.length;                 // 本次真转换的块数（诊断/判据口径）
  const conv: HistoryIteration[] = toHistoryIterations(src);
  liveBlocksMemo.set(src, conv);
  return conv;
}

/** 页面投递 `liveBlocks` 用的 O(1) 引用（live 行 = `row.completedBlocks`，否则空）。 */
export const EMPTY_BLOCKS: HistoryIteration[] = [];

/**
 * `liveBlocksConvStats()` 的返回形状。
 * ⛔ ArkTS **禁对象字面量作类型标注**（`arkts-no-obj-literals-as-types`）⇒ 必须显式声明
 *   interface；对象字面量本身对应已声明接口（`arkts-no-untyped-obj-literals`）才合法。
 *   （脱机 `run-one.sh` 把 `core/**` 当**纯 TS** 编译，抓不到这条 —— 见 `docs/ARKTS-GOTCHAS.md`。）
 */
export interface LiveBlocksConvStats {
  hits: number;
  misses: number;
  /** 累计**真转换过的块数**（命中算 0）—— 判据口径的「每帧工作量」。 */
  blocks: number;
}

/**
 * 诊断：live 行「已完成块转换」的命中/未命中/累计转换块数
 * （口径同 `core/markdown.ets` 的 `mdCacheStats`）。
 *
 * 判据消费方：`tools/tests/perf_live_frame.test.ts` —— 钉"**未变化的已完成块每帧零转换**"。
 * `blocks` 才是"每帧工作量"（命中一次算 0 块）；`misses` 只说明"换了源数组"。
 */
export function liveBlocksConvStats(): LiveBlocksConvStats {
  const st: LiveBlocksConvStats = {
    hits: liveConvHits,
    misses: liveConvMisses,
    blocks: liveConvBlocks,
  };
  return st;
}

/**
 * live Row → 渲染块列表（已完成迭代 ⊕ 末尾在飞块）。
 *
 * 在飞块的出现条件（两条，缺一即"在飞内容没有渲染位"）：
 *   ① `lastIter > maxCompleted` —— 在飞迭代号**尚未**作为历史渲染（正常流式）；
 *   ② 存在**与在飞号同号、且是空壳**的已完成迭代 —— 服务端把当前在飞迭代
 *      （此刻还是空壳）记进了 `iteration_history` ⇒ `maxCompleted === lastIter`，
 *      条件 ① 不成立；此时在飞内容只有"补一块"这一个渲染位（P0 就是这里）。
 * ⛔ 同号已完成迭代**已有可见内容**时不追加：那是在飞字段对同一迭代的重复副本
 *   （phase_done / commit 后窗口）⇒ 追加会让同一迭代号出现两块（重复渲染 +
 *   块数回退，真机 bug ① 的形态）。
 */
function liveIterations(r: LiveRowView): HistoryIteration[] {
  // 已完成部分走**按源数组记忆化**（未变化 ⇒ 每帧 0 分配）。
  // `slice()` 必需：下面可能 push 在飞块，而缓存数组是**共享**的（只读）。
  const out: HistoryIteration[] = convertedBlocksMemo(r.iterations).slice();
  let maxCompleted: number = 0;
  let shellSameNum: boolean = false;
  for (let i = 0; i < out.length; i++) {
    const it: HistoryIteration = out[i];
    if (it.iteration > maxCompleted) {
      maxCompleted = it.iteration;
    }
    if (it.iteration === r.lastIter && isShell(it)) {
      shellSameNum = true;
    }
  }
  if (!(r.lastIter > maxCompleted || shellSameNum)) {
    return out;
  }
  const block: HistoryIteration | null = inFlightBlock(r, out);
  if (block !== null) {
    // ⛔ **同号 = 同一迭代** ⇒ 已存在同号块时必须**就地合并**，绝不 append 第二个
    //   （用户 2026-10-17 P0：迭代完成后突然出现两个一模一样的 iter，下一迭代恢复）。
    //   合并语义：工具按 `toolKey` 并集（已提交优先，保持顺序）；正文/思考**非空者胜**
    //   （在飞带新文本时以在飞为准 —— `inFlightBlock` 已把"与已提交逐字相同"的文本清空，
    //   所以这里非空即"有新内容"）。合并后仍标 `live: true`（它在飞、要走在飞渲染）。
    let idx: number = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i].iteration === block.iteration) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      const prevIt: HistoryIteration = out[idx];
      const prevTools: ToolProgress[] = prevIt.tools !== undefined ? prevIt.tools : [];
      out[idx] = {
        iteration: prevIt.iteration,
        content: (block.content !== undefined && block.content.length > 0)
          ? block.content : (prevIt.content !== undefined ? prevIt.content : ''),
        reasoning: (block.reasoning !== undefined && block.reasoning.length > 0)
          ? block.reasoning : (prevIt.reasoning !== undefined ? prevIt.reasoning : ''),
        tools: mergeTools(prevTools, block.tools),
        tools_folded: prevIt.tools_folded,
        live: true,
      };
    } else {
      out.push(block);
    }
  }
  return collapseSameNumberBlocks(out);
}

/**
 * **渲染边界不变量**：同一 `iteration` 号在渲染列表里**只能出现一次**。
 *
 * ⛔ 为什么要有（用户 2026-10-17 P0「完成后突然变成两个一模一样的 iter」）：
 *   上游（状态机 merge / fold / finalizer / 增量 delta）任何一条路径只要让同一个号
 *   出现两次，UI 就会并排画出两块——而"同一个号"在语义上**永远是同一个迭代**。
 *   这里做**兜底收敛**（工具按 `toolKey` 并集、正文/思考非空者胜、`live` 取或），
 *   让"同号重复"这类缺陷在渲染层**不可能**露出到屏幕上。
 *   判据与渲染同源：`tools/tests/live_iter_dedupe.test.ts` 直接喂重复输入断言收敛。
 */
export function collapseSameNumberBlocks(list: HistoryIteration[]): HistoryIteration[] {
  if (list.length < 2) {
    return list;
  }
  const seen: Map<number, number> = new Map<number, number>();   // 号 → 结果下标
  const out: HistoryIteration[] = [];
  for (let i = 0; i < list.length; i++) {
    const it: HistoryIteration = list[i];
    const at: number | undefined = seen.get(it.iteration);
    if (at === undefined) {
      seen.set(it.iteration, out.length);
      out.push(it);
      continue;
    }
    const prevIt: HistoryIteration = out[at];
    const prevTools: ToolProgress[] = prevIt.tools !== undefined ? prevIt.tools : [];
    out[at] = {
      iteration: prevIt.iteration,
      content: it.content !== undefined && it.content.length > 0 ? it.content : (prevIt.content !== undefined ? prevIt.content : ''),
      reasoning: it.reasoning !== undefined && it.reasoning.length > 0 ? it.reasoning : (prevIt.reasoning !== undefined ? prevIt.reasoning : ''),
      tools: mergeTools(prevTools, it.tools !== undefined ? it.tools : []),
      tools_folded: prevIt.tools_folded,
      live: prevIt.live === true || it.live === true,
    };
  }
  return out;
}

/**
 * live 行**工具状态摘要** —— 状态/退出码/已生成字数任一变化都必须让行重建。
 *
 * ⛔ 为什么必须有（2026-10-12 用户亲报 P0，原话「running 绝不能变回 pending」）：
 *   行指纹（`rowSignature`）此前只含 `last.tools.length`。而**工具执行期间模型不产 token**
 *   ⇒ `content.length`/`tools.length` **都不变** ⇒ 指纹不变 ⇒ `applyRow` 记忆化**不重建行**
 *   ⇒ 行内 `iterations[i].tools` **冻结在"工具仍是 `pending`"的那一帧** ⇒ pill 一直显示
 *   「排队」，直到下次有内容变化才跳变。加入状态摘要后，`pending→running→done` 每次都改
 *   指纹 ⇒ 行重建 ⇒ chip 与现实**逐帧一致**（服务端 `active_tools` 的 `status` 为准）。
 *
 * 只取**离散**字段（`name`/`status`/`exit_code`/`gen_chars`）——⛔ 不含 `elapsed_ms`
 * （running 时长是每帧变的连续量，纳入会让 live 行每帧重建，得不偿失）。
 */
/**
 * ⛔ **已删除字符串指纹**（`toolsStatusSig` / `rowSignature`）。
 *
 * 旧实现每帧把 `content.length`/工具状态/SubAgent 描述拼成字符串再比较 ——
 * 既是 O(内容) 的每帧成本，也违反「禁止用字符串比较内容来去重」。
 * 现在变化判据 = **派生 Row 的对象恒等**：`deriveRows` 对未变化的 turn 复用同一个
 * `Row` 对象（`assistantRowByTurn` WeakMap），reducer 只对变化的 turn 产生新对象
 * ⇒ `applyRow` 用 `WeakMap<ChatRow, Row>` 记「上次应用的 Row」，引用相同即 no-op。
 * 这是 O(1)、零分配、零字符串比较的**完备**变化信号（Row 的所有字段都来自 state）。
 */

/**
 * `WebCompaction[]`（readonly）→ 渲染层可变数组（**新增对象、不就地改源**）。
 *
 * 与 `toHistoryIterations` 同款：JS/ArkTS 侧 `readonly T[]` 与 `T[]` 不通用 ⇒ 显式拷贝。
 * 无压缩 ⇒ 空数组（渲染层据此**零渲染**）。元素本身透传引用（WebCompaction 只读消费）。
 */
function toCompactions(cs: readonly WebCompaction[] | undefined): WebCompaction[] {
  const out: WebCompaction[] = [];
  if (cs !== undefined) {
    for (let i = 0; i < cs.length; i++) {
      out.push(cs[i]);
    }
  }
  return out;
}

/** 工具结构比较可消费的最小面（原生 `ToolProgress` 与 web `WebToolProgress` 都满足）。
 * ⛔ 两套字段名（snake_case / camelCase）都要读 —— live 派生行的工具是 **web 形状**
 *    （`WebToolProgress`：exitCode/genChars/callID/uiMode/toolHints），若只读 snake_case
 *    会把「退出码/生成字数/调用 id」的变化全部当成"无变化" ⇒ pill 冻帧。
 */
interface EssenceTool {
  name?: string;
  label?: string;
  status?: string;
  exit_code?: number;
  exitCode?: number;
  gen_chars?: number;
  genChars?: number;
  call_id?: string;
  callID?: string;
  ui_mode?: string;
  uiMode?: string;
  summary?: string;
  args?: string;
  detail?: string;
  tool_hints?: string;
  toolHints?: string;
}

/** 工具数组的**结构等价**（只用离散元数据 + 正文/参数的**长度**；⛔ 不做全文字符串比较）。
 *
 * 目的：`elapsed_ms` 是每帧变化的连续量 —— 它单独变化**不得**触发行重建
 * （否则流式期每帧重建，掉帧）。旧实现用字符串指纹排除它；现在用 O(n) 整数/元数据比较。
 */
function sameToolEssence(a: EssenceTool, b: EssenceTool): boolean {
  if (a === b) return true
  const aExit: number | undefined = a.exit_code !== undefined ? a.exit_code : a.exitCode
  const bExit: number | undefined = b.exit_code !== undefined ? b.exit_code : b.exitCode
  const aGen: number | undefined = a.gen_chars !== undefined ? a.gen_chars : a.genChars
  const bGen: number | undefined = b.gen_chars !== undefined ? b.gen_chars : b.genChars
  const aCall: string | undefined = a.call_id !== undefined ? a.call_id : a.callID
  const bCall: string | undefined = b.call_id !== undefined ? b.call_id : b.callID
  const aMode: string | undefined = a.ui_mode !== undefined ? a.ui_mode : a.uiMode
  const bMode: string | undefined = b.ui_mode !== undefined ? b.ui_mode : b.uiMode
  const aHints: string | undefined = a.tool_hints !== undefined ? a.tool_hints : a.toolHints
  const bHints: string | undefined = b.tool_hints !== undefined ? b.tool_hints : b.toolHints
  if (a.name !== b.name || a.status !== b.status || a.label !== b.label) return false
  if (aExit !== bExit || aGen !== bGen || aCall !== bCall || aMode !== bMode) return false
  if ((a.summary ?? '').length !== (b.summary ?? '').length) return false
  if ((a.args ?? '').length !== (b.args ?? '').length) return false
  if ((a.detail ?? '').length !== (b.detail ?? '').length) return false
  if ((aHints ?? '').length !== (bHints ?? '').length) return false
  return true
}

function sameToolArr(a: readonly EssenceTool[] | undefined, b: readonly EssenceTool[] | undefined): boolean {
  if (a === b) return true
  const A: readonly EssenceTool[] = a !== undefined ? a : []
  const B: readonly EssenceTool[] = b !== undefined ? b : []
  if (A.length !== B.length) return false
  for (let i = 0; i < A.length; i++) {
    if (!sameToolEssence(A[i], B[i])) return false
  }
  return true
}

/** 逐元素**引用**相等（空数组合并视为相等）。用于 SubAgent 等不可变源对象数组。 */
function sameRefArr<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (a === b) return true
  const A: readonly T[] = a !== undefined ? a : []
  const B: readonly T[] = b !== undefined ? b : []
  if (A.length !== B.length) return false
  for (let i = 0; i < A.length; i++) {
    if (A[i] !== B[i]) return false
  }
  return true
}

/**
 * 两个派生 Row 是否**渲染等价**（O(n) 离散比较，无字符串拼接、无全文比较）。
 *
 * ⛔ 为什么需要它（而不是只靠对象恒等）：
 *   `elapsed_ms` 是流式期每帧变化的连续量；`deriveRows` 会因底层 Turn 变化产出新 Row
 *   对象。若把"新对象"一律当变化，live 行会**逐帧重建**（掉帧）。
 *   旧实现用 `rowSignature` 字符串排除 elapsed；本函数等价地排除它，但：
 *     · 不拼任何字符串（零分配）；
 *     · 更早迭代的变化靠 `iterations` **逐元素引用**判出（旧签名只看最后一个迭代 ⇒ 会漏）；
 *     · 工具状态/退出码/生成字数都参与（旧签名有，不能退化）。
 *   正文/参数只比**长度**（用户明确禁止用字符串比较内容去重）；真实更新几乎都会改长度。
 */
function sameRowEssence(a: Row, b: Row): boolean {
  if (a === b) return true
  if (a.kind !== b.kind) return false
  if (a.kind === 'user' && b.kind === 'user') {
    return a.id === b.id && a.turnID === b.turnID && a.content.length === b.content.length
      && a.timestamp === b.timestamp && a.isNotification === b.isNotification
      && a.queued === b.queued && a.sending === b.sending
  }
  if (a.kind === 'live' && b.kind === 'live') {
    return a.turnID === b.turnID && a.streaming === b.streaming && a.lastIter === b.lastIter
      && a.regionsBefore === b.regionsBefore
      && a.content.length === b.content.length && a.reasoning.length === b.reasoning.length
      && a.genui.length === b.genui.length
      && sameRefArr(a.iterations, b.iterations)
      && sameRefArr(a.subAgents, b.subAgents)
      && sameToolArr(a.activeTools, b.activeTools)
      && sameToolArr(a.streamingTools, b.streamingTools)
      && sameToolArr(a.completedTools, b.completedTools)
  }
  if (a.kind === 'frozen' && b.kind === 'frozen') {
    return a.turnID === b.turnID && a.lastIter === b.lastIter && a.regionsBefore === b.regionsBefore
      && a.content.length === b.content.length && a.reasoning.length === b.reasoning.length
      && a.genui.length === b.genui.length
      && sameRefArr(a.iterations, b.iterations)
      && sameToolArr(a.activeTools, b.activeTools)
  }
  if (a.kind === 'committed' && b.kind === 'committed') {
    return a.turnID === b.turnID && a.content.length === b.content.length
      && a.iterationsTruncated === b.iterationsTruncated
      && a.regionsBefore === b.regionsBefore
      && sameRefArr(a.iterations, b.iterations)
      && sameRefArr(a.compactions, b.compactions)
  }
  return false
}

/** 行 → 上次应用的派生 Row（**对象恒等 + 渲染等价**判据；O(n) 无字符串）。 */
const appliedRowByRow = new WeakMap<ChatRow, Row>();

/**
 * 让某个 `ChatRow` 的「上次应用 Row」缓存失效，但**保留 ChatRow 身份**。
 *
 * ⛔ 不能直接删 `rowCache` 里的 ChatRow：LazyForEach 的键不含 rev，删除后新建的同键
 *    ChatRow 不会触发 item 重建 ⇒ 切换会话/新迭代时整行消失或停在旧内容（2026-10-20 P0）。
 *    身份稳定 + 重新 applyRow 才是正确语义。
 */
export function invalidateAppliedRow(row: ChatRow): void {
  appliedRowByRow.delete(row);
}

/**
 * 把一个派生 Row 落到既有的 `ChatRow` 对象上（就地更新）。
 *
 * 就地更新（而非每帧 new）保住 `@ObjectLink` 的对象恒等 —— 未变化的行为 ArkUI
 * 复用同一组件实例（对齐 web `rowsToChatMessages` 的对象恒等 memo）。
 *
 * 变化判据 = **`Row` 对象恒等**（`deriveRows` 对未变 turn 复用同一 Row 对象）。
 * ⛔ 不再拼字符串指纹：那既是每帧 O(内容) 成本，也会因"只看最后一个迭代/只看长度"
 * 漏掉更早迭代/工具状态/等长替换（用户症状：迭代内容不更新）。
 *
 * @returns 行内容是否变化（true ⇒ 调用方应自增 rev）
 */
export function applyRow(row: ChatRow, r: Row): boolean {
  const prev: Row | undefined = appliedRowByRow.get(row)
  // ⛔ user 行的 `sending/queued` 是**就地可变**的投递状态（ack/turn_started 清 sending）。
  //    若 deriveRows 复用了同一个 Row 对象（a===b），sameRowEssence 的 no-op 早退会让
  //    ChatRow 永远停在 sending=true（用户 2026-10-20：「发送成功了但还显示发送中」）。
  //    先用 ChatRow 上一值比对这两个布尔；只刷新布尔，不触发内容重建。
  if (prev !== undefined && prev === r && row.role === 'user' && r.kind === 'user') {
    const nextSending: boolean = r.sending === true
    const nextQueued: boolean = r.queued === true
    if (row.sending !== nextSending || row.queued !== nextQueued) {
      row.sending = nextSending
      row.queued = nextQueued
      return true
    }
  }
  // 对象恒等（O(1)）+ 渲染等价（O(n) 整数/元数据；排除 elapsed 这类连续量）。
  // 等价 ⇒ 保留上一次的 Row 引用，不更新字段、不自增 liveRevision（零重建）。
  if (prev !== undefined && sameRowEssence(prev, r)) {
    return false
  }
  appliedRowByRow.set(row, r);
  switch (r.kind) {
    case 'user':
      row.role = 'user';
      row.turnID = r.turnID;
      row.content = r.content;
      row.iterations = [];
      row.completedBlocks = [];
      row.isLive = false;
      // 通知注入的 user 行（web `UserMessage.isNotification`）—— 渲染层据此分流：通知类**原样呈现**，
      // 普通用户消息走与助手同一条 markdown（web `UserMessage.tsx:4-5`）。
      row.isNotification = r.isNotification === true;
      row.sending = r.sending === true;
      row.queued = r.queued === true;
      row.regionsBefore = 0;
      row.compactions = [];
      row.subAgents = [];
      break;
    case 'live':
      row.role = 'assistant';
      row.turnID = r.turnID;
      row.content = r.content;
      row.iterations = liveIterations(r);
      // 已完成块 = 源数组的转换结果（**按源数组对象恒等**记忆化；不含在飞块）。
      // 页面直接投这个引用（引用不变 ⇒ 不重投）——零字符串比较、零过滤分配。
      row.completedBlocks = convertedBlocksMemo(r.iterations);
      row.liveRevision = row.liveRevision + 1;
      row.isLive = true;
      row.regionsBefore = r.regionsBefore !== undefined ? r.regionsBefore : 0;
      // live 行不承载压缩点（压缩只在**已提交** turn 的迭代边界上定位）⇒ 清空。
      row.compactions = [];
      // live 快照的 SubAgent 树（行级；已提交行的树在 iterations[].subAgents 上）
      row.subAgents = toSubAgents(r.subAgents);
      break;
    case 'frozen':
      row.role = 'assistant';
      row.turnID = r.turnID;
      row.content = r.content;
      row.iterations = toHistoryIterations(r.iterations);
      row.completedBlocks = [];
      row.isLive = false;
      row.regionsBefore = r.regionsBefore !== undefined ? r.regionsBefore : 0;
      row.compactions = [];
      row.subAgents = [];
      break;
    case 'committed':
      row.role = 'assistant';
      row.turnID = r.turnID;
      row.content = r.content;
      row.iterations = toHistoryIterations(r.iterations);
      row.completedBlocks = [];
      row.isLive = false;
      row.regionsBefore = r.regionsBefore !== undefined ? r.regionsBefore : 0;
      // turn 内压缩点（迭代之间内联渲染）——派生行 → 渲染行透传（无则空数组）。
      row.compactions = toCompactions(r.compactions);
      // 已提交行：SubAgent 树**逐迭代**在 iterations[].subAgents 上（迭代边界冻结，
      // 不合并到行级 —— 与 web 逐迭代渲染同源）⇒ 行级清空。
      row.subAgents = [];
      break;
  }
  // ── 块列表持有者（独立 @Observed ⇒ 只通知 `IterBlocksView`，行/页面不重建）──
  // ⛔ 必须在 `row.iterations` 落定之后：`completedBlocks` / `mergeToolRuns` 都按源数组
  //   恒等记忆化 ⇒ 未变化时返回**同一引用** ⇒ 这里不赋值 ⇒ 订阅者零重建。
  if (r.kind === 'user') {
    syncIterBlocks(row, EMPTY_BLOCKS, NO_COMPACTIONS, r.turnID);
  } else if (r.kind === 'live') {
    // live 行的已完成块 = `applyRow` 上面按源数组记忆化得到的 `row.completedBlocks`
    //（**不含**末尾在飞块 —— 在飞内容由页面 `liveText/liveReasoning/liveTools` 承载）。
    syncIterBlocks(row, row.completedBlocks, NO_COMPACTIONS, r.turnID);
  } else if (r.kind === 'frozen') {
    syncIterBlocks(row, completedBlocks(row), NO_COMPACTIONS, r.turnID);
  } else {
    syncIterBlocks(row, completedBlocks(row), row.compactions, r.turnID);
  }
  return true;
}

/** 空迭代列表（供迭代详情合并的兜底）。 */
export function emptyIterList(): IterList {
  return { iterations: [] };
}
