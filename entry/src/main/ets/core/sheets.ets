/**
 * sheets.ets —— 浮层面板「**可见性 flag 所有权**」的**唯一真相表**（纯逻辑，可脱机单测）。
 *
 * 为什么必须收进 `core/`（本文件是 2026-10-11 用户亲报「点 X 无反应」的**结构性修复**）：
 *   真机 P0：抽屉进入的「设置」面板（`pages/Index.ets` 的 `PrefsSheet`）**打开了关不掉**
 *   —— 它的**渲染 flag** 是 `showPrefs`（`build()` 里 `if (this.showPrefs)`），但它头部 X 的
 *   `onClick` 却写了**另一个面板**的 flag `showSettings` ⇒ 点 X 关的是别人，自己纹丝不动。
 *
 *   ⇒ 根因不是"没接线"，而是「**一个面板的关闭，写了别的面板的 flag**」——flag 所有权错配。
 *     只要"面板 id → 它**自己**的 flag"没有一处集中声明，这类错配就永远可能复发。
 *     本文件把这张对应关系收成**一张表 + 一个纯函数**，让"写错 flag"变成**可判定**的。
 *
 * 与铁律的关系：
 *   · flag 的**所有权仍留页面**（`@State` 在 `pages/Index.ets`）——本文件**只声明对应关系**，
 *     不持有状态、不 import ArkUI。`core/overlays.topOverlay` 依赖"flag 集中"，
 *     本表是它"每个 flag 恰好属于一个面板"这一前提的可测形式。
 *   · `closeFlagOf(id)` = 该面板**唯一**可写的 flag ⇒ 组件/页面的关闭分支只许引用它，
 *     ⛔ 不许再手写字面 flag 名。
 *
 * ⚠️ 本文件属 `core/` ⇒ 被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ **禁止** import ArkUI/`@ohos.*`。
 */

/** 一个浮层面板的规格：id + 它**自己**的可见性 flag +（可选）页面 `@Builder` 名 + 标题。 */
export class SheetSpec {
  /** 面板 id（与 `core/overlays.OverlayCode` 对齐，见 `overlays.ets`）。 */
  id: string;
  /** 该面板**渲染与关闭共用的、唯一**的页面 `@State` 名（flag 所有权的落点）。 */
  flag: string;
  /**
   * 渲染该面板的 `pages/Index.ets` `@Builder` 名；`''` = 在 `build()` 里**内联**渲染
   * （没有独立 `@Builder` ⇒ 源码级扫描跳过它）。
   */
  builder: string;
  /** 面向用户的标题（用于文档/断言可读性；不进渲染）。 */
  title: string;
  constructor(id: string, flag: string, builder: string, title: string) {
    this.id = id;
    this.flag = flag;
    this.builder = builder;
    this.title = title;
  }
}

/**
 * 全部**页面持有 flag** 的浮层面板（唯一真相）。
 *
 * ⛔ 顺序无关；id/flag 均**唯一**（由 `sheetsIssues()` 断言）。
 * ⚠️ 已抽出为独立组件的面板（`components/QueueSheet.ets` 等）其关闭走组件 `onClose`，
 *    flag 仍留页面 ⇒ 这里保留其 flag（它是页面 `overlayState()` 的输入），`builder=''`。
 */
export function sheetSpecs(): SheetSpec[] {
  return [
    new SheetSpec('drawer', 'showDrawer', 'DrawerSheet', '会话抽屉'),
    new SheetSpec('settings', 'showSettings', 'SettingsSheet', '设置'),
    new SheetSpec('prefs', 'showPrefs', 'PrefsSheet', '设置'),
    new SheetSpec('model', 'showModel', 'ModelSheet', '模型与上下文'),
    new SheetSpec('panels', 'showPanels', 'PanelsSheet', '面板'),
    new SheetSpec('settingsPanel', 'showSettingsPanel', '', '偏好设置（全屏）'),
    new SheetSpec('pluginHost', 'showPluginHost', '', '插件宿主'),
    new SheetSpec('queue', 'showQueue', '', '待发队列'),
    new SheetSpec('plugins', 'showPlugins', '', '能力面板'),
    new SheetSpec('selfCheck', 'showSelfCheck', '', '渲染自检'),
    new SheetSpec('status', 'showStatus', '', '状态'),
  ];
}

/** 按 id 取规格；未知 id ⇒ `undefined`（调用方据 `closeFlagOf` 的空串语义处理）。 */
export function sheetSpecOf(id: string): SheetSpec | undefined {
  const all: SheetSpec[] = sheetSpecs();
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === id) { return all[i]; }
  }
  return undefined;
}

/**
 * 该面板**唯一**可写的关闭 flag（`''` = 未知面板）。
 *
 * ⛔ 页面/组件的关闭分支必须经它取 flag 名——这是「写错 flag」的结构性防线。
 */
export function closeFlagOf(id: string): string {
  const s: SheetSpec | undefined = sheetSpecOf(id);
  return s === undefined ? '' : s.flag;
}

/** flag → 面板 id（`closeFlagOf` 的逆；`''` = 未知 flag）。 */
export function sheetIdOfFlag(flag: string): string {
  const all: SheetSpec[] = sheetSpecs();
  for (let i = 0; i < all.length; i++) {
    if (all[i].flag === flag) { return all[i].id; }
  }
  return '';
}

/** 页面 `@Builder` 名 → 面板 id（`''` = 非浮层面板的 builder，如 LoadingView）。 */
export function sheetIdOfBuilder(builder: string): string {
  const all: SheetSpec[] = sheetSpecs();
  for (let i = 0; i < all.length; i++) {
    if (all[i].builder.length > 0 && all[i].builder === builder) { return all[i].id; }
  }
  return '';
}

/**
 * 面板 flag 表的不变量（返回空数组 = 自洽）。逐条：
 *   ① id 非空且唯一；
 *   ② flag 非空且**唯一**（同一个 flag 不能属于两个面板 —— 否则"关错人"必然）；
 *   ③ **id ↔ flag 一一对应**（`closeFlagOf(sheetIdOfFlag(f)) === f` 且逆亦成立）。
 */
export function sheetsIssues(): string[] {
  const out: string[] = [];
  const all: SheetSpec[] = sheetSpecs();
  const ids: string[] = [];
  const flags: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const s: SheetSpec = all[i];
    if (s.id.length === 0) {
      out.push(`id 为空 @${i}`);
    } else if (ids.indexOf(s.id) >= 0) {
      out.push(`id 重复：${s.id}`);
    } else {
      ids.push(s.id);
    }
    if (s.flag.length === 0) {
      out.push(`flag 为空：${s.id}`);
    } else if (flags.indexOf(s.flag) >= 0) {
      out.push(`flag 重复（两个面板共用同一个 flag ⇒ 关错人）：${s.flag}`);
    } else {
      flags.push(s.flag);
    }
  }
  // id ↔ flag 双向一一对应
  for (let i = 0; i < all.length; i++) {
    const s: SheetSpec = all[i];
    if (s.id.length === 0 || s.flag.length === 0) { continue; }
    if (closeFlagOf(s.id) !== s.flag) {
      out.push(`closeFlagOf(${s.id}) ≠ ${s.flag}`);
    }
    if (sheetIdOfFlag(s.flag) !== s.id) {
      out.push(`sheetIdOfFlag(${s.flag}) ≠ ${s.id}`);
    }
  }
  return out;
}
