#!/usr/bin/env bash
# 真机截图回路（Linux，无需 DevEco）：安装 → 启动 → 逐页截图 → 拉回本地
#
# 为什么走这条路：官方 Linux 预览器的 Stage ability 运行路径未实现
# （ide_previewer 源码：`JsApp::Run ability start failed. Linux is not supported.`），
# 而本 App 是 Stage 模型 ⇒ 预览器无法渲染；真机 + hdc 才是 Linux 上唯一可行的截图回路。
#
# 用法：
#   tools/device/shots.sh [hap路径] [输出目录]
# 前置：手机开启「开发者选项 → USB 调试」，用 USB 连到本机；hdc 取 CMDLINE_TOOLS 里的。
set -euo pipefail

HDC="${HDC:-$(ls -d /home/smith/ohos-cli/command-line-tools/sdk/*/openharmony/toolchains/hdc 2>/dev/null | head -1)}"
HAP="${1:-/home/smith/src/xbot-harmony/dist/xbot-harmony-release.hap}"
OUT="${2:-/tmp/xbot-shots}"
PKG="com.chronostasys.xbot"
DEV="/data/local/tmp"

[ -x "$HDC" ] || { echo "找不到 hdc：请设 HDC=<path>"; exit 1; }
mkdir -p "$OUT"

echo "== hdc: $HDC"
"$HDC" start >/dev/null 2>&1 || true
TARGETS="$("$HDC" list targets 2>/dev/null | tr -d '\r' | grep -v '^$' | head -1 || true)"
if [ -z "$TARGETS" ]; then
  echo "!! 没有检测到设备。请：① 手机开 USB 调试 ② 用数据线连本机 ③ 手机上允许调试授权"
  "$HDC" list targets || true
  exit 2
fi
echo "== 设备: $TARGETS"

echo "== 安装 $HAP"
"$HDC" install -r "$HAP"

echo "== 启动"
"$HDC" shell aa start -a EntryAbility -b "$PKG" || true
sleep 6

shot() {  # shot <名字>
  local name="$1"
  "$HDC" shell snapshot_display -f "$DEV/$name.jpeg" >/dev/null 2>&1 || true
  "$HDC" file recv "$DEV/$name.jpeg" "$OUT/$name.jpeg" >/dev/null 2>&1 || true
  if [ -f "$OUT/$name.jpeg" ]; then
    convert "$OUT/$name.jpeg" -resize 45% "$OUT/$name.png" 2>/dev/null || true
    echo "  → $OUT/$name.png"
  else
    echo "  !! 截图失败：$name"
  fi
}

tap() { "$HDC" shell uinput -T -c "$1" "$2" >/dev/null 2>&1 || true; sleep 1.2; }

echo "== 逐页截图"
shot 01-login

# 登录页 →（若已存会话则直接进聊天）
tap 600 1200   # 服务端输入框
tap 600 1420   # 用户名
tap 600 1640   # 密码
tap 600 1950   # 登录按钮
sleep 6
shot 02-chat

tap 60 120     # ☰ 会话抽屉
sleep 2; shot 03-drawer
tap 900 120    # 关闭抽屉（右上 ✕ 附近）
sleep 1

tap 1090 120   # ⚙ 设置
sleep 2; shot 04-settings
tap 600 200    # 关闭
sleep 1

tap 990 120    # ⊞ 能力面板
sleep 2; shot 05-plugins
tap 600 200
sleep 1

echo "== 完成，产物在 $OUT"
ls -la "$OUT"
echo
echo "== 如遇异常，抓日志："
echo "   $HDC shell hilog | grep -iE 'xbot|ArkUI|js error' | tail -100"
