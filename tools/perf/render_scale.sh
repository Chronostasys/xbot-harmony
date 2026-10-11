#!/usr/bin/env bash
# tools/perf/render_scale.sh —— **只读**真机渲染规模采集（块级窗口化改造的改前/改后同一把尺）。
#
# 口径：docs/RENDER-LOAD-MEASUREMENT.md 的"App 实际渲染块数"的**真机对应量** =
#       uitest dumpLayout 布局树的节点数（含 List/ListItem/Text/SymbolGlyph…）。
#
# ⚠️ 只读：只调 `uitest dumpLayout` 与 `file recv`。**不点击、不滑动、不输入、不切会话**
#    （设备可能正被用户使用；操作前请自行 `tools/device/ui.sh dump` 确认）。
#
# 用法：
#   TARGET=127.0.0.1:5555 bash tools/perf/render_scale.sh            # 打印当前屏的节点规模
#   TARGET=127.0.0.1:5555 bash tools/perf/render_scale.sh --json out.json   # 另存布局树
set -uo pipefail

if [ -z "${OHOS_SDK:-}" ] && [ -f "$HOME/ohos-cli/env.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/ohos-cli/env.sh" >/dev/null 2>&1 || true
fi
HDC="${HDC:-$(command -v hdc 2>/dev/null || true)}"
[ -n "$HDC" ] || { echo "❌ 找不到 hdc（先 source ~/ohos-cli/env.sh）" >&2; exit 1; }
T="${TARGET:-$("$HDC" list targets 2>/dev/null | tr -d '\r' | grep ':' | head -1)}"
[ -n "$T" ] || { echo "❌ 没有设备" >&2; exit 2; }

OUT="${1:-}"; [ "${OUT}" = "--json" ] && OUT="${2:-}"
SCRATCH="${SCRATCH:-/tmp/xbot-perf}"
mkdir -p "$SCRATCH"
J="$SCRATCH/ui.json"

"$HDC" -t "$T" shell "uitest dumpLayout -p /data/local/tmp/ui.json" >/dev/null 2>&1 || true
"$HDC" -t "$T" file recv /data/local/tmp/ui.json "$J" >/dev/null 2>&1 || true
[ -s "$J" ] || { echo "❌ 拿不到布局树" >&2; exit 1; }
[ -n "$OUT" ] && cp "$J" "$OUT"

python3 - "$J" <<'PY'
import json, sys, collections
d = json.load(open(sys.argv[1], encoding='utf-8'))
tot = 0; depth = 0; typ = collections.Counter(); ids = []
def walk(n, dp):
    global tot, depth
    if isinstance(n, dict):
        tot += 1; depth = max(depth, dp)
        a = n.get('attributes') or {}
        typ[a.get('type') or '?'] += 1
        if a.get('id'):
            ids.append((a['id'], a.get('bounds')))
        for c in (n.get('children') or []):
            walk(c, dp + 1)
    elif isinstance(n, list):
        for c in n:
            walk(c, dp)
walk(d, 0)
print(f"节点总数={tot}  最大深度={depth}")
print("按类型:", ', '.join(f"{k}:{v}" for k, v in typ.most_common(12)))
# 关键量：消息列表里的 ListItem 数 = 当前实际构建的"行"数（含 live 行/占位）
print(f"ListItem={typ.get('ListItem', 0)}  List={typ.get('List', 0)}  Text={typ.get('Text', 0)}")
print("关键 id:", [i for i, _ in ids][:8])
# 机械 grep 口径（可直接复制到 shell 复核上面的 python 计数）
raw = open(sys.argv[1], encoding='utf-8').read()
import re as _re
q = chr(34)
n_type = len(_re.findall(q + "type" + q + ":", raw))
n_li = len(_re.findall(q + "type" + q + ":" + q + "ListItem" + q, raw))
n_think = len(_re.findall(q + "text" + q + ":" + q + "思考 " + r"\d+" + " 字" + q, raw))
print("[grep 口径] \"type\": 出现 %d 次 / ListItem %d 个 / 「思考 N 字」%d 个" % (n_type, n_li, n_think))
PY

# ── 逐行（ListItem）规模：块数 / 节点数 —— #1（单行 N 块）改造的主口径 ──────────────
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$HERE/row_scale.py" ]; then
  echo
  python3 "$HERE/row_scale.py" "$J" || true
else
  echo "⚠️ 缺 $HERE/row_scale.py（逐行块数/节点数）"
fi
