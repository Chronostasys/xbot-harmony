/**
 * NotifyReconcileAbility —— 「极其轻量的后台对账」的**执行体**（目标① 客户端上限方案）。
 *
 * ── 它解决什么（判决见 `docs/NOTIFY-ACCEPTANCE.md §10`）────────────────────────────
 * 应用被后台化/被杀后会被**冻结** ⇒ SSE 事件进不来 ⇒ 既有 `notifyOnSse` 永不触发。
 * 本扩展由 `workScheduler`（延迟任务）在系统允许的时机唤醒，**只读**拉一次服务端快照，
 * 用**纯判定**（`core/reconcile.ets`）回答"有没有你没见过的已完成回合"，有就发通知。
 *
 * ── 设计纪律 ──────────────────────────────────────────────────────────────────
 * 1. ⛔ **不碰既有 notify 主链路**：本文件只用 `notificationManager.publish` 做"最小合法发布"，
 *    不改 `core/notify.ets` 的任何导出；判定逻辑全部复用 `core/reconcile.ets` 的纯函数。
 * 2. ⛔ **失败必须静默**：对账是旁路，任何异常只打 `hilog` 并 `return`，绝不抛（扩展抛错会被系统记异常）。
 * 3. ⛔ **幂等**：发完通知**立刻**把备忘落盘（`applyDecision` + `preferences`），否则每次唤醒都重复打扰。
 * 4. ⛔ **只读**：只调 `POST /api/history`（服务端 `authenticatedPOST`，与前台同接口、同参数形态），
 *    **不写任何服务端数据**。
 * 5. 可观测：每个关键步骤一条 `hilog`（tag `XBOTRECON`），真机用 `hilog -x` 取回即可判
 *    「有没有被唤醒 / 快照读到什么 / 判出什么 / 发没发出去」。
 *
 * ── 需要真机验证的点（本文件**未经真机运行**，如实标注）───────────────────────────
 * · 系统**实际唤醒间隔**是否接近 `RECONCILE_INTERVAL_MS`（受 Doze/省电/内存策略影响）；
 * · 扩展进程里读 `preferences`（同一 `xbot_settings` 仓）是否**一定能拿到** 前台写的 cookie；
 * · **ASK（待答）在后台能否判定**：本期 `askId` 恒传空串（前台 `askUser` 来自 SSE 事件，
 *   后台没有该事件；从 `/api/history` 单独推出待答**未验证**）⇒ 本期后台只覆盖
 *   `turn_done`（"回复好了"），待答仍靠前台/短时任务窗。**这是已知缺口，不是遗漏。**
 */
import WorkSchedulerExtensionAbility from '@ohos.WorkSchedulerExtensionAbility';
import workScheduler from '@ohos.resourceschedule.workScheduler';
import { preferences } from '@kit.ArkData';
import { http } from '@kit.NetworkKit';
import notificationManager from '@ohos.notificationManager';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import type { common } from '@kit.AbilityKit';
import { RECONCILE_NONE, RECONCILE_TURN_DONE, ReconcileMark, ReconcileMemo, ReconcileDecision, reconcileDecision, applyDecision, turnKeyOf, MissedItem, MissedSummary, summarizeMissed } from '../core/reconcile';
import wantAgent from '@ohos.app.ability.wantAgent';

const DOMAIN: number = 0x0000;
const TAG: string = 'XBOTRECON';

/** 与 `core/config.ets` 同源（只读它写的 cookie / 地址；**不改**该文件）。 */
const STORE_NAME: string = 'xbot_settings';
const KEY_SERVER: string = 'server_url';
const KEY_COOKIE: string = 'session_cookie';
const KEY_USER: string = 'username';
/** 对账备忘自成一仓（与前台设置解耦，避免互相覆盖）。 */
const MEMO_STORE: string = 'xbot_reconcile';
const M_INIT: string = 'initialized';
const M_TURN: string = 'last_seen_turn';
const M_ASK: string = 'last_ask_id';

/** 只读连接信息（显式 class：ArkTS 禁对象字面量作类型/无类型字面量）。 */
class ConnInfo {
  base: string = '';
  cookie: string = '';
  user: string = '';
  constructor(base: string, cookie: string, user: string) {
    this.base = base;
    this.cookie = cookie;
    this.user = user;
  }
}

