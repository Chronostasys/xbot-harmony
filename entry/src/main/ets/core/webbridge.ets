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

// ── 依赖（**只引纯 core 模块**，不引入任何 `@ohos.*`/ArkUI —— 本文件仍可脱机单测）──────
// 「打开外链」的协议白名单与相对地址解析（`resolveOpenable`）是**消息层既有**的唯一出口，
// 新窗口代理必须与它同源判定（⛔ 不另写一份白名单 —— 两份必然分叉）。
import { resolveOpenable } from './msgops';
import { sameOrigin } from './pluginhost';

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
  'clipboard',
  // 页面请求宿主弹出**原生 diff**（通用协议：任何 web 插件都能用，零插件特判）
  'diff',
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
/** 动作：页面请求**原生 diff 面板**（payload = `{path, commit}` JSON）。 */
export const BRIDGE_ACTION_DIFF: string = 'diff';
/** 动作：把页面日志转写到原生日志（hilog/console）。 */
export const BRIDGE_ACTION_LOG: string = 'log';
/** 动作：页面就绪握手 ⇒ 宿主回一条 `init`（下发主题等能力）。 */
export const BRIDGE_ACTION_READY: string = 'ready';
/** 动作：**写系统剪贴板**（页面 `navigator.clipboard.writeText` 的代理；见文件末尾长注释）。 */
export const BRIDGE_ACTION_CLIPBOARD: string = 'clipboard';
/** 动作：**不处理**（业务类型由上层接线；未接线时既不崩也不编造语义）。 */
export const BRIDGE_ACTION_IGNORE: string = 'ignore';

/** 动作：**面板导航意图**（页面把"用户想往外走"的动作代理给宿主；§21.122f）。 */
export const BRIDGE_ACTION_NAV: string = 'nav';

/**
 * 面板导航意图的种类（⛔ 与 web `src/workspace/hostBridge.ts:HostNavKind` **同源**，
 * 两侧改动必须同批 —— 少一个 ⇒ 该事件被静默丢弃，症状是"点了没反应"）。
 *
 * · `ready`    —— 嵌入面板挂载握手（`text` = 面板 id）⇒ 宿主据此确认 embed 生效/设标题；
 * · `title`    —— 面板自述标题变化（`text` = 新标题）⇒ 宿主 chrome 标题跟随；
 * · `openFile` —— 用户在面板里要求打开文件（`text` = 路径）⇒ 宿主**触发原生 UI**（原生预览），
 *                 而不是让 web 在 WebView 里再开一个 web 编辑器（用户原话：
 *                 「然后文件面板应该**代理后触发原生 ui**」）。
 */
export const HOST_NAV_READY: string = 'ready';
export const HOST_NAV_TITLE: string = 'title';
export const HOST_NAV_OPEN_FILE: string = 'openFile';
export const HOST_NAV_KINDS: string[] = [HOST_NAV_READY, HOST_NAV_TITLE, HOST_NAV_OPEN_FILE];

/** 导航意图 `text` 上限（标题/路径；页面不受信任 ⇒ 一律收敛，别让巨串进 UI/日志）。 */
export const HOST_NAV_MAX_TEXT_LEN: number = 1024;

/** 一条面板导航意图（`kind` + `text`）。ArkTS 禁无类型对象字面量 ⇒ class。 */
export class HostNavEvent {
  kind: string = '';
  text: string = '';

  constructor(kind: string, text: string) {
    this.kind = kind;
    this.text = text;
  }
}

/** `kind` 是否在导航意图白名单内（未知 ⇒ 调用方**不编造语义**，直接丢弃）。 */
export function hostNavKindIsAllowed(kind: string): boolean {
  for (let i = 0; i < HOST_NAV_KINDS.length; i++) {
    if (HOST_NAV_KINDS[i] === kind) {
      return true;
    }
  }
  return false;
}

/**
 * `nav` 消息的 `payload`（JSON 串）→ 导航意图（纯函数，可脱机单测）。
 *
 * 契约（与 web `hostBridge.postHostNav` 逐字同源）：`{"kind":"…","text":"…"}`。
 * 坏输入（非 JSON / 缺字段 / 类型错 / **kind 不在白名单**）⇒ `null` —— 调用方据此**什么都不做**
 * （fail-closed；⛔ 不猜、不兜底成某个 kind，否则一个坏包会触发错误的原生动作）。
 * `text` 截断到 `HOST_NAV_MAX_TEXT_LEN`（页面不受信任）。
 */
