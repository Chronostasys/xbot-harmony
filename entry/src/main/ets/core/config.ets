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

export class AppConfig {
  serverUrl: string = '';
  username: string = '';
  sessionCookie: string = '';
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
    return this.data;
  }

  current(): AppConfig {
    return this.data;
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
