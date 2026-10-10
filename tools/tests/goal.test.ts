/**
 * Goal 横幅纯逻辑测试（`core/statusfmt.ets` 的 goal 部分）。
 *
 * 权威基准（web）：`web/src/components/agent/GoalBanner.tsx`
 *   · `:37`  `completed = goal.status === 'completed'`（只认这一个值）
 *   · `:52-58` 保存：trim 后**非空且变更**才提交（否则保留原值）
 *   · `:120` 已完成的目标**不可编辑**
 *   · `:141` 徽标 `进行中` / `已完成`（web i18n `zh-CN.ts:298-299`）
 *
 * ⚠️ 判别力自证：①`completed` 判据改成 `status !== 'active'`；②`goalEditCommit` 去掉
 *    「trim 后非空」守卫；③`goalEditable` 取反 —— 各自必红。
 */
declare const process: { exit: (c: number) => void };

import {
  GOAL_BADGE_ACTIVE, GOAL_BADGE_DONE, goalDisplay, GoalDisplay, goalEditable, goalEditCommit,
} from '../../entry/src/main/ets/core/statusfmt';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── ① 展示模型 ──
{
  const none: GoalDisplay = goalDisplay(undefined, undefined);
  eq('无 objective ⇒ 不渲染', none.visible, false);
  const empty: GoalDisplay = goalDisplay('', 'active');
  eq('空串 objective ⇒ 不渲染', empty.visible, false);

  const active: GoalDisplay = goalDisplay('修复登录', 'active');
  eq('active ⇒ visible', active.visible, true);
  eq('active ⇒ completed=false', active.completed, false);
  eq('active ⇒ active=true', active.active, true);
  eq('active ⇒ 徽标=进行中', active.badge, GOAL_BADGE_ACTIVE);
  eq('active ⇒ 原文透传', active.objective, '修复登录');

  const done: GoalDisplay = goalDisplay('修复登录', 'completed');
  eq('completed ⇒ completed=true', done.completed, true);
  eq('completed ⇒ active=false', done.active, false);
  eq('completed ⇒ 徽标=已完成', done.badge, GOAL_BADGE_DONE);
  eq('completed ⇒ visible', done.visible, true);

  // web `:37` **只认 'completed'** ⇒ 其它任何值都算进行中
  ok('status=done（服务端不发的值）不算完成', !goalDisplay('x', 'done').completed);
  ok('status 缺失 ⇒ 进行中', !goalDisplay('x', undefined).completed);
  ok('status=cleared ⇒ 进行中（清理由上游判 null，不用 status）',
    !goalDisplay('x', 'cleared').completed);
}

// ── ② 编辑提交判据（web `:52-58`）──
{
  eq('正常改名 ⇒ 返回新值', goalEditCommit('新目标', '旧目标'), '新目标');
  eq('两侧空白 ⇒ trim 后返回', goalEditCommit('  新目标  ', '旧目标'), '新目标');
  // ⛔ 空串必须拒绝（清空会让 goal 静默消失）
  eq('空串 ⇒ null（不提交）', goalEditCommit('', '旧目标'), null);
  eq('纯空白 ⇒ null', goalEditCommit('    ', '旧目标'), null);
  // 未变更 ⇒ null（不产生无谓写）
  eq('未变更 ⇒ null', goalEditCommit('旧目标', '旧目标'), null);
  eq('未变更（两侧空白）⇒ null', goalEditCommit('  旧目标 ', '旧目标'), null);
  eq('全空且原文为空 ⇒ null', goalEditCommit('', ''), null);
}

// ── ③ 可编辑性（web `:120`：已完成不可编辑）──
{
  ok('进行中可编辑', goalEditable(false));
  ok('已完成不可编辑', !goalEditable(true));
}

console.log(`\ngoal.test: ${pass} passed / ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);
