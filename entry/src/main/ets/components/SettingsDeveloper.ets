/**
 * SettingsDeveloper —— 设置 → 开发者（**SSE 录制 + 连接状态**面板）。
 *
 * 对齐 web `src/components/settings/SettingsDeveloper.tsx:20-40`（分区「Developer」+ 开发者工具开关）
 * 与 `src/workspace/panels/DebugToolbar.tsx:20-73`（REC 录制），并叠加 **原生增强**（见下）。
 *
 * ── 权威基准语义（取证）────────────────────────────────────────────────────────
 *   · 开关 = 开发者模式，**默认关**、**本地持久化**（web `useDeveloperMode.ts:3-9` 用 localStorage
 *     的 `xbot:developer-mode`；原生等价物 = 本组件用 preferences 写 `xbot_devtools/developer-mode`，
 *     同样**不同步服务端** —— 这是开发者本机偏好，不是用户功能面设置）；
 *   · 开关打开 ⇒ 记录所有 SSE 事件（web `useSSERecorder.ts:43-50` 注册 onMessage）；
 *   · 上限 / 脱敏：web **没有**（其 eventsRef 无界增长、不做脱敏）。原生**主动加固**：
 *     512 条 / 512KiB 有界（`core/sserec.ets`）+ 凭据脱敏（安全红线）。
 *
 * ── 原生增强（web 没有，明确标注）──────────────────────────────────────────────
 *   ① **SSE 连接状态卡**：状态 / 请求协议 / 上次错误码 / 上次响应码 /
 *      重连次数 / 已收事件数 / 连接尝试数 —— 正是本次排障（HTTP/3 崩溃 `errCode:2300023`）
 *      要一眼看清的量（web 的 DebugToolbar 只显示录制条数）；
 *   ② **一键复制**（把 `toJson()` 复制到剪贴板，便于贴进 issue）；
 *   ③ **清空**。
 *
 * ⛔ 录制器是 `core/sserec.ets` 的**全局单例** `sseRecorder`（与真实 SSE 通路同一实例）。
 * ⛔ 刷新用 `setInterval` 拉取（录制器在 UI 响应式系统之外变更）—— 面板销毁必须 `clearInterval`。
 * ⛔ 有界 @State（不把整份 entries 塞进 @State，只存"要渲染的快照"）。
 */
import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { preferences } from '@kit.ArkData';
import { pasteboard } from '@kit.BasicServicesKit';
import { webview } from '@kit.ArkWeb';
import { Palette, paletteOf } from '../core/theme';
import { CLEAR_STEP_WEB_CACHE, CLEAR_STEP_WEB_DATA, ClearCacheResult, ClearFailure } from '../core/cacheclear';
import { canonicalChatId, sessionDisplayKey } from '../core/sessionpick';
import { FS_CAPTION, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import { SSEE_MAX_BYTES, SSEE_MAX_ENTRIES, SseRecEntry, sseRecorder } from '../core/sserec';
import { XbotHttp } from '../core/http';
import { LiveViewBridge } from './LiveViewBridge';
import {
  ExportAction, ExportClock, demoRecordsFrom, exportActionFilename, exportActions, exportedSessionFrom,
  renderExportText, toBenchmarkJsonl,
} from '../core/export';
import {
  RPC_EXPORT_SESSION, RPC_EXPORT_SESSION_JSONL, SessionSelectorParams, readableRpcError, rpc,
} from '../core/rpc';
import { colorOf, HIT_TARGET_MIN, PRESS_OPACITY, SPACE_SM, typeOf } from '../core/design';
import { SettingsPanelHeader, SettingsToolRow, SettingsButton } from './SettingsRows';
import { animBase } from './anim';
import { t as i18nT } from '../core/i18n';

/** 本地偏好（**不同步服务端**；对齐 web 的 localStorage 语义）。 */
const DEV_STORE: string = 'xbot_devtools';
const DEV_KEY: string = 'developer-mode';
/** 面板刷新周期（ms）—— 1s 足够跟手，又不至于让设置页常驻高开销。 */
const REFRESH_MS: number = 1000;
/** 列表最多展示的最近条数（渲染上限，与控制台上限解耦）。 */
const LIST_LIMIT: number = 60;

/** 连接状态 → 中文（未知值原样透传，不吞信息）。 */
export function devStateLabel(state: string): string {
  if (state === 'idle') {
    return '未连接';
  }
  if (state === 'connecting') {
    return '连接中';
  }
  if (state === 'open') {
    return '已连接';
  }
  if (state === 'reconnecting') {
    return '重连中';
  }
  if (state === 'failed') {
    return '连接失败（终态）';
  }
  return state;
}

/** 字节 → 人类可读（KiB 起）。 */
export function fmtBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  return `${(n / 1024).toFixed(1)} KiB`;
}

