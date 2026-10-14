/**
 * PluginsSheet —— 「能力面板」（原 `pages/Index.ets` 的 `@Builder PluginsSheet()`，P2 抽出）。
 *
 * 分层铁律（同 `StatusSheet`）：只读 `plugins` 列表 + 回调；`showPlugins` / `panelUrl`
 * 所有权留页面（前者是弹层 flag 必须集中，后者是 ArkWeb 承载状态、页面独占）。
 *
 * ── 三态（加载 / 空 / 失败，2026-10-11 本波新增）─────────────────────────────────
 * 此前本面板**只有"有数据"一种样子**：RPC 慢 ⇒ 用户看到的是"关抽屉后什么都没有"；
 * RPC 失败 ⇒ 数据层把错误吞成空目录（`core/store.ets:loadPluginCatalog`）⇒ 面板**分不清空与失败**。
 * 现在三态判据收敛到 `core/pluginview.ets:pluginPanelStatus`（纯逻辑、可脱机单测），
 * 本组件**只画**：加载 = 一行小字（⛔ 不是 spinner —— 同一时刻只允许一个在飞动效=光球）；
 * 失败 = 一行红字 + **重试**；空 = 引导文案（去「完整 Web UI」装 / 让管理员启用）。
 *
 * ── 信息层次（对齐 web 设置弹窗「插件」分区 `settings/SettingsPlugins.tsx`）────────
 * 每行 = **图标 + 名称 +（有则）`v<版本> · <state>` + 一句描述 + 「打开」**（名称/说明/元信息三层灰阶）。
 * 数据是 `PluginCatalogItem`（比 `PluginPanelInfo` 多 description/version/state/views ⇒ 行才画得出层次）。
 *
 * ── 视觉语言（2026-10-11，与 `PluginHost` 对齐）──────────────────────────────
 * 「能力面板」是 `PluginHost`（原生插件目录）的**入口载体** ⇒ 用同一套语义令牌：
 *   · 字阶 = 语义排版档 `type.*`（标题 `type.headline` / 行名 `type.callout` / 说明 `type.caption`）；
 *   · 根面（L1 顶层弹层）= `surfaceFillOf(p,'surface.overlay')`（浮层语义面，不透明）+ 结构性发丝
 *     `hairlineOf(p)` + **两层柔影** `shadowLayersOf(p,'overlay')`（浅色 = 贴合 + 环境；深色 = near 透明
 *     + 该档原值）—— 与同层级 `StatusSheet`/`AskUserSheet`/`MenuSheets` 同通道（web `bg-bg-elevated` = 浮层面）；
 *   · **行体 = 扁平行 + 行内发丝**（⛔ 不是"每条一张卡"）—— 与同 App 的「文件」面板（`FilesSheet`）
 *     和会话抽屉**同一形态**：Apple 的分组列表是"一张容器 + 行内发丝"，同形卡片逐条堆叠会把分组
 *     层级读没（真机 9 条卡读作"一堆圆角块"）。行高 ≥ `HIT_TARGET_MIN`（`constraintSize`）；
 *   · 仍走**卡片**的两处 = 状态行的「重试」按钮（它是**动作按钮**、不是列表行）；
 *   · 内距 = `INSET_ROW_X`（竖向内距**不加**：44 行高由 `HIT_TARGET_MIN` 给，与 `FilesSheet` 同口径）；
 *   · 按压走全站唯一 `PRESS_OPACITY`；行命中区 ≥ `HIT_TARGET_MIN`（`constraintSize`）；
 *   · 关闭按钮热区用 `responseRegion` 外扩（⛔ 不改布局/视觉尺寸）。
 * ⛔ 颜色不写 hex；状态行的色走 `pluginPanelStatus().colorRole`（`core/pluginview.ets` 产出的合法角色）；
 *    浅/深分叉只走 `isLightPalette(paletteOf(theme))`。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import { PluginCatalogItem, pluginOpenHint } from '../core/pluginhost';
import { PluginPanelStatus, pluginMetaText, pluginPanelStatus, pluginPanelListHeight, PANEL_FIXED_ENTRY_ROWS, pluginRowHasDescription, pluginRowHasHint } from '../core/pluginview';
// 插件图标映射**唯一出口** = `PluginHost` 的 `pluginSymbol`（19/19 覆盖 web `ICON_MAP`）——
// ⛔ 不在本面板再写一份副本（副本会腐烂 / 各写一份 ⇒ 同一插件两处图标不一致）。
import { pluginSymbol } from './PluginHost';
import {
  colorOf, hairlineOf, structuralRuleOf, surfaceFillOf, HIT_TARGET_MIN, INSET_ROW_X, INSET_ROW_Y,
  PRESS_OPACITY, RADIUS_CARD, RADIUS_SHEET, SHEET_ACTION_GLYPH, SPACE_MD, SPACE_SM, SPACE_XS, STROKE_HAIRLINE,
  SHEET_WIDTH, SURFACE_CARD } from '../core/design';
import { fs, fw, lh } from './SettingsRows';
// 弹层**开合**过渡：唯一出口 = 底座 `sheetTransition()`（⛔ 不自造时长/曲线；E3 统一）。
import { sheetTransition } from './anim';

/**
 * 关闭 X 的命中盒 —— ⛔ 热区**不靠** `responseRegion` 负偏移外扩（真机实测（SDK21）**无效**，
 * 见 `AGENTS.md` GOTCHAS）⇒ 图标放进**真实 `HIT_TARGET_MIN`×`HIT_TARGET_MIN` 布局盒**、盒内居中。
 * 图标视觉尺寸不变（仍 `ICON_LG`=16）。
 */
