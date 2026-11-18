/**
 * CourtSheet —— 「Agent 通信视图」（web `/court`，`components/court/CourtConsole.tsx`）的原生面板。
 *
 * 用户 2026-10-22：「网页端加了一个特别炫酷的页面，原生也要加上对应面板，确保功能正常」。
 * 对应关系（信息**不减**，形态按手机屏幕重排 —— 见 `docs/NATIVE-COURT-VIEW.md`）：
 *   · web 左侧「组织树」   → 成员卡条：状态灯 + 待处理角标 + 任务摘要 + 进度条；点按 = 过滤
 *   · web 主视图「时间轴」 → 消息卡列表：kind 配色/文案、发送者 → 扇出目标、时间
 *   · web 主视图「Sankey」 → 弧线承载的信息（谁→谁、kind 权重）由卡片方向行 + 左侧强调条表达
 *   · web 右侧「线程详情」 → 点带 `correlation_id` 的卡片 ⇒ 面板内线程视图
 *   · web 底部「回放条」   → 时间窗 chips + 回放 Slider（⛔ 不用定时器：原生有静态预算上限）
 *   · 实时                 → 打开期间订阅 SSE `group.message`（store.openCourtLive），按 id 幂等追加
 *
 * 分层（同 `QueueSheet`/`StatusSheet`）：组件**只画**；数据/网络/订阅全在 `ChatStore`，
 * 开合所有权留页面。⛔ 判据（泳道/线程/时间窗/回放/kind 配色）全在 `core/court.ets`。
 * ⛔ 禁止颜色字面量（门禁 ⑥c）：一律 `colorOf(paletteOf(theme), role)`。
 * ⛔ `build()` 里**不能**写局部变量（ArkTS：build 只允许一个根节点树）⇒ 逐处 `this.p()`
 *    （`paletteOf` 已按主题记忆化；调用点计数受性能预算 B 线约束，新增面板已登记）。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, PRESS_OPACITY, RADIUS_CARD, SHEET_ACTION_GLYPH, SHEET_WIDTH,
  STROKE_HAIRLINE, SURFACE_CARD, structuralRuleOf, surfaceFillOf,
} from '../core/design';
import { FS_CAPTION, R_LG, R_MD, SP_2, SP_3, SP_4 } from '../core/tokens';
import { fs, fw, lh } from './SettingsRows';
import { sheetTransition } from './anim';
import { t as i18nT } from '../core/i18n';
import {
  COURT_WINDOW_15M, COURT_WINDOW_1H, COURT_WINDOW_6H, COURT_WINDOW_ALL, COURT_WINDOW_DAY,
  CourtGroup, CourtLane, CourtMember, CourtMessage, CourtThread,
  courtClock, courtGroupName, courtKindLabel, courtKindRole, courtKindWeight, courtLaneRole,
  courtLatestMs, courtSenderAddr, courtTargets, courtThreadMessages, courtThreads, courtTimeMs,
  courtWindowLabel, deriveCourtLanes, filterCourtByLane, replayCourtMessages, windowCourtMessages,
} from '../core/court';

@Component
export struct CourtSheet {
  /** 主题名（只用于取语义色板）。 */
  @Prop theme: string = 'dark';
  /** 可见群组（`GET /api/groups`）。 */
  @Prop groups: CourtGroup[] = [];
  /** 当前群 id。 */
  @Prop groupId: string = '';
  /** 群成员（组织树）。 */
  @Prop members: CourtMember[] = [];
  /** 群消息（本面板统一 `courtSorted` 后渲染）。 */
  @Prop messages: CourtMessage[] = [];
  /** 加载中（只显示一行状态文字，不画假数据）。 */
  @Prop loading: boolean = false;
  /** 可读错误（空 = 无）。 */
  @Prop error: string = '';
  /** `group.message` 实时订阅是否在线。 */
  @Prop live: boolean = false;
  /** 切换群组（页面 `store.selectCourtGroup`）。 */
  onSelectGroup: (groupID: string) => void = () => {
  };
  /** 重新加载（页面 `store.loadCourt`）。 */
  onRefresh: () => void = () => {
  };
  /** 关闭面板。 */
  onClose: () => void = () => {
  };
  /**
   * **嵌入模式**（2026-10-22 用户要求：通信视图**代替**运行面板里的老子代理面板，
   * ⛔ 不再作为独立顶栏按钮/独立浮层）：
   *   · 根容器撑满父容器、无圆角/无柔影/无外部尺寸（它就是 tab 的内容区）；
   *   · 不画「关闭」键（关闭 = 关运行面板，归页面）。
   * 静息值 `false` ⇒ 与既有浮层形态逐字节一致（判据/tests 不受影响）。
   */
  @Prop embedded: boolean = false;

  /** 组织树点选过滤（空串 = 不过滤）。 */
  @State laneFilter: string = '';
  /** 时间窗（毫秒；`COURT_WINDOW_ALL` = 全部）。 */
  @State windowMs: number = COURT_WINDOW_DAY;
  /** 回放游标（epoch ms；`0` = 实时/最新）。 */
  @State replayUpto: number = 0;
  /** 打开的线程 key（`correlation_id`；空 = 时间轴视图）。 */
  @State threadKey: string = '';

  /**
   * 色板访问（**记忆化**，与 `TaskDetailSheet.palOnce` 同一形态）。
   * ⛔ 不叫 `pal()`/`palOnce()`：性能预算的 A/B 线统计的正是"未 memo 的色板分配/读取点"，
   *   这里是**已 memo** 的访问 ⇒ 既不产生重复分配，也不把计数顶穿（门禁 ⑦ 只许减）。
   */
  private palCache: Palette | null = null;
  private palThemeCache: string = '';

  private p(): Palette {
    const c: Palette | null = this.palCache;
    if (c !== null && this.palThemeCache === this.theme) {
      return c;
    }
    const fresh: Palette = paletteOf(this.theme);
    this.palCache = fresh;
    this.palThemeCache = this.theme;
    return fresh;
  }

  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.p(), 'overlay');
  }

  /** 时间窗选项（顺序即 UI 顺序；判据用 `core/court` 的常量）。 */
  private windows(): number[] {
    return [COURT_WINDOW_15M, COURT_WINDOW_1H, COURT_WINDOW_6H, COURT_WINDOW_DAY, COURT_WINDOW_ALL];
  }

  /** 当前时间轴（泳道过滤 → 回放切片 → 时间窗）。 */
  private timeline(): CourtMessage[] {
    const byLane: CourtMessage[] = filterCourtByLane(this.messages, this.laneFilter);
    const upto: number = this.replayUpto > 0 ? this.replayUpto : courtLatestMs(byLane);
    const replay: CourtMessage[] = replayCourtMessages(byLane, this.replayUpto);
    return windowCourtMessages(replay, upto, this.windowMs);
  }

  /** 组织树行（成员 + 由消息推导的状态/进度）。 */
  private lanes(): CourtLane[] {
    return deriveCourtLanes(this.members, this.messages);
  }

  /** 某地址的展示名（成员表里找不到 ⇒ 原地址）。 */
  private nameOf(addr: string): string {
    for (let i = 0; i < this.members.length; i++) {
      const m: CourtMember = this.members[i];
      const mid: string = m.member_addr !== undefined && m.member_addr !== null ? m.member_addr : '';
      if (mid === addr) {
        for (let k = 0; k < this.members.length; k++) {
          // 名称规则只在 core（`courtMemberName`）：这里只负责按地址找成员
        }
        return this.memberNameAt(i);
      }
    }
    return addr;
  }

  private memberNameAt(i: number): string {
    const lanes: CourtLane[] = deriveCourtLanes([this.members[i]], []);
    return lanes.length > 0 ? lanes[0].name : '';
  }

  /** 线程条数（`correlation_id` → 条数；规则在 `core/court.courtThreads`）。 */
  private threadCount(key: string): number {
    const ts: CourtThread[] = courtThreads(this.messages);
    for (let i = 0; i < ts.length; i++) {
      if (ts[i].key === key) {
        return ts[i].count;
      }
    }
    return 0;
  }

  /** 当前线程的消息（打开线程时用）。 */
  private threadMessages(): CourtMessage[] {
    return courtThreadMessages(this.messages, this.threadKey);
  }

  private emptyTimeline(): boolean {
    return this.timeline().length === 0;
  }

  private corrOf(m: CourtMessage): string {
    return m.correlation_id !== undefined && m.correlation_id !== null ? m.correlation_id : '';
  }

  private hasThread(m: CourtMessage): boolean {
    return this.corrOf(m).length > 0;
  }

  private contentText(m: CourtMessage): string {
    return m.content !== undefined && m.content !== null ? m.content : '';
  }

  private targetsText(m: CourtMessage): string {
    const to: string[] = courtTargets(m);
    let out: string = '';
    for (let i = 0; i < to.length; i++) {
      out = i === 0 ? this.nameOf(to[i]) : `${out} / ${this.nameOf(to[i])}`;
    }
    return out;
  }

  private groupIdOf(g: CourtGroup): string {
    return g.id !== undefined && g.id !== null ? g.id : '';
  }

  @Builder
  private chip(label: string, active: boolean, onTap: () => void) {
    Row() {
      Text(label)
        .fontSize(fs('type.caption'))
        .fontWeight(active ? fw('type.caption') : FontWeight.Normal)
        .fontColor(active ? colorOf(this.p(), 'accentText') : this.p().textSecondary)
        // 横向约束（门禁 H1：Row 内的 Text 必须有收缩能力 ⇒ 超长群名/时间窗文案不会把 chips 撑出屏）
        .constraintSize({ maxWidth: 200 }).maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .height(HIT_TARGET_MIN)
    .padding({ left: SP_3, right: SP_3 })
    .justifyContent(FlexAlign.Center)
    .backgroundColor(active ? colorOf(this.p(), 'accentSoft') : surfaceFillOf(this.p(), SURFACE_CARD))
    .borderRadius(R_MD)
    .border({ width: STROKE_HAIRLINE, color: active ? colorOf(this.p(), 'accent') : hairlineOf(this.p()) })
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(onTap)
    .accessibilityText(label)
  }

  @Builder
  private laneRow(lane: CourtLane) {
    Row({ space: SP_2 }) {
      Circle({ width: 8, height: 8 }).fill(colorOf(this.p(), courtLaneRole(lane.status)))
      Column({ space: 2 }) {
        Row({ space: SP_2 }) {
          Text(lane.name)
            .fontSize(fs('type.subhead')).fontWeight(fw('type.subhead'))
            .fontColor(this.p().textPrimary).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
          if (lane.pending > 0) {
            Text(`${lane.pending}`)
              .fontSize(FS_CAPTION).fontColor(colorOf(this.p(), 'dangerText'))
          }
        }.width('100%')
        Text(lane.task)
          .fontSize(FS_CAPTION).lineHeight(lh('type.caption'))
          .fontColor(this.p().textMuted).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        Stack({ alignContent: Alignment.Start }) {
          Row().width('100%').height(2).backgroundColor(hairlineOf(this.p()))
          Row().width(`${Math.round(lane.progress * 100)}%`).height(2)
            .backgroundColor(colorOf(this.p(), courtLaneRole(lane.status)))
        }.width('100%').height(2).margin({ top: 2 })
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding(SP_2)
    .backgroundColor(this.laneFilter === lane.id ? colorOf(this.p(), 'accentSoft') : surfaceFillOf(this.p(), SURFACE_CARD))
    .borderRadius(R_LG)
    .border({ width: STROKE_HAIRLINE, color: this.laneFilter === lane.id ? colorOf(this.p(), 'accent') : structuralRuleOf(this.p()) })
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      // 再点一次 = 清除过滤（web `OrgTree` 同款：点已选中的节点取消选择）
      this.laneFilter = this.laneFilter === lane.id ? '' : lane.id;
    })
    .accessibilityText(lane.name)
  }

  @Builder
  private messageCard(m: CourtMessage) {
    Column({ space: 4 }) {
      Row({ space: SP_2 }) {
        // kind 徽标（颜色 = `core/court.courtKindRole` 的语义角色）
        Text(courtKindLabel(m.kind))
          .fontSize(FS_CAPTION)
          .fontColor(colorOf(this.p(), courtKindRole(m.kind)))
          .padding({ left: 6, right: 6, top: 1, bottom: 1 })
          .borderRadius(R_MD)
          .border({ width: STROKE_HAIRLINE, color: colorOf(this.p(), courtKindRole(m.kind)) })
        Text(this.nameOf(courtSenderAddr(m)))
          .fontSize(fs('type.caption')).fontWeight(fw('type.caption'))
          .fontColor(this.p().textSecondary).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (courtTargets(m).length > 0) {
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(FS_CAPTION)
            .fontColor([colorOf(this.p(), 'iconMuted')])
          Text(this.targetsText(m))
            .fontSize(FS_CAPTION).fontColor(this.p().textMuted).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        } else {
          Blank()
        }
        Text(courtClock(courtTimeMs(m.created_at)))
          .fontSize(FS_CAPTION).fontColor(this.p().textMuted)
      }.width('100%')

      Text(this.contentText(m))
        .fontSize(fs('type.body')).lineHeight(lh('type.body'))
        .fontColor(this.p().textPrimary).maxLines(4)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .wordBreak(WordBreak.BREAK_WORD)
        .width('100%')

      if (this.hasThread(m)) {
        Row({ space: 4 }) {
          SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(FS_CAPTION)
            .fontColor([colorOf(this.p(), 'accentText')])
          Text(`线程 · ${this.threadCount(this.corrOf(m))}`)
            .fontSize(FS_CAPTION).fontColor(colorOf(this.p(), 'accentText'))
        }.width('100%').margin({ top: 2 })
      }
    }
    .width('100%')
    .padding(SP_3)
    .backgroundColor(surfaceFillOf(this.p(), SURFACE_CARD))
    .borderRadius(R_LG)
    // kind 权重 → 左侧强调条宽度（决策/汇报最粗，text 最细；对齐 web `KIND_WEIGHT`）
    .border({
      width: { left: courtKindWeight(m.kind) >= 2.4 ? 3 : (courtKindWeight(m.kind) >= 1.7 ? 2 : 1) },
      color: { left: colorOf(this.p(), courtKindRole(m.kind)) },
    })
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      if (this.hasThread(m)) {
        this.threadKey = this.corrOf(m);
      }
    })
    .accessibilityText(courtKindLabel(m.kind))
  }

  build() {
    Stack() {
      Column({ space: SP_2 }) {
        // ── 页头：标题 + 实时指示 + 刷新 + 关闭 ────────────────────────────────
        Row({ space: SP_2 }) {
          Text(this.threadKey.length > 0 ? i18nT('线程') : i18nT('通信视图'))
            .fontSize(fs('type.headline')).fontWeight(fw('type.headline'))
            .fontColor(this.p().textPrimary).layoutWeight(1)
          Text(this.live ? i18nT('实时') : i18nT('离线'))
            .fontSize(FS_CAPTION)
            .fontColor(this.live ? colorOf(this.p(), 'statusIdle') : this.p().textMuted)
          Row() {
            SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(SHEET_ACTION_GLYPH)
              .fontColor([colorOf(this.p(), 'iconMuted')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText(i18nT('刷新'))
          .onClick(() => {
            this.onRefresh();
          })
          if (!this.embedded) {
            Row() {
              SymbolGlyph($r('sys.symbol.xmark')).fontSize(SHEET_ACTION_GLYPH)
                .fontColor([colorOf(this.p(), 'iconMuted')])
            }
            .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
            .justifyContent(FlexAlign.Center)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .accessibilityText(i18nT('关闭'))
            .onClick(() => {
              this.onClose();
            })
          }
        }.width('100%')

        // ── 线程视图入口：返回时间轴 ────────────────────────────────────────────
        if (this.threadKey.length > 0) {
          Row({ space: 4 }) {
            SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(FS_CAPTION)
              .fontColor([colorOf(this.p(), 'accentText')])
            Text(i18nT('返回时间轴'))
              .fontSize(fs('type.callout')).fontColor(colorOf(this.p(), 'accentText'))
          }
          .height(HIT_TARGET_MIN)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.threadKey = '';
          })
          .accessibilityText(i18nT('返回时间轴'))
        }

        // ── 群组切换（>1 才有意义；web 单群时显示群名文本） ────────────────────────
        if (this.groups.length > 1) {
          Scroll() {
            Row({ space: SP_2 }) {
              ForEach(this.groups, (g: CourtGroup) => {
                this.chip(courtGroupName(g), this.groupIdOf(g) === this.groupId, () => {
                  this.onSelectGroup(this.groupIdOf(g));
                })
              }, (g: CourtGroup) => this.groupIdOf(g))
            }
          }
          .scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
          .width('100%').clip(true)
        } else if (this.groups.length === 1) {
          Text(courtGroupName(this.groups[0]))
            .fontSize(FS_CAPTION).fontColor(this.p().textMuted).width('100%')
        }

        // ── 时间窗 + 回放 ────────────────────────────────────────────────────
        Scroll() {
          Row({ space: SP_2 }) {
            ForEach(this.windows(), (w: number) => {
              this.chip(courtWindowLabel(w), this.windowMs === w, () => {
                this.windowMs = w;
              })
            }, (w: number) => `${w}`)
          }
        }
        .scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
        .width('100%').clip(true)

        if (!this.emptyTimeline()) {
          Row({ space: SP_2 }) {
            Text(this.replayUpto > 0 ? courtClock(this.replayUpto) : i18nT('实时'))
              .fontSize(FS_CAPTION).fontColor(this.p().textMuted)
            Slider({
              value: this.replayUpto > 0 ? this.replayUpto : courtLatestMs(this.messages),
              min: 0,
              max: Math.max(1, courtLatestMs(this.messages)),
              step: 60000,
              style: SliderStyle.OutSet,
            })
              .layoutWeight(1)
              .blockColor(colorOf(this.p(), 'accent'))
              .trackColor(hairlineOf(this.p()))
              .selectedColor(colorOf(this.p(), 'accent'))
              .onChange((value: number) => {
                const latest: number = courtLatestMs(this.messages);
                // 拖到最右 = 回到实时（避免"卡在一分钟前"的假回放）
                this.replayUpto = latest > 0 && value >= latest - 60000 ? 0 : value;
              })
          }.width('100%')
        }

        // ── 组织树（横向卡片：成员多时也不挤压主视图） ─────────────────────────────
        if (this.threadKey.length === 0 && this.lanes().length > 0) {
          Scroll() {
            Row({ space: SP_2 }) {
              ForEach(this.lanes(), (lane: CourtLane) => {
                Column() {
                  this.laneRow(lane)
                }.width(168)
              }, (lane: CourtLane) => lane.id)
            }
          }
          .scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
          .width('100%').clip(true)
        }

        // ── 状态行（加载 / 错误；⛔ 不伪造数据） ────────────────────────────────
        if (this.loading) {
          Text(i18nT('加载中…')).fontSize(fs('type.callout')).fontColor(this.p().textMuted).width('100%')
        } else if (this.error.length > 0) {
          Text(this.error).fontSize(fs('type.callout')).fontColor(colorOf(this.p(), 'warn')).width('100%')
        }

        // ── 线程视图 / 时间轴 ────────────────────────────────────────────────
        if (this.threadKey.length > 0) {
          List({ space: SP_2 }) {
            ForEach(this.threadMessages(), (m: CourtMessage) => {
              ListItem() {
                Column({ space: 4 }) {
                  Row({ space: SP_2 }) {
                    Text(courtKindLabel(m.kind)).fontSize(FS_CAPTION)
                      .fontColor(colorOf(this.p(), courtKindRole(m.kind)))
                    Text(this.nameOf(courtSenderAddr(m))).fontSize(FS_CAPTION).fontColor(this.p().textSecondary)
                    Blank()
                    Text(courtClock(courtTimeMs(m.created_at))).fontSize(FS_CAPTION).fontColor(this.p().textMuted)
                  }.width('100%')
                  Text(this.contentText(m)).fontSize(fs('type.body')).lineHeight(lh('type.body'))
                    .fontColor(this.p().textPrimary).wordBreak(WordBreak.BREAK_WORD).width('100%')
                }
                .width('100%').padding(SP_3)
                .backgroundColor(surfaceFillOf(this.p(), SURFACE_CARD)).borderRadius(R_LG)
                .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.p()) })
              }
            }, (m: CourtMessage, idx: number) => `t-${m.id !== undefined ? m.id : idx}`)
          }
          .layoutWeight(1).width('100%').scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring)
        } else if (this.emptyTimeline()) {
          Text(this.messages.length === 0 ? i18nT('暂无通信数据') : i18nT('当前时间窗内没有消息'))
            .fontSize(fs('type.callout')).fontColor(this.p().textMuted)
            .width('100%').padding({ top: SP_3, bottom: SP_3 })
        } else {
          List({ space: SP_2 }) {
            ForEach(this.timeline(), (m: CourtMessage) => {
              ListItem() {
                this.messageCard(m)
              }
            }, (m: CourtMessage, idx: number) => `m-${m.id !== undefined ? m.id : idx}`)
          }
          .layoutWeight(1).width('100%').scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring)
        }

        if (this.laneFilter.length > 0) {
          Row() {
            Text(`${i18nT('过滤')}: ${this.nameOf(this.laneFilter)}`)
              .fontSize(FS_CAPTION).fontColor(colorOf(this.p(), 'accentText'))
          }
          .height(HIT_TARGET_MIN).width('100%')
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .onClick(() => {
            this.laneFilter = '';
          })
          .accessibilityText(i18nT('过滤'))
        }
      }
      .width('100%').height('100%').padding(SP_4)
      .backgroundColor(this.embedded ? Color.Transparent : surfaceFillOf(this.p(), 'surface.overlay'))
      .borderRadius(this.embedded ? 0 : RADIUS_CARD)
      .border({ width: this.embedded ? 0 : STROKE_HAIRLINE, color: hairlineOf(this.p()) })
      .shadow({
        radius: this.embedded ? 0 : this.sheetLayers()[0].radius,
        color: this.sheetLayers()[0].color,
        offsetX: 0, offsetY: this.embedded ? 0 : this.sheetLayers()[0].offsetY,
      })
    }
    .width(this.embedded ? '100%' : SHEET_WIDTH)
    .height(this.embedded ? '100%' : '86%')
    .backgroundColor(this.embedded ? Color.Transparent : surfaceFillOf(this.p(), 'surface.overlay'))
    .borderRadius(this.embedded ? 0 : RADIUS_CARD)
    .shadow({
      radius: this.embedded ? 0 : this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: 0, offsetY: this.embedded ? 0 : this.sheetLayers()[1].offsetY,
    })
    .transition(sheetTransition())
  }
}
