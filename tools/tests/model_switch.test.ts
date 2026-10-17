/**
 * model_switch —— 会话切模型（P0，用户 2026-10-17 亲报「所有会话里切换模型都是无效的」）。
 *
 * ── 根因（已定位，不是猜）──────────────────────────────────────────────────────
 *  web 权威：`ModelSelector.handleSelect` → `api.ts:796 selectModel` → RPC
 *  **`select_model {sub_id, model, chat_id, channel}`**（服务端 `rpc_table.go:598-612`）。
 *  本仓旧实现：`store.setModel` 打 `POST /api/llm-config {action:'set_model', …}`
 *  —— 该路由（`channel/web/web.go:918`）是**配置 upsert**、不认 `action`
 *  ⇒ **HTTP 200 但什么都没切**（静默无效，所有会话都如此）。
 *
 * ── 判据分两层（⛔ 只钉"参数类存在"会假绿：原 bug 的形态就是"看起来在调 API"）──
 *  ① wire 层：RPC 名与参数键必须与服务端/web 逐字一致（key 名错 = 服务端解析不到）；
 *  ② **调用点层**（源码形态）：`store.setModel` 必须走 `RPC_SELECT_MODEL`，且
 *     **不得**再出现 `/api/llm-config` + `'set_model'` 这对死路径；`chat_id` 不得写死空串
 *     （服务端缺 chat_id 直接报错 "select_model requires a chat_id"）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;

import { RPC_SELECT_MODEL, SelectModelParams } from '../../entry/src/main/ets/core/rpc';
import { modelBadgeText } from '../../entry/src/main/ets/core/llmfmt';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

console.log('\n▶ ① wire 层：RPC 名与参数键（与服务端 rpc_table.go:598-612 逐字一致）');
eq('RPC 名 = select_model', RPC_SELECT_MODEL, 'select_model');
const p = new SelectModelParams('sub_1', 'glm-5.2', 'chat_ABC', 'web');
eq('参数键集合（多一个少一个都算契约错）',
  Object.keys(JSON.parse(JSON.stringify(p))).sort(),
  ['channel', 'chat_id', 'model', 'sub_id']);
eq('sub_id 透传', p.sub_id, 'sub_1');
eq('model 透传', p.model, 'glm-5.2');
eq('chat_id 透传（服务端强依赖）', p.chat_id, 'chat_ABC');
eq('channel 透传（服务端按 (channel, chat_id) 落会话）', p.channel, 'web');

console.log('\n▶ ② 调用点层：store.setModel 走 select_model，且死路径不得回归');
const pathMod = require('path');
const fsMod = require('fs');
const storeSrc: string = fsMod.readFileSync(
  pathMod.resolve(__dirname, '../../../..', 'entry/src/main/ets/core/store.ets'), 'utf8');
const fnAt: number = storeSrc.indexOf('async setModel(subId: string, model: string): Promise<void> {');
ok('定位到 store.setModel', fnAt > 0);
// 函数体按**边界**截取（⛔ 不用定长窗：中间行变长会把后面的锚推出窗口 —— 见 AGENTS.md 教训）
const bodyEnd: number = storeSrc.indexOf('\n  }', fnAt);
const body: string = fnAt > 0 && bodyEnd > fnAt ? storeSrc.substring(fnAt, bodyEnd) : '';
ok('函数体截取到（函数边界，非定长窗）', body.length > 100);
ok('走 RPC select_model', body.indexOf('RPC_SELECT_MODEL') >= 0);
ok('参数用 SelectModelParams 构造（不手搓 map）', body.indexOf('new SelectModelParams(') >= 0);
ok('⛔ 不得再打 /api/llm-config 那条死路径', body.indexOf('/api/llm-config') < 0);
ok('⛔ 不得再出现 action=set_model 死写法', body.indexOf("'set_model'") < 0 && body.indexOf('action') < 0);
ok('切换后刷新配置与用量', body.indexOf('loadLlmConfig') >= 0 && body.indexOf('loadStatus') >= 0);
ok('⛔ 切换后必须刷新**会话订阅**（徽章权威源 = sessionModel，缺则"像没切"）',
  body.indexOf('loadSessionSubscription') >= 0);
ok('store 有会话级模型字段', storeSrc.indexOf('sessionModel: string') >= 0);
ok('会话模型来自 get_session_subscription 的 model 字段',
  /this\.sessionModel\s*=\s*\(sub\.model !== undefined/.test(storeSrc));

// chat_id 不得写死空串（服务端会拒）；取整份 store 里这条调用点附近的片段
const callAt: number = storeSrc.indexOf('new SelectModelParams(');
const callLine: string = callAt > 0 ? storeSrc.substring(callAt, storeSrc.indexOf(')', callAt) + 1) : '';
// chat_id 允许是局部变量（由 this.currentChatId 赋值）⇒ 断言"不是字面空串" +
// "函数体内确实取了本会话 id"
ok(`传入了 chat_id（实际：${callLine.replace(/\s+/g, ' ')}）`,
  callLine.length > 0 && callLine.indexOf("'',") < 0 && callLine.indexOf('chatId') >= 0);
ok('chat_id 取自本会话（this.currentChatId）', body.indexOf('this.currentChatId') >= 0);

console.log('\n▶ ②′ 徽章必须**会话级优先**（否则切完徽章不变 ⇒ 用户以为没切）');
// web 权威优先级：`SessionInfo.tsx:79` dump.modelName || sub.model || settings.model
eq('会话级有值 ⇒ 用它（即便用户级配置是别的）',
  modelBadgeText('glm-5.3', { model: 'deepseek-flash' } as never, 'deepseek-flash'), 'glm-5.3');
eq('会话级为空 ⇒ 回落到用户级 cfg.model',
  modelBadgeText('', { model: 'glm-5.2' } as never, 'deepseek-flash'), 'glm-5.2');
eq('会话级与用户级都空 ⇒ 回落到 usage.model',
  modelBadgeText('', undefined, 'deepseek-flash'), 'deepseek-flash');
eq('全空 ⇒ 空串（不编造）', modelBadgeText('', undefined, ''), '');

console.log('\n▶ ③ 全仓不得残留旧的 /api/llm-config action 切模型写法');
const idxSrc: string = fsMod.readFileSync(
  pathMod.resolve(__dirname, '../../../..', 'entry/src/main/ets/pages/Index.ets'), 'utf8');
ok('Index.ets 里 pickModel 不再直接调 store 的 HTTP 老路（hmm 仍调 store.setModel 是对的）',
  idxSrc.indexOf('store.setModel(') >= 0 || idxSrc.indexOf('this.store.setModel(') >= 0);
ok('Index.ets 不出现 action=set_model 死写法', idxSrc.indexOf('action=set_model') < 0);
// 徽章走纯函数 + 会话级优先（源码形态：判据与渲染同源）
ok('currentModelName 走 modelBadgeText（避免再次只读用户级配置）',
  idxSrc.indexOf('modelBadgeText(') >= 0);
ok('currentModelName 传入会话级 model', /modelBadgeText\(sess,/.test(idxSrc));

if (fail > 0) {
  console.log(`  model_switch: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  model_switch: ${pass} passed, 0 failed`);
process.exit(0);
