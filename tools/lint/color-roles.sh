#!/usr/bin/env bash
# color-roles.sh —— 断言「组件/页面请求的取色 role 全部合法」。
#
# 为什么必须有它（本仓已知的真缺陷类别，2026-10-11 我在审计令牌层时钓出）：
#   `core/design.ets` 的取色唯一入口 `colorOf(p, role)` 对**未知 role 静默 `return p.transparent`**
#   ⇒ 谁把「散文记号」当 API 用（`colorOf(p,'text.pillName')`、`colorOf(p,'status.danger')`），
#     **编译零警告**（形参是 string）、**运行时文字/图标不可见**、现有任何测试都抓不到。
#   `docs/REDESIGN-INPUT-*.md` 与 `docs/mockups/*.html` 里恰好大量使用这种**带点记号**
#   ⇒ 这是"文档写得越漂亮、实现越容易踩"的典型陷阱 ⇒ 用本脚本把"合法 role"变成可判定集合。
#
# 判据（三类调用一起查）：
#   · colorOf(p, '<lit>')         —— role ∈ colorOf 实现里的 `role === '<x>'` 字面量集合
#   · surfaceFillOf(p, '<lit>')   —— role ∈ `new SurfaceRole('<surface.x>', ...)` 表
#   · typeOf('<lit>')             —— role ∈ `new TypeRole('<type.x>', ...)` 表
#   · elevationColorOf(p,'<lit>') —— level ∈ `elevationLevelOf`/ElevationRole 表（若该表存在）
# ⛔ 只查**字符串字面量**实参：写 `SURFACE_COMPOSER` / `TYPE_PILL_NAME` 常量是**推荐姿势**，
#    天然不在扫描范围（这正是本仓 `SURFACE_*`/`TYPE_*` 常量存在的意义）。
#
# 用法：bash tools/lint/color-roles.sh
# 可覆盖（供 mutation 自证 / 复用）：DESIGN_FILE=... SCAN_DIRS="dir1 dir2"
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ETS="$ROOT/entry/src/main/ets"
DESIGN_FILE="${DESIGN_FILE:-$ETS/core/design.ets}"
: "${SCAN_DIRS:=}"
if [ -z "$SCAN_DIRS" ]; then
  SCAN_DIRS="$ETS/components $ETS/pages $ETS/core"
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/color-roles.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

[ -f "$DESIGN_FILE" ] || { echo "❌ 找不到 design 真源: $DESIGN_FILE"; exit 2; }

# ── 1) 合法集合（从真源抽取，⛔ 不硬编码：真源改了这里自动跟随） ─────────────
# colorOf: 形如  if (role === 'textPrimary') { ... }
sed -nE "s/.*role === '([^']+)'.*/\1/p" "$DESIGN_FILE" | sort -u > "$TMP/colors.txt"
# surfaceFillOf: 形如  new SurfaceRole('surface.pill', ...)
sed -nE "s/.*new SurfaceRole\('([^']+)'.*/\1/p" "$DESIGN_FILE" | sort -u > "$TMP/surfaces.txt"
# typeOf: 形如  new TypeRole('type.display', ...)
sed -nE "s/.*new TypeRole\('([^']+)'.*/\1/p" "$DESIGN_FILE" | sort -u > "$TMP/types.txt"
# elevation：合法档位 = `export const ELEV_X: string = 'elevN'` 的取值（真源里的常量，不是字面量比较）
sed -nE "s/.*export const ELEV_[A-Z_]+: string = '([^']+)'.*/\1/p" "$DESIGN_FILE" | sort -u > "$TMP/elevs.txt"

n_colors=$(wc -l < "$TMP/colors.txt" | tr -d ' ')
n_surfaces=$(wc -l < "$TMP/surfaces.txt" | tr -d ' ')
n_types=$(wc -l < "$TMP/types.txt" | tr -d ' ')
n_elevs=$(wc -l < "$TMP/elevs.txt" | tr -d ' ')
if [ "$n_colors" -lt 10 ]; then
  echo "❌ 从 $DESIGN_FILE 只抽到 ${n_colors} 个颜色 role —— 抽取规则与真源脱节，先修本脚本"
  exit 2
fi

# ── 1.5) **剥注释镜像**（本仓明文：「注释里记录色值/role 是允许且鼓励的」）──────────
#  实测踩过：`Fallback.ets` 头注里写了 `typeOf('type.*')` 这种**说明形状** ⇒ 旧版把注释当代码判红，
#  迫使作者改注释（白费一轮）。⇒ 先把"注释→等长空白"做镜像（**保留换行** ⇒ 行号不漂移）再扫；
#  ⛔ 字符串里的 `//`（如 `'xbot://a'`）不剥 —— 用状态机而非"字符后是否有冒号"的启发式。
mkdir -p "$TMP/src"
python3 - "$ROOT" "$TMP/src" $SCAN_DIRS <<'PYSTRIP'
import os, sys
root, out = sys.argv[1], sys.argv[2]
def strip(src):
    res = []; i = 0; n = len(src); st = 0; q = ''
    while i < n:
        c = src[i]; c2 = src[i + 1] if i + 1 < n else ''
        if st == 0:
            if c == '"' or c == "'" or c == chr(96):
                st = 3; q = c; res.append(c); i += 1; continue
            if c == '/' and c2 == '/':
                st = 1; res.append('  '); i += 2; continue
            if c == '/' and c2 == '*':
                st = 2; res.append('  '); i += 2; continue
            res.append(c); i += 1; continue
        if st == 1:
            if c == chr(10): st = 0; res.append(c)
            else: res.append(' ')
            i += 1; continue
        if st == 2:
            if c == '*' and c2 == '/': st = 0; res.append('  '); i += 2; continue
            res.append(c if c == chr(10) else ' '); i += 1; continue
        if c == chr(92):
            res.append(c)
            if c2: res.append(c2)
            i += 2; continue
        if c == q: st = 0
        res.append(c); i += 1
    return ''.join(res)
