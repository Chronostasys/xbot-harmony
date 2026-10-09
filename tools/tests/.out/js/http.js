"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmptyBody = exports.LoginBody = exports.XbotHttp = void 0;
/**
 * XbotHttp —— xbot Web 渠道的 HTTP 客户端（ArkTS）。
 *
 * 为什么需要它（而不是直接用 `http.createHttp()`）：
 *   ① xbot 的**全部** REST 端点都走 `{ok,data,error}` 信封（`channel/web/web_auth.go`），
 *      成功时 `data` 是扁平铺开的业务字段；
 *   ② 鉴权**只有 Cookie**（`xbot_session`；`web_auth.go:375` validateSession 只读 Cookie），
 *      没有 Bearer / API-Key —— 所以客户端必须自己维护 cookie jar；
 *   ③ 一个实例只做一次请求，避免并发污染（鸿蒙 http 文档要求）。
 */
const _kit_NetworkKit_1 = require("@kit.NetworkKit");
/** 响应头里取 Set-Cookie（ArkTS 限制动态取键 ⇒ 只按已知两种拼写直查）。 */
function pickSetCookie(header) {
    if (header === undefined) {
        return '';
    }
    const lower = header['set-cookie'];
    if (lower !== undefined && lower.length > 0) {
        return lower;
    }
    const upper = header['Set-Cookie'];
    return upper !== undefined ? upper : '';
}
/** 从 Set-Cookie 里抽出 `name=value`（丢掉属性，如 Path/HttpOnly/Max-Age）。 */
function cookiePairFrom(setCookie) {
    if (setCookie.length === 0) {
        return '';
    }
    const semi = setCookie.indexOf(';');
    const pair = semi >= 0 ? setCookie.substring(0, semi) : setCookie;
    return pair.trim();
}
class XbotHttp {
    constructor(baseUrl) {
        this.baseUrl = '';
        /** cookie jar：name → value（xbot 只用一个会话 cookie）。 */
        this.cookies = new Map();
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }
    cookieHeader() {
        const parts = [];
        this.cookies.forEach((v, k) => {
            parts.push(`${k}=${v}`);
        });
        return parts.join('; ');
    }
    /** SSE 流式连接需要原始 Cookie 头（`XbotHttp` 之外的地方也用它）。 */
    cookieHeaderForStream() {
        return this.cookieHeader();
    }
    /** 导出会话 cookie（持久化用；`xbot_session=<value>`）。 */
    exportSessionCookie() {
        const v = this.cookies.get('xbot_session');
        return v === undefined ? '' : `xbot_session=${v}`;
    }
    /** 冷启动恢复会话（preferences 里读回来的 cookie）。 */
    importSessionCookie(raw) {
        if (raw.length === 0) {
            return;
        }
        const pair = cookiePairFrom(raw);
        const eq = pair.indexOf('=');
        if (eq > 0) {
            this.cookies.set(pair.substring(0, eq), pair.substring(eq + 1));
        }
    }
    rememberCookies(header) {
        const raw = pickSetCookie(header);
        if (raw.length === 0) {
            return;
        }
        // 可能有多条 Set-Cookie 以逗号分隔（`a=b; Path=/, c=d; Path=/`）——按 `, <name>=` 切
        const cookies = raw.split(/,\s*(?=[^;=]+=)/);
        for (let i = 0; i < cookies.length; i++) {
            const pair = cookiePairFrom(cookies[i]);
            const eq = pair.indexOf('=');
            if (eq > 0) {
                this.cookies.set(pair.substring(0, eq), pair.substring(eq + 1));
            }
        }
    }
    hasSession() {
        return this.cookies.has('xbot_session');
    }
    clearSession() {
        this.cookies.clear();
    }
    /**
     * POST `/api/<path>`，返回信封里的 `data`（原始 JSON 字符串，调用方自行 parse 成 interface）。
     * @throws Error 网络失败 / HTTP 非 2xx / 信封 ok=false
     */
    async post(path, body) {
        const req = _kit_NetworkKit_1.http.createHttp();
        try {
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            };
            const cookie = this.cookieHeader();
            if (cookie.length > 0) {
                headers['Cookie'] = cookie;
            }
            const resp = await req.request(this.baseUrl + path, {
                method: _kit_NetworkKit_1.http.RequestMethod.POST,
                header: headers,
                extraData: JSON.stringify(body),
                expectDataType: _kit_NetworkKit_1.http.HttpDataType.STRING,
                connectTimeout: 15000,
                readTimeout: 120000,
            });
            this.rememberCookies(resp.header);
            const text = typeof resp.result === 'string' ? resp.result : '';
            if (resp.responseCode !== 200) {
                throw new Error(`HTTP ${resp.responseCode}: ${text.substring(0, 200)}`);
            }
            const env = JSON.parse(text);
            if (env.ok !== true) {
                const msg = env.error !== undefined && env.error.message !== undefined
                    ? env.error.message : 'request failed';
                throw new Error(msg);
            }
            return env.data === undefined ? '{}' : JSON.stringify(env.data);
        }
        finally {
            req.destroy();
        }
    }
    /** 便捷：POST 并返回强类型对象。 */
    async postAs(path, body) {
        const raw = await this.post(path, body);
        return JSON.parse(raw);
    }
    /**
     * GET 二进制（图片附件/头像等）。
     *
     * 为什么必须自己取：`/api/files/download`、`/api/files/viewimg/*` 都是 **cookie 鉴权**，
     * 而 ArkUI 的 `Image(url)` 不会带我们的会话 cookie、ArkWeb 也不是同一个 cookie jar
     * ⇒ 用本客户端的 cookie 拉字节，再交给 `image.createImageSource()` 解码成 PixelMap。
     */
    async getBinary(urlOrPath) {
        const url = urlOrPath.startsWith('http')
            ? urlOrPath
            : this.baseUrl + (urlOrPath.startsWith('/') ? urlOrPath : '/' + urlOrPath);
        const req = _kit_NetworkKit_1.http.createHttp();
        try {
            const headers = {};
            const cookie = this.cookieHeader();
            if (cookie.length > 0) {
                headers['Cookie'] = cookie;
            }
            const resp = await req.request(url, {
                method: _kit_NetworkKit_1.http.RequestMethod.GET,
                header: headers,
                expectDataType: _kit_NetworkKit_1.http.HttpDataType.ARRAY_BUFFER,
                connectTimeout: 15000,
                readTimeout: 60000,
            });
            if (resp.responseCode !== 200) {
                return null;
            }
            return resp.result instanceof ArrayBuffer ? resp.result : null;
        }
        catch (e) {
            return null;
        }
        finally {
            req.destroy();
        }
    }
    // ── 鉴权 ────────────────────────────────────────────────────────────────────
    async login(username, password) {
        await this.post('/api/auth/login', new LoginBody(username, password));
    }
    async logout() {
        try {
            await this.post('/api/auth/logout', new EmptyBody());
        }
        finally {
            this.clearSession();
        }
    }
    /** 服务端只允许 bootstrap 或非 invite-only 时注册，失败原样抛出。 */
    async register(username, password) {
        await this.post('/api/auth/register', new LoginBody(username, password));
    }
    /** 探测是否需要登录 / 是否允许注册。 */
    async authConfig() {
        try {
            return await this.postAs('/api/auth/config', new EmptyBody());
        }
        catch (e) {
            const err = e;
            throw new Error(`auth/config 失败: ${err.message}`);
        }
    }
}
exports.XbotHttp = XbotHttp;
/** 请求体：类而非"接口 + 同名工厂函数"（ArkTS 下更稳，避免值/类型同名）。 */
class LoginBody {
    constructor(username, password) {
        this.username = username;
        this.password = password;
    }
}
exports.LoginBody = LoginBody;
class EmptyBody {
}
exports.EmptyBody = EmptyBody;
