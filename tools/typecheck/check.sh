#!/usr/bin/env bash
# 秒级静态检查：用 tsc 检查 ArkTS 的**纯 TS 部分**（entry/src/main/ets/core/*.ets）。
#
# 为什么需要它：真实编译（hvigorw）只能在有 SDK 的环境跑，慢（CI 一轮 3~5 min）。
# core/ 里的代码不含 ArkUI 的 struct/装饰器语法，本身就是合法 TypeScript ⇒
# 配合 stubs/kits.d.ts（最小 SDK 声明）就能在**本机 10 秒内**抓出类型/拼写错误。
#
# 用法：tools/typecheck/check.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SRC="$ROOT/entry/src/main/ets/core"
# ⚠️ 目录**带 PID**：多条线可能同时跑门禁（曾实测 A 的 `rm -rf build` 把 B 的 `cp` 目标删掉 ⇒
# 「cp: .../build/mdtheme.ts: No such file」= **假红**，和假绿一样危险）。
BUILD="$HERE/build.$$"

# 找 tsc：环境变量 > PATH > 同机 xbot 仓库的 web/node_modules > npx 临时装
find_tsc() {
  if [ -n "${TSC:-}" ] && [ -x "$TSC" ]; then echo "$TSC"; return; fi
  if command -v tsc >/dev/null 2>&1; then command -v tsc; return; fi
  for p in "$ROOT/../xbot/web/node_modules/.bin/tsc" "$HOME/src/xbot/web/node_modules/.bin/tsc"; do
    if [ -x "$p" ]; then echo "$p"; return; fi
  done
  echo "npx --yes -p typescript@5 tsc"
}

TSC_BIN="$(find_tsc)"
trap 'rm -rf "$BUILD"' EXIT INT TERM HUP
rm -rf "$BUILD"
mkdir -p "$BUILD"
for f in "$SRC"/*.ets "$SRC"/*.ts; do
  [ -e "$f" ] || continue
  cp "$f" "$BUILD/$(basename "${f%.*}").ts"
done

echo "tsc: $TSC_BIN"
$TSC_BIN -p "$HERE/tsconfig.json"
echo "✅ core/ 静态检查通过（$(ls "$BUILD"/*.ts | wc -l) 个文件）"
