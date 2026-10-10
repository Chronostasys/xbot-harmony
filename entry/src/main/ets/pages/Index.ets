import { common } from '@kit.AbilityKit';
import { componentSnapshot, componentUtils, display, promptAction } from '@kit.ArkUI';
import { image } from '@kit.ImageKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { util } from '@kit.ArkTS';
import { AppConfig, ConfigStore, isValidServerUrl, normalizeServerUrl } from '../core/config';
import { ChatStore } from '../core/store';
import { mdCacheStats, MdCacheStats } from '../core/markdown';
import { displayContent, displayReasoning, streamStatsText } from '../core/streammerge';
import {
  channelLabel, hiddenRowCount, visibleRows, MAX_ROWS_VISIBLE,
} from '../core/sessionpick';
import {
  AskOption,
  AskQuestion,
  AskUserPrompt,
  ChatRow,
  HistoryIteration,
  PluginPanelInfo,
  QueueItem,
  SessionItem,
  ToolProgress,
} from '../core/types';
import { MarkdownView } from '../components/MarkdownView';
import { WebSurface } from '../components/WebSurface';

/** 一个问题当前选中的答案（用类而非 Map/Record：ArkTS 下最稳，且能整体替换触发重渲染）。 */
class AskSelection {
  qid: string = '';
  labels: string[] = [];
  other: string = '';
}

/**
 * 单个 turn 默认最多渲染多少个迭代。
 *
 * ⛔ 为什么必须限制：一个 turn 可能有**上千个迭代**（每次工具调用一个），若全部渲染 ——
 * 每个迭代还带完整 Markdown（含 Span/表格/代码块）—— 视口内外的 DOM 会瞬间上千，
 * 表现就是**卡到没法用 / 看起来"整个渲染错乱"**。Web 端同样的问题是用"迭代级窗口化"解决的
 * （见 xbot 仓库 docs/agent/gotchas-web-frontend.md）。这里先用**上限 + 手动展开**做等价保护。
 */
const MAX_ITER_VISIBLE: number = 16;

/**
 * 诊断开关：登录后**自动**走查并上传所有页面截图。
 *
 * 为什么需要它：用户反馈"渲染错乱、完全用不了"时，可能**连 ⚙ 都点不到** ⇒
 * 交互式触发不可靠。置 true 后 App 会在登录后自行走查一遍（每页截图上传到服务端），
 * 供排查用。**排查完成应改回 false**（避免每次启动都上传）。
 */
const AUTO_AUDIT_ON_LAUNCH: boolean = true;

/** 把任意 catch 到的值变成可读文本（BusinessError 有 message/code；其它情况回落 JSON）。 */
function errText(e: Object): string {
  const err: BusinessError = e as BusinessError;
  const m: string = err.message !== undefined ? err.message : '';
  const c: string = err.code !== undefined ? `${err.code}` : '';
  if (m.length > 0) {
    return c.length > 0 ? `${m}（code ${c}）` : m;
  }
  const raw: string = JSON.stringify(e);
  return raw !== undefined && raw.length > 2 ? raw : '未知错误';
}

/**
 * 按 AskUser 载荷生成选择状态。
 * ⚠️ 模块级函数而非 `struct Index` 的 static 方法（ArkUI struct 的静态成员在真机上
 * 是 undefined，调用即 "undefined is not callable"）。
 */
function selectionsFor(ask: AskUserPrompt | null): AskSelection[] {
  const out: AskSelection[] = [];
  if (ask === null || ask.questions === undefined) {
    return out;
  }
  for (let i = 0; i < ask.questions.length; i++) {
    const q: AskQuestion = ask.questions[i];
    const sel: AskSelection = new AskSelection();
    sel.qid = q.id !== undefined ? q.id : `q${i}`;
    out.push(sel);
  }
  return out;
}

/**
 * markdown 解析缓存的一行摘要（**模块级函数**：ArkUI 的 struct 不是普通类，真机上静态成员会解析成
 * undefined —— 见 docs/ARKTS-GOTCHAS.md）。放在自检页是为了在真机截图上**证明**"整行反复重建
 * 不再反复解析几百 KB"这条优化确实在命中。
 */
function mdCacheText(): string {
  const st: MdCacheStats = mdCacheStats();
  const total: number = st.hits + st.misses;
  const rate: number = total > 0 ? Math.round(st.hits * 100 / total) : 0;
  return `md缓存 命中=${st.hits} 未命中=${st.misses}（命中率 ${rate}%）`
    + ` 占用=${Math.round(st.chars / 1024)}KB 条目=${st.entries}`;
}

/**
 * 消息列表的项数 = [可选"加载更早消息"项] + rows + [可选 busy 指示器项]。
 *
 * 必须显式算：`onScrollIndex` 给的是**列表项**下标，而项数不等于 rows.length
 * （头部可能多一项、尾部可能多一项 busy 指示器）—— 用错就会误判"在不在底部"。
 * 模块级函数：ArkUI 的 struct 不是普通类，真机上静态成员会解析成 undefined（见 docs/ARKTS-GOTCHAS.md）。
 */
function listItemCount(hasMore: boolean, loadingMore: boolean, rowsLen: number, busy: boolean): number {
  let n: number = rowsLen;
  if (hasMore || loadingMore) {
    n += 1;
  }
  if (busy) {
    n += 1;
  }
  return n;
}

@Entry
@Component
struct Index {
  // ── 引导 / 登录 ────────────────────────────────────────────────────────────
  @State booted: boolean = false;
  @State loggedIn: boolean = false;
  @State errMsg: string = '';
  @State serverUrl: string = 'http://';
  @State username: string = '';
  @State password: string = '';
  @State testing: boolean = false;
  @State testMsg: string = '';
  @State recentServers: string[] = [];

  // ── 聊天数据 ──────────────────────────────────────────────────────────────
  @State sessions: SessionItem[] = [];
  @State rows: ChatRow[] = [];
  @State busy: boolean = false;
  /**
   * 加载失败原因（网络/代理不通时最常见）。
   * 聊天页在"列表为空"时必须给出可读原因 + 重试，否则用户看到的就是一片空白，
   * 极易被误判为「渲染坏了 / 完全用不了」。
   */
  @State loadErr: string = '';
  @State currentChat: string = '';
  @State draft: string = '';
  @State hasMore: boolean = false;
  @State loadingMore: boolean = false;
  @State queue: QueueItem[] = [];

  // ── 弹层 ──────────────────────────────────────────────────────────────────
  @State showDrawer: boolean = false;
  @State showSettings: boolean = false;
  @State showQueue: boolean = false;
  @State showPlugins: boolean = false;
  @State showSelfCheck: boolean = false;
  /** 各页版面几何的**屏幕可见文本**（无需网络：截一张图即可把数值带给我） */
  /**
   * 用户当前是否停在列表底部。
   * ⚠️ 自动"跟随到底部"必须由它守卫：流式期间每个事件都会同步一次，若无条件
   * `scrollEdge(Bottom)`，用户往上滚想看工具/思考详情会被立刻拽回底部 ⇒ 表现为"根本没法用"。
   * 与 xbot Web 端既有铁律一致（所有 GotoBottom 调用由 !userScrolledUp 守卫）。
   */
  @State atBottom: boolean = true;

  /** 首屏渲染的行窗口（避免一次性构建几十行；点上方的「显示更早」按批放开） */
  @State rowLimit: number = MAX_ROWS_VISIBLE;

  @State geoText: string = '';
  @State geoRunning: boolean = false;
  @State auditing: boolean = false;
  @State auditLog: string = '';
  @State renamingId: string = '';
  @State renameText: string = '';

  // ── AskUser ───────────────────────────────────────────────────────────────
  @State askUser: AskUserPrompt | null = null;
  @State askSelections: AskSelection[] = [];
  @State askBusy: boolean = false;

  // ── 插件 / ArkWeb 面板 ────────────────────────────────────────────────────
  @State plugins: PluginPanelInfo[] = [];
  @State panelUrl: string = '';

  // ── 图片查看 ──────────────────────────────────────────────────────────────
  @State imagePixel: image.PixelMap | null = null;
  @State imageBusy: boolean = false;

  // ── 工具/迭代展开 ─────────────────────────────────────────────────────────
  @State openToolKey: string = '';
  @State openReasonKey: string = '';
  /** 展开了全部迭代的 turn（默认只渲染最近 MAX_ITER_VISIBLE 个，防长 turn 爆炸） */
  @State expandedTurn: string = '';

  // ── 显示设置 ──────────────────────────────────────────────────────────────
  @State showReasoning: boolean = true;

  private store: ChatStore | null = null;
  /** 合并同步用：待同步的 store 与"已排帧"标志（见 scheduleSync） */
  private pendingSync: ChatStore | null = null;
  private syncScheduled: boolean = false;
  private config: ConfigStore = new ConfigStore();
  private listScroller: Scroller = new Scroller();

  // ── 生命周期 ──────────────────────────────────────────────────────────────

