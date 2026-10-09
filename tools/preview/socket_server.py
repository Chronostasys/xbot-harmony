#!/usr/bin/env python3
"""预览器的本地套接字对端（DevEco 平时扮演这个角色）。
预览器是客户端，连 /tmp/<name>；我们只 accept + 读掉数据，让它不再因写失败而崩。"""
import os, socket, sys, threading, time

name = sys.argv[1] if len(sys.argv) > 1 else "xbotprev"
path = f"/tmp/{name}"
try:
    os.unlink(path)
except FileNotFoundError:
    pass

srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
srv.bind(path)
srv.listen(4)
print(f"listening on {path}", flush=True)

def handle(conn):
    conn.settimeout(1.0)
    while True:
        try:
            data = conn.recv(65536)
            if not data:
                break
            # 可选：把预览器上报的 JSON 落盘，便于分析（比如它上报的布局/错误）
            with open("/tmp/prev_socket_in.log", "ab") as f:
                f.write(data)
        except socket.timeout:
            continue
        except OSError:
            break
    try:
        conn.close()
    except OSError:
        pass

while True:
    c, _ = srv.accept()
    print("client connected", flush=True)
    threading.Thread(target=handle, args=(c,), daemon=True).start()
