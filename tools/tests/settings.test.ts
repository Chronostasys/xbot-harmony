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
eq('发送键标签 ctrl-enter', sendKeyLabel(SEND_KEY_MOD_ENTER), 'Ctrl/⌘ + Enter 发送');

// ── send-key 值域迁移（与 web 对齐；判别力：把实现改回旧值域必红）──────────────
eq('常量值域 = web', SEND_KEY_MOD_ENTER, 'ctrl-enter');
eq('归一 ctrl-enter', normalizeSendKey('ctrl-enter'), 'ctrl-enter');
eq('归一历史 mod-enter → ctrl-enter', normalizeSendKey('mod-enter'), 'ctrl-enter');
eq('归一 enter 保持', normalizeSendKey('enter'), 'enter');
eq('缺失回落 web 默认 ctrl-enter', normalizeSendKey(undefined), 'ctrl-enter');
eq('空串回落 ctrl-enter', normalizeSendKey(''), 'ctrl-enter');
eq('垃圾回落 ctrl-enter', normalizeSendKey('weird'), 'ctrl-enter');
eq('历史标签迁移为同一文案', sendKeyLabel('mod-enter'), 'Ctrl/⌘ + Enter 发送');
eq('发送键服务端键名', serverKey(KEY_SEND_KEY), 'web:ui:send-key-mode');

const srv: Record<string, string> = { 'web:ui:code-word-wrap': '0', 'web:ui:font-scale': '1.2' };
const loc: Record<string, string> = toLocalSettings(srv);
eq('map 换行', loc[KEY_CODE_WRAP], '0');
eq('map 字号', loc[KEY_FONT_SCALE], '1.2');
eq('取值缺失为空串', settingOf(loc, 'xbot-nope'), '');
eq('取值命中', settingOf(loc, KEY_FONT_SCALE), '1.2');
eq('设置项显示名', settingLabel(KEY_FONT_SCALE), '消息字号');
eq('思考键往返', localKey(serverKey(KEY_REASONING_DEFAULT)), KEY_REASONING_DEFAULT);
eq('思考键显示名', settingLabel(KEY_REASONING_DEFAULT), '思考默认展开');

// ── 键表 parity 守卫（2026-10-11 设置面审计的机器判据）────────────────────────────
// 事实（见 docs/WEB-ALIGNMENT.md §17.6）：两端 key 表**并非同源** —— 真共享 8 / 原生独有 8 /
// web 独有 6。本组把它钉住，防"悄悄加/删键"导致两端偏好漂移或丢键。
// ★ 判别力（mutation 必红）：把任一共享键的 serverKey 改掉 ⇒ 第 1 组红。
{
  const SHARED: string[][] = [
    [KEY_MD_THEME, 'web:ui:md-theme'],
    [KEY_ACCENT, 'web:ui:accent'],
    [KEY_LOCALE, 'web:ui:locale'],
    [KEY_SEND_KEY, 'web:ui:send-key-mode'],
    [KEY_CODE_WRAP, 'web:ui:code-word-wrap'],
    [KEY_UI_MODE, 'web:ui:ui-mode'],
    [KEY_STARRED, 'web:session:starred'],
    [KEY_SESSION_CATEGORY, 'web:session:category'],
  ];
  let bad: number = 0;
  for (const p of SHARED) {
    if (serverKey(p[0]) !== p[1]) { bad++; }
    if (localKey(p[1]) !== p[0]) { bad++; }
  }
  eq(`真共享 ${SHARED.length} 键：本地↔服务端双向映射逐字正确`, bad, 0);

  // 原生独有键：必须有映射（否则跨设备丢），但**不得**被误当成共享键
  const NATIVE_ONLY: string[] = [KEY_FONT_SCALE, KEY_REASONING_DEFAULT, KEY_APP_THEME, KEY_SURFACE,
    KEY_ORB, KEY_NOTIFY_ASK, KEY_NOTIFY_TURN_DONE, KEY_NOTIFY_DETAIL];
  let nativeMapped: number = 0;
  for (const k of NATIVE_ONLY) {
    if (serverKey(k).indexOf('web:') === 0) { nativeMapped++; }
  }
  eq(`原生独有 ${NATIVE_ONLY.length} 键都映射到 web: 命名空间（跨设备可存）`, nativeMapped, NATIVE_ONLY.length);

  // web 独有的桌面布局键：本仓**不收录** ⇒ `localKey` 原样返回 = 零丢键（见 §17.5-5）
  const WEB_ONLY: string[] = ['web:ui:left-sidebar-width', 'web:ui:layout-overrides', 'web:ui:layout-order',
    'web:ui:panel-layout', 'web:ui:panel-layout-v2', 'web:workspace:recent-workdirs'];
  let passthru: number = 0;
  for (const k of WEB_ONLY) {
    if (localKey(k) === k) { passthru++; }
  }
  eq(`web 独有 ${WEB_ONLY.length} 键：原样透传（零丢键，⛔ 不收录）`, passthru, WEB_ONLY.length);
}

if (fail > 0) { console.log(`  settings: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  settings: ${pass} passed, 0 failed`);
process.exit(0);
