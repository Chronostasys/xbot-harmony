/**
 * 面板（定时任务 / 后台任务 / 子代理 / Runner）的**纯逻辑**（可脱机单测）。
 *
 * 服务端契约逐字核对：
 * - `POST /api/cron/list`   → `{tasks:[{id,message,channel,chat_id,cron_expr?,every_seconds?,
 *                              delay_seconds?,one_shot?,next_run?,created_at?}]}`
 *   `POST /api/cron/remove` → body `{channel?, chat_id?, job_id}`（`storage/sqlite/cron.go` 的 json tag）；
 * - `POST /api/tasks/list`  → `{background_tasks:[{id,command,status,started_at,finished_at?,
 *                              output,exit_code,error?}]}`（`tools.BackgroundTask`）；
 * - `POST /api/rpc` `{method:"runner_list"}` → `{runners:[{name,mode,docker_image,workspace,
 *                              created_at,online,version?}]}`（`tools.RunnerInfo`；凭据绝不下发）。
 *
 * ⚠️ 状态标记一律用**纯文字**（运行中/完成/失败/在线/离线），禁用 emoji —— 设计系统 §2.8
 *    「图标禁用 emoji」（彩色字形、各平台不一致、`fontColor` 控不住）。本模块属 `core/`，
 *    只能返回字符串、用不了 `SymbolGlyph`，故文字是唯一自洽解。
 */

import { arrOrEmpty } from './guards';
import { ST_ERROR, toolStatusKind } from './toolstatus';
import { SessionItem, SseEventType } from './types';

export interface CronJob {
  id?: string;
  message?: string;
  channel?: string;
  chat_id?: string;
  cron_expr?: string;
  every_seconds?: number;
  delay_seconds?: number;
  one_shot?: boolean;
  next_run?: string;
  created_at?: string;
}

export interface BgTask {
  id?: string;
  command?: string;
  status?: string;
  started_at?: string;
  finished_at?: string;
  output?: string;
  exit_code?: number;
  error?: string;
}

export interface RunnerRow {
  name?: string;
  mode?: string;
  docker_image?: string;
  workspace?: string;
  created_at?: string;
  online?: boolean;
  version?: string;
}

/**
 * 子代理行。
 *
 * ⚠️ 这里是 **class** 不是 interface：store 里需要就地填充（`new SubAgentRow()`）——
 * ArkTS 禁止 `const x: SomeInterface = {}` 这种空对象字面量（arkts-no-untyped-obj-literals）。
 */
export class SubAgentRow {
  chat_id: string = '';
  label: string = '';
  running: boolean = false;
  /** 15h：标题/副行对齐 web（`TasksPanel.tsx:308 subAgentTitle` 优先 `role/instance`）。 */
  role: string = '';
  instance: string = '';
  /** 服务端状态（`running`/`waiting_input`/`pending`/…）—— 副行文案与「活跃」判据都用它。 */
  status: string = '';
  /** 服务端给的预览行（有则优先当副行，web 同口径）。 */
  preview: string = '';
  historical: boolean = false;
}

/**
 * 会话树里按 `chat_id` 找节点（**递归 children**）—— web `TasksPanel.tsx` 的 `findSessionNode` 同口径。
 * ⛔ 面板「子代理」tab 必须挂在**当前会话节点**下取 children（15h 实锤：原实现取 `orphan_subagents`，
 *   后端对当前会话恒返回 `null` ⇒ tab 结构性永远空）。
 */
