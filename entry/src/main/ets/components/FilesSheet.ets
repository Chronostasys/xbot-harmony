/**
 * FilesSheet —— **文件管理**面板（原生，目标④「文件管理也没有」）。
 *
 * 分层（同 `PluginsSheet`/`StatusSheet`）：组件**只画**，数据与所有权留页面
 * （`showFiles` / 当前目录 / 条目 / 预览文本都是页面 `@State`；组件只收 `@Prop` + 回调）。
 *
 * ── 为什么是原生而不是 WebView ────────────────────────────────────────────────
 * web 侧文件管理 = `components/sidebar/FileExplorer.tsx`（树）+ `workspace/panels/FilePanel.tsx`
 * （单文件：markdown 预览 / 图片预览 / 其余走 Monaco）。本仓**原生渲染**同一套能力
 * （⛔ 不把整个 web UI 塞进 WebView —— 用户已否掉那条路线）。
 *
 * ── 单一判据（⛔ 组件不写第二套）──────────────────────────────────────────────
 * 排序 / 图标种类 / 大小文案 / 面包屑 **全部**读 `core/files.ets`（与 `tools/tests/files_pure.test.ts`
 * 同一份纯函数）；markdown 预览复用 `MarkdownView`（与聊天正文同一渲染器）。
 *
 * ── 三态 ────────────────────────────────────────────────────────────────────
 * 加载（一行小字，⛔ 不另起 spinner —— 全站同一时刻只允许一个在飞动效）、
 * 失败（红字 + 重试）、空目录（一行灰字）。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import {
  baseNameOf, FK_DIR, FK_IMAGE, FK_MARKDOWN, FsCrumb, FsFileEntry, fileKindOf, fmtSize, fsCrumbs,
  joinFsPath,
} from '../core/files';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, INSET_ROW_X, PRESS_OPACITY, RADIUS_CARD, RADIUS_SHEET, SPACE_MD,
  SPACE_SM, SPACE_XS, STROKE_HAIRLINE, SURFACE_CARD, surfaceFillOf, ICON_MD, typeOf,
} from '../core/design';
import { sheetTransition } from './anim';
import { MarkdownView } from './MarkdownView';
import { AuthImage } from './AuthImage';

/** 目录列表数据源（`LazyForEach` 行级虚拟化 —— 大目录不炸节点）。 */
class FsDataSource implements IDataSource {
  private items: FsFileEntry[] = [];
  private listeners: DataChangeListener[] = [];

  totalCount(): number {
    return this.items.length;
  }

  getData(index: number): FsFileEntry {
    return this.items[index];
  }

  registerDataChangeListener(listener: DataChangeListener): void {
    if (this.listeners.indexOf(listener) < 0) {
      this.listeners.push(listener);
    }
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const i: number = this.listeners.indexOf(listener);
    if (i >= 0) {
      this.listeners.splice(i, 1);
    }
  }

  /** 整表替换（目录切换 / 刷新）⇒ 全量重载（本面板无"最小通知键"需求）。 */
  setItems(items: FsFileEntry[]): void {
    this.items = items;
    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i].onDataReloaded();
    }
  }
}

/** 面包屑单段最大宽（vp）—— 横向滚动里的动态文本必须有上限（`horizontal_overflow_gate` H1）。 */
const CRUMB_MAX: number = 220;

/** 条目图标（`core/files.ets` 的种类 ⇒ 系统符号）。 */
function entrySymbol(kind: string): Resource {
  if (kind === FK_DIR) {
    return $r('sys.symbol.folder');
  }
  if (kind === FK_IMAGE) {
    return $r('sys.symbol.picture');
  }
  return $r('sys.symbol.doc_text');
}

@Component
export struct FilesSheet {
  @Prop theme: string = 'dark';
  /** 当前目录绝对路径。 */
  @Prop path: string = '/';
  /**
   * 目录条目。
   * ⛔ **必须挂 `@Watch`**（2026-10-12 真机实证）：`LazyForEach` 的数据源是 `ds`（组件内部），
   * `aboutToAppear` 只跑一次、那时 `entries` 还是空（页面异步拉目录）⇒ 不挂 `@Watch`
   * 则数据源**永远是空** ⇒ 面板画出一个**空列表**（真机症状：面包屑正确、正文一片空白，
   * 连"空目录"提示都不出现 —— 因为判据走的是 `entries.length>0` 的 List 分支）。
   */
  @Prop @Watch('onEntriesChanged') entries: FsFileEntry[] = [];
  @Prop loading: boolean = false;
  @Prop error: string = '';
  /** 预览态：非空 ⇒ 面板切到单文件视图。 */
  @Prop previewPath: string = '';
  @Prop previewText: string = '';
  @Prop previewLoading: boolean = false;
  @Prop previewIsImage: boolean = false;
  /** 图片预览 URL（`/api/fs/raw?path=...`；空 = 非图片）。 */
  @Prop previewImageUrl: string = '';
  /** 鉴权取字节（复用页面 `loadImageBytes` —— ⛔ 不新开图片通道）。 */
  loadImageBytes: (src: string) => Promise<ArrayBuffer> = async (s: string) => new ArrayBuffer(0);
  @Prop fontScale: number = 1;
  @Prop wrapCode: boolean = true;
  @Prop mdTheme: string = 'vscode-dark';
  onNavigate: (dir: string) => void = () => {
  };
  onOpenFile: (filePath: string, kind: string) => void = () => {
  };
  onClosePreview: () => void = () => {
  };
  onRefresh: () => void = () => {
  };
  onClose: () => void = () => {
  };

