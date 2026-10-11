/**
 * 注入型「假工具」通知的**纯逻辑**（Synthetic / Interrupt 卡）—— 逐条对齐 web
 * `src/components/agent/SyntheticToolCard.tsx`（本工程自己的代码，属"对齐"而非重造）。
 *
 * ── 背景（web 权威）──────────────────────────────────────────────────────────
 * 后端把"系统注入事件"（后台任务完成 / 子代理完成 / 定时触发 / 异步消息 / 投递 /
 * 取消 / 循环拦截 / 回合提醒 / 用户插话）当成**假工具调用对**喂给模型；同时给 UI 在
 * `tool.tool_hints` 里附一份**只给 UI 看**的结构化载荷（`SyntheticToolHints`，绝不发给模型）。
 * web 在 `ToolRender.tsx:136`（`user_interrupt` ⇒ `InterruptCard`）、`:154-155`
 * （其余假工具 ⇒ `SyntheticToolCard`）把它们渲染成卡片，而不是看不懂的普通工具 pill。
 *
 * 本仓此前**0 渲染** ⇒ 所有假工具都退化成普通 pill。本文件补上"判据"（纯逻辑、
 * 可脱机单测）；渲染在 `components/SyntheticCard.ets`（**判据与渲染同源**：渲只调本文件）。
 *
 * ── 本波范围（用户裁决）──────────────────────────────────────────────────────
 * **专用卡 3 种**：`bg_task` / `subagent` / `interrupt`。
 * **中性通用变体**：其余 6 种 kind（`cron` / `async` / `delivered` / `cancel` / `loop` /
 *   `pre_turn_end`）+ **任何未知 kind** —— 一律落 `FORM_GENERIC`（优雅降级：有图标 + 标题 +
 *   正文，绝不白板/错位，也绝不崩）。`syntheticForm(kind)` 是**唯一**形态判据。
 *
 * ── 与 web 的一处**刻意收窄**（明记）────────────────────────────────────────
 * web 的 kind 全集是 **9** 种（`bg_task/subagent/cron/async/delivered/cancel/loop/
 * pre_turn_end/interrupt`）；本波只把前 3 种做成专用形态，其余 6 种走通用（仍可读、
 * 仍带正确标题与中性色），供下一波按需要在 `syntheticForm` / `syntheticRoleOf` 里补。
 *
 * 纯函数 ⇒ 可脱机单测（`tools/tests/synthhints.test.ts`）。本文件属 `core/`，会被
 * `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ **禁止** import ArkUI / `@ohos.*`；避开 ArkTS
 * 严格规则（禁 `is` 类型谓词、禁对象字面量作类型标注 ⇒ 用 class；`JSON.parse` 结果走
 * `Record<string, Object>` 逐字段取，不用结构化 `as` 强转）。
 */

// ── kind 常量（与 web `inferSyntheticKind` 逐一对应）────────────────────────────
export const KIND_BG_TASK: string = 'bg_task';
export const KIND_SUBAGENT: string = 'subagent';
export const KIND_CRON: string = 'cron';
export const KIND_ASYNC: string = 'async';
export const KIND_DELIVERED: string = 'delivered';
export const KIND_CANCEL: string = 'cancel';
export const KIND_LOOP: string = 'loop';
export const KIND_PRE_TURN_END: string = 'pre_turn_end';
export const KIND_INTERRUPT: string = 'interrupt';

// ── 形态常量（渲染层据此选择卡形态；**唯一判据**）──────────────────────────────
export const FORM_BG_TASK: string = 'bg_task';
export const FORM_SUBAGENT: string = 'subagent';
export const FORM_INTERRUPT: string = 'interrupt';
/** 通用变体：其余已知 kind + **任何未知 kind**（优雅降级，不崩）。 */
export const FORM_GENERIC: string = 'generic';

/** 专用卡（本波做全形态）的 kind 白名单。 */
export const DEDICATED_KINDS: string[] = [KIND_BG_TASK, KIND_SUBAGENT, KIND_INTERRUPT];

/**
 * 后端注入的假工具名全集（逐字对齐 web `SYNTHETIC_TOOL_NAMES`，`SyntheticToolCard.tsx:68-77`）。
 * 另有 `bg_subagent_` **前缀族**（见 `isSyntheticToolName`）。
 */
export const SYNTHETIC_TOOL_NAMES: string[] = [
  'background_task_result',
  'cron_fired',
  'async_message',
  'user_cancelled',
  'delivered_message',
  'loop_detected',
  'pre_turn_end',
  'user_interrupt',
];

