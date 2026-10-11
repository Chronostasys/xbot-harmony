/**
 * 会话导出 —— 纯逻辑（可脱机单测；**不含**任何 UI / 网络 / 文件系统）。
 *
 * 权威来源（逐条核对，web = `/Users/bobli/src/xbot/web`；字段面以服务端
 * `protocol/session_export.go` + `protocol/jsonl_export.go` 为准）：
 *   · `ExportedSession` / `ExportedMessage` / `ExportedRecord` 字段面：
 *       web `src/components/agent/api.ts:290-329`；Go `protocol/session_export.go:29-131`。
 *   · `downloadSession` 的 5 种形态：web `src/components/agent/api.ts:378-582`：
 *       native（JSON, `:560-566`）· openai（JSON, `:396-422`）· codex（JSONL, `:424-462`）
 *       · multica（JSONL, `:464-558`）· benchmark（JSONL, `:383-391`）。
 *   · 文件名清理：web `src/components/agent/api.ts:570-572`。
 *   · 开发者 turn+iter 文本导出：web `src/components/settings/SettingsDeveloper.tsx:60-92`。
 *
 * ⛔ **web 没有 markdown 形态的会话导出**（`grep -rniE "text/markdown|\\.md['\"]"` 无导出命中；
 *    服务端 RPC 表也只有 `export_session`/`export_session_jsonl`，`serverapp/rpc_table.go:1539/1577`
 *    ⇒ 最接近的"文本"形态是开发者 turn+iter 的 `text/plain` `.txt`）。**本模块不发明 md**。
 *
 * ⚠️ 本文件属 `core/`：脱机 harness（`tools/tests/run.sh`）把它当**纯 TS** 编译
 *    ⇒ **禁止** import ArkUI / `@ohos.*`。
 * ⚠️ 时间与随机 id 一律**注入**（web 用 `new Date()`/`crypto.randomUUID()`；ArkTS 无 crypto）
 *    ⇒ 纯函数可判别、可复现（见 ExportClock）。
 * ⚠️ `content`/`tool_calls` 用 `Object` 承载（承载 string / 数组等原语或引用值）—— 依托
 *    ArkTS `Object` 是所有类型的公共超类型（同 `core/rpc.ets:46 params: Object` 的用法）。
 *    ⚠️ 本文件**尚未被 UI 消费** ⇒ ArkTS 严格检查要等接线后才跑到（见本仓 GOTCHAS 的
 *    "未被消费的文件不被类型检查"）；下一波接线后请重跑 `tools/gate.sh` 复核。
 */
import { nonEmpty } from './guards';

// ── 格式判别（对齐 web `agent/api.ts:340 ExportFormat` 中 client 侧会自行生成的分支）──────

export const EXPORT_NATIVE: string = 'native';
export const EXPORT_OPENAI: string = 'openai';
export const EXPORT_CODEX: string = 'codex';
export const EXPORT_MULTICA: string = 'multica';
export const EXPORT_BENCHMARK: string = 'benchmark';

// ── 输入类型（逐字对齐 web `agent/api.ts:290-329` + Go `protocol/session_export.go`）──────

/** Token 用量（Go `protocol/session_export.go:70-74`）。字段序 = 声明序。 */
export class ExportedUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

/**
 * 一条消息（web `api.ts:302-311` / Go `ExportedMessage` `session_export.go:78-86`）。
 *
 * `content` 与 `tool_calls` 刻意声明为不透明 `Object`：
 *   · web 对二者是**原样透传**（`entry.tool_calls = msg.tool_calls`、`entry.content = msg.content`）
 *     ⇒ 保持原形最忠实，也避免 ArkTS 联合类型/保留字（`function`）字段名的坑。
 *   · `content` 实际是 `string | Array<{type,text?}>`；`tool_calls` 是
 *     `Array<{id,type,function:{name,arguments}}>`（OpenAI function-calling 形态）。
 */
export class ExportedMessage {
  role: string = '';
  content: Object = '';
  reasoning?: string;
  detail?: string;
  tool_calls?: Object;
  tool_call_id?: string;
  name?: string;
  timestamp?: string;
}

