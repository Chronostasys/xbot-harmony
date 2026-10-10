/**
 * webbridge.ets —— ArkWeb JS 桥的**协议层**（纯逻辑，零依赖，可脱机单测）。
 *
 * 分层原因（铁律）：本文件属 `core/`，会被 `tools/tests/run.sh` 当**纯 TS** 在 Node 里编译
 * ⇒ **禁止** import `@ohos.*` / ArkUI 全局类型（`@kit.ArkWeb` 的 `webview` 也不行）。
 * 所以这里只放"信封的形状 + 解析/编码/白名单"这些**能脱机验证**的纯函数；把协议接到
 * ArkWeb 上（`javaScriptProxy` / `runJavaScript`）由 `components/WebSurface.ets` 干。
 *
 * ── 这个模块存在的理由 ─────────────────────────────────────────────────────────
 * 插件 UI 是**浏览器 ESM bundle**（web `plugin-runtime/loader.ts` 的 `await import(entryUrl)`），
 * 跑在 ArkWeb 里；它要调原生（拿 host 能力/回传消息）只能走 `window.xbotNative` 这个
 * `javaScriptProxy` 对象。**桥的另一端（页面）是不受信任的**：任何页面脚本都能调
 * `postMessage(任意串)` ⇒ 解析层必须**防御性**：非 JSON、缺字段、类型不符、id/type 空或超长、
 * payload 超限，一律 `null`（**绝不抛**，绝不把异常穿透到主链路）。
 *
 * ── 信封（line 协议：一条消息 = 一个 JSON 对象字符串）────────────────────────────
 *   { "v": 1, "id": "req-1", "type": "call", "payload": "{\"method\":\"x\"}" }
 *   · v       协议版本（int）。不匹配即拒（fail-closed，避免旧页面用错语义）。
 *   · id      关联 id（`[A-Za-z0-9_.:-]{1,128}`）—— 请求/响应配对用；空或超长即拒。
 *   · type    消息类型，**必须在白名单内**（`bridgeTypeIsAllowed`）—— 避免把任意字符串当指令。
 *   · payload **字符串**（通常是再一层 JSON，由懂语义的上层解析）。
 *     为什么是 string 而不是嵌套对象：① ArkTS 禁 untyped 对象字面量，嵌套动态对象在原生侧
 *     无法安全取字段；② 让**协议层**保持"对载荷完全无知"（不认识业务），业务形状交给上层
 *     （store/rpc）—— 桥只做搬运与校验，不做业务解释。
 *
 * ── 上限（自己定的合理值，注释说明）──────────────────────────────────────────────
 *   id ≤ 128         —— 足够容纳 UUID/`req-N`，防超长 id 塞爆日志/映射键。
 *   type ≤ 64        —— 白名单成员都很短；超出必是构造攻击。
 *   payload ≤ 256 KiB —— 单条桥消息足够承载一次 UI 回传/工具结果；再大应走文件/HTTP 通道，
 *                        不该堵在同步 JS 桥上（同步桥会阻塞渲染线程）。见 WebSurface 注释。
 *   json ≤ payload + 4 KiB（信封开销）—— 先拒超大原始串，避免对大串做 JSON.parse 白烧 CPU。
 */

// ── 常量（协议契约；改动会同步反映到测试锚点）────────────────────────────────────
/** 协议版本。页面与原生必须一致。 */
export const BRIDGE_VERSION: number = 1;
/** id 最大长度（`{1,128}` 的正则里也硬编码了这个数字，改这里要一起改）。 */
export const BRIDGE_MAX_ID_LEN: number = 128;
/** type 最大长度。 */
export const BRIDGE_MAX_TYPE_LEN: number = 64;
/** payload 最大长度（**256 KiB**）：单条 UI 回传足够；更大的数据走文件/HTTP 通道。 */
export const BRIDGE_MAX_PAYLOAD_LEN: number = 262144;
/** 原始 JSON 串最大长度 = payload 上限 + 信封字段/转义开销（4 KiB 余量）。 */
export const BRIDGE_MAX_JSON_LEN: number = BRIDGE_MAX_PAYLOAD_LEN + 4096;

/**
 * 允许的消息类型白名单。页面**只能**发这几种（其余一律拒），避免把任意字符串当指令。
 *
 * 页面 → 原生：`ready`（页面就绪握手）/ `call`（请求 host 能力，等 `result`）/
 *             `notify`（fire-and-forget host 调用）/ `log`（页面日志）/
 *             `resize`（请求 host chrome 尺寸）/ `openExternal`（系统浏览器打开）/ `close`（请求关面板）
 * 原生 → 页面：`init`（能力/主题下发）/ `result`（`call` 的响应）/ `event`（host 主动推送）/ `theme`（主题变更）
 *
 * ⚠️ 这是**波1a 定的契约骨架**；波1b（页面侧）若要新增类型，在**这里**加，别在组件里旁路判断。
 */
