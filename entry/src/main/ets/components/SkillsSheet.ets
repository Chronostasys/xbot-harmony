/**
 * SkillsSheet —— **技能管理**面板（原生，目标④「真的支持 web 的所有插件和功能」）。
 *
 * 对齐对象：web 内置前端插件 `xbot.skill-manager` 的面板
 * （`web/src/plugins/xbot-skill-manager/SkillManagerPanel.tsx`，`container='right_sidebar'`）。
 * 原生此前**零覆盖** ⇒ 本面板补齐（视图原生重做，**契约与判据**仍以服务端/web 为权威）。
 *
 * ── 分层（同 `FilesSheet`/`PluginsSheet`/`StatusSheet`）────────────────────────
 * 组件**只画**：`loading`/`error`/`items`/`view*` 全是页面 `@State`，组件收 `@Prop` + 回调。
 *
 * ── 单一判据（⛔ 组件不写第二套）──────────────────────────────────────────────
 * 分组/档序/组标题/计数文案/路径提示/开关可访问性文案**全部**读 `core/skills.ets`
 * （与 `tools/tests/skills_pure.test.ts` 同一份纯函数）。列表行模型 = `skillRows()`
 * **摊平**成一维（组标题行 ⊕ 条目行）⇒ 渲染只需**一处** `ForEach`
 * （性能预算 ⑦ 的 `ForEach(` 是全仓硬上限；本批已把静态骨架屏的 `ForEach` 展开抵消，**净额不变**）。
 *
 * ── 三态 ────────────────────────────────────────────────────────────────────
 * 加载（一行小字，⛔ 不另起 spinner —— 全站同一时刻只允许一个在飞动效）、
 * 失败（红字 + 重试）、空（一行灰字）。
 *
 * ── 取色（⛔ 唯一入口）──────────────────────────────────────────────────────
 * 记忆化 `paletteOf(this.theme)`：**含** `APP_ACCENT` 覆盖（缓存键 = `主题|强调色`，
 * `core/theme.ets:575-587`）⇒ 强调色不丢；且它**不计入**性能预算 A/B 线（A/B 只数
 * `this.pal()` / `paletteOf(this.theme)`）。⛔ 不与"未 memo 的 `this.pal()`"混用。
 */
import { paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import {
  SKILL_ROW_GROUP, SKILL_ROW_ITEM, SkillItem, SkillRow, skillPathHint, skillRows, skillSummaryText,
  skillToggleLabel,
} from '../core/skills';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, INSET_ROW_X, PRESS_OPACITY, RADIUS_CHIP, RADIUS_SHEET,
  SHEET_ACTION_GLYPH, SPACE_MD, SPACE_SM, SPACE_XS, STROKE_HAIRLINE, surfaceFillOf, typeOf,
} from '../core/design';
// 本面板是**侧栏**（不是底部面板）⇒ 横向滑入（与 `DrawerSheet`/`FilesSheet` 同语义）。
import { drawerTransition } from './anim';
import { MarkdownView } from './MarkdownView';
import { t as i18nT } from '../core/i18n';

@Component
export struct SkillsSheet {
  // 语言切换订阅：所有存量组件实例在 setLocale 后自行 rebuild（@StorageProp 组件级订阅，
  // 不依赖父级 ForEach/LazyForEach 重投递）。
  @StorageProp('appLocale') localeStamp: string = '';
  @Prop theme: string = 'dark';
  /** 是否正在拉列表。 */
  @Prop loading: boolean = false;
  /** 失败原因（**已可读化**；空 = 无错）。 */
  @Prop error: string = '';
  /**
   * 技能列表（页面投影）。
   * ⛔ 渲染读 `skillRows(this.items)`（纯函数）；`ForEach` 的 key **含启用态**
   *   ⇒ 开关后行**必重建**（不吃"最小通知键"的亏 —— `docs/ARKTS-GOTCHAS.md` 的 LazyForEach 坑）。
   */
  @Prop items: SkillItem[] = [];
  /** 阅读态：技能名非空 ⇒ 面板切到 `SKILL.md` 视图。 */
  @Prop viewName: string = '';
  @Prop viewText: string = '';
  @Prop viewLoading: boolean = false;
  @Prop fontScale: number = 1;
  @Prop wrapCode: boolean = true;
  @Prop mdTheme: string = 'vscode-dark';
  /** 开关一条技能（页面做乐观更新 + 失败回滚）。 */
  onToggle: (name: string, enabled: boolean) => void = () => {
  };
  /** 打开一条技能的 `SKILL.md`（页面异步取内容）。 */
  onOpen: (item: SkillItem) => void = () => {
  };
  onClosePreview: () => void = () => {
  };
  onRefresh: () => void = () => {
  };
  onClose: () => void = () => {
  };

