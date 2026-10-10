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
import { WebIteration, WebToolProgress } from './chattypes';
import type { LiveRowView, Row } from './derive';

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

/** WebToolProgress[] → ToolProgress[]（页面 live 尾块的工具列表用）。 */
export function toNativeTools(ws: readonly WebToolProgress[]): ToolProgress[] {
  const out: ToolProgress[] = [];
  for (let i = 0; i < ws.length; i++) {
    out.push(toToolProgress(ws[i]));
  }
  return out;
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
function inFlightBlock(r: LiveRowView, completed: HistoryIteration[]): HistoryIteration | null {
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
  for (let i = 0; i < r.activeTools.length; i++) {
    tools.push(toToolProgress(r.activeTools[i]));
  }
  for (let i = 0; i < r.streamingTools.length; i++) {
    tools.push(toToolProgress(r.streamingTools[i]));
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
  const out: HistoryIteration[] = toHistoryIterations(r.iterations);
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
        + `#${r.activeTools.length}#${r.streamingTools.length}`;
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
      return `c#${r.turnID}#${r.iterations.length}#${lastSig}#${r.content.length}#${r.regionsBefore !== undefined ? r.regionsBefore : 0}`;
    }
  }
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
      break;
    case 'live':
      row.role = 'assistant';
      row.turnID = r.turnID;
      row.content = r.content;
      row.iterations = liveIterations(r);
      row.isLive = true;
      row.regionsBefore = r.regionsBefore !== undefined ? r.regionsBefore : 0;
      break;
    case 'frozen':
      row.role = 'assistant';
      row.turnID = r.turnID;
      row.content = r.content;
      row.iterations = toHistoryIterations(r.iterations);
      row.isLive = false;
      row.regionsBefore = r.regionsBefore !== undefined ? r.regionsBefore : 0;
      break;
    case 'committed':
      row.role = 'assistant';
      row.turnID = r.turnID;
      row.content = r.content;
      row.iterations = toHistoryIterations(r.iterations);
      row.isLive = false;
      row.regionsBefore = r.regionsBefore !== undefined ? r.regionsBefore : 0;
      break;
  }
  return true;
}

/** 空迭代列表（供迭代详情合并的兜底）。 */
export function emptyIterList(): IterList {
  return { iterations: [] };
}
