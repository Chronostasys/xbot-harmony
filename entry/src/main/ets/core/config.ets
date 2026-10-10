/**
 * 本地配置与凭证（`@kit.ArkData` preferences）。
 *
 * 只持久化「服务端地址 + 用户名 + 会话 cookie」——**不存密码**。
 * 会话 cookie 等价于浏览器里的登录态（服务端 30 天有效，见 `web_auth.go`），
 * 持久化它才能在冷启动后保持登录。
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { isValidServerUrl, normalizeServerUrl } from './endpoint';

// 地址规则住在 core/endpoint.ets（纯函数、可脱离 SDK 单测）；这里只做转出，保持原有调用点不变
export { isValidServerUrl, normalizeServerUrl };

const STORE_NAME: string = 'xbot_settings';
const KEY_SERVERS: string = 'server_history';
const KEY_SERVER: string = 'server_url';
const KEY_USER: string = 'username';
const KEY_COOKIE: string = 'session_cookie';
// 主题本地缓存（**原生独有副本**）：主题的业务真值在服务端 settings（登录后才拿到），
// 而系统表面（应用级 colorMode / 状态栏前景）必须在**进程最早**锁定 ⇒ EntryAbility 从这里同步读。
const KEY_THEME: string = 'app_theme';
// 离线草稿（弱网/杀进程不丢正在写的内容；只保最近一个会话）
const KEY_DRAFT_CHAT: string = 'draft_chat_id';
const KEY_DRAFT_TEXT: string = 'draft_text';

export class AppConfig {
  serverUrl: string = '';
  username: string = '';
  sessionCookie: string = '';
  /** 主题名本地缓存（`''` = 未存过 ⇒ 系统表面回落深色）。 */
  theme: string = '';
  /** 草稿所属会话与内容（空 = 没有草稿） */
  draftChatId: string = '';
  draftText: string = '';
}

export class ConfigStore {
  private store: preferences.Preferences | null = null;
  private data: AppConfig = new AppConfig();

  async init(context: common.UIAbilityContext): Promise<AppConfig> {
    const options: preferences.Options = { name: STORE_NAME };
    this.store = await preferences.getPreferences(context, options);
    const s: preferences.Preferences = this.store;
    this.data.serverUrl = s.getSync(KEY_SERVER, '') as string;
    this.data.username = s.getSync(KEY_USER, '') as string;
    this.data.sessionCookie = s.getSync(KEY_COOKIE, '') as string;
    this.data.theme = s.getSync(KEY_THEME, '') as string;
    this.data.draftChatId = s.getSync(KEY_DRAFT_CHAT, '') as string;
    this.data.draftText = s.getSync(KEY_DRAFT_TEXT, '') as string;
    return this.data;
  }

  current(): AppConfig {
    return this.data;
  }

  /** 本地缓存的主题名（`''` = 未存过）。 */
  cachedTheme(): string {
    return this.data.theme;
  }

  /** 保存主题名到本地（写盘失败不影响切主题本身）。 */
  async saveTheme(theme: string): Promise<void> {
    this.data.theme = theme;
    const s: preferences.Preferences | null = this.store;
    if (s === null) {
      return;
    }
    s.putSync(KEY_THEME, theme);
    await s.flush();
  }

  /** 某会话的草稿（只保最近一个会话；不匹配返回空串）。 */
  draftFor(chatId: string): string {
    return this.data.draftChatId === chatId ? this.data.draftText : '';
  }

  /** 保存草稿（空文本等于清除；写盘失败不影响输入）。 */
  async saveDraft(chatId: string, text: string): Promise<void> {
    this.data.draftChatId = text.trim().length > 0 ? chatId : '';
    this.data.draftText = text;
    const s: preferences.Preferences | null = this.store;
    if (s === null) {
      return;
    }
    s.putSync(KEY_DRAFT_CHAT, this.data.draftChatId);
    s.putSync(KEY_DRAFT_TEXT, text);
    await s.flush();
  }

  async save(serverUrl: string, username: string, sessionCookie: string): Promise<void> {
    this.data.serverUrl = serverUrl;
    this.data.username = username;
    this.data.sessionCookie = sessionCookie;
    const s: preferences.Preferences | null = this.store;
    if (s === null) {
      return;
    }
    s.putSync(KEY_SERVER, serverUrl);
    // 最近用过的服务端（去重、最多 5 条）——换机器/换网络时省得重打
    const prev: string[] = this.recentServers();
    const next: string[] = [serverUrl];
    for (let i = 0; i < prev.length && next.length < 5; i++) {
      if (prev[i] !== serverUrl) {
        next.push(prev[i]);
      }
    }
    s.putSync(KEY_SERVERS, next.join('\n'));
    s.putSync(KEY_USER, username);
    s.putSync(KEY_COOKIE, sessionCookie);
    await s.flush();
  }

  /** 最近用过的服务端地址（最新在前）。 */
  recentServers(): string[] {
    const s: preferences.Preferences | null = this.store;
    if (s === null) {
      return [];
    }
    const raw: string = s.getSync(KEY_SERVERS, '') as string;
    if (raw.length === 0) {
      return [];
    }
    const out: string[] = [];
    const parts: string[] = raw.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].length > 0) {
        out.push(parts[i]);
      }
    }
    return out;
  }

  async clearSession(): Promise<void> {
    await this.save(this.data.serverUrl, this.data.username, '');
  }
}

/**
 * **同步**读主题缓存 —— 供 `EntryAbility.onCreate` 在**进程最早**锁定系统表面
 * （应用级 colorMode / 状态栏前景）。
 *
 * 为什么必须同步：这些系统表面要在**首帧之前**定下来；异步读盘会先按默认（深色）渲染一帧
 * 再翻转 ⇒ 浅色主题用户会看到闪色。用 `getPreferencesSync` 取同一个 store 直接读。
 * 失败 / 未存过 ⇒ 返回 `''`（调用方回落深色，保持既有语义）。
 */
export function readCachedTheme(context: common.Context): string {
  try {
    const options: preferences.Options = { name: STORE_NAME };
    const s: preferences.Preferences = preferences.getPreferencesSync(context, options);
    return s.getSync(KEY_THEME, '') as string;
  } catch (e) {
    return '';
  }
}
