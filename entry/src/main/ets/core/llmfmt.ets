/**
 * LLM 选择栏的**纯逻辑**（可脱机单测）。
 *
 * 服务端契约（`channel/web/web_api.go` + `protocol/events.go`，逐字核对）：
 *   GET  /api/llm-config        → { ok, is_global, model, models[], model_entries[], max_context }
 *   POST /api/llm-config/model  → { sub_id, model }  切模型（按 sender 生效）
 *   POST /api/llm-max-context   → { max_context }
 * `model_entries[i]` = { sub_id, sub_name, model, status: normal|offline|disabled, vision }。
 *
 * ⚠️ 模型解析严禁用"裸模型名"（项目铁律）：切换必须带 `sub_id`，所以选择栏按订阅分组展示。
 */

/** 一个可选模型（服务端 `protocol.ModelEntry`）。 */
export interface LlmModelEntry {
  sub_id?: string;
  sub_name?: string;
  model?: string;
  /** normal | offline | disabled */
  status?: string;
  vision?: boolean;
}

/** `GET /api/llm-config` 的响应。 */
export interface LlmConfig {
  ok?: boolean;
  is_global?: boolean;
  provider?: string;
  base_url?: string;
  model?: string;
  models?: string[];
  model_entries?: LlmModelEntry[];
  max_context?: number;
  max_output_tokens?: number;
  thinking_mode?: string;
}

/** 订阅分组（同名合并；顺序 = 首次出现顺序，**不打乱服务端给的顺序**）。 */
export class ModelGroup {
  name: string = '';
  subId: string = '';
  entries: LlmModelEntry[] = [];
}

/** 按订阅分组（`sub_id` 相同即同组；名字取服务端给的 sub_name）。 */
export function groupModels(entries: LlmModelEntry[] | undefined): ModelGroup[] {
  const out: ModelGroup[] = [];
  if (entries === undefined) {
    return out;
  }
  for (let i = 0; i < entries.length; i++) {
    const e: LlmModelEntry = entries[i];
    const subId: string = e.sub_id !== undefined ? e.sub_id : '';
    let g: ModelGroup | undefined = undefined;
    for (let k = 0; k < out.length; k++) {
      if (out[k].subId === subId) {
        g = out[k];
      }
    }
    if (g === undefined) {
      g = new ModelGroup();
      g.subId = subId;
      g.name = e.sub_name !== undefined && e.sub_name.length > 0 ? e.sub_name : subId;
      out.push(g);
    }
    g.entries.push(e);
  }
  return out;
}

/** 状态角标（正常无角标，避免噪音）。 */
export function statusLabel(status: string | undefined): string {
  if (status === 'offline') {
    return '离线';
  }
  if (status === 'disabled') {
    return '已禁用';
  }
  return '';
}

/** 该模型能不能选（禁用的不给点）。 */
export function selectable(e: LlmModelEntry): boolean {
  return e.status !== 'disabled';
}

/** 模型显示名（带视觉能力标记；视觉是**手动开关**，不是白名单 ⇒ 只作信息展示）。
 *  文本标记（`（视觉）`），不用 emoji —— 见设计系统 §2.8。 */
export function modelLabel(e: LlmModelEntry): string {
  const m: string = e.model !== undefined ? e.model : '';
  const badge: string = statusLabel(e.status);
  const vision: string = e.vision === true ? '（视觉）' : '';
  return badge.length > 0 ? `${m}（${badge}）${vision}` : `${m}${vision}`;
}

/** 当前模型一行（优先用服务端给的有效模型）。 */
export function currentModelText(cfg: LlmConfig | undefined, fallback: string): string {
  if (cfg === undefined) {
    return fallback;
  }
  if (cfg.model !== undefined && cfg.model.length > 0) {
    return cfg.model;
  }
  return fallback;
}

/** 上下文上限显示（1.0M / 200k）。 */
export function contextText(maxContext: number | undefined): string {
  if (maxContext === undefined || maxContext <= 0) {
    return '';
  }
  if (maxContext >= 1000 * 1000) {
    return `${(maxContext / (1000 * 1000)).toFixed(1)}M`;
  }
  return `${Math.round(maxContext / 1000)}k`;
}

/** 常上下文预设（点选即可，不用手打数字）。 */
export function contextPresets(): number[] {
  return [32000, 128000, 200000, 1000000];
}

/** 解析用户手输的上下文上限（支持 `200k` / `1m` / 数字；非法返回 0）。 */
export function parseContext(input: string): number {
  const s: string = input.trim().toLowerCase();
  if (s.length === 0) {
    return 0;
  }
  const last: string = s.substring(s.length - 1);
  let mult: number = 1;
  let num: string = s;
  if (last === 'k') {
    mult = 1000;
    num = s.substring(0, s.length - 1);
  } else if (last === 'm') {
    mult = 1000 * 1000;
    num = s.substring(0, s.length - 1);
  }
  const n: number = Number.parseFloat(num);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  const v: number = Math.round(n * mult);
  return v > 0 ? v : 0;
}

