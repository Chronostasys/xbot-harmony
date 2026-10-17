/**
 * pushreg.ets —— App 侧「本机 Push Token 取用与上报」。
 *
 * ── 职责边界（⛔ 只有一个）────────────────────────────────────────────────────
 *   把**本机 Push Token** 交给服务端插件 `xbot.harmony-push`。其余全部（发送、限流、
 *   合并窗口、静音时段、设备台账、投递日志、参数校验）都在插件里 —— App 侧**不写**
 *   任何设置界面：插件设置一律由它的 `contributes.configuration` 经**通用渲染**生成
 *   （host `plugin_config` 描述字段 + `plugin_config_set` 回写，`plugin_config_set`
 *   实测可让插件进程**立刻**看到新值）。本文件只做"取 + 报"。
 *
 * ── 为什么必须是端侧 ──────────────────────────────────────────────────────────
 *   `pushService.getToken()` 要求**应用自身身份**（AGC 里该包名的 push 权益 + 含 push 能力的
 *   profile），服务端无法代取：Token 是"这台设备上这个应用"的收件地址。
 *
 * ── 失败不许静默 ──────────────────────────────────────────────────────────────
 *   逐个错误码给可执行中文（尤其 `1000900012 推送权益未开通` —— 这正是"要去 AGC 开通/重签
 *   profile"那条），并落应用日志（设置→开发者→应用日志，tag `push`），用户可自查。
 */

import { pushService } from '@kit.PushKit';
import { BusinessError, deviceInfo } from '@kit.BasicServicesKit';
import { log } from './applog';
import { XbotHttp } from './http';
import { EmptyParams, RPC_PLUGIN_STATUS, rpc, readableRpcError } from './rpc';
// ⛔ `RPC_WEB_PLUGIN`（= 'web_plugin_rpc'）与 `WebPluginRpcParams` 都定义在 `gitpanel.ets`
//   （那里是全仓唯一的前端插件 RPC 出口）；从 `./rpc` 导入会 TS2305。
import { WebPluginRpcParams, RPC_WEB_PLUGIN } from './gitpanel';

/** 承接推送的服务端插件 id（`plugin.json` 的 `id`）。 */
export const PUSH_PLUGIN_ID: string = 'xbot.harmony-push';

/** 同一 token 的最短重报间隔（幂等，插件侧也会去重；这里只为省网络）。 */
export const PUSH_REREGISTER_MIN_MS: number = 10 * 60 * 1000;

// ── 插件探活（用户 2026-10-17 要求：**先判 active 再请求**）──────────────────────────
//  ⛔ 为什么不能每次都试：后端重启/插件未就绪的窗口里直接打 RPC 会拿到
//    `plugin not active: xbot.harmony-push.register_token` 的 500（用户亲报「一进去就500」）。
//  ⛔ 为什么不进启动关键路径：本模块的调用点是 fire-and-forget（登录后 / 回前台），
//    且探活结果**按次启动缓存** ⇒ 正常情况下每次启动只多**一个**极小 RPC。
export const PUSH_PLUGIN_PROBE_TTL_MS: number = 120 * 1000;

/** `plugin_status` 的一条（服务端 `{id,name,version,state,runtime}`）。 */
interface PluginStatusEntry {
  id?: string;
  state?: string;
}

interface PluginStatusData {
  plugins?: PluginStatusEntry[];
}

/** 探活缓存：0 未探测 / 1 已就绪 / 2 暂不可用（带时刻，超 TTL 允许重探 ⇒ 后端重启后自愈）。 */
let pluginActiveState: number = 0;
let pluginActiveAt: number = 0;

/**
 * `plugin_status` 的返回 → 本插件是否 **active**（纯函数，可脱机单测）。
 * ⛔ 只认 `state === 'active'`：`error`/`discovered`（未激活）都不许放行请求。
 */
export function pushPluginActiveFromStatus(data: Object | undefined): boolean {
  if (data === undefined || data === null) {
    return false;
  }
  const list: PluginStatusEntry[] | undefined = (data as PluginStatusData).plugins;
  if (list === undefined || list === null) {
    return false;
  }
  for (let i = 0; i < list.length; i++) {
    const e: PluginStatusEntry = list[i];
    if (e !== undefined && e !== null && e.id === PUSH_PLUGIN_ID) {
      return e.state === 'active';
    }
  }
  return false;
}

