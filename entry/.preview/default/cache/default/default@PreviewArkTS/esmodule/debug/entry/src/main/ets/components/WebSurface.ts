if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface WebSurface_Params {
    url?: string;
    theme?: string;
    chrome?: boolean;
    /** 关闭回调（由页面清空 url 卸载本组件）。 */
    onClose?: () => void;
    controller?: webview.WebviewController;
    title?: string;
}
import webview from "@ohos:web.webview";
import { paletteOf } from "@normalized:N&&&entry/src/main/ets/core/theme&";
import type { Palette } from "@normalized:N&&&entry/src/main/ets/core/theme&";
import type { BusinessError as BusinessError } from "@ohos:base";
export class WebSurface extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__url = new SynchedPropertySimpleOneWayPU(params.url, this, "url");
        this.__theme = new SynchedPropertySimpleOneWayPU(params.theme, this, "theme");
        this.__chrome = new SynchedPropertySimpleOneWayPU(params.chrome, this, "chrome");
        this.onClose = () => {
        };
        this.controller = new webview.WebviewController();
        this.__title = new ObservedPropertySimplePU('', this, "title");
        this.setInitiallyProvidedValue(params);
        this.declareWatch("url", this.onUrlChanged);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: WebSurface_Params) {
        if (params.url === undefined) {
            this.__url.set('');
        }
        if (params.theme === undefined) {
            this.__theme.set('dark');
        }
        if (params.chrome === undefined) {
            this.__chrome.set(true);
        }
        if (params.onClose !== undefined) {
            this.onClose = params.onClose;
        }
        if (params.controller !== undefined) {
            this.controller = params.controller;
        }
        if (params.title !== undefined) {
            this.title = params.title;
        }
    }
    updateStateVars(params: WebSurface_Params) {
        this.__url.reset(params.url);
        this.__theme.reset(params.theme);
        this.__chrome.reset(params.chrome);
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__url.purgeDependencyOnElmtId(rmElmtId);
        this.__theme.purgeDependencyOnElmtId(rmElmtId);
        this.__chrome.purgeDependencyOnElmtId(rmElmtId);
        this.__title.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__url.aboutToBeDeleted();
        this.__theme.aboutToBeDeleted();
        this.__chrome.aboutToBeDeleted();
        this.__title.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    /** 要加载的 URL（通常就是 xbot 服务端根地址，带完整 web UI）。 */
    // ⚠️ 必须是 @Prop + @Watch：面板从插件 A 切到插件 B 时组件实例不会重建，
    // 若 url 只是普通成员，ArkWeb 仍停留在旧页面（表现为"点了没反应/显示上一个页面"）。
    private __url: SynchedPropertySimpleOneWayPU<string>;
    get url() {
        return this.__url.get();
    }
    set url(newValue: string) {
        this.__url.set(newValue);
    }
    /** 主题（由上层透传；语义色板见 core/theme.ets） */
    private __theme: SynchedPropertySimpleOneWayPU<string>;
    get theme() {
        return this.__theme.get();
    }
    set theme(newValue: string) {
        this.__theme.set(newValue);
    }
    /** 当前语义色板 */
    private pal(): Palette {
        return paletteOf(this.theme);
    }
    /**
     * 是否带顶部 chrome（"‹ 返回"那行）。
     * 全屏承载**完整 web UI** 时置 false —— 一行原生 UI 都不留，才叫"与 web 一比一"。
     */
    private __chrome: SynchedPropertySimpleOneWayPU<boolean>;
    get chrome() {
        return this.__chrome.get();
    }
    set chrome(newValue: boolean) {
        this.__chrome.set(newValue);
    }
    /** 关闭回调（由页面清空 url 卸载本组件）。 */
    private onClose: () => void;
    private controller: webview.WebviewController;
    private __title: ObservedPropertySimplePU<string>;
    get title() {
        return this.__title.get();
    }
    set title(newValue: string) {
        this.__title.set(newValue);
    }
    onUrlChanged(): void {
        if (this.url.length === 0) {
            return;
        }
        try {
            this.controller.loadUrl(this.url);
        }
        catch (e) {
            console.error('loadUrl failed');
        }
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("entry/src/main/ets/components/WebSurface.ets(57:5)", "entry");
            Column.width('100%');
            Column.height('100%');
            Column.backgroundColor(this.pal().appBg);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.chrome) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create();
                        Row.debugLine("entry/src/main/ets/components/WebSurface.ets(59:9)", "entry");
                        Row.width('100%');
                        Row.constraintSize({ minHeight: 48 });
                        Row.backgroundColor(this.pal().surfaceAlt);
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('‹ 返回');
                        Text.debugLine("entry/src/main/ets/components/WebSurface.ets(60:11)", "entry");
                        Text.fontSize(15);
                        Text.fontColor(this.pal().accentSoft);
                        Text.padding(10);
                        Text.onClick(() => {
                            this.onClose();
                        });
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.title.length > 0 ? this.title : this.url);
                        Text.debugLine("entry/src/main/ets/components/WebSurface.ets(63:11)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textSecondary);
                        Text.layoutWeight(1);
                        Text.maxLines(1);
                        Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('⟳');
                        Text.debugLine("entry/src/main/ets/components/WebSurface.ets(69:11)", "entry");
                        Text.fontSize(16);
                        Text.fontColor(this.pal().accentSoft);
                        Text.padding(10);
                        Text.onClick(() => {
                            try {
                                this.controller.refresh();
                            }
                            catch (e) {
                                const err: BusinessError = e as BusinessError;
                                console.error(`refresh failed: ${err.message}`);
                            }
                        });
                    }, Text);
                    Text.pop();
                    Row.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Web.create({ src: this.url, controller: this.controller });
            Web.debugLine("entry/src/main/ets/components/WebSurface.ets(83:7)", "entry");
            Web.javaScriptAccess(true);
            Web.domStorageAccess(true);
            Web.databaseAccess(true);
            Web.fileAccess(true);
            Web.imageAccess(true);
            Web.onlineImageAccess(true);
            Web.geolocationAccess(false);
            Web.mixedMode(MixedMode.All);
            Web.zoomAccess(true);
            Web.horizontalScrollBarAccess(false);
            Web.darkMode(WebDarkMode.Auto);
            Web.onPageBegin((event) => {
                this.title = event !== undefined ? event.url : '';
            });
            Web.onErrorReceive((event) => {
                // ArkWeb 的错误对象在不同内核版本上暴露的成员不同 ⇒ 不假设方法存在
                try {
                    if (event !== undefined && event.error !== undefined) {
                        console.error(`web error: ${JSON.stringify(event.error)}`);
                    }
                }
                catch (e) {
                    console.error('web error (无法序列化)');
                }
            });
            Web.width('100%');
            Web.layoutWeight(1);
        }, Web);
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
}
