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
import { ChatRow, HistoryIteration, IterList, ToolProgress } from './types';
import { WebCompaction, WebIteration, WebSubAgentProgress, WebToolProgress } from './chattypes';
import type { LiveRowView, Row } from './derive';
import { mergeTools, toolKey } from './streammerge';

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
 * SubAgent 树指纹（**live 行签名**用）—— 树变化必须让 `applyRow` 认为行变了，
 * 否则行上的 `subAgents` 会冻结在首帧（聊天树不更新）。
 *
 * 递归覆盖 children（树很小：几只 agent）；无 ⇒ `'-'`。
 * ⚠️ 只读**结构/状态**字段：desc 逐字进指纹会让长描述抖动，但那是"内容变了"的正当信号
 *    （与 `rowSignature` 里其它 `.length` 同款 —— 只求"变了就变指纹"）。
 */
function subAgentSig(ws: readonly WebSubAgentProgress[] | undefined): string {
  if (ws === undefined || ws.length === 0) {
    return '-';
  }
  const parts: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const n: WebSubAgentProgress = ws[i];
    const inst: string = n.instance !== undefined ? n.instance : '';
    parts.push(`${n.role}:${inst}:${n.status}:${n.desc !== undefined ? n.desc.length : 0}`
      + `[${subAgentSig(n.children)}]`);
  }
  return parts.join(',');
}

/**
 * 公开的 SubAgent 树指纹 —— **同一份判据供页面做值投递门控**（live 行的
 * `subAgents` 由 `applyRow` 就地替换成新数组 ⇒ 引用每帧都可能变；页面据此
 * 指纹判定"内容真的变了"才把新值投给 `MessageRowView`，避免逐帧重建 SubAgentTree）。
 * ⛔ 与 `rowSignature` 的 live 分支**同源**（同一函数）⇒ 判据与渲染不分叉。
 */
export function subAgentsFingerprint(ws: readonly WebSubAgentProgress[] | undefined): string {
  return subAgentSig(ws);
}

