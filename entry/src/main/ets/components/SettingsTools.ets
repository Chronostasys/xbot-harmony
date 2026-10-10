/**
 * SettingsTools —— 内置工具激活面板（设置 → 工具），对齐 web
 * `web/src/components/settings/SettingsTools.tsx`。
 *
 * 契约（服务端 `serverapp/rpc_table.go:699-713`）：
 *   · `get_tools_settings` `{}`（**admin**）→ `{tools:[{name,description,enabled,server_name?}]}`
 *   · `set_tool_enabled` `{name,enabled}`（**admin**）→ void
 * 语义：只有**激活**的工具会进 LLM 上下文、才可执行；启停可逆、立即生效、无需重启。
 *
 * ⛔ **MCP 分组静默失效的根因**：后端字段是 snake_case `server_name`，web 曾直接读 `serverName`
 *    ⇒ 永远 `undefined` ⇒ MCP 分组/服务器总开关**静默消失**（web `SettingsTools.tsx:44-46` 的注释）。
 *    原生在 `core/rpc.ets:normalizeToolSetting()` 里归一（snake 优先），本组件只消费归一结果。
 *
 * ⛔ **不用带参全局 `@Builder`**（参数是调用时刻的快照 ⇒ 子树不随数据重建；见
 *    `docs/ARKTS-GOTCHAS.md`）。行/组头都是真 `@Component` + `@Prop`。
 */
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_BODY, FS_CAPTION, FS_TITLE, R_LG, R_MD, R_XL, SP_1, SP_2, SP_3, SP_4, SP_5, SP_6 } from '../core/tokens';
import {
  buildToolsView, ENTRY_MCP_HEAD, flattenToolsView, McpGroup, normalizeToolsSettings,
  readableRpcError, rpc, RpcMethod, setToolsEnabled, ToolEnabledParams, ToolsEntry,
  ToolsSettingsData, ToolsView, ToolSettingRow, toolsEntryBusyKey, toolsEntryKey,
} from '../core/rpc';

/**
 * 工具面板的 server 名 / 工具名（弱于正文的等宽字）。
 * 说明：ArkTS 无等宽字体族 switch，`fontFamily('monospace')` 在真机会回落系统等宽字体。
 */
const SERVER_HEAD_H: number = 44;

