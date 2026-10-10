/**
 * user_row_integrity.test.ts —— 一条用户消息**恰一条** user 行
 * （真机 bug 2026-10-10「我发了一个你好渲染两次，一开始两个你好在一起，
 *  然后变成前后各一个」的回归守卫）。
 *
 * 权威规则（web）：本地乐观发送（`user_sent`）与后端回声（`user_echo`）/回合开始
 * （`turn_started`）/历史（`history_replaced`）必须**收敛到同一条** user 行 —— 靠
 * **requestID 精确匹配**：web `useChatMessages.sendMessage` 把乐观行 requestID
 * 作为 `id` 发给服务端，服务端把它原样回显到 `user_echo.ID` /
 * `turn_started.turn_start.request_id`。
 *
 * 本用例**端到端驱动** `ChatStore.send()`（打桩 HTTP / SSE），并让"服务端"按真实
 * 契约回显：请求体带 `id` 就原样回显，缺席则自生成 uuid（= 真实服务端
 * `dispatchResolvedUserMessage` 的行为）。
 *
 * 修复前：`MessageReq` 无 `id` ⇒ 服务端自生成 uuid ⇒ 回声 ID 与乐观行对不上 ⇒
 * `user_echo` 无法就地收敛、被当新 user 追加 ⇒ 该 turn 渲染出 **2 条** user 行
 * （一条绑进 turn 在回复之前、一条 pending 沉底在回复之后）= 用户看到的
 * 「先并排、后前后各一个」→ RED。
 * 修复后：`send()` 把乐观行 requestID 作为 `id` 发出 ⇒ 回声/回合 ID 匹配 ⇒
 * `reduce` 已有的就地收敛逻辑生效 ⇒ **恰 1 条** → GREEN。
 *
 * 另两条同类路径一并守卫：历史合并（`history_replaced`）不得留下第二条旧 key、
 * 通知 turn 的 `inject_user` 回声不得再造一行。
 */
import { ChatStore } from '../../entry/src/main/ets/core/store'
import type { SseListener } from '../../entry/src/main/ets/core/sse'

declare const process: { exit: (c: number) => void }

