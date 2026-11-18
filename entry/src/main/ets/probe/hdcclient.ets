/**
 * hdc **客户端**（App 自连本机 hdcd）—— 目标：iOS self-runner 在鸿蒙上的等价物。
 *
 * 依据：OpenHarmony `developtools_hdc`（`session.h`/`serial_struct*.h`/`auth.cpp`）+ 真机抓包。
 * 编解码在 `core/hdccodec.ts`（golden 逐字节验过）；RSA-PSS/PKCS1 在 `hdccrypto.ets`。
 *
 * 认证链（抓包实证）：
 *   ① C→S handshake{authType=NONE, buf=<feature 串>, version}
 *   ② S→C handshake{authType=3}                     ← daemon 要求 RSA 认证
 *   ③ C→S handshake{authType=3, buf="hostname\x0c<PEM 公钥>"}
 *   ④ S→C handshake{buf=<挑战串>}
 *   ⑤ C→S handshake{buf=<base64 签名>}
 *   ⑥ S→C handshake{buf="… authstatus … SUCCESS …"}
 *
 * ⛔ 签名方案/输入口径没有文档，只能**枚举**（daemon 拒签会直接断连 ⇒ 换下一种重连）：
 *    PSS 或 PKCS1 × SHA512/SHA256 × 消息=挑战**文本**或**hex 解码后的字节**。
 * ⛔ 私钥：A 方案（rawfile，debug only，`.gitignore` 已挡）。发版前必须删。
 */
import { socket } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import {
  AUTH_NONE, AUTH_RSA_3072_SHA512, HdcHandshake, HdcPacket, encodeFrame, encodeHandshake,
  parseFrame, parseHandshake, utf8Decode, utf8Encode,
} from '../core/hdccodec';
import {
  parsePkcs8, pkcs1Encode, pssEncodeWith, RsaPrivate, rsaRawSign, sha256, sha512Of,
} from './hdccrypto';

const TAG: string = 'HDCAUTH';
const HDC_VERSION: string = 'Ver: 3.2.0f73c487f8b34a2ba5';
/** 抓包里首帧的 feature 串（94B，静态）。⛔ 末尾的 `,TCP,mac,heartbeat` **不能少**：
 *  daemon 靠它判定连接类型，缺了会进"非 TCP 会话"分支 ⇒ 认证被拒（E000010 DAEMON_UNAUTH）。 */
const HDC_FEATURE_TEXT: string =
  `authtype        1               1supportfeatures 29              Ver: 3.2.0f,TCP,mac,heartbeat`;

/** 认证结果。 */
export class HdcAuthResult {
  ok: boolean = false;
  log: string = '';
  sessionId: number = 0;
  /** 成功的签名变体（0..5；-1 = 全失败）。 */
  variant: number = -1;
}

function pemToDer(pem: string): Uint8Array {
  const lines: string[] = pem.split('\n');
  let body: string = '';
  for (let i = 0; i < lines.length; i++) {
    const l: string = lines[i].trim();
    if (l.length === 0 || l.startsWith('-----')) {
      continue;
    }
    body += l;
  }
  const helper: util.Base64Helper = new util.Base64Helper();
  return helper.decodeSync(body);
}

function b64(bytes: Uint8Array): string {
  const helper: util.Base64Helper = new util.Base64Helper();
  return helper.encodeToStringSync(bytes);
}

/** 挑战串 → hex 解码字节（不是 hex ⇒ 返回原文本字节）。 */
function challengeBytes(text: string): Uint8Array {
  if (text.length >= 2 && text.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(text)) {
    const n: number = text.length / 2;
    const out: Uint8Array = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = parseInt(text.substr(i * 2, 2), 16);
    }
    return out;
  }
  return utf8Encode(text);
}