export function parseHostNavPayload(payload: string): HostNavEvent | null {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > BRIDGE_MAX_PAYLOAD_LEN) {
    return null;
  }
  try {
    const raw: object = JSON.parse(payload) as object;
    if (raw === null || raw === undefined || typeof raw !== 'object') {
      return null;
    }
    const rec: Record<string, Object> = raw as Record<string, Object>;
    const k: Object | undefined = rec.kind;
    const t: Object | undefined = rec.text;
    if (typeof k !== 'string' || !hostNavKindIsAllowed(k)) {
      return null;
    }
    const text: string = typeof t === 'string' ? t : '';
    return new HostNavEvent(k, text.length > HOST_NAV_MAX_TEXT_LEN ? text.substring(0, HOST_NAV_MAX_TEXT_LEN) : text);
  } catch (e) {
    return null;
  }
}

/**
 * 剪贴板文本上限（**64 KiB**）：单次复制不可能更多；超大串只会白烧内存/系统调用。
 * ⛔ 与 `BRIDGE_MAX_PAYLOAD_LEN`（256 KiB，信封级）**不是**一个数：信封允许更大的 payload，
 *    剪贴板另外收紧（页面不受信任）。
 */
export const BRIDGE_MAX_CLIPBOARD_LEN: number = 65536;

/**
 * `clipboard` 消息的 payload → 要写入剪贴板的文本（纯函数）。
 *
 * 契约：**payload 即原文**（⛔ 不再套一层 JSON —— 否则"复制一段 JSON 文本"会被误当信封解析，
 * 用户复制的内容与粘贴结果不一致，且这种歧义无法从数据上分辨）。
 * 坏输入（非字符串/空/超限）⇒ `''`（调用方据此**不写剪贴板**，避免把空串覆盖掉用户剪贴板）。
 */