/** 时刻 → HH:MM:SS（非法/0 ⇒ `—`）。 */
export function fmtClock(ms: number): string {
  if (ms <= 0) {
    return '—';
  }
  const d: Date = new Date(ms);
  const p2 = (x: number): string => (x < 10 ? `0${x}` : `${x}`);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** 载荷单行预览（折叠换行 + 截断；脱敏已在录制器内完成）。 */
export function previewText(s: string, max: number): string {
  const flat: string = s.replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.substring(0, max)}…` : flat;
}

@Component
export struct SettingsDeveloper {
  /** 迭代号标记开关（默认关；`@StorageProp` ⇒ 与 `IterBlocksView` 共享同一真源）。 */
  @StorageProp('xbotIterBadge') iterBadgeOn: boolean = false;
  // 语言切换订阅：所有存量组件实例在 setLocale 后自行 rebuild（@StorageProp 组件级订阅，
  // 不依赖父级 ForEach/LazyForEach 重投递）。
  @StorageProp('appLocale') @Watch('onLocaleStamp') localeStamp: string = '';
  /** 语言切换 -> @State 变化，强制本组件 build（@StorageProp 未在 build 直接读取时也能重渲）。 */
  @State private localeRev: number = 0;
  private onLocaleStamp(): void {
    this.localeRev++;
  }
  @Prop theme: string = 'dark';
  /** HTTP 客户端（由页面经 `SettingsPanel` 注入 `store.http`）—— 导出会话要用它发 RPC。 */
  http: XbotHttp = new XbotHttp('');
  /** 当前会话的渠道（`store.channel`）。空 ⇒ 无活动会话 ⇒ 导出按钮禁用。 */
  @Prop channel: string = '';
  /** 当前会话 id（`store.currentChatId`）。 */
  @Prop chatID: string = '';
  /**
   * 打开「应用日志」面板（由页面经 `SettingsPanel` 注入）。
   *
   * ⛔ 用户 2026-10-16 要求：应用日志是**纯 debug 功能**，不该占侧边栏主导航的显眼位置
   *   （原实现把它与"设置/文件/终端"同排）⇒ 收进本分区（设置 → 开发者）作二级入口。
   */
  onOpenLog: () => void = () => {};

  @State private devEnabled: boolean = false;
  @State private rows: SseRecEntry[] = [];
  @State private connState: string = 'idle';
  @State private connHttpVer: string = '';
  @State private connErr: number = 0;
  @State private connResp: number = 0;
  @State private connReconnects: number = 0;
  @State private connFrames: number = 0;
  @State private connAttempts: number = 0;
  @State private recCount: number = 0;
  @State private recBytes: number = 0;
  @State private copyNote: string = '';
  /** 正在导出的动作 id（空 = 空闲）——用于按钮禁用与文案。 */
  @State private exportBusy: string = '';
  /** 导出成功提示（**含落盘绝对路径**，供真机 `hdc file recv` 核对）。 */
  @State private exportNote: string = '';
  /** 导出失败原因（可读）。 */
  @State private exportErr: string = '';

  /** 「清除缓存」反馈（`core/cacheclear.ets` 三态聚合；空串 ⇒ 隐藏，⛔ 组件不自己拼串）。 */
  @State private cacheOk: boolean = true;
  @State private cacheNote: string = '';
  @State private cacheDetail: string = '';

  private store: preferences.Preferences | null = null;
  private timer: number = -1;

  aboutToAppear(): void {
    this.devEnabled = this.readPersisted();
    sseRecorder.setEnabled(this.devEnabled);
    this.refresh();
    this.timer = setInterval(() => {
      this.refresh();
    }, REFRESH_MS);
  }

  aboutToDisappear(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private prefsStore(): preferences.Preferences | null {
    if (this.store !== null) {
      return this.store;
    }
    try {
      const ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
      const opt: preferences.Options = { name: DEV_STORE };
      this.store = preferences.getPreferencesSync(ctx, opt);
    } catch (e) {
      this.store = null; // 偏好不可用 ⇒ 退化为"仅内存"（不影响本次会话录制）
    }
    return this.store;
  }

  private readPersisted(): boolean {
    const s: preferences.Preferences | null = this.prefsStore();
    if (s === null) {
      return false; // 读不到 ⇒ 默认关（web 同款：默认 OFF）
    }
    try {
      const v: string = s.getSync(DEV_KEY, '') as string;
      return v === '1';
    } catch (e) {
      return false;
    }
  }

  private persist(on: boolean): void {
    const s: preferences.Preferences | null = this.prefsStore();
    if (s === null) {
      return;
    }
    try {
      s.putSync(DEV_KEY, on ? '1' : '0');
      s.flush();
    } catch (e) {
      // 写盘失败不影响本次会话（仅丢掉"下次冷启动仍开"）
    }
  }

  private refresh(): void {
    this.connState = sseRecorder.status.state;
    this.connHttpVer = sseRecorder.status.httpVer;
    this.connErr = sseRecorder.status.lastErrCode;
    this.connResp = sseRecorder.status.lastRespCode;
    this.connReconnects = sseRecorder.status.reconnectCount;
    this.connFrames = sseRecorder.status.frameCount;
    this.connAttempts = sseRecorder.status.attemptCount;
    this.recCount = sseRecorder.count();
    this.recBytes = sseRecorder.totalBytes();
    // 最近 N 条、**最新在前**（排障先看最新）
    const tail: SseRecEntry[] = sseRecorder.recent(LIST_LIMIT);
    const rev: SseRecEntry[] = [];
    for (let i = tail.length - 1; i >= 0; i--) {
      rev.push(tail[i]);
    }
    this.rows = rev;
  }

  private onToggleDev(isOn: boolean): void {
    this.devEnabled = isOn;
    sseRecorder.setEnabled(isOn);
    this.persist(isOn);
    this.refresh();
  }

  private clearRec(): void {
    sseRecorder.clear();
    this.copyNote = '';
    this.refresh();
  }

  /**
   * 清除 WebView 缓存与网页数据（对齐 web `SettingsGeneral.tsx:34-37` 的 clearCache；
   * web「内存态复位」差集见 `core/cacheclear.ets` 头注——原生无对应缓存层）。
   *
   * 两步独立 try-catch（一步失败不阻断另一步）；三态反馈从 `core/cacheclear.ets`
   * 聚合（判据与渲染同源，⛔ 组件不拼字符串）。⛔ 不动 Cookie（插件面板登录态）
   * 与 preferences（主题 / 本分区开发者开关）。
   */
  private clearCaches(): void {
    const failures: ClearFailure[] = [];
    try {
      webview.WebStorage.deleteAllData();
    } catch (e) {
      failures.push(new ClearFailure(CLEAR_STEP_WEB_DATA, `${(e as Error).message}`));
    }
    try {
      webview.WebviewController.removeAllCache(true);
    } catch (e) {
      failures.push(new ClearFailure(CLEAR_STEP_WEB_CACHE, `${(e as Error).message}`));
    }
    const res: ClearCacheResult = new ClearCacheResult(failures);
    this.cacheOk = res.ok;
    this.cacheNote = res.note;
    this.cacheDetail = res.detail;
  }

  private copyRec(): void {
    const json: string = sseRecorder.toJson();
    try {
      const data: pasteboard.PasteData =
        pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, json);
      pasteboard.getSystemPasteboard().setData(data);
      this.copyNote = `已复制 ${this.recCount} 条（${fmtBytes(this.recBytes)}）`;
    } catch (e) {
      this.copyNote = '复制失败';
    }
  }

  /**
   * 导出当前会话（**唯一入口**；具体形态由 `core/export.exportActions()` 决定）。
   *
   * 链路（对齐 web `agent/api.ts:378-582`）：
   *   ① benchmark ⇒ 专用 RPC `export_session_jsonl` → `toBenchmarkJsonl`；
   *   ② 其余 ⇒ `export_session` → `exportedSessionFrom` → `renderExportText`（native/multica/turn-iter 分派）。
   * 落盘 = **应用沙箱可写目录**（`context.filesDir`），并把**绝对路径**回显 —— 便于真机 `hdc file recv` 核对。
   * ⛔ 失败给可读原因、⛔ 绝不"点了没反应"。
   */
  private async exportOne(a: ExportAction): Promise<void> {
    if (this.exportBusy.length > 0) {
      return;
    }
    if (this.chatID.length === 0) {
      this.exportErr = '没有打开的会话（先进入一个会话再导出）。';
      this.exportNote = '';
      return;
    }
    this.exportBusy = a.id;
    this.exportNote = '';
    this.exportErr = '';
    try {
      // ⛔ 出网 id 必须**规范化**（裸 id）——见 `core/sessionpick.canonicalChatId` 的长注释：
      //   服务端把会话键组装成 `channel + ":" + chat_id`，本仓 `chatID` 来自会话树（带前缀）
      //   ⇒ 直接传会变成 `web:web:chat_…`（导出落到幽灵会话）。
      const params: SessionSelectorParams = new SessionSelectorParams(this.channel, canonicalChatId(this.channel, this.chatID));
      let text: string;
      if (a.viaJsonlRpc) {
        const raw: Object = await rpc<Object>(this.http, RPC_EXPORT_SESSION_JSONL, params);
        text = toBenchmarkJsonl(demoRecordsFrom(raw));
      } else {
        const raw: Object = await rpc<Object>(this.http, RPC_EXPORT_SESSION, params);
        const clock: ExportClock = new ExportClock(new Date().toISOString(), Date.now());
        text = renderExportText(a.format, exportedSessionFrom(raw), this.channel, this.chatID,
          clock.nowIso, clock);
      }
      const path: string = this.writeExport(exportActionFilename(a, this.chatID), text);
      this.exportNote = `已导出 → ${path}`;
    } catch (e) {
      this.exportErr = readableRpcError((e as Error).message);
    } finally {
      this.exportBusy = '';
    }
  }

  /** 把文本写进应用沙箱（`filesDir`）；返回**绝对路径**。⛔ 文件系统错误向外抛（由调用方转可读原因）。 */
  private writeExport(name: string, text: string): string {
    const ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
    const path: string = `${ctx.filesDir}/${name}`;
    const f: fileIo.File = fileIo.openSync(path,
      fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
    try {
      fileIo.writeSync(f.fd, text);
    } finally {
      fileIo.closeSync(f);
    }
    return path;
  }

  @Builder
  /**
   * 实况窗（Live View Kit）**自检 + 一键测试**。
   *
   * 为什么放这里：实况窗能不能用由**系统侧**决定（应用实况窗权益 / 调试白名单设备 / 系统开关
   * 「设置 > 通知与状态栏 > 实况窗 > 本 App」），**不是代码能保证的** ⇒ 给一条自证路径：
   * 点「测试」就起一条演示实况窗（看状态栏胶囊），失败原因同时落**应用日志**（tag `liveview`）。
   */
  @Builder
  LiveViewSection() {
    Column({ space: SP_2 }) {
      Row({ space: SP_2 }) {
        SymbolGlyph($r('sys.symbol.rectangle_on_rectangle'))
          .fontSize(18)
          .fontColor([this.pal().textSecondary])
        Column({ space: 2 }) {
          Text(i18nT('实况窗（Live View）'))
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textPrimary)
          // 能力判定读桥接层（探测结果缓存；进入本页时刷新一次，之后每次重渲都取最新）
          Text(`系统开关：${LiveViewBridge.shared().capText()} · 失败原因见「应用日志」tag liveview`)
            .fontSize(10)
            .fontColor(this.pal().textMuted)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      Row({ space: SP_2 }) {
        Row() {
          Text(i18nT('测试实况窗'))
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textPrimary)
        }
          .padding({ left: SP_3, right: SP_3 })
          .height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center)
          .borderRadius(R_MD)
          .backgroundColor(this.pal().surfaceAlt)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            LiveViewBridge.shared().testStart();
          })
        Row() {
          Text(i18nT('结束'))
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textPrimary)
        }
          .padding({ left: SP_3, right: SP_3 })
          .height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center)
          .borderRadius(R_MD)
          .backgroundColor(this.pal().surfaceAlt)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            LiveViewBridge.shared().testStop();
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  ExportSection() {
    Column({ space: SP_2 }) {
      Text(i18nT('导出会话'))
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textPrimary)
        .width('100%')
      Text(this.chatID.length > 0 ? `当前会话：${sessionDisplayKey(this.channel, this.chatID)}` : i18nT('未打开会话（导出按钮禁用）。'))
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textMuted)
        .width('100%')

      ForEach(exportActions(), (a: ExportAction) => {
        Row({ space: SP_2 }) {
          Button(this.exportBusy === a.id ? '导出中…' : a.title)
            .fontSize(FS_CAPTION)
            // ⚡ 2026-10-20 丝滑动画：可用态切换时文字/背景颜色缓动
            .animation(animBase())
            .fontColor(this.chatID.length > 0 ? this.pal().onAccent : this.pal().textMuted)
            .backgroundColor(this.chatID.length > 0 ? this.pal().accent : this.pal().surfaceAlt)
            .borderRadius(R_MD)
            // ⛔ 命中区 ≥ 44（Apple HIG）：32 低于阈值（审计命中）；
            //    文字按钮在 Row(space:SP_2) 里**不宜 responseRegion 外扩**（会与兄弟重叠 ⇒ 误触）。
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .enabled(this.chatID.length > 0 && this.exportBusy.length === 0)
            .onClick(() => {
              void this.exportOne(a);
            })
          Text(a.desc)
            .fontSize(10)
            .fontColor(this.pal().textMuted)
            .layoutWeight(1)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
      }, (a: ExportAction) => `exp-${a.id}`)

      if (this.exportNote.length > 0) {
        Text(this.exportNote)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().successText)
          .width('100%')
      }
      if (this.exportErr.length > 0) {
        Text(`导出失败：${this.exportErr}`)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().dangerText)
          .width('100%')
      }
    }
    .width('100%')
    .padding(SP_3)
    .backgroundColor(this.pal().surface)
    .borderRadius(R_LG)
    .border({ width: 1, color: this.pal().border })
    .alignItems(HorizontalAlign.Start)
  }

  /**
   * 「清除缓存」卡（web 在 General 分区；原生无 General ⇒ 维护类聚合进本分区，
   * 差集登记 `docs/WEB-PARITY.md`）。底/字色跟随仓内危险组合先例
   * （`SyntheticCard` / `SettingsWebUsers`：`dangerBg` + `dangerText`），⛔ 不自造色彩对。
   */
  @Builder
  CacheSection() {
    Column({ space: SP_2 }) {
      Text(i18nT('缓存'))
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textPrimary)
        .width('100%')
      Text(i18nT('清除 WebView 的网页数据与缓存（插件面板 / Web 设置页的加载内容）。登录态与偏好不受影响；重新打开的面板为全新加载。'))
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textMuted)
        .width('100%')
      Row({ space: SP_2 }) {
        SettingsButton({
          label: '清除缓存',
          kind: 'danger',
          theme: this.theme,
          onTap: () => {
            this.clearCaches();
          },
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      if (this.cacheNote.length > 0) {
        Text(this.cacheNote)
          .fontSize(FS_CAPTION)
          // 视觉态用 `cacheOk`（= ClearCacheResult.ok，纯逻辑真源），⛔ 不在组件里二次推断。
          .fontColor(this.cacheOk ? this.pal().successText : this.pal().dangerText)
          .width('100%')
      }
      if (this.cacheDetail.length > 0) {
        Text(this.cacheDetail)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().dangerText)
          .width('100%')
      }
    }
    .width('100%')
    .padding(SP_3)
    .backgroundColor(this.pal().surface)
    .borderRadius(R_LG)
    .border({ width: 1, color: this.pal().border })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  EntryRow(e: SseRecEntry) {
    Row({ space: SP_2 }) {
      Text(fmtClock(e.atMs))
        .fontSize(10)
        .fontFamily('monospace')
        .fontColor(this.pal().textMuted)
      Text(e.name)
        .fontSize(10)
        .fontFamily('monospace')
        .fontColor(e.kind === 'lifecycle' ? this.pal().accentSoft : this.pal().textSecondary)
        .maxLines(1)
        // ⛔ `maxLines` 必须配 `textOverflow`（否则默认 `Clip` ⇒ 事件名被**静默截断**无提示）。
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(previewText(e.payload, 120))
        .fontSize(10)
        .fontFamily('monospace')
        .fontColor(this.pal().textMuted)
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }

  build() {
    // ⛔ **整页唯一滚动容器**（用户 2026-10-17：「开发者二级菜单甚至无法滚动看不到所有功能」）：
    //    此前只有内层事件列表有 Scroll，面板其余内容（开关/按钮/日志入口）超出屏幕即被裁掉、
    //    无从触达。整页一个 Scroll 后所有条目都可滚到；内层列表另给定高（见其 .height）。
    Scroll() {
      Column({ space: SP_3 }) {
      SettingsPanelHeader({
        title: '开发者',
        subtitle: '排障工具：录制 SSE 事件流并查看连接状态。录制内容会自动脱敏（api_key / token 等）。',
        theme: this.theme,
      })

      // ── 开关（默认关；本地持久化，不同步服务端）──
      SettingsToolRow({
        label: '启用开发者工具（SSE 录制）',
        description: '打开后记录所有 SSE 事件；仅在排障时开启（关闭时零额外开销）。',
        isOn: this.devEnabled,
        indented: false,
        busy: false,
        mono: false,
        theme: this.theme,
        names: ['developer-mode'],
        onToggle: (names: string[], next: boolean) => {
          this.onToggleDev(next);
        },
      })

      // ── 应用日志（二级入口；用户 2026-10-16：日志是纯 debug 功能，不该占侧边栏主导航）──
      Row({ space: SP_2 }) {
        SymbolGlyph($r('sys.symbol.doc_text'))
          .fontSize(18)
          .fontColor([this.pal().textSecondary])
        Column({ space: 2 }) {
          Text(i18nT('应用日志'))
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textPrimary)
          Text(i18nT('查看当前会话运行期日志（连接 / 切会话 / 发送 / 错误）'))
            .fontSize(10)
            .fontColor(this.pal().textMuted)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right'))
          .fontSize(14)
          // ⛔ 图标弱色必须走计算型 role `iconMuted`（porcelain 下 textMuted < 3:1 不达非文本门槛）
          .fontColor([colorOf(this.pal(), 'iconMuted')])
      }
      .width('100%')
      .height(HIT_TARGET_MIN)
      .alignItems(VerticalAlign.Center)
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .accessibilityText(i18nT('打开应用日志'))
      .onClick(() => {
        this.onOpenLog();
      })

      // ── 迭代号标记开关（用户 2026-10-21：「把迭代号这个搞成开关，在开发者里搞个设置，关掉就不显示」）──
      // 与「应用日志」同一分区；写入 `AppStorage('xbotIterBadge')`，`IterBlocksView` 用
      // `@StorageProp` 自己订阅 ⇒ 切换后**已存在行**立即跟随（不必重进会话）。
      Row({ space: SPACE_SM }) {
        Column({ space: 2 }) {
          Text(i18nT('显示迭代号'))
            .fontSize(typeOf('type.body').size)
            .fontColor(this.pal().textPrimary)
          Text(i18nT('在每个迭代块左上角显示 #号、是否在飞、工具数（排障用）'))
            .fontSize(typeOf('type.caption').size)
            .fontColor(this.pal().textMuted)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Toggle({ type: ToggleType.Switch, isOn: this.iterBadgeOn })
          .onChange((on: boolean) => {
            this.iterBadgeOn = on;
            AppStorage.setOrCreate<boolean>('xbotIterBadge', on);
          })
      }
      .width('100%')
      .height(HIT_TARGET_MIN)
      .alignItems(VerticalAlign.Center)

      // ── 实况窗（Live View Kit）自检 + 手动测试 ──
      this.LiveViewSection()

      // ── 导出会话（对齐 web `SettingsDeveloper.tsx:42-...`；形态表在 `core/export.exportActions()`）──
      this.ExportSection()

      // ── 清除缓存（对齐 web `SettingsGeneral` 的 clearCache；落点=本分区：维护类聚合）──
      this.CacheSection()

      // ── 连接状态卡（原生增强）──
      Column({ space: SP_1 }) {
        Row({ space: SP_2 }) {
          Text(i18nT('SSE 连接状态'))
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textPrimary)
            .layoutWeight(1)
          if (this.devEnabled) {
            // ⛔ 图标一致性：原先 `Text(i18nT('● 录制中'))` 把**符号当图标**直写在文案里（审计命中）。
            //    拆成「symbol 点 + 文案」两个兄弟节点（父容器已是 `Row(space: SP_2)` ⇒ 布局不变）。
            //    用本仓既有 `circle_fill`（别处已在用 ⇒ 命名安全）。
            SymbolGlyph($r('sys.symbol.circle_fill'))
              .fontSize(8)
              .fontColor([this.pal().dangerText])
            Text(i18nT('录制中'))
              .fontSize(10)
              .fontColor(this.pal().dangerText)
          }
        }
        .width('100%')

        SettingsDevStatLine({ label: i18nT('状态'), value: devStateLabel(this.connState), valueColor: this.pal().textSecondary, theme: this.theme })
        SettingsDevStatLine({ label: '请求协议', value: this.connHttpVer, valueColor: this.pal().textSecondary, theme: this.theme })
        SettingsDevStatLine({
          label: '上次错误码',
          value: this.connErr !== 0 ? `${this.connErr}` : '',
          valueColor: this.connErr !== 0 ? this.pal().dangerText : this.pal().textMuted,
          theme: this.theme,
        })
        SettingsDevStatLine({ label: '上次响应码', value: this.connResp !== 0 ? `${this.connResp}` : '', valueColor: this.pal().textSecondary, theme: this.theme })
        SettingsDevStatLine({ label: '重连次数', value: `${this.connReconnects}`, valueColor: this.pal().textSecondary, theme: this.theme })
        SettingsDevStatLine({ label: '连接尝试', value: `${this.connAttempts}`, valueColor: this.pal().textSecondary, theme: this.theme })
        SettingsDevStatLine({ label: '已收事件', value: `${this.connFrames}`, valueColor: this.pal().textSecondary, theme: this.theme })
        SettingsDevStatLine({
          label: '录制占用',
          value: `${this.recCount} / ${SSEE_MAX_ENTRIES} 条 · ${fmtBytes(this.recBytes)} / ${fmtBytes(SSEE_MAX_BYTES)}`,
          valueColor: this.pal().textSecondary,
          theme: this.theme,
        })
      }
      .width('100%')
      .padding(SP_3)
      .backgroundColor(this.pal().surface)
      .borderRadius(R_LG)
      .border({ width: 1, color: this.pal().border })
      .alignItems(HorizontalAlign.Start)

      // ── 操作：清空 / 复制（原生增强）──
      Row({ space: SP_2 }) {
        SettingsButton({
          label: '清空',
          kind: 'secondary',
          theme: this.theme,
          onTap: () => {
            this.clearRec();
          },
        })
        SettingsButton({
          label: '复制 JSON',
          kind: 'primary',
          theme: this.theme,
          onTap: () => {
            this.copyRec();
          },
        })
        if (this.copyNote.length > 0) {
          Text(this.copyNote)
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .width('100%')

      // ── 事件列表（最新在前）──
      if (this.rows.length === 0) {
        Text(this.devEnabled ? i18nT('暂无事件（等待 SSE 活动…）') : i18nT('开发者工具已关闭。'))
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else {
        Text(`最近 ${this.rows.length} 条事件（最新在前）`)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
        Scroll() {
          Column({ space: SP_1 }) {
            ForEach(this.rows, (e: SseRecEntry) => {
              this.EntryRow(e)
            }, (e: SseRecEntry) => `${e.seq}-${e.name}`)
          }
          .width('100%')
        }
        .width('100%')
        // ⛔ 内层列表**定高**（外层已是整页 Scroll）：`layoutWeight(1)` 在"外层可滚 + 内容自适应"
        //    下会与外层争高 ⇒ 两者都滚不动（用户亲报「开发者面板无法滚动」的同一族根因）。
        .height(280)
        .padding(SP_3)
        .backgroundColor(this.pal().surface)
        .borderRadius(R_XL)
        .border({ width: 1, color: this.pal().border })
        .edgeEffect(EdgeEffect.Spring)
        .scrollBar(BarState.Auto)
        .align(Alignment.Top)
      }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: SP_5, right: SP_5, top: SP_4, bottom: SP_4 })
    }
    .width('100%')
    .layoutWeight(1)
    .edgeEffect(EdgeEffect.Spring)
    .scrollBar(BarState.Auto)
    .align(Alignment.Top)
  }
}

/**
 * 一行「标签 —— 值」（值可着色）。
 *
 * ⛔ **真 `@Component` + `@Prop`**，**不是**带参 `@Builder` —— 这里的值每次刷新都会变，
 *    带参 `@Builder` 多参数按值传递、子树不随参数重建（`docs/ARKTS-GOTCHAS.md` §4）
 *    ⇒ 用 `@Builder` 会把 `状态 / errCode / 重连次数` 全**卡在首帧**。
 */
@Component
struct SettingsDevStatLine {
  @Prop label: string = '';
  @Prop value: string = '';
  @Prop valueColor: string = '';
  @Prop theme: string = 'dark';

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row() {
      Text(this.label)
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textMuted)
      Blank()
      Text(this.value.length > 0 ? this.value : '—')
        .fontSize(FS_CAPTION)
        .fontFamily('monospace')
        .fontColor(this.valueColor.length > 0 ? this.valueColor : this.pal().textSecondary)
        // H1 残留风险收口（2026-10-11）：本组件是**共享组件**（8 个消费点），value 是 Row 内
        // **唯一可变长元素**；此前只有 maxLines+textOverflow、**无宽度上限** ⇒ `Blank()` 被压到 0
        // 后极长值仍可顶宽。原则：**标签优先可读、值以省略收尾** ⇒ 给 value 侧设宽度上限。
        .constraintSize({ maxWidth: '70%' })
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .padding({ top: SP_1, bottom: SP_1 })
  }
}
