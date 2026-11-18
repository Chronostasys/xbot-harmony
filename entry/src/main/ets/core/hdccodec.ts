/**
 * hdc 线协议编解码（纯逻辑，脱机可测）—— 依据 OpenHarmony `developtools_hdc` 源码：
 *   · `src/common/session.cpp:1024-1032` 的 `PayloadHead`（`__attribute__((packed))`）
 *   · `src/common/session.h:160-166`：`flag[2] reserve[2] protocolVer headSize(u16 BE) dataSize(u32 BE)`
 *   · `src/common/serial_struct_define.h`：protobuf-lite（key = tag<<3 | wireType）
 *   · `SessionHandShake` 字段顺序（`serial_struct.h:78-88`）：
 *       1 banner / 2 authType / 3 sessionId / 4 connectKey / 5 buf / 6 version
 *   · `PayloadProtect` 字段顺序（`serial_struct.h:90-98`）：
 *       1 channelId / 2 commandFlag / 3 checkSum / 4 vCode
 *
 * ⛔ 全部是**纯函数**（无 socket / 无 kit）：socket 与 RSA 签名在 `probe/hdcclient.ets`。
 * ⛔ 判据 `tools/tests/hdc_codec.test.ts` 直接拿**真机抓包字节**做 golden：
 *    编出来的帧必须与 `hdc` 客户端发出的字节**逐字相同**，否则"能连上"只是自欺。
 */

const PACKET_FLAG_H: number = 0x48;   // 'H'
const PACKET_FLAG_W: number = 0x57;   // 'W'
/** `PayloadHead` packed 长度 = 2 + 2 + 1 + 2 + 4。 */
const HDC_HEAD_LEN: number = 11;
const HDC_PROTOCOL_VER: number = 1;

/** 读 varint 的结果（ArkTS 不支持元组返回）。 */
class VarintRead {
  value: number = 0;
  /** 读完后下一个字节的下标。 */
  next: number = 0;
  ok: boolean = false;
}

/** protobuf 风格的 varint 写入（7 位一组，最高位续位）。 */
function writeVarint(value: number, out: number[]): void {
  let v: number = value;
  // 无符号化（JS 位运算是 32 位有符号）
  if (v < 0) {
    v = v >>> 0;
  }
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v & 0x7f);
}

/** varint 读取；`ok=false` 表示数据被截断。 */
function readVarint(buf: Uint8Array, pos: number): VarintRead {
  const r: VarintRead = new VarintRead();
  let value: number = 0;
  let shift: number = 1;
  let i: number = pos;
  while (i < buf.length) {
    const b: number = buf[i];
    value += (b & 0x7f) * shift;
    shift *= 128;
    i++;
    if ((b & 0x80) === 0) {
      r.value = value;
      r.next = i;
      r.ok = true;
      return r;
    }
  }
  r.next = buf.length;
  return r;
}

/** protobuf 消息写入器（只覆盖 hdc 用到的两种：varint / 长度前缀）。 */
class MsgWriter {
  private bytes: number[] = [];

  /** 写 uint 字段（wireType 0）。 */
  uint(tag: number, value: number): MsgWriter {
    writeVarint(tag * 8, this.bytes);
    writeVarint(value, this.bytes);
    return this;
  }

  /** 写字符串字段（wireType 2，UTF-8）。 */
  str(tag: number, value: string): MsgWriter {
    const enc: Uint8Array = utf8Encode(value);
    writeVarint(tag * 8 + 2, this.bytes);
    writeVarint(enc.length, this.bytes);
    for (let i = 0; i < enc.length; i++) {
      this.bytes.push(enc[i]);
    }
    return this;
  }

  /** 写 bytes 字段（wireType 2）。 */
  bytesField(tag: number, value: Uint8Array): MsgWriter {
    writeVarint(tag * 8 + 2, this.bytes);
    writeVarint(value.length, this.bytes);
    for (let i = 0; i < value.length; i++) {
      this.bytes.push(value[i]);
    }
    return this;
  }

  toArray(): Uint8Array {
    const out: Uint8Array = new Uint8Array(this.bytes.length);
    for (let i = 0; i < this.bytes.length; i++) {
      out[i] = this.bytes[i];
    }
    return out;
  }
}

