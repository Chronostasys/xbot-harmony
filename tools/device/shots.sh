#!/usr/bin/env bash
# 真机截图回路：安装 → 启动 → 截图 → 拉回本地（macOS / Linux 均可）
#
# 为什么需要它：ArkUI 的**视觉层缺陷不是类型错误** ⇒
#   三条离线门禁 + `hvigorw assembleHap` 全绿也照样能渲染出「直角紫方块」
#   （实例见 docs/ARKTS-GOTCHAS.md 批次 14）。**只有真机截图能抓到。**
#   所以凡是「视觉层」改动，交付必须附截图 —— 这个脚本就是那条产出截图的命令。
#
# 用法：
#   tools/device/shots.sh                     # ①装最新 HAP ②启动 ③截首屏（登录/开屏，无需登录）
#   tools/device/shots.sh --no-install        # 设备上已装好：只重启 + 截图（**不重建，秒级**）
#   tools/device/shots.sh --tour              # 首屏后多走一遍：会话抽屉 / 设置 / 插件
#   HAP=/path/x.hap OUT=/tmp/x TARGET=127.0.0.1:5555 tools/device/shots.sh
#
# 环境变量：HDC / TARGET / OUT / HAP / DEV
# 前置：设备已连（`hdc list targets` 有输出）；`--tour` 的点击坐标按 **1320×2848** 屏（真机）。
set -euo pipefail

BUNDLE=com.chronostasys.xbot
ABILITY=EntryAbility
DEV="${DEV:-/data/local/tmp}"
OUT="${OUT:-/tmp/xbot-shots}"
TOUR=0
INSTALL=1
for a in "$@"; do
  case "$a" in
    --tour) TOUR=1 ;;
    --no-install) INSTALL=0 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数：$a（见 --help）"; exit 1 ;;
  esac
done

# ── 1. 定位 hdc：环境变量 → env.sh → 按 SDK 布局兜底（不再硬编码某台机器的 /home/xxx）──
if [ -z "${OHOS_SDK:-}" ] && [ -f "$HOME/ohos-cli/env.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/ohos-cli/env.sh"
fi
HDC="${HDC:-$(command -v hdc 2>/dev/null || true)}"
if [ -z "$HDC" ] || [ ! -x "$HDC" ]; then
  HDC="$(ls -d "${OHOS_SDK:-$HOME/ohos-cli/command-line-tools/sdk}"/*/openharmony/toolchains/hdc 2>/dev/null | head -1 || true)"
fi
[ -n "$HDC" ] && [ -x "$HDC" ] || { echo "❌ 找不到 hdc。请先 source ~/ohos-cli/env.sh，或 HDC=<path>"; exit 1; }
echo "== hdc: $HDC"

# ── 2. 设备 ──
TARGET="${TARGET:-}"
if [ -z "$TARGET" ]; then
  TARGET="$("$HDC" list targets 2>/dev/null | tr -d '\r' | grep ':' | head -1 || true)"
fi
if [ -z "$TARGET" ]; then
  echo "!! 没有检测到设备。① 手机开 USB/无线调试 ② hdc 已授权 ③ 或 TARGET=<ip:port> 指定"
  "$HDC" list targets || true
  exit 2
fi
echo "== 设备: $TARGET"

mkdir -p "$OUT"
echo "== 产物目录: $OUT"

# ── 3. 安装（可选）──
if [ "$INSTALL" = "1" ]; then
  if [ -z "${HAP:-}" ]; then
    HAP="$(find entry/build -name '*-signed.hap' -not -path './oh_modules/*' 2>/dev/null | head -1 || true)"
  fi
  if [ -z "$HAP" ] || [ ! -f "$HAP" ]; then
    echo "❌ 没找到已签名 HAP。先 `~/ohos-cli/deploy.sh` 或传 HAP=<path>；"
    echo "   （未签名 HAP 装机必报 install sign info inconsistent）"
    exit 3
  fi
  echo "== 安装 $HAP ($(wc -c <"$HAP" | tr -d ' ') bytes)"
  "$HDC" -t "$TARGET" install -r "$HAP"
fi

# ── 4. 冷启动：force-stop 再 start，保证拿到的是「首屏」而不是上次停留的页面 ──
echo "== 冷启动 $BUNDLE/$ABILITY"
"$HDC" -t "$TARGET" shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
sleep 1
"$HDC" -t "$TARGET" shell "aa start -a $ABILITY -b $BUNDLE" >/dev/null 2>&1 || true

# ── 5. 原语 ──
shot() {  # shot <名字>  ⇒ $OUT/<名字>.jpeg（**全分辨率，不做缩放**：设计评审要看细节）
  local name="$1"
  "$HDC" -t "$TARGET" shell "snapshot_display -f $DEV/$name.jpeg" >/dev/null 2>&1 || true
  "$HDC" -t "$TARGET" file recv "$DEV/$name.jpeg" "$OUT/$name.jpeg" >/dev/null 2>&1 || true
  if [ -f "$OUT/$name.jpeg" ]; then
    # 可选降采样（省空间）：SHOT_RESIZE=1 时用 sips(macOS)/convert(ImageMagick)
    if [ "${SHOT_RESIZE:-0}" = "1" ]; then
      if command -v sips >/dev/null 2>&1; then
        sips -Z 660 "$OUT/$name.jpeg" --out "$OUT/$name.png" >/dev/null 2>&1 || true
      elif command -v convert >/dev/null 2>&1; then
        convert "$OUT/$name.jpeg" -resize 50% "$OUT/$name.png" >/dev/null 2>&1 || true
      fi
      echo "  → $OUT/$name.png"
    else
      echo "  → $OUT/$name.jpeg"
    fi
  else
    echo "  !! 截图失败：$name（snapshot_display 是否可用？）"
  fi
}
# `uitest uiInput click` 是官方 uitest 通道（比 uinput -T -c 更贴近真实触摸）
tap() { "$HDC" -t "$TARGET" shell "uitest uiInput click $1 $2" >/dev/null 2>&1 || true; sleep 1.2; }
kill_app() { "$HDC" -t "$TARGET" shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true; }

# ── 6. 截图 ──
echo "== 首屏（登录 / 开屏）"
sleep 6
shot 01-login

if [ "$TOUR" = "1" ]; then
  echo "== 巡视（坐标按 1320×2848 真机）"
  # 设备上若已存会话，启动即进聊天；否则停在登录页 ⇒ 02 可能是登录页，属正常
  tap 660 1900   # 登录按钮
  sleep 6
  shot 02-chat
  tap 60 130     # ☰ 会话抽屉
  sleep 2; shot 03-drawer
  kill_app; "$HDC" -t "$TARGET" shell "aa start -a $ABILITY -b $BUNDLE" >/dev/null 2>&1 || true; sleep 6
  tap 1200 130   # ⚙ 设置
  sleep 2; shot 04-settings
  kill_app; "$HDC" -t "$TARGET" shell "aa start -a $ABILITY -b $BUNDLE" >/dev/null 2>&1 || true; sleep 6
  tap 1090 130   # ⊞ 能力 / 插件
  sleep 2; shot 05-plugins
fi

echo "== 完成，产物在 $OUT"
ls -la "$OUT"
echo
echo "== 如遇异常，抓日志："
echo "   $HDC -t $TARGET shell hilog | grep -iE 'xbot|ArkUI|js error' | tail -100"
