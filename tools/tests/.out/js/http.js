"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmptyBody = exports.LoginBody = exports.XbotHttp = void 0;
exports.describeError = describeError;
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
const _kit_ArkTS_1 = require("@kit.ArkTS");
/** 响应头里取 Set-Cookie（ArkTS 限制动态取键 ⇒ 只按已知两种拼写直查）。 */
/**
 * 把一条（或逗号拼接的多条）`Set-Cookie` 拆开。
 *
 * ⛔ 刻意**不用正则 lookahead**（`/,\s*(?=[^;=]+=)/`）：lookahead 属高级正则特性，
 * ArkTS 引擎上不可靠，而这段只在收到 Set-Cookie 时才执行。纯字符串遍历无引擎依赖。
 */
function splitSetCookie(raw) {
    const out = [];
    let start = 0;
    for (let i = 0; i < raw.length; i++) {
        if (raw.charAt(i) !== ',') {
            continue;
        }
        let j = i + 1;
        while (j < raw.length && raw.charAt(j) === ' ') {
            j++;
        }
        let k = j;
        let isNext = false;
        while (k < raw.length) {
            const c = raw.charAt(k);
            if (c === '=') {
                isNext = k > j;
                break;
            }
            if (c === ';' || c === ',' || c === ' ') {
                break;
            }
            k++;
        }
        if (isNext) {
            out.push(raw.substring(start, i));
            start = i + 1;
        }
    }
    out.push(raw.substring(start));
    return out;
}
/** 把 catch 到的值描述清楚（ArkTS 里字段要显式取；带 name/首行调用点便于定位）。 */
function describeError(e) {
    const err = e;
    const name = err.name !== undefined ? err.name : '';
    const msg = err.message !== undefined ? err.message : '';
    const stack = err.stack !== undefined ? err.stack : '';
    let out = msg.length > 0 ? msg : JSON.stringify(e);
    if (name.length > 0 && out.indexOf(name) < 0) {
        out = `${name}: ${out}`;
    }
    if (stack.length > 0) {
        const lines = stack.split('\n');
        const at = lines.length > 1 ? lines[1].trim() : stack.trim();
        out = `${out} @${at}`;
    }
    return out;
}
/**
 * 取出 Set-Cookie 原始值，**归一化成字符串**。
 *
 * ⛔ 必须同时兼容 `string` 与 `string[]` 两种形态 —— 这是 2026-10-09 真机
 * 「登录报 `undefined is not callable`」的**真正根因**：
 *   服务端登录成功后下发 `Set-Cookie: xbot_session=...`，而鸿蒙的 `HttpResponse.header`
 *   对**同名头**给的是**字符串数组**。我按 `string` 声明后直接 `.split(...)`，
 *   数组没有 split ⇒ 运行期报「undefined is not callable」。
 *   现象完全吻合：**只有登录崩**（唯一走 Set-Cookie 的路径），`/api/auth/config`
 *   （无 cookie）一直正常。
 */
