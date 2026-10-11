/**
 * 行查询的**纯函数**（`pages/Index.ets` 的行集合查询出口）。
 *
 * ── 为什么必须有（2026-10-11「状态双写/派生不一致」审计）────────────────────────────────
 * 页面曾把 rewind 的编辑目标存成**两个 id**（`rewindEditRowId` **和** `rewindEditTurnID`）+
 * 一份内容快照（`rewindEditOriginal`）—— 同一行**三个来源**，`begin/cancel/submit` **三处必须同步**，
 * 漏一处就漂移（这类"脆"迟早变"漂移"）。
 * 收敛方式：**只存行 id**，`turnID` / `content` 用时**由行查得** —— 本函数即那条查询。
 *
 * ⛔ 本文件属 `core/` ⇒ 被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ **禁止** import ArkUI/`@ohos.*`。
 */
import { ChatRow } from './types';

/**
 * 按行 id 查行（**唯一**：全表线性扫；未命中 ⇒ `undefined`）。
 * ⚠️ `id` 为空串 ⇒ 立即 `undefined`（"无编辑目标"的静息态，⛔ 不返回"第一个空 id 行"）。
 */
export function rowById(rows: ChatRow[], id: string): ChatRow | undefined {
  if (id.length === 0) {
    return undefined;
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) {
      return rows[i];
    }
  }
  return undefined;
}
