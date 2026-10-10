if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface UserBubbleView_Params {
    text?: string;
    theme?: string;
    /** 长按（页面据此弹"复制"菜单） */
    onLongPress?: () => void;
}
import { paletteOf } from "@normalized:N&&&entry/src/main/ets/core/theme&";
import type { Palette } from "@normalized:N&&&entry/src/main/ets/core/theme&";
export class UserBubbleView extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__text = new SynchedPropertySimpleOneWayPU(params.text, this, "text");
        this.__theme = new SynchedPropertySimpleOneWayPU(params.theme, this, "theme");
        this.onLongPress = () => {
        };
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: UserBubbleView_Params) {
        if (params.text === undefined) {
            this.__text.set('');
        }
        if (params.theme === undefined) {
            this.__theme.set('dark');
        }
        if (params.onLongPress !== undefined) {
            this.onLongPress = params.onLongPress;
        }
    }
    updateStateVars(params: UserBubbleView_Params) {
        this.__text.reset(params.text);
        this.__theme.reset(params.theme);
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__text.purgeDependencyOnElmtId(rmElmtId);
        this.__theme.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__text.aboutToBeDeleted();
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
    private __theme: SynchedPropertySimpleOneWayPU<string>;
    get theme() {
        return this.__theme.get();
    }
    set theme(newValue: string) {
        this.__theme.set(newValue);
    }
    /** 长按（页面据此弹"复制"菜单） */
    private onLongPress: () => void;
    private pal(): Palette {
        return paletteOf(this.theme);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.debugLine("entry/src/main/ets/components/UserBubble.ets(27:5)", "entry");
            Row.width('100%');
            Row.padding({ top: 6, bottom: 6 });
            Gesture.create(GesturePriority.Low);
            LongPressGesture.create();
            LongPressGesture.onAction(() => {
                this.onLongPress();
            });
            LongPressGesture.pop();
            Gesture.pop();
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Blank.create();
            Blank.debugLine("entry/src/main/ets/components/UserBubble.ets(28:7)", "entry");
        }, Blank);
        Blank.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.text);
            Text.debugLine("entry/src/main/ets/components/UserBubble.ets(29:7)", "entry");
            Text.wordBreak(WordBreak.BREAK_ALL);
            Text.fontSize(15);
            Text.fontColor(this.pal().textPrimary);
            Text.padding(12);
            Text.constraintSize({ maxWidth: '78%' });
            Text.backgroundColor(this.pal().bubbleUser);
            Text.borderRadius(12);
            Text.copyOption(CopyOptions.LocalDevice);
        }, Text);
        Text.pop();
        Row.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
}
