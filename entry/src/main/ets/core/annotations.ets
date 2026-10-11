/**
 * 消息注释 / 高亮的**数据面**（纯逻辑）—— 移植 web `src/lib/messageAnnotations.ts`
 * （web UI 在 `components/agent/MessageAnnotations.tsx`，本文件**不做 UI**）。
 *
 * ── 这是什么 ──────────────────────────────────────────────────────────────────
 * 用户对助手回答的某段**划词加批注**（quote + comment），随下一次请求一起发给模型。
 * 两端必须给出**同一份序列化格式**，否则"同一份草稿在 web 能读、在原生读不出"。
 *
 * ── 两种序列化形态（**别混**）──────────────────────────────────────────────────
 *   ① **草稿存储**（localStorage / 本仓设置串）：`MessageAnnotation[]` 直存
 *      形状 `{id, source:{turnID,iteration,messageID,startOffset,endOffset}, quote, comment}`
 *      （**camelCase 且 ID 大写**；未设置的字段**省略**，与 web 直存一致）。
 *   ② **出站信封**（发给模型的那条普通用户消息里嵌的 XML+JSON）：
 *      `{text, annotation, source:{turnId,iteration,messageId,startOffset,endOffset,
 *        offsetBasis:'dom-text',offsetEncoding:'utf-16'}}`
 *      （**小写 d**；`offsetBasis/Encoding` 仅在带 offset 时出现）。
 *   本文件两种都给，并各自有往返测试。
 *
 * ── 上限（逐字对齐 web `ANNOTATION_LIMITS`）──────────────────────────────────
 *   条数 ≤ 10；单条 quote ≤ 6000 **码点**；comment ≤ 2000 码点；全部合计 ≤ 20000 码点。
 *   ⚠️ 按**码点**（`[...s].length` 等价），不是 UTF-16 单元 —— emoji 不能被算成两个。
 *
 * ⚠️ 移植说明：web `parseAnnotatedMessage` 用 `DOMParser` 校验 XML。原生无 DOM ⇒ 用
 * **等价的字符串校验**（内层文本不得含 `<` / `&`，即"无嵌套元素 / 无实体"），语义对齐
 * web 的「`children.length===0` + XML 可解析」。这不是重写逻辑，是同一判据的无 DOM 实现。
 *
 * 纯函数 ⇒ 可脱机单测（`tools/tests/annotations.test.ts`）。本文件属 `core/`，禁止
 * import ArkUI / `@ohos.*`。
 */

/** i18n 翻译函数（由调用方注入；`num` 供 `agent.annotations.item` 的序号）。 */
export type Translate = (key: string, num?: number) => string;

/** 草稿存储键前缀（web `ANNOTATION_STORAGE_PREFIX`）。 */
export const ANNOTATION_STORAGE_PREFIX: string = 'xbot:annotations:';

/** 上限（web `ANNOTATION_LIMITS`，逐值一致）。 */
export class AnnotationLimits {
  count: number = 10;
  quote: number = 6000;
  comment: number = 2000;
  total: number = 20000;
}
export const ANNOTATION_LIMITS: AnnotationLimits = new AnnotationLimits();

// 出站信封的定界（web 同名常量，逐字一致）。
const RESPONSE_HEADER: string = '# Response annotations:\n';
const OPEN_TAG: string = '<response-annotations>';
const CLOSE_TAG: string = '</response-annotations>';
const REQUEST_HEADER: string = '\n\n# My request:';

/**
 * 锚点快照（**不是永久锚**：回退/重放会复用 turn/iteration 号，故只作"提示"）。
 * 用 `-1` 表示"未设置"（ArkTS 友好；序列化时会**省略**这些字段，与 web 的 undefined 等价）。
 */
export class AnnotationSource {
  turnID: number = -1;
  iteration: number = -1;
  messageID: number = -1;
  startOffset: number = -1;
  endOffset: number = -1;
}

/** 一条注释草稿。 */
export class MessageAnnotation {
  id: string = '';
  source: AnnotationSource = new AnnotationSource();
  quote: string = '';
  comment: string = '';
}

/** 出站信封里的一条（source 用小写 d 的键 + offsetBasis/Encoding）。 */
export class ResponseSource {
  turnId: number = -1;
  iteration: number = -1;
  messageId: number = -1;
  startOffset: number = -1;
  endOffset: number = -1;
  offsetBasis: string = '';
  offsetEncoding: string = '';
}
export class ResponseAnnotation {
  text: string = '';
  annotation: string = '';
  source: ResponseSource = new ResponseSource();
}
/** 解析出站信封的产物。 */
export class ParsedAnnotatedMessage {
  body: string = '';
  annotations: ResponseAnnotation[] = [];
}

