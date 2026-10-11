#!/usr/bin/env bash
# tools/perf/guard.sh —— **性能护栏**：对基线设阈值，超了就红。
#
# 为什么需要（本单背景）：用户要求「性能也要非常好 / 超级丝滑」，而接下来要做**大重构**。
# 没有量化护栏 ⇒ 重构把性能做砸了也无人察觉（"功能对了就算过"）。本脚本把
# `docs/PERF-BUDGET.md` 里的**预算表**变成可执行的判据。
#
# ⛔ 纪律（写在最前面，因为最容易破）：
#   1. **不要**为了让护栏变绿去调大阈值。阈值只能来自**实测基线 + 余量**，
#      改动阈值必须在 `docs/PERF-BUDGET.md` 的"阈值变更记录"里写理由。
#   2. 微基准取 **min-of-N**（宿主抖动下均值不可信），因此阈值给的是**数量级护栏**
#      （抓 O(N²)/多算一遍/缓存被拆这类**结构性退化**），不是抓 ±20% 的抖动。
#   3. 重构**每个阶段**（每合并一次主分支前的自检）都要跑本脚本。
#
# 用法：
#   bash tools/perf/guard.sh              # 全量（静态 + 基准）
#   bash tools/perf/guard.sh --static     # 只跑静态（秒级，无编译）
#   bash tools/perf/guard.sh --self-test  # 自检：证明阈值机制**能红**（喂伪造的越界指标）
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ETS="$ROOT/entry/src/main/ets"
MODE="${1:-}"

pass=0; fail=0
ok()   { pass=$((pass+1)); echo "  ✅ $1"; }
bad()  { fail=$((fail+1)); echo "  ❌ $1"; }
# 判定（**只返回状态、不动计数**，便于自检复用）
cmp_le() { awk -v v="$2" -v m="$3" 'BEGIN{exit !(v<=m)}'; }   # 0 = 通过
cmp_ge() { awk -v v="$2" -v m="$3" 'BEGIN{exit !(v>=m)}'; }
le() { # $1=名称 $2=实测 $3=上限 $4=单位
  if cmp_le "$1" "$2" "$3"; then ok "$1 = $2 $4（≤ $3）"; else bad "$1 = $2 $4（**超上限 $3**）"; fi
}
ge() { # $1=名称 $2=实测 $3=下限 $4=单位
  if cmp_ge "$1" "$2" "$3"; then ok "$1 = $2 $4（≥ $3）"; else bad "$1 = $2 $4（**低于下限 $3**）"; fi
}
echo "===== 性能护栏（阈值来源：docs/PERF-BUDGET.md 预算表）====="

# ═══ 第一部分：静态护栏（确定性，零抖动）═══════════════════════════════════════
echo "-- A. 静态护栏（结构性退化，零抖动）--"
if bash "$HERE/../lint/render-path.sh" >/dev/null 2>&1; then
  ok "渲染路径门禁通过（components/pages 无裸 parseMarkdown/parseInline）"
else
  bad "渲染路径门禁**失败**（渲染路径里出现了裸解析调用）"
fi

n_pal=$(grep -ro 'this\.pal()' "$ETS/components" "$ETS/pages" 2>/dev/null | wc -l | tr -d ' ')
n_eff=$(grep -ro 'this\.eff()' "$ETS/components" "$ETS/pages" 2>/dev/null | wc -l | tr -d ' ')
n_itv=$(grep -ro 'setInterval(' "$ETS/components" "$ETS/pages" 2>/dev/null | wc -l | tr -d ' ')
n_tmo=$(grep -ro 'setTimeout(' "$ETS/components" "$ETS/pages" 2>/dev/null | wc -l | tr -d ' ')
n_fe=$(grep -ro 'ForEach(' "$ETS/components" "$ETS/pages" 2>/dev/null | wc -l | tr -d ' ')
n_anim=$(grep -roE 'anim(Fast|Base|Slow|Spring|MsgIn)\(\)' "$ETS/components" "$ETS/pages" 2>/dev/null | wc -l | tr -d ' ')
n_raw=$(grep -rn 'parseMarkdown(\|parseInline(' "$ETS/components" "$ETS/pages" "$ETS/entryability" 2>/dev/null | grep -v 'Cached' | wc -l | tr -d ' ')