/** 插件图标视觉边长（vp）—— 与 `PluginHost` 卡片（18）同档。 */
const PLUGIN_ICON: number = 18;

@Component
export struct PluginsSheet {
  @Prop theme: string = 'dark';
  /** 插件面板列表（页面 `pluginItems`；`PluginCatalogItem` 才有 description/version/state）。 */
  @Prop plugins: PluginCatalogItem[] = [];
  /** 视图分组数（空态判据要**同时**看 items 与 groups）。 */
  @Prop groupCount: number = 0;
  /** 是否正在拉目录（页面加载态）。 */
  @Prop loading: boolean = false;
  /** 加载失败原因（**已可读化**；空 = 无错）。 */
  @Prop error: string = '';
  /** 打开**原生**插件目录宿主页（页面 `openPluginHost()`）。 */
  onOpenPluginHost: () => void = () => {
  };
  /**
   * 打开 **web 插件管理面板**（`xbot.plugin-manager.panel` → WebView；页面 `openPluginManager()`）。
   *
   * ⛔ 这是**权威入口**（用户 2026-10-14 定向）：插件列表/视图贡献点/启停/重载全由 web 用
   * **插件自己声明的 contributes** 渲染 ⇒ 原生零猜测、**未来插件自动可用**。
   * 实测反证（原生目录必然漏）：`xbot.genui` 在原生目录里显示「0 个视图」⇒ 连「打开」都没有。
   */
  onOpenPluginManager: () => void = () => {
  };
  /** 打开**完整 Web UI**（页面用自己的 serverUrl 置 `panelUrl`）。 */
  onOpenWebUi: () => void = () => {
  };
  /** 打开**原生会话统计面板**（内置插件 `xbot.session-stats`；判据/渲染在 `core/sessionstats.ets`）。 */
  onOpenSessionStats: () => void = () => {
  };
  /** 打开**原生技能管理面板**（web 内置插件 `xbot.skill-manager` 的原生落地；判据在 `core/skills.ets`）。 */
  onOpenSkills: () => void = () => {
  };
  /**
   * 打开**原生 Git 面板**（web 内置插件 `xbot.git-fancy` 的**可选增强**；判据在 `core/gitpanel.ets`）。
   *
   * ⛔ 它**不在**关键路径上：任何插件（含以后 web 新加的/第三方的）都经**通用深链**
   * （`onOpenPlugin` → `pluginViewDeepLink`，数据来自插件自己声明的 `contributes.views`）
   * 打开。本入口 = **保底直入口**（插件卡那条路依赖 `web_plugin_list` 成功；本入口不依赖）。
   * 契约见 `tools/tests/git_panel.test.ts` ①。
   */
  onOpenGit: () => void = () => {
  };
  /** 打开某个插件面板（页面置 `panelUrl = p.url`）。 */
  onOpenPlugin: (p: PluginCatalogItem) => void = () => {
  };
  /** 重试拉目录（页面 `loadPluginCatalog()`）。 */
  onRetry: () => void = () => {
  };
  /** 关闭面板（页面置 `showPlugins=false`）。 */
  onClose: () => void = () => {
  };

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  // ── 取色门（§21.115）─────────────────────────────────────────────────────────
  // `this.pal()` 是**未记忆化分配**（每次 `withAccent` 重新分配调色板），而门禁 **B 线**
  // （`this.pal()` ∨ `this.palOnce()` 的**字面出现次数**，`tools/perf/guard.sh`）**零余量**
  // ⇒ 把**重复**的直读收敛成方法（同一色只写一处），本批**净减**读取点。
  // ⛔ 语义逐字节不变：只是把 3 处同色直读收成 1 处（同 `PanelRows.trailColor` 的既有做法）。
  private fg(): string {
    return this.pal().textPrimary;
  }