  aboutToAppear(): void {
    this.bootstrap();
  }

  aboutToDisappear(): void {
    const s: ChatStore | null = this.store;
    if (s !== null) {
      s.sse.close();
    }
  }

  private async bootstrap(): Promise<void> {
    // 兜底：即使本地存储不可用，也必须能进登录页（否则永远停在 Loading，无从排查）
    let saved: AppConfig = new AppConfig();
    try {
      const ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
      saved = await this.config.init(ctx);
    } catch (e) {
      this.errMsg = `[本地存储不可用] ${errText(e)}（可继续手填地址登录）`;
      this.booted = true;
      return;
    }
    if (saved.serverUrl.length > 0) {
      this.serverUrl = saved.serverUrl;
    }
    this.username = saved.username;
    this.recentServers = this.config.recentServers();
    if (saved.serverUrl.length > 0 && saved.sessionCookie.length > 0) {
      const store: ChatStore = this.makeStore(saved.serverUrl);
      store.http.importSessionCookie(saved.sessionCookie);
      try {
        await store.loadSessions();
        this.attach(store);
        this.loggedIn = true;
        if (AUTO_AUDIT_ON_LAUNCH) {
          // 冷启动免登录路径同样触发（用户在手机上多半是这个路径）
          setTimeout(() => {
            this.runUiAudit();
          }, 4000);
        }
        const first: SessionItem | undefined = this.sessions.length > 0 ? this.sessions[0] : undefined;
        if (first !== undefined && first.chat_id !== undefined) {
          await store.openSession(first.chat_id);
        }
      } catch (e) {
        this.loggedIn = false;
      }
    }
    this.booted = true;
  }

  private makeStore(url: string): ChatStore {
    const store: ChatStore = new ChatStore(url);
    store.onUpdate = () => {
      this.scheduleSync(store);
    };
    return store;
  }

  /**
   * 把 store→UI 的同步**合并到每帧至多一次**。
   *
   * 为什么：流式期间每个 SSE 事件都会 onUpdate（每秒可达数十次），逐次同步会把 UI 线程打满
   * ⇒ 真机表现"渲染很卡、交互也很差"。与 xbot Web 端已定稿的结论同款：所有"每帧一次"的更新
   * 必须走同一个调度器。（切会话/首帧仍走同步路径 syncFrom，保证不迟一帧。）
   */
  private scheduleSync(store: ChatStore): void {
    this.pendingSync = store;
    if (this.syncScheduled) {
      return;
    }
    this.syncScheduled = true;
    setTimeout(() => {
      this.syncScheduled = false;
      const s: ChatStore | null = this.pendingSync;
      this.pendingSync = null;
      if (s !== null) {
        this.syncFrom(s);
      }
    }, 16);
  }

  private attach(store: ChatStore): void {
    this.store = store;
    this.syncFrom(store);
  }

  private syncFrom(store: ChatStore): void {
    // 切会话 ⇒ 用户预期"看到最新"，总是跳到底（此时门控必须放行）
    if (store.currentChatId !== this.currentChat) {
      this.atBottom = true;
      this.rowLimit = MAX_ROWS_VISIBLE;   // 切会话重置行窗口（否则行数会无限累积增长）
    }
    this.sessions = store.sessions.slice();
    this.rows = store.rows.slice();
    this.busy = store.busy;
    this.currentChat = store.currentChatId;
    this.hasMore = store.hasMore;
    this.loadingMore = store.loadingMore;
    this.queue = store.queue.slice();
    const ask: AskUserPrompt | null = store.askUser;
    if (ask !== this.askUser) {
      this.askUser = ask;
      this.askSelections = selectionsFor(ask);
    }
    // 只有用户本来就在底部才跟随；用户往上滚后就不再抢滚动位置（否则"阅读中被打断"）
    if (this.atBottom) {
      setTimeout(() => {
        try {
          this.listScroller.scrollEdge(Edge.Bottom);
        } catch (e) {
          // 首帧尚未布局
        }
      }, 30);
    }
  }

  /** 规范化并校验服务端地址；不合法返回空串并把原因写进 testMsg。 */
  private takeServerUrl(): string {
    const url: string = normalizeServerUrl(this.serverUrl);
    if (!isValidServerUrl(url)) {
      this.testMsg = '地址不完整：需要 http://主机:端口（例如 http://192.168.1.10:16000）';
      return '';
    }
    this.serverUrl = url;
    return url;
  }

  /** 「测试连接」：打公开端点 /api/auth/config（不需要登录），立刻给出可达性结论。 */
  private async testConnection(): Promise<void> {
    const url: string = this.takeServerUrl();
    if (url.length === 0) {
      return;
    }
    this.testing = true;
    this.testMsg = '';
    try {
      const store: ChatStore = this.makeStore(url);
      const cfg = await store.http.authConfig();
      const hint: string = cfg.need_bootstrap === true
        ? '服务端可用：还没有账号，先「注册」建第一个账号'
        : (cfg.invite_only === true ? '服务端可用：仅允许已存在的账号登录' : '服务端可用：可直接登录或注册');
      this.testMsg = `✅ ${hint}`;
      // 顺手记进"最近使用"
      await this.config.save(url, this.username, '');
      this.recentServers = this.config.recentServers();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.testMsg = `❌ 连不上：${err.message}（检查 IP/端口、手机是否同网段、服务端是否在跑）`;
    } finally {
      this.testing = false;
    }
  }

  /**
   * 逐页采集版面几何并**显示在屏幕上**（不依赖网络）。
   *
   * 为什么需要：真机画面只能靠用户截图；但"哪个容器高度为 0 / 跑到屏幕外"这类根因，
   * **数值比图更直接**。把数值渲染成文本后，用户截一张图就等于把 7 页的实测几何带给我。
   */
  private async collectAllGeometry(): Promise<void> {
    if (this.geoRunning) {
      return;
    }
    this.geoRunning = true;
    const parts: string[] = [];
    try {
      parts.push(`# 聊天页\n${this.collectGeometry()}`);
      this.showDrawer = true;
      await this.wait(700);
      parts.push(`# 会话抽屉\n${this.collectGeometry()}`);
      this.showDrawer = false;
      this.showSettings = true;
      await this.wait(700);
      parts.push(`# 设置\n${this.collectGeometry()}`);
      this.showSettings = false;
      this.showQueue = true;
      await this.wait(700);
      parts.push(`# 队列\n${this.collectGeometry()}`);
      this.showQueue = false;
      this.showPlugins = true;
      await this.wait(700);
      parts.push(`# 能力面板\n${this.collectGeometry()}`);
      this.showPlugins = false;
      await this.wait(300);
      parts.push(`# 回到聊天\n${this.collectGeometry()}`);
      this.geoText = parts.join('\n\n');
    } catch (e) {
      this.geoText = `采集失败: ${errText(e as Object)}`;
    } finally {
      this.showDrawer = false;
      this.showSettings = false;
      this.showQueue = false;
      this.showPlugins = false;
      this.geoRunning = false;
    }
  }

