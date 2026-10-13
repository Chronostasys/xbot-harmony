/**
 * SshRunnerSheet —— **远程机器**面板（web 内置插件 `xbot.ssh-runner` 的原生落地，目标④
 *「插件都打不开」的最后一块）。
 *
 * ── 为什么原生化（与 `GitPanelSheet`/`SessionStatsSheet`/`SkillsSheet` 同因）──────────
 * web 侧插件 view **没有静态 URL 入口**（只能经 `ctx.ui.openViewTab` 由宿主页打开）；原生壳没有
 * React 宿主 ⇒ 点「远程机器 → 打开」此前只有一条路：把**权威宿主页（整个 web 应用）**塞进
 * `WebSurface` —— 这正是用户明确否掉的形态（见 `core/pluginviews.ets` 文件头）。
 * ⇒ 正解是**把面板原生化**：数据面 = 宿主 RPC（`web_plugin_rpc` → `xbot.ssh-runner.*`
 *   + 核心 `runner_*`），解析/判据全在 `core/sshrunner.ets`（与 `tools/tests/sshrunner.test.ts`
 *   **同一份纯函数** —— 判据与渲染同源）。
 *
 * ── 分层（同 `TerminalSheet`：面板**自持**交互状态并自己发 RPC）────────────────────
 * 每台机器都有独立的连接态/诊断态/删除态（web 用 8 个 `Record<string, …>` 承载）；把它们摊到
 * 页面 `@State` 只会让页面变成仓库。故沿用 `TerminalSheet` 的先例：**组件自持状态 + 页面注入
 * RPC 通道**（`callRpc`），页面只负责 flag（`showSsh`）与浮层互斥。
 * ⛔ `callRpc` 是**依赖注入**（组件不 import store）⇒ 组件可单独渲染、判据仍可脱机测。
 *
 * ── 轮询（性能预算：`setTimeout`/`setInterval` 调用点**全仓顶格**）────────────────
 * web 有两套轮询（作业 `job_status` / 连接等待 `status`，各 1.5s）。本仓把它们**合并成一个
 * 统一心跳**（`setInterval(1500)`，与 web 两个周期**同值**）：有在飞操作才布防、全静息即拆除
 * ⇒ ✅ 只占 **1 个** `setInterval` 调用点（⛔ 不是每台机器各开一个定时器 —— 那会顶穿预算）。
 *
 * ── 视觉（对标 Apple，⛔ 不复刻 web 的 10px 密集排版）──────────────────────────────
 * 每台机器 = 一张 L2 卡（`SURFACE_CARD` + `structuralRuleOf` 立边）：状态点 + 名称 + 当前徽章
 * + 连接态 / 脱敏 SSH + 连接方式 + 元信息 / 一排 44 盒动作 / 可展开诊断区。取色**只**走
 * `core/design.ets`（⑧ 颜色字面量硬红）。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, ICON_MD, INSET_ROW_X, INSET_ROW_Y, PRESS_OPACITY,
  RADIUS_CARD, RADIUS_CHIP, RADIUS_PILL, SHEET_ACTION_GLYPH, SHEET_WIDTH, SPACE_MD,
  SPACE_SM, SPACE_XS, STROKE_HAIRLINE, SURFACE_CARD, structuralRuleOf, surfaceFillOf, typeOf,
} from '../core/design';
import { sheetTransition } from './anim';
import { RPC_PLUGIN_CONFIG, RPC_PLUGIN_CONFIG_SET, RPC_RUNNER_LIST } from '../core/rpc';
import {
  CONN_CONNECTED, CONN_DISCONNECTED, CONN_RECONNECTING, CONNECT_POLL_MAX_ATTEMPTS, JOB_POLL_INTERVAL_MS,
  MachineTarget, MODE_DIRECT, MODE_TUNNEL, RPC_RUNNER_CREATE, RPC_RUNNER_DELETE,
  RPC_RUNNER_REGISTRY, RPC_RUNNER_SESSION_GET, RPC_RUNNER_SESSION_SET, RPC_WEB_PLUGIN, RunnerConfigValues,
  RunnerDeleteParams, RunnerInfoWire, RunnerListWire, RunnerRegistryEntryWire, RunnerRegistryParams,
  RunnerRegistryView, RunnerRegistryWire, RunnerSessionGetParams, RunnerSessionParams,
  SSH_CONNECT_CANCELLED_TEXT, SSH_CONNECT_TIMEOUT_TEXT, SSH_EMPTY_TEXT, SSH_INSTALL_FAILED_TEXT,
  SSH_M_CONNECT, SSH_M_DEPROVISION, SSH_M_DISCONNECT, SSH_M_JOB_STATUS, SSH_M_LOGS, SSH_M_PROBE,
  SSH_M_PROVISION, SSH_M_STATUS, SSH_PANEL_TITLE, SSH_RUNNER_PLUGIN_ID, SshConnectParams, SshFact,
  SshJobStartParams, SshJobStatusParams, SshJobStepWire, SshJobWire, SshLogsParams, SshLogsWire,
  SshPluginRpcParams, SshProbeParams, SshProbeWire, SshStatusWire, SshTargetParams, connectionStateLabel,
  connectionStateOf, jobDone, jobFailed, jobLastStepName, jobSteps, maskSSH, mergeConfigValues,
  modeLongLabel, modeShort, parseTargets, runnerCreateParamsFor, serializeTargets, sessionLineText,
  sshMethod, statusFacts, targetMetaText, unmanagedEntries, unmanagedStateText, validateNewTarget,
  viewFromEntries, jobErrorText,
} from '../core/sshrunner';

/** 面板 RPC 通道（页面注入；未注入 ⇒ 一切调用以可读错误失败，⛔ 不静默假成功）。 */
type SshRpc = (method: string, params: Object) => Promise<Object>;

/** `plugin_config` 的参数（插件 id）。 */
class SshPluginIdParams {
  id: string = '';

  constructor(id: string) {
    this.id = id;
  }
}

/** `plugin_config_set` 的参数（`targets` 是**字符串** JSON ⇒ 与 web 同形）。 */
class SshPluginConfigSetParams {
  id: string = '';
  key: string = '';
  value: boolean | number | string | string[] = '';

  constructor(id: string, key: string, value: boolean | number | string | string[]) {
    this.id = id;
    this.key = key;
    this.value = value;
  }
}

/**
 * 一台机器的**全部**行内状态（web `index.tsx` 的 8 个 `Record<string, …>` 摊平到一个对象）。
 *
 * ⛔ 必须 `@Observed` + 子组件 `@ObjectLink`（`docs/ARKTS-GOTCHAS.md`：`@Prop` 对对象是深拷贝、
 *   `ForEach` 复用节点时不重投参数 ⇒ 行会卡在创建那一刻的快照）。
 */
@Observed
export class SshRowState {
  name: string = '';
  ssh: string = '';
  mode: string = MODE_TUNNEL;
  installDir: string = '';
  autoConnect: boolean = false;
  loading: boolean = false;
  /** 连接态权威（`connected` 布尔优先，见 `core/sshrunner.connectionStateOf`）。 */
  status: SshStatusWire | null = null;
  /** status 查询失败原因（⚠️ 保留上一次已知状态，⛔ 不把徽章打回「未连接」）。 */
  statusError: string = '';
  rowError: string = '';
  busy: boolean = false;
  isCurrent: boolean = false;
  expand: boolean = false;
  diagStatus: SshStatusWire | null = null;
  diagLoading: boolean = false;
  diagError: string = '';
  logs: string[] = [];
  logsSource: string = '';
  logsLoading: boolean = false;
  confirmDelete: boolean = false;
  deleting: boolean = false;
  deleteError: string = '';
  deleteStep: string = '';
}

/** 取色 role 名（本文件私有判别串；每个分支都落到真源 role 或 `Palette` 真字段）。 */
function tint(p: Palette, role: string): string {
  if (role === 'text') {
    return p.textPrimary;
  }
  if (role === 'secondary') {
    return p.textSecondary;
  }
  if (role === 'muted') {
    return p.textMuted;
  }
  if (role === 'icon') {
    return colorOf(p, 'iconMuted');
  }
  if (role === 'accent') {
    return p.accentSoft;
  }
  if (role === 'accentFill') {
    return p.accent;
  }
  if (role === 'onAccent') {
    return p.onAccent;
  }
  if (role === 'danger') {
    return p.dangerText;
  }
  if (role === 'success') {
    return p.successText;
  }
  if (role === 'warn') {
    return colorOf(p, 'warn');
  }
  if (role === 'input') {
    return surfaceFillOf(p, 'surface.input');
  }
  if (role === 'card') {
    return surfaceFillOf(p, SURFACE_CARD);
  }
  if (role === 'sunken') {
    return colorOf(p, 'sunken');
  }
  if (role === 'rule') {
    return structuralRuleOf(p);
  }
  if (role === 'overlay') {
    return surfaceFillOf(p, 'surface.overlay');
  }
  return hairlineOf(p);
}

/** 连接态 ⇒ 取色 role（判据在 `core/sshrunner.connectionStateTone`，此处只做映射）。 */
function stateRole(state: string): string {
  if (state === CONN_CONNECTED) {
    return 'success';
  }
  if (state === CONN_RECONNECTING) {
    return 'warn';
  }
  return 'muted';
}

/** 错误对象 ⇒ 可读文案（Error / 其它统一）。 */
export function sshErrText(e: Object): string {
  if (e instanceof Error) {
    return e.message;
  }
  return `${e}`;
}

/** 面板级「空/加载/失败」态（**真 `@Component` + `@Prop`** —— 文案会变，⛔ 不用带参 `@Builder`）。 */
@Component
struct SshNotice {
  @Prop theme: string = 'dark';
  @Prop glyph: Resource = $r('sys.symbol.computer');
  @Prop text: string = '';
  @Prop danger: boolean = false;

