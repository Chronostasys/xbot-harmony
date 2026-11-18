#!/usr/bin/env bash
# 手机操作链路：装 HAP + 拉起客户端 + 自检（命令口 / 客户端长轮询 / 一次 dump）。
#
# 用法：bash tools/phone/install_and_check.sh [设备序列号]
# 前提：xbot.phone 插件已加载（`config reload_plugins`），后端在跑，手机与本机同网段。
set -uo pipefail
DEV="${1:-9QF0226922014533}"
HDC="$HOME/ohos-cli/command-line-tools/sdk/default/openharmony/toolchains/hdc"
HAP="$(cd "$(dirname "$0")/../.." && pwd)/entry/build/default/outputs/default/entry-default-signed.hap"
PORT="${XBOT_PHONE_PORT:-8791}"

echo "== 1) 设备"
"$HDC" list targets | sed 's/^/   /'

echo "== 2) 安装"
"$HDC" -t "$DEV" install -r "$HAP" | tail -1

echo "== 3) 拉起客户端"
"$HDC" -t "$DEV" shell aa start -a EntryAbility -b com.chronostasys.xbot | tail -1

echo "== 4) 等客户端长轮询到命令口（最多 20s）"
for i in $(seq 1 20); do
  if lsof -nP -iTCP:"$PORT" 2>/dev/null | grep -q ESTABLISHED; then
    echo "   ✅ 客户端已连上 $PORT"
    break
  fi
  sleep 1
done
lsof -nP -iTCP:"$PORT" 2>/dev/null | grep ESTABLISHED | head -2 | sed 's/^/   /'

echo "== 5) 自检：命令口健康"
curl -s --max-time 3 "http://127.0.0.1:$PORT/health"; echo

echo "== 6) 自检：一次真实 dump（走客户端执行）"
curl -s --max-time 25 -X POST "http://127.0.0.1:$PORT/tool" \
  -H 'Content-Type: application/json' -d '{"name":"phone_dump_ui","args":{}}' | head -c 200; echo
