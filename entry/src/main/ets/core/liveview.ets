/**
 * liveview.ets —— HarmonyOS **实况窗**（Live View Kit）的**纯逻辑层**。
 *
 * ── 为什么有这一层 ──────────────────────────────────────────────────────────────
 *  · `core/**` 被 `tools/tests/run.sh` 当**纯 TS** 编译（AGENTS.md 铁律）⇒ 本文件
 *    **不许** `import @kit.LiveViewKit`；真实调用只在 `components/LiveViewBridge.ets`
 *    （全仓**唯一** import `@kit.LiveViewKit` 处）。
 *  · 这里只做两件事：**把一轮 turn 折成"实况窗该显示什么"** + **差分/节流判据**
 *    （纯函数 ⇒ 可脱机单测，判据与投递同源）。
 *
 * ── 实况窗是什么（SDK 真源：`@hms.core.liveview.liveViewManager.d.ts`）────────────────
 *  · 状态栏**胶囊**（`capsule`）+ 可展开的**横幅卡片**（`primary`）——即系统级"正在进行的
 *    服务"常驻展示（iOS 灵动岛的等价能力）。
 *  · `LiveView.event` = **场景**字符串（TAXI、DELIVERY、…、PROGRESS、TRADE，共 15 个；
 *    每个场景需在 AGC 申请对应权限）。本应用用 **`PROGRESS`（进度展示）**——一轮 agent turn
 *    就是"一个进行中的进度型服务"；`LiveView.layoutType` 与场景**正交**，故用
 *    `LAYOUT_TYPE_DEFAULT`（标题 + 多行内容 + 胶囊文字/计时）——⛔ 不画**假进度条**：
 *    LLM 一轮的剩余量不可知，编一个百分比是骗人（`ProgressLayout.progress` 必填，
 *    宁可不给 layoutData）。
 *
 * ⛔ 一条硬教训（与 `pages/Index.ets:syncLiveTail` 的 bug 同族）：**"起/止"是结构事件，
 *    绝不允许被节流吃掉**（用户 2026-10-16 亲报的 pill 消失就是这个坑）⇒ `shouldPush`
 *    对 `active` 翻转**恒真**，只有"内容刷新"才节流。
 */

/** 实况窗场景（AGC 需申请该场景权限；`@hms.core.liveview.liveViewManager.d.ts:378`.event）。 */
import { t } from './i18n';

export const LV_EVENT: string = 'PROGRESS';

/** 本应用的实况窗 id（`LiveView.id`，值域 int32）。同一时刻至多一个 turn 在飞 ⇒ 固定值即可。 */
export const LV_ID: number = 20261017;

/** 内容类更新的最小间隔（ms）。系统侧每次 `updateLiveView` 都有跨进程成本 ⇒ 1s 足够。 */
export const LV_MIN_UPDATE_MS: number = 1000;

/** 一轮 turn 的**可视输入**（由页面从 store/渲染行折叠；纯值，无引用语义）。 */
export class LiveViewInput {
  /** 是否有在飞 turn。false ⇒ 实况窗应结束（`stopLiveView`）。 */
  busy: boolean = false;
  /** 当前迭代号（1 起；0 = 未知）。 */
  iteration: number = 0;
  /** 当前在飞工具的标签（`Shell: sleep 90` 形态；空 = 无在飞工具）。 */
  toolLabel: string = '';
  /** 当前在飞工具的状态（`running`/`pending`/`generating`/`done`…；空 = 无）。 */
  toolStatus: string = '';
  /** 已产出字符数（正文 + 思考，码点）——"在动"的最直观信号。 */
  runes: number = 0;
  /** 本 turn 开始时刻（ms epoch；0 = 未知 ⇒ 不显示耗时）。 */
  startedAtMs: number = 0;
}

/** 实况窗当下该显示的内容（纯值；与上一份相等 ⇒ 不必打扰系统服务）。 */
export class LiveViewSnapshot {
  /** 该显示（true）还是该结束（false）。 */
  active: boolean = false;
  /** 横幅标题（`primary.title`）。 */
  title: string = '';
  /** 横幅第一行（`primary.content[0]`）。 */
  line1: string = '';
  /** 横幅第二行（`primary.content[1]`）。 */
  line2: string = '';
  /** 状态栏胶囊文字（`TextCapsule.content`）。 */
  capsuleText: string = '';
}

