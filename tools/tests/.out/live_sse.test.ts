/**
 * 真实服务端 SSE 链路验证（**只读**：订阅事件流，不写任何数据）。
 *
 * 用法：XBOT_E2E_BASE=http://127.0.0.1:16000 XBOT_E2E_USER=adm XBOT_E2E_PASS=*** \
 *       XBOT_E2E_CHAT=chat_XXX tools/tests/run.sh
 *
 * 为什么必须有：SSE 客户端是自研的（ArkTS 无 EventSource）—— `requestInStream` 分块接收、
 * `id:/event:/data:` 帧解析、心跳、`Last-Event-ID` 续传。这是整份代码里最复杂、
 * 也最容易"真机上完全收不到事件"的部分，必须用真服务端验一次。
 */
import { SseClient } from './sse';
import { XbotHttp } from './http';

declare const process: { env: Record<string, string>; exit: (c: number) => void };

const BASE = process.env.XBOT_E2E_BASE;
const USER = process.env.XBOT_E2E_USER || 'admin';
const PASS = process.env.XBOT_E2E_PASS || 'admin';
const CHAT = process.env.XBOT_E2E_CHAT || '';
const WAIT_MS = 12000;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

async function main(): Promise<void> {
  if (BASE === undefined || BASE.length === 0 || CHAT.length === 0) {
    console.log('live_sse.test: 跳过（需 XBOT_E2E_BASE 与 XBOT_E2E_CHAT）');
    process.exit(0);
  }
  const http = new XbotHttp(BASE);
  await http.login(USER, PASS);

  const events: string[] = [];
  const sse = new SseClient(BASE);
  sse.connect(CHAT, 'web', http.cookieHeaderForStream(), (event: string, data: string) => {
    events.push(event);
    if (events.length <= 5) {
      console.log(`  ← 事件 ${event} (${data.length} 字节) ${data.substring(0, 100)}`);
    }
  });

  await new Promise<void>((resolve: () => void) => setTimeout(() => resolve(), WAIT_MS));
  sse.close();

  const uniq: string[] = Array.from(new Set(events));
  console.log(`=== SSE 实测（chat=${CHAT}, ${WAIT_MS / 1000}s）===`);
  console.log(`  收到事件 ${events.length} 个，类型: ${uniq.join(', ') || '(无)'}`);
  ok('SSE 能连上并收到事件（心跳即证明链路通）', events.length > 0, '0 事件');
  ok('事件类型都在客户端白名单内（无未知类型）',
    uniq.every((e) => ['heartbeat', 'progress_structured', 'stream_content', 'text', 'session',
      'user_echo', 'ask_user', 'ask_user_resolved', 'sync_progress', 'resync_required',
      'queue_state', 'runner_status', 'web_widgets', 'plugin_widgets', 'inject_user', 'card',
      'bg_task_output'].indexOf(e) >= 0), uniq.join(','));

  console.log(`live_sse.test: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
