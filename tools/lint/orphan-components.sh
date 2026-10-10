#!/usr/bin/env bash
# 孤儿组件检测 —— 找出**没有任何消费者**的 `components/*.ets`。
#
# 为什么需要（今天踩到的假绿，见 AGENTS.md GOTCHAS / docs/ARKTS-GOTCHAS.md 批次13）：
#   ArkTS **不会对被引用的组件做类型检查之外的事** —— 但**完全无消费者**的组件文件根本
#   不会被编进依赖图 ⇒ 它里面的 ArkTS 错误**编译期不报**。实例：`components/AssistantOrb.ets`
#   的 `@Prop size` 与基类 `CustomComponent` 成员冲突，在 `828b28a` 提交时"门禁全绿"，
#   直到被 `LiveTailView` 引用才报 `10505001`。
#   ⇒ 本脚本把"孤儿组件"变成**显式警告**：要么尽早接线，要么明知那点绿不覆盖它。
#
# ⚠️ 这是**警告级**（不 fail）：本仓有"先交纯逻辑/组件、后接线"的波次习惯，
#    孤儿是**待接线信号**，不是错误。切不可据此删除文件。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ETS="$(cd "$HERE/../.." && pwd)/entry/src/main/ets"
cd "$ETS" || exit 1

orphans=0
total=0
for f in components/*.ets; do
  [ -f "$f" ] || continue
  structs="$(grep -oE '^export struct [A-Za-z0-9_]+' "$f" 2>/dev/null | awk '{print $3}')"
  [ -z "$structs" ] && continue
  for s in $structs; do
    total=$((total + 1))
    hits="$(grep -rl --include='*.ets' -E "\\b${s}\\b" . 2>/dev/null | grep -v "^\./${f}$" | wc -l | tr -d ' ')"
    if [ "$hits" -eq 0 ]; then
      echo "  ⚠ 孤儿组件：${f} → struct ${s}（无任何消费者 ⇒ 其 ArkTS 错误不会被类型检查）"
      orphans=$((orphans + 1))
    fi
  done
done

if [ "$orphans" -eq 0 ]; then
  echo "✅ 无孤儿组件（$total 个 export struct 均有消费者）"
else
  echo "⚠ 发现 $orphans 个孤儿 struct（共 $total 个）—— **警告级**：接线后请重跑 bash tools/gate.sh"
fi
exit 0
