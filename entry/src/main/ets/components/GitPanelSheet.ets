/**
 * GitPanelSheet —— **原生 Git 面板**（web 内置插件 `xbot.git-fancy` 的原生落地）。
 *
 * ── 为什么必须有它（目标④「插件都打不开」）────────────────────────────────────
 * 抽屉「插件」里点 `Git 面板` 此前落到**通用 Web UI 根页**（聊天页），不是插件面板 ——
 * web 侧插件 view **没有静态 URL 入口**（只能经 `ctx.ui.openViewTab`），而本仓是原生壳，
 * 没有 React 宿主 ⇒ **深链不可达**。唯一合法路线 = 原生化（先例：`SessionStatsSheet`、
 * `SkillsSheet`）。数据面全在宿主 RPC（`web_plugin_rpc` → `xbot.git-fancy.*`），
 * 判据/解析/格式化全在 `core/gitpanel.ets`（纯逻辑，可脱机单测）。
 *
 * ── 分层铁律（同 `CronDetailSheet`/`StatusSheet`）────────────────────────────────
 * 组件**只画**：所有字符串/列表由页面算好传入 ⇒ 列表行与详情页**判据同源**；
 * 组件**不发任何 RPC**（开关所有权留页面：`showGit` / `gitMode`）。
 *
 * ── 三种形态（`mode`）─────────────────────────────────────────────────────────
 * · `list`   —— 分支/落差 + 工作区变更（± 统计）+ 提交历史（可分页「加载更多」）
 * · `diff`   —— 单文件 diff（工作区或某 commit 作用域；走 `core/diffparse.ets` 的**同一套**解析）
 * · `commit` —— 某提交的详情（作者/时间/信息全文 + 该提交内文件；点文件进 `diff`）
 *
 * ── 性能预算（`docs/PERF-BUDGET.md`）：本文件只留 2 处调色板读取点 ──────────────
 * 面板级 `palOnce()`（记忆化）+ `skin()` 一次取齐并缓存；diff 解析结果按
 * `diffText` 缓存（`diffFiles()`）⇒ 不随 build 次数重复解析（门禁 `perf/guard.sh`）。
 */
import { Palette, paletteOf, ShadowLayer, shadowLayersOf } from '../core/theme';
import {
  colorOf, hairlineOf, HIT_TARGET_MIN, INSET_ROW_X, INSET_ROW_Y, PRESS_OPACITY, RADIUS_CARD,
  RADIUS_CHIP, SHEET_ACTION_GLYPH, SHEET_WIDTH, SPACE_HAIR, SPACE_MD, SPACE_SM, SPACE_XS,
  SPACE_XXS, STROKE_HAIRLINE, structuralRuleOf, surfaceFillOf, SURFACE_CARD, typeOf,
} from '../core/design';
import { fs, fw } from './SettingsRows';
// 弹层开合过渡：唯一出口 = 底座 `sheetTransition()`（⛔ 不自造第二套入场语言）。
import { sheetTransition } from './anim';
import { DIFF_ADD, DIFF_DEL, DIFF_HUNK, DiffFile, DiffLine } from '../core/diffparse';
import {
  GitChange, GitCommitRow, GitLog, gitDiffFiles, gitFileDir, gitFileName, gitStatText,
  gitStatusLetter, gitStatusTone,
} from '../core/gitpanel';
import { t as i18nT } from '../core/i18n';

/** diff 行数上限（超出的部分**截断并显式告知**，⛔ 不静默丢内容）。 */
const MAX_DIFF_LINES: number = 400;
/** diff 行号列宽（同 `ToolPopover`）。 */
const LN_W: number = 30;
/** 面板高度：与 `SessionStatsSheet` 同（内容多的列表面板）。 */
const PANEL_H: string = '78%';
/** 状态字母列宽。 */
const WN: number = 22;
/** 提交短哈希列宽。 */
const COMMIT_HASH_W: number = 60;
/** 顶部/内联 spinner 尺寸。 */
const ICON_LOADING: number = 18;
/** commit 信息块高度上限（vp）。 */
const COMMIT_MSG_MAX_H: number = SPACE_SM * 22;