  /** 本面板柔影（两层数组恒返 `[near, far]`；侧栏取环境层 `far`）。 */
  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(paletteOf(this.theme), 'overlay');
  }

  build() {
    Column() {
      // ── 头部：返回（阅读态）/ 标题 / 刷新 / 关闭 ───────────────────────────────
      Row({ space: SPACE_XS }) {
        if (this.viewName.length > 0) {
          Row() {
            SymbolGlyph($r('sys.symbol.chevron_left'))
              .fontSize(22).fontColor([colorOf(paletteOf(this.theme), 'iconMuted')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText(i18nT('返回技能列表'))
          .onClick(() => {
            this.onClosePreview();
          })
        }
        Text(this.viewName.length > 0 ? this.viewName : '技能')
          .fontSize(typeOf('type.headline').size)
          .fontWeight(typeOf('type.headline').weight)
          .fontColor(paletteOf(this.theme).textPrimary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        if (this.viewName.length === 0) {
          Row() {
            SymbolGlyph($r('sys.symbol.arrow_clockwise'))
              .fontSize(22).fontColor([colorOf(paletteOf(this.theme), 'iconMuted')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText(i18nT('刷新技能列表'))
          .onClick(() => {
            this.onRefresh();
          })
        }
        Row() {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(SHEET_ACTION_GLYPH).fontColor([colorOf(paletteOf(this.theme), 'iconMuted')])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText(i18nT('关闭技能面板'))
        .onClick(() => {
          this.onClose();
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      if (this.viewName.length === 0) {
        // ── 计数（⛔ 判据同源：`skillSummaryText`）──────────────────────────────
        Text(skillSummaryText(this.items))
          .fontSize(typeOf('type.caption').size)
          .fontColor(paletteOf(this.theme).textSecondary)
          .width('100%')
          .padding({ bottom: SPACE_XS })

        if (this.loading) {
          Text(i18nT('读取技能…'))
            .fontSize(typeOf('type.subhead').size)
            .fontColor(paletteOf(this.theme).textSecondary)
            .width('100%')
            .padding({ top: SPACE_MD, bottom: SPACE_MD })
        } else if (this.error.length > 0) {
          Row({ space: SPACE_SM }) {
            Text(this.error)
              .fontSize(typeOf('type.subhead').size)
              .fontColor(paletteOf(this.theme).dangerText)
              .layoutWeight(1)
              .maxLines(3)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(i18nT('重试'))
              .fontSize(typeOf('type.subhead').size)
              .fontColor(paletteOf(this.theme).accentSoft)
              .padding({ left: SPACE_SM, right: SPACE_SM })
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.onRefresh();
              })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
        } else if (this.items.length === 0) {
          // 空态（2026-10-13 对标 Apple）：大号弱化字形 + 说明，并在内容区**居中**
          // （`layoutWeight(1)` 占满剩余空间才是"居中"的前提）。字形 `star` 已核对存在于
          // SDK 资源表（`previewer/common/resources/entry/resources.txt`；⛔ 不猜字形）。
          Column({ space: SPACE_SM }) {
            SymbolGlyph($r('sys.symbol.star'))
              .fontSize(typeOf('type.display').size)
              // ⛔ 图标弱色**只能**走 `colorOf(p,'iconMuted')`（`textMuted` 的批准档是
              // 「非交互元信息文本」=2，图标是**非文本** ⇒ 需 ≥3；仓内铁律见 AGENTS.md）。
              .fontColor([colorOf(paletteOf(this.theme), 'iconMuted')])
            Text(i18nT('暂无技能'))
              .fontSize(typeOf('type.subhead').size)
              .fontColor(paletteOf(this.theme).textSecondary)
              .width('100%')
              .textAlign(TextAlign.Center)
            // S2（对标 Apple 空态层级）：补**提示行**（怎么说才会有）——与运行面板 `PanelEmpty` 同形。
            Text(i18nT('技能由服务端技能目录提供'))
              .fontSize(typeOf('type.caption').size)
              .fontColor(paletteOf(this.theme).textMuted)
              .width('100%')
              .textAlign(TextAlign.Center)
          }
          .width('100%')
          .layoutWeight(1)
          .justifyContent(FlexAlign.Center)
          .alignItems(HorizontalAlign.Center)
          .padding({ top: SPACE_MD, bottom: SPACE_MD })
        } else {
          List() {
            ForEach(skillRows(this.items), (r: SkillRow) => {
              ListItem() {
                if (r.kind === SKILL_ROW_GROUP) {
                  // 分组标题行（小节标题：小字 + 弱色，按苹果的分组语义）
                  Text(r.label)
                    .fontSize(typeOf('type.caption').size)
                    .fontColor(paletteOf(this.theme).textMuted)
                    .width('100%')
                    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_SM, bottom: SPACE_XS })
                } else {
                  if (r.item !== undefined) {
                    Row({ space: SPACE_SM }) {
                      Column({ space: 2 }) {
                        Text(r.item!.name)
                          .constraintSize({ maxWidth: '100%' })
                          .fontSize(typeOf('type.callout').size)
                          .fontColor(paletteOf(this.theme).textPrimary)
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                          .width('100%')
                        if (r.item!.description.length > 0) {
                          Text(r.item!.description)
                            .constraintSize({ maxWidth: '100%' })
                            .fontSize(typeOf('type.caption').size)
                            .fontColor(paletteOf(this.theme).textSecondary)
                            .maxLines(2)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .width('100%')
                        }
                        if (skillPathHint(r.item!.path).length > 0) {
                          Text(skillPathHint(r.item!.path))
                            .constraintSize({ maxWidth: '100%' })
                            .fontSize(typeOf('type.micro').size)
                            .fontColor(paletteOf(this.theme).textMuted)
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                            .width('100%')
                        }
                      }
                      .layoutWeight(1)
                      .alignItems(HorizontalAlign.Start)
                      // 开关（Switch）：`.selectedColor` 走**用户强调色**（⛔ 不写死绿色）
                      Toggle({ type: ToggleType.Switch, isOn: r.item!.enabled })
                        .selectedColor(paletteOf(this.theme).accent)
                        .accessibilityText(skillToggleLabel(r.item!.name, r.item!.enabled))
                        .onChange((on: boolean) => {
                          this.onToggle(r.item!.name, on);
                        })
                    }
                    .width('100%')
                    .constraintSize({ minHeight: HIT_TARGET_MIN })
                    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_XS, bottom: SPACE_XS })
                    .alignItems(VerticalAlign.Center)
                    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                    .onClick(() => {
                      // 点行（非开关区）= 打开 `SKILL.md`（对齐 web `handleView`）
                      this.onOpen(r.item!);
                    })
                  }
                }
              }
            }, (r: SkillRow) => `${r.kind}|${r.label}|${r.item !== undefined && r.item!.enabled ? 'on' : 'off'}`)
          }
          .layoutWeight(1)
          .width('100%')
          .scrollBar(BarState.Off)
          .divider({ strokeWidth: STROKE_HAIRLINE, color: hairlineOf(paletteOf(this.theme)), startMargin: INSET_ROW_X })
        }
      } else {
        // ── SKILL.md 阅读视图（复用聊天正文同一渲染器）──────────────────────────
        if (this.viewLoading) {
          Text(i18nT('读取技能说明…'))
            .fontSize(typeOf('type.subhead').size)
            .fontColor(paletteOf(this.theme).textSecondary)
            .width('100%')
            .padding({ top: SPACE_MD })
        } else {
          Scroll() {
            MarkdownView({
              text: this.viewText,
              theme: this.theme,
              mdTheme: this.mdTheme,
              fontScale: this.fontScale,
              wrapCode: this.wrapCode,
            })
          }
          .layoutWeight(1)
          .width('100%')
          .scrollBar(BarState.Off)
        }
      }
    }
    .width('100%')
    .height('100%')
    .padding(SPACE_MD)
    .backgroundColor(surfaceFillOf(paletteOf(this.theme), 'surface.overlay'))
    .borderWidth({ left: STROKE_HAIRLINE })
    .borderColor(hairlineOf(paletteOf(this.theme)))
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: SPACE_XS,
      offsetY: 0,
    })
    .transition(drawerTransition())
  }
}
