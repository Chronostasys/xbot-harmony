#!/usr/bin/env bash
# state-single-writer.sh —— **单写入源门禁**（会话生命周期字段只允许一处写）。
#
# 为什么需要（用户 2026-10-21：「发送中/cancel 中/busy/idle 必须准确」「不许再出新问题」）：
#   前八轮的 60+ 条确证缺陷里有**一整类**是"两处各写一半"：
#     · `text_final` 清了 `sessionRunning` 没清 `busy` ⇒ 回复显示完了输入框还挂着 cancel；
#     · `history_replaced` 把两者写成**相反值**；
#     · store 里某个异步回包直接改 `todos` 而绕过状态机。
#   规则本身没错，错在**规则可以被绕过**。本门禁把"绕过"变成构建失败：
#   会话生命周期字段（busy/sessionRunning/activeTurn/todos/goal/cancelling）的
#   **唯一写入源**是 `core/reduce.ts`（纯函数状态机）+ `core/chat_types_full.ts`
#   （`initialChatState` 的初值）。其它任何文件对**状态对象**直写 ⇒ 红。
#
# 判据（三条，均为静态源码扫描）：
#   ① 除 reduce.ts 外，任何文件不得出现 `state.<field> =` / `this.state.<field> =`
#      （对状态对象的**就地变更**）。
#   ② 除 reduce.ts / chat_types_full.ts 外，不得在 **状态 spread**（`{ ...s,` /
#      `{ ...out,` / `{ ...this.state,`）里写生命周期字段（绕过状态机重建状态）。
#   ③ **白绿防线**：正控必须命中 —— reduce.ts 自身必须能看到这些字段；
#      扫描文件数为 0 ⇒ 直接红（防止路径写错导致"零扫描假绿"）。
#
# 用法：bash tools/lint/state-single-writer.sh [--self-test]
#   --self-test：注入一个必红样本 + 同副本不注入 ⇒ 必须红/绿（mutation 自证）。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SRC="${XC_SRC_DIR:-$ROOT/entry/src/main/ets}"
REDUCE="${XC_REDUCE:-$SRC/core/reduce.ts}"
TYPES="${XC_TYPES:-$SRC/core/chat_types_full.ts}"

FIELDS='busy|sessionRunning|activeTurn|todos|goal|cancelling'

# 剥注释（行注释 + 块注释）后再扫 —— 注释里写 `state.busy = true` 不算违规。
strip() { sed -E 's://.*$::' "$1" | perl -0pe 's:/\*.*?\*/::gs'; }

scan_direct() { # ① 对状态对象的就地变更
  local out=0 f
  while IFS= read -r f; do
    [ "$f" = "$REDUCE" ] && continue
    local n
    n="$(strip "$f" | grep -cE "(this\.)?state\.($FIELDS)[[:space:]]*=[^=]" || true)"
    if [ "${n:-0}" -gt 0 ]; then
      echo "  ✗ $(realpath --relative-to="$ROOT" "$f" 2>/dev/null || echo "$f")：$n 处对状态字段就地赋值"
      strip "$f" | grep -nE "(this\.)?state\.($FIELDS)[[:space:]]*=[^=]" | sed 's/^/      /'
      out=$((out + n))
    fi
  done < <(find "$SRC" -type f \( -name '*.ets' -o -name '*.ts' \) | sort)
  echo "$out"
}

scan_spread() { # ② 状态 spread 里的生命周期字段
  local out=0 f
  while IFS= read -r f; do
    [ "$f" = "$REDUCE" ] && continue
    [ "$f" = "$TYPES" ] && continue
    local n
    n="$(strip "$f" | grep -cE '\{[[:space:]]*\.\.\.(s|out|next|this\.state|st)[[:space:]]*,.*\b('"$FIELDS"')[[:space:]]*:' || true)"
    if [ "${n:-0}" -gt 0 ]; then
      echo "  ✗ $(realpath --relative-to="$ROOT" "$f" 2>/dev/null || echo "$f")：$n 处在状态 spread 里直接写生命周期字段"
      strip "$f" | grep -nE '\{[[:space:]]*\.\.\.(s|out|next|this\.state|st)[[:space:]]*,.*\b('"$FIELDS"')[[:space:]]*:' | sed 's/^/      /'
      out=$((out + n))
    fi
  done < <(find "$SRC" -type f \( -name '*.ets' -o -name '*.ts' \) | sort)
  echo "$out"
}

