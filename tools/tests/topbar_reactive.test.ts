/**
 * 顶栏「迭代指标」徽章（插件 `xbot.iteration-stats` 的 `status_bar_right` 视图）的
 * **响应式投影**守卫（读源码形态；纯逻辑、可脱机跑）。
 *
 * 背景（2026-10-12 真机实锤缺陷，用户亲报「统计插件的面板我们看不到」）：
 *   徽章文案来自 `store.liveProgress().streamStats`，而旧实现**在头部 builder 内直调**
 *   `iterStatsBadgeText()` —— 它读的是 `store` 的内部状态（**非** `@State`）⇒ 头部只在
 *   `busy`/`currentChat`/`nativeCatalog` 变化时重渲，而 `busy` 在回合**开始**那一刻就置 true
 *   （此时 `stream_stats` 尚为 0）⇒ 之后指标有了**却没有重渲触发** ⇒ **徽章恒为空**。
 *   真机证据：流式中 `dumpLayout` 全页 **0 处 `t/s`**，而 web 侧同期显示 `190t/s · 930ms`。
 *   （同类陷阱见 `AGENTS.md`：「凡会变的值要么让行自己订阅，要么在变更路径显式发通知」。）
 *
 * ⇒ 本用例钉死「算」与「投影」分离：
 *   ① 徽章文案经 **`@State iterStatsBadge`** 投影，头部 `Text(...)` 只读该 `@State`；
 *   ② 投影发生在**更新通路 `sync()`** 里（`computeIterStatsBadge(store)` 的结果赋给该 `@State`）；
 *   ③ 反向：头部徽章子树内**不得**出现 `liveProgress(` / `computeIterStatsBadge(`（非响应式读）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { describe, expect, it, summary } from './vitest_shim';

describe('顶栏「迭代指标」徽章：必须经 @State 投影（否则恒空）', () => {
  const fs = require('fs');
  const path = require('path');
  // ⛔ `run-one.sh` 把测试编译到 `.out.$$/js/` 下再跑 ⇒ `__dirname` 不是 `tools/tests/`；
  //    必须**向上查找仓库根**（含 `entry/src/main/ets`），别写死相对层级。
  let root: string = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(root, 'entry', 'src', 'main', 'ets'))) { break; }
    root = path.join(root, '..');
  }
  const idxPath: string = path.join(root, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets');
  const raw: string = fs.existsSync(idxPath) ? fs.readFileSync(idxPath, 'utf-8') : '';
  // 剥注释：只认**真实代码形态**（注释里的说明/历史不算）
  const src: string = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // 徽章渲染点：`if (this.iterStatsBadge.length > 0) { Text(this.iterStatsBadge) … }`
  const badgeAnchor: number = src.indexOf('Text(this.iterStatsBadge)');
  const badgeStart: number = badgeAnchor > 0 ? src.lastIndexOf('if (this.iterStatsBadge', badgeAnchor) : -1;
  // 右侧界 = 紧邻的下一个兄弟节点（2026-10-17 顶栏队列 chip 删除后 ⇒ 顶栏收尾 id）
  const badgeStop: number = badgeAnchor > 0 ? src.indexOf(".id('xbot-header')", badgeAnchor) : -1;
  const badgeSlice: string = badgeStart > 0 && badgeStop > badgeStart ? src.slice(badgeStart, badgeStop) : '';

  // 投影点：更新通路里 `const … = this.computeIterStatsBadge(store);` + 赋给 @State
  const projCall: number = src.indexOf('computeIterStatsBadge(store)');
  const projWindow: string = projCall > 0 ? src.slice(projCall - 40, projCall + 480) : '';

  it('零扫描防线：读到源码、定位到徽章子树与投影点', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(badgeAnchor).toBeGreaterThan(0);
    expect(badgeSlice.length).toBeGreaterThan(80);
    expect(projCall).toBeGreaterThan(0);
    expect(projWindow.length).toBeGreaterThan(80);
  });

  it('① 徽章文案声明为 @State（头部只读它，才能随流式指标重渲）', () => {
    expect(src).toContain('@State iterStatsBadge: string');
    expect(badgeSlice).toContain('this.iterStatsBadge');
  });

  it('② 投影发生在更新通路 sync()：computeIterStatsBadge(store) 的结果赋给该 @State', () => {
    expect(projWindow).toContain('this.computeIterStatsBadge(store)');
    expect(projWindow).toContain('this.iterStatsBadge =');
  });

  it('③ ⛔ 头部徽章子树内不得直读 store.liveProgress()（非响应式 ⇒ 徽章恒空）', () => {
    expect(badgeSlice).not.toContain('liveProgress(');
  });

  it('③ ⛔ 头部徽章子树内不得直调 computeIterStatsBadge(（算与投影必须分离）', () => {
    expect(badgeSlice).not.toContain('computeIterStatsBadge(');
  });
});

process.exit(summary('topbar_reactive'));

export {};
