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
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { ApiEnvelope } from './types';
import { isPresent } from './guards';

/** 响应头里取 Set-Cookie（ArkTS 限制动态取键 ⇒ 只按已知两种拼写直查）。 */

/**
 * 把一条（或逗号拼接的多条）`Set-Cookie` 拆开。
 *
 * ⛔ 刻意**不用正则 lookahead**（`/,\s*(?=[^;=]+=)/`）：lookahead 属高级正则特性，
 * ArkTS 引擎上不可靠，而这段只在收到 Set-Cookie 时才执行。纯字符串遍历无引擎依赖。
 */
function splitSetCookie(raw: string): string[] {
  const out: string[] = [];
  let start: number = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw.charAt(i) !== ',') {
      continue;
    }
    let j: number = i + 1;
    while (j < raw.length && raw.charAt(j) === ' ') {
      j++;
    }
    let k: number = j;
    let isNext: boolean = false;
    while (k < raw.length) {
      const c: string = raw.charAt(k);
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
export function describeError(e: Object | null | undefined): string {
  // ⛔ catch 到的值可能是任意东西（`throw null` / 非 Error 对象）⇒ 取字段前三态判空，
  //    否则错误处理路径自身会抛（掩盖真实错误）。
  if (!isPresent(e)) {
    return e === null ? 'null' : 'undefined';
  }
  const err: Error = e as Error;
  const name: string = isPresent(err.name) ? err.name : '';
  const msg: string = isPresent(err.message) ? err.message : '';
  const stack: string = isPresent(err.stack) ? err.stack : '';
  let out: string = msg.length > 0 ? msg : JSON.stringify(e);
  if (name.length > 0 && out.indexOf(name) < 0) {
    out = `${name}: ${out}`;
  }
  if (stack.length > 0) {
    const lines: string[] = stack.split('\n');
    const at: string = lines.length > 1 ? lines[1].trim() : stack.trim();
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
function pickSetCookie(header: Record<string, Object> | undefined): string {
  if (header === undefined || header === null) {
    return '';
  }
  let v: Object = header['set-cookie'];
  if (v === undefined || v === null) {
    v = header['Set-Cookie'];
  }
  if (v === undefined || v === null) {
    return '';
  }
  if (typeof v === 'string') {
    return v as string;
  }
  if (Array.isArray(v)) {
    const arr: string[] = v as string[];
    const out: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      out.push(arr[i]);
    }
    return out.join(', ');
  }
  return `${v}`;
}

/** 从 Set-Cookie 里抽出 `name=value`（丢掉属性，如 Path/HttpOnly/Max-Age）。 */
function cookiePairFrom(setCookie: string): string {
  if (setCookie.length === 0) {
    return '';
  }
  const semi: number = setCookie.indexOf(';');
  const pair: string = semi >= 0 ? setCookie.substring(0, semi) : setCookie;
  return pair.trim();
}

export class XbotHttp {
  baseUrl: string = '';
  /** cookie jar：name → value（xbot 只用一个会话 cookie）。 */
  private cookies: Map<string, string> = new Map();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private cookieHeader(): string {
    const parts: string[] = [];
    this.cookies.forEach((v: string, k: string) => {
      parts.push(`${k}=${v}`);
    });
    return parts.join('; ');
  }

  /** SSE 流式连接需要原始 Cookie 头（`XbotHttp` 之外的地方也用它）。 */
  cookieHeaderForStream(): string {
    return this.cookieHeader();
  }

  /** 导出会话 cookie（持久化用；`xbot_session=<value>`）。 */
  exportSessionCookie(): string {
    const v: string | undefined = this.cookies.get('xbot_session');
    return v === undefined ? '' : `xbot_session=${v}`;
  }

  /** 冷启动恢复会话（preferences 里读回来的 cookie）。 */
  importSessionCookie(raw: string): void {
    if (raw.length === 0) {
      return;
    }
    const pair: string = cookiePairFrom(raw);
    const eq: number = pair.indexOf('=');
    if (eq > 0) {
      this.cookies.set(pair.substring(0, eq), pair.substring(eq + 1));
    }
  }

  private rememberCookies(header: Record<string, string> | undefined): void {
    const raw: string = pickSetCookie(header);
    if (raw.length === 0) {
      return;
    }
    // 可能有多条 Set-Cookie 以逗号分隔（`a=b; Path=/, c=d; Path=/`）
    const cookies: string[] = splitSetCookie(raw);
    for (let i = 0; i < cookies.length; i++) {
      const pair: string = cookiePairFrom(cookies[i]);
      const eq: number = pair.indexOf('=');
      if (eq > 0) {
        this.cookies.set(pair.substring(0, eq), pair.substring(eq + 1));
      }
    }
  }

  /**
   * 401（会话凭据失效）回调。页面据此**退回登录页** ——
   * 绝不能把它当成网络故障（真实事故：web 会话有效，客户端却提示"网络不通"）。
   */
  onUnauthorized: () => void = () => {
  };

  hasSession(): boolean {
    return this.cookies.has('xbot_session');
  }

  clearSession(): void {
    this.cookies.clear();
  }

  /**
   * POST `/api/<path>`，返回信封里的 `data`（原始 JSON 字符串，调用方自行 parse 成 interface）。
   * @throws Error 网络失败 / HTTP 非 2xx / 信封 ok=false
   */
  async post(path: string, body: object): Promise<string> {
    let bodyText: string;
    try {
      bodyText = JSON.stringify(body);
    } catch (e) {
      throw new Error(`[body 序列化] ${describeError(e as Object)}`);
    }
    return this.sendJson(http.RequestMethod.POST, path, bodyText);
  }

  /** GET `/api/<path>`，返回信封里的 `data`（原始 JSON 字符串）。 */
  async get(path: string): Promise<string> {
    return this.sendJson(http.RequestMethod.GET, path, undefined);
  }

  /** 便捷：GET 并返回强类型对象。 */
  async getAs<T>(path: string): Promise<T> {
    const raw: string = await this.get(path);
    return JSON.parse(raw) as T;
  }

  /**
   * 统一的 JSON 请求（POST/GET 共用同一套错误标注与 cookie 处理）。
   *
   * 每个子步骤单独兜底并标注产地：真机一旦抛错，错误文案直接指出是哪一步的哪个 API
   * （2026-10-09 教训：只有一句 "undefined is not callable" 时无法定位）。
   */
  private async sendJson(method: http.RequestMethod, path: string, bodyText: string | undefined): Promise<string> {
    let req: http.HttpRequest;
    try {
      req = http.createHttp();
    } catch (e) {
      throw new Error(`[createHttp] ${describeError(e as Object)}`);
    }

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (bodyText !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      const cookie: string = this.cookieHeader();
      if (cookie.length > 0) {
        headers['Cookie'] = cookie;
      }
      let resp: http.HttpResponse;
      try {
        resp = await req.request(this.baseUrl + path, {
          method: method,
          header: headers,
          extraData: bodyText,
          expectDataType: http.HttpDataType.STRING,
          connectTimeout: 15000,
          readTimeout: 120000,
        });
      } catch (e) {
        throw new Error(`[发送 ${path}] ${describeError(e as Object)}`);
      }

      try {
        this.rememberCookies(resp.header as Record<string, string>);
      } catch (e) {
        throw new Error(`[解析 Set-Cookie] ${describeError(e as Object)}`);
      }

      const text: string = typeof resp.result === 'string' ? resp.result as string : '';
      if (resp.responseCode === 401) {
        this.clearSession();
        this.onUnauthorized();
        throw new Error(`HTTP 401: ${text.substring(0, 200)}`);
      }
      if (resp.responseCode === 401) {
          this.clearSession();
          this.onUnauthorized();
        }
if (resp.responseCode !== 200) {
        throw new Error(`HTTP ${resp.responseCode}: ${text.substring(0, 200)}`);
      }
      // ── 信封解包（外来 JSON 边界）─────────────────────────────────────────────
      // 服务端 `apiResponse{OK bool; Data any; Error *apiError}` **三个键恒存在**（无 omitempty）：
      //   成功：`{"ok":true,"data":{…},"error":null}`   ← error 是 JSON **null**
      //   失败：`{"ok":false,"data":null,"error":{code,message}}` ← data 是 JSON **null**
      // 另有裸 encoder 路径（web_files.go）会发 `{"ok":true}`（无 data 键）或 `{"ok":false,"error":"str"}`。
      // ⇒ env 自身 / env.error / env.data 都必须三态，不能只判 `!== undefined`。
      let env: ApiEnvelope | null | undefined;
      try {
        env = JSON.parse(text) as ApiEnvelope;
      } catch (e) {
        throw new Error(`[解析响应] ${describeError(e as Object)}：${text.substring(0, 120)}`);
      }
      // 响应体是字面 JSON `null`（`JSON.parse('null') === null`）——`env.ok` 会崩。
      if (!isPresent(env)) {
        throw new Error(`[解析响应] 信封为空（JSON null）：${text.substring(0, 120)}`);
      }
      if (env.ok !== true) {
        // `error:null`（或 error 是裸字符串）时**不得**取 `.message` —— null 穿透即崩。
        const msg: string = isPresent(env.error) && isPresent(env.error.message)
          ? env.error.message : 'request failed';
        throw new Error(msg);
      }
      // `data:null` 与 `data:undefined`（键缺失）都表示"服务端无可用载荷"：
      // 二者一律降级为 `'{}'`（空对象）。⛔ 绝不能 `JSON.stringify(null)` —— 那会产出
      // **字符串 `"null"`**，下游 `JSON.parse` 得 null、再按对象取成员即崩。
      return isPresent(env.data) ? JSON.stringify(env.data) : '{}';
    } finally {
      try {
        req.destroy();
      } catch (e) {
        // destroy 失败不影响结果
      }
    }
  }

  /** 便捷：POST 并返回强类型对象。 */
  async postAs<T>(path: string, body: object): Promise<T> {
    const raw: string = await this.post(path, body);
    return JSON.parse(raw) as T;
  }

  /**
   * 以 multipart/form-data 上传一段二进制（自检截图用）。
   *
   * 为什么手搓 multipart：ArkTS 的 `http.request` 支持 `extraData: ArrayBuffer`，
   * 但没有现成的 FormData ⇒ 自己拼 body（boundary + part 头 + 字节 + 结束 boundary）。
   * 走 `/api/files/upload`（10MB 上限、字段名 `file`）。
   */
  async uploadBytes(path: string, filename: string, data: ArrayBuffer, mime: string): Promise<string> {
    const boundary: string = `----xbot${Date.now().toString(16)}`;
    const head: string =
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`;
    const tail: string = `\r\n--${boundary}--\r\n`;
    const headBuf: Uint8Array = new Uint8Array(new util.TextEncoder().encodeInto(head));
    const tailBuf: Uint8Array = new Uint8Array(new util.TextEncoder().encodeInto(tail));
    const body: Uint8Array = new Uint8Array(headBuf.length + data.byteLength + tailBuf.length);
    body.set(headBuf, 0);
    body.set(new Uint8Array(data), headBuf.length);
    body.set(tailBuf, headBuf.length + data.byteLength);

    const req: http.HttpRequest = http.createHttp();
    try {
      const headers: Record<string, string> = {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Accept': 'application/json',
      };
      const cookie: string = this.cookieHeader();
      if (cookie.length > 0) {
        headers['Cookie'] = cookie;
      }
      const resp: http.HttpResponse = await req.request(this.baseUrl + path, {
        method: http.RequestMethod.POST,
        header: headers,
        extraData: body.buffer as ArrayBuffer,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 15000,
        readTimeout: 60000,
      });
      const text: string = typeof resp.result === 'string' ? resp.result as string : '';
      if (resp.responseCode === 401) {
          this.clearSession();
          this.onUnauthorized();
        }
if (resp.responseCode !== 200) {
        throw new Error(`HTTP ${resp.responseCode}: ${text.substring(0, 200)}`);
      }
      // ── 信封解包（同 sendJson，外来 JSON 边界）───────────────────────────────
      // ⛔ 裸 `JSON.parse` + `env.data === undefined` 判定：`data:null` 会 stringify 成
      //    `"null"`；`data` 键缺失时 `JSON.stringify(undefined)` 甚至返回 **非字符串**。
      let env: ApiEnvelope | null | undefined;
      try {
        env = JSON.parse(text) as ApiEnvelope;
      } catch (e) {
        throw new Error(`[解析响应] ${describeError(e as Object)}：${text.substring(0, 120)}`);
      }
      if (!isPresent(env)) {
        throw new Error(`[解析响应] 信封为空（JSON null）：${text.substring(0, 120)}`);
      }
      if (env.ok !== true) {
        const msg: string = isPresent(env.error) && isPresent(env.error.message)
          ? env.error.message : 'upload failed';
        throw new Error(msg);
      }
      return isPresent(env.data) ? JSON.stringify(env.data) : '{}';
    } finally {
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
  async getBinary(urlOrPath: string): Promise<ArrayBuffer | null> {
    const url: string = urlOrPath.startsWith('http')
      ? urlOrPath
      : this.baseUrl + (urlOrPath.startsWith('/') ? urlOrPath : '/' + urlOrPath);
    const req: http.HttpRequest = http.createHttp();
    try {
      const headers: Record<string, string> = {};
      const cookie: string = this.cookieHeader();
      if (cookie.length > 0) {
        headers['Cookie'] = cookie;
      }
      const resp: http.HttpResponse = await req.request(url, {
        method: http.RequestMethod.GET,
        header: headers,
        expectDataType: http.HttpDataType.ARRAY_BUFFER,
        connectTimeout: 15000,
        readTimeout: 60000,
      });
      if (resp.responseCode === 401) {
        this.clearSession();
        this.onUnauthorized();
        return null;
      }
      if (resp.responseCode !== 200) {
        return null;
      }
      return resp.result instanceof ArrayBuffer ? resp.result as ArrayBuffer : null;
    } catch (e) {
      return null;
    } finally {
      req.destroy();
    }
  }

  // ── 鉴权 ────────────────────────────────────────────────────────────────────

  async login(username: string, password: string): Promise<void> {
    await this.post('/api/auth/login', new LoginBody(username, password));
  }

  async logout(): Promise<void> {
    try {
      await this.post('/api/auth/logout', new EmptyBody());
    } finally {
      this.clearSession();
    }
  }

  /** 服务端只允许 bootstrap 或非 invite-only 时注册，失败原样抛出。 */
  async register(username: string, password: string): Promise<void> {
    await this.post('/api/auth/register', new LoginBody(username, password));
  }

  /** 探测是否需要登录 / 是否允许注册。 */
  async authConfig(): Promise<AuthConfig> {
    try {
      return await this.postAs<AuthConfig>('/api/auth/config', new EmptyBody());
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      throw new Error(`auth/config 失败: ${err.message}`);
    }
  }
}

export interface AuthConfig {
  invite_only?: boolean;
  need_bootstrap?: boolean;
}

/** 请求体：类而非"接口 + 同名工厂函数"（ArkTS 下更稳，避免值/类型同名）。 */
export class LoginBody {
  username: string;
  password: string;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;
  }
}

export class EmptyBody {
}