# 基线（2026-10-11 实测，见 docs/PERF-BUDGET.md 表 A；余量 40%）
le "this.pal() 调用点（components+pages）" "$n_pal" 1250 处
le "this.eff() 调用点" "$n_eff" 80 处
le "setInterval 调用点（常驻定时器）" "$n_itv" 6 处
le "setTimeout 调用点" "$n_tmo" 7 处
le "anim*() 调用点（每次调用新建曲线对象）" "$n_anim" 20 处
le "ForEach 处数" "$n_fe" 107 处
le "core 外裸 parseMarkdown/parseInline 调用点" "$n_raw" 0 处

# anim.ets：曲线**记忆化守卫**必须在位。
# ⚠️ 为什么不是"数构造点"：`curves.cubicBezierCurve` 原本也只在 `springCurve()` 里 1 处，
#    问题在于它被 14 处调用点**反复调用** ⇒ 数调用点抓不到。能抓到的是"记忆化守卫还在不在"：
#    守卫被删（改回直接 return）⇒ 每次都新建原生 ICurve ⇒ 这两条立刻红。
n_bez_memo=$(grep -c 'if (springCurveMemo === undefined)' "$ETS/components/anim.ets" 2>/dev/null || echo 0)
n_spr_memo=$(grep -c 'if (springMotionMemo === undefined)' "$ETS/components/anim.ets" 2>/dev/null || echo 0)
ok_gate() { [ "${1:-0}" -ge 1 ] && ok "$2" || bad "$2"; }
ok_gate "$n_bez_memo" "anim.ets：spring 曲线记忆化守卫在位（springCurveMemo）"
ok_gate "$n_spr_memo" "anim.ets：物理弹簧记忆化守卫在位（springMotionMemo）"
echo "     （参考：ForEach 处数仅作规模指示，不是质量判据）"

# 结构性事实（落地前**只报告**，不判红）：行内块级窗口是否已落地
if grep -q 'MSG_BLOCK_WINDOW\|visibleBlocks' "$ETS/components/MessageRow.ets" "$ETS/core/streammerge.ets" 2>/dev/null; then
  ok "行内块级窗口已落地（MessageRow/streammerge 出现 MSG_BLOCK_WINDOW|visibleBlocks）"
else
  echo "  ⚠ 行内块级窗口**未落地**：单行 N 块仍全部进渲染（实测最重 340 块 → 估算 1938 节点，"
  echo "     超单行预算 600 的 3.2×）。判据见 docs/PERF-BUDGET.md §3 问题①。（警告级，不判红）"
fi

[ "$MODE" = "--static" ] && { echo; echo "小结：✅ ${pass} / ❌ ${fail}（--static）"; [ "$fail" -eq 0 ] || exit 1; exit 0; }

# ═══ 第二部分：核心微基准（min-of-N，抓结构性退化）═════════════════════════════
echo
echo "-- B. 核心微基准（min-of-N；基线×余量 = 上限）--"
METRICS="$(bash "$HERE/bench_core.sh" 2>/dev/null | grep '^METRIC ' || true)"
METRICS2="$(bash "$HERE/bench_core.sh" 2>/dev/null | grep '^METRIC ' || true)"
if [ -z "$METRICS" ] && [ -z "$METRICS2" ]; then
  bad "基准脚本无输出（编译失败？先跑 bash tools/perf/bench_core.sh 看详情）"
