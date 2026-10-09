#!/usr/bin/env bash
# 收集 App「走查」上传回来的页面截图，并按走查顺序推断页名。
#
# 背景：App 通过 /api/files/upload 上传自检截图（本地存储 → ~/.xbot/uploads/uploads/<uid>/<uuid>.png）。
# UUID 文件名不含页名，但**上传顺序 = 走查顺序**是固定的，据此推断：
#   01-chat → 02-drawer → 03-settings → 04-selfcheck → 05-queue → 06-plugins → 07-chat-back
#
# 用法：tools/device/collect_uploads.sh [since_epoch] [outdir]
#   since_epoch 默认取 /tmp/audit_mark（由监听任务写入）；不传则取"最近 5 分钟"。
set -euo pipefail

SINCE="${1:-$(cat /tmp/audit_mark 2>/dev/null || echo $(( $(date +%s) - 300 )))}"
OUT="${2:-/tmp/xbot-shots}"
UP="${UPLOADS_DIR:-/home/smith/.xbot/uploads/uploads}"

mkdir -p "$OUT"
rm -f "$OUT"/*.png 2>/dev/null || true

mapfile -t FILES < <(find "$UP" -type f -newermt "@$SINCE" -printf "%T@ %p\n" 2>/dev/null | sort -n | awk '{print $2}')
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "没有在 $UP 找到 $SINCE 之后的新上传（App 走查还没跑？）"
  exit 1
fi

NAMES=(01-chat 02-drawer 03-settings 04-selfcheck 05-queue 06-plugins 07-chat-back 08-extra 09-extra 10-extra)
i=0
for f in "${FILES[@]}"; do
  name="${NAMES[$i]:-page-$i}"
  # 只收 PNG（走查上传的都是 PNG）
  if head -c 4 "$f" | grep -q $'\x89PNG' 2>/dev/null; then
    cp -f "$f" "$OUT/$name.png"
    convert "$OUT/$name.png" -resize 45% "$OUT/${name}_view.png" 2>/dev/null || true
    printf '  %-12s <- %s (%s bytes)\n' "$name" "$(basename "$f")" "$(stat -c%s "$f")"
  else
    printf '  (跳过非 PNG: %s)\n' "$f"
  fi
  i=$((i+1))
done

# 版面几何文本（走查最后上传的 audit-layout.txt）——直接打印，便于判读
echo
for f in $(find "$UP" -type f -newermt "@$SINCE" ! -name '*.png' 2>/dev/null | head -3); do
  if head -c 64 "$f" | grep -qiE "screen=|xbot-root"; then
    cp -f "$f" "$OUT/audit-layout.txt"
    echo "===== audit-layout.txt（版面几何）====="
    cat "$OUT/audit-layout.txt"
    echo "======================================"
  fi
done

# 自动判读几何（对照 docs/UI-AUDIT-CHECKLIST.md 的基线）
if [ -f "$OUT/audit-layout.txt" ]; then
  echo
  echo "===== 几何自动判读 ====="
  python3 - "$OUT/audit-layout.txt" <<'PY'
import re, sys
txt = open(sys.argv[1], encoding='utf-8', errors='replace').read()
screen = None
m = re.search(r'screen=(\d+)x(\d+)', txt)
if m:
    screen = (int(m.group(1)), int(m.group(2)))
print('屏幕:', screen)
issues = []
for page in re.split(r'---\s*([^\-]+)\s*---', txt)[1:]:
    pass
blocks = re.split(r'---\s*([A-Za-z0-9\-]+)\s*---', txt)[1:]
for i in range(0, len(blocks) - 1, 2):
    page, body = blocks[i], blocks[i + 1]
    geo = {}
    for line in body.splitlines():
        mm = re.match(r'\s*(\S+):\s*x=(-?\d+)\s+y=(-?\d+)\s+w=(-?\d+)\s+h=(-?\d+)', line)
        if mm:
            geo[mm.group(1)] = tuple(int(mm.group(k)) for k in range(2, 6))
        elif line.strip().endswith(': absent'):
            geo[line.split(':')[0].strip()] = None
    def chk(name, cond, msg):
        if not cond:
            issues.append(f'[{page}] {name}: {msg}')
    root = geo.get('xbot-root')
    chk('xbot-root', root is not None and root[2] > 0 and root[3] > 0, f'尺寸异常 {root}')
    hdr = geo.get('xbot-header')
    if page.startswith('01') or page.startswith('07'):
        chk('xbot-header', hdr is not None and 40 <= hdr[3] <= 80, f'顶栏高度异常 {hdr}')
        lst = geo.get('xbot-list')
        chk('xbot-list', lst is not None and lst[3] > 200, f'列表高度异常（空白/错乱根因）{lst}')
        comp = geo.get('xbot-composer')
        chk('xbot-composer', comp is not None and comp[3] > 0, f'输入区高度异常 {comp}')
        if screen and comp is not None:
            chk('xbot-composer', comp[1] + comp[3] <= screen[1] + 8, f'输入区跑到屏幕外 {comp}')
    if page.startswith('02'):
        chk('xbot-drawer', geo.get('xbot-drawer') is not None, '抽屉未出现')
    if page.startswith('04'):
        chk('xbot-selfcheck', geo.get('xbot-selfcheck') is not None, '自检页未出现')
    if screen:
        for name, g in geo.items():
            if g is None:
                continue
            x, y, w, h = g
            if y < -4 or y > screen[1] or x < -4 or x > screen[0]:
                issues.append(f'[{page}] {name}: 位置在屏幕外 {g}')
print('判读结论:', '无异常 ✅' if not issues else f'{len(issues)} 处异常')
for i in issues:
    print('  ✗', i)
PY
fi

echo
echo "输出目录: $OUT"
ls -la "$OUT" | head -20
