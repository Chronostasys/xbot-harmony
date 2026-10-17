/**
 * LiveViewBridge —— HarmonyOS **实况窗**（Live View Kit）的**唯一调用点**。
 *
 * ⛔ 为什么单独一个文件：`core/**` 被 `tools/tests/run.sh` 当**纯 TS** 编译 ⇒ `core/*.ets`
 *    **不许** import `@kit.*`（AGENTS.md 铁律）。判据/文案全在 `core/liveview.ets`（纯函数，
 *    有判别力单测）；本文件只做"把纯逻辑算出的快照喂给系统服务"这一件事。
 *
 * ── 系统契约（真源 `@hms.core.liveview.liveViewManager.d.ts`）─────────────────────────
 *  · **前置体检**：`isLiveViewEnabled()` —— 应用级开关（用户在 设置→通知 里可关；未申请场景
 *    权限时服务端也会给 `1003500004 LiveView is not enabled`）。
 *  · `startLiveView(v)` / `updateLiveView(v)` / `stopLiveView(v)`，全部返回
 *    `LiveViewResult{resultCode, message}`；失败**抛** `BusinessError`（不是 reject 一个普通值）。
 *  · `LiveView.sequence`：update/stop 时必须**大于**当前值，否则失败 ⇒ 本类每次推送自增。
 *  · `LiveView.timer` = 系统侧**每秒自刷**的计时器（`isCountdown:false` ⇒ 正计时）——
 *    "已用时长"由系统免费维护，我们**不需要**每秒推 update（这正是"耗时不掉帧"的关键）。
 *
 * ── 降级（⛔ 绝不把实况窗失败暴露成用户可见故障）─────────────────────────────────────
 *  · 未申请到场景权限 / 用户关了开关 ⇒ 一次探测失败即置 `LV_CAP_NO`，之后**不再**打扰系统服务
 *    （零成本），仅落一行应用日志（设置→开发者→应用日志）说明原因；
 *  · 所有调用包 try/catch，**永不向调用方抛**（页面每帧调用 ⇒ 抛 = 崩）。
 */
import { liveViewManager } from '@kit.LiveViewKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { log } from '../core/applog';
import {
  LiveViewInput, LiveViewSnapshot, liveViewSnapshotOf, shouldPushLiveView, LV_EVENT, LV_ID,
} from '../core/liveview';

/** 能力探测三态。 */
export const LV_CAP_UNKNOWN: number = 0;
export const LV_CAP_OK: number = 1;
export const LV_CAP_NO: number = 2;

export class LiveViewBridge {
  private static inst: LiveViewBridge | null = null;

  /** 单例（页面每帧调；无状态耦合）。 */
  static shared(): LiveViewBridge {
    if (LiveViewBridge.inst === null) {
      LiveViewBridge.inst = new LiveViewBridge();
    }
    return LiveViewBridge.inst;
  }

  /** 能力：0 未探测 / 1 可用 / 2 不可用（不可用后不再打扰系统服务）。 */
  private cap: number = LV_CAP_UNKNOWN;
  /** `isLiveViewEnabled` 探测在飞（防重入）。 */
  private probing: boolean = false;
  /** `sequence`（update/stop 必须严格递增）。 */
  private seq: number = 1;
  /** 上次推送时刻（节流基准）。 */
  private lastPushMs: number = 0;
  /** 上次推送的快照（差分基准）。 */
  private last: LiveViewSnapshot | null = null;
  /** 当前是否有已 start 未 stop 的实况窗。 */
  private live: boolean = false;
  /** 一次系统调用在飞（防重入：SSE 帧很密）。 */
  private inFlight: boolean = false;
  /** 已 stop 的实况窗 id 集合不需要 —— id 固定，用 `live` 标记是否在展示。 */

  /** 诊断文本（设置→开发者 展示；⛔ 只读，不改行为）。 */
  capText(): string {
    if (this.cap === LV_CAP_OK) { return '可用'; }
    if (this.cap === LV_CAP_NO) { return '不可用'; }
    return '未探测';
  }

