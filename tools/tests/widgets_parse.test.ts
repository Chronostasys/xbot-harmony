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

// ⑤ ★ 诚实契约：原生当前**无组件渲染** zones/components ⇒ 常量必须为 false
eq('★ WIDGETS_RENDERABLE=false（未支持，非静默）', WIDGETS_RENDERABLE, false);

if (fail > 0) { console.log(`  widgets_parse: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  widgets_parse: ${pass} passed, 0 failed`);
process.exit(0);
