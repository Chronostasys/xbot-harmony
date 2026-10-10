#!/usr/bin/env bash
# 真机 UI 语义化操作 —— **按文本找元素并点击**，不写死坐标。
#
# 为什么必须语义化：写死坐标的脚本在「键盘弹出/页面滚动/布局随主题变」时全部失效，
#   而且失效后表现为"点了但没反应"，极难定位（2026-10-11 实测：安全键盘弹出把页面
#   上推 ~93px，导致按截图估算的"登录"按钮坐标实际点在键盘上）。
#   语义化后：布局怎么变都能找到目标。
#
# 用法：
#   tools/device/ui.sh click-text 登录        # 找文本含「登录」的节点，点它的中心
#   tools/device/ui.sh click-text 测试连接
#   tools/device/ui.sh exists 渲染自检        # 存在 ⇒ 打印 Y / 不存在 ⇒ 退出码 1
#   tools/device/ui.sh text 'hello'           # 在当前焦点处输入
#   tools/device/ui.sh key Back               # 注入按键（Back/Home/Power）
#   tools/device/ui.sh dump                   # 打印屏幕上的文本节点（带 bounds）
#   tools/device/ui.sh shot /tmp/a.jpeg       # 截图并拉回本地
#   tools/device/ui.sh wait-text 会话 --timeout 15   # 轮询直到出现该文本
#
# ⚠️ 截图保护：**密码框聚焦时系统进入安全输入，snapshot_display 只能拿到全黑图**
#   （此时布局树仍正常）。要截图必须先 `key Back` 收起安全键盘 / 让密码框失焦。
#
# 环境变量：TARGET（默认取第一个 hdc 目标）/ HDC
set -euo pipefail