// ── 小工具 ────────────────────────────────────────────────────────────────────
/** **码点**长度（emoji 算 1；等价 `[...s].length`，但无迭代器依赖）。 */
export function codePointLength(s: string): number {
  let n: number = 0;
  for (let i = 0; i < s.length; i++) {
    const c: number = s.charCodeAt(i);
    if (c >= 0xDC00 && c <= 0xDFFF) { continue; } // 低代理项：属上一个码点
    n++;
  }
  return n;
}

function isSafePositiveInt(v: Object | undefined): boolean {
  return typeof v === 'number' && Number.isSafeInteger(v as number) && (v as number) > 0;
}

/** 存储键（web `annotationStorageKey` 逐字移植；用 JSON 数组避免分隔符歧义）。 */
export function annotationStorageKey(username: string, sessionKey: string): string {
  return ANNOTATION_STORAGE_PREFIX + JSON.stringify([username, sessionKey]);
}

// ── 校验 ──────────────────────────────────────────────────────────────────────
/**
 * 校验一批注释 ⇒ 错误码（`''` = 通过）。错误码与 web 逐字一致：
 * `tooMany`／`empty`／`quoteTooLong`／`commentTooLong`／`totalTooLong`。
 */
export function validateAnnotations(items: MessageAnnotation[]): string {
  if (items.length > ANNOTATION_LIMITS.count) { return 'tooMany'; }
  let total: number = 0;
  for (let i = 0; i < items.length; i++) {
    const item: MessageAnnotation = items[i];
    const quoteLength: number = codePointLength(item.quote);
    const commentLength: number = codePointLength(item.comment);
    if (item.quote.trim().length === 0 || item.comment.trim().length === 0) { return 'empty'; }
    if (quoteLength > ANNOTATION_LIMITS.quote) { return 'quoteTooLong'; }
    if (commentLength > ANNOTATION_LIMITS.comment) { return 'commentTooLong'; }
    total += quoteLength + commentLength;
  }
  return total > ANNOTATION_LIMITS.total ? 'totalTooLong' : '';
}

/** 锚点是否合法（web `isSource` 等价）：身份号 -1 或 >0 的安全整数；offset 成对且 end>start>=0。 */
export function sourceValid(s: AnnotationSource): boolean {
  const ids: number[] = [s.turnID, s.iteration, s.messageID];
  for (let i = 0; i < ids.length; i++) {
    const n: number = ids[i];
    if (n !== -1 && !(Number.isSafeInteger(n) && n > 0)) { return false; }
  }
  const noOffsets: boolean = s.startOffset === -1 && s.endOffset === -1;
  if (noOffsets) { return true; }
  const bothSet: boolean = Number.isSafeInteger(s.startOffset) && Number.isSafeInteger(s.endOffset)
    && s.startOffset >= 0 && s.endOffset > s.startOffset;
  return bothSet;
}

/**
 * 校验**原始 JSON 对象**形状的锚点（存储键 `turnID` 大写 / 信封 `turnId` 小写）。
 * ⚠️ 与 class 版 `sourceValid` 的关键差别：这里**看字段是否"在场"** —— web 的 `isSource`
 * 只接受"**缺失**"或"**>0 的安全整数**"，显式写 `"turnId": -1` **非法**（`-1` 既非 undefined
 * 也非 >0）。存/出站两处都走这条，保证与 web 同判。
 */
function jsonSourceValid(o: Record<string, Object>, idKeys: string[]): boolean {
  for (let i = 0; i < idKeys.length; i++) {
    const v: Object = o[idKeys[i]];
    if (v === undefined) { continue; }
    if (typeof v !== 'number' || !Number.isSafeInteger(v as number) || (v as number) <= 0) { return false; }
  }
  const so: Object = o['startOffset'];
  const eo: Object = o['endOffset'];
  if (so === undefined && eo === undefined) { return true; }
  if (typeof so !== 'number' || typeof eo !== 'number') { return false; }
  if (!Number.isSafeInteger(so as number) || !Number.isSafeInteger(eo as number)) { return false; }
  return (so as number) >= 0 && (eo as number) > (so as number);
}