/** 一条 append-only history 行（web `api.ts:313-329` / Go `ExportedRecord` `:115-131`）。 */
export class ExportedRecord {
  history_id: number = 0;
  record_type: string = '';
  target_history_id?: number;
  record_data?: Object;
  role?: string;
  content?: string;
  tool_call_id?: string;
  tool_name?: string;
  tool_arguments?: string;
  tool_calls?: Object;
  detail?: string;
  reasoning?: string;
  display_only?: boolean;
  turn_id?: number;
  created_at?: string;
}

/** 可移植会话（web `api.ts:290-300` / Go `ExportedSession` `:29-45`）。字段序 = 声明序。 */
export class ExportedSession {
  id: string = '';
  model?: string;
  system_instructions?: string;
  messages: ExportedMessage[] = [];
  usage?: ExportedUsage;
  created_at?: string;
  updated_at?: string;
  records?: ExportedRecord[];
  /** Go 的 `iterations`（`session_export.go:44`，omitempty）——native 透传用，不解释。 */
  iterations?: Object;
}

/** benchmark JSONL 记录（Go `protocol/jsonl_export.go:38-61`；web `api.ts:347-368`）。 */
export class DemoPart {
  part_kind: string = '';
  content: string = '';
  tool_name: string = '';
  tool_call_id: string = '';
  args: string = '';
}

export class DemoMessage {
  kind: string = '';
  parts: DemoPart[] = [];
}

export class DemoRecord {
  uuid: string = '';
  question: string = '';
  answer: string = '';
  domain: string = '';
  messages: DemoMessage[] = [];
  correct: boolean = false;
  judge_applied: boolean = false;
}

// ── 时间 / id 注入（纯函数性的关键）─────────────────────────────────────────────

/**
 * 导出的时间与 id 来源。
 *
 * web 直接用 `new Date()` / `Date.now()` / `crypto.randomUUID()`（非确定）；ArkTS 无 crypto。
 * 这里抽成可注入对象：生产侧传当前时间（见 `exportClockNow()`），测试侧传固定值 + 计数器
 * ⇒ 同输入必得同串（对齐 `core/sserec.ets:337` 的"确定性"要求）。
 */
export class ExportClock {
  /** ISO-8601 字符串（web `new Date().toISOString()`）。 */
  nowIso: string = '';
  /** epoch 毫秒（web `Date.now()`）。 */
  nowMs: number = 0;
  private seq: number = 0;

  constructor(nowIso: string, nowMs: number) {
    this.nowIso = nowIso;
    this.nowMs = nowMs;
  }

  /** 等价 web `crypto.randomUUID().slice(0, 8)`（确定化：`id0000001` 截 8 位）。 */
  id8(): string {
    this.seq++;
    const raw: string = `id${this.seq}`;
    return raw.length >= 8 ? raw.substring(0, 8) : raw;
  }

  /** 等价 web `crypto.randomUUID()`（确定化：计数器拼成 uuid 形）。 */
  uuid(): string {
    this.seq++;
    const n: string = `${this.seq}`;
    return `00000000-0000-4000-8000-${n.padStart(12, '0')}`;
  }
}

// ── 文件名（web `agent/api.ts:570-572` + `SettingsDeveloper.tsx:88`）────────────────

/**
 * 文件名标签：`(chatID || 'session').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)`。
 * ⚠️ 顺序不可换：**先替换后截断**（替换会把 1 个非法字符压成 1 个 `_`，长度不变）。
 * ⚠️ web 文件名**不含时间戳**（唯一来源是 chatID）—— 与本仓 SSE 录制器的 `sse-dump-<ts>.ev` 不同。
 */
export function sanitizeExportLabel(chatID: string): string {
  const base: string = (chatID !== undefined && chatID !== null && chatID.length > 0) ? chatID : 'session';
  return base.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60);
}

/** `downloadSession` 的文件名：`<label>.<ext>`。 */
export function exportFilename(chatID: string, ext: string): string {
  return `${sanitizeExportLabel(chatID)}.${ext}`;
}

/** 开发者 turn+iter 导出的文件名（web `SettingsDeveloper.tsx:88`；此处**不**做空值兜底）。 */
export function turnIterFilename(chatID: string): string {
  const label: string = chatID.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
  return `session-${label}-turn-iter.txt`;
}

