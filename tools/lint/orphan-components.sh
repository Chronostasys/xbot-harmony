#!/usr/bin/env bash
# 孤儿组件检测 —— 找出**没有任何消费者**的 `components/*.ets`。
#
# 为什么需要（踩到的假绿，见 AGENTS.md GOTCHAS / docs/ARKTS-GOTCHAS.md 批次13）：
#   ArkTS **不会对被引用的组件做类型检查之外的事** —— 但**完全无消费者**的组件文件根本
#   不会被编进依赖图 ⇒ 它里面的 ArkTS 错误**编译期不报**。实例：`components/AssistantOrb.ets`
#   的 `@Prop size` 与基类 `CustomComponent` 成员冲突，在 `828b28a` 提交时"门禁全绿"，
#   直到被 `LiveTailView` 引用才报 `10505001`；`components/PluginHost.ets` 同病（`abaec53`）。
#   ⇒ 本脚本把"孤儿组件"变成**显式警告**：要么尽早接线，要么明知那点绿不覆盖它。
#
# ⛔ **注释/文档里的提及不是消费者**（2026-10-11 修正：这条是本脚本自己的第二次假绿）
#   旧版直接 `grep -rl "\bStruct\b"` 全文搜索 ⇒ 只要注释里出现过名字就算"有消费者"。实测：
#     · `core/types.ets` 注释写「…展平后交给 `components/SubAgentTree`」
#     · `core/statusfmt.ets` 注释写「web `GoalBanner.tsx`」
#     · `components/GoalBanner.ets` 注释写「原生即 `TodoPanel` 的上一条」
#   这三个**真·孤儿**（从未被编译过）因此被报成「✅ 无孤儿组件」—— 防线本身就是漏的。
#   ⇒ 现在先把每个 .ets **剥掉注释**再找引用。判据：**只在注释里被提到 ⇒ 仍是孤儿**。
#   （已知局限：`//` 若出现在字符串里会误截断该行；只可能**多报**孤儿，不会漏报，方向安全。）
#
# ⚠️ 这是**警告级**（不 fail）：本仓有"先交纯逻辑/组件、后接线"的波次习惯，
#    孤儿是**待接线信号**，不是错误。切不可据此删除文件。
#
# 用法：
#   bash tools/lint/orphan-components.sh              # 检测本仓
#   bash tools/lint/orphan-components.sh --self-test  # 自检夹具（防"注释=消费者"回归）
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ETS="$(cd "$HERE/../.." && pwd)/entry/src/main/ets"

# 剥掉 `/* ... */` 块注释与 `//` 行注释（`://` 不截断，避免打死 URL 行的后半截）。
strip_comments_to() { # $1=源 $2=目标
  if command -v perl >/dev/null 2>&1; then
    perl -0777 -pe 's{/\*.*?\*/}{}gs; s{(?<!:)//[^\n]*}{}g' "$1" >"$2" 2>/dev/null || cp "$1" "$2"
  else
    cp "$1" "$2"
  fi
}

# 检测；孤儿逐行打到 stdout，计数经 ORPHANS/TOTAL 返回（不 echo，便于自检捕获）
detect() { # $1 = ets 根目录
  local root="$1" tmpd f rel s structs consumers n
  tmpd="$(mktemp -d)"
  ( cd "$root" && find . -name '*.ets' -type f -print0 |
      while IFS= read -r -d '' f; do
        mkdir -p "$tmpd/$(dirname "$f")"
        strip_comments_to "$f" "$tmpd/$f"
      done )
  orphans=0
  total=0
  for f in "$root"/components/*.ets; do
    [ -f "$f" ] || continue
    rel="components/$(basename "$f")"
    structs="$(grep -oE '^export struct [A-Za-z0-9_]+' "$f" 2>/dev/null | awk '{print $3}')"
    [ -z "$structs" ] && continue
    for s in $structs; do
      total=$((total + 1))
      consumers="$(grep -rlE "\\b${s}\\b" "$tmpd" 2>/dev/null | grep -vE "^${tmpd}/${rel}$" || true)"
      n="$(printf '%s' "$consumers" | grep -c . || true)"
      if [ "$n" -eq 0 ]; then
        echo "  ⚠ 孤儿组件：${rel} → struct ${s}（无任何消费者 ⇒ 其 ArkTS 错误不会被类型检查）"
        orphans=$((orphans + 1))
      fi
    done
  done
  rm -rf "$tmpd"
  ORPHANS=$orphans
  TOTAL=$total
}

report() {
  if [ "${ORPHANS:-0}" -eq 0 ]; then
    echo "✅ 无孤儿组件（${TOTAL:-?} 个 export struct 均有消费者）"
  else
    echo "⚠ 发现 $ORPHANS 个孤儿 struct（共 $TOTAL 个）—— **警告级**：接线后请重跑 bash tools/gate.sh"
    echo "   （判据已剔除注释提及：只在注释/文档里被提到的组件**仍算孤儿**）"
  fi
}

self_test() {
  local d out failed=0
  d="$(mktemp -d)"
  mkdir -p "$d/components" "$d/core" "$d/pages"
  printf 'export struct Alpha {\n'  > "$d/components/Alpha.ets"
  printf 'export struct Beta {\n'   > "$d/components/Beta.ets"
  printf 'export struct Gamma {\n'  > "$d/components/Gamma.ets"
  # Alpha 只在**注释**里被提到 ⇒ 必须判为孤儿（这就是旧版的 bug）
  cat > "$d/core/notes.ets" <<'EOF'
// 渲染层据此展平后交给 components/Alpha 处理
/* 也见 components/Alpha 的说明 */
export const NOTE = 1;
EOF
  # Beta 有**真**消费者
  cat > "$d/pages/P.ets" <<'EOF'
import { Beta } from '../components/Beta';
@Entry
@Component
struct P {
  build() {
    Column() {
      Beta({ rows: [] })
    }
  }
}
EOF
  out="$(detect "$d")"
  if ! printf '%s\n' "$out" | grep -q "struct Alpha"; then
    echo "❌ 自检失败：Alpha 只在注释里被提到，必须判为孤儿（防回归：注释≠消费者）"; failed=1
  fi
  if ! printf '%s\n' "$out" | grep -q "struct Gamma"; then
    echo "❌ 自检失败：Gamma 无任何提及，必须判为孤儿"; failed=1
  fi
  if printf '%s\n' "$out" | grep -q "struct Beta"; then
    echo "❌ 自检失败：Beta 有真消费者，被误报为孤儿"; failed=1
  fi
  rm -rf "$d"
  if [ "$failed" -eq 0 ]; then
    echo "✅ 自检通过（注释提及⇒孤儿 / 无提及⇒孤儿 / 真消费者⇒不算孤儿）"
  fi
  return "$failed"
}

case "${1:-}" in
  --self-test)
    self_test || exit 1
    ;;
  *)
    detect "$ETS"
    report
    ;;
esac
exit 0