// ── 草稿存储：串 ↔ 列表（读时**严格**：坏数据抛；web `loadAnnotations` 同）────────────
/** 把一条注释编成**存储形状**的 JSON 对象（未设置字段省略，与 web 直存一致）。 */
function annotationToStorage(a: MessageAnnotation): Record<string, Object> {
  const src: Record<string, Object> = {};
  if (a.source.turnID > 0) { src['turnID'] = a.source.turnID; }
  if (a.source.iteration > 0) { src['iteration'] = a.source.iteration; }
  if (a.source.messageID > 0) { src['messageID'] = a.source.messageID; }
  if (a.source.startOffset >= 0) { src['startOffset'] = a.source.startOffset; }
  if (a.source.endOffset >= 0) { src['endOffset'] = a.source.endOffset; }
  const o: Record<string, Object> = {};
  o['id'] = a.id;
  o['source'] = src;
  o['quote'] = a.quote;
  o['comment'] = a.comment;
  return o;
}

/** 序列化草稿列表 ⇒ 存储串（形状与 web `localStorage.setItem(key, JSON.stringify(items))` 一致）。 */
export function serializeAnnotations(items: MessageAnnotation[]): string {
  const arr: Record<string, Object>[] = [];
  for (let i = 0; i < items.length; i++) { arr.push(annotationToStorage(items[i])); }
  return JSON.stringify(arr);
}

/** 从存储形状的原始对象读一条注释；形状不合法 ⇒ null。 */
function readStorageAnnotation(v: Object): MessageAnnotation | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) { return null; }
  const obj: Record<string, Object> = v as Record<string, Object>;
  const id: Object = obj['id'];
  const quote: Object = obj['quote'];
  const comment: Object = obj['comment'];
  if (typeof id !== 'string' || typeof quote !== 'string' || typeof comment !== 'string') { return null; }
  const srcRaw: Object = obj['source'];
  if (srcRaw === null || typeof srcRaw !== 'object' || Array.isArray(srcRaw)) { return null; }
  const sor: Record<string, Object> = srcRaw as Record<string, Object>;
  if (!jsonSourceValid(sor, ['turnID', 'iteration', 'messageID'])) { return null; }
  const s: AnnotationSource = new AnnotationSource();
  const readId = (k: string): number => {
    const x: Object = sor[k];
    return typeof x === 'number' ? (x as number) : -1;
  };
  s.turnID = readId('turnID');
  s.iteration = readId('iteration');
  s.messageID = readId('messageID');
  s.startOffset = readId('startOffset');
  s.endOffset = readId('endOffset');
  if (!sourceValid(s)) { return null; }
  const out: MessageAnnotation = new MessageAnnotation();
  out.id = id as string;
  out.source = s;
  out.quote = quote as string;
  out.comment = comment as string;
  return out;
}

/**
 * 解析草稿串 ⇒ 列表。**严格**：非数组 / 任一条形状坏 / 校验不过 ⇒ **抛**（web 行为）。
 * 想要"坏数据当空"的宽松口径，用 `readAnnotations`。
 */
export function parseAnnotations(raw: string): MessageAnnotation[] {
  const parsed: Object = JSON.parse(raw) as Object;
  if (!Array.isArray(parsed)) { throw new Error('Invalid annotation draft'); }
  const arr: Object[] = parsed as Object[];
  const out: MessageAnnotation[] = [];
  for (let i = 0; i < arr.length; i++) {
    const a: MessageAnnotation | null = readStorageAnnotation(arr[i]);
    if (a === null) { throw new Error('Invalid annotation draft'); }
    out.push(a);
  }
  if (validateAnnotations(out).length > 0) { throw new Error('Invalid annotation draft'); }
  return out;
}

/** 宽松读（坏数据 ⇒ `[]`，绝不抛；给"设置串可能被外部改脏"的原生宿用）。 */
export function readAnnotations(raw: string | undefined | null): MessageAnnotation[] {
  if (raw === undefined || raw === null || raw.length === 0) { return []; }
  try {
    return parseAnnotations(raw);
  } catch (e) {
    return [];
  }
}

// ── 增删改查（返回**新数组**，不改入参）─────────────────────────────────────────
/** 造一条注释。 */
export function makeAnnotation(id: string, source: AnnotationSource, quote: string, comment: string): MessageAnnotation {
  const a: MessageAnnotation = new MessageAnnotation();
  a.id = id;
  a.source = source;
  a.quote = quote;
  a.comment = comment;
  return a;
}

/** 追加一条（不做上限/非空校验——那是 `validateAnnotations` 的事）。 */
export function addAnnotation(items: MessageAnnotation[], item: MessageAnnotation): MessageAnnotation[] {
  const out: MessageAnnotation[] = items.slice();
  out.push(item);
  return out;
}