  /**
   * 每帧调用（幂等、可重入安全、**绝不抛**）。
   *
   * 判据全在 `core/liveview.shouldPushLiveView`：起/止**恒推**（结构事件不许被节流吃掉），
   * 内容刷新按 `LV_MIN_UPDATE_MS` 节流。
   */
  sync(i: LiveViewInput, nowMs: number): void {
    if (this.cap === LV_CAP_NO) {
      return;
    }
    if (this.inFlight) {
      return;
    }
    const next: LiveViewSnapshot = liveViewSnapshotOf(i, nowMs);
    if (!shouldPushLiveView(this.last, next, nowMs, this.lastPushMs)) {
      return;
    }
    this.inFlight = true;
    this.apply(next, nowMs);
  }

  /** 手动测试（设置→开发者）：起一条**演示**实况窗 —— 不必跑一轮 agent 就能验证本机是否可用。 */
  testStart(): void {
    if (this.cap === LV_CAP_NO || this.inFlight) {
      return;
    }
    const s: LiveViewSnapshot = new LiveViewSnapshot();
    s.active = true;
    s.title = 'xbot · 实况窗测试';
    s.line1 = '这是一条测试实况窗';
    s.line2 = '看得到 ⇒ 本机已启用实况窗';
    s.capsuleText = 'xbot 测试';
    this.last = null;      // 首帧 ⇒ 必推（也是能力探测的唯一入口）
    this.lastPushMs = 0;
    this.inFlight = true;
    this.apply(s, Date.now());
  }

  /** 手动测试：结束演示实况窗。 */
  testStop(): void {
    if (this.inFlight) {
      return;
    }
    const s: LiveViewSnapshot = new LiveViewSnapshot();
    s.active = false;
    this.lastPushMs = 0;
    this.inFlight = true;
    this.apply(s, Date.now());
  }

  /** 真正落系统调用（异步；`inFlight` 由这里释放）。 */
  private async apply(next: LiveViewSnapshot, nowMs: number): Promise<void> {
    try {
      if (this.cap === LV_CAP_UNKNOWN) {
        const ok: boolean = await this.probe();
        if (!ok) {
          this.last = next;          // 记下来：能力恢复后不会因为"内容没变"而漏掉首帧
          this.lastPushMs = nowMs;
          return;
        }
      }
      if (!next.active) {
        if (this.live) {
          await this.stop();
        }
        this.last = next;
        this.lastPushMs = nowMs;
        return;
      }
      // ⛔ 每次推送都必须换一个新的 sequence（系统侧要求严格递增，否则 update 被拒）。
      this.seq = this.seq + 1;
      const v: liveViewManager.LiveView = this.build(next);
      const res: liveViewManager.LiveViewResult = this.live
        ? await liveViewManager.updateLiveView(v)
        : await liveViewManager.startLiveView(v);
      if (!this.live) {
        const code: number = res !== undefined && res !== null ? res.resultCode : 0;
        log('liveview', `startLiveView 成功 code=${code} id=${LV_ID} event=${LV_EVENT}`);
      }
      this.live = true;
      this.last = next;
      this.lastPushMs = nowMs;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      const code: number = err !== undefined && err !== null ? err.code : -1;
      // 1003500004 = LiveView is not enabled（未申请场景权限 / 用户关了开关 / 系统不支持）
      // 1003500003 = 连不上服务；1003500001/2 = 内部/编解码错。前两类**不是**我们的 bug ⇒ 降级。
      if (code === 1003500004 || code === 1003500003 || code === 401) {
        if (this.cap !== LV_CAP_NO) {
          log('liveview', `实况窗不可用（code=${code}），已降级不再尝试：${err.message}`);
        }
        this.cap = LV_CAP_NO;
        this.live = false;
      } else {
        log('liveview', `实况窗调用失败 code=${code}: ${err.message}`);
        // 非降级错误也记下“本次已尝试”，避免每秒重复推同一份内容（日志洪水）。
        this.last = next;
        this.lastPushMs = nowMs;
      }
    } finally {
      this.inFlight = false;
    }
  }

