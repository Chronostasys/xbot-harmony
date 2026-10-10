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
 */

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

/** 后台任务的状态图标。 */
export function statusIcon(status: string | undefined): string {
  if (status === 'running' || status === 'started' || status === 'pending') {
    return '▶';
  }
  if (status === 'done' || status === 'completed' || status === 'success') {
    return '✓';
  }
  if (status === 'failed' || status === 'error' || status === 'killed') {
    return '✗';
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
  const exitPart: string = t.status === 'failed' || t.status === 'error'
    ? ` · exit ${t.exit_code !== undefined ? t.exit_code : '?'}` : '';
  const id: string = t.id !== undefined ? t.id : '';
  return `${icon} ${cmd}${durPart}${exitPart}（${id}）`;
}

/** 一条 Runner 的显示行（凭据永不显示）。 */
export function runnerLine(r: RunnerRow): string {
  const dot: string = r.online === true ? '🟢' : '⚪';
  const name: string = r.name !== undefined ? r.name : '(未命名)';
  const mode: string = r.mode !== undefined && r.mode.length > 0 ? r.mode : 'native';
  const ver: string = r.version !== undefined && r.version.length > 0 ? ` · v${r.version}` : '';
  const ws: string = r.workspace !== undefined && r.workspace.length > 0 ? ` · ${r.workspace}` : '';
  return `${dot} ${name} · ${mode}${ver}${ws}`;
}

/** 一条子代理的显示行。 */
export function subagentLine(s: SubAgentRow): string {
  const dot: string = s.running === true ? '▶' : '✓';
  const label: string = s.label !== undefined && s.label.length > 0
    ? s.label : (s.chat_id !== undefined ? s.chat_id : '');
  return `${dot} ${label}`;
}

/** 面板计数文本（0 也要显示，避免"面板是空的"和"没加载"混淆）。 */
export function countText(n: number): string {
  return `${n}`;
}
