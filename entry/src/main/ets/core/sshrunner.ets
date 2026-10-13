/**
 * sshrunner.ets —— 内置 web 插件 `xbot.ssh-runner`（**远程机器 / SSH 控制面**）的数据模型 + 判据
 * （纯逻辑，可脱机单测）。
 *
 * ── 为什么会有这个模块（目标④「插件都打不开」的最后一块）────────────────────────
 * `nativeViewKind`（`core/pluginhost.ets`）是「插件视图 ⇒ 原生面板」的**唯一注册表**，
 * 此前只注册了 `xbot.git-fancy.panel` / `xbot.git-fancy.commit`。而本插件声明了两个视图
 * （真源 `plugins/xbot-ssh-runner/plugin.json` 的 `web.contributes`）：
 *   · `xbot.ssh-runner.panel`（container `right_sidebar`，人读标题「远程机器」）
 *   · `xbot.ssh-runner.bar`（container `info_bar`，执行目标切换徽章）
 * ⇒ 点「远程机器 → 打开」**没有原生落地** ⇒ 落到 **web 宿主页（= 整个 web 应用）**。
 * 这与用户明确否掉的那条路同因（见 `core/pluginviews.ets` 文件头）。本模块是它的正面解法，
 * 体例逐字沿用既有先例（`core/gitpanel.ets` / `core/sessionstats.ets` / `core/skills.ets`）。
 *
 * ── 契约来源（逐字对齐，⛔ 不猜）────────────────────────────────────────────────
 * · **面板**：`web/src/plugins/ssh-runner/index.tsx`（1903 行）；
 * · **共享判据/轮询**：`web/src/plugins/ssh-runner/shared.ts`（488 行）——本文件的
 *   `normalizeConnectionMode` / `connectionStateOf` / `parseTargets` / `serializeTargets` /
 *   `mergeConfigValues` / `maskSSH` / 轮询常量**逐个逐字**搬自它；
 * · **服务端插件**：`plugins/xbot-ssh-runner/{main,state,supervisor,update}.go` + `README.md`
 *   的 RPC 表（8 个方法，参数名逐字）；
 * · **配置**：`plugin.json` 的 `contributes.configuration.properties`（`downloadBase` /
 *   `installDir` / `connectionMode` / `targets`）+ `web.i18n.zh-CN`（本模块的文案真源）。
 *
 * ── wire 格式（关键，同 `gitpanel.ets`）─────────────────────────────────────────
 * 插件方法名**含点号** ⇒ `/api/rpc` 表里没有该键 ⇒ 必须包一层
 * `{method:'web_plugin_rpc', params:{method:'xbot.ssh-runner.<m>', params:{…}}}`
 * （web `src/plugin-runtime/rpc.ts:30-34`；直接当外层 method 传 ⇒ 服务端 `unknown RPC method`）。
 * ⚠️ 本插件的 RPC 参数**不带 `channel`/`chatID`**（与 git 面板不同：本插件是**跨会话**的
 *   机器控制面）——只有核心 `runner_session_*` 才需要会话身份。
 *
 * ── 纪律 ─────────────────────────────────────────────────────────────────────
 * ⛔ 本文件属 `core/` ⇒ 被 `run.sh` 当**纯 TS** 编译：禁 import ArkUI / `@ohos.*`；
 *    禁无类型对象字面量（一律 `class`）；无 `any`。
 * ⛔ 只产出**文案 / 角色名 / 数值**，不产出颜色（颜色由组件经 `core/design.ets:colorOf` 解析）。
 * ⛔ 别 import `.ets` 之外的东西造成环：本模块只依赖 `./gitpanel`（外层方法常量）与 `./panels`（时间格式）。
 */
// 外层方法名常量复用 `gitpanel.ets` 的唯一定义（⛔ 不再写第二个 `'web_plugin_rpc'` 字面量 ——
// 同一协议两处字面量必然漂移）。
import { RPC_WEB_PLUGIN } from './gitpanel';
// 时间本地化**复用** `core/panels.ets:fmtDateTime`（⛔ 不新建第二套日期格式化）。
import { fmtDateTime } from './panels';

export { RPC_WEB_PLUGIN };

// ══════════════════════════════════════════════════════════════════════════════
// ① 标识与常量
// ══════════════════════════════════════════════════════════════════════════════

/** 插件 id（真源：`plugin.json` 顶层 `id` / 服务端 `web_plugin_list` 的原值）。 */
export const SSH_RUNNER_PLUGIN_ID: string = 'xbot.ssh-runner';
/** 面板视图 id（真源：`web.contributes[0].id`）—— `nativeViewKind` 的注册键。 */
export const SSH_PANEL_VIEW_ID: string = 'xbot.ssh-runner.panel';
/** 信息栏视图 id（真源：`web.contributes[1].id`）。 */
export const SSH_BAR_VIEW_ID: string = 'xbot.ssh-runner.bar';
/** 面板人读标题（web 视图 `title` 的 zh-CN 文案：`view.panel.title`）。 */
export const SSH_PANEL_TITLE: string = '远程机器';

