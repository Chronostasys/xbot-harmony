/**
 * About 面的**破坏性动作**纯逻辑（可脱机单测）。
 *
 * 补齐 web `web/src/components/settings/SettingsAbout.tsx` 里原生缺失的 S9 段：
 *   · 应用内更新 —— `apply_update`（一键下载二进制 + web dist + 内置插件，校验和验证后原子替换）
 *     web `SettingsAbout.tsx:146-158`（handler）+ `:262-274`（按钮门控）+ `:319-335`（结果渲染）
 *   · 重启服务 —— `restart_server`（主动重启进程，~800ms 后触发）+ 40s 轮询等它回来
 *     web `SettingsAbout.tsx:165-197`（handler + 轮询）+ `:358-421`（两步确认 UI / 失败 / 完成）
 *   · release notes 外链 —— `check_update.url` 的规范化与可点性判定
 *     web `SettingsAbout.tsx:297-317`（`currentToLatest · releaseNotes`）
 *
 * 服务端契约（逐条 grep `serverapp/rpc_table.go` 核实，非猜测）：
 *   · `get_system_info`  admin `rpc0err` 无参 → SystemInfo —— `rpc_table.go:1963-1965`
 *   · `check_update`     admin `rpc0err` 无参 → UpdateCheck —— `rpc_table.go:1971-1973`
 *   · `apply_update`     admin `rpc1`  `{tag(必填), mirror(可选)}` → ApplyResult —— `rpc_table.go:1978-1990`
 *                         ⚠️ 服务端对空 tag **直接报错**（`tag is required`）——调用方必须先过 `canApplyUpdate`
 *   · `restart_server`   admin `rpc0err` 无参 → `{managedBy}` —— `rpc_table.go:1998-2004`
 *                         ⚠️ 响应**先 flush**（重启 ~800ms 后由 goroutine 触发）⇒ 拿到回包 ≠ 已重启
 *
 * ⛔ 本文件属 `core/`，会被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ **禁止** import ArkUI / `@ohos.*`。
 *    只依赖 `./settings`（类型）、`./msgops`（既有协议白名单，**别自造轮子**）。
 *
 * ⛔ method 名**就地定义在此**（`core/rpc.ets` 本波由另一条线占用）——这是刻意选择，见下方注释。
 */

import { textOrDash, UpdateCheckRow } from './settings';
import { isOpenableScheme } from './msgops';

// ── method 常量（就地定义；本波**不动** core/rpc.ets）────────────────────────────
//
// 为什么放这里而不折叠进 `core/rpc.ets`：该文件本波**有主**（parity-gap 线在改），
// 并行 `git add` 会把对方的在途改动串进本提交 —— 故 method 常量与 params 类**就地定义**，
// 待两条线合流后再折叠进 `RpcMethod` 表（与 `core/settings.ets` 里 about 段的做法一致）。
/** `apply_update`（admin，`rpc1`）`{tag, mirror?}` → ApplyResult。`rpc_table.go:1978-1990`。 */
export const RPC_APPLY_UPDATE: string = 'apply_update';
/** `restart_server`（admin，`rpc0err`，无参）→ `{managedBy}`。`rpc_table.go:1998-2004`。 */
export const RPC_RESTART_SERVER: string = 'restart_server';

/** 就地登记的全部 About 动作 method（契约测试遍历用，防"加了 method 忘登记"）。 */
export const ABOUT_ACTION_METHODS: string[] = [RPC_APPLY_UPDATE, RPC_RESTART_SERVER];

/**
 * `apply_update` 的 params（服务端 `rpc_table.go:1978-1981` 的匿名 struct json tag）。
 *
 * ⚠️ `tag` **必填**：空串服务端直接 `tag is required (run check_update first)` 报错。
 * ⚠️ `mirror`（可选 GitHub CDN 镜像）原生**不暴露选择入口**，恒空串 —— 服务端收到空串
 *    走默认（不镜像），与 web 未传该字段同义。
 */
export class ApplyUpdateParams {
  tag: string = '';
  mirror: string = '';

  constructor(tag: string) {
    this.tag = tag;
  }
}

