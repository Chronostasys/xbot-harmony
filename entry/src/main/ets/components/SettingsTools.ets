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
 *    `docs/ARKTS-GOTCHAS.md`）。行/组头都来自 `components/SettingsRows.ets`（真 `@Component` + `@Prop`）。
 */
import { Palette, paletteOf } from '../core/theme';
import { XbotHttp } from '../core/http';
import { FS_CAPTION, R_MD, R_XL, SP_2, SP_3, SP_4, SP_5 } from '../core/tokens';
import {
  buildToolsView, ENTRY_MCP_HEAD, flattenToolsView, normalizeToolsSettings,
  readableRpcError, rpc, RpcMethod, setToolsEnabled, ToolEnabledParams, ToolsEntry,
  ToolsSettingsData, ToolsView, ToolSettingRow, toolsEntryBusyKey, toolsEntryKey,
} from '../core/rpc';
import { SettingsErrorBar, SettingsMcpHead, SettingsPanelHeader, SettingsToolRow } from './SettingsRows';

/** MCP 分组区块与内置列表之间的间距留白。 */
const GAP: number = SP_2;

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
        mono: true,
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
      SettingsPanelHeader({
        title: '工具',
        subtitle: '只有激活的工具会进入上下文并可被执行；关闭后立即失效，重新打开立即恢复。',
        theme: this.theme,
      })

      if (this.error.length > 0) {
        SettingsErrorBar({ message: this.error, theme: this.theme })
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

        Scroll() {
          Column({ space: GAP }) {
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
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Auto)
        .align(Alignment.Top)
      }
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: SP_5, right: SP_5, top: SP_4, bottom: SP_4 })
  }
}