export function clipboardTextOf(msg: BridgeMessage): string {
  if (msg === null || msg === undefined) {
    return '';
  }
  const t: string = typeof msg.payload === 'string' ? msg.payload : '';
  if (t.length === 0) {
    return '';
  }
  return t.length > BRIDGE_MAX_CLIPBOARD_LEN ? t.substring(0, BRIDGE_MAX_CLIPBOARD_LEN) : t;
}


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
  if (msg.type === 'clipboard') {
    // 剪贴板写代理（页面在非 secure context 下拿不到 `navigator.clipboard` ⇒ 由宿主代写）。
    // 文本由 `clipboardTextOf` 收敛；空文本 ⇒ 动作仍回 `clipboard` 但 `text=''`，
    // 上层据此**跳过写入**（⛔ 不能拿空串覆盖用户已有剪贴板）。
    return new BridgeHostAction(BRIDGE_ACTION_CLIPBOARD, clipboardTextOf(msg));
  }
  if (msg.type === 'diff') {
    // 原生 diff 代理（通用）：结构化解析交给 `parseDiffBridgePayload`（纯函数、fail-closed），
    // 这里只把 payload 原样带出。⛔ 不做任何"按插件 id"的分支 —— 所有 web 插件同一出口。
    const p: string = typeof msg.payload === 'string' ? msg.payload : '';
    return new BridgeHostAction(BRIDGE_ACTION_DIFF, p);
  }
  if (msg.type === 'nav') {
    // 面板导航意图代理（§21.122f，嵌入模式）：结构化解析交给 `parseHostNavPayload`
    // （纯函数，白名单 + 截断），这里只把 payload 原样带出，**不在此编造语义**。
    const p: string = typeof msg.payload === 'string' ? msg.payload : '';
    return new BridgeHostAction(BRIDGE_ACTION_NAV, p);
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

// ══════════════════════════════════════════════════════════════════════════════
// `onWindowNew`（新窗口请求）代理 —— 用户定向「代理一部分 web 原生的事件」
//
// ── 为什么必须有（不是可选增强）────────────────────────────────────────────────
// ArkWeb 的**默认行为**：`window.open(...)` / `<a target="_blank">` 触发「创建新窗口」请求；
// 宿主若**不接** `onWindowNew`，ArkWeb 不会自己开窗 ⇒ **整块静默失效**（点了没反应，无日志）。
// 实证：web 侧 `MessageActions.tsx:127`「打开链接」= `window.open(href,'_blank',…)`；
//   `MarkdownRenderer.tsx:274/316`（消息里的链接）、`MarkdownPreview.tsx:122`、
//   `WidgetZone.tsx:43`、`SettingsAbout/Channels` 等共 **9 处 `target="_blank"`**。
//   ⇒ 不代理 = 插件面板/完整 Web UI 里所有外链都是死的。
//
// ⛔ 另一条硬约束（SDK 原文）：`onWindowNew` 里**必须**回调 `handler.setWebController(...)`
//    （不想开新窗就传 null），**否则渲染进程阻塞**。所以组件侧无论判定结果如何都会回话。
//
// 判定分三类（纯函数，可脱机单测；组件只执行副作用）：
//   · `in-web`   —— **同源**（与承载页同 origin）⇒ 在**同一个** WebView 里导航
//                  （同源页面本来就是同一份 SPA 的另一页，开系统浏览器是错的）；
//   · `external` —— 非同源且在可打开协议白名单内 ⇒ 交系统浏览器（`startAbility viewData`）；
//   · `block`    —— 其余（相对地址拼不出绝对、`javascript:`/`data:` 等不在白名单、空）⇒ 只拦不跳。
// ══════════════════════════════════════════════════════════════════════════════

/** 新窗口请求 → 在**同一 WebView** 内导航（同源）。 */
export const NEW_WINDOW_IN_WEB: string = 'in-web';
/** 新窗口请求 → 交**系统浏览器**（非同源 + 白名单协议）。 */
export const NEW_WINDOW_EXTERNAL: string = 'external';
/** 新窗口请求 → **只拦不跳**（不可解析/不在白名单；fail-closed）。 */
export const NEW_WINDOW_BLOCK: string = 'block';

/**
 * 新窗口请求该怎么做（纯函数）。
 *
 * @param targetUrl ArkWeb 给的 `event.targetUrl`（可能是相对地址、也可能带 `javascript:`）
 * @param pageUrl   承载页当前地址（同源判定基准；空 ⇒ 无法判同源 ⇒ 只可能 external/block）
 * @param base      服务端地址（相对地址的解析基准，通常 = `http.baseUrl`）
 */
export function newWindowAction(targetUrl: string, pageUrl: string, base: string): string {
  const raw: string = typeof targetUrl === 'string' ? targetUrl : '';
  // `resolveOpenable` 已做：trim → 白名单协议（http/https/mailto）/ 相对地址按 base 补全
  // ⇒ 拼不出来的（含 `javascript:`、`data:`、协议相对以外的裸相对）一律空串。
  const abs: string = resolveOpenable(raw, typeof base === 'string' ? base : '');
  if (abs.length === 0) {
    return NEW_WINDOW_BLOCK;
  }
  const page: string = typeof pageUrl === 'string' ? pageUrl : '';
  if (page.length > 0 && sameOrigin(abs, page)) {
    return NEW_WINDOW_IN_WEB;
  }
  return NEW_WINDOW_EXTERNAL;
}

// ══════════════════════════════════════════════════════════════════════════════
// `onShowFileSelector`（页面 `<input type=file>`）代理 —— §21.122d 事件代理第三批
//
// ── 为什么必须有（不是可选增强）────────────────────────────────────────────────
// ArkWeb 的**默认行为**：页面里的 `<input type="file">` 触发「显示文件选择器」请求；宿主若
// **不接** `onShowFileSelector`，ArkWeb **不会**自己弹任何选择器，且**必须**回调
// `event.result.handleFileList(...)`（不回话则该请求永久挂着）⇒ 整块静默失效。
// web 侧实证调用点：`MessageInput.tsx:853`（聊天附件）、`SettingsLLM.tsx:264`、
//   `SettingsPlugins.tsx:349`、`PluginManagerPanel.tsx:168`、`SkillManagerPanel.tsx:185`
//   ⇒ 不代理 = 消息里加不了附件、所有"导入插件/skill/配置"的按钮点了没反应。
//
// 判定 = `accept` 属性 → 该弹哪种选择器（纯函数，可脱机单测；组件只执行副作用）：
//   · `image`    —— accept 里的 token **全是**图片类型（`image/*` / `.png` …）⇒ 相册选择器；
//   · `document` —— 其余（空 accept / 通配 accept / 混合类型 / `.zip` 等）⇒ 文件选择器（能力最广）。
// ⛔ 只有"全是图片"才走相册：混合 accept 下相册给不出 PDF/zip ⇒ 用户"选不到想要的文件"。
// ══════════════════════════════════════════════════════════════════════════════

/** `accept` 全为图片 ⇒ 相册选择器。 */
export const FILE_PICK_IMAGE: string = 'image';
/** 其余（空 accept、通配 accept、混合类型、文档）⇒ 文件选择器。 */
export const FILE_PICK_DOCUMENT: string = 'document';

/**
 * 一次能交给页面的文件数上限。
 * ⛔ 必须与聊天附件上限同源（`core/attach.ets:MAX_ATTACH`）—— 页面拿到的文件最终多半要作为
 *    附件上传，两边不一致会让用户"选了 12 个却只上去 9 个"。测试钉住这条同源契约。
 */
export const FILE_PICK_MAX_COUNT: number = 9;

/** 相册能给出的图片扩展名（用于 `accept=".png,.jpg"` 这类按扩展名声明的情形）。 */
const IMAGE_EXTS: string[] = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif', 'svg', 'ico', 'tif', 'tiff',
];

