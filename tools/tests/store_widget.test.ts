/**
 * `ChatStore` 的**插件 widget 直通**（`lastWidgetEvent` / `lastWidgetContent`）判别力测试。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────────
 * widget 载荷（SSE `web_widgets` / `plugin_widgets`）**不是** `DomainEvent`：
 * `core/normalize.ts` / `core/reduce.ts` 都没有 widget 分支 ⇒ 若落进状态机只会被**静默丢弃**，
 * 页面永远不知道有 plugin widget。`ChatStore.onSse` 因此在 `JSON.parse` **之前**加了一个
 * 「收下来 + `onUpdate()` + 早退」的分支 —— 本文件把该分支的**每条不变量**钉住。
 *
 * ── 判别力自证（见交付，改坏必红/还原必绿）──────────────────────────────────────
 *   ★A 去掉早退分支（载荷交给 normalize/reduce）⇒ 红（字段恒空）
 *   ★B 把 `return` 挪到 `JSON.parse` 之后       ⇒ 红（坏 JSON 时 catch 先返回 ⇒ 字段没设）
 *   ★C 删 `onUpdate()`                           ⇒ 红（页面不会重渲）
 *   ★D 喂普通 DomainEvent                        ⇒ 字段**不变**（防误吞正常事件）
 *   ★E 喂近名事件 `web_widget`（少一个 s）       ⇒ 字段**不变**（白名单不许放宽）
 *   ★F 删 `openSession` 的两行复位               ⇒ 红（切会话后仍显示上一会话的 widget = 串台）
 *
 * ⚠️ 本测试**不用**私有成员 hack：它把 `store.sse.connect` 收到的 listener 捕获下来，
 *    再调用它 ⇒ 走的是**真 `ChatStore.onSse`**（真函数、真分支），不是读源码文本。
 *    `openSession` 内部会拉历史/队列/状态/会话列表 ⇒ ★F 先把这 4 个方法 stub 成空实现（断网）。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { SseListener } from '../../entry/src/main/ets/core/sse';
import { SseEventType } from '../../entry/src/main/ets/core/types';
import { isWidgetEvent } from '../../entry/src/main/ets/core/panels';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

/**
 * 测试夹具：构造真 `ChatStore`，把 `sse.connect` 的 listener 截下来，
 * 从而能**直接喂 SSE 帧**进 `onSse`（不触网、不碰私有成员）。
 */
class Harness {
  store: ChatStore;
  sink: SseListener | null = null;
  updates: number = 0;

  constructor() {
    this.store = new ChatStore('http://example.invalid');
    this.store.onUpdate = () => {
      this.updates++;
    };
    this.store.sse.connect =
      (_chatId: string, _channel: string, _cookie: string, listener: SseListener): void => {
        this.sink = listener;
      };
    this.store.currentChatId = 'chat-1';
    this.store.subscribe();
  }

  /** 投递一帧（真进 `onSse`）。 */
  feed(event: string, data: string): void {
    if (this.sink !== null) {
      this.sink(event, data);
    }
  }

  /** 断网：`openSession` 内部会拉会话列表/历史/队列/状态 ⇒ 全部 stub 成空实现（本测试只关心复位）。 */
  offline(): void {
    this.store.loadSessions = async (): Promise<void> => {
    };
    this.store.loadHistory = async (): Promise<void> => {
    };
    this.store.loadQueue = async (): Promise<void> => {
    };
    this.store.loadStatus = async (): Promise<void> => {
    };
  }
}