/** 一个解析出来的字段值（varint 或 原始字节）。 */
class MsgField {
  tag: number = 0;
  /** 0 = varint；2 = 长度前缀。 */
  wireType: number = 0;
  num: number = 0;
  raw: Uint8Array = new Uint8Array(0);
}

/** 解析 protobuf 消息（hdc 只用 varint / 长度前缀两种）。 */
function parseMsg(buf: Uint8Array): Map<number, MsgField> {
  const out: Map<number, MsgField> = new Map<number, MsgField>();
  let pos: number = 0;
  while (pos < buf.length) {
    const key: VarintRead = readVarint(buf, pos);
    if (!key.ok) {
      break;
    }
    pos = key.next;
    const tag: number = Math.floor(key.value / 8);
    const wt: number = key.value % 8;
    const f: MsgField = new MsgField();
    f.tag = tag;
    f.wireType = wt;
    if (wt === 0) {
      const v: VarintRead = readVarint(buf, pos);
      if (!v.ok) {
        break;
      }
      f.num = v.value;
      pos = v.next;
    } else if (wt === 2) {
      const len: VarintRead = readVarint(buf, pos);
      if (!len.ok) {
        break;
      }
      pos = len.next;
      const end: number = pos + len.value;
      f.raw = buf.slice(pos, end > buf.length ? buf.length : end);
      pos = end;
    } else {
      // hdc 不用 fixed64/fixed32；遇到未知类型直接停（避免错位读出脏数据）
      break;
    }
    out.set(tag, f);
  }
  return out;
}

/** 读字段的 UTF-8 文本（不存在 ⇒ 空串）。 */
function fieldText(m: Map<number, MsgField>, tag: number): string {
  const f: MsgField | undefined = m.get(tag);
  return f === undefined ? '' : utf8Decode(f.raw);
}

/** 读字段的数值（不存在 ⇒ 0）。 */
function fieldNum(m: Map<number, MsgField>, tag: number): number {
  const f: MsgField | undefined = m.get(tag);
  return f === undefined ? 0 : f.num;
}

/** 一帧 hdc 数据包（头部 + 载荷），供解析/落日志用。 */
export class HdcPacket {
  channelId: number = 0;
  commandFlag: number = 0;
  checkSum: number = 0;
  vCode: number = 0;
  payload: Uint8Array = new Uint8Array(0);
  /** 本帧在输入缓冲里占用的总字节数（用于流式拆包）。 */
  consumed: number = 0;
}

/**
 * 编码一帧（与 `HdcSessionBase::Send` 逐字节对齐）：
 * `PayloadHead(11) | PayloadProtect(protobuf) | data`
 */
export function encodeFrame(channelId: number, commandFlag: number, vCode: number,
  payload: Uint8Array): Uint8Array {
  // PayloadProtect：1 channelId / 2 commandFlag / 3 checkSum / 4 vCode（checkSum 恒 0：抓包里就是 0）
  const head: MsgWriter = new MsgWriter();
  head.uint(1, channelId);
  head.uint(2, commandFlag);
  head.uint(3, 0);
  head.uint(4, vCode);
  const headBytes: Uint8Array = head.toArray();

  const total: number = HDC_HEAD_LEN + headBytes.length + payload.length;
  const out: Uint8Array = new Uint8Array(total);
  out[0] = PACKET_FLAG_H;
  out[1] = PACKET_FLAG_W;
  out[2] = 0;
  out[3] = 0;
  out[4] = HDC_PROTOCOL_VER;
  // headSize / dataSize 都是**大端**
  out[5] = (headBytes.length >> 8) & 0xff;
  out[6] = headBytes.length & 0xff;
  out[7] = (payload.length >>> 24) & 0xff;
  out[8] = (payload.length >>> 16) & 0xff;
  out[9] = (payload.length >>> 8) & 0xff;
  out[10] = payload.length & 0xff;
  out.set(headBytes, HDC_HEAD_LEN);
  out.set(payload, HDC_HEAD_LEN + headBytes.length);
  return out;
}