/** `apply_update` 的返回（`internal/selfupdate.ApplyResult`，`update.go:28-33`）。 */
export interface ApplyResultRow {
  /** 写入各组件的版本号（服务端 stamp）。 */
  newVersion?: string;
  /** 实际下载的 release tag。 */
  tag?: string;
  /** 被更新的组件："binary" / "web" / "plugins"。 */
  components?: string[];
  /** 非致命问题（如校验和跳过）—— 必须显示给用户，不能吞。 */
  warnings?: string[];
}

/** `restart_server` 的返回（`rpc_table.go:2003`：`map[string]string{"managedBy": …}`）。 */
export interface RestartResultRow {
  managedBy?: string;
}

// ── 更新可用性判定 ────────────────────────────────────────────────────────────

/**
 * 能否执行 `apply_update`：**有可用新版 + 未跳过 + tag 非空**。
 *
 * 对齐 web `SettingsAbout.tsx:262`（`updateInfo?.hasUpdate && updateInfo.tag && !applyResult`）。
 * ⛔ 为什么必须同时判 `tag`：服务端对空 tag 报错（`rpc_table.go:1984-1986`）——只判 `hasUpdate`
 *    会在 `tag` 缺失时报出无意义的服务端错误；且 `skipped=true` 时 `hasUpdate` 语义不可信
 *    （`UpdateCheck` 注释：skipped 时 tag 为空串，`update.go`）。
 */
export function canApplyUpdate(chk: UpdateCheckRow | undefined): boolean {
  if (chk === undefined || chk === null) {
    return false;
  }
  if (chk.skipped === true) {
    return false;
  }
  if (chk.hasUpdate !== true) {
    return false;
  }
  const tag: string = chk.tag !== undefined && chk.tag !== null ? chk.tag.trim() : '';
  return tag.length > 0;
}

/** 更新按钮文案（web `:270-272`：applying ? 更新中 : 更新到 {latest}）。 */
export function applyButtonLabel(applying: boolean, latest: string | undefined): string {
  return applying ? '更新中…' : `更新到 ${textOrDash(latest)}`;
}

/**
 * `current → latest` 一行（web `:299-302` 的 `currentToLatest`）。
 * 任一缺失走 `—` 回落（不显示空白，对齐 `textOrDash`）。
 */
export function currentToLatestText(current: string | undefined, latest: string | undefined): string {
  return `${textOrDash(current)} → ${textOrDash(latest)}`;
}

// ── apply_update 状态机：idle → confirming → applying → applied / failed ─────────
//
// web 对 apply 是**单击直发**（`SettingsAbout.tsx:263-274`，无确认）；原生在手机端误触代价高
// ⇒ 依本波硬要求「危险操作二次确认」，为 apply 也加一层确认态（**不丢 web 任何能力**，
//   仅多一步确认；确认文案强调"不可撤销：会替换服务端二进制"）。

export const APPLY_IDLE: string = 'idle';
export const APPLY_CONFIRMING: string = 'confirming';
export const APPLY_APPLYING: string = 'applying';
export const APPLY_APPLIED: string = 'applied';
export const APPLY_FAILED: string = 'failed';

export const APPLY_REQ_CONFIRM: string = 'reqConfirm';
export const APPLY_REQ_CANCEL: string = 'reqCancel';
export const APPLY_REQ_APPLY: string = 'reqApply';
export const APPLY_DONE: string = 'done';
export const APPLY_FAIL: string = 'fail';
export const APPLY_RESET: string = 'reset';

/**
 * apply 状态迁移（**纯函数**，非法 event 一律**原样返回**不抛）。
 *
 * ⛔ 关键守卫：`applying` 态**不可**被 `reqApply` 再触发（防连点重复提交 —— 更新是不可撤销的
 *    IO 重操作）。`applying` 只能被 `done`/`fail`/`reset` 离开。
 */
export function applyReducer(state: string, event: string): string {
  if (event === APPLY_RESET) {
    return APPLY_IDLE;
  }
  if (state === APPLY_IDLE || state === APPLY_APPLIED || state === APPLY_FAILED) {
    return event === APPLY_REQ_CONFIRM ? APPLY_CONFIRMING : state;
  }
  if (state === APPLY_CONFIRMING) {
    if (event === APPLY_REQ_CANCEL) {
      return APPLY_IDLE;
    }
    return event === APPLY_REQ_APPLY ? APPLY_APPLYING : state;
  }
  if (state === APPLY_APPLYING) {
    if (event === APPLY_DONE) {
      return APPLY_APPLIED;
    }
    return event === APPLY_FAIL ? APPLY_FAILED : state;
  }
  return state;
}

