/**
 * gitpanel.ets —— 内置 web 插件 `xbot.git-fancy`（Git 面板）的**数据模型 + 判据**（纯逻辑，可脱机单测）。
 *
 * ── 为什么会有这个模块（目标④「插件都打不开」的正面解法）────────────────────────
 * 用户在抽屉「插件」里点 `Git 面板` 时，此前落到**通用 Web UI 根页**（`http://…:8082/` 的聊天页），
 * 而不是该插件的面板 —— 因为 web 侧**没有静态 URL 入口**（`web/src/plugin-runtime/...`：
 * 插件 view 只能经 `ctx.ui.openViewTab` 打开，`commandRouter` 的 URI 协议全仓无消费点）。
 * ⇒ 唯一合法路线 = **把插件面板原生化**（先例：`core/sessionstats.ets` 会话统计、
 * `core/skills.ets` 技能管理，均为 web 内置插件）。本文件是 Git 面板的那一份。
 *
 * ── 契约来源（逐字对齐，⛔ 不猜）────────────────────────────────────────────────
 * · 前端调用面 `web/src/plugin-api/rpc.ts` 的 `git.*`（含 `xbot.ssh-runner.*` 的插件命名法说明）；
 * · 服务端插件实现 `plugins/xbot-git-fancy/main.go`（`status`/`log`/`commit`/`diff`/`branches`）；
 * · **wire 格式**（关键）：`/api/rpc` 表里**没有**插件方法键 ⇒ 含点号的方法必须包一层
 *   `{method:'web_plugin_rpc', params:{method:'xbot.git-fancy.status', params:{channel,chatID,…}}}`
 *   （web `src/plugin-runtime/rpc.ts:30-34`；直接当外层 method 传 ⇒ 服务端 `unknown RPC method`）。
 *
 * ── 判据与渲染同源 ─────────────────────────────────────────────────────────────
 * 本模块只做「解析 / 归一化 / 格式化 / 分页合并」，页面只做取数与所有权，
 * 组件只画。⇒ 同一份数据在"行"与"详情"里显示同一串字符（不可能 A 处说 `M`、B 处说 `modified`）。
 */
import { DiffFile, parseUnifiedDiff } from './diffparse';
// 时间本地化**复用** `core/panels.ets:fmtDateTime`（`YYYY-MM-DD HH:MM`，本地时区）——
// ⛔ 不新建第二套日期格式化（否则提交行与定时任务详情可能给出不同口径的同一时刻）。
import { fmtDateTime } from './panels';

// ── RPC 通道常量（唯一引用点，别处勿再拼字面量）────────────────────────────────

/** 插件 ID（服务端 `web_plugin_list` 的原值）。 */
export const GIT_PLUGIN_ID: string = 'xbot.git-fancy';
/** 插件方法的**外层**方法名（服务端 RPC 表里只有这一个入口）。 */
export const RPC_WEB_PLUGIN: string = 'web_plugin_rpc';
/** 后端文件名缺省字符（与 web 面板一致：无路径 ⇒ 不伪造名字）。 */
export const GIT_LOG_PAGE: number = 20;

/** `xbot.git-fancy.<method>` —— 插件方法的完整名（外层仍包 `web_plugin_rpc`）。 */
export function gitMethod(method: string): string {
  return `${GIT_PLUGIN_ID}.${method}`;
}

// ── 线格式（wire；服务端结构镜像，字段**可缺**——旧后端/异常时不得崩）──────────────

/** `status` 的一条变更（`main.go:132` 的 `change`）。 */
export interface GitChangeWire {
  path?: string;
  /** 归一化后的单字母：`M`/`A`/`D`/`R`/`C`/`U`（untracked）。 */
  status?: string;
  added?: number;
  deleted?: number;
}

/** `status` 的返回（`main.go:120-160` 的 `statusResult`）。 */
export interface GitStatusWire {
  repo?: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  clean?: boolean;
  changes?: GitChangeWire[];
  /** 非 git 仓库 / 命令失败时的可读原因（服务端原样带回）。 */
  error?: string;
}

/** `log` 的一条提交（`main.go:230-260` 的 `commitInfo`）。 */
export interface GitCommitWire {
  hash?: string;
  author?: string;
  when?: string;
  subject?: string;
}

/** `log` 的返回。 */
export interface GitLogWire {
  commits?: GitCommitWire[];
  /** 服务端 `rev-list --count` 总数 —— **分页判据**（`hasMoreGitLog`）。 */
  total?: number;
}