/** 各形态的扩展名（web `downloadSession` 内联）。 */
export function extForFormat(format: string): string {
  if (format === EXPORT_CODEX || format === EXPORT_MULTICA || format === EXPORT_BENCHMARK) {
    return 'jsonl';
  }
  return 'json';
}

/** 各形态的 MIME（web `downloadSession` 内联）。 */
export function mimeForFormat(format: string): string {
  if (format === EXPORT_CODEX || format === EXPORT_MULTICA || format === EXPORT_BENCHMARK) {
    return 'application/x-jsonlines';
  }
  return 'application/json';
}

// ── 开发者设置页的导出动作表（**唯一来源**；判据与渲染同源）──────────────────────────
//
// 对齐 web：`components/settings/SettingsDeveloper.tsx:42-...` 的三个按钮
// （Turn+Iter txt / multica jsonl / benchmark jsonl）+ `agent/api.ts:560-566` 的 native(JSON) 默认形态。
// ⛔ 组件**不得**自己拼文件名 / 自己选 RPC —— 全从本表派生（改一处即全对齐）。

/** turn+iter 文本形态（web `SettingsDeveloper.tsx:84-92` 的 `text/plain` `.txt`）—— **不是** RPC 格式。 */
export const EXPORT_TURN_ITER: string = 'turn-iter';

/** 一个导出动作（= 设置页的一个按钮）。 */
export class ExportAction {
  /** 稳定 id（UI 的 `ForEach` key）。 */
  id: string = '';
  /** 格式（传给 `extForFormat` / `exportFilename` / 文本分派）。 */
  format: string = '';
  title: string = '';
  desc: string = '';
  /** 是否走专用 RPC `export_session_jsonl`（只有 benchmark 是）。 */
  viaJsonlRpc: boolean = false;

  constructor(id: string, format: string, title: string, desc: string, viaJsonlRpc: boolean) {
    this.id = id;
    this.format = format;
    this.title = title;
    this.desc = desc;
    this.viaJsonlRpc = viaJsonlRpc;
  }
}

/**
 * 开发者设置页的导出动作清单（顺序 = 展示顺序）。
 * 覆盖 web 开发者分区三个按钮 + `downloadSession` 的 native 默认形态 ⇒ **json / jsonl / txt 三态齐**。
 */
export function exportActions(): ExportAction[] {
  return [
    new ExportAction('json', EXPORT_NATIVE, '导出 JSON',
      '服务端整包会话（native 形态，与 Web 端 `downloadSession` 默认一致）。', false),
    new ExportAction('jsonl-multica', EXPORT_MULTICA, '导出 JSONL（Multica）',
      '逐行 JSON，Multica/训练数据形态。', false),
    new ExportAction('jsonl-benchmark', EXPORT_BENCHMARK, '导出 JSONL（benchmark）',
      '逐 turn 记录（走 `export_session_jsonl`）。', true),
    new ExportAction('txt-turn-iter', EXPORT_TURN_ITER, '导出 TXT（Turn + Iter）',
      '人类可读的 turn/iter 顺序清单（Web 端同名按钮）。', false),
  ];
}

/** 该动作的扩展名（turn+iter ⇒ `txt`；benchmark/multica ⇒ `jsonl`；其余 `json`）。 */
export function exportActionExt(a: ExportAction): string {
  if (a.format === EXPORT_TURN_ITER) {
    return 'txt';
  }
  return extForFormat(a.format);
}

/** 该动作的落盘文件名（**唯一来源**；⛔ 组件不拼名、不含时间戳）。 */
export function exportActionFilename(a: ExportAction, chatID: string): string {
  if (a.format === EXPORT_TURN_ITER) {
    return turnIterFilename(chatID);
  }
  return exportFilename(chatID, extForFormat(a.format));
}

/**
 * 本地生成导出文本（web `agent/api.ts:394-566` 的分派）。
 * ⚠️ **benchmark 除外** —— 它由服务端 `export_session_jsonl` 直接给记录，前端只做 `toBenchmarkJsonl` 拼接。
 */
export function renderExportText(format: string, session: ExportedSession, channel: string, chatID: string,
  nowIso: string, clock: ExportClock): string {
  if (format === EXPORT_MULTICA) {
    return toMulticaJsonl(session, clock);
  }
  if (format === EXPORT_CODEX) {
    return toCodexJsonl(session);
  }
  if (format === EXPORT_OPENAI) {
    return toOpenAiJson(session);
  }
  if (format === EXPORT_TURN_ITER) {
    return toTurnIterTxt(session, channel, chatID, nowIso);
  }
  return toNativeJson(session);
}

