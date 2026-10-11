/**
 * 后台对账的**纯判定层**（目标①「后台也能收到通知」的客户端上限方案）。
 *
 * ── 为什么需要它（2026-10-11 判决，见 `docs/NOTIFY-ACCEPTANCE.md §10`）──────────────
 * 后台化后应用会被**冻结** ⇒ SSE 事件**进不来** ⇒ `store.notifyOnSse` 零调用 ⇒ 必然没通知。
 * 客户端能做的上限 = **"极其轻量的后台任务定期对账"**（用户原话）：由 `workScheduler`
 * （延迟任务）在系统允许的时机唤醒一个 `WorkSchedulerExtensionAbility`，**只读**拉一次
 * 服务端快照，判断"有没有**你还没见过**的已完成回合 / 新待答问题"，有就发通知。
 *
 * ⛔ 本文件是**纯数值/纯判断**（`core/` ⇒ 被 `tools/tests/run.sh` 当纯 TS 编译）
 *    ⇒ **禁止** import 任何 `@ohos.*` / ArkUI 类型。副作用（HTTP / 发通知 / 读写备忘）
 *    全部由扩展与页面侧执行；本层只回答"**该不该提醒、提醒哪一种**"。
 *
 * ── 核心判据（**"见过没见过"比"忙不忙"更可靠**）────────────────────────────────
 * 不用"忙→不忙"的边沿（进程被杀时**没有边沿**，那条回合就漏了），改用**记忆比对**：
 *   · 前台每次观测到当前回合 ⇒ 记 `lastSeenTurnKey`（"这个回合我亲眼见过"）；
 *   · 对账时若存在一个**已完成**（`!busy`）且 **`turnKey !== lastSeenTurnKey`** 的回合
 *     ⇒ 说明它是在"你看不见的时候"结束的 ⇒ **该提醒**。
 * 这条同时覆盖两种情形：**后台冻结期间完成** 与 **进程被杀期间完成**。
 */

/** 不提醒。 */
export const RECONCILE_NONE: string = 'none';
/** 回合已完成（且用户没见过）⇒ 提醒"回复好了"。 */
export const RECONCILE_TURN_DONE: string = 'turn_done';
/** 有新的待回答请求 ⇒ 提醒（用户可能在等）。 */
export const RECONCILE_ASK: string = 'ask';

/**
 * 服务端只读快照的**最小投影**（扩展侧从 `/api/history` 的顶层字段填进来）。
 * 字段来源（只读、权威）：`processing`（忙碌）、`last_seq`（回合序号）、
 * 末行的 `pending ask request_id`。
 */
export class ReconcileMark {
  /** 服务端权威忙碌标志（`processing === true` 或 `active_progress` 非空）。 */
  busy: boolean = false;
  /** 当前/最近一次回合的标识。约定 = `` `${chatId}#${last_seq}` ``；空 = 还没有任何回合。 */
  turnKey: string = '';
  /** 待回答的 `request_id`（空 = 无待答）。 */
  askId: string = '';
  constructor(busy: boolean, turnKey: string, askId: string) {
    this.busy = busy;
    this.turnKey = turnKey;
    this.askId = askId;
  }
}

/**
 * 去重备忘（**必须持久化**：前台写、扩展读、跨进程跨唤醒都要记得"见过谁"）。
 * ⛔ 存的是**标识**（键/ID），不是内容 ⇒ 不涉隐私。
 */
export class ReconcileMemo {
  /**
   * 前台**至少观测过一次**会话状态。
   * 为什么需要：全新安装/首次登录时 `lastSeenTurnKey` 恒空 ⇒ 会把**历史**最后一个回合
   * 误判成"刚完成" ⇒ **冷启动误报**。加这道闸后，只有"前台确实看过"才允许 TURN_DONE 提醒。
   * 注意：**不影响 ASK**（待答是"用户要做动作"，冷启动也该提醒）。
   */
  initialized: boolean = false;
  /** 前台亲眼见过的回合键（`ReconcileMark.turnKey` 的同构值）。 */
  lastSeenTurnKey: string = '';
  /** 已提醒过的待答 `request_id`。 */
  lastAskId: string = '';
  constructor(initialized: boolean, lastSeenTurnKey: string, lastAskId: string) {
    this.initialized = initialized;
    this.lastSeenTurnKey = lastSeenTurnKey;
    this.lastAskId = lastAskId;
  }
}