/** `ms` → `m:ss`（<1h）或 `h:mm:ss`。`<= 0` ⇒ 空串（不显示）。 */
export function fmtClock(ms: number): string {
  if (ms <= 0) {
    return '';
  }
  const total: number = Math.floor(ms / 1000);
  const s: number = total % 60;
  const m: number = Math.floor(total / 60) % 60;
  const h: number = Math.floor(total / 3600);
  const pad: string = s < 10 ? `0${s}` : `${s}`;
  if (h > 0) {
    const mp: string = m < 10 ? `0${m}` : `${m}`;
    return `${h}:${mp}:${pad}`;
  }
  return `${m}:${pad}`;
}

/** 工具状态 → 中文短语（与 pill 观感同源；未知状态原样回退，⛔ 不静默说成"执行中"）。 */
export function lvStatusWord(status: string): string {
  switch (status) {
    case 'running':
    case 'executing':
      return t('正在执行');
    case 'pending':
      return t('等待调度');
    case 'generating':
      return t('生成参数中');
    case 'done':
      return t('已完成');
    case 'error':
      return t('失败');
    case '':
      return t('思考中');
    default:
      return status;
  }
}

/** 工具标签 → 胶囊短名（`Shell: sleep 90; echo DONE` ⇒ `Shell`）。 */
export function lvToolShort(label: string): string {
  if (label.length === 0) {
    return '';
  }
  const i: number = label.indexOf(':');
  const head: string = i > 0 ? label.substring(0, i) : label;
  return head.trim();
}

/**
 * 一轮 turn 的输入 → 实况窗该显示的内容（**纯函数**）。
 *
 * 文案口径（都是**真实**信号，不编造）：
 *   · 标题 = `xbot · 已用 1:23`（本 turn 起算的**真实**耗时）；
 *   · 第一行 = `第 N 轮迭代` + 在飞工具；
 *   · 第二行 = 工具状态中文 + `已生成 N 字`；
 *   · 胶囊 = 在飞工具短名（无工具 ⇒ `第 N 轮`）。
 */
export function liveViewSnapshotOf(i: LiveViewInput, nowMs: number): LiveViewSnapshot {
  const s: LiveViewSnapshot = new LiveViewSnapshot();
  s.active = i.busy;
  if (!i.busy) {
    return s;
  }
  const used: string = i.startedAtMs > 0 ? fmtClock(nowMs - i.startedAtMs) : '';
  s.title = used.length > 0 ? `xbot · 已用 ${used}` : 'xbot';
  const iterPart: string = i.iteration > 0 ? `第 ${i.iteration} 轮迭代` : '准备中';
  s.line1 = i.toolLabel.length > 0 ? `${iterPart} · ${i.toolLabel}` : iterPart;
  const word: string = lvStatusWord(i.toolStatus);
  s.line2 = i.runes > 0 ? `${word} · 已生成 ${i.runes} 字` : word;
  const short: string = lvToolShort(i.toolLabel);
  s.capsuleText = short.length > 0 ? short : (i.iteration > 0 ? `${t('第')} ${i.iteration} ${t('轮')}` : 'xbot');
  return s;
}

/** 两份快照是否**逐字段相等**（相等 ⇒ 无需 `updateLiveView`）。 */
export function sameLiveView(a: LiveViewSnapshot | null, b: LiveViewSnapshot): boolean {
  if (a === null) {
    return false;
  }
  return a.active === b.active && a.title === b.title && a.line1 === b.line1
    && a.line2 === b.line2 && a.capsuleText === b.capsuleText;
}

/**
 * 这一帧是否该把快照推给系统服务（`startLiveView`/`updateLiveView`/`stopLiveView`）。
 *
 * 规则（顺序即优先级）：
 *   ① 首帧（`prev === null`）⇒ 推（否则永远不 start）；
 *   ② `active` **翻转**（起 / 止）⇒ **恒推**，⛔ 不受 `LV_MIN_UPDATE_MS` 节流
 *      —— 起止是可数的结构事件，丢掉一次就是"实况窗该出现却没出现 / 该消失却挂着"
 *      （2026-10-16 的 pill 消失同族 bug：结构事件被时间闸门连坐）；
 *   ③ 内容没变 ⇒ 不推（省跨进程调用）；
 *   ④ 内容变了 ⇒ 距上次推送 ≥ `LV_MIN_UPDATE_MS` 才推（避免流式期间每帧打扰系统服务）。
 */
export function shouldPushLiveView(prev: LiveViewSnapshot | null, next: LiveViewSnapshot,
  nowMs: number, lastPushMs: number): boolean {
  if (prev === null) {
    return true;
  }
  if (prev.active !== next.active) {
    return true;
  }
  if (sameLiveView(prev, next)) {
    return false;
  }
  return nowMs - lastPushMs >= LV_MIN_UPDATE_MS;
}