export const BRIDGE_TYPES: string[] = [
  'ready', 'call', 'notify', 'log', 'resize', 'openExternal', 'close',
  'init', 'result', 'event', 'theme',
];

/** id 允许的字符集（字母/数字/下划线/点/冒号/连字符），1..BRIDGE_MAX_ID_LEN。 */
const BRIDGE_ID_RE: RegExp = /^[A-Za-z0-9_.:-]{1,128}$/;

/** 类型是否在白名单内（O(n) 线性查，n=11，无需 Set）。 */
export function bridgeTypeIsAllowed(type: string): boolean {
  for (let i = 0; i < BRIDGE_TYPES.length; i++) {
    if (BRIDGE_TYPES[i] === type) {
      return true;
    }
  }
  return false;
}

/** 桥消息信封（ArkTS 用 class；禁无类型对象字面量）。字段顺序即 JSON 输出顺序。 */
export class BridgeMessage {
  v: number = BRIDGE_VERSION;
  id: string = '';
  type: string = '';
  payload: string = '';
  constructor(v: number, id: string, type: string, payload: string) {
    this.v = v;
    this.id = id;
    this.type = type;
    this.payload = payload;
  }
}

/** 解析中间体（对应线上 JSON 的字段，全可选 —— 因为外部输入可能缺字段/类型不符）。 */
interface BridgeWire {
  v?: number;
  id?: string;
  type?: string;
  payload?: string;
}

/** 桥同步返回的**结构化回执**（页面调用 `xbotNative.postMessage(...)` 的返回值）。 */
export class BridgeAck {
  ok: boolean = false;
  error: string = '';
  constructor(ok: boolean, error: string) {
    this.ok = ok;
    this.error = error;
  }
}

/**
 * 构造**结构化回执**（原生 → 页面的同步返回值）。`error` 由原生侧常量给出（非外部串），
 * 仍经 `JSON.stringify` 转义，保证回执恒为合法 JSON 串。
 */
export function encodeBridgeAck(ok: boolean, error: string): string {
  try {
    return JSON.stringify(new BridgeAck(ok, error));
  } catch (e) {
    // 理论上不可达（字段都是原始类型）；兜底返回最小合法回执，绝不抛。
    return ok ? '{"ok":true,"error":""}' : '{"ok":false,"error":"ack encode failed"}';
  }
}

/**
 * **防御性解析**页面发来的桥信封。
 *
 * 契约：**但凡有一处不合法就返回 `null`，永不抛**（页面不受信任，异常绝不能穿透到原生主链路）。
 * 拒绝清单：空/超长原始串、非 JSON、JSON 非对象（`null`/数组/数字/字符串）、
 *           `v` 非数字或版本不匹配、`id` 非字符串/空/超长/含非法字符、
 *           `type` 非字符串/空/超长/不在白名单、`payload` 非字符串/超限。
 */
export function parseBridgeMessage(json: string): BridgeMessage | null {
  try {
    // ① 原始串粗筛（先拒空/超长，避免对大串做 JSON.parse）
    if (json === undefined || json === null) {
      return null;
    }
    if (json.length === 0 || json.length > BRIDGE_MAX_JSON_LEN) {
      return null;
    }
    // ② JSON.parse（失败即 null）—— 包在 try 里，绝不让 SyntaxError 外泄
    let raw: BridgeWire;
    try {
      raw = JSON.parse(json) as BridgeWire;
    } catch (e) {
      return null;
    }
    // ③ 必须是个对象：`null` / 数组 / 数字 / 字符串 一律拒（`raw` 缺省访问会返回 undefined，
    //    但 `null` 直接取字段会抛 ⇒ 先显式挡掉，再靠 try 兜底）。
    if (raw === null || raw === undefined) {
      return null;
    }
    if (Array.isArray(raw)) {
      return null;
    }
    // ④ 逐字段类型/范围校验
    const v: number | undefined = raw.v;
    const id: string | undefined = raw.id;
    const type: string | undefined = raw.type;
    const payload: string | undefined = raw.payload;
    if (v === undefined || typeof v !== 'number' || v !== BRIDGE_VERSION) {
      return null;
    }
    if (id === undefined || typeof id !== 'string' || !BRIDGE_ID_RE.test(id)) {
      return null;
    }
    if (type === undefined || typeof type !== 'string' || type.length > BRIDGE_MAX_TYPE_LEN) {
      return null;
    }
    if (!bridgeTypeIsAllowed(type)) {
      return null;
    }
    if (payload === undefined || typeof payload !== 'string' || payload.length > BRIDGE_MAX_PAYLOAD_LEN) {
      return null;
    }
    return new BridgeMessage(v, id, type, payload);
  } catch (e) {
    // 最后兜底：任何未预期异常都吞成 null（对外语义 = "不是一条合法消息"）。
    return null;
  }
}