/** `xbot.ssh-runner.<method>` —— 插件方法的完整名（外层仍包 `web_plugin_rpc`）。 */
export function sshMethod(method: string): string {
  return `${SSH_RUNNER_PLUGIN_ID}.${method}`;
}

/** 插件方法名（⛔ 只此一处字面量；页面/组件一律经 `sshMethod` 拼）。 */
export const SSH_M_PROBE: string = 'probe';
export const SSH_M_PROVISION: string = 'provision';
export const SSH_M_CONNECT: string = 'connect';
export const SSH_M_DISCONNECT: string = 'disconnect';
export const SSH_M_STATUS: string = 'status';
export const SSH_M_LOGS: string = 'logs';
export const SSH_M_DEPROVISION: string = 'deprovision';
export const SSH_M_JOB_STATUS: string = 'job_status';

// ── 核心 RPC（非插件方法；直接当外层 method 调用）──────────────────────────────
/** 铸出 runner 登记行并返回远端启动参数串（`command`）。 */
export const RPC_RUNNER_CREATE: string = 'runner_create';
/** 删除 runner 登记行（删不存在的行是成功 ⇒ 幂等）。 */
export const RPC_RUNNER_DELETE: string = 'runner_delete';
/** 注册表分类视图（`{managed}` ⇒ `{runners, orphans}`）。 */
export const RPC_RUNNER_REGISTRY: string = 'runner_registry';
/** 读某会话当前的执行目标（`{channel, chat_id}` ⇒ `{name}`）。 */
export const RPC_RUNNER_SESSION_GET: string = 'runner_session_get';
/** 设某会话的执行目标（`name=''` ⇒ 切回本机）。 */
export const RPC_RUNNER_SESSION_SET: string = 'runner_session_set';

/** `logs` 请求行数（web `index.tsx:1137`：`lines: 100`）。 */
export const SSH_LOG_LINES: number = 100;

/**
 * 作业轮询间隔（ms）—— web `shared.ts:347 JOB_POLL_INTERVAL_MS`。
 * `provision` / `deprovision` 返回 `job_id`，前端轮询 `job_status` 直到 `state !== 'running'`。
 */
export const JOB_POLL_INTERVAL_MS: number = 1500;

/**
 * 连接等待轮询：间隔 1.5s、上限 24 次（≈36s）—— web `shared.ts:392-394`
 * （`CONNECT_POLL_INTERVAL_MS` / `CONNECT_POLL_MAX_ATTEMPTS`）。
 * 超时**不是失败**：后端 supervisor 仍在后台重连 ⇒ 文案必须说清（见 `SSH_CONNECT_TIMEOUT_TEXT`）。
 */
export const CONNECT_POLL_INTERVAL_MS: number = 1500;
export const CONNECT_POLL_MAX_ATTEMPTS: number = 24;

// ══════════════════════════════════════════════════════════════════════════════
// ② wire（服务端结构镜像；字段**全可缺** —— 旧后端/异常时不得崩）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * `status` 的返回（服务端 `state.go` 的 `StatusResult`；README 的 RPC 表）。
 * `service_state ∈ connected / reconnecting / disconnected`；`connected` 布尔是**权威**。
 */
export interface SshStatusWire {
  installed_version?: string;
  service_state?: string;
  detail?: string;
  connected?: boolean;
  connection_mode?: string;
  restarts?: number;
  connected_at?: string;
  remote_port?: number;
  last_error?: string;
}

/** `probe` 的返回（README：**只读**探测）。 */
export interface SshProbeWire {
  os?: string;
  arch?: string;
  user?: string;
  is_root?: boolean;
  has_curl?: boolean;
  has_wget?: boolean;
  installed_version?: string;
  install_dir?: string;
}

/** 作业步骤（`provision` / `deprovision` 共用；README：`steps[{name,ok,detail}]`）。 */
export interface SshJobStepWire {
  name?: string;
  ok?: boolean;
  detail?: string;
}

/** `job_status` 的返回。`state !== 'running'` 即终态（`done` / `failed`）—— 轮询必须停止。 */
export interface SshJobWire {
  state?: string;
  steps?: SshJobStepWire[];
  error?: string;
}

/** `logs` 的返回。`source = 'ssh-session'`（管道输出环形缓冲）或 `'remote-log'`（旧安装遗留）。 */
export interface SshLogsWire {
  lines?: string[];
  source?: string;
}

