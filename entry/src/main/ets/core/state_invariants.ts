/**
 * state_invariants.ts —— 会话状态的**可执行定义**（"正确"的唯一机器判据）。
 *
 * 为什么需要（用户 2026-10-21：「为什么每次改完都有新 bug」的结构性答复）：
 *   前八轮修复都是"某个路径忘了写 X"逐条补 —— 规则散落在几十个 handler/异步回包里，
 *   **每个新路径都必须重新记住所有规则** ⇒ 永远会漏。本文件把规则从"纪律"变成
 *   **可执行谓词**：`invariantViolations(state)` 返回违反清单（空 = 合法）。
 *   它被两处消费：
 *     ① `tools/tests/state_fuzz.test.ts` —— 机器穷举事件序列（人只能枚举有限组合）；
 *     ② 全部既有回归测试 —— 每个历史 P0 的终态都必须过同一组不变量。
 *
 * 设计约束：
 *   · 纯 .ts、零 ArkUI/@ohos 依赖（`run.sh` 把它当纯 TS 编译）。
 *   · 只读 `ChatState`，不修状态（判据与修复分离 ⇒ 不会自己制造"修好了"的假象）。
 *   · 每条不变量都有**稳定的编号**（I1…），失败信息里带编号 ⇒ 门禁/报告可逐条引用，
 *     不会出现"某处又坏了但说不清是哪条规则"。
 */

import { ChatState, Turn, liveHasOutput } from './chat_types_full'

/** live/frozen data 或 committed payload 是否已有产出（送达/开始工作的证据）。
 *  ⛔ 唯一判据在 `chat_types_full.liveHasOutput`（本文件此前是第三份实现且不计工具 ——
 *  state-gate-10-1 确证它与 reduce/derive 互相矛盾）。 */
function turnHasOutput(t: Turn): boolean {
  if (t.phase.kind === 'committed') {
    const p = t.phase.payload
    return p.content.length > 0 || p.iterations.length > 0
  }
  return liveHasOutput(t.phase.data)
}

/**
 * 全部不变量。返回违反清单（`['I1: …', …]`），空数组 = 合法状态。
 *
 * 编号是契约：新增判据只能**追加编号**，不得改语义（改了就是改规则，必须同步
 * `docs/STATE-AUDIT.md §4.3` 与全部判据）。
 */
export function invariantViolations(s: ChatState): string[] {
  const out: string[] = []
  const bad = (code: string, msg: string): void => {
    out.push(`${code}: ${msg}`)
  }

  // ── I1 busy 与 sessionRunning 是**同一个概念**的两个出口 ──────────────────
  // 历史确证项里出现过 `history_replaced` 把两者写成相反值 ⇒ composer 显示 cancel
  // 而列表渲染成 idle（或反之）。同值不是"两条规则"，是**一条规则的两个读者**。
  if (s.busy !== s.sessionRunning) {
    bad('I1', `busy=${s.busy} 与 sessionRunning=${s.sessionRunning} 相反`)
  }

  // ── I2/I3 live-ness 唯一且必须由 activeTurn 持有 ─────────────────────────
  let liveID = -1
  let liveCount = 0
  const ownerOfUser = new Map<string, number>()
  for (const [key, t] of s.turns) {
    if (key !== t.id) {
      bad('I9', `turns 的键 ${key} ≠ turn.id ${t.id}`)
    }
    if (t.phase.kind === 'live') {
      liveCount++
      liveID = t.id
    }
    if (t.user !== null) {
      const prev = ownerOfUser.get(t.user.id)
      if (prev !== undefined) {
        bad('I7', `user 行 ${t.user.id} 同时属于 turn ${prev} 与 ${t.id}（一 user 只能在一个 turn）`)
      }
      ownerOfUser.set(t.user.id, t.id)
      // ── I5 已产出 ⇒ 绝不可能还在"发送中" ─────────────────────────────────
      // 用户 2026-10-21 原话：「只要他有迭代了那就是不应该发送中啊」。
      // 这是比"idle 才收敛"更强的判据：迭代 = 服务端已受理并产出 = 一定送达。
      if (t.user.sending && turnHasOutput(t)) {
        bad('I5', `turn ${t.id} 的 user 仍 sending，但该 turn 已有产出（送达证据）`)
      }
    }
  }
  if (liveCount > 1) {
    bad('I3', `同时存在 ${liveCount} 个 live turn（只允许 0 或 1）`)
  }
  if (s.activeTurn !== null) {
    const t = s.turns.get(s.activeTurn)
    if (t === undefined) {
      bad('I2', `activeTurn=${s.activeTurn} 不在 turns 里`)
    } else if (t.phase.kind !== 'live') {
      bad('I2', `activeTurn=${s.activeTurn} 的 phase=${t.phase.kind}（activeTurn 必须是 live）`)
    }
  } else if (liveCount > 0) {
    bad('I3', `activeTurn 为 null，但 turn ${liveID} 仍是 live（live 必须由 activeTurn 持有）`)
  }

  // ── I4 有在飞内容 ⇒ 会话必然在跑 ─────────────────────────────────────────
  // 反向安全：权威 idle 一律把 `streaming` 置 false 而**不删内容**（见 reduce 的
  // session/session_idle），所以"已收尾"的 turn 不会触发本判据。
  // 这条是 busy 抖动的单向闸门：任何漏发 `session_running(true)` 的路径都会被它兜住。
  if (s.activeTurn !== null && !s.sessionRunning) {
    const t = s.turns.get(s.activeTurn)
    if (t !== undefined && t.phase.kind === 'live' && t.phase.data.streaming === true) {
      bad('I4', `turn ${t.id} 仍在 streaming，但 sessionRunning=false（busy 被提前降级）`)
    }
  }

  // ── I6 pending 与已绑定 user 不得重复（一条 user 只有一个家） ─────────────
  const pendingIDs = new Set<string>()
  for (let i = 0; i < s.pendingUsers.length; i++) {
    const u = s.pendingUsers[i]
    if (pendingIDs.has(u.id)) {
      bad('I6', `pendingUsers 里出现重复 id ${u.id}`)
    }
    pendingIDs.add(u.id)
    if (ownerOfUser.has(u.id)) {
      bad('I6', `user ${u.id} 既在 pendingUsers 又绑在 turn ${ownerOfUser.get(u.id)}`)
    }
  }

  // ── I8 goal 三态：墓碑（已清除）不得以"值"的形态存在 ─────────────────────
  // 契约（§4.3）：缺字段 = 不动 / `{objective:'',status:'cleared'}` = 清除 / 有值 = 覆盖。
  // 落到 state 上只有两种合法形态：null（无目标）或**非墓碑**的值。
  // 注意判据是 `status === 'cleared'`（不是"objective 为空"）：空 objective 但状态
  // 未清除是后端异常，三态语义要求原样保留，不能在这里二次解释。
  if (s.goal !== null && s.goal.status === 'cleared') {
    bad('I8', `goal 是清除墓碑（status='cleared'）却留在 state 里（应折成 null）`)
  }

  return out
}

/** 便于失败报告：把状态压成一行（只含判据相关字段）。 */
export function describeState(s: ChatState): string {
  const ids: string[] = []
  for (const [, t] of s.turns) {
    ids.push(`${t.id}:${t.phase.kind}${t.phase.kind === 'live' && t.phase.data.streaming ? '(stream)' : ''}`)
  }
  return `chat=${s.chatID} active=${s.activeTurn} busy=${s.busy} run=${s.sessionRunning} `
    + `turns=[${ids.join(',')}] pending=${s.pendingUsers.length} goal=${s.goal === null ? 'null' : 'set'}`
}