// ── 内部工具 ──────────────────────────────────────────────────────────────────

/** `content` → 文本（web `typeof x === 'string' ? x : JSON.stringify(x)`）。 */
function contentAsText(content: Object): string {
  if (typeof content === 'string') {
    return content as string;
  }
  return JSON.stringify(content);
}

/** `content` 作为数组（非数组 ⇒ null）。 */
function contentAsParts(content: Object): Object[] | null {
  return Array.isArray(content) ? (content as Object[]) : null;
}

/** 从（不透明的）JSON 对象里按键取值（ArkTS 友好：Record 索引）。 */
function field(o: Object, key: string): Object | undefined {
  return (o as Record<string, Object>)[key];
}

function optionalString(o: Object | undefined): string | undefined {
  if (o === undefined || o === null || typeof o !== 'string') {
    return undefined;
  }
  return o as string;
}

/** 非空（web 的 `if (x)` 真值判断，用于 optional 字符串/数组）。 */

function hasItems(o: Object | undefined): boolean {
  return o !== undefined && Array.isArray(o) && (o as Object[]).length > 0;
}

// ── native（web `api.ts:560-566`）：`JSON.stringify(data, null, 2)` ─────────────────

export function toNativeJson(session: ExportedSession): string {
  return JSON.stringify(session, null, 2);
}

// ── openai（web `api.ts:396-422`）：Chat Completions 请求体 ──────────────────────────

/** openai 单条消息：字段序 role → content → [tool_calls] → [tool_call_id] → [name]。 */
class OpenAiEntry {
  role: string = '';
  content: Object = '';
  tool_calls?: Object;
  tool_call_id?: string;
  name?: string;
}

/** openai 请求体：字段序 model → messages。 */
class OpenAiBody {
  model: string = '';
  messages: OpenAiEntry[] = [];
}

export function toOpenAiJson(session: ExportedSession): string {
  const messages: OpenAiEntry[] = [];
  if (nonEmpty(session.system_instructions)) {
    const sys: OpenAiEntry = new OpenAiEntry();
    sys.role = 'system';
    sys.content = session.system_instructions as string;
    messages.push(sys);
  }
  for (const msg of session.messages) {
    const e: OpenAiEntry = new OpenAiEntry();
    e.role = msg.role;
    e.content = msg.content; // web 的三元是 no-op ⇒ 原样透传（string | parts[]）
    if (hasItems(msg.tool_calls)) {
      e.tool_calls = msg.tool_calls;
    }
    if (nonEmpty(msg.tool_call_id)) {
      e.tool_call_id = msg.tool_call_id;
    }
    if (nonEmpty(msg.name)) {
      e.name = msg.name;
    }
    messages.push(e);
  }
  const body: OpenAiBody = new OpenAiBody();
  body.model = nonEmpty(session.model) ? (session.model as string) : 'gpt-4o';
  body.messages = messages;
  return JSON.stringify(body, null, 2);
}

// ── codex（web `api.ts:424-462`）：每行一条 Codex CLI 消息（JSONL）────────────────────

/** Codex content part：`{type:'input_text'|'output_text', text}`。 */
class CodexContentPart {
  type: string = 'input_text';
  text: string = '';
}

/** Codex 单条：字段序 type → role → content → [reasoning] → [tool_calls] → [tool_call_id] → [name]。 */
class CodexEntry {
  type: string = 'message';
  role: string = '';
  content: CodexContentPart[] = [];
  reasoning?: string;
  tool_calls?: Object;
  tool_call_id?: string;
  name?: string;
}

/** 组装一条 codex message 行（`input_text`/`output_text` 由 role 决定）。 */
function codexLine(role: string, text: string): string {
  const part: CodexContentPart = new CodexContentPart();
  part.type = role === 'assistant' ? 'output_text' : 'input_text';
  part.text = text;
  const e: CodexEntry = new CodexEntry();
  e.type = 'message';
  e.role = role;
  e.content = [part];
  return JSON.stringify(e);
}

