/**
 * 插件 widget **视图模型**（`core/widgetsview.ets`）的判别力测试。
 *
 * 权威基准（web）：
 *   · `PluginWidgetProvider.tsx:63-74`（载荷形状）· `WidgetZone.tsx:14-23,38-69`（zone/span/style）
 *   · `components.tsx:236-259`（声明式类型 + 未知类型降级）· `PluginComponentPanel.tsx:72-87`（code/src）
 *   · 服务端 `plugin/web_widget.go:12-37,81-116`
 *
 * ⚠️ 判别力自证（提交信息）：四条 mutation 分别必红 ——
 *   ② 把"未知类型"改成 `kind='badge'`（假装支持）⇒ ★② 红；
 *   ③ 让 `widgetsView` 丢掉 `revision` ⇒ ★③ 红；
 *   ④ 把 `visible` 恒置 true（产空壳）⇒ ★④ 红；
 *   ⑤ 把 code/src 分支删掉（静默当 badge）⇒ ★⑤ 红。
 *   （★① "坏载荷 ⇒ ok=false + reason" 已在 `widgets_parse.test.ts` 钉死，此处**不重复**。）
 */
declare const process: { exit: (c: number) => void };

import {
  KIND_BADGE, KIND_LIST, KIND_MARKDOWN, KIND_METRIC, KIND_PROGRESS, KIND_UNSUPPORTED,
  SUPPORTED_KINDS, WIDGET_EVENT_PLUGIN, WIDGET_EVENT_WEB,
  WidgetComponentView, WidgetZoneView, WidgetsView,
  degradeReasonForType, isSupportedKind, styleColorRole, toneColorRole, widgetZoneLabel, widgetsView,
} from '../../entry/src/main/ets/core/widgetsview';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const W = WIDGET_EVENT_WEB;

// ── 映射表（判据集中）──────────────────────────────────────────────────────────
eq('zone 名 → 显示名', widgetZoneLabel('infoBar'), '信息条');
eq('未知 zone 回落原名（不丢）', widgetZoneLabel('myZone'), 'myZone');
eq('style normal → textPrimary', styleColorRole('normal'), 'textPrimary');
eq('style dim → textMuted', styleColorRole('dim'), 'textMuted');
eq('style error → dangerText', styleColorRole('error'), 'dangerText');
eq('style 未知 → textPrimary（不透明）', styleColorRole('zzz'), 'textPrimary');
eq('tone success → successText', toneColorRole('success'), 'successText');
ok('支持 badge/progress/metric/list/markdown', isSupportedKind(KIND_BADGE)
  && isSupportedKind(KIND_PROGRESS) && isSupportedKind(KIND_METRIC)
  && isSupportedKind(KIND_LIST) && isSupportedKind(KIND_MARKDOWN));
eq('支持集 = 5 种', SUPPORTED_KINDS.length, 5);

// ── zones：span 透传 + 语义色角色 ──────────────────────────────────────────────
{
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    zones: { infoBar: [{ text: 'main', style: 'accent' }, { text: 'Δ3', style: 'warning' }], footer: [] },
    revision: 3,
  }));
  eq('ok', v.ok, true);
  eq('空分区已剔除（只剩 infoBar）', v.zones.length, 1);
  const z: WidgetZoneView = v.zones[0];
  eq('zone 名', z.name, 'infoBar');
  eq('zone 显示名', z.label, '信息条');
  eq('span 文本', z.spans.map((s) => s.text), ['main', 'Δ3']);
  eq('span 色角色（accent/warning）', z.spans.map((s) => s.colorRole), ['accentSoft', 'statusWaiting']);
  eq('有内容 ⇒ visible', v.visible, true);
}

// ── 声明式组件：已实现类型逐字段 ───────────────────────────────────────────────
{
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    components: [
      { widget_id: 'b1', title: '状态', slot: 'panel', component: { type: 'badge', props: { text: 'ok', tone: 'success' } } },
      { widget_id: 'p1', slot: 'panel', component: { type: 'progress', props: { value: 30, max: 60, label: '进度' } } },
      { widget_id: 'm1', slot: 'panel', component: { type: 'metric', props: { label: 'CPU', value: '42%', delta: '-3' } } },
      { widget_id: 'l1', slot: 'panel', component: { type: 'list', props: { title: 'T', items: [{ key: 'a', value: '1', tone: 'error' }] } } },
      { widget_id: 'k1', slot: 'panel', component: { type: 'markdown', props: { content: 'hi' } } },
    ],
  }));
  eq('组件数', v.components.length, 5);
  eq('badge kind', v.components[0].kind, KIND_BADGE);
  eq('badge text/tone', [v.components[0].badgeText, v.components[0].tone], ['ok', 'success']);
  eq('progress value/max/label', [v.components[1].progressValue, v.components[1].progressMax, v.components[1].progressLabel], [30, 60, '进度']);
  eq('metric label/value/delta', [v.components[2].metricLabel, v.components[2].metricValue, v.components[2].metricDelta], ['CPU', '42%', '-3']);
  eq('list title + 1 条（key/value/tone）', [v.components[3].listTitle, v.components[3].listItems.length, v.components[3].listItems[0].tone], ['T', 1, 'error']);
  eq('markdown text', v.components[4].markdownText, 'hi');
  // 数值强制（字符串数字）
  const v2: WidgetsView = widgetsView(W, JSON.stringify({
    components: [{ widget_id: 'p', slot: 'panel', component: { type: 'progress', props: { value: '25' } } }],
  }));
  eq('字符串数字被强制', v2.components[0].progressValue, 25);
  eq('max 缺省 100', v2.components[0].progressMax, 100);
}

