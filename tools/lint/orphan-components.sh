#!/usr/bin/env bash
# 孤儿组件检测 —— 找出**不进 ArkTS 依赖图**的 `components/*.ets`。
#
# 为什么需要（踩到的假绿，见 AGENTS.md GOTCHAS / docs/ARKTS-GOTCHAS.md 批次13）：
#   ArkTS **不会对被引用的组件做类型检查之外的事** —— 但**完全无消费者**的组件文件根本
#   不会被编进依赖图 ⇒ 它里面的 ArkTS 错误**编译期不报**。实例：`components/AssistantOrb.ets`
#   的 `@Prop size` 与基类 `CustomComponent` 成员冲突，在 `828b28a` 提交时"门禁全绿"，
#   直到被 `LiveTailView` 引用才报 `10505001`；`components/PluginHost.ets` 同病（`abaec53`）。
#   ⇒ 本脚本把"孤儿组件"变成**显式警告**：要么尽早接线，要么明知那点绿不覆盖它。
#
# ⛔ **注释/文档里的提及不是消费者**（2026-10-11 第一次修：本脚本自己的**漏报**）
#   旧版直接 `grep -rl "\bStruct\b"` 全文搜索 ⇒ 只要注释里出现过名字就算"有消费者"。实测：
#     · `core/types.ets` 注释写「…展平后交给 `components/SubAgentTree`」
#     · `core/statusfmt.ets` 注释写「web `GoalBanner.tsx`」
#     · `components/GoalBanner.ets` 注释写「原生即 `TodoPanel` 的上一条」
#   这三个**真·孤儿**（从未被编译过）因此被报成「✅ 无孤儿组件」—— 防线本身就是漏的。
#   ⇒ 现在先把每个 .ets **剥掉注释**再找引用。判据：**只在注释里被提到 ⇒ 仍是孤儿**。
#   （已知局限：`//` 若出现在字符串里会误截断该行；只可能**多报**孤儿，不会漏报，方向安全。）
#
# ⛔ **判据是"文件级可达"，不是"逐个 struct 有没有跨文件引用"**（2026-10-11 第二次修：**误报**）
#   旧版把"本文件"从消费者搜索里排除 ⇒ **只在同一文件内被其它 struct 使用的导出**被判成孤儿。
#   实测（修前）：`components/SettingsMdTheme.ets` 的 `SettingsMdSwatch` / `SettingsMdThemeGroup`
#   被判孤儿 —— 但它们**确实有消费者**（同文件的 `SettingsMdThemePicker` 在 `:197/:212/:242-244`
#   真实例化它们），而 picker 自己被 `SettingsAppearance.ets:165` 消费 ⇒ **整个文件本来就被编译**，
#   警告是假的。当时告警 **2/2 全误报（零判别力）**。
#   ⇒ 正确判据：**只要文件里"任一" export struct 有跨文件消费者 ⇒ 整个文件进了依赖图
#     ⇒ 文件内所有 struct 都被类型检查**。故分三类：
#       ① 文件**不可达**（所有导出都无跨文件消费者）⇒ 报「孤儿组件**文件**」= 真·假绿风险；
#       ② 文件可达 + 该导出**有**跨文件消费者 ⇒ 正常，不报；
#       ③ 文件可达 + 该导出**没有**跨文件消费者（只在文件内被用，或连文件内都没人用）
#          ⇒ 报「死导出」**提示级**（它已被类型检查，**不构成假绿**）。
#
# ⚠️ 这是**警告级**（不 fail）：本仓有"先交纯逻辑/组件、后接线"的波次习惯，
#    孤儿是**待接线信号**，不是错误。切不可据此删除文件。
#
# 用法：
#   bash tools/lint/orphan-components.sh              # 检测本仓
#   bash tools/lint/orphan-components.sh --self-test  # 自检夹具（防三类回归：注释=消费者 / 逐 struct 误报 / 真孤儿漏报）
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

# 某 struct 名在**别的文件**里出现的次数（0 = 无跨文件消费者）
cross_count() { # $1=struct 名 $2=本文件在临时区的相对路径
  grep -rlE "\\b${1}\\b" "$tmpd" 2>/dev/null | grep -cvE "^${tmpd}/${2}$" || true
}