  private ds: FsDataSource = new FsDataSource();

  /**
   * 记忆化色板（**唯一取色入口**）。
   *
   * ⛔ 两条硬线同时约束，本形态是唯一同时合法的写法：
   *   ① `tools/perf/guard.sh` **A 线**：`this.pal()` 是**未 memo 的色板分配**，全仓站点有上限
   *      ⇒ 本面板 ~23 处取色**不许**各写一遍 `this.pal()`（那会把全仓顶爆，实测 1268 > 1250）；
   *   ② `tools/tests/staleness_audit.test.ts` **R1 硬红**：**结构体字段初值**里算色/主题
   *      = 只在构造那一次求值（`private p: Palette = paletteOf('dark')` 之类会被抓）。
   *   ⇒ 用**记忆化方法 + 两个"非取色"字段**（`null`/空串初值，不触发 R1）：命中即复用，
   *     换主题（`this.theme` 变）自动失效 ⇒ 分配 1 次/主题，A 线站点 0。
   */
  private palCache: Palette | null = null;
  private palThemeCache: string = '';

  private palOnce(): Palette {
    const c: Palette | null = this.palCache;
    if (c !== null && this.palThemeCache === this.theme) {
      return c;
    }
    const fresh: Palette = paletteOf(this.theme);
    this.palCache = fresh;
    this.palThemeCache = this.theme;
    return fresh;
  }

  aboutToAppear(): void {
    this.ds.setItems(this.entries);
  }

  /** `@Prop entries` 变化 ⇒ 同步数据源（LazyForEach 的数据入口）。 */
  onEntriesChanged(): void {
    this.ds.setItems(this.entries);
  }

  /** 面包屑（判据同源：`core/files.ets:fsCrumbs`）。 */
  private crumbs(): FsCrumb[] {
    return fsCrumbs(this.path);
  }