/** 只读读取前台写的配置（缺项一律空串 ⇒ 后续直接放弃，不猜）。 */
async function readConn(ctx: common.Context): Promise<ConnInfo> {
  const opts: preferences.Options = { name: STORE_NAME };
  try {
    const s: preferences.Preferences = await preferences.getPreferences(ctx, opts);
    return new ConnInfo(
      String(s.getSync(KEY_SERVER, '')),
      String(s.getSync(KEY_COOKIE, '')),
      String(s.getSync(KEY_USER, '')),
    );
  } catch (e) {
    hilog.warn(DOMAIN, TAG, 'readConn failed: %{public}s', (e as BusinessError).message);
    return new ConnInfo('', '', '');
  }
}

async function loadMemo(ctx: common.Context): Promise<ReconcileMemo> {
  const memoOpts: preferences.Options = { name: MEMO_STORE };
  try {
    const s: preferences.Preferences = await preferences.getPreferences(ctx, memoOpts);
    return new ReconcileMemo(
      s.getSync(M_INIT, false) === true,
      String(s.getSync(M_TURN, '')),
      String(s.getSync(M_ASK, '')),
    );
  } catch (e) {
    hilog.warn(DOMAIN, TAG, 'loadMemo failed: %{public}s', (e as BusinessError).message);
    return new ReconcileMemo(false, '', '');
  }
}

async function saveMemo(ctx: common.Context, m: ReconcileMemo): Promise<void> {
  const memoOpts: preferences.Options = { name: MEMO_STORE };
  try {
    const s: preferences.Preferences = await preferences.getPreferences(ctx, memoOpts);
    s.putSync(M_INIT, m.initialized);
    s.putSync(M_TURN, m.lastSeenTurnKey);
    s.putSync(M_ASK, m.lastAskId);
    await s.flush();
  } catch (e) {
    hilog.warn(DOMAIN, TAG, 'saveMemo failed: %{public}s', (e as BusinessError).message);
  }
}

/**
 * 只读拉一次快照 → 投影成 `ReconcileMark`。
 * ⚠️ `askId` 恒空（见文件头"需要真机验证的点"）；`busy` 取 `active_progress` 非空。
 */
async function fetchMark(base: string, cookie: string): Promise<ReconcileMark | null> {
  if (base.length === 0 || cookie.length === 0) {
    hilog.info(DOMAIN, TAG, 'skip: 未登录/无地址');
    return null;
  }
  const req: http.HttpRequest = http.createHttp();
  try {
    const url: string = base.replace(/\/+$/, '') + '/api/history';
    const body: string = JSON.stringify({ channel: 'web', chat_id: '', limit: 1, before_id: 0 });
    const resp: http.HttpResponse = await req.request(url, {
      method: http.RequestMethod.POST,
      header: { 'Content-Type': 'application/json', 'Cookie': cookie },
      extraData: body,
      connectTimeout: 8000,
      readTimeout: 8000,
    });
    if (resp.responseCode !== 200) {
      hilog.info(DOMAIN, TAG, 'history http %{public}d', resp.responseCode);
      return null;
    }
    const obj: Record<string, Object> = JSON.parse(String(resp.result)) as Record<string, Object>;
    const data: Record<string, Object> | null =
      obj.data !== undefined && obj.data !== null ? obj.data as Record<string, Object> : null;
    if (data === null) {
      return null;
    }
    const ap: Object | undefined = data.active_progress;
    const busy: boolean = ap !== undefined && ap !== null;
    const seqRaw: Object | undefined = data.last_seq;
    const seq: number = typeof seqRaw === 'number' ? seqRaw as number : 0;
    const chat: Object | undefined = data.chat_id;
    const chatId: string = typeof chat === 'string' ? chat as string : '';
    return new ReconcileMark(busy, turnKeyOf(chatId, seq), '', chatId, chatId);
  } catch (e) {
    hilog.warn(DOMAIN, TAG, 'fetchMark failed: %{public}s', (e as BusinessError).message);
    return null;
  } finally {
    req.destroy();
  }
}

/**
 * 延迟任务被系统触发（`onWorkStart`）⇒ 显式重新排下一次（`isRepeat` 之外的双保险）。
 * ⛔ 全程 try/catch：任何异常都不得外抛。
 */
