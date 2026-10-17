#!/usr/bin/env bash
# package.sh —— 构建并安装「鸿蒙推送」插件（xbot.harmony-push）。
#
# ⛔ 本插件的**非侵入**定义：只往服务端的插件目录里**新增**一个插件目录，
#    不修改 xbot 服务端的任何源码/配置。删除该目录即完全回到原状。
#
# 布局（与既有插件一致，host 按此发现）：
#   ${XBOT_HOME:-~/.xbot}/plugins/xbot.harmony-push/plugin.json
#   ${XBOT_HOME:-~/.xbot}/plugins/xbot.harmony-push/bin/harmony-push   ← entry `./bin/harmony-push`
#   运行期数据（全部落在插件自己的目录里）：
#     config.json   ← 设置（与 App「设置 → 插件」界面**同一份文件**，由 host 写入）
#     data.json     ← 设备 Push Token 台账 + 投递日志
#
# 用法：
#   plugins/xbot-harmony-push/package.sh            # 构建 + 安装（默认）
#   plugins/xbot-harmony-push/package.sh --build    # 只构建到 ./bin/
#   plugins/xbot-harmony-push/package.sh --out DIR  # 构建到指定目录（不安装）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ID="xbot.harmony-push"
BIN_NAME="harmony-push"
XBOT_HOME="${XBOT_HOME:-$HOME/.xbot}"
TARGET_DIR="$XBOT_HOME/plugins/$PLUGIN_ID"

MODE="install"
OUT_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) MODE="build"; shift ;;
    --out) OUT_DIR="$2"; MODE="build"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# go 可能不在 PATH（本机在 /usr/local/go/bin）
export PATH="$PATH:/usr/local/go/bin:/opt/homebrew/bin"
command -v go >/dev/null || { echo "需要 go（未找到）：请安装 Go 1.24+ 或加入 PATH"; exit 1; }

echo "▶ 构建 $PLUGIN_ID ($(go version | awk '{print $3}'))"
cd "$HERE"
VERSION="$(python3 -c 'import json,sys;print(json.load(open("plugin.json"))["version"])' 2>/dev/null || echo dev)"
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.buildVersion=$VERSION" -o "$HERE/bin/$BIN_NAME" .
echo "  ✓ bin/$BIN_NAME $(du -h "$HERE/bin/$BIN_NAME" | cut -f1)"

if [[ "$MODE" == "build" ]]; then
  if [[ -n "$OUT_DIR" ]]; then
    mkdir -p "$OUT_DIR"
    cp "$HERE/bin/$BIN_NAME" "$OUT_DIR/$BIN_NAME"
    echo "  ✓ 产物：$OUT_DIR/$BIN_NAME"
  fi
  exit 0
fi

echo "▶ 安装到 $TARGET_DIR"
mkdir -p "$TARGET_DIR/bin"
cp "$HERE/plugin.json" "$TARGET_DIR/plugin.json"
cp "$HERE/bin/$BIN_NAME" "$TARGET_DIR/bin/$BIN_NAME"
chmod +x "$TARGET_DIR/bin/$BIN_NAME"
# ⛔ 不动已存在的 config.json / data.json（升级不清设置、不清设备台账）
echo "  ✓ 已安装（保留既有 config.json / data.json）"
echo
echo "检查清单："
echo "  1) 服务端重载插件（或重启 xbot）后，插件才会被发现"
echo "  2) 在 App「设置 → 插件 → 鸿蒙推送（Push Kit）」填入 App ID / Project ID / Client Secret"
echo "  3) 手机端在插件页点「登记本机」上报 Push Token，再点「发送测试推送」验证链路"