function pickSetCookie(header) {
    if (header === undefined || header === null) {
        return '';
    }
    let v = header['set-cookie'];
    if (v === undefined || v === null) {
        v = header['Set-Cookie'];
    }
    if (v === undefined || v === null) {
        return '';
    }
    if (typeof v === 'string') {
        return v;
    }
    if (Array.isArray(v)) {
        const arr = v;
        const out = [];
        for (let i = 0; i < arr.length; i++) {
            out.push(arr[i]);
        }
        return out.join(', ');
    }
    return `${v}`;
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
        // 可能有多条 Set-Cookie 以逗号分隔（`a=b; Path=/, c=d; Path=/`）
        const cookies = splitSetCookie(raw);
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
        // 每个子步骤单独兜底并标注产地：真机一旦抛错，错误文案直接指出是哪一步的哪个 API
        // （2026-10-09 教训：只有一句 "undefined is not callable" 时无法定位）
        let bodyText;
        try {
            bodyText = JSON.stringify(body);
        }
        catch (e) {
            throw new Error(`[body 序列化] ${describeError(e)}`);
        }
        let req;
        try {
            req = _kit_NetworkKit_1.http.createHttp();
        }
        catch (e) {
            throw new Error(`[createHttp] ${describeError(e)}`);
        }
        try {
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            };
            const cookie = this.cookieHeader();
            if (cookie.length > 0) {
                headers['Cookie'] = cookie;
            }
            let resp;
            try {
                resp = await req.request(this.baseUrl + path, {
                    method: _kit_NetworkKit_1.http.RequestMethod.POST,
                    header: headers,
                    extraData: bodyText,
                    expectDataType: _kit_NetworkKit_1.http.HttpDataType.STRING,
                    connectTimeout: 15000,
                    readTimeout: 120000,
                });
            }
            catch (e) {
                throw new Error(`[发送 ${path}] ${describeError(e)}`);
            }
            try {
                this.rememberCookies(resp.header);
            }
            catch (e) {
                throw new Error(`[解析 Set-Cookie] ${describeError(e)}`);
            }
            const text = typeof resp.result === 'string' ? resp.result : '';
            if (resp.responseCode !== 200) {
                throw new Error(`HTTP ${resp.responseCode}: ${text.substring(0, 200)}`);
            }
            let env;
            try {
                env = JSON.parse(text);
            }
            catch (e) {
                throw new Error(`[解析响应] ${describeError(e)}：${text.substring(0, 120)}`);
            }
            if (env.ok !== true) {
                const msg = env.error !== undefined && env.error.message !== undefined
                    ? env.error.message : 'request failed';
                throw new Error(msg);
            }
            return env.data === undefined ? '{}' : JSON.stringify(env.data);
        }
        finally {
            try {
                req.destroy();
            }
            catch (e) {
                // destroy 失败不影响结果
            }
        }
    }
    /** 便捷：POST 并返回强类型对象。 */
    async postAs(path, body) {
        const raw = await this.post(path, body);
        return JSON.parse(raw);
    }
    /**
     * 以 multipart/form-data 上传一段二进制（自检截图用）。
     *
     * 为什么手搓 multipart：ArkTS 的 `http.request` 支持 `extraData: ArrayBuffer`，
     * 但没有现成的 FormData ⇒ 自己拼 body（boundary + part 头 + 字节 + 结束 boundary）。
     * 走 `/api/files/upload`（10MB 上限、字段名 `file`）。
     */
    async uploadBytes(path, filename, data, mime) {
        const boundary = `----xbot${Date.now().toString(16)}`;
        const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            `Content-Type: ${mime}\r\n\r\n`;
        const tail = `\r\n--${boundary}--\r\n`;
        const headBuf = new Uint8Array(new _kit_ArkTS_1.util.TextEncoder().encodeInto(head));
        const tailBuf = new Uint8Array(new _kit_ArkTS_1.util.TextEncoder().encodeInto(tail));
        const body = new Uint8Array(headBuf.length + data.byteLength + tailBuf.length);
        body.set(headBuf, 0);
        body.set(new Uint8Array(data), headBuf.length);
        body.set(tailBuf, headBuf.length + data.byteLength);
        const req = _kit_NetworkKit_1.http.createHttp();
        try {
            const headers = {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Accept': 'application/json',
            };
            const cookie = this.cookieHeader();
            if (cookie.length > 0) {
                headers['Cookie'] = cookie;
            }
            const resp = await req.request(this.baseUrl + path, {
                method: _kit_NetworkKit_1.http.RequestMethod.POST,
                header: headers,
                extraData: body.buffer,
                expectDataType: _kit_NetworkKit_1.http.HttpDataType.STRING,
                connectTimeout: 15000,
                readTimeout: 60000,
            });
            const text = typeof resp.result === 'string' ? resp.result : '';
            if (resp.responseCode !== 200) {
                throw new Error(`HTTP ${resp.responseCode}: ${text.substring(0, 200)}`);
            }
            const env = JSON.parse(text);
            if (env.ok !== true) {
                throw new Error('upload failed');
            }
            return JSON.stringify(env.data);
        }
        finally {
            req.destroy();
        }
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
