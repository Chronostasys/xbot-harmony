#!/usr/bin/env bash
# 渲染路径门禁：ArkUI 组件/页面里禁止直接调用 parseMarkdown()/parseInline()。
#
# 为什么：ArkUI 的 ForEach **不比较内容**（key 不变就不重建），所以行级 key 必须带 rev
# ⇒ 数据一变就**整行重建** ⇒ 组件每次渲染都会重跑 build() 里的解析。实测单行正文可达 274 KB
# （单 turn 108 个迭代块）⇒ 流式期间每个 SSE 事件重解析几百 KB ⇒ 卡到完全没法用。
# 因此渲染路径只能调**带缓存**的版本（键=原文本身 ⇒ 无碰撞、无陈旧，见 core/markdown.ets）。
#
# 用法：tools/lint/render-path.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TARGETS=("$ROOT/entry/src/main/ets/components" "$ROOT/entry/src/main/ets/pages")

bad=0
for dir in "${TARGETS[@]}"; do
  [ -d "$dir" ] || continue
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    bad=1
    echo "  ✗ $hit"
  done < <(grep -rnE '(^|[^A-Za-z0-9_.])(parseMarkdown|parseInline)\(' "$dir" --include='*.ets' 2>/dev/null \
            | grep -vE ':[0-9]+: *(\*|//)' || true)
done

if [ "$bad" -ne 0 ]; then
  echo
  echo "❌ 渲染路径里出现了未缓存的 Markdown 解析调用。"
  echo "   改用 core/markdown.ets 的 parseMarkdownCached() / parseInlineCached()。"
  echo "   （原因：ArkUI 数据一变整行重建 ⇒ 每次渲染都重解析，长会话会卡死。见 docs/ARKTS-GOTCHAS.md 第 11 条）"
  exit 1
fi
echo "✅ 渲染路径门禁通过（components/ 与 pages/ 无裸解析调用）"