/** 工具名是否是后端注入的假工具（`bg_subagent_` 前缀族 + 精确名集）。 */
export function isSyntheticToolName(name: string): boolean {
  if (name.indexOf('bg_subagent_') === 0) { return true; }
  for (let i = 0; i < SYNTHETIC_TOOL_NAMES.length; i++) {
    if (SYNTHETIC_TOOL_NAMES[i] === name) { return true; }
  }
  return false;
}

/**
 * 由**工具名**推断 kind（逐字对齐 web `inferSyntheticKind`，`:85-97`）。
 * ⚠️ 仅在 `tool_hints` 缺 `kind` 时作兜底（历史行）。
 * ⚠️ 未知名字**不做假工具判定** —— 调用方先过 `isSyntheticToolName`；本函数对未知名
 *    返回 `pre_turn_end`（与 web `default` 同）—— 但**只有**在已确认是假工具后才会走到这。
 */
export function inferSyntheticKind(name: string): string {
  if (name.indexOf('bg_subagent_') === 0) { return KIND_SUBAGENT; }
  if (name === 'background_task_result') { return KIND_BG_TASK; }
  if (name === 'cron_fired') { return KIND_CRON; }
  if (name === 'async_message') { return KIND_ASYNC; }
  if (name === 'delivered_message') { return KIND_DELIVERED; }
  if (name === 'user_cancelled') { return KIND_CANCEL; }
  if (name === 'loop_detected') { return KIND_LOOP; }
  if (name === 'user_interrupt') { return KIND_INTERRUPT; }
  return KIND_PRE_TURN_END;
}

/** 结构化 UI 载荷（`tool_hints`）—— 字段逐一对齐 web `SyntheticHints`。 */
export class SyntheticHints {
  kind: string = '';
  task_id: string = '';
  /** 被作用的原始对象：shell 命令 或 子代理任务。 */
  task: string = '';
  role: string = '';
  instance: string = '';
  status: string = '';
  /** 是否带 exit_code（web 用 `typeof === 'number'` 判在不在）。 */
  hasExit: boolean = false;
  exitCode: number = 0;
  elapsedMs: number = 0;
  message: string = '';
  output: string = '';
  error: string = '';
}

/** 取 JSON 对象里的字符串字段（非字符串 ⇒ ''）。 */
function fieldStr(o: Record<string, Object>, k: string): string {
  const v: Object | undefined = o[k];
  return typeof v === 'string' ? v as string : '';
}

/**
 * 解析 `tool_hints` 里的结构化载荷（逐字对齐 web `parseSyntheticHints`，`:56-65`）。
 * 缺省 / 非对象 / 非法 JSON ⇒ **null**（旧行 / 真工具 ⇒ 优雅降级到 summary/detail）。
 */
export function parseSyntheticHints(raw: string): SyntheticHints | null {
  const s: string = (raw !== undefined && raw !== null ? raw : '').trim();
  if (s.length === 0 || s.charAt(0) !== '{') { return null; }
  let parsed: Object;
  try {
    parsed = JSON.parse(s) as Object;
  } catch (e) {
    return null;
  }
  if (parsed === null || parsed === undefined) { return null; }
  const o: Record<string, Object> = parsed as Record<string, Object>;
  const h: SyntheticHints = new SyntheticHints();
  h.kind = fieldStr(o, 'kind');
  h.task_id = fieldStr(o, 'task_id');
  h.task = fieldStr(o, 'task');
  h.role = fieldStr(o, 'role');
  h.instance = fieldStr(o, 'instance');
  h.status = fieldStr(o, 'status');
  h.message = fieldStr(o, 'message');
  h.output = fieldStr(o, 'output');
  h.error = fieldStr(o, 'error');
  const ec: Object | undefined = o['exit_code'];
  if (typeof ec === 'number') { h.hasExit = true; h.exitCode = ec as number; }
  const em: Object | undefined = o['elapsed_ms'];
  if (typeof em === 'number') { h.elapsedMs = em as number; }
  return h;
}

/**
 * kind 的唯一判据（web `syntheticKindOf`，`:99-101`）：优先 `tool_hints.kind`，
 * 否则由工具名推断。**已确认是假工具**时调用（`isSyntheticToolName` 由调用点先过）。
 */
export function syntheticKindOf(name: string, rawHints: string): string {
  const h: SyntheticHints | null = parseSyntheticHints(rawHints);
  if (h !== null && h.kind.length > 0) { return h.kind; }
  return inferSyntheticKind(name);
}

