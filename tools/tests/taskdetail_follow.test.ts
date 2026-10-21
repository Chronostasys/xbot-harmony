/**
 * taskdetail_follow —— 后台任务详情「跟随重投」的**接线形态断言**
 * （P0「开盖冻结」修复，2026-10-14）。
 *
 * 缺陷回顾（tasks-gap 审计最大发现）：详情页输出/状态曾是**打开那一刻的静态快照**
 * （taskDetailOutput 等 4 个 @State 唯一赋值点在 openTaskDetail）；任务自然结束后
 * 仍显示「运行中」+ 挂着终止钮——用户点它去 kill 一个已死进程才被动刷一次。
 *
 * web 权威：BackgroundPanel.tsx:152-172 SSE `bg_task_output` 增量 + 状态轮询双通道
 * 保证详情实时；原生最小闭环 = 列表每次镜像更新（syncFromStore bgTasks 分支 ⇐
 * panelPollMs 2s/30s / kill / promote 就地重拉）⇒ refreshTaskDetailFrom 重投。
 *
 * 本文件钉「接线形态」——**调用点计数**（⛔ 不钉方法体存在、不钉注释文字，
 * 防死消费假绿：方法写了 0 调用也曾是真实事故形态）：
 *   ① 方法定义恰 1；
 *   ② 调用点 ≥2（syncFromStore 镜像分支 + killTaskDetail）且镜像分支接线恰 1；
 *   ③ 方法体内判据同源（core/panels.ets 四纯函数与列表行同一组）；
 *   ④ 旧内联残留 0（killTaskDetail 的「openTaskDetail(list[i])」必须合入）；
 *   ⑤ 消失即关（id 不在新列表 ⇒ showTaskDetail=false）；
 *   ⑥ ⛔ 不走 openTaskDetail / dismissKeyboard（轮询路径收用户键盘的回归防线）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; dirname(p: string): string };
declare const __dirname: string;

import { describe, expect, it, summary } from './vitest_shim';

/** 爬根 idiom（run-one.sh 编译产物令 __dirname 漂移 ⇒ 裸 ../ 会 ENOENT，实测）。 */
function repoRoot(): string {
  let root: string = __dirname;
  for (let i = 0; i < 8; i++) {
    if (require('fs').existsSync(require('path').join(root, 'entry', 'src', 'main', 'ets'))) {
      break;
    }
    root = require('path').join(root, '..');
  }
  return root;
}

function srcOf(rel: string): string {
  const f: string = require('path').join(repoRoot(), 'entry', 'src', 'main', 'ets', rel);
  if (!require('fs').existsSync(f)) {
    throw new Error(`形态断言取不到源文件: ${f}`);
  }
  return require('fs').readFileSync(f, 'utf-8');
}

/** 子串出现次数（「调用片段」计数，⛔ 不取整行——`Text('保存')…typeOf('type.subhead')` 假红教训）。 */
function occ(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

const idx: string = srcOf('pages/Index.ets');

/** 抽方法体（从签名行到下一个「\n  }」—— ArkTS 方法两空格缩进闭合）。 */
function methodBody(src: string, signature: string): string {
  const at: number = src.indexOf(signature);
  if (at < 0) {
    throw new Error(`方法不存在: ${signature}`);
  }
  const end: number = src.indexOf('\n  }', at);
  return src.slice(at, end < 0 ? src.length : end);
}

describe('任务详情跟随重投——接线形态（Index.ets）', () => {
  it('① 方法定义恰 1（防重复实现两份）', () => {
    expect(occ(idx, 'private refreshTaskDetailFrom(')).toBe(1);
  });

  it('② 调用点 ≥2 且镜像分支接线恰 1（防「方法写了但不接线」的死消费）', () => {
    expect(occ(idx, 'this.refreshTaskDetailFrom(')).toBeGreaterThanOrEqual(2);
    // syncFromStore 镜像分支的精确接线（this.bgTasks 直传）——killTaskDetail 传的是 st.bgTasks。
    expect(occ(idx, 'this.refreshTaskDetailFrom(this.bgTasks);')).toBe(1);
  });

  it('③ 方法体判据同源：core/panels.ets 四纯函数（与列表行同组——不可能「列表说运行中、详情说完成」）', () => {
    const body: string = methodBody(idx, 'private refreshTaskDetailFrom(');
    expect(occ(body, 'bgTaskStatusText(')).toBeGreaterThanOrEqual(1);
    expect(occ(body, 'bgTaskMetaText(')).toBeGreaterThanOrEqual(1);
    expect(occ(body, 'bgTaskOutputText(')).toBeGreaterThanOrEqual(1);
    expect(occ(body, 'bgTaskRunning(')).toBeGreaterThanOrEqual(1);
  });

  it('④ killTaskDetail 旧内联残留 0（「找 id→openTaskDetail/消失→关」必须合入，不再各写一份）', () => {
    expect(occ(idx, 'openTaskDetail(list[i])')).toBe(0);
  });

  it('⑤ 消失即关：id 不在新列表 ⇒ 详情自动关（不吊死在已不存在的任务上）', () => {
    const body: string = methodBody(idx, 'private refreshTaskDetailFrom(');
    expect(occ(body, 'this.showTaskDetail = false')).toBeGreaterThanOrEqual(1);
  });

  it('⑥ ⛔ 不走 openTaskDetail / dismissKeyboard（每 2s 轮询会把用户在别处的键盘无端收掉）', () => {
    const body: string = methodBody(idx, 'private refreshTaskDetailFrom(');
    expect(occ(body, 'this.openTaskDetail(')).toBe(0);
    expect(occ(body, 'dismissKeyboard')).toBe(0);
  });
});

summary('taskdetail_follow');

export {};