/** 面板一次取齐的视觉令牌（`skin()` 返回值；见文件头「性能预算」）。 */
interface GitSkin {
  /** 浮层根面填充。 */
  overlay: string;
  /** L1 浮层描边。 */
  hair: string;
  /** L2 内嵌卡底（diff 卡 / 上下文行）。 */
  card: string;
  /** L2 面到面轮廓（⛔ L2 卡不许走 L1 的 `hairlineOf`）。 */
  rule: string;
  /** 内凹槽面（字母徽章 / 分支 chip / diff 增行底）。 */
  well: string;
  /** 图标弱色（`iconMuted` 是计算型角色，只能走 `colorOf`）。 */
  icon: string;
  /** 正文主色。 */
  text: string;
  /** 次级文字。 */
  sub: string;
  /** 三级文字（元信息）。 */
  muted: string;
  /** 新增/未跟踪（A/U 字母、`+N`、diff 增行）。 */
  add: string;
  /** 删除（D 字母、`−M`、diff 删行）。 */
  del: string;
  /** diff 删行底色。 */
  delBg: string;
  /** hunk 头底色。 */
  hunk: string;
  /** 主强调（短哈希 / 刷新 / 返回 / 加载更多）。 */
  accent: string;
}

/** 只取前 N 行（⛔ 不静默截断：`DiffBody` 里另有一行显式告知）。 */
function diffHeadLines(lines: DiffLine[], max: number): DiffLine[] {
  return lines.length > max ? lines.slice(0, max) : lines;
}

/** 提交行副行：`作者 · 时间`（缺项自动省略，⛔ 不留孤立分隔符）。 */
function commitSubOf(r: GitCommitRow): string {
  const parts: string[] = [];
  if (r.author.length > 0) {
    parts.push(r.author);
  }
  if (r.when.length > 0) {
    parts.push(r.when);
  }
  return parts.join(' · ');
}

@Component
export struct GitPanelSheet {
  @Prop theme: string = 'dark';
  /** 取数在飞（列表空 ⇒ 顶部 spinner）。 */
  @Prop loading: boolean = false;
  /** 取数失败的可读原因（空 ⇒ 无错误）。 */
  @Prop error: string = '';
  /** 顶部一句状态（`gitHeadline(status)`）。 */
  @Prop headline: string = '';
  /** 工作目录**是否** git 仓库（`status.repo`）—— 非仓库时**不渲染分区骨架**（见 `ListBody`）。 */
  @Prop isRepo: boolean = true;
  /** 分支名（`gitBranchText(status)`）。 */
  @Prop branch: string = '';
  /** 与上游落差（`gitAheadBehindText(status)`；空 ⇒ 不画）。 */
  @Prop aheadBehind: string = '';
  /** 工作区变更（已归一化）。 */
  @Prop changes: GitChange[] = [];
  /** 提交历史（已归一化；分页合并由页面做）。 */
  @Prop log: GitLog = new GitLog();
  /** 「加载更多」在飞。 */
  @Prop logLoading: boolean = false;
  /** 还有更多提交（`hasMoreGitLog(log)`）。 */
  @Prop hasMore: boolean = false;
  /** `list` | `diff` | `commit`。 */
  @Prop mode: string = 'list';
  // ── diff 形态 ────────────────────────────────────────────────────────────
  @Prop diffPath: string = '';
  @Prop diffText: string = '';
  @Prop diffAdds: number = 0;
  @Prop diffDels: number = 0;
  /** diff 所属 commit（空 = 工作区）。 */
  @Prop diffFromCommit: string = '';
  @Prop diffLoading: boolean = false;
  // ── commit 形态 ──────────────────────────────────────────────────────────
  @Prop commitMeta: string = '';
  @Prop commitMessage: string = '';
  @Prop commitFiles: GitChange[] = [];

  // 回调（⛔ 不加 `@Prop`：V1 装饰器不许标函数类型）。
  onClose: () => void = () => {
  };
  onRefresh: () => void = () => {
  };
  onLoadMore: () => void = () => {
  };
  onOpenDiff: (path: string) => void = () => {
  };
  onOpenCommit: (hash: string) => void = () => {
  };
  /** 从 diff/commit 形态返回列表。 */
  onBack: () => void = () => {
  };

