/**
 * sessionstats.ets —— 内置插件 `xbot.session-stats`（会话统计面板）的**数据模型 + 判据**
 * （纯逻辑，零依赖，可脱机单测）。
 *
 * ── 为什么必须有这一层（用户点名「统计插件的面板我们看不到」）────────────────────
 * `xbot.session-stats` 是 **web bundle 内置插件**（`web/src/plugin-runtime/usePluginRuntimeHost.ts:112`
 * 的 `builtinViews.set('xbot.session-stats.panel', SessionStatsPanel)`），它**不在**
 * `~/.xbot/plugins/builtin/` 磁盘目录里 ⇒ 服务端 RPC `web_plugin_list` **从不下发它**
 * （2026-10-12 实测：只回 genui / git-fancy / iteration-stats / ssh-runner 四条）
 * ⇒ 原生此前**没有任何入口**能看见这个面板（这正是用户报的缺陷）。
 *
 *   它的数据**全部来自宿主自己的 RPC**（`get_session_usage_stats`，iteration_history 聚合）
 *   —— **不需要执行任何插件 JS** ⇒ **可以原生渲染**（与 `xbot.iteration-stats` 徽章同一范式，
 *   见 `core/pluginviews.ets` 文件头「能由宿主自己出数据、原生画得出的视图一律原生渲染」）。
 *   本模块是这条路径的**唯一判据层**：把"画什么、怎么格式化"收敛到这里，组件只画
 *   （`docs/REDESIGN.md` §11「单一状态→视图管线」）。
 *
 * ── 纪律（同 `core/pluginviews.ets`）────────────────────────────────────────────
 *   ⛔ 本文件属 `core/` ⇒ 被 `tools/tests/run.sh` 当**纯 TS** 编译：禁 import ArkUI /
 *      `@ohos.*`；禁无类型对象字面量（一律 `class`）；无 `any`。
 *   ⛔ 只产出**文案 / 数值**，不产出颜色（颜色由组件经 `core/design.ets:colorOf` 解析）。
 *
 * ── 逐字对齐的 web 真源（file:line 可查）────────────────────────────────────────
 *   · 面板形态：`web/src/plugins/session-stats/SessionStatsPanel.tsx:723-818` 的**窄形态**
 *     （手机屏宽 < 640px ⇒ 只出窄形态；宽形态只在主编辑区出现）。
 *   · 格式化：`web/src/plugins/session-stats/format.ts`（`formatTokenCount` / `formatCount` /
 *     `formatRatio`）+ 面板内 `fmtMs`（`:49-58`）/ `fmtPct`（`:60-63`）。
 *   · 数据：RPC `get_session_usage_stats`（`web/src/plugin-api/rpc.ts:315-334 TenantUsageStats`
 *     / `:286-298 UsageIterationRow`）。
 *
 * ── 原生**优于** web 的两处（有意偏离，已在代码处逐一注明）──────────────────────
 *   ① web 窄形态把「缓存命中率」「迭代/轮次」的**实际数值**传进了 `t(key,{…})`，但 zh/en/ja
 *      三份 i18n 表里这些 key **没有插值占位符**（实测 `src/i18n/{zh-CN,en,ja}.ts`）⇒ web 面板
 *      这两行的副标题是**死文案**（拿不到数值）。原生按传入值渲染（忠于调用点的意图）。
 *   ② web 用 `contextLevel`（zh 文案误抄成「当前模型」）标注**上下文水位**指标 ⇒ 原生用语义
 *      正确的「上下文水位」（`contextUsage` 同义）。
 */
// `fmtTokens`（token 短形态，web `fmtTokens` 同源）唯一出口 = `core/settings.ets`（⛔ 不重造）。
// 但统计面用的是 `formatTokenCount`（k/M/B 口径），与设置的「跟随默认」口径**不同** ⇒ 见下。

// ══════════════════════════════════════════════════════════════════════════════
// ① 线类型（服务端 JSON；字段名逐字对齐 `web/src/plugin-api/rpc.ts`）
// ══════════════════════════════════════════════════════════════════════════════

/** 单条迭代明细（`rpc.ts:286-298 UsageIterationRow`）。 */
import { t } from './i18n';

export interface UsageIterationWire {
  turn_id?: number;
  iteration?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  ttft_ms?: number;
  tpot_ms?: number;
  tokens_per_sec?: number;
  total_ms?: number;
  model?: string;
  created_at?: string;
}

