/**
 * 工具状态语义门禁 —— `core/toolstatus.ets`（live 与 committed **共用**的唯一判据）。
 *
 * 权威表见 `core/toolstatus.ets` 文件头。守护的**三道闸**（"病情不再复发"）：
 *   ① `⛔ 陈旧 pending 不得覆盖新的 running/done`（rank 终态优先；见 `streammerge.test.ts`）
 *   ② `⛔ generating 不得回落「执行中」`（独立档）
 *   ③ `⛔ live pending ⇒ 排队（后端为准，不得私改判）`（§13.3 的私改判**已废止**）
 * 另：`live` 只影响「是否在飞（扫光）」，**绝不影响文案/档位/颜色**。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  ST_DONE, ST_ERROR, ST_GENERATING, ST_KILLED, ST_PENDING, ST_RUNNING,
  ROLE_ACCENT, ROLE_DANGER, ROLE_MUTED, ROLE_SUCCESS,
  isInFlight, isLiveStatus, isToolInProgress, renderKind, statusChip, statusColorRole, toolStatusKind,
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
eq('running ⇒ running', toolStatusKind('running', undefined), ST_RUNNING);
eq('executing ⇒ running', toolStatusKind('executing', undefined), ST_RUNNING);
eq('generating ⇒ generating（不是 running）', toolStatusKind('generating', undefined), ST_GENERATING);
eq('pending ⇒ pending', toolStatusKind('pending', undefined), ST_PENDING);
eq('error ⇒ error', toolStatusKind('error', undefined), ST_ERROR);
eq('failed ⇒ error（同义档，panels 复用）', toolStatusKind('failed', undefined), ST_ERROR);
eq('killed ⇒ killed', toolStatusKind('killed', undefined), ST_KILLED);
eq('⛔ killed + exit 130 ⇒ killed（抢在 exit 之前，否则误报失败）', toolStatusKind('killed', 130), ST_KILLED);
eq('aborted + exit 130 ⇒ killed', toolStatusKind('aborted', 130), ST_KILLED);
eq('大写 GENERATING 也识别', toolStatusKind('GENERATING', undefined), ST_GENERATING);
eq('running + exit 1 ⇒ error', toolStatusKind('running', 1), ST_ERROR);
eq('generating + exit 1 ⇒ error', toolStatusKind('generating', 1), ST_ERROR);
eq('exit 0 不算失败', toolStatusKind('done', 0), ST_DONE);

// ── renderKind：**档位一律以后端为准**（不看 live）────────────────────────────
eq('live pending 仍是 pending（不私改判）', renderKind('pending', undefined, true), ST_PENDING);
eq('committed pending 仍是 pending', renderKind('pending', undefined, false), ST_PENDING);
eq('live generating 仍是 generating', renderKind('generating', undefined, true), ST_GENERATING);
eq('live running 仍 running', renderKind('running', undefined, true), ST_RUNNING);
eq('live done 仍 done', renderKind('done', 0, true), ST_DONE);

// ═══════════════════════════════════════════════════════════════════════════
// **权威表逐格断言**（6 行 × {文案, 在飞, 色角色}）—— `live` 只改「在飞」
// ═══════════════════════════════════════════════════════════════════════════
type Cell = { live: boolean; status: string; exit?: number; gen?: number; chip: string; inFlight: boolean; role: string };
const TABLE: Cell[] = [
  // live 块
  { live: true, status: 'pending', chip: '排队', inFlight: true, role: ROLE_MUTED },
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
  eq(`表[${tag}] 在飞`, isInFlight(kind, c.live), c.inFlight);
  eq(`表[${tag}] 色角色`, statusColorRole(kind), c.role);
}
eq('live 只改在飞、不改文案', TABLE[0].chip, statusChip(renderKind('pending', undefined, true), undefined, undefined));
eq('live 只改在飞、不改色', statusColorRole(renderKind('pending', undefined, true)), ROLE_MUTED);

// ── 三道闸（"病情不再复发"）──────────────────────────────────────────────────
// ② generating 不得回落「执行中」
eq('⛔ generating ⇒ 生成中…（不是执行中）',
  statusChip(renderKind('generating', undefined, true), undefined, undefined), '生成中…');
eq('⛔ generating ⇒ 生成中…（committed 同）',
  statusChip(renderKind('generating', undefined, false), undefined, undefined), '生成中…');
// ③ live pending ⇒ 排队（后端为准，不得私改判）
eq('⛔ live pending ⇒ 排队（后端为准，不得私改判）',
  statusChip(renderKind('pending', undefined, true), undefined, undefined), '排队');
eq('⛔ live pending ⇒ muted（不是 accent）', statusColorRole(renderKind('pending', undefined, true)), ROLE_MUTED);

// ── statusColorRole：六档 × 唯一色表（H1）────────────────────────────────────
eq('色表 done ⇒ success', statusColorRole(ST_DONE), ROLE_SUCCESS);
eq('色表 running ⇒ accent', statusColorRole(ST_RUNNING), ROLE_ACCENT);
eq('色表 generating ⇒ accent', statusColorRole(ST_GENERATING), ROLE_ACCENT);
eq('色表 pending ⇒ muted（绝不是 accent；真机打脸根因）', statusColorRole(ST_PENDING), ROLE_MUTED);
eq('色表 error ⇒ danger', statusColorRole(ST_ERROR), ROLE_DANGER);
eq('色表 killed ⇒ muted', statusColorRole(ST_KILLED), ROLE_MUTED);

// ── 在飞：committed 只有 running/generating；live 的非终态都算 ──────────────────
eq('base：running 在飞', isLiveStatus(ST_RUNNING), true);
eq('base：generating 在飞', isLiveStatus(ST_GENERATING), true);
eq('base：pending 不在飞', isLiveStatus(ST_PENDING), false);
eq('live pending 在飞（扫光）', isInFlight(ST_PENDING, true), true);
eq('committed pending 不在飞', isInFlight(ST_PENDING, false), false);
eq('live done 不在飞（终态）', isInFlight(ST_DONE, true), false);

// ── C（§12-C）：`isToolInProgress`（web `isToolInProgress`）**含 pending**，与 isLiveStatus 区分 ──
eq('C：isToolInProgress 含 running', isToolInProgress(ST_RUNNING), true);
eq('C：isToolInProgress 含 generating', isToolInProgress(ST_GENERATING), true);
eq('C：isToolInProgress **含 pending**（web 语义；思考领读用）', isToolInProgress(ST_PENDING), true);
eq('C：isToolInProgress 不含 done', isToolInProgress(ST_DONE), false);
eq('C：isToolInProgress 不含 killed', isToolInProgress(ST_KILLED), false);
// ⛔ 反面板：两者**必须**在 pending 上分叉（合并即回归"文案说排队、形态说在飞"）
eq('C：pending 上 isLiveStatus=false 而 isToolInProgress=true（有意分叉）',
  `${isLiveStatus(ST_PENDING)}/${isToolInProgress(ST_PENDING)}`, 'false/true');

// ── 互不同档（"没区别"/"当成"类 bug 的总闸）─────────────────────────────────
eq('done ≠ running', toolStatusKind('done', 0) !== toolStatusKind('running', undefined), true);
eq('running ≠ generating（P0："generating 被当成 executing"）',
  toolStatusKind('running', undefined) !== toolStatusKind('generating', undefined), true);

// ── 时长（原生增强；第 4 参 elapsedMs）─────────────────────────────────────
eq('running + 1234ms ⇒ 执行中 1.2s', statusChip(ST_RUNNING, 0, 0, 1234), '执行中 1.2s');
eq('running 无时长（3 参）⇒ 执行中（向后兼容）', statusChip(ST_RUNNING, 0, 0), '执行中');
eq('running + 0ms ⇒ 执行中', statusChip(ST_RUNNING, 0, 0, 0), '执行中');
eq('elapsed 不得影响 generating', statusChip(ST_GENERATING, undefined, 0, 1234), '生成中…');
eq('elapsed 不得影响 pending', statusChip(ST_PENDING, undefined, undefined, 1234), '排队');
eq('elapsed 不得影响 done', statusChip(ST_DONE, 0, 0, 1234), '');

console.log(`  toolstatus: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};
