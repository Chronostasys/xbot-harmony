/**
 * RSA-PSS 签名（自实现）—— 为什么必须自己写：
 *
 *   hdc 的 daemon 用 `auth.cpp:RsaSign` 校验：**RSA-PKCS1-PSS + SHA-512 + salt=digestlen**。
 *   本机 SDK 的 `cryptoFramework` 只支持 `RSA3072|SHA512|PKCS1`（实测 PSS 串全部
 *   `create c sign fail`）⇒ 只能自己做 EMSA-PSS 编码 + 裸 RSA 私钥运算（m^d mod n）。
 *
 * 组成：
 *   ① PKCS#8 DER 解析 → (n, d)          —— 纯函数，可脱机单测
 *   ② EMSA-PSS 编码（RFC 8017 §9.1.1）  —— SHA-512 走 cryptoFramework（该 API 可用）
 *   ③ RSA 私钥运算 s = m^d mod n        —— BigInt 快速幂
 */
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { utf8Encode } from '../core/hdccodec';

/** RSA 私钥最小子集（只用来做 s = m^d mod n）。 */
export class RsaPrivate {
  n: bigint = 0n;
  e: bigint = 0n;
  d: bigint = 0n;
  /** 模长（字节）= 384（3072 位）。 */
  modBytes: number = 0;
}

// ── DER ──────────────────────────────────────────────────────────────────────
class DerReader {
  buf: Uint8Array;
  pos: number = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  /** 读 TLV：返回 {tag, value}；`pos` 前进到下一个 TLV。 */
  next(): DerTlv {
    const tag: number = this.buf[this.pos];
    this.pos++;
    let len: number = this.buf[this.pos];
    this.pos++;
    if ((len & 0x80) !== 0) {
      const n: number = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) {
        len = len * 256 + this.buf[this.pos];
        this.pos++;
      }
    }
    const value: Uint8Array = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    return new DerTlv(tag, value);
  }
}

class DerTlv {
  tag: number = 0;
  value: Uint8Array = new Uint8Array(0);

  constructor(tag: number, value: Uint8Array) {
    this.tag = tag;
    this.value = value;
  }
}

/** DER INTEGER（无符号大端，可能带前导 0x00）→ BigInt。 */
function derInt(bytes: Uint8Array): bigint {
  let v: bigint = 0n;
  for (let i = 0; i < bytes.length; i++) {
    v = (v << 8n) | BigInt(bytes[i]);
  }
  return v;
}

/**
 * 解析 PKCS#8（`-----BEGIN PRIVATE KEY-----` 的 DER）：
 * PrivateKeyInfo ::= SEQUENCE { version, AlgorithmIdentifier, privateKey OCTET STRING }
 * RSAPrivateKey ::= SEQUENCE { version, n, e, d, p, q, dp, dq, qinv }
 */
export function parsePkcs8(der: Uint8Array): RsaPrivate {
  const top: DerReader = new DerReader(der);
  const seq: DerTlv = top.next();
  const body: DerReader = new DerReader(seq.value);
  body.next();                    // version INTEGER
  body.next();                    // AlgorithmIdentifier SEQUENCE
  const octets: DerTlv = body.next();   // privateKey OCTET STRING（内容 = RSAPrivateKey DER）
  const rsaReader: DerReader = new DerReader(octets.value);
  const rsaSeq: DerTlv = rsaReader.next();
  const f: DerReader = new DerReader(rsaSeq.value);
  f.next();                       // version
  const key: RsaPrivate = new RsaPrivate();
  key.n = derInt(f.next().value);
  key.e = derInt(f.next().value);
  key.d = derInt(f.next().value);
  key.modBytes = Math.ceil(bitLength(key.n) / 8);
  return key;
}

function bitLength(v: bigint): number {
  let n: number = 0;
  let x: bigint = v;
  while (x > 0n) {
    x >>= 1n;
    n++;
  }
  return n;
}

// ── BigInt 快速幂 ────────────────────────────────────────────────────────────
/** `base^exp mod m`（平方-乘法；3072 位约 3000 次乘，实测可接受）。 */
export function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result: bigint = 1n;
  let b: bigint = base % m;
  let e: bigint = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % m;
    }
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

// ── SHA-512（走 cryptoFramework；该能力实测可用）───────────────────────────────
async function sha512(data: Uint8Array): Promise<Uint8Array> {
  const md: cryptoFramework.Md = cryptoFramework.createMd('SHA512');
  await md.update({ data: data });
  const out: cryptoFramework.DataBlob = await md.digest();
  return out.data;
}

