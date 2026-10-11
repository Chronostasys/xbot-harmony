#!/usr/bin/env bash
# tools/perf/lib_build.sh —— 把 `entry/src/main/ets/core/**` 编译成**可在 node 里真跑**的 JS。
#
# 为什么需要单独一份：`tools/tests/run.sh` 把 core 编译成"纯 TS"跑测试，是**测试**入口；
# 性能护栏需要同一个**编译口径**（同样的 stub / mock / 装饰器垫片）去跑基准脚本，
# 且要能反复调用（bench / guard）。这里只做编译，不跑任何断言。
#
# 用法：bash tools/perf/lib_build.sh <输出目录> [额外要一起编译的 .ts 文件…]
# 产物：<输出目录>/js/*.js   （用 `node -r <输出目录>/js/__decorators.js` 跑）
#
# ⚠️ 门禁/性能脚本**不要**改本文件的编译参数去"让数字好看"：
#    口径必须与 tools/tests/run.sh 一致，否则基线与测试不可比。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${1:?用法: lib_build.sh <输出目录> [extra.ts…]}"
shift || true

rm -rf "$OUT"; mkdir -p "$OUT"
for f in "$ROOT"/entry/src/main/ets/core/*.ets "$ROOT"/entry/src/main/ets/core/*.ts; do
  [ -f "$f" ] || continue
  b="$(basename "$f")"
  case "$b" in
    *.ets) cp "$f" "$OUT/${b%.ets}.ts" ;;
    *.ts)  cp "$f" "$OUT/$b" ;;
  esac
done
cp "$ROOT/tools/typecheck/stubs/"*.d.ts "$OUT/"
for t in "$@"; do
  [ -f "$t" ] || continue
  sed 's#\.\./\.\./entry/src/main/ets/core/#./#g' "$t" > "$OUT/$(basename "$t")"
done

find_tsc() {
  if [ -n "${TSC:-}" ] && [ -x "$TSC" ]; then echo "$TSC"; return; fi
  for p in "$ROOT/../xbot/web/node_modules/.bin/tsc" "$HOME/src/xbot/web/node_modules/.bin/tsc"; do
    [ -x "$p" ] && { echo "$p"; return; }
  done
  command -v tsc
}
TSC_BIN="$(find_tsc)"
"$TSC_BIN" "$OUT"/*.ts --module commonjs --target ES2021 --strict --skipLibCheck \
  --experimentalDecorators --outDir "$OUT/js" 2>&1 | grep -vE '^\.\./|sse\.ts' | head -10

# 与 run.sh 同一套运行期 mock（@kit.* / 装饰器 / 通知 / prism4j）
J="$OUT/js"
mkdir -p "$J/node_modules/@kit.NetworkKit" "$J/node_modules/@kit.ArkTS"
cp "$ROOT/tools/tests/mocks/NetworkKit.js" "$J/node_modules/@kit.NetworkKit/index.js"
cp "$ROOT/tools/tests/mocks/ArkTS.js" "$J/node_modules/@kit.ArkTS/index.js"
printf '{ "name": "@kit.NetworkKit", "version": "0.0.0", "main": "index.js" }\n' > "$J/node_modules/@kit.NetworkKit/package.json"
printf '{ "name": "@kit.ArkTS", "version": "0.0.0", "main": "index.js" }\n' > "$J/node_modules/@kit.ArkTS/package.json"
mkdir -p "$J/node_modules/@hxa-atpc/noties_prism4j"
cp "$ROOT/tools/tests/mocks/prism4j.js" "$J/node_modules/@hxa-atpc/noties_prism4j/index.js"
printf '{ "name": "@hxa-atpc/noties_prism4j", "version": "0.0.0", "main": "index.js" }\n' > "$J/node_modules/@hxa-atpc/noties_prism4j/package.json"
for n in '@ohos.notificationManager' '@ohos.app.ability.wantAgent' '@ohos.resourceschedule.backgroundTaskManager'; do
  mkdir -p "$J/node_modules/$n"; cp "$ROOT/tools/tests/mocks/notify_sdk.js" "$J/node_modules/$n/index.js"
  printf '{ "name": "%s", "version": "0.0.0", "main": "index.js" }\n' "$n" > "$J/node_modules/$n/package.json"
done
cp "$ROOT/tools/tests/mocks/decorators.js" "$J/__decorators.js"
echo "OK $J"
