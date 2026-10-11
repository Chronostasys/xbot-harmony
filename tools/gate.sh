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

echo "===== ① 纯逻辑测试（聚合 · 跑完全部再判定）====="
# ⚠️ 用 run-all.sh（**不早退**：跑完全部测试再汇总"共 N 个，M 个失败"+ 失败明细），
#    替代原先的 run.sh（`set -e` ⇒ 第一个红就中止，多线协作时所有人都拿不到全貌）。
#    判据**不变**：任一测试红或编译失败 ⇒ 这里仍 `|| fail=1` ⇒ 步①判红。
#    `run.sh` 保留不动（其既有外部行为与调用方不受影响）。
bash "$HERE/tests/run-all.sh" || fail=1

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

# ⛔ 构建串行锁：多条线在**同一工作树**并行跑 gate 时，两个 hvigor 会互相踩，
#    症状是 `Read buffer from input error` 之类**假红**（真机/本仓实测过）。
#    用 mkdir 原子性做锁；等待有上限（超时则继续，只是可能再撞一次）。
LOCK="${TMPDIR:-/tmp}/xbot-gate-build.lock"
waited=0
while ! mkdir "$LOCK" 2>/dev/null; do
  if [ "$waited" -ge 300 ]; then
    echo "⚠ 等待构建锁超时（>300s），继续（可能与并发构建冲突）"
    break
  fi
  [ "$waited" -eq 0 ] && echo "⏳ 另一条线正在构建，等待锁…"
  sleep 2
  waited=$((waited + 2))
done
# 无论怎么退出都要释放锁（含 Ctrl-C / 编译失败）
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM

LOG="$(mktemp -t xbot-gate.XXXXXX)"
build_once() {
  hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon >"$LOG" 2>&1
}

# ⛔ 强制**真实**编译（否则门禁本身就是假绿制造机）。
#    hvigor 增量在"无变更"时只打 `BUILD SUCCESSFUL in 1 s 145 ms`（本仓 2026-10-11 实测）
#    —— 那一步**没有做 ArkTS 类型检查**，等于把 ④ 变成了空转。`touch -c` 只改 mtime
#    （不加 `-c` 会把已删除的文件复活成 0 字节幽灵），强制 entry 编译图整体重编。
touch -c "$ROOT/entry/src/main/ets/pages/Index.ets" 2>/dev/null || true

ok=0
build_once && ok=1
if [ "$ok" -eq 0 ] && grep -qE "Read buffer from input error|input error" "$LOG"; then
  # 瞬时/并发类错误：**重试一次**（这类假红重跑即绿，重试能省掉一整轮误判）
  echo "⚠ 检测到疑似并发/瞬时构建错误，重试一次…"
  sleep 3
  build_once && ok=1
fi

if [ "$ok" -eq 1 ]; then
  grep -E "BUILD SUCCESSFUL" "$LOG" | tail -1
else
  echo "❌ ArkTS 编译失败："
  grep -E "ArkTS Compiler Error|Error Message|BUILD FAILED|input error" "$LOG" | head -20
  fail=1
fi
rm -f "$LOG"
rmdir "$LOCK" 2>/dev/null
trap - EXIT INT TERM

echo "===== ⑤ 孤儿组件（警告级，不影响退出码）====="
bash "$HERE/lint/orphan-components.sh" || true

# ⚠️ 警告级：判据单一性（ForEach key 含状态字段 / 同一文件 ≥2 段状态→颜色映射）。
#    为什么暂不设硬性：现在有**真实命中**（4 处），立刻转硬会红掉在飞的多条线 —— 那是
#    "让门禁挡路"，不是"让缺陷自动红"。升级条件（命中清零 / 全部进带理由的允许清单）
#    写在 tools/lint/criteria-single-source.sh 的脚本头，达到后把这里的 `|| true` 去掉即可。
echo "===== ⑥ 判据单一性（警告级，不影响退出码）====="
bash "$HERE/lint/criteria-single-source.sh" || true

echo
if [ "$fail" -ne 0 ]; then
  echo "❌ 真门禁**未通过**（见上方红灯）"
  exit 1
fi
echo "✅ 真门禁全绿（离线三条 + ArkTS 编译）"
