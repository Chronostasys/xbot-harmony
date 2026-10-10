/**
 * 「空 / 失败」态契约测试（波5g）—— 修复真机空白屏：**「模型没返回内容」与「这个回合不存在」是两件事**。
 *
 * 真机事实（2026-10-11，用户实测）：`role=user len=19` + `role=assistant len=0` 的会话，
 * processing=False ⇒ app 里"用户气泡 + 下面一片空白"。根因是 `MessageRowView.build()` 用
 * `rowIsEmpty` 把**空**当成**不存在**（整块跳过）。
 *
 * 本文件分两层：
 *  A. **真判定（可执行）**：`rowIsEmpty` / `rowHasInFlightSignal` 是真函数（`core/streammerge.ets`），
 *     用真 `ChatRow` 跑「空/非空 × 在飞/已结束」四种组合 ⇒ 这正是组件里那个分支的**判据本身**。
 *  B. **源码形态契约**：组件层不进离线 harness（`run.sh` 只编译 `core/**`），故按本仓既有先例
 *     （`live_tail_delivery.test.ts`）读真实源码，断言分支条件、文案逐字、克制形态。
 *     —— 任一条改坏即红（mutation 证据见交付报告）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { rowIsEmpty, rowHasInFlightSignal } from '../../entry/src/main/ets/core/streammerge';
import { ChatRow, HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}
/** 取某方法/函数体文本（本仓缩进约定：成员方法结束于行首两空格 + `}`）。 */
function bodyOf(src: string, sig: string): string {
  const i = src.indexOf(sig);
  if (i < 0) { return ''; }
  const j = src.indexOf('\n  }', i);
  return j < 0 ? src.substring(i) : src.substring(i, j);
}

function row(content: string, isLive: boolean, iterations: HistoryIteration[]): ChatRow {
  const r = new ChatRow();
  r.role = 'assistant';
  r.content = content;
  r.isLive = isLive;
  r.iterations = iterations;
  return r;
}

// ── (A) 真判定：空/非空 × 在飞/已结束 ─────────────────────────────────────────
// 真机复现的那一行：assistant、无内容、无迭代、**回合已结束**（processing=False）
const endedEmpty: ChatRow = row('', false, []);
eq('复现行：整行判定为"空"', rowIsEmpty(endedEmpty), true);
eq('复现行：尾部无在飞信号（= 占位不会顶上来）', rowHasInFlightSignal(endedEmpty), false);
// ⇒ 两个信号同时为"空"，而回合已结束 ⇒ 若组件什么都不画，用户就得到空白屏（本波修的正是这个）
ok('复现行确实是"已结束 + 空"（必须显式说话的组合）', !endedEmpty.isLive && rowIsEmpty(endedEmpty));

// 在飞的空行（刚 turn_started、首个 delta 未到）⇒ **不能**说话，由列表尾「思考中…」占位承担
const liveEmpty: ChatRow = row('', true, [{ iteration: 1, content: '', reasoning: '' }]);
eq('在飞空行：判定为空', rowIsEmpty(liveEmpty), true);
eq('在飞空行：无在飞信号（占位条件的另一半）', rowHasInFlightSignal(liveEmpty), false);
ok('在飞 vs 已结束 —— 同为"空"但状态不同（组件必须用 isLive 区分）', liveEmpty.isLive !== endedEmpty.isLive);

// 非空 ⇒ 走正常气泡（绝不能与空态提示同时出现）
eq('有正文：不空', rowIsEmpty(row('收到。', false, [])), false);
eq('纯思考迭代：不空', rowIsEmpty(row('', false, [{ iteration: 1, content: '', reasoning: '想' }])), false);
const t: ToolProgress = { name: 'Shell', status: 'done' };
eq('有工具迭代：不空', rowIsEmpty(row('', false, [{ iteration: 1, content: '', reasoning: '', tools: [t] }])), false);
eq('流式正文：不空', rowIsEmpty(row('', false, [{ iteration: 1, content: '', reasoning: '', stream_text: '流' }])), false);

// 服务端哨兵 `'(empty response)'`：**非空**（会被 rowIsEmpty 判为有内容）⇒ 必须单独识别，
// 否则哨兵字面量会被当正文渲染上屏（web 同款判据：AssistantMessage.tsx:169-171）
const sentinel: ChatRow = row('(empty response)', false, []);
eq('哨兵：rowIsEmpty 判为"非空"（所以必须有独立的哨兵分支）', rowIsEmpty(sentinel), false);
ok('哨兵字面量与 web 同值', sentinel.content.trim() === '(empty response)');

