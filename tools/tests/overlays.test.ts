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
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

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

// ── 贴底**位置闸门**（`atEnd` 第三参）：压制弹性过滚动期间的"闪现"（2026-10-12 用户亲报）──
// 用户原话：「药丸只在**刚好**在最下方才不渲染；容器有弹性，**向下过滚动时它还会出现**，
//   自动回正之后才消失」。根因：`EdgeEffect.Spring` 过滚动期间滚动帧会把跟随意图置暂停，
//   而视口其实还在末尾 ⇒ 药丸闪现。闸门 = 页面在**滚动停止**时缓存的 `isAtEnd()`。
// ⛔ 实测：过滚动期间直接调 `isAtEnd()` 判**假** ⇒ 不能当这一闸门（必须在 onScrollStop 采样）。
// 判别力（mutation）：删掉 `if (atEnd === true) return false;` ⇒ 第 ① 条立即红。
describe('「↓ 回到最新」贴底位置闸门（防弹性过滚动闪现）', () => {
  it('① 暂停 + 有内容，但**视口仍在末尾** ⇒ ⛔ 不显示（防过滚动闪现）', () => {
    expect(showsJumpToLatest(false, 5, true)).toBe(false);
  });
  it('② 暂停 + 有内容 + **确实离开了末尾** ⇒ 显示', () => {
    expect(showsJumpToLatest(false, 5, false)).toBe(true);
  });
  it('③ 省略 atEnd（旧调用点/回归）⇒ 行为与两参版完全一致', () => {
    expect(showsJumpToLatest(true, 5)).toBe(false);
    expect(showsJumpToLatest(false, 5)).toBe(true);
    expect(showsJumpToLatest(false, 0)).toBe(false);
  });
  it('④ 跟随时（atBottom=true）闸门不得把药丸"放出来"', () => {
    expect(showsJumpToLatest(true, 5, false)).toBe(false);
  });
});

// ── 「回到最新」呈现形态（目标③ 批13g）：**悬浮提示**，不占布局行 ──────────────────────
// 用户亲报：「回到最新那个 popup 应该是悬浮提示，而不是单独占一片区域 / 不该挤压我们的历史」。
// 旧实现把药丸放在消息区**下方**的一个全宽 `Row` 里 ⇒ 吃掉一行高度、把列表顶短。
// 新形态：药丸叠在消息区**之上**（`Stack` 内），贴底居中、容器全屏透明 + `hitTestBehavior(Transparent)`
//   ⇒ 不占布局、不挡列表；命中盒 ≥ HIT_TARGET_MIN（⛔ 不用真机无效的 `responseRegion` 外扩）。
describe('「回到最新」= 悬浮提示（叠层；不占布局行、不挤压历史）', () => {
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
  const anchor: number = src.indexOf("Text('回到最新')");
  const start: number = anchor > 0 ? src.lastIndexOf('if (showsJumpToLatest(', anchor) : -1;
  const stop: number = anchor > 0 ? src.indexOf('.hitTestBehavior', anchor) : -1;
  const slice: string = start > 0 && stop > start ? src.slice(start, stop + 64) : '';

  it('零扫描防线：读到源码、定位到「回到最新」子树', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(anchor).toBeGreaterThan(0);
    expect(slice.length).toBeGreaterThan(150);
  });

  it('悬浮层：全屏透明容器 + 底对齐（justifyContent End）+ hitTestBehavior(Transparent)', () => {
    expect(slice).toContain("height('100%')");
    expect(slice).toContain('justifyContent(FlexAlign.End)');
    expect(slice).toContain('hitTestBehavior(HitTestMode.Transparent)');
  });

  it('命中盒 ≥44：onClick 落在 constraintSize({ minHeight: HIT_TARGET_MIN }) 的布局盒上', () => {
    expect(slice).toContain('constraintSize({ minHeight: HIT_TARGET_MIN })');
  });

  it('⛔ 不用失效的 responseRegion 外扩热区（真机实测不生效）', () => {
    expect(slice).not.toContain('responseRegion');
  });

  it('⛔ 不再是「全宽居中」的布局行（旧形态 = justifyContent(FlexAlign.Center)）', () => {
    expect(slice).not.toContain('FlexAlign.Center');
  });
});

process.exit(summary('overlays'));
