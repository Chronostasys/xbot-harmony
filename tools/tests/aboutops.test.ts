/**
 * About 面破坏性动作（应用内更新 + 重启服务）的**纯逻辑契约测试**。
 *
 * 判别力重点（每条都能被"改回旧行为"的 mutation 弄红）：
 *  1. **更新可用性判定**：必须同时满足 未跳过 + hasUpdate + tag 非空 ——
 *     漏判 `tag` ⇒ 空 tag 直发服务端（`rpc_table.go:1984` 报 "tag is required"）；
 *     漏判 `skipped` ⇒ skipped 时 `hasUpdate` 语义不可信却仍放行更新按钮。
 *  2. **apply 状态机**：`applying` 态**不可**被再触发（防连点重复提交不可撤销的更新 IO）；
 *     `idle→confirming→applying→applied/failed` 全路径 + cancel 归位。
 *  3. **restart 状态机**：`restarting`/`polling` 态**不可**被 `reqRestart` 再触发；
 *     7 态互斥；两次确认（confirming→restarting）与 40s 超时（polling→timedOut）路径。
 *  4. **轮询节奏/超时**：间隔 1500ms、超时 40000ms、flush 1200ms（web `SettingsAbout.tsx:176-196`
 *     逐字）；`pollExceeded` 是**严格大于**（`>`，不是 `>=`）。
 *  5. **失败/超时必须可见**：`restartErrorText` 在 timedOut 给超时文案、failed 给原文、其余空。
 *  6. **release notes 外链**：规范化 + 协议白名单（复用 msgops 的 isOpenableScheme）；
 *     非白名单（javascript:/data:）⇒ 空串（**不渲染不可打开的链接**）。
 *
 * method 名：`apply_update` / `restart_server` 就地定义（core/rpc.ets 本波有主），
 * 用完整性断言把"加了 method 忘登记"钉死。
 */
declare const process: { exit: (c: number) => void };

import {
  ABOUT_ACTION_METHODS, ApplyResultRow, applyBusy, applyButtonLabel, applyReducer, applyShowConfirm,
  applySucceeded, APPLY_APPLIED, APPLY_APPLYING, APPLY_CONFIRMING, APPLY_DONE, APPLY_FAIL, APPLY_FAILED,
  APPLY_IDLE, APPLY_REQ_APPLY, APPLY_REQ_CANCEL, APPLY_REQ_CONFIRM, APPLY_RESET,
  canApplyUpdate, currentToLatestText, isClickableUrl, normalizeReleaseUrl, pollDeadline, pollExceeded,
  releaseNotesUrl, RESTART_FAIL, RESTART_POLL_INTERVAL_MS, RESTART_POLL_OK, RESTART_TIMEOUT_MS,
  RESTART_FLUSH_DELAY_MS, restartBusy, restartErrorText, restartHintText, restartReducer,
  restartShowConfirm, restartSucceeded, restartSucceededText, restartTimedOut, restartTimeoutText,
  RESTART_CONFIRMING, RESTART_FAILED, RESTART_IDLE, RESTART_POLLING, RESTART_REQ_CANCEL, RESTART_REQ_CONFIRM,
  RESTART_REQ_RESTART, RESTART_RESET, RESTART_RESTARTING, RESTART_SENT, RESTART_SUCCEEDED,
  RESTART_TIMED_OUT, RESTART_TIMEOUT, RPC_APPLY_UPDATE, RPC_RESTART_SERVER,
} from '../../entry/src/main/ets/core/aboutops';
import { UpdateCheckRow } from '../../entry/src/main/ets/core/settings';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── ① method 常量（就地定义，待折叠进 core/rpc.ets）────────────────────────────

eq('apply_update method', RPC_APPLY_UPDATE, 'apply_update');
eq('restart_server method', RPC_RESTART_SERVER, 'restart_server');
eq('关于动作 method 清单', ABOUT_ACTION_METHODS, ['apply_update', 'restart_server']);
eq('清单无重复', new Set(ABOUT_ACTION_METHODS).size, ABOUT_ACTION_METHODS.length);

// ── ② 更新可用性判定 canApplyUpdate ───────────────────────────────────────────

