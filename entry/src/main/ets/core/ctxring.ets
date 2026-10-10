/**
 * 上下文用量环的**纯逻辑**（可脱机单测）—— 逐字移植 web `web/src/components/agent/ContextRing.tsx`。
 *
 * 为什么单独成文件：这些规则（阈值档位 / 变色语义 / 文案 / 数字格式）算错会**直接误导用户**
 * （把 79% 显示成告警、把 200K 显示成 200.0K、把"未知"显示成 0%），必须能被钉死在测试里。
 * 本文件属 `core/` ⇒ 会被 `tools/tests/run.sh` 当**纯 TS** 在 Node 里编译
 * ⇒ **禁止**引用任何 ArkUI 全局类型（`Progress`/`Color`/`@Component` 等）。
 *
 * ── web 侧的权威语义（file:line） ───────────────────────────────────────────
 *   · `ContextRing.tsx:24` `hasUsage = available && usagePercent !== null && isFinite(...)`
 *   · `ContextRing.tsx:25` `drawnPercent = hasUsage ? clamp(0,100,usagePercent) : 0`
 *   · `ContextRing.tsx:26` `high = hasUsage && usagePercent >= 80`  ← **用原始值**判定，不是 clamp 后
 *   · `ContextRing.tsx:12-16` `formatTokensAsK`（整千无小数；否则一位小数 + 去掉尾随 `.0`）
 *   · `ContextRing.tsx:18-20` `formatUsagePercent` = `Number(p.toFixed(3)).toString()`
 *   · `ContextRing.tsx:28-35` tooltip 文案 = `{pct}% · {used} / {available}`（`i18n/zh-CN.ts:257`）
 *                             无数据时 `未知 / {available}`（`i18n/zh-CN.ts:261`），max 为 0 时用 `—`
 *   · `ContextRing.tsx:55` 轨道 `opacity="0.22"`；`:53` `strokeWidth="2"`（viewBox 20×20）
 *   · `useSessionContext.ts:74-85` `available` 的**完整**判据：
 *     `snapshot.available && promptTokens > 0 && maxContext > 0 && Number.isFinite(usagePercent)`
 *     —— 即 percent 一律取**服务端**值，**绝不本地推算**（与 `core/statusfmt.ets` 的
 *     `usageText` 不同：那条文本在缺 percent 时会用 used/max 兜底；环**不做**兜底，
 *     这是 web 的原样行为 —— 别"顺手修"成兜底，否则环变告警的时机与 web 不一致）。
 */
import { TokenUsage } from './types';

/** 告警阈值（web `ContextRing.tsx:26`：`usagePercent >= 80`）。改这里 = 改 web 的同一处。 */
export const CTX_HIGH_PERCENT: number = 80;

/** 轨道不透明度（web `ContextRing.tsx:55` 的 `opacity="0.22"`）。 */
export const CTX_TRACK_OPACITY: number = 0.22;

/** 环描边宽度（web `ContextRing.tsx:53` `strokeWidth="2"`；viewBox 20×20 ⇒ 20vp 环时 2vp）。 */
export const CTX_RING_STROKE: number = 2;

/** 档位：正常。 */
export const CTX_LEVEL_NORMAL: string = 'normal';
/** 档位：接近溢出（≥ 阈值）。 */
export const CTX_LEVEL_HIGH: string = 'high';

/** 颜色语义角色：强调色（web `text-accent`）。 */
export const CTX_ROLE_ACCENT: string = 'accent';
/** 颜色语义角色：危险/告警（web `text-status-error`）。 */
export const CTX_ROLE_DANGER: string = 'danger';

/**
 * 是否有**服务端权威**用量可画（= web `useSessionContext` 的 `available`，见文件头）。
 *
 * 判据全部来自服务端快照，**不做任何本地估算**（项目铁律）。
 * ⇒ 拿不到就让调用方**不挂载**本组件（web 画空轨道；原生端整行更干净，见挂载处注释）。
 */