export function toCodexJsonl(session: ExportedSession): string {
  const lines: string[] = [];
  if (nonEmpty(session.system_instructions)) {
    const part: CodexContentPart = new CodexContentPart();
    part.type = 'input_text';
    part.text = session.system_instructions as string;
    const sys: CodexEntry = new CodexEntry();
    sys.type = 'message';
    sys.role = 'system';
    sys.content = [part];
    lines.push(JSON.stringify(sys));
  }
  for (const msg of session.messages) {
    const text: string = contentAsText(msg.content);
    const part: CodexContentPart = new CodexContentPart();
    part.type = msg.role === 'assistant' ? 'output_text' : 'input_text';
    part.text = text;
    const e: CodexEntry = new CodexEntry();
    e.type = 'message';
    e.role = msg.role;
    e.content = [part];
    if (nonEmpty(msg.reasoning)) {
      e.reasoning = msg.reasoning;
    }
    if (hasItems(msg.tool_calls)) {
      e.tool_calls = msg.tool_calls;
    }
    if (nonEmpty(msg.tool_call_id)) {
      e.tool_call_id = msg.tool_call_id;
    }
    if (nonEmpty(msg.name)) {
      e.name = msg.name;
    }
    lines.push(JSON.stringify(e));
  }
  // ⚠️ codex **无**结尾换行（web `lines.join('\n')`）—— 与 multica 不同。
  return lines.join('\n');
}

// ── multica（web `api.ts:464-558`）：parentId 链式 JSONL ──────────────────────────────

class MulticaSessionLine {
  type: string = 'session';
  version: number = 3;
  id: string = '';
  timestamp: string = '';
  cwd: string = '';
}

class MulticaModelChange {
  type: string = 'model_change';
  id: string = '';
  parentId: string | null = null;
  timestamp: string = '';
  provider: string = 'macaronai';
  modelId: string = '';
}

class MulticaNormalMsg {
  role: string = '';
  content: Object[] = [];
  timestamp: number = 0;
}

class MulticaToolResultMsg {
  role: string = 'toolResult';
  toolCallId: string = '';
  toolName: string = '';
  content: Object[] = [];
  isError: boolean = false;
  timestamp: number = 0;
}

class MulticaEntry {
  type: string = 'message';
  id: string = '';
  parentId: string | null = null;
  timestamp: string = '';
  message: Object = new MulticaNormalMsg();
}

/** contentPart 的三种形态（用 Record 动态拼，ArkTS 允许 Record 字面量）。 */
function multicaThinking(text: string): Object {
  const o: Record<string, Object> = {};
  o['type'] = 'thinking';
  o['thinking'] = text;
  return o;
}

function multicaToolCall(tc: Object): Object {
  const o: Record<string, Object> = {};
  o['type'] = 'toolCall';
  o['id'] = field(tc, 'id') !== undefined ? field(tc, 'id') as Object : '';
  const fn: Object | undefined = field(tc, 'function');
  o['name'] = (fn !== undefined ? (field(fn, 'name') as Object) : '') as Object;
  const argsRaw: Object = (fn !== undefined ? field(fn, 'arguments') : '') as Object;
  // web：能 JSON.parse 就用解析结果，否则保留原字符串（api.ts:502-503）。
  let args: Object = argsRaw;
  if (typeof argsRaw === 'string') {
    try {
      args = JSON.parse(argsRaw as string) as Object;
    } catch (e) {
      args = argsRaw;
    }
  }
  o['arguments'] = args;
  return o;
}

function multicaText(text: string): Object {
  const o: Record<string, Object> = {};
  o['type'] = 'text';
  o['text'] = text;
  return o;
}

/** 一条 msg 的 contentParts（web `api.ts:494-521`）：thinking → toolCall* → text。 */
function multicaContentParts(msg: ExportedMessage): Object[] {
  const parts: Object[] = [];
  if (nonEmpty(msg.reasoning)) {
    parts.push(multicaThinking(msg.reasoning as string));
  }
  if (hasItems(msg.tool_calls)) {
    for (const tc of msg.tool_calls as Object[]) {
      parts.push(multicaToolCall(tc));
    }
  }
  if (typeof msg.content === 'string') {
    const s: string = msg.content as string;
    if (s.length > 0) {
      parts.push(multicaText(s));
    }
  } else {
    const arr: Object[] | null = contentAsParts(msg.content);
    if (arr !== null) {
      for (const p of arr) {
        if (field(p, 'type') === 'text') {
          const t: string | undefined = optionalString(field(p, 'text'));
          if (nonEmpty(t)) {
            parts.push(multicaText(t as string));
          }
        }
      }
    }
  }
  return parts;
}