  /** 等待 ms（ArkTS 里没有 await sleep，自己包一层 Promise）。 */
  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(() => {
        resolve();
      }, ms);
    });
  }

  /**
   * 采集关键组件的**版面几何数值**（可读文本，不依赖看图）。
   *
   * 为什么需要：若渲染乱到看不清，数值仍能指出根因（例如列表高度 0、元素跑到屏幕外、
   * 宽度为 0）。`componentUtils.getRectangleById(id)` 对不存在的组件会抛错 ⇒ 逐个兜底。
   */
  private collectGeometry(): string {
    const ids: string[] = [
      'xbot-root', 'xbot-header', 'xbot-list', 'xbot-composer', 'xbot-login',
      'xbot-drawer', 'xbot-settings', 'xbot-selfcheck',
    ];
    const out: string[] = [];
    try {
      const d: display.Display = display.getDefaultDisplaySync();
      out.push(`screen=${d.width}x${d.height} densityDPI=${d.densityDPI}`);
    } catch (e) {
      out.push('screen=unknown');
    }
    for (let i = 0; i < ids.length; i++) {
      try {
        const r: componentUtils.ComponentInfo = componentUtils.getRectangleById(ids[i]);
        const gx: number = Math.round(r.screenOffset.x);
        const gy: number = Math.round(r.screenOffset.y);
        const gw: number = Math.round(r.size.width);
        const gh: number = Math.round(r.size.height);
        // ⚠️ ArkUI 对"不存在"的 id 往往返回 0 尺寸而不是抛错 ⇒ 必须显式标注，
        // 否则"组件真的 0 尺寸"与"组件不存在"分不开（曾导致一份几何文本无法判读）。
        const flag: string = (gw === 0 || gh === 0) ? ' ⚠未布局(0尺寸,或被弹层遮挡/当前不在该页)' : '';
        out.push(`${ids[i]}: x=${gx} y=${gy} w=${gw} h=${gh}${flag}`);
      } catch (e) {
        out.push(`${ids[i]}: absent（getRectangleById 抛错=确实不存在）`);
      }
    }
    return out.join('\n');
  }

  /** 截取根容器当前画面并上传到服务端（返回服务端给的 key）。 */
  private async captureAndUpload(name: string): Promise<string> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return '';
    }
    const pm: image.PixelMap = await componentSnapshot.get('xbot-root');
    const packer: image.ImagePacker = image.createImagePacker();
    const buf: ArrayBuffer = await packer.packing(pm, { format: 'image/png', quality: 100 });
    await packer.release();
    const data: string = await store.http.uploadBytes('/api/files/upload', `${name}.png`, buf, 'image/png');
    await pm.release();
    return data;
  }

  /**
   * UI 走查：逐页截图并上传（登录页/聊天页/会话抽屉/设置/队列/能力面板/渲染自检）。
   *
   * 为什么要自动化：本机无法渲染鸿蒙 Stage 应用（预览器源码 `Linux is not supported`、
   * 无头容器 `AttachSurface not ready`），只能借助真机。与其让用户一页页手动截图，
   * 不如让应用**自己**把每一页截下来传到用户自己的服务端 —— 服务端目录我这边可读。
   */
  private async runUiAudit(): Promise<void> {
    if (this.auditing) {
      return;
    }
    this.auditing = true;
    const done: string[] = [];
    const geo: string[] = [];
    try {
      const steps: string[] = ['01-chat'];
      for (let i = 0; i < steps.length; i++) {
        await this.wait(600);
        done.push(`${steps[i]}=${await this.captureAndUpload(steps[i])}`);
        geo.push(`--- ${steps[i]} ---\n${this.collectGeometry()}`);
      }
      // 会话抽屉
      this.showDrawer = true;
      await this.wait(900);
      try {
        done.push(`02-drawer=${await this.captureAndUpload('02-drawer')}`);
      } catch (e) {
        done.push(`02-drawer=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 02-drawer ---\n${this.collectGeometry()}`);
      this.showDrawer = false;
      // 设置
      this.showSettings = true;
      await this.wait(900);
      try {
        done.push(`03-settings=${await this.captureAndUpload('03-settings')}`);
      } catch (e) {
        done.push(`03-settings=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 03-settings ---\n${this.collectGeometry()}`);
      this.showSettings = false;
      // 渲染自检
      this.showSelfCheck = true;
      await this.wait(1200);
      try {
        done.push(`04-selfcheck=${await this.captureAndUpload('04-selfcheck')}`);
      } catch (e) {
        done.push(`04-selfcheck=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 04-selfcheck ---\n${this.collectGeometry()}`);
      this.showSelfCheck = false;
      // 队列（有内容才有意义，无内容也截，便于对比）
      this.showQueue = true;
      await this.wait(900);
      try {
        done.push(`05-queue=${await this.captureAndUpload('05-queue')}`);
      } catch (e) {
        done.push(`05-queue=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 05-queue ---\n${this.collectGeometry()}`);
      this.showQueue = false;
      // 能力面板
      await this.openPlugins();
      await this.wait(900);
      try {
        done.push(`06-plugins=${await this.captureAndUpload('06-plugins')}`);
      } catch (e) {
        done.push(`06-plugins=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 06-plugins ---\n${this.collectGeometry()}`);
      this.showPlugins = false;
      await this.wait(400);
      try {
        done.push(`07-chat-back=${await this.captureAndUpload('07-chat-back')}`);
      } catch (e) {
        done.push(`07-chat-back=FAILED:${errText(e as Object)}`);
      }
      geo.push(`--- 07-chat-back ---\n${this.collectGeometry()}`);
      this.auditLog = done.join('  ');
      this.toast('走查完成，已上传 7 张截图 + 1 份版面几何');
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.auditLog = `失败: ${err.message}（已完成: ${done.join(' ') }）`;
      this.toast(`走查失败: ${err.message}`);
    } finally {
      // 几何数值必须送达（唯一不依赖图像的信息）：即使中途失败也要上传
      const st: ChatStore | null = this.store;
      if (st !== null && geo.length > 0) {
        try {
          const txt: string = geo.join('\n\n');
          const bytes: Uint8Array = new Uint8Array(new util.TextEncoder().encodeInto(txt));
          await st.http.uploadBytes('/api/files/upload', 'audit-layout.txt',
            bytes.buffer as ArrayBuffer, 'text/plain');
          this.auditLog = `${this.auditLog}\n几何已上传(${geo.length} 页)`;
        } catch (e) {
          this.auditLog = `${this.auditLog}\n几何上传失败: ${errText(e as Object)}`;
        }
      }
      this.auditing = false;
      this.showSelfCheck = false;
    }
  }

  private toast(msg: string): void {
    promptAction.showToast({ message: msg, duration: 2500 });
  }

  // ── 登录 / 登出 ───────────────────────────────────────────────────────────

  private async doLogin(): Promise<void> {
    this.errMsg = '';
    const url: string = this.takeServerUrl();
    if (url.length === 0) {
      this.errMsg = this.testMsg;
      return;
    }
    const store: ChatStore = this.makeStore(url);
    // 分步报错：哪一步挂了 + 原始信息，一眼可定位（真机排查只能靠这个）
    try {
      await store.http.login(this.username, this.password);
    } catch (e) {
      this.errMsg = `[登录请求] ${errText(e)}`;
      return;
    }
    try {
      await store.loadSessions();
      this.attach(store);
    } catch (e) {
      this.errMsg = `[加载会话] ${errText(e)}`;
      return;
    }
    try {
      await this.config.save(url, this.username, store.http.exportSessionCookie());
      this.recentServers = this.config.recentServers();
    } catch (e) {
      this.errMsg = `[保存登录态] ${errText(e)}`;
      return;
    }
    this.loggedIn = true;
    if (AUTO_AUDIT_ON_LAUNCH) {
      // 等界面稳定再走查（不阻塞登录流程）
      setTimeout(() => {
        this.runUiAudit();
      }, 2500);
    }
    const first: SessionItem | undefined = this.sessions.length > 0 ? this.sessions[0] : undefined;
    if (first !== undefined && first.chat_id !== undefined) {
      try {
        await store.openSession(first.chat_id);
      } catch (e) {
        this.errMsg = `[打开会话] ${errText(e)}`;
      }
    }
  }

  private async doRegister(): Promise<void> {
    this.errMsg = '';
    const url: string = this.takeServerUrl();
    if (url.length === 0) {
      this.errMsg = this.testMsg;
      return;
    }
    try {
      const store: ChatStore = this.makeStore(url);
      await store.http.register(this.username, this.password);
      await this.doLogin();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.errMsg = err.message;
    }
  }

  private async doLogout(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store !== null) {
      try {
        await store.http.logout();
      } catch (e) {
        // 忽略
      }
      store.sse.close();
    }
    await this.config.clearSession();
    this.store = null;
    this.loggedIn = false;
    this.rows = [];
    this.sessions = [];
    this.showDrawer = false;
  }

  // ── 会话 ──────────────────────────────────────────────────────────────────

  private async switchSession(chatId: string): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    this.showDrawer = false;
    try {
      await store.openSession(chatId);
    } catch (e) {
      this.loadErr = errText(e as Object);
      this.toast(`切换失败: ${this.loadErr}`);
    }
  }

  private async newSession(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    this.showDrawer = false;
    try {
      await store.createSession();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.toast(`新建失败: ${err.message}`);
    }
  }

  private labelOf(chatId: string): string {
    for (let i = 0; i < this.sessions.length; i++) {
      const s: SessionItem = this.sessions[i];
      if (s.chat_id === chatId) {
        return s.label !== undefined && s.label.length > 0 ? s.label : s.chat_id;
      }
    }
    return chatId;
  }

  // ── 发送 / 取消 / 分页 ────────────────────────────────────────────────────

  private async sendDraft(): Promise<void> {
    const store: ChatStore | null = this.store;
    const text: string = this.draft.trim();
    if (store === null || text.length === 0) {
      return;
    }
    this.draft = '';
    try {
      await store.send(text);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.toast(`发送失败: ${err.message}`);
    }
  }

  /** 重试加载当前会话（网络恢复后一键回到正常）。 */
  private async retryLoad(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    this.loadErr = '';
    try {
      if (this.currentChat.length === 0) {
        await store.loadSessions();
        const first: SessionItem | undefined = this.sessions.length > 0 ? this.sessions[0] : undefined;
        if (first !== undefined && first.chat_id !== undefined) {
          await store.openSession(first.chat_id);
        }
      } else {
        await store.openSession(this.currentChat);
      }
    } catch (e) {
      this.loadErr = errText(e as Object);
      this.toast(`仍然失败: ${this.loadErr}`);
    }
  }

  private async loadMore(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    await store.loadMore();
  }

  // ── 工具详情 / 迭代展开 ───────────────────────────────────────────────────

  private toolKey(turnID: number, iter: number, name: string): string {
    return `${turnID}:${iter}:${name}`;
  }

  private async toggleTool(row: ChatRow, it: HistoryIteration, t: ToolProgress): Promise<void> {
    const key: string = this.toolKey(row.turnID, it.iteration, t.name);
    if (this.openToolKey === key) {
      this.openToolKey = '';
      return;
    }
    this.openToolKey = key;
    const store: ChatStore | null = this.store;
    // 折叠视图下详情未下发（该迭代带 tools_folded）→ 按需拉取
    if (store !== null && it.tools_folded === true && (t.detail === undefined || t.detail.length === 0)) {
      await store.fetchIterationDetail(row.turnID, it.iteration);
    }
  }

  // ── AskUser ───────────────────────────────────────────────────────────────

  private toggleAskOption(qid: string, label: string, multi: boolean): void {
    const next: AskSelection[] = [];
    for (let i = 0; i < this.askSelections.length; i++) {
      const s: AskSelection = this.askSelections[i];
      if (s.qid !== qid) {
        next.push(s);
        continue;
      }
      const copy: AskSelection = new AskSelection();
      copy.qid = s.qid;
      copy.other = s.other;
      if (!multi) {
        copy.labels = s.labels.indexOf(label) >= 0 ? [] : [label];
      } else if (s.labels.indexOf(label) >= 0) {
        copy.labels = s.labels.filter((x: string) => x !== label);
      } else {
        copy.labels = s.labels.concat([label]);
      }
      next.push(copy);
    }
    this.askSelections = next;
  }

  private isAskSelected(qid: string, label: string): boolean {
    for (let i = 0; i < this.askSelections.length; i++) {
      const s: AskSelection = this.askSelections[i];
      if (s.qid === qid) {
        return s.labels.indexOf(label) >= 0;
      }
    }
    return false;
  }

  private async submitAsk(cancelled: boolean): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null || this.askBusy) {
      return;
    }
    this.askBusy = true;
    try {
      const answers: Record<string, string> = {};
      for (let i = 0; i < this.askSelections.length; i++) {
        const s: AskSelection = this.askSelections[i];
        const joined: string = s.labels.join(', ');
        answers[s.qid] = s.other.length > 0 ? (joined.length > 0 ? `${joined}；${s.other}` : s.other) : joined;
      }
      await store.respondAsk(answers, cancelled);
      this.askUser = null;
      this.askSelections = [];
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.toast(`提交失败: ${err.message}`);
    } finally {
      this.askBusy = false;
    }
  }

  // ── 插件面板 ──────────────────────────────────────────────────────────────

  private async openPlugins(): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store !== null) {
      this.plugins = await store.listPlugins();
    }
    this.showPlugins = true;
  }

  // ── 图片（cookie 鉴权端点 → 自行取字节解码） ──────────────────────────────

  private async openImage(src: string): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    this.imageBusy = true;
    this.imagePixel = null;
    try {
      const buf: ArrayBuffer | null = await store.http.getBinary(src);
      if (buf === null) {
        this.toast('图片加载失败（可能已过期或未登录）');
        return;
      }
      const source: image.ImageSource = image.createImageSource(buf);
      const pm: image.PixelMap = await source.createPixelMap();
      this.imagePixel = pm;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.toast(`图片解码失败: ${err.message}`);
    } finally {
      this.imageBusy = false;
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  build() {
    Stack() {
      if (!this.booted) {
        this.LoadingView()
      } else if (!this.loggedIn) {
        this.LoginView()
      } else {
        this.ChatView()
      }

      // 会话抽屉
      if (this.showDrawer) {
        this.DrawerSheet()
      }
      // 设置
      if (this.showSettings) {
        this.SettingsSheet()
      }
      // 队列
      if (this.showQueue) {
        this.QueueSheet()
      }
      // 插件面板选择
      if (this.showPlugins) {
        this.PluginsSheet()
      }
      // AskUser（服务端权威：有 pending 就弹）
      if (this.askUser !== null) {
        this.AskUserSheet()
      }
      // 渲染自检（逐构件隔离排查用）
      if (this.showSelfCheck) {
        this.SelfCheckSheet()
      }
      // 图片查看
      if (this.imagePixel !== null || this.imageBusy) {
        this.ImageViewer()
      }
      // ArkWeb 逃生舱（插件 UI / GenUI / 终端 / 编辑器 / 完整 Web UI）
      if (this.panelUrl.length > 0) {
        WebSurface({ url: this.panelUrl, onClose: () => {
          this.panelUrl = '';
        } })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0B0F19')
    .id('xbot-root')
  }

  @Builder
  LoadingView() {
    Column() {
      LoadingProgress().width(48).height(48).color('#8B5CF6')
      Text('xbot').fontSize(18).fontColor('#E5E7EB').margin({ top: 12 })
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
  }

  @Builder
  LoginView() {
    Column({ space: 12 }) {
      Text('xbot').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#E5E7EB')
      Text('连接你的 xbot 服务端（原生鸿蒙客户端）').fontSize(13).fontColor('#9CA3AF').margin({ bottom: 8 })

      TextInput({ placeholder: '服务端地址，如 192.168.1.10:16000', text: this.serverUrl })
        .onChange((v: string) => {
          this.serverUrl = v;
          this.testMsg = '';
        })
        .backgroundColor('#111827').fontColor('#E5E7EB').constraintSize({ minHeight: 44 })

      // 最近用过的地址（一点即填，省得重打 IP）
      if (this.recentServers.length > 0) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.recentServers, (u: string) => {
            Text(u)
              .fontSize(11).fontColor('#93C5FD')
              .padding({ left: 8, right: 8, top: 4, bottom: 4 })
              .margin(2)
              .backgroundColor('#111827').borderRadius(6)
              .onClick(() => {
                this.serverUrl = u;
                this.testMsg = '';
              })
          }, (u: string) => u)
        }
        .width('100%')
      }

      Row({ space: 8 }) {
        Button(this.testing ? '测试中…' : '测试连接')
          .layoutWeight(1).constraintSize({ minHeight: 38 })
          .backgroundColor('#1F2937')
          .onClick(() => {
            this.testConnection();
          })
      }
      .width('100%')

      if (this.testMsg.length > 0) {
        Text(this.testMsg).fontSize(12)
          .wordBreak(WordBreak.BREAK_ALL)
          .fontColor(this.testMsg.startsWith('✅') ? '#A7F3D0' : '#FBBF24')
          .width('100%')
      }
      TextInput({ placeholder: '用户名', text: this.username })
        .onChange((v: string) => {
          this.username = v;
        })
        .backgroundColor('#111827').fontColor('#E5E7EB').constraintSize({ minHeight: 44 })
      TextInput({ placeholder: '密码' })
        .type(InputType.Password)
        .onChange((v: string) => {
          this.password = v;
        })
        .backgroundColor('#111827').fontColor('#E5E7EB').constraintSize({ minHeight: 44 })

      if (this.errMsg.length > 0) {
        Text(this.errMsg).fontSize(12).fontColor('#F87171').width('100%')
          .wordBreak(WordBreak.BREAK_ALL)
      }

      Button('登录').width('100%').constraintSize({ minHeight: 44 })
        .backgroundColor('#7C3AED').fontColor('#FFFFFF')
        .onClick(() => {
          this.doLogin();
        })
      Button('注册（仅服务端允许时）').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor('#1F2937')
        .onClick(() => {
          this.doRegister();
        })
      // 无需登录/无需网络：直接打开渲染自检页（截图发我即可定位构件级问题）
      Text('渲染自检（排查渲染问题用）')
        .fontSize(12).fontColor('#93C5FD').margin({ top: 8 })
        .onClick(() => {
          this.showSelfCheck = true;
        })
    }
    .padding(24).width('100%').height('100%').justifyContent(FlexAlign.Center)
    .id('xbot-login')
  }

  @Builder
  ChatView() {
    Column() {
      // 顶栏
      Row() {
        Text('☰').fontSize(20).fontColor('#E5E7EB').padding(10).onClick(() => {
          this.showDrawer = true;
        })
        Column() {
          Text(this.currentChat.length > 0 ? this.labelOf(this.currentChat) : 'xbot')
            .fontSize(15).fontColor('#E5E7EB').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.busy ? '运行中…' : '空闲')
            .fontSize(11).fontColor(this.busy ? '#FBBF24' : '#6B7280')
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        if (this.queue.length > 0) {
          Text(`队列 ${this.queue.length}`)
            .fontSize(12).fontColor('#FBBF24').padding(8)
            .onClick(() => {
              this.showQueue = true;
            })
        }
        Text('⊞').fontSize(20).fontColor('#E5E7EB').padding(10).onClick(() => {
          this.openPlugins();
        })
        Text('⚙').fontSize(20).fontColor('#E5E7EB').padding(10).onClick(() => {
          this.showSettings = true;
        })
      }
      .width('100%').constraintSize({ minHeight: 56 }).padding({ left: 4, right: 4 }).backgroundColor('#111827')
      .id('xbot-header')

      // 加载失败且列表为空 ⇒ 明确提示 + 重试（网络/代理故障时界面必须自解释）
      if (this.rows.length === 0 && this.loadErr.length > 0) {
        Column({ space: 8 }) {
          Text('加载会话失败').fontSize(14).fontColor('#FCA5A5')
          Text(this.loadErr).fontSize(12).fontColor('#9CA3AF')
            .maxLines(4).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text('常见原因：手机到服务端网络不通（代理/防火墙），或服务端地址填错')
            .fontSize(11).fontColor('#6B7280').maxLines(3)
          Button('重试').constraintSize({ minHeight: 38 }).backgroundColor('#7C3AED').onClick(() => {
            this.retryLoad();
          })
        }
        .width('100%').padding(16).alignItems(HorizontalAlign.Start)
        .backgroundColor('#111827').borderRadius(10).margin({ left: 12, right: 12, top: 12 })
      }

      // 消息列表
      List({ scroller: this.listScroller }) {
        if (this.hasMore || this.loadingMore) {
          ListItem() {
            Row() {
              if (this.loadingMore) {
                LoadingProgress().width(16).height(16).color('#8B5CF6')
                Text('加载更早消息…').fontSize(12).fontColor('#9CA3AF').margin({ left: 6 })
              } else {
                Text('↑ 加载更早消息').fontSize(12).fontColor('#93C5FD').onClick(() => {
                  this.loadMore();
                })
              }
            }
            .width('100%').justifyContent(FlexAlign.Center).padding(10)
          }
        }

        // 行窗口：`List` + `ForEach` 会**一次性构建全部行**（每行 ≤16 个迭代块 × Markdown）
        // ⇒ 几十行就是几千个节点（真机"很卡、交互差"的主因之一）。只渲染末尾 rowLimit 行，
        // 更早的按批放开。
        if (hiddenRowCount(this.rows.length, this.rowLimit) > 0) {
          ListItem() {
            Row() {
              Text(`↑ 显示更早的 ${hiddenRowCount(this.rows.length, this.rowLimit)} 条`)
                .fontSize(12).fontColor('#93C5FD')
            }
            .width('100%').justifyContent(FlexAlign.Center).padding(10)
            .onClick(() => {
              this.rowLimit += MAX_ROWS_VISIBLE;
            })
          }
        }
        ForEach(visibleRows(this.rows, this.rowLimit), (row: ChatRow) => {
          ListItem() {
            if (row.role === 'user') {
              this.UserBubble(row)
            } else {
              this.AssistantBlock(row)
            }
          }
        }, (row: ChatRow) => `${row.id}#${row.rev}`)

        if (this.busy) {
          ListItem() {
            Row({ space: 8 }) {
              LoadingProgress().width(16).height(16).color('#8B5CF6')
              Text('思考中…').fontSize(13).fontColor('#9CA3AF')
            }.padding({ left: 14, top: 8, bottom: 8 })
          }
        }
      }
      .layoutWeight(1).width('100%').edgeEffect(EdgeEffect.Spring).padding({ left: 8, right: 8 })
      // 跟踪"用户是否停在底部"：end 是最后一个可见项的下标，等于末项下标即在底部。
      // 项数 = [可选"加载更早"] + rows + [可选 busy 指示器]，故用 listItemCount() 显式算。
      .onScrollIndex((start: number, end: number) => {
        this.atBottom = end >= listItemCount(this.hasMore, this.loadingMore, this.rows.length, this.busy) - 1;
      })
      .id('xbot-list')

      // 输入区
      Row({ space: 8 }) {
        TextInput({ placeholder: '给 xbot 发消息…', text: this.draft })
          .onChange((v: string) => {
            this.draft = v;
          })
          .layoutWeight(1).constraintSize({ minHeight: 42 }).backgroundColor('#111827').fontColor('#E5E7EB')
          .onSubmit(() => {
            this.sendDraft();
          })
        Button(this.busy ? '停止' : '发送')
          .constraintSize({ minHeight: 42 })
          .backgroundColor(this.busy ? '#7F1D1D' : '#7C3AED')
          .onClick(() => {
            if (this.busy) {
              this.store?.cancel();
            } else {
              this.sendDraft();
            }
          })
      }
      .width('100%').padding(8).backgroundColor('#0F172A')
      .id('xbot-composer')
    }
    .width('100%').height('100%')
  }

  @Builder
  UserBubble(row: ChatRow) {
    Row() {
      Blank()
      Text(row.content)
        .wordBreak(WordBreak.BREAK_ALL)
        .fontSize(15).fontColor('#F9FAFB').padding(12)
        .constraintSize({ maxWidth: '78%' })
        .backgroundColor('#6D28D9').borderRadius(12)
        .copyOption(CopyOptions.LocalDevice)
    }
    .width('100%').padding({ top: 6, bottom: 6 })
  }

  @Builder
  AssistantBlock(row: ChatRow) {
    Column({ space: 6 }) {
      if (row.content.length > 0) {
        MarkdownView({ text: row.content, onImage: (src: string) => {
          this.openImage(src);
        } })
      }
      // 服务端折叠视图：更早的展示区域需按需取回（与 Web 端「⌃ 更早的 N 个区域」同源）
      if (row.regionsBefore > 0) {
        Row({ space: 6 }) {
          Text(`⌃ 更早的 ${row.regionsBefore} 个区域`).fontSize(11).fontColor('#FBBF24')
          Text('（点击加载）').fontSize(11).fontColor('#6B7280')
        }
        .width('100%')
        .padding({ top: 4, bottom: 4 })
        .onClick(() => {
          this.loadMoreRegions(row);
        })
      }
      if (this.hiddenIterCount(row) > 0) {
        Row({ space: 6 }) {
          Text(`↑ 已折叠更早的 ${this.hiddenIterCount(row)} 个迭代`)
            .fontSize(11).fontColor('#93C5FD')
          Text('（点击展开全部）').fontSize(11).fontColor('#6B7280')
        }
        .width('100%')
        .padding({ top: 4, bottom: 4 })
        .onClick(() => {
          this.expandedTurn = row.id;
        })
      }
      ForEach(this.itersFor(row), (it: HistoryIteration) => {
        this.IterationBlock(row, it)
      }, (it: HistoryIteration) => `${row.id}#${row.rev}-${it.iteration}`)
    }
    .width('100%').alignItems(HorizontalAlign.Start).padding({ top: 6, bottom: 6 })
  }

  /** 一个迭代 = 思考(T) / 正文(O) / 工具(C)。 */
  @Builder
  IterationBlock(row: ChatRow, it: HistoryIteration) {
    Column({ space: 6 }) {
      Row() {
        Text(`迭代 ${it.iteration}`).fontSize(11).fontColor('#6B7280').layoutWeight(1)
        if (displayReasoning(it).length > 0 && this.showReasoning) {
          Text(this.openReasonKey === `${row.id}-${it.iteration}` ? '收起思考' : '展开思考')
            .fontSize(11).fontColor('#93C5FD')
            .onClick(() => {
              const key: string = `${row.id}-${it.iteration}`;
              this.openReasonKey = this.openReasonKey === key ? '' : key;
            })
        }
      }
      .width('100%')

      if (this.showReasoning && displayReasoning(it).length > 0
        && this.openReasonKey === `${row.id}-${it.iteration}`) {
        Text(displayReasoning(it))
          .wordBreak(WordBreak.BREAK_ALL)
          .fontSize(13).fontColor('#9CA3AF').padding(8).width('100%')
          .backgroundColor('#0F172A').borderRadius(8)
          .copyOption(CopyOptions.LocalDevice)
      }

      if (displayContent(it).length > 0) {
        MarkdownView({ text: displayContent(it), onImage: (src: string) => {
          this.openImage(src);
        } })
      }

      if (it.tools !== undefined && it.tools.length > 0) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(it.tools, (t: ToolProgress) => {
            this.ToolPill(row, it, t)
          }, (t: ToolProgress, ti: number) => `${this.toolKey(row.turnID, it.iteration, t.name)}#${t.call_id !== undefined ? t.call_id : ''}#${ti}`)
        }
        .width('100%')
      }

      // 工具详情（点击 pill 展开）
      if (this.openToolKey.startsWith(`${row.turnID}:${it.iteration}:`) && it.tools !== undefined) {
        ForEach(it.tools, (t: ToolProgress) => {
          if (this.openToolKey === this.toolKey(row.turnID, it.iteration, t.name)) {
            this.ToolDetail(t)
          }
        }, (t: ToolProgress, ti: number) => `d-${this.toolKey(row.turnID, it.iteration, t.name)}#${ti}`)
      }
    }
    .width('100%').alignItems(HorizontalAlign.Start).padding({ top: 4, bottom: 4 })
  }

  @Builder
  ToolPill(row: ChatRow, it: HistoryIteration, t: ToolProgress) {
    Row({ space: 4 }) {
      Text(this.toolIcon(t)).fontSize(11)
        .fontColor(this.toolColor(t))
      Text(t.label !== undefined && t.label.length > 0 ? t.label : t.name)
        .fontSize(12)
        .fontColor(this.toolColor(t))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .constraintSize({ maxWidth: 220 })
    }
    .padding({ left: 8, right: 8, top: 5, bottom: 5 })
    .margin(3)
    .backgroundColor('#111827')
    .borderRadius(6)
    .border({ width: 1, color: this.openToolKey === this.toolKey(row.turnID, it.iteration, t.name) ? '#7C3AED' : '#1F2937' })
    .onClick(() => {
      this.toggleTool(row, it, t);
    })
  }

  @Builder
  ToolDetail(t: ToolProgress) {
    Column({ space: 4 }) {
      if (t.summary !== undefined && t.summary.length > 0) {
        Text(t.summary).fontSize(12).fontColor('#D1D5DB').width('100%')
          .wordBreak(WordBreak.BREAK_ALL)
      }
      if (t.args !== undefined && t.args.length > 0) {
        Text('参数').fontSize(10).fontColor('#6B7280')
        Text(t.args)
          .wordBreak(WordBreak.BREAK_ALL)
          .fontSize(12).fontColor('#E5E7EB').fontFamily('monospace')
          .width('100%').padding(6).backgroundColor('#111827').borderRadius(6)
          .copyOption(CopyOptions.LocalDevice)
      }
      if (t.detail !== undefined && t.detail.length > 0) {
        Text('输出').fontSize(10).fontColor('#6B7280')
        Text(t.detail)
          .wordBreak(WordBreak.BREAK_ALL)
          .fontSize(12).fontColor('#E5E7EB').fontFamily('monospace')
          .width('100%').padding(6).backgroundColor('#111827').borderRadius(6)
          .copyOption(CopyOptions.LocalDevice)
      }
      if ((t.summary === undefined || t.summary.length === 0)
        && (t.args === undefined || t.args.length === 0)
        && (t.detail === undefined || t.detail.length === 0)) {
        Text('（详情加载中或该工具无详情）').fontSize(11).fontColor('#6B7280')
      }
      if (t.elapsed_ms !== undefined) {
        Text(`耗时 ${t.elapsed_ms} ms`).fontSize(10).fontColor('#6B7280')
      }
    }
    .width('100%').padding(8).backgroundColor('#0F172A').borderRadius(8)
    .alignItems(HorizontalAlign.Start)
  }

  /**
   * **一段可长按复制的完整取证文本** = 渲染规模 + 各页实测几何。
   *
   * 为什么合成一段：取证的最低摩擦路径不是截图，而是「长按 → 复制 → 粘贴到对话里」
   * —— 截图受限于截图工具/传输，纯文本不会丢信息、也不用修代理。
   */
  private auditText(): string {
    const geo: string = this.geoText.length > 0
      ? this.geoText
      : '（几何未采集：请点上面的「采集各页版面几何」按钮）';
    return `===== xbot-harmony 自检取证（长按可复制）=====\n`
      + `[渲染规模]\n${this.sessionStats()}\n\n[各页几何 x/y/w/h]\n${geo}`;
  }

  /**
   * 当前会话的**渲染规模统计**（设备侧实测）。
   *
   * 与 tools/tests/live_dump.test.ts（服务端侧测量）互为印证：一张自检页截图即可带回
   * "这台手机上到底要渲染多少块"——用于确认"卡到没法用"是否已由迭代上限解决。
   */
  private sessionStats(): string {
    const rows: ChatRow[] = this.rows;
    let iterTotal: number = 0;
    let maxIter: number = 0;
    let rendered: number = 0;
    let foldedRows: number = 0;
    for (let i = 0; i < rows.length; i++) {
      const r: ChatRow = rows[i];
      const n: number = r.iterations.length;
      iterTotal += n;
      if (n > maxIter) {
        maxIter = n;
      }
      rendered += Math.min(n, MAX_ITER_VISIBLE);
      if (r.regionsBefore > 0) {
        foldedRows++;
      }
    }
    return `rows=${rows.length}\n迭代总数=${iterTotal}\n单行最多迭代=${maxIter}\n`
      + `实际渲染块数=${rendered}（每行≤${MAX_ITER_VISIBLE}）\n带更早折叠区域的行=${foldedRows}\n`
      + `会话=${this.currentChat}\nbusy=${this.busy}\n`
      + mdCacheText() + '\n' + streamStatsText();
  }

  /** 加载该 turn 更早的展示区域（服务端折叠视图按需取回）。 */
  private async loadMoreRegions(row: ChatRow): Promise<void> {
    const store: ChatStore | null = this.store;
    if (store === null) {
      return;
    }
    try {
      await store.loadEarlierRegions(row);
    } catch (e) {
      this.toast(`加载更早区域失败: ${errText(e as Object)}`);
    }
  }

  /** 该 turn 实际要渲染的迭代（默认只给最近 MAX_ITER_VISIBLE 个）。 */
  private itersFor(row: ChatRow): HistoryIteration[] {
    const all: HistoryIteration[] = row.iterations;
    if (this.expandedTurn === row.id || all.length <= MAX_ITER_VISIBLE) {
      return all;
    }
    return all.slice(all.length - MAX_ITER_VISIBLE);
  }

  /** 被折叠掉的迭代数量（0 表示全展示）。 */
  private hiddenIterCount(row: ChatRow): number {
    if (this.expandedTurn === row.id) {
      return 0;
    }
    return row.iterations.length > MAX_ITER_VISIBLE ? row.iterations.length - MAX_ITER_VISIBLE : 0;
  }

  private toolIcon(t: ToolProgress): string {
    if (t.status === 'running') {
      return '●';
    }
    if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
      return '✗';
    }
    return '✓';
  }

  private toolColor(t: ToolProgress): string {
    if (t.status === 'running') {
      return '#FBBF24';
    }
    if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
      return '#F87171';
    }
    return '#A7F3D0';
  }

  // ── 弹层：会话抽屉 ────────────────────────────────────────────────────────

  @Builder
  DrawerSheet() {
    Column() {
      Row() {
        Text('会话').fontSize(17).fontWeight(FontWeight.Bold).fontColor('#E5E7EB').layoutWeight(1)
        Text('＋ 新建').fontSize(13).fontColor('#93C5FD').padding(8).onClick(() => {
          this.newSession();
        })
        Text('✕').fontSize(16).fontColor('#9CA3AF').padding(8).onClick(() => {
          this.showDrawer = false;
          this.renamingId = '';
        })
      }
      .width('100%').padding(8)

      List() {
        ForEach(this.sessions, (s: SessionItem) => {
          ListItem() {
            Column({ space: 4 }) {
              if (this.renamingId === s.chat_id) {
                Row({ space: 6 }) {
                  TextInput({ text: this.renameText })
                    .onChange((v: string) => {
                      this.renameText = v;
                    })
                    .layoutWeight(1).constraintSize({ minHeight: 36 }).backgroundColor('#111827').fontColor('#E5E7EB')
                  Text('保存').fontSize(13).fontColor('#93C5FD').padding(6).onClick(() => {
                    const store: ChatStore | null = this.store;
                    if (store !== null && s.chat_id !== undefined) {
                      store.renameSession(s.chat_id, this.renameText);
                    }
                    this.renamingId = '';
                  })
                  Text('取消').fontSize(13).fontColor('#9CA3AF').padding(6).onClick(() => {
                    this.renamingId = '';
                  })
                }.width('100%')
              } else {
                Row() {
                  Column() {
                    Text(s.label !== undefined && s.label.length > 0 ? s.label : s.chat_id)
                      .fontSize(14)
                      .fontColor(s.chat_id === this.currentChat ? '#C4B5FD' : '#E5E7EB')
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    Row({ space: 6 }) {
                      Text(channelLabel(s.channel !== undefined ? s.channel : 'web'))
                        .fontSize(9).fontColor('#C4B5FD')
                        .padding({ left: 4, right: 4, top: 1, bottom: 1 })
                        .backgroundColor('#1F2937').borderRadius(4)
                      Text(s.chat_id)
                        .fontSize(10).fontColor('#6B7280')
                        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                        .layoutWeight(1)
                    }.width('100%')
                  }
                  .layoutWeight(1).alignItems(HorizontalAlign.Start)

                  Text('改名').fontSize(12).fontColor('#93C5FD').padding(6).onClick(() => {
                    this.renamingId = s.chat_id !== undefined ? s.chat_id : '';
                    this.renameText = s.label !== undefined ? s.label : '';
                  })
                  Text('删除').fontSize(12).fontColor('#F87171').padding(6).onClick(() => {
                    const store: ChatStore | null = this.store;
                    if (store !== null && s.chat_id !== undefined) {
                      store.deleteSession(s.chat_id);
                    }
                  })
                }.width('100%')
              }
            }
            .width('100%').padding(10)
            .backgroundColor(s.chat_id === this.currentChat ? '#1F2937' : '#0F172A')
            .borderRadius(8)
            .onClick(() => {
              if (s.chat_id !== undefined && this.renamingId.length === 0) {
                this.switchSession(s.chat_id);
              }
            })
          }
        }, (s: SessionItem) => `${s.chat_id}#${s.label}#${s.running}`)
      }
      .layoutWeight(1).width('100%')

      Button('退出登录').width('100%').constraintSize({ minHeight: 40 }).backgroundColor('#1F2937').margin({ top: 8 }).onClick(() => {
        this.doLogout();
      })
    }
    .width('82%').height('100%')
    .padding(12)
    .backgroundColor('#0B0F19')
    .border({ width: { right: 1 }, color: '#1F2937' })
    .position({ x: 0, y: 0 })
  }

  // ── 弹层：设置 ────────────────────────────────────────────────────────────

  @Builder
  SettingsSheet() {
    Column({ space: 10 }) {
      Row() {
        Text('设置').fontSize(17).fontWeight(FontWeight.Bold).fontColor('#E5E7EB').layoutWeight(1)
        Text('✕').fontSize(16).fontColor('#9CA3AF').padding(8).onClick(() => {
          this.showSettings = false;
        })
      }.width('100%')

      Text('服务端').fontSize(12).fontColor('#9CA3AF').width('100%')
      TextInput({ text: this.serverUrl })
        .onChange((v: string) => {
          this.serverUrl = v;
        })
        .constraintSize({ minHeight: 42 }).backgroundColor('#111827').fontColor('#E5E7EB')

      Text('用户名').fontSize(12).fontColor('#9CA3AF').width('100%')
      TextInput({ text: this.username })
        .onChange((v: string) => {
          this.username = v;
        })
        .constraintSize({ minHeight: 42 }).backgroundColor('#111827').fontColor('#E5E7EB')

      Row() {
        Text('显示思考过程').fontSize(14).fontColor('#E5E7EB').layoutWeight(1)
        Toggle({ type: ToggleType.Switch, isOn: this.showReasoning })
          .onChange((on: boolean) => {
            this.showReasoning = on;
          })
      }.width('100%')

      Row() {
        Text('当前会话 ID').fontSize(12).fontColor('#9CA3AF').layoutWeight(1)
        Text(this.currentChat.length > 0 ? this.currentChat : '-')
          .fontSize(11).fontColor('#6B7280').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: 180 })
      }.width('100%')

      Button('保存服务端/用户名').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor('#7C3AED').fontColor('#FFFFFF')
        .onClick(async () => {
        const store: ChatStore | null = this.store;
        this.takeServerUrl();
        await this.config.save(this.serverUrl, this.username,
          store !== null ? store.http.exportSessionCookie() : '');
        this.toast('已保存（换服务端请退出重登）');
      })
      Button(this.auditing ? '走查中…' : '① 走查并上传所有页面截图（推荐）').width('100%').constraintSize({ minHeight: 44 })
        .backgroundColor('#7C3AED')
        .onClick(() => {
          this.showSettings = false;
          this.runUiAudit();
        })
      if (this.auditLog.length > 0) {
        Text(this.auditLog).fontSize(10).fontColor('#9CA3AF').width('100%').maxLines(4)
      }
      Button('渲染自检（排查渲染问题用）').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor('#1F2937')
        .onClick(() => {
          this.showSettings = false;
          this.showSelfCheck = true;
        })
      Button('打开完整 Web UI（插件/GenUI/终端）').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor('#1F2937')
        .onClick(() => {
          this.showSettings = false;
          this.panelUrl = this.serverUrl;
        })
      Button('退出登录').width('100%').constraintSize({ minHeight: 40 })
        .backgroundColor('#7F1D1D')
        .onClick(() => {
          this.showSettings = false;
          this.doLogout();
        })
    }
    .width('92%').padding(16).backgroundColor('#0B0F19')
    .borderRadius(12).border({ width: 1, color: '#1F2937' })
  }

  // ── 弹层：队列 ────────────────────────────────────────────────────────────

  /**
   * 渲染自检：把每类渲染构件分块画出来（带序号标签）。
   * 用途：截一张图即可定位"到底哪类构件渲染错乱"，不必逐页猜。
   *
   * 注意：ArkUI 的 @Builder **不能接受函数/回调参数**（需 @BuilderParam 组件才行），
   * 所以这里把每格内联展开，不做回调包装。
   */
  @Builder
  SelfCheckSheet() {
    Column() {
      Row() {
        Text('渲染自检').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#E5E7EB').layoutWeight(1)
        Text('✕').fontSize(16).fontColor('#9CA3AF').padding(8).onClick(() => {
          this.showSelfCheck = false;
        })
      }.width('100%')

      Button(this.geoRunning ? '采集中…' : '采集各页版面几何（数值，无需网络）')
        .width('100%').constraintSize({ minHeight: 40 }).backgroundColor('#0E7490')
        .onClick(() => {
          this.collectAllGeometry();
        })
      Text('下方这一段可【长按复制】后直接粘贴给对方 —— 不必截图（零网络也能取证）')
        .fontSize(11).fontColor('#FCD34D').width('100%')
      Text(this.auditText())
        .fontSize(11).fontColor('#A7F3D0').fontFamily('monospace')
        .width('100%').padding(8)
        .backgroundColor('#111827').borderRadius(8)
        .copyOption(CopyOptions.LocalDevice)

      Scroll() {
        Column({ space: 10 }) {
          Column({ space: 6 }) {
            Text('A 纯文本（自动换行）').fontSize(12).fontColor('#9CA3AF').width('100%')
            MarkdownView({ text: '这是一段用于自检的普通中文文本，应当自动换行并且左右不溢出。' })
          }.width('100%').padding(8).backgroundColor('#0F172A').borderRadius(8)
          .border({ width: 1, color: '#1F2937' })

          Column({ space: 6 }) {
            Text('B 行内样式（粗/斜/删除/行内码/链接）').fontSize(12).fontColor('#9CA3AF').width('100%')
            MarkdownView({ text: '这里有 **粗体**、*斜体*、~~删除线~~、`inlineCode()` 与 [一个链接](https://example.com)。' })
          }.width('100%').padding(8).backgroundColor('#0F172A').borderRadius(8)
          .border({ width: 1, color: '#1F2937' })

          Column({ space: 6 }) {
            Text('C 标题 + 列表').fontSize(12).fontColor('#9CA3AF').width('100%')
            MarkdownView({ text: '## 二级标题\n- 列表项一\n- 列表项二\n\n1. 有序一\n2. 有序二' })
          }.width('100%').padding(8).backgroundColor('#0F172A').borderRadius(8)
          .border({ width: 1, color: '#1F2937' })

          Column({ space: 6 }) {
            Text('D 代码块（含超长行）').fontSize(12).fontColor('#9CA3AF').width('100%')
            MarkdownView({ text: '```ts\nconst veryLongVariableName: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n```' })
          }.width('100%').padding(8).backgroundColor('#0F172A').borderRadius(8)
          .border({ width: 1, color: '#1F2937' })

          Column({ space: 6 }) {
            Text('E 表格').fontSize(12).fontColor('#9CA3AF').width('100%')
            MarkdownView({ text: '| 列一 | 列二 |\n| --- | --- |\n| 值一 | 值二 |\n| 更长的值 | 另一个值 |' })
          }.width('100%').padding(8).backgroundColor('#0F172A').borderRadius(8)
          .border({ width: 1, color: '#1F2937' })

          Column({ space: 6 }) {
            Text('F 工具 pill 行（Flex 换行）').fontSize(12).fontColor('#9CA3AF').width('100%')
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(['✓ Read', '✓ Shell', '● Grep', '✓ Edit', '✗ Fetch'], (t: string) => {
                Text(t).fontSize(12).fontColor('#A7F3D0')
                  .padding({ left: 8, right: 8, top: 5, bottom: 5 })
                  .margin(3).backgroundColor('#111827').borderRadius(6)
                  .border({ width: 1, color: '#1F2937' })
              }, (t: string) => t)
            }.width('100%')
          }.width('100%').padding(8).backgroundColor('#0F172A').borderRadius(8)
          .border({ width: 1, color: '#1F2937' })

          Column({ space: 6 }) {
            Text('G 长 URL（不可断词）').fontSize(12).fontColor('#9CA3AF').width('100%')
            Text('https://xbot.pivotlang.tech/api/files/download?key=uploads%2F4%2Faaef9711-1349-420d-97ea-94e70e2401e7.jpg&inline=1')
              .fontSize(12).fontColor('#93C5FD').width('100%')
          }.width('100%').padding(8).backgroundColor('#0F172A').borderRadius(8)
          .border({ width: 1, color: '#1F2937' })

          Column({ space: 6 }) {
            Text('H 顶栏内联布局').fontSize(12).fontColor('#9CA3AF').width('100%')
            Row() {
              Text('☰').fontSize(20).fontColor('#E5E7EB').padding(10)
              Text('标题文本').fontSize(15).fontColor('#E5E7EB').layoutWeight(1)
              Text('⊞').fontSize(20).fontColor('#E5E7EB').padding(10)
              Text('⚙').fontSize(20).fontColor('#E5E7EB').padding(10)
            }.width('100%').backgroundColor('#111827')
          }.width('100%').padding(8).backgroundColor('#0F172A').borderRadius(8)
          .border({ width: 1, color: '#1F2937' })
        }
        .width('100%')
        .padding(10)
      }
      .layoutWeight(1)
      .width('100%')
    }
    .width('94%').height('86%')
    .padding(12)
    .backgroundColor('#0B0F19')
    .borderRadius(12)
    .border({ width: 1, color: '#374151' })
  }

  @Builder
  QueueSheet() {
    Column({ space: 8 }) {
      Row() {
        Text(`待发队列 (${this.queue.length})`).fontSize(16).fontWeight(FontWeight.Bold)
          .fontColor('#E5E7EB').layoutWeight(1)
        Text('✕').fontSize(16).fontColor('#9CA3AF').padding(8).onClick(() => {
          this.showQueue = false;
        })
      }.width('100%')

      List() {
        ForEach(this.queue, (q: QueueItem) => {
          ListItem() {
            Row({ space: 6 }) {
              Text(q.content !== undefined && q.content.length > 0
                ? q.content
                : (q.text !== undefined ? q.text : ''))
                .fontSize(13).fontColor('#E5E7EB').layoutWeight(1).maxLines(3)
                .wordBreak(WordBreak.BREAK_ALL)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text('↑').fontSize(14).fontColor('#93C5FD').padding(6).onClick(() => {
                const id: string = q.msg_id !== undefined ? q.msg_id : (q.id !== undefined ? q.id : '');
                this.store?.moveQueued(id, -1);
              })
              Text('↓').fontSize(14).fontColor('#93C5FD').padding(6).onClick(() => {
                const id: string = q.msg_id !== undefined ? q.msg_id : (q.id !== undefined ? q.id : '');
                this.store?.moveQueued(id, 1);
              })
              Text('✕').fontSize(14).fontColor('#F87171').padding(6).onClick(() => {
                const id: string = q.msg_id !== undefined ? q.msg_id : (q.id !== undefined ? q.id : '');
                this.store?.cancelQueued(id);
              })
            }.width('100%').padding(8).backgroundColor('#0F172A').borderRadius(8)
          }
        }, (q: QueueItem) => `${q.msg_id}#${q.content}#${q.text}`)
      }
      .height(300).width('100%')
    }
    .width('92%').padding(16).backgroundColor('#0B0F19')
    .borderRadius(12).border({ width: 1, color: '#1F2937' })
  }

  // ── 弹层：插件面板 ────────────────────────────────────────────────────────

  @Builder
  PluginsSheet() {
    Column({ space: 8 }) {
      Row() {
        Text('能力面板').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#E5E7EB').layoutWeight(1)
        Text('✕').fontSize(16).fontColor('#9CA3AF').padding(8).onClick(() => {
          this.showPlugins = false;
        })
      }.width('100%')

      Text('原生渲染聊天主链路；下列能力由 ArkWeb 承载（与 Web 版同源、能力一致）：')
        .fontSize(11).fontColor('#9CA3AF').width('100%')

      List() {
        // 完整 Web UI（插件 / GenUI / 终端 / 编辑器都在里面）
        ListItem() {
          Row() {
            Text('🌐  完整 Web UI').fontSize(14).fontColor('#E5E7EB').layoutWeight(1)
            Text('打开').fontSize(12).fontColor('#93C5FD')
          }
          .width('100%').padding(12).backgroundColor('#111827').borderRadius(8)
          .onClick(() => {
            this.showPlugins = false;
            this.panelUrl = this.serverUrl;
          })
        }
        ForEach(this.plugins, (p: PluginPanelInfo) => {
          ListItem() {
            Row() {
              Column() {
                Text(p.name).fontSize(14).fontColor('#E5E7EB')
                Text(p.url).fontSize(10).fontColor('#6B7280').maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              Text('打开').fontSize(12).fontColor('#93C5FD')
            }
            .width('100%').padding(12).backgroundColor('#111827').borderRadius(8)
            .onClick(() => {
              this.showPlugins = false;
              this.panelUrl = p.url;
            })
          }
        }, (p: PluginPanelInfo) => `${p.id}#${p.url}`)
      }
      .height(320).width('100%')
    }
    .width('92%').padding(16).backgroundColor('#0B0F19')
    .borderRadius(12).border({ width: 1, color: '#1F2937' })
  }

  // ── 弹层：AskUser ────────────────────────────────────────────────────────

  @Builder
  AskUserSheet() {
    Column({ space: 10 }) {
      Text('xbot 需要你确认').fontSize(15).fontWeight(FontWeight.Bold).fontColor('#FDE68A').width('100%')
      List() {
        ForEach(this.askUser !== null && this.askUser.questions !== undefined ? this.askUser.questions : [],
          (q: AskQuestion, qi: number) => {
            ListItem() {
              Column({ space: 6 }) {
                if (q.header !== undefined && q.header.length > 0) {
                  Text(q.header).fontSize(12).fontColor('#9CA3AF').width('100%')
                }
                Text(q.question !== undefined ? q.question : '').fontSize(14).fontColor('#E5E7EB').width('100%')

                ForEach(q.options !== undefined ? q.options : [], (opt: AskOption, oi: number) => {
                  Row() {
                    Text(this.isAskSelected(q.id !== undefined ? q.id : `q${qi}`,
                      opt.label !== undefined ? opt.label : '') ? '◉' : '○')
                      .fontSize(14).fontColor('#A78BFA')
                    Column() {
                      Text(opt.label !== undefined ? opt.label : '').fontSize(13).fontColor('#E5E7EB')
                      if (opt.description !== undefined && opt.description.length > 0) {
                        Text(opt.description).fontSize(11).fontColor('#6B7280')
                      }
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start).margin({ left: 6 })
                  }
                  .width('100%').padding(8).backgroundColor('#0F172A')
                  .borderRadius(6)
                  .onClick(() => {
                    this.toggleAskOption(q.id !== undefined ? q.id : `q${qi}`,
                      opt.label !== undefined ? opt.label : '',
                      q.multi_select === true);
                  })
                }, (opt: AskOption, oi: number) => `o-${qi}-${oi}`)

                if (q.allow_other === true) {
                  TextInput({ placeholder: '其他（自己填）' })
                    .onChange((v: string) => {
                      const next: AskSelection[] = [];
                      for (let i = 0; i < this.askSelections.length; i++) {
                        const s: AskSelection = this.askSelections[i];
                        const copy: AskSelection = new AskSelection();
                        copy.qid = s.qid;
                        copy.labels = s.labels;
                        copy.other = s.qid === (q.id !== undefined ? q.id : `q${qi}`) ? v : s.other;
                        next.push(copy);
                      }
                      this.askSelections = next;
                    })
                    .constraintSize({ minHeight: 38 }).backgroundColor('#111827').fontColor('#E5E7EB')
                }
              }.width('100%').padding(8)
            }
          }, (q: AskQuestion, qi: number) => q.id !== undefined ? q.id : `q${qi}`)
      }
      .constraintSize({ maxHeight: 420 }).width('100%')

      Row({ space: 8 }) {
        Button('取消').layoutWeight(1).constraintSize({ minHeight: 42 }).backgroundColor('#1F2937').onClick(() => {
          this.submitAsk(true);
        })
        Button(this.askBusy ? '提交中…' : '提交').layoutWeight(1).constraintSize({ minHeight: 42 })
          .backgroundColor('#7C3AED').fontColor('#FFFFFF')
          .onClick(() => {
            this.submitAsk(false);
          })
      }.width('100%')
    }
    .width('94%').padding(16).backgroundColor('#111827')
    .borderRadius(12).border({ width: 1, color: '#F59E0B' })
  }

  // ── 弹层：图片查看 ────────────────────────────────────────────────────────

  @Builder
  ImageViewer() {
    Column() {
      Row() {
        Text('图片').fontSize(15).fontColor('#E5E7EB').layoutWeight(1)
        Text('✕').fontSize(16).fontColor('#9CA3AF').padding(10).onClick(() => {
          this.imagePixel = null;
          this.imageBusy = false;
        })
      }.width('100%')

      if (this.imageBusy) {
        Column() {
          LoadingProgress().width(32).height(32).color('#8B5CF6')
          Text('加载图片…').fontSize(12).fontColor('#9CA3AF').margin({ top: 8 })
        }.layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.imagePixel !== null) {
        Image(this.imagePixel)
          .objectFit(ImageFit.Contain)
          .layoutWeight(1)
          .width('100%')
      }
    }
    .width('94%').height('80%').padding(12)
    .backgroundColor('#0B0F19').borderRadius(12).border({ width: 1, color: '#1F2937' })
  }
}