/** 单模型分组（`by_model[]`）。 */
export interface UsageByModelWire {
  model?: string;
  subscription_id?: string;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  iterations?: number;
  turns?: number;
  avg_ttft_ms?: number;
  avg_tpot_ms?: number;
}

/** `get_session_usage_stats` 响应（`rpc.ts:315-334 TenantUsageStats`）。 */
export interface SessionUsageWire {
  iteration_count?: number;
  turn_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  llm_total_ms?: number;
  avg_ttft_ms?: number;
  avg_tpot_ms?: number;
  avg_tokens_per_sec?: number;
  first_iteration_at?: string;
  last_iteration_at?: string;
  last_prompt_tokens?: number;
  last_completion_tokens?: number;
  current_model?: string;
  session_created_at?: string;
  session_last_active?: string;
  by_model?: UsageByModelWire[];
  recent_iterations?: UsageIterationWire[] | null;
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 归一化模型（组件直接消费；缺字段一律回落 0/''，**绝不** NaN）
// ══════════════════════════════════════════════════════════════════════════════

/** 防御性取数：非有限数 ⇒ 0（NaN/Infinity 一律归零，绝不透传到 UI）。 */
function toNum(v: number | undefined): number {
  return v !== undefined && v !== null && isFinite(v) ? v : 0;
}

/** 防御性取串：缺 ⇒ ''。 */
function str(v: string | undefined): string {
  return v !== undefined && v !== null ? v : '';
}

/** 归一化后的一条迭代明细。 */
export class UsageIteration {
  turnId: number = 0;
  iteration: number = 0;
  inputTokens: number = 0;
  outputTokens: number = 0;
  cachedTokens: number = 0;
  ttftMs: number = 0;
  tpotMs: number = 0;
  tokensPerSec: number = 0;
  totalMs: number = 0;
  model: string = '';
  createdAt: string = '';
}

/** 归一化后的单模型分组。 */
export class UsageByModel {
  model: string = '';
  inputTokens: number = 0;
  outputTokens: number = 0;
  cachedTokens: number = 0;
  iterations: number = 0;
  turns: number = 0;
  avgTtftMs: number = 0;
  avgTpotMs: number = 0;
}

/** 归一化后的会话用量（组件消费）。 */
export class SessionUsage {
  iterationCount: number = 0;
  turnCount: number = 0;
  inputTokens: number = 0;
  outputTokens: number = 0;
  cachedTokens: number = 0;
  llmTotalMs: number = 0;
  avgTtftMs: number = 0;
  avgTpotMs: number = 0;
  avgTokensPerSec: number = 0;
  lastPromptTokens: number = 0;
  lastCompletionTokens: number = 0;
  currentModel: string = '';
  sessionCreatedAt: string = '';
  byModel: UsageByModel[] = [];
  recentIterations: UsageIteration[] = [];
}

/** 把 `get_session_usage_stats` 的原始响应归一化成 `SessionUsage`（纯函数 ⇒ 可脱机单测）。 */
export function parseSessionUsage(raw: SessionUsageWire | undefined): SessionUsage {
  const u: SessionUsage = new SessionUsage();
  if (raw === undefined || raw === null) {
    return u;
  }
  u.iterationCount = toNum(raw.iteration_count);
  u.turnCount = toNum(raw.turn_count);
  u.inputTokens = toNum(raw.input_tokens);
  u.outputTokens = toNum(raw.output_tokens);
  u.cachedTokens = toNum(raw.cached_tokens);
  u.llmTotalMs = toNum(raw.llm_total_ms);
  u.avgTtftMs = toNum(raw.avg_ttft_ms);
  u.avgTpotMs = toNum(raw.avg_tpot_ms);
  u.avgTokensPerSec = toNum(raw.avg_tokens_per_sec);
  u.lastPromptTokens = toNum(raw.last_prompt_tokens);
  u.lastCompletionTokens = toNum(raw.last_completion_tokens);
  u.currentModel = str(raw.current_model);
  u.sessionCreatedAt = str(raw.session_created_at);
  const bm: UsageByModelWire[] = raw.by_model !== undefined && raw.by_model !== null ? raw.by_model : [];
  for (let i = 0; i < bm.length; i++) {
    const w: UsageByModelWire = bm[i];
    const m: UsageByModel = new UsageByModel();
    m.model = str(w.model);
    m.inputTokens = toNum(w.input_tokens);
    m.outputTokens = toNum(w.output_tokens);
    m.cachedTokens = toNum(w.cached_tokens);
    m.iterations = toNum(w.iterations);
    m.turns = toNum(w.turns);
    m.avgTtftMs = toNum(w.avg_ttft_ms);
    m.avgTpotMs = toNum(w.avg_tpot_ms);
    u.byModel.push(m);
  }
  const ri: UsageIterationWire[] = raw.recent_iterations !== undefined && raw.recent_iterations !== null
    ? raw.recent_iterations : [];
  for (let i = 0; i < ri.length; i++) {
    const w: UsageIterationWire = ri[i];
    const r: UsageIteration = new UsageIteration();
    r.turnId = toNum(w.turn_id);
    r.iteration = toNum(w.iteration);
    r.inputTokens = toNum(w.input_tokens);
    r.outputTokens = toNum(w.output_tokens);
    r.cachedTokens = toNum(w.cached_tokens);
    r.ttftMs = toNum(w.ttft_ms);
    r.tpotMs = toNum(w.tpot_ms);
    r.tokensPerSec = toNum(w.tokens_per_sec);
    r.totalMs = toNum(w.total_ms);
    r.model = str(w.model);
    r.createdAt = str(w.created_at);
    u.recentIterations.push(r);
  }
  return u;
}

// ══════════════════════════════════════════════════════════════════════════════
// ③ 格式化（逐字端口 web `format.ts` + 面板内 `fmtMs`/`fmtPct`）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * token 数缩写（web `format.ts:7-13 formatTokenCount`）：
 * `0/缺` ⇒ `0`；`>=1e9` ⇒ `x.xxB`；`>=1e6` ⇒ `x.xxM`；`>=1e3` ⇒ `x.xk`；否则四舍五入整数。
 */
export function formatTokenCount(n: number): string {
  const v: number = toNum(n);
  if (v === 0) {
    return '0';
  }
  if (v >= 1000000000) {
    return `${(v / 1000000000).toFixed(2)}B`;
  }
  if (v >= 1000000) {
    return `${(v / 1000000).toFixed(2)}M`;
  }
  if (v >= 1000) {
    return `${(v / 1000).toFixed(1)}k`;
  }
  return `${Math.round(v)}`;
}

/**
 * 整数千分位（web `format.ts:17` 的 `toLocaleString('en-US')` —— 这里**手写分组**
 * 以求跨运行时确定：`en-US` 的输出就是每 3 位一个逗号、负号在左）。
 */
export function formatCount(n: number): string {
  const v: number = Math.round(toNum(n));
  const neg: boolean = v < 0;
  const digits: string = `${neg ? -v : v}`;
  let out: string = '';
  const len: number = digits.length;
  for (let i = 0; i < len; i++) {
    if (i > 0 && (len - i) % 3 === 0) {
      out += ',';
    }
    out += digits.charAt(i);
  }
  return neg ? `-${out}` : out;
}

/**
 * 0..1 比率 → `x.x%`（web `format.ts:21-24 formatRatio`）：
 * `null`/非有限 ⇒ `—`（**绝不把"无数据"渲染成 0%**）。
 */
export function formatRatio(ratio: number | undefined, digits: number): string {
  if (ratio === undefined || ratio === null || !isFinite(ratio)) {
    return '—';
  }
  return `${(ratio * 100).toFixed(digits >= 0 ? digits : 1)}%`;
}

/**
 * 毫秒 → 人类可读（web `SessionStatsPanel.tsx:49-58 fmtMs` 逐字端口）：
 * `0/缺` ⇒ `—`；`<1s` ⇒ `${round}ms`；`<60s` ⇒ `x.xs`；否则 `xhmm` / `xmss`。
 */
export function statMs(ms: number): string {
  const v: number = toNum(ms);
  if (v === 0) {
    return '—';
  }
  if (v < 1000) {
    return `${Math.round(v)}ms`;
  }
  if (v < 60000) {
    return `${(v / 1000).toFixed(1)}s`;
  }
  const h: number = Math.floor(v / 3600000);
  const m: number = Math.floor((v % 3600000) / 60000);
  if (h > 0) {
    return `${h}h${two(m)}m`;
  }
  const s: number = Math.round((v % 60000) / 1000);
  return `${m}m${two(s)}s`;
}

/** 两位补零（`String(x).padStart(2,'0')` 的纯逻辑等价）。 */
function two(x: number): string {
  return x < 10 ? `0${x}` : `${x}`;
}

/**
 * 百分比（web 面板 `fmtPct`，`:60-63`）：分母为 0 ⇒ `—`（不渲染 `NaN%`/`0%` 假值）。
 */
export function fmtPct(numerator: number, denominator: number): string {
  const d: number = toNum(denominator);
  if (d === 0) {
    return '—';
  }
  return `${((toNum(numerator) / d) * 100).toFixed(1)}%`;
}

/** 缓存命中率（0..1；分母 0 ⇒ undefined = 无数据）。 */
export function cacheRatio(u: SessionUsage): number | undefined {
  return u.inputTokens > 0 ? u.cachedTokens / u.inputTokens : undefined;
}

/** `since <创建时刻>` 副标题（web 用 `session_created_at.slice(5,16)`，去掉了年份）。 */
export function sinceText(createdAt: string): string {
  const s: string = str(createdAt).replace('T', ' ');
  const cut: string = s.length > 16 ? s.substring(0, 16) : s;
  const body: string = cut.length > 5 ? cut.substring(5) : cut;
  return body.length > 0 ? `since ${body}` : '';
}

// ══════════════════════════════════════════════════════════════════════════════
// ④ 窄形态的展示单元（组件只画；判据在此，**判据与渲染同源**）
// ══════════════════════════════════════════════════════════════════════════════

/** 一张指标卡（label 小字 / value 大数字 / sub 可选副行）。 */
export class StatCell {
  label: string = '';
  value: string = '';
  sub: string = '';

