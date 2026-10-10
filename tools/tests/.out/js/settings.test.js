"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const settings_1 = require("./settings");
let pass = 0, fail = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
    }
}
eq('本地键 → 服务端键：换行', (0, settings_1.serverKey)(settings_1.KEY_CODE_WRAP), 'web:ui:code-word-wrap');
eq('本地键 → 服务端键：字号', (0, settings_1.serverKey)(settings_1.KEY_FONT_SCALE), 'web:ui:font-scale');
eq('未知键原样', (0, settings_1.serverKey)('xbot-unknown'), 'xbot-unknown');
eq('服务端键 → 本地键：往返', (0, settings_1.localKey)('web:ui:code-word-wrap'), settings_1.KEY_CODE_WRAP);
eq('服务端键 → 本地键：未知保留', (0, settings_1.localKey)('web:other:thing'), 'web:other:thing');
eq('往返一致（发送键）', (0, settings_1.localKey)((0, settings_1.serverKey)(settings_1.KEY_SEND_KEY)), settings_1.KEY_SEND_KEY);
eq('布尔 1', (0, settings_1.parseBool)('1', false), true);
eq('布尔 true', (0, settings_1.parseBool)('TRUE', false), true);
eq('布尔 on', (0, settings_1.parseBool)('on', false), true);
eq('布尔 0', (0, settings_1.parseBool)('0', true), false);
eq('布尔 false', (0, settings_1.parseBool)('false', true), false);
eq('布尔缺失回落', (0, settings_1.parseBool)(undefined, true), true);
eq('布尔垃圾回落', (0, settings_1.parseBool)('maybe', false), false);
eq('夹取下界', (0, settings_1.clampFontScale)(0.1), 0.85);
eq('夹取上界', (0, settings_1.clampFontScale)(9), 1.4);
eq('正常保留', (0, settings_1.clampFontScale)(1.15), 1.15);
eq('NaN 回落 1', (0, settings_1.clampFontScale)(Number.NaN), 1);
eq('负数回落 1', (0, settings_1.clampFontScale)(-3), 1);
eq('从字符串解析', (0, settings_1.fontScaleFrom)('1.2'), 1.2);
eq('缺失回落 1', (0, settings_1.fontScaleFrom)(undefined), 1);
eq('垃圾回落 1', (0, settings_1.fontScaleFrom)('abc'), 1);
eq('档位数', (0, settings_1.fontScalePresets)().length, 4);
eq('档位名 小', (0, settings_1.fontScaleLabel)(0.9), '小');
eq('档位名 中', (0, settings_1.fontScaleLabel)(1), '中');
eq('档位名 大', (0, settings_1.fontScaleLabel)(1.15), '大');
eq('档位名 特大', (0, settings_1.fontScaleLabel)(1.3), '特大');
eq('发送键标签 enter', (0, settings_1.sendKeyLabel)(settings_1.SEND_KEY_ENTER), 'Enter 发送');
eq('发送键标签 mod-enter', (0, settings_1.sendKeyLabel)(settings_1.SEND_KEY_MOD_ENTER), 'Ctrl/⌘ + Enter 发送');
eq('规范化未知', (0, settings_1.normalizeSendKey)('weird'), settings_1.SEND_KEY_ENTER);
eq('规范化 mod-enter', (0, settings_1.normalizeSendKey)(settings_1.SEND_KEY_MOD_ENTER), settings_1.SEND_KEY_MOD_ENTER);
const srv = { 'web:ui:code-word-wrap': '0', 'web:ui:font-scale': '1.2' };
const loc = (0, settings_1.toLocalSettings)(srv);
eq('map 换行', loc[settings_1.KEY_CODE_WRAP], '0');
eq('map 字号', loc[settings_1.KEY_FONT_SCALE], '1.2');
eq('取值缺失为空串', (0, settings_1.settingOf)(loc, 'xbot-nope'), '');
eq('取值命中', (0, settings_1.settingOf)(loc, settings_1.KEY_FONT_SCALE), '1.2');
eq('设置项显示名', (0, settings_1.settingLabel)(settings_1.KEY_FONT_SCALE), '消息字号');
eq('思考键往返', (0, settings_1.localKey)((0, settings_1.serverKey)(settings_1.KEY_REASONING_DEFAULT)), settings_1.KEY_REASONING_DEFAULT);
eq('思考键显示名', (0, settings_1.settingLabel)(settings_1.KEY_REASONING_DEFAULT), '思考默认展开');
if (fail > 0) {
    console.log(`  settings: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  settings: ${pass} passed, 0 failed`);
process.exit(0);
