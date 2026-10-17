#!/usr/bin/env bash
# 隔离单测 —— 只编译并运行**名字匹配 <子串>** 的 `tools/tests/*.test.ts`。
#
# 为什么需要它（真问题）：共享套件 `tools/tests/run.sh` 用 `set -e` ⇒ **一遇红测试就整体中止**
#   （它把所有测试和所有 core 文件一起 tsc + 逐个 node）。只要**别人**的在途改动让某个测试红，
#   十几条线**全都拿不到自己的判定**。本脚本把"编译范围"缩到**你关心的那几个测试**，
#   别人的红测试不再拖住你（core 文件仍全量编译 —— 因为它们是我的测试的真实依赖）。
#
# 用法：
#   bash tools/tests/run-one.sh                 # 无参：列出可用测试名 + 总数（覆盖范围可数）
#   bash tools/tests/run-one.sh streammerge     # 只跑文件名含 streammerge 的测试
#   bash tools/tests/run-one.sh sse             # 子串匹配 ⇒ 跑 sse.test / sse_*.test 等全部
#
# 退出码：0 全过 · 2 找不到匹配的测试名 · 3 编译失败（常见于**别人在途文件**的编译错误）· 否则 = 测试失败数
#
# ⚠️ 本脚本**不改** `run.sh`（它被多条线共用，改它风险高），但**复刻**其编译环境（逐项等价）：
#    core/*.ets ⇒ .ts + core/*.ts + 测试 + stubs + `sed` 路径改写 + @kit.*/prism4j/notify mock + 同款 find_tsc。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export NODE_OPTIONS="--require $HERE/i18n_normalize.js${NODE_OPTIONS:+ $NODE_OPTIONS}"
ROOT="$(cd "$HERE/../.." && pwd)"
# ⚠️ 目录名带 PID：并发跑互不干扰（与 run.sh 同思路；另一个名字避免与 .out.$$ 撞）
OUT="$HERE/.out-one.$$"

rm -rf "$OUT"
trap 'rm -rf "$OUT"' EXIT

FILTER="${1:-}"

