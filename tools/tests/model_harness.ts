/**
 * tools/tests/model_harness.ts —— 判据侧的**唯一入口**：wire 事件 → 模型状态 → 渲染行。
 *
 * ⛔ 判据必须与生产同源（`model_bridge.stepEvent` + `applyModel`），否则会出现
 *   「判据绿、真机红」——旧判据走的是已删除的 `deriveRows + applyRow` 链路。
 *
 * 用法：
 *   const f = new ModelFeed('chat_x');
 *   f.pushAll(EVS);
 *   const rows = f.rows();          // ChatRow[]（身份稳定，可反复取）
 *   const st = f.state;             // 模型 State（turns/live/...）
 */
import { emptyState } from './model_types';
import type { State } from './model_types';
import { stepEvent, applyModel } from './model_bridge';
import { ChatRow } from './types';

export class ModelFeed {
  private st: State;
  private cache: Map<string, ChatRow> = new Map<string, ChatRow>();

  constructor(chat: string = 'chat') {
    this.st = emptyState(chat, 1, 0);
  }

  /** 喂一帧（wire 事件；`history_replaced` 走权威水合）。 */
  push(ev: unknown): ModelFeed {
    this.st = stepEvent(this.st, ev as never, this.st.chat).state;
    return this;
  }

  pushAll(evs: readonly unknown[]): ModelFeed {
    for (let i = 0; i < evs.length; i++) {
      this.push(evs[i]);
    }
    return this;
  }

  get state(): State {
    return this.st;
  }

  /** 投影成渲染行（与页面 `store.rebuildRows` 同一条路径）。 */
  rows(): ChatRow[] {
    return applyModel(this.st, this.cache);
  }

  /** 按行 id 取一行（找不到返回 undefined）。 */
  row(id: string): ChatRow | undefined {
    const rows: ChatRow[] = this.rows();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === id) {
        return rows[i];
      }
    }
    return undefined;
  }
}
