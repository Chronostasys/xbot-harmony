/**
 * 设置的**纯逻辑**（可脱机单测）。
 *
 * 服务端契约（`channel/web/web.go` + `web/src/lib/userSettings.ts`，逐字核对）：
 *   `POST /api/settings`（空体）      → `{ settings: Record<string,string> }`（也用作登录探针）
 *   `POST /api/settings {settings:{…}}` → 批量写
 * Web 的用户偏好就存在服务端，键形如 `xbot-*`（服务端名 `web:ui:*`）——
 * **原生端读写同一份 ⇒ 两端偏好天然一致**（项目要求「两边数据统一」）。
 */

// 本地键名（与服务端名一一对应；与 web `userSettings.ts` 的映射表一致）
export const KEY_MD_THEME: string = 'xbot-md-theme';
export const KEY_ACCENT: string = 'xbot-accent';
export const KEY_LOCALE: string = 'xbot-locale';
export const KEY_SEND_KEY: string = 'xbot-send-key-mode';
export const KEY_CODE_WRAP: string = 'xbot-code-word-wrap';
export const KEY_UI_MODE: string = 'xbot-ui-mode';
export const KEY_STARRED: string = 'xbot-starred';
/** 原生端新增（web 不认也无害）：消息字号缩放，`0.9` / `1` / `1.15` */
export const KEY_FONT_SCALE: string = 'xbot-font-scale';
/** 新增：思考块默认是否展开（原生端偏好） */
export const KEY_REASONING_DEFAULT: string = 'xbot-reasoning-default';

/** 本地键 → 服务端键（web `userSettings.ts` 的同一张表）。 */
export function serverKey(localKey: string): string {
  if (localKey === KEY_MD_THEME) {
    return 'web:ui:md-theme';
  }
  if (localKey === KEY_ACCENT) {
    return 'web:ui:accent';
  }
  if (localKey === KEY_LOCALE) {
    return 'web:ui:locale';
  }
  if (localKey === KEY_SEND_KEY) {
    return 'web:ui:send-key-mode';
  }
  if (localKey === KEY_CODE_WRAP) {
    return 'web:ui:code-word-wrap';
  }
  if (localKey === KEY_UI_MODE) {
    return 'web:ui:ui-mode';
  }
  if (localKey === KEY_STARRED) {
    return 'web:session:starred';
  }
  if (localKey === KEY_FONT_SCALE) {
    return 'web:ui:font-scale';
  }
  if (localKey === KEY_REASONING_DEFAULT) {
    return 'web:ui:reasoning-default';
  }
  return localKey;
}

/** 服务端键 → 本地键（读回来时反查；未知键原样保留）。 */
export function localKey(srvKey: string): string {
  const table: string[] = [KEY_MD_THEME, KEY_ACCENT, KEY_LOCALE, KEY_SEND_KEY, KEY_CODE_WRAP,
    KEY_UI_MODE, KEY_STARRED, KEY_FONT_SCALE, KEY_REASONING_DEFAULT];
  for (let i = 0; i < table.length; i++) {
    if (serverKey(table[i]) === srvKey) {
      return table[i];
    }
  }
  return srvKey;
}

/** 宽松布尔解析（服务端存的是字符串）。 */
export function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) {
    return fallback;
  }
  const s: string = v.trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'on' || s === 'yes') {
    return true;
  }
  if (s === '0' || s === 'false' || s === 'off' || s === 'no') {
    return false;
  }
  return fallback;
}

/** 字号缩放的范围（0.85 – 1.4）—— 超出就夹住，绝不渲染成 0 号字或巨无霸。 */
export function clampFontScale(n: number): number {
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
export function fontScaleFrom(v: string | undefined): number {
  if (v === undefined || v.trim().length === 0) {
    return 1;
  }
  const n: number = Number.parseFloat(v);
  return clampFontScale(n);
}

/** 字号档位（小/中/大/特大）。 */
export function fontScalePresets(): number[] {
  return [0.9, 1, 1.15, 1.3];
}

/** 档位名。 */
export function fontScaleLabel(scale: number): string {
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
export const SEND_KEY_ENTER: string = 'enter';
export const SEND_KEY_MOD_ENTER: string = 'mod-enter';

export function sendKeyLabel(mode: string): string {
  return mode === SEND_KEY_MOD_ENTER ? 'Ctrl/⌘ + Enter 发送' : 'Enter 发送';
}

/** 规范化发送键模式（未知值回落 enter）。 */
export function normalizeSendKey(v: string | undefined): string {
  return v === SEND_KEY_MOD_ENTER ? SEND_KEY_MOD_ENTER : SEND_KEY_ENTER;
}

/** 把服务端返回的 `{服务端键: 值}` 映射本地化。 */
export function toLocalSettings(server: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const keys: string[] = Object.keys(server);
  for (let i = 0; i < keys.length; i++) {
    out[localKey(keys[i])] = server[keys[i]];
  }
  return out;
}

/** 取一个值（缺失返回空串）。 */
export function settingOf(map: Record<string, string>, key: string): string {
  const v: string | undefined = map[key];
  return v !== undefined ? v : '';
}

/** 设置项的显示名（面板用）。 */
export function settingLabel(key: string): string {
  if (key === KEY_FONT_SCALE) {
    return '消息字号';
  }
  if (key === KEY_CODE_WRAP) {
    return '代码自动换行';
  }
  if (key === KEY_SEND_KEY) {
    return '发送快捷键';
  }
  if (key === KEY_REASONING_DEFAULT) {
    return '思考默认展开';
  }
  if (key === KEY_MD_THEME) {
    return 'Markdown 主题';
  }
  if (key === KEY_ACCENT) {
    return '强调色';
  }
  if (key === KEY_LOCALE) {
    return '语言';
  }
  if (key === KEY_UI_MODE) {
    return '界面模式';
  }
  return key;
}
