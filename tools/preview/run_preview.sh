#!/usr/bin/env bash
# Linux 跑鸿蒙预览器：Xvfb + 本地套接字对端 + websocket 抓帧 → JPEG
set -u
CLI=/home/smith/ohos-cli/command-line-tools
PVB="$CLI/sdk/default/openharmony/previewer/common/bin"
export LD_LIBRARY_PATH="/tmp/zvlib:$PVB:$CLI/sdk/default/hms/toolchains/lib:$CLI/sdk/default/openharmony/toolchains/lib"
R="${1:-/tmp/prevroot}"; PAGE="${2:-pages/Index}"; TAG="${3:-shot}"
NAME="xbotprev"; DISP=":77"; W=1200; H=2600
export DISPLAY="$DISP"
mkdir -p /tmp/frames; rm -f /tmp/frames/*.bin 2>/dev/null
python3 /tmp/prev_socket_server.py "$NAME" >/tmp/prev_sock.log 2>&1 & SPID=$!
Xvfb "$DISP" -screen 0 ${W}x${H}x24 >/tmp/xvfb.log 2>&1 & XPID=$!
sleep 2
# 先把抓帧客户端挂上（预览器只在绘制时推帧）
( timeout 45 python3 /tmp/ws_grab.py 8891 /tmp/frames > /tmp/ws_grab.out 2>&1 ) &
GPID=$!
"$PVB/Previewer" -j "/data/storage/el1/bundle/xbot/ets/modules.abc" -n entry -p 8890 -device phone -or $W $H -cr $W $H \
  -url "$PAGE" -s "$NAME" -lws 8891 -av ACE_2_0 -cm dark \
  -f "$R/module.json" -arp "$R" -pm Stage -ljPath "$R/loader.json" -pages "$R/resources/base/profile/main_pages.json" \
  -refresh full -card false -o portrait -l zh_CN -bn com.chronostasys.xbot -pkgName entry >/tmp/previewer.log 2>&1 & PREPID=$!
sleep 26
cat /tmp/ws_grab.out 2>/dev/null | head -8
kill "$PREPID" 2>/dev/null; kill "$GPID" 2>/dev/null; kill "$XPID" 2>/dev/null; kill "$SPID" 2>/dev/null
# 转成 PNG 便于查看
python3 - <<'PY'
import glob, struct, subprocess, os
files = sorted(glob.glob('/tmp/frames/msg*.bin'))
print("frames:", [os.path.basename(f) for f in files])
if files:
    data = open(files[-1],'rb').read()
    off = data.find(b'\xff\xd8\xff')
    if off >= 0:
        out = f'/tmp/frames/{os.environ.get("TAG","shot")}.jpg'
        open(out,'wb').write(data[off:])
        subprocess.run(['convert', out, '-resize', '45%', f'/tmp/frames/{os.environ.get("TAG","shot")}.png'], check=False)
        print("saved", out, "->", f'/tmp/frames/{os.environ.get("TAG","shot")}.png', os.path.getsize(out), "bytes")
PY
