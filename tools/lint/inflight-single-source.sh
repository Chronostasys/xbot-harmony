#!/usr/bin/env bash
#
# inflight-single-source.sh —— 铁律「同一时刻只允许一个**在飞动效** = 光球（`AssistantOrb`）」
# 的**机器门禁**（本仓纪律：动效极度克制；见 `docs/DESIGN-SYSTEM.md §8`）。
#
# 为什么需要它：这条铁律此前**只靠文档与自觉**。`Index.ets` 正在拆、白色主题/新气泡/新导航
# 等新组件一多，"第二个在飞动效"极容易被悄悄引入而无人发现。
#
# ── API 分类结论（ArkTS / SDK 21 动效 API 面）────────────────────────────────────
#
# 【A 类 · 循环/重复类（= "在飞"动效）—— 准白名单】
#   · **SymbolEffect 的循环子类**：`ScaleSymbolEffect` / `PulseSymbolEffect` /
#     `BounceSymbolEffect` / `VariableColorSymbolEffect` —— 在 `isActive=true` 期间**反复播放**。
#     ⚠️ 一次性子类（`AppearSymbolEffect` / `DisappearSymbolEffect` / `ReplaceSymbolEffect` /
#        `HierarchicalSymbolEffect`）属**过渡**，不在 A 类（若使用，走 B2 约束）。
#   · **重复参数**：`AnimateParam.iterations` 为非 1（`-1`/`0`/`>1`/`Infinity`）或出现 `playMode`
#     —— 出现即"重复"，无论底层是 `animateTo` / `.animation()` / `keyframeAnimateTo`。
#   · （本仓现状：A 类命中 = 0 或极少；命中即"真发现"，见交付说明。）
#
# 【B 类 · 需要人判断的"连续动画"与"未走底座的过渡"（警告级；`--strict` 才失败）】
#   · B1 **内置连续动画组件**：`LoadingProgress` / `Marquee` —— 挂载即持续动。
#     它们可能是"操作进度"（加载中，非装饰）也可能是"装饰性在飞动效"（= 违规）⇒ 无法机械判定，
#     故列警告，由人确认。⛔ 本门禁**不**把它们当 A 类，避免"把所有加载 spinner 都判红"的假阳性。
#   · B2 **一次性过渡未走底座**：`animateTo({...})` / `.animation({...})` 的**内联字面量**，
#     或直接构造 `TransitionEffect.*` —— 应改用 `components/anim.ets` 的
#     `animFast()/animBase()/animMsgIn()/animEaseOut()/animEaseOutDelayed()/sheetTransition()`（一处定义、
#     换主题/调刻度只改一处）。`anim.ets` 本身（底座）在准白名单内。
#
# 【白名单】=`components/AssistantOrb.ets`（光球本体）+ 底座 `components/anim.ets` + `core/motion.ets`。
#
# 【豁免】`tools/lint/inflight-allowlist.txt`：`<相对路径>|<API标签> # <理由>`。
#   ⛔ **理由必填**（去除空白后 ≥ 8 字符）；缺理由 / 理由过短的条目**不生效**（仍然红），并单独报出。
#
# 用法：
#   bash tools/lint/inflight-single-source.sh            # A 类失败 / B 类警告
#   bash tools/lint/inflight-single-source.sh --strict   # A+B 任一命中即失败
#   bash tools/lint/inflight-single-source.sh --self-test # 自证（临时目录造违规，验证判据能红）
#
# ⛔ 退出码：0 = 通过，1 = 未通过。`set -u`；含中文处变量一律 `${var}`。

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SRC="$ROOT/entry/src/main/ets"
ALLOW="$HERE/inflight-allowlist.txt"
STRICT=0
SELFTEST=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --strict) STRICT=1; shift ;;
    --self-test) SELFTEST=1; shift ;;
    --src) SRC="${2:-$SRC}"; shift 2 ;;
    --allow) ALLOW="${2:-$ALLOW}"; shift 2 ;;
    *) shift ;;
  esac
done

