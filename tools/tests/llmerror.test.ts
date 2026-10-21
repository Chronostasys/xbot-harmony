/**
 * LLM 失败文本解析门禁 —— 守护 `core/llmerror.ets`（`components/LlmErrorNotice.ets` 的判据源）。
 *
 * 判别力核心：
 *  · **宁窄勿宽**：真失败文本 ⇒ 命中；普通消息（即使提到"错误"）⇒ **不误判**；
 *  · `#N:` 行**去重**（样例 `#1..#5` 相同 ⇒ attempts=1、attemptCount=5、repeatLabel）；
 *  · 短原因归类（连接被拒绝/超时/域名解析/认证…）；`raw` **逐字保留**（绝不丢内容）；
 *  · 边界：空/无签名/带围栏。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  LlmError, llmErrorReasonOf, llmErrorRepeatLabel, looksLikeLlmError, parseLlmError,
} from '../../entry/src/main/ets/core/llmerror';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 真机样例（逐字）──────────────────────────────────────────────────────────
const ATTEMPT: string = '#1: openai stream completion: Post "http://3.37.20.114:31001/v1/chat/completions": dial tcp 3.37.20.114:31001: connect: connection refused';
const SAMPLE: string = 'LLM 服务调用失败，请稍后重试或检查配置。\n错误详情: LLM generate failed: All attempts fail:\n'
  + ATTEMPT + '\n#2: ' + ATTEMPT.substring(4) + '\n#3: ' + ATTEMPT.substring(4)
  + '\n#4: ' + ATTEMPT.substring(4) + '\n#5: ' + ATTEMPT.substring(4);

// ── 命中 / 不误判 ────────────────────────────────────────────────────────────
eq('真机样例 ⇒ 命中', looksLikeLlmError(SAMPLE), true);
eq('All attempts fail ⇒ 命中', looksLikeLlmError('x: All attempts fail:'), true);
eq('LLM 服务调用失败 ⇒ 命中', looksLikeLlmError('LLM 服务调用失败'), true);
eq('普通消息 ⇒ 不命中', looksLikeLlmError('今天天气不错，我们来写代码'), false);
eq('提到"错误"但非失败文本 ⇒ 不命中', looksLikeLlmError('这里有个错误需要修复'), false);
eq('短串 ⇒ 不命中', looksLikeLlmError('ok'), false);
eq('空串 ⇒ 不命中', looksLikeLlmError(''), false);

// ── parseLlmError 核心字段 ───────────────────────────────────────────────────
{
  const e: LlmError | null = parseLlmError(SAMPLE);
  eq('非失败文本 ⇒ null', parseLlmError('hello world'), null);
  eq('空 ⇒ null', parseLlmError(''), null);
  eq('headline = 首行', e !== null ? e.headline : '', 'LLM 服务调用失败，请稍后重试或检查配置。');
  eq('reason = 连接被拒绝', e !== null ? e.reason : '', '连接被拒绝');
  eq('title = 模型调用失败 · 连接被拒绝', e !== null ? e.title : '', '模型调用失败 · 连接被拒绝');
  // ⛔ 去重：5 条 `#N:` 相同 ⇒ attempts 只 1 条、attemptCount 5
  eq('attempts 去重 ⇒ 1', e !== null ? e.attempts.length : -1, 1);
  eq('attemptCount = 5', e !== null ? e.attemptCount : -1, 5);
  eq('repeatLabel = 重复 5 次', llmErrorRepeatLabel(e !== null ? e.attemptCount : 0), '重复 5 次');
  eq('单次 ⇒ 无重复标签', llmErrorRepeatLabel(1), '');
  // raw 逐字保留（含 headline + 全部 #N）
  eq('raw 逐字保留原文', e !== null ? e.raw : '', SAMPLE);
}

// ── 不同的 `#N:` 不去重 ──────────────────────────────────────────────────────
{
  const two: string = 'LLM 调用失败\n错误详情: LLM generate failed: All attempts fail:\n#1: timeout on host a\n#2: connection refused on host b';
  const e: LlmError | null = parseLlmError(two);
  eq('不同尝试 ⇒ 2 条', e !== null ? e.attempts.length : -1, 2);
  eq('attemptCount = 2', e !== null ? e.attemptCount : -1, 2);
  eq('reason 取首条（超时）', e !== null ? e.reason : '', '连接超时');
}

// ── 原因归类 ─────────────────────────────────────────────────────────────────
eq('refused ⇒ 连接被拒绝', llmErrorReasonOf('connect: connection refused'), '连接被拒绝');
eq('no such host ⇒ 域名解析失败', llmErrorReasonOf('dial tcp: lookup x: no such host'), '域名解析失败');
eq('deadline ⇒ 连接超时', llmErrorReasonOf('context deadline exceeded'), '连接超时');
eq('401 ⇒ 认证失败', llmErrorReasonOf('status 401 Unauthorized'), '认证失败');
eq('403 ⇒ 无权限', llmErrorReasonOf('403 Forbidden'), '无权限');
eq('429 ⇒ 限流', llmErrorReasonOf('429 rate limit exceeded'), '限流');
eq('503 ⇒ 服务端错误', llmErrorReasonOf('503 Service Unavailable'), '服务端错误');
eq('未知 ⇒ 调用失败', llmErrorReasonOf('something weird'), '调用失败');

// ── 围栏：剥栏解析，raw 保原样 ───────────────────────────────────────────────
{
  const fenced: string = '```\nLLM 服务调用失败，请稍后重试。\n错误详情: All attempts fail:\n#1: connection refused\n```';
  const e: LlmError | null = parseLlmError(fenced);
  eq('带围栏 ⇒ 命中', e !== null, true);
  eq('带围栏 ⇒ reason 正确', e !== null ? e.reason : '', '连接被拒绝');
  eq('带围栏 ⇒ raw 逐字保留（含 ```）', e !== null ? e.raw : '', fenced);
  eq('带围栏 ⇒ headline 不含 ```', e !== null ? e.headline : '', 'LLM 服务调用失败，请稍后重试。');
}

// ── headline/detail：无 `#N:` 行也不崩 ──────────────────────────────────────
{
  const e: LlmError | null = parseLlmError('LLM 服务调用失败，请稍后重试或检查配置。\n错误详情: connection refused');
  eq('无 #N: 行 ⇒ attemptCount=0', e !== null ? e.attemptCount : -1, 0);
  eq('无 #N: 行 ⇒ detail 含原因', e !== null ? e.detail.indexOf('connection refused') >= 0 : false, true);
  eq('无 #N: 行 ⇒ reason 仍正确', e !== null ? e.reason : '', '连接被拒绝');
}

console.log(`  llmerror: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
