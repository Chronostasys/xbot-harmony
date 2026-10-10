"use strict";
/**
 * 设置的**纯逻辑**（可脱机单测）。
 *
 * 服务端契约（`channel/web/web.go` + `web/src/lib/userSettings.ts`，逐字核对）：
 *   `POST /api/settings`（空体）      → `{ settings: Record<string,string> }`（也用作登录探针）
 *   `POST /api/settings {settings:{…}}` → 批量写
 * Web 的用户偏好就存在服务端，键形如 `xbot-*`（服务端名 `web:ui:*`）——
 * **原生端读写同一份 ⇒ 两端偏好天然一致**（项目要求「两边数据统一」）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEND_KEY_MOD_ENTER = exports.SEND_KEY_ENTER = exports.KEY_APP_THEME = exports.KEY_REASONING_DEFAULT = exports.KEY_FONT_SCALE = exports.KEY_STARRED = exports.KEY_UI_MODE = exports.KEY_CODE_WRAP = exports.KEY_SEND_KEY = exports.KEY_LOCALE = exports.KEY_ACCENT = exports.KEY_MD_THEME = void 0;
exports.serverKey = serverKey;
exports.localKey = localKey;
exports.parseBool = parseBool;
exports.clampFontScale = clampFontScale;
exports.fontScaleFrom = fontScaleFrom;
exports.fontScalePresets = fontScalePresets;
exports.fontScaleLabel = fontScaleLabel;
exports.sendKeyLabel = sendKeyLabel;
exports.normalizeSendKey = normalizeSendKey;
exports.toLocalSettings = toLocalSettings;
exports.settingOf = settingOf;
exports.settingLabel = settingLabel;
// 本地键名（与服务端名一一对应；与 web `userSettings.ts` 的映射表一致）
exports.KEY_MD_THEME = 'xbot-md-theme';
exports.KEY_ACCENT = 'xbot-accent';
exports.KEY_LOCALE = 'xbot-locale';
exports.KEY_SEND_KEY = 'xbot-send-key-mode';
exports.KEY_CODE_WRAP = 'xbot-code-word-wrap';
exports.KEY_UI_MODE = 'xbot-ui-mode';
exports.KEY_STARRED = 'xbot-starred';
/** 原生端新增（web 不认也无害）：消息字号缩放，`0.9` / `1` / `1.15` */
exports.KEY_FONT_SCALE = 'xbot-font-scale';
/** 新增：思考块默认是否展开（原生端偏好） */
exports.KEY_REASONING_DEFAULT = 'xbot-reasoning-default';
/** 新增：应用主题深浅（原生端偏好；角色语义见 core/theme.ets） */
exports.KEY_APP_THEME = 'xbot-app-theme';
/** 本地键 → 服务端键（web `userSettings.ts` 的同一张表）。 */
function serverKey(localKey) {
    if (localKey === exports.KEY_MD_THEME) {
        return 'web:ui:md-theme';
    }
    if (localKey === exports.KEY_ACCENT) {
        return 'web:ui:accent';
    }
    if (localKey === exports.KEY_LOCALE) {
        return 'web:ui:locale';
    }
    if (localKey === exports.KEY_SEND_KEY) {
        return 'web:ui:send-key-mode';
    }
    if (localKey === exports.KEY_CODE_WRAP) {
        return 'web:ui:code-word-wrap';
    }
    if (localKey === exports.KEY_UI_MODE) {
        return 'web:ui:ui-mode';
    }
    if (localKey === exports.KEY_STARRED) {
        return 'web:session:starred';
    }
    if (localKey === exports.KEY_FONT_SCALE) {
        return 'web:ui:font-scale';
    }
    if (localKey === exports.KEY_REASONING_DEFAULT) {
        return 'web:ui:reasoning-default';
    }
    if (localKey === exports.KEY_APP_THEME) {
        return 'web:ui:app-theme';
    }
    return localKey;
}
/** 服务端键 → 本地键（读回来时反查；未知键原样保留）。 */
function localKey(srvKey) {
    const table = [exports.KEY_MD_THEME, exports.KEY_ACCENT, exports.KEY_LOCALE, exports.KEY_SEND_KEY, exports.KEY_CODE_WRAP,
        exports.KEY_UI_MODE, exports.KEY_STARRED, exports.KEY_FONT_SCALE, exports.KEY_REASONING_DEFAULT, exports.KEY_APP_THEME];
    for (let i = 0; i < table.length; i++) {
        if (serverKey(table[i]) === srvKey) {
            return table[i];
        }
    }
    return srvKey;
}
/** 宽松布尔解析（服务端存的是字符串）。 */
function parseBool(v, fallback) {
    if (v === undefined) {
        return fallback;
    }
    const s = v.trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'on' || s === 'yes') {
        return true;
    }
    if (s === '0' || s === 'false' || s === 'off' || s === 'no') {
        return false;
    }
    return fallback;
}
/** 字号缩放的范围（0.85 – 1.4）—— 超出就夹住，绝不渲染成 0 号字或巨无霸。 */
function clampFontScale(n) {
    if (!Number.isFinite(n) || n <= 0) {
        return 1;
    }
    if (n < 0.85) {
        return 0.85;
    }
    if (n > 1.4) {
        return 1.4;
    }
    return n;
}
/** 从设置值解析字号缩放（非法/缺失 ⇒ 1）。 */
function fontScaleFrom(v) {
    if (v === undefined || v.trim().length === 0) {
        return 1;
    }
    const n = Number.parseFloat(v);
    return clampFontScale(n);
}
/** 字号档位（小/中/大/特大）。 */
function fontScalePresets() {
    return [0.9, 1, 1.15, 1.3];
}
/** 档位名。 */
function fontScaleLabel(scale) {
    if (scale < 0.95) {
        return '小';
    }
    if (scale < 1.1) {
        return '中';
    }
    if (scale < 1.25) {
        return '大';
    }
    return '特大';
}
/** 发送键模式（`enter` = 回车发送；`mod-enter` = Ctrl/⌘+回车发送）。 */
exports.SEND_KEY_ENTER = 'enter';
exports.SEND_KEY_MOD_ENTER = 'mod-enter';
function sendKeyLabel(mode) {
    return mode === exports.SEND_KEY_MOD_ENTER ? 'Ctrl/⌘ + Enter 发送' : 'Enter 发送';
}
/** 规范化发送键模式（未知值回落 enter）。 */
function normalizeSendKey(v) {
    return v === exports.SEND_KEY_MOD_ENTER ? exports.SEND_KEY_MOD_ENTER : exports.SEND_KEY_ENTER;
}
/** 把服务端返回的 `{服务端键: 值}` 映射本地化。 */
function toLocalSettings(server) {
    const out = {};
    const keys = Object.keys(server);
    for (let i = 0; i < keys.length; i++) {
        out[localKey(keys[i])] = server[keys[i]];
    }
    return out;
}
/** 取一个值（缺失返回空串）。 */
function settingOf(map, key) {
    const v = map[key];
    return v !== undefined ? v : '';
}
/** 设置项的显示名（面板用）。 */
function settingLabel(key) {
    if (key === exports.KEY_FONT_SCALE) {
        return '消息字号';
    }
    if (key === exports.KEY_CODE_WRAP) {
        return '代码自动换行';
    }
    if (key === exports.KEY_SEND_KEY) {
        return '发送快捷键';
    }
    if (key === exports.KEY_REASONING_DEFAULT) {
        return '思考默认展开';
    }
    if (key === exports.KEY_APP_THEME) {
        return '应用主题';
    }
    if (key === exports.KEY_MD_THEME) {
        return 'Markdown 主题';
    }
    if (key === exports.KEY_ACCENT) {
        return '强调色';
    }
    if (key === exports.KEY_LOCALE) {
        return '语言';
    }
    if (key === exports.KEY_UI_MODE) {
        return '界面模式';
    }
    return key;
}
