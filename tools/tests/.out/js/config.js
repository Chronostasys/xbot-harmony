"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigStore = exports.AppConfig = void 0;
/**
 * 本地配置与凭证（`@kit.ArkData` preferences）。
 *
 * 只持久化「服务端地址 + 用户名 + 会话 cookie」——**不存密码**。
 * 会话 cookie 等价于浏览器里的登录态（服务端 30 天有效，见 `web_auth.go`），
 * 持久化它才能在冷启动后保持登录。
 */
const _kit_ArkData_1 = require("@kit.ArkData");
const STORE_NAME = 'xbot_settings';
const KEY_SERVER = 'server_url';
const KEY_USER = 'username';
const KEY_COOKIE = 'session_cookie';
class AppConfig {
    constructor() {
        this.serverUrl = '';
        this.username = '';
        this.sessionCookie = '';
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
        return this.data;
    }
    current() {
        return this.data;
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
        s.putSync(KEY_USER, username);
        s.putSync(KEY_COOKIE, sessionCookie);
        await s.flush();
    }
    async clearSession() {
        await this.save(this.data.serverUrl, this.data.username, '');
    }
}
exports.ConfigStore = ConfigStore;