  constructor(label: string, value: string, sub: string) {
    this.label = label;
    this.value = value;
    this.sub = sub;
  }
}

/** 用量四联卡（输入 / 输出 / 缓存命中 / LLM 时长）。 */
export function overviewCells(u: SessionUsage): StatCell[] {
  const rate: number | undefined = cacheRatio(u);
  return [
    new StatCell(t('输入'), formatTokenCount(u.inputTokens), ''),
    new StatCell(t('输出'), formatTokenCount(u.outputTokens), ''),
    // ⚠️ 有意优于 web：web 传了 `{rate}` 但 i18n 表无占位符 ⇒ 死文案；原生渲染实际命中率。
    new StatCell(t('缓存命中'), formatTokenCount(u.cachedTokens), `命中率 ${formatRatio(rate, 1)}`),
    // ⚠️ 有意优于 web：同上（web 的副标题是死文案）。
    new StatCell(t('LLM 时长'), statMs(u.llmTotalMs), `${u.iterationCount} 迭代 · ${u.turnCount} 轮次`),
  ];
}

/** 性能三联网（Avg TTFT / Avg TPOT / Avg tok/s）。 */
export function perfCells(u: SessionUsage): StatCell[] {
  return [
    new StatCell('Avg TTFT', statMs(u.avgTtftMs), ''),
    new StatCell('Avg TPOT', u.avgTpotMs > 0 ? `${Math.round(u.avgTpotMs)}ms` : '—', ''),
    new StatCell('Avg tok/s', u.avgTokensPerSec > 0 ? `${Math.round(u.avgTokensPerSec)}` : '—', ''),
  ];
}

/**
 * 上下文水位 + 当前模型（上下水位用语义正确的「上下文水位」，
 * ⛔ 不沿用 web 把 `contextLevel` 误标成「当前模型」的那处文案 bug）。
 */
export function contextCells(u: SessionUsage): StatCell[] {
  const model: string = u.currentModel.length > 0 ? u.currentModel : '—';
  return [
    new StatCell(t('上下文水位'), formatTokenCount(u.lastPromptTokens), `生成 ${formatTokenCount(u.lastCompletionTokens)}`),
    new StatCell(t('当前模型'), model, sinceText(u.sessionCreatedAt)),
  ];
}

/** 一行「按模型」展示单元（模型名 + 一行指标）。 */
export class ByModelRow {
  model: string = '';
  meta: string = '';

