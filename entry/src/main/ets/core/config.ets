/**
 * 本地配置与凭证（`@kit.ArkData` preferences）。
 *
 * 只持久化「服务端地址 + 用户名 + 会话 cookie」——**不存密码**。
 * 会话 cookie 等价于浏览器里的登录态（服务端 30 天有效，见 `web_auth.go`），
 * 持久化它才能在冷启动后保持登录。
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

const STORE_NAME: string = 'xbot_settings';
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
    this.store = await preferences.getPreferences(context, STORE_NAME);
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
    s.putSync(KEY_USER, username);
    s.putSync(KEY_COOKIE, sessionCookie);
    await s.flush();
  }

  async clearSession(): Promise<void> {
    await this.save(this.data.serverUrl, this.data.username, '');
  }
}
