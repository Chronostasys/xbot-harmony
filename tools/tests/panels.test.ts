/** 面板纯逻辑测试（时间/时长/状态图标算错会误导用户）。 */
declare const process: { exit: (c: number) => void };

import {
  bgTaskActiveCount, bgTaskLeadCode, bgTaskMetaText, bgTaskOutputText, bgTaskPrimary, bgTaskRunning,
  bgTaskStatusText, bgTaskSubText,
  bgTaskTone, cmdOneLine, countText, cronMessageText, cronPrimary, cronSubText, cronTargetText,
  fmtDateTime, LEAD_FAIL, LEAD_KILLED, LEAD_OK, LEAD_RUNNING, sortBgTasksActiveFirst,
  queueListHeight, QUEUE_LIST_MIN_H, QUEUE_LIST_MAX_H, QUEUE_ROW_H,
  durationText, fmtHHMM, KillBgTaskParams, runnerPrimary, runnerSubText, runnerTone, scheduleText,
  SubAgentRow, subagentPrimary, subagentSubText, subagentTone,
  PANEL_POLL_ACTIVE_MS, PANEL_POLL_IDLE_MS, panelPollMs,
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
// `at`（一次性绝对时间）—— 2026-10-13 装机实测发现的缺口：agent 用绝对时间建的任务此前显示「未设置」。
// ⚠️ 优先级与 web `TasksPanel.tsx:137-146` 逐字一致：`cron_expr → every_seconds → at → delay_seconds`。
eq('绝对时间 at（本地化）', scheduleText({ at: new Date(2027, 0, 1, 9, 0, 0).toISOString() }),
  '2027-01-01 09:00 触发');
eq('at 优先于 delay_seconds（同 web 顺序）',
  scheduleText({ at: new Date(2027, 0, 1, 9, 0, 0).toISOString(), delay_seconds: 60 }), '2027-01-01 09:00 触发');
eq('every_seconds 优先于 at', scheduleText({ every_seconds: 30, at: '2027-01-01T09:00:00' }), '每 30 秒');
eq('at 不可解析 ⇒ 原样显示（不丢信息，仍标触发）', scheduleText({ at: '09:00' }), '09:00 触发');
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

// ── 定时任务详情（2026-10-13，目标④ 对标 web `TasksPanel.tsx:120-172` 展开区）───────────────
// 病根：cron 行点按**只复制一行摘要**，而主行是 `.maxLines(1)` ⇒ **多行提示词正文永久不可见**。
// 判别力：㈠ 若 `cronMessageText` 改成复用 `cmdOneLine`（折叠换行）⇒ 下面第 1 条红；
//        ㈡ 若 `fmtDateTime` 退化成 `fmtHHMM`（丢日期）⇒ 第 3 条红；
//        ㈢ 若 `cronTargetText` 只拼 channel 不拼 chat_id ⇒ 第 4 条红。
eq('cron 消息全文保留换行（⛔ 不再单行折叠）', cronMessageText({ message: '第一行\n第二行\n  缩进' }),
  '第一行\n第二行\n  缩进');
eq('cron 消息去首尾空白', cronMessageText({ message: '\n  hi  \n' }), 'hi');
eq('cron 消息缺失 ⇒ 空串', cronMessageText({}), '');

const dt = new Date(2026, 8, 1, 9, 5, 0).toISOString();
eq('fmtDateTime 带日期（本地）', fmtDateTime(dt), '2026-09-01 09:05');
eq('fmtDateTime 空 ⇒ 空串', fmtDateTime(undefined), '');
eq('fmtDateTime 无效 ISO 原样', fmtDateTime('not-a-date'), 'not-a-date');
// ⛔ 判别点：`fmtHHMM` 只给 HH:MM，详情必须带日期（跨天 / 历史任务否则分不清哪天）。
eq('fmtDateTime ≠ fmtHHMM（确有日期信息）', fmtDateTime(dt) !== fmtHHMM(dt), true);

eq('cron 目标 = channel:chat_id', cronTargetText({ channel: 'web', chat_id: 'chat_1' }), 'web:chat_1');
eq('cron 目标缺 chat_id ⇒ 只 channel', cronTargetText({ channel: 'web' }), 'web');
eq('cron 目标缺 channel ⇒ 只 chat_id', cronTargetText({ chat_id: 'chat_1' }), 'chat_1');
eq('cron 目标皆缺 ⇒ 空串（组件渲染 —）', cronTargetText({}), '');

// ── 后台任务·列表层判据（2026-10-13；用户「任务管理做的很差」第二轮）────────────────
// 真机实测：354 条任务一屏平铺 ⇒ 正在跑的混在中段、失败项扫不出来。
// mutation 自证：`bgTaskLeadCode` 漏判 killed（归到 fail）⇒ 「killed ⇒ killed 码」红；
//                `sortBgTasksActiveFirst` 不做两趟（组内乱序/丢失）⇒ 「置顶且保序」红；
//                `bgTaskActiveCount` 改成数全部 ⇒ 「计数 = 运行中数」红。
eq('前导码 running ⇒ running', bgTaskLeadCode({ status: 'running' }), LEAD_RUNNING);
eq('前导码 started ⇒ running（web 口径 started 也算跑）', bgTaskLeadCode({ status: 'started' }), LEAD_RUNNING);
eq('前导码 exit 0 ⇒ ok', bgTaskLeadCode({ status: 'done', exit_code: 0 }), LEAD_OK);
eq('前导码 exit 2 ⇒ fail', bgTaskLeadCode({ status: 'failed', exit_code: 2 }), LEAD_FAIL);
// ⛔ killed 不能算故障（必须与 `bgTaskStatusText`/`bgTaskTone` 同源：exit 130 也不许报红）
eq('前导码 killed ⇒ killed（exit 130 也不许归 fail）',
  bgTaskLeadCode({ status: 'killed', exit_code: 130 }), LEAD_KILLED);
eq('前导码 aborted ⇒ killed', bgTaskLeadCode({ status: 'aborted', exit_code: 130 }), LEAD_KILLED);

const bgL = [
  { id: 'a', status: 'done', exit_code: 0 },
  { id: 'b', status: 'running' },
  { id: 'c', status: 'done', exit_code: 0 },
  { id: 'd', status: 'started' },
  { id: 'e', status: 'failed', exit_code: 1 },
];
eq('排序：运行中置顶、组内保持服务端原次序',
  sortBgTasksActiveFirst(bgL).map((x) => x.id), ['b', 'd', 'a', 'c', 'e']);
eq('排序：无运行中 ⇒ 原序（不动）',
  sortBgTasksActiveFirst([{ id: 'x', status: 'done' }, { id: 'y', status: 'done' }]).map((x) => x.id), ['x', 'y']);
eq('排序：空列表 ⇒ 空', sortBgTasksActiveFirst([]).length, 0);
eq('计数：运行中数（含 started）', bgTaskActiveCount(bgL), 2);
eq('计数：空 ⇒ 0', bgTaskActiveCount([]), 0);

// ── 运行面板自适应轮询周期（批次 2026-10-13，「任务管理做的很差」的可修点）──────────
// 真判别点：**有在跑的东西 ⇒ 2s；否则 30s**（web `useTasks.ts:117-122` + `TasksPanel.tsx:48-54`）。
// ⛔ 旧接线只在「打开/切 tab/手点刷新」取数 ⇒ 面板开着时数据是死的（后台任务跑完不更新）。
// mutation 自证：`panelPollMs` 恒返回 IDLE ⇒ 「running 后台任务 ⇒ 2s」「running 子代理 ⇒ 2s」两条红；
//                在子代理分支漏判 `running === true` ⇒ 「子代理非 running ⇒ 30s」红。
eq('轮询：空 ⇒ 30s', panelPollMs([], []), PANEL_POLL_IDLE_MS);
eq('轮询：全完成的后台任务 ⇒ 30s',
  panelPollMs([{ id: 'a', status: 'done', exit_code: 0 }, { id: 'b', status: 'failed', exit_code: 1 }], []),
  PANEL_POLL_IDLE_MS);
eq('轮询：有 running 后台任务 ⇒ 2s', panelPollMs([{ id: 'a', status: 'running' }], []), PANEL_POLL_ACTIVE_MS);
eq('轮询：started 也算在跑（web 同口径）⇒ 2s', panelPollMs([{ id: 'a', status: 'started' }], []), PANEL_POLL_ACTIVE_MS);
const subIdle = new SubAgentRow();
subIdle.chat_id = 'agent:reviewer/r1';
subIdle.running = false;
const subRun = new SubAgentRow();
subRun.chat_id = 'agent:reviewer/r2';
subRun.running = true;
eq('轮询：无后台任务但子代理在跑 ⇒ 2s', panelPollMs([], [subRun]), PANEL_POLL_ACTIVE_MS);
eq('轮询：子代理都不在跑 ⇒ 30s', panelPollMs([], [subIdle]), PANEL_POLL_IDLE_MS);
eq('轮询：后台+子代理都静息 ⇒ 30s', panelPollMs([{ id: 'a', status: 'done' }], [subIdle]), PANEL_POLL_IDLE_MS);
eq('轮询：两者都在跑 ⇒ 2s（取更快者，不许被静息项压回去）',
  panelPollMs([{ id: 'a', status: 'running' }], [subRun]), PANEL_POLL_ACTIVE_MS);
eq('轮询：常量与 web 字面量一致（2s/30s，⛔ 不许自造周期）',
  [PANEL_POLL_ACTIVE_MS, PANEL_POLL_IDLE_MS], [2000, 30000]);

if (fail > 0) { console.log(`  panels: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  panels: ${pass} passed, 0 failed`);
process.exit(0);