/** `diff` 的返回（`main.go:355-425`）。 */
export interface GitDiffWire {
  path?: string;
  /** 原始 `git diff` / `git show` 输出（**含 commit/show 前言**，需剥）。 */
  content?: string;
  original?: string;
  modified?: string;
  adds?: number;
  dels?: number;
  /** 未跟踪文件：`content` 不是 diff，而是文件正文（全增行）。 */
  untracked?: boolean;
  /** 该 diff 所属 commit（commit 作用域时非空）。 */
  commit?: string;
  error?: string;
}

/** `commit` 的返回（`main.go:322-330`：hash/short/author/email/date/message/files）。 */
export interface GitCommitDetailWire {
  hash?: string;
  /** 服务端给的短哈希（`fullHash[:7]`）—— 仍以本地 `gitShortHash` 为准，缺省时用它兜底。 */
  short?: string;
  author?: string;
  email?: string;
  /** ISO 8601（`%aI`）。 */
  date?: string;
  message?: string;
  files?: GitChangeWire[];
  error?: string;
}

// ── 归一化模型（组件只认这些）──────────────────────────────────────────────────

/** 一条变更（归一化：path 必有、字母必有、计数缺省 0）。 */
export class GitChange {
  path: string = '';
  status: string = '';
  added: number = 0;
  deleted: number = 0;
}

/** 工作区状态（归一化；`repo=false` ⇒ 只看 `error`/空态）。 */
export class GitStatus {
  repo: boolean = false;
  branch: string = '';
  ahead: number = 0;
  behind: number = 0;
  clean: boolean = true;
  changes: GitChange[] = [];
  error: string = '';
}

/** 一条提交（`shortHash` 是页面唯一显示用的短哈希 —— 与 web `hash.slice(0,7)` 同口径）。 */
export class GitCommitRow {
  hash: string = '';
  shortHash: string = '';
  author: string = '';
  when: string = '';
  subject: string = '';
}

/** 提交列表（`total` 用于分页判据）。 */
export class GitLog {
  commits: GitCommitRow[] = [];
  total: number = 0;
}

/** 一个文件的 diff（`diffText` 已剥前言 ⇒ 可直接喂 `parseUnifiedDiff`）。 */
export class GitDiffData {
  path: string = '';
  diffText: string = '';
  adds: number = 0;
  dels: number = 0;
  untracked: boolean = false;
  commit: string = '';
  error: string = '';
}

// ── 解析 / 归一化 ─────────────────────────────────────────────────────────────

/** 数值字段缺省 0（服务端可能省略 `omitempty` 的 0 值）。 */
function gitNum(v: number | undefined): number {
  return v === undefined ? 0 : v;
}

/** 字符串字段缺省空串。 */
function gitStr(v: string | undefined): string {
  return v === undefined ? '' : v;
}

/** `status` 响应 → 归一化模型。 */
export function parseGitStatus(raw: GitStatusWire | null): GitStatus {
  const out: GitStatus = new GitStatus();
  if (raw === null) {
    return out;
  }
  out.repo = raw.repo === true;
  out.branch = gitStr(raw.branch);
  out.ahead = gitNum(raw.ahead);
  out.behind = gitNum(raw.behind);
  out.clean = raw.clean !== false && (raw.changes === undefined || raw.changes.length === 0);
  out.error = gitStr(raw.error);
  const rows: GitChangeWire[] = raw.changes === undefined ? [] : raw.changes;
  const list: GitChange[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: GitChangeWire = rows[i];
    const c: GitChange = new GitChange();
    c.path = gitStr(r.path);
    c.status = gitStr(r.status);
    c.added = gitNum(r.added);
    c.deleted = gitNum(r.deleted);
    list.push(c);
  }
  out.changes = list;
  return out;
}

/** `log` 响应 → 归一化模型（短哈希在解析处算好 ⇒ 页面/组件不各算一份）。 */
export function parseGitLog(raw: GitLogWire | null): GitLog {
  const out: GitLog = new GitLog();
  if (raw === null) {
    return out;
  }
  const rows: GitCommitWire[] = raw.commits === undefined ? [] : raw.commits;
  const list: GitCommitRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: GitCommitWire = rows[i];
    const c: GitCommitRow = new GitCommitRow();
    c.hash = gitStr(r.hash);
    c.shortHash = gitShortHash(c.hash);
    c.author = gitStr(r.author);
    c.when = gitStr(r.when);
    c.subject = gitStr(r.subject);
    list.push(c);
  }
  out.commits = list;
  const t: number = gitNum(raw.total);
  // 旧后端可能不给 total ⇒ 用本页长度兜底（至少让「还有更多」的判断不误报）。
  out.total = t > 0 ? t : list.length;
  return out;
}