/** `runner_registry` 的一行（核心 RPC；本插件只做**投影**，分类由核心给出）。 */
export interface RunnerRegistryEntryWire {
  name?: string;
  managed?: boolean;
  /** `'managed'` / `'live'` / `'orphan'`（核心分类）。 */
  state?: string;
  selectable?: boolean;
  bound_count?: number;
}

/** `runner_registry` 的返回。 */
export interface RunnerRegistryWire {
  runners?: RunnerRegistryEntryWire[];
  /** 未受管也不在线的遗留登记名（管理面板的清理入口）。 */
  orphans?: string[];
}

// ══════════════════════════════════════════════════════════════════════════════
// ③ 连接方式 / 连接态（逐字搬 `shared.ts:72-86`）
// ══════════════════════════════════════════════════════════════════════════════

export const MODE_TUNNEL: string = 'tunnel';
export const MODE_DIRECT: string = 'direct';

/**
 * 规范化连接方式：未知值**一律回落 `tunnel`**（⛔ 不猜、不静默选 direct ——
 * direct 要求目标机器能访问 server，猜错会给出"连不上"且原因难查）。
 */
export function normalizeConnectionMode(raw: string | undefined): string {
  return raw === MODE_DIRECT ? MODE_DIRECT : MODE_TUNNEL;
}

export const CONN_CONNECTED: string = 'connected';
export const CONN_RECONNECTING: string = 'reconnecting';
export const CONN_DISCONNECTED: string = 'disconnected';

/**
 * 连接徽章三态：以 `connected` 布尔为**权威**，`service_state` 作补充。
 * 后端在 supervisor 未武装（从未连接 / 已断开）时返回 `service_state='disconnected'`、
 * `connection_mode=''` ⇒ 空 status 也归入 disconnected。
 */
export function connectionStateOf(status: SshStatusWire | null | undefined): string {
  if (status === null || status === undefined) {
    return CONN_DISCONNECTED;
  }
  if (status.connected === true || status.service_state === CONN_CONNECTED) {
    return CONN_CONNECTED;
  }
  if (status.service_state === CONN_RECONNECTING) {
    return CONN_RECONNECTING;
  }
  return CONN_DISCONNECTED;
}

/** 连接态 ⇒ 人读文案（真源 `plugin.json` 的 `web.i18n.zh-CN`：`stateConnected` 等）。 */
export function connectionStateLabel(state: string): string {
  if (state === CONN_CONNECTED) {
    return '已连接';
  }
  if (state === CONN_RECONNECTING) {
    return '重连中';
  }
  return '未连接';
}

/** 连接态 ⇒ **语义色调名**（组件经 `colorOf` 解析；⛔ 不出颜色）。 */
export function connectionStateTone(state: string): string {
  if (state === CONN_CONNECTED) {
    return 'success';
  }
  if (state === CONN_RECONNECTING) {
    return 'warn';
  }
  return 'muted';
}

// ══════════════════════════════════════════════════════════════════════════════
// ④ 面板配置 + 已纳管目标（逐字搬 `shared.ts:88-178`）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 已纳管目标（插件 config `targets` JSON 数组的元素）。
 * 字段与既有条目同风格（snake_case）；`parseTargets` 同时接受 camelCase 别名
 * （`connectionMode` / `autoConnect`），写入统一用 `serializeTargets` 的规范形态。
 *
 * ⚠️ class 而非 interface：组件 `@State` 里需要就地构造/替换（ArkTS 禁空对象字面量）。
 */
export class MachineTarget {
  name: string = '';
  ssh: string = '';
  install_dir: string = '';
  connection_mode: string = MODE_TUNNEL;
  /** true：面板挂载后自动连接（并且 connect 时透传给后端做插件重启自愈）。 */
  auto_connect: boolean = false;
  added_at: string = '';

  constructor(name: string, ssh: string, install_dir: string, connection_mode: string, auto_connect: boolean, added_at: string) {
    this.name = name;
    this.ssh = ssh;
    this.install_dir = install_dir;
    this.connection_mode = connection_mode;
    this.auto_connect = auto_connect;
    this.added_at = added_at;
  }
}

/** 插件配置值（`config.get()` 合并 manifest 默认值后的形态）。 */
export class RunnerConfigValues {
  downloadBase: string = '';
  installDir: string = '';
  /** 新增机器表单/连接的默认连接方式（`serviceMode` 键已废弃）。 */
  connectionMode: string = MODE_TUNNEL;
  targets: string = '[]';

  constructor(downloadBase: string, installDir: string, connectionMode: string, targets: string) {
    this.downloadBase = downloadBase;
    this.installDir = installDir;
    this.connectionMode = connectionMode;
    this.targets = targets;
  }
}

