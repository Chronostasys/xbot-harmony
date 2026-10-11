#!/usr/bin/env bash
# tools/perf/bench_core.sh —— 跑一遍离线核心基准，打印 METRIC 行（供人看 / 供 guard.sh 解析）。
#
# 用法：bash tools/perf/bench_core.sh              # 打印
#       bash tools/perf/bench_core.sh --json out   # 同时落一份 METRIC 文本
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${TMPDIR:-/tmp}/xbot-perf-bench.$$"
bash "$HERE/lib_build.sh" "$OUT" "$HERE/bench_core.ts" >/dev/null 2>&1 || true
[ -f "$OUT/js/bench_core.js" ] || { echo "❌ 编译失败（bash tools/perf/lib_build.sh $OUT $HERE/bench_core.ts 看详情）" >&2; exit 2; }
if [ "${1:-}" = "--json" ]; then
  node -r "$OUT/js/__decorators.js" "$OUT/js/bench_core.js" | tee "${2:-/tmp/xbot-perf-metrics.txt}"
else
  node -r "$OUT/js/__decorators.js" "$OUT/js/bench_core.js"
fi
rc=$?
rm -rf "$OUT"
exit "$rc"
