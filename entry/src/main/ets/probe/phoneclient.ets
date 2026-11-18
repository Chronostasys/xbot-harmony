/**
 * 手机操作**命令拉取器**（客户端侧）。
 *
 * ⛔ 架构纠正（用户 2026-11-08）：**不允许**用手机内网 IP 被服务端直连。
 *    正确链路 = 服务端下发 / 客户端自取：
 *
 *      xbot 插件（Mac 上，端口 8791）维护命令队列
 *          ↑ 长轮询 GET /poll?wait=25000            ↓ POST /result
 *      客户端（本文件，在手机上）→ 执行（hdcphone → hdcd 自连 → uitest）→ 回传结果
 *
 *    客户端只需要能访问**xbot 后端所在的 Mac**（它本来就连得上），不需要任何入站可达性。
 * ⛔ 不是"高频轮询"：长轮询（服务端挂住 25s，有命令立刻返回），空闲时几乎零开销。
 */
import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { currentLinkBase } from '../core/msgops';
import { readCachedServerUrl } from '../core/config';
import { commandUrl, parseCmd, PhoneCmd, splitCommands } from '../core/phonecmd';
import { keyEvent, PhoneResult, screenshot, swipe, inputText, tap, uiDump } from './hdcphone';

const POLL_WAIT_MS: number = 25000;

let started: boolean = false;
let running: boolean = false;

async function execute(ctx: Context, c: PhoneCmd): Promise<PhoneResult> {
  if (c.tool === 'phone_dump_ui') {
    return await uiDump(ctx);
  }
  if (c.tool === 'phone_tap') {
    return await tap(ctx, c.x, c.y);
  }
  if (c.tool === 'phone_swipe') {
    return await swipe(ctx, c.x1, c.y1, c.x2, c.y2);
  }
  if (c.tool === 'phone_input_text') {
    return await inputText(ctx, c.text);
  }
  if (c.tool === 'phone_key') {
    return await keyEvent(ctx, c.code);
  }
  if (c.tool === 'phone_screenshot') {
    return await screenshot(ctx);
  }
  const bad: PhoneResult = new PhoneResult();
  bad.ok = false;
  bad.error = `未知工具 ${c.tool}`;
  return bad;
}

async function postResult(url: string, id: string, r: PhoneResult): Promise<void> {
  const body: string = JSON.stringify({ id, ok: r.ok, output: r.output, error: r.error });
  const req: http.HttpRequest = http.createHttp();
  try {
    await req.request(`${url}/result`, {
      method: http.RequestMethod.POST,
      header: { 'Content-Type': 'application/json' },
      extraData: body,
      connectTimeout: 5000,
      readTimeout: 5000,
    });
  } catch (e) {
    console.error(`PHONECLIENT 回传失败 ${(e as BusinessError).message}`);
  } finally {
    req.destroy();
  }
}

/** 主循环：长轮询 → 执行 → 回传（串行，天然有序）。 */
async function loop(ctx: Context): Promise<void> {
  running = true;
  let failures: number = 0;
  while (running) {
    // 登录前 `currentLinkBase()` 为空 ⇒ 回落到已保存的后端地址（冷启动就能开始拉命令）
    const baseUrl: string = currentLinkBase().length > 0 ? currentLinkBase() : readCachedServerUrl(ctx);
    const url: string = commandUrl(baseUrl);
    if (url.length === 0) {
      // 还没登录/拿到后端地址：稍后再试（不阻塞启动）
      await sleep(3000);
      continue;
    }
    const req: http.HttpRequest = http.createHttp();
    let body: string = '';
    try {
      const resp: http.HttpResponse = await req.request(`${url}/poll?wait=${POLL_WAIT_MS}`, {
        method: http.RequestMethod.GET,
        connectTimeout: 8000,
        readTimeout: POLL_WAIT_MS + 8000,
      });
      if (resp.responseCode === 200 && typeof resp.result === 'string') {
        body = resp.result as string;
        failures = 0;
      } else {
        failures++;
      }
    } catch (e) {
      failures++;
      if (failures === 1 || failures % 20 === 0) {
        console.warn(`PHONECLIENT poll 失败(${failures}) ${url}: ${(e as BusinessError).message}`);
      }
    } finally {
      req.destroy();
    }
    if (body.length > 0) {
      const items: string[] = splitCommands(body);
      for (let i = 0; i < items.length; i++) {
        const raw: string = items[i];
        const c: PhoneCmd = parseCmd(raw);
        if (c.id.length === 0) {
          continue;
        }
        const r: PhoneResult = await execute(ctx, c);
        await postResult(url, c.id, r);
      }
      continue;   // 有活就立刻再取
    }
    // 空闲：长轮询本身已经阻塞了 25s，这里只是防抖
    if (failures > 0) {
      await sleep(Math.min(2000 + failures * 500, 15000));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(() => resolve(), ms);
  });
}

/**
 * 启动命令拉取（幂等）。在 `EntryAbility.onCreate` 调用；拿不到后端地址会自动等待重试。
 */
export function startPhoneClient(ctx: Context): void {
  if (started) {
    return;
  }
  started = true;
  void loop(ctx).catch((e: Object) => {
    console.error(`PHONECLIENT 退出 ${(e as Error).message}`);
    running = false;
    started = false;
  });
}
