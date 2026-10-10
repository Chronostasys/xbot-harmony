/**
 * 工具状态语义门禁 —— `core/toolstatus.ets`（live 与 committed **共用**的判定/文案）。
 *
 * 守护的不变量：
 *   · done 与 running **必须落在不同档**（用户 2026-10-10：「tool done 和 tool executing
 *     没区别」的根因就是两端各写一份判定、且成功/运行在视觉上不可辨）；
 *   · 失败判定**早于**运行判定（退出码非 0 时即便 status 仍是 running 也要报错）；
 *   · 成功态**无 chip**（安静），失败/运行/排队/终止**有 chip**（需要注意力）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  ST_DONE, ST_ERROR, ST_KILLED, ST_PENDING, ST_RUNNING,
  isLiveStatus, statusChip, toolStatusKind,
} from '../../entry/src/main/ets/core/toolstatus';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── toolStatusKind：raw status ⇒ 语义档 ─────────────────────────────────────
eq('done 状态', toolStatusKind('done', 0), ST_DONE);
eq('completed（未知）回落 done', toolStatusKind('completed', 0), ST_DONE);
eq('空状态回落 done', toolStatusKind('', undefined), ST_DONE);
eq('undefined 回落 done', toolStatusKind(undefined, undefined), ST_DONE);
eq('running ⇒ running', toolStatusKind('running', undefined), ST_RUNNING);
eq('executing ⇒ running', toolStatusKind('executing', undefined), ST_RUNNING);
eq('generating ⇒ running', toolStatusKind('generating', undefined), ST_RUNNING);
eq('pending ⇒ pending', toolStatusKind('pending', undefined), ST_PENDING);
eq('error ⇒ error', toolStatusKind('error', undefined), ST_ERROR);
eq('killed ⇒ killed', toolStatusKind('killed', undefined), ST_KILLED);
eq('aborted ⇒ killed', toolStatusKind('aborted', undefined), ST_KILLED);
eq('cancelled ⇒ killed', toolStatusKind('cancelled', undefined), ST_KILLED);
eq('大写 RUNNING 也识别', toolStatusKind('RUNNING', undefined), ST_RUNNING);
// ⚠️ 退出码非 0 必须**优先**判失败（哪怕 status 仍是 running —— 流式阶段的常见形态）
eq('running + exit 1 ⇒ error', toolStatusKind('running', 1), ST_ERROR);
eq('done + exit 2 ⇒ error', toolStatusKind('done', 2), ST_ERROR);
eq('exit 0 不算失败', toolStatusKind('done', 0), ST_DONE);

// ── **核心不变量**：done 与 running 必须不同档 ───────────────────────────────
eq('done ≠ running（这就是"没区别"的根因）',
  toolStatusKind('done', 0) !== toolStatusKind('running', undefined), true);
eq('isLive(done) = false', isLiveStatus(toolStatusKind('done', 0)), false);
eq('isLive(running) = true', isLiveStatus(toolStatusKind('running', undefined)), true);
eq('isLive(pending) = false', isLiveStatus(toolStatusKind('pending', undefined)), false);

// ── statusChip：成功安静、其余有 chip ───────────────────────────────────────
eq('done 无 chip（安静）', statusChip(ST_DONE, 0, 0), '');
eq('running 有 chip', statusChip(ST_RUNNING, undefined, 0), '执行中');
eq('generating 带字数', statusChip(ST_RUNNING, undefined, 42), '生成中 42 字');
eq('generating 无字数回落「执行中」', statusChip(ST_RUNNING, undefined, 0), '执行中');
eq('pending ⇒ 排队', statusChip(ST_PENDING, undefined, 0), '排队');
eq('killed ⇒ 已终止', statusChip(ST_KILLED, undefined, 0), '已终止');
eq('error ⇒ 失败', statusChip(ST_ERROR, undefined, 0), '失败');
eq('error + exit ⇒ 失败 exit N', statusChip(ST_ERROR, 3, 0), '失败 exit 3');

console.log(`  toolstatus: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
