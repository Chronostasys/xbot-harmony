#!/usr/bin/env bash
# orphan-core.sh —— core/ 下的「**未消费模块**」检测（警告级；`--strict` 时非 0 退出）
#
# 为什么需要（本仓真实事故，2026-10-11）：
#   `core/reasoningopen.ts`（web `reasoningOpenState.ts` 逐字移植）**零消费方**就被提交，
#   而 `run.sh` / `lint` / `typecheck` / 门禁 ④ **全部全绿** ⇒ 交付报告说的"修了 live→commit
#   自动收起"是**假的**。根因：**ArkTS 不检查没有任何消费者的模块文件**（同 ⑤ 孤儿组件）。
#
# 判据：`core/**` 下每个模块，若**全仓（entry/src/main/ets + tools/tests）无任何 import/re-export
#   指向它** ⇒ 报「未消费」（警告级）。合法无消费者的（诊断脚本、仅测试用夹具）写进
#   `tools/lint/orphan-core-allowlist.txt`（每行一个模块名，`#` 注释）。
#
# ⚠️ 实现说明：引用搜索只认**import/export 语句里的引号路径**（`'…/name'`），并**先剥注释**
#   ⇒ 注释里提到模块名**不算**消费者（避免假绿）。已知局限：路径字面量被行内 `//` 截断时可能
#   **漏报** ⇒ 只会少报，不会把有消费者的报成孤儿（方向安全）。
#
# 用法：
#   bash tools/lint/orphan-core.sh              # 检测（警告级：始终 exit 0）
#   bash tools/lint/orphan-core.sh --strict     # 有未消费 ⇒ exit 1
#   bash tools/lint/orphan-core.sh --self-test  # 夹具自检（防"零扫描假绿""注释当消费者""豁免失效"回归）
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
: "${XC_CORE_DIR:=$ROOT/entry/src/main/ets/core}"
: "${XC_SEARCH_DIRS:=$ROOT/entry/src/main/ets:$ROOT/tools/tests}"
: "${XC_ALLOW:=$HERE/orphan-core-allowlist.txt}"
# ⛔ `: "${V:=default}"` 只赋值**不导出** ⇒ 必须显式 export，否则 python3 子进程看不到（自证时被此坑咬）。
export XC_CORE_DIR XC_SEARCH_DIRS XC_ALLOW

MODE="check"
case "${1:-}" in
  --strict) MODE="strict" ;;
  --self-test) MODE="self-test" ;;
  "") MODE="check" ;;
  *) echo "用法: bash tools/lint/orphan-core.sh [--strict|--self-test]"; exit 2 ;;
esac

# ── 核心检测（python3：剥注释 + 只在 import/re-export 语句里找引用）──
# 输出（制表符分隔的机器行，由 bash 渲染人类可读输出）：
#   ORPHAN<TAB>file    未消费（未豁免）
#   EXEMPT<TAB>file    未消费但在豁免表里
#   SUMMARY<TAB>total<TAB>ok<TAB>exempt<TAB>orphan
run_check() {
  python3 - <<'PY'
import os, re

core = os.environ['XC_CORE_DIR']
dirs = [d for d in os.environ['XC_SEARCH_DIRS'].split(':') if d]
mods = sorted(f for f in os.listdir(core) if f.endswith(('.ts', '.ets')))

def strip_comments(text):
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n:
            if text[i + 1] == '/':
                j = text.find('\n', i)
                i = n if j < 0 else j
                continue
            if text[i + 1] == '*':
                j = text.find('*/', i + 2)
                i = n if j < 0 else j + 2
                continue
        out.append(c)
        i += 1
    return ''.join(out)

refs = {}   # 绝对路径 -> [被引用模块名, ...]
for d in dirs:
    for dp, _, fns in os.walk(d):
        for fn in fns:
            if not fn.endswith(('.ts', '.ets')):
                continue
            p = os.path.join(dp, fn)
            try:
                src = strip_comments(open(p, encoding='utf-8', errors='replace').read())
            except OSError:
                continue
            names = []
            for m in re.finditer(r"(?:^|\n)\s*(?:import|export)\b", src):
                seg = src[m.start():m.start() + 1200]
                end = seg.find(';')
                if end > 0:
                    seg = seg[:end]
                qs = re.findall(r"['\"]([^'\"]+)['\"]", seg)
                if qs:
                    names.append(qs[-1].rsplit('/', 1)[-1])
            refs[p] = names

allow = set()
if os.path.isfile(os.environ['XC_ALLOW']):
    for ln in open(os.environ['XC_ALLOW'], encoding='utf-8'):
        ln = ln.split('#')[0].strip()
        if ln:
            allow.add(ln)

total = ok = exempt = orphan = 0
lines = []
for f in mods:
    total += 1
    name = f.rsplit('.', 1)[0]
    self_path = os.path.abspath(os.path.join(core, f))
    hits = 0
    for p, names in refs.items():
        if os.path.abspath(p) == self_path:
            continue
        if name in names:
            hits += 1
            break
    if hits:
        ok += 1
    elif name in allow or f in allow:
        exempt += 1
        lines.append('EXEMPT\t' + f)
    else:
        orphan += 1
        lines.append('ORPHAN\t' + f)
lines.append('SUMMARY\t%d\t%d\t%d\t%d' % (total, ok, exempt, orphan))
print('\n'.join(lines))
PY
}

