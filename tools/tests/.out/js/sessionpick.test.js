"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sessionpick_1 = require("./sessionpick");
let pass = 0, fail = 0;
function ok(name, cond) {
    if (cond) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}`);
    }
}
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
const sessions = [
    { chat_id: 'chat_AAA', channel: 'web', label: 'web 会话' },
    { chat_id: 'oc_58ca927a', channel: 'feishu', label: '我' },
    { chat_id: 'ou_b90fbcfd', channel: 'feishu', label: '飞书私聊' },
    { chat_id: 'chat_NOCH' }, // 缺 channel 字段
    { chat_id: 'chat_EMPTY', channel: '' }, // 空 channel
];
// ① 核心：飞书会话必须解析成 feishu（旧实现恒返回 'web' ⇒ 本组全红）
eq('web 会话 → web', (0, sessionpick_1.channelForChat)(sessions, 'chat_AAA'), 'web');
eq('飞书群会话 → feishu', (0, sessionpick_1.channelForChat)(sessions, 'oc_58ca927a'), 'feishu');
eq('飞书私聊 → feishu', (0, sessionpick_1.channelForChat)(sessions, 'ou_b90fbcfd'), 'feishu');
eq('缺 channel 字段 → 回落 web', (0, sessionpick_1.channelForChat)(sessions, 'chat_NOCH'), 'web');
eq('空 channel → 回落 web', (0, sessionpick_1.channelForChat)(sessions, 'chat_EMPTY'), 'web');
eq('未知会话 → 回落 web', (0, sessionpick_1.channelForChat)(sessions, 'chat_UNKNOWN'), 'web');
eq('默认渠道常量 = web', sessionpick_1.DEFAULT_CHANNEL, 'web');
// ② 渠道展示名（抽屉里标注来源）
eq('web 标签', (0, sessionpick_1.channelLabel)('web'), 'Web');
eq('feishu 标签', (0, sessionpick_1.channelLabel)('feishu'), '飞书');
eq('cli 标签', (0, sessionpick_1.channelLabel)('cli'), 'CLI');
eq('未知渠道原样显示', (0, sessionpick_1.channelLabel)('telegram'), 'telegram');
eq('空渠道不显示空串', (0, sessionpick_1.channelLabel)(''), '未知');
// ③ 行窗口（避免 List+ForEach 一次性构建全部行）
ok('上限常量 >0', sessionpick_1.MAX_ROWS_VISIBLE > 0);
eq('行不足时限 = 全部', (0, sessionpick_1.visibleRows)([1, 2, 3], 12).length, 3);
eq('超限时取末尾 N 行', (0, sessionpick_1.visibleRows)([1, 2, 3, 4, 5], 3), [3, 4, 5]);
eq('limit=0 视为不限制', (0, sessionpick_1.visibleRows)([1, 2, 3], 0).length, 3);
eq('被挡住的条数', (0, sessionpick_1.hiddenRowCount)(30, 12), 18);
eq('未超限时隐藏 0 条', (0, sessionpick_1.hiddenRowCount)(5, 12), 0);
eq('limit=0 时隐藏 0 条', (0, sessionpick_1.hiddenRowCount)(30, 0), 0);
eq('恰好相等时隐藏 0 条', (0, sessionpick_1.hiddenRowCount)(12, 12), 0);
if (fail > 0) {
    console.log(`  sessionpick: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  sessionpick: ${pass} passed, 0 failed`);
process.exit(0);
