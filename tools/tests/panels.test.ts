/** 面板纯逻辑测试（时间/时长/状态图标算错会误导用户）。 */
declare const process: { exit: (c: number) => void };

import {
  bgTaskLine, countText, cronLine, durationText, fmtHHMM, runnerLine, scheduleText, statusIcon,
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

eq('运行中图标', statusIcon('running'), '▶');
eq('排队图标', statusIcon('pending'), '▶');
eq('完成图标', statusIcon('done'), '✓');
eq('失败图标', statusIcon('failed'), '✗');
eq('终止图标', statusIcon('killed'), '✗');
eq('未知状态', statusIcon('weird'), '·');

const t0 = new Date(2026, 8, 1, 9, 0, 0).getTime();
eq('秒级时长', durationText(new Date(t0).toISOString(), undefined, t0 + 12000), '12s');
eq('分秒时长', durationText(new Date(t0).toISOString(), undefined, t0 + 80000), '1m20s');
eq('已结束用 finished_at', durationText(new Date(t0).toISOString(),
  new Date(t0 + 45000).toISOString(), t0 + 999000), '45s');
eq('缺 started_at', durationText(undefined, undefined, t0), '');
eq('负数按 0', durationText(new Date(t0).toISOString(), undefined, t0 - 5000), '0s');

eq('后台任务行', bgTaskLine({ id: '3f8f', command: 'go test ./...', status: 'running',
  started_at: new Date(t0).toISOString() }, t0 + 12000), '▶ go test ./... · 12s（3f8f）');
eq('失败任务带 exit', bgTaskLine({ id: 'a1', command: 'ls', status: 'failed', exit_code: 2 }, 0),
  '✗ ls · exit 2（a1）');

eq('失败任务无 started_at 不含时长', bgTaskLine({ id: 'a1', command: 'ls', status: 'failed', exit_code: 2 }, 0), '✗ ls · exit 2（a1）');

eq('在线 runner', runnerLine({ name: 'gpu-1', mode: 'ssh', online: true, version: '1.2',
  workspace: '/root/w' }), '🟢 gpu-1 · ssh · v1.2 · /root/w');
eq('离线 runner 默认 native', runnerLine({ name: 'r2', online: false }), '⚪ r2 · native');
eq('未命名 runner', runnerLine({ online: true }), '🟢 (未命名) · native');

function subRow(chatId: string, label: string, running: boolean): SubAgentRow {
  const r = new SubAgentRow();
  r.chat_id = chatId; r.label = label; r.running = running;
  return r;
}
eq('子代理运行中', subagentLine(subRow('x', 'tester-1', true)), '▶ tester-1');
eq('子代理完成回落 chat_id', subagentLine(subRow('sub-9', '', false)), '✓ sub-9');

eq('计数 0', countText(0), '0');
eq('计数 12', countText(12), '12');

if (fail > 0) { console.log(`  panels: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  panels: ${pass} passed, 0 failed`);
process.exit(0);