/**
 * **kind ⇒ 卡片形态**（判据与渲染同源的唯一出口）。
 * 专用 3 种保其名；**其余已知 + 任何未知** ⇒ `FORM_GENERIC`（绝不崩、绝不白板）。
 */
export function syntheticForm(kind: string): string {
  if (kind === KIND_BG_TASK) { return FORM_BG_TASK; }
  if (kind === KIND_SUBAGENT) { return FORM_SUBAGENT; }
  if (kind === KIND_INTERRUPT) { return FORM_INTERRUPT; }
  return FORM_GENERIC;
}

/** 形态是否专用卡（本波做全形态的那 3 种）。 */
export function isDedicatedForm(form: string): boolean {
  return form === FORM_BG_TASK || form === FORM_SUBAGENT || form === FORM_INTERRUPT;
}

/**
 * **kind ⇒ 语义取色 role**（渲染层用 `colorOf(p, role)` 取色 ⇒ **颜色零字面量**）。
 * 色相意图对齐 web `LOOKS`（`SyntheticToolCard.tsx:114-169`）的 sky/violet/amber/teal，
 * 但落到**本仓语义角色**（本仓没有 tailwind 色板）：
 *   bg_task=青(terminal/运行) · subagent=品牌紫 · interrupt=深紫 · cron/loop=黄(警示) ·
 *   async=浅紫 · delivered=青 · cancel/pre_turn_end/未知=中性灰。
 * ⚠️ 每个 role 必须是 `colorOf` 里的**合法角色**（否则静默 transparent ⇒ 不可见）；
 *    `tools/tests/synthhints.test.ts` 在 5 套色板上逐条钉死。
 */
export function syntheticRoleOf(kind: string): string {
  if (kind === KIND_BG_TASK) { return 'statusRunning'; }
  if (kind === KIND_SUBAGENT) { return 'accent'; }
  if (kind === KIND_INTERRUPT) { return 'accentDeep'; }
  if (kind === KIND_CRON || kind === KIND_LOOP) { return 'statusWaiting'; }
  if (kind === KIND_ASYNC) { return 'accentSoft'; }
  if (kind === KIND_DELIVERED) { return 'statusRunning'; }
  return 'textMuted';
}

/** 卡片标题（逐字取自 web zh-CN `syntheticTitle*`）。未知 kind ⇒ 中性「系统通知」。 */
export function syntheticTitleOf(kind: string): string {
  if (kind === KIND_BG_TASK) { return '后台任务已完成'; }
  if (kind === KIND_SUBAGENT) { return '子代理已完成'; }
  if (kind === KIND_CRON) { return '定时任务已触发'; }
  if (kind === KIND_ASYNC) { return '收到异步消息'; }
  if (kind === KIND_DELIVERED) { return '排队消息已投递'; }
  if (kind === KIND_CANCEL) { return '本轮运行已取消'; }
  if (kind === KIND_LOOP) { return '已拦截重复循环'; }
  if (kind === KIND_PRE_TURN_END) { return '回合结束提醒'; }
  if (kind === KIND_INTERRUPT) { return '收到用户插话'; }
  return '系统通知';
}

/** 短名（pill / chip 用；逐字取自 web zh-CN `syntheticShort*`）。 */
export function syntheticShortOf(kind: string): string {
  if (kind === KIND_BG_TASK) { return '后台任务完成'; }
  if (kind === KIND_SUBAGENT) { return '子代理完成'; }
  if (kind === KIND_CRON) { return '定时任务触发'; }
  if (kind === KIND_ASYNC) { return '异步消息'; }
  if (kind === KIND_DELIVERED) { return '消息投递'; }
  if (kind === KIND_CANCEL) { return '已取消'; }
  if (kind === KIND_LOOP) { return '循环拦截'; }
  if (kind === KIND_PRE_TURN_END) { return '回合提醒'; }
  if (kind === KIND_INTERRUPT) { return '插话'; }
  return '系统通知';
}

/**
 * 承接说明 —— 告诉用户**为什么**这张卡在这里、"它指的是此前就在跑的东西，现在结束了"
 * （逐字取自 web zh-CN `syntheticContinuity*`）。未知 kind ⇒ 中性说明。
 */