/** 一个 accept token 是否"图片"（`image/*`、`image/png`、`.jpg` ⇒ true；通配 accept、`.pdf` ⇒ false）。 */
function acceptTokenIsImage(tok: string): boolean {
  const t: string = tok.trim().toLowerCase();
  if (t.length === 0) {
    return false;
  }
  if (t === 'image/*' || t.indexOf('image/') === 0) {
    return true;
  }
  if (t.charAt(0) === '.') {
    return IMAGE_EXTS.indexOf(t.substring(1)) >= 0;
  }
  return false;
}

/**
 * `accept` 列表 → 选择器种类（纯函数）。
 *
 * ⛔ 通配 accept、空串、未知类型一律判 `document`（fail-open 到能力更广的那个 —— 文件选择器能选到
 *    图片，相册选不到 PDF；判错的代价不对称）。
 */
export function filePickKindOf(acceptTypes: string[]): string {
  if (!Array.isArray(acceptTypes)) {
    return FILE_PICK_DOCUMENT;
  }
  let seen: number = 0;
  for (let i = 0; i < acceptTypes.length; i++) {
    const raw: string = typeof acceptTypes[i] === 'string' ? acceptTypes[i] : '';
    // 一个 token 里可能塞了多个条目（`accept="image/*,.pdf"`）—— 按逗号再切一次更稳。
    const parts: string[] = raw.split(',');
    for (let j = 0; j < parts.length; j++) {
      const tok: string = parts[j].trim();
      if (tok.length === 0) {
        continue;
      }
      seen++;
      if (!acceptTokenIsImage(tok)) {
        return FILE_PICK_DOCUMENT;
      }
    }
  }
  return seen > 0 ? FILE_PICK_IMAGE : FILE_PICK_DOCUMENT;
}

// ══════════════════════════════════════════════════════════════════════════════
// `onDownloadStart`（页面触发的下载）代理 —— 同批
//
// ── 为什么必须有 ────────────────────────────────────────────────────────────────
// ArkWeb 不接 `onDownloadStart` 时**不会**自行下载 ⇒ 页面里"导出/下载"的链接点了没反应。
// web 侧实证：文件面板下载（`/api/files/download?key=…`）、插件/skill 的"导出 zip"、
//   会话导出等。宿主侧用 `request.downloadFile` 落进沙箱后回话给上层（toast/提示）。
//
// 文件名推导必须**先信服务端**（`Content-Disposition`），再退到 URL 路径，最后兜底：
//   ⛔ 直接用 URL 最后一段当文件名会被 `?key=…&inline=1` 与 URL 编码坑到（可能得到空名、
//      或 `%E4%B8%AD%E6%96%87.pdf` 这种乱码名）；而 `Content-Disposition` 是服务端的**意图**。
// ══════════════════════════════════════════════════════════════════════════════

/** 推导不出名字时的兜底文件名（不含扩展名）。 */
export const DOWNLOAD_FALLBACK_NAME: string = 'xbot-download';
/** 文件名长度上限（含扩展名）—— 防超长 header/URL 把落盘名撑爆。 */
export const DOWNLOAD_MAX_NAME_LEN: number = 96;

/** 从 `Content-Disposition` 取值：优先 RFC 5987 `filename*=UTF-8''…`，其次 `filename="…"`。 */
function nameFromDisposition(cd: string): string {
  const s: string = typeof cd === 'string' ? cd : '';
  if (s.length === 0) {
    return '';
  }
  // filename*=UTF-8''%E4%B8%AD.pdf（带编码）—— 先取它，因为它才是"非 ASCII 名"的正源
  const star: number = s.toLowerCase().indexOf("filename*=");
  if (star >= 0) {
    let v: string = s.substring(star + 10).trim();
    const semi: number = v.indexOf(';');
    if (semi >= 0) {
      v = v.substring(0, semi);
    }
    v = v.trim();
    // `UTF-8''<pct-encoded>` ⇒ 去掉 charset'lang' 前缀
    const q: number = v.indexOf("''");
    if (q >= 0) {
      v = v.substring(q + 2);
    }
    const decoded: string = decodePct(v);
    if (decoded.length > 0) {
      return decoded;
    }
  }
  const plain: number = s.toLowerCase().indexOf('filename=');
  if (plain >= 0) {
    let v: string = s.substring(plain + 9).trim();
    const semi: number = v.indexOf(';');
    if (semi >= 0) {
      v = v.substring(0, semi);
    }
    v = v.trim();
    if (v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') {
      v = v.substring(1, v.length - 1);
    }
    return v.trim();
  }
  return '';
}

