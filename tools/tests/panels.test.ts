/** 面板纯逻辑测试（时间/时长/状态图标算错会误导用户）。 */
declare const process: { exit: (c: number) => void };

import {
  bgTaskMetaText, bgTaskOutputText, bgTaskPrimary, bgTaskRunning, bgTaskStatusText, bgTaskSubText,
  bgTaskTone, cmdOneLine, countText, cronPrimary, cronSubText,
  queueListHeight, QUEUE_LIST_MIN_H, QUEUE_LIST_MAX_H, QUEUE_ROW_H,
  durationText, fmtHHMM, KillBgTaskParams, runnerPrimary, runnerSubText, runnerTone, scheduleText,
  SubAgentRow, subagentPrimary, subagentSubText, subagentTone,
  TONE_ERROR, TONE_MUTED, TONE_SUCCESS,
} from '../../entry/src/main/ets/core/panels';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

eq('cron 表达式优先', scheduleText({ cron_expr: '0 9 * * *', every_seconds: 30 }), '0 9 * * *');
eq('每 N 秒', scheduleText({ every_seconds: 30 }), '每 30 秒');
eq('延迟 N 秒', scheduleText({ delay_seconds: 60 }), '60 秒后');
eq('都没设', scheduleText({}), '未设置');

eq('无效 ISO 原样', fmtHHMM('not-a-date'), 'not-a-date');
eq('空 ISO', fmtHHMM(undefined), '');
const iso = new Date(2026, 8, 1, 9, 5, 0).toISOString();
eq('本地 HH:MM', fmtHHMM(iso), '09:05');

// ── 结构化行（主行 / 副行 / tone）—— 批次10（2026-10-12，「任务管理做的很差」）────────
// 真判别点：长命令**不得**吃掉状态/时长（旧 `bgTaskLine` 单行 ⇒ 元信息被 maxLines 截掉）。
eq('cron 主行 = 消息', cronPrimary({ one_shot: true, cron_expr: '0 9 * * *', message: '检查', next_run: iso }), '检查');
eq('cron 主行缺消息回落调度', cronPrimary({ every_seconds: 30 }), '每 30 秒');
eq('cron 副行 = 一次性+调度+下次', cronSubText({ one_shot: true, cron_expr: '0 9 * * *', message: '检查', next_run: iso }),
  '一次性 · 0 9 * * * · 下次 09:05');
eq('cron 副行无一次性标记', cronSubText({ every_seconds: 30, message: '轮询' }), '每 30 秒');

const t0 = new Date(2026, 8, 1, 9, 0, 0).getTime();
eq('秒级时长', durationText(new Date(t0).toISOString(), undefined, t0 + 12000), '12s');
eq('分秒时长', durationText(new Date(t0).toISOString(), undefined, t0 + 80000), '1m20s');
eq('已结束用 finished_at', durationText(new Date(t0).toISOString(),
  new Date(t0 + 45000).toISOString(), t0 + 999000), '45s');
eq('缺 started_at', durationText(undefined, undefined, t0), '');
eq('负数按 0', durationText(new Date(t0).toISOString(), undefined, t0 - 5000), '0s');

// 主行 = 纯命令（无前缀、无元信息）——真机 62 条任务曾被「完成 <命令…>」一锅端
eq('后台主行 = 命令', bgTaskPrimary({ id: '3f8f', command: 'go test ./...', status: 'running' }), 'go test ./...');
eq('后台主行缺命令回落 id', bgTaskPrimary({ id: '3f8f' }), '3f8f');
eq('后台主行去空白', bgTaskPrimary({ id: 'x', command: '  ls  ' }), 'ls');
// 副行 = 状态短语 + 元信息（判据同源于 bgTaskStatusText/bgTaskMetaText）
eq('后台副行 运行中+时长+id', bgTaskSubText({ id: '3f8f', command: 'go test ./...', status: 'running',
  started_at: new Date(t0).toISOString() }, t0 + 12000), '运行中 · 12s · 3f8f');
eq('后台副行 失败带 exit', bgTaskSubText({ id: 'a1', command: 'ls', status: 'failed', exit_code: 2 }, 0),
  '失败 · exit 2 · a1');
eq('后台副行 失败并入 error 首行', bgTaskSubText({ id: 'b2', command: 'ls', status: 'failed', exit_code: 1,
  error: 'boom\nmore' }, 0), '失败 · exit 1 · b2 · boom');