  constructor(model: string, meta: string) {
    this.model = model;
    this.meta = meta;
  }
}

/**
 * 「按模型」分组行 —— 只保留 `model` 非空的行；`>1` 行才展示
 * （web 判据：`by_model.filter((m) => m.model).length > 1`）。
 */
export function byModelRows(u: SessionUsage): ByModelRow[] {
  const rows: ByModelRow[] = [];
  for (let i = 0; i < u.byModel.length; i++) {
    const m: UsageByModel = u.byModel[i];
    if (m.model.length === 0) {
      continue;
    }
    const meta: string = `in ${formatTokenCount(m.inputTokens)} · out ${formatTokenCount(m.outputTokens)}`
      + ` · cache ${formatTokenCount(m.cachedTokens)} · ${m.iterations} iters`;
    rows.push(new ByModelRow(m.model, meta));
  }
  return rows;
}

/** 最近迭代表的一行（已格式化，组件直接画）。 */
export class RecentIterRow {
  key: string = '';
  turnIter: string = '';
  input: string = '';
  cache: string = '';
  output: string = '';
  ttft: string = '';
  tpot: string = '';
  tps: string = '';

  constructor(key: string, turnIter: string, input: string, cache: string, output: string,
    ttft: string, tpot: string, tps: string) {
    this.key = key;
    this.turnIter = turnIter;
    this.input = input;
    this.cache = cache;
    this.output = output;
    this.ttft = ttft;
    this.tpot = tpot;
    this.tps = tps;
  }
}

/** 表格展示行数上限（web `RECENT_ITERATION_ROWS = 60`）。 */
export const RECENT_ITERATION_ROWS: number = 60;

/**
 * 最近迭代表行 —— 取**最新的一段**（web `allIterations.slice(len - RECENT_ITERATION_ROWS)`；
 * 服务端明细按时间从旧到新，故保留尾部）。
 */
export function recentRows(u: SessionUsage): RecentIterRow[] {
  const all: UsageIteration[] = u.recentIterations;
  const start: number = Math.max(0, all.length - RECENT_ITERATION_ROWS);
  const out: RecentIterRow[] = [];
  for (let i = start; i < all.length; i++) {
    const r: UsageIteration = all[i];
    out.push(new RecentIterRow(
      `${r.turnId}-${r.iteration}-${i}`,
      `${r.turnId}.${r.iteration}`,
      formatTokenCount(r.inputTokens),
      r.cachedTokens > 0 ? fmtPct(r.cachedTokens, r.inputTokens) : '—',
      formatTokenCount(r.outputTokens),
      statMs(r.ttftMs),
      r.tpotMs > 0 ? `${Math.round(r.tpotMs)}ms` : '—',
      r.tokensPerSec > 0 ? `${Math.round(r.tokensPerSec)}` : '—',
    ));
  }
  return out;
}

// ── 等宽表（**单 `Text` 承载** ⇒ 组件无需 `ForEach`）────────────────────────────
//
// 为什么这样：性能预算 ⑦ 的 `ForEach(` 处数是**全仓硬上限（≤107，只许减）** ⇒ 新面板不能再添
// `ForEach`。最近迭代表最多 60 行，逐行 `ForEach` + 每行 7 个 `Text` = 480 个节点；改成**一个
// 等宽 `Text`**（行由 `\n` 分隔、列用空格对齐）后只剩 1 个节点 —— 既省 ForEach 又**更快**。

/** 右补空格到宽 `n`（列左对齐）。 */
function padRightTo(s: string, n: number): string {
  const v: string = s !== undefined && s !== null ? s : '';
  return v.length >= n ? v : v + ' '.repeat(n - v.length);
}

/** 左补空格到宽 `n`（数列右对齐）。 */
function padLeftTo(s: string, n: number): string {
  const v: string = s !== undefined && s !== null ? s : '';
  return v.length >= n ? v : ' '.repeat(n - v.length) + v;
}

/** 一行 7 列的等宽文本（列宽固定 ⇒ 头部与数据行对齐）。 */
function tableLine(a: string, b: string, c: string, d: string, e: string, f: string, g: string): string {
  return padRightTo(a, 7) + padLeftTo(b, 7) + padLeftTo(c, 7) + padLeftTo(d, 7)
    + padLeftTo(e, 7) + padLeftTo(f, 7) + padLeftTo(g, 7);
}

/** 最近迭代表的**表头行**（等宽；组件单独上弱化色渲染）。 */
export function recentTableHeader(): string {
  return tableLine('T.I', 'In', 'Cache', 'Out', 'TTFT', 'TPOT', 'tok/s');
}

/** 最近迭代表的数据行（等宽多行；行间 `\n`）。**空样本 ⇒ 空串**（组件据此不渲染）。 */
export function recentTableText(u: SessionUsage): string {
  const rows: RecentIterRow[] = recentRows(u);
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: RecentIterRow = rows[i];
    lines.push(tableLine(r.turnIter, r.input, r.cache, r.output, r.ttft, r.tpot, r.tps));
  }
  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑦ 目标④ 续批（2026-10-12）：web 面板有而原生缺的**三块**
//    · 用户累计（RPC `get_user_token_usage`）
//    · 按日明细（RPC `get_daily_token_usage`，服务端按「日 × 模型」下发 ⇒ 这里按日聚合）
//    · 趋势（RPC `get_session_usage_buckets` + `web tokenTrend.ts:38-42` 的粒度窗口）
//
// ⛔ 趋势**不画柱**而画**块字符 sparkline**：与上面等宽表同一理由 —— 性能预算 ⑦ 的
//    `ForEach(` 处数是**全仓硬上限（≤107，只许减）** ⇒ 新面板不得再添 `ForEach`。
//    单 `Text` 承载 sparkline（`▁▂▃▄▅▆▇█` 8 级）既零 `ForEach`、节点数 = 1，又天然是
//    "近窗口全貌"的紧凑表达（与 Apple Health 的迷你趋势条同观感）。
// ══════════════════════════════════════════════════════════════════════════════

/** 用户累计线类型（RPC `get_user_token_usage`）。 */
export interface UserUsageWire {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  conversation_count?: number;
  llm_call_count?: number;
  sender_id?: string;
}

/** 单日（×模型）线类型（RPC `get_daily_token_usage`）。 */
export interface DailyUsageWire {
  date?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  conversation_count?: number;
  llm_call_count?: number;
}

/** 趋势桶线类型（RPC `get_session_usage_buckets`；`bucket_start` = epoch 秒）。 */
export interface UsageBucketWire {
  bucket_start?: number;
  calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  total_ms_sum?: number;
  ttft_ms_sum?: number;
}

/** 归一化后的用户累计。 */
export class UserUsage {
  totalTokens: number = 0;
  inputTokens: number = 0;
  outputTokens: number = 0;
  cachedTokens: number = 0;
  conversationCount: number = 0;
  llmCallCount: number = 0;
}

/** 归一化后的单日聚合。 */
export class DailyUsage {
  date: string = '';
  /** 当日 token 最多的模型（多模型时才有意义；空串 = 未知）。 */
  model: string = '';
  inputTokens: number = 0;
  outputTokens: number = 0;
  cachedTokens: number = 0;
  conversationCount: number = 0;
  llmCallCount: number = 0;
}

/** 归一化后的趋势桶。 */
export class UsageBucket {
  /** epoch 秒。 */
  bucketStart: number = 0;
  calls: number = 0;
  inputTokens: number = 0;
  outputTokens: number = 0;
  cachedTokens: number = 0;
}

/** `get_user_token_usage` → `UserUsage`（缺字段一律 0）。 */
export function parseUserUsage(raw: UserUsageWire | undefined): UserUsage {
  const u: UserUsage = new UserUsage();
  if (raw === undefined || raw === null) {
    return u;
  }
  u.totalTokens = toNum(raw.total_tokens);
  u.inputTokens = toNum(raw.input_tokens);
  u.outputTokens = toNum(raw.output_tokens);
  u.cachedTokens = toNum(raw.cached_tokens);
  u.conversationCount = toNum(raw.conversation_count);
  u.llmCallCount = toNum(raw.llm_call_count);
  return u;
}

/**
 * `get_daily_token_usage`（**数组**，元素 = 「日 × 模型」）→ 按日聚合（**新 → 旧**）。
 * 同日多模型：token/会话/调用数相加；`model` 取当日 token 总和最大的那个。
 */
export function parseDailyUsage(raw: DailyUsageWire[] | null | undefined): DailyUsage[] {
  const src: DailyUsageWire[] = raw !== undefined && raw !== null ? raw : [];
  const out: DailyUsage[] = [];
  for (let i = 0; i < src.length; i++) {
    const r: DailyUsageWire = src[i];
    if (r === undefined || r === null) {
      continue;
    }
    const date: string = str(r.date);
    const inTok: number = toNum(r.input_tokens);
    const outTok: number = toNum(r.output_tokens);
    let hit: DailyUsage | null = null;
    for (let j = 0; j < out.length; j++) {
      if (out[j].date === date) {
        hit = out[j];
        break;
      }
    }
    if (hit === null) {
      const d: DailyUsage = new DailyUsage();
      d.date = date;
      d.model = str(r.model);
      d.inputTokens = inTok;
      d.outputTokens = outTok;
      d.cachedTokens = toNum(r.cached_tokens);
      d.conversationCount = toNum(r.conversation_count);
      d.llmCallCount = toNum(r.llm_call_count);
      out.push(d);
    } else {
      const prev: number = hit.inputTokens + hit.outputTokens;
      hit.inputTokens += inTok;
      hit.outputTokens += outTok;
      hit.cachedTokens += toNum(r.cached_tokens);
      hit.conversationCount += toNum(r.conversation_count);
      hit.llmCallCount += toNum(r.llm_call_count);
      if (inTok + outTok > prev) {
        hit.model = str(r.model);
      }
    }
  }
  // 新 → 旧（`date` 是 `YYYY-MM-DD` ⇒ 字典序 = 时间序，无需解析日期）。
  out.sort((a: DailyUsage, b: DailyUsage): number => a.date < b.date ? 1 : (a.date > b.date ? -1 : 0));
  return out;
}

/** `get_session_usage_buckets`（**数组**）→ 趋势桶（**按时间升序**）。 */
export function parseBuckets(raw: UsageBucketWire[] | null | undefined): UsageBucket[] {
  const src: UsageBucketWire[] = raw !== undefined && raw !== null ? raw : [];
  const out: UsageBucket[] = [];
  for (let i = 0; i < src.length; i++) {
    const r: UsageBucketWire = src[i];
    if (r === undefined || r === null) {
      continue;
    }
    const b: UsageBucket = new UsageBucket();
    b.bucketStart = toNum(r.bucket_start);
    b.calls = toNum(r.calls);
    b.inputTokens = toNum(r.input_tokens);
    b.outputTokens = toNum(r.output_tokens);
    b.cachedTokens = toNum(r.cached_tokens);
    out.push(b);
  }
  out.sort((a: UsageBucket, b: UsageBucket): number => a.bucketStart - b.bucketStart);
  return out;
}

/** 桶的 token 总量。 */
export function bucketTokens(b: UsageBucket): number {
  return b.inputTokens + b.outputTokens;
}

/** 粒度 → 窗口桶数（web `tokenTrend.ts:38-42`：分钟 60 / 小时 24 / 天 30）。 */
export function bucketWindowBuckets(granularity: string): number {
  if (granularity === 'minute') {
    return 60;
  }
  if (granularity === 'day') {
    return 30;
  }
  return 24;
}

/** 请求桶数的**窗口余量**（服务端按 `count` 回溯分桶；余量保证当前桶一定在内）。 */
export const BUCKET_WINDOW_MARGIN: number = 2;

/** 请求桶数 = 窗口桶数 + 余量（`get_session_usage_buckets` 的 `count`）。 */
export function bucketRequestCount(granularity: string): number {
  return bucketWindowBuckets(granularity) + BUCKET_WINDOW_MARGIN;
}

/** 按日明细的默认窗口（天）。 */
export const DAILY_DAYS_WINDOW: number = 7;

/**
 * JS `Date.prototype.getTimezoneOffset()`（**UTC − 本地**，如东八区 = −480）
 * → `get_session_usage_buckets` 的 `tz_offset_minutes`（**本地 − UTC**，东八区 = 480）。
 * ⛔ 符号相反是 JS 的历史约定，混了会让趋势桶整体错 16 小时。
 */
export function tzOffsetMinutesFor(jsOffset: number): number {
  return -toNum(jsOffset);
}

/** 粒度 → 窗口文案（`最近 24 小时`）。 */
export function trendWindowText(granularity: string): string {
  if (granularity === 'minute') {
    return '最近 60 分钟';
  }
  if (granularity === 'day') {
    return '最近 30 天';
  }
  return '最近 24 小时';
}

/** 分段控件的三个粒度（细 → 粗）。 */
export function granularityOptions(): string[] {
  return ['minute', 'hour', 'day'];
}

/** 粒度显示名（分段控件）。 */
export function granularityLabel(g: string): string {
  if (g === 'minute') {
    return '分';
  }
  if (g === 'day') {
    return '日';
  }
  return '时';
}

/** 8 级块字符（`▁▂▃▄▅▆▇█`）—— 趋势 sparkline 的字模。 */
const SPARK_LEVELS: string = '▁▂▃▄▅▆▇█';

/**
 * 趋势 → **单行 sparkline**（块字符，8 级）。取窗口内**最后** N 个桶（N = `bucketWindowBuckets`）。
 * 全部为 0（或空）⇒ 返回**空串**（组件据此不渲染该段，而不是画一条"全是底"的假线）。
 */
export function trendSparkline(buckets: UsageBucket[], granularity: string): string {
  const n: number = bucketWindowBuckets(granularity);
  const total: number = buckets.length;
  if (total === 0) {
    return '';
  }
  const start: number = total > n ? total - n : 0;
  const vals: number[] = [];
  let max: number = 0;
  for (let i = start; i < total; i++) {
    const v: number = bucketTokens(buckets[i]);
    vals.push(v);
    if (v > max) {
      max = v;
    }
  }
  if (max <= 0) {
    return '';
  }
  let out: string = '';
  for (let i = 0; i < vals.length; i++) {
    const ratio: number = vals[i] / max;
    let lvl: number = Math.round(ratio * (SPARK_LEVELS.length - 1));
    if (lvl < 0) {
      lvl = 0;
    }
    if (lvl > SPARK_LEVELS.length - 1) {
      lvl = SPARK_LEVELS.length - 1;
    }
    out += SPARK_LEVELS.charAt(lvl);
  }
  return out;
}

/** 桶起点 → 刻度文案（分钟/小时 ⇒ `HH:MM`；天 ⇒ `MM-DD`；用**本地时区**）。 */
export function bucketLabel(epochSec: number, granularity: string): string {
  const ms: number = toNum(epochSec) * 1000;
  if (ms <= 0) {
    return '';
  }
  const d: Date = new Date(ms);
  const pad = (v: number): string => (v < 10 ? `0${v}` : `${v}`);
  if (granularity === 'day') {
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 趋势小结（`合计 12.3M · 活跃 9/24 桶 · 峰值 18:00 1.2M`）。
 * 无数据 ⇒ 空串（组件不渲染）。
 */
export function trendSummaryText(buckets: UsageBucket[], granularity: string): string {
  const n: number = bucketWindowBuckets(granularity);
  const total: number = buckets.length;
  if (total === 0) {
    return '';
  }
  const start: number = total > n ? total - n : 0;
  let sum: number = 0;
  let active: number = 0;
  let peak: number = 0;
  let peakAt: number = 0;
  for (let i = start; i < total; i++) {
    const v: number = bucketTokens(buckets[i]);
    sum += v;
    if (v > 0) {
      active++;
    }
    if (v > peak) {
      peak = v;
      peakAt = buckets[i].bucketStart;
    }
  }
  if (sum <= 0) {
    return '';
  }
  return `合计 ${formatTokenCount(sum)} · 活跃 ${active}/${n} 桶`
    + (peak > 0 ? ` · 峰值 ${bucketLabel(peakAt, granularity)} ${formatTokenCount(peak)}` : '');
}

/** 用户累计卡（总 token / 会话 / LLM 调用 / 缓存）。 */
export function userCells(u: UserUsage): StatCell[] {
  return [
    new StatCell(t('累计 token'), formatTokenCount(u.totalTokens), `${formatCount(u.llmCallCount)} 次调用`),
    new StatCell('会话数', formatCount(u.conversationCount), ''),
    new StatCell('缓存 token', formatTokenCount(u.cachedTokens),
      `命中率 ${fmtPct(u.cachedTokens, u.inputTokens)}`),
  ];
}

/** 一行「按日」展示单元。 */
export class DailyRow {
  day: string = '';
  total: string = '';
  meta: string = '';

  constructor(day: string, total: string, meta: string) {
    this.day = day;
    this.total = total;
    this.meta = meta;
  }
}

/** 「按日」行（最多 `maxDays` 日，新→旧；`day` 去掉年份）。 */
export function dailyRows(rows: DailyUsage[], maxDays: number): DailyRow[] {
  const out: DailyRow[] = [];
  const n: number = maxDays > 0 ? maxDays : 7;
  for (let i = 0; i < rows.length && i < n; i++) {
    const d: DailyUsage = rows[i];
    const day: string = d.date.length >= 10 ? d.date.substring(5) : d.date;
    const model: string = d.model.length > 0 ? ` · ${d.model}` : '';
    out.push(new DailyRow(day, formatTokenCount(d.inputTokens + d.outputTokens),
      `${formatCount(d.llmCallCount)} 次 · ${formatCount(d.conversationCount)} 会话${model}`));
  }
  return out;
}

/** 累计区是否可见（有数据才渲染；全 0 ⇒ 组件不画空卡）。 */
export function hasUserUsage(u: UserUsage): boolean {
  return u.totalTokens > 0 || u.conversationCount > 0 || u.llmCallCount > 0;
}