eq('canApply：undefined ⇒ false', canApplyUpdate(undefined), false);
eq('canApply：有新版 + tag ⇒ true',
  canApplyUpdate({ hasUpdate: true, tag: 'v1.5.0', latest: '1.5.0' } as UpdateCheckRow), true);
eq('canApply：有新版但 tag 空 ⇒ false（服务端会报 tag is required）',
  canApplyUpdate({ hasUpdate: true, tag: '' } as UpdateCheckRow), false);
eq('canApply：有新版但 tag 缺失 ⇒ false',
  canApplyUpdate({ hasUpdate: true } as UpdateCheckRow), false);
eq('canApply：tag 纯空白 ⇒ false',
  canApplyUpdate({ hasUpdate: true, tag: '   ' } as UpdateCheckRow), false);
eq('canApply：skipped 时即使 hasUpdate=true 也 ⇒ false',
  canApplyUpdate({ skipped: true, hasUpdate: true, tag: 'v9', reason: 'offline' } as UpdateCheckRow), false);
eq('canApply：已最新（hasUpdate=false）⇒ false',
  canApplyUpdate({ hasUpdate: false, tag: 'v1.0.0' } as UpdateCheckRow), false);
// tag 应被 trim 后判定（带空白不应放行到服务端，但非空 tag 应通过）
eq('canApply：tag 非空但带空白 ⇒ true（trim 后非空）',
  canApplyUpdate({ hasUpdate: true, tag: '  v1.5.0  ' } as UpdateCheckRow), true);

// ── ③ apply 状态机 ────────────────────────────────────────────────────────────

eq('apply：初始 idle', APPLY_IDLE, 'idle');
eq('apply：idle + 确认请求 ⇒ confirming', applyReducer(APPLY_IDLE, APPLY_REQ_CONFIRM), APPLY_CONFIRMING);
eq('apply：confirming + 取消 ⇒ idle', applyReducer(APPLY_CONFIRMING, APPLY_REQ_CANCEL), APPLY_IDLE);
eq('apply：confirming + 执行 ⇒ applying', applyReducer(APPLY_CONFIRMING, APPLY_REQ_APPLY), APPLY_APPLYING);
eq('apply：applying + done ⇒ applied', applyReducer(APPLY_APPLYING, APPLY_DONE), APPLY_APPLIED);
eq('apply：applying + fail ⇒ failed', applyReducer(APPLY_APPLYING, APPLY_FAIL), APPLY_FAILED);
// ⛔ 守卫：applying 态连点 reqApply 不改变状态（防重复提交不可撤销更新）
eq('apply：applying + 再点执行 ⇒ 仍 applying（防连点）',
  applyReducer(APPLY_APPLYING, APPLY_REQ_APPLY), APPLY_APPLYING);
// idle 直接执行（跳过确认）无效 —— 必须先确认
eq('apply：idle + 直接执行 ⇒ 仍 idle（必须先确认）',
  applyReducer(APPLY_IDLE, APPLY_REQ_APPLY), APPLY_IDLE);
// reset 从任意态归位
eq('apply：applied + reset ⇒ idle', applyReducer(APPLY_APPLIED, APPLY_RESET), APPLY_IDLE);
eq('apply：failed + reset ⇒ idle', applyReducer(APPLY_FAILED, APPLY_RESET), APPLY_IDLE);
eq('apply：failed + 确认请求 ⇒ confirming（可重试）',
  applyReducer(APPLY_FAILED, APPLY_REQ_CONFIRM), APPLY_CONFIRMING);

ok('applyBusy：仅 applying', applyBusy(APPLY_APPLYING) && !applyBusy(APPLY_CONFIRMING) && !applyBusy(APPLY_IDLE));
ok('applyShowConfirm：仅 confirming',
  applyShowConfirm(APPLY_CONFIRMING) && !applyShowConfirm(APPLY_APPLYING) && !applyShowConfirm(APPLY_IDLE));
ok('applySucceeded：仅 applied',
  applySucceeded(APPLY_APPLIED) && !applySucceeded(APPLY_APPLYING));

// ── ④ apply 文案 ──────────────────────────────────────────────────────────────

