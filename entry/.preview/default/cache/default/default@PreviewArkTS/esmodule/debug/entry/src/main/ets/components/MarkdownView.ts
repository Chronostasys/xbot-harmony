if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface MarkdownView_Params {
    text?: string;
    wrapCode?: boolean;
    fontScale?: number;
    theme?: string;
    /** 点击图片占位时的回调（参数是图片 src） */
    onImage?: (src: string) => void;
    /** 取图片字节（带鉴权；页面持有 HTTP 客户端） */
    loadImage?: (src: string) => Promise<ArrayBuffer>;
    /** 消息内图片最大高度（vp） */
    imageMaxHeight?: number;
}
import { AuthImage } from "@normalized:N&&&entry/src/main/ets/components/AuthImage&";
import pasteboard from "@ohos:pasteboard";
import { paletteOf } from "@normalized:N&&&entry/src/main/ets/core/theme&";
import type { Palette } from "@normalized:N&&&entry/src/main/ets/core/theme&";
import { MdBlockKind, parseInlineCached, parseMarkdownCached, tableRowFields, useTableGrid, } from "@normalized:N&&&entry/src/main/ets/core/markdown&";
import type { MdBlock, MdSpan, TableField } from "@normalized:N&&&entry/src/main/ets/core/markdown&";
/**
 * MarkdownView —— 把 Markdown 渲染成原生 ArkUI（零 WebView）。
 *
 * 覆盖聊天里真会出现的子集（标题/段落/列表/代码块/引用/分隔线/表格 + 内联样式 + 图片占位）。
 * 代码块自带复制；图片走 `onImage` 回调（xbot 的图片端点是 cookie 鉴权，需由页面用
 * `XbotHttp.getBinary()` 取字节再解码 —— ArkUI 的 Image(url) 不会带会话 cookie）。
 */
/**
 * 取出文本里的图片 src（供页面用 cookie 鉴权拉字节渲染）。
 *
 * ⚠️ 必须是**模块级函数**，不能写成 struct 的 static 方法：ArkUI 的 struct 不是普通类，
 * 真机上静态成员会解析成 undefined，调用直接抛 "undefined is not callable"
 * （2026-10-09 真机登录报错根因）。同理见 pages/Index.ets 的 selectionsFor。
 */
export function imagesIn(text: string): string[] {
    const out: string[] = [];
    const spans: MdSpan[] = parseInlineCached(text);
    for (let i = 0; i < spans.length; i++) {
        if (spans[i].image.length > 0) {
            out.push(spans[i].image);
        }
    }
    return out;
}
/**
 * 行内片段的**预计算样式**。
 *
 * 为什么在 TS 侧算好：ArkUI 的 `Text` 只接受 Span 类子组件，在 `Text(){ForEach(){ if/else }}`
 * 里做条件渲染不保证支持 —— 这正是"渲染错乱"的典型来源。改成一维 ForEach + 纯属性赋值，
 * 分支逻辑全部提前算完。
 */