# 检测；孤儿/死导出逐行打到 stdout，计数经 ORPHANS/DEADDEFS/TOTAL/SELFONLY 返回
# （不走 echo ⇒ 调用方用重定向捕获，避免子 shell 丢全局变量）
detect() { # $1 = ets 根目录
  local root="$1" f rel src s own n in_graph
  local structs
  tmpd="$(mktemp -d)"
  ( cd "$root" && find . -name '*.ets' -type f -print0 |
      while IFS= read -r -d '' f; do
        mkdir -p "$tmpd/$(dirname "$f")"
        strip_comments_to "$f" "$tmpd/$f"
      done )
  orphans=0
  total=0
  selfonly=0
  dead=0
  for f in "$root"/components/*.ets; do
    [ -f "$f" ] || continue
    rel="components/$(basename "$f")"
    src="$tmpd/$rel"
    structs="$(grep -oE '^export struct [A-Za-z0-9_]+' "$src" 2>/dev/null | awk '{print $3}')"
    [ -z "$structs" ] && continue

    # ① 文件级可达性：本文件**任一** export struct 有跨文件消费者 ⇒ 文件进依赖图
    in_graph=0
    for s in $structs; do
      total=$((total + 1))
      n="$(cross_count "$s" "$rel")"
      [ "${n:-0}" -gt 0 ] && in_graph=1
    done

    if [ "$in_graph" -eq 0 ]; then
      echo "  ⚠ 孤儿组件文件：${rel}"
      echo "     export struct: $(printf '%s' "$structs" | tr '\n' ' ')"
      echo "     （均无跨文件消费者 ⇒ 整个文件不进依赖图 ⇒ 其 ArkTS 错误不会被类型检查 ⇒ 尽早接线）"
      orphans=$((orphans + 1))
      continue
    fi

    # ②③ 文件可达 ⇒ 逐个导出分类（**必须同时看跨文件数与文件内数**）
    for s in $structs; do
      n="$(cross_count "$s" "$rel")"
      if [ "${n:-0}" -gt 0 ]; then
        continue                      # ② 正常：有跨文件消费者
      fi
      own="$(grep -cE "\\b${s}\\b" "$src" 2>/dev/null || true)"
      if [ "${own:-0}" -le 1 ]; then
        echo "  · 死导出：${rel} → struct ${s}（所在文件可达、但该导出连文件内都没人用 ⇒ 不构成假绿，仅提示）"
        dead=$((dead + 1))
      else
        selfonly=$((selfonly + 1))    # ③ 仅文件内消费：文件已进依赖图 ⇒ 已被类型检查，不算孤儿
      fi
    done
  done
  rm -rf "$tmpd"
  ORPHANS=$orphans
  TOTAL=$total
  SELFONLY=$selfonly
  DEADDEFS=$dead
  return 0
}

report() {
  local cross=0
  cross=$(( ${TOTAL:-0} - ${SELFONLY:-0} - ${DEADDEFS:-0} ))
  if [ "${ORPHANS:-0}" -eq 0 ]; then
    echo "✅ 无孤儿组件（${TOTAL:-?} 个 export struct：跨文件消费 ${cross} / 仅文件内消费 ${SELFONLY:-0} / 无消费者 ${DEADDEFS:-0}）"
  else
    echo "⚠ 发现 ${ORPHANS} 个孤儿组件**文件**（共 ${TOTAL} 个 export struct）—— **警告级**：接线后请重跑 bash tools/gate.sh"
    echo "   （判据：文件里任一 export struct 有跨文件消费者 ⇒ 整个文件已进依赖图；剥注释后只在注释里被提到 ⇒ 仍算孤儿）"
  fi
  if [ "${DEADDEFS:-0}" -gt 0 ]; then
    echo "   另有 ${DEADDEFS} 个「死导出」：所在文件可达、导出无人用 —— **不构成假绿**，仅提示（可删可留）"
  fi
  return 0
}

self_test() {
  local d out out_file failed=0
  d="$(mktemp -d)"
  mkdir -p "$d/components" "$d/core" "$d/pages"
  # Alpha：只在**注释**里被提到 ⇒ 文件不可达 ⇒ 必须判为孤儿文件（第一次修的回归）
  printf 'export struct Alpha {\n  build() { Text(\x27a\x27) }\n}\n' > "$d/components/Alpha.ets"
  # Beta：有**真**跨文件消费者 ⇒ 一行都不该出现
  printf 'export struct Beta {\n  build() { Text(\x27b\x27) }\n}\n' > "$d/components/Beta.ets"
  # Gamma：无任何提及 ⇒ 文件不可达 ⇒ 必须判为孤儿文件
  printf 'export struct Gamma {\n  build() { Text(\x27c\x27) }\n}\n' > "$d/components/Gamma.ets"
  # Delta：DeltaEntry 有跨文件消费者（⇒ 文件可达）；DeltaInner **仅同文件消费**（第二次修的回归：
  #        绝不能报孤儿）；DeltaDead 跨文件与文件内都无人用（⇒ 只报"死导出"，**不计入孤儿**）
  cat > "$d/components/Delta.ets" <<'EOF'
export struct DeltaEntry {
  build() {
    Column() {
      DeltaInner({ t: 'a' })
      DeltaInner({ t: 'b' })
      DeltaInner({ t: 'c' })
    }
  }
}
export struct DeltaInner {
  build() { Text('inner') }
}
export struct DeltaDead {
  build() { Text('dead') }
}
EOF
  cat > "$d/core/notes.ets" <<'EOF'
// 渲染层据此展平后交给 components/Alpha 与 struct Alpha 处理
/* 也见 components/Alpha 的说明 */
export const NOTE = 1;
EOF
  cat > "$d/pages/P.ets" <<'EOF'
import { Beta } from '../components/Beta';
import { DeltaEntry } from '../components/Delta';
@Entry
@Component
struct P {
  build() {
    Column() {
      Beta({ rows: [] })
      DeltaEntry()
    }
  }
}
EOF
  out_file="$(mktemp)"
  detect "$d" > "$out_file"
  out="$(cat "$out_file")"
  rm -f "$out_file"

  if ! printf '%s\n' "$out" | grep -q '孤儿组件文件：components/Alpha.ets'; then
    echo "❌ 自检失败：Alpha 只在注释里被提到，必须判为孤儿文件（防回归：注释≠消费者）"; failed=1
  fi
  if ! printf '%s\n' "$out" | grep -q '孤儿组件文件：components/Gamma.ets'; then
    echo "❌ 自检失败：Gamma 无任何提及，必须判为孤儿文件"; failed=1
  fi
  if printf '%s\n' "$out" | grep -q 'Beta'; then
    echo "❌ 自检失败：Beta 有真跨文件消费者，不该被报（任何一行都不该出现）"; failed=1
  fi
  if printf '%s\n' "$out" | grep -q 'DeltaInner'; then
    echo "❌ 自检失败：DeltaInner 仅在同文件内被消费，而该文件已进依赖图 ⇒ 绝不能报（防回归：逐 struct 误报）"; failed=1
  fi
  if ! printf '%s\n' "$out" | grep '死导出' | grep -q 'DeltaDead'; then
    echo "❌ 自检失败：DeltaDead 跨文件与文件内都无人用，应报「死导出」提示"; failed=1
  fi
  if printf '%s\n' "$out" | grep '孤儿组件文件' | grep -q 'Delta.ets'; then
    echo "❌ 自检失败：Delta.ets 有跨文件消费者，不该被判为孤儿文件"; failed=1
  fi
  if [ "${ORPHANS:-0}" -ne 2 ]; then
    echo "❌ 自检失败：孤儿**文件**数应为 2（Alpha.ets / Gamma.ets），实得 ${ORPHANS:-?}"; failed=1
  fi
  if [ "${DEADDEFS:-0}" -ne 1 ]; then
    echo "❌ 自检失败：死导出应为 1（DeltaDead），实得 ${DEADDEFS:-?}"; failed=1
  fi
  rm -rf "$d"
  if [ "$failed" -eq 0 ]; then
    echo "✅ 自检通过（注释提及⇒孤儿文件 / 无提及⇒孤儿文件 / 真消费者⇒不报 / 仅同文件消费⇒不报 / 零引用⇒只报死导出）"
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
