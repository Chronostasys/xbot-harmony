#!/usr/bin/env bash
# 判据单一性门禁 —— 把「同一件事只能有一个判据」从文档纪律变成**机器可检**。
#
# 为什么需要（两次真事故，都靠人肉审计才发现）：
#   ① `ForEach` 的 key 里编进**会变的状态字段**（`components/LiveTailView.ets:568` 旧版
#      `lt-${i}#${name}#${status}`）⇒ 流式期每翻一次状态，ArkUI 按 key 认条目 ⇒
#      **销毁并重建**该节点 ⇒ 挂在节点上的浮层被拆、选中态复位、long-press 中断。
#   ② 同一个状态在**两处**走两套判据（同文件 `badge()` 把状态映到文案、`color()` 映到颜色；
#      `color()` 的兜底是 `successText` ⇒ **`killed`（已终止）被画成成功绿**）。
#
# 三条规则（A/B 警告级、C 仅报告）：
#   A：`ForEach(` 的**第 2 个参数（key 生成器）**里不得出现状态类属性访问
#      （`.status/.state/.phase/.running/.done/.st/.killed/.generating/.pending/.failed`）。
#      判据：key 必须是**稳定身份**；含状态 ⇒ 状态一变就换 key ⇒ 节点被销毁重建。
#      ⚠️ 刻意**不在**字段表里的（本仓既定且正确）：`row.rev`（故意随内容变，
#         `docs/ARKTS-GOTCHAS.md §3`）、`live`（只在三元里产出稳定 token `L`/`C`，
#         见 `components/MessageRow.ets:523`）。
#   B：同一 `.ets` 文件内**不得有 ≥2 段**「≥3 个状态字面量 → 颜色/文案」的 if 链。
#      单一真值点应是 `components/ToolVisual.statusColorOf`（角色判据来自
#      `core/toolstatus.statusColorRole`）。
#   C：同一文件出现 ≥2 处**逐字相同的中文用户可见串**（≥3 汉字）⇒ 列出
#      （提示"可能又有一处口径分叉"）。**默认不改退出码**，`--strict` 才计入。
#
# 豁免：`tools/lint/criteria-allowlist.txt`，每行 `<路径正则>:<命中行正则>  # 书面理由`。
#       ⛔ **没写理由的豁免不予生效**（会当场报"缺理由"），防止豁免清单变成静音开关。
#
# 用法：
#   bash tools/lint/criteria-single-source.sh                # 扫描本仓（A/B 警告级 + C 报告）
#   bash tools/lint/criteria-single-source.sh --strict       # A/B 命中 ⇒ 退出码 1
#   bash tools/lint/criteria-single-source.sh --self-test    # 自检夹具（证明能红）
#   CRIT_SELFTEST_BREAK=1 bash tools/lint/... --self-test    # 变异自证：让 A 失效 ⇒ 自检变红
#
# ⛔ 何时升级为**硬门禁**（`tools/gate.sh` 里去掉 `|| true`）：
#   条件 = ① A 类命中清零（或全部进了**带理由**的允许清单）；② B 类命中清零。
#   当前 A/B **有真实命中**（见脚本输出）⇒ 立刻转硬会红掉在飞的三条线，那是"让门禁挡路"
#   而不是"让缺陷自动红"。
#
# 局限（诚实声明）：
#   · 纯**文本级**匹配，无类型推导 ⇒ 别名/间接状态字段（`const k = t.status`）抓不到。
#   · B 类的颜色判定按 token 形状（`*Color`/`success*`/`pal()`…）⇒ 自造色值可能漏。
#   · C 类是启发式（默认不失败）：两条独立文案恰好同字是正当的。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ETS_ROOT="${CRIT_ETS_ROOT:-$ROOT/entry/src/main/ets}"
ALLOWLIST="${CRIT_ALLOWLIST:-$HERE/criteria-allowlist.txt}"
PREFIX="${CRIT_PREFIX:-entry/src/main/ets}"
STRICT=0

