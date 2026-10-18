import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { KeyboardAvoidMode, UIContext, window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import {
  PENDING_ACTION_KEY,
  PENDING_CHAT_KEY,
  PENDING_CHAT_SEQ_KEY,
  endTurnKeepAlive,
  ensureEnabled,
  initSlots,
  notifyActionFromParam,
  noteForegroundSeen,
  reconcileOnForeground,
  setAppForeground,
  setForegroundSeenSink,
  setSessionClearedHook,
} from '../core/notify';
import {
  CommandAction,
  PENDING_COMMAND_KEY,
  PENDING_COMMAND_SEQ_KEY,
  commandActionValid,
  commandRegistered,
  isCommandUri,
  parseCommandUri,
  registeredCommands,
} from '../core/command';
import { readCachedLocale, readCachedTheme } from '../core/config';
import { initLocale } from '../core/i18n';
import { ensureReconcileScheduled, cancelReconcileScheduled } from '../workreconcile/schedule';
import { markForegroundSeen } from '../workreconcile/memo';
import { installNotifyIcon } from '../workreconcile/icons';
import { isLightPalette, paletteOf } from '../core/theme';

const DOMAIN: number = 0x0000;
const TAG: string = 'xbot';
/**
 * `loadContent('pages/Index')` 失败后的**重试次数**（重试 1 次 ⇒ 共 2 试）。
 * 取 1 的理由：失败基本都是瞬时/环境类（打包/资源/上下文未就绪），第二次有实质机会；
 * 再多只会拖长"空白期"（此时用户已经没有任何可读内容），不如**尽快进兜底页**。
 */
const MAX_LOAD_RETRY: number = 1;

export default class EntryAbility extends UIAbility {
  private darkSystem: boolean = true;
  /**
   * 软键盘高度监听回调（与 `win.on('keyboardHeightChange', …)` **成对**；
   * `onWindowStageDestroy` 里注销——避免留一个打到已销毁页面的回调）。
   */
  private kbCb: ((h: number) => void) | null = null;
  /** 主窗口引用（**只为注销**上面的监听；窗口本身随 ability 销毁）。 */
  private mainWin: window.Window | null = null;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    // ⛔ **系统表面跟随主题**（原为硬编码深色 —— 浅色主题下会造成"外壳深、卡片浅"的割裂）。
    //   应用自带完整语义色板，但**系统绘制的表面不听色板**：模糊材质（`backgroundBlurStyle`
    //   的 `colorMode` 默认 SYSTEM）、`bindPopup` 弹窗底、文本选择/长按菜单、状态栏前景等，
    //   它们的明暗只由**应用级 colorMode** 决定。
    //   冷启动时服务端 settings（主题真值）还没到 ⇒ 从**本地缓存**读（页面切主题时会写，
    //   见 Index.syncSystemTheme）；读不到（未存过/异常）⇒ 回落深色（保持既有语义）。
    //   **必须同步**（`getPreferencesSync`）：只有同步才能在**首帧之前**定下系统表面，
    //   否则浅色主题用户会先看到一帧深色再翻转（闪色）。
    //   ⛔ 判据必须是**色板亮度**（`isLightPalette(paletteOf(t))`），**不按主题名硬判**
    //   （`docs/DESIGN-SYSTEM.md §12`/铁律：深浅只走亮度口径 ⇒ 将来"主题名 ↔ appBg 亮度"脱钩也不会错）。
    const cachedTheme: string = readCachedTheme(this.context);
    // 首帧前定下界面语言（与主题同理）：本地缓存是上次选择；服务端 `xbot-locale`
    // 到达后会覆盖（`ChatStore.loadSettings`）。否则冷启动先渲染中文再异步切日文
    //（用户 2026-10-18：「切日文后重启，侧边栏还是中文」）。
    initLocale(readCachedLocale(this.context));
    this.darkSystem = cachedTheme.length === 0 || !isLightPalette(paletteOf(cachedTheme));
    this.context.getApplicationContext().setColorMode(this.darkSystem
      ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK
      : ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT);
    // ── 通知（主方案）：建槽 + 记录"在前台" + 冷启动时接收"点通知进来"的 chat_id ──
    // 三条都是旁路：失败只记日志，绝不影响启动（见 core/notify.ets 的 try/catch 兜底）。
    initSlots();
    setAppForeground(true);
    this.captureOpenChat(want);
    // 深链命令（`xbot://<command>?…`）——`core/command.ets` 的**生产消费点**（冷启动）。
    this.captureCommandUri(want);
    // **仅调试**：`--ps dbgPage splash` ⇒ 首屏换成开屏预览页（生产不带该参数）。
    const wp: Record<string, Object> | undefined = want.parameters;
    const dp: Object | undefined = wp !== undefined ? wp['dbgPage'] : undefined;
    this.dbgPage = typeof dp === 'string' ? dp : '';
    // 后台对账（延迟任务）：把 NotifyReconcileAbility 排进队列（幂等）。
    // ⛔ 旁路：失败只记日志（见 workreconcile/schedule.ets）；不改通知主链路的任何语义。
    // 品牌小图标（通知 smallIcon）：启动时解一次并注册装饰器。
    // 旁路：失败静默回落系统默认图标（见 workreconcile/icons.ets）。
    installNotifyIcon(this.context).catch(() => {
    });
    ensureReconcileScheduled(this.context);
    // 死消费修复的两个端口（2026-10-11）——**都在本处注册**，都在 `core/notify.ets` 里被触发：
    //   ① `setForegroundSeenSink`：前台"用户已看到某会话第 N 回合" ⇒ 写对账备忘
    //      （⇒ `core/reconcile.markSeen` 不再 0 消费；否则后台对账会把**已看过**的回合误报成新消息）；
    //   ② `setSessionClearedHook`：会话清场（登出/401）⇒ 取消后台对账延迟任务
    //      （⇒ `cancelReconcileScheduled` 不再 0 调用；否则登出后对账仍带着旧会话空跑）。
    // ⛔ 两者都是**旁路**：任何异常只静默（通知/对账失败最多"没提醒"）。
    setForegroundSeenSink((chatId: string, lastSeq: number) => {
      markForegroundSeen(this.context, chatId, lastSeq).catch(() => {
      });
    });
    setSessionClearedHook(() => {
      cancelReconcileScheduled();
    });
    hilog.info(DOMAIN, TAG, 'EntryAbility onCreate');
  }

  /**
   * **仅调试**：由 want 参数 `dbgPage` 指定的替代首屏（空串 = 正常 `pages/Index`）。
   *
   * 用途（用户 2026-10-16 要求）：开屏/加载态是**时序 + 层级**强相关的 UI，靠真机连拍
   * "碰运气截图"既慢又不确定 ⇒ 提供一个**确定性预览页** `pages/SplashPreview`：
   *   `hdc shell aa start -a EntryAbility -b com.chronostasys.xbot --ps dbgPage splash`
   * ⛔ 生产路径不带该参数 ⇒ 恒为 `pages/Index`（零影响）。
   */
  private dbgPage: string = '';

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'EntryAbility onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    this.loadContentWithRetry(windowStage, 0);

    // ⛔ 不启用沉浸式（full-screen layout）。
    // 原因（2026-10-09）：`setWindowLayoutFullScreen(true)` 会让内容铺到状态栏/挖孔之下，
    // 而应用侧**没有做安全区避让** ⇒ 顶部内容被状态栏压住、整体看起来"渲染错乱"。
    // 需要沉浸式时必须配套读取 window.getWindowAvoidArea(...) 并给根容器加 padding；
    // 在没做避让之前，交给系统做内边距是唯一正确的选择。
    try {
      const win: window.Window = windowStage.getMainWindowSync();
      win.setWindowLayoutFullScreen(false);
      // ── 软键盘高度 → AppStorage（**浮层自避让的唯一数据源**）────────────────────────────
      // ⛔ 为什么必须自己广播：`KeyboardAvoidMode.RESIZE` **只对"焦点在文档流输入框"生效**。
      //   真机 dump 对照（同一个抽屉，两次测量）：
      //     · 点 composer（**文档流**）⇒ 页面内容根 y2754 → ~1780（视口真缩、输入框可见）✓
      //     · 点抽屉搜索框（**浮层内**）⇒ 页面内容根**仍 2754**（视口一点没缩）⇒ 抽屉底栏留在
      //       y2647、被 IME 窗口**完全盖死**（连 dump 都把它的节点整批裁掉，因为被别的窗口盖住）✗
      //   ⇒ 浮层不能指望系统避让，必须自己按键盘高度让位。页面侧消费点：
      //     `Index.ets` 的 `@StorageProp('kbHeightPx')`（抽屉底栏 / 运行面板底部内边距）。
      //   单位 = **px**（页面侧用 `px2vp()` 换算）；键盘收起时系统会回调 **0** ⇒ 内边距归零。
      this.kbCb = (h: number): void => {
        AppStorage.setOrCreate<number>('kbHeightPx', h);
      };
      win.on('keyboardHeightChange', this.kbCb);
      this.mainWin = win;
      // 键盘避让模式：ArkUI 默认是 OFFSET（键盘弹出时把**整页上推**）——底部输入框仍可能被键盘
      // 盖住、整页内容随键盘抖动，在"边打字边看进度"的聊天场景里体感就是"没法用"。
      // 选 RESIZE：键盘出现时**缩小布局视口**（列表自然变矮、输入框始终可见、内容不位移），
      // 与 Web 端既定的 `interactive-widget=resizes-content` 策略一致（见 xbot 移动端适配铁律）。
      const uiCtx: UIContext = win.getUIContext();
      uiCtx.setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
      // 状态栏/导航栏**前景色跟随主题**：深色主题用浅色图标（#FFFFFF），浅色主题用深色（#000000）。
      // 判据 = `this.darkSystem`（onCreate 里**同步**读缓存主题算得；与页面 glassMode() 同源），不再硬编码。
      win.setWindowSystemBarProperties({
        statusBarContentColor: this.darkSystem ? '#FFFFFF' : '#000000',
        navigationBarContentColor: this.darkSystem ? '#FFFFFF' : '#000000',
      });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'window decorations skipped: %{public}s', err.message);
    }
  }

  onWindowStageDestroy(): void {
    // 注销键盘高度监听（**显式对称**：窗口随 ability 销毁本不会泄漏，但 `kbHeightPx` 是浮层避让的
    // 唯一数据源，⛔ 不能留一个可能打到已销毁页面的回调）。
    const win: window.Window | null = this.mainWin;
    if (win !== null && this.kbCb !== null) {
      try {
        win.off('keyboardHeightChange', this.kbCb);
      } catch (e) {
        const err: BusinessError = e as BusinessError;
        hilog.warn(DOMAIN, TAG, 'keyboardHeightChange off skipped: %{public}s', err.message);
      }
      this.kbCb = null;
      this.mainWin = null;
    }
    hilog.info(DOMAIN, TAG, 'EntryAbility onWindowStageDestroy');
  }

  onForeground(): void {
    // ── "三档状态"的前台档：写标志（store 据此**抑制**通知）+ 回前台对账 ──
    setAppForeground(true);
    // 用户已经回来了：短时任务不再需要（幂等），角标/通知一并清掉。
    endTurnKeepAlive();
    reconcileOnForeground();
  }

  onBackground(): void {
    setAppForeground(false);
  }

  /**
   * 通知点击 / 外部 Want 再次拉起（ability 已在运行时走这里；冷启动走 onCreate）。
   * 之前**完全缺失** ⇒ 点通知回到应用后页面收不到会话 id。
   */
  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.captureOpenChat(want);
    // 深链命令（ability 已在运行时走这里；与冷启动同一条通路）。
    this.captureCommandUri(want);
  }

  /**
   * **深链命令**（`xbot://settings.open?section=llm` 等）—— `core/command.ets` 的**唯一生产消费点**。
   *
   * ── 语义逐条对齐 web（`web/src/lib/commandRouter.ts`）────────────────────────────
   *   · `parseUri` 支持三种等价写法（`xbot://` / `xbot:` / `/command/`）：本端 `parseCommandUri` 同源；
   *   · **未注册命令 ⇒ 明确报错**（web `execute()` `:88-92` 直接 `throw` "拼错命令名应该立刻暴露"）：
   *     本端把这条落成 `hilog.error` + **不派发**（深链来自**外部** App ⇒ ⛔ 不崩，也 ⛔ 不静默吞）；
   *   · 命令集合 = `registeredCommands()`（逐条对应 web `layouts/AppShell.tsx:118-152` 的 4 条）。
   *
   * ⛔ `want.uri` 不是命令（如 `https://…`）⇒ **原样放过**（那是系统/浏览器的事，本方法不接管）。
   */
  private captureCommandUri(want: Want): void {
    try {
      const uri: string = want.uri !== undefined && want.uri !== null ? want.uri : '';
      if (uri.length === 0) {
        return;                        // 没有 uri ⇒ 不是深链
      }
      if (!isCommandUri(uri)) {
        return;                        // 有 uri 但不是命令 URI（普通链接）⇒ 不接管
      }
      const action: CommandAction | null = parseCommandUri(uri);
      if (!commandActionValid(action)) {
        hilog.error(DOMAIN, TAG, 'deep-link 命令形状非法（id 缺命名空间/非法字符）: %{public}s', uri);
        return;
      }
      const id: string = action !== null ? action.id : '';
      if (!commandRegistered(id)) {
        hilog.error(DOMAIN, TAG, 'deep-link 命令**未注册**: %{public}s（已注册: %{public}s）',
          id, registeredCommands().join(' | '));
        return;
      }
      // 合法 ⇒ **只投递**（页面 bootstrap 消费后 `AppStorage.delete`）——同 `PENDING_CHAT_KEY` 的分工。
      AppStorage.setOrCreate<string>(PENDING_COMMAND_KEY, uri);
      AppStorage.setOrCreate<number>(PENDING_COMMAND_SEQ_KEY, Date.now());
      hilog.info(DOMAIN, TAG, 'deep-link 命令已投递: %{public}s', uri);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'captureCommandUri skipped: %{public}s', err.message);
    }
  }

  /**
   * 把"点通知要打开的会话"交给页面（通道：**AppStorage**）。
   *
   * 为什么用 AppStorage：EntryAbility 与页面同进程，页面用
   * `@StorageProp('pendingOpenChatId')` 即可读到；另写一个**序号**
   * （`pendingOpenChatSeq`）保证"同一个会话被点第二次"也能被页面察觉
   * （只改同一个字符串值时，StorageProp 不产生新变更）。
   *
   * 本轮新增：**动作按钮**的 `notify_action`（`core/notify.ets` 的 `PENDING_ACTION_KEY`）——
   * 通知按钮的 WantAgent 用 `START_ABILITY + parameters{chat_id, notify_action}`（见 `publishTurn`），
   * 这里用**白名单**（`notifyActionFromParam`）解析后写入 AppStorage，供页面执行对应能力。
   *
   * ⚠️ 页面消费后应把 `pendingOpenChatId` / `pendingNotifyAction` 清空（`AppStorage.delete`）。
   */
  private captureOpenChat(want: Want): void {
    try {
      const params: Record<string, Object> | undefined = want.parameters;
      if (params === undefined) {
        return;
      }
      const raw: Object = params['chat_id'];
      if (typeof raw !== 'string' || (raw as string).length === 0) {
        return;
      }
      const chatId: string = raw as string;
      AppStorage.setOrCreate<string>(PENDING_CHAT_KEY, chatId);
      AppStorage.setOrCreate<number>(PENDING_CHAT_SEQ_KEY, Date.now());
      // 动作按钮：连带把白名单动作 id 交给页面（非法/缺失 ⇒ 空串，不写）
      const action: string = notifyActionFromParam(params['notify_action']);
      if (action.length > 0) {
        AppStorage.setOrCreate<string>(PENDING_ACTION_KEY, action);
      }
      hilog.info(DOMAIN, TAG, 'notification wants chat: %{public}s action: %{public}s', chatId, action);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'captureOpenChat skipped: %{public}s', err.message);
    }
  }

  /**
   * 加载首页 —— **失败绝不静默**（`docs/SPLASH-SPEC.md §10 ③` 的最小落地）：
   *   ① 打**明确 tag** 的 `hilog.error`（`xbot` ⇒ 可 `hilog -x | grep xbot` 归因）；
   *   ② **重试一次**（`MAX_LOAD_RETRY`）；
   *   ③ 两试仍失败 ⇒ 加载**最小兜底页** `pages/Fallback`（纯文本；⛔ 不白屏、⛔ 不复杂 UI）。
   *
   * 为什么"不静默 return"是最低要求：`loadContent` 失败 ⇒ 页面根本没挂载 ⇒ 系统开屏撤下后
   * **屏幕上什么都没有**，而日志只有一行 error ⇒ 现场无法归因、用户只会说"打不开"。
   */
  private loadContentWithRetry(windowStage: window.WindowStage, attempt: number): void {
    // **仅调试**：`--ps dbgPage splash` ⇒ 直接载入开屏预览页（确定性渲染，不靠真机连拍碰运气）。
    const page: string = this.dbgPage === 'splash' ? 'pages/SplashPreview' : 'pages/Index';
    windowStage.loadContent(page, (err: BusinessError) => {
      if (err.code === 0) {
        hilog.info(DOMAIN, TAG, 'loadContent succeeded');
        // 通知授权必须**在 UI 就绪之后**请求（授权框需要一个已加载好的 UIAbility 上下文）；
        // 失败（用户拒绝 / 弹框冲突）只记日志，不影响启动。
        ensureEnabled(this.context);
        return;
      }
      hilog.error(DOMAIN, TAG, 'loadContent failed (attempt=%{public}d): %{public}s', attempt, JSON.stringify(err));
      if (attempt < MAX_LOAD_RETRY) {
        this.loadContentWithRetry(windowStage, attempt + 1);
        return;
      }
      // 两试均失败 ⇒ **兜底**（⛔ 不白屏）
      hilog.error(DOMAIN, TAG, 'loadContent 两试均失败 ⇒ 加载兜底页 pages/Fallback');
      windowStage.loadContent('pages/Fallback', (e2: BusinessError) => {
        if (e2.code !== 0) {
          hilog.error(DOMAIN, TAG, '兜底页也加载失败: %{public}s', JSON.stringify(e2));
        }
      });
    });
  }
}