async function main(): Promise<void> {
  // ── 白名单本身（`core/panels.isWidgetEvent`）─────────────────────────────────
  ok('白名单只认 web_widgets / plugin_widgets',
    isWidgetEvent('web_widgets') && isWidgetEvent('plugin_widgets')
    && !isWidgetEvent('web_widget') && !isWidgetEvent('plugin_widget') && !isWidgetEvent('widgets'));

  // ── 起点：未收到任何 widget ⇒ 两字段为空（组件据此判 visible=false ⇒ 零节点）────
  {
    const h = new Harness();
    ok('sink 已捕获（真 onSse 可达）', h.sink !== null);
    eq('起点 lastWidgetEvent 为空', h.store.lastWidgetEvent, '');
    eq('起点 lastWidgetContent 为空', h.store.lastWidgetContent, '');
  }

  // ── ★A widget 载荷被收下（对照：没有早退分支时它会被 normalize 静默丢弃）───────
  {
    const h = new Harness();
    const payload: string = '{"zones":{"infoBar":[{"text":"main","style":"accent"}]},"revision":3}';
    h.feed(SseEventType.webWidgets, payload);
    eq('★A web_widgets ⇒ 事件名留存', h.store.lastWidgetEvent, 'web_widgets');
    eq('★A web_widgets ⇒ 原始载荷逐字留存', h.store.lastWidgetContent, payload);

    // 后到的覆盖先到的（页面只显示"最新一次"）
    h.feed(SseEventType.pluginWidgets, '{"revision":2}');
    eq('★A 后到的 plugin_widgets 覆盖前值',
      [h.store.lastWidgetEvent, h.store.lastWidgetContent], ['plugin_widgets', '{"revision":2}']);
  }

  // ── ★B 坏 JSON 也必须留原串（早退发生在 JSON.parse 之前）─────────────────────
  {
    const h = new Harness();
    h.feed(SseEventType.pluginWidgets, 'NOT-JSON{{{');
    eq('★B 坏载荷仍留存事件名（解析前早退）', h.store.lastWidgetEvent, 'plugin_widgets');
    eq('★B 坏载荷原串逐字留存（交给消费方显式降级）', h.store.lastWidgetContent, 'NOT-JSON{{{');
  }

  // ── ★C 每个 widget 事件各通知页面一次 ────────────────────────────────────────
  {
    const h = new Harness();
    eq('起点未通知', h.updates, 0);
    h.feed(SseEventType.webWidgets, '{"revision":1}');
    const after1: number = h.updates;
    h.feed(SseEventType.pluginWidgets, '{"revision":2}');
    const after2: number = h.updates;
    eq('★C 每个 widget 事件各触发一次 onUpdate', [after1, after2], [1, 2]);
  }

  // ── ★D 普通 DomainEvent 不得被误吞（字段不变），且仍被正常处理 ───────────────
  {
    const h = new Harness();
    h.feed(SseEventType.webWidgets, '{"revision":9}');
    const ev: string = h.store.lastWidgetEvent;
    const ct: string = h.store.lastWidgetContent;
    const before: number = h.updates;
    h.feed(SseEventType.askUserResolved, '{}');      // 一个真·普通事件（走 askUserResolved 分支）
    eq('★D 普通事件后 widget 事件名不变', h.store.lastWidgetEvent, ev);
    eq('★D 普通事件后 widget 载荷不变', h.store.lastWidgetContent, ct);
    ok('★D 普通事件确实跑完了（onUpdate 被调 ⇒ 没被 widget 分支吞掉）', h.updates > before);
  }

  // ── ★E 近名事件（`web_widget`，少一个 s）不得误判 ────────────────────────────
  {
    const h = new Harness();
    h.feed(SseEventType.webWidgets, '{"revision":1}');
    const ev: string = h.store.lastWidgetEvent;
    const ct: string = h.store.lastWidgetContent;
    h.feed('web_widget', '{"revision":2}');
    eq('★E 「web_widget」不被认作 widget 事件', h.store.lastWidgetEvent, ev);
    eq('★E 「web_widget」不覆盖载荷', h.store.lastWidgetContent, ct);
    h.feed('plugin_widget', '{"revision":3}');
    eq('★E 「plugin_widget」亦不被认作 widget 事件', h.store.lastWidgetContent, ct);
  }

  // ── ★F 会话切换必须复位 widget 载荷（否则串台：切到 B 仍显示 A 的 widget）──────
  {
    const h = new Harness();
    h.offline();                                   // openSession 内部拉取全部 stub 掉
    h.feed(SseEventType.webWidgets, '{"revision":1,"from":"A"}');
    eq('★F 切会话前：A 的载荷在', [h.store.lastWidgetEvent, h.store.lastWidgetContent],
      ['web_widgets', '{"revision":1,"from":"A"}']);
    await h.store.openSession('chat-B');
    eq('★F openSession(B) ⇒ lastWidgetEvent 清空（不串台）', h.store.lastWidgetEvent, '');
    eq('★F openSession(B) ⇒ lastWidgetContent 清空（不串台）', h.store.lastWidgetContent, '');
  }
}

main().then(() => {
  console.log(`\nstore_widget.test.ts: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}).catch((e) => {
  console.log(`  ✗ 未捕获异常：${e}`);
  process.exit(1);
});