# ── 剥注释（**保留行号**：注释内容换成空格，不删行，报告才能直接定位）──────────────
# `://` 不截断（避免打死 URL 行的后半截），同一门手艺见 tools/lint/orphan-components.sh。
# 无 perl ⇒ 退化为原样（只可能**多报**，不会漏报，方向安全）。
strip_keep_lines() { # $1=源  $2=目标
  if command -v perl >/dev/null 2>&1; then
    perl -0777 -pe '
      s{/\*.*?\*/}{ my $m = $&; $m =~ s/[^\n]/ /g; $m }ges;
      s{(?<!:)//[^\n]*}{ my $m = $&; $m =~ s/[^\n]/ /g; $m }ge;
    ' "$1" > "$2" 2>/dev/null || cp "$1" "$2"
  else
    cp "$1" "$2"
  fi
}

# ── 分析器 ─────────────────────────────────────────────────────────────────────
# 命中行： <prefix>/<rel>:<line>: [A] ...   <prefix>/<rel>:<line>: [B] ...
# 汇总行： STATS <countA> <countB>
analyze_file() { # $1=已剥注释的文件  $2=报告用路径
  LC_ALL=C awk -v FILE="$2" '
    function lineno(off,   j) {           # 偏移 → 行号（游标推进，总代价 O(len)）
      while (cursor <= N && cursor <= off) {
        if (substr(S, cursor, 1) == "\n") nl_at++
        cursor++
      }
      return nl_at
    }
    function has_nonascii(t,   x) {       # 段内含非 ASCII（≈中文文案）
      x = t; gsub(/[\001-\177]/, "", x); return (length(x) > 0)
    }
    function fname(head,   h) {           # 行 → 函数名（"" = 不是函数头）
      if (head !~ /^[ \t]*(export[ \t]+)?(private[ \t]+|public[ \t]+|static[ \t]+|async[ \t]+)*(function[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*\([^{;]*\)[^{;]*\{[ \t]*$/) return ""
      h = head
      sub(/[ \t]*\(.*$/, "", h)
      sub(/^.*[ \t]/, "", h)
      return h
    }
    function namenear(ln,   j, h) {        # 向上找最近的**函数头**，仅为报告可读
      for (j = ln; j >= 1 && j > ln - 40; j--) {
        h = fname(L[j])
        if (h != "" && h !~ /^(if|for|while|switch|catch|else|do|return|function)$/) return h
      }
      return "?"
    }
    { L[NR] = $0 }
    END {
      S = ""; for (i = 1; i <= NR; i++) S = S L[i] "\n"
      N = length(S); nl_at = 1; cursor = 1
      STATEF = "\\.(status|state|phase|running|done|st|killed|generating|pending|failed)([^A-Za-z0-9_]|$)"

      # ── 规则 A：ForEach 第 2 参（key 生成器）含状态字段 ──────────────────────
      cntA = 0
      idx = 1
      while (idx <= N) {
        p = index(substr(S, idx), "ForEach(")
        if (p == 0) break
        fpos = idx + p - 1
        prevc = (fpos > 1) ? substr(S, fpos - 1, 1) : ""
        if (prevc ~ /[A-Za-z0-9_]/) { idx = fpos + 8; continue }   # 词边界
        lp = fpos + 7                        # "(" 的下标
        d = 0; k = lp; instr = ""; c1 = 0; c2 = 0; endp = 0
        while (k <= N) {
          c = substr(S, k, 1)
          if (instr != "") {
            if (c == "\\") { k += 2; continue }
            if (c == instr) { instr = ""; k++; continue }
            if (instr == "`" && c == "$" && substr(S, k + 1, 1) == "{") {
              bd = 1; k += 2                 # 模板串里的 ${...} 按花括号配平跳过
              while (k <= N && bd > 0) {
                cc = substr(S, k, 1)
                if (cc == "{") bd++
                else if (cc == "}") bd--
                k++
              }
              continue
            }
            k++; continue
          }
          if (c == "\"" || c == "\047" || c == "`") { instr = c; k++; continue }
          if (c == "(" || c == "[" || c == "{") { d++; k++; continue }
          if (c == "]" || c == "}") { d--; k++; continue }
          if (c == ")") { d--; if (d == 0) { endp = k; break } k++; continue }
          if (c == "," && d == 1) { if (c1 == 0) c1 = k; else if (c2 == 0) c2 = k; else if (c3 == 0) c3 = k }
          k++
        }
        # ⚠️ key 生成器是 `ForEach(arr, itemGen, keyGen)` 的**第 3 个实参**
        #    （= 第 2 个"函数参数"）⇒ 取 (第 2 个顶层逗号, 第 3 个顶层逗号) 之间。
        if (endp == 0 || c2 == 0) { idx = lp + 1; continue }   # 无第 3 参 ⇒ 无 key 生成器
        keystart = c2 + 1
        keyend = (c3 > 0) ? c3 : endp
        key = substr(S, keystart, keyend - keystart)
        if (match(key, STATEF)) {
          ln = lineno(keystart + RSTART - 1)
          hit = substr(key, RSTART, 26); gsub(/\n/, " ", hit)
          kc = key; gsub(/[ \t\n]+/, " ", kc); kc = substr(kc, 1, 78)
          cntA++
          printf "%s:%d: [A] ForEach 的 key 生成器 = %s\n      ⇒ 含状态字段 `%s`：状态一变即换 key ⇒ ArkUI **销毁重建**该条目（浮层被拆 / 选中态复位 / long-press 中断）。改为**稳定身份**（如 ${row.id}#${row.rev}），状态留给组件内部读。\n", FILE, ln, kc, hit
        }
        # ⚠️ 只跳过 `ForEach(` 本身（而不是整个调用）—— 否则**嵌套** ForEach
        #    （`ForEach(groups, g => { ListItem(){ ForEach(g.items, …) } })`）会被整块跳过，
        #    实测漏报 `pages/Index.ets` 的抽屉会话行 key（含 `.running`）。
        idx = fpos + 8
      }

      # ── 规则 B：同文件 ≥2 段「≥3 状态字面量 → 颜色/文案」if 链 ───────────────
      # 真实形态（components/LiveTailView.ets 的 badge()/color()）：
      #   if (t.status === 'generating') {...}
      #   if (t.status === 'running')    {...}     ← 同一状态字段的连续多分支
      # 分段：同一「状态字段比较行」且相邻 ≤25 行归为一段。
      STLINE  = "\\.(status|state|phase|kind|st)[ \t]*[=!]=[=]?[ \t]*[\047\042](done|running|error|pending|generating|killed|failed|success|waiting|idle)[\047\042]"
      STLINE2 = "ST_(DONE|ERROR|RUNNING|PENDING|GENERATING|KILLED)"
      COLORTOK = "\\.[A-Za-z_]*[Cc]olor[A-Za-z_]*|\\.(success|danger|warn|error|accent|focus)[A-Za-z_]*|pal[ \t]*\\(\\)|paletteOf"
      # 段的边界 = **函数头**（不是行距）：真实形态里 `badge()` 与 `color()` 往往只隔 2 行，
      # 只按行距会把两段并成一段 ⇒ 漏报（自检夹具就是这种相邻形态）。
      FUNCHEAD = "^[ \t]*(export[ \t]+)?(private[ \t]+|public[ \t]+|static[ \t]+|async[ \t]+)*(function[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*\\([^{;]*\\)[^{;]*\\{[ \t]*$"
      NSEG = 0; open = 0; seg_last = 0
      for (ln = 1; ln <= NR; ln++) {
        is_st = (L[ln] ~ STLINE || L[ln] ~ STLINE2)
        if (!is_st) {
          # 函数头（且不是 if/for/while/switch/… 这类控制语句）= 段边界
          if (open && L[ln] ~ FUNCHEAD) {
            h = L[ln]; sub(/[ \t]*\(.*$/, "", h); sub(/^.*[ \t]/, "", h)
            if (h !~ /^(if|for|while|switch|catch|else|do|return|function)$/) {
              seg_stop[NSEG] = seg_last; open = 0
            }
          }
          continue
        }
        if (!open || ln - seg_last > 25) {
          NSEG++; seg_start[NSEG] = ln; seg_n[NSEG] = 0; seg_lit[NSEG] = ""; open = 1
        }
        seg_last = ln
        t = L[ln]
        while (match(t, /[\047\042](done|running|error|pending|generating|killed|failed|success|waiting|idle)[\047\042]/)) {
          lit = substr(t, RSTART, RLENGTH)
          if (index(seg_lit[NSEG], lit) == 0) { seg_lit[NSEG] = seg_lit[NSEG] lit; seg_n[NSEG]++ }
          t = substr(t, RSTART + RLENGTH)
        }
        if (L[ln] ~ STLINE2 && index(seg_lit[NSEG], "ST_") == 0) {
          seg_lit[NSEG] = seg_lit[NSEG] "ST_"; seg_n[NSEG]++
        }
      }
      if (open) seg_stop[NSEG] = seg_last

      cntB = 0; mapped = 0
      for (g = 1; g <= NSEG; g++) {
        if (seg_n[g] < 3) continue
        body = ""
        for (ln = seg_start[g]; ln <= seg_stop[g]; ln++) body = body L[ln] " "
        if (body !~ COLORTOK && !has_nonascii(body)) continue
        cntB++
        seg_ok[g] = 1
      }
      if (cntB >= 2) {
        printf "%s: [B] 同文件 %d 段「状态 → 颜色/文案」映射（判据分叉风险）：", FILE, cntB
        for (g = 1; g <= NSEG; g++) {
          if (seg_ok[g] != 1) continue
          printf " %s():%d(状态x%d)", namenear(seg_start[g]), seg_start[g], seg_n[g]
        }
        printf "\n    ⇒ 同一状态在不同段里可能得到不同结果（历史事故：`killed` 落到兜底分支被画成成功绿）。收敛到**唯一**映射 `components/ToolVisual.statusColorOf`（角色判据来自 `core/toolstatus.statusColorRole`）。\n"
      }
      printf "STATS %d %d\n", cntA, (cntB >= 2 ? 1 : 0)
    }
  ' "$1"
}

# ── 允许清单 ───────────────────────────────────────────────────────────────────
is_allowed() { # $1 = 报告行（以 <prefix>/ 开头）
  [ -f "$ALLOWLIST" ] || return 1
  local line="$1" raw pat reason pathre linere
  while IFS= read -r raw || [ -n "$raw" ]; do
    case "$raw" in ''|'#'*) continue ;; esac
    case "$raw" in *'#'*) reason="${raw#*#}" ;; *) reason="" ;; esac
    pat="${raw%%#*}"
    if [ -z "$(printf '%s' "$reason" | tr -d '[:space:]')" ]; then
      echo "  ⚠ 允许清单缺理由 ⇒ 该项**不予豁免**：${pat}" >&2
      continue
    fi
    pathre="$(printf '%s' "${pat%%:*}" | sed 's/[[:space:]]*$//')"
    linere="$(printf '%s' "${pat#*:}" | sed 's/[[:space:]]*$//')"
    [ -n "$pathre" ] && [ -n "$linere" ] || continue
    printf '%s\n' "$line" | grep -Eq "^(${pathre})" || continue
    printf '%s\n' "$line" | grep -Eq "${linere}" && return 0
  done < "$ALLOWLIST"
  return 1
}

scan() { # $1 = ets 根目录
  local root="$1" tmpd rel out stats
  tmpd="$(mktemp -d)"
  ( cd "$root" && find . -name '*.ets' -type f -print0 |
      while IFS= read -r -d '' f; do
        mkdir -p "$tmpd/$(dirname "$f")"
        strip_keep_lines "$f" "$tmpd/$f"
      done )
  ALLA=0; ALLB=0
  for rel in $( cd "$root" && find . -name '*.ets' -type f | sed 's|^\./||' | sort ); do
    [ -f "$tmpd/$rel" ] || continue
    out="$(analyze_file "$tmpd/$rel" "${PREFIX}/${rel}")"
    stats="$(printf '%s\n' "$out" | grep -E '^STATS ' | tail -1)"
    ALLA=$(( ALLA + $(printf '%s' "$stats" | awk '{print $2 + 0}') ))
    ALLB=$(( ALLB + $(printf '%s' "$stats" | awk '{print $3 + 0}') ))
    printf '%s\n' "$out" | grep -E "^${PREFIX}/" | while IFS= read -r l; do
      if is_allowed "$l"; then
        echo "  (豁免) ${l}"
      else
        echo "  ${l}"
      fi
    done
  done
  rm -rf "$tmpd"
  echo "STATS-A=${ALLA} STATS-B=${ALLB}"
}

# ── 规则 C：同文件 ≥2 处逐字相同的中文串（≥3 汉字 ⇒ UTF-8 下 ≥9 字节）──────────
rule_c() { # $1 = ets 根目录
  local root="$1" tmpd rel dups nfiles=0
  tmpd="$(mktemp -d)"
  ( cd "$root" && find . -name '*.ets' -type f -print0 |
      while IFS= read -r -d '' f; do
        mkdir -p "$tmpd/$(dirname "$f")"
        strip_keep_lines "$f" "$tmpd/$f"
      done )
  for rel in $( cd "$root" && find . -name '*.ets' -type f | sed 's|^\./||' | sort ); do
    [ -f "$tmpd/$rel" ] || continue
    dups="$( { LC_ALL=C grep -oE '"[^"]*"' "$tmpd/$rel" 2>/dev/null
               LC_ALL=C grep -oE "'[^']*'" "$tmpd/$rel" 2>/dev/null
             } | LC_ALL=C awk '{ s = $0; gsub(/[\001-\177]/, "", s); if (length(s) >= 9) print $0 }' \
               | LC_ALL=C sort | LC_ALL=C uniq -d)"
    if [ -n "$dups" ]; then
      nfiles=$((nfiles + 1))
      echo "  [C] ${PREFIX}/${rel} 有逐字重复的中文串："
      printf '%s\n' "$dups" | sed 's/^/      · /'
    fi
  done
  rm -rf "$tmpd"
  echo "  （C 类命中文件数：${nfiles}；**默认不失败**，--strict 才计入）"
  return 0
}

# ── 自检 ───────────────────────────────────────────────────────────────────────
self_test() {
  local d failed=0 out out2
  d="$(mktemp -d)"
  mkdir -p "$d/components" "$d/core"
  cat > "$d/components/HitKey.ets" <<'EOF'
@Component
export struct HitKey {
  build() {
    Column() {
      ForEach(this.tools, (t: ToolProgress, i: number) => {
        Pill({ t: t })
      }, (t: ToolProgress, i: number) => `lt-${i}#${t.name}#${t.status}`)
    }
  }
}
EOF
  cat > "$d/core/CommentOnly.ets" <<'EOF'
// 旧实现：ForEach(this.tools, (t) => { Pill({t:t}) }, (t) => `lt-${t.status}`)
/* 也见
   ForEach(x, (a) => { A() }, (a) => `k-${a.state}`)
*/
export const NOTE = 1;
EOF
  cat > "$d/components/TwoMaps.ets" <<'EOF'
function badgeOf(t: ToolProgress): string {
  if (t.status === 'generating') { return '生成中'; }
  if (t.status === 'running') { return '运行中'; }
  if (t.status === 'error') { return '失败'; }
  if (t.status === 'pending') { return '排队'; }
  return '';
}
function colorOf(t: ToolProgress): string {
  if (t.status === 'error') { return this.pal().dangerText; }
  if (t.status === 'running' || t.status === 'generating') { return this.pal().accentSoft; }
  if (t.status === 'pending') { return this.pal().textMuted; }
  return this.pal().successText;
}
EOF
  cat > "$d/components/Allowlisted.ets" <<'EOF'
@Component
export struct Allowlisted {
  build() {
    Column() {
      ForEach(this.jobs, (j: Job, i: number) => {
        Row() { Text(j.name) }
      }, (j: Job, i: number) => `job-${i}#${j.state}`)
    }
  }
}
EOF
  cat > "$d/core/RepText.ets" <<'EOF'
export function a(): string { return '正在加载更多…'; }
export function b(): string { return '正在加载更多…'; }
EOF
  cat > "$d/allow.txt" <<EOF
# 自检用允许清单（带书面理由）
${PREFIX}/components/Allowlisted[.]ets:.*\\[A\\].*   # 自检夹具：书面豁免理由
EOF

  out="$(CRIT_ETS_ROOT="$d" CRIT_ALLOWLIST="$d/allow.txt" PREFIX="$PREFIX" bash "$0" 2>&1)"

  if [ "${CRIT_SELFTEST_BREAK:-0}" = "1" ]; then
    out="$(printf '%s\n' "$out" | grep -v 'key 含状态字段')"   # 模拟 A 检测器失效
  fi

  printf '%s\n' "$out" | grep -q 'HitKey.ets.*\[A\]' \
    || { echo "❌ 自检失败：key 含 .status 的 ForEach 未被检出"; failed=1; }
  printf '%s\n' "$out" | grep -q 'TwoMaps.ets.*\[B\]' \
    || { echo "❌ 自检失败：同文件两段状态映射未被检出"; failed=1; }
  if printf '%s\n' "$out" | grep -q 'CommentOnly[.]ets.*\[A\]'; then
    echo "❌ 自检失败：注释里的 ForEach 被误报（假阳性）"; failed=1
  fi
  printf '%s\n' "$out" | grep -q '(豁免).*Allowlisted' \
    || { echo "❌ 自检失败：允许清单未生效（应打印 (豁免) 行）"; failed=1; }
  printf '%s\n' "$out" | grep -q '正在加载更多' \
    || { echo "❌ 自检失败：规则 C 未报出重复中文串"; failed=1; }
  printf '# 无理由\n%s/core/RepText[.]ets:.*\n' "$PREFIX" > "$d/allow2.txt"
  out2="$(CRIT_ETS_ROOT="$d" CRIT_ALLOWLIST="$d/allow2.txt" PREFIX="$PREFIX" bash "$0" 2>&1)"
  printf '%s\n' "$out2" | grep -q '缺理由' \
    || { echo "❌ 自检失败：缺理由的豁免未被拒绝"; failed=1; }
  rm -rf "$d"
  if [ "$failed" -eq 0 ]; then
    echo "✅ 自检通过（(a) key 含状态⇒检出 / (b) 同文件两段映射⇒检出 / (c) 注释⇒不报 / (d) 允许清单⇒豁免 且 缺理由⇒拒绝 / (e) 重复中文串⇒报出）"
  fi
  return "$failed"
}

case "${1:-}" in
  --self-test) self_test || exit 1 ;;
  --strict) STRICT=1 ;;
esac

echo "===== 判据单一性（A/B 警告级 · C 仅报告）====="
if [ ! -d "$ETS_ROOT" ]; then
  echo "⚠ 扫描根不存在：$ETS_ROOT（跳过）"
  exit 0
fi
echo "-- 规则 A：ForEach key 含状态字段 · 规则 B：同文件 ≥2 段状态→颜色/文案映射 --"
result="$(scan "$ETS_ROOT")"
printf '%s\n' "$result" | grep -vE '^STATS-A=' | sed '/^$/d'
summary="$(printf '%s\n' "$result" | grep -E '^STATS-A=' | tail -1)"
A="$(printf '%s' "$summary" | sed 's/.*STATS-A=\([0-9]*\).*/\1/')"
B="$(printf '%s' "$summary" | sed 's/.*STATS-B=\([0-9]*\).*/\1/')"
A="${A:-0}"; B="${B:-0}"

echo
echo "-- 规则 C：同文件逐字重复的中文用户可见串 --"
rule_c "$ETS_ROOT"

echo
echo "小结：A 类命中 ${A} 处 · B 类命中 ${B} 个文件 · 允许清单=${ALLOWLIST}"
if [ "$A" -eq 0 ] && [ "$B" -eq 0 ]; then
  echo "✅ 判据单一性通过（key 无状态字段 / 无重复状态映射）"
else
  echo "⚠ 判据单一性：A=${A} B=${B}（**警告级**：升级条件见脚本头注释）"
fi
if [ "$STRICT" -eq 1 ] && { [ "$A" -ne 0 ] || [ "$B" -ne 0 ]; }; then
  exit 1
fi
exit 0