# 准白名单（相对 `entry/src/main/ets/` 的路径）
WL_RE='^(components/AssistantOrb\.ets|components/anim\.ets|core/motion\.ets)$'

# ── 判据表：`标签@ERE@级别@建议`（⚠️ 用 `@` 分隔 —— ERE 里含 `|`，不能用 `|` 当分隔符）──────
CHECKS=(
  'SymbolEffect(循环类)@(Scale|Pulse|Bounce|VariableColor)SymbolEffect[[:space:]]*\(@A@改用**一次性**过渡（SymbolEffect 的 Appear/Disappear/Replace）或删掉；装饰性"在飞"只允许光球'
  'iterations>1@iterations[[:space:]]*:[[:space:]]*(-1|[0-9]{2,}|[2-9]|Infinity|0)@A@去掉 repetitions（一次性过渡不需要循环：AnimateParam.iterations 保持默认 1）'
  'playMode@playMode[[:space:]]*:@A@去掉 playMode（重复播放）；一次性过渡不需要它'
  '内置连续动画组件@(LoadingProgress|Marquee)[[:space:]]*\(@B1@确认它表示"操作进度"而非装饰性在飞动效；若是后者 ⇒ 删除/改为静态；若确属进度 ⇒ 登记豁免（附理由）'
  '内联过渡(非底座)@(\.animation[[:space:]]*\([[:space:]]*\{|animateTo[[:space:]]*\([[:space:]]*\{|TransitionEffect\.)@B2@改用 components/anim.ets 的 animFast()/animBase()/animMsgIn()/animEaseOut()/animEaseOutDelayed()/sheetTransition()'
)

# ── 豁免表解析：贴合的条目 + "无效豁免"（无理由/理由过短）────────────────────────
VALID_EXEMPT=""
INVALID_EXEMPT=""
if [ -f "$ALLOW" ]; then
  while IFS= read -r aline || [ -n "$aline" ]; do
    case "$aline" in ''|\#*) continue ;; esac
    alhs="${aline%%#*}"
    if [ "$alhs" = "$aline" ]; then
      INVALID_EXEMPT="${INVALID_EXEMPT}${aline}（缺 '#' 理由分隔）"$'\n'
      continue
    fi
    arhs="${aline#*#}"
    akey="$(printf '%s' "$alhs" | tr -d '[:space:]')"
    areason="$(printf '%s' "$arhs" | tr -d '[:space:]')"
    if [ "${#areason}" -lt 8 ]; then
      INVALID_EXEMPT="${INVALID_EXEMPT}${aline}（理由过短：需 ≥8 字符）"$'\n'
      continue
    fi
    VALID_EXEMPT="${VALID_EXEMPT}${akey}"$'\n'
  done < "$ALLOW"
fi

nA=0
nB=0
nExempt=0
report=""

is_exempt() { # $1=rel $2=label
  case "$(printf '%s\n' "$VALID_EXEMPT")" in
    *"$1|$2"*) return 0 ;;
    *) return 1 ;;
  esac
}

scan() { # $1=标签 $2=ERE $3=级别 $4=建议
  local label="$1" pat="$2" tier="$3" hint="$4"
  local hits
  hits="$(grep -rnboE "$pat" "$SRC" 2>/dev/null || true)"   # -b -o ⇒ 拿到**匹配点字节偏移**（给注释判定用）
  [ -z "$hits" ] && return 0
  while IFS= read -r ln || [ -n "$ln" ]; do
    [ -z "$ln" ] && continue
    local f="${ln%%:*}"
    local rest="${ln#*:}"
    local num="${rest%%:*}"
    local rest2="${rest#*:}"
    local off="${rest2%%:*}"     # 匹配点在该文件内的**字节偏移**（由 grep -b -o 给出）
    local code="${rest2#*:}"     # 匹配片段（-o）
    # 跳过注释里的命中（本仓明文：注释里记录 API 名是**允许且鼓励**的）。
    # ⛔ 旧版只跳"行首注释"（`*`/`//`/`/*` 开头）⇒ **行尾注释**与**块注释中间行**里的 API 名
    #    仍被当用法判红（同类缺陷已在 color-roles.sh / render-path.sh 修过）。
    # 正解：问"**匹配点本身是否落在注释内**"（状态机，字符串里的 `//` 不剥）。
    if python3 "$HERE/_match_in_comment.py" "$f" "$off" >/dev/null 2>&1; then
      continue
    fi
    local rel="${f#"$SRC"/}"
    if printf '%s' "$rel" | grep -qE "$WL_RE"; then
      continue
    fi
    if is_exempt "$rel" "$label"; then
      nExempt=$((nExempt + 1))
      report="${report}  · [豁免] ${tier} ${rel}:${num}  ${label}"$'\n'
      continue
    fi
    if [ "$tier" = "A" ]; then nA=$((nA + 1)); else nB=$((nB + 1)); fi
    report="${report}  ✗ [${tier}] ${rel}:${num}  ${label}"$'\n'"      ${code}"$'\n'"      建议：${hint}"$'\n'
  done <<< "$hits"
  return 0
}

