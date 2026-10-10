import type AbilityConstant from "@ohos:app.ability.AbilityConstant";
import UIAbility from "@ohos:app.ability.UIAbility";
import type Want from "@ohos:app.ability.Want";
import type { KeyboardAvoidMode as KeyboardAvoidMode } from "@ohos:arkui.UIContext";
import type { UIContext as UIContext } from "@ohos:arkui.UIContext";
import window from "@ohos:window";
import hilog from "@ohos:hilog";
import type { BusinessError as BusinessError } from "@ohos:base";
const DOMAIN: number = 0x0000;
const TAG: string = 'xbot';
export default class EntryAbility extends UIAbility {
    onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
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
            uiCtx.setKeyboardAvoidMode(1);
            // 深色界面：状态栏/导航栏用浅色图标
            // 安全区：即使窗口被系统判成"全屏"，也把状态栏/导航栏高度写进 AppStorage，
            // 由页面根容器加 padding（这是 EntryAbility 注释里就写明的配套动作）——
            // 真机事故：消息文本被画到状态栏图标之下。
            try {
                const topArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
                const bottomArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
                AppStorage.setOrCreate('safeTopVp', px2vp(topArea.topRect.height));
                AppStorage.setOrCreate('safeBottomVp', px2vp(bottomArea.bottomRect.height));
            }
            catch (e) {
                AppStorage.setOrCreate('safeTopVp', 0);
                AppStorage.setOrCreate('safeBottomVp', 0);
            }
            win.setWindowSystemBarProperties({
                statusBarContentColor: '#FFFFFF',
                navigationBarContentColor: '#FFFFFF',
            });
        }
        catch (e) {
            const err: BusinessError = e as BusinessError;
            hilog.warn(DOMAIN, TAG, 'window decorations skipped: %{public}s', err.message);
        }
    }
    onWindowStageDestroy(): void {
        hilog.info(DOMAIN, TAG, 'EntryAbility onWindowStageDestroy');
    }
    onForeground(): void {
    }
    onBackground(): void {
    }
}