// ── (B) 源码形态契约（改坏必红）──────────────────────────────────────────────
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const rowSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'MessageRow.ets'), 'utf-8');

// (B1) 判定：必须"已结束"才说话（否则与在飞占位打架）
const noticeBody: string = bodyOf(rowSrc, 'private showsEmptyNotice(): boolean {');
ok('showsEmptyNotice() 可定位', noticeBody.length > 20);
has(noticeBody, '!this.row.isLive', '空态提示以"回合已结束"为前置（!row.isLive）');
has(noticeBody, 'this.isEmptyBubble()', '并以"整行无产出"为前置（isEmptyBubble）');
// (B2) 哨兵识别（trim + 常量，与 web 同判据）
const sentBody: string = bodyOf(rowSrc, 'private isEmptyResponse(): boolean {');
ok('isEmptyResponse() 可定位', sentBody.length > 20);
has(sentBody, 'this.row.content.trim() === EMPTY_RESPONSE_SENTINEL', '哨兵判定 = trim 后比字面量');
has(rowSrc, "export const EMPTY_RESPONSE_SENTINEL: string = '(empty response)';", '哨兵字面量与 web 一致');
// (B3) 两条出口都接上：①行级空态 ②正文是哨兵时不把哨兵上屏
has(rowSrc, '} else if (this.showsEmptyNotice()) {', 'build() 的空分支接上"空态提示"');
has(rowSrc, 'if (this.isEmptyResponse()) {', '正文路径先判哨兵');
const contentBranch: string = bodyOf(rowSrc, 'if (this.isEmptyResponse()) {');
has(contentBranch, 'EmptyNotice({ kind: NOTICE_KIND_FAILED', '哨兵 ⇒ 失败档提示（而非 MarkdownView 渲染哨兵）');
// (B4) 文案**逐字**对齐 web（抄错/自创即红）
has(rowSrc, "export const EMPTY_NOTICE_TEXT: string = '（无文本输出）';",
  '空态文案 = web agent.emptyAssistant（zh-CN.ts:223）逐字');
has(rowSrc, "export const FAILED_NOTICE_TEXT: string = 'LLM 本次没有返回文本内容，可能是模型输出异常或中途结束。';",
  '失败态文案 = web agent.emptyResponseWarning（zh-CN.ts:224）逐字');
// (B5) 克制形态：无填充/无边框/无阴影/无发光；只用语义色，不按主题名硬判
const noticeComp: string = rowSrc.substring(rowSrc.indexOf('struct EmptyNotice'));
ok('EmptyNotice 组件存在', noticeComp.length > 200);
hasNot(noticeComp, '.backgroundColor(', '空态提示无填充');
hasNot(noticeComp, '.border(', '空态提示无边框');
hasNot(noticeComp, '.shadow(', '空态提示无阴影（不得成为第二个发光体）');
hasNot(noticeComp, '.blur(', '空态提示无模糊');
hasNot(noticeComp, 'isLightPalette', '无需亮度分叉（全语义角色自动成立）');
hasNot(noticeComp, 'lightPalette', '不按主题名/固定色板硬判');
has(noticeComp, 'this.pal().textMuted', '空档颜色 = textMuted（中性一档）');
has(noticeComp, 'this.pal().dangerText', '失败档颜色 = dangerText（唯一加重手段）');
has(noticeComp, '@Prop kind: string', 'kind 是 @Prop（会变的值 ⇒ 真组件通道）');
// (B6) 零动画：静态 —— 不与"在飞主高亮源"争抢（§8 的同一语言）
hasNot(noticeComp, 'animateTo(', '空态提示无动效（静态）');
hasNot(noticeComp, 'setInterval(', '空态提示无定时器');
// (B7) 基类成员名黑名单（10505001）
const banned: string[] = ['size', 'width', 'height', 'position', 'offset', 'scale', 'rotate',
  'opacity', 'visibility', 'clip', 'zIndex', 'id', 'key', 'enabled'];
for (let i = 0; i < banned.length; i++) {
  hasNot(noticeComp, `@Prop ${banned[i]}:`, `基类成员名黑名单：${banned[i]} 未用作 @Prop`);
}

if (fail > 0) {
  console.log(`  empty_notice: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  empty_notice: ${pass} passed, 0 failed`);
process.exit(0);
