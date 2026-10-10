if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface LiveTailView_Params {
    text?: string;
    reasoning?: string;
    tools?: ToolProgress[];
    paused?: boolean;
    theme?: string;
    fontScale?: number;
    wrapCode?: boolean;
    onImage?: (src: string) => void;
    loadImage?: (src: string) => Promise<ArrayBuffer>;
    onToolLongPress?: (name: string) => void;
    vis?: number;
    visReason?: number;
    reasonOpen?: boolean;
    openTool?: string;
    caretOn?: boolean;
    runes?: string[];
    reasonRunes?: string[];
    timer?: number;
    skip?: boolean;
    advanceTick?: number;
    lastTextLen?: number;
    lastReasonLen?: number;
}
import type { ToolProgress } from '../core/types';
import { advanceVisible, clipRunes, isCJK, isTyping, runeCount, toRunes } from "@bundle:com.chronostasys.xbot/entry/ets/core/typewriter";
import { paletteOf } from "@bundle:com.chronostasys.xbot/entry/ets/core/theme";
import type { Palette } from "@bundle:com.chronostasys.xbot/entry/ets/core/theme";
import { MarkdownView } from "@bundle:com.chronostasys.xbot/entry/ets/components/MarkdownView";
export class LiveTailView extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__text = new SynchedPropertySimpleOneWayPU(params.text, this, "text");
        this.__reasoning = new SynchedPropertySimpleOneWayPU(params.reasoning, this, "reasoning");
        this.__tools = new SynchedPropertyObjectOneWayPU(params.tools, this, "tools");
        this.__paused = new SynchedPropertySimpleOneWayPU(params.paused, this, "paused");
        this.__theme = new SynchedPropertySimpleOneWayPU(params.theme, this, "theme");
        this.__fontScale = new SynchedPropertySimpleOneWayPU(params.fontScale, this, "fontScale");
        this.__wrapCode = new SynchedPropertySimpleOneWayPU(params.wrapCode, this, "wrapCode");
        this.onImage = (src: string) => {
        };
        this.loadImage = async (s: string) => {
            return new ArrayBuffer(0);
        };
        this.onToolLongPress = (name: string) => {
        };
        this.__vis = new ObservedPropertySimplePU(0, this, "vis");
        this.__visReason = new ObservedPropertySimplePU(0, this, "visReason");
        this.__reasonOpen = new ObservedPropertySimplePU(false, this, "reasonOpen");
        this.__openTool = new ObservedPropertySimplePU('', this, "openTool");
        this.__caretOn = new ObservedPropertySimplePU(true, this, "caretOn");
        this.runes = [];
        this.reasonRunes = [];
        this.timer = -1;
        this.skip = false;
        this.advanceTick = 0;
        this.lastTextLen = -1;
        this.lastReasonLen = -1;
        this.setInitiallyProvidedValue(params);
        this.declareWatch("text", this.onSource);
        this.declareWatch("reasoning", this.onSource);
        this.declareWatch("paused", this.onSource);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: LiveTailView_Params) {
        if (params.text === undefined) {
            this.__text.set('');
        }
        if (params.reasoning === undefined) {
            this.__reasoning.set('');
        }
        if (params.tools === undefined) {
            this.__tools.set([]);
        }
        if (params.paused === undefined) {
            this.__paused.set(false);
        }
        if (params.theme === undefined) {
            this.__theme.set('dark');
        }
        if (params.fontScale === undefined) {
            this.__fontScale.set(1);
        }
        if (params.wrapCode === undefined) {
            this.__wrapCode.set(true);
        }
        if (params.onImage !== undefined) {
            this.onImage = params.onImage;
        }
        if (params.loadImage !== undefined) {
            this.loadImage = params.loadImage;
        }
        if (params.onToolLongPress !== undefined) {
            this.onToolLongPress = params.onToolLongPress;
        }
        if (params.vis !== undefined) {
            this.vis = params.vis;
        }
        if (params.visReason !== undefined) {
            this.visReason = params.visReason;
        }
        if (params.reasonOpen !== undefined) {
            this.reasonOpen = params.reasonOpen;
        }
        if (params.openTool !== undefined) {
            this.openTool = params.openTool;
        }
        if (params.caretOn !== undefined) {
            this.caretOn = params.caretOn;
        }
        if (params.runes !== undefined) {
            this.runes = params.runes;
        }
        if (params.reasonRunes !== undefined) {
            this.reasonRunes = params.reasonRunes;
        }
        if (params.timer !== undefined) {
            this.timer = params.timer;
        }
        if (params.skip !== undefined) {
            this.skip = params.skip;
        }
        if (params.advanceTick !== undefined) {
            this.advanceTick = params.advanceTick;
        }
        if (params.lastTextLen !== undefined) {
            this.lastTextLen = params.lastTextLen;
        }
        if (params.lastReasonLen !== undefined) {
            this.lastReasonLen = params.lastReasonLen;
        }
    }
    updateStateVars(params: LiveTailView_Params) {
        this.__text.reset(params.text);
        this.__reasoning.reset(params.reasoning);
        this.__tools.reset(params.tools);
        this.__paused.reset(params.paused);
        this.__theme.reset(params.theme);
        this.__fontScale.reset(params.fontScale);
        this.__wrapCode.reset(params.wrapCode);
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__text.purgeDependencyOnElmtId(rmElmtId);
        this.__reasoning.purgeDependencyOnElmtId(rmElmtId);
        this.__tools.purgeDependencyOnElmtId(rmElmtId);
        this.__paused.purgeDependencyOnElmtId(rmElmtId);
        this.__theme.purgeDependencyOnElmtId(rmElmtId);
        this.__fontScale.purgeDependencyOnElmtId(rmElmtId);
        this.__wrapCode.purgeDependencyOnElmtId(rmElmtId);
        this.__vis.purgeDependencyOnElmtId(rmElmtId);
        this.__visReason.purgeDependencyOnElmtId(rmElmtId);
        this.__reasonOpen.purgeDependencyOnElmtId(rmElmtId);
        this.__openTool.purgeDependencyOnElmtId(rmElmtId);
        this.__caretOn.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__text.aboutToBeDeleted();
        this.__reasoning.aboutToBeDeleted();
        this.__tools.aboutToBeDeleted();
        this.__paused.aboutToBeDeleted();
        this.__theme.aboutToBeDeleted();
        this.__fontScale.aboutToBeDeleted();
        this.__wrapCode.aboutToBeDeleted();
        this.__vis.aboutToBeDeleted();
        this.__visReason.aboutToBeDeleted();
        this.__reasonOpen.aboutToBeDeleted();
        this.__openTool.aboutToBeDeleted();
        this.__caretOn.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    /** 已收到的正文（流式累积；未裁剪） */
    private __text: SynchedPropertySimpleOneWayPU<string>;
    get text() {
        return this.__text.get();
    }
    set text(newValue: string) {
        this.__text.set(newValue);
    }
    /** 已收到的思考 */
    private __reasoning: SynchedPropertySimpleOneWayPU<string>;
    get reasoning() {
        return this.__reasoning.get();
    }
    set reasoning(newValue: string) {
        this.__reasoning.set(newValue);
    }
    private __tools: SynchedPropertySimpleOneWayPU<ToolProgress[]>;
    get tools() {
        return this.__tools.get();
    }
    set tools(newValue: ToolProgress[]) {
        this.__tools.set(newValue);
    }
    /** 应用是否在后台（官方性能规范 §3：后台必须挂起非必要定时器/动画） */
    private __paused: SynchedPropertySimpleOneWayPU<boolean>;
    get paused() {
        return this.__paused.get();
    }
    set paused(newValue: boolean) {
        this.__paused.set(newValue);
    }
    private __theme: SynchedPropertySimpleOneWayPU<string>;
    get theme() {
        return this.__theme.get();
    }
    set theme(newValue: string) {
        this.__theme.set(newValue);
    }
    private __fontScale: SynchedPropertySimpleOneWayPU<number>;
    get fontScale() {
        return this.__fontScale.get();
    }
    set fontScale(newValue: number) {
        this.__fontScale.set(newValue);
    }
    private __wrapCode: SynchedPropertySimpleOneWayPU<boolean>;
    get wrapCode() {
        return this.__wrapCode.get();
    }
    set wrapCode(newValue: boolean) {
        this.__wrapCode.set(newValue);
    }
    private onImage: (src: string) => void;
    private loadImage: (src: string) => Promise<ArrayBuffer>;
    private onToolLongPress: (name: string) => void;
    private __vis: ObservedPropertySimplePU<number>;
    get vis() {
        return this.__vis.get();
    }
    set vis(newValue: number) {
        this.__vis.set(newValue);
    }
    private __visReason: ObservedPropertySimplePU<number>;
    get visReason() {
        return this.__visReason.get();
    }
    set visReason(newValue: number) {
        this.__visReason.set(newValue);
    }
    private __reasonOpen: ObservedPropertySimplePU<boolean>;
    get reasonOpen() {
        return this.__reasonOpen.get();
    }
    set reasonOpen(newValue: boolean) {
        this.__reasonOpen.set(newValue);
    }
    private __openTool: ObservedPropertySimplePU<string>;
    get openTool() {
        return this.__openTool.get();
    }
    set openTool(newValue: string) {
        this.__openTool.set(newValue);
    }
    private __caretOn: ObservedPropertySimplePU<boolean>;
    get caretOn() {
        return this.__caretOn.get();
    }
    set caretOn(newValue: boolean) {
        this.__caretOn.set(newValue);
    }
    private runes: string[];
    private reasonRunes: string[];
    private timer: number;
    private skip: boolean;
    private advanceTick: number;
    private lastTextLen: number;
    private lastReasonLen: number;
    private pal(): Palette {
        return paletteOf(this.theme);
    }
    aboutToAppear(): void {
        this.onSource();
    }
    aboutToDisappear(): void {
        this.stopTimer();
    }
    /** 源文本变化：重算码点表 + 按需启动追赶。 */
    onSource(): void {
        if (this.text.length !== this.lastTextLen) {
            this.lastTextLen = this.text.length;
            this.runes = toRunes(this.text);
        }
        if (this.reasoning.length !== this.lastReasonLen) {
            this.lastReasonLen = this.reasoning.length;
            this.reasonRunes = toRunes(this.reasoning);
        }
        this.syncTimer();
    }
    private typingText(): boolean {
        return isTyping(this.vis, this.runes.length);
    }
    private typingReason(): boolean {
        return this.reasonOpen && isTyping(this.visReason, this.reasonRunes.length);
    }
    private syncTimer(): void {
        // 后台挂起：不推进、不重渲染（回前台时 @Watch 重新拉起）
        const on: boolean = !this.paused && this.liveNow() && (this.typingText() || this.typingReason());
        if (on && this.timer < 0) {
            this.timer = setInterval(() => {
                this.tick();
            }, 50);
            return;
        }
        if (!on && this.timer >= 0) {
            this.stopTimer();
        }
    }
    /** 「还在跑」的判据：正文/思考还没追平，或工具里还有非终态。 */
    private liveNow(): boolean {
        for (let i = 0; i < this.tools.length; i++) {
            const st: string = this.tools[i].status !== undefined ? this.tools[i].status as string : '';
            if (st === 'running' || st === 'generating' || st === 'pending') {
                return true;
            }
        }
        return false;
    }
    private stopTimer(): void {
        if (this.timer >= 0) {
            clearInterval(this.timer);
            this.timer = -1;
        }
    }
    private tick(): void {
        if (this.paused) {
            this.stopTimer();
            return;
        }
        const skip: boolean = this.skip;
        this.skip = !this.skip;
        this.caretOn = !this.caretOn;
        // 思考：展开时逐字（纯 Text，便宜）
        if (this.typingReason()) {
            const rc: number = this.reasonRunes.length > 0
                ? this.reasonRunes[Math.min(this.visReason, this.reasonRunes.length - 1)].codePointAt(0) as number : 0;
            this.visReason = advanceVisible(this.visReason, this.reasonRunes.length, skip && isCJK(rc));
        }
        // 正文：推进每拍（web 同款 gap/3）；上屏节奏按长度自适应（解析贵）
        if (this.typingText()) {
            const tc: number = this.runes.length > 0
                ? this.runes[Math.min(this.vis, this.runes.length - 1)].codePointAt(0) as number : 0;
            const next: number = advanceVisible(this.vis, this.runes.length, skip && isCJK(tc));
            this.advanceTick = this.advanceTick + 1;
            const renderEvery: number = Math.max(1, Math.ceil(this.runes.length / 300));
            if (this.advanceTick >= renderEvery || next >= this.runes.length) {
                this.advanceTick = 0;
                this.vis = next;
            }
        }
        if (!this.typingText() && !this.typingReason()) {
            // 追平后：把最后一段补全上屏，并停表（无内容可打时不留定时器）
            if (this.vis < this.runes.length) {
                this.vis = this.runes.length;
            }
            if (this.visReason < this.reasonRunes.length) {
                this.visReason = this.reasonRunes.length;
            }
            this.stopTimer();
        }
    }
    /** 可见正文（安全回退：定时器未跑 ⇒ 全文，绝不让内容不可见）。 */
    private shownText(): string {
        if (this.timer < 0 || this.vis >= this.runes.length) {
            return this.text;
        }
        return clipRunes(this.text, this.vis);
    }
    private shownReason(): string {
        if (this.timer < 0 || this.visReason >= this.reasonRunes.length) {
            return this.reasoning;
        }
        return clipRunes(this.reasoning, this.visReason);
    }
    /** 工具状态角标（generating 带字数 / running 带时长 / error 带 exit）。 */
    private badge(t: ToolProgress): string {
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
    private icon(t: ToolProgress): string {
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
    private color(t: ToolProgress): string {
        if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
            return this.pal().dangerText;
        }
        if (t.status === 'running' || t.status === 'generating') {
            return this.pal().accentSoft;
        }
        return this.pal().textSecondary;
    }
    private label(t: ToolProgress): string {
        const base: string = t.label !== undefined && t.label.length > 0 ? t.label : t.name;
        const b: string = this.badge(t);
        return b.length > 0 ? `${base} ${b}` : base;
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.debugLine("entry/src/main/ets/components/LiveTailView.ets(222:5)", "entry");
            Column.width('100%');
            Column.alignItems(HorizontalAlign.Start);
            Column.padding({ left: 12, right: 12, top: 10, bottom: 10 });
            Column.backgroundColor(this.pal().surface);
            Column.borderRadius(14);
            Column.border({ width: 1, color: this.pal().border });
            Column.margin({ top: 4, bottom: 4 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.reasoning.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Row.create({ space: 6 });
                        Row.debugLine("entry/src/main/ets/components/LiveTailView.ets(224:9)", "entry");
                        Row.padding({ top: 2, bottom: 2 });
                        ViewStackProcessor.visualState("pressed");
                        Row.opacity(0.6);
                        ViewStackProcessor.visualState("normal");
                        Row.opacity(1);
                        ViewStackProcessor.visualState();
                        Row.onClick(() => {
                            this.reasonOpen = !this.reasonOpen;
                            this.syncTimer();
                        });
                    }, Row);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create('✳');
                        Text.debugLine("entry/src/main/ets/components/LiveTailView.ets(225:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textMuted);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(`思考 ${runeCount(this.reasoning)} 字`);
                        Text.debugLine("entry/src/main/ets/components/LiveTailView.ets(226:11)", "entry");
                        Text.fontSize(11);
                        Text.fontColor(this.pal().textSecondary);
                    }, Text);
                    Text.pop();
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.reasonOpen ? '▾' : '▸');
                        Text.debugLine("entry/src/main/ets/components/LiveTailView.ets(227:11)", "entry");
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
            if (this.reasonOpen && this.reasoning.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.shownReason());
                        Text.debugLine("entry/src/main/ets/components/LiveTailView.ets(237:9)", "entry");
                        Text.width('100%');
                        Text.wordBreak(WordBreak.BREAK_ALL);
                        Text.fontSize(12);
                        Text.fontColor(this.pal().textSecondary);
                        Text.padding(8);
                        Text.backgroundColor(this.pal().surfaceAlt);
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
            if (this.text.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create({ space: 2 });
                        Column.debugLine("entry/src/main/ets/components/LiveTailView.ets(245:9)", "entry");
                        Column.width('100%');
                        Column.alignItems(HorizontalAlign.Start);
                    }, Column);
                    {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            if (isInitialRender) {
                                let componentCall = new MarkdownView(this, {
                                    text: this.shownText(),
                                    onImage: this.onImage,
                                    loadImage: this.loadImage,
                                    fontScale: this.fontScale,
                                    wrapCode: this.wrapCode,
                                    theme: this.theme,
                                }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/components/LiveTailView.ets", line: 246, col: 11 });
                                ViewPU.create(componentCall);
                                let paramsLambda = () => {
                                    return {
                                        text: this.shownText(),
                                        onImage: this.onImage,
                                        loadImage: this.loadImage,
                                        fontScale: this.fontScale,
                                        wrapCode: this.wrapCode,
                                        theme: this.theme
                                    };
                                };
                                componentCall.paramsGenerator_ = paramsLambda;
                            }
                            else {
                                this.updateStateVarsOfChildByElmtId(elmtId, {
                                    text: this.shownText(),
                                    fontScale: this.fontScale,
                                    wrapCode: this.wrapCode,
                                    theme: this.theme
                                });
                            }
                        }, { name: "MarkdownView" });
                    }
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        If.create();
                        if (this.typingText() || this.typingReason()) {
                            this.ifElseBranchUpdateFunction(0, () => {
                                this.observeComponentCreation2((elmtId, isInitialRender) => {
                                    Text.create('▍');
                                    Text.debugLine("entry/src/main/ets/components/LiveTailView.ets(255:13)", "entry");
                                    Text.fontSize(14);
                                    Text.fontColor(this.pal().accent);
                                    Text.opacity(this.caretOn ? 1 : 0.2);
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
            if (this.tools.length > 0) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create({ space: 4 });
                        Column.debugLine("entry/src/main/ets/components/LiveTailView.ets(263:9)", "entry");
                        Column.width('100%');
                    }, Column);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Flex.create({ wrap: FlexWrap.Wrap });
                        Flex.debugLine("entry/src/main/ets/components/LiveTailView.ets(264:11)", "entry");
                        Flex.width('100%');
                    }, Flex);
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        ForEach.create();
                        const forEachItemGenFunction = (_item, i: number) => {
                            const t = _item;
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Stack.create();
                                Stack.debugLine("entry/src/main/ets/components/LiveTailView.ets(266:15)", "entry");
                                Stack.constraintSize({ maxWidth: 240 });
                                Stack.margin(3);
                                Stack.clip(true);
                                Stack.backgroundColor(this.pal().surfaceAlt);
                                Stack.borderRadius(6);
                                Stack.border({ width: 1, color: this.pal().border });
                                ViewStackProcessor.visualState("pressed");
                                Stack.opacity(0.75);
                                ViewStackProcessor.visualState("normal");
                                Stack.opacity(1);
                                ViewStackProcessor.visualState();
                                Stack.onClick(() => {
                                    this.openTool = this.openTool === t.name ? '' : (t.name !== undefined ? t.name : '');
                                });
                                Gesture.create(GesturePriority.Low);
                                LongPressGesture.create();
                                LongPressGesture.onAction(() => {
                                    this.onToolLongPress(t.name);
                                });
                                LongPressGesture.pop();
                                Gesture.pop();
                            }, Stack);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Row.create({ space: 4 });
                                Row.debugLine("entry/src/main/ets/components/LiveTailView.ets(267:17)", "entry");
                                Row.padding({ left: 8, right: 8, top: 5, bottom: 5 });
                            }, Row);
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                If.create();
                                if (t.status === 'generating' || t.status === 'running') {
                                    this.ifElseBranchUpdateFunction(0, () => {
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            // 原生指示器（会动；替代静态 "◐" 的 TUI 观感）
                                            LoadingProgress.create();
                                            LoadingProgress.debugLine("entry/src/main/ets/components/LiveTailView.ets(270:21)", "entry");
                                            // 原生指示器（会动；替代静态 "◐" 的 TUI 观感）
                                            LoadingProgress.width(13);
                                            // 原生指示器（会动；替代静态 "◐" 的 TUI 观感）
                                            LoadingProgress.height(13);
                                            // 原生指示器（会动；替代静态 "◐" 的 TUI 观感）
                                            LoadingProgress.color(this.color(t));
                                        }, LoadingProgress);
                                    });
                                }
                                else {
                                    this.ifElseBranchUpdateFunction(1, () => {
                                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                                            Text.create(this.icon(t));
                                            Text.debugLine("entry/src/main/ets/components/LiveTailView.ets(272:21)", "entry");
                                            Text.fontSize(11);
                                            Text.fontColor(this.color(t));
                                        }, Text);
                                        Text.pop();
                                    });
                                }
                            }, If);
                            If.pop();
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create(this.label(t));
                                Text.debugLine("entry/src/main/ets/components/LiveTailView.ets(274:19)", "entry");
                                Text.fontSize(12);
                                Text.fontColor(this.color(t));
                                Text.maxLines(1);
                                Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                            }, Text);
                            Text.pop();
                            Row.pop();
                            Stack.pop();
                        };
                        this.forEachUpdateFunction(elmtId, this.tools, forEachItemGenFunction, (t: ToolProgress, i: number) => `lt-${i}#${t.name}#${t.status}`, true, true);
                    }, ForEach);
                    ForEach.pop();
                    Flex.pop();
                    Column.pop();
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
    rerender() {
        this.updateDirtyElements();
    }
}
