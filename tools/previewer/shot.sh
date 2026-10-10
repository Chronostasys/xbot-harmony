#!/usr/bin/env bash
# 一键：起 Previewer（零 GPU）→ 连它的 WebSocket 取**真实渲染帧** → 存 JPEG。
#
# 关键发现（2026-10-10，用户指出"Linux 肯定能 preview"后重新取证 —— 之前 X 截图空白是因为
# **Previewer 根本不往 X 窗口画**：它把渲染帧从 **WebSocket**（`-lws` 那个端口）推给客户端）：
#   [WebSocketServer] Engine Websocket protocol init / Websocket client connect / writeable
#   [VirtualScreenImpl][SendPixmap] Get first render buffer / Send first buffer finish
# 帧格式（实测）：
#   offset 0  : magic  12 34 56 78
#   offset 4  : width  (BE uint32, 如 1320)
#   offset 8  : height (BE uint32, 如 2848)
#   offset 12 : width / 16: height / 20: 00 02 00 00 / 24: width / 28: height / 32..39: 0
#   offset 40 : **JPEG** 数据（FF D8 FF E0 … JFIF）→ 直接切出来就是一张图
set -u
CLI=${CLI:-/home/smith/ohos-cli/command-line-tools}
BINS=/tmp/pvbins; PREFIX=/tmp/xbot_preview_bundle; R="$PREFIX/modules.abc"
PORT=${PORT:-40041}; XDISP=${XDISP:-75}; OUT=${OUT:-/tmp/frame.jpg}
PROJ=$(cd "$(dirname "$0")/../.." && pwd)

"$PROJ/tools/previewer/run.sh" >/tmp/pv_run.log 2>&1 &   # run.sh 会打印/持有 Xvfb + Previewer
sleep 10
python3 - "$PORT" "$OUT" <<'PY'
import socket, base64, os, struct, sys, time
port, out = int(sys.argv[1]), sys.argv[2]
key = base64.b64encode(os.urandom(16)).decode()
s = socket.create_connection(('127.0.0.1', port), timeout=10)
s.sendall((f'GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n'
           f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
buf = b''
while b'\r\n\r\n' not in buf:
    buf += s.recv(4096)
data = buf.split(b'\r\n\r\n', 1)[1]
def need(k):
    global data
    while len(data) < k:
        d = s.recv(1 << 20)
        if not d: raise EOFError
        data += d
need(2)
op = data[0] & 0xf; ln = data[1] & 0x7f; off = 2
if ln == 126: need(4); ln = struct.unpack('>H', data[2:4])[0]; off = 4
elif ln == 127: need(10); ln = struct.unpack('>Q', data[2:10])[0]; off = 10
need(off + ln)
payload = data[off:off+ln]
open('/tmp/pvf_last.bin','wb').write(payload)
i = payload.find(b'\xff\xd8\xff')
if i < 0:
    print('未找到 JPEG（帧头变了？前 64 字节: %s）' % payload[:64].hex()); sys.exit(1)
open(out, 'wb').write(payload[i:])
print('OK -> %s (%d B, JPEG@%d, %dx%d)' % (
    out, len(payload) - i, i,
    struct.unpack_from('>I', payload, 4)[0], struct.unpack_from('>I', payload, 8)[0]))
PY
