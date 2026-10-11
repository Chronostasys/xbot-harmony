#!/usr/bin/env bash
# tools/perf/orb_burst.sh —— 光球动效的**真机连拍采集 + 采样有效性门禁**（不判波形，只保证样本可用）
#
# ── 为什么需要这个脚本（2026-10-11 真实教训）──────────────────────────────────
# 首次尝试用 `snapshot_display` **连拍 24 帧**去量"吸:呼 帧数比"，事后发现
# **24 个 JPEG 的 md5 完全相同**（`md5 f1..f24 | sort -u | wc -l` = 1）
# ⇒ 序列里**没有任何时间信息**；据此得出的任何"波形结论"都是**假结论**。
# 这不是"判据不够好"，而是**数据本身是死的**。本脚本把这条教训固化成**机器门禁**。
#
# ── 依据（"有差异"是必要条件的出处）─────────────────────────────────────────────
# `components/AssistantOrb.ets` 的 `draw()` 用 **`Date.now()`**（毫秒）喂呼吸/公转纯函数
# （`core/orb.ets:orbRadius/orbOpacity/orbParticles`）⇒ 光球的每个可见量都是"时刻"的函数。
# ⇒ **任意两帧只要不在同一毫秒，光球像素就必然不同**（除非该帧刚好落在整周期同相位点，
#   概率 ≈ 0，且会被"唯一值 ≥ 2"的弱门禁放过 —— 那是可接受的：门禁只拦"全同"这种病）。
#
# ── 已知干扰（若要用本脚本判"吸:呼 相位数比"，必须先扣掉）─────────────────────────
#   ① **动势调幅**：`AssistantOrb.draw()` 的 `vitalityGain(this.vitalCur, ORB_VITAL_AMP_SPAN)`
#      会按**真实吐字速率**把呼吸幅度乘上 `1 ± 0.18`（高速更"有劲"、停顿收敛）
#      ⇒ 包络会被流式内容调制；**必须**在采集窗口内"无新内容到达"，或同时记录吐字速率。
#   ② **固定 bbox**：光球只占屏上一小块（默认直径 22vp ≈ 66px @3x）。全屏亮度会被
#      「思考 N 字」/光标/工具 pill 的**颜色变化**污染 ⇒ **只统计光球固定 bbox 内的像素**。
#   另：`orbMode` 可能在窗口内切 `thinking/tool/secondary/idle`（帧率与幅度都变）
#      ⇒ 采集期间**不要**触发工具调用/切换会话。
#
# ── 本脚本的契约（做了什么 / 不做什么）──────────────────────────────────────────
#   ✅ 采集：**带延时**逐帧 `snapshot_display`（默认 150ms/帧 ⇒ 20 帧 = 3s ≥ 1 个呼吸周期 2560ms）
#   ✅ 记录：sidecar `*.tsv`（帧号 / host 时间戳 / md5）—— 事后可复核"这帧是什么时候采的"
#   ✅ 门禁：结束时**排序去重后唯一值 < 2 ⇒ 打印 `SAMPLE_INVALID` 并以 1 退出**（白绿防线）
#   ⛔ 不判波形：帧率未知 + 上面两条干扰 ⇒ 本脚本**不下**"4:6"这类结论。
#      相位正确性另有**离线判别力判据**（`tools/tests/orb.test.ts`：峰值在 `0.4×周期`、两段各自单调）。
#
# ── 用法 ──────────────────────────────────────────────────────────────────────
#   TARGET=127.0.0.1:5555 bash tools/perf/orb_burst.sh                 # 20 帧 @150ms
#   TARGET=127.0.0.1:5555 bash tools/perf/orb_burst.sh 24 150 /tmp/burst
#
# ⛔ 设备纪律：本脚本**只截图**（不点击/不滑动/不启停应用）。采之前请确认**没人在用设备**
#    （多线并行会互相污染 —— 见 docs/ARKTS-GOTCHAS.md 批次 20/24）。
set -uo pipefail

N="${1:-20}"
DELAY_MS="${2:-150}"
OUTDIR="${3:-/tmp/orb-burst}"
PKG="${PKG:-com.chronostasys.xbot}"
# 一个完整呼吸周期：core/orb.ets ORB_BREATH_MS = D_SLOW(320) * 8 = 2560ms
PERIOD_MS=2560

