import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { KeyboardAvoidMode, UIContext, window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import {
  PENDING_CHAT_KEY,
  PENDING_CHAT_SEQ_KEY,
  endTurnKeepAlive,
  ensureEnabled,
  initSlots,
  reconcileOnForeground,
  setAppForeground,
} from '../core/notify';

const DOMAIN: number = 0x0000;
const TAG: string = 'xbot';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    // ⛔ **全局锁定深色**（不是"可选优化"，是这类观感 bug 的总开关）。
    //   应用自带完整深色语义色板，但**系统绘制的表面不听我们的**：模糊材质
    //   （`backgroundBlurStyle` 的 `colorMode` 默认是 SYSTEM）、`bindPopup` 的弹窗底、
    //   文本选择/长按菜单等。系统是浅色时它们一律渲染成浅灰，压在深色卡片上就是
    //   "深里突然一块白"的割裂（真机实测两处：抽屉曾整片发白；工具 pill 浮层一半浅一半深）。
    //   在进程最早的 onCreate 锁定，能让**所有**系统表面与自绘色板口径一致。
    this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_DARK);
    // ── 通知（主方案）：建槽 + 记录"在前台" + 冷启动时接收"点通知进来"的 chat_id ──
    // 三条都是旁路：失败只记日志，绝不影响启动（见 core/notify.ets 的 try/catch 兜底）。
    initSlots();
    setAppForeground(true);
    this.captureOpenChat(want);
    hilog.info(DOMAIN, TAG, 'EntryAbility onCreate');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'EntryAbility onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err: BusinessError) => {
      if (err.code !== 0) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, TAG, 'loadContent succeeded');
      // 通知授权必须**在 UI 就绪之后**请求（授权框需要一个已加载好的 UIAbility 上下文）；
      // 失败（用户拒绝 / 弹框冲突）只记日志，不影响启动。
      ensureEnabled(this.context);
    });

    // ⛔ 不启用沉浸式（full-screen layout）。
    // 原因（2026-10-09）：`setWindowLayoutFullScreen(true)` 会让内容铺到状态栏/挖孔之下，
    // 而应用侧**没有做安全区避让** ⇒ 顶部内容被状态栏压住、整体看起来"渲染错乱"。
    // 需要沉浸式时必须配套读取 window.getWindowAvoidArea(...) 并给根容器加 padding；
    // 在没做避让之前，交给系统做内边距是唯一正确的选择。
    try {
      const win: window.Window = windowStage.getMainWindowSync();
      win.setWindowLayoutFullScreen(false);
      // 键盘避让模式：ArkUI 默认是 OFFSET（键盘弹出时把**整页上推**）——底部输入框仍可能被键盘
      // 盖住、整页内容随键盘抖动，在"边打字边看进度"的聊天场景里体感就是"没法用"。
      // 选 RESIZE：键盘出现时**缩小布局视口**（列表自然变矮、输入框始终可见、内容不位移），
      // 与 Web 端既定的 `interactive-widget=resizes-content` 策略一致（见 xbot 移动端适配铁律）。
      const uiCtx: UIContext = win.getUIContext();
      uiCtx.setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
      // 深色界面：状态栏/导航栏用浅色图标
      
      // 安全区：即使窗口被系统判成"全屏"，也把状态栏/导航栏高度写进 AppStorage，
      // 由页面根容器加 padding（这是 EntryAbility 注释里就写明的配套动作）——
      // 真机事故：消息文本被画到状态栏图标之下。
      try {
        const topArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
        const bottomArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
        AppStorage.setOrCreate('safeTopVp', px2vp(topArea.topRect.height));
        AppStorage.setOrCreate('safeBottomVp', px2vp(bottomArea.bottomRect.height));
      } catch (e) {
        AppStorage.setOrCreate('safeTopVp', 0);
        AppStorage.setOrCreate('safeBottomVp', 0);
      }
win.setWindowSystemBarProperties({
        statusBarContentColor: '#FFFFFF',
        navigationBarContentColor: '#FFFFFF',
      });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'window decorations skipped: %{public}s', err.message);
    }
  }

  onWindowStageDestroy(): void {
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
  }

  /**
   * 把"点通知要打开的会话"交给页面（通道：**AppStorage**）。
   *
   * 为什么用 AppStorage：EntryAbility 与页面同进程，页面用
   * `@StorageProp('pendingOpenChatId')` 即可读到；另写一个**序号**
   * （`pendingOpenChatSeq`）保证"同一个会话被点第二次"也能被页面察觉
   * （只改同一个字符串值时，StorageProp 不产生新变更）。
   *
   * ⚠️ 页面消费后应把 `pendingOpenChatId` 清空（`AppStorage.delete`），
   *    否则冷启动不会重复消费，但"返回页面"可能再次触发。
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
      hilog.info(DOMAIN, TAG, 'notification wants chat: %{public}s', chatId);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'captureOpenChat skipped: %{public}s', err.message);
    }
  }
}
