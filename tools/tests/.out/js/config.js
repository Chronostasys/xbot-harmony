"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigStore = exports.AppConfig = exports.normalizeServerUrl = exports.isValidServerUrl = void 0;
/**
 * 本地配置与凭证（`@kit.ArkData` preferences）。
 *
 * 只持久化「服务端地址 + 用户名 + 会话 cookie」——**不存密码**。
 * 会话 cookie 等价于浏览器里的登录态（服务端 30 天有效，见 `web_auth.go`），
 * 持久化它才能在冷启动后保持登录。
 */
const _kit_ArkData_1 = require("@kit.ArkData");
const endpoint_1 = require("./endpoint");
Object.defineProperty(exports, "isValidServerUrl", { enumerable: true, get: function () { return endpoint_1.isValidServerUrl; } });
Object.defineProperty(exports, "normalizeServerUrl", { enumerable: true, get: function () { return endpoint_1.normalizeServerUrl; } });
const STORE_NAME = 'xbot_settings';
const KEY_SERVERS = 'server_history';
const KEY_SERVER = 'server_url';
const KEY_USER = 'username';
const KEY_COOKIE = 'session_cookie';
// 离线草稿（弱网/杀进程不丢正在写的内容；只保最近一个会话）
const KEY_DRAFT_CHAT = 'draft_chat_id';
const KEY_DRAFT_TEXT = 'draft_text';
class AppConfig {
    constructor() {
        this.serverUrl = '';
        this.username = '';
        this.sessionCookie = '';
        /** 草稿所属会话与内容（空 = 没有草稿） */
        this.draftChatId = '';
        this.draftText = '';
    }
}
exports.AppConfig = AppConfig;
class ConfigStore {
    constructor() {
        this.store = null;
        this.data = new AppConfig();
    }
    async init(context) {
        const options = { name: STORE_NAME };
        this.store = await _kit_ArkData_1.preferences.getPreferences(context, options);
        const s = this.store;
        this.data.serverUrl = s.getSync(KEY_SERVER, '');
        this.data.username = s.getSync(KEY_USER, '');
        this.data.sessionCookie = s.getSync(KEY_COOKIE, '');
        this.data.draftChatId = s.getSync(KEY_DRAFT_CHAT, '');
        this.data.draftText = s.getSync(KEY_DRAFT_TEXT, '');
        return this.data;
    }
    current() {
        return this.data;
    }
    /** 某会话的草稿（只保最近一个会话；不匹配返回空串）。 */
    draftFor(chatId) {
        return this.data.draftChatId === chatId ? this.data.draftText : '';
    }
    /** 保存草稿（空文本等于清除；写盘失败不影响输入）。 */
    async saveDraft(chatId, text) {
        this.data.draftChatId = text.trim().length > 0 ? chatId : '';
        this.data.draftText = text;
        const s = this.store;
        if (s === null) {
            return;
        }
        s.putSync(KEY_DRAFT_CHAT, this.data.draftChatId);
        s.putSync(KEY_DRAFT_TEXT, text);
        await s.flush();
    }
    async save(serverUrl, username, sessionCookie) {
        this.data.serverUrl = serverUrl;
        this.data.username = username;
        this.data.sessionCookie = sessionCookie;
        const s = this.store;
        if (s === null) {
            return;
        }
        s.putSync(KEY_SERVER, serverUrl);
        // 最近用过的服务端（去重、最多 5 条）——换机器/换网络时省得重打
        const prev = this.recentServers();
        const next = [serverUrl];
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
    recentServers() {
        const s = this.store;
        if (s === null) {
            return [];
        }
        const raw = s.getSync(KEY_SERVERS, '');
        if (raw.length === 0) {
            return [];
        }
        const out = [];
        const parts = raw.split('\n');
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].length > 0) {
                out.push(parts[i]);
            }
        }
        return out;
    }
    async clearSession() {
        await this.save(this.data.serverUrl, this.data.username, '');
    }
}
exports.ConfigStore = ConfigStore;
