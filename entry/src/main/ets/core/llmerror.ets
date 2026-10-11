/**
 * LLM 调用失败文本的**纯逻辑**（解析 → 人话摘要 + 去重）—— 供 `components/LlmErrorNotice.ets`
 * 渲染（**判据与渲染同源**：组件只调本文件，不另写判断）。
 *
 * ── 问题（2026-10-11 真机取证）────────────────────────────────────────────────
 * 服务端 LLM 连不上时，助手消息体原样铺一大段英文等宽文本：
 *   `LLM 服务调用失败，请稍后重试或检查配置。\n错误详情: LLM generate failed: All attempts fail:\n#1: …\n#2: …(×5)`
 * ⇒ 占满整屏、首屏看不到重点、重复 5 遍同一条错。
 *
 * ── web 权威（诚实记账）──────────────────────────────────────────────────────
 * web **没有**专门处理这种文本：它把 assistant 正文交给 `MarkdownRenderer`（`AssistantMessage.tsx:142-146`）
 * 原样渲染；唯一的"错误块"是 `LLMEmptyResponseWarning`（`AssistantMessage.tsx:173-179`）——
 * 一个 `border-status-error/40 bg-status-error/10 text-status-error` 的红盒，**不可折叠**、**不去重**。
 * ⇒ 本模块的"摘要行 + 可展开详情 + `#N:` 去重"是**原生对 web 的改进**（对齐其红盒的
 *   `status-error` 语义色，但形态收窄 —— 与既有 `FAILED_NOTICE_TEXT` 的"一行小字、非大红报错"同口径）。
 *
 * 纯函数 ⇒ 可脱机单测（`tools/tests/llmerror.test.ts`）。本文件属 `core/`，会被
 * `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ **禁止** import ArkUI / `@ohos.*`；避开 ArkTS 严格规则
 * （禁 `is` 类型谓词、禁对象字面量作类型标注 ⇒ 用 class）。
 */

/** 解析结果（渲染层据此画"摘要行 + 可展开详情"）。 */
export class LlmError {
  /** 原始首行（人话句，如 `LLM 服务调用失败，请稍后重试或检查配置。`）。 */
  headline: string = '';
  /** 展示标题（人话摘要，如 `模型调用失败 · 连接被拒绝`）。 */
  title: string = '';
  /** 短原因（如 `连接被拒绝`）。 */
  reason: string = '';
  /** **去重后**的 `#N:` 行正文（保序，首现为准）。 */
  attempts: string[] = [];
  /** `#N:` 行**总数**（> attempts.length ⇒ 有重复，UI 显示"重复 N 次"）。 */
  attemptCount: number = 0;
  /** 错误详情正文（剥掉 headline 与 `错误详情:` 前缀后的原文，供展开看）。 */
  detail: string = '';
  /** 完整原文（`raw` 展开"全部原文"用；绝不丢内容）。 */
  raw: string = '';
}

/** 判定是否"LLM 调用失败"文本（**宁窄勿宽**，避免误伤普通消息）。 */
export function looksLikeLlmError(text: string): boolean {
  if (text.indexOf('All attempts fail') >= 0) { return true; }
  if (text.indexOf('LLM generate failed') >= 0) { return true; }
  if (text.indexOf('LLM 服务调用失败') >= 0) { return true; }
  if (text.indexOf('LLM 调用失败') >= 0) { return true; }
  // `错误详情:` 必须与 LLM/失败同时出现，避免"任何提到错误的正常消息"被吞。
  if (text.indexOf('错误详情') >= 0
    && (text.indexOf('LLM') >= 0 || text.toLowerCase().indexOf('failed') >= 0)) {
    return true;
  }
  return false;
}