  private palCache: Palette | null = null;
  private palThemeCache: string = '';
  private skinCache: GitSkin | null = null;
  private diffCache: DiffFile[] = [];
  private diffCacheKey: string = '';

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

  /** 全部色值一次取齐并随主题缓存（`this.palOnce()` 只在这里出现 1 次）。 */
  private skin(): GitSkin {
    const c: GitSkin | null = this.skinCache;
    if (c !== null && this.palThemeCache === this.theme) {
      return c;
    }
    const p: Palette = this.palOnce();
    const s: GitSkin = {
      overlay: surfaceFillOf(p, 'surface.overlay'),
      hair: hairlineOf(p),
      card: surfaceFillOf(p, SURFACE_CARD),
      rule: structuralRuleOf(p),
      well: surfaceFillOf(p, 'surface.well'),
      icon: colorOf(p, 'iconMuted'),
      text: p.textPrimary,
      sub: p.textSecondary,
      muted: p.textMuted,
      add: p.successText,
      del: p.dangerText,
      delBg: p.warnBg,
      hunk: p.accentDeep,
      accent: p.accentText,
    };
    this.skinCache = s;
    return s;
  }

  private sheetLayers(): ShadowLayer[] {
    return shadowLayersOf(this.palOnce(), 'overlay');
  }

  /** 状态字母分档 → 颜色（分档判据在 `core/gitpanel.ets`，这里只取色）。 */
  private toneColor(tone: string): string {
    if (tone === 'add') {
      return this.skin().add;
    }
    if (tone === 'del') {
      return this.skin().del;
    }
    if (tone === 'warn') {
      return this.skin().text;
    }
    return this.skin().sub;
  }

  /** diff 解析结果按文本缓存（⛔ 不在 build 里重复解析）。 */
  private diffFiles(): DiffFile[] {
    if (this.diffCacheKey === this.diffText) {
      return this.diffCache;
    }
    const parsed: DiffFile[] = gitDiffFiles({
      path: this.diffPath, diffText: this.diffText, adds: this.diffAdds, dels: this.diffDels,
      untracked: false, commit: this.diffFromCommit, error: '',
    });
    this.diffCache = parsed;
    this.diffCacheKey = this.diffText;
    return parsed;
  }

  // ── 构件 ────────────────────────────────────────────────────────────────