/**
 * 分页合并：把新一页追加到既有列表（按 `hash` **去重**）。
 *
 * ⛔ 为什么必须去重：`log` 的 `skip` 是服务端口径，而两次请求之间**仓库可能新增提交**
 * （本仓是多线并行、真机取证时刚 commit 过）⇒ 第二页会与第一页重叠一行；不去重会出现重复行
 * 且 `ForEach` 的键冲突（`.ets` 键 = hash ⇒ 重复键 = 渲染错乱）。
 */
export function mergeGitLog(prev: GitLog, page: GitLog): GitLog {
  const out: GitLog = new GitLog();
  const seen: Map<string, boolean> = new Map<string, boolean>();
  const merged: GitCommitRow[] = [];
  for (let i = 0; i < prev.commits.length; i++) {
    const c: GitCommitRow = prev.commits[i];
    if (!seen.has(c.hash)) {
      seen.set(c.hash, true);
      merged.push(c);
    }
  }
  for (let i = 0; i < page.commits.length; i++) {
    const c: GitCommitRow = page.commits[i];
    if (!seen.has(c.hash)) {
      seen.set(c.hash, true);
      merged.push(c);
    }
  }
  out.commits = merged;
  out.total = page.total > 0 ? page.total : prev.total;
  return out;
}

/** 还有更多提交可翻（`total` 大于已取条数）。 */
export function hasMoreGitLog(log: GitLog): boolean {
  return log.commits.length > 0 && log.commits.length < log.total;
}

/**
 * `diff` 响应 → 归一化模型。
 *
 * ⛔ 两处**必须**归一化，否则 UI 会把非 diff 文本当 diff 画：
 *  ① commit 作用域的 `content` 是 `git show` 的**完整输出**（前有 `commit <hash>` / `Author:` /
 *     `Date:` / 提交信息）⇒ 必须先剥到第一个 `diff --git`（或 `@@`/`---`）再交给 `parseUnifiedDiff`；
 *  ② 未跟踪文件**根本没有 diff**（`content` = 文件正文）⇒ 合成为"全增行"的统一 diff 文本
 *     （`@@ -0,0 +1,N @@` + 每行 `+`），这样渲染侧只需要一条通路。
 */
export function parseGitDiff(raw: GitDiffWire | null): GitDiffData {
  const out: GitDiffData = new GitDiffData();
  if (raw === null) {
    return out;
  }
  out.path = gitStr(raw.path);
  out.adds = gitNum(raw.adds);
  out.dels = gitNum(raw.dels);
  out.untracked = raw.untracked === true;
  out.commit = gitStr(raw.commit);
  out.error = gitStr(raw.error);
  const content: string = gitStr(raw.content);
  if (content.length === 0) {
    return out;
  }
  out.diffText = out.untracked ? synthesizeAddedLines(content) : stripDiffPreamble(content);
  return out;
}

/** diff 文本（已归一化）→ 解析产物；空文本 ⇒ 空数组（组件据此渲染空态）。 */
export function gitDiffFiles(d: GitDiffData): DiffFile[] {
  if (d.diffText.length === 0) {
    return [];
  }
  return parseUnifiedDiff(d.diffText);
}

/**
 * 剥掉 `git show` 前言：从第一个 `diff --git ` 起返回；没有再找第一个 `@@` / `--- `；
 * 都没有 ⇒ 原样返回（可能本就是裸 hunk）。⛔ 纯字符串处理，不改任何 diff 行内容。
 */
export function stripDiffPreamble(text: string): string {
  const lines: string[] = text.split('\n');
  let gitIdx: number = -1;
  let hunkIdx: number = -1;
  for (let i = 0; i < lines.length; i++) {
    const l: string = lines[i];
    if (gitIdx < 0 && l.indexOf('diff --git ') === 0) {
      gitIdx = i;
    }
    if (hunkIdx < 0 && (l.indexOf('@@') === 0 || l.indexOf('--- ') === 0)) {
      hunkIdx = i;
    }
  }
  const start: number = gitIdx >= 0 ? gitIdx : hunkIdx;
  if (start <= 0) {
    return text;
  }
  return lines.slice(start).join('\n');
}

