/**
 * 手机操作能力（agent 的"手和眼"）—— 全部走 **App 自连 hdcd**（`probe/hdcclient.ets`），
 * 不依赖 Mac、不依赖 WDA、不依赖无障碍（`AccessibilityExtensionAbility` 的干活 API 自 API 12
 * 起全部 deprecated，`inputEventClient` 又要 `CONTROL_DEVICE`（system_basic）—— 都不是普通应用能用的）。
 *
 * 能力（都通过 `HDC` 通道执行 `uitest`，见 `shell` 命令）：
 *   · `uiDump()`      —— dump 当前整屏布局（JSON：accessibilityId/text/type/bounds/clickable）
 *   · `tap(x, y)`     —— 坐标点击
 *   · `swipe(...)`    —— 滑动
 *   · `inputText(s)`  —— 往当前焦点输入框输入（`uitest uiInput inputText`）
 *   · `keyEvent(n)`   —— 返回/Home 等按键
 *   · `screenshot(p)` —— 截图到 png（`uitest screenCap`）
 *
 * ⛔ 每次调用都是一次独立的 hdc 会话（认证 + 命令），目前**不做连接复用**：
 *    先保证正确性，长连接复用是后续优化（会让并发调用变复杂）。
 */
import { runHdcShell, HdcShellResult } from './hdcclient';

/** 统一的工具返回：`ok=false` 时 `error` 一定有值（⛔ 不静默失败）。 */
export class PhoneResult {
  ok: boolean = false;
  output: string = '';
  error: string = '';
}

const HOST: string = '127.0.0.1';
const PORT: number = 8710;
/** 单条命令的兜底等待（毫秒）；实际以输出哨兵为准提前返回。 */
const SHELL_TIMEOUT_MS: number = 8000;

async function sh(ctx: Context, command: string): Promise<PhoneResult> {
  const r: HdcShellResult = await runHdcShell(ctx, HOST, PORT, command, SHELL_TIMEOUT_MS);
  const out: PhoneResult = new PhoneResult();
  out.ok = r.ok;
  out.output = r.output;
  if (!r.ok) {
    out.error = r.log.length > 0 ? r.log : 'hdc 会话失败';
  }
  return out;
}

/** dump 当前整屏 UI 树（JSON 字符串）。写临时文件再 cat，避免大输出被截断/转义问题。 */
export async function uiDump(ctx: Context): Promise<PhoneResult> {
  const path: string = '/data/local/tmp/xbot-ui.json';
  const r: PhoneResult = await sh(ctx,
    `uitest dumpLayout -p ${path} >/dev/null 2>&1 && cat ${path} && echo`);
  if (!r.ok) {
    return r;
  }
  if (r.output.trim().length === 0) {
    r.ok = false;
    r.error = 'dumpLayout 无输出（前台可能是自绘界面）';
  }
  return r;
}

/** 坐标点击（px）。 */
export async function tap(ctx: Context, x: number, y: number): Promise<PhoneResult> {
  return await sh(ctx, `uitest uiInput click ${Math.round(x)} ${Math.round(y)}`);
}

/** 滑动（px）。 */
export async function swipe(ctx: Context, fromX: number, fromY: number,
  toX: number, toY: number, speed: number = 600): Promise<PhoneResult> {
  return await sh(ctx,
    `uitest uiInput swipe ${Math.round(fromX)} ${Math.round(fromY)} ${Math.round(toX)} ${Math.round(toY)} ${speed}`);
}

/** 往当前焦点输入框输入文本（⛔ 含空格/引号要用单引号包住并转义）。 */
export async function inputText(ctx: Context, text: string): Promise<PhoneResult> {
  const safe: string = text.replace(/'/g, `'\\''`);
  return await sh(ctx, `uitest uiInput inputText '${safe}'`);
}

/** 系统按键（如 2 = Home，4 = Back；具体编码随 uitest 版本）。 */
export async function keyEvent(ctx: Context, code: number): Promise<PhoneResult> {
  return await sh(ctx, `uitest uiInput keyEvent ${Math.round(code)}`);
}

/** 截图到 `path`（png）。 */
export async function screenshot(ctx: Context, path: string = '/data/local/tmp/xbot-shot.png'): Promise<PhoneResult> {
  return await sh(ctx, `uitest screenCap -p ${path}`);
}