eq('apply 按钮：进行中', applyButtonLabel(true, '1.5.0'), '更新中…');
eq('apply 按钮：待更新', applyButtonLabel(false, '1.5.0'), '更新到 1.5.0');
eq('apply 按钮：latest 缺失兜底', applyButtonLabel(false, undefined), '更新到 —');
eq('current→latest', currentToLatestText('1.4.2', '1.5.0'), '1.4.2 → 1.5.0');
eq('current→latest 缺失兜底', currentToLatestText(undefined, undefined), '— → —');

// ApplyResult 结构（编译期契约：字段名与服务端 json tag 对齐，update.go:28-33）
const applied: ApplyResultRow = { newVersion: '1.5.0', tag: 'v1.5.0', components: ['binary', 'web'], warnings: [] };
eq('ApplyResult components', applied.components, ['binary', 'web']);

// ── ⑤ restart 状态机（7 态）───────────────────────────────────────────────────

eq('restart：idle + 确认请求 ⇒ confirming', restartReducer(RESTART_IDLE, RESTART_REQ_CONFIRM), RESTART_CONFIRMING);
eq('restart：confirming + 取消 ⇒ idle', restartReducer(RESTART_CONFIRMING, RESTART_REQ_CANCEL), RESTART_IDLE);
eq('restart：confirming + 执行 ⇒ restarting', restartReducer(RESTART_CONFIRMING, RESTART_REQ_RESTART), RESTART_RESTARTING);
eq('restart：restarting + 回包成功 ⇒ polling', restartReducer(RESTART_RESTARTING, RESTART_SENT), RESTART_POLLING);
eq('restart：restarting + 失败 ⇒ failed', restartReducer(RESTART_RESTARTING, RESTART_FAIL), RESTART_FAILED);
eq('restart：polling + 探到服务 ⇒ succeeded', restartReducer(RESTART_POLLING, RESTART_POLL_OK), RESTART_SUCCEEDED);
eq('restart：polling + 超时 ⇒ timedOut', restartReducer(RESTART_POLLING, RESTART_TIMEOUT), RESTART_TIMED_OUT);
// ⛔ 守卫：restarting/polling 态连点 reqRestart 不改变状态（进行中态可见 + 防连点）
eq('restart：restarting + 再点 ⇒ 仍 restarting（防连点）',
  restartReducer(RESTART_RESTARTING, RESTART_REQ_RESTART), RESTART_RESTARTING);
eq('restart：polling + 再点 ⇒ 仍 polling（防连点）',
  restartReducer(RESTART_POLLING, RESTART_REQ_RESTART), RESTART_POLLING);
// reset 归位 + 终态可重试
eq('restart：timedOut + reset ⇒ idle', restartReducer(RESTART_TIMED_OUT, RESTART_RESET), RESTART_IDLE);
eq('restart：succeeded + 确认请求 ⇒ confirming（可再重启）',
  restartReducer(RESTART_SUCCEEDED, RESTART_REQ_CONFIRM), RESTART_CONFIRMING);
// 非法 event 原样返回（不抛）
eq('restart：idle + pollOk（非法）⇒ idle', restartReducer(RESTART_IDLE, RESTART_POLL_OK), RESTART_IDLE);
eq('restart：succeeded + 超时（非法）⇒ succeeded',
  restartReducer(RESTART_SUCCEEDED, RESTART_TIMEOUT), RESTART_SUCCEEDED);

// 7 态互斥谓词
ok('restartBusy：restarting|polling',
  restartBusy(RESTART_RESTARTING) && restartBusy(RESTART_POLLING)
    && !restartBusy(RESTART_CONFIRMING) && !restartBusy(RESTART_SUCCEEDED));
ok('restartShowConfirm：仅 confirming',
  restartShowConfirm(RESTART_CONFIRMING) && !restartShowConfirm(RESTART_RESTARTING));
ok('终态谓词互斥',
  restartSucceeded(RESTART_SUCCEEDED) && !restartSucceeded(RESTART_TIMED_OUT)
    && restartTimedOut(RESTART_TIMED_OUT) && !restartTimedOut(RESTART_SUCCEEDED)
    && !restartSucceeded(RESTART_FAILED));

// ── ⑥ 轮询节奏与超时（web SettingsAbout.tsx:176-196 逐字）────────────────────

