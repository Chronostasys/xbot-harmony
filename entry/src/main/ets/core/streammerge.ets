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
import { HistoryIteration, IterList, ProgressEvent, ToolProgress } from './types';

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

/** 是否携带结构化字段（迭代号/正文/推理/工具/历史）。 */
export function hasStructured(e: ProgressEvent): boolean {
  return (e.iteration !== undefined && e.iteration > 0)
    || nonEmpty(e.content) || nonEmpty(e.reasoning)
    || (e.active_tools !== undefined && e.active_tools.length > 0)
    || (e.completed_tools !== undefined && e.completed_tools.length > 0)
    || (e.tool_calls !== undefined && e.tool_calls.length > 0)
    || (e.iteration_history !== undefined && e.iteration_history.length > 0);
}

function nonEmpty(s: string | undefined): boolean {
  return s !== undefined && s.length > 0;
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
    const created: HistoryIteration = { iteration: 1, content: '', reasoning: '', tools: [] };
    row.iterations.push(created);
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
  row.iterations.push(created);
  row.iterations.sort((a: HistoryIteration, b: HistoryIteration) => a.iteration - b.iteration);
  return created;
}

/** 工具去重合并（按 call_id 优先、否则按 name+label）：顺序 = 先 prev 后 next。 */
export function mergeTools(prev: ToolProgress[] | undefined, next: ToolProgress[] | undefined): ToolProgress[] {
  const out: ToolProgress[] = [];
  const seen: string[] = [];
  const take = (list: ToolProgress[] | undefined): void => {
    if (list === undefined) {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const t: ToolProgress = list[i];
      const key: string = t.call_id !== undefined && t.call_id.length > 0
        ? t.call_id : `${t.name}#${t.label !== undefined ? t.label : ''}`;
      if (seen.indexOf(key) >= 0) {
        // 已存在 ⇒ 用新的替换（状态会从 running → done）
        for (let j = 0; j < out.length; j++) {
          const o: ToolProgress = out[j];
          const ok: string = o.call_id !== undefined && o.call_id.length > 0
            ? o.call_id : `${o.name}#${o.label !== undefined ? o.label : ''}`;
          if (ok === key) {
            out[j] = t;
            break;
          }
        }
        continue;
      }
      seen.push(key);
      out.push(t);
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

/** 该迭代当前应显示的推理文本。 */
export function displayReasoning(it: HistoryIteration): string {
  if (nonEmpty(it.stream_reasoning)) {
    return it.stream_reasoning !== undefined ? it.stream_reasoning : '';
  }
  return it.reasoning !== undefined ? it.reasoning : '';
}