const CHAT = 'chat-1'
const MSG = '你好'
const TURN = 5

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++
  } else {
    fail++
    console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`)
  }
}

interface Wired {
  /** ⚠️ 每次读取容器（post 桩是重新赋值 captured.body，早先取引用会读到空对象）。 */
  body: () => Record<string, unknown>
  emit: (event: string, payload: object) => void
}

/** 打桩：HTTP `/api/message` 记录请求体并返回服务端风格 ack、`/api/history` 返回给定快照；SSE 只捕获 listener。 */
function wire(store: ChatStore, history?: object): Wired {
  const captured: { body: Record<string, unknown> } = { body: {} }
  const box: { listener: SseListener | null } = { listener: null }
  const httpAny = store.http as unknown as { post: (path: string, body: object) => Promise<string> }
  httpAny.post = (path: string, body: object): Promise<string> => {
    if (path === '/api/history') {
      return Promise.resolve(JSON.stringify(
        history ?? { chat_id: CHAT, channel: 'web', messages: [], has_more: false, oldest_id: 0 }))
    }
    captured.body = JSON.parse(JSON.stringify(body)) as Record<string, unknown>
    return Promise.resolve(JSON.stringify({ message_id: 7, turn_id: TURN, queued: false }))
  }
  const sseAny = store.sse as unknown as {
    connect: (chatId: string, channel: string, cookie: string, listener: SseListener) => void
  }
  sseAny.connect = (_c: string, _ch: string, _ck: string, listener: SseListener): void => {
    box.listener = listener
  }
  store.currentChatId = CHAT
  store.subscribe()
  return {
    body: (): Record<string, unknown> => captured.body,
    emit: (event: string, payload: object): void => {
      const l = box.listener
      if (l === null) {
        throw new Error('SSE listener 未捕获（subscribe 未生效）')
      }
      l(event, JSON.stringify(payload))
    },
  }
}

function userRows(store: ChatStore): string[] {
  return store.rows.filter((r) => r.role === 'user').map((r) => `${r.content}@${r.turnID}`)
}

/** 主场景：本地乐观发送 → 后端回声/回合开始 → 最终文本。 */
async function mainScenario(): Promise<void> {
  const store = new ChatStore('http://127.0.0.1:9')
  const w = wire(store)

  // ① 发送：乐观 user 行入 pendingUsers，REST ack 清 sending。
  await store.send(MSG)
  ok('发送后：乐观 user 行恰 1 条', userRows(store).length === 1,
    `rows=${store.rows.map((r) => `${r.role}:"${r.content}"`).join(' | ')}`)
  const afterSend = store.rows.filter((r) => r.role === 'user')
  const optimisticRID = afterSend.length > 0 && afterSend[0].id.startsWith('local-')
    ? afterSend[0].id.slice('local-'.length) : ''

  // ② 传输契约（真机 bug 根因断言）：请求体必须携带乐观行 requestID。
  const sentBody = w.body()
  const sentID = sentBody['id']
  ok('REST /api/message 携带客户端 requestID（id）—— 回声/回合据此精确匹配',
    typeof sentID === 'string' && sentID.length > 0 && sentID === optimisticRID,
    `body.id=${String(sentID)} optimisticRID=${optimisticRID} body=${JSON.stringify(sentBody)}`)

  // ③ 服务端契约：收到 id 原样回显；缺席则自生成 uuid（= 修复前的实际行为）。
  const serverRID: string = typeof sentID === 'string' && sentID.length > 0 ? sentID : 'srv-uuid-1'

  // ④ 真实 SSE 事件序列：user_echo → turn_started → text（最终回复）。
  w.emit('user_echo', { chat_id: CHAT, id: serverRID, content: MSG, turn_id: TURN })
  w.emit('progress_structured', {
    chat_id: CHAT,
    progress: {
      turn_id: TURN, phase: 'turn_started', seq: 2,
      turn_start: { trigger: 'user', content: MSG, request_id: serverRID },
    },
  })
  w.emit('text', { chat_id: CHAT, turn_id: TURN, content: '你好呀，有什么可以帮你？' })

  // ⑤ 不变量：该 turn 的 user 行**恰 1 条**，在 assistant 之前，正文 = 用户输入。
  const users = store.rows.filter((r) => r.role === 'user')
  ok('该 turn 的 user 行**恰好 1 条**（乐观行与回声/回合收敛为同一条）', users.length === 1,
    `users=${userRows(store).join(' | ')} all=${store.rows.map((r) => `${r.role}:"${r.content}"@${r.turnID}`).join(' | ')}`)
  if (users.length >= 1) {
    ok('user 行正文 = 用户输入', users[0].content === MSG, `got=${users[0].content}`)
    const idxUser = store.rows.findIndex((r) => r.role === 'user')
    const idxAsst = store.rows.findIndex((r) => r.role === 'assistant')
    ok('user 行位置在 assistant 回复之前（无漂移）',
      idxUser >= 0 && idxAsst >= 0 && idxUser < idxAsst, `idxUser=${idxUser} idxAsst=${idxAsst}`)
  }

  // ⑥ 历史合并（同 turn 的 DB 行回灌）不得再造/留第二条 user 行。
  await store.loadHistory()
  ok('历史合并后仍恰 1 条 user 行（history_replaced 不产第二条）', userRows(store).length === 1,
    `users=${userRows(store).join(' | ')}`)
}

/** 同类路径：通知 turn（turn_started(notification) + inject_user 回声）不得一行渲染两次。 */
async function notificationScenario(): Promise<void> {
  const store = new ChatStore('http://127.0.0.1:9')
  const w = wire(store)
  const NOTIF = '系统通知：任务已完成'
  const N = 6
  w.emit('progress_structured', {
    chat_id: CHAT,
    progress: {
      turn_id: N, phase: 'turn_started', seq: 1,
      turn_start: { trigger: 'notification', content: NOTIF, request_id: null },
    },
  })
  // 后端 inject_user 回声（WSMessage 四字段，无 id/turn_id）—— 不得与上面的通知 user 行重复。
  w.emit('inject_user', { chat_id: CHAT, content: NOTIF })
  w.emit('text', { chat_id: CHAT, turn_id: N, content: '收到' })
  const users = store.rows.filter((r) => r.role === 'user')
  ok('通知 turn：恰 1 条通知 user 行（inject_user 回声不重复）', users.length === 1,
    `users=${users.map((r) => `${r.content}@${r.turnID}`).join(' | ')}`)
}

async function main(): Promise<void> {
  await mainScenario()
  await notificationScenario()
  console.log(`  user_row_integrity: ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e: Error) => {
  console.log(`  ✗ user_row_integrity 运行异常: ${e.message}`)
  process.exit(1)
})
