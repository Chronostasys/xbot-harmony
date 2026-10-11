#!/usr/bin/env bash
# 品牌资源生成器 —— 从 `core/brand.ets`（唯一真源）**重复生成**图标与开屏资源。
#
# 为什么需要它：此前 `app_icon.svg` / `start_icon.png` 是手写/手跟的（SVG 源只活在 docs 的代码块里），
# 改一处忘另一处、且 `start_icon.png` 是**手改的二进制**（违反本仓纪律）。本脚本让资源**可复现**：
# 同样输入 ⇒ 逐字节同样的产物（`sips` 栅格化已实测确定性；见 `--check`）。
#
# 用法：
#   bash tools/brand/gen.sh            # 生成/覆盖资源（app_icon.svg ×2 + start_icon.png + 轮廓/分层 SVG）
#   bash tools/brand/gen.sh --check    # 只校验：把生成结果与已提交资源逐字节比对（drift 门禁）
#   bash tools/brand/gen.sh --proofs DIR   # 另外渲染浅/深两种开屏底色上的标记 proof PNG（人工走查用）
#
# 依赖：仓库同机的 tsc（见 tools/tests/run.sh 的 find_tsc）+ macOS 的 `sips`（SVG→PNG）。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CORE="$ROOT/entry/src/main/ets/core"
APPSCOPE_SVG="$ROOT/AppScope/resources/base/media/app_icon.svg"
ENTRY_SVG="$ROOT/entry/src/main/resources/base/media/app_icon.svg"
ENTRY_PNG="$ROOT/entry/src/main/resources/base/media/start_icon.png"
ENTRY_OUTLINE="$ROOT/entry/src/main/resources/base/media/brand_mark_outline.svg"
ENTRY_FG="$ROOT/entry/src/main/resources/base/media/brand_foreground.svg"
ENTRY_BG="$ROOT/entry/src/main/resources/base/media/brand_background.svg"

MODE="write"
PROOF_DIR=""
case "${1:-}" in
  --check) MODE="check" ;;
  --proofs) MODE="write"; PROOF_DIR="${2:-/tmp/xbot-brand-proofs}" ;;
  "") ;;
  *) echo "未知参数：$1"; exit 2 ;;
esac

find_tsc() {
  if [ -n "${TSC:-}" ] && [ -x "$TSC" ]; then echo "$TSC"; return; fi
  if command -v tsc >/dev/null 2>&1; then command -v tsc; return; fi
  for p in "$ROOT/../xbot/web/node_modules/.bin/tsc" "$HOME/src/xbot/web/node_modules/.bin/tsc"; do
    if [ -x "$p" ]; then echo "$p"; return; fi
  done
  echo "npx --yes -p typescript@5 tsc"
}
TSC_BIN="$(find_tsc)"

WORK="$(mktemp -d -t xbot-brand.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
# core/*.ets 当纯 TS 编译（与 tools/tests/run.sh 同法）：两者都无 @ohos 依赖
cp "$CORE/brand.ets" "$WORK/brand.ts"
cp "$CORE/theme.ets" "$WORK/theme.ts"
mkdir -p "$WORK/js"
$TSC_BIN "$WORK/brand.ts" "$WORK/theme.ts" --module commonjs --target ES2021 --strict \
  --skipLibCheck --outDir "$WORK/js" >/dev/null

# 生成器（node）：从编译产物取几何/配色 ⇒ 写 SVG；PNG 由 sips 栅格化
node "$HERE/emit.js" "$WORK/js" "$WORK/out" "$MODE" "$APPSCOPE_SVG" "$ENTRY_SVG" "$ENTRY_PNG"

if [ "$MODE" = "write" ]; then
  mkdir -p "$(dirname "$APPSCOPE_SVG")" "$(dirname "$ENTRY_SVG")" "$(dirname "$ENTRY_PNG")"
  cp "$WORK/out/AppScope_app_icon.svg" "$APPSCOPE_SVG"
  cp "$WORK/out/entry_app_icon.svg" "$ENTRY_SVG"
  # 开屏标记：先出 SVG 中间件，再 sips 栅格化为 512×512 PNG（透明底）
  sips -s format png "$WORK/out/start_icon.svg" --out "$ENTRY_PNG" >/dev/null 2>&1
  # 降级链 / 分层图标：矢量资源（SVG 原样进 HAP）
  cp "$WORK/out/brand_mark_outline.svg" "$ENTRY_OUTLINE"
  cp "$WORK/out/brand_foreground.svg" "$ENTRY_FG"
  cp "$WORK/out/brand_background.svg" "$ENTRY_BG"
  echo "✅ 已生成："
  echo "   $APPSCOPE_SVG"
  echo "   $ENTRY_SVG"
  echo "   $ENTRY_PNG"
  echo "   $ENTRY_OUTLINE"
  echo "   $ENTRY_FG"
  echo "   $ENTRY_BG"
  if [ -n "$PROOF_DIR" ]; then
    mkdir -p "$PROOF_DIR"
    sips -s format png "$WORK/out/proof_light.svg" --out "$PROOF_DIR/proof_light.png" >/dev/null 2>&1
    sips -s format png "$WORK/out/proof_dark.svg" --out "$PROOF_DIR/proof_dark.png" >/dev/null 2>&1
    echo "   浅/深开屏 proof：$PROOF_DIR/proof_light.png, $PROOF_DIR/proof_dark.png"
  fi
else
  # --check：与已提交资源逐字节比对（含 PNG 重生成）
  sips -s format png "$WORK/out/start_icon.svg" --out "$WORK/out/start_icon.png" >/dev/null 2>&1
  fail=0
  for pair in "$WORK/out/AppScope_app_icon.svg:$APPSCOPE_SVG" "$WORK/out/entry_app_icon.svg:$ENTRY_SVG" "$WORK/out/start_icon.png:$ENTRY_PNG" "$WORK/out/brand_mark_outline.svg:$ENTRY_OUTLINE" "$WORK/out/brand_foreground.svg:$ENTRY_FG" "$WORK/out/brand_background.svg:$ENTRY_BG"; do
    gen="${pair%%:*}"; committed="${pair#*:}"
    if [ ! -f "$committed" ]; then echo "❌ 缺失：$committed"; fail=1; continue; fi
    if cmp -s "$gen" "$committed"; then
      echo "✅ 一致：$(basename "$committed")"
    else
      echo "❌ 漂移：$committed 与生成器输出不一致（跑 bash tools/brand/gen.sh 重新生成并提交）"
      fail=1
    fi
  done
  exit "$fail"
fi