if [ -z "${OHOS_SDK:-}" ] && [ -f "$HOME/ohos-cli/env.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/ohos-cli/env.sh"
fi
HDC="${HDC:-$(command -v hdc 2>/dev/null || true)}"
if [ -z "$HDC" ] || [ ! -x "$HDC" ]; then
  HDC="$(ls -d "${OHOS_SDK:-$HOME/ohos-cli/command-line-tools/sdk}"/*/openharmony/toolchains/hdc 2>/dev/null | head -1 || true)"
fi
[ -n "$HDC" ] && [ -x "$HDC" ] || { echo "❌ 找不到 hdc（source ~/ohos-cli/env.sh 或 HDC=<path>）" >&2; exit 1; }

T="${TARGET:-}"
if [ -z "$T" ]; then
  T="$("$HDC" list targets 2>/dev/null | tr -d '\r' | grep ':' | head -1 || true)"
fi
[ -n "$T" ] || { echo "❌ 没有设备（hdc list targets 为空）" >&2; exit 2; }

DEV="${DEV:-/data/local/tmp}"
SCRATCH="${SCRATCH:-/tmp/xbot-ui}"
mkdir -p "$SCRATCH"

dump_to() {  # dump_to <local json path>
  local out="$1"
  "$HDC" -t "$T" shell "uitest dumpLayout -p $DEV/ui.json" >/dev/null 2>&1 || true
  "$HDC" -t "$T" file recv "$DEV/ui.json" "$out" >/dev/null 2>&1 || true
  [ -s "$out" ] || { echo "❌ 拿不到布局树（uitest dumpLayout 失败？）" >&2; return 1; }
}

# find <json> <text> ⇒ 打印 "cx cy text"（取文本包含 <text> 的第一个有面积的节点）
find_node() {
  python3 - "$1" "$2" <<'PY'
import json,re,sys
path,needle=sys.argv[1],sys.argv[2]
d=json.load(open(path,encoding='utf-8'))
hit=[]
def walk(n):
    if isinstance(n,dict):
        a=n.get('attributes') or {}
        # ⚠️ 空 TextInput 的**占位符在 `hint`**，不在 `text`（2026-10-11 实测）：
        #    只匹配 text ⇒ "用户名/密码"这类空输入框永远找不到目标。
        cands=[a.get('text'),a.get('content'),a.get('hint')]
        b=a.get('bounds')
        if b and any(c and needle in c for c in cands):
            m=re.match(r'\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]',b)
            if m:
                x1,y1,x2,y2=map(int,m.groups())
                if x2>x1 and y2>y1:
                    label=next((c for c in cands if c), '')
                    hit.append((label,(x1+x2)//2,(y1+y2)//2,x1,y1,x2,y2))
        for c in (n.get('children') or []): walk(c)
    elif isinstance(n,list):
        for c in n: walk(c)
walk(d)
if not hit: sys.exit(1)
# ⚠️ 多命中时取**面积最小**的节点：文本常同时挂在「容器」与「叶子」上，
#    容器的 bounds 会包含整块区域 ⇒ 点它的中心会落在空白处/标题上而不是按钮上
#    （2026-10-11 实测：点"允许"命中了通知弹窗的标题，弹窗没关掉）。
hit.sort(key=lambda h: (h[5]-h[3])*(h[6]-h[4]))
t,cx,cy,*_=hit[0]
print(f"{cx} {cy} {t}")
PY
}

cmd="${1:-}"; shift || true
case "$cmd" in
  dump)
    J="$SCRATCH/ui.json"; dump_to "$J"
    python3 - "$J" <<'PY'
import json,re,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
out=[]
def walk(n):
    if isinstance(n,dict):
        a=n.get('attributes') or {}
        t=(a.get('text') or a.get('content') or '')
        if t: out.append((t,a.get('bounds'),a.get('type')))
        for c in (n.get('children') or []): walk(c)
    elif isinstance(n,list):
        for c in n: walk(c)
walk(d)
print(f"文本节点 {len(out)} 个：")
for t,b,ty in out: print(f"  {t!r} @ {b}  <{ty}>")
PY
    ;;
  click-text)
    [ $# -ge 1 ] || { echo "用法: ui.sh click-text <文本>" >&2; exit 1; }
    J="$SCRATCH/ui.json"; dump_to "$J"
    if read -r cx cy txt < <(find_node "$J" "$1"); then
      echo "→ 点中 $txt @ ($cx,$cy)"
      "$HDC" -t "$T" shell "uitest uiInput click $cx $cy" >/dev/null 2>&1 || true
    else
      echo "❌ 屏幕上找不到文本：$1" >&2; exit 1
    fi
    ;;
  click-input)
    # 点第 n 个 TextInput（1-based，按布局树顺序）—— 不依赖占位符/当前值，最稳。
    [ $# -ge 1 ] || { echo "用法: ui.sh click-input <n>" >&2; exit 1; }
    J="$SCRATCH/ui.json"; dump_to "$J"
    if read -r cx cy txt < <(python3 - "$J" "$1" <<'PY'
import json,re,sys
d=json.load(open(sys.argv[1],encoding='utf-8')); want=int(sys.argv[2]); ins=[]
def walk(n):
    if isinstance(n,dict):
        a=n.get('attributes') or {}
        if a.get('type')=='TextInput' and a.get('bounds') and a.get('visible')!='false':
            m=re.match(r'\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]',a['bounds'])
            if m:
                x1,y1,x2,y2=map(int,m.groups())
                if x2>x1 and y2>y1: ins.append(((x1+x2)//2,(y1+y2)//2,a.get('hint') or a.get('text') or ''))
        for c in (n.get('children') or []): walk(c)
    elif isinstance(n,list):
        for c in n: walk(c)
walk(d)
if want<1 or want>len(ins): sys.exit(1)
cx,cy,lab=ins[want-1]; print(f"{cx} {cy} TextInput#{want} {lab}")
PY
    ); then
      echo "→ 点中 $txt @ ($cx,$cy)"
      "$HDC" -t "$T" shell "uitest uiInput click $cx $cy" >/dev/null 2>&1 || true
    else
      echo "❌ 没有第 $1 个 TextInput" >&2; exit 1
    fi
    ;;
  exists)
    [ $# -ge 1 ] || { echo "用法: ui.sh exists <文本>" >&2; exit 1; }
    J="$SCRATCH/ui.json"; dump_to "$J"
    if read -r cx cy txt < <(find_node "$J" "$1"); then echo "Y $txt @ ($cx,$cy)"; else echo "N"; exit 1; fi
    ;;
  wait-text)
    [ $# -ge 1 ] || { echo "用法: ui.sh wait-text <文本> [--timeout 秒]" >&2; exit 1; }
    WANT="$1"; TIMEOUT=20
    if [ "${2:-}" = "--timeout" ]; then TIMEOUT="${3:-20}"; fi
    J="$SCRATCH/ui.json"; i=0
    while [ "$i" -lt "$TIMEOUT" ]; do
      if dump_to "$J" 2>/dev/null && read -r cx cy txt < <(find_node "$J" "$WANT"); then
        echo "Y $txt @ ($cx,$cy)（等了 ${i}s）"; exit 0
      fi
      sleep 1; i=$((i+1))
    done
    echo "❌ 等了 ${TIMEOUT}s 仍未出现：$WANT" >&2; exit 1
    ;;
  text)
    [ $# -ge 1 ] || { echo "用法: ui.sh text <内容>" >&2; exit 1; }
    "$HDC" -t "$T" shell "uitest uiInput text '$1'" >/dev/null 2>&1 || true
    ;;
  key)
    "$HDC" -t "$T" shell "uitest uiInput keyEvent '${1:-Back}'" >/dev/null 2>&1 || true
    ;;
  shot)
    P="${1:-$SCRATCH/shot.jpeg}"
    "$HDC" -t "$T" shell "snapshot_display -f $DEV/ui-shot.jpeg" >/dev/null 2>&1 || true
    "$HDC" -t "$T" file recv "$DEV/ui-shot.jpeg" "$P" >/dev/null 2>&1 || true
    [ -s "$P" ] && echo "→ $P ($(wc -c <"$P" | tr -d ' ') bytes)" || { echo "❌ 截图失败" >&2; exit 1; }
    ;;
  *)
    sed -n '2,30p' "$0"; exit 1
    ;;
esac