eq('后台副行 成功**不**并入 error', bgTaskSubText({ id: 'c3', command: 'ls', status: 'done', exit_code: 0,
  error: 'stale' }, 0), '完成 · exit 0 · c3');
// tone：运行中 ⇒ success；失败 ⇒ error；完成 ⇒ muted（⛔ killed 不是 error —— 用户主动终止）
eq('tone 运行中', bgTaskTone({ status: 'running' }), TONE_SUCCESS);
eq('tone 失败', bgTaskTone({ status: 'failed', exit_code: 2 }), TONE_ERROR);
eq('tone done+exit0', bgTaskTone({ status: 'done', exit_code: 0 }), TONE_MUTED);
eq('tone killed 非 error', bgTaskTone({ status: 'killed', exit_code: 130 }), TONE_MUTED);
eq('tone 无 status', bgTaskTone({}), TONE_MUTED);

// ── 后台任务**详情**（2026-10-12「任务管理做的很差」的判据）──────────────────────
eq('running 判运行中', bgTaskRunning({ status: 'running' }), true);
eq('started 判运行中', bgTaskRunning({ status: 'started' }), true);
eq('RUNNING 大写也认', bgTaskRunning({ status: 'RUNNING' }), true);
eq('done 不运行', bgTaskRunning({ status: 'done' }), false);
eq('无 status 不运行', bgTaskRunning({}), false);

eq('运行中短语', bgTaskStatusText({ status: 'running' }), '运行中');
eq('完成短语', bgTaskStatusText({ status: 'done', exit_code: 0 }), '完成');
eq('failed 短语', bgTaskStatusText({ status: 'failed', exit_code: 2 }), '失败');
eq('error 短语', bgTaskStatusText({ status: 'error' }), '失败');
// ⭐ 真判别：被杀的进程 exit 130 ⇒ 若先问 toolStatusKind 会返回 ST_ERROR 而误报「失败」；
//    "用户主动终止" 必须抢在 exit_code 之前判 —— 这条错了用户会以为任务崩了。
eq('killed 抢在 exit 之前', bgTaskStatusText({ status: 'killed', exit_code: 130 }), '已终止');
eq('cancelled 同 killed', bgTaskStatusText({ status: 'cancelled', exit_code: 1 }), '已终止');
eq('done 但 exit 非 0 ⇒ 失败', bgTaskStatusText({ status: 'done', exit_code: 1 }), '失败');

eq('副行 exit+时长+id', bgTaskMetaText({ id: '3f8f', status: 'done', exit_code: 0,
  started_at: '2026-09-01T09:00:00Z', finished_at: '2026-09-01T09:00:03Z' }, Date.parse('2026-09-01T09:00:09Z')),
  'exit 0 · 3s · 3f8f');
eq('副行无 exit_code 只有 id', bgTaskMetaText({ id: 'a1' }, 0), 'a1');
eq('副行全空', bgTaskMetaText({}, 0), '');

eq('输出优先', bgTaskOutputText({ output: 'hi', error: 'boom' }), 'hi\nboom');
eq('只有 error', bgTaskOutputText({ error: 'boom' }), 'boom');
eq('只有 output', bgTaskOutputText({ output: 'hi' }), 'hi');
eq('全空', bgTaskOutputText({}), '');
// ⭐ error 已在 output 里时不重复拼（服务端 CurrentOutput 常把 stderr 并进 output）
eq('error 已含在 output 里不重复', bgTaskOutputText({ output: 'x\nboom', error: 'boom' }), 'x\nboom');

const kp = new KillBgTaskParams('t-1');
eq('kill 参数名是 task_id', kp.task_id, 't-1');

eq('runner 主行 = 名字', runnerPrimary({ name: 'gpu-1', online: true }), 'gpu-1');
eq('runner 主行缺名', runnerPrimary({ online: true }), '(未命名)');
eq('runner 副行 在线+mode+版本+workspace', runnerSubText({ name: 'gpu-1', mode: 'ssh', online: true, version: '1.2',
  workspace: '/root/w' }), '在线 · ssh · v1.2 · /root/w');
eq('runner 副行 离线默认 native', runnerSubText({ name: 'r2', online: false }), '离线 · native');
eq('runner tone 在线', runnerTone({ online: true }), TONE_SUCCESS);
eq('runner tone 离线', runnerTone({ online: false }), TONE_MUTED);