scan_helpers() { # ③ 会话级 helper 的**跨文件**写入点（台账只许缩短）
  local ledger="$HERE/state-single-writer.txt"
  local out=0 f rel n max reason
  while IFS= read -r f; do
    [ "$f" = "$REDUCE" ] && continue
    [ "$f" = "$TYPES" ] && continue
    n="$(strip "$f" | grep -cE '(applySessionFields|withSessionRunning)\(' || true)"
    [ "${n:-0}" -eq 0 ] && continue
    rel="${f#$SRC/}"
    max="$(awk -F'\t' -v p="$rel" '$1==p{print $2}' "$ledger" 2>/dev/null | head -1)"
    if [ -z "${max:-}" ]; then
      echo "  ✗ ${rel}：${n} 处 applySessionFields/withSessionRunning（**未登记**：写会话级字段必须经 reduce，或写进台账附理由）"
      out=$((out + n))
    elif [ "$n" -gt "$max" ]; then
      echo "  ✗ ${rel}：${n} 处 > 台账上限 ${max}（台账**只许缩短**）"
      out=$((out + n - max))
    fi
  done < <(find "$SRC" -type f \( -name '*.ets' -o -name '*.ts' \) | sort)
  echo "$out"
}

run_check() {
  local total_files
  total_files="$(find "$SRC" -type f \( -name '*.ets' -o -name '*.ts' \) | wc -l | tr -d ' ')"
  echo "▶ 单写入源检查：扫描 $total_files 个文件（唯一写入源 = core/reduce.ts）"

  # ③ 白绿防线：正控（reduce.ts 必须含这些字段）+ 扫描面
  if [ "$total_files" -lt 10 ]; then
    echo "  ✗ 扫描到的文件数异常（$total_files）—— 路径可能写错 ⇒ 判红（白绿防线）"
    return 1
  fi
  local ctrl
  ctrl="$(strip "$REDUCE" | grep -cE "\b($FIELDS)\b" || true)"
  if [ "${ctrl:-0}" -lt 5 ]; then
    echo "  ✗ 正控失败：reduce.ts 里只看到 ${ctrl} 处生命周期字段（应 ≥5）—— 判据可能在空转"
    return 1
  fi

  local bad=0
  bad=$((bad + $(scan_direct | tail -1)))
  bad=$((bad + $(scan_spread | tail -1)))
  bad=$((bad + $(scan_helpers | tail -1)))

  if [ "$bad" -gt 0 ]; then
    echo "❌ 单写入源：$bad 处违规（生命周期字段只能在 core/reduce.ts 写）"
    return 1
  fi
  echo "✅ 单写入源：0 处违规（生命周期字段唯一写入源成立）"
  return 0
}

self_test() {
  local tmp rc_inject rc_clean
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  mkdir -p "$tmp/core"
  printf 'export function f(state: any) {\n  state.busy = true;\n  return state;\n}\n' > "$tmp/core/bad.ts"
  printf 'export function f(state: any) {\n  // state.busy = true;  （注释不算）\n  return state;\n}\n' > "$tmp/core/ok.ts"
  printf 'export const busy = 1;\nexport const sessionRunning = 1;\nexport const activeTurn = 1;\nexport const todos = 1;\nexport const goal = 1;\n' > "$tmp/core/reduce.ts"
  # 为了满足"扫描面 ≥10"，补足文件数
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do printf 'export const x%s = 1;\n' "$i" > "$tmp/core/f$i.ts"; done

  XC_SRC_DIR="$tmp" XC_REDUCE="$tmp/core/reduce.ts" XC_TYPES="$tmp/core/nofile.ts" bash "$0" >/dev/null 2>&1
  rc_inject=$?
  rm -f "$tmp/core/bad.ts"
  XC_SRC_DIR="$tmp" XC_REDUCE="$tmp/core/reduce.ts" XC_TYPES="$tmp/core/nofile.ts" bash "$0" >/dev/null 2>&1
  rc_clean=$?
  echo "self-test: 注入违规 ⇒ exit=${rc_inject}（期望非 0）；移除违规 ⇒ exit=${rc_clean}（期望 0）"
  [ "$rc_inject" -ne 0 ] && [ "$rc_clean" -eq 0 ] && echo "✅ mutation 自证通过" && return 0
  echo "❌ mutation 自证失败"; return 1
}

case "${1:-}" in
  --self-test) self_test ;;
  "") run_check ;;
  *) echo "用法: bash tools/lint/state-single-writer.sh [--self-test]"; exit 2 ;;
esac
