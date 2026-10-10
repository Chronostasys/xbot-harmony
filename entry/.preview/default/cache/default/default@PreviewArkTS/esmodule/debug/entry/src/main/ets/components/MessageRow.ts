if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface MessageRowView_Params {
    row?: ChatRow;
    theme?: string;
    fontScaleV?: number;
    wrapCodeV?: boolean;
    sweepX?: number;
    onImage?: (src: string) => void;
    loadImage?: (src: string) => Promise<ArrayBuffer>;
    onLoadMoreRegions?: () => void;
    onOpenCtx?: (iter: number, toolName: string) => void;
    onToggleTool?: (iter: number, toolName: string) => void;
    onRowLongPress?: () => void;
    /** 复制文本（页面对接系统剪贴板；组件不做 IO/系统调用） */
    onCopy?: (text: string, what: string) => void;
    openReasonKey?: string;
    openToolKey?: string;
    expandedTurn?: string;
}
import type { ChatRow, HistoryIteration, ToolProgress } from '../core/types';
import { displayContent, displayReasoning, tailOwnedIteration } from "@normalized:N&&&entry/src/main/ets/core/streammerge&";
import { runeCount } from "@normalized:N&&&entry/src/main/ets/core/typewriter&";
import { paletteOf } from "@normalized:N&&&entry/src/main/ets/core/theme&";
import type { Palette } from "@normalized:N&&&entry/src/main/ets/core/theme&";
import { MarkdownView } from "@normalized:N&&&entry/src/main/ets/components/MarkdownView&";
/** 行内最多直出多少个迭代（其余折叠 —— 与页面原有窗口一致）。 */
const MAX_ITER_VISIBLE: number = 8;
export class MessageRowView extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__row = new SynchedPropertyNesedObjectPU(params.row, this, "row");
        this.__theme = new SynchedPropertySimpleOneWayPU(params.theme, this, "theme");
        this.__fontScaleV = new SynchedPropertySimpleOneWayPU(params.fontScaleV, this, "fontScaleV");
        this.__wrapCodeV = new SynchedPropertySimpleOneWayPU(params.wrapCodeV, this, "wrapCodeV");
        this.__sweepX = new SynchedPropertySimpleOneWayPU(params.sweepX, this, "sweepX");
        this.onImage = (src: string) => {
        };
        this.loadImage = async (s: string) => {
            return new ArrayBuffer(0);
        };
        this.onLoadMoreRegions = () => {
        };
        this.onOpenCtx = (iter: number, toolName: string) => {
        };
        this.onToggleTool = (iter: number, toolName: string) => {
        };
        this.onRowLongPress = () => {
        };
        this.onCopy = (text: string, what: string) => {
        };
        this.__openReasonKey = new ObservedPropertySimplePU('', this, "openReasonKey");
        this.__openToolKey = new ObservedPropertySimplePU('', this, "openToolKey");
        this.__expandedTurn = new ObservedPropertySimplePU('', this, "expandedTurn");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: MessageRowView_Params) {
        this.__row.set(params.row);
        if (params.theme === undefined) {
            this.__theme.set('dark');
        }
        if (params.fontScaleV === undefined) {
            this.__fontScaleV.set(1);
        }
        if (params.wrapCodeV === undefined) {
            this.__wrapCodeV.set(true);
        }
        if (params.sweepX === undefined) {
            this.__sweepX.set(0);
        }
        if (params.onImage !== undefined) {
            this.onImage = params.onImage;
        }
        if (params.loadImage !== undefined) {
            this.loadImage = params.loadImage;
        }
        if (params.onLoadMoreRegions !== undefined) {
            this.onLoadMoreRegions = params.onLoadMoreRegions;
        }
        if (params.onOpenCtx !== undefined) {
            this.onOpenCtx = params.onOpenCtx;
        }
        if (params.onToggleTool !== undefined) {
            this.onToggleTool = params.onToggleTool;
        }
        if (params.onRowLongPress !== undefined) {
            this.onRowLongPress = params.onRowLongPress;
        }
        if (params.onCopy !== undefined) {
            this.onCopy = params.onCopy;
        }
        if (params.openReasonKey !== undefined) {
            this.openReasonKey = params.openReasonKey;
        }
        if (params.openToolKey !== undefined) {
            this.openToolKey = params.openToolKey;
        }
        if (params.expandedTurn !== undefined) {
            this.expandedTurn = params.expandedTurn;
        }
    }
    updateStateVars(params: MessageRowView_Params) {
        this.__row.set(params.row);
        this.__theme.reset(params.theme);
        this.__fontScaleV.reset(params.fontScaleV);
        this.__wrapCodeV.reset(params.wrapCodeV);
        this.__sweepX.reset(params.sweepX);
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__row.purgeDependencyOnElmtId(rmElmtId);
        this.__theme.purgeDependencyOnElmtId(rmElmtId);
        this.__fontScaleV.purgeDependencyOnElmtId(rmElmtId);
        this.__wrapCodeV.purgeDependencyOnElmtId(rmElmtId);
        this.__sweepX.purgeDependencyOnElmtId(rmElmtId);
        this.__openReasonKey.purgeDependencyOnElmtId(rmElmtId);
        this.__openToolKey.purgeDependencyOnElmtId(rmElmtId);
        this.__expandedTurn.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__row.aboutToBeDeleted();
        this.__theme.aboutToBeDeleted();
        this.__fontScaleV.aboutToBeDeleted();
        this.__wrapCodeV.aboutToBeDeleted();
        this.__sweepX.aboutToBeDeleted();
        this.__openReasonKey.aboutToBeDeleted();
        this.__openToolKey.aboutToBeDeleted();
        this.__expandedTurn.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __row: SynchedPropertyNesedObjectPU<ChatRow>;
    get row() {
        return this.__row.get();
    }
    private __theme: SynchedPropertySimpleOneWayPU<string>;
    get theme() {
        return this.__theme.get();
    }
    set theme(newValue: string) {
        this.__theme.set(newValue);
    }
    private __fontScaleV: SynchedPropertySimpleOneWayPU<number>;
    get fontScaleV() {
        return this.__fontScaleV.get();
    }
    set fontScaleV(newValue: number) {
        this.__fontScaleV.set(newValue);
    }
    private __wrapCodeV: SynchedPropertySimpleOneWayPU<boolean>;
    get wrapCodeV() {
        return this.__wrapCodeV.get();
    }
    set wrapCodeV(newValue: boolean) {
        this.__wrapCodeV.set(newValue);
    }
    /** 运行中工具 pill 的流光位置（页面统一推进 ⇒ 每行不再各开定时器） */
    private __sweepX: SynchedPropertySimpleOneWayPU<number>;
    get sweepX() {
        return this.__sweepX.get();
    }
    set sweepX(newValue: number) {
        this.__sweepX.set(newValue);
    }
    private onImage: (src: string) => void;
    private loadImage: (src: string) => Promise<ArrayBuffer>;
    private onLoadMoreRegions: () => void;
    private onOpenCtx: (iter: number, toolName: string) => void;
    private onToggleTool: (iter: number, toolName: string) => void;
    private onRowLongPress: () => void;
    /** 复制文本（页面对接系统剪贴板；组件不做 IO/系统调用） */
    private onCopy: (text: string, what: string) => void;
    private __openReasonKey: ObservedPropertySimplePU<string>;
    get openReasonKey() {
        return this.__openReasonKey.get();
    }
    set openReasonKey(newValue: string) {
        this.__openReasonKey.set(newValue);
    }
    private __openToolKey: ObservedPropertySimplePU<string>;
    get openToolKey() {
        return this.__openToolKey.get();
    }
    set openToolKey(newValue: string) {
        this.__openToolKey.set(newValue);
    }
    private __expandedTurn: ObservedPropertySimplePU<string>;
    get expandedTurn() {
        return this.__expandedTurn.get();
    }
    set expandedTurn(newValue: string) {
        this.__expandedTurn.set(newValue);
    }
    private pal(): Palette {
        return paletteOf(this.theme);
    }
    /**
     * 该迭代是否由"列表尾的 LiveTail"承担（= live 行的**最后一个迭代**，即进行中的那个）。
     *
     * 互斥保证同一迭代不会被画两遍；而它**之前**的迭代仍在本组件里渲染 ——
     * 这正是"每个迭代完成就消失、永远只能看到最新迭代"的修复点。
     */
    private isTailOwned(it: HistoryIteration): boolean {
        return tailOwnedIteration(this.row, it);
    }
    private toolKey(turnID: number, iter: number, name: string): string {
        return `${turnID}:${iter}:${name}`;
    }
    private toolIcon(t: ToolProgress): string {
        if (t.status === 'generating') {
            return '◐';
        }
        if (t.status === 'running') {
            return '●';
        }
        if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
            return '✗';
        }
        if (t.status === 'pending') {
            return '○';
        }
        return '✓';
    }
    private toolColor(t: ToolProgress): string {
        if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
            return this.pal().dangerText;
        }
        if (t.status === 'running' || t.status === 'generating') {
            return this.pal().accentSoft;
        }
        return this.pal().textSecondary;
    }
    private toolStatusBadge(t: ToolProgress): string {
        if (t.status === 'generating') {
            const n: number = t.gen_chars !== undefined ? t.gen_chars : 0;
            return n > 0 ? `生成中 ${n} 字` : '生成中…';
        }
        if (t.status === 'running') {
            const ms: number = t.elapsed_ms !== undefined ? t.elapsed_ms : 0;
            return ms > 0 ? `${(ms / 1000).toFixed(1)}s` : '运行中';
        }
        if (t.status === 'error') {
            return t.exit_code !== undefined && t.exit_code !== 0 ? `失败 exit ${t.exit_code}` : '失败';
        }
        if (t.status === 'pending') {
            return '排队';
        }
        return '';
    }
    private toolLabel(t: ToolProgress): string {
        const base: string = t.label !== undefined && t.label.length > 0 ? t.label : t.name;
        const badge: string = this.toolStatusBadge(t);
        return badge.length > 0 ? `${base} ${badge}` : base;
    }
    private itersFor(row: ChatRow): HistoryIteration[] {
        const all: HistoryIteration[] = row.iterations;
        if (this.expandedTurn === row.id || all.length <= MAX_ITER_VISIBLE) {
            return all;
        }
        return all.slice(all.length - MAX_ITER_VISIBLE);
    }
    private hiddenIterCount(row: ChatRow): number {
        if (this.expandedTurn === row.id) {
            return 0;
        }
        return row.iterations.length > MAX_ITER_VISIBLE ? row.iterations.length - MAX_ITER_VISIBLE : 0;
    }
    AssistantBlock(row: ChatRow, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/components/MessageRow.ets(136:5)", "entry");
            Column.width('100%');
            Column.alignItems(HorizontalAlign.Start);
            Column.padding({ left: 12, right: 12, top: 10, bottom: 10 });
            Column.backgroundColor(this.pal().surface);
            Column.borderRadius(14);
            Column.border({ width: 1, color: this.pal().border });
            Column.shadow({ radius: 10, color: '#14000000', offsetX: 0, offsetY: 2 });
            Column.margin({ top: 4, bottom: 4 });
            Gesture.create(GesturePriority.Low);
            LongPressGesture.create();
            LongPressGesture.onAction(() => {
                this.onRowLongPress();
            });
            LongPressGesture.pop();
            Gesture.pop();
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (row.content.length > 0 && row.iterations.length === 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            if (isInitialRender) {
                                let componentCall = new MarkdownView(this, {
                                    text: row.content,
                                    onImage: (src: string) => {
                                        this.onImage(src);
                                    },
                                    loadImage: (src: string) => {
                                        return this.loadImage(src);
                                    },
                                    fontScale: this.fontScaleV,
                                    wrapCode: this.wrapCodeV,
                                    theme: this.theme,
                                }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/components/MessageRow.ets", line: 138, col: 9 });
                                ViewPU.create(componentCall);
                                let paramsLambda = () => {
                                    return {
                                        text: row.content,
                                        onImage: (src: string) => {
                                            this.onImage(src);
                                        },
                                        loadImage: (src: string) => {
                                            return this.loadImage(src);
                                        },
                                        fontScale: this.fontScaleV,
                                        wrapCode: this.wrapCodeV,
                                        theme: this.theme
                                    };
                                };
                                componentCall.paramsGenerator_ = paramsLambda;
                            }
                            else {
                                this.updateStateVarsOfChildByElmtId(elmtId, {
                                    text: row.content,
                                    fontScale: this.fontScaleV,
                                    wrapCode: this.wrapCodeV,
                                    theme: this.theme
                                });
                            }
                        }, { name: "MarkdownView" });
                    }
                });
            }
            // 服务端折叠视图：更早的展示区域需按需取回（与 Web 端「⌃ 更早的 N 个区域」同源）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 服务端折叠视图：更早的展示区域需按需取回（与 Web 端「⌃ 更早的 N 个区域」同源）
            if (row.regionsBefore > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create({ space: 6 });
                        Row.debugLine("entry/src/main/ets/components/MessageRow.ets(153:9)", "entry");
                        Row.width('100%');
                        Row.padding({ top: 4, bottom: 4 });
                        Row.onClick(() => {
                            this.onLoadMoreRegions();
                        });
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(`⌃ 更早的 ${row.regionsBefore} 个区域`);
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(154:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().warn);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('（点击加载）');
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(155:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textMuted);
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
            If.create();
            if (this.hiddenIterCount(row) > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create({ space: 6 });
                        Row.debugLine("entry/src/main/ets/components/MessageRow.ets(164:9)", "entry");
                        Row.width('100%');
                        Row.padding({ top: 4, bottom: 4 });
                        Row.onClick(() => {
                            this.expandedTurn = row.id;
                        });
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(`↑ 已折叠更早的 ${this.hiddenIterCount(row)} 个迭代`);
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(165:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().accentSoft);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('（点击展开全部）');
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(167:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textMuted);
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
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const it = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    If.create();
                    if (!this.isTailOwned(it)) {
                        this.ifElseBranchUpdateFunction(0, () => {
                            this.IterationBlock.bind(this)(row, it);
                        });
                    }
                    else {
                        this.ifElseBranchUpdateFunction(1, () => {
                        });
                    }
                }, If);
                If.pop();
            };
            this.forEachUpdateFunction(elmtId, this.itersFor(row), forEachItemGenFunction, (it: HistoryIteration) => `${row.id}#${row.rev}-${it.iteration}`, false, false);
        }, ForEach);
        ForEach.pop();
        Column.pop();
    }
    IterationBlock(row: ChatRow, it: HistoryIteration, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/components/MessageRow.ets(196:5)", "entry");
            Column.width('100%');
            Column.alignItems(HorizontalAlign.Start);
            Column.padding({ top: 4, bottom: 4 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // web 形态：**没有"迭代 N"这种标题**，只有一条可展开的「思考 N 字」
            if (displayReasoning(it).length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create({ space: 6 });
                        Row.debugLine("entry/src/main/ets/components/MessageRow.ets(199:9)", "entry");
                        Row.padding({ top: 2, bottom: 2 });
                        ViewStackProcessor.visualState("pressed");
                        Row.opacity(0.6);
                        ViewStackProcessor.visualState("normal");
                        Row.opacity(1);
                        ViewStackProcessor.visualState();
                        Row.onClick(() => {
                            const key: string = `${row.id}-${it.iteration}`;
                            this.openReasonKey = this.openReasonKey === key ? '' : key;
                        });
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('✳');
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(200:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textMuted);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(`思考 ${runeCount(displayReasoning(it))} 字`);
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(201:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textSecondary);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.openReasonKey === `${row.id}-${it.iteration}` ? '▾' : '▸');
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(203:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textMuted);
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
            If.create();
            if (displayReasoning(it).length > 0
                && this.openReasonKey === `${row.id}-${it.iteration}`) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(displayReasoning(it));
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(216:9)", "entry");
                        Text.wordBreak(WordBreak.BREAK_ALL);
                        Text.fontSize(13);
                        Text.fontColor(this.pal().textSecondary);
                        Text.padding(8);
                        Text.width('100%');
                        Text.backgroundColor(this.pal().surface);
                        Text.borderRadius(8);
                        Text.copyOption(CopyOptions.LocalDevice);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (displayContent(it).length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            if (isInitialRender) {
                                let componentCall = new MarkdownView(this, {
                                    text: displayContent(it),
                                    onImage: (src: string) => {
                                        this.onImage(src);
                                    },
                                    loadImage: (src: string) => {
                                        return this.loadImage(src);
                                    },
                                    fontScale: this.fontScaleV,
                                    wrapCode: this.wrapCodeV,
                                    theme: this.theme,
                                }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/components/MessageRow.ets", line: 224, col: 9 });
                                ViewPU.create(componentCall);
                                let paramsLambda = () => {
                                    return {
                                        text: displayContent(it),
                                        onImage: (src: string) => {
                                            this.onImage(src);
                                        },
                                        loadImage: (src: string) => {
                                            return this.loadImage(src);
                                        },
                                        fontScale: this.fontScaleV,
                                        wrapCode: this.wrapCodeV,
                                        theme: this.theme
                                    };
                                };
                                componentCall.paramsGenerator_ = paramsLambda;
                            }
                            else {
                                this.updateStateVarsOfChildByElmtId(elmtId, {
                                    text: displayContent(it),
                                    fontScale: this.fontScaleV,
                                    wrapCode: this.wrapCodeV,
                                    theme: this.theme
                                });
                            }
                        }, { name: "MarkdownView" });
                    }
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (it.tools !== undefined && it.tools.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Flex.create({ wrap: FlexWrap.Wrap });
                        Flex.debugLine("entry/src/main/ets/components/MessageRow.ets(239:9)", "entry");
                        Flex.width('100%');
                    }, Flex);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = _item => {
                            const t = _item;
                            this.ToolPill.bind(this)(row, it, t);
                        };
                        this.forEachUpdateFunction(elmtId, it.tools, forEachItemGenFunction, (t: ToolProgress, ti: number) => `${this.toolKey(row.turnID, it.iteration, t.name)}#${t.call_id !== undefined ? t.call_id : ''}#${ti}`, false, true);
                    }, ForEach);
                    ForEach.pop();
                    Flex.pop();
                });
            }
            // 工具详情（点击 pill 展开）
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 工具详情（点击 pill 展开）
            if (this.openToolKey.startsWith(`${row.turnID}:${it.iteration}:`) && it.tools !== undefined) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = _item => {
                            const t = _item;
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                If.create();
                                if (this.openToolKey === this.toolKey(row.turnID, it.iteration, t.name)) {
                                    this.ifElseBranchUpdateFunction(0, () => {
                                        this.ToolDetail.bind(this)(t);
                                    });
                                }
                                else {
                                    this.ifElseBranchUpdateFunction(1, () => {
                                    });
                                }
                            }, If);
                            If.pop();
                        };
                        this.forEachUpdateFunction(elmtId, it.tools, forEachItemGenFunction, (t: ToolProgress, ti: number) => `d-${this.toolKey(row.turnID, it.iteration, t.name)}#${ti}`, false, true);
                    }, ForEach);
                    ForEach.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        Column.pop();
    }
    ToolPill(row: ChatRow, it: HistoryIteration, t: ToolProgress, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Stack.create();
            Stack.debugLine("entry/src/main/ets/components/MessageRow.ets(261:5)", "entry");
            Stack.clip(true);
            Stack.backgroundColor(this.pal().surfaceAlt);
            Stack.borderRadius(6);
            Stack.border({ width: 1, color: this.openToolKey === this.toolKey(row.turnID, it.iteration, t.name) ? this.pal().accent : this.pal().border });
            ViewStackProcessor.visualState("pressed");
            Stack.opacity(0.75);
            ViewStackProcessor.visualState("normal");
            Stack.opacity(1);
            ViewStackProcessor.visualState();
            Stack.onClick(() => {
                this.onToggleTool(it.iteration, t.name);
            });
            Gesture.create(GesturePriority.Low);
            LongPressGesture.create();
            LongPressGesture.onAction(() => {
                this.onOpenCtx(it.iteration, t.name);
            });
            LongPressGesture.pop();
            Gesture.pop();
        }, Stack);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create({ space: 4 });
            Row.debugLine("entry/src/main/ets/components/MessageRow.ets(262:7)", "entry");
            Row.padding({ left: 8, right: 8, top: 5, bottom: 5 });
            Row.margin(3);
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (t.status === 'generating' || t.status === 'running') {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        // 原生指示器（会动）。之前用静态字符 "◐" —— 既不动、也是 TUI 观感（用户明确否掉）
                        LoadingProgress.create();
                        LoadingProgress.debugLine("entry/src/main/ets/components/MessageRow.ets(265:9)", "entry");
                        // 原生指示器（会动）。之前用静态字符 "◐" —— 既不动、也是 TUI 观感（用户明确否掉）
                        LoadingProgress.width(13);
                        // 原生指示器（会动）。之前用静态字符 "◐" —— 既不动、也是 TUI 观感（用户明确否掉）
                        LoadingProgress.height(13);
                        // 原生指示器（会动）。之前用静态字符 "◐" —— 既不动、也是 TUI 观感（用户明确否掉）
                        LoadingProgress.color(this.toolColor(t));
                    }, LoadingProgress);
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.toolIcon(t));
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(267:9)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.toolColor(t));
                    }, Text);
                    Text.pop();
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.toolLabel(t));
            Text.debugLine("entry/src/main/ets/components/MessageRow.ets(270:7)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.toolColor(t));
            Text.maxLines(1);
            Text.textOverflow({ overflow: TextOverflow.Ellipsis });
            Text.constraintSize({ maxWidth: 200 });
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 运行中：一道流光扫过（纯 transform ⇒ 不触发布局，触屏也稳）
            if (t.status === 'running' || t.status === 'generating') {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create();
                        Row.debugLine("entry/src/main/ets/components/MessageRow.ets(281:9)", "entry");
                        Row.width(46);
                        Row.height('100%');
                        Row.linearGradient({ angle: 90, colors: [
                                [this.pal().accentSoftFade, 0.0], [this.pal().accentSoft, 0.5], [this.pal().accentSoftFade, 1.0],
                            ] });
                        Row.opacity(0.35);
                        Row.translate({ x: this.sweepX });
                        Row.hitTestBehavior(HitTestMode.None);
                    }, Row);
                    Row.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        Stack.pop();
    }
    ToolDetail(t: ToolProgress, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 4 });
            Column.debugLine("entry/src/main/ets/components/MessageRow.ets(306:5)", "entry");
            Column.width('100%');
            Column.padding(8);
            Column.backgroundColor(this.pal().surface);
            Column.borderRadius(8);
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (t.summary !== undefined && t.summary.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(t.summary);
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(308:9)", "entry");
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textSecondary);
                        Text.width('100%');
                        Text.wordBreak(WordBreak.BREAK_ALL);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (t.args !== undefined && t.args.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('参数');
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(312:9)", "entry");
                        Text.fontSize(10);
                        Text.fontColor(this.pal().textMuted);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(t.args);
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(313:9)", "entry");
                        Text.wordBreak(WordBreak.BREAK_ALL);
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textPrimary);
                        Text.fontFamily('monospace');
                        Text.width('100%');
                        Text.padding(6);
                        Text.backgroundColor(this.pal().surfaceAlt);
                        Text.borderRadius(6);
                        Text.copyOption(CopyOptions.LocalDevice);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (t.detail !== undefined && t.detail.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('输出');
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(320:9)", "entry");
                        Text.fontSize(10);
                        Text.fontColor(this.pal().textMuted);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(t.detail);
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(321:9)", "entry");
                        Text.wordBreak(WordBreak.BREAK_ALL);
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textPrimary);
                        Text.fontFamily('monospace');
                        Text.width('100%');
                        Text.padding(6);
                        Text.backgroundColor(this.pal().surfaceAlt);
                        Text.borderRadius(6);
                        Text.copyOption(CopyOptions.LocalDevice);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if ((t.summary === undefined || t.summary.length === 0)
                && (t.args === undefined || t.args.length === 0)
                && (t.detail === undefined || t.detail.length === 0)) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('（详情加载中或该工具无详情）');
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(330:9)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textMuted);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (t.elapsed_ms !== undefined) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(`耗时 ${t.elapsed_ms} ms`);
                        Text.debugLine("entry/src/main/ets/components/MessageRow.ets(333:9)", "entry");
                        Text.fontSize(10);
                        Text.fontColor(this.pal().textMuted);
                    }, Text);
                    Text.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        Column.pop();
    }
    initialRender() {
        this.AssistantBlock.bind(this)(ObservedObject.GetRawObject(this.row));
    }
    rerender() {
        this.updateDirtyElements();
    }
}