/** 改某条的批注文本（命中 id 才改；返回新数组）。 */
export function updateAnnotationComment(items: MessageAnnotation[], id: string, comment: string): MessageAnnotation[] {
  const out: MessageAnnotation[] = [];
  for (let i = 0; i < items.length; i++) {
    const a: MessageAnnotation = items[i];
    if (a.id === id) {
      const copy: MessageAnnotation = makeAnnotation(a.id, a.source, a.quote, comment);
      out.push(copy);
    } else {
      out.push(a);
    }
  }
  return out;
}

/** 删某条（返回新数组）。 */
export function removeAnnotation(items: MessageAnnotation[], id: string): MessageAnnotation[] {
  const out: MessageAnnotation[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].id !== id) { out.push(items[i]); }
  }
  return out;
}

/** 按 id 取（无 ⇒ null）。 */
export function annotationById(items: MessageAnnotation[], id: string): MessageAnnotation | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) { return items[i]; }
  }
  return null;
}

// ── 出站信封（发给模型）────────────────────────────────────────────────────────
/** 用比内容里任何反引号串都长的围栏，把快照**原样**当字面文本保留（web `literalBlock`）。 */
export function literalBlock(text: string): string {
  let length: number = 3;
  const re: RegExp = /`+/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    if (m[0].length + 1 > length) { length = m[0].length + 1; }
    m = re.exec(text);
  }
  const fence: string = '`'.repeat(length);
  return `${fence}text\n${text}\n${fence}`;
}

/** 把 `<>&` 转成 JSON 的 `\uXXXX`（web 逐字：防止注释内容造成 XML 破出）。 */
function escapeXmlHostile(json: string): string {
  return json.replace(/[<>&]/g, (char: string): string => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** 出站 source 的 JSON 形状（小写 d + 条件性 offsetBasis/Encoding）。 */
function responseSourceToJson(src: AnnotationSource): Record<string, Object> {
  const o: Record<string, Object> = {};
  if (src.turnID > 0) { o['turnId'] = src.turnID; }
  if (src.iteration > 0) { o['iteration'] = src.iteration; }
  if (src.messageID > 0) { o['messageId'] = src.messageID; }
  if (src.startOffset >= 0 && src.endOffset >= 0) {
    o['startOffset'] = src.startOffset;
    o['endOffset'] = src.endOffset;
    o['offsetBasis'] = 'dom-text';
    o['offsetEncoding'] = 'utf-16';
  }
  return o;
}

/**
 * 把（体 + 注释）编成**一条普通用户消息**（web `formatAnnotatedMessage`）。
 * 无注释 ⇒ 原样返回 `body`（不产生空信封）。
 */
export function formatAnnotatedMessage(body: string, items: MessageAnnotation[], t: Translate): string {
  if (items.length === 0) { return body; }
  const payload: Record<string, Object>[] = [];
  for (let i = 0; i < items.length; i++) {
    const a: MessageAnnotation = items[i];
    const o: Record<string, Object> = {};
    o['text'] = a.quote;
    o['annotation'] = a.comment;
    o['source'] = responseSourceToJson(a.source);
    payload.push(o);
  }
  const json: string = escapeXmlHostile(JSON.stringify(payload, null, 2));
  return `${RESPONSE_HEADER}${t('agent.annotations.feedbackInstructions')}\n${OPEN_TAG}\n${json}\n${CLOSE_TAG}${REQUEST_HEADER}\n${body}`;
}

/**
 * 出站 source 是否合法（web `isResponseAnnotation` 的 source 分支）。
 * 用 `jsonSourceValid` 看**字段在场性**（显式 `-1` 非法），并额外校验 offsetBasis/Encoding 白名单。
 */
function isResponseSource(o: Record<string, Object>): boolean {
  const basis: Object = o['offsetBasis'];
  if (basis !== undefined && basis !== 'dom-text') { return false; }
  const enc: Object = o['offsetEncoding'];
  if (enc !== undefined && enc !== 'utf-16') { return false; }
  return jsonSourceValid(o, ['turnId', 'iteration', 'messageId']);
}

function isResponseAnnotation(v: Object): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) { return false; }
  const o: Record<string, Object> = v as Record<string, Object>;
  if (typeof o['text'] !== 'string' || typeof o['annotation'] !== 'string') { return false; }
  const src: Object = o['source'];
  if (src === null || typeof src !== 'object' || Array.isArray(src)) { return false; }
  return isResponseSource(src as Record<string, Object>);
}