export function toMulticaJsonl(session: ExportedSession, clock: ExportClock): string {
  const lines: string[] = [];

  const header: MulticaSessionLine = new MulticaSessionLine();
  header.type = 'session';
  header.version = 3;
  header.id = nonEmpty(session.id) ? (session.id as string) : clock.uuid();
  header.timestamp = nonEmpty(session.created_at) ? (session.created_at as string) : clock.nowIso;
  header.cwd = '';
  lines.push(JSON.stringify(header));

  if (nonEmpty(session.model)) {
    const mc: MulticaModelChange = new MulticaModelChange();
    mc.type = 'model_change';
    mc.id = clock.id8();
    mc.parentId = null;
    mc.timestamp = nonEmpty(session.created_at) ? (session.created_at as string) : clock.nowIso;
    mc.provider = 'macaronai';
    mc.modelId = session.model as string;
    lines.push(JSON.stringify(mc));
  }

  let prevId: string | null = null;
  for (const msg of session.messages) {
    const id: string = clock.id8();
    const ts: string = nonEmpty(msg.timestamp) ? (msg.timestamp as string) : clock.nowIso;
    const parts: Object[] = multicaContentParts(msg);

    const entry: MulticaEntry = new MulticaEntry();
    entry.type = 'message';
    entry.id = id;
    entry.parentId = prevId;
    entry.timestamp = ts;

    if (nonEmpty(msg.tool_call_id)) {
      const tr: MulticaToolResultMsg = new MulticaToolResultMsg();
      tr.role = 'toolResult';
      tr.toolCallId = msg.tool_call_id as string;
      tr.toolName = nonEmpty(msg.name) ? (msg.name as string) : '';
      tr.content = parts.length > 0 ? parts : [multicaText(contentAsText(msg.content))];
      tr.isError = false;
      tr.timestamp = clock.nowMs;
      entry.message = tr;
    } else {
      const nm: MulticaNormalMsg = new MulticaNormalMsg();
      nm.role = msg.role;
      nm.content = parts.length > 0
        ? parts
        : [multicaText(typeof msg.content === 'string' ? (msg.content as string) : '')];
      nm.timestamp = clock.nowMs;
      entry.message = nm;
    }
    lines.push(JSON.stringify(entry));
    prevId = id;
  }

  // ⚠️ multica **有**结尾换行（web `lines.join('\n') + '\n'`）。
  return lines.join('\n') + '\n';
}

// ── benchmark（web `api.ts:383-391`）：HLE / mint-bench JSONL ─────────────────────────

/**
 * 逐行一条 `DemoRecord`；非空时**末尾补一个 `\n`**（web `map(JSON.stringify).join('\n') + (len ? '\n' : '')`）。
 * ⚠️ 数据来自**另一个 RPC**（`export_session_jsonl`，`serverapp/rpc_table.go:1577`）——不在此处取。
 */
export function toBenchmarkJsonl(records: DemoRecord[]): string {
  const lines: string[] = [];
  for (const r of records) {
    lines.push(JSON.stringify(r));
  }
  return lines.join('\n') + (records.length > 0 ? '\n' : '');
}

// ── 响应收窄（RPC 原始 Object → 视图模型）──────────────────────────────────────────
//
// 为什么需要：RPC 返回裸 JSON；ArkTS 无 `any` ⇒ 必须显式收窄。口径同
// `core/settingsplugins.parsePluginConfig`：**全容错**（缺失/类型不符 ⇒ 用默认值），
// ⛔ 不抛、不猜（宁可导出"空消息"，也不因一个脏字段整单失败）。
// 字段面 = Go `protocol/session_export.go`（`omitempty` ⇒ 可选字段**只在有值时**赋值，
// 这样 `toNativeJson` 的 `JSON.stringify` 与 web `agent/api.ts:562` 的 `JSON.stringify(data,null,2)` 同形）。

function strOf(o: Object, key: string): string {
  const v: Object | undefined = field(o, key);
  return typeof v === 'string' ? v : '';
}

