if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface AuthImage_Params {
    /** 图片地址（服务端返回的引用 URL） */
    src?: string;
    /** 取字节（带鉴权） */
    load?: (src: string) => Promise<ArrayBuffer>;
    /** 点按打开大图（查看器） */
    onOpen?: (src: string) => void;
    /** 最大显示高度（vp） */
    maxHeight?: number;
    theme?: string;
    pm?: image.PixelMap | undefined;
    failed?: boolean;
    loading?: boolean;
}
import image from "@ohos:multimedia.image";
import { paletteOf } from "@normalized:N&&&entry/src/main/ets/core/theme&";
import type { Palette } from "@normalized:N&&&entry/src/main/ets/core/theme&";
const PM_CACHE: Map<string, image.PixelMap> = new Map<string, image.PixelMap>();
const PM_ORDER: string[] = [];
/** 缓存上限（张）。 */
const PM_CACHE_MAX: number = 24;
export class AuthImage extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.src = '';
        this.load = async (s: string) => {
            return new ArrayBuffer(0);
        };
        this.onOpen = (src: string) => {
        };
        this.maxHeight = 340;
        this.__theme = new SynchedPropertySimpleOneWayPU(params.theme, this, "theme");
        this.__pm = new ObservedPropertyObjectPU(undefined, this, "pm");
        this.__failed = new ObservedPropertySimplePU(false, this, "failed");
        this.__loading = new ObservedPropertySimplePU(true, this, "loading");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: AuthImage_Params) {
        if (params.src !== undefined) {
            this.src = params.src;
        }
        if (params.load !== undefined) {
            this.load = params.load;
        }
        if (params.onOpen !== undefined) {
            this.onOpen = params.onOpen;
        }
        if (params.maxHeight !== undefined) {
            this.maxHeight = params.maxHeight;
        }
        if (params.theme === undefined) {
            this.__theme.set('dark');
        }
        if (params.pm !== undefined) {
            this.pm = params.pm;
        }
        if (params.failed !== undefined) {
            this.failed = params.failed;
        }
        if (params.loading !== undefined) {
            this.loading = params.loading;
        }
    }
    updateStateVars(params: AuthImage_Params) {
        this.__theme.reset(params.theme);
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__theme.purgeDependencyOnElmtId(rmElmtId);
        this.__pm.purgeDependencyOnElmtId(rmElmtId);
        this.__failed.purgeDependencyOnElmtId(rmElmtId);
        this.__loading.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__theme.aboutToBeDeleted();
        this.__pm.aboutToBeDeleted();
        this.__failed.aboutToBeDeleted();
        this.__loading.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    /** 图片地址（服务端返回的引用 URL） */
    private src: string;
    /** 取字节（带鉴权） */
    private load: (src: string) => Promise<ArrayBuffer>;
    /** 点按打开大图（查看器） */
    private onOpen: (src: string) => void;
    /** 最大显示高度（vp） */
    private maxHeight: number;
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
    private __pm: ObservedPropertyObjectPU<image.PixelMap | undefined>;
    get pm() {
        return this.__pm.get();
    }
    set pm(newValue: image.PixelMap | undefined) {
        this.__pm.set(newValue);
    }
    private __failed: ObservedPropertySimplePU<boolean>;
    get failed() {
        return this.__failed.get();
    }
    set failed(newValue: boolean) {
        this.__failed.set(newValue);
    }
    private __loading: ObservedPropertySimplePU<boolean>;
    get loading() {
        return this.__loading.get();
    }
    set loading(newValue: boolean) {
        this.__loading.set(newValue);
    }
    aboutToAppear(): void {
        this.ensure();
    }
    private async ensure(): Promise<void> {
        const hit: image.PixelMap | undefined = PM_CACHE.get(this.src);
        if (hit !== undefined) {
            this.pm = hit;
            this.loading = false;
            return;
        }
        try {
            const buf: ArrayBuffer = await this.load(this.src);
            if (buf.byteLength === 0) {
                throw new Error('空响应');
            }
            const srcObj: image.ImageSource = image.createImageSource(buf);
            const pm: image.PixelMap = await srcObj.createPixelMap();
            this.remember(this.src, pm);
            this.pm = pm;
            this.loading = false;
        }
        catch (e) {
            this.failed = true;
            this.loading = false;
        }
    }
    private remember(key: string, pm: image.PixelMap): void {
        PM_CACHE.set(key, pm);
        PM_ORDER.push(key);
        while (PM_ORDER.length > PM_CACHE_MAX) {
            const old: string | undefined = PM_ORDER.shift();
            if (old !== undefined) {
                PM_CACHE.delete(old);
            }
        }
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.pm !== undefined) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Image.create(this.pm);
                        Image.debugLine("entry/src/main/ets/components/AuthImage.ets(80:7)", "entry");
                        Image.width('100%');
                        Image.constraintSize({ maxHeight: this.maxHeight });
                        Image.objectFit(ImageFit.Contain);
                        Image.borderRadius(8);
                        Image.backgroundColor(this.pal().appBg);
                        Image.onClick(() => {
                            this.onOpen(this.src);
                        });
                    }, Image);
                });
            }
            else if (this.loading) {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create({ space: 6 });
                        Row.debugLine("entry/src/main/ets/components/AuthImage.ets(90:7)", "entry");
                        Row.padding(8);
                        Row.backgroundColor(this.pal().surfaceAlt);
                        Row.borderRadius(6);
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        LoadingProgress.create();
                        LoadingProgress.debugLine("entry/src/main/ets/components/AuthImage.ets(91:9)", "entry");
                        LoadingProgress.width(14);
                        LoadingProgress.height(14);
                        LoadingProgress.color(this.pal().accent);
                    }, LoadingProgress);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('图片加载中…');
                        Text.debugLine("entry/src/main/ets/components/AuthImage.ets(92:9)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textMuted);
                    }, Text);
                    Text.pop();
                    Row.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(2, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create({ space: 6 });
                        Row.debugLine("entry/src/main/ets/components/AuthImage.ets(98:7)", "entry");
                        Row.padding({ left: 8, right: 8, top: 5, bottom: 5 });
                        Row.margin({ top: 2, bottom: 2 });
                        Row.backgroundColor(this.pal().surfaceAlt);
                        Row.borderRadius(6);
                        Row.border({ width: 1, color: this.pal().border });
                        Row.onClick(() => {
                            if (this.failed) {
                                this.failed = false;
                                this.loading = true;
                                this.ensure();
                            }
                            else {
                                this.onOpen(this.src);
                            }
                        });
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('▣');
                        Text.debugLine("entry/src/main/ets/components/AuthImage.ets(99:9)", "entry");
                        Text.fontSize(14);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.failed ? '图片加载失败（点按重试）' : '查看图片');
                        Text.debugLine("entry/src/main/ets/components/AuthImage.ets(100:9)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().accentSoft);
                    }, Text);
                    Text.pop();
                    Row.pop();
                });
            }
        }, If);
        If.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
}