export function syntheticContinuityOf(kind: string): string {
  if (kind === KIND_BG_TASK) { return '这条命令此前转入了后台运行，现在已经结束'; }
  if (kind === KIND_SUBAGENT) { return '这是此前派发出去的子代理，现在已经结束'; }
  if (kind === KIND_CRON) { return '到点自动触发，无需人工发起'; }
  if (kind === KIND_ASYNC) { return '来自其他会话 / 外部服务的消息，插入当前回合'; }
  if (kind === KIND_DELIVERED) { return '此前排队等待发送的消息已送达'; }
  if (kind === KIND_CANCEL) { return '这一轮运行被你中止，下面保留已完成的部分'; }
  if (kind === KIND_LOOP) { return '检测到重复的工具调用，已自动拦截'; }
  if (kind === KIND_PRE_TURN_END) { return '回合即将结束时的提醒'; }
  if (kind === KIND_INTERRUPT) { return '你在任务执行中插话，未打断当前任务'; }
  return '系统注入的通知';
}

/** 状态 chip 文案（web `syntheticStatus*`；空 ⇒ 不渲染 chip）。 */
export function syntheticStatusOf(status: string): string {
  const s: string = status.toLowerCase();
  if (s === 'done') { return '完成'; }
  if (s === 'error') { return '失败'; }
  if (s === 'killed') { return '已终止'; }
  if (s === 'cancelled') { return '已取消'; }
  if (s === 'running') { return '进行中'; }
  return '';
}

/**
 * **状态 ⇒ 语义取色 role**（渲染层用 `colorOf(p, role)`；空 ⇒ 无状态色）。
 * 与 web `SyntheticToolCard` 的 `tone`（`:406`：done=green / failed=red / 其余=muted）同源。
 */
export function syntheticStatusRoleOf(status: string): string {
  const s: string = status.toLowerCase();
  if (s === 'done') { return 'successText'; }
  if (s === 'error' || s === 'killed') { return 'dangerText'; }
  if (s === 'running') { return 'statusRunning'; }
  if (s === 'cancelled') { return 'textMuted'; }
  return '';
}

/**
 * 作用对象（"这个假工具作用在什么上"，展示在标题旁，如 `Sub-agent · explore/mem-1`）。
 * 逐字对齐 web `syntheticSubject`（`:253-265`）：优先结构化载荷的 role/instance / task_id；
 * `interrupt` 恒为空（其 label 就是展示名，重复会变成「插话 💬 插话」）；
 * 否则从 label 冒号后取（剥掉前导 emoji/符号）。
 */
export function syntheticSubject(name: string, h: SyntheticHints | null, label: string): string {
  if (h !== null && h.role.length > 0) {
    return h.instance.length > 0 ? `${h.role}/${h.instance}` : h.role;
  }
  if (h !== null && h.task_id.length > 0) { return h.task_id; }
  if (syntheticKindOf(name, '') === KIND_INTERRUPT) { return ''; }
  const idx: number = label.indexOf(':');
  const rest: string = (idx >= 0 ? label.substring(idx + 1) : label).trim();
  // 剥掉前导的非"字母/数字/符号"字符（emoji 等）—— `💬 插话` 不能变成 subject。
  // 用码点判断，避免正则 unicode 属性（ArkTS 正则特性受限）。
  let i: number = 0;
  while (i < rest.length) {
    const c: number = rest.charCodeAt(i);
    const isWord: boolean = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    const isSym: boolean = c === 47 || c === 95 || c === 46 || c === 58 || c === 45;
    if (isWord || isSym) { break; }
    i++;
  }
  const cleaned: string = rest.substring(i).trim();
  if (cleaned.length === 0 || cleaned === '{}' || isSyntheticToolName(cleaned)) { return ''; }
  return cleaned;
}

/** 卡片正文源（web `SyntheticToolCard.tsx:423`）：结构化 output/message 优先，回落 summary/detail。 */
export function syntheticBodyOf(h: SyntheticHints | null, detail: string, summary: string): string {
  if (h !== null && h.output.length > 0) { return h.output; }
  if (h !== null && h.message.length > 0) { return h.message; }
  if (detail.length > 0) { return detail; }
  return summary;
}

/** 时长格式化（逐字对齐 web `formatDuration`，`:269-277`）。 */
export function formatDuration(ms: number): string {
  if (!(ms > 0)) { return ''; }
  if (ms < 1000) { return `${Math.round(ms)}ms`; }
  const s: number = ms / 1000;
  if (s < 60) { return `${s.toFixed(s < 10 ? 1 : 0)}s`; }
  const m: number = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}
