#!/usr/bin/env bash
# tools/perf/coldstart.sh —— 冷启动耗时采集（**只读 / 被动**）。
#
# ⛔ 本脚本**绝不** force-stop / 重装 / 切走用户会话：那是用户正在用的设备。
#    做法是**被动监听 hilog**，等一次**自然发生的**冷启动（例如另一条线装包后重启、
#    或用户自己重进应用），然后量它。
#
# 口径（替代指标 —— 真机没有"首帧"的应用侧日志，故用两个可采的锚点）：
#   t1 = `EntryAbility onCreate`            （进程拉起后首个应用日志）
#   t2 = `loadContent succeeded`            （UIAbility.loadContent 返回 ⇒ 页面树已提交）
#   ⇒ **onCreate→loadContent = 启动骨架耗时**（不含首帧绘制；见 docs/PERF-BUDGET.md §1 的局限说明）
#
# 用法：
#   TARGET=127.0.0.1:5555 bash tools/perf/coldstart.sh            # 监听 20s
#   TARGET=127.0.0.1:5555 bash tools/perf/coldstart.sh 60         # 监听 60s
set -uo pipefail
if [ -z "${OHOS_SDK:-}" ] && [ -f "$HOME/ohos-cli/env.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/ohos-cli/env.sh" >/dev/null 2>&1 || true
fi
HDC="${HDC:-$(command -v hdc 2>/dev/null || true)}"
[ -n "$HDC" ] || { echo "❌ 找不到 hdc" >&2; exit 1; }
T="${TARGET:-$("$HDC" list targets 2>/dev/null | tr -d '\r' | grep ':' | head -1)}"
[ -n "$T" ] || { echo "❌ 没有设备" >&2; exit 2; }
WINDOW="${1:-20}"
LOG="${TMPDIR:-/tmp}/xbot-coldstart.log"

echo "⏳ 被动监听 hilog ${WINDOW}s（**不** force-stop；等一次自然冷启动）…"
# hdc 的输出在 host 侧；用子 shell + kill 保证按时收工（不依赖设备的 timeout 命令）
( "$HDC" -t "$T" shell "hilog -x" > "$LOG" 2>/dev/null & echo $! > "${LOG}.pid" ) 
CPID="$(cat "${LOG}.pid" 2>/dev/null || true)"
sleep "$WINDOW"
[ -n "$CPID" ] && kill "$CPID" 2>/dev/null || true
pkill -f "hdc -t $T shell hilog -x" 2>/dev/null || true

python3 - "$LOG" <<'PY'
import re, sys
lines = open(sys.argv[1], encoding='utf-8', errors='replace').read().splitlines()
pat_on = re.compile(r'^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+\d+\s+\d+\s+\w+\s+\S+/xbot:\s+EntryAbility onCreate')
pat_ok = re.compile(r'^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+\d+\s+\d+\s+\w+\s+\S+/xbot:\s+loadContent succeeded')
ons  = [m.group(1) for m in (pat_on.match(l) for l in lines) if m]
oks  = [m.group(1) for m in (pat_ok.match(l) for l in lines) if m]
print(f"捕获到 onCreate={len(ons)} 次，loadContent succeeded={len(oks)} 次")
if not ons or not oks:
    print("⇒ 窗口内没有冷启动（正常：脚本刻意不 force-stop）。")
    print("   要采一次：等另一条线装包/或用户重进应用时再跑；或见 docs/PERF-BUDGET.md §1 的已采样本。")
    sys.exit(0)

def to_ms(s):
    # s 形如 "10-11 10:23:45.678"（hilog 带日期）⇒ 先剥掉日期段
    if ' ' in s:
        s = s.split(' ', 1)[1]
    h, m, rest = s.split(':')
    sec, ms = rest.split('.')
    return ((int(h) * 60 + int(m)) * 60 + int(sec)) * 1000 + int(ms)

# 取**每一对**（onCreate 之后的第一个 loadContent succeeded）
for i, on in enumerate(ons[:5]):
    t0 = to_ms(on)
    after = [o for o in oks if to_ms(o) >= t0]
    if after:
        print(f"  样本 {i+1}: onCreate={on} → loadContent succeeded={after[0]}"
              f"  ⇒ **{to_ms(after[0]) - t0} ms**")
PY
echo "（原始日志：${LOG}）"
