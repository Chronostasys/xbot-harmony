#!/usr/bin/env bash
# deeplink-verify.sh —— 深链命令路由**真机**验证（S1）—— **一次跑完全部用例**
#
# 被测实现：`entryability/EntryAbility.ets: captureCommandUri(want)`（`core/command.ets` 的唯一生产消费点）。
# 判据文案**逐条抄自实现里的 hilog 字面量**（⛔ 不抄文档，防"文档/实现漂移"）：
#   · 合法    ⇒ `deep-link 命令已投递`
#   · 未注册  ⇒ `命令**未注册**`（附已注册集合）
#   · 形状非法 ⇒ `命令形状非法`（id 无点号命名空间 / 非法字符）
#   · 非命令  ⇒ **不得**出现任何 `deep-link` 行（普通 URL 不该被接管）
#
# ⛔ 判据纪律（本仓 `readability-scan.sh` 同款）：
#   · **零扫描判红**：hilog 取不到 / 该用例的日志窗口为空 ⇒ 显式 `SAMPLE_INVALID` + **计入失败**，
#     绝不当"通过"（白绿防线）。
#   · **逐用例隔离**：每条前 `hilog -r` 清缓冲；若你的设备上该语义不同（dump 为空）⇒ 会判
#     `SAMPLE_INVALID`（⛔ 不会假绿）—— 首次跑若见它，改用 `--append` 模式（见下）。
#
# 用法：
#   bash tools/device/deeplink-verify.sh                 # 冷启动路径（每条前 force-stop ⇒ 走 onCreate）
#   bash tools/device/deeplink-verify.sh --hot           # 热启动路径（不 force-stop ⇒ 走 onNewWant）
#   bash tools/device/deeplink-verify.sh --pkg <包名>
#   bash tools/device/deeplink-verify.sh --out /tmp/dp   # 日志落点（默认 /tmp/xbot-deeplink）
#
# ⚠️ 需设备空闲（会 force-stop / start 目标 App）；⛔ 验收窗口内别跟他人抢设备。
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
MODE="cold"
OUT="${OUT:-/tmp/xbot-deeplink}"
DEV="${DEV:-/data/local/tmp}"
while [ $# -gt 0 ]; do
  case "$1" in
    --hot) MODE="hot" ;;
    --cold) MODE="cold" ;;
    --pkg) PKG="${2:?--pkg 需要值}"; shift ;;
    --out) OUT="${2:?--out 需要值}"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
  shift
done
mkdir -p "$OUT"

# ── 用例表：`<uri>|<必须匹配的关键字>|<kind>`，kind = must | mustnot ────────────────
# mustnot 的关键字固定为 `deep-link`（= 任何 deep-link 日志都算违规）。
CASES=(
  "xbot://settings.open?section=llm|deep-link 命令已投递|must"
  "xbot://session.new|deep-link 命令已投递|must"
  "xbot://sidebar.toggle|deep-link 命令已投递|must"
  "xbot://input.focus|deep-link 命令已投递|must"
  "xbot://totally.madeup|未注册|must"
  "xbot://nodot|命令形状非法|must"
  "https://example.com|deep-link|mustnot"
)

pass=0; fail=0; invalid=0
echo "▶ 深链验证（包名=$PKG  路径=$MODE  设备=$T  日志=$OUT）"
printf '   %-38s %-22s %s\n' "URI" "期望" "结果"

for i in "${!CASES[@]}"; do
  IFS='|' read -r uri want kind <<< "${CASES[$i]}"
  # ① 清缓冲（逐用例隔离；⛔ 失败不中止，靠下面的空窗判 SAMPLE_INVALID）
  "$HDC" -t "$T" shell "hilog -r" >/dev/null 2>&1 || true
  # ② 冷/热路径
  if [ "$MODE" = "cold" ]; then
    "$HDC" -t "$T" shell "aa force-stop $PKG" >/dev/null 2>&1 || true
  fi
  # ③ 深链拉起（⚠️ uri 用单引号包住，避免 shell 把 `?`/`&` 吃掉）
  "$HDC" -t "$T" shell "aa start -a EntryAbility -b $PKG --uri '$uri'" >/dev/null 2>&1 || true
  sleep 2
  # ④ 取日志（先落设备临时文件再 recv —— 与 `docs/NOTIFY-ACCEPTANCE.md:163` 同款，避免交互式管道）
  log="$OUT/case$((i + 1)).txt"
  rm -f "$log"
  "$HDC" -t "$T" shell "hilog -x > $DEV/dp.txt" >/dev/null 2>&1 || true
  "$HDC" -t "$T" file recv "$DEV/dp.txt" "$log" >/dev/null 2>&1 || true

  # ⑤ 零扫描判红：日志窗口为空 ⇒ SAMPLE_INVALID（⛔ 绝不当通过）
  if [ ! -s "$log" ]; then
    printf '   %-38s %-22s %s\n' "$uri" "$kind:$want" "SAMPLE_INVALID（日志空：设备/清缓冲语义？）"
    invalid=$((invalid + 1)); continue
  fi

  hits="$(grep -c -- "$want" "$log" 2>/dev/null || true)"
  hits="${hits:-0}"
  if [ "$kind" = "must" ]; then
    if [ "$hits" -ge 1 ]; then
      printf '   %-38s %-22s %s\n' "$uri" "must:$want" "✅ PASS（命中 $hits）"
      pass=$((pass + 1))
    else
      printf '   %-38s %-22s %s\n' "$uri" "must:$want" "❌ FAIL（0 命中；见 $log）"
      fail=$((fail + 1))
    fi
  else
    if [ "$hits" -eq 0 ]; then
      printf '   %-38s %-22s %s\n' "$uri" "mustnot:$want" "✅ PASS（未接管）"
      pass=$((pass + 1))
    else
      printf '   %-38s %-22s %s\n' "$uri" "mustnot:$want" "❌ FAIL（不该有 deep-link 日志，命中 $hits）"
      fail=$((fail + 1))
    fi
  fi
done

echo "── 小结：PASS=$pass  FAIL=$fail  SAMPLE_INVALID=$invalid（共 ${#CASES[@]} 条）"
if [ "$fail" -gt 0 ] || [ "$invalid" -gt 0 ]; then
  echo "❌ 未通过（⛔ SAMPLE_INVALID 也算失败 —— 不可当「设备没反应」放过）"
  exit 1
fi
echo "✅ 全部通过"