/** `%E4%B8%AD` → `中`（非法转义原样保留；`decodeURIComponent` 失败时退化为原文）。 */
function decodePct(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

/** URL 路径最后一段（去掉 query/hash 与百分号编码）。 */
function nameFromUrlPath(url: string): string {
  let s: string = typeof url === 'string' ? url : '';
  if (s.length === 0) {
    return '';
  }
  const hash: number = s.indexOf('#');
  if (hash >= 0) {
    s = s.substring(0, hash);
  }
  const qm: number = s.indexOf('?');
  if (qm >= 0) {
    s = s.substring(0, qm);
  }
  const slash: number = s.lastIndexOf('/');
  if (slash >= 0) {
    s = s.substring(slash + 1);
  }
  return decodePct(s).trim();
}

/** mime → 扩展名（无把握时返回空串 —— ⛔ 不要瞎猜，宁可没有扩展名）。 */
function extensionForMime(mime: string): string {
  const m: string = (typeof mime === 'string' ? mime : '').trim().toLowerCase();
  const semi: number = m.indexOf(';');
  const base: string = semi >= 0 ? m.substring(0, semi).trim() : m;
  if (base === 'application/pdf') { return 'pdf'; }
  if (base === 'application/zip' || base === 'application/x-zip-compressed') { return 'zip'; }
  if (base === 'application/json') { return 'json'; }
  if (base === 'text/plain') { return 'txt'; }
  if (base === 'text/markdown') { return 'md'; }
  if (base === 'text/csv') { return 'csv'; }
  if (base === 'text/html') { return 'html'; }
  if (base === 'image/png') { return 'png'; }
  if (base === 'image/jpeg') { return 'jpg'; }
  if (base === 'image/gif') { return 'gif'; }
  if (base === 'image/webp') { return 'webp'; }
  if (base === 'image/svg+xml') { return 'svg'; }
  if (base === 'video/mp4') { return 'mp4'; }
  if (base === 'audio/mpeg') { return 'mp3'; }
  if (base.indexOf('+json') > 0) { return 'json'; }
  if (base.indexOf('+xml') > 0) { return 'xml'; }
  if (base === 'application/xml') { return 'xml'; }
  return '';
}

/**
 * 落盘文件名清洗（纯函数）：去掉路径分量/控制字符/尾点，`..` 归零，超长截断。
 * ⛔ 这是**安全边界**（决定写哪个文件），不是美化 —— 页面完全可能给出 `../../x`。
 */
export function sanitizeFileName(name: string): string {
  let s: string = typeof name === 'string' ? name : '';
  // 路径分隔符一律压平（含 Windows 反斜杠）
  s = s.split('/').join('_').split('\\').join('_');
  // 控制字符 + 各平台的非法字符
  s = s.replace(/[\u0000-\u001f\u007f]/g, '');
  s = s.replace(/[:*?"<>|]/g, '_');
  // 前后空白与点（`.`/`..`、`x.` 在多数文件系统上语义特殊）
  s = s.trim();
  s = s.replace(/^\.+/, '');
  s = s.replace(/\.+$/, '');
  if (s.length > DOWNLOAD_MAX_NAME_LEN) {
    s = s.substring(0, DOWNLOAD_MAX_NAME_LEN);
    s = s.replace(/\.+$/, '');
  }
  return s;
}

/** 有扩展名吗（只看最后一段，且不是纯点/数字点——`a.b.c` 算有，`x.` 不算）。 */
function hasExtension(name: string): boolean {
  const dot: number = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1;
}

/**
 * 下载文件名（纯函数）：`Content-Disposition` → URL 路径 → 兜底；缺扩展名时按 mime 补。
 * 返回的一定是**安全的单段文件名**（不含 `/`、非空、≤ 上限）。
 */
export function downloadFileNameOf(url: string, contentDisposition: string, mime: string): string {
  let name: string = sanitizeFileName(nameFromDisposition(contentDisposition));
  if (name.length === 0) {
    name = sanitizeFileName(nameFromUrlPath(url));
  }
  if (name.length === 0) {
    name = DOWNLOAD_FALLBACK_NAME;
  }
  if (!hasExtension(name)) {
    const ext: string = extensionForMime(mime);
    if (ext.length > 0) {
      name = `${name}.${ext}`;
    }
  }
  return name;
}