/** 从缓冲区头部尝试解析一帧；不完整 ⇒ 返回 null（调用方继续攒字节）。 */
export function parseFrame(buf: Uint8Array): HdcPacket | null {
  if (buf.length < HDC_HEAD_LEN) {
    return null;
  }
  if (buf[0] !== PACKET_FLAG_H || buf[1] !== PACKET_FLAG_W) {
    // 不是 hdc 帧（例如被别的东西写进来了）——交给调用方丢弃 1 字节重试
    return null;
  }
  const headSize: number = (buf[5] << 8) | buf[6];
  const dataSize: number = (buf[7] * 16777216) + (buf[8] << 16) + (buf[9] << 8) + buf[10];
  const total: number = HDC_HEAD_LEN + headSize + dataSize;
  if (buf.length < total) {
    return null;
  }
  const headMsg: Map<number, MsgField> = parseMsg(buf.slice(HDC_HEAD_LEN, HDC_HEAD_LEN + headSize));
  const p: HdcPacket = new HdcPacket();
  p.channelId = fieldNum(headMsg, 1);
  p.commandFlag = fieldNum(headMsg, 2);
  p.checkSum = fieldNum(headMsg, 3);
  p.vCode = fieldNum(headMsg, 4);
  p.payload = buf.slice(HDC_HEAD_LEN + headSize, total);
  p.consumed = total;
  return p;
}

// ── UTF-8（ArkTS 侧不引额外依赖；只处理 BMP + 代理对）───────────────────────────
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let cp: number = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const low: number = s.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = ((cp - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
        i++;
      }
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  const arr: Uint8Array = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) {
    arr[i] = out[i];
  }
  return arr;
}

export function utf8Decode(buf: Uint8Array): string {
  let out: string = '';
  let i: number = 0;
  while (i < buf.length) {
    const b: number = buf[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
    } else if ((b & 0xe0) === 0xc0 && i + 1 < buf.length) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (buf[i + 1] & 0x3f));
      i += 2;
    } else if ((b & 0xf0) === 0xe0 && i + 2 < buf.length) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((buf[i + 1] & 0x3f) << 6)
        | (buf[i + 2] & 0x3f));
      i += 3;
    } else if ((b & 0xf8) === 0xf0 && i + 3 < buf.length) {
      const cp: number = ((b & 0x07) << 18) | ((buf[i + 1] & 0x3f) << 12)
        | ((buf[i + 2] & 0x3f) << 6) | (buf[i + 3] & 0x3f);
      const v: number = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      i += 4;
    } else {
      i++;
    }
  }
  return out;
}

// ── SessionHandShake / PayloadProtect 语义层 ────────────────────────────────────
/** 握手包（`SessionHandShake`）。 */
export class HdcHandshake {
  banner: string = '';
  authType: number = 0;
  sessionId: number = 0;
  connectKey: string = '';
  buf: Uint8Array = new Uint8Array(0);
  version: string = '';
}

/** `AuthVerifyType`（`src/common/auth.h`）：0 无认证 / 2 RSA3072_SHA512(旧) / 3 RSA3072_SHA512。 */
export const AUTH_NONE: number = 0;
export const AUTH_RSA_3072_SHA512: number = 3;

export function encodeHandshake(h: HdcHandshake): Uint8Array {
  // ⛔ **六个字段始终写**（即使为空/0）：抓包里第 2/3 步就是 `18 00`（sessionId=0）+
  //    `22 00`（connectKey 空串）都**显式存在**。省略字段会让 daemon 认为"未携带"而拒签。
  const w: MsgWriter = new MsgWriter();
  w.str(1, h.banner);
  w.uint(2, h.authType);
  w.uint(3, h.sessionId);
  w.str(4, h.connectKey);
  w.bytesField(5, h.buf);
  w.str(6, h.version);
  return w.toArray();
}

export function parseHandshake(payload: Uint8Array): HdcHandshake {
  const m: Map<number, MsgField> = parseMsg(payload);
  const h: HdcHandshake = new HdcHandshake();
  h.banner = fieldText(m, 1);
  h.authType = fieldNum(m, 2);
  h.sessionId = fieldNum(m, 3);
  h.connectKey = fieldText(m, 4);
  const bufField: MsgField | undefined = m.get(5);
  h.buf = bufField !== undefined ? bufField.raw : new Uint8Array(0);
  h.version = fieldText(m, 6);
  return h;
}

/** buf 里的 TLV（`Base::TlvAppend`）——本轮不消费（feature 串直接按抓包文本发送），故不导出。 */
