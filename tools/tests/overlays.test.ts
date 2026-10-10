/**
 * 浮层栈 + 「↓ 回到最新」判据的**纯逻辑**回归守卫。
 *
 * 背景（2026-10-10 交互对齐，参照 web）：
 *   · web 用 `Esc` 关最上层 dialog/popover（Radix 默认）；HarmonyOS 的平台等价物是
 *     **返回键**。原生端此前**完全没有**返回键处理 ⇒ 任何浮层打开时按返回直接退出
 *     应用（web 是"关弹窗"，语义不一致且会误退）。
 *   · web 的模态都有 backdrop 点击关闭；原生端多个 sheet 此前点空白无反应。
 *
 * 本用例钉死两件事：
 *   1. `topOverlay` 永远返回**渲染 z 序最上层**那个（逆序），且无浮层时返回 ''；
 *   2. `showsJumpToLatest` **贴底不显示**、空列表不显示。
 */
declare const process: { exit: (c: number) => void };

import { describe, expect, it, summary } from './vitest_shim';
import { OverlayState, hasOverlay, topOverlay } from '../../entry/src/main/ets/core/overlays';
import { showsJumpToLatest } from '../../entry/src/main/ets/core/indicators';

function ov(over: Partial<OverlayState>): OverlayState {
  return {
    drawer: false, settings: false, queue: false, plugins: false, selfCheck: false,
    status: false, model: false, prefs: false, panels: false, sessMenu: false,
    searchHits: false, ctxMenu: false, image: false, webPanel: false,
    ...over,
  };
}

describe('浮层栈：返回键先关最上层（web Esc 语义）', () => {
  it('无浮层 ⇒ 返回键交还系统', () => {
    expect(topOverlay(ov({}))).toBe('');
    expect(hasOverlay(ov({}))).toBe(false);
  });

  it('单层浮层：每个开关都能被返回键关掉', () => {
    expect(topOverlay(ov({ drawer: true }))).toBe('drawer');
    expect(topOverlay(ov({ settings: true }))).toBe('settings');
    expect(topOverlay(ov({ queue: true }))).toBe('queue');
    expect(topOverlay(ov({ plugins: true }))).toBe('plugins');
    expect(topOverlay(ov({ selfCheck: true }))).toBe('selfCheck');
    expect(topOverlay(ov({ status: true }))).toBe('status');
    expect(topOverlay(ov({ model: true }))).toBe('model');
    expect(topOverlay(ov({ prefs: true }))).toBe('prefs');
    expect(topOverlay(ov({ panels: true }))).toBe('panels');
    expect(topOverlay(ov({ sessMenu: true }))).toBe('sessMenu');
    expect(topOverlay(ov({ searchHits: true }))).toBe('searchHits');
    expect(topOverlay(ov({ ctxMenu: true }))).toBe('ctxMenu');
    expect(topOverlay(ov({ image: true }))).toBe('image');
    expect(topOverlay(ov({ webPanel: true }))).toBe('webPanel');
  });

  it('多层叠加：返回键关【最后渲染】（z 序最上）那层，不被下层抢走', () => {
    // drawer 在最下层、webPanel 在最上层 ⇒ 先关 webPanel
    expect(topOverlay(ov({ drawer: true, settings: true, webPanel: true }))).toBe('webPanel');
    // 去掉最上层 ⇒ 轮到 image
    expect(topOverlay(ov({ drawer: true, settings: true, image: true }))).toBe('image');
    // 再逐层：ctxMenu > sessMenu > panels > prefs > model
    expect(topOverlay(ov({ drawer: true, ctxMenu: true, panels: true }))).toBe('ctxMenu');
    expect(topOverlay(ov({ drawer: true, sessMenu: true, panels: true }))).toBe('sessMenu');
    expect(topOverlay(ov({ panels: true, prefs: true }))).toBe('panels');
    expect(topOverlay(ov({ prefs: true, model: true }))).toBe('prefs');
    expect(topOverlay(ov({ model: true, status: true }))).toBe('model');
    expect(topOverlay(ov({ status: true, selfCheck: true }))).toBe('status');
    expect(topOverlay(ov({ selfCheck: true, plugins: true }))).toBe('selfCheck');
    expect(topOverlay(ov({ plugins: true, queue: true }))).toBe('plugins');
    expect(topOverlay(ov({ queue: true, settings: true }))).toBe('queue');
    expect(topOverlay(ov({ settings: true, drawer: true }))).toBe('settings');
  });

  it('AskUser 不在浮层栈里（服务端权威必答，不允许返回键关掉）', () => {
    // OverlayState 根本没有 askUser 字段 ⇒ 无法被关（类型即约束）。
    const o: OverlayState = ov({});
    expect(topOverlay(o)).toBe('');
  });
});

describe('「↓ 回到最新」判据：贴底/空列表都不显示', () => {
  it('贴底 ⇒ 不显示', () => {
    expect(showsJumpToLatest(true, 5)).toBe(false);
  });
  it('不在底部且有内容 ⇒ 显示', () => {
    expect(showsJumpToLatest(false, 5)).toBe(true);
  });
  it('空列表 ⇒ 不显示（即使不在底部）', () => {
    expect(showsJumpToLatest(false, 0)).toBe(false);
  });
});

process.exit(summary('overlays'));