async function run(ctx: common.Context): Promise<void> {
  const memo: ReconcileMemo = await loadMemo(ctx);
  const conn = await readConn(ctx);
  const mark: ReconcileMark | null = await fetchMark(conn.base, conn.cookie);
  if (mark === null) {
    hilog.info(DOMAIN, TAG, 'no snapshot（跳过本次）');
    return;
  }
  const d: ReconcileDecision = reconcileDecision(mark, memo);
  hilog.info(DOMAIN, TAG, 'mark busy=%{public}s turn=%{public}s ⇒ %{public}s',
    String(mark.busy), mark.turnKey, d.kind);
  if (d.kind === RECONCILE_NONE) {
    return;
  }
  if (d.kind === RECONCILE_TURN_DONE) {
    // ⛔ 文案**唯一来源** = `core/reconcile.summarizeMissed`（不在本层另写一句）。
    //    本期只喂"刚判出的那一条" ⇒ count=1；多会话聚合的**结构已就位**（加项即可，文案无需改）。
    const items: MissedItem[] = [new MissedItem(mark.chatLabel, d.turnKey)];
    const sum: MissedSummary = summarizeMissed(items);
    // ⛔ `count === 0` ⇒ **不发**（避免"0 条新消息"的空提醒）——这是硬门禁，不是优化。
    if (sum.count > 0) {
      await publish(ctx, '新消息', sum.text, mark.chatId);
    } else {
      hilog.info(DOMAIN, TAG, 'summary count=0 ⇒ 不发通知');
    }
  }
  applyDecision(memo, d);
  await saveMemo(ctx, memo); // ⛔ 必须落盘，否则下次唤醒重复打扰
  hilog.info(DOMAIN, TAG, 'published %{public}s & memo saved', d.kind);
}

/**
 * 最小通知发布（**不复制** `core/notify.ets` 的三形态/动作按钮逻辑：后台只发一条可点开的提醒）。
 * ⚠️ 与 `notify.ets` 的 slot 分级不同源 ⇒ 若将来要求"同 slot 语义"，应把公共部分上收，而不是各写一份。
 */
async function publish(ctx: common.Context, title: string, text: string, chatId: string): Promise<void> {
  try {
    // 点进路由：复用既有 `notify_action`/`chat_id` 机制（与 `core/notify.ets` 同参数名）
    // ⇒ 冷启由 `EntryAbility.captureOpenChat(want)` 接住，直达到该会话。
    // 为什么带"最后判出的那个 session"：本期只判出一条；多会话聚合时改成"最长未读者"即可（结构已就位）。
    // ⛔ ArkTS 禁**无显式类型的对象字面量**（arkts-no-untyped-obj-literals）：
    //    这里曾写 `let agent: Object = {}` ⇒ 编译红（10605038，:196）。
    //    修法 = 不用占位字面量：请求体先建成**显式类型**，再条件赋值可选字段。
    // ⚠️ SDK 里 `WantAgent` 就是 `object` 的别名（`@ohos.app.ability.wantAgent.d.ts:475`：
    //    `export type WantAgent = object;`），且 default import 下**不解析为类型名**
    //    （写成 `wantAgent.WantAgent` 会报"no exported member named 'WantAgent'"）。
    //    ⇒ 这里直接用 `Object | null`，语义与 SDK 别名一致。
    let agent: Object | null = null;
    try {
      const info: wantAgent.WantAgentInfo = {
        wants: [{
          bundleName: ctx.applicationInfo.name,
          abilityName: 'EntryAbility',
          parameters: { chat_id: chatId, notify_action: 'open' },
        }],
        actionType: wantAgent.OperationType.START_ABILITY,
        requestCode: 0,
        wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
      };
      agent = await wantAgent.getWantAgent(info);
    } catch (e) {
      hilog.warn(DOMAIN, TAG, 'wantAgent failed（点开仍会起应用）: %{public}s', (e as BusinessError).message);
    }
    const request: notificationManager.NotificationRequest = {
      id: 1001,
      content: {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: { title: title, text: text },
      },
      isAlertOnce: true,
    };
    if (agent !== null) {
      request.wantAgent = agent;
    }
    await notificationManager.publish(request);
  } catch (e) {
    hilog.warn(DOMAIN, TAG, 'publish failed: %{public}s', (e as BusinessError).message);
  }
}

export default class NotifyReconcileAbility extends WorkSchedulerExtensionAbility {
  onWorkStart(work: workScheduler.WorkInfo): void {
    hilog.info(DOMAIN, TAG, 'onWorkStart workId=%{public}d', work !== undefined ? work.workId : -1);
    run(this.context).catch((e: Error) => {
      hilog.warn(DOMAIN, TAG, 'run threw (静默): %{public}s', e.message);
    });
  }

  /** 系统在**超时 2 分钟**或 `stopWork` 时回调（见 `@ohos.WorkSchedulerExtensionAbility` 注释）。 */
  onWorkStop(work: workScheduler.WorkInfo): void {
    hilog.info(DOMAIN, TAG, 'onWorkStop workId=%{public}d', work !== undefined ? work.workId : -1);
  }
}