// ── ★② 未知 component 类型 ⇒ **降级态**（可见占位 + reason），不崩、不静默 ────────
{
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    components: [{ widget_id: 'x', slot: 'panel', component: { type: 'quantum_flux', props: {} } }],
  }));
  eq('★② 未知类型 ⇒ kind=unsupported', v.components[0].kind, KIND_UNSUPPORTED);
  ok('★② 未知类型 ⇒ reason 非空（可观测，不静默）', v.components[0].reason.length > 0);
  ok('★② 降级占位**算内容**（visible）', v.visible === true && v.components[0].empty === false);
  ok('★② reason 含类型名（可诊断）', v.components[0].reason.indexOf('quantum_flux') >= 0);
}
{
  // sparkline/table 是 web **真有**的类型 —— 原因是"原生未实现"，与"未知"区分
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    components: [
      { widget_id: 's', slot: 'panel', component: { type: 'sparkline', props: {} } },
      { widget_id: 't', slot: 'panel', component: { type: 'table', props: {} } },
    ],
  }));
  eq('sparkline ⇒ unsupported', v.components[0].kind, KIND_UNSUPPORTED);
  ok('sparkline ⇒ reason 说"暂未实现"', v.components[0].reason.indexOf('暂未实现') >= 0);
  ok('table ⇒ reason 说"暂未实现"', v.components[1].reason.indexOf('暂未实现') >= 0);
  ok('"未实现" ≠ "未知"（措辞区分）', degradeReasonForType('table').indexOf('未知') < 0
    && degradeReasonForType('zzz').indexOf('未知') >= 0);
}

// ── ★⑤ code / src ⇒ 显式降级（沙箱 iframe 原生不支持），不当 badge 静默处理 ──────
{
  const v: WidgetsView = widgetsView(W, JSON.stringify({
    components: [
      { widget_id: 'c', slot: 'panel', code: 'export default () => null' },
      { widget_id: 'u', slot: 'panel', src: 'https://example.com/w.js' },
    ],
  }));
  eq('★⑤ code ⇒ unsupported', v.components[0].kind, KIND_UNSUPPORTED);
  ok('★⑤ code ⇒ reason 非空且**特指沙箱**（不是笼统"缺 component"）',
    v.components[0].reason.length > 0 && v.components[0].reason.indexOf('沙箱') >= 0);
  eq('★⑤ src ⇒ unsupported', v.components[1].kind, KIND_UNSUPPORTED);
  ok('★⑤ src ⇒ reason 非空且**特指沙箱**',
    v.components[1].reason.length > 0 && v.components[1].reason.indexOf('沙箱') >= 0);
}

// ── ★③ revision 变更 ⇒ 视图模型更新（幂等：同输入同输出）────────────────────────
{
  const c1: string = JSON.stringify({ zones: { infoBar: [{ text: 'a' }] }, revision: 1 });
  const c2: string = JSON.stringify({ zones: { infoBar: [{ text: 'a' }] }, revision: 2 });
  const a: WidgetsView = widgetsView(W, c1);
  const b: WidgetsView = widgetsView(W, c2);
  eq('★③ revision 透传（1）', a.revision, 1);
  eq('★③ revision 透传（2，变更可见）', b.revision, 2);
  ok('★③ 仅 revision 变 ⇒ 其余视图一致', JSON.stringify({ ...a, revision: 0 }) === JSON.stringify({ ...b, revision: 0 }));
  // 幂等：同输入两次 ⇒ 深等
  eq('★③ 幂等（同输入同输出）', JSON.stringify(widgetsView(W, c2)), JSON.stringify(b));
}

// ── ★④ 空 zones ⇒ **不渲染空壳** ──────────────────────────────────────────────
{
  eq('★④ {zones:{}} ⇒ visible=false', widgetsView(W, '{"zones":{}}').visible, false);
  eq('★④ {} ⇒ visible=false', widgetsView(W, '{}').visible, false);
  eq('★④ 全空分区 ⇒ visible=false', widgetsView(W, '{"zones":{"infoBar":[]},"components":[]}').visible, false);
  eq('★④ 空载荷内容 ⇒ visible=false', widgetsView(W, '').visible, false);
  // 反例：有内容 ⇒ true（防"恒 false"的假绿）
  eq('★④ 有 span ⇒ visible=true', widgetsView(W, '{"zones":{"infoBar":[{"text":"x"}]}}').visible, true);
  // 空 markdown（web `components.tsx:220-222` return null）不算内容
  eq('★④ 仅空 markdown ⇒ visible=false', widgetsView(W, '{"components":[{"widget_id":"m","slot":"panel","component":{"type":"markdown","props":{}}}]}').visible, false);
}

// ── 坏载荷（非空）⇒ 可见降级行（**绝不静默**）；空载荷 ⇒ 不产空壳 ────────────────
{
  const bad: WidgetsView = widgetsView(W, 'not-json{{');
  eq('坏载荷 ⇒ ok=false', bad.ok, false);
  ok('坏载荷 ⇒ reason 非空', bad.reason.length > 0);
  eq('坏载荷（非空内容）⇒ visible（显式降级行）', bad.visible, true);
  // plugin_widgets 事件同样可行
  const pl: WidgetsView = widgetsView(WIDGET_EVENT_PLUGIN, '{"zones":{"infoBar":[{"text":"p"}]}}');
  eq('plugin_widgets 事件可用', pl.visible, true);
}

if (fail > 0) { console.log(`  widgets_view: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  widgets_view: ${pass} passed, 0 failed`);
process.exit(0);
