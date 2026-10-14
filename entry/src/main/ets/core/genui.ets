/**
 * genui.ets —— **GenUI（`display_html`）工具结果的原生面板判据**（纯逻辑，零依赖，可脱机单测）。
 *
 * ── 为什么必须有这一层（用户原话，目标④）──────────────────────────────────────
 * 「必须真的支持 web 的所有插件和功能…比如**统计插件的面板我们看不到**」。
 * `xbot.genui` 是 web 内置插件（后端 `plugins/xbot-genui`）：它给 web 频道声明工具
 * `display_html`，把 LLM 生成的**交互式 TSX 面板**（ECharts 图表 / 组件库 / three.js）
 * 直接渲染在聊天流里（web `components/agent/GenUIPanel.tsx` + `plugins/SandboxedUI.tsx`）。
 * 原生端此前把它当**一枚普通工具 pill** ⇒ 用户看不到任何面板（= 本条诉求的根因）。
 *
 * ── 原生为什么不能自己渲染这段 TSX ────────────────────────────────────────────
 * web 用 `sucrase` 编译 TSX + `new Function()` 求值 + React 挂载（`SandboxedUI.tsx:33`）。
 * ⛔ ArkTS **禁动态求值**（无 `eval`/`new Function`），亦无 React ⇒ 原生**不可能**执行它。
 *
 * ── 与 web 一致的落地形态（⛔ 零自造协议、零插件特判）──────────────────────────
 * 复用 web **自己的**分享渲染链（`xbot.genui` 插件**自己注册**的 `shareRenderer`）：
 *   ① `POST /api/share/create`（后端 `channel/web/web_share.go:34`）body
 *      `{plugin_id, content_type:'xbot.genui/tsx', payload:<TSX>, title}`
 *      ⇒ 回 `{token, path:'/s/<token>'}`（`:74-82`）；
 *   ② 把 `<host><path>` 交 `WebSurface`（ArkWeb）—— web SPA 的 `/s/:token` 路由
 *      （`web/src/App.tsx:45`）把它交给**插件自己的** shareRenderer
 *      （`web/src/plugins/genui/index.tsx:99,214`）⇒ `SandboxedUI` 渲染**同一个面板**，
 *      且**只渲染这个面板**（用户点名过：不要「整屏变成 web 版的完整聊天应用」）。
 * ⇒ 宿主**零插件特判**：本文件只认**工具声明**里的 `ui_mode==='genui'`
 *   （服务端通用 UI 元数据 `tools/ui_decl.go`）；插件 id / content type 是**注册表**
 *   （可扩展），不是散落在渲染路径里的 if。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────────────
 *   ⛔ core/ ⇒ 被 `tools/tests/run.sh` 当**纯 TS** 编译：禁 import ArkUI / `@ohos.*`；
 *      禁无类型对象字面量（一律 `class`）；无 `any`；不用 spread / `??`。
 */
import { ToolProgress } from './types';

/** 工具 UI 声明里的模式（后端 `plugins/xbot-genui/main.go:190 UI.Mode = "genui"`）。 */
export const GENUI_UI_MODE: string = 'genui';

/** 注册表：GenUI 面板分享所属的插件 id（`plugins/xbot-genui` 清单 `id`）。 */
export const GENUI_PLUGIN_ID: string = 'xbot.genui';

/** 注册表：GenUI 面板的分享内容类型（`plugins/genui/index.tsx:22 SHARE_CONTENT_TYPE`）。 */
export const GENUI_CONTENT_TYPE: string = 'xbot.genui/tsx';

/** 卡片兜底标题（工具无 `summary` 时；与 web i18n `agent.genui.title` 同义）。 */
export const GENUI_FALLBACK_TITLE: string = '交互式面板';

/** 面板动作文案（卡片上的按钮）。 */
export const GENUI_OPEN_LABEL: string = '打开面板';

/** 服务端负载上限（`channel/web/web_share.go:27 shareMaxPayload = 1 << 20`，1 MiB）。 */
export const GENUI_MAX_PAYLOAD: number = 1 << 20;

/** 该工具是否是 GenUI 工具（判据 = 服务端下发的通用 UI 元数据，**不看工具名**）。 */
export function isGenuiTool(t: ToolProgress | null | undefined): boolean {
  if (t === undefined || t === null) {
    return false;
  }
  const m: string = t.ui_mode !== undefined && t.ui_mode !== null ? t.ui_mode : '';
  return m === GENUI_UI_MODE;
}

