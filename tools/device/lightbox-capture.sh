#!/usr/bin/env bash
# lightbox-capture.sh —— 图片 Lightbox **真机连拍序列**（E5）—— 每帧给"期望判据"
#
# 被测实现：`components/Lightbox.ets`（E5）。**转场语义 = 缩放 + 淡入**（`anim.ets: lightboxTransition()`
#   = `TransitionEffect.scale(MOTION_LIGHTBOX_ENTER_SCALE=0.96) + OPACITY`）——
#   ⚠️ **不是**"自下而上滑入"（那是 `sheetTransition()` 的语义；本组件**故意**不用它：全屏浮层从下滑入
#   读作"抽屉"，不对。见 `components/Lightbox.ets` 头注）。
#
# ── ⛔ 采样能力先说清（否则会误判成"没动画"）──────────────────────────────────────
#   · `snapshot_display` **≈0.3–0.5 s/帧** ⇒ 转场只有 `MOTION_BASE_MS`(220ms) + `MOTION_FAST_MS`(180ms)
#     ⇒ **连拍抓不到中间帧**。本脚本负责**稳定态各帧**；**转场中间帧必须录屏**：
#       `hdc -t $T shell "screenrecord --time-limit 10 /data/local/tmp/lb.mp4"` ⇒ `hdc file recv` ⇒ 逐帧抽图。
#   · **双指捏合不可脚本化**：本仓 `uitest uiInput` 只用到 `click / text / keyEvent / swipe / inputText`
#     （无 pinch / 无多指）⇒ 缩放一档用**双击**（可脚本化：`uitest uiInput doubleClick`）覆盖，
#     **真·双指上下限**必须手动（录屏 + 双指）。
#
# ── 用法 ────────────────────────────────────────────────────────────────────────
#   bash tools/device/lightbox-capture.sh --img-x 660 --img-y 1400
#   bash tools/device/lightbox-capture.sh --img-x 660 --img-y 1400 --out /tmp/xbot-lightbox --pkg <包名>
#   （`--img-x/--img-y` = 聊天里那张图片的大致屏幕坐标；先 `tools/device/ui.sh dump` 或截图确认。）
#
# ⛔ 判据纪律：**每条帧必须落到下表某一行**；拿不到图 ⇒ 记 `SAMPLE_INVALID` 并**计入失败**
#   （⛔ 不当"通过"；本仓 `readability-scan.sh` 同款）。
set -uo pipefail

if [ -z "${OHOS_SDK:-}" ] && [ -f "$HOME/ohos-cli/env.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/ohos-cli/env.sh"
fi
HDC="${HDC:-$(command -v hdc 2>/dev/null || true)}"
if [ -z "$HDC" ] || [ ! -x "$HDC" ]; then
  HDC="$(ls -d "${OHOS_SDK:-$HOME/ohos-cli/command-line-tools/sdk}"/*/openharmony/toolchains/hdc 2>/dev/null | head -1 || true)"
fi
[ -n "$HDC" ] && [ -x "$HDC" ] || { echo "❌ 找不到 hdc（source ~/ohos-cli/env.sh 或 HDC=<path>）" >&2; exit 1; }
T="${TARGET:-}"
if [ -z "$T" ]; then
  T="$("$HDC" list targets 2>/dev/null | tr -d '\r' | grep ':' | head -1 || true)"
fi
[ -n "$T" ] || { echo "❌ 没有设备（hdc list targets 为空）" >&2; exit 2; }

PKG="${PKG:-com.chronostasys.xbot}"
OUT="${OUT:-/tmp/xbot-lightbox}"
DEV="${DEV:-/data/local/tmp}"
IMX=""; IMY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --img-x) IMX="${2:?}"; shift ;;
    --img-y) IMY="${2:?}"; shift ;;
    --out) OUT="${2:?}"; shift ;;
    --pkg) PKG="${2:?}"; shift ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
  shift
done
if [ -z "$IMX" ] || [ -z "$IMY" ]; then
  echo "❌ 必须给 --img-x/--img-y（聊天里图片的屏幕坐标）" >&2; exit 2
fi
mkdir -p "$OUT"; rm -f "$OUT"/f*.jpeg 2>/dev/null || true

shot() {  # shot <name>  ⇒ 落 $OUT/<name>.jpeg；拿不到 ⇒ 返回 1（调用方记 SAMPLE_INVALID）
  local name="$1"
  "$HDC" -t "$T" shell "snapshot_display -f $DEV/lb.jpeg" >/dev/null 2>&1 || true
  "$HDC" -t "$T" file recv "$DEV/lb.jpeg" "$OUT/$name.jpeg" >/dev/null 2>&1 || true
  if [ ! -s "$OUT/$name.jpeg" ]; then
    echo "   ⚠️ SAMPLE_INVALID：$name 没取到图（⛔ 不计通过）" >&2
    return 1
  fi
  return 0
}
tap()  { "$HDC" -t "$T" shell "uitest uiInput click $1 $2" >/dev/null 2>&1 || true; sleep 1.2; }
swipe() { "$HDC" -t "$T" shell "uitest uiInput swipe $1 $2 $3 $4 ${5:-300}" >/dev/null 2>&1 || true; sleep 1.2; }