if [ -z "${OHOS_SDK:-}" ] && [ -f "$HOME/ohos-cli/env.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/ohos-cli/env.sh" >/dev/null 2>&1 || true
fi
HDC="${HDC:-$(command -v hdc 2>/dev/null || true)}"
[ -n "${HDC}" ] || { echo "❌ 找不到 hdc（先 source ~/ohos-cli/env.sh）" >&2; exit 1; }
T="${TARGET:-$("${HDC}" list targets 2>/dev/null | tr -d '\r' | grep ':' | head -1)}"
[ -n "${T}" ] || { echo "❌ 没有设备" >&2; exit 2; }

mkdir -p "${OUTDIR}"
TSV="${OUTDIR}/frames.tsv"
: > "${TSV}"
printf 'frame\thost_ts\tmd5\tbytes\n' >> "${TSV}"

SPAN_MS=$(( N * DELAY_MS ))
echo "target=${T}  frames=${N}  delay=${DELAY_MS}ms  span=${SPAN_MS}ms  out=${OUTDIR}"
if [ "${SPAN_MS}" -lt "${PERIOD_MS}" ]; then
  echo "⚠️ 采样跨度 ${SPAN_MS}ms < 1 个呼吸周期 ${PERIOD_MS}ms ⇒ **不足以**覆盖一次完整吸/呼；"
  echo "   即使样本有效，也不能据此判相位比（请增大帧数或延时）。"
fi

echo "⏳ 采集（逐帧 snapshot_display + ${DELAY_MS}ms 间隔）…"
i=0
while [ "${i}" -lt "${N}" ]; do
  i=$(( i + 1 ))
  HOST_TS="$(python3 -c 'import time;print("%.3f"%time.time())' 2>/dev/null || date +%s)"
  # 设备侧落盘 → 立刻 recv（两次调用之间不叠加额外 sleep，延时由末尾统一 sleep 控制）
  "${HDC}" -t "${T}" shell "snapshot_display -f /data/local/tmp/orb_${i}.jpeg" >/dev/null 2>&1 || true
  "${HDC}" -t "${T}" file recv "/data/local/tmp/orb_${i}.jpeg" "${OUTDIR}/f${i}.jpeg" >/dev/null 2>&1 || true
  if [ -s "${OUTDIR}/f${i}.jpeg" ]; then
    M="$(md5 -q "${OUTDIR}/f${i}.jpeg" 2>/dev/null || md5sum "${OUTDIR}/f${i}.jpeg" | awk '{print $1}')"
    B="$(wc -c < "${OUTDIR}/f${i}.jpeg" | tr -d ' ')"
    printf '%s\t%s\t%s\t%s\n' "${i}" "${HOST_TS}" "${M}" "${B}" >> "${TSV}"
  else
    printf '%s\t%s\t%s\t%s\n' "${i}" "${HOST_TS}" "MISSING" "0" >> "${TSV}"
  fi
  sleep "$(python3 -c "print(${DELAY_MS}/1000.0)" 2>/dev/null || echo 0.15)"
done

# ── 门禁：唯一值 < 2 ⇒ 样本无时间信息 ⇒ 判无效（宁判无效，不给假结论）────────────
UNIQ="$(awk -F'\t' 'NR>1 && $3!="MISSING" {print $3}' "${TSV}" | sort -u | wc -l | tr -d ' ')"
GOT="$(awk -F'\t' 'NR>1 && $3!="MISSING"' "${TSV}" | wc -l | tr -d ' ')"
echo "采到 ${GOT}/${N} 帧；md5 唯一值 = ${UNIQ}"

if [ "${GOT}" -lt 2 ] || [ "${UNIQ}" -lt 2 ]; then
  echo "SAMPLE_INVALID"
  cat <<'TXT'
⇒ 逐帧画面**完全相同**（或几乎没有帧）⇒ 序列不含时间信息，**不得**据此判任何动效结论。
   常见成因（按概率）：
     · 应用当时**不在动画态**（无在飞行 / 已停表 / 后台）；
     · `snapshot_display` 取到**缓存帧**（合成器快照不等新 vsync）；
     · 采集太快，两次快照之间屏上没有新帧。
   处置：确认会话处于「运行中」（有在飞行）后重采；必要时**加大延时**（如 300ms）再试。
TXT
  exit 1
fi

echo "SAMPLE_OK（有差异 ⇒ 至少证明"画面在变"；**仍不**等于"呼吸相位正确"）"
echo "sidecar: ${TSV}"
cat <<'TXT'
下一步（判"吸:呼"必须先满足这三条，缺一不可）：
  ① 跨度 ≥ 1 个呼吸周期（2560ms）—— 脚本已在开头提示；
  ② 采集窗口内**没有流式新内容**（否则 vitalityGain 的 ±18% 调幅会污染包络）；
  ③ 统计**只取光球固定 bbox 内**的像素（不要全屏亮度）。
  ⇒ 三条都满足后，按"亮度阈值以上像素数"分段（上升=吸 / 下降=呼），段长比期望 ≈ 4:6
     （`core/orb.ets:ORB_BREATH_INHALE = 0.4`；离线判据见 tools/tests/orb.test.ts）。
TXT
exit 0
