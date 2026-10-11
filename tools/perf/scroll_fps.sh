#!/usr/bin/env bash
# tools/perf/scroll_fps.sh —— 真机「滚动帧率 / jank」与「内存 / CPU」采集（默认**被动**，不驱动 UI）。
#
# 为什么需要它：`tools/perf/render_scale.sh` 只量"要渲染多少节点"（静态代理），
# `coldstart.sh` 只量启动骨架；**真机滚动时的实际帧率/掉帧**此前没有可复现的量法
# ⇒ "长会话滚动卡不卡"只能靠肉眼。本脚本用设备自带 `SP_daemon`（OpenHarmony SmartPerf
# 命令行版）把 FPS / jank / 内存 / CPU 变成**可抄的数字**。
#
# 口径（与 docs/PERF-BUDGET.md §2 的预算表对应）：
#   · `-f`  → app 刷新帧率 + 抖动（jitters）+ 屏幕刷新率
#   · `-r`  → 进程内存 + 总内存
#   · `-c`  → 设备/进程 CPU 频率与占用、进程 CPU load
#
# ⛔ 纪律
#   1. 默认**不驱动 UI**（不点、不滑、不切）：设备是多线共用的。要量滚动必须**人工**在窗口内滚，
#      或显式加 `--drive` 让脚本用 `uitest uiInput swipe` 代滚（会动屏幕 —— 先确认没人在验收）。
#   2. 采集窗口内**不要同时跑别的设备操作**（否则数字里混进别人的界面）。
#   3. ⛔ 不要为了好看调阈值：本脚本只**输出数字**，不做任何判断。
#
# 用法
#   TARGET=127.0.0.1:5555 bash tools/perf/scroll_fps.sh 8            # 采 8 秒（人工滚）
#   TARGET=127.0.0.1:5555 bash tools/perf/scroll_fps.sh 8 --drive    # 脚本代滚 8 秒（会动屏幕）
#   TARGET=127.0.0.1:5555 bash tools/perf/scroll_fps.sh 5 --memory   # 只采内存/CPU
#
# 参考基线（2026-10-11，空态只读采样）：app CPU 0.00–0.03%，PSS ≈ 218 MB（见 RENDER-LOAD-MEASUREMENT.md）
set -uo pipefail

PKG="${PKG:-com.chronostasys.xbot}"
SECS="${1:-8}"
MODE="fps"          # fps | memory
DRIVE=0
for a in "$@"; do
  case "$a" in
    --drive) DRIVE=1 ;;
    --memory) MODE="memory" ;;
    --fps) MODE="fps" ;;
  esac
done
case "${SECS}" in ''|*[!0-9]*) SECS=8 ;; esac

if [ -z "${OHOS_SDK:-}" ] && [ -f "$HOME/ohos-cli/env.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/ohos-cli/env.sh" >/dev/null 2>&1 || true
fi
HDC="${HDC:-$(command -v hdc 2>/dev/null || true)}"
[ -n "$HDC" ] || { echo "❌ 找不到 hdc（先 source ~/ohos-cli/env.sh）" >&2; exit 1; }
T="${TARGET:-$("$HDC" list targets 2>/dev/null | tr -d '\r' | grep ':' | head -1)}"
[ -n "${T}" ] || { echo "❌ 没有设备" >&2; exit 2; }

PID="$("$HDC" -t "${T}" shell "pidof ${PKG}" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
[ -n "${PID}" ] || { echo "❌ ${PKG} 未在运行（本脚本不会替你启动它）" >&2; exit 3; }

echo "target=${T}  pkg=${PKG}  pid=${PID}  window=${SECS}s  mode=${MODE}  drive=${DRIVE}"
echo "⏱  采集窗口：$(date '+%H:%M:%S') → +${SECS}s"
if [ "${MODE}" = "fps" ] && [ "${DRIVE}" = "0" ]; then
  echo "👉 现在开始**手动滚动长会话**（这正是要量的场景）；窗口结束前不要停。"
fi

# ── 可选：脚本代滚（显式 --drive 才做）────────────────────────────────────────
drive_loop() {
  # 1320×2848 屏：在列表区（y 约 1200→600）反复上滑 ⇒ 触发持续滚动 + 惯性
  local i=0
  while [ "${i}" -lt "${SECS}" ]; do
    # ⛔ 一条 shell 内原子执行（本仓 gotcha：分两条命令时坐标会漂）
    "$HDC" -t "${T}" shell "uitest uiInput swipe 660 1400 660 700 200" >/dev/null 2>&1 || true
    sleep 0.35
    i=$((i + 1))
  done
}
if [ "${DRIVE}" = "1" ]; then
  drive_loop &
  DPID=$!
fi

# ── 采集（设备侧执行，host 侧只读回显）────────────────────────────────────────
echo "───── SP_daemon 输出 ─────"
if [ "${MODE}" = "memory" ]; then
  "$HDC" -t "${T}" shell "SP_daemon -N ${SECS} -PID ${PID} -r" 2>&1 | tr -d '\r'
  echo "───── hidumper 交叉核对（PSS 明细）─────"
  "$HDC" -t "${T}" shell "hidumper --mem ${PID}" 2>&1 | tr -d '\r' | sed -n '1,14p'
else
  "$HDC" -t "${T}" shell "SP_daemon -N ${SECS} -PID ${PID} -f" 2>&1 | tr -d '\r'
  echo "───── hidumper 交叉核对（CPU%）─────"
  "$HDC" -t "${T}" shell "hidumper --cpuusage ${PID}" 2>&1 | tr -d '\r' | sed -n '1,14p'
fi

[ "${DRIVE}" = "1" ] && wait "${DPID}" 2>/dev/null

echo
echo "判读口径（预算见 docs/PERF-BUDGET.md §2）"
cat <<'TXT'
  · FPS：滚动窗口内应**贴近屏幕刷新率**（本机 1320×2848 模拟器常见 60）。
    明显低于刷新率 / jitters 高 ⇒ 掉帧；对照 §2 里与"节点数/块数"相关的结构性判据定位根因。
  · CPU：**空态**基线 0.00–0.03%（空转时几乎为 0）；**流式**基线 4.4–4.7%（定时器地板）。
    滚动期若无流式却在 5% 以上 ⇒ 先看是否同屏多枚 30fps Canvas 光球（`AssistantOrb`）。
  · 内存：PSS 增长应只在会话切换/加载历史时阶梯上升，**不应**随滚动单调爬升（那才是泄漏）。
TXT