/**
 * 未跟踪文件正文 → 「全增行」统一 diff 文本（可被 `parseUnifiedDiff` 消费）。
 * 尾部空行（文件以 `\n` 结尾产生的幻影行）**不产出**（与服务端 `main.go:381-388` 同口径）。
 */
export function synthesizeAddedLines(content: string): string {
  const lines: string[] = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    return '';
  }
  const out: string[] = [`@@ -0,0 +1,${lines.length} @@`];
  for (let i = 0; i < lines.length; i++) {
    out.push(`+${lines[i]}`);
  }
  return out.join('\n');
}

// ── 判据 / 格式化（行与详情**同源**）──────────────────────────────────────────

/** 短哈希（web `hash.slice(0,7)`；不足 7 位原样）。 */
export function gitShortHash(hash: string): string {
  return hash.length > 7 ? hash.substring(0, 7) : hash;
}

/**
 * 状态字母 → 显示字母。
 * 服务端已归一化（`??`→`U`、` M`/`M `→`M`…）；此处只兜**未归一化/未知**值：
 * 空 ⇒ `?`（宁可显示问号，也不显示空白格子）。
 */
export function gitStatusLetter(status: string): string {
  const s: string = status.trim();
  if (s.length === 0) {
    return '?';
  }
  return s.length > 1 ? s.substring(0, 1) : s;
}

/**
 * 状态字母 → 语义分档（组件据此取色；⛔ 组件不写第二套 `if`）：
 * · `add`  = 新增/未跟踪（`A`/`U`）
 * · `del`  = 删除（`D`）
 * · `warn` = 修改/改名/复制（`M`/`R`/`C`）
 * · `none` = 未知（显中性色，⛔ 不猜）
 */
export function gitStatusTone(status: string): string {
  const s: string = gitStatusLetter(status);
  if (s === 'A' || s === 'U') {
    return 'add';
  }
  if (s === 'D') {
    return 'del';
  }
  if (s === 'M' || s === 'R' || s === 'C') {
    return 'warn';
  }
  return 'none';
}

/** `+N −M`（两侧都 0 时给空串 ⇒ 组件不画"±0"这种噪音；未跟踪文件的 `−0` 同样不画）。 */
export function gitStatText(c: GitChange): string {
  const parts: string[] = [];
  if (c.added > 0) {
    parts.push(`+${c.added}`);
  }
  if (c.deleted > 0) {
    parts.push(`−${c.deleted}`);
  }
  return parts.join(' ');
}

/** 与上游的落差（`↑2 ↓1`；两者皆 0 ⇒ 空串，无上游时后端本来就都给 0）。 */
export function gitAheadBehindText(st: GitStatus): string {
  const parts: string[] = [];
  if (st.ahead > 0) {
    parts.push(`↑${st.ahead}`);
  }
  if (st.behind > 0) {
    parts.push(`↓${st.behind}`);
  }
  return parts.join(' ');
}

/** 分支名（无分支 ⇒ 可读兜底，⛔ 不留空白）。 */
export function gitBranchText(st: GitStatus): string {
  return st.branch.length > 0 ? st.branch : '（无分支）';
}

/**
 * 面板顶部的**一句状态**（判据在此，组件不写 `if` 森林）：
 * · 非仓库/报错 ⇒ 原因（截断交给组件）
 * · 干净 ⇒ 「工作区干净」
 * · 否则 ⇒ 「N 个文件有改动」
 */
export function gitHeadline(st: GitStatus): string {
  if (!st.repo) {
    return st.error.length > 0 ? st.error : '当前会话的工作目录不是 Git 仓库';
  }
  if (st.clean) {
    return '工作区干净';
  }
  return `${st.changes.length} 个文件有改动`;
}

/** 路径 → 文件名（最后一个 `/` 之后；无 `/` ⇒ 原值）。 */
export function gitFileName(path: string): string {
  const i: number = path.lastIndexOf('/');
  return i < 0 ? path : path.substring(i + 1);
}

/** 路径 → 目录（最后一个 `/` 之前；无 `/` ⇒ 空串，组件据此**不画**副行）。 */
export function gitFileDir(path: string): string {
  const i: number = path.lastIndexOf('/');
  return i <= 0 ? '' : path.substring(0, i);
}

// ── commit 详情（`commit {hash}`）────────────────────────────────────────────