/** MGF1（RFC 8017 B.2.1），哈希用 SHA-512。 */
async function mgf1(seed: Uint8Array, len: number): Promise<Uint8Array> {
  const out: Uint8Array = new Uint8Array(len);
  let off: number = 0;
  let counter: number = 0;
  while (off < len) {
    const c: Uint8Array = new Uint8Array(4);
    c[0] = (counter >>> 24) & 0xff;
    c[1] = (counter >>> 16) & 0xff;
    c[2] = (counter >>> 8) & 0xff;
    c[3] = counter & 0xff;
    const input: Uint8Array = new Uint8Array(seed.length + 4);
    input.set(seed, 0);
    input.set(c, seed.length);
    const h: Uint8Array = await sha512(input);
    const take: number = Math.min(h.length, len - off);
    out.set(h.slice(0, take), off);
    off += take;
    counter++;
  }
  return out;
}

/**
 * EMSA-PSS-ENCODE（RFC 8017 §9.1.1）：SHA-512、MGF1-SHA512、salt=64（= digest 长度），
 * 与 `auth.cpp:RsaSign` 的 `RSA_PSS_SALTLEN_DIGEST` 逐项对应。
 */
export async function pssEncode(message: Uint8Array, emBits: number): Promise<Uint8Array> {
  const hLen: number = 64;          // SHA-512
  const sLen: number = 64;
  const mHash: Uint8Array = await sha512(message);
  const salt: Uint8Array = new Uint8Array(sLen);
  // 随机盐（Math.random 足够：每次会话独立，且 daemon 只验签名有效性）
  for (let i = 0; i < sLen; i++) {
    salt[i] = Math.floor(Math.random() * 256);
  }
  const mPrime: Uint8Array = new Uint8Array(8 + hLen + sLen);
  mPrime.set(mHash, 8);
  mPrime.set(salt, 8 + hLen);
  const h: Uint8Array = await sha512(mPrime);

  const emLen: number = Math.ceil(emBits / 8);
  const dbLen: number = emLen - hLen - 1;
  const db: Uint8Array = new Uint8Array(dbLen);
  // PS || 0x01 || salt
  const psLen: number = dbLen - sLen - 1;
  db[psLen] = 0x01;
  db.set(salt, psLen + 1);

  const mask: Uint8Array = await mgf1(h, dbLen);
  const maskedDb: Uint8Array = new Uint8Array(dbLen);
  for (let i = 0; i < dbLen; i++) {
    maskedDb[i] = db[i] ^ mask[i];
  }
  // 清掉最高位（emBits 可能不是 8 的倍数）
  const clearBits: number = 8 * emLen - emBits;
  maskedDb[0] &= (0xff >>> clearBits);

  const em: Uint8Array = new Uint8Array(emLen);
  em.set(maskedDb, 0);
  em.set(h, dbLen);
  em[emLen - 1] = 0xbc;
  return em;
}

/** OS2IP。 */
function os2ip(b: Uint8Array): bigint {
  let v: bigint = 0n;
  for (let i = 0; i < b.length; i++) {
    v = (v << 8n) | BigInt(b[i]);
  }
  return v;
}

