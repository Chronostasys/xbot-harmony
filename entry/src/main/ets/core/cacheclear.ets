/**
 * cacheclear —— 「清除缓存」动作的**纯逻辑**（可脱机单测）。
 *
 * 权威基准（web `web/src/components/settings/SettingsGeneral.tsx:34-37` +
 * `web/src/lib/webCache.ts:251-266`）：`clearCache = clearWebCaches() + window.location.reload()`。
 * web 清的是「客户端恢复态缓存」（SSE seq/迭代/快照/代次四个内存 Map + localStorage 会话树
 * 首绘缓存 + 标注键），随后整页 reload 把内存态归零。
 *
 * ── 原生语义（差集见 docs/WEB-PARITY.md §P7）──────────────────────────────────
 *   原生**没有** web 的那一层缓存：无 localStorage 会话树（0 命中）、无标注存储、
 *   历史按需 RPC 拉取且渲染层不自建恢复缓存 ⇒ 「内存态复位」在原生等于切换会话时
 *   既有快照重建，无需按钮。
 *   原生**独有**（价值面）：ArkWeb WebView 的网页数据（Web SQL / localStorage）与
 *   HTTP 缓存 —— 插件面板 / Web 设置分区用 WebView 加载，缓存体积随使用增长。
 *   ⇒ 本动作 = 清 ArkWeb 两项（`WebStorage.deleteAllData` + `WebviewController.removeAllCache(true)`）。
 *   ⛔ 不清 Cookie（`WebCookieManager` 有 API 但清了会丢插件面板登录态）——
 *     与 web clearWebCaches 不动登录 token 同语义。⛔ 不清应用 preferences（主题/开发者开关）。
 *
 * 判据与渲染同源：**全部反馈文案只从这里出口**（组件不另写字符串拼接）。
 */

/** 两个清理步骤的固定 id（文案与测试引用；不参与渲染顺序决策）。 */
export const CLEAR_STEP_WEB_DATA: string = 'webdata';
export const CLEAR_STEP_WEB_CACHE: string = 'webcache';

/** 步骤中文标签（note 拼接用；**唯一消费点** = clearCacheNote / clearCacheDetail）。 */
function stepLabel(step: string): string {
  if (step === CLEAR_STEP_WEB_DATA) {
    return '网页数据';
  }
  return '网页缓存';
}

/**
 * 聚合两步清理的**结果文案**。
 *
 * 三态（判别力测试钉死）：
 *   - 双成 ⇒ 成功文案（一句，不带步骤清单）；
 *   - 单败 ⇒ 部分成功（保留双步骤语义：谁失败谁入列）；
 *   - 双败 ⇒ 失败文案（detail 交给 clearCacheDetail 单独渲染，不在本函数）。
 *
 * @param webDataOk 网页数据清理是否成功
 * @param webCacheOk 网页缓存清理是否成功
 * @returns 呈现给用户的一行 note（恒非空）
 */
export function clearCacheNote(webDataOk: boolean, webCacheOk: boolean): string {
  if (webDataOk && webCacheOk) {
    return '已清除 WebView 缓存与网页数据（登录态与偏好不受影响）。';
  }
  if (webDataOk || webCacheOk) {
    const failed: string = !webCacheOk ? stepLabel(CLEAR_STEP_WEB_CACHE) : stepLabel(CLEAR_STEP_WEB_DATA);
    return `部分清除：${failed}清除失败，可稍后重试。`;
  }
  return '清除失败，请稍后重试。';
}

/**
 * 失败步骤的可读原因（与 note 分开渲染：note = 一行结论，detail = 逐行原因）。
 *
 * @param failures `{step, reason}[]`（组件层 try-catch 收集；成功步骤不入列）
 * @returns 多行字符串；**无失败 ⇒ 空串**（渲染层用空串判隐藏，⛔ 不再造第三态）
 */
export function clearCacheDetail(failures: ClearFailure[]): string {
  if (failures.length === 0) {
    return '';
  }
  const lines: string[] = [];
  for (let i = 0; i < failures.length; i++) {
    lines.push(`${stepLabel(failures[i].step)}：${failures[i].reason}`);
  }
  return lines.join('\n');
}

/** 一次失败的记录（step = CLEAR_STEP_*；reason = 组件层 catch 到的可读原因）。 */
export class ClearFailure {
  step: string = '';
  reason: string = '';

  constructor(step: string, reason: string) {
    this.step = step;
    this.reason = reason;
  }
}

/** 清理动作的聚合结果（组件 @State 消费的完整形态）。 */
export class ClearCacheResult {
  ok: boolean = false;
  note: string = '';
  detail: string = '';

  /**
   * @param failures 组件层两步 try-catch 收集的失败清单（空 ⇒ 全成）
   *   ⛔ 本构造函数即"判据与渲染同源"的接线点：note/detail 只从它派生。
   */
  constructor(failures: ClearFailure[]) {
    const webDataOk: boolean = !hasStep(failures, CLEAR_STEP_WEB_DATA);
    const webCacheOk: boolean = !hasStep(failures, CLEAR_STEP_WEB_CACHE);
    this.ok = failures.length === 0;
    this.note = clearCacheNote(webDataOk, webCacheOk);
    this.detail = clearCacheDetail(failures);
  }
}

function hasStep(failures: ClearFailure[], step: string): boolean {
  for (let i = 0; i < failures.length; i++) {
    if (failures[i].step === step) {
      return true;
    }
  }
  return false;
}