/** 判定结果（**纯数据**；`kind === RECONCILE_NONE` 时另两个字段无意义）。 */
export class ReconcileDecision {
  kind: string = RECONCILE_NONE;
  turnKey: string = '';
  askId: string = '';
  constructor(kind: string, turnKey: string, askId: string) {
    this.kind = kind;
    this.turnKey = turnKey;
    this.askId = askId;
  }
}

/** 纯判定：该不该提醒、提醒哪一种。**无副作用、可脱机单测。** */
export function reconcileDecision(next: ReconcileMark, memo: ReconcileMemo): ReconcileDecision {
  // ① **存在待答 ⇒ 本次判定只围绕它**（待答是"要用户动作"的事件，优先级最高）。
  //    ⚠️ 已提醒过同一个 ⇒ 返回 NONE 而**不是**继续往下判"回合完成"：
  //    同一快照的可动作状态已经报过了，再报一次 turn_done 就是**重复打扰**
  //    （这一条是被 `reconcile.test.ts` 抓出来的真实缺陷：只记 askId 不够，
  //     还必须让"有待答"本身短路掉完成判定）。
  if (next.askId.length > 0) {
    if (next.askId !== memo.lastAskId) {
      return new ReconcileDecision(RECONCILE_ASK, next.turnKey, next.askId);
    }
    return new ReconcileDecision(RECONCILE_NONE, '', '');
  }
  // ② 未立基线（前台从没看过）⇒ 不判"回合完成"，避免冷启动把历史回合当刚完成。
  if (!memo.initialized) {
    return new ReconcileDecision(RECONCILE_NONE, '', '');
  }
  // ③ 存在"已完成、但你没见过"的回合 ⇒ 提醒。覆盖"后台冻结期完成"与"被杀期完成"两种情形。
  if (!next.busy && next.turnKey.length > 0 && next.turnKey !== memo.lastSeenTurnKey) {
    return new ReconcileDecision(RECONCILE_TURN_DONE, next.turnKey, '');
  }
  return new ReconcileDecision(RECONCILE_NONE, '', '');
}

/**
 * 记下"已提醒"（幂等）。**扩展发完通知后必须调它并落盘**，否则下一次唤醒会重复打扰。
 * 同时把备忘标为已立基线（提醒过 ⇒ 显然观测过）。
 */
export function applyDecision(memo: ReconcileMemo, d: ReconcileDecision): void {
  memo.initialized = true;
  if (d.kind === RECONCILE_TURN_DONE) {
    memo.lastSeenTurnKey = d.turnKey;
  } else if (d.kind === RECONCILE_ASK) {
    memo.lastAskId = d.askId;
  }
}

/**
 * 前台观测到状态时调用：**只记"我见过"**，不判断、不提醒（前台由既有通知链路负责）。
 * ⛔ 别把它做成"顺手发通知"——那会让前台路径多一份判定（两份判据必然漂移）。
 */
export function markSeen(memo: ReconcileMemo, next: ReconcileMark): void {
  memo.initialized = true;
  if (next.turnKey.length > 0) {
    memo.lastSeenTurnKey = next.turnKey;
  }
  if (next.askId.length > 0) {
    memo.lastAskId = next.askId;
  }
}

/** 回合键的**唯一构造**（前台与扩展必须同源，否则"见过没见过"永远对不上）。 */
export function turnKeyOf(chatId: string, lastSeq: number): string {
  const c: string = chatId !== undefined && chatId !== null ? chatId : '';
  const s: number = lastSeq > 0 ? lastSeq : 0;
  return c.length > 0 && s > 0 ? `${c}#${s}` : '';
}

/**
 * 延迟任务的**重复间隔**（ms）。= 15 分钟。
 *
 * 为什么是 15 分钟：与"系统推送不可用时，用户能接受的迟到上限"取一个折中——
 * 更短（如 1 分钟）会被系统合并/限流且显著耗电；更长（如 1 小时）在聊天场景已失去意义。
 * ⚠️ **系统不保证按此间隔唤醒**（受 Doze/省电/内存策略影响，见 spec 的覆盖表）。
 */
export const RECONCILE_INTERVAL_MS: number = 15 * 60 * 1000;

/** 延迟任务的 workId（同一应用内唯一；`1001` 固定分配给对账任务）。 */
export const RECONCILE_WORK_ID: number = 1001;

/** 延迟任务在 `module.json5` 里注册的扩展名（须与 `extensionAbilities[].name` 逐字一致）。 */
export const RECONCILE_ABILITY: string = 'NotifyReconcileAbility';