invalid=0
echo "▶ Lightbox 连拍（包名=$PKG  图片坐标=($IMX,$IMY)  输出=$OUT）"
echo "   帧 → 期望判据（⛔ 判读逐条对照；SAMPLE_INVALID 帧作废且计入失败）"
cat <<'EXPECT'
   f00 未打开：聊天在，**无**全屏浮层（对比基准）
   ── f01..f04：点图片后的**开**过渡（录屏才抓得到中间帧；连拍多落在 f04）──
   f01..f03 期望：浮层**由小到大 + 由透到实**（scale 0.96→1、α 0→1）；⛔ **不得**是"自下而上滑入"
            （若见整层从下方平移 ⇒ 用错了 `sheetTransition()`，判红）
   f04 期望：稳定帧 —— 全屏**深色画布**（= `surface.canvas`/appBg）+ 顶部工具栏面板（圆角+发丝+柔影）
            + 图片居中；⛔ 图片**不得**溢出/糊
   ── 缩放（双击一档；双指须手动 + 录屏）──
   f05 期望：**双击后**图片 ≈2.5×；工具栏出现「百分比」+「复位」；⛔ 原图不得超过浮层边界
   f06 期望：**复位后**回 1×；「百分比/复位」消失
   ── 拖拽 ──
   f07 期望：放大态下 `swipe` 拖动 ⇒ 图片位移，**拖不出边界**（`panLimit` 夹取）；未放大态拖动 ⇒ **不动**
   ── 关（两条路各测一次）──
   f08 期望：**点背板**（图片外的深色区）⇒ 浮层**淡出 + 缩回**；⛔ 不得瞬变
   f09 期望：已回到聊天；⛔ 不得留"半透明残影"
   f10 期望：**下拉 > 视口高 1/5** ⇒ 关闭；**< 1/5** ⇒ **弹回不关**（两条各测一次）
   ── 另测（放大后）──
   f11 期望：**放大态下拉** ⇒ **不关**（此时单指 = 平移；`shouldDismissBySwipe` 恒 false）
   ── 保存 ──
   f12 期望：点 `SaveButton` ⇒ 授权成功弹「已保存到相册」；拒绝 ⇒ 「需要授权才能保存到相册」（⛔ 不静默）
EXPECT

"$HDC" -t "$T" shell "aa force-stop $PKG" >/dev/null 2>&1 || true
"$HDC" -t "$T" shell "aa start -a EntryAbility -b $PKG" >/dev/null 2>&1 || true
sleep 3
shot f00 || invalid=$((invalid + 1))

tap "$IMX" "$IMY"
shot f04 || invalid=$((invalid + 1))          # 开（稳定态；中间帧看录屏）
"$HDC" -t "$T" shell "uitest uiInput doubleClick $IMX $IMY" >/dev/null 2>&1 || true; sleep 1.2
shot f05 || invalid=$((invalid + 1))          # 双击放大
"$HDC" -t "$T" shell "uitest uiInput click $((IMX + 220)) $((IMY - 220))" >/dev/null 2>&1 || true; sleep 1.2
shot f06 || invalid=$((invalid + 1))          # 复位（点「复位」大致位置；⛔ 需按 dump 校正）
swipe "$IMX" "$IMY" "$((IMX + 30))" "$((IMY + 150))"
shot f07 || invalid=$((invalid + 1))          # 拖拽

# 关：点背板（取图片坐标上方 1/5 屏高处，通常已在背板上）
tap "$IMX" 120
shot f09 || invalid=$((invalid + 1))          # 关（稳定态）

echo "── 小结：已落帧见 $OUT（SAMPLE_INVALID=$invalid）"
echo "   ⚠️ 转场中间帧（f01..f03）**必须录屏**："
echo "      hdc -t $T shell \"screenrecord --time-limit 10 $DEV/lb.mp4\" && hdc -t $T file recv $DEV/lb.mp4 $OUT/lb.mp4"
echo "   ⚠️ 双指缩放不可脚本化 ⇒ 手动双指 + 录屏，按上表 f05 的边界判据读帧。"
if [ "$invalid" -gt 0 ]; then echo "❌ 有 $invalid 帧 SAMPLE_INVALID ⇒ 本轮**未通过**（⛔ 不可当「没反应」放过）"; exit 1; fi
echo "✅ 脚本部分（稳定态连拍）完成 —— 请对照上表逐帧判读"