for d in sys.argv[3:]:
    for dp, _dn, fns in os.walk(d):
        for fn in fns:
            if not fn.endswith(('.ets', '.ts')): continue
            p = os.path.join(dp, fn)
            dst = os.path.join(out, os.path.relpath(p, root))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            src = open(p, encoding='utf-8').read()
            open(dst, 'w', encoding='utf-8').write(strip(src))
PYSTRIP
MIRROR_DIRS=""
for d in $SCAN_DIRS; do MIRROR_DIRS="$MIRROR_DIRS $TMP/src/${d#$ROOT/}"; done
SCAN_DIRS="$MIRROR_DIRS"
SHOW_PREFIX="$TMP/src/"

# ── 2) 扫描调用点，挑出非法字面量 ─────────────────────────────────────────
scan() { # $1=函数名  $2=合法集合文件  $3=角色类别名
  local fn="$1" set="$2" kind="$3" hit frag lit line f bad=0 hits=0
  # ⚠️ 只取**调用片段**（grep -o）而不是整行：实测踩过坑 ——
  #    `Text('保存').fontSize(typeOf('type.subhead').size)` 用"整行 + 每行第一个引号"会误取 '保存'（假红）。
  # `[^)(']*` ⇒ 实参里不含嵌套括号/引号 ⇒ 只在"字面量确实是该调用的实参"时命中，宁漏不误报。
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    f="${hit%%:*}"; line="${hit#*:}"; line="${line%%:*}"; frag="${hit#*:}"; frag="${frag#*:}"
    lit="$(printf '%s' "$frag" | sed -E "s/^[^']*'([^']*)'.*/\1/")"
    [ -n "$lit" ] || continue
    hits=$((hits + 1))
    if ! grep -Fxq -- "$lit" "$set"; then
      printf '  ❌ %s:%s  %s(%s) —— 非法 %s role\n' "${f#$SHOW_PREFIX}" "$line" "$fn" "'$lit'" "$kind"
      bad=$((bad + 1))
    fi
  done < <(grep -rnoE --include='*.ets' --include='*.ts' "${fn}\([^)(']*'[^']*'" $SCAN_DIRS 2>/dev/null)
  # ⚠️ 子 shell 里跑 ⇒ 计数写文件带出去（bash 3.2 无 nameref）
  echo "$(( $(cat "$TMP/counts" 2>/dev/null || echo 0) + hits ))" > "$TMP/counts"
  return $bad
}

{
  echo "== 合法 role 集合（真源 ${DESIGN_FILE}）=="
  echo "  颜色 ${n_colors}｜面 ${n_surfaces}｜字型 ${n_types}｜高程 ${n_elevs}"
  if [ "$n_surfaces" -gt 0 ]; then echo "  面: $(paste -sd, "$TMP/surfaces.txt")"; fi
  if [ "$n_types" -gt 0 ]; then echo "  字型: $(paste -sd, "$TMP/types.txt")"; fi
  echo
} > "$TMP/report"

bad_total=0
checked=""; skipped=""
# ⚠️ surface 集合同时用于 `elevationLevelOf('<surface.x>')`（它按面角色选阴影档；未知角色静默落 elev2）
for spec in "colorOf:$TMP/colors.txt:颜色:checked" \
            "surfaceFillOf:$TMP/surfaces.txt:面:checked" \
            "typeOf:$TMP/types.txt:字型:checked" \
            "elevationColorOf:$TMP/elevs.txt:高程档:checked" \
            "elevationLevelOf:$TMP/surfaces.txt:面角色:checked"; do
  fn="${spec%%:*}"; rest="${spec#*:}"; set="${rest%%:*}"; rest="${rest#*:}"; kind="${rest%%:*}"
  if [ ! -s "$set" ]; then
    skipped="$skipped ${fn}(表为空)"
    continue
  fi
  out="$(scan "$fn" "$set" "$kind")"; rc=$?
  [ -n "$out" ] && echo "$out" >> "$TMP/report"
  bad_total=$((bad_total + rc))
  checked="$checked ${fn}"
done
echo "　（已查:$checked${skipped:+｜跳过:$skipped}）" >> "$TMP/report"

if [ "$bad_total" -eq 0 ]; then
  scanned="$(cat "$TMP/counts" 2>/dev/null || echo 0)"
  if [ "$scanned" -eq 0 ]; then
    echo "❌ color-roles：**一处取色调用都没扫到** —— 这是白绿（正则/路径与真源脱节），先修本脚本再信它"
    exit 2
  fi
  echo "✅ color-roles：扫到 ${scanned} 处取色调用，用的都是真源里的合法 role（颜色 ${n_colors}｜面 ${n_surfaces}｜字型 ${n_types}｜高程 ${n_elevs}）"
  echo "   ⚠️ 提醒：未知 role 会被 colorOf 静默解析成 p.transparent（不可见）——本脚本是唯一机器判据。"
  exit 0
fi
cat "$TMP/report"
echo
echo "❌ color-roles：${bad_total} 处非法取色 role（严重：运行时不可见，且编译不报）"
echo "   修法：①改用真源里的 camelCase 名（如 textPrimary / textSecondary / dangerText / statusError）"
echo "         ②面/字型请用常量：SURFACE_COMPOSER / TYPE_PILL_NAME …（而不是新造字符串）"
echo "         ③确实需要新角色 ⇒ 加进 core/design.ets 的角色表（别在组件里硬写）"
exit 1
