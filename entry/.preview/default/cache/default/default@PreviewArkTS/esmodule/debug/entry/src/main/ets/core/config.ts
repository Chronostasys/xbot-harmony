import preferences from "@ohos:data.preferences";
import type common from "@ohos:app.ability.common";
import { isValidServerUrl, normalizeServerUrl } from "@normalized:N&&&entry/src/main/ets/core/endpoint&";
// 地址规则住在 core/endpoint.ets（纯函数、可脱离 SDK 单测）；这里只做转出，保持原有调用点不变
export { isValidServerUrl, normalizeServerUrl };
const STORE_NAME: string = 'xbot_settings';
const KEY_SERVERS: string = 'server_history';
const KEY_SERVER: string = 'server_url';
const KEY_USER: string = 'username';
const KEY_COOKIE: string = 'session_cookie';
// 离线草稿（弱网/杀进程不丢正在写的内容；只保最近一个会话）
const KEY_DRAFT_CHAT: string = 'draft_chat_id';
const KEY_DRAFT_TEXT: string = 'draft_text';
export class AppConfig {
    serverUrl: string = '';
    username: string = '';
    sessionCookie: string = '';
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
        this.data.draftChatId = s.getSync(KEY_DRAFT_CHAT, '') as string;
        this.data.draftText = s.getSync(KEY_DRAFT_TEXT, '') as string;
        return this.data;
    }
    current(): AppConfig {
        return this.data;
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