/** apply 进行中（按钮禁用 + 文案切换）。 */
export function applyBusy(state: string): boolean {
  return state === APPLY_APPLYING;
}

/** 处于确认态（渲染确认片段）。 */
export function applyShowConfirm(state: string): boolean {
  return state === APPLY_CONFIRMING;
}

/** 成功态（渲染"更新完成 + 组件清单"）。 */
export function applySucceeded(state: string): boolean {
  return state === APPLY_APPLIED;
}

// ── restart_server 状态机 ─────────────────────────────────────────────────────
//   idle → confirming → restarting → polling → succeeded / failed / timedOut

export const RESTART_IDLE: string = 'idle';
export const RESTART_CONFIRMING: string = 'confirming';
export const RESTART_RESTARTING: string = 'restarting';
export const RESTART_POLLING: string = 'polling';
export const RESTART_SUCCEEDED: string = 'succeeded';
export const RESTART_FAILED: string = 'failed';
export const RESTART_TIMED_OUT: string = 'timedOut';

export const RESTART_REQ_CONFIRM: string = 'reqConfirm';
export const RESTART_REQ_CANCEL: string = 'reqCancel';
export const RESTART_REQ_RESTART: string = 'reqRestart';
/** `restart_server` 回包成功（响应先 flush，重启随后触发）。 */
export const RESTART_SENT: string = 'sent';
/** 轮询到服务已回来。 */
export const RESTART_POLL_OK: string = 'pollOk';
export const RESTART_FAIL: string = 'fail';
export const RESTART_TIMEOUT: string = 'timeout';
export const RESTART_RESET: string = 'reset';

/**
 * restart 状态迁移（**纯函数**，非法 event **原样返回**）。
 *
 * 与 web 的四个布尔（`confirmRestart`/`restarting`/`restartDone`/`restartError`，
 * `SettingsAbout.tsx:108-111`）等价但**互斥** —— 布尔可能共存的中间态（既 done 又 error）
 * 在状态机里不可能出现。
 *
 * ⛔ 守卫：`restarting`/`polling` 态**不可**被 `reqRestart` 再触发（更新中态可见 + 防连点）。
 */
export function restartReducer(state: string, event: string): string {
  if (event === RESTART_RESET) {
    return RESTART_IDLE;
  }
  if (state === RESTART_IDLE || state === RESTART_SUCCEEDED || state === RESTART_FAILED
    || state === RESTART_TIMED_OUT) {
    return event === RESTART_REQ_CONFIRM ? RESTART_CONFIRMING : state;
  }
  if (state === RESTART_CONFIRMING) {
    if (event === RESTART_REQ_CANCEL) {
      return RESTART_IDLE;
    }
    return event === RESTART_REQ_RESTART ? RESTART_RESTARTING : state;
  }
  if (state === RESTART_RESTARTING) {
    if (event === RESTART_SENT) {
      return RESTART_POLLING;
    }
    return event === RESTART_FAIL ? RESTART_FAILED : state;
  }
  if (state === RESTART_POLLING) {
    if (event === RESTART_POLL_OK) {
      return RESTART_SUCCEEDED;
    }
    if (event === RESTART_TIMEOUT) {
      return RESTART_TIMED_OUT;
    }
    return event === RESTART_FAIL ? RESTART_FAILED : state;
  }
  return state;
}

/** 重启进行中（`restart_server` 在途 或 轮询中）—— 按钮禁用 + 转圈。 */
export function restartBusy(state: string): boolean {
  return state === RESTART_RESTARTING || state === RESTART_POLLING;
}

/** 处于确认态（渲染红色"确认重启" + 取消）。 */
export function restartShowConfirm(state: string): boolean {
  return state === RESTART_CONFIRMING;
}

export function restartSucceeded(state: string): boolean {
  return state === RESTART_SUCCEEDED;
}

export function restartFailed(state: string): boolean {
  return state === RESTART_FAILED;
}