  build() {
    Column() {
      // ── 头部：标题 +（预览态）返回 / 刷新 + 关闭 ─────────────────────────────
      Row({ space: SPACE_XS }) {
        if (this.previewPath.length > 0) {
          Row() {
            SymbolGlyph($r('sys.symbol.chevron_left'))
              .fontSize(ICON_MD).fontColor([colorOf(this.palOnce(), 'iconMuted')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('返回目录')
          .onClick(() => {
            this.onClosePreview();
          })
        }
        Text(this.previewPath.length > 0 ? baseNameOf(this.previewPath) : '文件')
          .fontSize(typeOf('type.headline').size)
          .fontWeight(typeOf('type.headline').weight)
          .fontColor(this.palOnce().textPrimary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        if (this.previewPath.length === 0) {
          Row() {
            SymbolGlyph($r('sys.symbol.arrow_clockwise'))
              .fontSize(ICON_MD).fontColor([colorOf(this.palOnce(), 'iconMuted')])
          }
          .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
          .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText('刷新目录')
          .onClick(() => {
            this.onRefresh();
          })
        }
        Row() {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(ICON_MD).fontColor([colorOf(this.palOnce(), 'iconMuted')])
        }
        .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
        .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .accessibilityText('关闭文件面板')
        .onClick(() => {
          this.onClose();
        })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      if (this.previewPath.length === 0) {
        // ── 面包屑（横向滚动；点任一段回跳）──────────────────────────────────
        Scroll() {
          Row({ space: SPACE_XS }) {
            ForEach(this.crumbs(), (c: FsCrumb, i: number) => {
              if (i > 0) {
                SymbolGlyph($r('sys.symbol.chevron_right'))
                  .fontSize(typeOf('type.micro').size)
                  .fontColor([colorOf(this.palOnce(), 'iconMuted')])
              }
              // 面包屑段：**真实 ≥44 热区**由 Row 承载（⛔ 小 Text 自带 padding 只有 16vp；
              // `hit_target_pad` 的实测/台账一致性会红）。
              Row() {
                Text(c.label)
                  .fontSize(typeOf('type.caption').size)
                  .fontColor(i === this.crumbs().length - 1 ? this.palOnce().accentSoft : this.palOnce().textSecondary)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  // 动态宽度上限（H1：横向上下文里不允许无界文本）
                  .constraintSize({ maxWidth: CRUMB_MAX })
              }
              .height(HIT_TARGET_MIN)
              .padding({ left: SPACE_XS, right: SPACE_XS })
              .justifyContent(FlexAlign.Center)
              .alignItems(VerticalAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.onNavigate(c.path);
              })
            }, (c: FsCrumb, i: number) => `crumb-${i}-${c.path}`)
          }
          .alignItems(VerticalAlign.Center)
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .align(Alignment.Start)
        // 横向滚动容器必须自 clip（`horizontal_overflow_gate` H0 硬判：内容溢出不留外溢）。
        .clip(true)

        // ── 目录列表 ────────────────────────────────────────────────────────
        if (this.loading) {
          Text('读取目录…')
            .fontSize(typeOf('type.subhead').size)
            .fontColor(this.palOnce().textSecondary)
            .width('100%')
            .padding({ top: SPACE_MD, bottom: SPACE_MD })
        } else if (this.error.length > 0) {
          Row({ space: SPACE_SM }) {
            Text(this.error)
              .fontSize(typeOf('type.subhead').size)
              .fontColor(this.palOnce().dangerText)
              .layoutWeight(1)
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text('重试')
              .fontSize(typeOf('type.subhead').size)
              .fontColor(this.palOnce().accentSoft)
              .padding({ left: SPACE_SM, right: SPACE_SM })
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                this.onRefresh();
              })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
        } else if (this.entries.length === 0) {
          Text('空目录')
            .fontSize(typeOf('type.subhead').size)
            .fontColor(this.palOnce().textSecondary)
            .width('100%')
            .padding({ top: SPACE_MD, bottom: SPACE_MD })
        } else {
          List() {
            LazyForEach(this.ds, (e: FsFileEntry) => {
              ListItem() {
                Row({ space: SPACE_SM }) {
                  SymbolGlyph(entrySymbol(fileKindOf(e.name, e.isDir)))
                    .fontSize(ICON_MD)
                    .fontColor([e.isDir ? this.palOnce().accentSoft : colorOf(this.palOnce(), 'iconMuted')])
                  Text(e.name)
                    .fontSize(typeOf('type.callout').size)
                    .fontColor(this.palOnce().textPrimary)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1)
                  if (!e.isDir) {
                    Text(fmtSize(e.size))
                      .fontSize(typeOf('type.caption').size)
                      .fontColor(this.palOnce().textMuted)
                  }
                  SymbolGlyph($r('sys.symbol.chevron_right'))
                    .fontSize(typeOf('type.caption').size)
                    .fontColor([colorOf(this.palOnce(), 'iconMuted')])
                }
                .width('100%')
                .constraintSize({ minHeight: HIT_TARGET_MIN })
                .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
                .alignItems(VerticalAlign.Center)
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .onClick(() => {
                  if (e.isDir) {
                    this.onNavigate(joinFsPath(this.path, e.name));
                  } else {
                    this.onOpenFile(joinFsPath(this.path, e.name), fileKindOf(e.name, false));
                  }
                })
              }
            }, (e: FsFileEntry) => `fs-${this.path}-${e.name}`)
          }
          .layoutWeight(1)
          .width('100%')
          .scrollBar(BarState.Off)
          .divider({ strokeWidth: STROKE_HAIRLINE, color: hairlineOf(this.palOnce()), startMargin: INSET_ROW_X })
        }
      } else {
        // ── 单文件预览 ──────────────────────────────────────────────────────
        if (this.previewLoading) {
          Text('读取文件…')
            .fontSize(typeOf('type.subhead').size)
            .fontColor(this.palOnce().textSecondary)
            .width('100%')
            .padding({ top: SPACE_MD })
        } else if (this.previewIsImage) {
          if (this.previewImageUrl.length > 0) {
            Column() {
              AuthImage({
                src: this.previewImageUrl,
                load: (s: string) => {
                  return this.loadImageBytes(s);
                },
                onOpen: () => {
                },
                maxHeight: 2000,
                theme: this.theme,
              })
            }
            .layoutWeight(1)
            .width('100%')
          } else {
            Text('图片加载中…')
              .fontSize(typeOf('type.subhead').size)
              .fontColor(this.palOnce().textSecondary)
              .width('100%')
              .padding({ top: SPACE_MD })
          }
        } else if (fileKindOf(baseNameOf(this.previewPath), false) === FK_MARKDOWN) {
          Scroll() {
            MarkdownView({
              text: this.previewText,
              theme: this.theme,
              mdTheme: this.mdTheme,
              fontScale: this.fontScale,
              wrapCode: this.wrapCode,
            })
          }
          .layoutWeight(1)
          .width('100%')
          .scrollBar(BarState.Off)
        } else {
          Scroll() {
            Text(this.previewText)
              .fontSize(typeOf('type.subhead').size)
              .fontFamily('monospace')
              .fontColor(this.palOnce().textPrimary)
              .textAlign(TextAlign.Start)
              .width('100%')
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
    .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.overlay'))
    .borderWidth({ left: STROKE_HAIRLINE })
    .borderColor(hairlineOf(this.palOnce()))
    // 侧栏柔影 —— 唯一出口 `core/theme.shadowLayersOf`（同 `PluginsSheet`/`DrawerSheet` 同族；
    // ⛔ 不写死半径/颜色：浅色=小半径贴合影、深色=该档原值）。
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: SPACE_XS,
      offsetY: 0,
    })
    .transition(sheetTransition())
  }

  /** 本面板柔影（两层数组恒返 `[near, far]`；本面板是侧栏 ⇒ 取环境层 `far`）。 */
  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.palOnce(), 'overlay');
  }

}