/** 一行工具（内置工具 / MCP 成员）。真 `@Component` + `@Prop` ⇒ 开关状态随数据更新。 */
@Component
export struct SettingsToolRow {
  @Prop label: string = '';
  @Prop description: string = '';
  /** ⛔ 不能叫 `enabled` —— 它是 ArkUI `CustomComponent` 的基类成员（`.enabled()` 修饰符），
   *  同名会被判 10505001 「not assignable to base type」（与已知的 `size` 同类坑，
   *  见 `docs/ARKTS-GOTCHAS.md` 批次13）。 */
  @Prop isOn: boolean = false;
  @Prop indented: boolean = false;
  @Prop busy: boolean = false;
  @Prop theme: string = 'dark';
  /** 用户切换开关（乐观更新由面板负责）。 */
  onToggle: (names: string[], next: boolean) => void = () => {
  };
  /** 该行开关作用的工具名（单行 = 自身）。 */
  names: string[] = [];

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row({ space: SP_3 }) {
      Toggle({ type: ToggleType.Switch, isOn: this.isOn })
        .enabled(!this.busy)
        .onChange((isOn: boolean) => {
          this.onToggle(this.names, isOn);
        })
      Column({ space: 2 }) {
        Text(this.label)
          .fontSize(FS_BODY)
          .fontFamily('monospace')
          .fontColor(this.pal().textPrimary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (this.description.length > 0) {
          Text(this.description)
            .fontSize(FS_CAPTION)
            .fontColor(this.pal().textMuted)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .padding({
      left: this.indented ? SP_6 : 0,
      right: SP_2,
      top: SP_2,
      bottom: SP_2,
    })
  }
}

/** 一个 MCP server 的组头（总开关 = 批量启停该组全部工具）。 */
@Component
export struct SettingsMcpHead {
  @Prop server: string = '';
  @Prop count: number = 0;
  @Prop allEnabled: boolean = false;
  @Prop busy: boolean = false;
  @Prop theme: string = 'dark';
  onToggle: (names: string[], next: boolean) => void = () => {
  };
  names: string[] = [];

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  build() {
    Row({ space: SP_3 }) {
      Toggle({ type: ToggleType.Switch, isOn: this.allEnabled })
        .enabled(!this.busy)
        .onChange((isOn: boolean) => {
          this.onToggle(this.names, isOn);
        })
      Column({ space: 2 }) {
        Text(this.server)
          .fontSize(FS_BODY)
          .fontFamily('monospace')
          .fontColor(this.pal().textPrimary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(`${this.count} 个工具`)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .height(SERVER_HEAD_H)
    .alignItems(VerticalAlign.Center)
    .padding({ right: SP_2 })
  }
}

@Component
export struct SettingsTools {
  /**
   * HTTP 客户端（由页面注入 `store.http`）。默认空实例只为满足 ArkTS 成员初始化，
   * 未注入时任何调用都会失败并显示可读错误 —— 不静默。
   */
  http: XbotHttp = new XbotHttp('');
  @Prop theme: string = 'dark';

  @State private rows: ToolSettingRow[] = [];
  @State private loading: boolean = true;
  @State private error: string = '';
  /** 正在切换的键（单工具名，或整组的逗号串）—— 与 web `busy` 同义。 */
  @State private busy: string = '';

  aboutToAppear(): void {
    void this.load();
  }

  private pal(): Palette {
    return paletteOf(this.theme);
  }

  private view(): ToolsView {
    return buildToolsView(this.rows);
  }

  private entries(): ToolsEntry[] {
    return flattenToolsView(this.view());
  }

  private summary(): string {
    const v: ToolsView = this.view();
    return `已启用 ${v.activeCount} / ${v.totalCount} 项`;
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const data: ToolsSettingsData = await rpc<ToolsSettingsData>(this.http, RpcMethod.getToolsSettings);
      this.rows = normalizeToolsSettings(data);
      this.error = '';
    } catch (e) {
      // ⛔ 权限不足（`admin only`）必须给可读提示，**绝不静默空白**（用户会以为没数据）。
      this.error = readableRpcError((e as Error).message);
      this.rows = [];
    } finally {
      this.loading = false;
    }
  }

  /** 乐观更新 + 失败回滚（与 web `SettingsTools.tsx:58-97` 同模式）。 */
  private async setMany(names: string[], next: boolean): Promise<void> {
    const key: string = names.join(',');
    this.busy = key;
    const prev: ToolSettingRow[] = this.rows;
    this.rows = setToolsEnabled(this.rows, names, next);
    try {
      for (let i = 0; i < names.length; i++) {
        await rpc<void>(this.http, RpcMethod.setToolEnabled, new ToolEnabledParams(names[i], next));
      }
      this.error = '';
    } catch (e) {
      this.rows = prev;
      this.error = readableRpcError((e as Error).message);
    } finally {
      this.busy = '';
    }
  }

  @Builder
  EntryRow(e: ToolsEntry) {
    if (e.kind === ENTRY_MCP_HEAD) {
      SettingsMcpHead({
        server: e.label,
        count: e.names.length,
        allEnabled: e.enabled,
        busy: this.busy === toolsEntryBusyKey(e),
        theme: this.theme,
        names: e.names,
        onToggle: (names: string[], next: boolean) => {
          void this.setMany(names, next);
        },
      })
    } else {
      SettingsToolRow({
        label: e.label,
        description: e.description,
        isOn: e.enabled,
        indented: e.indented,
        busy: this.busy === toolsEntryBusyKey(e),
        theme: this.theme,
        names: e.names,
        onToggle: (names: string[], next: boolean) => {
          void this.setMany(names, next);
        },
      })
    }
  }

  build() {
    Column({ space: SP_3 }) {
      Text('工具')
        .fontSize(FS_TITLE)
        .fontColor(this.pal().textPrimary)
        .width('100%')
      Text('只有激活的工具会进入上下文并可被执行；关闭后立即失效，重新打开立即恢复。')
        .fontSize(FS_CAPTION)
        .fontColor(this.pal().textMuted)
        .width('100%')

      if (this.error.length > 0) {
        Text(this.error)
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().dangerText)
          .width('100%')
          .padding(SP_3)
          .backgroundColor(this.pal().surfaceAlt)
          .borderRadius(R_MD)
      }

      if (this.loading) {
        Text('加载中…')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else if (this.rows.length === 0 && this.error.length === 0) {
        Text('没有可配置的工具。')
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')
      } else {
        Text(this.summary())
          .fontSize(FS_CAPTION)
          .fontColor(this.pal().textMuted)
          .width('100%')

        Column({ space: 0 }) {
          ForEach(this.entries(), (e: ToolsEntry) => {
            this.EntryRow(e)
          }, (e: ToolsEntry) => toolsEntryKey(e))
        }
        .width('100%')
        .padding(SP_4)
        .backgroundColor(this.pal().surface)
        .borderRadius(R_XL)
        .border({ width: 1, color: this.pal().border })
      }

      Blank()
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SP_5, right: SP_5, top: SP_4 })
  }
}
