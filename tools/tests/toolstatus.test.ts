/**
 * 工具状态语义门禁 —— `core/toolstatus.ets`（live 与 committed **共用**的唯一判据）。
 *
 * 权威表见 `core/toolstatus.ets` 文件头 + `docs/WEB-ALIGNMENT.md §13.3`。
 * 守护的不变量：
 *   · **live 块的 `pending` ⇒ 「执行中」**（服务端整批先建 pending、goroutine 启动才翻 running
 *     —— `engine_run_tools.go:49-64/:150`；live 块里的工具**都已派发**）；
 *   · **`generating` 任何情况下都不得显示「执行中」**（用户原话第 2 半）；
 *   · done / running / generating / pending 互不同档；失败判定**早于**运行判定；
 *   · 六档 × **唯一语义色表**；committed 与 live 的差异**只由 `live?` 一个输入决定**。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  ST_DONE, ST_ERROR, ST_GENERATING, ST_KILLED, ST_PENDING, ST_RUNNING,
  ROLE_ACCENT, ROLE_DANGER, ROLE_MUTED, ROLE_SUCCESS,
  isLiveStatus, renderKind, statusChip, statusColorRole, toolStatusKind,
} from '../../entry/src/main/ets/core/toolstatus';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── toolStatusKind：raw status ⇒ 原始档 ─────────────────────────────────────
eq('done 状态', toolStatusKind('done', 0), ST_DONE);
eq('completed（未知）回落 done', toolStatusKind('completed', 0), ST_DONE);
eq('空状态回落 done', toolStatusKind('', undefined), ST_DONE);
eq('running ⇒ running', toolStatusKind('running', undefined), ST_RUNNING);
eq('executing ⇒ running', toolStatusKind('executing', undefined), ST_RUNNING);
eq('generating ⇒ generating（不是 running）', toolStatusKind('generating', undefined), ST_GENERATING);
eq('pending ⇒ pending', toolStatusKind('pending', undefined), ST_PENDING);
eq('error ⇒ error', toolStatusKind('error', undefined), ST_ERROR);
eq('failed ⇒ error（同义档，panels 复用）', toolStatusKind('failed', undefined), ST_ERROR);
eq('killed ⇒ killed', toolStatusKind('killed', undefined), ST_KILLED);
eq('大写 GENERATING 也识别', toolStatusKind('GENERATING', undefined), ST_GENERATING);
// 退出码非 0 必须**优先**判失败
eq('running + exit 1 ⇒ error', toolStatusKind('running', 1), ST_ERROR);
eq('generating + exit 1 ⇒ error', toolStatusKind('generating', 1), ST_ERROR);
eq('exit 0 不算失败', toolStatusKind('done', 0), ST_DONE);

// ── renderKind：**唯一** live-aware 判据 ─────────────────────────────────────
eq('live pending ⇒ running（§13.3 核心）', renderKind('pending', undefined, true), ST_RUNNING);
eq('committed pending ⇒ pending（保守「排队」）', renderKind('pending', undefined, false), ST_PENDING);
eq('live running 不变', renderKind('running', undefined, true), ST_RUNNING);
eq('live generating 不变（绝不被归并成 running）', renderKind('generating', undefined, true), ST_GENERATING);
eq('live done 不变', renderKind('done', 0, true), ST_DONE);
eq('live error 不变', renderKind('error', undefined, true), ST_ERROR);

// ═══════════════════════════════════════════════════════════════════════════
// **权威表逐格断言**（6 行 × {文案, 在飞}）—— 防"这次回归不会再发生"
// ═══════════════════════════════════════════════════════════════════════════
type Cell = { live: boolean; status: string; exit?: number; gen?: number; chip: string; inFlight: boolean; role: string };
const TABLE: Cell[] = [
  // live 块
  { live: true, status: 'pending', chip: '执行中', inFlight: true, role: ROLE_ACCENT },
  { live: true, status: 'generating', gen: 0, chip: '生成中…', inFlight: true, role: ROLE_ACCENT },
  { live: true, status: 'generating', gen: 42, chip: '生成中 42 字', inFlight: true, role: ROLE_ACCENT },
  { live: true, status: 'running', chip: '执行中', inFlight: true, role: ROLE_ACCENT },
  { live: true, status: 'error', chip: '失败', inFlight: false, role: ROLE_DANGER },
  { live: true, status: 'error', exit: 7, chip: '失败 exit 7', inFlight: false, role: ROLE_DANGER },
  { live: true, status: 'killed', chip: '已终止', inFlight: false, role: ROLE_MUTED },
  // committed 块
  { live: false, status: 'done', chip: '', inFlight: false, role: ROLE_SUCCESS },
  { live: false, status: 'running', chip: '执行中', inFlight: true, role: ROLE_ACCENT },
  { live: false, status: 'generating', gen: 0, chip: '生成中…', inFlight: true, role: ROLE_ACCENT },
  { live: false, status: 'pending', chip: '排队', inFlight: false, role: ROLE_MUTED },
  { live: false, status: 'error', chip: '失败', inFlight: false, role: ROLE_DANGER },
  { live: false, status: 'killed', chip: '已终止', inFlight: false, role: ROLE_MUTED },
];
for (let i = 0; i < TABLE.length; i++) {
  const c: Cell = TABLE[i];
  const kind: string = renderKind(c.status, c.exit, c.live);
  const tag: string = `${c.live ? 'live' : 'committed'}/${c.status}${c.gen !== undefined ? '+gen' + c.gen : ''}${c.exit !== undefined ? '+exit' + c.exit : ''}`;
  eq(`表[${tag}] 文案`, statusChip(kind, c.exit, c.gen), c.chip);
  eq(`表[${tag}] 在飞`, isLiveStatus(kind), c.inFlight);
  eq(`表[${tag}] 色角色`, statusColorRole(kind), c.role);
}
// 核心两格（单独再钉一遍，读起来最清楚）
eq('⛔ live pending ⇒ 执行中（不是排队）', statusChip(renderKind('pending', undefined, true), undefined, undefined), '执行中');
eq('⛔ live generating ⇒ 生成中…（不是执行中）', statusChip(renderKind('generating', undefined, true), undefined, undefined), '生成中…');

// ── statusColorRole：六档 × 唯一色表（H1）────────────────────────────────────
eq('色表 done ⇒ success', statusColorRole(ST_DONE), ROLE_SUCCESS);
eq('色表 running ⇒ accent', statusColorRole(ST_RUNNING), ROLE_ACCENT);
eq('色表 generating ⇒ accent', statusColorRole(ST_GENERATING), ROLE_ACCENT);
eq('色表 pending ⇒ muted（绝不是 accent；真机打脸根因）', statusColorRole(ST_PENDING), ROLE_MUTED);
eq('色表 error ⇒ danger', statusColorRole(ST_ERROR), ROLE_DANGER);
eq('色表 killed ⇒ muted', statusColorRole(ST_KILLED), ROLE_MUTED);

// ── 互不同档（"没区别"/"当成"类 bug 的总闸）─────────────────────────────────
eq('done ≠ running', toolStatusKind('done', 0) !== toolStatusKind('running', undefined), true);
eq('running ≠ generating（P0："generating 被当成 executing"）',
  toolStatusKind('running', undefined) !== toolStatusKind('generating', undefined), true);

console.log(`  toolstatus: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
