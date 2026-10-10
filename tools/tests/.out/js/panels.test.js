"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const panels_1 = require("./panels");
let pass = 0, fail = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
    }
}
eq('cron 表达式优先', (0, panels_1.scheduleText)({ cron_expr: '0 9 * * *', every_seconds: 30 }), '0 9 * * *');
eq('每 N 秒', (0, panels_1.scheduleText)({ every_seconds: 30 }), '每 30 秒');
eq('延迟 N 秒', (0, panels_1.scheduleText)({ delay_seconds: 60 }), '60 秒后');
eq('都没设', (0, panels_1.scheduleText)({}), '未设置');
eq('无效 ISO 原样', (0, panels_1.fmtHHMM)('not-a-date'), 'not-a-date');
eq('空 ISO', (0, panels_1.fmtHHMM)(undefined), '');
const iso = new Date(2026, 8, 1, 9, 5, 0).toISOString();
eq('本地 HH:MM', (0, panels_1.fmtHHMM)(iso), '09:05');
eq('一次性标记', (0, panels_1.cronLine)({ one_shot: true, cron_expr: '0 9 * * *', message: '检查', next_run: iso }), '一次性 · 0 9 * * * · 检查 · 下次 09:05');
eq('周期任务无标记', (0, panels_1.cronLine)({ every_seconds: 30, message: '轮询' }), '每 30 秒 · 轮询');
eq('运行中图标', (0, panels_1.statusIcon)('running'), '▶');
eq('排队图标', (0, panels_1.statusIcon)('pending'), '▶');
eq('完成图标', (0, panels_1.statusIcon)('done'), '✓');
eq('失败图标', (0, panels_1.statusIcon)('failed'), '✗');
eq('终止图标', (0, panels_1.statusIcon)('killed'), '✗');
eq('未知状态', (0, panels_1.statusIcon)('weird'), '·');
const t0 = new Date(2026, 8, 1, 9, 0, 0).getTime();
eq('秒级时长', (0, panels_1.durationText)(new Date(t0).toISOString(), undefined, t0 + 12000), '12s');
eq('分秒时长', (0, panels_1.durationText)(new Date(t0).toISOString(), undefined, t0 + 80000), '1m20s');
eq('已结束用 finished_at', (0, panels_1.durationText)(new Date(t0).toISOString(), new Date(t0 + 45000).toISOString(), t0 + 999000), '45s');
eq('缺 started_at', (0, panels_1.durationText)(undefined, undefined, t0), '');
eq('负数按 0', (0, panels_1.durationText)(new Date(t0).toISOString(), undefined, t0 - 5000), '0s');
eq('后台任务行', (0, panels_1.bgTaskLine)({ id: '3f8f', command: 'go test ./...', status: 'running',
    started_at: new Date(t0).toISOString() }, t0 + 12000), '▶ go test ./... · 12s（3f8f）');
eq('失败任务带 exit', (0, panels_1.bgTaskLine)({ id: 'a1', command: 'ls', status: 'failed', exit_code: 2 }, 0), '✗ ls · exit 2（a1）');
eq('失败任务无 started_at 不含时长', (0, panels_1.bgTaskLine)({ id: 'a1', command: 'ls', status: 'failed', exit_code: 2 }, 0), '✗ ls · exit 2（a1）');
eq('在线 runner', (0, panels_1.runnerLine)({ name: 'gpu-1', mode: 'ssh', online: true, version: '1.2',
    workspace: '/root/w' }), '🟢 gpu-1 · ssh · v1.2 · /root/w');
eq('离线 runner 默认 native', (0, panels_1.runnerLine)({ name: 'r2', online: false }), '⚪ r2 · native');
eq('未命名 runner', (0, panels_1.runnerLine)({ online: true }), '🟢 (未命名) · native');
function subRow(chatId, label, running) {
    const r = new panels_1.SubAgentRow();
    r.chat_id = chatId;
    r.label = label;
    r.running = running;
    return r;
}
eq('子代理运行中', (0, panels_1.subagentLine)(subRow('x', 'tester-1', true)), '▶ tester-1');
eq('子代理完成回落 chat_id', (0, panels_1.subagentLine)(subRow('sub-9', '', false)), '✓ sub-9');
eq('计数 0', (0, panels_1.countText)(0), '0');
eq('计数 12', (0, panels_1.countText)(12), '12');
if (fail > 0) {
    console.log(`  panels: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  panels: ${pass} passed, 0 failed`);
process.exit(0);