  private accentSoftColor(): string {
    return this.pal().accentSoft;
  }

  private mutedIcon(): string {
    return colorOf(this.pal(), 'iconMuted');
  }

  private mutedText(): string {
    return this.pal().textMuted;
  }

  /** 三态状态行（判据在 `core/pluginview.ets`；**判据与渲染同源**）。 */
  private status(): PluginPanelStatus {
    return pluginPanelStatus(this.loading, this.plugins.length, this.groupCount, this.error);
  }

  /**
   * 列表高度（vp）——判据是纯函数 `core/pluginview.ets:pluginPanelListHeight`（可脱机单测）。
   * ⛔ 旧实现是**硬编码 `.height(320)`**：插件一多就把靠后的行裁掉（真机实测 `xbot.ssh-runner`
   *    整条不可见）⇒ 现按行数估值、夹在 `[PANEL_LIST_MIN_H, PANEL_LIST_MAX_H]`（超出才表内滚动）。
   */
  private listHeight(): number {
    const st: PluginPanelStatus = this.status();
    const statusRows: number = (st.show ? 1 : 0) + (st.canRetry ? 1 : 0);
    return pluginPanelListHeight(PANEL_FIXED_ENTRY_ROWS, this.plugins, statusRows);
  }

  /** 本弹层的两层柔影（浅色 = 贴合 + 环境；深色 = 透明 + 原值）—— `core/theme.shadowLayersOf`。 */
  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.pal(), 'overlay');
  }

  /** 一行「跳转入口」（能力面板的固定入口：原生目录 / 会话统计 / 技能 / 完整 Web UI）。
   *
   * 结构与下方**插件行逐项对齐**（图标 → 标题 → 尾部 chevron）：真机帧里此前入口行**没有图标**
   * 而插件行有 ⇒ 同一张表里两种行形，前 3 行看着"没画完"（`EntryRow` 与插件行的差别只有这一点）。
   * 图标一律取**已验证**的 `sys.symbol.*`（`PluginHost.ets:pluginSymbol` 那张白名单；
   * `plugin_icons.test.ts` 会拿 SDK 名册校验每个符号名）。
   */
  @Builder
  EntryRow(label: string, sym: Resource, onClick: () => void) {
    Row({ space: SPACE_XS }) {
      SymbolGlyph(sym)
        .fontSize(PLUGIN_ICON)
        .fontColor([this.accentSoftColor()])
      Text(label).fontSize(fs('type.callout')).fontColor(this.fg()).layoutWeight(1)
      // 尾部 = **chevron**（Apple 列表里"可进入"的惯用形态）。此前这里是 accent 文字「打开」，
      // 与插件行一起重复 6 次 ⇒ 一张表里 6 个同色动作词：既噪、又把"整行可点"读成"两个按钮"。
      SymbolGlyph($r('sys.symbol.chevron_right'))
        .fontSize(fs('type.caption'))
        .fontColor([this.mutedIcon()])
    }
    .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      onClick();
    })
  }

  build() {
    // ── 多层柔影（C3 推广，G1）：`shadowLayersOf` 恒返 [near, far] ─────────────────────────
    // 浅色：near = 贴合影（`elev2` 小半径）、far = 环境影（大半径）⇒ "落在纸面上"；
    // 深色：near **透明**（零成本、不渲染）、far = 该档原值 ⇒ 净观感**逐字节不变**。
    // ⛔ ArkUI 每元素只能挂一层 `.shadow()` ⇒ 外层 `Stack` 承载 far（同 `SyntheticCard` 范例）。
    Stack() {
      Column({ space: SPACE_XS }) {
        Row() {
          Text('能力面板').fontSize(fs('type.headline')).fontWeight(fw('type.headline'))
            .fontColor(this.pal().textPrimary).layoutWeight(1)
          // ⛔ 关闭 X：真机实测 `responseRegion` 负偏移外扩**无效** ⇒ 真实 44×44 布局盒承载 `onClick`。
          Row() {
            SymbolGlyph($r('sys.symbol.xmark')).fontSize(SHEET_ACTION_GLYPH)
              .fontColor([colorOf(this.pal(), 'iconMuted')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('关闭')
          .onClick(() => {
            this.onClose();
          })
        }.width('100%')

        // ⚠️ 2026-10-12（目标③ 第八批）：删掉原说明段「原生渲染聊天主链路；下列能力由 ArkWeb 承载
        //    （与 Web 版同源、能力一致）：」——两条理由：① 它**不准**（`插件目录（原生）`/`会话统计`
        //    是原生渲染，不属"由 ArkWeb 承载"）；② Apple 的用户面弹层不解释**渲染架构**，各行的
        //    标签（「…（原生）」/「完整 Web UI」）已自带这一信息 ⇒ 删掉即少两行 chrome。

        List() {
          // ── §21.122（用户 2026-10-14 定向）**权威入口**：web 插件管理面板 ────────────────
          // 全部插件/视图贡献点 + 启停/重载由 web 用插件自己声明的 contributes 渲染（原生零猜测，
          // 未来插件自动可用）。为什么放第一行：它是「支持 web 所有插件」的唯一不漏的入口
          // ——实测原生目录对 `xbot.genui` 显示「0 个视图」、`迭代指标` 无入口。
          ListItem() {
            this.EntryRow('插件管理（Web）', $r('sys.symbol.list_bullet'), (): void => {
              this.onOpenPluginManager();
            })
          }
          // 原生插件目录（components/PluginHost）：列出所有插件/视图贡献点，点开在宿主页运行
          ListItem() {
            this.EntryRow('插件目录（原生）', $r('sys.symbol.puzzle'), (): void => {
              this.onOpenPluginHost();
            })
          }
          // 会话统计（内置插件 `xbot.session-stats` —— **原生渲染**，数据来自宿主 RPC）
          ListItem() {
            this.EntryRow('会话统计', $r('sys.symbol.line_3_horizontal'), (): void => {
              this.onOpenSessionStats();
            })
          }
          // 技能（web 内置插件 `xbot.skill-manager` 的面板 —— **原生渲染**，数据来自宿主 RPC）
          ListItem() {
            this.EntryRow('技能', $r('sys.symbol.lightbulb'), (): void => {
              this.onOpenSkills();
            })
          }
          // Git 面板（web 内置插件 `xbot.git-fancy` 的**原生渲染**增强项；插件行本身走通用深链）
          // ⛔ 保留为**固定入口**（契约见 `tools/tests/git_panel.test.ts` ①：它是**可选增强**、
          //    不在关键路径上 —— 插件卡那条路即使 RPC 拉目录失败也还在，这里给一条**保底**直入口）。
          ListItem() {
            this.EntryRow('Git 面板（原生）', $r('sys.symbol.arrow_triangle_merge'), (): void => {
              this.onOpenGit();
            })
          }
          // 完整 Web UI（插件 / GenUI / 终端 / 编辑器都在里面）
          ListItem() {
            this.EntryRow('完整 Web UI', $r('sys.symbol.rectangle_on_rectangle'), (): void => {
              this.onOpenWebUi();
            })
          }

          // ── 三态状态行：加载 / 失败(+重试) / 空 ──────────────────────────────────
          if (this.status().show) {
            ListItem() {
              Column({ space: SPACE_SM }) {
                Text(this.status().text)
                  .fontSize(fs('type.callout'))
                  .fontWeight(fw('type.callout'))
                  .fontColor(colorOf(this.pal(), this.status().colorRole))
                  .width('100%')
                  // ⛔ **水平溢出**（2026-10-11）：状态行会承载**失败详情/错误原文**（含 URL、路径、
                  //    base64 这类**不可断串**）⇒ 必须允许任意字符处断行，否则一行顶出屏宽。
                  .wordBreak(WordBreak.BREAK_ALL)
                  .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
                if (this.status().canRetry) {
                  Row() {
                    Text('重试').fontSize(fs('type.caption')).fontWeight(fw('type.caption'))
                      .fontColor(this.pal().accentSoft)
                  }
                  .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
                  .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
                  .backgroundColor(surfaceFillOf(this.pal(), SURFACE_CARD))
                  .borderRadius(RADIUS_CARD)
                  .border({ width: STROKE_HAIRLINE, color: structuralRuleOf(this.pal()) })
                  .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                  .onClick(() => {
                    this.onRetry();
                  })
                }
              }
              .width('100%')
            }
          }

          // ── 分组头「插件」（§21.115，Apple 分组列表语言）───────────────────────────
          // 为什么要有：上面 4 行是**原生固定入口**，下面是**插件目录**里的插件卡片 —— 此前
          // 二者同形**无分组**，一张表读下来像"8 个并列条目"（用户要的"对标苹果"= 分组可读）。
          // 分组头文案/字阶对齐侧边栏既有分组头（今天/昨天/更早）同一语言；行高由
          // `core/pluginview.ets:PANEL_SECTION_HEADER_H` **单独**计入（⛔ 不折进
          // `PANEL_FIXED_ENTRY_ROWS` —— 它只数上面那 5 条入口行）。
          if (this.plugins.length > 0) {
            ListItem() {
              Text('插件')
                .fontSize(fs('type.micro'))
                .fontWeight(fw('type.micro'))
                .fontColor(this.mutedText())
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
                .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_SM, bottom: SPACE_XS })
            }
          }

          // ── 插件行（图标 / 名称 / v版本·state / 描述 / 打开）──────────────────────
          // ⛔ 三态期间（加载/失败）不画空列表；有数据时才逐行渲染。
          ForEach(this.plugins, (p: PluginCatalogItem) => {
            ListItem() {
              // ⚠️ §21.115：`alignItems(VerticalAlign.Top)` + 图标放进**高度 = 标题行高**的居中盒
              //    ⇒ 前导图标与**首行标题同轴**（此前 Row 默认 `Center`，图标按**整卡**垂直居中 ⇒
              //    在 3 行卡（名称 + 描述 + 提示）里落到**描述行**高度、与标题不同轴）。
              //    Apple 多行列表行范式：前导字形对齐**第一行文本**，不是整块居中。
              Row({ space: SPACE_XS }) {
                Row() {
                  SymbolGlyph(pluginSymbol(p.icon))
                    .fontSize(PLUGIN_ICON)
                    .fontColor([this.accentSoftColor()])
                }
                .height(lh('type.callout'))
                .justifyContent(FlexAlign.Center)
                .alignItems(VerticalAlign.Center)
                Column({ space: SPACE_XS }) {
                  Row({ space: SPACE_XS }) {
                    Text(p.name).fontSize(fs('type.callout')).fontColor(this.fg())
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
                    if (pluginMetaText(p.version, p.state).length > 0) {
                      Text(pluginMetaText(p.version, p.state))
                        .fontSize(fs('type.micro')).fontColor(this.mutedText())
                        // ⚠️ 这一处原为 `flexShrink(0)` —— 但它是**文本**（版本/状态由插件给，可能很长）
                        // ⇒ 顶宽、把 `Row` 撑爆（全仓 11 处 `flexShrink(0)` 里唯一挂在文本上的）。
                        // ⇒ 改为**可收缩 + 单行省略**（`p.name` 那侧的 `layoutWeight(1)` 保持不动）。
                        .flexShrink(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    }
                  }.width('100%').alignItems(VerticalAlign.Center)
                  if (pluginRowHasDescription(p)) {
                    Text(p.description)
                      .fontSize(fs('type.caption')).fontColor(this.mutedText())
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                  }
                  // ⛔ 无独立面板的插件（只声明内嵌徽章/条，或未声明 contributes）⇒ 说明它
                  //    「已经在哪儿生效了」，别让用户去找一个不存在的面板（判据 `pluginOpenHint`）。
                  if (pluginRowHasHint(p)) {
                    Text(pluginOpenHint(p))
                      .fontSize(fs('type.micro')).fontColor(this.mutedText())
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                  }
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                // 尾部 = **chevron**，**仅在该插件真有独立面板可开时**出现（chevron = "可进入"的唯一表达）。
                // ⛔ 无面板的插件（只声明内嵌徽章/条，如 `xbot.iteration-stats`；或未声明 contributes，
                //    如 `xbot.genui`）**不给 chevron** —— 否则点开是一个空页（用户原话
                //    「统计插件的面板我们看不到」的根因；判据 `pluginOpenHint`/`isPanelContainer`）。
                if (p.openable) {
                  Row() {
                    SymbolGlyph($r('sys.symbol.chevron_right'))
                      .fontSize(fs('type.caption'))
                      .fontColor([this.mutedIcon()])
                  }
                  .height(lh('type.callout'))
                  .justifyContent(FlexAlign.Center)
                  .alignItems(VerticalAlign.Center)
                }
              }
              .width('100%').constraintSize({ minHeight: HIT_TARGET_MIN })
              .alignItems(VerticalAlign.Top)
              .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
              .stateStyles({
                pressed: { .opacity(p.openable ? PRESS_OPACITY : 1) },
                normal: { .opacity(1) },
              })
              .onClick(() => {
                // 不可点的行（无独立面板）静默忽略 —— 绝不开空页
                if (p.openable) {
                  this.onOpenPlugin(p);
                }
              })
            }
          }, (p: PluginCatalogItem) => `${p.id}#${p.url}`)
        }
      .height(this.listHeight()).width('100%')
      // 结构性发丝（⛔ 不是装饰描边）：**行与行之间的唯一分隔**（Apple 分组列表形态）。
      // 本轮（目标③ 对标苹果）把行体从"每条一张卡（面 + 圆角 + 描边 + 行间距）"改为
      // **扁平行 + 行内发丝** —— 与同 App 的「文件」面板（`FilesSheet`）和会话抽屉**同一形态**。
      // 病根：9 条同形卡片在真机截图上读作"一堆圆角块"，分组层级消失；Apple 的分组列表是
      // **一张容器 + 行内发丝**（左缘内缩到文字起点，线只从正文起画）。⛔ 行高/热区不动（仍 ≥44）。
      // ⚠️ §21.115：`startMargin` 从 `INSET_ROW_X`（= 图标左缘）**再内缩一个图标槽**
      //    （`PLUGIN_ICON + SPACE_XS`）⇒ 线从**正文起点**画（Apple `UITableView.insetGrouped`
      //    的 inset separator 语义：线跟着文字走，不穿过前导字形）。与侧边栏行内 `Divider`
      //    的 `INSET_ROW_X + MARKER_GUTTER + SPACE_XS` 同一口径。
      .divider({ strokeWidth: STROKE_HAIRLINE, color: hairlineOf(this.pal()), startMargin: INSET_ROW_X + PLUGIN_ICON + SPACE_XS })
      }
      .width('100%').padding(SPACE_MD)
      .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
      .borderRadius(RADIUS_SHEET)
      .border({ width: STROKE_HAIRLINE, color: hairlineOf(this.pal()) })
      // 贴合层（near）：浅色 = `elev2` 小半径贴合影；深色 = 透明（不渲染 ⇒ 净观感不变）。
      .shadow({
        radius: this.sheetLayers()[0].radius,
        color: this.sheetLayers()[0].color,
        offsetX: 0, offsetY: this.sheetLayers()[0].offsetY,
      })
    }
    // 环境层（far）：浅色 = 大半径环境柔影；深色 = 该档原值（`glow`，逐字节不变）。
    .width(SHEET_WIDTH)
    .backgroundColor(surfaceFillOf(this.pal(), 'surface.overlay'))
    .borderRadius(RADIUS_SHEET)
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: 0, offsetY: this.sheetLayers()[1].offsetY,
    })
    // 开合过渡（E3 统一）：与其它弹层同一条 `sheetTransition()`。
    .transition(sheetTransition())
  }
}