/** 登记状态（页面持有；`@State`-free，纯数据）。 */
export class PushRegState {
  /** 最近一次从华为取到的 token（空 = 还没取到）。 */
  token: string = '';
  /** 最近一次**成功上报**给插件的 token。 */
  reportedToken: string = '';
  /** 最近一次成功上报时刻（ms）。 */
  reportedAt: number = 0;
  /** 连续失败次数（用于文案与是否继续重试）。 */
  failCount: number = 0;
  /** 最近一次失败的**可读原因**（页面/日志展示）。 */
  lastError: string = '';
}

/** `register_token` 的 RPC 参数（ArkTS：不用对象字面量作类型 ⇒ 显式类）。 */
export class PushRegParams {
  token: string = '';
  name: string = '';
  platform: string = 'HarmonyOS';
  version: string = '';

  constructor(token: string, name: string, version: string) {
    this.token = token;
    this.name = name;
    this.version = version;
  }
}

/**
 * 华为 `pushService.getToken` 的错误码 → 可执行中文。
 *
 * 真源：`@hms.core.push.pushService.d.ts` 的 `@throws` 清单（逐个对应，⛔ 不合并成一句"失败"）。
 */
export function pushErrorHint(code: number, msg: string): string {
  switch (code) {
    case 1000900008:
      return '连不上华为推送服务（检查网络后重试）';
    case 1000900009:
      return '华为推送服务内部错误（稍后重试）';
    case 1000900010:
      return '应用身份非法：签名 profile 与包名不匹配（需用该包名的正式签名重装）';
    case 1000900011:
      return '网络不可用';
    case 1000900012:
      return '推送权益未开通：请在 AGC 开通「推送服务」并重新生成包含 push 能力的 profile 后重装';
    case 1000900013:
      return '跨地域应用不允许获取 Token';
    case 1000900014:
      return '本设备不支持获取推送 Token';
    case 1000900001:
      return '华为推送服务系统内部错误';
    default:
      return msg.length > 0 ? `获取推送 Token 失败（${code}）：${msg}` : `获取推送 Token 失败（${code}）`;
  }
}

/**
 * 该不该现在上报（**判据唯一**，可脱机单测）：
 *   · 没取到 token ⇒ 不报；
 *   · token 与已上报的不同（换 token/换机/重装）⇒ 必报（结构事件，不受间隔限制）；
 *   · 上次失败过 ⇒ 报（重试；失败不该被间隔永久压住）；
 *   · 其余 ⇒ 距上次成功上报 ≥ `PUSH_REREGISTER_MIN_MS` 才报（省网络，插件侧本就幂等）。
 */
export function pushShouldRegister(st: PushRegState, token: string, nowMs: number): boolean {
  if (token.length === 0) {
    return false;
  }
  if (token !== st.reportedToken) {
    return true;
  }
  if (st.failCount > 0) {
    return true;
  }
  return nowMs - st.reportedAt >= PUSH_REREGISTER_MIN_MS;
}

/**
 * 本机显示名（服务端台账里能认出是哪台机器）。
 * `marketName` 是面向用户的名字（如 "Mate 70"），为空时回落到 `productModel`。
 */
export function localDeviceName(): string {
  const market: string = deviceInfo.marketName !== undefined ? deviceInfo.marketName : '';
  const model: string = deviceInfo.productModel !== undefined ? deviceInfo.productModel : '';
  return pushDeviceName(deviceInfo.brand, market.length > 0 ? market : model);
}

/** 系统版本（台账展示用；取不到就空串，⛔ 不编造）。 */
export function localVersion(): string {
  return deviceInfo.osFullName !== undefined ? deviceInfo.osFullName : '';
}

/** 设备显示名（让服务端台账里能认出是哪台机器）。 */
export function pushDeviceName(brand: string, model: string): string {
  const b: string = brand.trim();
  const m: string = model.trim();
  if (b.length === 0 && m.length === 0) {
    return 'HarmonyOS 设备';
  }
  return b.length > 0 && m.length > 0 ? `${b} ${m}` : (b.length > 0 ? b : m);
}

/**
 * 取本机 Push Token（失败抛出**可读** Error；调用方负责展示/记录）。
 *
 * ⛔ 不让异常穿透到调用点之外：本函数把 BusinessError 映射成中文原因后再抛。
 */