/** 短原因：从错误正文里按关键词归类（连接被拒绝 / 超时 / 域名解析 / 认证 …）。 */
export function llmErrorReasonOf(detail: string): string {
  const s: string = detail.toLowerCase();
  if (s.indexOf('connection refused') >= 0) { return '连接被拒绝'; }
  if (s.indexOf('no such host') >= 0 || s.indexOf('server misbehaving') >= 0
    || s.indexOf('dns') >= 0 || s.indexOf('lookup ') >= 0) { return '域名解析失败'; }
  if (s.indexOf('timeout') >= 0 || s.indexOf('timed out') >= 0
    || s.indexOf('deadline exceeded') >= 0) { return '连接超时'; }
  if (s.indexOf('connection reset') >= 0) { return '连接被重置'; }
  if (s.indexOf('eof') >= 0 || s.indexOf('broken pipe') >= 0) { return '连接中断'; }
  if (s.indexOf('401') >= 0 || s.indexOf('unauthorized') >= 0) { return '认证失败'; }
  if (s.indexOf('403') >= 0 || s.indexOf('forbidden') >= 0) { return '无权限'; }
  if (s.indexOf('404') >= 0 || s.indexOf('not found') >= 0) { return '接口不存在'; }
  if (s.indexOf('429') >= 0 || s.indexOf('rate limit') >= 0) { return '限流'; }
  if (s.indexOf('502') >= 0 || s.indexOf('503') >= 0
    || s.indexOf('500') >= 0 || s.indexOf('bad gateway') >= 0) { return '服务端错误'; }
  return '调用失败';
}

/** 重复提示（`<=1` 返回空串 ⇒ UI 不渲染 chip）。 */
export function llmErrorRepeatLabel(count: number): string {
  return count > 1 ? `重复 ${count} 次` : '';
}

/** 剥掉 markdown 代码围栏行（`\`\`\`` / `\`\`\`lang`）—— 只用于**解析**，`raw` 保留原样。 */
function stripFences(text: string): string {
  const lines: string[] = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().indexOf('```') === 0) { continue; }
    out.push(lines[i]);
  }
  return out.join('\n');
}

/** 取 `#<digits>:` 行冒号后的正文（非该形态 ⇒ 返回 null）。 */
function attemptBody(line: string): string | null {
  const t: string = line.trim();
  if (t.length < 3 || t.charAt(0) !== '#') { return null; }
  let i: number = 1;
  let digits: number = 0;
  while (i < t.length) {
    const c: number = t.charCodeAt(i);
    if (c < 48 || c > 57) { break; }
    digits++;
    i++;
  }
  if (digits === 0 || i >= t.length || t.charAt(i) !== ':') { return null; }
  return t.substring(i + 1).trim();
}

/**
 * 解析 LLM 失败文本 ⇒ `LlmError`（**不是**该形态 ⇒ null，调用方按普通 markdown 渲染）。
 * @param text 助手正文（可含 markdown 围栏；`raw` 保留原文，解析用剥栏副本）。
 */
export function parseLlmError(text: string): LlmError | null {
  if (text === undefined || text === null || text.length === 0) { return null; }
  const stripped: string = stripFences(text);
  if (!looksLikeLlmError(stripped)) { return null; }

  const err: LlmError = new LlmError();
  err.raw = text;

  const lines: string[] = stripped.split('\n');
  // headline = 第一个非空行
  let hi: number = 0;
  while (hi < lines.length && lines[hi].trim().length === 0) { hi++; }
  err.headline = hi < lines.length ? lines[hi].trim() : '';

  // 逐行收集：#N: 尝试行（去重） + 详情正文
  const detailLines: string[] = [];
  const seen: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const body: string | null = attemptBody(lines[i]);
    if (body !== null) {
      err.attemptCount++;
      if (seen.indexOf(body) < 0) { seen.push(body); }
      continue;
    }
    // 去掉首行 + 去掉 "错误详情:" 标签行
    const t: string = lines[i].trim();
    if (i === hi) { continue; }
    if (t === '错误详情:' || t === '错误详情' || t === '错误详情：') { continue; }
    detailLines.push(lines[i]);
  }
  err.attempts = seen;
  // 详情正文：优先错误详情区（非空行），否则用去重后的尝试
  let detail: string = detailLines.join('\n').trim();
  if (detail.length === 0 && err.attempts.length > 0) { detail = err.attempts.join('\n'); }
  err.detail = detail;

  // 短原因：取**首条尝试**的正文（多条时其余多为同一根因；首条 = 主因）
  const reasonSrc: string = err.attempts.length > 0 ? err.attempts[0] : detail;
  err.reason = llmErrorReasonOf(reasonSrc);
  err.title = `模型调用失败 · ${err.reason}`;
  return err;
}
