// 逐字移植自 xbot web `web/src/components/agent/progressStore.ts`（normalizeWebTool* /
// normalizeWebSubAgent*）+ `web/src/types/agent.ts`（IterationSnapshot/IterationTool/
// ToolProgress）+ `web/src/components/agent/api.ts`（HistProgress）（逻辑一比一）。
//
// 为什么单独成模块：agent_normalize.ets / normalize.ets 都从它取规范化的类型与
// 归一函数（对齐 web：normalize.ts 从 progressStore/api/types 三处 import）。

import type { GoalInfo, TodoItem, UISurface, WebSubAgentProgress, WebToolProgress } from './chattypes';
/**
 * 历史 active_progress 快照（web `components/agent/api.ts:63`：`type HistProgress = ProgressEvent`）。
 *
 * ⚠️ 这里**内联**声明字段（不从 `core/types.ets` import）：`.ts` 文件禁止 import
 * ArkTS（`.ets`）文件（ArkTS 规则 "Importing ArkTS files in JS and TS files is
 * forbidden"）。字段与协议 `protocol/events.go` 的 ProgressEvent 一致（子集）。
 */
export interface HistProgress {
  seq?: number;
  phase?: string;
  iteration?: number;
  content?: string;
  reasoning?: string;
  stream_content?: string;
  reasoning_stream_content?: string;
  iteration_history?: unknown[];
  active_tools?: unknown[];
  completed_tools?: unknown[];
  streaming_tools?: unknown[];
  sub_agents?: unknown[];
  todos?: unknown[];
  goal?: unknown;
  turn_id?: number;
  iteration_regions_before?: number;
}

/** A single tool snapshot inside an iteration（web `types/agent.ts:54`）。 */
export interface IterationTool {
  name: string;
  label?: string;
  /** 'done' | 'error'（历史里都是已完成）。 */
  status: string;
  elapsedMs?: number;
  summary?: string;
}

/** One iteration snapshot from the `detail` JSON（web `types/agent.ts:64`）。 */
export interface IterationSnapshot {
  iteration: number;
  content?: string;
  reasoning?: string;
  elapsedMs?: number;
  tools: IterationTool[];
}

/** A live tool being executed（web `types/agent.ts:77`）。 */
export interface ToolProgress {
  name?: string;
  label?: string;
  /** 'pending' | 'running' | 'done' | 'error' | 'generating'. */
  status?: string;
  elapsedMs?: number;
  iteration?: number;
  summary?: string;
  detail?: string;
  args?: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function normalizeUISurface(raw: unknown): UISurface | undefined {
  const s = asRecord(raw);
  if (!s) return undefined;
  return {
    kind: typeof s.kind === 'string' ? s.kind : undefined,
    title: typeof s.title === 'string' ? s.title : undefined,
    collapsible: typeof s.collapsible === 'boolean' ? s.collapsible : undefined,
    fullscreen: typeof s.fullscreen === 'boolean' ? s.fullscreen : undefined,
    defaultOpen: typeof s.default_open === 'boolean' ? s.default_open : undefined,
  };
}

/** Normalize a raw tool object（逐字取自 web `progressStore.ts:206`）。 */
export function normalizeWebTool(raw: unknown): WebToolProgress | null {
  const r = asRecord(raw);
  if (!r) return null;
  const uiLibs: string[] | undefined = Array.isArray(r.ui_libs)
    ? (r.ui_libs as unknown[]).map((l: unknown) => String(l)).filter((l: string) => l.length > 0)
    : undefined;
  return {
    name: typeof r.name === 'string' ? r.name : '',
    label: typeof r.label === 'string' ? r.label : '',
    status: (typeof r.status === 'string' ? r.status : 'running') as WebToolProgress['status'],
    elapsedMs: typeof r.elapsed_ms === 'number' ? r.elapsed_ms : 0,
    summary: typeof r.summary === 'string' ? r.summary : '',
    detail: typeof r.detail === 'string' ? r.detail : '',
    args: typeof r.args === 'string' ? r.args : '',
    toolHints: typeof r.tool_hints === 'string' ? r.tool_hints : '',
    iteration: typeof r.iteration === 'number' ? r.iteration : undefined,
    uiMode: typeof r.ui_mode === 'string' ? r.ui_mode : undefined,
    callID: typeof r.call_id === 'string' && r.call_id.length > 0 ? r.call_id : undefined,
    uiLibs: uiLibs !== undefined && uiLibs.length > 0 ? uiLibs : undefined,
    surface: normalizeUISurface(r.ui_surface),
    genChars: typeof r.gen_chars === 'number' ? r.gen_chars : undefined,
  };
}

/** Normalize an array of raw tool objects（逐字取自 web `progressStore.ts:305`）。 */
export function normalizeWebTools(raw: unknown[] | undefined): WebToolProgress[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map((x: unknown) => normalizeWebTool(x)).filter((x: WebToolProgress | null): x is WebToolProgress => x !== null);
}

/** Normalize a raw sub-agent node（逐字取自 web `progressStore.ts:310`）。 */
export function normalizeWebSubAgent(raw: unknown): WebSubAgentProgress | null {
  const r = asRecord(raw);
  if (!r) return null;
  const role: string = typeof r.role === 'string' ? r.role : '';
  if (role.length === 0) return null;
  const children: WebSubAgentProgress[] = Array.isArray(r.children)
    ? (r.children as unknown[]).map((c: unknown) => normalizeWebSubAgent(c))
      .filter((c: WebSubAgentProgress | null): c is WebSubAgentProgress => c !== null)
    : [];
  return {
    role,
    instance: typeof r.instance === 'string' ? r.instance : undefined,
    sessionKey: typeof r.session_key === 'string' ? r.session_key : undefined,
    status: typeof r.status === 'string' ? r.status : '',
    desc: typeof r.desc === 'string' ? r.desc : undefined,
    children,
    iteration: typeof r.iteration === 'number' && r.iteration > 0 ? r.iteration : undefined,
  };
}

/** Normalize an array of raw sub-agent nodes（逐字取自 web `progressStore.ts:329`）。 */
export function normalizeWebSubAgents(raw: unknown[] | undefined): WebSubAgentProgress[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x: unknown) => normalizeWebSubAgent(x))
    .filter((x: WebSubAgentProgress | null): x is WebSubAgentProgress => x !== null);
}

// 供 agent_normalize 复用的类型（避免未使用告警的显式引用）
export type ProgressTypesGoal = GoalInfo;
export type ProgressTypesTodo = TodoItem;
