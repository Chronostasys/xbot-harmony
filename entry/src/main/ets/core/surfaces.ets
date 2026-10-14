/**
 * surfaces.ets —— 每个**能力面**的唯一承载（native / web）判定，**单一真源**。
 *
 * 用户定向（2026-10-16）原话：
 *   「目前 web 和原生混杂太丑了，**如果有原生就不要搞 web**，统一，**一个页面必须只有一个形态**，
 *    别他妈入口不同展示的不同。架构要优秀统一」
 *
 * 为什么必须有这张表（而不是各入口自己判断）：本仓此前同一能力面有多条入口、各自决定走原生还是
 * 走 WebView（`?xbot_panel=<id>`）⇒ 用户从 A 入口看到原生面板、从 B 入口看到 web 面板（形态不同、
 * 观感割裂、能力还可能不一致）。⇒ 规则收敛成两件事：
 *   · **判定**只有这一张表（`surfaceOf`）：`native` 的能力面**禁止**再开 web 面板；
 *   · **动作**只有页面一个出口（`pages/Index.openSurface(id)`）⇒ 任何新入口自动拿到同一形态。
 *
 * ⛔ 本文件**不读** `pal()`/主题/任何全局（纯逻辑 ⇒ 可脱机单测 + mutation 自证）。
 * 判据：`tools/tests/surfaces.test.ts`。
 */

/** 承载方式取值（字符串常量而非 enum：与设置项 `KEY_SURFACE` 的 'native'/'web' 逐字一致）。 */
export const SURFACE_NATIVE: string = 'native';
export const SURFACE_WEB: string = 'web';

/** 能力面 id（⛔ 与 `core/pluginhost.WEB_PANEL_IDS` 的 web 面板 id 逐字对齐，便于双向审计）。 */
export const SURF_FILES: string = 'files';
export const SURF_TASKS: string = 'tasks';
export const SURF_TERMINAL: string = 'terminal';
export const SURF_PLUGINS: string = 'plugins';
export const SURF_GENUI: string = 'genui';
export const SURF_WEBUI: string = 'webui';

/**
 * 该能力面的**唯一形态**。
 *
 * 规则（用户定向的直译）：
 *   · 仓里**已有原生实现**的能力面（文件 / 任务 / 终端）⇒ `native`，⛔ 从任何入口都不得再开 web 面板；
 *   · **本质就是 web** 的面（插件目录 / 插件宿主页 / GenUI 面板 / 完整 Web UI）⇒ `web`；
 *   · 未知 id ⇒ `web`（fail-safe：不凭空发明一条原生路径；web 面板自身是通用兜底）。
 */
export function surfaceOf(id: string): string {
  switch (id) {
    case SURF_FILES:
    case SURF_TASKS:
    case SURF_TERMINAL:
      return SURFACE_NATIVE;
    case SURF_PLUGINS:
    case SURF_GENUI:
    case SURF_WEBUI:
      return SURFACE_WEB;
    default:
      return SURFACE_WEB;
  }
}

/** 该 id 是否已收敛到原生（入口审计用：真源仍是 `surfaceOf`）。 */
export function isNativeSurface(id: string): boolean {
  return surfaceOf(id) === SURFACE_NATIVE;
}