export function restartTimedOut(state: string): boolean {
  return state === RESTART_TIMED_OUT;
}

// ── 轮询节奏与超时（web `SettingsAbout.tsx:176-196`）──────────────────────────

/** 轮询间隔：每 1.5s 探一次（web `:190`）。 */
export const RESTART_POLL_INTERVAL_MS: number = 1500;
/** 总超时：40s（web `:177`，systemd RestartSec=5 + 启动耗时）。 */
export const RESTART_TIMEOUT_MS: number = 40000;
/** 轮询前给响应 flush 的缓冲：1200ms（web `:195`，重启 800ms 后才触发）。 */
export const RESTART_FLUSH_DELAY_MS: number = 1200;

/** 是否已超过轮询期限（web `:179` `Date.now() > deadline`）。 */
export function pollExceeded(nowMs: number, deadlineMs: number): boolean {
  return nowMs > deadlineMs;
}

/** 轮询起始时刻 → 期限（web `:177` `Date.now() + 40_000`）。 */
export function pollDeadline(startMs: number): number {
  return startMs + RESTART_TIMEOUT_MS;
}

/** 超时可见文案（web `:180` `settings.about.restartTimeout`，**必显失败**，不许静默）。 */
export function restartTimeoutText(): string {
  return `重启超时：服务在 ${RESTART_TIMEOUT_MS / 1000} 秒内未恢复。若为手动启动的进程，请自行重新启动服务。`;
}

/** 重启完成文案（web `:417` `settings.about.restartDone`）。 */
export function restartSucceededText(): string {
  return '服务已重启。';
}

/**
 * 重启区的中性提示（web `:363-368`）——**不假定会不会自动重启**，取决于用户的服务管理方式：
 * 托管（systemd/launchd/supervisord/docker）⇒ 说明由谁拉起；`none`/未知 ⇒ 中性提示。
 */
export function restartHintText(managedBy: string | undefined): string {
  const m: string = managedBy !== undefined && managedBy !== null ? managedBy.trim() : '';
  if (m.length > 0 && m !== 'none') {
    return `${m} 托管：重启由服务管理器拉起，连接会自动恢复。`;
  }
  return '是否自动恢复取决于你的服务管理方式；手动启动的进程重启后不会自动拉起。';
}

/**
 * 重启区的错误文案：`timedOut` ⇒ 超时提示；`failed` ⇒ 服务端/网络错误原文；其余 ⇒ 空串。
 * ⛔ 失败/超时**必须可见**（不许静默）；成功态单独走 `restartSucceededText`。
 */
export function restartErrorText(state: string, detail: string | undefined): string {
  if (state === RESTART_TIMED_OUT) {
    return restartTimeoutText();
  }
  if (state === RESTART_FAILED) {
    const d: string = detail !== undefined && detail !== null ? detail.trim() : '';
    return d.length > 0 ? d : '重启请求失败。';
  }
  return '';
}

// ── release notes 外链：规范化 + 可点性判定 ─────────────────────────────────────

/**
 * release notes 外链地址规范化：trim；空 / 非白名单协议 ⇒ 空串。
 *
 * ⛔ **复用** `core/msgops.ets` 的 `isOpenableScheme`（http/https/mailto 白名单），
 *    **不自造**协议判定 —— 打开动作走仓内既有做法（`Index.ets:4558-4572` 的
 *    `common.UIAbilityContext.startAbility({action:'ohos.want.action.viewData', uri})`）。
 */
export function normalizeReleaseUrl(raw: string | undefined): string {
  const s: string = raw !== undefined && raw !== null ? raw.trim() : '';
  if (s.length === 0) {
    return '';
  }
  return isOpenableScheme(s) ? s : '';
}

/** `check_update.url` → 可打开的 release 外链（不能打开 ⇒ 空串，UI 不渲染链接）。 */
export function releaseNotesUrl(chk: UpdateCheckRow | undefined): string {
  if (chk === undefined || chk === null) {
    return '';
  }
  return normalizeReleaseUrl(chk.url);
}

/** 该地址是否可点（非空 + 白名单协议）。 */
export function isClickableUrl(url: string): boolean {
  return normalizeReleaseUrl(url).length > 0;
}