  /** 前置体检（一次即可；结果缓存）。 */
  private async probe(): Promise<boolean> {
    if (this.probing) {
      return false;
    }
    this.probing = true;
    try {
      const ok: boolean = await liveViewManager.isLiveViewEnabled();
      this.cap = ok ? LV_CAP_OK : LV_CAP_NO;
      if (ok) {
        log('liveview', `实况窗已启用（event=${LV_EVENT} 场景需在 AGC 申请权限）`);
      } else {
        log('liveview', '实况窗未启用（应用开关关闭或未申请场景权限）⇒ 已降级，不再尝试');
      }
      return ok;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      log('liveview', `isLiveViewEnabled 失败 code=${err.code}: ${err.message} ⇒ 已降级`);
      this.cap = LV_CAP_NO;
      return false;
    } finally {
      this.probing = false;
    }
  }

  /** 结束实况窗（turn 结束）。 */
  private async stop(): Promise<void> {
    this.seq = this.seq + 1;
    await liveViewManager.stopLiveView(this.buildStopped());
    this.live = false;
    log('liveview', `stopLiveView 已结束 id=${LV_ID}`);
  }

  /**
   * 纯逻辑快照 → 系统 `LiveView` 载荷。
   *
   * ⛔ 只用**系统模板**（`LAYOUT_TYPE_DEFAULT`：标题 + 多行内容 + 文字胶囊 + 系统计时器）：
   *    · 不画**假进度条**（`ProgressLayout.progress` 必填，而 LLM 一轮的剩余量不可知 ⇒ 编一个
   *      百分比是骗人）；
   *    · `timer` 交给系统每秒自刷 ⇒ "已用时长"真实且零成本；
   *    · `isMute:true` —— agent 在跑不该响铃（用户没在看屏幕时也别骚扰）。
   */
  private build(snap: LiveViewSnapshot): liveViewManager.LiveView {
    const content: liveViewManager.RichText[] = [];
    if (snap.line1.length > 0) {
      content.push({ text: snap.line1 });
    }
    if (snap.line2.length > 0) {
      content.push({ text: snap.line2 });
    }
    const v: liveViewManager.LiveView = {
      id: LV_ID,
      event: LV_EVENT,
      sequence: this.seq,
      isMute: true,
      timer: { isCountdown: false },
      liveViewData: {
        primary: {
          title: snap.title,
          content: content,
          layoutData: { layoutType: liveViewManager.LayoutType.LAYOUT_TYPE_DEFAULT },
        },
        capsule: {
          // 「进度类型（PROGRESS）」场景的**官方胶囊形态**：进度胶囊 + `indeterminate: true`
          // （不确定进度 = 进行中转圈）。⛔ 不给 `progress` 数字：LLM 一轮的剩余量不可知，
          // 编一个百分比违背「与应用内任务进度与信息一致」的准入要求。
          type: liveViewManager.CapsuleType.CAPSULE_TYPE_PROGRESS,
          status: 1,
          indeterminate: true,
          content: snap.capsuleText,
        },
      },
    };
    return v;
  }

  /** 结束载荷（内容清空；sequence 已在 `stop()` 里自增）。 */
  private buildStopped(): liveViewManager.LiveView {
    const content: liveViewManager.RichText[] = [];
    const v: liveViewManager.LiveView = {
      id: LV_ID,
      event: LV_EVENT,
      sequence: this.seq,
      isMute: true,
      liveViewData: {
        primary: { title: 'xbot', content: content },
        capsule: {
          type: liveViewManager.CapsuleType.CAPSULE_TYPE_PROGRESS,
          status: 1,
          indeterminate: false,
          content: '',
        },
      },
    };
    return v;
  }
}
