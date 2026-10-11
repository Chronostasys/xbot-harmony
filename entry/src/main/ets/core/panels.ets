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

import { ST_ERROR, toolStatusKind } from './toolstatus';
import { SseEventType } from './types';

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

/** 一条定时任务的显示行。 */
export function cronLine(job: CronJob): string {
  const one: string = job.one_shot === true ? '一次性 · ' : '';
  const next: string = fmtHHMM(job.next_run);
  const tail: string = next.length > 0 ? ` · 下次 ${next}` : '';
  const msg: string = job.message !== undefined ? job.message : '';
  return `${one}${scheduleText(job)} · ${msg}${tail}`;
}

/** 后台任务的状态标记（纯文字，无 emoji —— 设计系统 §2.8；见 core/panels 顶部说明）。 */
export function statusIcon(status: string | undefined): string {
  if (status === 'running' || status === 'started' || status === 'pending') {
    return '运行中';
  }
  if (status === 'done' || status === 'completed' || status === 'success') {
    return '完成';
  }
  if (status === 'failed' || status === 'error' || status === 'killed') {
    return '失败';
  }
  return '·';
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

/** 一条后台任务的显示行。 */
export function bgTaskLine(t: BgTask, nowMs: number): string {
  const icon: string = statusIcon(t.status);
  const cmd: string = t.command !== undefined ? t.command : '';
  const dur: string = durationText(t.started_at, t.finished_at, nowMs);
  const durPart: string = dur.length > 0 ? ` · ${dur}` : '';
  // 错误态判据**同源**（`core/toolstatus`）：`'failed'` 与 `'error'` 都判 ST_ERROR（不再各写一份）。
  const exitPart: string = toolStatusKind(t.status, undefined) === ST_ERROR
    ? ` · exit ${t.exit_code !== undefined ? t.exit_code : '?'}` : '';
  const id: string = t.id !== undefined ? t.id : '';
  return `${icon} ${cmd}${durPart}${exitPart}（${id}）`;
}

/** 一条 Runner 的显示行（凭据永不显示）。状态用**纯文字**（在线/离线），无 emoji —— 设计系统 §2.8。 */
export function runnerLine(r: RunnerRow): string {
  const dot: string = r.online === true ? '在线' : '离线';
  const name: string = r.name !== undefined ? r.name : '(未命名)';
  const mode: string = r.mode !== undefined && r.mode.length > 0 ? r.mode : 'native';
  const ver: string = r.version !== undefined && r.version.length > 0 ? ` · v${r.version}` : '';
  const ws: string = r.workspace !== undefined && r.workspace.length > 0 ? ` · ${r.workspace}` : '';
  return `${dot} ${name} · ${mode}${ver}${ws}`;
}

/** 一条子代理的显示行。状态用**纯文字**（运行中/完成），无 emoji —— 设计系统 §2.8。 */
export function subagentLine(s: SubAgentRow): string {
  const dot: string = s.running === true ? '运行中' : '完成';
  const label: string = s.label !== undefined && s.label.length > 0
    ? s.label : (s.chat_id !== undefined ? s.chat_id : '');
  return `${dot} ${label}`;
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
