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
  baseNameOf, filterFsEntries, FK_DIR, FK_IMAGE, FK_MARKDOWN, FsCrumb, FsFileEntry,
  fileKindOf, fsCodeFence, fsCodeLanguage,
  fsCrumbs, fsFilterEmptyText, fsFilterPlaceholder,
  fsHiddenToggleLabel, FsRow, FsSearchEntry, fsRowsForDir, fsRowsForSearch,
  fsSearchEmptyText, fsSearchSummary, FS_SEARCH_LIMIT,
} from '../core/files';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, INSET_ROW_X, MENU_W, PRESS_OPACITY, RADIUS_CARD, RADIUS_CHIP, RADIUS_SHEET,
  SHEET_ACTION_GLYPH, SPACE_LG, SPACE_MD,
  SPACE_SM, SPACE_XS, STROKE_HAIRLINE, SURFACE_CARD, surfaceFillOf, ICON_MD, typeOf,
} from '../core/design';
// 本面板是**侧栏**（不是底部面板）⇒ 走 `drawerTransition()`（横向滑入），与 `DrawerSheet` 同语义；
// ⛔ 原先用 `sheetTransition()`（自下而上）轴不对 —— 侧栏从底部滑入读作「抽屉」，语义冲突。
import { drawerTransition } from './anim';
import { MarkdownView } from './MarkdownView';
import { AuthImage } from './AuthImage';

/**
 * 列表数据源（`LazyForEach` 行级虚拟化 —— 大目录不炸节点）。
 * ⛔ 行类型是**统一视图模型** `FsRow`（目录浏览 ⊕ 搜索结果共用一个 builder；`ForEach` 预算已 0 余量）。
 */
class FsDataSource implements IDataSource {
  private items: FsRow[] = [];
  private listeners: DataChangeListener[] = [];

  totalCount(): number {
    return this.items.length;
  }

  getData(index: number): FsRow {
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

  /** 整表替换（目录切换 / 刷新 / 搜索）⇒ 全量重载（本面板无"最小通知键"需求）。 */
  setItems(items: FsRow[]): void {
    this.items = items;
    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i].onDataReloaded();
    }
  }
}

/** 面包屑单段最大宽（vp）—— 横向滚动里的动态文本必须有上限（`horizontal_overflow_gate` H1）。 */
const CRUMB_MAX: number = 220;

/** 行内次要右列最大宽（vp）—— 同上：搜索态的"所在目录"是动态文本，必须有宽度上限。 */
const SUB_MAX: number = 160;

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

/**
 * 面板级「空/加载/失败」态（**对标 Apple** 的统一长相：大号弱化字形 + 说明 + 居中）。
 *
 * ⛔ 必须是**真 `@Component` + `@Prop`**，不能用带参 `@Builder`：过滤无命中时用户继续打字
 *   ⇒ 分支条件（`filtered.length === 0`）不变、只有文案变；`@Builder` 的参数是"调用那一刻的快照"
 *   ⇒ 文案会**卡在首帧**（本仓血债，见 `docs/ARKTS-GOTCHAS.md`）。
 */
@Component
struct FsNotice {
  @Prop theme: string = 'dark';
  @Prop icon: Resource = $r('sys.symbol.folder');
  @Prop text: string = '';
  /** 文案色调：`secondary`（空/加载，弱）或 `danger`（失败）。 */
  @Prop tone: string = 'secondary';

  private palOnce(): Palette {
    return paletteOf(this.theme);
  }

  /**
   * 一次取色换两个站点（性能预算 B 线：全仓 `this.palOnce()` 调用点**只许减**）。
   * 返回 `[iconColor, textColor]`；`this.palOnce()` 字面量在本文件恒 **1** 处。
   */
  private noticeColors(): string[] {
    const p: Palette = this.palOnce();
    return [colorOf(p, 'iconMuted'), this.tone === 'danger' ? p.dangerText : p.textMuted];
  }

