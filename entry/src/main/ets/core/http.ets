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
import { BusinessError } from '@kit.BasicServicesKit';
import { ApiEnvelope } from './types';

/** 响应头里取 Set-Cookie（鸿蒙 `http` 把响应头摊平成 `Record<string,string>`）。 */
function pickSetCookie(header: Record<string, string> | undefined): string {
  if (header === undefined) {
    return '';
  }
  const keys: string[] = Object.keys(header);
  for (let i = 0; i < keys.length; i++) {
    const k: string = keys[i];
    if (k.toLowerCase() === 'set-cookie') {
      return header[k];
    }
  }
  return '';
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
    // 可能有多条 Set-Cookie 以逗号分隔（`a=b; Path=/, c=d; Path=/`）——按 `, <name>=` 切
    const cookies: string[] = raw.split(/,\s*(?=[^;=]+=)/);
    for (let i = 0; i < cookies.length; i++) {
      const pair: string = cookiePairFrom(cookies[i]);
      const eq: number = pair.indexOf('=');
      if (eq > 0) {
        this.cookies.set(pair.substring(0, eq), pair.substring(eq + 1));
      }
    }
  }

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
    const req: http.HttpRequest = http.createHttp();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      const cookie: string = this.cookieHeader();
      if (cookie.length > 0) {
        headers['Cookie'] = cookie;
      }
      const resp: http.HttpResponse = await req.request(this.baseUrl + path, {
        method: http.RequestMethod.POST,
        header: headers,
        extraData: JSON.stringify(body),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 15000,
        readTimeout: 120000,
      });
      this.rememberCookies(resp.header as Record<string, string>);
      const text: string = typeof resp.result === 'string' ? resp.result as string : '';
      if (resp.responseCode !== 200) {
        throw new Error(`HTTP ${resp.responseCode}: ${text.substring(0, 200)}`);
      }
      const env: ApiEnvelope = JSON.parse(text) as ApiEnvelope;
      if (env.ok !== true) {
        const msg: string = env.error !== undefined && env.error.message !== undefined
          ? env.error.message : 'request failed';
        throw new Error(msg);
      }
      return env.data === undefined ? '{}' : JSON.stringify(env.data);
    } finally {
      req.destroy();
    }
  }

  /** 便捷：POST 并返回强类型对象。 */
  async postAs<T>(path: string, body: object): Promise<T> {
    const raw: string = await this.post(path, body);
    return JSON.parse(raw) as T;
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

export interface LoginBody {
  username: string;
  password: string;
}

export function LoginBody(username: string, password: string): LoginBody {
  return { username: username, password: password };
}

export class EmptyBody {
}