/** I2OSP（定长）。 */
function i2osp(v: bigint, len: number): Uint8Array {
  const out: Uint8Array = new Uint8Array(len);
  let x: bigint = v;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/**
 * 完整签名：`SHA-512 + PSS` 后做裸 RSA 私钥运算，返回**定长 384 字节**签名。
 * `message` = daemon 下发的挑战串（按 `auth.cpp:RsaSign` 对 `buf` 的原样字节处理）。
 */
export async function rsaPssSign(key: RsaPrivate, messageText: string): Promise<Uint8Array> {
  const message: Uint8Array = utf8Encode(messageText);
  // emBits = modBits - 1
  const emBits: number = bitLength(key.n) - 1;
  const em: Uint8Array = await pssEncode(message, emBits);
  const m: bigint = os2ip(em);
  const s: bigint = modPow(m, key.d, key.n);
  return i2osp(s, key.modBytes);
}

// ── 变体支持：PKCS#1 v1.5 + 原始字节输入（daemon 实际口径未知，需要枚举）──────────
/** SHA-256（走 cryptoFramework）。 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const md: cryptoFramework.Md = cryptoFramework.createMd('SHA256');
  await md.update({ data: data });
  const out: cryptoFramework.DataBlob = await md.digest();
  return out.data;
}

/** SHA-512 公开版（客户端枚举用）。 */
export async function sha512Of(data: Uint8Array): Promise<Uint8Array> {
  return await sha512(data);
}

/** 原始 RSA 私钥运算：EM → 签名（I2OSP 定长）。 */
export function rsaRawSign(key: RsaPrivate, em: Uint8Array): Uint8Array {
  const m: bigint = os2ip(em);
  return i2osp(modPow(m, key.d, key.n), key.modBytes);
}

/** EMSA-PKCS1-v1_5（RFC 8017 §9.2）——`hash` 是**已算好的摘要**。 */
export function pkcs1Encode(key: RsaPrivate, hash: Uint8Array, sha256Hash: boolean): Uint8Array {
  // DigestInfo 前缀（SHA-256 / SHA-512）
  const prefix: number[] = sha256Hash
    ? [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
      0x05, 0x00, 0x04, 0x20]
    : [0x30, 0x51, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03,
      0x05, 0x00, 0x04, 0x40];
  const tLen: number = prefix.length + hash.length;
  const em: Uint8Array = new Uint8Array(key.modBytes);
  em[0] = 0x00;
  em[1] = 0x01;
  const psLen: number = key.modBytes - tLen - 3;
  for (let i = 0; i < psLen; i++) {
    em[2 + i] = 0xff;
  }
  em[2 + psLen] = 0x00;
  for (let i = 0; i < prefix.length; i++) {
    em[2 + psLen + 1 + i] = prefix[i];
  }
  em.set(hash, 2 + psLen + 1 + prefix.length);
  return em;
}

/** PSS 编码的**字节版**（消息是原始字节，不是字符串）。 */
export async function pssEncodeBytes(key: RsaPrivate, msg: Uint8Array): Promise<Uint8Array> {
  return await pssEncode(msg, bitLength(key.n) - 1);
}

/** 通用 PSS 编码（hashKind：true=SHA-512，false=SHA-256）。 */
export async function pssEncodeWith(key: RsaPrivate, msg: Uint8Array, useSha512: boolean): Promise<Uint8Array> {
  const hLen: number = useSha512 ? 64 : 32;
  const sLen: number = hLen;
  const emBits: number = bitLength(key.n) - 1;
  const hash = (d: Uint8Array): Promise<Uint8Array> => useSha512 ? sha512(d) : sha256(d);
  const mHash: Uint8Array = await hash(msg);
  const salt: Uint8Array = new Uint8Array(sLen);
  for (let i = 0; i < sLen; i++) {
    salt[i] = Math.floor(Math.random() * 256);
  }
  const mPrime: Uint8Array = new Uint8Array(8 + hLen + sLen);
  mPrime.set(mHash, 8);
  mPrime.set(salt, 8 + hLen);
  const h: Uint8Array = await hash(mPrime);
  const emLen: number = Math.ceil(emBits / 8);
  const dbLen: number = emLen - hLen - 1;
  const db: Uint8Array = new Uint8Array(dbLen);
  const psLen: number = dbLen - sLen - 1;
  db[psLen] = 0x01;
  db.set(salt, psLen + 1);
  // MGF1（同一哈希）
  const mask: Uint8Array = new Uint8Array(dbLen);
  let off: number = 0;
  let counter: number = 0;
  while (off < dbLen) {
    const c: Uint8Array = new Uint8Array(4);
    c[0] = (counter >>> 24) & 0xff;
    c[1] = (counter >>> 16) & 0xff;
    c[2] = (counter >>> 8) & 0xff;
    c[3] = counter & 0xff;
    const input: Uint8Array = new Uint8Array(h.length + 4);
    input.set(h, 0);
    input.set(c, h.length);
    const hh: Uint8Array = await hash(input);
    const take: number = Math.min(hh.length, dbLen - off);
    for (let i = 0; i < take; i++) {
      mask[off + i] = hh[i];
    }
    off += take;
    counter++;
  }
  const maskedDb: Uint8Array = new Uint8Array(dbLen);
  for (let i = 0; i < dbLen; i++) {
    maskedDb[i] = db[i] ^ mask[i];
  }
  maskedDb[0] &= (0xff >>> (8 * emLen - emBits));
  const em: Uint8Array = new Uint8Array(emLen);
  em.set(maskedDb, 0);
  em.set(h, dbLen);
  em[emLen - 1] = 0xbc;
  return em;
}
