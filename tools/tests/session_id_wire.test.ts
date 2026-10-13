/**
 * 会话 id **出网规范化**接线门禁 —— `core/store.ets` / `components/SettingsDeveloper.ets` 的调用点证据。
 *
 * ── 背景（2026-10-13 服务端对照实验，真机实测）──────────────────────────────────────
 *   服务端把会话键一律组装成 `channel + ":" + chat_id`（48 处）⇒ **期望裸 id**（web 同款语义：
 *   `s.chatID` 裸、`${channel}:${chatID}` 才是键）。而本仓 `store.currentChatId` 是**全键**
 *   （`/api/session-tree` 的 `is_current` 行 `chat_id` 字段自带渠道前缀）⇒ 出网组装成
 *   `web:web:chat_…`，落到**幽灵会话**：
 *     · `/api/cron/list` 裸 ✅ / 全键 `null`；`/api/tasks/list` 裸 ✅ 真任务 / 全键 `[]`；
 *     · `/api/session/status` 裸 ✅ 正确 cwd+todos / 全键 空 todos + 默认 cwd `/Users/bobli`。
 *   ⇒ 用户可见：**定时/后台任务面板结构性永远空**（"任务管理做的很差"的真根因）、开发者面板显示
 *   `web:web:chat_…`。修复 = 出网一律走 `wireChatId()`（`canonicalChatId` 的实例包装）。
 *
 * ── 钉什么 ────────────────────────────────────────────────────────────────────
 *   ① 零扫描判红：两文件真读到；store 里出网规范化调用点 ≥ 8。
 *   ② **不许回退**：store 里 `new SessionReq(this.channel, this.currentChatId)` /
 *      `'chat_id': this.currentChatId` / `'chatID': this.currentChatId` **各 0 处**。
 *   ③ store 确实消费了 `canonicalChatId`（import 1 处 + 使用 ≥ 1 处，switch 路径内联）。
 *   ④ SettingsDeveloper：导出参数用 `canonicalChatId(...)`、标签用 `sessionDisplayKey(...)` 各 1 处；
 *      且**不得**再出现 `` `${this.channel}:${this.chatID}` ``（双写形态）。
 *
 * ⚠️ 纪律：剥注释（注释里写这些形态是文档，不是调用点）；计数精确 `=== n`；切片按**文件**分。
 * ✅ 判据自证（mutation）：把任一出网点改回 `this.currentChatId` ⇒ ② 红；删 `wireChatId()` 定义 ⇒ ③ 红；
 *   标签改回 `${this.channel}:${this.chatID}` ⇒ ④ 红；还原 ⇒ 全绿。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

// ⛔ 标记为模块（顶层变量不落全局，避免与其它脚本测试重名 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}`); }
}
function eq(name: string, got: number, want: number): void {
  ok(`${name}（期望 ${want}，实得 ${got}）`, got === want);
}

const REPO: string = path.resolve(__dirname, '../../../..');
function readSrc(rel: string): string {
  const raw: string = fs.readFileSync(path.join(REPO, rel), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
function count(s: string, needle: string): number {
  return s.split(needle).length - 1;
}

const store: string = readSrc('entry/src/main/ets/core/store.ets');
const dev: string = readSrc('entry/src/main/ets/components/SettingsDeveloper.ets');
const pick: string = readSrc('entry/src/main/ets/core/sessionpick.ets');

// ── ① 零扫描判红 ────────────────────────────────────────────────────────────
// ⚠️ 判据自证时踩过：阈值一开始拍成 50000，而 `store.ets` **剥注释后**实为 47314 ⇒ 假红。
//    阈值按"剥注释后真实规模"留 15% 余量（⛔ 不给实现让步，只订正判据自身）。
ok('① store.ets 读到', store.length > 40000);
ok('① SettingsDeveloper.ets 读到', dev.length > 5000);
eq('① sessionpick 导出 canonicalChatId 恰 1 处', count(pick, 'export function canonicalChatId'), 1);
eq('① sessionpick 导出 sessionDisplayKey 恰 1 处', count(pick, 'export function sessionDisplayKey'), 1);

const wired: number = count(store, 'this.wireChatId()');
ok(`① store 出网规范化调用点 ≥ 8（实得 ${wired}）`, wired >= 8);

// ── ② 不许回退：出网直传全键 0 处 ────────────────────────────────────────────
eq('② SessionReq 直传 currentChatId = 0', count(store, 'new SessionReq(this.channel, this.currentChatId)'), 0);
eq("② body 'chat_id' 直传 currentChatId = 0", count(store, "'chat_id': this.currentChatId"), 0);
eq("② body 'chatID' 直传 currentChatId = 0", count(store, "'chatID': this.currentChatId"), 0);
eq('② promoteSessionKey 直传 currentChatId = 0',
  count(store, 'promoteSessionKey(this.channel, this.currentChatId)'), 0);
eq('② HistoryReq 两处都不再直传 currentChatId = 0', count(store, 'this.currentChatId, 30,'), 0);

// ── ③ store 真消费 canonicalChatId（switch 路径内联）──────────────────────────
eq('③ store import canonicalChatId 恰 1 处', count(store, 'canonicalChatId,'), 1);
eq('③ store 使用 canonicalChatId 恰 1 处（chatSwitchPath）', count(store, 'canonicalChatId(this.channel, chatId)'), 1);
eq('③ wireChatId() 定义恰 1 处', count(store, 'private wireChatId(): string'), 1);

// ── ④ SettingsDeveloper：参数 + 标签都走规范形态 ─────────────────────────────
eq('④ 导出参数用 canonicalChatId 恰 1 处',
  count(dev, 'new SessionSelectorParams(this.channel, canonicalChatId(this.channel, this.chatID))'), 1);
eq('④ 标签用 sessionDisplayKey 恰 1 处', count(dev, 'sessionDisplayKey(this.channel, this.chatID)'), 1);
eq('④ ⛔ 不再出现双写标签', count(dev, '${this.channel}:${this.chatID}'), 0);
eq('④ export.ets 的 TXT 头也走规范形态', count(readSrc('entry/src/main/ets/core/export.ets'),
  'sessionDisplayKey'), 0);

console.log(`  session_id_wire: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