  /** 小节标题（变更 / 提交 / 该提交内的文件）。 */
  @Builder
  SectionTitle(t: string, count: number) {
    Row({ space: SPACE_XS }) {
      Text(t)
        .fontSize(fs('type.caption'))
        .fontWeight(fw('type.subhead'))
        .fontColor(this.skin().sub)
        .layoutWeight(1)
      if (count > 0) {
        Text(`${count}`)
          .fontSize(fs('type.micro')).fontColor(this.skin().muted)
          // 横向约束（门禁 H1）
          .flexShrink(0)
      }
    }
    .width('100%')
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X })
    .alignItems(VerticalAlign.Center)
  }

  /** 状态字母（A/U 绿、D 红、M/R/C 主色）。 */
  @Builder
  StatusLetter(c: GitChange) {
    Text(gitStatusLetter(c.status))
      .fontSize(fs('type.micro'))
      .fontWeight(fw('type.subhead'))
      .fontColor(this.toneColor(gitStatusTone(c.status)))
      .width(WN)
      .textAlign(TextAlign.Center)
      .borderRadius(RADIUS_CHIP)
      .backgroundColor(this.skin().well)
  }

  /** 变更/提交内文件的一行：字母 + 文件名（+ 目录副行）+ ± 统计。 */
  @Builder
  FileRow(c: GitChange) {
    Row({ space: SPACE_XS }) {
      this.StatusLetter(c)
      Column({ space: 0 }) {
        Text(gitFileName(c.path))
          .fontSize(fs('type.callout'))
          .fontColor(this.skin().text)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%').textAlign(TextAlign.Start)
          // 横向约束（门禁 H1：`.width` 不在三选一之内）
          .constraintSize({ maxWidth: '100%' })
        if (gitFileDir(c.path).length > 0) {
          Text(gitFileDir(c.path))
            .fontSize(fs('type.micro')).fontColor(this.skin().muted)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%').textAlign(TextAlign.Start)
            .constraintSize({ maxWidth: '100%' })
        }
      }
      .layoutWeight(1).alignItems(HorizontalAlign.Start)
      if (gitStatText(c).length > 0) {
        Text(gitStatText(c))
          .fontSize(fs('type.micro'))
          .fontFamily('monospace')
          .fontColor(this.skin().sub)
          // 横向约束（门禁 H1）：± 统计是定宽短标签，不被压缩；可压缩的是左侧 `layoutWeight(1)` 列。
          .flexShrink(0)
      }
    }
    .width('100%')
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .alignItems(VerticalAlign.Center)
    .borderRadius(RADIUS_CARD)
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.onOpenDiff(c.path);
    })
  }

  /** 提交行：短哈希（等宽）+ 主题 + 作者·时间副行。 */
  @Builder
  CommitRow(r: GitCommitRow) {
    Row({ space: SPACE_XS }) {
      Text(r.shortHash)
        .fontSize(fs('type.micro'))
        .fontFamily('monospace')
        .fontColor(this.skin().accent)
        .width(COMMIT_HASH_W)
        // 横向约束（门禁 H1：`.width` 不在三选一之内）
        .flexShrink(0)
      Column({ space: 0 }) {
        Text(r.subject)
          .fontSize(fs('type.callout'))
          .fontColor(this.skin().text)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%').textAlign(TextAlign.Start)
        if (commitSubOf(r).length > 0) {
          Text(commitSubOf(r))
            .fontSize(fs('type.micro')).fontColor(this.skin().muted)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%').textAlign(TextAlign.Start)
        }
      }
      .layoutWeight(1).alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .constraintSize({ minHeight: HIT_TARGET_MIN })
    .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: INSET_ROW_Y, bottom: INSET_ROW_Y })
    .alignItems(VerticalAlign.Center)
    .borderRadius(RADIUS_CARD)
    .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
    .onClick(() => {
      this.onOpenCommit(r.hash);
    })
  }

  /** 单个 diff 行：双列行号 + 标记 + 内容（视觉与 `ToolPopover` 的 diff 卡逐项一致）。 */
  @Builder
  DiffRow(ln: DiffLine) {
    Row() {
      Text(ln.oldNum > 0 ? `${ln.oldNum}` : '')
        .width(LN_W).textAlign(TextAlign.End)
        .fontSize(fs('type.micro')).fontFamily('monospace').fontColor(this.skin().muted)
      Text(ln.newNum > 0 ? `${ln.newNum}` : '')
        .width(LN_W).textAlign(TextAlign.End)
        .fontSize(fs('type.micro')).fontFamily('monospace').fontColor(this.skin().muted)
        .margin({ right: SPACE_HAIR })
      Text(ln.kind === DIFF_ADD ? '+' : (ln.kind === DIFF_DEL ? '-' : ' '))
        .width(10).fontSize(fs('type.micro')).fontFamily('monospace')
        .fontColor(ln.kind === DIFF_ADD ? this.skin().add
          : (ln.kind === DIFF_DEL ? this.skin().del : this.skin().muted))
      Text(ln.text.length > 0 ? ln.text : ' ')
        .fontSize(fs('type.micro')).fontFamily('monospace')
        // ⛔ 不折行（web `whitespace-pre`）：长行由 diff 卡整体承担。
        .wordBreak(WordBreak.NORMAL)
        .maxLines(1)
        // 显式 overflow（门禁 text_truncation：`maxLines` 必须配 `textOverflow`）。
        // `Clip` 而非 `Ellipsis` —— diff 行加省略号会让人以为**内容本身**被截断。
        .textOverflow({ overflow: TextOverflow.Clip })
        // 水平溢出：正文必须能收缩（与行号/标记列同 Row ⇒ 取余下宽度）。
        .layoutWeight(1)
        .fontColor(ln.kind === DIFF_ADD ? this.skin().add
          : (ln.kind === DIFF_DEL ? this.skin().del : this.skin().sub))
        .copyOption(CopyOptions.LocalDevice)
    }
    .backgroundColor(ln.kind === DIFF_ADD ? this.skin().well
      : (ln.kind === DIFF_DEL ? this.skin().delBg : this.skin().card))
  }

  /** `@@` 块头。 */
  @Builder
  HunkRow(ln: DiffLine) {
    Text(ln.text)
      .width('100%')
      .fontSize(fs('type.micro')).fontFamily('monospace').fontColor(this.skin().accent)
      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      .backgroundColor(this.skin().hunk)
      .padding({ left: SPACE_HAIR, right: SPACE_HAIR })
  }

  /** diff 正文（一个文件；超出上限**截断并告知**）。 */
  @Builder
  DiffBody(f: DiffFile) {
    Scroll() {
      Column({ space: 0 }) {
        // 超过上限时**先**给出显式提示（⛔ 静默截断会让用户以为文件就这么短）。
        if (f.lines.length > MAX_DIFF_LINES) {
          Text(`仅显示前 ${MAX_DIFF_LINES} 行（共 ${f.lines.length} 行）`)
            .width('100%').fontSize(fs('type.micro')).fontColor(this.skin().muted)
            .padding({ left: SPACE_HAIR, bottom: SPACE_HAIR })
        }
        ForEach(diffHeadLines(f.lines, MAX_DIFF_LINES), (ln: DiffLine, li: number) => {
          if (ln.kind === DIFF_HUNK) {
            this.HunkRow(ln)
          } else {
            this.DiffRow(ln)
          }
        }, (ln: DiffLine, li: number) => `gl${li}`)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%').layoutWeight(1)
    .align(Alignment.TopStart)
    .scrollBar(BarState.Auto)
    .edgeEffect(EdgeEffect.Spring)
    .backgroundColor(this.skin().card)
    .borderRadius(RADIUS_CARD)
    .border({ width: STROKE_HAIRLINE, color: this.skin().rule })
    .clip(true)
  }

  /** 头部：标题 + 分支 + 落差 + 刷新 + 关闭。 */
  @Builder
  Header() {
    Row({ space: SPACE_XS }) {
      Text('Git')
        .fontSize(fs('type.headline'))
        .fontWeight(fw('type.headline'))
        .fontColor(this.skin().text)
      Text(this.branch)
        .fontSize(fs('type.micro'))
        .fontFamily('monospace')
        .fontColor(this.skin().sub)
        .padding({ left: SPACE_XS, right: SPACE_XS, top: SPACE_HAIR, bottom: SPACE_HAIR })
        .backgroundColor(this.skin().well)
        .borderRadius(RADIUS_CHIP)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        // 横向约束（门禁 H1：Row 内可变文本必须有约束）。
        .constraintSize({ maxWidth: '40%' })
      if (this.aheadBehind.length > 0) {
        Text(this.aheadBehind)
          .fontSize(fs('type.micro')).fontFamily('monospace').fontColor(this.skin().sub)
          // 横向约束（门禁 H1：Row 内可变文本三选一）
          .flexShrink(0)
      }
      Blank()
      if (this.loading || this.logLoading || this.diffLoading) {
        LoadingProgress().width(ICON_LOADING).height(ICON_LOADING).color(this.skin().accent)
      }
      // 刷新：真实 44 盒。
      Row() {
        SymbolGlyph($r('sys.symbol.arrow_clockwise'))
          .fontSize(SHEET_ACTION_GLYPH).fontColor([this.skin().icon])
      }
      .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
      .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .accessibilityText(i18nT('刷新 Git 状态'))
      .onClick(() => {
        this.onRefresh();
      })
      // 关闭：真实 44 盒（⛔ responseRegion 负偏移外扩在真机 SDK21 无效）。
      Row() {
        SymbolGlyph($r('sys.symbol.xmark'))
          .fontSize(SHEET_ACTION_GLYPH).fontColor([this.skin().icon])
      }
      .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
      .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .accessibilityText(i18nT('关闭 Git 面板'))
      .onClick(() => {
        this.onClose();
      })
    }
    .width('100%').alignItems(VerticalAlign.Center)
  }

  /** 详情形态的返回条（diff / commit 共用）。 */
  @Builder
  BackBar(title: string) {
    Row({ space: SPACE_XXS }) {
      Row() {
        SymbolGlyph($r('sys.symbol.chevron_left'))
          .fontSize(SHEET_ACTION_GLYPH).fontColor([this.skin().accent])
      }
      .width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)
      .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
      .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
      .accessibilityText(i18nT('返回列表'))
      .onClick(() => {
        this.onBack();
      })
      Text(title)
        .fontSize(fs('type.callout'))
        .fontFamily('monospace')
        .fontColor(this.skin().text)
        .layoutWeight(1)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%').alignItems(VerticalAlign.Center)
  }

  /** 列表形态。 */
  @Builder
  ListBody() {
    Scroll() {
      Column({ space: SPACE_HAIR }) {
        // 顶部一句（`gitHeadline`：干净 / N 个文件有改动 / 非仓库原因）。
        Text(this.headline)
          .width('100%')
          .fontSize(fs('type.caption'))
          .fontColor(this.skin().sub)
          .padding({ left: INSET_ROW_X, right: INSET_ROW_X, top: SPACE_XS, bottom: SPACE_XS })
        // 错误条（取数失败；刷新可重试）。
        if (this.error.length > 0) {
          Text(this.error)
            .width('100%')
            .fontSize(fs('type.caption'))
            .fontColor(this.skin().del)
            .wordBreak(WordBreak.BREAK_ALL)
            .padding(SPACE_SM)
            .backgroundColor(this.skin().well)
            .borderRadius(RADIUS_CARD)
            .margin({ left: INSET_ROW_X, right: INSET_ROW_X })
        }
        // ── 分区骨架：**仅当工作目录确是 git 仓库**时渲染 ─────────────────────────
        // ⚠️ 2026-10-13（目标③ 逐面板量测·装机帧 `/tmp/v3_git.jpeg`）：非仓库时本面板只出
        //    一句 notice，却**照样**渲染「工作区变更」/「提交历史」两个**空分区标题**（下方全空）
        //    ⇒ 读作"渲染了一半"。web 权威 `plugins/git-fancy/index.tsx:256` 在非仓库时**只**渲染
        //    `<div>{t('notRepo','当前目录不是 git 仓库')}</div>`、**没有任何分区骨架** ⇒ 对齐 web。
        if (this.isRepo) {
          // ── 工作区变更 ────────────────────────────────────────────────────
          this.SectionTitle('工作区变更', this.changes.length)
          ForEach(this.changes, (c: GitChange, i: number) => {
            this.FileRow(c)
          }, (c: GitChange, i: number) => `c${i}#${c.path}#${c.status}`)
          // ── 提交历史 ──────────────────────────────────────────────────────
          this.SectionTitle('提交历史', 0)
          ForEach(this.log.commits, (r: GitCommitRow, i: number) => {
            this.CommitRow(r)
          }, (r: GitCommitRow, i: number) => `h${r.hash}`)
          // 「加载更多」：只在**确认还有**时出现（⛔ 不做永远点不动的按钮）。
          if (this.hasMore) {
            Row() {
              Text(this.logLoading ? i18nT('加载中…') : i18nT('加载更多'))
                .fontSize(fs('type.callout'))
                .fontColor(this.skin().accent)
            }
            .width('100%')
            .constraintSize({ minHeight: HIT_TARGET_MIN })
            .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
            .stateStyles({ pressed: { .opacity(PRESS_OPACITY) }, normal: { .opacity(1) } })
            .onClick(() => {
              this.onLoadMore();
            })
          }
        }
      }
      .width('100%')
      .padding({ bottom: SPACE_MD })
    }
    .width('100%').layoutWeight(1)
    .align(Alignment.TopStart)
    .scrollBar(BarState.Auto)
    .edgeEffect(EdgeEffect.Spring)
  }

  build() {
    Stack() {
      Column({ space: SPACE_SM }) {
        if (this.mode === 'diff') {
          this.BackBar(this.diffPath)
        } else if (this.mode === 'commit') {
          this.BackBar('提交详情')
        } else {
          this.Header()
        }

        if (this.mode === 'diff') {
          // diff 形态：路径 + ± 统计 +（若来自 commit）来源。
          Row({ space: SPACE_XS }) {
            Text(this.diffPath)
              .fontSize(fs('type.caption')).fontFamily('monospace').fontColor(this.skin().sub)
              .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(`+${this.diffAdds}`).fontSize(fs('type.micro')).fontColor(this.skin().add)
            Text(`−${this.diffDels}`).fontSize(fs('type.micro')).fontColor(this.skin().del)
            if (this.diffFromCommit.length > 0) {
              Text(this.diffFromCommit)
                .fontSize(fs('type.micro')).fontFamily('monospace').fontColor(this.skin().accent)
            }
          }.width('100%').alignItems(VerticalAlign.Center)

          if (this.diffLoading) {
            Column() {
              LoadingProgress().width(ICON_LOADING).height(ICON_LOADING).color(this.skin().accent)
            }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
          } else if (this.diffFiles().length === 0) {
            // 空 diff：二进制文件 / 仅模式变更 / 内容相同 ⇒ 显式告知，⛔ 不留白屏。
            Column({ space: SPACE_XS }) {
              SymbolGlyph($r('sys.symbol.doc_text'))
                .fontSize(typeOf('type.display').size).fontColor([this.skin().icon])
              Text(i18nT('没有可显示的文本改动（二进制文件或仅权限变更）'))
                .fontSize(fs('type.caption')).fontColor(this.skin().sub)
                .textAlign(TextAlign.Center)
                .wordBreak(WordBreak.BREAK_ALL)
            }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
          } else {
            this.DiffBody(this.diffFiles()[0])
          }
        } else if (this.mode === 'commit') {
          // commit 形态：元信息 + 信息全文（封顶滚动）+ 该提交内文件（点进 diff）。
          if (this.loading) {
            Column() {
              LoadingProgress().width(ICON_LOADING).height(ICON_LOADING).color(this.skin().accent)
            }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
          } else {
            Text(this.commitMeta)
              .width('100%')
              .fontSize(fs('type.caption')).fontColor(this.skin().sub)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            if (this.commitMessage.length > 0) {
              Scroll() {
                Text(this.commitMessage)
                  .width('100%')
                  .fontSize(fs('type.callout')).fontColor(this.skin().text)
                  .wordBreak(WordBreak.BREAK_ALL)
                  .copyOption(CopyOptions.LocalDevice)
              }
              .width('100%')
              .constraintSize({ maxHeight: COMMIT_MSG_MAX_H })
              .align(Alignment.TopStart)
              // 显式滚动条（门禁 hittarget_audit B 类：浮层内 Scroll 必须声明 scrollBar）。
              .scrollBar(BarState.Auto)
              .padding(SPACE_SM)
              .backgroundColor(this.skin().card)
              .borderRadius(RADIUS_CARD)
              .border({ width: STROKE_HAIRLINE, color: this.skin().rule })
            }
            this.SectionTitle('该提交内的文件', this.commitFiles.length)
            Scroll() {
              Column({ space: SPACE_HAIR }) {
                ForEach(this.commitFiles, (c: GitChange, i: number) => {
                  this.FileRow(c)
                }, (c: GitChange, i: number) => `f${i}#${c.path}`)
              }.width('100%')
            }
            .width('100%').layoutWeight(1)
            .align(Alignment.TopStart)
            .scrollBar(BarState.Auto)
          }
        } else {
          this.ListBody()
        }
      }
      .width('100%').height('100%')
      .padding(SPACE_MD)
      .backgroundColor(this.skin().overlay)
      .borderRadius(RADIUS_CARD)
      .border({ width: STROKE_HAIRLINE, color: this.skin().hair })
      .shadow({
        radius: this.sheetLayers()[0].radius,
        color: this.sheetLayers()[0].color,
        offsetX: 0, offsetY: this.sheetLayers()[0].offsetY,
      })
    }
    .width(SHEET_WIDTH).height(PANEL_H)
    .id('xbot-git-panel')
    .backgroundColor(this.skin().overlay)
    .borderRadius(RADIUS_CARD)
    .shadow({
      radius: this.sheetLayers()[1].radius,
      color: this.sheetLayers()[1].color,
      offsetX: 0, offsetY: this.sheetLayers()[1].offsetY,
    })
    .transition(sheetTransition())
  }
}