export async function obtainPushToken(): Promise<string> {
  try {
    const token: string = await pushService.getToken();
    return token !== undefined && token !== null ? token : '';
  } catch (e) {
    const err: BusinessError = e as BusinessError;
    const code: number = err !== undefined && err !== null && err.code !== undefined ? err.code : -1;
    const msg: string = err !== undefined && err !== null && err.message !== undefined ? err.message : '';
    throw new Error(pushErrorHint(code, msg));
  }
}

/**
 * 探活插件（带 TTL 缓存）。
 * ⛔ 失败**不弹 toast**（`notify=false`）：这是后台静默能力，未装/重启期间不该打扰用户。
 */
async function ensurePushPluginActive(http: XbotHttp, nowMs: number): Promise<boolean> {
  if (pluginActiveState === 1) {
    return true;
  }
  if (pluginActiveState === 2 && nowMs - pluginActiveAt < PUSH_PLUGIN_PROBE_TTL_MS) {
    return false;
  }
  try {
    const data: Object = await rpc<Object>(http, RPC_PLUGIN_STATUS, new EmptyParams(), false);
    pluginActiveState = pushPluginActiveFromStatus(data) ? 1 : 2;
    pluginActiveAt = nowMs;
    log('push', pluginActiveState === 1 ? '推送插件已就绪，开始登记本机 Token'
      : '推送插件未 active，稍后再试');
    return pluginActiveState === 1;
  } catch (e) {
    pluginActiveState = 2;
    pluginActiveAt = nowMs;
    log('push', `探活推送插件失败：${readableRpcError((e as Error).message)}`);
    return false;
  }
}

/**
 * 取 + 上报（**幂等**；失败不抛，返回可读结论并记日志）。
 *
 * @returns 人类可读结论（页面可 toast / 日志展示）
 */
export async function registerPushToken(http: XbotHttp, st: PushRegState): Promise<string> {
  const deviceName: string = localDeviceName();
  const version: string = localVersion();
  const now: number = Date.now();
  let token: string = '';
  try {
    token = await obtainPushToken();
  } catch (e) {
    const reason: string = (e as Error).message;
    st.failCount = st.failCount + 1;
    st.lastError = reason;
    log('push', `取 Push Token 失败：${reason}`);
    return reason;
  }
  st.token = token;
  if (!pushShouldRegister(st, token, now)) {
    // 已上报且无需重报 ⇒ 不打扰（⛔ 也不写日志，避免日志被刷）
    return '';
  }
  // ⛔ 闸门：插件不是 active（后端重启窗口 / 未装插件）⇒ **不发请求**，只记日志；
  //    下一次（回前台）会自动重试（`pushShouldRegister` 在未上报成功前恒真）。
  if (!await ensurePushPluginActive(http, now)) {
    const why: string = '推送插件未就绪（后端可能正在重启），本次跳过上报';
    st.failCount = st.failCount + 1;
    st.lastError = why;
    log('push', why);
    return why;
  }
  try {
    const res: Object = await rpc<Object>(http, RPC_WEB_PLUGIN,
      new WebPluginRpcParams(`${PUSH_PLUGIN_ID}.register_token`,
        new PushRegParams(token, deviceName, version)), false);
    const raw: string = JSON.stringify(res);
    st.reportedToken = token;
    st.reportedAt = now;
    st.failCount = 0;
    st.lastError = '';
    // ⛔ 只记掩码后的形态（前 6 后 4），绝不把真 token 写进日志
    log('push', `已上报本机 Push Token（${maskTokenForLog(token)}）name=${deviceName} ${raw.length > 0 ? '' : ''}`);
    return '本机推送已登记';
  } catch (e) {
    const reason: string = readableRpcError((e as Error).message);
    st.failCount = st.failCount + 1;
    st.lastError = reason;
    log('push', `上报 Push Token 失败：${reason}`);
    return `上报失败：${reason}`;
  }
}

/** 日志用掩码（与插件侧同一形态；⛔ 真 token 不进日志）。 */
export function maskTokenForLog(token: string): string {
  if (token.length <= 8) {
    return '***';
  }
  return `${token.substring(0, 6)}…${token.substring(token.length - 4)}`;
}
