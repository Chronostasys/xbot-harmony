import { common } from '@kit.AbilityKit';
import { promptAction } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { AppConfig, ConfigStore } from '../core/config';
import { ChatStore } from '../core/store';
import { ChatRow, HistoryIteration, SessionItem, ToolProgress } from '../core/types';
import { WebSurface } from '../components/WebSurface';

/**
 * Index —— xbot 原生壳（M1）。
 *
 * 形态（用户要求"web 的完整能力"）：**原生渲染聊天主链路**（会话/消息/迭代/工具/输入），
 * 需要 web 才能表达的部分（插件 UI、GenUI `display_html`、终端、代码编辑器）经
 * `WebSurface`（ArkWeb）承载 —— 见 docs/ARCHITECTURE.md。
 */
@Entry
@Component
struct Index {
  @State booted: boolean = false;
  @State loggedIn: boolean = false;
  @State busy: boolean = false;
  @State serverUrl: string = 'http://';
  @State username: string = '';
  @State password: string = '';
  @State errMsg: string = '';
  @State sessions: SessionItem[] = [];
  @State rows: ChatRow[] = [];
  @State draft: string = '';
  @State showDrawer: boolean = false;
  @State panelUrl: string = '';
  @State currentChat: string = '';

  private store: ChatStore | null = null;
  private config: ConfigStore = new ConfigStore();
  private listScroller: Scroller = new Scroller();

  aboutToAppear(): void {
    // ArkUI 生命周期是同步的：异步引导另起（首帧渲染不被阻塞）
    this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    const ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
    const saved: AppConfig = await this.config.init(ctx);
    if (saved.serverUrl.length > 0) {
      this.serverUrl = saved.serverUrl;
    }
    this.username = saved.username;
    if (saved.serverUrl.length > 0 && saved.sessionCookie.length > 0) {
      // 冷启动恢复登录态（cookie 由服务端签发的 30 天会话，见 web_auth.go）
      const store: ChatStore = this.makeStore(saved.serverUrl);
      store.http.importSessionCookie(saved.sessionCookie);
      try {
        await store.loadSessions();
        this.attach(store);
        this.loggedIn = true;
      } catch (e) {
        this.loggedIn = false;
      }
    }
    this.booted = true;
  }

  aboutToDisappear(): void {
    if (this.store !== null) {
      this.store.sse.close();
    }
  }

  private makeStore(url: string): ChatStore {
    const store: ChatStore = new ChatStore(url);
    store.onUpdate = () => {
      this.syncFrom(store);
    };
    return store;
  }

  private attach(store: ChatStore): void {
    this.store = store;
    this.syncFrom(store);
  }

  private syncFrom(store: ChatStore): void {
    this.sessions = store.sessions.slice();
    this.rows = store.rows.slice();
    this.busy = store.busy;
    this.currentChat = store.currentChatId;
    // 新内容进来自动贴底
    setTimeout(() => {
      try {
        this.listScroller.scrollEdge(Edge.Bottom);
      } catch (e) {
        // 列表尚未布局（首帧）——忽略
      }
    }, 30);
  }

  private toast(msg: string): void {
    promptAction.showToast({ message: msg, duration: 2500 });
  }

  private async doLogin(): Promise<void> {
    this.errMsg = '';
    try {
      const store: ChatStore = this.makeStore(this.serverUrl);
      await store.http.login(this.username, this.password);
      await store.loadSessions();
      this.attach(store);
      await this.config.save(this.serverUrl, this.username, store.http.exportSessionCookie());
      this.loggedIn = true;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.errMsg = err.message;
    }
  }

  private async doRegister(): Promise<void> {
    this.errMsg = '';
    try {
      const store: ChatStore = this.makeStore(this.serverUrl);
      await store.http.register(this.username, this.password);
      await this.doLogin();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.errMsg = err.message;
    }
  }

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