/**
 * 编码**原生 → 页面**的桥信封（与 `parseBridgeMessage` 对称）。
 *
 * 出站同样做一次对称校验：坏信封**不推给页面**（返回空串，调用方应放弃发送）。
 * 永不抛（异常吞成空串）。
 */
export function encodeBridgeMessage(msg: BridgeMessage): string {
  try {
    if (msg === null || msg === undefined) {
      return '';
    }
    const okV: boolean = msg.v === BRIDGE_VERSION;
    const okId: boolean = BRIDGE_ID_RE.test(msg.id);
    const okType: boolean = msg.type.length <= BRIDGE_MAX_TYPE_LEN && bridgeTypeIsAllowed(msg.type);
    const okPayload: boolean = msg.payload.length <= BRIDGE_MAX_PAYLOAD_LEN;
    if (!okV || !okId || !okType || !okPayload) {
      return '';
    }
    const wire: BridgeWire = { v: msg.v, id: msg.id, type: msg.type, payload: msg.payload };
    return JSON.stringify(wire);
  } catch (e) {
    return '';
  }
}

/**
 * 便捷构造：**校验通过**的信封，否则 `null`（调用方据此放弃发送）。
 * 与 `parseBridgeMessage` 共用同一套规则（judgment 与 encode 同源）。
 */
export function makeBridgeMessage(id: string, type: string, payload: string): BridgeMessage | null {
  try {
    if (typeof id !== 'string' || !BRIDGE_ID_RE.test(id)) {
      return null;
    }
    if (typeof type !== 'string' || type.length > BRIDGE_MAX_TYPE_LEN || !bridgeTypeIsAllowed(type)) {
      return null;
    }
    if (typeof payload !== 'string' || payload.length > BRIDGE_MAX_PAYLOAD_LEN) {
      return null;
    }
    return new BridgeMessage(BRIDGE_VERSION, id, type, payload);
  } catch (e) {
    return null;
  }
}

// ── 宿主侧动作判定（纯函数；副作用由 components/WebSurface.ets 执行）────────────

/** 动作：请求关闭承载页面（页面调用 `xbotNative.postMessage({type:'close'})`）。 */
export const BRIDGE_ACTION_CLOSE: string = 'close';
/** 动作：把页面日志转写到原生日志（hilog/console）。 */
export const BRIDGE_ACTION_LOG: string = 'log';
/** 动作：页面就绪握手 ⇒ 宿主回一条 `init`（下发主题等能力）。 */
export const BRIDGE_ACTION_READY: string = 'ready';
/** 动作：**不处理**（业务类型由上层接线；未接线时既不崩也不编造语义）。 */
export const BRIDGE_ACTION_IGNORE: string = 'ignore';

/** 宿主动作（`kind` + 供日志用的 `text`）。 */
export class BridgeHostAction {
  kind: string = BRIDGE_ACTION_IGNORE;
  text: string = '';

  constructor(kind: string, text: string) {
    this.kind = kind;
    this.text = text;
  }
}

/**
 * 一条桥消息 → 宿主**该做什么**（纯函数，可脱机单测）。
 *
 * 边界（有意为之）：
 *   · 只判定**宿主 chrome 级、无业务含义**的三种：`close` / `log` / `ready`；
 *   · 业务类型（`call` / `notify` / `result` / `event` / `theme` / `resize` / `openExternal`）
 *     一律 `ignore` —— 它们需要**上层**（组件注入的 `onBridgeMessage`）决定，宿主组件
 *     **不替上层编造语义**（例如"打开外部浏览器"涉及系统能力与白名单，不能顺手实现）。
 */
export function hostActionFor(msg: BridgeMessage): BridgeHostAction {
  if (msg === null || msg === undefined) {
    return new BridgeHostAction(BRIDGE_ACTION_IGNORE, '');
  }
  if (msg.type === 'close') {
    return new BridgeHostAction(BRIDGE_ACTION_CLOSE, '');
  }
  if (msg.type === 'log') {
    // 日志正文来自不受信任的页面 ⇒ 截断，避免把巨串灌进日志系统
    const t: string = typeof msg.payload === 'string' ? msg.payload : '';
    return new BridgeHostAction(BRIDGE_ACTION_LOG, t.length > 512 ? t.substring(0, 512) : t);
  }
  if (msg.type === 'ready') {
    return new BridgeHostAction(BRIDGE_ACTION_READY, '');
  }
  return new BridgeHostAction(BRIDGE_ACTION_IGNORE, '');
}

/**
 * `init` 消息的 payload（宿主 → 页面：下发主题等能力；页面据此与宿主外观对齐）。
 * 纯函数 + `JSON.stringify`（**防注入**：值一律当数据处理，不拼字符串）。
 */
export function bridgeInitPayload(theme: string): string {
  const t: string = typeof theme === 'string' ? theme : '';
  try {
    return JSON.stringify({ theme: t });
  } catch (e) {
    return '{"theme":""}';
  }
}
