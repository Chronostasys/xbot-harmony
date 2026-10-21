/**
 * 插件 widget 推送（`web_widgets` / `plugin_widgets`）解析的判别力测试。
 *
 * 现状（本测试钉死的"不静默丢"契约）：
 *   · 服务端 `channel/web/web.go:452 NotifyWidgetsUpdated` → hub 推 `MsgTypeWebWidgets`
 *     （`protocol/ws.go:27`；`plugin_widgets` 见 `:26`），content = JSON `{zones,components,revision}`；
 *   · web 同款解析在 `web/src/plugins/PluginWidgetProvider.tsx:63-74`；
 *   · 本仓旧链路：`core/normalize.ts` 的 `default: return null` + store 无分支 ⇒ **静默丢弃**。
 *
 * 判据：坏载荷/非 widget 事件必须 **`ok=false` 且 `reason` 非空**（可观测），绝不静默 return。
 * 把坏载荷改回"静默成功（ok=true）" ⇒ ★ 断言红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  WIDGETS_RENDERABLE, isWidgetEvent, parseWidgetsPayload, WidgetSnapshot,
} from '../../entry/src/main/ets/core/panels';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ① 事件名识别（复用 core/types.ets:236-237 的常量）
eq('web_widgets 是 widget 事件', isWidgetEvent('web_widgets'), true);
eq('plugin_widgets 是 widget 事件', isWidgetEvent('plugin_widgets'), true);
eq('progress_structured 不是', isWidgetEvent('progress_structured'), false);

// ② 合法载荷解析
{
  const snap: WidgetSnapshot = parseWidgetsPayload('web_widgets', JSON.stringify({
    zones: { infoBar: {}, git: {} },
    components: [{ id: 'c1', label: '信息条' }, { id: 'c2', title: 'Git 状态' }, { id: 'c3' }],
    revision: 7,
  }));
  eq('ok', snap.ok, true);
  eq('reason 空', snap.reason, '');
  eq('revision', snap.revision, 7);
  eq('zoneKeys 有序', snap.zoneKeys, ['git', 'infoBar']);
  eq('componentLabels（label>title>id）', snap.componentLabels, ['信息条', 'Git 状态', 'c3']);
}

// ③ ★ 坏载荷必须**显式失败**（不静默）
{
  const bad: WidgetSnapshot = parseWidgetsPayload('web_widgets', 'not-json{{');
  eq('★ 坏 JSON ⇒ ok=false', bad.ok, false);
  ok('★ 坏 JSON ⇒ reason 非空（可观测）', bad.reason.length > 0);
}
{
  const empty: WidgetSnapshot = parseWidgetsPayload('plugin_widgets', '');
  eq('空载荷 ⇒ ok=false', empty.ok, false);
  ok('空载荷 ⇒ reason 非空', empty.reason.length > 0);
}
{
  const wrong: WidgetSnapshot = parseWidgetsPayload('progress_structured', '{"zones":{}}');
  eq('非 widget 事件 ⇒ ok=false', wrong.ok, false);
  ok('非 widget 事件 ⇒ reason 非空', wrong.reason.length > 0);
}

// ④ 合法但空的载荷（`{}`）⇒ ok=true（是合法 JSON，只是没内容）
{
  const snap: WidgetSnapshot = parseWidgetsPayload('web_widgets', '{}');
  eq('{} ⇒ ok=true', snap.ok, true);
  eq('{} ⇒ revision 缺省 -1', snap.revision, -1);
  eq('{} ⇒ zoneKeys 空', snap.zoneKeys, []);
  eq('{} ⇒ componentLabels 空', snap.componentLabels, []);
}

// ⑤ ★ 诚实契约（2026-10-13 订正）：渲染层**已消费** zones/components ⇒ 常量必须为 `true`。
//
//    ⛔ 光钉常量值 = **纸面承诺**（把值改成 true 而渲染层仍不接线，测试照样绿）⇒ 必须**同时钉调用点**
//    （AGENTS.md「死消费」纪律：钉"方法体/文件存在"会**假绿**，钉**调用点计数**才有判别力）。
//    历史：这里曾钉 `false`（当时的诚实状态：解析在、UI 缺）；渲染层补齐后，常量 + 本断言 +
//    两份文档（`docs/RELEASE.md:98` / `RELEASE-NOTES.md:118`）**一同腐烂成假陈述**。
eq('★ WIDGETS_RENDERABLE=true（渲染层已接线）', WIDGETS_RENDERABLE, true);
{
  const fs = require('fs');
  const path = require('path');
  let root: string = __dirname;
  for (let i = 0; i < 10 && !fs.existsSync(path.join(root, 'entry', 'src', 'main', 'ets')); i++) {
    root = path.join(root, '..');
  }
  ok('⑤ 零扫描防线：仓库根可达', fs.existsSync(path.join(root, 'entry', 'src', 'main', 'ets')));
  /** 读一份源并**剥注释**（⛔ 注释里记录接线方式的散文会假绿）。 */
  const src = (rel: string): string =>
    fs.readFileSync(path.join(root, rel), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const countOf = (s: string, m: string): number => (m.length === 0 ? 0 : s.split(m).length - 1);
  const storeSrc: string = src('entry/src/main/ets/core/store.ets');
  const pageSrc: string = src('entry/src/main/ets/pages/Index.ets');
  const hostSrc: string = src('entry/src/main/ets/components/PluginHost.ets');
  // 链路四段，逐段钉**代码形态**：
  ok('⑤ store 命中 widget 事件 ⇒ 收下**原始串**（不解析 ⇒ 坏 JSON 也不丢）',
    storeSrc.indexOf('this.lastWidgetContent = data;') >= 0);
  ok('⑤ 页面把 store 字段转成渲染入参',
    pageSrc.indexOf('this.widgetContent = store.lastWidgetContent;') >= 0);
  ok('⑤ 聊天内联落点：WidgetDock 被**挂载**（不是"文件存在"）', countOf(pageSrc, 'WidgetDock({') >= 1);
  ok('⑤ 宿主全量卡：PluginWidgets 被**挂载**', countOf(hostSrc, 'PluginWidgets({') >= 1);
  // ⛔ 反例防线：同义旗标不得复活（双真源 = 历史上两个旗标互相打脸的直接原因）
  const wvSrc: string = src('entry/src/main/ets/core/widgetsview.ets');
  ok('⑤ ⛔ 同义旗标 WIDGETS_VIEW_SUPPORTED 已删（同一事实只有一个声明处）',
    countOf(wvSrc, 'WIDGETS_VIEW_SUPPORTED') === 0);
}

if (fail > 0) { console.log(`  widgets_parse: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  widgets_parse: ${pass} passed, 0 failed`);
process.exit(0);

export {};