/** manifest 声明的默认值（`plugin.json` 的 `contributes.configuration.properties` 的 `default`）。 */
export const DEFAULT_DOWNLOAD_BASE: string = 'https://github.com/ai-pivot/xbot/releases/latest/download';
export const DEFAULT_INSTALL_DIR: string = '/usr/local/bin';
export const DEFAULT_TARGETS_JSON: string = '[]';

export function defaultConfigValues(): RunnerConfigValues {
  return new RunnerConfigValues(DEFAULT_DOWNLOAD_BASE, DEFAULT_INSTALL_DIR, MODE_TUNNEL, DEFAULT_TARGETS_JSON);
}

/**
 * 合并 `config.get()` 的原始值 + manifest 默认值（空串/非字符串视为缺省）。
 * ⛔ 键集合与 web `shared.ts:122 CONFIG_KEYS` **逐字一致**（多读一个键就有可能把用户
 *    手改的畸形值带进 UI）。
 */
export function mergeConfigValues(raw: Record<string, Object> | null | undefined): RunnerConfigValues {
  const out: RunnerConfigValues = defaultConfigValues();
  if (raw === null || raw === undefined) {
    return out;
  }
  const dl: Object | undefined = raw['downloadBase'];
  if (typeof dl === 'string' && dl.trim().length > 0) {
    out.downloadBase = dl;
  }
  const idir: Object | undefined = raw['installDir'];
  if (typeof idir === 'string' && idir.trim().length > 0) {
    out.installDir = idir;
  }
  const tg: Object | undefined = raw['targets'];
  if (typeof tg === 'string' && tg.trim().length > 0) {
    out.targets = tg;
  }
  const cm: Object | undefined = raw['connectionMode'];
  out.connectionMode = normalizeConnectionMode(typeof cm === 'string' ? cm : undefined);
  return out;
}

/** `true` / `'true'` 视为真（web `shared.ts:135 truthyFlag` —— 用户手改的配置可能是字符串）。 */
function truthyFlag(v: Object | undefined): boolean {
  return v === true || v === 'true';
}