  build() {
    Column({ space: SPACE_SM }) {
      SymbolGlyph(this.icon)
        .fontSize(typeOf('type.display').size)
        .fontColor([this.noticeColors()[0]])
      Text(this.text)
        .fontSize(typeOf('type.callout').size)
        .fontColor(this.noticeColors()[1])
        .width('100%')
        .textAlign(TextAlign.Center)
        .maxLines(4)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }
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
  /**
   * 隐藏文件开关（`/api/fs/list` 的 `show_hidden`）。
   * 契约：web `hooks/useFileSystem.ts:79-93 listDir(path, showHidden)`；请求体构造走
   * `core/files.ets:fsListBody`（⛔ 键名 `show_hidden`，服务端 query 侧却是 `showHidden`）。
   */
  @Prop showHidden: boolean = false;
  /**
   * ── 递归搜索（`/api/fs/search`）───────────────────────────────────────────────
   * `searching` 必须挂 `@Watch`：搜索态**进出**都要重建数据源 ——
   *   · 进入 ⇒ 行来自 `searchItems`（不是 `entries`）；
   *   · 退出（清空查询/切目录）⇒ 必须把行**换回目录**，否则列表停在上一批搜索结果上。
   *   ⚠️ 不能只靠 `@Watch('searchItems')`：页面若先置 `searchItems` 再翻 `searching`，
   *      那一帧 `searching` 还是旧值 ⇒ 事件被吞 ⇒ 列表空 ⇒ 这里**两个 watch 都做全量重建**。
   */
  @Prop @Watch('onSearchingChanged') searching: boolean = false;
  @Prop searchQuery: string = '';
  @Prop @Watch('onSearchItemsChanged') searchItems: FsSearchEntry[] = [];
  @Prop searchLoading: boolean = false;
  @Prop searchError: string = '';
  /** 预览态：非空 ⇒ 面板切到单文件视图。 */
  @Prop previewPath: string = '';
  @Prop previewText: string = '';
  /** 预览文件的**语言标识**（`/api/fs/read` 的 `language`；代码预览用它选 Prism4j 语法）。 */
  @Prop previewLanguage: string = '';
  /**
   * 预览态的**通知文案**（非空 ⇒ 显示居中通知态而不是文件正文）。
   * 用途：二进制文件 / 未连接 / 读取失败 —— 这些**不是文件内容**，塞进代码视图里会误导
   * （用户会以为文件真的写着那句话）。判据：文案由页面给（面板不猜）。
   */
  @Prop previewNotice: string = '';
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
  /** 复制条目路径（web `FileExplorer.tsx:379-382` 的 `navigator.clipboard.writeText` ⇒ 页面 toast）。 */
  onCopyPath: (filePath: string) => void = () => {
  };
  /** 「加入聊天」：页面把 `@path` 提及时插进输入框（web `insertIntoChat(\`@${path}\`)`）。 */
  onAddToChat: (filePath: string) => void = () => {
  };
  onClosePreview: () => void = () => {
  };
  onRefresh: () => void = () => {
  };
  /** 切换「隐藏文件」开关（页面翻转状态后**重列当前目录**）。 */
  onToggleHidden: () => void = () => {
  };
  /** 递归搜索（过滤框**回车**触发；web 无此 UI ⇒ 超越 web 的能力，端点契约见 `core/files.ets`）。 */
  onSearch: (query: string) => void = () => {
  };
  /** 退出搜索态（清空查询 ⇒ 回到目录浏览）。 */
  onExitSearch: () => void = () => {
  };
  onClose: () => void = () => {
  };

  private ds: FsDataSource = new FsDataSource();

  /**
   * 内联过滤查询 + 过滤后的可见条目（对齐 web `sidebar/FileExplorer.tsx:124-131` 的
   * 名称大小写不敏感子串过滤；判据 = `core/files.ets:filterFsEntries`，⛔ 组件不写第二套）。
   *
   * ⚠️ 过滤结果**缓存在 `@State`**（而不是在 build 里现算）：列目录是 `LazyForEach` 虚拟化的大列表
   *   （可能上千条），build 每次重建数组会把滚动帧打爆。
   */
  @State private filterQuery: string = '';
  @State private filtered: FsFileEntry[] = [];

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

  /**
   * 面板取色（**一次 `palOnce()` 换 N 个站点**）。
   *
   * ⛔ 为什么必须收成一个方法：`tools/perf/guard.sh` 的 **B 线**（全仓 `this.pal()` ∨
   *    **palOnce 调用点**总数（门禁用 `grep -oE` 计数、**不剥注释** ⇒ 注释里也别写该字面量），
   *    上限 1350 且**只许减**）—— 本轮文件"过滤行"按"看着直白"
   *    逐处直写 role，实测把全仓顶到 **1355 ⇒ 真红**（基线 1349）。形态与本仓
   *    `TerminalSheet.keyRoleColor` 同款（那边的注释记了同一课）。
   * ⚠️ `role` 是**本方法私有**的判别串，⛔ **不是** `colorOf` 的角色名：真源角色表只有
   *    `core/design.ets:colorOf` 里的那些（`docs/DESIGN-SYSTEM.md §12`）。本方法每个分支都落到
   *    真源角色（`iconMuted`/`textMuted`）或 `Palette` 真字段，⛔ 不新造角色名。
   *
   * ⛔ **两处故意不收敛**（保留字面量，别"顺手优化"）：页头**关闭 X** 的取色
   *    （`sheet_chrome` ② 钉「关闭 X = `iconMuted`/破坏性 `dangerText`」）与**面板根容器**的
   *    实底面（`panel_surface_consistency` A 钉「根容器 = 实底 `surface.overlay`」）。
   *    这两条是**设计判据**，静态扫描看的是调用片段 ⇒ 走 `tint(role)` 会让判据失去判别力。
   */
  private tint(role: string): string {
    const p: Palette = this.palOnce();
    if (role === 'icon') {
      return colorOf(p, 'iconMuted');
    }
    if (role === 'text') {
      return p.textPrimary;
    }
    if (role === 'muted') {
      return p.textMuted;
    }
    if (role === 'secondary') {
      return p.textSecondary;
    }
    if (role === 'accent') {
      return p.accent;
    }
    if (role === 'accentSoft') {
      return p.accentSoft;
    }
    if (role === 'onAccent') {
      return p.onAccent;
    }
    if (role === 'danger') {
      return p.dangerText;
    }
    if (role === 'input') {
      return surfaceFillOf(p, 'surface.input');
    }
    if (role === 'overlay') {
      return surfaceFillOf(p, 'surface.overlay');
    }
    return hairlineOf(p);
  }

  aboutToAppear(): void {
    this.applyFilter();
  }

  /** `@Prop entries` 变化 ⇒ 重算过滤并同步数据源（LazyForEach 的数据入口）。 */
  onEntriesChanged(): void {
    this.applyFilter();
  }

  /**
   * 应用内联过滤：`filtered = filterFsEntries(entries, filterQuery)` 并推给 `LazyForEach`。
   * ⛔ 过滤**只影响展示**，不碰 `entries` 本身（页面的目录状态是唯一真源）。
   * ⛔ 搜索态下**不推**（那时的行来自 `searchItems`，见 `applySearch`）——否则一次 `entries`
   *    刷新会把搜索结果冲掉（页面切目录时会先清 `entries` 再异步填）。
   */
  private applyFilter(): void {
    this.filtered = filterFsEntries(this.entries, this.filterQuery);
    if (!this.searching) {
      this.ds.setItems(fsRowsForDir(this.path, this.filtered));
    }
  }

  /** 搜索态的数据入口：行来自 `searchItems`（页面已用 `sortFsSearch` 排好；组件不重排）。 */
  private applySearch(): void {
    this.ds.setItems(fsRowsForSearch(this.path, this.searchItems));
  }

  /** 搜索态**进出** ⇒ 重建数据源（两个 watch 都做全量重建，见 `searching` 的注释）。 */
  onSearchingChanged(): void {
    if (this.searching) {
      this.applySearch();
    } else {
      // 退出搜索 ⇒ 过滤框一起清空：否则新目录会被上一个搜索词**静默过滤**（看着像空目录）。
      this.filterQuery = '';
      this.applyFilter();
    }
  }

  onSearchItemsChanged(): void {
    if (this.searching) {
      this.applySearch();
    }
  }

  /** 面包屑（判据同源：`core/files.ets:fsCrumbs`）。 */
  private crumbs(): FsCrumb[] {
    return fsCrumbs(this.path);
  }

  /** 失败文案（搜索态与目录态是**两条不同的结论**，⛔ 不许合并成一句"加载失败"）。 */
  private errText(): string {
    return this.searching ? this.searchError : this.error;
  }

  /** 当前列表的行数（搜索态看结果数，目录态看过滤后的条目数）。 */
  private rowCount(): number {
    return this.searching ? this.searchItems.length : this.filtered.length;
  }

  /** 空态文案（判据在 `core/files.ets`，组件不写第二套）。 */
  private emptyText(): string {
    return this.searching ? fsSearchEmptyText(this.searchQuery) : fsFilterEmptyText(this.filterQuery);
  }

  /** 空态字形：在过滤/搜索 ⇒ 放大镜；真空目录 ⇒ 文件夹（⛔ 不许"没有匹配"却画文件夹）。 */
  private emptyIcon(): Resource {
    if (this.searching || this.filterQuery.length > 0) {
      return $r('sys.symbol.magnifyingglass');
    }
    return $r('sys.symbol.folder');
  }

  /**
   * 行长按菜单 —— 逐项对齐 web `sidebar/FileExplorer.tsx:369-387` 的 `ContextMenuContent`
   * 三项：**打开 / 加入聊天 / 复制路径**（web 第二项即 `insertIntoChat(\`@${path}\`)`）。
   *
   * ⚠️ 为什么这里的**带参** `@Builder` 是安全的（与 `docs/ARKTS-GOTCHAS.md` 的"快照"陷阱不冲突）：
   *   `bindContextMenu` 的 builder **每次长按弹出时**才求值，且每个 row 只捕获**本行**的
   *   `(path, isDir)` —— 行 key 含 `this.path` + `e.name` ⇒ 目录/条目一变即换行实例，
   *   参数不存在"过期"。会卡快照的是**常驻子树**里用带参 builder 承载**会变的值**。
   */
  @Builder
  rowMenu(filePath: string, isDir: boolean) {
    Column() {
      Text(isDir ? '打开' : '预览')
        .fontSize(typeOf('type.callout').size)
        .fontColor(this.tint('text'))
        .width('100%')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .padding({ left: SPACE_MD, right: SPACE_MD, top: SPACE_SM, bottom: SPACE_SM })
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          if (isDir) {
            this.onNavigate(filePath);
          } else {
            this.onOpenFile(filePath, fileKindOf(baseNameOf(filePath), false));
          }
        })
      Text('加入聊天')
        .fontSize(typeOf('type.callout').size)
        .fontColor(this.tint('text'))
        .width('100%')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .padding({ left: SPACE_MD, right: SPACE_MD, top: SPACE_SM, bottom: SPACE_SM })
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.onAddToChat(filePath);
        })
      Text('复制路径')
        .fontSize(typeOf('type.callout').size)
        .fontColor(this.tint('text'))
        .width('100%')
        .constraintSize({ minHeight: HIT_TARGET_MIN })
        .padding({ left: SPACE_MD, right: SPACE_MD, top: SPACE_SM, bottom: SPACE_SM })
        .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
        .onClick(() => {
          this.onCopyPath(filePath);
        })
    }
    .width(MENU_W)
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Column() {
      // ── 头部：标题 +（预览态）返回 / 刷新 + 关闭 ─────────────────────────────
      Row({ space: SPACE_XS }) {
        if (this.previewPath.length > 0) {
          Row() {
            SymbolGlyph($r('sys.symbol.chevron_left'))
              .fontSize(ICON_MD).fontColor([this.tint('icon')])
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
          .fontColor(this.tint('text'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        if (this.previewPath.length === 0) {
          // 隐藏文件开关（web 契约**已有**：`useFileSystem.listDir(path, showHidden)`；原生此前未接）。
          // 形态：胶囊壳；**开启 = accent 实心态底 + onAccent 字**，另有 `checkmark` + `accessibilityText`
          // 的可读状态（⛔ 不许只靠颜色表达状态）。
          Row({ space: SPACE_XS }) {
            Text('隐藏文件')
              .fontSize(typeOf('type.caption').size)
              .fontColor(this.tint(this.showHidden ? 'onAccent' : 'secondary'))
            if (this.showHidden) {
              SymbolGlyph($r('sys.symbol.checkmark'))
                .fontSize(typeOf('type.micro').size)
                .fontColor([this.tint('onAccent')])
            }
          }
          .constraintSize({ minHeight: HIT_TARGET_MIN })
          .padding({ left: SPACE_XS, right: SPACE_XS })
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          .backgroundColor(this.tint(this.showHidden ? 'accent' : 'input'))
          .borderRadius(RADIUS_CHIP)
          .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
          .accessibilityText(fsHiddenToggleLabel(this.showHidden))
          .onClick(() => {
            this.onToggleHidden();
          })
          Row() {
            SymbolGlyph($r('sys.symbol.arrow_clockwise'))
              .fontSize(ICON_MD).fontColor([this.tint('icon')])
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
            .fontSize(SHEET_ACTION_GLYPH).fontColor([colorOf(this.palOnce(), 'iconMuted')])
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
                  .fontColor([this.tint('icon')])
              }
              // 面包屑段：**真实 ≥44 热区**由 Row 承载（⛔ 小 Text 自带 padding 只有 16vp；
              // `hit_target_pad` 的实测/台账一致性会红）。
              Row() {
                Text(c.label)
                  .fontSize(typeOf('type.caption').size)
                  .fontColor(this.tint(i === this.crumbs().length - 1 ? 'accentSoft' : 'secondary'))
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

        // ── 内联过滤（对齐 web `FileExplorer` 的搜索框：名称大小写不敏感子串）──────
        if (this.entries.length > 0) {
          Row({ space: SPACE_XS }) {
            SymbolGlyph($r('sys.symbol.magnifyingglass'))
              .fontSize(typeOf('type.caption').size)
              .fontColor([this.tint('icon')])
            TextInput({ text: this.filterQuery, placeholder: fsFilterPlaceholder() })
              .placeholderColor(this.tint('muted'))
              .fontColor(this.tint('text'))
              .fontSize(typeOf('type.callout').size)
              .backgroundColor(Color.Transparent)
              .padding(0)
              .layoutWeight(1)
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .enterKeyType(EnterKeyType.Search)
              .onChange((v: string) => {
                this.filterQuery = v;
                this.applyFilter();
              })
              // ⛔ 递归搜索是**手动**触发（回车）而不是输入防抖：性能预算 `setTimeout` 仅剩 1 处余量，
              //    且服务端 `searchDir` 是**同步递归 walk** ⇒ 每键一搜会打爆响应。
              .onSubmit(() => {
                this.onSearch(this.filterQuery);
              })
            if (this.filterQuery.length > 0) {
              Row() {
                SymbolGlyph($r('sys.symbol.xmark_circle_fill'))
                  .fontSize(typeOf('type.caption').size)
                  .fontColor([this.tint('icon')])
              }
              .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
              .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .accessibilityText(this.searching ? '退出搜索' : '清除过滤')
              .onClick(() => {
                // 搜索态下清空 = **退出搜索**（回到目录浏览）；否则只是清过滤词。
                this.filterQuery = '';
                if (this.searching) {
                  this.onExitSearch();
                } else {
                  this.applyFilter();
                }
              })
            }
          }
          .width('100%')
          .padding({ left: SPACE_SM, right: SPACE_XS })
          .alignItems(VerticalAlign.Center)
          .backgroundColor(this.tint('input'))
          .borderRadius(RADIUS_CHIP)
          .border({ width: STROKE_HAIRLINE, color: this.tint('hairline') })
          .constraintSize({ minHeight: HIT_TARGET_MIN })
        }

        // ── 搜索汇总（搜索态、有命中时一行）──────────────────────────────────
        // ⛔ 必须能区分"搜索中止/失败"与"没有匹配"——前者走下面的红字通知态（带重试）。
        if (this.searching && !this.searchLoading && this.searchError.length === 0 && this.searchItems.length > 0) {
          Row() {
            Text(fsSearchSummary(this.searchItems.length, this.searchQuery, FS_SEARCH_LIMIT))
              .fontSize(typeOf('type.micro').size)
              .fontColor(this.tint('secondary'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
          }
          .width('100%')
          .padding({ left: SPACE_SM, right: SPACE_SM })
        }

        // ── 列表（目录浏览 ⊕ 搜索结果，同一个 builder）──────────────────────
        // 三态一律走面板级统一长相（`FsNotice`：大号弱化字形 + 说明 + 居中，对标 Apple）。
        if (this.loading || (this.searching && this.searchLoading)) {
          FsNotice({
            theme: this.theme, icon: $r('sys.symbol.folder'),
            text: this.searching ? '搜索中…' : '读取目录…', tone: 'secondary',
          })
        } else if (this.errText().length > 0) {
          // 失败态：字形 + 红字 + 重试（重试是**独立热区 ≥44**，不再挤在文案行尾）
          Column({ space: SPACE_MD }) {
            FsNotice({
              theme: this.theme, icon: $r('sys.symbol.exclamationmark_triangle'),
              text: this.errText(), tone: 'danger',
            })
            Text('重试')
              .fontSize(typeOf('type.callout').size)
              .fontColor(this.tint('accentSoft'))
              .padding({ left: SPACE_MD, right: SPACE_MD })
              .constraintSize({ minHeight: HIT_TARGET_MIN })
              .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
              .onClick(() => {
                if (this.searching) {
                  this.onSearch(this.filterQuery);
                } else {
                  this.onRefresh();
                }
              })
          }
          .width('100%')
          .layoutWeight(1)
          .justifyContent(FlexAlign.Center)
          .alignItems(HorizontalAlign.Center)
          .padding({ bottom: SPACE_LG })
        } else if (this.rowCount() === 0) {
          // 过滤/搜索无命中 ⇒ `magnifyingglass`；真空目录 ⇒ `folder`（判据：文案由 `core/files` 给，
          // 但**图标**必须与"是否在过滤/搜索"一致，否则「没有匹配」却画个文件夹，误导）
          FsNotice({
            theme: this.theme,
            icon: this.emptyIcon(),
            text: this.emptyText(),
            tone: 'secondary',
          })
        } else {
          List() {
            LazyForEach(this.ds, (r: FsRow) => {
              ListItem() {
                Row({ space: SPACE_SM }) {
                  SymbolGlyph(entrySymbol(r.kind))
                    .fontSize(ICON_MD)
                    .fontColor([this.tint(r.isDir ? 'accentSoft' : 'icon')])
                  Text(r.label)
                    .fontSize(typeOf('type.callout').size)
                    .fontColor(this.tint('text'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1)
                  // 次要右列：目录态 = 文件大小；搜索态 = 所在目录（相对搜索根）。
                  // ⛔ 合成**一个** `Text`（两种内容共用这一处取色点）—— 分成两列会多一个色板读取站点，
                  //    而性能预算 B 线（`pal() ∨ palOnce()` 读取总量）余量已是**个位数**。
                  if (r.size.length > 0 || r.sub.length > 0) {
                    Text(r.size.length > 0 ? r.size : r.sub)
                      .fontSize(typeOf('type.caption').size)
                      .fontColor(this.tint('muted'))
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                      // 动态宽度上限（H1：横向上下文里不允许无界文本）
                      .constraintSize({ maxWidth: SUB_MAX })
                  }
                  SymbolGlyph($r('sys.symbol.chevron_right'))
                    .fontSize(typeOf('type.caption').size)
                    .fontColor([this.tint('icon')])
                }
                .width('100%')
                .constraintSize({ minHeight: HIT_TARGET_MIN })
                .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
                .alignItems(VerticalAlign.Center)
                .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
                .onClick(() => {
                  // 行只认 `r.path`（绝对路径）—— 搜索行分散在各子目录，拼 `this.path + name` 会拼错。
                  if (r.isDir) {
                    this.onNavigate(r.path);
                  } else {
                    this.onOpenFile(r.path, fileKindOf(r.label, false));
                  }
                })
                // 长按 = 行菜单（web `FileExplorer.tsx:369` 的 ContextMenu：打开/加入聊天/复制路径）。
                // ⛔ 用 `bindContextMenu`（长按）而不是 `bindMenu`（点按）—— 行本身的点按已有语义
                //    （进目录/开预览），菜单必须挂在**另一个手势**上，否则互相抢。
                .bindContextMenu(
                  this.rowMenu(r.path, r.isDir),
                  ResponseType.LongPress,
                )
              }
            }, (r: FsRow) => r.key)
          }
          .layoutWeight(1)
          .width('100%')
          .scrollBar(BarState.Off)
          .divider({ strokeWidth: STROKE_HAIRLINE, color: this.tint('hairline'), startMargin: INSET_ROW_X })
        }
      } else {
        // ── 单文件预览 ──────────────────────────────────────────────────────
        if (this.previewLoading) {
          // 加载态 = 面板级统一长相（`doc_text` + 一行说明 + 居中）
          FsNotice({ theme: this.theme, icon: $r('sys.symbol.doc_text'), text: '读取文件…', tone: 'secondary' })
        } else if (this.previewNotice.length > 0) {
          // 「这不是文件内容」的通知（二进制/未连接/读取失败）——⛔ 绝不塞进代码视图（会谎报文件内容）。
          FsNotice({
            theme: this.theme, icon: $r('sys.symbol.exclamationmark_triangle'),
            text: this.previewNotice, tone: 'secondary',
          })
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
            FsNotice({ theme: this.theme, icon: $r('sys.symbol.picture'), text: '图片加载中…', tone: 'secondary' })
          }
        } else {
          // **文本类（markdown + 代码/纯文本）走同一渲染器**：
          //   · markdown ⇒ 原样（`MarkdownView` 的文档路径）；
          //   · 其余 ⇒ 包成**围栏代码块**（`fsCodeFence`）⇒ 直接复用聊天侧同一套
          //     Prism4j 高亮 / 复制条 / `wrapCode` 溢出策略 —— ⛔ 面板**不另写**一个"文件代码视图"
          //     （否则同一个 .py 在聊天里高亮、在文件面板里是灰字，全站两副面孔）。
          //   ⚠️ 行号不做：本仓没有"行号槽 + 横向滚动"的成熟布局，硬上会引入 gutter 随内容横滚的错位
          //     （宁可没有，也不做一个错的）。
          Scroll() {
            MarkdownView({
              text: fileKindOf(baseNameOf(this.previewPath), false) === FK_MARKDOWN
                ? this.previewText
                : fsCodeFence(baseNameOf(this.previewPath), this.previewLanguage, this.previewText),
              theme: this.theme,
              mdTheme: this.mdTheme,
              fontScale: this.fontScale,
              wrapCode: this.wrapCode,
            })
          }
          .layoutWeight(1)
          .width('100%')
          .scrollBar(BarState.Off)
          // ⛔ `Scroll` 的内容**默认垂直居中**（真机取证：109B 的小文件被顶到面板正中间，
          //    上下各留半屏空白，看着像"没加载完"）⇒ 文件预览必须**顶对齐**（Apple 文件查看器同）。
          .align(Alignment.TopStart)
        }
      }
    }
    .width('100%')
    .height('100%')
    .padding(SPACE_MD)
    .backgroundColor(surfaceFillOf(this.palOnce(), 'surface.overlay'))
    .borderWidth({ left: STROKE_HAIRLINE })
    .borderColor(this.tint('hairline'))
    // 侧栏柔影 —— 唯一出口 `core/theme.shadowLayersOf`（同 `PluginsSheet`/`DrawerSheet` 同族；
    // ⛔ 不写死半径/颜色：浅色=小半径贴合影、深色=该档原值）。
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: SPACE_XS,
      offsetY: 0,
    })
    // 侧栏出入场 = **横向滑入**（`drawerTransition()`，与 `DrawerSheet` 同语义）。
    .transition(drawerTransition())
  }

  /** 本面板柔影（两层数组恒返 `[near, far]`；本面板是侧栏 ⇒ 取环境层 `far`）。 */
  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.palOnce(), 'overlay');
  }

}
