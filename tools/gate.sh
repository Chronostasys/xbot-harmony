#!/usr/bin/env bash
# ⭐ 真门禁：离线三条脚本 + **ArkTS 编译**。
#
# 为什么必须包含第 ④ 步：`tools/tests/run.sh` 只把 `core/**` 当**纯 TS** 编译，
# `tools/lint/render-path.sh` / `tools/typecheck/check.sh` 也不碰 ArkUI 组件与页面。
# ⇒ **组件/页面的 ArkTS 严格性与类型错误，这三条脚本一个都抓不到**（2026-10-11 实测：
#   `components/ContextRing.ets` 里 `Stack.justifyContent` 让整树编译失败，而三条脚本全绿）。
# 唯一判据是 `hvigorw assembleHap` 输出 `BUILD SUCCESSFUL`。
#
# 用法：bash tools/gate.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

fail=0

echo "===== ① 纯逻辑测试 ====="
bash "$HERE/tests/run.sh" || fail=1

echo "===== ② 渲染路径门禁 ====="
bash "$HERE/lint/render-path.sh" || fail=1

echo "===== ③ core/ 静态检查 ====="
bash "$HERE/typecheck/check.sh" || fail=1

echo "===== ④ ArkTS 编译（唯一能抓 ArkTS 错误的判据）====="
if [ -f "$HOME/ohos-cli/env.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/ohos-cli/env.sh" >/dev/null 2>&1 || true
fi
cd "$ROOT"
LOG="$(mktemp -t xbot-gate.XXXXXX)"
if hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon >"$LOG" 2>&1; then
  grep -E "BUILD SUCCESSFUL" "$LOG" | tail -1
else
  echo "❌ ArkTS 编译失败："
  grep -E "ArkTS Compiler Error|Error Message|BUILD FAILED" "$LOG" | head -20
  fail=1
fi
rm -f "$LOG"

echo "===== ⑤ 孤儿组件（警告级，不影响退出码）====="
bash "$HERE/lint/orphan-components.sh" || true

echo
if [ "$fail" -ne 0 ]; then
  echo "❌ 真门禁**未通过**（见上方红灯）"
  exit 1
fi
echo "✅ 真门禁全绿（离线三条 + ArkTS 编译）"