# 可用测试名（按文件名排序，便于稳定输出）
list_tests() {
  local n=0 t b
  for t in "$HERE"/*.test.ts; do
    [ -f "$t" ] || continue
    b="$(basename "$t" .test.ts)"
    echo "  ${b}"
    n=$((n + 1))
  done
  echo "  ── 共 ${n} 个测试文件"
}

if [ -z "$FILTER" ]; then
  echo "可用测试（子串匹配；用法：bash tools/tests/run-one.sh <子串>）："
  list_tests
  exit 0
fi

# ── 收集匹配的测试文件 ────────────────────────────────────────────────────────
matches=()
for t in "$HERE"/*.test.ts; do
  [ -f "$t" ] || continue
  case "$(basename "$t")" in
    *"${FILTER}"*.test.ts) matches+=("$t") ;;
  esac
done

if [ "${#matches[@]}" -eq 0 ]; then
  echo "❌ 没有匹配「${FILTER}」的测试文件。可用测试："
  list_tests
  exit 2
fi

echo "▶ 隔离运行 ${#matches[@]} 个测试（匹配「${FILTER}」）："
for t in "${matches[@]}"; do
  echo "    $(basename "$t")"
done

# ── 复刻 run.sh 的编译环境 ────────────────────────────────────────────────────
find_tsc() {
  if [ -n "${TSC:-}" ] && [ -x "$TSC" ]; then echo "$TSC"; return; fi
  if command -v tsc >/dev/null 2>&1; then command -v tsc; return; fi
  for p in "$ROOT/../xbot/web/node_modules/.bin/tsc" "$HOME/src/xbot/web/node_modules/.bin/tsc"; do
    if [ -x "$p" ]; then echo "$p"; return; fi
  done
  echo "npx --yes -p typescript@5 tsc"
}
TSC_BIN="$(find_tsc)"

mkdir -p "$OUT"
# core/*.ets 当纯 TS 编译：拷成 .ts（与 run.sh 逐项相同）
for f in "$ROOT"/entry/src/main/ets/core/*.ets "$ROOT"/entry/src/main/ets/core/*.ts; do
  [ -f "$f" ] || continue
  b="$(basename "$f")"
  case "$b" in
    *.ets) cp "$f" "$OUT/${b%.ets}.ts" ;;
    *.ts)  cp "$f" "$OUT/$b" ;;
  esac
done
# 测试文件：**只拷匹配的**（这正是"隔离"的关键 —— 别人的红测试不进编译）
for t in "${matches[@]}"; do
  sed 's#\.\./\.\./entry/src/main/ets/core/#./#g' "$t" > "$OUT/$(basename "$t")"
done
# 非测试的 TS 辅助件（vitest 垫片等）—— 移植的 web 测试 `import … from './vitest_shim'` 需要它
for h in "$HERE"/*.ts; do
  case "$(basename "$h")" in
    *.test.ts) ;;
    *) cp "$h" "$OUT/$(basename "$h")" ;;
  esac
done

# core/ 里 http/sse/config 依赖 @kit.* ⇒ 必须带最小 SDK stub（同 run.sh）
cp "$ROOT/tools/typecheck/stubs/"*.d.ts "$OUT/"

TSC_LOG="$(mktemp -t xbot-run-one-tsc.XXXXXX)"
if ! $TSC_BIN "$OUT"/*.ts --module commonjs --target ES2021 --strict --skipLibCheck --experimentalDecorators --outDir "$OUT/js" >"$TSC_LOG" 2>&1; then
  echo ""
  echo "❌ 编译失败（tsc 退出非 0）。错误尾部："
  tail -25 "$TSC_LOG"
  rm -f "$TSC_LOG"
  echo ""
  echo "⚠️ 这可能是**别人在途文件**的编译错误（core/ 是**全量**编译的，因为它是测试的真实依赖）。"
  echo "   若错误落在与你无关的 core 文件里 ⇒ 不是你的问题，请把上面原文贴给调度者。"
  exit 3
fi
rm -f "$TSC_LOG"

# ── 装 mock（与 run.sh 逐项相同）─────────────────────────────────────────────
mkdir -p "$OUT/js/node_modules/@kit.NetworkKit"
cp "$HERE/mocks/NetworkKit.js" "$OUT/js/node_modules/@kit.NetworkKit/index.js"
mkdir -p "$OUT/js/node_modules/@kit.ArkTS"
cp "$HERE/mocks/ArkTS.js" "$OUT/js/node_modules/@kit.ArkTS/index.js"
mkdir -p "$OUT/js/node_modules/@kit.PushKit"
cp "$HERE/mocks/PushKit.js" "$OUT/js/node_modules/@kit.PushKit/index.js"
mkdir -p "$OUT/js/node_modules/@kit.BasicServicesKit"
cp "$HERE/mocks/BasicServicesKit.js" "$OUT/js/node_modules/@kit.BasicServicesKit/index.js"
cat > "$OUT/js/node_modules/@kit.ArkTS/package.json" <<'PKG2'
{ "name": "@kit.ArkTS", "version": "0.0.0", "main": "index.js" }
PKG2
cat > "$OUT/js/node_modules/@kit.NetworkKit/package.json" <<'PKG'
{ "name": "@kit.NetworkKit", "version": "0.0.0", "main": "index.js" }
PKG
mkdir -p "$OUT/js/node_modules/@hxa-atpc/noties_prism4j"
cp "$HERE/mocks/prism4j.js" "$OUT/js/node_modules/@hxa-atpc/noties_prism4j/index.js"
cat > "$OUT/js/node_modules/@hxa-atpc/noties_prism4j/package.json" <<'PKG3'
{ "name": "@hxa-atpc/noties_prism4j", "version": "0.0.0", "main": "index.js" }
PKG3
install_notify_sdk() {
  local name="$1"
  mkdir -p "$OUT/js/node_modules/${name}"
  cp "$HERE/mocks/notify_sdk.js" "$OUT/js/node_modules/${name}/index.js"
  printf '{ "name": "%s", "version": "0.0.0", "main": "index.js" }\n' "${name}" \
    > "$OUT/js/node_modules/${name}/package.json"
}
install_notify_sdk '@ohos.notificationManager'
install_notify_sdk '@ohos.app.ability.wantAgent'
install_notify_sdk '@ohos.resourceschedule.backgroundTaskManager'
cp "$HERE/mocks/decorators.js" "$OUT/js/__decorators.js"

# ── 只跑匹配的测试（失败即停并透传退出码）──────────────────────────────────────
rc=0
for t in "${matches[@]}"; do
  b="$(basename "$t" .test.ts)"
  echo ""
  echo "── ${b}.test.ts ──"
  node -r "$OUT/js/__decorators.js" "$OUT/js/${b}.test.js" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "❌ ${b} 失败（exit ${rc}）"
    exit "$rc"
  fi
done

echo ""
echo "✅ 隔离单测通过（${#matches[@]} 个文件）"
exit 0