// ── 模型列表面板的**三态**（口径同 `core/pluginview.ets:pluginPanelStatus`；2026-10-11 目标⑤ A4）──
// 旧缺陷（`polish-audit` 登记）：面板在 `llmCfg === undefined` 时**恒**显示 spinner +「正在读取模型列表…」
//   ⇒ 拉失败（后端不可用/超时/报错）**永久转圈**，用户读不出"是慢还是坏了"。三态 = 加载中 /
//   加载失败(+重试) / 已加载但空。⛔ 失败态**来自既有取数路径的真结果**（`store.loadLlmConfig` 的
//   `llmConfigState`/`llmConfigError`），⛔ 不是 `setTimeout` 猜的超时。

/** 加载中（含"从未拉过"的 idle —— 面板一打开即触发拉取）。 */
export const MODEL_PANEL_LOADING: string = 'loading';
/** 已加载但无任何可选模型（空）。 */
export const MODEL_PANEL_EMPTY: string = 'empty';
/** 加载失败（可重试）。 */
export const MODEL_PANEL_ERROR: string = 'error';
/** 有可选模型（画分组列表，不画状态行）。 */
export const MODEL_PANEL_LIST: string = 'list';

/** 模型列表面板的状态行（是否显示 / 文案 / 语义色角色 / 是否给"重试"）。 */
export class ModelPanelStatus {
  /** 见 `MODEL_PANEL_*`。 */
  state: string = MODEL_PANEL_LIST;
  show: boolean = false;
  text: string = '';
  /** `colorOf` 合法角色（本模块**只产出** textMuted / dangerText 两者）。 */
  colorRole: string = 'textMuted';
  canRetry: boolean = false;

  constructor(state: string, show: boolean, text: string, colorRole: string, canRetry: boolean) {
    this.state = state;
    this.show = show;
    this.text = text;
    this.colorRole = colorRole;
    this.canRetry = canRetry;
  }
}

/** 加载中文案（**静态一行字**，与 `pluginPanelLoadingText` 同口径）。 */
export function modelPanelLoadingText(): string {
  return '正在读取模型列表…';
}

/**
 * 失败文案：`模型列表加载失败：<可读原因>`。
 * ⚠️ `error` 必须由调用方先经 `core/rpc.ets:readableRpcError` **可读化**（本函数不解析原始 JSON/英文栈）。
 * 空串 ⇒ 只留前缀（不产出 `：` 悬空）。
 */
export function modelPanelErrorText(error: string): string {
  const e: string = typeof error === 'string' ? error.trim() : '';
  return e.length > 0 ? `模型列表加载失败：${e}` : '模型列表加载失败';
}

/** 空态文案 + 导向（**保留既有口径**：没有可选模型时去哪加订阅）。 */
export function modelPanelEmptyText(): string {
  return '（没有可选模型：请在设置里添加订阅）';
}

/**
 * 模型列表面板的三态（**判据与渲染同源**的唯一出口；`pages/Index.ets` 只消费它）。
 *
 * 优先级（**失败 > 加载 > 空 > 列表**）：
 *   · `errorText` 非空 ⇒ `dangerText` + **可重试**（失败就是失败）；
 *   · `fetchState` ≠ `ready`（idle/loading）⇒ `textMuted`，**不可重试**（正在拉，别给第二个按钮）；
 *   · `ready` 且 `entryCount` = 0 ⇒ 空态引导（`textMuted`）；
 *   · 有模型 ⇒ 不显示状态行（`state = list`）。
 *
 * @param fetchState `store.llmConfigState`（`idle|loading|ready|error`）。
 * @param entryCount 可选模型条目数（`modelGroups()` 里的总条数；服务端返回 null/空 ⇒ 0）。
 * @param errorText  **已可读化**的失败原因（空 = 无错）。
 */
export function modelPanelStatus(fetchState: string, entryCount: number, errorText: string): ModelPanelStatus {
  const err: string = typeof errorText === 'string' ? errorText.trim() : '';
  if (err.length > 0) {
    return new ModelPanelStatus(MODEL_PANEL_ERROR, true, modelPanelErrorText(err), 'dangerText', true);
  }
  const st: string = typeof fetchState === 'string' ? fetchState : '';
  if (st !== 'ready') {
    // idle（从未拉过）/ loading（正在拉）都读作"加载中"。
    return new ModelPanelStatus(MODEL_PANEL_LOADING, true, modelPanelLoadingText(), 'textMuted', false);
  }
  const n: number = typeof entryCount === 'number' && Number.isFinite(entryCount) && entryCount > 0 ? entryCount : 0;
  if (n === 0) {
    return new ModelPanelStatus(MODEL_PANEL_EMPTY, true, modelPanelEmptyText(), 'textMuted', false);
  }
  return new ModelPanelStatus(MODEL_PANEL_LIST, false, '', 'textMuted', false);
}