export function findSessionNodeOf(
  nodes: SessionItem[] | null | undefined, chatId: string,
): SessionItem | null {
  const src: SessionItem[] = arrOrEmpty(nodes);
  for (let i = 0; i < src.length; i++) {
    const n: SessionItem | null | undefined = src[i];
    if (n === null || n === undefined) {
      continue;
    }
    if (n.chat_id === chatId) {
      return n;
    }
    const hit: SessionItem | null = findSessionNodeOf(n.children, chatId);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

/**
 * 子代理「活跃」判据 —— **逐字对齐** web `TasksPanel.tsx:300 isActiveSubAgent`：
 *   `running === true || status ∈ {running, waiting_input, pending}`。
 */
export function isActiveSubAgent(s: SessionItem): boolean {
  const st: string = s.status !== undefined && s.status !== null ? s.status : '';
  return s.running === true || st === 'running' || st === 'waiting_input' || st === 'pending';
}

/**
 * 会话节点 → 子代理**扁平行**：**DFS 前序**（⛔ 逐字对齐 web `flattenSubAgentTree`（`session-tree.ts:37`
 * 的 `visit` 递归先父后子）—— 顺序直接决定 UI 顺序，用 BFS 会与 web 不一致），并**去重**
 * （`channel#chat_id`，防服务端自引用导致死循环）。
 * ⛔ 无闭包递归（ArkTS 对自引用 const 不友好）⇒ 用显式栈：子节点**逆序压栈** ⇒ 弹出即前序。
 */
export function flattenSubAgentNodes(root: SessionItem | null | undefined): SessionItem[] {
  const out: SessionItem[] = [];
  const seen: string[] = [];
  const stack: SessionItem[] = [];
  const top: SessionItem[] = root === null || root === undefined ? [] : arrOrEmpty(root.children);
  for (let i = top.length - 1; i >= 0; i--) {
    stack.push(top[i]);
  }
  while (stack.length > 0) {
    const n: SessionItem | undefined = stack.pop();
    if (n === undefined || n === null) {
      continue;
    }
    const ch: string = n.channel !== undefined && n.channel !== null ? n.channel : '';
    const key: string = `${ch}#${n.chat_id}`;
    if (seen.indexOf(key) >= 0) {
      continue;
    }
    seen.push(key);
    out.push(n);
    const kids: SessionItem[] = arrOrEmpty(n.children);
    for (let j = kids.length - 1; j >= 0; j--) {
      stack.push(kids[j]);
    }
  }
  return out;
}

/** 当前会话节点的**活跃子代理**（= 面板「子代理」tab 的真源；web `TasksPanel.tsx:36-40`）。 */
export function activeSubAgentNodes(root: SessionItem | null | undefined): SessionItem[] {
  const all: SessionItem[] = flattenSubAgentNodes(root);
  const out: SessionItem[] = [];
  for (let i = 0; i < all.length; i++) {
    if (isActiveSubAgent(all[i])) {
      out.push(all[i]);
    }
  }
  return out;
}

/** 会话节点 → 面板行（字段三态取值：服务端字符串可能是 JSON `null`）。 */
export function subAgentRowOf(s: SessionItem): SubAgentRow {
  const r: SubAgentRow = new SubAgentRow();
  r.chat_id = s.chat_id !== undefined && s.chat_id !== null ? s.chat_id : '';
  r.label = s.label !== undefined && s.label !== null ? s.label : '';
  r.role = s.role !== undefined && s.role !== null ? s.role : '';
  r.instance = s.instance !== undefined && s.instance !== null ? s.instance : '';
  r.status = s.status !== undefined && s.status !== null ? s.status : '';
  r.preview = s.preview !== undefined && s.preview !== null ? s.preview : '';
  r.historical = s.historical === true;
  const st: string = r.status;
  r.running = s.running === true || st === 'running' || st === 'waiting_input' || st === 'pending';
  return r;
}

/** 调度文本：cron 表达式 / 每 N 秒 / 延迟 N 秒（优先级同服务端语义）。 */
export function scheduleText(job: CronJob): string {
  if (job.cron_expr !== undefined && job.cron_expr.length > 0) {
    return job.cron_expr;
  }
  if (job.every_seconds !== undefined && job.every_seconds > 0) {
    return `每 ${job.every_seconds} 秒`;
  }
  if (job.delay_seconds !== undefined && job.delay_seconds > 0) {
    return `${job.delay_seconds} 秒后`;
  }
  return '未设置';
}

/** ISO 时间 → `HH:MM`（本地时区；解析失败原样返回）。 */
export function fmtHHMM(iso: string | undefined): string {
  if (iso === undefined || iso.length === 0) {
    return '';
  }
  const t: number = Date.parse(iso);
  if (Number.isNaN(t)) {
    return iso;
  }
  const d: Date = new Date(t);
  const hh: string = d.getHours() < 10 ? `0${d.getHours()}` : `${d.getHours()}`;
  const mm: string = d.getMinutes() < 10 ? `0${d.getMinutes()}` : `${d.getMinutes()}`;
  return `${hh}:${mm}`;
}

// ── 行卡**语义 tone**（⛔ core/ 只产 role 名，**不 import 任何主题/调色板**）──────────
// 运行面板四类列表的**结构化行**（批次10，2026-10-12）：此前每类都是「单行纯文本」，
// 状态与元信息被长命令挤掉（真机：62 条后台任务全渲染成「完成 <长命令…>」，时长/id 被
// `maxLines` 截掉）⇒ 拆成「主行（标识）+ 副行（状态 · 元信息）」两行，副行按 tone 上色。
export const TONE_MUTED: string = 'muted';
export const TONE_SUCCESS: string = 'success';
export const TONE_ERROR: string = 'error';

/** 定时任务·主行（标识 = 消息文本；缺 ⇒ 调度文本，绝不渲染空行）。 */
export function cronPrimary(job: CronJob): string {
  const msg: string = job.message !== undefined ? job.message.trim() : '';
  return msg.length > 0 ? msg : scheduleText(job);
}

/** 定时任务·副行 = `[一次性 · ]<调度>[ · 下次 HH:MM]`（缺项自动省略）。 */
export function cronSubText(job: CronJob): string {
  const one: string = job.one_shot === true ? '一次性 · ' : '';
  const next: string = fmtHHMM(job.next_run);
  const tail: string = next.length > 0 ? ` · 下次 ${next}` : '';
  return `${one}${scheduleText(job)}${tail}`;
}

/** 时长文本（秒 / 分秒）。 */
export function durationText(startedAt: string | undefined, finishedAt: string | undefined,
  nowMs: number): string {
  if (startedAt === undefined || startedAt.length === 0) {
    return '';
  }
  const s: number = Date.parse(startedAt);
  if (Number.isNaN(s)) {
    return '';
  }
  let end: number = nowMs;
  if (finishedAt !== undefined && finishedAt.length > 0) {
    const f: number = Date.parse(finishedAt);
    if (!Number.isNaN(f)) {
      end = f;
    }
  }
  const sec: number = Math.max(0, Math.round((end - s) / 1000));
  if (sec < 60) {
    return `${sec}s`;
  }
  const m: number = Math.floor(sec / 60);
  const r: number = sec % 60;
  return `${m}m${r}s`;
}

/**
 * 后台任务·主行（标识）= 命令（缺 ⇒ id）——**单行**，长命令由组件 `maxLines(1)` 截断。
 * ⛔ 时长/exit/id 不再挤在这一行（旧 `bgTaskLine` 的缺陷：真机 3 行截断把元信息全吃掉）。
 */
export function bgTaskPrimary(t: BgTask): string {
  const cmd: string = t.command !== undefined ? t.command.trim() : '';
  if (cmd.length > 0) {
    return cmd;
  }
  return t.id !== undefined ? t.id : '';
}

/**
 * 后台任务·副行 = `状态 · exit N · 时长 · id`（缺项自动省略；失败时并入 `error` 首行）。
 *
 * ⛔ 状态短语走 `bgTaskStatusText`（**唯一判据**，killed 抢在 exit_code 之前）—— 与详情页同源。
 */
export function bgTaskSubText(t: BgTask, nowMs: number): string {
  const parts: string[] = [bgTaskStatusText(t)];
  const meta: string = bgTaskMetaText(t, nowMs);
  if (meta.length > 0) {
    parts.push(meta);
  }
  const err: string = t.error !== undefined ? t.error.trim() : '';
  if (err.length > 0 && bgTaskFailed(t)) {
    // 失败原因不能只藏在详情里：副行补一句（取首行，避免多行撑高行卡）
    const nl: number = err.indexOf('\n');
    parts.push(nl >= 0 ? err.substring(0, nl) : err);
  }
  return parts.join(' · ');
}

/**
 * 是否属于**故障失败**（⛔ `killed`/`aborted`/`cancelled` = 用户主动终止 ⇒ **不算**故障）。
 *
 * ⭐ 批次10 抽出的**唯一判据**：`bgTaskStatusText`（文案）/ `bgTaskSubText`（是否并入 error）/
 *    `bgTaskTone`（颜色）三处**必须同源** —— 否则会出现「副行说『已终止』、颜色却报红」这种
 *    **同一行自相矛盾**（本仓已知缺陷类：列表与详情不同源）。测试 `panels.test.ts` 捕获过该 bug。
 */
export function bgTaskFailed(t: BgTask): boolean {
  const raw: string = t.status !== undefined ? t.status.toLowerCase() : '';
  if (raw === 'killed' || raw === 'aborted' || raw === 'cancelled') { return false; }
  return toolStatusKind(t.status, t.exit_code) === ST_ERROR;
}

/** 后台任务·tone：运行中 ⇒ success；故障失败 ⇒ error；其余（完成/已终止）⇒ muted。 */
export function bgTaskTone(t: BgTask): string {
  if (bgTaskRunning(t)) {
    return TONE_SUCCESS;
  }
  return bgTaskFailed(t) ? TONE_ERROR : TONE_MUTED;
}

// ── 后台任务**详情**（2026-10-12 补齐）─────────────────────────────────────────────
// 用户点名「任务管理做的很差」：此前原生只有上面那一行字 —— **看不到输出、杀不掉**。
// 形态对齐 web `workspace/panels/BackgroundPanel.tsx`（标题 + 状态 + kill + 实时输出）。

/** `kill_bg_task` 的 RPC 参数（服务端 `serverapp/rpc_table.go:1818` 读 `task_id`）。 */
export class KillBgTaskParams {
  task_id: string = '';

  constructor(taskId: string) {
    this.task_id = taskId;
  }
}

/** 任务是否仍在跑（web `BackgroundPanel.tsx:33`：`running|started` ⇒ 运行中）。 */
export function bgTaskRunning(t: BgTask): boolean {
  const raw: string = t.status !== undefined ? t.status.toLowerCase() : '';
  return raw === 'running' || raw === 'started';
}

/**
 * 详情页状态短语（纯文字；设计系统 §2.8 禁 emoji）。
 *
 * ⛔ **判据 = `bgTaskFailed`（唯一真源）**：`killed` **要抢在 exit_code 之前**判 —— 被杀的进程
 *    exit 130 ⇒ 若先问 `toolStatusKind` 会返回 ST_ERROR 而显示「失败」，那就把「用户主动终止」
 *    误报成故障（web 面板同样把 killed 单列）。
 */
export function bgTaskStatusText(t: BgTask): string {
  const raw: string = t.status !== undefined ? t.status.toLowerCase() : '';
  if (raw === 'killed' || raw === 'aborted' || raw === 'cancelled') { return '已终止'; }
  if (bgTaskRunning(t)) { return '运行中'; }
  return bgTaskFailed(t) ? '失败' : '完成';
}

/** 详情页副行：`exit 0 · 3.2s · <id>`（耗时同源 `durationText`；缺项自动省略）。 */
export function bgTaskMetaText(t: BgTask, nowMs: number): string {
  const parts: string[] = [];
  if (t.exit_code !== undefined) { parts.push(`exit ${t.exit_code}`); }
  const dur: string = durationText(t.started_at, t.finished_at, nowMs);
  if (dur.length > 0) { parts.push(dur); }
  const id: string = t.id !== undefined ? t.id : '';
  if (id.length > 0) { parts.push(id); }
  return parts.join(' · ');
}

/** 详情页输出正文（`error` 并入尾部 —— 失败原因不能只藏在别的字段里）。 */
export function bgTaskOutputText(t: BgTask): string {
  const out: string = t.output !== undefined ? t.output : '';
  const err: string = t.error !== undefined ? t.error : '';
  if (out.length === 0) { return err; }
  if (err.length === 0 || out.indexOf(err) >= 0) { return out; }
  return `${out}\n${err}`;
}

/** Runner·主行（标识）= 名字（缺 ⇒ `(未命名)`）——凭据永不显示。 */
export function runnerPrimary(r: RunnerRow): string {
  return r.name !== undefined && r.name.length > 0 ? r.name : '(未命名)';
}

/** Runner·副行 = `在线/离线 · <mode>[ · v<version>][ · <workspace>]`（纯文字，无 emoji —— §2.8）。 */
export function runnerSubText(r: RunnerRow): string {
  const dot: string = r.online === true ? '在线' : '离线';
  const mode: string = r.mode !== undefined && r.mode.length > 0 ? r.mode : 'native';
  const ver: string = r.version !== undefined && r.version.length > 0 ? ` · v${r.version}` : '';
  const ws: string = r.workspace !== undefined && r.workspace.length > 0 ? ` · ${r.workspace}` : '';
  return `${dot} · ${mode}${ver}${ws}`;
}

/** Runner·tone：在线 ⇒ success；离线 ⇒ muted。 */
export function runnerTone(r: RunnerRow): string {
  return r.online === true ? TONE_SUCCESS : TONE_MUTED;
}

/** 子代理·主行（标识）= label（缺 ⇒ chat_id）。 */
export function subagentPrimary(s: SubAgentRow): string {
  // 15h：标题口径对齐 web `TasksPanel.tsx:308 subAgentTitle` —— `role`(/`instance`) 优先，
  //      其次 `label`，再次 `chat_id`（后端会话树的子代理项带 `role`/`instance`）。
  const role: string = s.role !== undefined ? s.role.trim() : '';
  const inst: string = s.instance !== undefined ? s.instance.trim() : '';
  if (role.length > 0) {
    return inst.length > 0 ? `${role}/${inst}` : role;
  }
  const label: string = s.label !== undefined ? s.label.trim() : '';
  if (label.length > 0) {
    return label;
  }
  return s.chat_id !== undefined ? s.chat_id : '';
}

/** 子代理·副行 = 预览 / 等待输入 / 排队中 / 运行中 / 历史 / 完成（纯文字，无 emoji —— §2.8）。 */
export function subagentSubText(s: SubAgentRow): string {
  const p: string = s.preview !== undefined ? s.preview.trim() : '';
  if (p.length > 0) {
    return p;
  }
  const st: string = s.status !== undefined ? s.status.trim() : '';
  if (st === 'waiting_input') {
    return '等待输入';
  }
  if (st === 'pending') {
    return '排队中';
  }
  if (s.running === true) {
    return '运行中';
  }
  if (s.historical === true) {
    return '历史';
  }
  return '完成';
}

/** 子代理·tone：运行中 ⇒ success；其余 ⇒ muted。 */
export function subagentTone(s: SubAgentRow): string {
  return s.running === true ? TONE_SUCCESS : TONE_MUTED;
}

/** 面板计数文本（0 也要显示，避免"面板是空的"和"没加载"混淆）。 */
export function countText(n: number): string {
  return `${n}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 插件 widget 推送（SSE `web_widgets` / `plugin_widgets`）—— **绝不静默丢**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 原生渲染层目前**没有**消费 zones/components 的组件 ⇒ 明确标"未支持"（不静默）。
 *
 * ⛔ 诚实契约：解析函数**照样**把服务端推来的 zones/components 解出来（数据已暴露），
 *    但这个常量 = false 表示"当前无组件可渲染" ⇒ 渲染层应显示「插件面板暂不支持」
 *    而不是默默什么都不做。接线方案见交付清单（需 `components/**`，不属本轮可改）。
 */
export const WIDGETS_RENDERABLE: boolean = false;

/** 一个 web UI 组件声明（web `types/shared.ts:692-724` 的 WebUIComponentDecl 子集）。 */
export interface WidgetComponentDecl {
  id?: string;
  label?: string;
  title?: string;
  type?: string;
}

/** `web_widgets` / `plugin_widgets` 载荷（web `PluginWidgetProvider.tsx:63-74` 同形）。 */
interface WidgetPayload {
  zones?: Record<string, object>;
  components?: WidgetComponentDecl[];
  revision?: number;
}

/**
 * widget 事件载荷的**显式**解析结果（ok/reason 二选一，绝不静默 return null）。
 * 与 `normalize.ts` 对未知事件 `default: return null`（静默丢）形成对照 —— 本类
 * 让"服务端推了插件数据、客户端却看不到"这件事**可观测**。
 */
export class WidgetSnapshot {
  /** 解析是否成功（false 时 `reason` 非空）。 */
  ok: boolean = false;
  /** 失败原因（空载荷 / 非 widget 事件 / JSON 不合法 / null）。 */
  reason: string = '';
  /** 服务端单调修订号（增量合并用；缺省 -1）。 */
  revision: number = -1;
  /** zones 的键（有序；渲染层据此挂载各区域）。 */
  zoneKeys: string[] = [];
  /** components 的展示名（label > title > id，按序）。 */
  componentLabels: string[] = [];
}

/** 事件名是否属于插件 widget 推送（复用 `core/types.ets:236-237` 的常量，不另造字面量）。 */
export function isWidgetEvent(event: string): boolean {
  return event === SseEventType.webWidgets || event === SseEventType.pluginWidgets;
}

/**
 * 解析 widget 推送载荷（`content` = JSON `{zones?, components?, revision?}`）。
 *
 * 服务端链路：`channel/web/web.go:452 NotifyWidgetsUpdated` → hub 推 `MsgTypeWebWidgets`
 *   （`protocol/ws.go:27`，`plugin_widgets` 见 `:26`）；web 同款解析在
 *   `web/src/plugins/PluginWidgetProvider.tsx:63-74`。
 * 本仓现状：`core/types.ets:236-237` 有事件名常量，但 `store.handleSse` 未分支、
 *   `normalize.normalizeEvent` 的 `default: return null` ⇒ **静默丢弃**（本次修复目标）。
 */
export function parseWidgetsPayload(event: string, content: string): WidgetSnapshot {
  const snap: WidgetSnapshot = new WidgetSnapshot();
  if (!isWidgetEvent(event)) {
    snap.reason = `非 widget 事件: ${event}`;
    return snap;
  }
  if (content.length === 0) {
    snap.reason = '空载荷';
    return snap;
  }
  let payload: WidgetPayload | null = null;
  try {
    payload = JSON.parse(content) as WidgetPayload;
  } catch (e) {
    snap.reason = '载荷不是合法 JSON';
    return snap;
  }
  if (payload === null) {
    snap.reason = '载荷为 null';
    return snap;
  }
  snap.ok = true;
  const rev: number | undefined = payload.revision;
  if (rev !== undefined && rev !== null) {
    snap.revision = rev;
  }
  const zones: Record<string, object> | undefined = payload.zones;
  if (zones !== undefined && zones !== null) {
    const keys: string[] = Object.keys(zones);
    keys.sort();
    snap.zoneKeys = keys;
  }
  const comps: WidgetComponentDecl[] | undefined = payload.components;
  if (comps !== undefined && comps !== null) {
    const labels: string[] = [];
    for (let i = 0; i < comps.length; i++) {
      const c: WidgetComponentDecl = comps[i];
      const l: string = c.label !== undefined && c.label.length > 0 ? c.label
        : (c.title !== undefined && c.title.length > 0 ? c.title
          : (c.id !== undefined ? c.id : ''));
      if (l.length > 0) {
        labels.push(l);
      }
    }
    snap.componentLabels = labels;
  }
  return snap;
}
