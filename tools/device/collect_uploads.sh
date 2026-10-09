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

echo
echo "输出目录: $OUT"
ls -la "$OUT" | head -20