/**
 * 工具是否**失败**（失败 ⇒ 绝不渲染 UI）。
 *
 * 逐字对齐 web `plugins/genui/index.tsx:81-82`：`r.status === 'error'` ⇒ 不渲染。
 * 为什么关键：被拒/重试的 `display_html` **保留完整 args.code** 但没有落库 UI
 * ⇒ 照渲染会得到一个永远空着的高面板（web 注释原文记着 2026-08-28 的踩坑）。
 * ⚠️ 原生 `ToolProgress` 没有 web 的 `result.content` 字段 ⇒ 仅能判 `status`
 *   （服务端状态词表见 `core/toolstatus.ets:renderKind`：`error`/`failed`）。
 */
export function genuiFailed(t: ToolProgress | null | undefined): boolean {
  if (t === undefined || t === null) {
    return true;
  }
  const s: string = t.status !== undefined && t.status !== null ? t.status : '';
  return s === 'error' || s === 'failed';
}

/**
 * `stripGenUIPrefix` —— 逐字移植 web `plugins/genui/index.tsx:57-67`（`SandboxedUI.tsx:103` 同）。
 *
 * LLM 习惯在 TSX 前写一行散文（如「这是一个统计面板：」）⇒ 若首行既不是代码起始符、
 * 又确实是一个 TSX 模块（含 `export default` / `function App` / 大写组件标签），就丢掉首行。
 */