function numOf(o: Object, key: string): number {
  const v: Object | undefined = field(o, key);
  return typeof v === 'number' ? v : 0;
}

function boolOf(o: Object, key: string): boolean {
  const v: Object | undefined = field(o, key);
  return typeof v === 'boolean' ? v : false;
}

function arrOf(o: Object, key: string): Object[] {
  const v: Object | undefined = field(o, key);
  return Array.isArray(v) ? (v as Object[]) : [];
}

/** 一条消息的收窄（`content` / `tool_calls` **原样透传** —— 见 `ExportedMessage` 注释）。 */
function messageOf(raw: Object): ExportedMessage {
  const m: ExportedMessage = new ExportedMessage();
  m.role = strOf(raw, 'role');
  const c: Object | undefined = field(raw, 'content');
  if (c !== undefined) {
    m.content = c;
  }
  const rs: string = strOf(raw, 'reasoning');
  if (rs.length > 0) {
    m.reasoning = rs;
  }
  const d: string = strOf(raw, 'detail');
  if (d.length > 0) {
    m.detail = d;
  }
  const tc: Object | undefined = field(raw, 'tool_calls');
  if (tc !== undefined) {
    m.tool_calls = tc;
  }
  const tcid: string = strOf(raw, 'tool_call_id');
  if (tcid.length > 0) {
    m.tool_call_id = tcid;
  }
  const nm: string = strOf(raw, 'name');
  if (nm.length > 0) {
    m.name = nm;
  }
  const ts: string = strOf(raw, 'timestamp');
  if (ts.length > 0) {
    m.timestamp = ts;
  }
  return m;
}

/** 一条 append-only history 行的收窄。 */
function recordOf(raw: Object): ExportedRecord {
  const r: ExportedRecord = new ExportedRecord();
  r.history_id = numOf(raw, 'history_id');
  r.record_type = strOf(raw, 'record_type');
  if (field(raw, 'target_history_id') !== undefined) {
    r.target_history_id = numOf(raw, 'target_history_id');
  }
  const rd: Object | undefined = field(raw, 'record_data');
  if (rd !== undefined) {
    r.record_data = rd;
  }
  const role: string = strOf(raw, 'role');
  if (role.length > 0) {
    r.role = role;
  }
  const content: string = strOf(raw, 'content');
  if (content.length > 0) {
    r.content = content;
  }
  const tcid: string = strOf(raw, 'tool_call_id');
  if (tcid.length > 0) {
    r.tool_call_id = tcid;
  }
  const tname: string = strOf(raw, 'tool_name');
  if (tname.length > 0) {
    r.tool_name = tname;
  }
  const targs: string = strOf(raw, 'tool_arguments');
  if (targs.length > 0) {
    r.tool_arguments = targs;
  }
  const tc: Object | undefined = field(raw, 'tool_calls');
  if (tc !== undefined) {
    r.tool_calls = tc;
  }
  const d: string = strOf(raw, 'detail');
  if (d.length > 0) {
    r.detail = d;
  }
  const rs: string = strOf(raw, 'reasoning');
  if (rs.length > 0) {
    r.reasoning = rs;
  }
  if (field(raw, 'display_only') !== undefined) {
    r.display_only = boolOf(raw, 'display_only');
  }
  if (field(raw, 'turn_id') !== undefined) {
    r.turn_id = numOf(raw, 'turn_id');
  }
  const ca: string = strOf(raw, 'created_at');
  if (ca.length > 0) {
    r.created_at = ca;
  }
  return r;
}

/** `export_session` 的响应 → `ExportedSession`（全容错，⛔ 不抛）。 */
export function exportedSessionFrom(raw: Object): ExportedSession {
  const s: ExportedSession = new ExportedSession();
  s.id = strOf(raw, 'id');
  const model: string = strOf(raw, 'model');
  if (model.length > 0) {
    s.model = model;
  }
  const si: string = strOf(raw, 'system_instructions');
  if (si.length > 0) {
    s.system_instructions = si;
  }
  const msgs: Object[] = arrOf(raw, 'messages');
  for (let i = 0; i < msgs.length; i++) {
    s.messages.push(messageOf(msgs[i]));
  }
  const recs: Object[] = arrOf(raw, 'records');
  if (recs.length > 0) {
    const out: ExportedRecord[] = [];
    for (let i = 0; i < recs.length; i++) {
      out.push(recordOf(recs[i]));
    }
    s.records = out;
  }
  const ca: string = strOf(raw, 'created_at');
  if (ca.length > 0) {
    s.created_at = ca;
  }
  const ua: string = strOf(raw, 'updated_at');
  if (ua.length > 0) {
    s.updated_at = ua;
  }
  const it: Object | undefined = field(raw, 'iterations');
  if (it !== undefined) {
    s.iterations = it;
  }
  return s;
}

