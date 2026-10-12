/**
 * pluginviews.ets —— **插件视图贡献点的原生渲染判据**（纯逻辑，零依赖，可脱机单测）。
 *
 * ── 为什么必须有这一层（2026-10-12，用户当场否掉"打开就是整个 web UI"的做法）──────
 *   插件的 `web.contributes[].kind='view'` 声明了"贡献到某个容器"的视图（web
 *   `plugin-api/manifest.ts:19-45`）。web 侧它们是**同页 ESM**，在宿主页里用 React 跑；
 *   原生无法执行插件 JS。此前原生对"要打开某个插件视图"只有一个出口 —— 把**权威宿主页
 *   （= 整个 web 应用）**塞进 `WebSurface`。真机实测的后果：点「迭代指标 → 打开」⇒ **整屏变成
 *   web 版的完整聊天应用**（不是"只渲染这个插件"）。用户明确否掉：
 *   「他是 web 实现你可以用 web，但是你不能把原生会话也变成 web view」。
 *
 *   ⇒ 正确做法：**能由宿主自己出数据、原生画得出的视图，一律原生渲染**（"只有插件本身"）。
 *   本模块就是这条路径的**唯一判据层**：把"哪些视图原生可渲染、渲染成什么"收敛到这里，
 *   组件只画（`docs/REDESIGN.md` §11「单一状态→视图管线」）。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────────────
 *   ⛔ 本文件属 `core/` ⇒ 被 `run.sh` 当**纯 TS** 编译：禁 import ArkUI / `@ohos.*`；
 *      禁无类型对象字面量（一律 `class`）；无 `any`。
 *   ⛔ 只产出**文案 / 角色名 / 数值**，不产出颜色（颜色由组件经 `core/design.ets:colorOf` 解析）。
 */
import { PluginCatalog, PluginCatalogItem, PluginViewItem } from './pluginhost';

// ══════════════════════════════════════════════════════════════════════════════
// ① 迭代指标（`xbot.iteration-stats`）—— 唯一的"纯宿主数据"型插件视图
// ══════════════════════════════════════════════════════════════════════════════
//
// ── 真源（逐字核对插件产物 `~/.xbot/plugins/builtin/xbot.iteration-stats/web/index.js`）──
//   · 徽章值 = 宿主的实时指标桥 `window.__xbot_iteration__.getGlobalLiveStats()`，
//     字段 `tokensPerSec` / `ttftMs`（web 侧由 `iteration-render.tsx` 注入；
//     原生的同一份数据来自 SSE `stream_stats`，落 `ProgressSnapshot.streamStats`）。
//   · `if (!tps || tps <= 0) return null` ⇒ **无速度就不显示**（不是显示 0）。
//   · 手机版（`sm:hidden`）文案 = `` `${tps.toFixed(0)}t/s${hasTTFT ? ` · ${fmtMs(ttft)}` : ''}` ``
//     —— 原生是手机，取这条（桌面版多 `tok/s`/`ttft` 词，见产物 `key:"desktop"`）。
//   · `hasTTFT = showTTFT && ttft !== undefined && ttft > 0`（`showTTFT` 来自插件配置，
//     默认 `true`；配置键与默认值见 `plugin.json` 的 `contributes.configuration`）。
//   · `fmtMs`：`ms<=0 ⇒ ''`；`<1000 ⇒ ${ms}ms`；否则 `${(ms/1000).toFixed(1)}s`。

/** 迭代指标插件的 id（真源：`plugin.json` 顶层 `id`）。 */
export const ITER_STATS_PLUGIN_ID: string = 'xbot.iteration-stats';
/** 迭代指标徽章的视图 id（真源：`plugin.json` 的 `web.contributes[0].id`）。 */
export const ITER_STATS_VIEW_ID: string = 'xbot.iteration-stats.badge';
/** 徽章所属容器（真源：`web.contributes[0].container`）—— 原生落点是**顶栏右侧**。 */
export const ITER_STATS_CONTAINER: string = 'status_bar_right';

/**
 * 毫秒 → 人类可读（逐字对齐插件产物的 `fmtMs`）。
 * `ms<=0` ⇒ 空串（"无数据"不是"0ms"）；`<1s` ⇒ `${ms}ms`；否则 `${(ms/1000).toFixed(1)}s`。
 */
export function fmtMs(ms: number): string {
  if (!(ms > 0)) {
    return '';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  // `toFixed(1)` 与插件产物同（2300 → "2.3s"）。
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 迭代指标徽章文案（**无速度 ⇒ 空串 = 不渲染**，对齐插件产物的 `return null`）。
 *
 * @param tokensPerSec 实时输出速度（`ProgressSnapshot.streamStats.tokensPerSec`；0/负 = 无数据）
 * @param ttftMs       首 token 延迟毫秒（同上，缺失/0 = 无数据）
 * @param showTTFT     插件配置 `showTTFT`（默认 true —— 只有显式 false 才隐藏 TTFT）
 */
export function iterStatsText(tokensPerSec: number, ttftMs: number, showTTFT: boolean): string {
  if (!(tokensPerSec > 0)) {
    return '';
  }
  const hasTTFT: boolean = showTTFT === true && ttftMs > 0;
  return `${tokensPerSec.toFixed(0)}t/s${hasTTFT ? ` · ${fmtMs(ttftMs)}` : ''}`;
}

/** 目录里是否存在**指定的视图 id**（原生渲染器的启用判据：装了且声明了该视图才渲染）。 */
export function hasView(catalog: PluginCatalog | null | undefined, viewId: string): boolean {
  if (catalog === undefined || catalog === null) {
    return false;
  }
  const items: PluginCatalogItem[] = catalog.items;
  for (let i = 0; i < items.length; i++) {
    const vs: PluginViewItem[] = items[i].views;
    for (let j = 0; j < vs.length; j++) {
      if (vs[j].id === viewId) {
        return true;
      }
    }
  }
  return false;
}

/** 目录里是否存在迭代指标徽章视图（顶栏原生 badge 的启用判据）。 */
export function hasIterStatsBadge(catalog: PluginCatalog | null | undefined): boolean {
  return hasView(catalog, ITER_STATS_VIEW_ID);
}