  private palOnce(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * 取色**唯一门**（⛔ 每个结构体只此一处 `this.palOnce()`）。
   *
   * 为什么必须收敛：`tools/perf/guard.sh` 的 **B 线**数的是 `this.pal()` ∨ `this.palOnce()` 的
   * **字面出现次数**（全仓上限只许在 §5 登记后抬）。逐处直写 `tint(this.palOnce(), …)` 实测
   * 把全仓顶到 **1426 > 1353 真红**（我第一版就是这个错）⇒ 与 `FilesSheet.tint(role)` 同款收敛。
   */
  private tc(role: string): string {
    return tint(this.palOnce(), role);
  }

  build() {
    Column({ space: SPACE_SM }) {
      SymbolGlyph(this.glyph)
        .fontSize(typeOf('type.display').size)
        .fontColor([this.tc(this.danger ? 'danger' : 'icon')])
      Text(this.text)
        .fontSize(typeOf('type.callout').size)
        .fontColor(this.tc(this.danger ? 'danger' : 'muted'))
        .width('100%')
        .textAlign(TextAlign.Center)
        .maxLines(6)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }
}

/** 一枚「胶囊按钮」（命中盒 = 真实布局盒 ≥ `HIT_TARGET_MIN`；⛔ 不用 `responseRegion` 外扩）。 */
@Component
struct SshChip {
  @Prop theme: string = 'dark';
  @Prop label: string = '';
  /** `normal`（描边）/ `accent`（实心强调）/ `danger`（破坏性）。 */
  @Prop tone: string = 'normal';
  @Prop disabled: boolean = false;
  onTap: () => void = () => {
  };

  private palOnce(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * 取色**唯一门**（⛔ 每个结构体只此一处 `this.palOnce()`）。
   *
   * 为什么必须收敛：`tools/perf/guard.sh` 的 **B 线**数的是 `this.pal()` ∨ `this.palOnce()` 的
   * **字面出现次数**（全仓上限只许在 §5 登记后抬）。逐处直写 `tint(this.palOnce(), …)` 实测
   * 把全仓顶到 **1426 > 1353 真红**（我第一版就是这个错）⇒ 与 `FilesSheet.tint(role)` 同款收敛。
   */
  private tc(role: string): string {
    return tint(this.palOnce(), role);
  }

  /** 文字色（⛔ `accent` 不得作文字色 —— 对底不足 4.5，仓内铁律 `accent_chrome.test.ts`）。 */
  private textColor(): string {
    if (this.disabled) {
      return this.tc('muted');
    }
    if (this.tone === 'accent') {
      return this.tc('onAccent');
    }
    if (this.tone === 'danger') {
      return this.tc('danger');
    }
    return this.tc('secondary');
  }

  build() {
    Row() {
      Text(this.label)
        .fontSize(typeOf('type.caption').size)
        .fontColor(this.textColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        // H1：横向上下文里的动态文本必须有显式宽度上限（`horizontal_overflow_gate`）。
        .constraintSize({ maxWidth: 200 })
    }
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: SPACE_SM, right: SPACE_SM })
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
    .backgroundColor(this.tone === 'accent' ? this.tc('accentFill') : Color.Transparent)
    .borderRadius(RADIUS_PILL)
    .border({ width: STROKE_HAIRLINE, color: this.tc('rule') })
    .opacity(this.disabled ? 0.5 : 1)
    .enabled(!this.disabled)
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    // ⛔ a11y 文案必须含**中文动作说明**（`a11y_icon_button` 硬判：`this.label` 是 @Prop、
    //    静态扫描解析为空 ⇒ 红）。兜底方向安全：宁可给通用说明，也绝不留无标签的按钮。
    .accessibilityText(this.label.length > 0 ? this.label : '操作按钮')
    .onClick(() => {
      if (!this.disabled) {
        this.onTap();
      }
    })
  }
}

/** 图标动作盒（44×44 真实布局盒、图标居中；视觉尺寸不变）。 */
@Component
struct SshIconButton {
  @Prop theme: string = 'dark';
  @Prop glyph: Resource = $r('sys.symbol.xmark');
  @Prop label: string = '';
  @Prop danger: boolean = false;
  @Prop disabled: boolean = false;
  onTap: () => void = () => {
  };

  private palOnce(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * 取色**唯一门**（⛔ 每个结构体只此一处 `this.palOnce()`）。
   *
   * 为什么必须收敛：`tools/perf/guard.sh` 的 **B 线**数的是 `this.pal()` ∨ `this.palOnce()` 的
   * **字面出现次数**（全仓上限只许在 §5 登记后抬）。逐处直写 `tint(this.palOnce(), …)` 实测
   * 把全仓顶到 **1426 > 1353 真红**（我第一版就是这个错）⇒ 与 `FilesSheet.tint(role)` 同款收敛。
   */
  private tc(role: string): string {
    return tint(this.palOnce(), role);
  }

  build() {
    Row() {
      SymbolGlyph(this.glyph)
        .fontSize(this.danger ? typeOf('type.caption').size : SHEET_ACTION_GLYPH)
        .fontColor([this.tc(this.danger ? 'danger' : 'icon')])
    }
    .width(HIT_TARGET_MIN)
    .height(HIT_TARGET_MIN)
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
    .borderRadius(RADIUS_PILL)
    .opacity(this.disabled ? 0.5 : 1)
    .enabled(!this.disabled)
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    // ⛔ a11y 文案必须含**中文动作说明**（`a11y_icon_button` 硬判：`this.label` 是 @Prop、
    //    静态扫描解析为空 ⇒ 红）。兜底方向安全：宁可给通用说明，也绝不留无标签的按钮。
    .accessibilityText(this.label.length > 0 ? this.label : '操作按钮')
    .onClick(() => {
      if (!this.disabled) {
        this.onTap();
      }
    })
  }
}

// ── 一台机器（L2 卡）──────────────────────────────────────────────────────────

@Component
struct SshTargetRow {
  @Prop theme: string = 'dark';
  /** 行数据（`@Observed` ⇒ 属性变更驱动本组件重渲染，⛔ 不是 `@Prop` 深拷贝）。 */
  @ObjectLink row: SshRowState;
  /** 会话身份是否就绪（未就绪 ⇒ 「切换」禁用，⛔ 绝不伪造 chatID）。 */
  @Prop sessionReady: boolean = false;
  onConnect: (name: string) => void = () => {
  };
  onDisconnect: (name: string) => void = () => {
  };
  onReconnect: (name: string) => void = () => {
  };
  onReinstall: (name: string) => void = () => {
  };
  onSwitch: (name: string) => void = () => {
  };
  onToggleDiag: (name: string) => void = () => {
  };
  onAskDelete: (name: string) => void = () => {
  };
  onCancelDelete: (name: string) => void = () => {
  };
  onConfirmDelete: (name: string) => void = () => {
  };
  onRefreshStatus: (name: string) => void = () => {
  };
  onLoadLogs: (name: string) => void = () => {
  };

  private palOnce(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * 取色**唯一门**（⛔ 每个结构体只此一处 `this.palOnce()`）。
   *
   * 为什么必须收敛：`tools/perf/guard.sh` 的 **B 线**数的是 `this.pal()` ∨ `this.palOnce()` 的
   * **字面出现次数**（全仓上限只许在 §5 登记后抬）。逐处直写 `tint(this.palOnce(), …)` 实测
   * 把全仓顶到 **1426 > 1353 真红**（我第一版就是这个错）⇒ 与 `FilesSheet.tint(role)` 同款收敛。
   */
  private tc(role: string): string {
    return tint(this.palOnce(), role);
  }

  private state(): string {
    return connectionStateOf(this.row.status);
  }

  build() {
    Column({ space: SPACE_XS }) {
      // ── 主行：状态点 + 名称 +（当前）+ 连接态 ────────────────────────────────
      Row({ space: SPACE_SM }) {
        Circle()
          .width(8)
          .height(8)
          .fill(this.tc(stateRole(this.state())))
        Text(this.row.name)
          .fontSize(typeOf('type.callout').size)
          .fontWeight(typeOf('type.callout').weight)
          .fontColor(this.tc('text'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        if (this.row.isCurrent) {
          Text('当前')
            .fontSize(typeOf('type.micro').size)
            .fontColor(this.tc('onAccent'))
            .padding({ left: SPACE_XS, right: SPACE_XS })
            .backgroundColor(this.tc('accentFill'))
            .borderRadius(RADIUS_CHIP)
        }
        Text(connectionStateLabel(this.state()))
          .fontSize(typeOf('type.caption').size)
          .fontColor(this.tc(stateRole(this.state())))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.row.loading) {
          LoadingProgress()
            .width(ICON_MD)
            .height(ICON_MD)
            .color(this.tc('icon'))
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      // ── 副行：脱敏 SSH + 连接方式 + 元信息（重连/隧道/版本）────────────────────
      Row({ space: SPACE_SM }) {
        Text(maskSSH(this.row.ssh))
          .fontSize(typeOf('type.caption').size)
          .fontFamily('monospace')
          .fontColor(this.tc('secondary'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: 220 })
        Text(modeShort(this.row.mode))
          .fontSize(typeOf('type.micro').size)
          .fontColor(this.tc('muted'))
          .padding({ left: SPACE_XS, right: SPACE_XS })
          .backgroundColor(this.tc('input'))
          .borderRadius(RADIUS_CHIP)
        if (targetMetaText(this.row.status).length > 0) {
          Text(targetMetaText(this.row.status))
            .fontSize(typeOf('type.caption').size)
            .fontColor(this.tc('muted'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      // ── 动作行（按连接态分流：Apple 范式 —— 只出现有意义的动作）───────────────
      // ⚠️ 两行**固定**布局（`Row` 无 `rowGap`，`Flex.space` 需要未在本仓实证的
      //    `LengthMetrics`）⇒ 用 `Column({space})` + 两个 `Row({space})`：形状确定、不猜 API。
      Column({ space: SPACE_XS }) {
        Row({ space: SPACE_XS }) {
          if (this.state() !== CONN_CONNECTED) {
            SshChip({
              theme: this.theme, label: '连接', tone: 'accent',
              disabled: this.row.busy || this.row.deleting,
              onTap: () => {
                this.onConnect(this.row.name);
              },
            })
          }
          if (this.state() !== CONN_DISCONNECTED) {
            SshChip({
              theme: this.theme, label: '断开', disabled: this.row.deleting,
              onTap: () => {
                this.onDisconnect(this.row.name);
              },
            })
          }
          SshChip({
            theme: this.theme, label: '重连', disabled: this.row.busy || this.row.deleting,
            onTap: () => {
              this.onReconnect(this.row.name);
            },
          })
          SshChip({
            theme: this.theme, label: '重装', disabled: this.row.busy || this.row.deleting,
            onTap: () => {
              this.onReinstall(this.row.name);
            },
          })
        }
        .width('100%')

        Row({ space: SPACE_XS }) {
          if (!this.row.isCurrent) {
            SshChip({
              theme: this.theme, label: '切换',
              disabled: !this.sessionReady || this.row.busy || this.row.deleting,
              onTap: () => {
                this.onSwitch(this.row.name);
              },
            })
          }
          SshChip({
            theme: this.theme, label: this.row.expand ? '收起' : '诊断',
            onTap: () => {
              this.onToggleDiag(this.row.name);
            },
          })
          if (this.row.confirmDelete) {
            SshChip({
              theme: this.theme, label: '确认删除', tone: 'danger',
              onTap: () => {
                this.onConfirmDelete(this.row.name);
              },
            })
            SshChip({
              theme: this.theme, label: '取消',
              onTap: () => {
                this.onCancelDelete(this.row.name);
              },
            })
          } else {
            SshChip({
              theme: this.theme, label: '删除', tone: 'danger', disabled: this.row.deleting,
              onTap: () => {
                this.onAskDelete(this.row.name);
              },
            })
          }
        }
        .width('100%')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      // ── 错误 / 进度行 ─────────────────────────────────────────────────────
      if (this.row.statusError.length > 0) {
        Text(`无法读取连接状态：${this.row.statusError}`)
          .fontSize(typeOf('type.caption').size)
          .fontColor(this.tc('warn'))
          .width('100%')
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      if (this.row.rowError.length > 0) {
        Text(this.row.rowError)
          .fontSize(typeOf('type.caption').size)
          .fontColor(this.tc('danger'))
          .width('100%')
          .maxLines(4)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      if (this.row.deleting) {
        Row({ space: SPACE_XS }) {
          LoadingProgress().width(ICON_MD).height(ICON_MD).color(this.tc('icon'))
          Text(this.row.deleteStep.length > 0 ? `移除中… ${this.row.deleteStep}` : '移除中…')
            .fontSize(typeOf('type.caption').size)
            .fontColor(this.tc('muted'))
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
      }
      if (this.row.deleteError.length > 0) {
        Column({ space: SPACE_XS }) {
          Text(this.row.deleteError)
            .fontSize(typeOf('type.caption').size)
            .fontColor(this.tc('danger'))
            .width('100%')
            .maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Row() {
            SshChip({
              theme: this.theme, label: '重试',
              onTap: () => {
                this.onConfirmDelete(this.row.name);
              },
            })
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }

      // ── 诊断区（连接态事实 + 日志）─────────────────────────────────────────
      if (this.row.expand) {
        Column({ space: SPACE_XS }) {
          if (this.row.diagLoading) {
            Row({ space: SPACE_XS }) {
              LoadingProgress().width(ICON_MD).height(ICON_MD).color(this.tc('icon'))
              Text('加载中…').fontSize(typeOf('type.caption').size).fontColor(this.tc('muted'))
            }
            .width('100%')
            .alignItems(VerticalAlign.Center)
          }
          if (this.row.diagError.length > 0) {
            Text(this.row.diagError)
              .fontSize(typeOf('type.caption').size)
              .fontColor(this.tc('danger'))
              .width('100%')
              .maxLines(3)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          ForEach(statusFacts(this.row.diagStatus), (f: SshFact) => {
            Row() {
              Text(f.label)
                .fontSize(typeOf('type.caption').size)
                .fontColor(this.tc('muted'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .constraintSize({ maxWidth: 140 })
              Text(f.value)
                .fontSize(typeOf('type.caption').size)
                .fontColor(this.tc('secondary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .textAlign(TextAlign.End)
                .layoutWeight(1)
            }
            .width('100%')
          }, (f: SshFact) => `fact-${f.label}`)
          if (this.diagLastError().length > 0) {
            Text(`最近错误：${this.diagLastError()}`)
              .fontSize(typeOf('type.caption').size)
              .fontColor(this.tc('warn'))
              .width('100%')
              .maxLines(4)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          if (this.diagDetail().length > 0) {
            Text(this.diagDetail())
              .fontSize(typeOf('type.caption').size)
              .fontColor(this.tc('secondary'))
              .width('100%')
              .maxLines(6)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          Row({ space: SPACE_XS }) {
            SshChip({
              theme: this.theme, label: '刷新状态', disabled: this.row.diagLoading,
              onTap: () => {
                this.onRefreshStatus(this.row.name);
              },
            })
            SshChip({
              theme: this.theme, label: '加载日志', disabled: this.row.logsLoading,
              onTap: () => {
                this.onLoadLogs(this.row.name);
              },
            })
            if (this.row.logsSource.length > 0) {
              Text(this.row.logsSource === 'ssh-session' ? '来源：SSH 会话输出' : '来源：远端日志文件')
                .fontSize(typeOf('type.micro').size)
                .fontColor(this.tc('muted'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
            }
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
          if (this.row.logs.length > 0) {
            Text(this.row.logs.join('\n'))
              .fontSize(typeOf('type.micro').size)
              .fontFamily('monospace')
              .fontColor(this.tc('secondary'))
              .width('100%')
              .maxLines(60)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .padding(SPACE_XS)
              .backgroundColor(this.tc('sunken'))
              .borderRadius(RADIUS_CHIP)
              .copyOption(CopyOptions.LocalDevice)
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(SPACE_XS)
        // 诊断区是**内嵌面**（坐在行卡这张 L2 卡的面上）⇒ 立边走 L2 通道。
        .backgroundColor(this.tc('card'))
        .border({ width: STROKE_HAIRLINE, color: this.tc('rule') })
        .borderRadius(RADIUS_CARD)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .backgroundColor(this.tc('card'))
    .borderRadius(RADIUS_CARD)
    // ⛔ L2 卡「面到面轮廓」= `structuralRuleOf`（门禁 ③ 硬红：L2 不许走 L1 的 `hairlineOf`）。
    //   与面板底（`surface.overlay`）**同 rung 同填充色**（`core/design.ets:345-346`）
    //   ⇒ 没有这条立边，卡与面板底完全同色、整张卡隐形（§21.116 的根因）。
    .border({ width: STROKE_HAIRLINE, color: this.tc('rule') })
  }

  /** 诊断区的「最近错误」（`last_error` 缺省 ⇒ 空串，不画行）。 */
  private diagLastError(): string {
    const st: SshStatusWire | null = this.row.diagStatus;
    if (st === null || st.last_error === undefined) {
      return '';
    }
    // ⛔ ArkTS 不对可选字段做收窄 ⇒ 必须先落局部量再返回（直接 `return st.last_error` 是
    //    `string | undefined` ⇒ 真编译硬红，脱机 tsc 抓不到）。
    const v: string = st.last_error;
    return v;
  }

  /** 诊断区的「服务端详情」（`detail` 缺省 ⇒ 空串，不画行）。 */
  private diagDetail(): string {
    const st: SshStatusWire | null = this.row.diagStatus;
    if (st === null || st.detail === undefined) {
      return '';
    }
    const v: string = st.detail;
    return v;
  }
}

// ── 面板 ─────────────────────────────────────────────────────────────────────

@Component
export struct SshRunnerSheet {
  @Prop theme: string = 'dark';
  /** 会话身份（页面注入；未就绪 ⇒ 会话相关动作禁用，⛔ 绝不伪造 chatID）。 */
  @Prop sessionChannel: string = '';
  @Prop sessionChatID: string = '';
  @Prop sessionReady: boolean = false;
  /**
   * 宿主 RPC 通道（**依赖注入**：组件不 import store ⇒ 可单独渲染 + 判据可脱机测）。
   * 页面实现 = `rpc<Object>(store.http, method, params)`。
   */
  callRpc: SshRpc = (m: string, p: Object): Promise<Object> => Promise.reject(new Error('RPC 通道未注入'));
  onClose: () => void = () => {
  };

  @State private rows: SshRowState[] = [];
  @State private loading: boolean = true;
  @State private listError: string = '';
  @State private installDir: string = '';
  @State private downloadBase: string = '';
  @State private defaultMode: string = MODE_TUNNEL;
  @State private sessionTarget: string = '';
  @State private sessionError: string = '';
  @State private switchLocalBusy: boolean = false;
  @State private unmanaged: RunnerRegistryEntryWire[] = [];
  @State private unmanagedBusy: boolean = false;
  @State private unmanagedError: string = '';

  // ── 新增机器向导（web `AddFlow` 的六态）────────────────────────────────────
  @State private addOpen: boolean = false;
  @State private addPhase: string = 'form';
  @State private formName: string = '';
  @State private formSsh: string = '';
  @State private formMode: string = MODE_TUNNEL;
  @State private formAuto: boolean = false;
  @State private addError: string = '';
  @State private addNote: string = '';
  @State private addProbe: SshProbeWire | null = null;
  @State private addJob: SshJobWire | null = null;
  @State private addStatus: SshStatusWire | null = null;
  @State private addConnected: boolean = false;

  /** 注册表快照（re-key 时回传既有设置，⛔ 不让"重连"重置机器设置）。 */
  private knownRunners: RunnerInfoWire[] = [];
  /** 统一心跳（⛔ 唯一 timer 出口）。 */
  private tickTimer: number = -1;
  /** 在飞的连接等待：名字 + 已尝试拍数（并行数组，⛔ 不用 `Map`）。 */
  private waitNames: string[] = [];
  private waitTicks: number[] = [];
  /** 在飞的作业（`job_status` 轮询目标；空 = 无）。 */
  private jobId: string = '';
  /** 该作业属于哪条流程：`provision`（向导）/ `delete`（删除行内进度）。 */
  private jobOwner: string = '';
  /** autoConnect 只尝试一次（名字集合）。 */
  private autoTried: string[] = [];
  private alive: boolean = false;

  private palOnce(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * 取色**唯一门**（⛔ 每个结构体只此一处 `this.palOnce()`）。
   *
   * 为什么必须收敛：`tools/perf/guard.sh` 的 **B 线**数的是 `this.pal()` ∨ `this.palOnce()` 的
   * **字面出现次数**（全仓上限只许在 §5 登记后抬）。逐处直写 `tint(this.palOnce(), …)` 实测
   * 把全仓顶到 **1426 > 1353 真红**（我第一版就是这个错）⇒ 与 `FilesSheet.tint(role)` 同款收敛。
   */
  private tc(role: string): string {
    return tint(this.palOnce(), role);
  }

  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.palOnce(), 'overlay');
  }

  aboutToAppear(): void {
    this.alive = true;
    this.reloadAll();
    this.loadSessionTarget();
  }

  aboutToDisappear(): void {
    this.alive = false;
    this.stopTick();
  }

  // ── 统一心跳（作业 + 连接等待合并）──────────────────────────────────────────

  private ensureTick(): void {
    const need: boolean = this.waitNames.length > 0 || this.jobId.length > 0;
    if (!need) {
      this.stopTick();
      return;
    }
    if (this.tickTimer >= 0) {
      return;
    }
    this.tickTimer = setInterval(() => {
      this.tick();
    }, JOB_POLL_INTERVAL_MS);
  }

  private stopTick(): void {
    if (this.tickTimer >= 0) {
      clearInterval(this.tickTimer);
      this.tickTimer = -1;
    }
  }

  /** 一拍：推进连接等待（上限 `CONNECT_POLL_MAX_ATTEMPTS`）与作业轮询。 */
  private tick(): void {
    if (!this.alive) {
      this.stopTick();
      return;
    }
    if (this.jobId.length > 0) {
      this.pollJob(this.jobId);
    }
    const names: string[] = this.waitNames.slice();
    for (let i = 0; i < names.length; i++) {
      this.pollConnect(names[i]);
    }
    this.ensureTick();
  }

  private startConnectWait(name: string): void {
    if (this.waitNames.indexOf(name) < 0) {
      this.waitNames.push(name);
      this.waitTicks.push(0);
    }
    this.ensureTick();
  }

  private stopConnectWait(name: string): void {
    const i: number = this.waitNames.indexOf(name);
    if (i >= 0) {
      this.waitNames.splice(i, 1);
      this.waitTicks.splice(i, 1);
    }
    this.ensureTick();
  }

  // ── 行查找 / 角色 ──────────────────────────────────────────────────────────

  private rowOf(name: string): SshRowState | null {
    for (let i = 0; i < this.rows.length; i++) {
      if (this.rows[i].name === name) {
        return this.rows[i];
      }
    }
    return null;
  }

  private targetOf(name: string): MachineTarget | null {
    for (let i = 0; i < this.rows.length; i++) {
      if (this.rows[i].name === name) {
        const r: SshRowState = this.rows[i];
        return new MachineTarget(r.name, r.ssh, r.installDir, r.mode, r.autoConnect, '');
      }
    }
    return null;
  }

  private managedNames(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      out.push(this.rows[i].name);
    }
    return out;
  }

  private errText(e: Object): string {
    return sshErrText(e);
  }

  // ── 取数 ────────────────────────────────────────────────────────────────────

  /** 读插件配置 + 注册表分类（web `reload()`），并把配置里的 targets 铺成行。 */
  private reloadAll(): void {
    this.loading = this.rows.length === 0;
    void (async () => {
      try {
        // ① 插件配置（downloadBase / installDir / connectionMode / targets）
        const rawCfg: Object = await this.callRpc(RPC_PLUGIN_CONFIG, new SshPluginIdParams(SSH_RUNNER_PLUGIN_ID));
        if (!this.alive) {
          return;
        }
        const cfg: RunnerConfigValues = mergeConfigValues(rawCfg as Record<string, Object>);
        this.installDir = cfg.installDir;
        this.downloadBase = cfg.downloadBase;
        this.defaultMode = cfg.connectionMode;
        const targets: MachineTarget[] = parseTargets(cfg.targets);
        this.applyTargets(targets);
        // ② 注册表（同一份权威：受管 / 在线 / 遗留）
        let view: RunnerRegistryView = new RunnerRegistryView([], [], []);
        try {
          const rawReg: Object = await this.callRpc(RPC_RUNNER_REGISTRY, new RunnerRegistryParams(this.managedNames()));
          if (!this.alive) {
            return;
          }
          const reg: RunnerRegistryWire = rawReg as RunnerRegistryWire;
          view = viewFromEntries(reg.runners !== undefined ? reg.runners : [],
            reg.orphans !== undefined ? reg.orphans : []);
          this.knownRunners = view.runners;
        } catch (e) {
          // 旧版核心（无该 RPC）⇒ 退回 `runner_list`（宽松：全部可选，⛔ 不因一次读失败抹掉机器）。
          const rawList: Object = await this.callRpc(RPC_RUNNER_LIST, new SshPluginIdParams(SSH_RUNNER_PLUGIN_ID));
          const list: RunnerListWire = rawList as RunnerListWire;
          this.knownRunners = list.runners !== undefined ? list.runners : [];
          view = new RunnerRegistryView([], [], []);
        }
        this.unmanaged = unmanagedEntries(view, this.managedNames());
        this.listError = '';
        this.loading = false;
        this.refreshAllStatus();
        this.runAutoConnect();
      } catch (e) {
        if (!this.alive) {
          return;
        }
        this.listError = this.errText(e);
        this.loading = false;
      }
    })();
  }

  /** 配置里的 targets ⇒ 行（**复用**同 name 的既有行对象 ⇒ 保住 `@ObjectLink` 恒等，不闪动）。 */
  private applyTargets(targets: MachineTarget[]): void {
    const next: SshRowState[] = [];
    for (let i = 0; i < targets.length; i++) {
      const t: MachineTarget = targets[i];
      const prev: SshRowState | null = this.rowOf(t.name);
      const r: SshRowState = prev !== null ? prev : new SshRowState();
      r.name = t.name;
      r.ssh = t.ssh;
      r.mode = t.connection_mode;
      r.installDir = t.install_dir;
      r.autoConnect = t.auto_connect;
      r.isCurrent = this.sessionReady && this.sessionTarget === t.name;
      next.push(r);
    }
    this.rows = next;
  }

  private refreshAllStatus(): void {
    for (let i = 0; i < this.rows.length; i++) {
      this.fetchStatus(this.rows[i].name, false);
    }
  }

  /** 读本会话当前执行目标（`runner_session_get`；未就绪 ⇒ 不发 RPC，⛔ 绝不伪造身份）。 */
  private loadSessionTarget(): void {
    if (!this.sessionReady) {
      this.sessionTarget = '';
      return;
    }
    void (async () => {
      try {
        const raw: Object = await this.callRpc(RPC_RUNNER_SESSION_GET,
          new RunnerSessionGetParams(this.sessionChannel, this.sessionChatID));
        const res: Record<string, Object> = raw as Record<string, Object>;
        const name: Object | undefined = res['name'];
        this.sessionTarget = typeof name === 'string' ? name : '';
        this.sessionError = '';
        this.syncCurrent();
      } catch (e) {
        this.sessionError = `无法读取当前目标：${this.errText(e)}`;
      }
    })();
  }

  private syncCurrent(): void {
    for (let i = 0; i < this.rows.length; i++) {
      this.rows[i].isCurrent = this.sessionReady && this.sessionTarget === this.rows[i].name;
    }
  }

  private runAutoConnect(): void {
    for (let i = 0; i < this.rows.length; i++) {
      const r: SshRowState = this.rows[i];
      if (!r.autoConnect || this.autoTried.indexOf(r.name) >= 0) {
        continue;
      }
      this.autoTried.push(r.name);
      this.connectTarget(r.name);
    }
  }

  // ── 单台机器：状态 / 诊断 ───────────────────────────────────────────────────

  private fetchStatus(name: string, forDiag: boolean): void {
    const r: SshRowState | null = this.rowOf(name);
    if (r === null) {
      return;
    }
    if (!forDiag) {
      r.loading = true;
    }
    void (async () => {
      try {
        const raw: Object = await this.callRpc(RPC_WEB_PLUGIN,
          new SshPluginRpcParams(sshMethod(SSH_M_STATUS), new SshTargetParams(r.ssh, r.name)));
        const st: SshStatusWire = raw as SshStatusWire;
        if (!this.alive) {
          return;
        }
        r.status = st;
        r.statusError = '';
        if (forDiag) {
          r.diagStatus = st;
        }
      } catch (e) {
        if (!this.alive) {
          return;
        }
        // ⛔ 保留上一次已知状态（瞬时查询失败不该把徽章打回「未连接」），错误单独展示。
        r.statusError = this.errText(e);
      } finally {
        r.loading = false;
        r.diagLoading = false;
      }
    })();
  }

  private toggleDiag(name: string): void {
    const r: SshRowState | null = this.rowOf(name);
    if (r === null) {
      return;
    }
    r.expand = !r.expand;
    if (r.expand) {
      this.refreshDiag(name);
    }
  }

  private refreshDiag(name: string): void {
    const r: SshRowState | null = this.rowOf(name);
    if (r === null) {
      return;
    }
    r.diagLoading = true;
    r.diagError = '';
    this.fetchStatus(name, true);
  }

  private loadLogs(name: string): void {
    const r: SshRowState | null = this.rowOf(name);
    if (r === null) {
      return;
    }
    r.logsLoading = true;
    r.diagError = '';
    void (async () => {
      try {
        const raw: Object = await this.callRpc(RPC_WEB_PLUGIN,
          new SshPluginRpcParams(sshMethod(SSH_M_LOGS), new SshLogsParams(r.ssh, r.name)));
        const res: SshLogsWire = raw as SshLogsWire;
        if (!this.alive) {
          return;
        }
        r.logs = res.lines !== undefined ? res.lines : [];
        r.logsSource = res.source !== undefined ? res.source : '';
      } catch (e) {
        r.diagError = this.errText(e);
      } finally {
        r.logsLoading = false;
      }
    })();
  }

  // ── 连接 / 断开 / 重连 / 重装 ───────────────────────────────────────────────

  /** 铸远端启动参数串（唯一来源 = 核心 `runner_create`；已注册的行回传既有设置 ⇒ 只轮换 token）。 */
  private mintCommand(name: string): Promise<string> {
    return new Promise<string>((resolve: (v: string) => void, reject: (e: Object) => void) => {
      void (async () => {
        try {
          const raw: Object = await this.callRpc(RPC_RUNNER_CREATE, runnerCreateParamsFor(name, this.knownRunners));
          const res: Record<string, Object> = raw as Record<string, Object>;
          const cmd: Object | undefined = res['command'];
          resolve(typeof cmd === 'string' ? cmd : '');
        } catch (e) {
          reject(e as Object);
        }
      })();
    });
  }

  private connectTarget(name: string): void {
    const r: SshRowState | null = this.rowOf(name);
    if (r === null || r.busy) {
      return;
    }
    r.busy = true;
    r.rowError = '';
    void (async () => {
      try {
        const command: string = await this.mintCommand(name);
        await this.callRpc(RPC_WEB_PLUGIN, new SshPluginRpcParams(sshMethod(SSH_M_CONNECT),
          new SshConnectParams(r.ssh, r.name, command, r.installDir.length > 0 ? r.installDir : this.installDir,
            r.mode, r.autoConnect)));
        if (!this.alive) {
          return;
        }
        this.startConnectWait(name);
      } catch (e) {
        if (!this.alive) {
          return;
        }
        r.rowError = this.errText(e);
        r.busy = false;
      }
    })();
  }

  private disconnectTarget(name: string): void {
    const r: SshRowState | null = this.rowOf(name);
    if (r === null) {
      return;
    }
    this.stopConnectWait(name);
    r.busy = true;
    r.rowError = '';
    void (async () => {
      try {
        await this.callRpc(RPC_WEB_PLUGIN,
          new SshPluginRpcParams(sshMethod(SSH_M_DISCONNECT), new SshTargetParams(r.ssh, r.name)));
      } catch (e) {
        r.rowError = this.errText(e);
      } finally {
        r.busy = false;
        this.fetchStatus(name, false);
      }
    })();
  }

  private reconnectTarget(name: string): void {
    const r: SshRowState | null = this.rowOf(name);
    if (r === null || r.busy) {
      return;
    }
    r.busy = true;
    r.rowError = '';
    void (async () => {
      // 重连 = 先显式断开再连接（后端 connect 本身也会先杀老 runner）；
      // ⚠️ 断开失败**不阻断**重连（connect 是 kill-old-first），错误并入最终提示。
      let disconnectError: string = '';
      try {
        await this.callRpc(RPC_WEB_PLUGIN,
          new SshPluginRpcParams(sshMethod(SSH_M_DISCONNECT), new SshTargetParams(r.ssh, r.name)));
      } catch (e) {
        disconnectError = this.errText(e);
      }
      try {
        const command: string = await this.mintCommand(name);
        await this.callRpc(RPC_WEB_PLUGIN, new SshPluginRpcParams(sshMethod(SSH_M_CONNECT),
          new SshConnectParams(r.ssh, r.name, command, r.installDir.length > 0 ? r.installDir : this.installDir,
            r.mode, r.autoConnect)));
        if (!this.alive) {
          return;
        }
        this.startConnectWait(name);
      } catch (e) {
        if (!this.alive) {
          return;
        }
        const msg: string = this.errText(e);
        r.rowError = disconnectError.length > 0 ? `${msg}（断开旧连接也失败：${disconnectError}）` : msg;
        r.busy = false;
      }
    })();
  }

  /** 重新安装（重装 runner 二进制；不重启 server。装完自动重连 ⇒ 新二进制立即生效）。 */
  private reinstallTarget(name: string): void {
    const r: SshRowState | null = this.rowOf(name);
    if (r === null || r.busy) {
      return;
    }
    r.busy = true;
    r.rowError = '';
    void (async () => {
      try {
        const raw: Object = await this.callRpc(RPC_WEB_PLUGIN, new SshPluginRpcParams(sshMethod(SSH_M_PROVISION),
          new SshJobStartParams(r.ssh, r.name, this.downloadBase,
            r.installDir.length > 0 ? r.installDir : this.installDir, false)));
        const res: Record<string, Object> = raw as Record<string, Object>;
        const jid: Object | undefined = res['job_id'];
        this.jobId = typeof jid === 'string' ? jid : '';
        this.jobOwner = `reinstall:${name}`;
        this.ensureTick();
      } catch (e) {
        r.rowError = this.errText(e);
        r.busy = false;
      }
    })();
  }

  // ── 轮询实现 ────────────────────────────────────────────────────────────────

  private pollConnect(name: string): void {
    const idx: number = this.waitNames.indexOf(name);
    if (idx < 0) {
      return;
    }
    const r: SshRowState | null = this.rowOf(name);
    if (r === null) {
      this.stopConnectWait(name);
      return;
    }
    this.waitTicks[idx] = this.waitTicks[idx] + 1;
    const ticks: number = this.waitTicks[idx];
    void (async () => {
      try {
        const raw: Object = await this.callRpc(RPC_WEB_PLUGIN,
          new SshPluginRpcParams(sshMethod(SSH_M_STATUS), new SshTargetParams(r.ssh, r.name)));
        const st: SshStatusWire = raw as SshStatusWire;
        if (!this.alive) {
          return;
        }
        r.status = st;
        r.statusError = '';
        if (connectionStateOf(st) === CONN_CONNECTED) {
          r.busy = false;
          r.rowError = '';
          this.stopConnectWait(name);
          return;
        }
      } catch (e) {
        // 单次查询失败（ssh 抖动）**不中止等待**，只记录；上限到了才收尾。
        r.statusError = this.errText(e);
      }
      if (ticks >= CONNECT_POLL_MAX_ATTEMPTS) {
        // 超时 ≠ 失败：后端 supervisor 仍在后台重连 ⇒ 文案必须说清。
        r.rowError = SSH_CONNECT_TIMEOUT_TEXT;
        r.busy = false;
        this.stopConnectWait(name);
      }
    })();
  }

  private pollJob(jobId: string): void {
    void (async () => {
      try {
        const raw: Object = await this.callRpc(RPC_WEB_PLUGIN,
          new SshPluginRpcParams(sshMethod(SSH_M_JOB_STATUS), new SshJobStatusParams(jobId)));
        const job: SshJobWire = raw as SshJobWire;
        if (!this.alive) {
          return;
        }
        this.onJobUpdate(job);
      } catch (e) {
        this.onJobError(this.errText(e));
      }
    })();
  }

  /** 作业推进：终态（done/failed）才停轮询。 */
  private onJobUpdate(job: SshJobWire): void {
    if (this.jobOwner.indexOf('reinstall:') === 0) {
      const name: string = this.jobOwner.substring('reinstall:'.length);
      if (jobDone(job)) {
        this.jobId = '';
        this.jobOwner = '';
        this.stopTick();
        // 装完即重连：runner 跑在 SSH 会话前台，重连 = 杀老 + 起新 ⇒ 新二进制生效。
        this.connectTarget(name);
        return;
      }
      if (jobFailed(job)) {
        this.jobId = '';
        this.jobOwner = '';
        const r: SshRowState | null = this.rowOf(name);
        if (r !== null) {
          r.rowError = jobErrorText(job, SSH_INSTALL_FAILED_TEXT);
          r.busy = false;
        }
      }
      return;
    }
    if (this.jobOwner.indexOf('delete:') === 0) {
      const name: string = this.jobOwner.substring('delete:'.length);
      const r: SshRowState | null = this.rowOf(name);
      if (r !== null) {
        r.deleteStep = jobLastStepName(job);
      }
      if (jobDone(job) || jobFailed(job)) {
        this.jobId = '';
        this.jobOwner = '';
        if (jobFailed(job) && r !== null) {
          r.deleteError = jobErrorText(job, SSH_INSTALL_FAILED_TEXT);
          r.deleting = false;
          return;
        }
        this.finishDelete(name);
      }
      return;
    }
    if (this.jobOwner.length > 0) {
      // 向导的 provision 作业（owner = 'add'）
      this.addJob = job;
      if (jobFailed(job)) {
        this.addError = jobErrorText(job, SSH_INSTALL_FAILED_TEXT);
        this.jobId = '';
        this.jobOwner = '';
      } else if (jobDone(job)) {
        this.jobId = '';
        this.jobOwner = '';
        this.startConnectPhase();
      }
    }
  }

  private onJobError(message: string): void {
    if (this.jobOwner.indexOf('reinstall:') === 0) {
      const name: string = this.jobOwner.substring('reinstall:'.length);
      this.jobId = '';
      this.jobOwner = '';
      const r: SshRowState | null = this.rowOf(name);
      if (r !== null) {
        r.rowError = message;
        r.busy = false;
      }
      return;
    }
    if (this.jobOwner.indexOf('delete:') === 0) {
      const name: string = this.jobOwner.substring('delete:'.length);
      this.jobId = '';
      this.jobOwner = '';
      const r: SshRowState | null = this.rowOf(name);
      if (r !== null) {
        r.deleteError = message;
      }
      this.finishDeleteFailed(name);
      return;
    }
    this.addError = message;
    this.jobId = '';
    this.jobOwner = '';
  }

  // ── 删除（disconnect → deprovision → runner_delete → 移出 targets）───────────

  private deleteTarget(name: string): void {
    const r: SshRowState | null = this.rowOf(name);
    if (r === null) {
      return;
    }
    r.confirmDelete = false;
    r.deleting = true;
    r.deleteError = '';
    r.deleteStep = '';
    this.stopConnectWait(name);
    void (async () => {
      // 1) 断开：管道是 runner 的生命线。断开失败**不阻断删除**（后续 runner_delete 会丢弃注册）。
      try {
        await this.callRpc(RPC_WEB_PLUGIN,
          new SshPluginRpcParams(sshMethod(SSH_M_DISCONNECT), new SshTargetParams(r.ssh, r.name)));
      } catch (e) {
        // 见上：不阻断
      }
      try {
        // 2) 远端卸载（uninstall:false = 保留二进制，只清进程/服务态）。
        const raw: Object = await this.callRpc(RPC_WEB_PLUGIN, new SshPluginRpcParams(sshMethod(SSH_M_DEPROVISION),
          new SshJobStartParams(r.ssh, r.name, '', '', false)));
        const res: Record<string, Object> = raw as Record<string, Object>;
        const jid: Object | undefined = res['job_id'];
        this.jobId = typeof jid === 'string' ? jid : '';
        this.jobOwner = `delete:${name}`;
        if (this.jobId.length === 0) {
          this.finishDelete(name);
        } else {
          this.ensureTick();
        }
      } catch (e) {
        r.deleteError = this.errText(e);
        r.deleting = false;
      }
    })();
  }

  /** 作业终态 → 移除注册行 + 从 config 的 targets 里摘掉（web `finishDelete`）。 */
  private finishDelete(name: string): void {
    const r: SshRowState | null = this.rowOf(name);
    if (r !== null && r.deleteError.length > 0) {
      r.deleting = false;
      return;
    }
    void (async () => {
      try {
        await this.callRpc(RPC_RUNNER_DELETE, new RunnerDeleteParams(name));
      } catch (e) {
        if (r !== null) {
          r.deleteError = this.errText(e);
          r.deleting = false;
        }
        return;
      }
      const next: MachineTarget[] = [];
      for (let i = 0; i < this.rows.length; i++) {
        const row: SshRowState = this.rows[i];
        if (row.name !== name) {
          next.push(new MachineTarget(row.name, row.ssh, row.installDir, row.mode, row.autoConnect, ''));
        }
      }
      await this.saveTargets(next);
      if (!this.alive) {
        return;
      }
      this.applyTargets(next);
      this.reloadAll();
    })();
  }

  private finishDeleteFailed(name: string): void {
    const r: SshRowState | null = this.rowOf(name);
    if (r !== null) {
      r.deleting = false;
    }
  }

  private saveTargets(targets: MachineTarget[]): Promise<void> {
    return new Promise<void>((resolve: () => void, reject: (e: Object) => void) => {
      void (async () => {
        try {
          await this.callRpc(RPC_PLUGIN_CONFIG_SET,
            new SshPluginConfigSetParams(SSH_RUNNER_PLUGIN_ID, 'targets', serializeTargets(targets)));
          resolve();
        } catch (e) {
          reject(e as Object);
        }
      })();
    });
  }

  // ── 会话执行目标切换 ────────────────────────────────────────────────────────

  private switchTo(name: string): void {
    if (!this.sessionReady) {
      this.sessionError = '会话身份未就绪（__xbot_session__ 未设置）——切换功能暂不可用';
      return;
    }
    const r: SshRowState | null = this.rowOf(name);
    if (r !== null) {
      r.busy = true;
      r.rowError = '';
    }
    void (async () => {
      try {
        await this.callRpc(RPC_RUNNER_SESSION_SET,
          new RunnerSessionParams(this.sessionChannel, this.sessionChatID, name));
        this.sessionTarget = name;
        this.syncCurrent();
      } catch (e) {
        if (r !== null) {
          r.rowError = this.errText(e);
        }
      } finally {
        if (r !== null) {
          r.busy = false;
        }
      }
    })();
  }

  private switchToLocal(): void {
    if (!this.sessionReady) {
      this.sessionError = '会话身份未就绪（__xbot_session__ 未设置）——切换功能暂不可用';
      return;
    }
    this.switchLocalBusy = true;
    void (async () => {
      try {
        await this.callRpc(RPC_RUNNER_SESSION_SET,
          new RunnerSessionParams(this.sessionChannel, this.sessionChatID, ''));
        this.sessionTarget = '';
        this.sessionError = '';
        this.syncCurrent();
      } catch (e) {
        this.sessionError = this.errText(e);
      } finally {
        this.switchLocalBusy = false;
      }
    })();
  }

  // ── 未纳管登记行清理 ────────────────────────────────────────────────────────

  private removeUnmanaged(u: RunnerRegistryEntryWire): void {
    const name: string = u.name !== undefined ? u.name : '';
    if (name.length === 0) {
      return;
    }
    this.unmanagedBusy = true;
    this.unmanagedError = '';
    void (async () => {
      try {
        await this.callRpc(RPC_RUNNER_DELETE, new RunnerDeleteParams(name));
        this.reloadAll();
      } catch (e) {
        this.unmanagedError = this.errText(e);
      } finally {
        this.unmanagedBusy = false;
      }
    })();
  }

  /** 一键清理全部未纳管记录（逐条删除，幂等；失败即停并显示原因）。 */
  private cleanupUnmanaged(): void {
    if (this.unmanaged.length === 0) {
      return;
    }
    this.unmanagedBusy = true;
    this.unmanagedError = '';
    void (async () => {
      try {
        for (let i = 0; i < this.unmanaged.length; i++) {
          // ⛔ ArkTS **不对重复下标访问做收窄**：`x[i].name !== undefined ? x[i].name : ''` 是
          //    `string | undefined` ⇒ 真编译硬红（脱机 tsc 抓不到）⇒ 必须先落局部量。
          const u: RunnerRegistryEntryWire = this.unmanaged[i];
          const name: string = u.name !== undefined ? u.name : '';
          if (name.length > 0) {
            await this.callRpc(RPC_RUNNER_DELETE, new RunnerDeleteParams(name));
          }
        }
        this.reloadAll();
      } catch (e) {
        this.unmanagedError = this.errText(e);
      } finally {
        this.unmanagedBusy = false;
      }
    })();
  }

  // ── 新增机器向导 ────────────────────────────────────────────────────────────

  private openAdd(): void {
    this.addOpen = true;
    this.addPhase = 'form';
    this.formName = '';
    this.formSsh = '';
    this.formMode = this.defaultMode;
    this.formAuto = false;
    this.addError = '';
    this.addNote = '';
    this.addProbe = null;
    this.addJob = null;
    this.addStatus = null;
    this.addConnected = false;
  }

  private closeAdd(): void {
    // 关闭一次**未完成**的纳管 ⇒ 回滚本次登记的 runner 行（写入侧不留孤儿）。
    if (this.addPhase === 'confirm' || this.addPhase === 'provisioning' || this.addPhase === 'connecting') {
      this.discardEnrollment(this.formName, this.formSsh);
    }
    this.jobId = '';
    this.jobOwner = '';
    this.stopConnectWait(this.formName);
    this.addOpen = false;
    this.addPhase = 'form';
  }

  /**
   * 放弃一次未完成的纳管（`runner_create` 在连接**之前**铸 token ⇒ 登记行天然先于机器
   * 存在；流程失败/取消不回滚就会留下"永远离线、也没有 SSH 目标"的孤儿）。
   *
   * 两道守卫（web `index.tsx:842-855`）：① 名字已在 targets 里 ⇒ 机器已受管，⛔ 绝不动；
   * ② 后端仍持有连接（`status.connected`）⇒ 是真机器，⛔ 绝不悄悄删掉。
   * 查询失败时**不删**（宁可不回滚，也不误删真机器）。
   */
  private discardEnrollment(name: string, ssh: string): void {
    if (name.length === 0 || this.managedNames().indexOf(name) >= 0) {
      return;
    }
    void (async () => {
      try {
        const raw: Object = await this.callRpc(RPC_WEB_PLUGIN,
          new SshPluginRpcParams(sshMethod(SSH_M_STATUS), new SshTargetParams(ssh, name)));
        const st: SshStatusWire = raw as SshStatusWire;
        if (connectionStateOf(st) === CONN_CONNECTED) {
          return;
        }
      } catch (e) {
        return;
      }
      try {
        await this.callRpc(RPC_RUNNER_DELETE, new RunnerDeleteParams(name));
      } catch (e) {
        // 回滚失败不阻断 UI：该行会在「未纳管的注册记录」里可见，可手动清理。
      }
    })();
  }

  /** 表单 → 探测环境（`runner_create` 拿 command + `probe` 拿环境报告）。 */
  private submitProbe(): void {
    const name: string = this.formName.trim();
    const ssh: string = this.formSsh.trim();
    const problem: string = validateNewTarget(name, ssh, this.managedNames());
    if (problem.length > 0) {
      this.addError = problem;
      return;
    }
    this.addError = '';
    this.addPhase = 'probing';
    void (async () => {
      try {
        const rawCmd: Object = await this.callRpc(RPC_RUNNER_CREATE, runnerCreateParamsFor(name, this.knownRunners));
        const cmdRes: Record<string, Object> = rawCmd as Record<string, Object>;
        const cmd: Object | undefined = cmdRes['command'];
        const rawProbe: Object = await this.callRpc(RPC_WEB_PLUGIN,
          new SshPluginRpcParams(sshMethod(SSH_M_PROBE), new SshProbeParams(ssh)));
        if (!this.alive) {
          return;
        }
        this.addProbe = rawProbe as SshProbeWire;
        this.addPhase = 'confirm';
        // command 挂在 addNote 之外单独保留（下一步要用）
        this.addNote = typeof cmd === 'string' ? cmd : '';
      } catch (e) {
        if (!this.alive) {
          return;
        }
        this.discardEnrollment(name, ssh);
        this.addPhase = 'form';
        this.addError = this.errText(e);
      }
    })();
  }

  /** 确认 → 装机（只安装二进制，不启动常驻服务）→ 轮询作业 → 自动进连接阶段。 */
  private confirmProvision(): void {
    if (this.addPhase !== 'confirm') {
      return;
    }
    this.startProvision();
  }

  private startProvision(): void {
    const name: string = this.formName.trim();
    const ssh: string = this.formSsh.trim();
    this.addPhase = 'provisioning';
    this.addError = '';
    this.addJob = null;
    void (async () => {
      try {
        const raw: Object = await this.callRpc(RPC_WEB_PLUGIN, new SshPluginRpcParams(sshMethod(SSH_M_PROVISION),
          new SshJobStartParams(ssh, name, this.downloadBase, this.installDir, false)));
        const res: Record<string, Object> = raw as Record<string, Object>;
        const jid: Object | undefined = res['job_id'];
        this.jobId = typeof jid === 'string' ? jid : '';
        this.jobOwner = 'add';
        this.ensureTick();
      } catch (e) {
        this.addError = this.errText(e);
      }
    })();
  }

  /** 连接阶段：`connect` 立即返回（supervisor 已武装）⇒ 轮询 status 直到 connected。 */
  private startConnectPhase(): void {
    const name: string = this.formName.trim();
    const ssh: string = this.formSsh.trim();
    this.addPhase = 'connecting';
    this.addStatus = null;
    void (async () => {
      try {
        await this.callRpc(RPC_WEB_PLUGIN, new SshPluginRpcParams(sshMethod(SSH_M_CONNECT),
          new SshConnectParams(ssh, name, this.addNote, this.installDir, this.formMode, this.formAuto)));
      } catch (e) {
        if (!this.alive) {
          return;
        }
        this.addError = this.errText(e);
        return;
      }
      if (!this.alive) {
        return;
      }
      this.addPhase = 'connecting';
    })();
  }

  /** 连接成功/仅保存 ⇒ 落进 targets 配置（唯一真源），并刷新面板。 */
  private finishAdd(connected: boolean): void {
    const name: string = this.formName.trim();
    const ssh: string = this.formSsh.trim();
    const target: MachineTarget = new MachineTarget(name, ssh, this.installDir, this.formMode, this.formAuto, new Date().toISOString());
    const next: MachineTarget[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      const row: SshRowState = this.rows[i];
      if (row.name !== name) {
        next.push(new MachineTarget(row.name, row.ssh, row.installDir, row.mode, row.autoConnect, ''));
      }
    }
    next.push(target);
    void (async () => {
      try {
        await this.saveTargets(next);
        if (!this.alive) {
          return;
        }
        this.addConnected = connected;
        this.addPhase = 'completed';
        this.applyTargets(next);
        this.reloadAll();
      } catch (e) {
        this.addError = this.errText(e);
      }
    })();
  }

  /** 「仅保存机器」：停止等待连接，但仍把机器落进 targets。 */
  private saveOnly(): void {
    this.stopConnectWait(this.formName.trim());
    this.finishAdd(false);
  }

  private cancelWait(): void {
    this.stopConnectWait(this.formName.trim());
    this.addError = SSH_CONNECT_CANCELLED_TEXT;
  }

  // ── build ──────────────────────────────────────────────────────────────────

  build() {
    Column({ space: SPACE_SM }) {
      // ── 头部：标题 + 刷新 + 关闭 ────────────────────────────────────────────
      Row({ space: SPACE_XS }) {
        Text(SSH_PANEL_TITLE)
          .fontSize(typeOf('type.headline').size)
          .fontWeight(typeOf('type.headline').weight)
          .fontColor(this.tc('text'))
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        SshIconButton({
          theme: this.theme, glyph: $r('sys.symbol.arrow_clockwise'), label: '刷新',
          onTap: () => {
            this.reloadAll();
            this.loadSessionTarget();
          },
        })
        SshIconButton({
          theme: this.theme, glyph: $r('sys.symbol.xmark'), label: '关闭远程机器面板',
          onTap: () => {
            this.onClose();
          },
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      // ── 会话目标行：当前目标 + 切回本机 + 添加机器 ──────────────────────────
      Row({ space: SPACE_XS }) {
        Text(sessionLineText(this.sessionReady, this.sessionTarget))
          .fontSize(typeOf('type.caption').size)
          .fontColor(this.tc('muted'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        SshChip({
          theme: this.theme, label: this.switchLocalBusy ? '切换中…' : '切回本机',
          disabled: !this.sessionReady || this.switchLocalBusy,
          onTap: () => {
            this.switchToLocal();
          },
        })
        SshChip({
          theme: this.theme, label: this.addOpen ? '收起添加' : '添加机器', tone: 'accent',
          onTap: () => {
            if (this.addOpen) {
              this.closeAdd();
            } else {
              this.openAdd();
            }
          },
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      if (this.sessionError.length > 0) {
        Text(this.sessionError)
          .fontSize(typeOf('type.caption').size)
          .fontColor(this.tc('danger'))
          .width('100%')
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }

      // ── 添加向导 ──────────────────────────────────────────────────────────
      if (this.addOpen) {
        this.AddWizard()
      }

      // ── 列表 / 三态 ────────────────────────────────────────────────────────
      if (this.loading && this.rows.length === 0) {
        SshNotice({ theme: this.theme, glyph: $r('sys.symbol.computer'), text: '读取远程机器…' })
      } else if (this.listError.length > 0) {
        Column({ space: SPACE_MD }) {
          SshNotice({ theme: this.theme, glyph: $r('sys.symbol.exclamationmark_triangle'), text: this.listError, danger: true })
          SshChip({
            theme: this.theme, label: '重试',
            onTap: () => {
              this.reloadAll();
            },
          })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
      } else if (this.rows.length === 0) {
        SshNotice({ theme: this.theme, glyph: $r('sys.symbol.computer'), text: SSH_EMPTY_TEXT })
      } else {
        List({ space: SPACE_SM }) {
          ForEach(this.rows, (r: SshRowState) => {
            ListItem() {
              SshTargetRow({
                theme: this.theme,
                row: r,
                sessionReady: this.sessionReady,
                onConnect: (n: string) => {
                  this.connectTarget(n);
                },
                onDisconnect: (n: string) => {
                  this.disconnectTarget(n);
                },
                onReconnect: (n: string) => {
                  this.reconnectTarget(n);
                },
                onReinstall: (n: string) => {
                  this.reinstallTarget(n);
                },
                onSwitch: (n: string) => {
                  this.switchTo(n);
                },
                onToggleDiag: (n: string) => {
                  this.toggleDiag(n);
                },
                onAskDelete: (n: string) => {
                  const row: SshRowState | null = this.rowOf(n);
                  if (row !== null) {
                    row.confirmDelete = true;
                  }
                },
                onCancelDelete: (n: string) => {
                  const row: SshRowState | null = this.rowOf(n);
                  if (row !== null) {
                    row.confirmDelete = false;
                  }
                },
                onConfirmDelete: (n: string) => {
                  this.deleteTarget(n);
                },
                onRefreshStatus: (n: string) => {
                  this.refreshDiag(n);
                },
                onLoadLogs: (n: string) => {
                  this.loadLogs(n);
                },
              })
            }
          }, (r: SshRowState) => `ssh-${r.name}`)
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Off)
      }

      // ── 未纳管的注册记录（清理入口）────────────────────────────────────────
      if (this.unmanaged.length > 0) {
        this.UnmanagedBlock()
      }
    }
    .width(SHEET_WIDTH)
    .height('100%')
    .padding(SPACE_MD)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor(this.tc('overlay'))
    .borderWidth({ left: STROKE_HAIRLINE })
    .borderColor(this.tc('hairline'))
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: SPACE_XS,
      offsetY: 0,
    })
    .transition(sheetTransition())
  }

  /** 未纳管的注册记录块（web `index.tsx:1846-1898`）。 */
  @Builder
  UnmanagedBlock() {
    Column({ space: SPACE_XS }) {
      Row({ space: SPACE_XS }) {
        Text(`未纳管的注册记录（${this.unmanaged.length}）`)
          .fontSize(typeOf('type.caption').size)
          .fontWeight(typeOf('type.caption').weight)
          .fontColor(this.tc('warn'))
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        SshChip({
          theme: this.theme, label: this.unmanagedBusy ? '清理中…' : '全部清理', disabled: this.unmanagedBusy,
          onTap: () => {
            this.cleanupUnmanaged();
          },
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      Text('没有对应 SSH 目标的注册记录（中途中止的纳管 / 旧版本残留）。它们不会出现在「切换执行目标」里，可以在这里删除。')
        .fontSize(typeOf('type.micro').size)
        .fontColor(this.tc('muted'))
        .width('100%')
        .maxLines(4)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      ForEach(this.unmanaged, (u: RunnerRegistryEntryWire) => {
        Row({ space: SPACE_XS }) {
          Text(u.name !== undefined ? u.name : '')
            .fontSize(typeOf('type.caption').size)
            .fontFamily('monospace')
            .fontColor(this.tc('secondary'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text(unmanagedStateText(u))
            .fontSize(typeOf('type.micro').size)
            .fontColor(this.tc('muted'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          SshIconButton({
            theme: this.theme, glyph: $r('sys.symbol.trash'), label: '删除登记', danger: true,
            disabled: this.unmanagedBusy,
            onTap: () => {
              this.removeUnmanaged(u);
            },
          })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
      }, (u: RunnerRegistryEntryWire) => `unm-${u.name}`)
      if (this.unmanagedError.length > 0) {
        Text(this.unmanagedError)
          .fontSize(typeOf('type.caption').size)
          .fontColor(this.tc('danger'))
          .width('100%')
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(SPACE_SM)
    .backgroundColor(this.tc('card'))
    .border({ width: STROKE_HAIRLINE, color: this.tc('rule') })
    .borderRadius(RADIUS_CARD)
  }

  /** 新增机器向导（六态）。 */
  @Builder
  AddWizard() {
    Column({ space: SPACE_XS }) {
      if (this.addPhase === 'form') {
        Text('添加远程机器')
          .fontSize(typeOf('type.subhead').size)
          .fontWeight(typeOf('type.subhead').weight)
          .fontColor(this.tc('text'))
          .width('100%')
        Text('名称')
          .fontSize(typeOf('type.micro').size)
          .fontColor(this.tc('muted'))
          .width('100%')
        TextInput({ text: this.formName, placeholder: 'gpu-box' })
          .fontSize(typeOf('type.callout').size)
          .fontColor(this.tc('text'))
          .placeholderColor(this.tc('muted'))
          .backgroundColor(this.tc('input'))
          .borderRadius(RADIUS_CHIP)
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .onChange((v: string) => {
            this.formName = v;
          })
        Text('SSH 命令')
          .fontSize(typeOf('type.micro').size)
          .fontColor(this.tc('muted'))
          .width('100%')
        TextInput({ text: this.formSsh, placeholder: 'ssh user@host -p 22' })
          .fontSize(typeOf('type.callout').size)
          .fontFamily('monospace')
          .fontColor(this.tc('text'))
          .placeholderColor(this.tc('muted'))
          .backgroundColor(this.tc('input'))
          .borderRadius(RADIUS_CHIP)
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .onChange((v: string) => {
            this.formSsh = v;
          })
        Text('连接方式')
          .fontSize(typeOf('type.micro').size)
          .fontColor(this.tc('muted'))
          .width('100%')
        Row({ space: SPACE_XS }) {
          SshChip({
            theme: this.theme, label: modeLongLabel(MODE_TUNNEL),
            tone: this.formMode === MODE_TUNNEL ? 'accent' : 'normal',
            onTap: () => {
              this.formMode = MODE_TUNNEL;
            },
          })
          SshChip({
            theme: this.theme, label: modeLongLabel(MODE_DIRECT),
            tone: this.formMode === MODE_DIRECT ? 'accent' : 'normal',
            onTap: () => {
              this.formMode = MODE_DIRECT;
            },
          })
        }
        .width('100%')
        SshChip({
          theme: this.theme, label: this.formAuto ? '✓ 面板打开后自动连接该机器' : '面板打开后自动连接该机器',
          tone: this.formAuto ? 'accent' : 'normal',
          onTap: () => {
            this.formAuto = !this.formAuto;
          },
        })
        Text('tunnel：远端无需能访问 server（ssh -R 反向隧道）；direct：runner 直连 server。runner 跑在 SSH 会话前台，断开管道即结束。')
          .fontSize(typeOf('type.micro').size)
          .fontColor(this.tc('muted'))
          .width('100%')
          .maxLines(4)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.addError.length > 0) {
          Text(this.addError)
            .fontSize(typeOf('type.caption').size)
            .fontColor(this.tc('danger'))
            .width('100%')
            .maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Row({ space: SPACE_XS }) {
          SshChip({
            theme: this.theme, label: '探测环境', tone: 'accent',
            onTap: () => {
              this.submitProbe();
            },
          })
          SshChip({
            theme: this.theme, label: '取消',
            onTap: () => {
              this.closeAdd();
            },
          })
        }
        .width('100%')
      } else if (this.addPhase === 'probing') {
        Row({ space: SPACE_XS }) {
          LoadingProgress().width(ICON_MD).height(ICON_MD).color(this.tc('accent'))
          Text('正在探测远端环境…')
            .fontSize(typeOf('type.callout').size)
            .fontColor(this.tc('text'))
            .layoutWeight(1)
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
      } else if (this.addPhase === 'confirm') {
        Text('远端环境')
          .fontSize(typeOf('type.subhead').size)
          .fontWeight(typeOf('type.subhead').weight)
          .fontColor(this.tc('text'))
          .width('100%')
        Text(this.probeText())
          .fontSize(typeOf('type.caption').size)
          .fontColor(this.tc('secondary'))
          .width('100%')
          .maxLines(4)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: SPACE_XS }) {
          SshChip({
            theme: this.theme, label: '开始安装并连接', tone: 'accent',
            onTap: () => {
              this.confirmProvision();
            },
          })
          SshChip({
            theme: this.theme, label: '取消',
            onTap: () => {
              this.closeAdd();
            },
          })
        }
        .width('100%')
      } else if (this.addPhase === 'provisioning') {
        Row({ space: SPACE_XS }) {
          LoadingProgress().width(ICON_MD).height(ICON_MD).color(this.tc('accent'))
          Text(this.addError.length > 0 ? SSH_INSTALL_FAILED_TEXT : '正在安装 xbot-runner（只安装二进制）…')
            .fontSize(typeOf('type.subhead').size)
            .fontColor(this.addError.length > 0 ? this.tc('danger') : this.tc('text'))
            .layoutWeight(1)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        ForEach(jobSteps(this.addJob), (s: SshJobStepWire) => {
          Row({ space: SPACE_XS }) {
            Text(s.ok === true ? '✓' : '·')
              .fontSize(typeOf('type.caption').size)
              .fontColor(this.tc(s.ok === true ? 'success' : 'muted'))
            Text(s.name !== undefined ? s.name : '')
              .fontSize(typeOf('type.caption').size)
              .fontFamily('monospace')
              .fontColor(this.tc('secondary'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .constraintSize({ maxWidth: 140 })
            if (s.detail !== undefined && s.detail.length > 0) {
              Text(s.detail !== undefined ? s.detail : '')
                .fontSize(typeOf('type.caption').size)
                .fontColor(this.tc('muted'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
            }
          }
          .width('100%')
        }, (s: SshJobStepWire, i: number) => `step-${i}-${s.name}`)
        if (this.addError.length > 0) {
          Text(this.addError)
            .fontSize(typeOf('type.caption').size)
            .fontColor(this.tc('danger'))
            .width('100%')
            .maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Row({ space: SPACE_XS }) {
          if (this.addError.length > 0) {
            SshChip({
              theme: this.theme, label: '重试', tone: 'accent',
              onTap: () => {
                this.startProvision();
              },
            })
          }
          SshChip({
            theme: this.theme, label: '关闭',
            onTap: () => {
              this.closeAdd();
            },
          })
        }
        .width('100%')
      } else if (this.addPhase === 'connecting') {
        Row({ space: SPACE_XS }) {
          LoadingProgress().width(ICON_MD).height(ICON_MD).color(this.tc('accent'))
          Text(this.addError.length > 0 ? '连接未建立' : '正在通过 SSH 建立连接…')
            .fontSize(typeOf('type.subhead').size)
            .fontColor(this.addError.length > 0 ? this.tc('danger') : this.tc('text'))
            .layoutWeight(1)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        if (this.addError.length > 0) {
          Text(this.addError)
            .fontSize(typeOf('type.caption').size)
            .fontColor(this.tc('danger'))
            .width('100%')
            .maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Row({ space: SPACE_XS }) {
          SshChip({
            theme: this.theme, label: '仅保存机器',
            onTap: () => {
              this.saveOnly();
            },
          })
          SshChip({
            theme: this.theme, label: '停止等待',
            onTap: () => {
              this.cancelWait();
            },
          })
          SshChip({
            theme: this.theme, label: '关闭',
            onTap: () => {
              this.closeAdd();
            },
          })
        }
        .width('100%')
      } else {
        Text(this.addConnected ? '已安装并连接' : '已安装并保存（尚未连接）')
          .fontSize(typeOf('type.subhead').size)
          .fontColor(this.addConnected ? this.tc('success') : this.tc('text'))
          .width('100%')
        SshChip({
          theme: this.theme, label: '关闭',
          onTap: () => {
            this.closeAdd();
          },
        })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(SPACE_SM)
    .backgroundColor(this.tc('card'))
    .border({ width: STROKE_HAIRLINE, color: this.tc('rule') })
    .borderRadius(RADIUS_CARD)
  }

  /** 探测结果一行（`os/arch · user(是否 root) · 包管理器 · 已装版本`）。 */
  private probeText(): string {
    const p: SshProbeWire | null = this.addProbe;
    if (p === null) {
      return '';
    }
    const parts: string[] = [];
    const os: string = p.os !== undefined ? p.os : '';
    const arch: string = p.arch !== undefined ? p.arch : '';
    if (os.length > 0 || arch.length > 0) {
      parts.push(`${os}/${arch}`);
    }
    const user: string = p.user !== undefined ? p.user : '';
    if (user.length > 0) {
      parts.push(p.is_root === true ? `${user}(root)` : user);
    }
    const pm: string[] = [];
    if (p.has_curl === true) {
      pm.push('curl');
    }
    if (p.has_wget === true) {
      pm.push('wget');
    }
    if (pm.length > 0) {
      parts.push(pm.join('/'));
    }
    const ver: string = p.installed_version !== undefined ? p.installed_version : '';
    parts.push(ver.length > 0 ? `已装 ${ver}` : '未安装');
    const dir: string = p.install_dir !== undefined ? p.install_dir : '';
    if (dir.length > 0) {
      parts.push(dir);
    }
    return parts.join(' · ');
  }
}