function freshSessionId(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** 变体表：PSS(SHA512/SHA256) 与 PKCS1(SHA512/SHA256) × 文本/字节 = 8 种。 */
const VARIANT_COUNT: number = 8;

async function signVariant(key: RsaPrivate, challenge: string, variant: number): Promise<string> {
  const useBytes: boolean = (variant % 2) === 1;
  const msg: Uint8Array = useBytes ? challengeBytes(challenge) : utf8Encode(challenge);
  const half: number = Math.floor(variant / 2);
  if (half === 0) {
    // PSS + SHA-512（auth.cpp:RsaSign 的主路径）
    return b64(rsaRawSign(key, await pssEncodeWith(key, msg, true)));
  }
  if (half === 1) {
    // PSS + SHA-256（daemon 里 RSA_verify(NID_sha256,…) 的痕迹）
    return b64(rsaRawSign(key, await pssEncodeWith(key, msg, false)));
  }
  const hash: Uint8Array = half === 2 ? await sha512Of(msg) : await sha256(msg);
  return b64(rsaRawSign(key, pkcs1Encode(key, hash, half === 3)));
}

/** 一次完整尝试（新连接）；成功返回 ok=true，失败/断连返回 ok=false。 */
async function attempt(ctx: Context, host: string, port: number, variant: number,
  priPem: string): Promise<HdcAuthResult> {
  const res: HdcAuthResult = new HdcAuthResult();
  const notes: string[] = [];
  const tcp: socket.TCPSocket = socket.constructTCPSocketInstance();
  const addr: socket.NetAddress = { address: host, port: port, family: 1 };
  let buf: Uint8Array = new Uint8Array(0);
  let step: number = 0;

  const send = async (hs: HdcHandshake): Promise<void> => {
    const frame: Uint8Array = encodeFrame(0, 1, 9, encodeHandshake(hs));
    // ⛔ send 只接受 string | ArrayBuffer（传 Uint8Array ⇒ 401）
    await tcp.send({ data: frame.buffer as ArrayBuffer });
  };

  const result: Promise<HdcAuthResult> = new Promise<HdcAuthResult>((resolve: (v: HdcAuthResult) => void) => {
    let settled: boolean = false;
    const finish = (ok: boolean, why: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      res.ok = ok;
      notes.push(why);
      res.log = notes.join(' | ');
      try {
        tcp.close();
      } catch (e) {
        // 已关闭
      }
      resolve(res);
    };
    tcp.on('close', () => {
      finish(false, 'closed-by-peer');
    });
    tcp.on('error', (e: Object) => {
      finish(false, `sockerr:${(e as Error).message}`);
    });
    tcp.on('message', (info: socket.SocketMessageInfo) => {
      const incoming: Uint8Array = new Uint8Array(info.message);
      const merged: Uint8Array = new Uint8Array(buf.length + incoming.length);
      merged.set(buf, 0);
      merged.set(incoming, buf.length);
      buf = merged;
      for (;;) {
        const p: HdcPacket | null = parseFrame(buf);
        if (p === null) {
          break;
        }
        buf = buf.slice(p.consumed);
        const hs: HdcHandshake = parseHandshake(p.payload);
        notes.push(`s${step}:auth=${hs.authType}`);
        if (step === 0) {
          step = 1;
          const pemBytes: Uint8Array = utf8Encode(`${'xbot-harmony'}\x0c${priPem.length > 0 ? PUB_PEM : ''}`);
          console.info(`${TAG} step2 bufLen=${pemBytes.length} ` +
            `pemLen=${PUB_PEM.length} pemTail=${PUB_PEM.slice(-24).replace(/\n/g, '\\n')}`);
          const hs2: HdcHandshake = new HdcHandshake();
          hs2.banner = 'OHOS HDC';
          hs2.authType = AUTH_RSA_3072_SHA512;
          hs2.sessionId = 0;
          hs2.buf = pemBytes;
          hs2.version = HDC_VERSION;
          void send(hs2);
          return;
        }
        if (step === 1) {
          step = 2;
          const challenge: string = utf8Decode(hs.buf);
          const key: RsaPrivate = parsePkcs8(pemToDer(priPem));
          signVariant(key, challenge, variant).then((sig: string) => {
            if (variant <= 1) {
              console.info(`${TAG} SIGDUMP v${variant} ch=${challenge} sig=${sig}`);
            }
            const hs3: HdcHandshake = new HdcHandshake();
            hs3.banner = 'OHOS HDC';
            // ⛔ 逐字段比对抓包：签名帧的 authType 必须是**服务端挑战包里的值（2）**，
            //    不是常量 3（3 只用于第 2 步的公钥帧）。发错 daemon 直接断连。
            hs3.authType = hs.authType;
            hs3.sessionId = 0;
            hs3.buf = utf8Encode(sig);
            hs3.version = HDC_VERSION;
            void send(hs3);
          }).catch((e: Object) => {
            finish(false, `sign-fail:${(e as Error).message}`);
          });
          return;
        }
        const body: string = utf8Decode(hs.buf);
        notes.push(`final=${body}`);
        res.sessionId = hs.sessionId;
        finish(body.indexOf('SUCCESS') >= 0, body.indexOf('SUCCESS') >= 0 ? 'success' : 'auth-rejected');
        return;
      }
    });
  });

  try {
    await tcp.connect({ address: addr, timeout: 1500 });
    const hs1: HdcHandshake = new HdcHandshake();
    hs1.banner = 'OHOS HDC';
    hs1.authType = AUTH_NONE;
    hs1.sessionId = freshSessionId();
    hs1.connectKey = `${host}:${port}`;
    hs1.buf = utf8Encode(HDC_FEATURE_TEXT);
    hs1.version = HDC_VERSION;
    await send(hs1);
  } catch (e) {
    res.log = `connect-fail:${(e as Error).message}`;
    return res;
  }
  return result;
}

/** 公钥 PEM（rawfile 读取后在入口处赋值；静态字段避免层层传参）。 */
let PUB_PEM: string = '';

/**
 * 枚举全部签名变体直到 daemon 接受；返回首个成功结果。
 * ⛔ 每次变体都**新建连接**（daemon 拒签会断连；重连才算干净的一次尝试）。
 */
export async function runHdcAuth(ctx: Context, host: string, port: number): Promise<HdcAuthResult> {
  const priPem: string = utf8Decode(ctx.resourceManager.getRawFileContentSync('hdckey.pem'));
  PUB_PEM = utf8Decode(ctx.resourceManager.getRawFileContentSync('hdckey.pub.pem'));
  const logs: string[] = [];
  for (let v = 0; v < VARIANT_COUNT; v++) {
    const r: HdcAuthResult = await attempt(ctx, host, port, v, priPem);
    logs.push(`v${v}:${r.ok ? 'OK' : 'fail'}(${r.log})`);
    console.info(`${TAG} variant=${v} ok=${r.ok} ${r.log}`);
    if (r.ok) {
      r.variant = v;
      r.log = logs.join(' || ');
      return r;
    }
  }
  const out: HdcAuthResult = new HdcAuthResult();
  out.log = logs.join(' || ');
  console.info(`${TAG} all-variants-failed ${out.log}`);
  return out;
}

// ── shell 通道（认证通过后执行命令）────────────────────────────────────────────
/** `CMD_UNITY_EXECUTE`（`define_enum.h:158`）：带通道号的命令执行。 */
const CMD_UNITY_EXECUTE: number = 1001;

/** 命令结束哨兵：daemon 的 EOF 帧语义不稳定，用它做确定性收尾（⛔ 不依赖定时器）。 */
const SHELL_END: string = '__XBOT_END__';

export class HdcShellResult {
  ok: boolean = false;
  output: string = '';
  log: string = '';
}

/**
 * 连上 → 认证（variant 0 已验证可过）→ 用独立 channelId 发 `CMD_UNITY_EXECUTE` 跑命令。
 * 输出：同 channelId 的响应帧 payload 依次拼接，直到 daemon 发空载荷结束帧。
 */
export async function runHdcShell(ctx: Context, host: string, port: number,
  command: string, timeoutMs: number): Promise<HdcShellResult> {
  const res: HdcShellResult = new HdcShellResult();
  const priPem: string = utf8Decode(ctx.resourceManager.getRawFileContentSync('hdckey.pem'));
  PUB_PEM = utf8Decode(ctx.resourceManager.getRawFileContentSync('hdckey.pub.pem'));
  const tcp: socket.TCPSocket = socket.constructTCPSocketInstance();
  const addr: socket.NetAddress = { address: host, port: port, family: 1 };
  let buf: Uint8Array = new Uint8Array(0);
  let step: number = 0;
  let authed: boolean = false;
  const channelId: number = (Math.floor(Math.random() * 0xffffff) + 1) >>> 0;
  let out: string = '';
  const notes: string[] = [];

  const send = async (ch: number, cmd: number, hs: HdcHandshake): Promise<void> => {
    await tcp.send({ data: encodeFrame(ch, cmd, 9, encodeHandshake(hs)).buffer as ArrayBuffer });
  };

  const done: Promise<HdcShellResult> = new Promise<HdcShellResult>((resolve: (v: HdcShellResult) => void) => {
    let settled: boolean = false;
    const finish = (ok: boolean, why: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      res.ok = ok;
      res.output = out;
      notes.push(why);
      res.log = notes.join(' | ');
      try {
        tcp.close();
      } catch (e) {
        // 已关
      }
      resolve(res);
    };
    tcp.on('close', () => finish(authed && out.length > 0, 'closed'));
    tcp.on('error', (e: Object) => finish(false, `sockerr:${(e as Error).message}`));
    tcp.on('message', (info: socket.SocketMessageInfo) => {
      const incoming: Uint8Array = new Uint8Array(info.message);
      const merged: Uint8Array = new Uint8Array(buf.length + incoming.length);
      merged.set(buf, 0);
      merged.set(incoming, buf.length);
      buf = merged;
      for (;;) {
        const p: HdcPacket | null = parseFrame(buf);
        if (p === null) {
          break;
        }
        buf = buf.slice(p.consumed);
        if (!authed) {
          const hs: HdcHandshake = parseHandshake(p.payload);
          notes.push(`s${step}:auth=${hs.authType}`);
          if (step === 0) {
            step = 1;
            const hs2: HdcHandshake = new HdcHandshake();
            hs2.banner = 'OHOS HDC';
            hs2.authType = AUTH_RSA_3072_SHA512;
            hs2.sessionId = 0;
            hs2.buf = utf8Encode(`${'xbot-harmony'}\x0c${PUB_PEM}`);
            hs2.version = HDC_VERSION;
            void send(0, 1, hs2);
            return;
          }
          if (step === 1) {
            step = 2;
            const challenge: string = utf8Decode(hs.buf);
            const key: RsaPrivate = parsePkcs8(pemToDer(priPem));
            pssEncodeWith(key, utf8Encode(challenge), true).then((em: Uint8Array) => {
              const sig: string = b64(rsaRawSign(key, em));
              const hs3: HdcHandshake = new HdcHandshake();
              hs3.banner = 'OHOS HDC';
              hs3.authType = hs.authType;
              hs3.sessionId = 0;
              hs3.buf = utf8Encode(sig);
              hs3.version = HDC_VERSION;
              return send(0, 1, hs3);
            }).catch((e: Object) => finish(false, `sign:${(e as Error).message}`));
            return;
          }
          const body: string = utf8Decode(hs.buf);
          if (body.indexOf('SUCCESS') >= 0) {
            authed = true;
            notes.push('auth-ok');
            // 立即发命令（独立通道号）。⛔ 命令尾部追加**结束哨兵**：daemon 的 EOF 帧语义
            //    实测不稳定（多帧输出会被提前截断），用哨兵做确定性收尾，避免依赖定时器。
            const wrapped: string = `${command}; echo ${SHELL_END}`;
            const frame: Uint8Array = encodeFrame(channelId, CMD_UNITY_EXECUTE, 9, utf8Encode(wrapped));
            void tcp.send({ data: frame.buffer as ArrayBuffer });
            return;
          }
          finish(false, `auth-fail:${body.slice(0, 40)}`);
          return;
        }
        // 输出：非空载荷**全部追加**；见到结束哨兵 ⇒ 完成（确定性，不依赖定时器）。
        if (p.payload.length === 0) {
          finish(true, 'eof');
          return;
        }
        out += utf8Decode(p.payload);
        if (out.indexOf(SHELL_END) >= 0) {
          out = out.substring(0, out.indexOf(SHELL_END));
          finish(true, 'sentinel');
          return;
        }
      }
    });
  });

  try {
    await tcp.connect({ address: addr, timeout: 2000 });
    const hs1: HdcHandshake = new HdcHandshake();
    hs1.banner = 'OHOS HDC';
    hs1.authType = AUTH_NONE;
    hs1.sessionId = freshSessionId();
    hs1.connectKey = `${host}:${port}`;
    hs1.buf = utf8Encode(HDC_FEATURE_TEXT);
    hs1.version = HDC_VERSION;
    await send(0, 1, hs1);
  } catch (e) {
    res.log = `连不上本机 hdcd（127.0.0.1:8710）：${(e as Error).message}。`
      + `设备需开启 TCP 调试口：\`hdc tmode port 8710\`（模拟器不支持该指令）。`;
    return res;
  }
  return done;
}