/** `export_session_jsonl` 的响应 `{records}` → `DemoRecord[]`（全容错，⛔ 不抛）。 */
export function demoRecordsFrom(raw: Object): DemoRecord[] {
  const recs: Object[] = arrOf(raw, 'records');
  const out: DemoRecord[] = [];
  for (let i = 0; i < recs.length; i++) {
    const o: Object = recs[i];
    const d: DemoRecord = new DemoRecord();
    d.uuid = strOf(o, 'uuid');
    d.question = strOf(o, 'question');
    d.answer = strOf(o, 'answer');
    d.domain = strOf(o, 'domain');
    d.correct = boolOf(o, 'correct');
    d.judge_applied = boolOf(o, 'judge_applied');
    const msgs: Object[] = arrOf(o, 'messages');
    for (let j = 0; j < msgs.length; j++) {
      const mo: Object = msgs[j];
      const dm: DemoMessage = new DemoMessage();
      dm.kind = strOf(mo, 'kind');
      const parts: Object[] = arrOf(mo, 'parts');
      for (let k = 0; k < parts.length; k++) {
        const po: Object = parts[k];
        const dp: DemoPart = new DemoPart();
        dp.part_kind = strOf(po, 'part_kind');
        dp.content = strOf(po, 'content');
        dp.tool_name = strOf(po, 'tool_name');
        dp.tool_call_id = strOf(po, 'tool_call_id');
        dp.args = strOf(po, 'args');
        dm.parts.push(dp);
      }
      d.messages.push(dm);
    }
    out.push(d);
  }
  return out;
}

// ── 开发者 turn+iter 文本（web `SettingsDeveloper.tsx:60-92`）：`text/plain` ───────────

/**
 * 会话 → 开发者调试文本（**不是 markdown**；web 存为 `text/plain` `.txt`）。
 *
 * 需要 `channel`/`chatID` 两个参数：web 从 session store 取（`s.channel`/`s.chatID`），
 * 不在 `ExportedSession` 里。`nowIso` 注入。
 */
export function toTurnIterTxt(
  session: ExportedSession,
  channel: string,
  chatID: string,
  nowIso: string,
): string {
  const lines: string[] = [];
  lines.push(`# Session: ${channel}:${chatID}`);
  lines.push(`# Model: ${nonEmpty(session.model) ? (session.model as string) : 'unknown'}`);
  lines.push(`# Messages: ${session.messages.length}`);
  lines.push(`# Exported: ${nowIso}`);
  lines.push('');
  for (const msg of session.messages) {
    const content: string = contentAsText(msg.content);
    const head: string = content.substring(0, 80).replace(/\n/g, ' ');
    const preview: string = head + (content.length > 80 ? '...' : '');
    const iterInfo: string = nonEmpty(msg.detail) ? ' [has detail]' : '';
    lines.push(`role=${msg.role} content="${preview}"${iterInfo}`);
  }
  lines.push('');
  lines.push('# Records (append-only history):');
  const records: ExportedRecord[] | undefined = session.records;
  if (records !== undefined && records.length > 0) {
    for (const r of records) {
      const raw: string = r.content !== undefined ? r.content : '';
      const head: string = raw.substring(0, 60).replace(/\n/g, ' ');
      const preview: string = head + (raw.length > 60 ? '...' : '');
      const turn: number = r.turn_id !== undefined ? r.turn_id : 0;
      const role: string = nonEmpty(r.role) ? (r.role as string) : '-';
      lines.push(`  hid=${r.history_id} type=${r.record_type} turn=${turn} role=${role} content="${preview}"`);
    }
  } else {
    lines.push('  (no records)');
  }
  return lines.join('\n');
}
