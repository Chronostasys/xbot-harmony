"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubAgentRow = void 0;
exports.scheduleText = scheduleText;
exports.fmtHHMM = fmtHHMM;
exports.cronLine = cronLine;
exports.statusIcon = statusIcon;
exports.durationText = durationText;
exports.bgTaskLine = bgTaskLine;
exports.runnerLine = runnerLine;
exports.subagentLine = subagentLine;
exports.countText = countText;
/**
 * 子代理行。
 *
 * ⚠️ 这里是 **class** 不是 interface：store 里需要就地填充（`new SubAgentRow()`）——
 * ArkTS 禁止 `const x: SomeInterface = {}` 这种空对象字面量（arkts-no-untyped-obj-literals）。
 */
class SubAgentRow {
    constructor() {
        this.chat_id = '';
        this.label = '';
        this.running = false;
    }
}
exports.SubAgentRow = SubAgentRow;
/** 调度文本：cron 表达式 / 每 N 秒 / 延迟 N 秒（优先级同服务端语义）。 */
function scheduleText(job) {
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
function fmtHHMM(iso) {
    if (iso === undefined || iso.length === 0) {
        return '';
    }
    const t = Date.parse(iso);
    if (Number.isNaN(t)) {
        return iso;
    }
    const d = new Date(t);
    const hh = d.getHours() < 10 ? `0${d.getHours()}` : `${d.getHours()}`;
    const mm = d.getMinutes() < 10 ? `0${d.getMinutes()}` : `${d.getMinutes()}`;
    return `${hh}:${mm}`;
}
/** 一条定时任务的显示行。 */
function cronLine(job) {
    const one = job.one_shot === true ? '一次性 · ' : '';
    const next = fmtHHMM(job.next_run);
    const tail = next.length > 0 ? ` · 下次 ${next}` : '';
    const msg = job.message !== undefined ? job.message : '';
    return `${one}${scheduleText(job)} · ${msg}${tail}`;
}
/** 后台任务的状态图标。 */
function statusIcon(status) {
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
function durationText(startedAt, finishedAt, nowMs) {
    if (startedAt === undefined || startedAt.length === 0) {
        return '';
    }
    const s = Date.parse(startedAt);
    if (Number.isNaN(s)) {
        return '';
    }
    let end = nowMs;
    if (finishedAt !== undefined && finishedAt.length > 0) {
        const f = Date.parse(finishedAt);
        if (!Number.isNaN(f)) {
            end = f;
        }
    }
    const sec = Math.max(0, Math.round((end - s) / 1000));
    if (sec < 60) {
        return `${sec}s`;
    }
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return `${m}m${r}s`;
}
/** 一条后台任务的显示行。 */
function bgTaskLine(t, nowMs) {
    const icon = statusIcon(t.status);
    const cmd = t.command !== undefined ? t.command : '';
    const dur = durationText(t.started_at, t.finished_at, nowMs);
    const durPart = dur.length > 0 ? ` · ${dur}` : '';
    const exitPart = t.status === 'failed' || t.status === 'error'
        ? ` · exit ${t.exit_code !== undefined ? t.exit_code : '?'}` : '';
    const id = t.id !== undefined ? t.id : '';
    return `${icon} ${cmd}${durPart}${exitPart}（${id}）`;
}
/** 一条 Runner 的显示行（凭据永不显示）。 */
function runnerLine(r) {
    const dot = r.online === true ? '🟢' : '⚪';
    const name = r.name !== undefined ? r.name : '(未命名)';
    const mode = r.mode !== undefined && r.mode.length > 0 ? r.mode : 'native';
    const ver = r.version !== undefined && r.version.length > 0 ? ` · v${r.version}` : '';
    const ws = r.workspace !== undefined && r.workspace.length > 0 ? ` · ${r.workspace}` : '';
    return `${dot} ${name} · ${mode}${ver}${ws}`;
}
/** 一条子代理的显示行。 */
function subagentLine(s) {
    const dot = s.running === true ? '▶' : '✓';
    const label = s.label !== undefined && s.label.length > 0
        ? s.label : (s.chat_id !== undefined ? s.chat_id : '');
    return `${dot} ${label}`;
}
/** 面板计数文本（0 也要显示，避免"面板是空的"和"没加载"混淆）。 */
function countText(n) {
    return `${n}`;
}