/**
 * 解析出站信封 ⇒ `{body, annotations}`；非信封 / 形状坏 ⇒ `null`（**不抛**）。
 * DOMParser 的无 DOM 等价实现：见文件头"移植说明"。
 */
export function parseAnnotatedMessage(content: string): ParsedAnnotatedMessage | null {
  if (!content.startsWith(RESPONSE_HEADER)) { return null; }
  const start: number = content.indexOf('\n' + OPEN_TAG + '\n', RESPONSE_HEADER.length);
  if (start < 0) { return null; }
  const end: number = content.indexOf('\n' + CLOSE_TAG, start);
  if (end < 0) { return null; }
  const suffix: string = content.substring(end + 1 + CLOSE_TAG.length);
  if (!suffix.startsWith(REQUEST_HEADER)) { return null; }
  const request: string = suffix.substring(REQUEST_HEADER.length);
  if (request.length > 0 && request.charAt(0) !== '\n') { return null; }

  const block: string = content.substring(start + 1, end + 1 + CLOSE_TAG.length);
  const prefix: string = OPEN_TAG + '\n';
  const tail: string = '\n' + CLOSE_TAG;
  if (!block.startsWith(prefix) || !block.endsWith(tail)) { return null; }
  const inner: string = block.substring(prefix.length, block.length - tail.length);
  // XML 等价的"无嵌套元素 / 无实体"判据（web 靠 DOMParser children.length===0）
  if (inner.indexOf('<') >= 0 || inner.indexOf('&') >= 0) { return null; }

  let payload: Object | null = null;
  try {
    payload = JSON.parse(inner) as Object | null;
  } catch (e) {
    return null;
  }
  if (!Array.isArray(payload)) { return null; }
  const arr: Object[] = payload as Object[];
  if (arr.length === 0) { return null; }

  const out: ResponseAnnotation[] = [];
  const forValidate: MessageAnnotation[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (!isResponseAnnotation(arr[i])) { return null; }
    const o: Record<string, Object> = arr[i] as Record<string, Object>;
    const ra: ResponseAnnotation = new ResponseAnnotation();
    ra.text = o['text'] as string;
    ra.annotation = o['annotation'] as string;
    const sor: Record<string, Object> = o['source'] as Record<string, Object>;
    const rs: ResponseSource = new ResponseSource();
    const readId = (k: string): number => {
      const x: Object = sor[k];
      return typeof x === 'number' ? (x as number) : -1;
    };
    rs.turnId = readId('turnId');
    rs.iteration = readId('iteration');
    rs.messageId = readId('messageId');
    rs.startOffset = readId('startOffset');
    rs.endOffset = readId('endOffset');
    const basis: Object = sor['offsetBasis'];
    rs.offsetBasis = typeof basis === 'string' ? (basis as string) : '';
    const enc: Object = sor['offsetEncoding'];
    rs.offsetEncoding = typeof enc === 'string' ? (enc as string) : '';
    ra.source = rs;
    out.push(ra);
    forValidate.push(makeAnnotation(String(i), new AnnotationSource(), ra.text, ra.annotation));
  }
  if (validateAnnotations(forValidate).length > 0) { return null; }
  const parsed: ParsedAnnotatedMessage = new ParsedAnnotatedMessage();
  parsed.body = request.substring(1);
  parsed.annotations = out;
  return parsed;
}

/**
 * 渲染用：出站信封 ⇒ **可读显示串**（引用/批注分节）；
 * 非信封 ⇒ 原样返回 `content`（普通消息/历史旧格式不动）。
 */
export function annotatedMessageDisplay(content: string, t: Translate): string {
  const parsed: ParsedAnnotatedMessage | null = parseAnnotatedMessage(content);
  if (parsed === null) { return content; }
  const parts: string[] = [];
  for (let i = 0; i < parsed.annotations.length; i++) {
    const item: ResponseAnnotation = parsed.annotations[i];
    const section: string = [
      `### ${t('agent.annotations.item', i + 1)}`,
      `**${t('agent.annotations.quote')}**\n\n${literalBlock(item.text)}`,
      `**${t('agent.annotations.comment')}**\n\n${literalBlock(item.annotation)}`,
    ].join('\n\n');
    parts.push(section);
  }
  const feedback: string = parts.join('\n\n');
  const head: string = t('agent.annotations.feedbackHeading');
  const segs: string[] = [parsed.body, head, feedback];
  const kept: string[] = [];
  for (let i = 0; i < segs.length; i++) { if (segs[i].length > 0) { kept.push(segs[i]); } }
  return kept.join('\n\n');
}