function strOr(v: Object | undefined, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/**
 * 解析 targets JSON；**损坏条目安全跳过**（配置可被用户手改 ⇒ 绝不因一条坏数据崩面板）。
 */
export function parseTargets(raw: string): MachineTarget[] {
  const out: MachineTarget[] = [];
  if (raw.length === 0) {
    return out;
  }
  let parsed: Object;
  try {
    parsed = JSON.parse(raw) as Object;
  } catch (e) {
    return out;
  }
  if (!Array.isArray(parsed)) {
    return out;
  }
  const items: Object[] = parsed as Object[];
  for (let i = 0; i < items.length; i++) {
    const item: Object = items[i];
    if (item === null || item === undefined || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const rec: Record<string, Object> = item as Record<string, Object>;
    const name: string = strOr(rec['name'], '');
    const ssh: string = strOr(rec['ssh'], '');
    if (name.length === 0 || ssh.length === 0) {
      continue;
    }
    const modeRaw: Object | undefined = rec['connection_mode'] !== undefined ? rec['connection_mode'] : rec['connectionMode'];
    out.push(new MachineTarget(
      name,
      ssh,
      strOr(rec['install_dir'], ''),
      normalizeConnectionMode(typeof modeRaw === 'string' ? modeRaw : undefined),
      truthyFlag(rec['auto_connect'] !== undefined ? rec['auto_connect'] : rec['autoConnect']),
      strOr(rec['added_at'], ''),
    ));
  }
  return out;
}

/**
 * 序列化 targets（**只写已知字段** —— 用户手加的杂键不落盘，字段形态保持规范）。
 * ⛔ 字段顺序与 web `shared.ts:167-178` 逐字一致（配置是用户可见的 JSON）。
 */
export function serializeTargets(targets: MachineTarget[]): string {
  const rows: Object[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t: MachineTarget = targets[i];
    const row: Record<string, Object> = {};
    row['name'] = t.name;
    row['ssh'] = t.ssh;
    row['install_dir'] = t.install_dir;
    row['connection_mode'] = t.connection_mode;
    row['auto_connect'] = t.auto_connect;
    row['added_at'] = t.added_at;
    rows.push(row);
  }
  return JSON.stringify(rows);
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 机器注册表视图（分类由核心给出，前端**只做投影** —— 不重复实现判定）
// ══════════════════════════════════════════════════════════════════════════════

/** 注册表视图：全部行 + 可选目标 + 遗留行（管理面板的清理入口）。 */
export class RunnerRegistryView {
  /** 全部注册表行（含遗留行）—— 管理面板用。 */
  runners: RunnerRegistryEntryWire[] = [];
  /** `selectable === true` 的目标 —— 执行目标选择器只列这些。 */
  selectable: RunnerRegistryEntryWire[] = [];
  /** 未受管也不在线的遗留登记名（只能由管理面板显式 `runner_delete` 清理）。 */
  orphans: string[] = [];

  constructor(runners: RunnerRegistryEntryWire[], selectable: RunnerRegistryEntryWire[], orphans: string[]) {
    this.runners = runners;
    this.selectable = selectable;
    this.orphans = orphans;
  }
}

/** 由注册表行构建视图（`shared.ts:250 viewFromEntries` 逐字）。 */
export function viewFromEntries(entries: RunnerRegistryEntryWire[], orphans: string[]): RunnerRegistryView {
  const selectable: RunnerRegistryEntryWire[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].selectable === true) {
      selectable.push(entries[i]);
    }
  }
  // 只在 entries 里确实存在的孤儿名才保留（否则是核心给的陈旧名）。
  const kept: string[] = [];
  for (let i = 0; i < orphans.length; i++) {
    const name: string = orphans[i];
    let found: boolean = false;
    for (let j = 0; j < entries.length; j++) {
      if (entries[j].name === name) {
        found = true;
        break;
      }
    }
    if (found) {
      kept.push(name);
    }
  }
  return new RunnerRegistryView(entries, selectable, kept);
}

/**
 * 「未纳管的注册记录」= 既不在本面板 targets 里、也没有在线连接的登记行
 * （中途中止的纳管 / 旧版本残留）。它们**绝不进入执行目标**，只能显式清理。
 *
 * 判据（`index.tsx:1079`）：不属于本面板 `managed` 集合、且 `state !== 'managed'`。
 */
export function unmanagedEntries(view: RunnerRegistryView | null, managed: string[]): RunnerRegistryEntryWire[] {
  const out: RunnerRegistryEntryWire[] = [];
  if (view === null) {
    return out;
  }
  for (let i = 0; i < view.runners.length; i++) {
    const r: RunnerRegistryEntryWire = view.runners[i];
    const name: string = r.name !== undefined ? r.name : '';
    if (name.length === 0) {
      continue;
    }
    let isManaged: boolean = false;
    for (let j = 0; j < managed.length; j++) {
      if (managed[j] === name) {
        isManaged = true;
        break;
      }
    }
    if (!isManaged && r.state !== 'managed') {
      out.push(r);
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ 作业（provision / deprovision）状态
// ══════════════════════════════════════════════════════════════════════════════

export const JOB_RUNNING: string = 'running';
export const JOB_DONE: string = 'done';
export const JOB_FAILED: string = 'failed';

/** 作业是否仍在跑（**只有 running 才继续轮询** —— 终态不再排期，轮询必然停止）。 */
export function jobRunning(job: SshJobWire | null): boolean {
  return job !== null && job.state === JOB_RUNNING;
}

/** 作业是否成功终态。 */
export function jobDone(job: SshJobWire | null): boolean {
  return job !== null && job.state === JOB_DONE;
}

/** 作业是否失败终态（`error` 可能为空 ⇒ 调用方回退到通用「安装失败」文案）。 */
export function jobFailed(job: SshJobWire | null): boolean {
  return job !== null && job.state === JOB_FAILED;
}

/** 作业步骤列表（缺省空数组；组件只画）。 */
export function jobSteps(job: SshJobWire | null): SshJobStepWire[] {
  if (job === null || job.steps === undefined) {
    return [];
  }
  return job.steps;
}

/** 作业最后一步的名字（删除中的行内进度；无步骤 ⇒ 空串）。 */
export function jobLastStepName(job: SshJobWire | null): string {
  const steps: SshJobStepWire[] = jobSteps(job);
  if (steps.length === 0) {
    return '';
  }
  const last: SshJobStepWire = steps[steps.length - 1];
  return last.name !== undefined ? last.name : '';
}

/** 作业失败原因（`error` 空 ⇒ 回退到兜底文案，⛔ 绝不给空白错误行）。 */
export function jobErrorText(job: SshJobWire | null, fallback: string): string {
  const err: string = job !== null && job.error !== undefined ? job.error : '';
  if (err.length > 0) {
    return err;
  }
  return fallback;
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑦ 文案（真源 = `plugin.json` 的 `web.i18n.zh-CN`；⛔ 用词逐字对齐，别发挥）
// ══════════════════════════════════════════════════════════════════════════════

export const SSH_CONNECT_TIMEOUT_TEXT: string =
  '等待连接超时（后端仍在后台重连）——可重试，或稍后刷新状态。';
export const SSH_CONNECT_CANCELLED_TEXT: string = '已停止等待连接（后端仍在后台尝试重连）。';
export const SSH_INSTALL_FAILED_TEXT: string = '安装失败';
export const SSH_NOT_INITIALIZED_TEXT: string = '远程机器插件尚未初始化（插件未启用？）';
export const SSH_CONFIG_UNAVAILABLE_TEXT: string = '插件配置能力不可用（permissions 需含 config）';
export const SSH_EMPTY_TEXT: string =
  '还没有纳管的远程机器。点击「添加机器」输入一条 SSH 命令（如 ssh user@host -p 22）：远端会自动安装 xbot-runner，然后通过 SSH 管道连接。';

/** 连接方式的人读短名（列表行上的小徽章）。 */
export function modeShort(mode: string): string {
  return mode === MODE_DIRECT ? 'direct' : 'tunnel';
}

/** 连接方式的人读长名（新增表单的下拉项）。 */
export function modeLongLabel(mode: string): string {
  return mode === MODE_DIRECT ? '直连（机器能访问 server）' : '隧道（server 只对本机可达）';
}

/** 表单校验（逐字搬 `index.tsx:857-872` 的三条守卫；返回空串 = 通过）。 */
export function validateNewTarget(name: string, ssh: string, existingNames: string[]): string {
  if (name.length === 0) {
    return '请填写名称';
  }
  if (ssh.length === 0) {
    return '请填写 SSH 命令（例如 ssh user@host -p 22）';
  }
  for (let i = 0; i < existingNames.length; i++) {
    if (existingNames[i] === name) {
      return `名称已存在：${name}`;
    }
  }
  return '';
}

/**
 * SSH 命令脱敏展示：优先抽 `user@host`（列表行只展示这一部分）。
 * ⛔ 逐字对齐 `shared.ts:481-487 maskSSH` 的**行为**（安全判据：`-i /path/key`、
 *   `-o ProxyCommand=…` 绝不能进列表行）。
 * ⚠️ 实现改用**手写扫描**而不是正则：ArkTS 不支持结构类型化（`arkts-no-structural-typing`）⇒
 *   `RegExpMatchArray` 这类 TS lib 类型在真编译下硬红（脱机 `tsc` 抓不到，见 `AGENTS.md`）。
 */
export function maskSSH(ssh: string): string {
  const trimmed: string = ssh.trim();
  const at: number = trimmed.indexOf('@');
  if (at > 0) {
    let start: number = at;
    while (start > 0 && isUserChar(trimmed.charAt(start - 1))) {
      start = start - 1;
    }
    let end: number = at + 1;
    while (end < trimmed.length && isHostChar(trimmed.charAt(end))) {
      end = end + 1;
    }
    // 只在**两侧都非空**时采纳（`@host` 这种不成形的输入不算）。
    if (start < at && end > at + 1) {
      return trimmed.substring(start, end);
    }
  }
  const tokens: string[] = trimmed.split(' ').filter((tok: string) => tok.length > 0 && !tok.startsWith('-'));
  if (tokens.length > 0 && tokens[0] === 'ssh') {
    return tokens.length > 1 ? tokens[1] : trimmed;
  }
  return tokens.length > 0 ? tokens[0] : trimmed;
}

/** `user` 段允许的字符（对齐 `maskSSH` 正则的 `[A-Za-z0-9._-]`）。 */
function isUserChar(c: string): boolean {
  return isAlnum(c) || c === '.' || c === '_' || c === '-';
}

/** `host` 段允许的字符（对齐 `[A-Za-z0-9._:-]`，多一个冒号给 IPv6 / `host:port`）。 */
function isHostChar(c: string): boolean {
  return isAlnum(c) || c === '.' || c === '_' || c === '-' || c === ':';
}

function isAlnum(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑧ 行内视图模型（组件只画；判据与渲染同源）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 「连接态」一个事实行（诊断区里 label/value 成对；组件经 `colorOf` 上色）。
 * ⚠️ 是 **class** 而非 `[string,string]` 元组：ArkTS 下元组在数组里类型推断不稳。
 */
export class SshFact {
  label: string = '';
  value: string = '';

  constructor(label: string, value: string) {
    this.label = label;
    this.value = value;
  }
}

/**
 * 诊断区的「连接态」事实行（逐项对齐 `index.tsx:1764-1801` 的顺序与取值）。
 * ⛔ `remote_port` 只在 **tunnel 模式且 > 0** 时出现；`connected_at` 空则不出现
 *   （空值行 = 噪声，Apple 列表范式里"没有就不画"）。
 */
export function statusFacts(status: SshStatusWire | null): SshFact[] {
  const out: SshFact[] = [];
  if (status === null) {
    return out;
  }
  out.push(new SshFact('连接状态', connectionStateLabel(connectionStateOf(status))));
  const cmRaw: string = status.connection_mode !== undefined ? status.connection_mode : '';
  out.push(new SshFact('连接方式', cmRaw.length > 0 ? cmRaw : '—'));
  out.push(new SshFact('重连次数', `${status.restarts !== undefined ? status.restarts : 0}`));
  if (status.connection_mode === MODE_TUNNEL && status.remote_port !== undefined && status.remote_port > 0) {
    out.push(new SshFact('隧道端口', `127.0.0.1:${status.remote_port}`));
  }
  const connectedAt: string = status.connected_at !== undefined ? status.connected_at : '';
  if (connectedAt.length > 0) {
    out.push(new SshFact('连接时间', connectedAt));
  }
  const ivRaw: string = status.installed_version !== undefined ? status.installed_version : '';
  out.push(new SshFact('版本', ivRaw.length > 0 ? ivRaw : '—'));
  return out;
}

/**
 * 目标行的**副行**（元信息串）：`重连 3 次 · 隧道 :8443 · 1.2.3`。
 * 判据：`status === null` ⇒ 空串（只显示名称 + 徽章，不伪造"0 次重连"）。
 */
export function targetMetaText(status: SshStatusWire | null): string {
  const parts: string[] = [];
  if (status === null) {
    return '';
  }
  const restarts: number = status.restarts !== undefined ? status.restarts : 0;
  if (restarts > 0) {
    parts.push(`重连 ${restarts} 次`);
  }
  if (status.connection_mode === MODE_TUNNEL && status.remote_port !== undefined && status.remote_port > 0) {
    parts.push(`隧道 :${status.remote_port}`);
  }
  const iv: string = status.installed_version !== undefined ? status.installed_version : '';
  if (iv.length > 0) {
    parts.push(iv);
  }
  return parts.join(' · ');
}

/** 当前执行目标一行的文案（`sessionTarget` 空 = 本机）。 */
export function sessionLineText(ready: boolean, sessionTarget: string): string {
  if (!ready) {
    return '当前目标：本机（会话身份未就绪）';
  }
  if (sessionTarget.length > 0) {
    return `当前目标：${sessionTarget}`;
  }
  return '当前目标：本机';
}

/** 遗留登记行的状态文案（`live` = 已连接但未纳管；其余 = 遗留登记）。 */
export function unmanagedStateText(entry: RunnerRegistryEntryWire): string {
  return entry.state === 'live' ? '已连接但未纳管' : '遗留登记';
}

/** 目标新掌握行的时间展示（`added_at` 走 `panels.fmtDateTime`，⛔ 不新建格式化）。 */
export function targetAddedText(target: MachineTarget): string {
  return fmtDateTime(target.added_at);
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑨ RPC 参数（ArkTS 禁对象字面量 ⇒ 显式类；字段名**逐字**对齐服务端 json tag）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * `web_plugin_rpc` 的外层 params：`{method:'xbot.ssh-runner.status', params:{…}}`。
 * ⛔ 这一层**不可省**（见文件头）。
 */
export class SshPluginRpcParams {
  method: string = '';
  params: Object = new Object();

  constructor(method: string, params: Object) {
    this.method = method;
    this.params = params;
  }
}

/** `probe` / `status` / `disconnect` 共用：`{ssh, name}`（`probe` 只用 `ssh`）。 */
export class SshTargetParams {
  ssh: string = '';
  name: string = '';

  constructor(ssh: string, name: string) {
    this.ssh = ssh;
    this.name = name;
  }
}

/** `probe` 的 params（**只** `ssh` —— 探测发生在纳管之前，那时还没有 name 登记）。 */
export class SshProbeParams {
  ssh: string = '';

  constructor(ssh: string) {
    this.ssh = ssh;
  }
}

/** `provision` / `deprovision` 的 params（`uninstall` 只在 deprovision 有意义）。 */
export class SshJobStartParams {
  ssh: string = '';
  name: string = '';
  download_base: string = '';
  install_dir: string = '';
  uninstall: boolean = false;

  constructor(ssh: string, name: string, download_base: string, install_dir: string, uninstall: boolean) {
    this.ssh = ssh;
    this.name = name;
    this.download_base = download_base;
    this.install_dir = install_dir;
    this.uninstall = uninstall;
  }
}

/** `connect` 的 params（`connect_cmd` = 核心 `runner_create` 铸出的远端启动串）。 */
export class SshConnectParams {
  ssh: string = '';
  name: string = '';
  connect_cmd: string = '';
  install_dir: string = '';
  connection_mode: string = MODE_TUNNEL;
  auto_connect: boolean = false;

  constructor(ssh: string, name: string, connect_cmd: string, install_dir: string, connection_mode: string, auto_connect: boolean) {
    this.ssh = ssh;
    this.name = name;
    this.connect_cmd = connect_cmd;
    this.install_dir = install_dir;
    this.connection_mode = connection_mode;
    this.auto_connect = auto_connect;
  }
}

/** `logs` 的 params。 */
export class SshLogsParams {
  ssh: string = '';
  name: string = '';
  lines: number = SSH_LOG_LINES;

  constructor(ssh: string, name: string) {
    this.ssh = ssh;
    this.name = name;
  }
}

/** `job_status` 的 params。 */
export class SshJobStatusParams {
  job_id: string = '';

  constructor(job_id: string) {
    this.job_id = job_id;
  }
}

/** `runner_create` 的 params（**仅名字** —— 新机器第一次登记；重连 re-key 走下面的 R 版）。 */
export class RunnerCreateParams {
  name: string = '';

  constructor(name: string) {
    this.name = name;
  }
}

/**
 * `runner_create` 的 re-key params（重连时回传既有设置，**避免重置**用户在其它面板
 * 配置过的 mode/workspace/LLM）。
 *
 * ⛔ 与 web `index.tsx:451-460` 逐字：`mode` / `docker_image` / `workspace` /
 *   `llm_provider` / `llm_api_key` / `llm_model` / `llm_base_url`。
 */
export class RunnerCreateRekeyParams {
  name: string = '';
  mode: string = '';
  docker_image: string = '';
  workspace: string = '';
  llm_provider: string = '';
  llm_api_key: string = '';
  llm_model: string = '';
  llm_base_url: string = '';

  constructor(name: string, mode: string, docker_image: string, workspace: string,
              llm_provider: string, llm_api_key: string, llm_model: string, llm_base_url: string) {
    this.name = name;
    this.mode = mode;
    this.docker_image = docker_image;
    this.workspace = workspace;
    this.llm_provider = llm_provider;
    this.llm_api_key = llm_api_key;
    this.llm_model = llm_model;
    this.llm_base_url = llm_base_url;
  }
}

/** `runner_delete` 的 params。 */
export class RunnerDeleteParams {
  name: string = '';

  constructor(name: string) {
    this.name = name;
  }
}

/** `runner_registry` 的 params（`managed` = 本面板纳管的集合，**只用于分类**）。 */
export class RunnerRegistryParams {
  managed: string[] = [];

  constructor(managed: string[]) {
    this.managed = managed;
  }
}

/** `runner_session_get` / `runner_session_set` 的 params（⚠️ 这里是 **`chat_id`**，核心 RPC 的 tag）。 */
export class RunnerSessionParams {
  channel: string = '';
  chat_id: string = '';
  name: string = '';

  constructor(channel: string, chat_id: string, name: string) {
    this.channel = channel;
    this.chat_id = chat_id;
    this.name = name;
  }
}

/** `runner_session_get` 的 params（不带 `name` —— 别的写法服务端不吃）。 */
export class RunnerSessionGetParams {
  channel: string = '';
  chat_id: string = '';

  constructor(channel: string, chat_id: string) {
    this.channel = channel;
    this.chat_id = chat_id;
  }
}

/**
 * `runner_list` / `runner_registry` 的一行（注册表行是前者 & 分类字段，见 web
 * `plugin-api/rpc.ts:225-235`）。**re-key 要回传的既有设置**就在这里。
 */
export interface RunnerInfoWire {
  name?: string;
  mode?: string;
  docker_image?: string;
  workspace?: string;
  online?: boolean;
  created_at?: string;
  version?: string;
  llm_provider?: string;
  llm_api_key?: string;
  llm_model?: string;
  llm_base_url?: string;
}

/**
 * 铸「远端启动参数串」的 params —— **重连 vs 首次登记**两条路（逐字搬 `index.tsx:448-463`）：
 * · 注册表里**已有**该名字 ⇒ 回传其既有 mode/workspace/LLM 设置（重连只轮换 token，
 *   ⛔ 不重置用户在「机器」面板里配过的东西）；
 * · 没有 ⇒ 只发名字。
 *
 * ⚠️ 返回联合类型（两个 class 都可 `JSON.stringify` 成服务端要的形态）。
 */
export function runnerCreateParamsFor(name: string, known: RunnerInfoWire[]): Object {
  for (let i = 0; i < known.length; i++) {
    const r: RunnerInfoWire = known[i];
    if (r.name !== name) {
      continue;
    }
    return new RunnerCreateRekeyParams(
      name,
      r.mode !== undefined ? r.mode : '',
      r.docker_image !== undefined ? r.docker_image : '',
      r.workspace !== undefined ? r.workspace : '',
      r.llm_provider !== undefined ? r.llm_provider : '',
      r.llm_api_key !== undefined ? r.llm_api_key : '',
      r.llm_model !== undefined ? r.llm_model : '',
      r.llm_base_url !== undefined ? r.llm_base_url : '',
    );
  }
  return new RunnerCreateParams(name);
}

/** `runner_list` 的返回（用于 toast/兼容；本面板主要读 `runner_registry`）。 */
export interface RunnerListWire {
  runners?: RunnerInfoWire[];
}