if [ "$MODE" = "self-test" ]; then
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  mkdir -p "$TMP/core" "$TMP/cons"
  printf 'export const a = 1;\n' > "$TMP/core/consumed.ts"
  printf 'export const b = 2;\n' > "$TMP/core/orphaned.ts"
  printf 'export const c = 3;\n' > "$TMP/core/incomment.ts"
  printf 'export const d = 4;\n' > "$TMP/core/exempted.ts"
  printf "import { a } from '../core/consumed';\n// 参见 '../core/incomment'\nconsole.log(a);\n" > "$TMP/cons/user.ts"
  printf 'exempted\n' > "$TMP/allow.txt"
  OUT="$(XC_CORE_DIR="$TMP/core" XC_SEARCH_DIRS="$TMP/cons" XC_ALLOW="$TMP/allow.txt" run_check)"
  fail=0
  printf '%s\n' "$OUT" | grep -q "ORPHAN	orphaned.ts"  || { echo "❌ 自检失败：真孤儿未报"; fail=1; }
  printf '%s\n' "$OUT" | grep -q "ORPHAN	incomment.ts" || { echo "❌ 自检失败：只在注释里被提到未报（假绿）"; fail=1; }
  printf '%s\n' "$OUT" | grep -q "EXEMPT	exempted.ts" || { echo "❌ 自检失败：豁免表未生效"; fail=1; }
  printf '%s\n' "$OUT" | grep -q "consumed.ts"         && { echo "❌ 自检失败：有消费者却被报"; fail=1; }
  printf '%s\n' "$OUT" | grep -q "SUMMARY	4	1	1	2" || { printf '%s\n' "$OUT" | grep -q "^SUMMARY	4" || { echo "❌ 自检失败：模块计数错（可能零扫描）"; fail=1; }; }
  [ "$fail" = 0 ] && { echo "✅ orphan-core 自检通过（真孤儿报／注释提不算消费者／豁免生效／有消费者不报／计数对）"; exit 0; }
  exit 1
fi

OUT="$(run_check)"
SUM="$(printf '%s\n' "$OUT" | grep '^SUMMARY' | head -1)"
TOTAL="$(printf '%s' "$SUM" | cut -f2)"; OK_N="$(printf '%s' "$SUM" | cut -f3)"
EXEMPT_N="$(printf '%s' "$SUM" | cut -f4)"; ORPH_N="$(printf '%s' "$SUM" | cut -f5)"
ORPH_LIST="$(printf '%s\n' "$OUT" | grep '^ORPHAN' | cut -f2)"
EXEMPT_LIST="$(printf '%s\n' "$OUT" | grep '^EXEMPT' | cut -f2)"

echo "=== core/ 未消费模块（警告级 · ⑧）==="
if [ "${ORPH_N:-0}" -gt 0 ]; then
  printf '%s\n' "$ORPH_LIST" | while IFS= read -r f; do [ -n "$f" ] && echo "  ⚠ 未消费（全仓无 import）：core/${f}"; done
  echo "  ⇒ 接线进页面；或（合法无消费者，如诊断/仅测试用）写进 tools/lint/orphan-core-allowlist.txt"
fi
if [ "${EXEMPT_N:-0}" -gt 0 ]; then
  printf '%s\n' "$EXEMPT_LIST" | while IFS= read -r f; do [ -n "$f" ] && echo "  (豁免) core/${f}"; done
fi
if [ "${TOTAL:-0}" -eq 0 ]; then
  echo "❌ 零扫描（未找到任何 core 模块）⇒ 判红（白绿防线）"; exit 1
fi
if [ "${ORPH_N:-0}" -eq 0 ]; then
  echo "✅ 无未消费模块（core 模块 ${TOTAL}：跨文件消费 ${OK_N} / 豁免 ${EXEMPT_N} / 未消费 0）"
else
  echo "⚠ core 模块 ${TOTAL}：跨文件消费 ${OK_N} / 豁免 ${EXEMPT_N} / **未消费 ${ORPH_N}**"
fi
[ "$MODE" = "strict" ] && [ "${ORPH_N:-0}" -gt 0 ] && exit 1
exit 0