export function ctxHasUsage(u: TokenUsage | undefined): boolean {
  if (u === undefined || u.available !== true) {
    return false;
  }
  const used: number = u.prompt_tokens !== undefined ? u.prompt_tokens : 0;
  const max: number = u.max_context_tokens !== undefined ? u.max_context_tokens : 0;
  const pct: number | undefined = u.usage_percent;
  if (pct === undefined || !Number.isFinite(pct)) {
    return false;
  }
  return used > 0 && max > 0;
}

/** 服务端**原始**百分比（无数据 → 0）。组件以 `@Prop` 值语义拿它，避免传对象深拷贝。 */
export function ctxPercent(u: TokenUsage | undefined): number {
  if (!ctxHasUsage(u) || u === undefined) {
    return 0;
  }
  const pct: number | undefined = u.usage_percent;
  return pct !== undefined ? pct : 0;
}

/** 画弧百分比（web `drawnPercent`：clamp 到 [0,100]）。 */
export function ctxDrawnPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) {
    return 0;
  }
  return percent > 100 ? 100 : percent;
}

/**
 * 档位（web `high`）。⚠️ 传入的必须是**原始** percent（不是 `ctxDrawnPercent` 的结果）——
 * web 用原始值判定 ⇒ 负值/超 100 的脏数据行为与 web 一致。
 */
export function ctxLevel(percent: number): string {
  return percent >= CTX_HIGH_PERCENT ? CTX_LEVEL_HIGH : CTX_LEVEL_NORMAL;
}

/**
 * 档位 → 颜色**语义角色**（UI 侧再映射到 `pal()`）。
 *
 * 为什么不在这里直接返回颜色：本文件必须能被纯 TS 单测（不含主题状态），
 * 而"哪个角色配哪个色"是主题的事（`core/theme.ets`）。测试钉的是**判据**，不是颜色值。
 */
export function ctxColorRole(level: string): string {
  return level === CTX_LEVEL_HIGH ? CTX_ROLE_DANGER : CTX_ROLE_ACCENT;
}

/** 百分比文本（web `formatUsagePercent`：`Number(p.toFixed(3)).toString()`）—— `80.5` 而非 `80.500`。 */
export function ctxPercentText(percent: number): string {
  if (!Number.isFinite(percent)) {
    return '0';
  }
  const fixed: string = percent.toFixed(3);
  return `${Number(fixed)}`;
}

/**
 * token 数 → `K` 记法（web `formatTokensAsK`）：`200000→200K`、`1500→1.5K`、`999→1K`、`0→0K`。
 * 注意 web 用 `Number.isInteger` + `toFixed(1).replace(/\.0$/,'')`，这里用等价的字符串比较实现
 * （避免在 ArkTS 侧引入正则），**行为逐字对齐**。
 */
export function ctxTokensAsK(tokens: number): string {
  const value: number = (tokens > 0 ? tokens : 0) / 1000;
  if (value === Math.floor(value)) {
    return `${value}K`;
  }
  let s: string = value.toFixed(1);
  if (s.length > 2 && s.slice(s.length - 2) === '.0') {
    s = s.slice(0, s.length - 2);
  }
  return `${s}K`;
}

/**
 * 明细文案（web 的 tooltip = `ContextRing.tsx:28-35` 拼出的字符串）。
 * 有数据：`{pct}% · {used} / {available}`；无数据：`未知 / {available|—}`。
 */
export function ctxLabel(u: TokenUsage | undefined): string {
  const max: number = u !== undefined && u.max_context_tokens !== undefined ? u.max_context_tokens : 0;
  if (!ctxHasUsage(u) || u === undefined) {
    return `未知 / ${max > 0 ? ctxTokensAsK(max) : '—'}`;
  }
  const pct: number | undefined = u.usage_percent;
  const used: number = u.prompt_tokens !== undefined ? u.prompt_tokens : 0;
  return `${ctxPercentText(pct !== undefined ? pct : 0)}% · ${ctxTokensAsK(used)} / ${ctxTokensAsK(max)}`;
}