export function stripGenuiPrefix(code: string): string {
  const c: string = code !== undefined && code !== null ? code : '';
  if (c.length === 0) {
    return '';
  }
  const lines: string[] = c.split('\n');
  if (lines.length > 1) {
    const first: string = lines[0].trim();
    const looksLikeCode: boolean = /^(import|export|const|function|class|return|\/\/|\/\*|#|\{|\()/.test(first);
    const isModule: boolean = /export default|function App|<[A-Z]/.test(c);
    if (!looksLikeCode && isModule) {
      return lines.slice(1).join('\n').trimStart();
    }
  }
  return c;
}

/** 从工具 `args`（JSON 串）里取 `code` 字段；坏 JSON / 缺失 ⇒ 空串。 */
function codeFromArgs(args: string): string {
  const raw: string = args !== undefined && args !== null ? args.trim() : '';
  if (raw.length === 0) {
    return '';
  }
  try {
    const obj: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
    const c: Object | undefined = obj['code'];
    if (c === undefined || c === null) {
      return '';
    }
    return c.toString();
  } catch (e) {
    return '';
  }
}

/**
 * 提取面板 TSX 源码（web `genUICode` 逐字移植：`args.code` 优先 → `detail` 回落）。
 * 失败态 / 取不到 ⇒ `''`（调用方据此**不渲染面板卡**）。
 */
export function genuiCode(t: ToolProgress | null | undefined): string {
  if (t === undefined || t === null) {
    return '';
  }
  if (genuiFailed(t)) {
    return '';
  }
  const fromArgs: string = codeFromArgs(t.args !== undefined && t.args !== null ? t.args : '');
  if (fromArgs.trim().length > 0) {
    return stripGenuiPrefix(fromArgs);
  }
  const d: string = t.detail !== undefined && t.detail !== null ? t.detail : '';
  if (d.trim().length > 0) {
    return stripGenuiPrefix(d);
  }
  return '';
}

/** 是否该为这个工具渲染**面板卡**（GenUI + 未失败 + 有源码）。 */
export function genuiRenderable(t: ToolProgress | null | undefined): boolean {
  return isGenuiTool(t) && genuiCode(t).length > 0;
}

/** 面板负载是否超出服务端上限（超限 ⇒ 服务端 400，调用方先自判、给人类可读提示）。 */
export function genuiPayloadTooLarge(code: string): boolean {
  const c: string = code !== undefined && code !== null ? code : '';
  return c.length > GENUI_MAX_PAYLOAD;
}

/** 卡片标题（工具 `summary` → 兜底文案）。 */
export function genuiCardTitle(t: ToolProgress | null | undefined): string {
  if (t === undefined || t === null) {
    return GENUI_FALLBACK_TITLE;
  }
  const s: string = t.summary !== undefined && t.summary !== null ? t.summary.trim() : '';
  return s.length > 0 ? s : GENUI_FALLBACK_TITLE;
}

/** 卡片副标题（生成中字符数 / 声明用到的前端库）—— 空串 ⇒ 不渲染该行。 */
export function genuiCardSubtitle(t: ToolProgress | null | undefined): string {
  if (t === undefined || t === null) {
    return '';
  }
  const parts: string[] = [];
  const s: string = t.status !== undefined && t.status !== null ? t.status : '';
  if (s === 'generating' || s === 'pending') {
    const n: number = t.gen_chars !== undefined && t.gen_chars !== null ? t.gen_chars : 0;
    parts.push(`生成中 ${n} 字`);
  }
  const libs: string[] | undefined = t.ui_libs;
  if (libs !== undefined && libs !== null && libs.length > 0) {
    parts.push(libs.join(' · '));
  }
  return parts.join(' · ');
}

/**
 * `POST /api/share/create` 的请求体（后端 `protocol/share.go:28 ShareCreateRequest`）。
 * ⛔ ArkTS 禁无类型对象字面量 ⇒ 必须是 class（同 `core/pluginhost.ets` 的做法）。
 */
export class GenuiShareBody {
  /** 分享所属插件（服务端只校验非空；此处是**注册表**值，不是渲染路径里的特判）。 */
  plugin_id: string = GENUI_PLUGIN_ID;
  /** 内容类型（决定服务端/前端交给哪个 `shareRenderer`）。 */
  content_type: string = GENUI_CONTENT_TYPE;
  /** 不透明快照 —— 面板 TSX 源码。 */
  payload: string = '';
  /** 展示标题（分享列表用）。 */
  title: string = '';

  constructor(payload: string, title: string) {
    this.payload = payload;
    this.title = title;
  }
}

/** 构造分享请求体（**判据与请求同源**：调用方不得另拼一份）。 */
export function genuiShareBody(code: string, title: string): GenuiShareBody {
  const c: string = code !== undefined && code !== null ? code : '';
  const t: string = title !== undefined && title !== null ? title.trim() : '';
  return new GenuiShareBody(c, t.length > 0 ? t : GENUI_FALLBACK_TITLE);
}

/**
 * 面板 URL = `<host><path>`（服务端回 `path:'/s/<token>'`）—— 交 `WebSurface` 载入。
 * `host` 末尾斜杠归一掉（避免 `//s/`）；任一侧为空 ⇒ 空串（调用方不得当 URL 用）。
 */
export function genuiPanelUrl(host: string, path: string): string {
  const h: string = host !== undefined && host !== null ? host.trim() : '';
  const p: string = path !== undefined && path !== null ? path.trim() : '';
  if (h.length === 0 || p.length === 0) {
    return '';
  }
  let root: string = h;
  while (root.length > 0 && root.charAt(root.length - 1) === '/') {
    root = root.substring(0, root.length - 1);
  }
  if (p.charAt(0) === '/') {
    return `${root}${p}`;
  }
  return `${root}/${p}`;
}

// ── 分享按钮四态（web `plugins/genui/index.tsx:122-181` ShareablePanel 的原生对等物）──
// web 的分享按钮是**插件自己的 UI**（absolute 定位在面板右上角）：点按 → ctx.share.create
// → clipboard.writeText(absolute URL)。zh-CN.ts 中无 share* 的 i18n key（grep 0 命中）
// ⇒ web 线上真实显示 = t() 的 fallback 值，以下文案**逐字**照抄 fallback：
//   idle『分享』/ busy『生成链接…』/ done『已复制链接』/ error『分享失败，重试』。

/** 分享动作四态（对齐 web `genui/index.tsx:126` `useState<'idle'|'busy'|'done'|'error'>`）。 */
export const SHARE_IDLE: string = 'idle';
export const SHARE_BUSY: string = 'busy';
export const SHARE_DONE: string = 'done';
export const SHARE_ERR: string = 'error';

/**
 * 分享按钮四态文案（判据与渲染同源：组件**只**调本函数，不得内联三元）。
 * 未知/空态回落 idle 文案（失败方向安全：宁可显示可重试的『分享』，不卡死在假状态）。
 */
export function shareLabelOf(state: string): string {
  if (state === SHARE_BUSY) {
    return '生成链接…';
  }
  if (state === SHARE_DONE) {
    return '已复制链接';
  }
  if (state === SHARE_ERR) {
    return '分享失败，重试';
  }
  return '分享';
}
