/** 设置纯逻辑测试（键映射与字号夹取错了会让用户偏好错乱/字号崩掉）。 */
declare const process: { exit: (c: number) => void };

import {
  clampFontScale, fontScaleFrom, fontScaleLabel, fontScalePresets, KEY_CODE_WRAP, KEY_FONT_SCALE,
  KEY_SEND_KEY, localKey, normalizeSendKey, parseBool, sendKeyLabel, serverKey, settingLabel,
  settingOf, SEND_KEY_ENTER, SEND_KEY_MOD_ENTER, toLocalSettings, KEY_REASONING_DEFAULT,
} from '../../entry/src/main/ets/core/settings';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

eq('本地键 → 服务端键：换行', serverKey(KEY_CODE_WRAP), 'web:ui:code-word-wrap');
eq('本地键 → 服务端键：字号', serverKey(KEY_FONT_SCALE), 'web:ui:font-scale');
eq('未知键原样', serverKey('xbot-unknown'), 'xbot-unknown');
eq('服务端键 → 本地键：往返', localKey('web:ui:code-word-wrap'), KEY_CODE_WRAP);
eq('服务端键 → 本地键：未知保留', localKey('web:other:thing'), 'web:other:thing');
eq('往返一致（发送键）', localKey(serverKey(KEY_SEND_KEY)), KEY_SEND_KEY);

eq('布尔 1', parseBool('1', false), true);
eq('布尔 true', parseBool('TRUE', false), true);
eq('布尔 on', parseBool('on', false), true);
eq('布尔 0', parseBool('0', true), false);
eq('布尔 false', parseBool('false', true), false);
eq('布尔缺失回落', parseBool(undefined, true), true);
eq('布尔垃圾回落', parseBool('maybe', false), false);

eq('夹取下界', clampFontScale(0.1), 0.85);
eq('夹取上界', clampFontScale(9), 1.4);
eq('正常保留', clampFontScale(1.15), 1.15);
eq('NaN 回落 1', clampFontScale(Number.NaN), 1);
eq('负数回落 1', clampFontScale(-3), 1);
eq('从字符串解析', fontScaleFrom('1.2'), 1.2);
eq('缺失回落 1', fontScaleFrom(undefined), 1);
eq('垃圾回落 1', fontScaleFrom('abc'), 1);

eq('档位数', fontScalePresets().length, 4);
eq('档位名 小', fontScaleLabel(0.9), '小');
eq('档位名 中', fontScaleLabel(1), '中');
eq('档位名 大', fontScaleLabel(1.15), '大');
eq('档位名 特大', fontScaleLabel(1.3), '特大');

eq('发送键标签 enter', sendKeyLabel(SEND_KEY_ENTER), 'Enter 发送');
eq('发送键标签 mod-enter', sendKeyLabel(SEND_KEY_MOD_ENTER), 'Ctrl/⌘ + Enter 发送');
eq('规范化未知', normalizeSendKey('weird'), SEND_KEY_ENTER);
eq('规范化 mod-enter', normalizeSendKey(SEND_KEY_MOD_ENTER), SEND_KEY_MOD_ENTER);

const srv: Record<string, string> = { 'web:ui:code-word-wrap': '0', 'web:ui:font-scale': '1.2' };
const loc: Record<string, string> = toLocalSettings(srv);
eq('map 换行', loc[KEY_CODE_WRAP], '0');
eq('map 字号', loc[KEY_FONT_SCALE], '1.2');
eq('取值缺失为空串', settingOf(loc, 'xbot-nope'), '');
eq('取值命中', settingOf(loc, KEY_FONT_SCALE), '1.2');
eq('设置项显示名', settingLabel(KEY_FONT_SCALE), '消息字号');
eq('思考键往返', localKey(serverKey(KEY_REASONING_DEFAULT)), KEY_REASONING_DEFAULT);
eq('思考键显示名', settingLabel(KEY_REASONING_DEFAULT), '思考默认展开');

if (fail > 0) { console.log(`  settings: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  settings: ${pass} passed, 0 failed`);
process.exit(0);
