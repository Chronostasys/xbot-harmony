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
import type { Row } from './derive';

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
      return `l#${r.turnID}#${r.iterations.length}#${lastSig}#${r.streaming ? 1 : 0}#${r.regionsBefore !== undefined ? r.regionsBefore : 0}`;
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
      row.iterations = toHistoryIterations(r.iterations);
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
