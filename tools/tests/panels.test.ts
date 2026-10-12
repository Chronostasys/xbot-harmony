/** 面板纯逻辑测试（时间/时长/状态图标算错会误导用户）。 */
declare const process: { exit: (c: number) => void };

import {
  bgTaskLine, bgTaskMetaText, bgTaskOutputText, bgTaskRunning, bgTaskStatusText, countText, cronLine,
  durationText, fmtHHMM, KillBgTaskParams, runnerLine, scheduleText, statusIcon,
  SubAgentRow, subagentLine,
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

eq('一次性标记', cronLine({ one_shot: true, cron_expr: '0 9 * * *', message: '检查', next_run: iso }),
  '一次性 · 0 9 * * * · 检查 · 下次 09:05');
eq('周期任务无标记', cronLine({ every_seconds: 30, message: '轮询' }), '每 30 秒 · 轮询');

eq('运行中标记', statusIcon('running'), '运行中');
eq('排队标记', statusIcon('pending'), '运行中');
eq('完成标记', statusIcon('done'), '完成');
eq('失败标记', statusIcon('failed'), '失败');
eq('终止标记', statusIcon('killed'), '失败');
eq('未知状态', statusIcon('weird'), '·');

const t0 = new Date(2026, 8, 1, 9, 0, 0).getTime();
eq('秒级时长', durationText(new Date(t0).toISOString(), undefined, t0 + 12000), '12s');
eq('分秒时长', durationText(new Date(t0).toISOString(), undefined, t0 + 80000), '1m20s');
eq('已结束用 finished_at', durationText(new Date(t0).toISOString(),
  new Date(t0 + 45000).toISOString(), t0 + 999000), '45s');
eq('缺 started_at', durationText(undefined, undefined, t0), '');
eq('负数按 0', durationText(new Date(t0).toISOString(), undefined, t0 - 5000), '0s');

eq('后台任务行', bgTaskLine({ id: '3f8f', command: 'go test ./...', status: 'running',
  started_at: new Date(t0).toISOString() }, t0 + 12000), '运行中 go test ./... · 12s（3f8f）');
eq('失败任务带 exit', bgTaskLine({ id: 'a1', command: 'ls', status: 'failed', exit_code: 2 }, 0),
  '失败 ls · exit 2（a1）');

eq('失败任务无 started_at 不含时长', bgTaskLine({ id: 'a1', command: 'ls', status: 'failed', exit_code: 2 }, 0), '失败 ls · exit 2（a1）');

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

eq('在线 runner', runnerLine({ name: 'gpu-1', mode: 'ssh', online: true, version: '1.2',
  workspace: '/root/w' }), '在线 gpu-1 · ssh · v1.2 · /root/w');
eq('离线 runner 默认 native', runnerLine({ name: 'r2', online: false }), '离线 r2 · native');
eq('未命名 runner', runnerLine({ online: true }), '在线 (未命名) · native');

function subRow(chatId: string, label: string, running: boolean): SubAgentRow {
  const r = new SubAgentRow();
  r.chat_id = chatId; r.label = label; r.running = running;
  return r;
}
eq('子代理运行中', subagentLine(subRow('x', 'tester-1', true)), '运行中 tester-1');
eq('子代理完成回落 chat_id', subagentLine(subRow('sub-9', '', false)), '完成 sub-9');

eq('计数 0', countText(0), '0');
eq('计数 12', countText(12), '12');

if (fail > 0) { console.log(`  panels: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  panels: ${pass} passed, 0 failed`);
process.exit(0);