run_all() {
  local entry
  for entry in "${CHECKS[@]}"; do
    IFS='@' read -r label pat tier hint <<< "$entry"
    scan "$label" "$pat" "$tier" "$hint"
  done
}

# ── 自证：在临时目录造违规，验证判据能红 ────────────────────────────────────────
if [ "$SELFTEST" -eq 1 ]; then
  T="$(mktemp -d)"
  trap 'rm -rf "$T"' EXIT
  mkdir -p "$T/components" "$T/pages"
  cat > "$T/components/BadLoop.ets" <<'EOF'
@Component
export struct BadLoop {
  build() {
    // 故意违规：循环类符号效果（A 类）
    Column().symbolEffect(new PulseSymbolEffect(), true)
    // 故意违规：一次性过渡未走底座（B2）
    Row().animation({ duration: 600, curve: Curve.EaseInOut })
  }
}
EOF
  SRC="$T"
  echo "▶ --self-test：临时树 ${T}（含 1 处 A 类 + 1 处 B2 类违规）"
  nA=0; nB=0; nExempt=0; report=""
  run_all
  printf '%s' "$report"
  ok_selftest=1
  if [ "$nA" -lt 1 ]; then echo "  ✗ 自证失败：A 类未命中"; ok_selftest=0; fi
  if [ "$nB" -lt 1 ]; then echo "  ✗ 自证失败：B 类未命中"; ok_selftest=0; fi
  if [ "$ok_selftest" -eq 1 ]; then echo "  ✅ 自证通过：A=${nA} B=${nB}（判据可红）"; exit 0; fi
  exit 1
fi

# ── 正式扫描 ────────────────────────────────────────────────────────────────
[ -d "$SRC" ] || { echo "❌ 源目录不存在：${SRC}"; exit 1; }
if [ ! -f "$ALLOW" ]; then
  echo "ℹ 无豁免文件（${ALLOW}）——全部命中均为违规"
fi

run_all

if [ -n "$INVALID_EXEMPT" ]; then
  echo "❌ 豁免文件中存在**无效条目**（无理由 / 理由过短 ⇒ 不生效）："
  printf '%s' "$INVALID_EXEMPT"
fi

echo "──── inflight-single-source ────"
if [ -n "$report" ]; then printf '%s' "$report"; fi
echo "A 类（循环/重复 = 在飞动效，硬红）：${nA}"
echo "B 类（连续动画 / 未走底座，${STRICT:+--strict 时 }警告）：${nB}"
echo "已豁免（有理由）：${nExempt}"

fail=0
if [ "$nA" -gt 0 ]; then fail=1; fi
if [ "$STRICT" -eq 1 ] && [ "$nB" -gt 0 ]; then fail=1; fi
if [ -n "$INVALID_EXEMPT" ]; then fail=1; fi

if [ "$fail" -eq 0 ]; then
  echo "✅ 通过：在飞动效只有白名单（光球 + 底座）"
  exit 0
fi
echo "❌ 未通过：见上方红线（A 类必须修；B 类确认或登记豁免）"
exit 1
