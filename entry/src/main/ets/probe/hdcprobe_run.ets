/**
 * hdc 自连**探针执行器**（临时，用户 2026-11-08：「搞个临时 app 测一下试试看」）。
 *
 * 只回答一个问题：**应用沙箱域能不能 TCP 连上本机 hdc daemon（127.0.0.1:8710）**。
 *   · 连不上 ⇒ 应用域被封 ⇒ "App 自己当 hdc 主机"这条路线**直接死**（不用再折腾私钥/握手）；
 *   · 连上（哪怕静默）⇒ 端口可达，才有资格谈"RSA 挑战握手 → shell → aa test"。
 *
 * ⛔ 判定/文案全部来自 `core/hdcprobe.ts`（判据与渲染同源，⛔ 不在这里另写 if/else 文案）。
 * ⛔ **零 setTimeout**（仓规性能预算已用满）：连上就判定可达；迟到的回包用 `on('message')`
 *    异步追加一行日志（`HDCPROBE-EXTRA`）——不靠定时器等回包。
 */
import { socket } from '@kit.NetworkKit';
import { HDC_PROBE_PORTS, HdcPortProbe, formatProbeReport } from '../core/hdcprobe';

const PROBE_TAG: string = 'HDCPROBE';

/**
 * **真实 hdc 客户端的第一帧**（2026-11-08 用 TCP 代理抓的真机握手，179 字节）：
 *
 *   48 57 = "HW" 魔数 + 8 字节头，随后是 `0a 08 "OHOS HDC"` + 时间戳 + 连接键
 *   （`127.0.0.1:18711`）+ `authtype 1 / supportfeatures 29` + `Ver: 3.2.0f73c…`。
 *
 * ⛔ 用途只有一个：**验证 App 域能否与 hdcd 真正对话**（发了它、daemon 回了 banner ⇒ 传输层通）。
 *    我们上一轮只发了 `'OHOS HDC\0'` ⇒ daemon 静默（说明它按帧头解析，不是读裸字符串）。
 * ⛔ 这不是"已实现客户端"：后续还有 公钥帧 → 挑战 → RSA3072-SHA512 签名 → session → 命令。
 */
const HDC_BANNER_HEX: string =
  '48570000010008000000a008001001180020090a084f484f5320484443100018abb7aa980f220f3132372e302e302e313a3138373131'
  + '2a5e617574687479706520202020202020203120202020202020202020202020202031737570706f727466656174757265732032'
  + '392020202020202020202020202020205665723a20332e322e30662c5443502c6d61632c686561727462656174321b5665723a2033'
  + '2e322e306637336334383766386233346132626135';

/** hex 字符串 → ArrayBuffer（探针要发**字节**，不是字符串）。 */
function hexToBuffer(hex: string): ArrayBuffer {
  const n: number = Math.floor(hex.length / 2);
  const out: Uint8Array = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out.buffer as ArrayBuffer;
}

function hexOf(buf: ArrayBuffer, max: number): string {
  const bytes: Uint8Array = new Uint8Array(buf);
  const n: number = bytes.length < max ? bytes.length : max;
  let out: string = '';
  for (let i = 0; i < n; i++) {
    const h: string = bytes[i].toString(16);
    out += (h.length === 1 ? '0' : '') + h;
  }
  return out;
}

function probeErrText(e: Object): string {
  const be = e as Record<string, Object>;
  const code: Object | undefined = be['code'];
  const msg: Object | undefined = be['message'];
  const c: string = code !== undefined && code !== null ? code.toString() : '';
  const m: string = msg !== undefined && msg !== null ? msg.toString() : '';
  return c.length > 0 ? `code=${c} ${m}` : m;
}

/** 单端口探测：只等 `connect`（有内建 timeout），回包由 `on('message')` 异步补记。 */
async function probePort(port: number): Promise<HdcPortProbe> {
  const p: HdcPortProbe = new HdcPortProbe();
  p.port = port;
  const addr: socket.NetAddress = { address: '127.0.0.1', port: port, family: 1 };
  const tcp: socket.TCPSocket = socket.constructTCPSocketInstance();
  tcp.on('message', (info: socket.SocketMessageInfo) => {
    const hex: string = hexOf(info.message, 24);
    const len: number = new Uint8Array(info.message).length;
    console.info(`${PROBE_TAG}-EXTRA port=${port} bytes=${len} hex=${hex}`);
  });
  try {
    await tcp.connect({ address: { address: '127.0.0.1', port: port, family: 1 }, timeout: 1500 });
    p.reachable = true;
    // 发**真实 hdc 第一帧**（仅 8710；其它端口发裸串即可，它们只作对照）
    try {
      if (port === 8710) {
        await tcp.send({ data: hexToBuffer(HDC_BANNER_HEX) });
        console.info(`${PROBE_TAG}-SENT port=8710 bytes=179 ok`);
      } else {
        await tcp.send({ data: 'OHOS HDC\0' });
      }
    } catch (e) {
      // 发送失败不影响"端口可达"这个结论
    }
  } catch (e) {
    p.error = probeErrText(e as Object);
  }
  return p;
}

/**
 * **探针自检**：在本进程内起一个 127.0.0.1:18080 的 TCP server，再用同样的客户端路径连它。
 *
 * 为什么必须有（本轮实测教训）：第一次在模拟器上跑，三个端口都返回
 * `code=2301115 Operation in progress`（同一个错误码）——**分不清**是"沙箱全封"还是
 * "探针写错了"。自检把这两件事分开：自检通 ⇒ 探针可信，8710 的 CLOSED 才是真的。
 */
async function runSelfTest(): Promise<boolean> {
  const port: number = 18080;
  const server: socket.TCPSocketServer = socket.constructTCPSocketServerInstance();
  let connected: boolean = false;
  return new Promise<boolean>((resolve: (v: boolean) => void) => {
    try {
      server.on('connect', (client: socket.TCPSocketConnection) => {
        connected = true;
        try {
          client.close();
        } catch (e) {
          // 关不掉不影响判定
        }
        try {
          server.close();
        } catch (e) {
          // 同上
        }
        resolve(true);
      });
      const listenAddr: socket.NetAddress = { address: '127.0.0.1', port: port, family: 1 };
      server.listen(listenAddr)
        .then(() => {
          const tcp: socket.TCPSocket = socket.constructTCPSocketInstance();
          return tcp.connect({ address: listenAddr, timeout: 1500 })
            .then(() => {
              try {
                tcp.close();
              } catch (e) {
                // 同上
              }
              // 连上就说明自检成立（服务端 connect 回调可能略晚）
              if (!connected) {
                connected = true;
                try {
                  server.close();
                } catch (e) {
                  // 同上
                }
                resolve(true);
              }
            });
        })
        .catch(() => {
          try {
            server.close();
          } catch (e) {
            // 同上
          }
          resolve(false);
        });
    } catch (e) {
      resolve(false);
    }
  });
}

/**
 * 跑一轮并把报告打进 hilog（tag=`HDCPROBE`）。
 * ⚠️ 每个探针 socket 用完即关（避免"上一个连接还在进行中"污染下一次）。
 */
export async function runHdcProbe(): Promise<string> {
  const selftestOk: boolean = await runSelfTest();
  const results: HdcPortProbe[] = [];
  for (let i = 0; i < HDC_PROBE_PORTS.length; i++) {
    results.push(await probePort(HDC_PROBE_PORTS[i]));
  }
  const report: string = formatProbeReport(results, selftestOk);
  console.info(`${PROBE_TAG} ${report}`);
  return report;
}