eq('轮询间隔 1.5s', RESTART_POLL_INTERVAL_MS, 1500);
eq('总超时 40s', RESTART_TIMEOUT_MS, 40000);
eq('flush 缓冲 1.2s', RESTART_FLUSH_DELAY_MS, 1200);
eq('期限 = 起点 + 40s', pollDeadline(1000), 41000);
// 严格大于：恰好到点（now == deadline）**不算**超时（对齐 web `Date.now() > deadline`）
eq('超时判定：恰好到点 ⇒ false', pollExceeded(41000, 41000), false);
eq('超时判定：越过 1ms ⇒ true', pollExceeded(41001, 41000), true);
eq('超时判定：期限内 ⇒ false', pollExceeded(20000, 41000), false);

// ── ⑦ 失败/超时必须可见 ───────────────────────────────────────────────────────

ok('超时文案提到 40 秒', restartTimeoutText().indexOf('40 秒') >= 0);
ok('超时文案提示自行启动', restartTimeoutText().indexOf('自行') >= 0);
eq('完成文案', restartSucceededText(), '服务已重启。');
eq('错误文案：timedOut ⇒ 超时文案', restartErrorText(RESTART_TIMED_OUT, 'ignored'), restartTimeoutText());
eq('错误文案：failed ⇒ 原文', restartErrorText(RESTART_FAILED, 'connection refused'), 'connection refused');
eq('错误文案：failed 且无原文 ⇒ 兜底', restartErrorText(RESTART_FAILED, ''), '重启请求失败。');
eq('错误文案：succeeded ⇒ 空', restartErrorText(RESTART_SUCCEEDED, 'x'), '');
eq('错误文案：polling ⇒ 空', restartErrorText(RESTART_POLLING, 'x'), '');

// 中性提示：托管 ⇒ 说明由谁拉起；none/未知 ⇒ 中性（不假定自动重启）
ok('提示：systemd 托管', restartHintText('systemd').indexOf('systemd') >= 0
  && restartHintText('systemd').indexOf('自动恢复') >= 0);
ok('提示：none 中性', restartHintText('none').indexOf('取决于') >= 0);
ok('提示：未知中性', restartHintText(undefined).indexOf('取决于') >= 0);

// ── ⑧ release notes 外链：规范化 + 白名单 ─────────────────────────────────────

eq('外链：正常 https 原样', normalizeReleaseUrl('https://github.com/x/y/releases/tag/v1'), 'https://github.com/x/y/releases/tag/v1');
eq('外链：http 放行', normalizeReleaseUrl('http://example.com/r'), 'http://example.com/r');
eq('外链：trim', normalizeReleaseUrl('  https://a.b/c  '), 'https://a.b/c');
eq('外链：空串 ⇒ 空', normalizeReleaseUrl(''), '');
eq('外链：undefined ⇒ 空', normalizeReleaseUrl(undefined), '');
eq('外链：纯空白 ⇒ 空', normalizeReleaseUrl('   '), '');
// ⛔ 非白名单协议一律拒绝（不渲染不可打开的链接）
eq('外链：javascript 拒绝', normalizeReleaseUrl('javascript:alert(1)'), '');
eq('外链：data 拒绝', normalizeReleaseUrl('data:text/html,x'), '');
eq('外链：file 拒绝', normalizeReleaseUrl('file:///etc/passwd'), '');
eq('外链：相对地址拒绝（不做猜拼）', normalizeReleaseUrl('/releases/v1'), '');

eq('check_update.url 提取', releaseNotesUrl({ hasUpdate: true, url: 'https://gh/x' } as UpdateCheckRow), 'https://gh/x');
eq('check_update 无 url ⇒ 空', releaseNotesUrl({ hasUpdate: true } as UpdateCheckRow), '');
eq('check_update undefined ⇒ 空', releaseNotesUrl(undefined), '');
eq('可点性：https ⇒ true', isClickableUrl('https://gh/x'), true);
eq('可点性：非白名单 ⇒ false', isClickableUrl('javascript:x'), false);
eq('可点性：空 ⇒ false', isClickableUrl(''), false);

console.log(`\n${fail === 0 ? '✅' : '❌'} about 破坏性动作契约测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

export {};
