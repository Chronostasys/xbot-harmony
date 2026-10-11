/**
 * AskUser 应答的**键 / 拼接**纯逻辑 —— web `components/agent/AskUserPanel.tsx` 的逐字移植。
 *
 * ⛔ 本模块是 web 判据的移植件：**不要重写语义**。要改先改 web 侧同一处再跟过来。
 *
 * ── 为什么存在（WEB-PARITY §12-G，2026-10-11 定案）─────────────────────────────
 * 服务端契约（**只读取证**，⛔ 未改服务端）：
 *   · `protocol/ws.go:85`：`Answers map[string]string `json:"answers"` // question index -> answer`
 *     ⇒ **声明契约是「问题下标 → 答案」**；
 *   · `channel/web/web_inbound.go:447-453`：服务端**不做任何匹配**，把客户端 map **原样**拼成
 *     `fmt.Sprintf("Q%s: %s", 键, 值)` ⇒ **key-agnostic**（按 `q.id` 发就回显 `Q<q.id>`，与 web/飞书分叉）；
 *   · `channel/feishu/feishu.go:264`：同源实现是 `Answers map[int]string`（**下标**）。
 *   ⇒ **不存在"服务端按问题文本匹配"** ⇒ 无服务端脆弱点；键的口径**完全由客户端定**，而 web 权威 = 下标。
 * web 权威：`AskUserPanel.tsx:70` `const key = String(i)`；`:90/:151` 也用 `String(i)`。
 *
 * ── 为什么抽到 `core/` ────────────────────────────────────────────────────────
 * 原实现内联在 `pages/Index.ets` 的应答拼装里（§12 表点名 `:2200-2201`），用了 `q.id`（缺省 `q{i}`）
 * 作键 + 多选 `, ` 连接 ⇒ 与 web 两处分叉，且**不可脱机测**。收敛到此处后：判据单点、可直测。
 */
import { isPresent } from './guards';

/** 多选答案连接符（web `AskUserPanel.tsx:37` `const MULTI_JOIN = '、'`）。 ⛔ 不得是 `, `。 */
export const ASKUSER_MULTI_JOIN: string = '、';

/** 问题的最小结构面（只要有可选 `id` —— 用来证明"**有 id 也必须是下标**"）。 */
export interface AskUserQuestionLike {
  id?: string;
}

/**
 * 应答**键集合**：**恒为问题下标** `String(i)`（`['0','1',…]`）。
 *
 * ⛔ **绝不使用 `q.id`**（哪怕问题带了 `id`）：服务端 `protocol/ws.go:85` 的契约与 web `:70`
 *    都是下标；用 id 会与 web/飞书（`map[int]string`）的 `Q<下标>` 形状分叉。
 * @param questions 问题数组（**读它的长度**；`id` 一律忽略 —— 这正是本函数要钉的不变量）。
 */
export function askUserAnswerKeys(questions: readonly AskUserQuestionLike[] | undefined): string[] {
  const src: readonly AskUserQuestionLike[] = questions === undefined ? [] : questions;
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    out.push(String(i));
  }
  return out;
}

/**
 * 多选答案拼接（web `:84` `realPicks.join(MULTI_JOIN)`）。
 * 空/空白项被丢弃；结果为空 ⇒ 空串（调用方据此判"未作答"）。
 */
export function joinMultiAnswer(picks: string[] | undefined): string {
  const src: string[] = picks === undefined ? [] : picks;
  const kept: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const v: string = isPresent(src[i]) ? src[i].trim() : '';
    if (v.length > 0) {
      kept.push(v);
    }
  }
  return kept.join(ASKUSER_MULTI_JOIN);
}

/**
 * 单题**最终答案**（web `:67-88` 的优先级，逐条对齐）：
 *   ① 自由文本（trim 后非空）⇒ 用它，**忽略**其它；
 *   ② 否则 "Other" 输入（trim 后非空）⇒ 用它（web `:76` 注释：**"Other" 只是触发开关，不是答案**）；
 *   ③ 否则已选项 **减去 `otherLabel`** 后非空 ⇒ 用 `、` 连接；
 *   ④ 都没有 ⇒ 空串（调用方判"该题未作答"）。
 *
 * @param otherLabel web `t('agent.askUserOther')`（原生同源常量）；⛔ 必须传入，否则"Other"会被当成真选项。
 */
export function mergeAskUserAnswer(
  freeText: string, otherInput: string, picks: string[] | undefined, otherLabel: string,
): string {
  const free: string = isPresent(freeText) ? freeText.trim() : '';
  if (free.length > 0) {
    return free;
  }
  const other: string = isPresent(otherInput) ? otherInput.trim() : '';
  if (other.length > 0) {
    return other;
  }
  const src: string[] = picks === undefined ? [] : picks;
  const label: string = isPresent(otherLabel) ? otherLabel : '';
  const real: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const v: string = isPresent(src[i]) ? src[i].trim() : '';
    if (v.length > 0 && (label.length === 0 || v !== label)) {
      real.push(v);
    }
  }
  return joinMultiAnswer(real);
}

/** 该题是否**已作答**（web `:90` `Boolean(mergedAnswers[String(i)])`）。 */
export function askUserAnswered(answer: string): boolean {
  return isPresent(answer) && answer.trim().length > 0;
}
