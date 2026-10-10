/**
 * 上下文用量环的**纯逻辑测试**（web `ContextRing.tsx` 的行为镜像）。
 *
 * 判别力（关键边界）：阈值 79 / 80 / 81、0、100、负值与 NaN 脏数据、未知/无 max 的文案。
 * 自证（改错必红）：把 `core/ctxring.ets` 的 `CTX_HIGH_PERCENT` 由 80 改成 81（或 79）
 * ⇒ 本文件 80 那两条 `eq` 立即 fail（见提交信息里的实测输出）。
 */
declare const process: { exit: (c: number) => void };

import {
  CTX_HIGH_PERCENT, CTX_LEVEL_HIGH, CTX_LEVEL_NORMAL, CTX_ROLE_ACCENT, CTX_ROLE_DANGER,
  ctxColorRole, ctxDrawnPercent, ctxHasUsage, ctxLabel, ctxLevel, ctxPercent, ctxPercentText, ctxTokensAsK,
} from '../../entry/src/main/ets/core/ctxring';
import { TokenUsage } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 一份"有效"的服务端快照（web `useSessionContext` 判据全满足）。 */
function full(): TokenUsage {
  return { available: true, prompt_tokens: 160000, completion_tokens: 10, max_context_tokens: 200000, usage_percent: 80, model: 'glm' };
}

eq('阈值常量 = 80（web ContextRing.tsx:26）', CTX_HIGH_PERCENT, 80);

// ── ctxHasUsage：一条都不许少（缺 available / 缺 percent / 无 prompt / 无 max / NaN ⇒ 无数据）──
eq('undefined 无数据', ctxHasUsage(undefined), false);
eq('available=false 无数据', ctxHasUsage({ available: false, prompt_tokens: 160000, max_context_tokens: 200000, usage_percent: 80 }), false);
eq('缺 percent 无数据（不本地推算 —— web 行为）', ctxHasUsage({ available: true, prompt_tokens: 160000, max_context_tokens: 200000 }), false);
eq('percent=NaN 无数据', ctxHasUsage({ available: true, prompt_tokens: 160000, max_context_tokens: 200000, usage_percent: NaN }), false);
eq('prompt_tokens=0 无数据（web: promptTokens > 0）', ctxHasUsage({ available: true, prompt_tokens: 0, max_context_tokens: 200000, usage_percent: 0 }), false);
eq('缺 max 无数据（web: maxContext > 0）', ctxHasUsage({ available: true, prompt_tokens: 100, usage_percent: 5 }), false);
eq('完整快照有数据', ctxHasUsage(full()), true);
eq('prompt 缺失但 percent/max 有效 ⇒ 无数据（不猜）', ctxHasUsage({ available: true, max_context_tokens: 200000, usage_percent: 80 }), false);

// ── ctxPercent：取服务端原始值；无数据 → 0（绝不造值）──
eq('原始 percent 原样返回', ctxPercent({ available: true, prompt_tokens: 100, max_context_tokens: 200000, usage_percent: 80.5 }), 80.5);
eq('无数据 → 0', ctxPercent(undefined), 0);
eq('超 100 也原样返回（clamp 是画弧的事，判定用原始值）', ctxPercent({ available: true, prompt_tokens: 100, max_context_tokens: 200000, usage_percent: 120 }), 120);

// ── ctxDrawnPercent：clamp [0,100] ──
eq('0', ctxDrawnPercent(0), 0);
eq('79', ctxDrawnPercent(79), 79);
eq('100', ctxDrawnPercent(100), 100);
eq('100.5 → 100（不许画超一圈）', ctxDrawnPercent(100.5), 100);
eq('负数 → 0', ctxDrawnPercent(-5), 0);
eq('NaN → 0', ctxDrawnPercent(NaN), 0);

// ── ctxLevel：阈值边界（这一组就是"改错阈值必红"的哨兵）──
eq('79 → normal', ctxLevel(79), CTX_LEVEL_NORMAL);
eq('80 → high（含边界）', ctxLevel(80), CTX_LEVEL_HIGH);
eq('81 → high', ctxLevel(81), CTX_LEVEL_HIGH);
eq('0 → normal', ctxLevel(0), CTX_LEVEL_NORMAL);
eq('100 → high', ctxLevel(100), CTX_LEVEL_HIGH);
eq('79.999 → normal', ctxLevel(79.999), CTX_LEVEL_NORMAL);
eq('负数脏值 → normal（web 同样不告警）', ctxLevel(-3), CTX_LEVEL_NORMAL);

// ── ctxColorRole：档位 → 语义角色（色值由主题解析，测试钉角色）──
eq('normal → accent', ctxColorRole(CTX_LEVEL_NORMAL), CTX_ROLE_ACCENT);
eq('high → danger', ctxColorRole(CTX_LEVEL_HIGH), CTX_ROLE_DANGER);
eq('未知档位回落 accent（不炸不告警）', ctxColorRole('???'), CTX_ROLE_ACCENT);

// ── ctxPercentText：web `Number(p.toFixed(3)).toString()` ──
eq('整数不留小数', ctxPercentText(80), '80');
eq('一位小数', ctxPercentText(80.5), '80.5');
eq('三位截断', ctxPercentText(33.3333), '33.333');
eq('100', ctxPercentText(100), '100');

// ── ctxTokensAsK：web `formatTokensAsK`（注意**没有** M 档：1e6 → `1000K`）──
eq('0 → 0K', ctxTokensAsK(0), '0K');
eq('负数 → 0K', ctxTokensAsK(-1), '0K');
eq('999 → 1K（进位到一位小数）', ctxTokensAsK(999), '1K');
eq('1500 → 1.5K', ctxTokensAsK(1500), '1.5K');
eq('12300 → 12.3K', ctxTokensAsK(12300), '12.3K');
eq('200000 → 200K', ctxTokensAsK(200000), '200K');
eq('1e6 → 1000K（web 无 M 档，别自作主张）', ctxTokensAsK(1000000), '1000K');

// ── ctxLabel：web tooltip 文案 ──
eq('有数据', ctxLabel({ available: true, prompt_tokens: 160000, max_context_tokens: 200000, usage_percent: 80.5 }), '80.5% · 160K / 200K');
eq('无数据但有 max', ctxLabel({ available: false, max_context_tokens: 200000 }), '未知 / 200K');
eq('无数据且无 max → —', ctxLabel(undefined), '未知 / —');
eq('available 但无 percent ⇒ 未知（web 行为）', ctxLabel({ available: true, prompt_tokens: 160000, max_context_tokens: 200000 }), '未知 / 200K');
eq('0% 也照实显示（有数据就是有数据）', ctxLabel({ available: true, prompt_tokens: 1000, max_context_tokens: 200000, usage_percent: 0 }), '0% · 1K / 200K');

if (fail > 0) { console.log(`  ctxring: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ctxring: ${pass} passed, 0 failed`);
process.exit(0);