export class MdInlineStyle {
    text: string = '';
    size: number = 15;
    /** 由调用方按当前色板赋值（类字段默认值不能依赖主题） */
    color: string = '';
    bold: boolean = false;
    italic: boolean = false;
    strike: boolean = false;
    underline: boolean = false;
    mono: boolean = false;
    /** 背景（由调用方按当前色板赋值；空 = 无背景） */
    bg: string = '';
}
export function inlineStyles(text: string, pal: Palette): MdInlineStyle[] {
    const spans: MdSpan[] = parseInlineCached(text);
    const out: MdInlineStyle[] = [];
    for (let i = 0; i < spans.length; i++) {
        const sp: MdSpan = spans[i];
        const st: MdInlineStyle = new MdInlineStyle();
        st.color = pal.textPrimary;
        if (sp.code) {
            st.text = ` ${sp.text} `;
            st.mono = true;
            st.size = 13;
            st.color = pal.dangerText;
            st.bg = pal.surfaceHi;
        }
        else if (sp.link.length > 0) {
            st.text = sp.text;
            st.color = pal.accentSoft;
            st.underline = true;
        }
        else {
            st.text = sp.text;
            st.bold = sp.bold;
            st.italic = sp.italic;
            st.strike = sp.strike;
        }
        out.push(st);
    }
    return out;
}
export class MarkdownView extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__text = new SynchedPropertySimpleOneWayPU(params.text, this, "text");
        this.__wrapCode = new SynchedPropertySimpleOneWayPU(params.wrapCode, this, "wrapCode");
        this.__fontScale = new SynchedPropertySimpleOneWayPU(params.fontScale, this, "fontScale");
        this.__theme = new SynchedPropertySimpleOneWayPU(params.theme, this, "theme");
        this.onImage = () => {
        };
        this.loadImage = async (s: string) => {
            return new ArrayBuffer(0);
        };
        this.imageMaxHeight = 340;
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: MarkdownView_Params) {
        if (params.text === undefined) {
            this.__text.set('');
        }
        if (params.wrapCode === undefined) {
            this.__wrapCode.set(true);
        }
        if (params.fontScale === undefined) {
            this.__fontScale.set(1);
        }
        if (params.theme === undefined) {
            this.__theme.set('dark');
        }
        if (params.onImage !== undefined) {
            this.onImage = params.onImage;
        }
        if (params.loadImage !== undefined) {
            this.loadImage = params.loadImage;
        }
        if (params.imageMaxHeight !== undefined) {
            this.imageMaxHeight = params.imageMaxHeight;
        }
    }
    updateStateVars(params: MarkdownView_Params) {
        this.__text.reset(params.text);
        this.__wrapCode.reset(params.wrapCode);
        this.__fontScale.reset(params.fontScale);
        this.__theme.reset(params.theme);
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__text.purgeDependencyOnElmtId(rmElmtId);
        this.__wrapCode.purgeDependencyOnElmtId(rmElmtId);
        this.__fontScale.purgeDependencyOnElmtId(rmElmtId);
        this.__theme.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__text.aboutToBeDeleted();
        this.__wrapCode.aboutToBeDeleted();
        this.__fontScale.aboutToBeDeleted();
        this.__theme.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __text: SynchedPropertySimpleOneWayPU<string>;
    get text() {
        return this.__text.get();
    }
    set text(newValue: string) {
        this.__text.set(newValue);
    }
    /** 代码块是否换行（设置里可切） */
    private __wrapCode: SynchedPropertySimpleOneWayPU<boolean>;
    get wrapCode() {
        return this.__wrapCode.get();
    }
    set wrapCode(newValue: boolean) {
        this.__wrapCode.set(newValue);
    }
    /** 消息字号缩放（1 = 默认；由设置面板控制，范围 0.85–1.4 已在上游夹取） */
    private __fontScale: SynchedPropertySimpleOneWayPU<number>;
    get fontScale() {
        return this.__fontScale.get();
    }
    set fontScale(newValue: number) {
        this.__fontScale.set(newValue);
    }
    /** 主题（由页面透传；语义色板见 core/theme.ets） */
    private __theme: SynchedPropertySimpleOneWayPU<string>;
    get theme() {
        return this.__theme.get();
    }
    set theme(newValue: string) {
        this.__theme.set(newValue);
    }
    /** 当前语义色板（深浅两套，换主题只换取值） */
    private pal(): Palette {
        return paletteOf(this.theme);
    }
    /** 点击图片占位时的回调（参数是图片 src） */
    private onImage: (src: string) => void;
    /** 取图片字节（带鉴权；页面持有 HTTP 客户端） */
    private loadImage: (src: string) => Promise<ArrayBuffer>;
    /** 消息内图片最大高度（vp） */
    private imageMaxHeight: number;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/components/MarkdownView.ets(108:5)", "entry");
            Column.width('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 走缓存：流式期间整行会反复重建，没缓存就要反复解析几百 KB（见 core/markdown.ets 注释）
            ForEach.create();
            const forEachItemGenFunction = (_item, idx: number) => {
                const b = _item;
                this.Block.bind(this)(b, idx);
            };
            this.forEachUpdateFunction(elmtId, parseMarkdownCached(this.text), forEachItemGenFunction, (b: MdBlock, idx: number) => b.key, true, true);
        }, ForEach);
        // 走缓存：流式期间整行会反复重建，没缓存就要反复解析几百 KB（见 core/markdown.ets 注释）
        ForEach.pop();
        Column.pop();
    }
    Block(b: MdBlock, idx: number, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (b.kind === MdBlockKind.Heading) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create();
                        Text.debugLine("entry/src/main/ets/components/MarkdownView.ets(121:7)", "entry");
                        Text.width('100%');
                        Text.wordBreak(WordBreak.BREAK_ALL);
                        Text.margin({ top: b.level <= 2 ? 8 : 4, bottom: 2 });
                    }, Text);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = _item => {
                            const s = _item;
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Span.create(s.text);
                                Span.debugLine("entry/src/main/ets/components/MarkdownView.ets(123:11)", "entry");
                                Span.fontWeight(FontWeight.Bold);
                                Span.fontSize(this.sz(this.headingSize(b.level)));
                                Span.fontColor(this.pal().textPrimary);
                            }, Span);
                        };
                        this.forEachUpdateFunction(elmtId, parseInlineCached(b.text), forEachItemGenFunction, (s: MdSpan, i: number) => `h-${b.key}-${i}-${s.text.length}`, false, true);
                    }, ForEach);
                    ForEach.pop();
                    Text.pop();
                });
            }
            else if (b.kind === MdBlockKind.Code) {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.CodeBlock.bind(this)(b);
                });
            }
            else if (b.kind === MdBlockKind.Divider) {
                this.ifElseBranchUpdateFunction(2, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Divider.create();
                        Divider.debugLine("entry/src/main/ets/components/MarkdownView.ets(135:7)", "entry");
                        Divider.color(this.pal().surfaceHi);
                        Divider.strokeWidth(1);
                        Divider.margin({ top: 6, bottom: 6 });
                    }, Divider);
                });
            }
            else if (b.kind === MdBlockKind.Quote) {
                this.ifElseBranchUpdateFunction(3, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        // ⚠️ 左侧竖条必须用**边框**，绝不能用 `Divider().vertical(true).height('100%')`：
                        // 父容器高度由内容决定时，子元素的百分比高度没有参照（循环测量）⇒ 竖条塌成 0 高、
                        // 引用块失去唯一视觉标识。边框宽度是固定值、随容器自身高度拉伸，不存在百分比依赖。
                        // 见 docs/ARKTS-GOTCHAS.md 第 12 条。同类：任何"内容定高"的父容器里都不要放百分比高度子元素。
                        Column.create();
                        Column.debugLine("entry/src/main/ets/components/MarkdownView.ets(141:7)", "entry");
                        // ⚠️ 左侧竖条必须用**边框**，绝不能用 `Divider().vertical(true).height('100%')`：
                        // 父容器高度由内容决定时，子元素的百分比高度没有参照（循环测量）⇒ 竖条塌成 0 高、
                        // 引用块失去唯一视觉标识。边框宽度是固定值、随容器自身高度拉伸，不存在百分比依赖。
                        // 见 docs/ARKTS-GOTCHAS.md 第 12 条。同类：任何"内容定高"的父容器里都不要放百分比高度子元素。
                        Column.width('100%');
                        // ⚠️ 左侧竖条必须用**边框**，绝不能用 `Divider().vertical(true).height('100%')`：
                        // 父容器高度由内容决定时，子元素的百分比高度没有参照（循环测量）⇒ 竖条塌成 0 高、
                        // 引用块失去唯一视觉标识。边框宽度是固定值、随容器自身高度拉伸，不存在百分比依赖。
                        // 见 docs/ARKTS-GOTCHAS.md 第 12 条。同类：任何"内容定高"的父容器里都不要放百分比高度子元素。
                        Column.alignItems(HorizontalAlign.Start);
                        // ⚠️ 左侧竖条必须用**边框**，绝不能用 `Divider().vertical(true).height('100%')`：
                        // 父容器高度由内容决定时，子元素的百分比高度没有参照（循环测量）⇒ 竖条塌成 0 高、
                        // 引用块失去唯一视觉标识。边框宽度是固定值、随容器自身高度拉伸，不存在百分比依赖。
                        // 见 docs/ARKTS-GOTCHAS.md 第 12 条。同类：任何"内容定高"的父容器里都不要放百分比高度子元素。
                        Column.padding({ left: 11, right: 8, top: 8, bottom: 8 });
                        // ⚠️ 左侧竖条必须用**边框**，绝不能用 `Divider().vertical(true).height('100%')`：
                        // 父容器高度由内容决定时，子元素的百分比高度没有参照（循环测量）⇒ 竖条塌成 0 高、
                        // 引用块失去唯一视觉标识。边框宽度是固定值、随容器自身高度拉伸，不存在百分比依赖。
                        // 见 docs/ARKTS-GOTCHAS.md 第 12 条。同类：任何"内容定高"的父容器里都不要放百分比高度子元素。
                        Column.backgroundColor(this.pal().surface);
                        // ⚠️ 左侧竖条必须用**边框**，绝不能用 `Divider().vertical(true).height('100%')`：
                        // 父容器高度由内容决定时，子元素的百分比高度没有参照（循环测量）⇒ 竖条塌成 0 高、
                        // 引用块失去唯一视觉标识。边框宽度是固定值、随容器自身高度拉伸，不存在百分比依赖。
                        // 见 docs/ARKTS-GOTCHAS.md 第 12 条。同类：任何"内容定高"的父容器里都不要放百分比高度子元素。
                        Column.borderRadius(6);
                        // ⚠️ 左侧竖条必须用**边框**，绝不能用 `Divider().vertical(true).height('100%')`：
                        // 父容器高度由内容决定时，子元素的百分比高度没有参照（循环测量）⇒ 竖条塌成 0 高、
                        // 引用块失去唯一视觉标识。边框宽度是固定值、随容器自身高度拉伸，不存在百分比依赖。
                        // 见 docs/ARKTS-GOTCHAS.md 第 12 条。同类：任何"内容定高"的父容器里都不要放百分比高度子元素。
                        Column.border({ width: { left: 3, top: 0, right: 0, bottom: 0 }, color: this.pal().textMuted });
                    }, Column);
                    this.Inline.bind(this)(b.text);
                    // ⚠️ 左侧竖条必须用**边框**，绝不能用 `Divider().vertical(true).height('100%')`：
                    // 父容器高度由内容决定时，子元素的百分比高度没有参照（循环测量）⇒ 竖条塌成 0 高、
                    // 引用块失去唯一视觉标识。边框宽度是固定值、随容器自身高度拉伸，不存在百分比依赖。
                    // 见 docs/ARKTS-GOTCHAS.md 第 12 条。同类：任何"内容定高"的父容器里都不要放百分比高度子元素。
                    Column.pop();
                });
            }
            else if (b.kind === MdBlockKind.List) {
                this.ifElseBranchUpdateFunction(4, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create({ space: 3 });
                        Column.debugLine("entry/src/main/ets/components/MarkdownView.ets(151:7)", "entry");
                        Column.width('100%');
                        Column.alignItems(HorizontalAlign.Start);
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = (_item, k: number) => {
                            const item = _item;
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Row.create({ space: 6 });
                                Row.debugLine("entry/src/main/ets/components/MarkdownView.ets(153:11)", "entry");
                                Row.width('100%');
                                Row.alignItems(VerticalAlign.Top);
                                Row.padding({ left: b.level * 12 });
                            }, Row);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create(b.ordered ? `${k + 1}.` : '•');
                                Text.debugLine("entry/src/main/ets/components/MarkdownView.ets(154:13)", "entry");
                                Text.fontSize(14);
                                Text.fontColor(this.pal().textSecondary);
                                Text.margin({ top: 2 });
                            }, Text);
                            Text.pop();
                            this.Inline.bind(this)(item);
                            Row.pop();
                        };
                        this.forEachUpdateFunction(elmtId, b.items, forEachItemGenFunction, (item: string, k: number) => `${b.key}-li${k}`, true, true);
                    }, ForEach);
                    ForEach.pop();
                    Column.pop();
                });
            }
            else if (b.kind === MdBlockKind.Table) {
                this.ifElseBranchUpdateFunction(5, () => {
                    this.TableBlock.bind(this)(b);
                });
            }
            else {
                this.ifElseBranchUpdateFunction(6, () => {
                    this.Inline.bind(this)(b.text);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        // 图片：xbot 的图片引用是 cookie 鉴权端点（ArkUI Image(url) 不带 cookie）
                        // ⇒ 由页面取字节，AuthImage 负责解码/显示/缓存；点按交给查看器。
                        ForEach.create();
                        const forEachItemGenFunction = (_item, k: number) => {
                            const src = _item;
                            {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    if (isInitialRender) {
                                        let componentCall = new AuthImage(this, {
                                            src: src,
                                            load: this.loadImage,
                                            onOpen: this.onImage,
                                            maxHeight: this.imageMaxHeight,
                                            theme: this.theme,
                                        }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/components/MarkdownView.ets", line: 174, col: 9 });
                                        ViewPU.create(componentCall);
                                        let paramsLambda = () => {
                                            return {
                                                src: src,
                                                load: this.loadImage,
                                                onOpen: this.onImage,
                                                maxHeight: this.imageMaxHeight,
                                                theme: this.theme
                                            };
                                        };
                                        componentCall.paramsGenerator_ = paramsLambda;
                                    }
                                    else {
                                        this.updateStateVarsOfChildByElmtId(elmtId, {
                                            theme: this.theme
                                        });
                                    }
                                }, { name: "AuthImage" });
                            }
                        };
                        this.forEachUpdateFunction(elmtId, imagesIn(b.text), forEachItemGenFunction, (src: string, k: number) => `${b.key}-img${k}`, true, true);
                    }, ForEach);
                    // 图片：xbot 的图片引用是 cookie 鉴权端点（ArkUI Image(url) 不带 cookie）
                    // ⇒ 由页面取字节，AuthImage 负责解码/显示/缓存；点按交给查看器。
                    ForEach.pop();
                });
            }
        }, If);
        If.pop();
    }
    /** 段落/引用/列表项的行内渲染（零条件分支：样式全部预计算）。 */
    Inline(text: string, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create();
            Text.debugLine("entry/src/main/ets/components/MarkdownView.ets(188:5)", "entry");
            Text.width('100%');
            Text.textAlign(TextAlign.Start);
            Text.wordBreak(WordBreak.BREAK_ALL);
        }, Text);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const s = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Span.create(s.text);
                    Span.debugLine("entry/src/main/ets/components/MarkdownView.ets(190:9)", "entry");
                    Span.fontSize(this.sz(s.size));
                    Span.fontColor(s.color);
                    Span.fontWeight(s.bold ? FontWeight.Bold : FontWeight.Normal);
                    Span.fontStyle(s.italic ? FontStyle.Italic : FontStyle.Normal);
                    Span.fontFamily(s.mono ? 'monospace' : 'sans-serif');
                    Span.backgroundColor(s.bg);
                    Span.decoration({
                        type: s.strike ? TextDecorationType.LineThrough
                            : (s.underline ? TextDecorationType.Underline : TextDecorationType.None),
                        color: s.color,
                    });
                }, Span);
            };
            this.forEachUpdateFunction(elmtId, inlineStyles(text, this.pal()), forEachItemGenFunction, (s: MdInlineStyle, i: number) => `sp-${i}-${s.text.length}`, false, true);
        }, ForEach);
        ForEach.pop();
        Text.pop();
    }
    /** 统一字号缩放入口（所有正文/标题/代码都经这里，避免漏改一处导致大小不一致）。 */
    private sz(n: number): number {
        return n * this.fontScale;
    }
    CodeBlock(b: MdBlock, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("entry/src/main/ets/components/MarkdownView.ets(218:5)", "entry");
            Column.width('100%');
            Column.backgroundColor(this.pal().surfaceAlt);
            Column.borderRadius(8);
            Column.border({ width: 1, color: this.pal().border });
            Column.margin({ top: 4, bottom: 4 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/components/MarkdownView.ets(219:7)", "entry");
            Row.width('100%');
            Row.padding({ left: 12, right: 12, top: 8, bottom: 4 });
            Row.backgroundColor(this.pal().surfaceAlt);
            Row.borderRadius({ topLeft: 10, topRight: 10 });
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(b.lang.length > 0 ? b.lang : 'code');
            Text.debugLine("entry/src/main/ets/components/MarkdownView.ets(220:9)", "entry");
            Text.fontSize(11);
            Text.fontColor(this.pal().textSecondary);
            Text.layoutWeight(1);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('复制');
            Text.debugLine("entry/src/main/ets/components/MarkdownView.ets(224:9)", "entry");
            Text.fontSize(11);
            Text.fontColor(this.pal().accentSoft);
            Text.onClick(() => {
                // 剪贴板：用 pasteboard（`getContext(this).getApplicationContext().getPasteboard()` 不是 ArkTS API）
                try {
                    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, b.code);
                    pasteboard.getSystemPasteboard().setData(data);
                }
                catch (e) {
                    console.error('copy failed');
                }
            });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(b.code);
            Text.debugLine("entry/src/main/ets/components/MarkdownView.ets(243:7)", "entry");
            Text.wordBreak(this.wrapCode ? WordBreak.BREAK_ALL : WordBreak.NORMAL);
            Text.fontFamily('monospace');
            Text.fontSize(13);
            Text.fontColor(this.pal().textPrimary);
            Text.width('100%');
            Text.padding(10);
            Text.textAlign(TextAlign.Start);
            Text.maxLines(1000);
            Text.textOverflow({ overflow: TextOverflow.Clip });
        }, Text);
        Text.pop();
        Column.pop();
    }
    /**
     * 表格：**列数决定形态**。
     *
     * - ≤4 列：等宽网格（手机上每列仍可读）
     * - ≥5 列：堆叠成「字段: 值」—— 等宽网格在手机上会把每列压成 ~40dp 的**竖条**，
     *   中文完全不可读（实测真实会话里存在 5/7/8 列表格：`{2:544,3:490,5:267,4:218,8:6,7:5}`），
     *   这正是"渲染整个都是错乱的、完全用不了"的成因之一。
     *   堆叠形态只用 Column/Row/Text —— 都是真机已验证可渲染的构件（登录页已证明）。
     */
    TableBlock(b: MdBlock, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("entry/src/main/ets/components/MarkdownView.ets(274:5)", "entry");
            Column.width('100%');
            Column.border({ width: 1, color: this.pal().border });
            Column.borderRadius(8);
            Column.clip(true);
            Column.margin({ top: 4, bottom: 4 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (useTableGrid(b.header.length)) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create();
                        Row.debugLine("entry/src/main/ets/components/MarkdownView.ets(276:9)", "entry");
                        Row.width('100%');
                        Row.backgroundColor(this.pal().surfaceHi);
                        Row.borderRadius({ topLeft: 10, topRight: 10 });
                        Row.padding({ left: 2, right: 2 });
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = _item => {
                            const h = _item;
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create(h);
                                Text.debugLine("entry/src/main/ets/components/MarkdownView.ets(278:13)", "entry");
                                Text.wordBreak(WordBreak.BREAK_ALL);
                                Text.fontSize(13);
                                Text.fontWeight(FontWeight.Bold);
                                Text.fontColor(this.pal().textPrimary);
                                Text.layoutWeight(1);
                                Text.padding(6);
                            }, Text);
                            Text.pop();
                        };
                        this.forEachUpdateFunction(elmtId, b.header, forEachItemGenFunction, (h: string, k: number) => `${b.key}-th${k}`, false, true);
                    }, ForEach);
                    ForEach.pop();
                    Row.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = (_item, ri: number) => {
                            const row = _item;
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Row.create();
                                Row.debugLine("entry/src/main/ets/components/MarkdownView.ets(293:11)", "entry");
                                Row.width('100%');
                                Row.border({ width: { top: 1 }, color: this.pal().border });
                            }, Row);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                ForEach.create();
                                const forEachItemGenFunction = (_item, ci: number) => {
                                    const cell = _item;
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create(cell);
                                        Text.debugLine("entry/src/main/ets/components/MarkdownView.ets(295:15)", "entry");
                                        Text.wordBreak(WordBreak.BREAK_ALL);
                                        Text.fontSize(13);
                                        Text.fontColor(this.pal().textPrimary);
                                        Text.layoutWeight(1);
                                        Text.padding(6);
                                    }, Text);
                                    Text.pop();
                                };
                                this.forEachUpdateFunction(elmtId, row, forEachItemGenFunction, (cell: string, ci: number) => `${b.key}-td${ri}-${ci}`, true, true);
                            }, ForEach);
                            ForEach.pop();
                            Row.pop();
                        };
                        this.forEachUpdateFunction(elmtId, b.rows, forEachItemGenFunction, (row: string[], ri: number) => `${b.key}-tr${ri}`, true, true);
                    }, ForEach);
                    ForEach.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create();
                        Row.debugLine("entry/src/main/ets/components/MarkdownView.ets(307:9)", "entry");
                        Row.width('100%');
                        Row.padding({ left: 8, right: 8, top: 6, bottom: 4 });
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(`📋 表格（${b.header.length} 列 · ${b.rows.length} 行）`);
                        Text.debugLine("entry/src/main/ets/components/MarkdownView.ets(308:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textSecondary);
                    }, Text);
                    Text.pop();
                    Row.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = (_item, ri: number) => {
                            const row = _item;
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Column.create({ space: 3 });
                                Column.debugLine("entry/src/main/ets/components/MarkdownView.ets(315:11)", "entry");
                                Column.width('100%');
                                Column.alignItems(HorizontalAlign.Start);
                                Column.padding({ left: 8, right: 8, top: 6, bottom: 6 });
                                Column.border({ width: { top: ri === 0 ? 0 : 1 }, color: this.pal().border });
                            }, Column);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                ForEach.create();
                                const forEachItemGenFunction = (_item, fi: number) => {
                                    const f = _item;
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Row.create({ space: 6 });
                                        Row.debugLine("entry/src/main/ets/components/MarkdownView.ets(317:15)", "entry");
                                        Row.width('100%');
                                        Row.alignItems(VerticalAlign.Top);
                                    }, Row);
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create(f.label);
                                        Text.debugLine("entry/src/main/ets/components/MarkdownView.ets(318:17)", "entry");
                                        Text.fontSize(12);
                                        Text.fontColor(this.pal().textSecondary);
                                        Text.constraintSize({ minWidth: 84 });
                                    }, Text);
                                    Text.pop();
                                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                                        Text.create(f.value);
                                        Text.debugLine("entry/src/main/ets/components/MarkdownView.ets(321:17)", "entry");
                                        Text.wordBreak(WordBreak.BREAK_ALL);
                                        Text.fontSize(13);
                                        Text.fontColor(this.pal().textPrimary);
                                        Text.layoutWeight(1);
                                    }, Text);
                                    Text.pop();
                                    Row.pop();
                                };
                                this.forEachUpdateFunction(elmtId, tableRowFields(b.header, row), forEachItemGenFunction, (f: TableField, fi: number) => `${b.key}-s${ri}-${fi}`, true, true);
                            }, ForEach);
                            ForEach.pop();
                            Column.pop();
                        };
                        this.forEachUpdateFunction(elmtId, b.rows, forEachItemGenFunction, (row: string[], ri: number) => `${b.key}-sr${ri}`, true, true);
                    }, ForEach);
                    ForEach.pop();
                });
            }
        }, If);
        If.pop();
        Column.pop();
    }
    private headingSize(level: number): number {
        if (level <= 1) {
            return 20;
        }
        if (level === 2) {
            return 18;
        }
        if (level === 3) {
            return 16;
        }
        return 15;
    }
    rerender() {
        this.updateDirtyElements();
    }
}
