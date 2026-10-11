/**
 * 注入型「假工具」（Synthetic / Interrupt 卡）**判据**门禁 —— 守护 `core/synthhints.ets`。
 *
 * 判别力核心：
 *  · 8 个 web 真名 + `bg_subagent_` 前缀族 ⇒ 识别为假工具；**真工具名（Shell/Read…）⇒ 不误判**；
 *  · `syntheticForm`：**专用 3 种**（bg_task/subagent/interrupt）+ **其余全部（含未知）⇒ FORM_GENERIC**；
 *  · `syntheticRoleOf`：每个 role 必须在 **5 套色板**都合法（非 transparent，否则不可见）；
 *  · `parseSyntheticHints` / kind 优先级 / subject / body / status / duration 边界。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  DEDICATED_KINDS, FORM_BG_TASK, FORM_GENERIC, FORM_INTERRUPT, FORM_SUBAGENT, KIND_ASYNC,
  KIND_BG_TASK, KIND_CANCEL, KIND_CRON, KIND_DELIVERED, KIND_INTERRUPT, KIND_LOOP,
  KIND_PRE_TURN_END, KIND_SUBAGENT, SYNTHETIC_TOOL_NAMES, SyntheticHints, formatDuration,
  inferSyntheticKind, isDedicatedForm, isSyntheticToolName, parseSyntheticHints, syntheticBodyOf,
  syntheticContinuityOf, syntheticForm, syntheticKindOf, syntheticRoleOf, syntheticShortOf,
  syntheticStatusOf, syntheticStatusRoleOf, syntheticSubject, syntheticTitleOf,
} from '../../entry/src/main/ets/core/synthhints';
import { ALL_THEMES, Palette, paletteOf } from '../../entry/src/main/ets/core/theme';
import { colorOf } from '../../entry/src/main/ets/core/design';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 名字判定：8 真名 + bg_subagent_ 前缀族；真工具不误判 ──────────────────────
eq('SYNTHETIC_TOOL_NAMES 长度 = 8', SYNTHETIC_TOOL_NAMES.length, 8);
const REAL_NAMES: string[] = ['Shell', 'Read', 'FileReplace', 'Grep', 'Glob', 'TodoWrite', 'background', 'user'];
for (const n of SYNTHETIC_TOOL_NAMES) { eq(`isSyntheticToolName(${n})`, isSyntheticToolName(n), true); }
eq('bg_subagent_ 前缀（非精确名）', isSyntheticToolName('bg_subagent_explore'), true);
eq('bg_subagent_ 前缀（带实例）', isSyntheticToolName('bg_subagent_explore/mem-1'), true);
for (const n of REAL_NAMES) { eq(`真工具 ${n} ⇒ 不误判`, isSyntheticToolName(n), false); }
eq('空名 ⇒ 不误判', isSyntheticToolName(''), false);

// ── 名称 ⇒ kind（web inferSyntheticKind 逐条）───────────────────────────────
eq('background_task_result ⇒ bg_task', inferSyntheticKind('background_task_result'), KIND_BG_TASK);
eq('cron_fired ⇒ cron', inferSyntheticKind('cron_fired'), KIND_CRON);
eq('async_message ⇒ async', inferSyntheticKind('async_message'), KIND_ASYNC);
eq('delivered_message ⇒ delivered', inferSyntheticKind('delivered_message'), KIND_DELIVERED);
eq('user_cancelled ⇒ cancel', inferSyntheticKind('user_cancelled'), KIND_CANCEL);
eq('loop_detected ⇒ loop', inferSyntheticKind('loop_detected'), KIND_LOOP);
eq('pre_turn_end ⇒ pre_turn_end', inferSyntheticKind('pre_turn_end'), KIND_PRE_TURN_END);
eq('user_interrupt ⇒ interrupt', inferSyntheticKind('user_interrupt'), KIND_INTERRUPT);
eq('bg_subagent_x ⇒ subagent', inferSyntheticKind('bg_subagent_x'), KIND_SUBAGENT);

// ── parseSyntheticHints：合法/非法/kwargs ───────────────────────────────────
eq('空串 ⇒ null', parseSyntheticHints(''), null);
eq('非对象（以 [ 开头）⇒ null', parseSyntheticHints('[1,2]'), null);
eq('非法 JSON ⇒ null', parseSyntheticHints('{not json'), null);
eq('纯文本（旧行）⇒ null', parseSyntheticHints('some legacy text'), null);
{
  const h: SyntheticHints | null = parseSyntheticHints(
    '{"kind":"subagent","role":"explore","instance":"mem-1","status":"done","exit_code":0,'
    + '"elapsed_ms":1500,"task":"do x","output":"ok","message":"m","error":"e","task_id":"t1"}');
  eq('解析 kind', h !== null ? h.kind : '', 'subagent');
  eq('解析 role/instance', h !== null ? `${h.role}/${h.instance}` : '', 'explore/mem-1');
  eq('解析 status', h !== null ? h.status : '', 'done');
  eq('解析 hasExit/exitCode', h !== null ? [h.hasExit, h.exitCode] : [], [true, 0]);
  eq('解析 elapsedMs', h !== null ? h.elapsedMs : -1, 1500);
  eq('解析 output/error/task', h !== null ? [h.output, h.error, h.task] : [], ['ok', 'e', 'do x']);
  eq('缺字段 ⇒ 空串（不崩）', parseSyntheticHints('{"kind":"bg_task"}') !== null
    ? [parseSyntheticHints('{"kind":"bg_task"}')!.hasExit,
       parseSyntheticHints('{"kind":"bg_task"}')!.elapsedMs] : [], [false, 0]);
}

// ── kind 优先级：hints.kind 覆盖名称推断 ────────────────────────────────────
eq('hints.kind 优先于名称', syntheticKindOf('background_task_result', '{"kind":"subagent"}'), KIND_SUBAGENT);
eq('hints 无 kind ⇒ 回落名称', syntheticKindOf('cron_fired', '{"task":"x"}'), KIND_CRON);
eq('hints 为旧文本 ⇒ 回落名称', syntheticKindOf('user_interrupt', 'legacy'), KIND_INTERRUPT);

// ── 形态：专用 3 + 其余/未知 ⇒ 通用（判别力核心）──────────────────────────────
eq('DEDICATED_KINDS = 3', DEDICATED_KINDS.length, 3);
eq('bg_task ⇒ 专用', syntheticForm(KIND_BG_TASK), FORM_BG_TASK);
eq('subagent ⇒ 专用', syntheticForm(KIND_SUBAGENT), FORM_SUBAGENT);
eq('interrupt ⇒ 专用', syntheticForm(KIND_INTERRUPT), FORM_INTERRUPT);
for (const k of [KIND_CRON, KIND_ASYNC, KIND_DELIVERED, KIND_CANCEL, KIND_LOOP, KIND_PRE_TURN_END]) {
  eq(`${k} ⇒ 通用`, syntheticForm(k), FORM_GENERIC);
}
eq('未知 kind ⇒ 通用（不崩）', syntheticForm('totally_unknown_xyz'), FORM_GENERIC);
eq('空 kind ⇒ 通用（不崩）', syntheticForm(''), FORM_GENERIC);
eq('isDedicatedForm(bg_task)', isDedicatedForm(FORM_BG_TASK), true);
eq('isDedicatedForm(generic)', isDedicatedForm(FORM_GENERIC), false);

// ── 取色 role：每个 role 必须在 5 套色板都合法（非 transparent，否则不可见）──────
{
  const kinds: string[] = DEDICATED_KINDS.concat([KIND_CRON, KIND_ASYNC, KIND_DELIVERED, KIND_CANCEL,
    KIND_LOOP, KIND_PRE_TURN_END, 'unknown_x']);
  const bad: string[] = [];
  for (const theme of ALL_THEMES) {
    const p: Palette = paletteOf(theme);
    for (const k of kinds) {
      if (colorOf(p, syntheticRoleOf(k)) === p.transparent) { bad.push(`${theme}:${k}`); }
    }
    for (const st of ['done', 'error', 'killed', 'cancelled', 'running']) {
      const role: string = syntheticStatusRoleOf(st);
      if (role.length > 0 && colorOf(p, role) === p.transparent) { bad.push(`${theme}:status:${st}`); }
    }
  }
  eq('所有 kind/状态 role 在 5 套色板都合法', bad, []);
}
// 专用 kinds 主色两两不同（否则"颜色语义"名存实亡）
{
  const p: Palette = paletteOf('dark');
  const cols: string[] = DEDICATED_KINDS.map((k: string): string => colorOf(p, syntheticRoleOf(k)));
  eq('专用 3 种主色两两不同', new Set(cols).size, 3);
}
eq('interrupt 状态色 cancelled ⇒ textMuted', syntheticStatusRoleOf('cancelled'), 'textMuted');

// ── 文案：已知 kind 非空且未知 ⇒ 中性 ────────────────────────────────────────
for (const k of DEDICATED_KINDS.concat([KIND_CRON, KIND_ASYNC, KIND_DELIVERED, KIND_CANCEL, KIND_LOOP, KIND_PRE_TURN_END])) {
  eq(`${k} 标题非空`, syntheticTitleOf(k).length > 0, true);
  eq(`${k} 短名非空`, syntheticShortOf(k).length > 0, true);
  eq(`${k} 承接说明非空`, syntheticContinuityOf(k).length > 0, true);
}
eq('未知 kind 标题 ⇒ 系统通知', syntheticTitleOf('mystery'), '系统通知');
eq('未知 kind 承接 ⇒ 中性', syntheticContinuityOf('mystery').length > 0, true);
eq('bg_task 标题逐字', syntheticTitleOf(KIND_BG_TASK), '后台任务已完成');
eq('interrupt 标题逐字', syntheticTitleOf(KIND_INTERRUPT), '收到用户插话');

// ── subject：role/instance > task_id > label；interrupt 恒空 ──────────────────
eq('subject 取 role/instance', syntheticSubject('bg_subagent_explore', parseSyntheticHints('{"role":"explore","instance":"mem-1"}'), ''), 'explore/mem-1');
eq('subject 取 role（无 instance）', syntheticSubject('bg_subagent_explore', parseSyntheticHints('{"role":"explore"}'), ''), 'explore');
eq('subject 取 task_id', syntheticSubject('background_task_result', parseSyntheticHints('{"task_id":"t9"}'), ''), 't9');
eq('subject=interrupt 恒空', syntheticSubject('user_interrupt', parseSyntheticHints('{"message":"hi"}'), '💬 插话'), '');
eq('subject 从 label 冒号后取', syntheticSubject('bg_subagent_x', null, 'bgsub:explore/mem-1'), 'explore/mem-1');
eq('subject 剥前导 emoji', syntheticSubject('bg_subagent_x', null, '子代理： task/1'), 'task/1');
eq('subject 无内容 ⇒ 空', syntheticSubject('background_task_result', null, ''), '');

// ── body：output > message > detail > summary ───────────────────────────────
eq('body 取 output', syntheticBodyOf(parseSyntheticHints('{"output":"O","message":"M"}'), 'd', 's'), 'O');
eq('body 回落 message', syntheticBodyOf(parseSyntheticHints('{"message":"M"}'), 'd', 's'), 'M');
eq('body 回落 detail', syntheticBodyOf(null, 'd', 's'), 'd');
eq('body 回落 summary', syntheticBodyOf(null, '', 's'), 's');
eq('body 全空 ⇒ 空', syntheticBodyOf(null, '', ''), '');

// ── 状态文案 / 时长 ─────────────────────────────────────────────────────────
eq('status done ⇒ 完成', syntheticStatusOf('done'), '完成');
eq('status error ⇒ 失败', syntheticStatusOf('error'), '失败');
eq('status 空 ⇒ 空', syntheticStatusOf(''), '');
eq('duration 0 ⇒ 空', formatDuration(0), '');
eq('duration 800 ⇒ 800ms', formatDuration(800), '800ms');
eq('duration 1500 ⇒ 1.5s', formatDuration(1500), '1.5s');
eq('duration 65000 ⇒ 1m 5s', formatDuration(65000), '1m 5s');

console.log(`  synthhints: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
