#!/usr/bin/env python3
"""连预览器的 websocket，抓它推来的渲染帧（DevEco 平时就是干这个）。
不依赖第三方库：手写最简 WS 客户端（握手 + 帧解析）。"""
import base64, os, socket, struct, sys, time

HOST = "127.0.0.1"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8891
OUTDIR = sys.argv[2] if len(sys.argv) > 2 else "/tmp/frames"
os.makedirs(OUTDIR, exist_ok=True)

# 重试连接：预览器的 ws 端口稍晚才起来，但必须在它绘制之前连上才能拿到真帧
import time as _t
_deadline = _t.time() + 25
s = None
while _t.time() < _deadline:
    try:
        s = socket.create_connection((HOST, PORT), timeout=5)
        break
    except OSError:
        _t.sleep(0.5)
if s is None:
    print("connect failed after retries", flush=True)
    raise SystemExit(1)
key = base64.b64encode(os.urandom(16)).decode()
req = ("GET / HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\n"
       "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
       % (HOST, PORT, key))
s.sendall(req.encode())
resp = b""
while b"\r\n\r\n" not in resp:
    chunk = s.recv(4096)
    if not chunk:
        break
    resp += chunk
print("handshake:", resp.split(b"\r\n")[0].decode(errors="replace"), flush=True)


def send_text(msg: str) -> None:
    """发送一个掩码的 WS 文本帧（客户端必须 mask）。"""
    payload = msg.encode()
    header = bytearray([0x81])
    ln = len(payload)
    if ln < 126:
        header.append(0x80 | ln)
    elif ln < 65536:
        header.append(0x80 | 126)
        header += struct.pack(">H", ln)
    else:
        header.append(0x80 | 127)
        header += struct.pack(">Q", ln)
    mask = os.urandom(4)
    header += mask
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    s.sendall(bytes(header) + masked)


def recv_exact(n):
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise EOFError("closed")
        buf += chunk
    return buf


s.settimeout(30)
# 关键：预览器的"重绘/重发帧"由客户端命令触发 —— 第三方客户端就是这么做的
for _ in range(6):
    try:
        send_text('{"type":"refresh","data":{},"timestamp":%d}' % int(time.time() * 1000))
        time.sleep(1.0)
    except OSError:
        break
idx = 0
text_log = open("/tmp/ws_text.log", "w")
deadline = time.time() + 22
while time.time() < deadline and idx < 40:
    try:
        hdr = recv_exact(2)
    except (EOFError, socket.timeout):
        break
    opcode = hdr[0] & 0x0F
    ln = hdr[1] & 0x7F
    if ln == 126:
        ln = struct.unpack(">H", recv_exact(2))[0]
    elif ln == 127:
        ln = struct.unpack(">Q", recv_exact(8))[0]
    payload = recv_exact(ln) if ln else b""
    if opcode == 0x2:  # binary
        idx += 1
        p = "%s/msg%d.bin" % (OUTDIR, idx)
        open(p, "wb").write(payload)
        print("BINARY %d bytes -> %s head=%s" % (ln, p, payload[:24].hex()), flush=True)
    elif opcode == 0x1:  # text
        txt = payload.decode(errors="replace")
        text_log.write(txt + "\n")
        print("TEXT %d bytes: %s" % (ln, txt[:160]), flush=True)
    elif opcode == 0x8:
        print("close frame", flush=True)
        break
text_log.close()
