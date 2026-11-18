#!/usr/bin/env bash
# 全量单测（**聚合、不早退、增量编译、单进程执行**）—— `tools/gate.sh` 第 ① 步的入口。
#
# 硬约束（用户 2026-11-08）：**一次全量必须在 5 秒内跑完**（旧实现 3–5 分钟不可接受）。
# 慢的两个根因与对策：
#   ① 每次都全量 `tsc` 编译 428 个测试 + core 全量  ⇒ **持久缓存 + 增量**（源没变直接跳过编译）；
#   ② 每个测试起一个 `node` 进程（428 次进程启动）  ⇒ **单进程 require 全部**（`run-all-fast.js`）。
# ⛔ 覆盖面对齐旧实现：**所有** `*.test.ts` 都参与编译与执行，没有抽样/跳过；PASS/FAIL 语义不变
#    （任一测试红或编译失败 ⇒ 退出码非 0）。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export NODE_OPTIONS="--require $HERE/i18n_normalize.js${NODE_OPTIONS:+ $NODE_OPTIONS}"
ROOT="$(cd "$HERE/../.." && pwd)"
CACHE="$HERE/.build-cache"
STAMP="$CACHE/.stamp"

find_tsc() {
  if [ -n "${TSC:-}" ] && [ -x "$TSC" ]; then echo "$TSC"; return; fi
  if command -v tsc >/dev/null 2>&1; then command -v tsc; return; fi
  for p in "$ROOT/../xbot/web/node_modules/.bin/tsc" "$HOME/src/xbot/web/node_modules/.bin/tsc"; do
    if [ -x "$p" ]; then echo "$p"; return; fi
  done
  echo "npx --yes -p typescript@5 tsc"
}

# ── 增量判定：任何输入比 stamp 新 ⇒ 需要重新编译 ─────────────────────────────
need_build() {
  [ -f "$STAMP" ] || return 0
  local newer
  newer="$(find "$ROOT/entry/src/main/ets/core" "$HERE" "$ROOT/tools/typecheck/stubs" \
      -maxdepth 2 \( -name '*.ts' -o -name '*.ets' -o -name '*.js' -o -name '*.d.ts' \) \
      -newer "$STAMP" 2>/dev/null | grep -v '/\.build-cache/' | head -1)"
  [ -n "$newer" ]
}

build() {
  local OUT="$CACHE"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  # core/*.ets ⇒ .ts（与旧实现逐项相同）
  for f in "$ROOT"/entry/src/main/ets/core/*.ets "$ROOT"/entry/src/main/ets/core/*.ts; do
    [ -f "$f" ] || continue
    b="$(basename "$f")"
    case "$b" in
      *.ets) cp "$f" "$OUT/${b%.ets}.ts" ;;
      *.ts)  cp "$f" "$OUT/$b" ;;
    esac
  done
  # 测试：把 `../../entry/src/main/ets/core/` 改写成同目录相对路径
  for t in "$HERE"/*.test.ts; do
    [ -f "$t" ] || continue
    sed 's#\.\./\.\./entry/src/main/ets/core/#./#g' "$t" > "$OUT/$(basename "$t")"
  done
  for h in "$HERE"/*.ts; do
    case "$(basename "$h")" in
      *.test.ts) ;;
      *) cp "$h" "$OUT/$(basename "$h")" ;;
    esac
  done
  cp "$ROOT/tools/typecheck/stubs/"*.d.ts "$OUT/"

  local LOG
  LOG="$(mktemp -t xbot-run-all-tsc.XXXXXX)"
  if ! "$(find_tsc)" "$OUT"/*.ts --module commonjs --target ES2021 --strict --skipLibCheck \
      --experimentalDecorators --outDir "$OUT/js" >"$LOG" 2>&1; then
    echo "══ 纯逻辑测试（聚合）══"
    echo "❌ 归类：**编译失败**（tsc 非 0）—— 断言层未执行"
    tail -30 "$LOG" | sed 's/^/     /'
    rm -f "$LOG"
    echo ""
    echo "共 0 个测试文件，0 个失败（但**编译失败** ⇒ 判红）"
    return 1
  fi
  rm -f "$LOG"

  # mock（与旧实现逐项相同）
  local NM="$OUT/js/node_modules"
  mkdir -p "$NM/@kit.NetworkKit" "$NM/@kit.ArkTS" "$NM/@kit.PushKit" "$NM/@kit.BasicServicesKit" \
           "$NM/@hxa-atpc/noties_prism4j" "$NM/@ohos.notificationManager" \
           "$NM/@ohos.app.ability.wantAgent" "$NM/@ohos.resourceschedule.backgroundTaskManager"
  cp "$HERE/mocks/NetworkKit.js" "$NM/@kit.NetworkKit/index.js"
  cp "$HERE/mocks/ArkTS.js" "$NM/@kit.ArkTS/index.js"
  cp "$HERE/mocks/PushKit.js" "$NM/@kit.PushKit/index.js"
  cp "$HERE/mocks/BasicServicesKit.js" "$NM/@kit.BasicServicesKit/index.js"
  cp "$HERE/mocks/prism4j.js" "$NM/@hxa-atpc/noties_prism4j/index.js"
  cp "$HERE/mocks/notify_sdk.js" "$NM/@ohos.notificationManager/index.js"
  cp "$HERE/mocks/notify_sdk.js" "$NM/@ohos.app.ability.wantAgent/index.js"
  cp "$HERE/mocks/notify_sdk.js" "$NM/@ohos.resourceschedule.backgroundTaskManager/index.js"
  for m in '@kit.NetworkKit' '@kit.ArkTS' '@kit.PushKit' '@kit.BasicServicesKit'; do
    printf '{ "name": "%s", "version": "0.0.0", "main": "index.js" }\n' "$m" > "$NM/$m/package.json"
  done
  for m in '@hxa-atpc/noties_prism4j' '@ohos.notificationManager' \
           '@ohos.app.ability.wantAgent' '@ohos.resourceschedule.backgroundTaskManager'; do
    printf '{ "name": "%s", "version": "0.0.0", "main": "index.js" }\n' "$m" > "$NM/$m/package.json"
  done
  cp "$HERE/mocks/decorators.js" "$OUT/js/__decorators.js"
  touch "$STAMP"
  return 0
}

echo "══ 纯逻辑测试（聚合 · 跑完全部）══"
if need_build; then
  build || exit 1
  echo "（编译完成）"
fi
node -r "$CACHE/js/__decorators.js" "$HERE/run-all-fast.js" "$CACHE/js"