  build() {
    Stack() {
      if (!this.booted) {
        this.LoadingView();
      } else if (!this.loggedIn) {
        this.LoginView();
      } else {
        this.ChatView();
      }
      if (this.panelUrl.length > 0) {
        // 全能力逃生舱：插件 UI / GenUI / 终端 / 代码编辑器（ArkWeb）
        WebSurface({ url: this.panelUrl, onClose: () => {
          this.panelUrl = '';
        } })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0B0F19');
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
      Text('连接你的 xbot 服务端').fontSize(13).fontColor('#9CA3AF').margin({ bottom: 8 })

      TextInput({ placeholder: 'http://192.168.1.10:16000', text: this.serverUrl })
        .onChange((v: string) => {
          this.serverUrl = v;
        })
        .backgroundColor('#111827')
        .fontColor('#E5E7EB')
        .height(44)

      TextInput({ placeholder: '用户名', text: this.username })
        .onChange((v: string) => {
          this.username = v;
        })
        .backgroundColor('#111827')
        .fontColor('#E5E7EB')
        .height(44)

      TextInput({ placeholder: '密码' })
        .type(InputType.Password)
        .onChange((v: string) => {
          this.password = v;
        })
        .backgroundColor('#111827')
        .fontColor('#E5E7EB')
        .height(44)

      if (this.errMsg.length > 0) {
        Text(this.errMsg).fontSize(12).fontColor('#F87171').width('100%')
      }

      Button('登录').width('100%').height(44).onClick(() => {
        this.doLogin();
      })
      Button('注册（仅服务端允许时）').width('100%').height(40)
        .backgroundColor('#1F2937')
        .onClick(() => {
          this.doRegister();
        })
    }
    .padding(24)
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
  }

  @Builder
  ChatView() {
    Column() {
      // 顶栏
      Row() {
        Text('☰').fontSize(20).fontColor('#E5E7EB').padding(8).onClick(() => {
          this.showDrawer = true;
        })
        Text(this.sessions.length > 0 ? this.labelOf(this.currentChat) : 'xbot')
          .fontSize(16).fontColor('#E5E7EB').layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text('⊞').fontSize(20).fontColor('#E5E7EB').padding(8).onClick(() => {
          // 打开服务端 Web UI（插件面板 / GenUI / 终端 / 编辑器全部能力）
          this.panelUrl = this.serverUrl;
        })
      }
      .width('100%')
      .height(52)
      .padding({ left: 8, right: 8 })
      .backgroundColor('#111827')

      // 消息列表
      List({ scroller: this.listScroller }) {
        ForEach(this.rows, (row: ChatRow) => {
          ListItem() {
            if (row.role === 'user') {
              this.UserBubble(row)
            } else {
              this.AssistantBlock(row)
            }
          }
        }, (row: ChatRow) => row.id)
        if (this.busy) {
          ListItem() {
            Row({ space: 8 }) {
              LoadingProgress().width(16).height(16).color('#8B5CF6')
              Text('思考中…').fontSize(13).fontColor('#9CA3AF')
            }.padding({ left: 14, top: 8, bottom: 8 })
          }
        }
      }
      .layoutWeight(1)
      .width('100%')
      .edgeEffect(EdgeEffect.Spring)
      .padding({ left: 8, right: 8 })

      // 输入区
      Row({ space: 8 }) {
        TextInput({ placeholder: '给 xbot 发消息…', text: this.draft })
          .onChange((v: string) => {
            this.draft = v;
          })
          .layoutWeight(1)
          .height(42)
          .backgroundColor('#111827')
          .fontColor('#E5E7EB')
          .onSubmit(() => {
            this.sendDraft();
          })
        Button(this.busy ? '停止' : '发送')
          .height(42)
          .backgroundColor(this.busy ? '#7F1D1D' : '#7C3AED')
          .onClick(() => {
            if (this.busy) {
              this.store?.cancel();
            } else {
              this.sendDraft();
            }
          })
      }
      .width('100%')
      .padding(8)
      .backgroundColor('#0F172A')
    }
    .width('100%')
    .height('100%')
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

  @Builder
  UserBubble(row: ChatRow) {
    Row() {
      Blank()
      Text(row.content)
        .fontSize(15)
        .fontColor('#F9FAFB')
        .padding(12)
        .constraintSize({ maxWidth: '78%' })
        .backgroundColor('#6D28D9')
        .borderRadius(12)
    }
    .width('100%')
    .padding({ top: 6, bottom: 6 })
  }

  @Builder
  AssistantBlock(row: ChatRow) {
    Column({ space: 6 }) {
      if (row.content.length > 0) {
        Text(row.content)
          .fontSize(15)
          .fontColor('#E5E7EB')
          .width('100%')
          .copyOption(CopyOptions.LocalDevice)
      }
      ForEach(row.iterations, (it: HistoryIteration) => {
        this.IterationBlock(it)
      }, (it: HistoryIteration) => `${row.id}-${it.iteration}`)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ top: 6, bottom: 6 })
  }

  /** 一个迭代 = 思考(T) / 正文(O) / 工具(C) —— 与 web 的渲染语义一致。 */
  @Builder
  IterationBlock(it: HistoryIteration) {
    Column({ space: 6 }) {
      Text(`迭代 ${it.iteration}`)
        .fontSize(11)
        .fontColor('#6B7280')
      if (it.reasoning !== undefined && it.reasoning.length > 0) {
        Text(it.reasoning)
          .fontSize(13)
          .fontColor('#9CA3AF')
          .padding(8)
          .width('100%')
          .backgroundColor('#0F172A')
          .borderRadius(8)
          .maxLines(6)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      if (it.content !== undefined && it.content.length > 0) {
        Text(it.content)
          .fontSize(15)
          .fontColor('#E5E7EB')
          .width('100%')
          .copyOption(CopyOptions.LocalDevice)
      }
      if (it.tools !== undefined && it.tools.length > 0) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(it.tools, (t: ToolProgress) => {
            Text(this.toolLabel(t))
              .fontSize(12)
              .fontColor(t.status === 'running' ? '#FBBF24' : '#A7F3D0')
              .padding({ left: 8, right: 8, top: 4, bottom: 4 })
              .margin(3)
              .backgroundColor('#111827')
              .borderRadius(6)
          }, (t: ToolProgress) => `${it.iteration}-${t.call_id !== undefined ? t.call_id : t.name}`)
        }
        .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ top: 4, bottom: 4 })
  }

  private toolLabel(t: ToolProgress): string {
    const base: string = t.label !== undefined && t.label.length > 0 ? t.label : t.name;
    if (t.status === 'running') {
      return `● ${base}`;
    }
    if (t.status === 'error' || (t.exit_code !== undefined && t.exit_code !== 0)) {
      return `✗ ${base}`;
    }
    return `✓ ${base}`;
  }
}