/** WebIteration（web 形状）→ HistoryIteration（渲染层形状）。 */
export function toHistoryIteration(w: WebIteration): HistoryIteration {
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
  };
  // SubAgent 树：**只在有值时新增键**（无 SubAgent 的迭代保持既有形状不变 —— 零回归）。
  const subs: WebSubAgentProgress[] = toSubAgents(w.subAgents);
  if (subs.length > 0) {
    out.subAgents = subs;
  }
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
  let content: string = r.content;
  let reasoning: string = r.reasoning;
  for (let i = 0; i < completed.length; i++) {
    if (content.length > 0 && completed[i].content === content) {
      content = '';
    }
    if (reasoning.length > 0 && completed[i].reasoning === reasoning) {
      reasoning = '';
    }
  }
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
  const deduped: ToolProgress[] = mergeTools([], live);
  const completedKeys: string[] = [];
  for (let i = 0; i < completed.length; i++) {
    const it: HistoryIteration = completed[i];
    if (it.tools === undefined) {
      continue;
    }
    for (let j = 0; j < it.tools.length; j++) {
      completedKeys.push(toolKey(it.tools[j]));
    }
  }
  for (let i = 0; i < deduped.length; i++) {
    if (completedKeys.indexOf(toolKey(deduped[i])) < 0) {
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

// ── live 行**已完成块**的转换记忆化（按源数组**对象恒等**）─────────────────────────
/**
 * `LiveSnapshot.iterations`（WebIteration[]）→ `HistoryIteration[]` 的**按源数组记忆化**。
 *
 * ⛔ 为什么（可离线量化的「每帧工作量」）：
 *   流式期间**每一帧**都会重建 live 行的 `ChatRow.iterations`（`applyRow` 的 live 分支），
 *   而其中的**已完成**部分（`r.iterations`）在该帧里**根本没变** —— 状态机的流式/结构化帧
 *   是字段级合并（`core/reduce.ts` 的 `{ ...prev, content, … }`），`iterations` 直接沿用
 *   `prev.iterations`（**同一数组对象**；判据 `tools/tests/perf_live_frame.test.ts` §A 直接断言）。
 *   旧实现每帧对它整份重新转换 ⇒ 每帧重新分配 N 个 `HistoryIteration` + K 个 `ToolProgress`
 *   + N 个 tools 数组（实测 N=108：`toHistoryIterations` ≈2.9 µs/帧、162 个对象/帧）。
 *   真实服务端单行可达 **108+** 已完成块 ⇒ 这是**随 turn 长度线性增长**的每帧分配（GC 压力）。
 *   ⇒ 按源数组对象恒等记忆化：键不变（内容也没变）⇒ 复用上次结果，每帧 **0 分配**。
 *
 * ⚠️ 不变量（缓存正确性的前提 —— 判据在 `tools/tests/perf_live_frame.test.ts`）：
 *   · 源数组一律**整体替换、绝不就地改**（每个 commit/fold 路径都产新数组：
 *     `mergeIterations` / `foldInFlightToIterations`）⇒ 换数组即换键 ⇒ **结构上不可能陈旧**；
 *   · 缓存值是**共享**的 ⇒ 调用方**只许读**，要改必须先 `slice()`（`liveIterations` 已如此）。
 *     转换结果（`HistoryIteration`）仓内只被只读消费 —— 会就地改它的 `applyStreamFrame` /
 *     `applyStructured`（`core/streammerge.ets`）在**全仓没有任何调用点**（已 grep 核实）；
 *   · WeakMap 键 ⇒ 源数组被 GC 时条目一并回收（**无容量上限、无泄漏**）—— 与
 *     `core/derive.ts` 的 `assistantRowByTurn` / `core/markdown.ets` 的 mdCache 同一手法。
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
    out.push(block);
  }
  return out;
}

/** 行内容变化指纹 —— 变了才自增 `rev`（参与 ForEach key）。 */
function rowSignature(r: Row): string {
  switch (r.kind) {
    case 'user':
      return `u#${r.content.length}#${r.turnID}#${r.sending ? 1 : 0}#${r.queued ? 1 : 0}#${r.isNotification ? 1 : 0}`;
    case 'live': {
      const last: WebIteration | undefined = r.iterations.length > 0
        ? r.iterations[r.iterations.length - 1] : undefined;
      const lastSig: string = last !== undefined
        ? `${last.iteration}:${last.content.length}:${last.reasoning.length}:${last.tools.length}` : '-';
      // ⚠️ 必须含**在飞字段**（content/reasoning/tools/lastIter）：在飞迭代块
      // 是由它们折叠出的最后一个迭代块，其内容每帧都变 —— 指纹不含它则
      // 行内容不刷新（"流式只在尾块更新、行内静止"）。含它 ⇒ 每帧 rev 自增、
      // 非懒尾行重渲染（打字机靠 @Prop 增量，不受 rev 影响）。
      return `l#${r.turnID}#${r.iterations.length}#${lastSig}#${r.streaming ? 1 : 0}`
        + `#${r.regionsBefore !== undefined ? r.regionsBefore : 0}`
        + `#${r.lastIter}#${r.content.length}#${r.reasoning.length}`
        + `#${r.activeTools.length}#${r.streamingTools.length}`
        // SubAgent 树（live 快照）：变了必须让行重建，否则行上的 subAgents 冻结在首帧
        + `#${subAgentSig(r.subAgents)}`;
    }
    case 'frozen': {
      const last: WebIteration | undefined = r.iterations.length > 0
        ? r.iterations[r.iterations.length - 1] : undefined;
      const lastSig: string = last !== undefined
        ? `${last.iteration}:${last.content.length}:${last.reasoning.length}:${last.tools.length}` : '-';
      return `f#${r.turnID}#${r.iterations.length}#${lastSig}#${r.content.length}#${r.reasoning.length}`;
    }
    case 'committed': {
      const last: WebIteration | undefined = r.iterations.length > 0
        ? r.iterations[r.iterations.length - 1] : undefined;
      const lastSig: string = last !== undefined
        ? `${last.iteration}:${last.content.length}:${last.tools.length}` : '-';
      return `c#${r.turnID}#${r.iterations.length}#${lastSig}#${r.content.length}#${r.regionsBefore !== undefined ? r.regionsBefore : 0}#${r.compactions !== undefined ? r.compactions.length : 0}`;
    }
  }
}

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

/**
 * 把一个派生 Row 落到既有的 `ChatRow` 对象上（就地更新）。
 *
 * 就地更新（而非每帧 new）保住 `@ObjectLink` 的对象恒等 —— 未变化的行为 ArkUI
 * 复用同一组件实例（对齐 web `rowsToChatMessages` 的对象恒等 memo）。
 *
 * @returns 行内容是否变化（true ⇒ 调用方应自增 rev）
 */
export function applyRow(row: ChatRow, r: Row): boolean {
  const sig: string = rowSignature(r);
  if (row.signature === sig) {
    return false;
  }
  row.signature = sig;
  switch (r.kind) {
    case 'user':
      row.role = 'user';
      row.turnID = r.turnID;
      row.content = r.content;
      row.iterations = [];
      row.isLive = false;
      row.regionsBefore = 0;
      row.compactions = [];
      row.subAgents = [];
      break;
    case 'live':
      row.role = 'assistant';
      row.turnID = r.turnID;
      row.content = r.content;
      row.iterations = liveIterations(r);
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
      row.isLive = false;
      row.regionsBefore = r.regionsBefore !== undefined ? r.regionsBefore : 0;
      // turn 内压缩点（迭代之间内联渲染）——派生行 → 渲染行透传（无则空数组）。
      row.compactions = toCompactions(r.compactions);
      // 已提交行：SubAgent 树**逐迭代**在 iterations[].subAgents 上（迭代边界冻结，
      // 不合并到行级 —— 与 web 逐迭代渲染同源）⇒ 行级清空。
      row.subAgents = [];
      break;
  }
  return true;
}

/** 空迭代列表（供迭代详情合并的兜底）。 */
export function emptyIterList(): IterList {
  return { iterations: [] };
}
