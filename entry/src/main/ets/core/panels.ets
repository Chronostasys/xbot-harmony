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

import { GAP_ROW_Y, HIT_TARGET_MIN, SPACE_SM, SPACE_XS } from './design';
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
  /** 一次性**绝对时间**（`at`）——服务端 `storage/sqlite/cron.go:24` 的 json tag。 */
  at?: string;
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

/** 调度文本：cron 表达式 / 每 N 秒 / **绝对时间** / 延迟 N 秒（优先级同服务端 + web `TasksPanel.tsx:137-146`）。 */
export function scheduleText(job: CronJob): string {
  if (job.cron_expr !== undefined && job.cron_expr.length > 0) {
    return job.cron_expr;
  }
  if (job.every_seconds !== undefined && job.every_seconds > 0) {
    return `每 ${job.every_seconds} 秒`;
  }
  // ⚠️ `at`（一次性绝对时间）**必须在 `delay_seconds` 之前** —— 与 web 的取值顺序逐字一致
  //    （`cronExpr → everySeconds → at → delaySeconds`）。漏掉 `at` 的真机症状：agent 用
  //    「2027-01-01 触发」建的任务在面板里显示「未设置」（2026-10-13 装机实测，本波修）。
  if (job.at !== undefined && job.at !== null && job.at.length > 0) {
    const t: string = fmtDateTime(job.at);
    return t.length > 0 ? `${t} 触发` : job.at;
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
  // ⚠️ 走 `cmdOneLine` 同款归一化：`message` 可能是多行/带转义 ⇒ 主行是 `.maxLines(1)`，
  //    不折叠会在行里留下换行噪声（与后台任务主行同一处置）。
  const msg: string = job.message !== undefined ? cmdOneLine(job.message.trim()) : '';
  return msg.length > 0 ? msg : scheduleText(job);
}

/** 定时任务·副行 = `[一次性 · ]<调度>[ · 下次 HH:MM]`（缺项自动省略）。 */
export function cronSubText(job: CronJob): string {
  const one: string = job.one_shot === true ? '一次性 · ' : '';
  const next: string = fmtHHMM(job.next_run);
  const tail: string = next.length > 0 ? ` · 下次 ${next}` : '';
  return `${one}${scheduleText(job)}${tail}`;
}

/** 两位补零（内部工具）。 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** ISO 时间 → `YYYY-MM-DD HH:MM`（本地时区；空 ⇒ `''`；解析失败原样返回）。 */
export function fmtDateTime(iso: string | undefined): string {
  if (iso === undefined || iso === null || iso.length === 0) {
    return '';
  }
  const t: number = Date.parse(iso);
  if (Number.isNaN(t)) {
    return iso;
  }
  const d: Date = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 定时任务·**消息全文**（详情页用）。
 *
 * ⛔ 与主行 `cronPrimary` 的 `cmdOneLine` 归一化**刻意不同**：主行是 `.maxLines(1)`，
 *    多行提示词在那里只剩第一行；详情页若也折叠，用户**永远看不到自己写的正文**
 *    （web `TasksPanel.tsx:120-131` 展开区同样保留原文 —— 用户报告过"电脑 cron 也无法点开看详情"）。
 *    这里只去首尾空白，行内换行/缩进逐字保留。
 */
export function cronMessageText(job: CronJob): string {
  const m: string = job.message !== undefined && job.message !== null ? job.message : '';
  return m.trim();
}

/** 定时任务·投递目标 = `channel:chat_id`（缺项自动省略；两者皆空 ⇒ `''`）。 */
export function cronTargetText(job: CronJob): string {
  const ch: string = job.channel !== undefined && job.channel !== null ? job.channel.trim() : '';
  const cid: string = job.chat_id !== undefined && job.chat_id !== null ? job.chat_id.trim() : '';
  if (ch.length > 0 && cid.length > 0) {
    return `${ch}:${cid}`;
  }
  return ch.length > 0 ? ch : cid;
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
/**
 * 命令 / 多行文本 → **单行显示串**（纯函数，列表主行与详情标题专用）。
 *
 * ⛔ 服务端 `command` 里带**字面 `\\n`**（反斜杠 + n，JSON 双重转义）以及真实换行/制表/连续空白
 * —— 直接渲染会在行里出现一堆「\n」字样（真机取证 2026-10-12：后台任务列表 142 行主行整行全是
 * `K=~/.ssh/b300_spot.pem\nssh -i $K ubuntu@...'set -e\ncd ~/cann\n...`，一层转义噪声）。
 * 规则：`\n`/`\t`/`\r`（**字面**与真实两种形态）→ 空格；连续空白折叠为 1 个；首尾去白。
 * ⛔ 不用正则（ArkTS 侧稳妥）：手写折叠循环。
 */
export function cmdOneLine(cmd: string): string {
  if (cmd.length === 0) {
    return '';
  }
  const flat: string = cmd
    .split('\\n').join(' ').split('\\t').join(' ').split('\\r').join(' ')
    .split('\n').join(' ').split('\t').join(' ').split('\r').join(' ');
  let out: string = '';
  let prevSpace: boolean = false;
  for (let i: number = 0; i < flat.length; i++) {
    const ch: string = flat.charAt(i);
    if (ch === ' ') {
      if (prevSpace) {
        continue;
      }
      prevSpace = true;
    } else {
      prevSpace = false;
    }
    out += ch;
  }
  return out.trim();
}

export function bgTaskPrimary(t: BgTask): string {
  const cmd: string = t.command !== undefined ? cmdOneLine(t.command.trim()) : '';
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

// ── 后台任务·**列表层可读性判据**（前导状态码 / 运行中置顶）──────────────────────────
// 用户点名「任务管理做的很差」；真机实测：354 条任务**一屏平铺**，每行只有「命令 + 状态行 +
// chevron」⇒ ① 正在跑的那条混在中间（用户"看不到任务"）② 扫不出失败项。

/** 前导状态码（⛔ `core/` 禁 ArkUI 资源 ⇒ 这里只出**码**，符号映射留在组件）。 */
export const LEAD_RUNNING: string = 'running';
export const LEAD_OK: string = 'ok';
export const LEAD_FAIL: string = 'fail';
export const LEAD_KILLED: string = 'killed';

/**
 * 列表行的**前导状态码** —— 与 `bgTaskStatusText`（文案）/ `bgTaskTone`（颜色）
 * **同源**（都经 `bgTaskRunning`/`bgTaskFailed` 这两个唯一真源）。
 * ⛔ 不许在这里另判一套：否则会出现「字形说运行中、颜色说失败」这种同一行自相矛盾
 * （本仓已知缺陷类：列表与详情不同源）。
 */
export function bgTaskLeadCode(t: BgTask): string {
  if (bgTaskRunning(t)) {
    return LEAD_RUNNING;
  }
  const raw: string = t.status !== undefined ? t.status.toLowerCase() : '';
  if (raw === 'killed' || raw === 'aborted' || raw === 'cancelled') {
    return LEAD_KILLED;
  }
  return bgTaskFailed(t) ? LEAD_FAIL : LEAD_OK;
}

/** 运行中任务数（列表分组/徽章用；判据 = `bgTaskRunning`）。 */
export function bgTaskActiveCount(list: BgTask[]): number {
  const src: BgTask[] = arrOrEmpty(list);
  let n: number = 0;
  for (let i = 0; i < src.length; i++) {
    if (bgTaskRunning(src[i])) {
      n += 1;
    }
  }
  return n;
}

/**
 * **运行中置顶**排序（稳定；组内保持服务端原次序 = 时间序）。
 * 真机实测动因：354 条里"正在跑的那条"混在中段 ⇒ 用户以为"任务没了"。
 */
export function sortBgTasksActiveFirst(list: BgTask[]): BgTask[] {
  const src: BgTask[] = arrOrEmpty(list);
  const out: BgTask[] = [];
  for (let i = 0; i < src.length; i++) {
    if (bgTaskRunning(src[i])) {
      out.push(src[i]);
    }
  }
  for (let i = 0; i < src.length; i++) {
    if (!bgTaskRunning(src[i])) {
      out.push(src[i]);
    }
  }
  return out;
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
  // ⛔ **未结束不报退出码**（2026-10-13 有数据态真机实测 + web 权威）：web
  //   `TasksPanel.tsx:240-243` 是 `task.status === 'done' ? \`exit ${task.exitCode}\` : task.status`
  //   —— 即**只有结束时**才显示 `exit N`。此前原生给**运行中**的行也拼了 `exit -1`
  //   （服务端未结束时的哨兵值）⇒ 副行变成「运行中 · exit -1 · 519m37s · 4c4bc8f8」，
  //   同一行自相矛盾（"还在跑"却"已经退出、码 = -1"）。
  if (!bgTaskRunning(t) && t.exit_code !== undefined) { parts.push(`exit ${t.exit_code}`); }
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

/**
 * 运行面板轮询周期：**有在跑的东西**（后台任务 或 子代理）⇒ 2s。
 *
 * web 同源：`useTasks.ts:117-122` —— `hasRunning ? 2_000 : REFRESH_INTERVAL_MS`。
 */
export const PANEL_POLL_ACTIVE_MS: number = 2000;

/** 运行面板轮询周期：静息 ⇒ 30s（web `useTasks.ts:49 REFRESH_INTERVAL_MS = 30_000`）。 */
export const PANEL_POLL_IDLE_MS: number = 30000;

/**
 * 运行面板的**自适应轮询周期**（ms）—— 与 web **逐条同源**（不允许发明）：
 *   · `web/src/hooks/useTasks.ts:117-122`：有后台任务 `running|started` ⇒ `setInterval(…, 2_000)`，
 *     否则 `REFRESH_INTERVAL_MS = 30_000`；
 *   · `web/src/components/sidebar/TasksPanel.tsx:48-54`：有 running 子代理 ⇒ 每 `2_000ms`
 *     `session.refresh()`。
 * ⇒ 合成判据 = **「有任何在跑的东西 ⇒ 2s；否则 30s」**（两个真源取"更快者"，与 web 的叠加效果一致）。
 *
 * ⛔ 为什么必须有：此前原生**只在**「打开面板 / 切 tab / 手点刷新」取数 ⇒ 面板开着时数据是**死的**
 *    （后台任务跑完、子代理状态翻转都不更新）—— 用户口径「任务管理做的很差」的可修点之一。
 * ⛔ 纯函数（无定时器、不碰 ArkUI）⇒ 可脱机单测；接线侧只在"何时补一拍"上用 `setTimeout` 自续期。
 */
export function panelPollMs(bgTasks: BgTask[], subs: SubAgentRow[]): number {
  if (bgTaskActiveCount(bgTasks) > 0) {
    return PANEL_POLL_ACTIVE_MS;
  }
  const rows: SubAgentRow[] = arrOrEmpty(subs);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].running === true) {
      return PANEL_POLL_ACTIVE_MS;
    }
  }
  return PANEL_POLL_IDLE_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// 插件 widget 推送（SSE `web_widgets` / `plugin_widgets`）—— **绝不静默丢**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 原生渲染层**已消费** zones/components ⇒ 事实为 `true`（2026-10-13 订正）。
 *
 * ── 历史（为什么这里曾经是 `false`，以及它为什么变成假陈述）──────────────────────
 *   当年为 `false` 是**诚实**的："原生没有组件消费 zones/components"（解析在、渲染层缺），
 *   并配上"渲染层应显示「插件面板暂不支持」而不是默默什么都不做"的契约。
 *   此后 `components/PluginWidgets.ets` + `components/WidgetDock.ets` 补齐并接线，
 *   但**常量与注释**（连同 `docs/RELEASE.md:98`、`docs/RELEASE-NOTES.md:118` 两份文档）
 *   一同腐烂成**假陈述** ⇒ 正是 AGENTS.md 记的「同一件事只能有一个判据 / 文档说有、代码没有」形态。
 *
 * ── 接线（**可机器复核**：`tools/tests/widgets_parse.test.ts` ⑤ 钉调用点，⛔ 不钉"文件存在"）──
 *   · `core/store.ets:onSse`：命中 `isWidgetEvent(event)` ⇒ 保留**原始串**（含坏 JSON）投给
 *     `lastWidgetEvent` / `lastWidgetContent`（**先于 `JSON.parse`**，不解析 ⇒ 不可能抛）；
 *   · `pages/Index.ets`：转成 `widgetEvent` / `widgetContent` ⇒
 *     `components/WidgetDock.ets`（聊天内联落点）+ `components/PluginWidgets.ets`（宿主页全量卡）。
 *
 * ⛔ **单个 widget 体裁**不受支持时仍**逐块显式降级**（`WIDGET_UNSUPPORTED_LABEL` = 「暂不支持」，
 *    见 `core/widgetsview.ets` 的 `degradeReasonForType`：`code`/`src` 需 iframe 沙箱）—— 那是**块级**
 *    契约，与"整类功能有没有渲染层"是两件事，⛔ 别把二者混成一个旗标。
 */
export const WIDGETS_RENDERABLE: boolean = true;

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


// ══════════════════════════════════════════════════════════════════════════════
// 待发队列面板：列表高度（内容自适应 + 上下限）—— `components/QueueSheet.ets` 消费
// ══════════════════════════════════════════════════════════════════════════════
//
// ⛔ 曾经的缺陷（与能力面板**同族**，见 `core/pluginview.ets:352-355` 的同类记载）：
//    `QueueSheet` 的 `List` 是**硬编码 `.height(300)`** ⇒
//    ① 队列长时**靠后的行看不到**（面板高度不随内容长，只能在 300vp 里滚）；
//    ② 队列只有 1 条时**留一大块空白**（面板永远 300vp 高）。
//    ⇒ 与能力面板同一处置：**行数 → 高度**，夹在 `[QUEUE_LIST_MIN_H, QUEUE_LIST_MAX_H]`；
//      行少 ⇒ 卡片矮（观感不变）；行多 ⇒ 长到上限后**表内滚动**（不再有"有行却看不见"）。

/** 队列行高（vp）估算 = 44 命中盒 + 上下内边距（`SPACE_XS`×2）+ 行距（`GAP_ROW_Y`）——与 `QueueSheet` 行卡同源。 */
export const QUEUE_ROW_H: number = HIT_TARGET_MIN + 2 * SPACE_XS + GAP_ROW_Y;
/** 队列列表最小高（vp）：1 条也要留出"能看见、不贴边"的高度。 */
export const QUEUE_LIST_MIN_H: number = 120;
/** 队列列表最大高（vp）：到此为止，超出**表内滚动**（≈ 6 行）。 */
export const QUEUE_LIST_MAX_H: number = SPACE_SM * 35;

/**
 * 队列列表高度（vp）——**夹在 `[QUEUE_LIST_MIN_H, QUEUE_LIST_MAX_H]`**。
 * ⛔ 负值/NaN 一律按 0 条（防御：上游 `queue` 可能瞬时为空）。
 */
export function queueListHeight(count: number): number {
  const n: number = count > 0 ? Math.floor(count) : 0;
  const h: number = n * QUEUE_ROW_H;
  if (h > QUEUE_LIST_MAX_H) {
    return QUEUE_LIST_MAX_H;
  }
  return h > QUEUE_LIST_MIN_H ? h : QUEUE_LIST_MIN_H;
}