/** 一个提交的详情（归一化；`files` 复用 `GitChange` ⇒ 行渲染与工作区变更**同一套**）。 */
export class GitCommitDetail {
  hash: string = '';
  shortHash: string = '';
  author: string = '';
  email: string = '';
  /** 本地化时间（`fmtDateTime`；不可解析 ⇒ 原样，⛔ 不丢信息）。 */
  when: string = '';
  /** 提交信息**全文**（保留换行；组件里封顶滚动）。 */
  message: string = '';
  files: GitChange[] = [];
  error: string = '';
}

/** `commit` 响应 → 归一化模型（缺字段不崩；短哈希以本地 7 位口径为准）。 */
export function parseGitCommit(raw: GitCommitDetailWire | null): GitCommitDetail {
  const out: GitCommitDetail = new GitCommitDetail();
  if (raw === null) {
    return out;
  }
  out.hash = gitStr(raw.hash);
  out.author = gitStr(raw.author);
  out.email = gitStr(raw.email);
  out.when = fmtDateTime(gitStr(raw.date));
  out.message = gitStr(raw.message);
  out.error = gitStr(raw.error);
  // 短哈希：本地算（与 log 行**同一口径**）；本地算不出（hash 为空）时才退回服务端给的 `short`。
  const local: string = gitShortHash(out.hash);
  out.shortHash = local.length > 0 ? local : gitStr(raw.short);
  const rows: GitChangeWire[] = raw.files === undefined ? [] : raw.files;
  const list: GitChange[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: GitChangeWire = rows[i];
    const c: GitChange = new GitChange();
    c.path = gitStr(r.path);
    c.status = gitStr(r.status);
    c.added = gitNum(r.added);
    c.deleted = gitNum(r.deleted);
    list.push(c);
  }
  out.files = list;
  return out;
}

/**
 * 提交元信息行：`Li Boxiu · 2026-10-13 05:00`。
 * 缺项**自动省略**（⛔ 不留孤立的分隔符）；作者缺失时退回邮箱（有信息就显示，不显示空）。
 */
export function gitCommitMetaText(d: GitCommitDetail): string {
  const who: string = d.author.length > 0 ? d.author : d.email;
  const parts: string[] = [];
  if (who.length > 0) {
    parts.push(who);
  }
  if (d.when.length > 0) {
    parts.push(d.when);
  }
  return parts.join(' · ');
}

// ── RPC 参数（ArkTS 禁对象字面量 ⇒ 显式类；字段名**逐字**对齐服务端 json tag）──────

/**
 * `web_plugin_rpc` 的外层 params：`{method:'xbot.git-fancy.status', params:{…}}`。
 *
 * ⛔ 这一层**不可省**（web `src/plugin-runtime/rpc.ts:30-34`）：`/api/rpc` 表里没有插件方法键，
 * 直接把 `xbot.git-fancy.status` 当外层 method 传 ⇒ 服务端 `unknown RPC method`（已实测）。
 */
export class WebPluginRpcParams {
  method: string = '';
  params: Object = new Object();

  constructor(method: string, params: Object) {
    this.method = method;
    this.params = params;
  }
}

/** 会话型参数：`{channel, chatID}`（**注意是 `chatID`**，插件侧 tag 与核心 RPC 的 `chat_id` 不同）。 */
export class GitChatParams {
  channel: string = '';
  chatID: string = '';

  constructor(channel: string, chatID: string) {
    this.channel = channel;
    this.chatID = chatID;
  }
}

/** `log` 的分页参数（服务端 `main.go:60-70`：`limit` ≤100、`skip` 从 0 起）。 */
export class GitLogParams {
  channel: string = '';
  chatID: string = '';
  limit: number = 0;
  skip: number = 0;

  constructor(channel: string, chatID: string, limit: number, skip: number) {
    this.channel = channel;
    this.chatID = chatID;
    this.limit = limit;
    this.skip = skip;
  }
}

/** `diff` 的参数（`commit` 非空 ⇒ 该 commit 作用域，否则工作区 vs HEAD）。 */
export class GitDiffParams {
  channel: string = '';
  chatID: string = '';
  path: string = '';
  commit: string = '';

  constructor(channel: string, chatID: string, path: string, commit: string) {
    this.channel = channel;
    this.chatID = chatID;
    this.path = path;
    this.commit = commit;
  }
}

/** `commit` 的参数（按哈希查单个提交详情）。 */
export class GitCommitParams {
  channel: string = '';
  chatID: string = '';
  hash: string = '';

  constructor(channel: string, chatID: string, hash: string) {
    this.channel = channel;
    this.chatID = chatID;
    this.hash = hash;
  }
}
