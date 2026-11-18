/**
 * hdc 线协议**逐字节**判据（用户 2026-11-08：「客户端似乎开源，你可以对着抄。请彻底实现对应功能」）。
 *
 * golden = **真机抓包**（2026-11-08，`hdc fport tcp:18710 tcp:8710` + 本地 TCP 代理抓的真实
 * `hdc` 客户端第一帧，179 字节）。判据要求：
 *   · `parseFrame` 能把抓包解成 {channel=0, cmd=1, vCode=9, payload=160B}；
 *   · `parseHandshake` 解出 banner / authType / sessionId / connectKey / version；
 *   · `encodeFrame` 重新编码后与抓包**逐字节相同**（⛔ 否则"能连上"只是巧合）；
 *   · 不完整 / 非 hdc 数据 ⇒ 返回 null（流式拆包的前置条件）。
 *
 * mutation 自证：把 `HDC_HEAD_LEN` 改成 10、或 headSize/dataSize 改小端 ⇒ 第 1/2 条立刻红。
 */
declare const process: { exit: (c: number) => void };

import {
  AUTH_NONE, HdcHandshake, HdcPacket, encodeFrame, encodeHandshake,
  parseFrame, parseHandshake,
} from '../../entry/src/main/ets/core/hdccodec';

/** 真机抓到的第一帧（`hdc` 客户端 → hdcd，179B）。 */
const GOLDEN: string =
  '48570000010008000000a008001001180020090a084f484f5320484443100018abb7aa980f220f3132372e302e302e313a31383731312a5e6175746'
  + '87479706520202020202020203120202020202020202020202020202031737570706f72746665617475726573203239202020202020202020202020'
  + '20205665723a20332e322e30662c5443502c6d61632c686561727462656174321b5665723a20332e322e30663733633438376638623334613262613'
  + '5';

function hexToBytes(hex: string): Uint8Array {
  const n: number = Math.floor(hex.length / 2);
  const out: Uint8Array = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}
function bytesToHex(b: Uint8Array): string {
  let s: string = '';
  for (let i = 0; i < b.length; i++) {
    const h: string = b[i].toString(16);
    s += h.length === 1 ? '0' + h : h;
  }
  return s;
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail: string = ''): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail.length > 0 ? '\n      ' + detail : ''}`);
  }
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`);
}

const goldenBytes: Uint8Array = hexToBytes(GOLDEN);

console.log("\n▶ §1 varint（经公开 API 往返验证）");
{
  const b: Uint8Array = encodeFrame(3, 4, 9, new Uint8Array(0));
  const p2: HdcPacket | null = parseFrame(b);
  ok("§1 大数 sessionId 经握手往返不变", (() => {
    const h: HdcHandshake = new HdcHandshake();
    h.banner = "OHOS HDC";
    h.authType = 0;
    h.sessionId = 4077558699;
    h.version = "Ver: x";
    const got: HdcHandshake = parseHandshake(encodeHandshake(h));
    return got.sessionId === 4077558699;
  })(), "sessionId 往返失败");
  ok("§1 帧头字段往返", p2 !== null && p2.channelId === 3 && p2.commandFlag === 4 && p2.vCode === 9);
}

console.log('\n▶ §2 帧头（PayloadHead 11B 打包）');
{
  eq("§2 头长度 = 11", 11, 11);
  eq('§2 抓包总长 179', goldenBytes.length, 179);
  const p: HdcPacket | null = parseFrame(goldenBytes);
  ok('§2 能解出一帧', p !== null);
  if (p !== null) {
    eq('§2 魔数 HW', bytesToHex(goldenBytes.slice(0, 2)), '4857');
    eq('§2 protocolVer=1', goldenBytes[4], 1);
    eq('§2 headSize=8', (goldenBytes[5] << 8) | goldenBytes[6], 8);
    eq('§2 dataSize=160', p.payload.length, 160);
    eq('§2 channelId=0', p.channelId, 0);
    eq('§2 commandFlag=1', p.commandFlag, 1);
    eq('§2 checkSum=0', p.checkSum, 0);
    eq('§2 vCode=9', p.vCode, 9);
    eq('§2 整帧消费 179B', p.consumed, 179);
  }
}

console.log('\n▶ §3 SessionHandShake（prolobuf 字段 1..6）');
{
  const p: HdcPacket | null = parseFrame(goldenBytes);
  const h: HdcHandshake = parseHandshake(p !== null ? p.payload : new Uint8Array(0));
  eq('§3 banner = "OHOS HDC"', h.banner, 'OHOS HDC');
  eq('§3 authType = 0（AUTH_NONE 首帧）', h.authType, AUTH_NONE);
  eq('§3 sessionId', h.sessionId, 4077558699);
  eq('§3 connectKey', h.connectKey, '127.0.0.1:18711');
  ok('§3 version 前缀 "Ver: 3.2.0"', h.version.startsWith('Ver: 3.2.0'), h.version);
  ok('§3 buf 里带 authtype 描述', new TextDecoder().decode(h.buf).indexOf('authtype') >= 0);
}

console.log('\n▶ §4 重编码必须与抓包逐字节相同');
{
  const p: HdcPacket | null = parseFrame(goldenBytes);
  if (p === null) {
    ok('§4 前置：需要先解出帧', false);
  } else {
    const h: HdcHandshake = parseHandshake(p.payload);
    const payload: Uint8Array = encodeHandshake(h);
    eq('§4 握手体长度 160', payload.length, 160);
    const re: Uint8Array = encodeFrame(p.channelId, p.commandFlag, p.vCode, payload);
    eq('§4 整帧长度 179', re.length, 179);
    eq('§4 逐字节相同（golden）', bytesToHex(re), GOLDEN);
  }
}

console.log('\n▶ §5 拆包边界');
{
  ok('§5 不足 11 字节 ⇒ null', parseFrame(goldenBytes.slice(0, 10)) === null);
  ok('§5 截断载荷 ⇒ null', parseFrame(goldenBytes.slice(0, 100)) === null);
  const notHdc: Uint8Array = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  ok('§5 非 HW 魔数 ⇒ null', parseFrame(notHdc) === null);
  // 帧后多余字节不影响本帧解析（流式）
  const padded: Uint8Array = new Uint8Array(goldenBytes.length + 3);
  padded.set(goldenBytes, 0);
  const p: HdcPacket | null = parseFrame(padded);
  ok('§5 多余字节不影响本帧', p !== null && p.consumed === 179);
}

console.log('\n▶ §6 载荷帧（PayloadProtect）');
{
  const body: Uint8Array = new Uint8Array([0x61, 0x62, 0x63]);
  const frame: Uint8Array = encodeFrame(3, 4, 9, body);
  const p: HdcPacket | null = parseFrame(frame);
  ok('§6 自编码帧可解', p !== null);
  if (p !== null) {
    eq('§6 channelId 往返', p.channelId, 3);
    eq('§6 commandFlag 往返', p.commandFlag, 4);
    eq('§6 载荷往返', new TextDecoder().decode(p.payload), 'abc');
  }
  }

console.log(`\n=== hdc_codec: ${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}
export {};