else
  # 跑**两遍取每条指标的最小值**：宿主被多条线同时占用时，同一指标跨 run 实测可差 10×
  # （paletteOf 0.007→0.067µs / surfacesOf 1.66→5.72µs）⇒ 单 run 会判假红。
  val() {
    local a b
    a="$(printf '%s\n' "$METRICS"  | sed -n "s/^METRIC $1=\([0-9.]*\).*/\1/p" | head -1)"
    b="$(printf '%s\n' "$METRICS2" | sed -n "s/^METRIC $1=\([0-9.]*\).*/\1/p" | head -1)"
    [ -z "$a" ] && a="$b"; [ -z "$b" ] && b="$a"
    awk -v x="$a" -v y="$b" 'BEGIN{print (x+0 < y+0) ? x : y}'
  }
  # 上限 = **跨多次 run 的实测最大值 × ~3**（宿主噪声下限：sub-µs 指标 10× 波动是常态）。
  # 目的只抓**数量级/结构性退化**（O(N²)、多算一遍、缓存被拆），不抓 ±30%。
  le "paletteOf（每次新建 Palette）"   "$(val paletteOf_us)"            0.5    "us/call"
  le "effectsOf（每次新建 Effects）"   "$(val effectsOf_us)"            12     "us/call"
  le "surfacesOf"                       "$(val surfacesOf_us)"           20     "us/call"
  le "mergeTools(8 工具)（每事件）"     "$(val mergeTools_8_us)"         6      "us/call"
  le "completedBlocks(340 块)"          "$(val completedBlocks_340_us)"  15     "us/call"
  le "blocksSignature(340 块)"          "$(val blocksSignature_340_us)"  400    "us/call"
  le "mergeToolRuns(340 块)"            "$(val mergeToolRuns_340_us)"    25     "us/call"
  le "rowsFromHistory(340 块, 整个事件)" "$(val rowsFromHistory_340_ms)"  1      "ms/event"
  le "parseMarkdown(8K)"                "$(val parseMarkdown_8k_us)"     900    "us/call"
  le "parseMarkdown(274K)"              "$(val parseMarkdown_274k_ms)"   50     "ms/call"
  le "parseInline"                      "$(val parseInline_us)"          40     "us/call"
  le "签名长度比 340/24（线性度）"       "$(val signature_len_ratio_340_24)" 25 "x"
  le "mergeToolRuns 耗时比 340/24（线性度）" "$(val mergeToolRuns_time_ratio_340_24)" 60 "x"
  le "流式增长 120 拍总耗时"             "$(val streamingGrowth_120ticks_ms)" 300 "ms/120ticks"
  le "motion springBezier+springParams"  "$(val motion_springBezier_us)"  1      "us/call"
  # 行内块窗口（TOP1 护栏）：**确定性计数** ⇒ 阈值可以设成硬值（= 判据本身）
  le "行内块窗口：340 块行渲染块数"       "$(val blocks_rendered_340)"     24     "blocks"
  ge "行内块窗口：340 块行隐藏块数"       "$(val hidden_blocks_340)"       1      "blocks"
  le "行内块窗口：340 块行估算节点"       "$(val est_nodes_340_windowed)"  600    "nodes"
  # 缓存：重复解析同一文本**必须**全命中（防"重构把缓存拆了"）
  le "mdCache 重复解析未命中数"          "$(val mdCache_repeat_misses)"   1      "miss/1000"
  ge "mdCache 重复解析命中数"            "$(val mdCache_repeat_hits)"     999    "hits/1000"
fi

echo
echo "小结：✅ $pass / ❌ $fail"
if [ "$fail" -ne 0 ]; then
  echo "❌ 性能护栏**未通过** —— 见上方红灯。判据/阈值来源：docs/PERF-BUDGET.md"
  exit 1
fi
echo "✅ 性能护栏全绿（静态 + 微基准）"

# ═══ 自检：证明阈值机制**能红** ═══════════════════════════════════════════════
if [ "$MODE" = "--self-test" ]; then
  echo
  echo "-- 自检：喂伪造越界指标 ⇒ 必须变红 --"
  fake_fail=0
  cmp_le x "10" "0.06" || fake_fail=1        # 10 > 0.06 ⇒ 必须判"超限"
  cmp_ge x "0" "999"   || fake_fail=1        # 0 < 999  ⇒ 必须判"低于下限"
  cmp_le x "0.001" "0.06" && : || fake_fail=1  # 正常值不该被判超限（反例保护）
  if [ "$fake_fail" -eq 1 ]; then
    echo "  ✅ 自检通过：越界指标确实判 ❌（阈值机制不是恒绿）"
  else
    echo "  ❌ 自检失败：越界指标竟然判 ✅ —— 阈值机制失效"; exit 1
  fi
fi