function subRow(chatId: string, label: string, running: boolean): SubAgentRow {
  const r = new SubAgentRow();
  r.chat_id = chatId; r.label = label; r.running = running;
  return r;
}
eq('子代理主行 = label', subagentPrimary(subRow('x', 'tester-1', true)), 'tester-1');
eq('子代理主行回落 chat_id', subagentPrimary(subRow('sub-9', '', false)), 'sub-9');
eq('子代理副行 运行中', subagentSubText(subRow('x', 'tester-1', true)), '运行中');
eq('子代理副行 完成', subagentSubText(subRow('x', 'tester-1', false)), '完成');
eq('子代理 tone 运行中', subagentTone(subRow('x', 't', true)), TONE_SUCCESS);
eq('子代理 tone 完成', subagentTone(subRow('x', 't', false)), TONE_MUTED);

// ── tone 常量真源（组件`PanelRows` 与 core 必须同字面量；写错 ⇒ 副行静默落 muted）────
eq('TONE_SUCCESS 字面量', TONE_SUCCESS, 'success');
eq('TONE_ERROR 字面量', TONE_ERROR, 'error');
eq('TONE_MUTED 字面量', TONE_MUTED, 'muted');

eq('计数 0', countText(0), '0');
eq('计数 12', countText(12), '12');

// ── `cmdOneLine`：命令 → 单行显示串（2026-10-12；用户点名「任务管理做的很差」）──────────────
// 真机取证：后台任务列表主行整行 `K=~/.ssh/b300_spot.pem\nssh -i $K ubuntu@...'set -e\ncd ~/cann\n…`
//   —— 服务端 `command` 里是**字面 `\n`**（反斜杠 + n）⇒ `.maxLines(1)` 也照旧把转义噪声显示出来。
// 判别力：把任一条改回「原样 trim」⇒ 对应断言红（下面的 want 里都不含 `\n`）。
eq('cmdOneLine：字面 \\n → 空格', cmdOneLine('a\\nb'), 'a b');
eq('cmdOneLine：真实换行 → 空格', cmdOneLine('a\nb'), 'a b');
eq('cmdOneLine：字面 \\t 与制表 → 空格', cmdOneLine('a\\tb\tc'), 'a b c');
eq('cmdOneLine：连续空白折叠为 1', cmdOneLine('a   \\n  b'), 'a b');
eq('cmdOneLine：首尾去白', cmdOneLine('  a b  '), 'a b');
eq('cmdOneLine：空串', cmdOneLine(''), '');
eq('cmdOneLine：单行原样', cmdOneLine('ls -la'), 'ls -la');
eq('bgTaskPrimary 走单行归一化', bgTaskPrimary({ command: 'x\\ny' }), 'x y');
eq('cronPrimary 走单行归一化', cronPrimary({ every_seconds: 30, message: 'a\\nb' }), 'a b');

// ── `queueListHeight`：待发队列列表高（内容自适应 + 上下限）（2026-10-12）──────────────────────
// 病根：`QueueSheet` 的 List 曾**硬编码 `.height(300)`** ⇒ 队列长时靠后的行看不到；1 条时留一大块空白。
// 判别力：把实现改回"恒 300"（或去掉 clamp）⇒ 下面 5 条里至少 3 条红。
eq('queue 0 条 ⇒ 下限', queueListHeight(0), QUEUE_LIST_MIN_H);
eq('queue 负值 ⇒ 下限（防御）', queueListHeight(-3), QUEUE_LIST_MIN_H);
eq('queue 1 条 ⇒ 一行高（< 下限时取下限）', queueListHeight(1), QUEUE_LIST_MIN_H);
eq('queue 2 条 ⇒ 两行高（已超下限）', queueListHeight(2), 2 * QUEUE_ROW_H);
eq('queue 100 条 ⇒ 上限封顶', queueListHeight(100), QUEUE_LIST_MAX_H);
eq('queue 上限 < 100 行（确有封顶）', QUEUE_LIST_MAX_H < 100 * QUEUE_ROW_H, true);
eq('queue 行高 = 44 命中盒 + 2×8 内边距 + 6 行距', QUEUE_ROW_H, 44 + 16 + 6);
eq('queue 非整数按 floor', queueListHeight(2.9), 2 * QUEUE_ROW_H);

if (fail > 0) { console.log(`  panels: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  panels: ${pass} passed, 0 failed`);
process.exit(0);
