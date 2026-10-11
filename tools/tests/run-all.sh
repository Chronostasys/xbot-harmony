#!/usr/bin/env bash
# 全量单测（**聚合、不早退**）—— `tools/gate.sh` 第 ① 步调用的执行器。
#
# 为什么要有它（当前最大的协作摩擦）：
#   `tools/tests/run.sh` 用 `set -e` 顺序执行 ⇒ **遇到第一个红测试就整体中止**。多条线同改一个
#   工作树时，只要**任何一条线**的在途改动让某个测试红，**所有线**都拿不到自己的判定与全貌，
#   也无法区分"是谁的红"。
#
# 目标语义（**判据不变，只是变全量**）：
#   · PASS/FAIL 语义**完全不变** —— 只要有任一测试红（或 tsc 编译失败）⇒ 退出码非 0（仍判红，
#     ⛔ 绝不因"聚合"而变宽容）；
#   · 不再早退 —— 把所有测试**跑完**，最后汇总：`共 N 个测试文件，M 个失败`，并逐条列出
#     **失败测试名 + 失败断言行**；
#   · **编译失败（tsc 层）与断言失败分开归类**，编译失败打印错误尾部（对"谁是罪魁"最关键）。
#
# ⚠️ 编译环境与 `run.sh` **逐项等价**（core/*.ets⇒.ts + core/*.ts + 全部测试 + 非测试辅助件 +
#    stubs + sed 路径改写 + @kit.*/prism4j/notify mock + 同款 find_tsc）⇒ 判定可信。
# ⛔ 本脚本**不改** `run.sh`（它的既有外部行为不变；共享套件仍是最终判据）。
set -uo pipefail  # ⛔ 刻意**不用** -e：本脚本的职责就是"跑完全部再汇总"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/.out-all.$$"

rm -rf "$OUT"
trap 'rm -rf "$OUT"' EXIT

find_tsc() {
  if [ -n "${TSC:-}" ] && [ -x "$TSC" ]; then echo "$TSC"; return; fi
  if command -v tsc >/dev/null 2>&1; then command -v tsc; return; fi
  for p in "$ROOT/../xbot/web/node_modules/.bin/tsc" "$HOME/src/xbot/web/node_modules/.bin/tsc"; do
    if [ -x "$p" ]; then echo "$p"; return; fi
  done
  echo "npx --yes -p typescript@5 tsc"
}
TSC_BIN="$(find_tsc)"

# ── 编译环境（与 run.sh 逐项相同）────────────────────────────────────────────
mkdir -p "$OUT"
for f in "$ROOT"/entry/src/main/ets/core/*.ets "$ROOT"/entry/src/main/ets/core/*.ts; do
  [ -f "$f" ] || continue
  b="$(basename "$f")"
  case "$b" in
    *.ets) cp "$f" "$OUT/${b%.ets}.ts" ;;
    *.ts)  cp "$f" "$OUT/$b" ;;
  esac
done
for t in "$HERE"/*.test.ts; do
  [ -f "$t" ] || continue
  sed 's#\.\./\.\./entry/src/main/ets/core/#./#g' "$t" > "$OUT/$(basename "$t")"
done
for h in "$HERE"/*.ts; do
  case "$(basename "$h")" in
    *.test.ts) ;;
    *) cp "$h" "$OUT/$(basename "$h")" ;;
  esac
done
cp "$ROOT/tools/typecheck/stubs/"*.d.ts "$OUT/"

# ── 编译一次（失败 ⇒ 归为「编译失败」，打印尾部，退出非 0）────────────────────
TSC_LOG="$(mktemp -t xbot-run-all-tsc.XXXXXX)"
if ! $TSC_BIN "$OUT"/*.ts --module commonjs --target ES2021 --strict --skipLibCheck --experimentalDecorators --outDir "$OUT/js" >"$TSC_LOG" 2>&1; then
  echo "══ 纯逻辑测试（聚合）══"
  echo "❌ 归类：**编译失败**（tsc 非 0）—— 断言层未执行"
  echo "   错误尾部："
  tail -30 "$TSC_LOG" | sed 's/^/     /'
  rm -f "$TSC_LOG"
  echo ""
  echo "共 0 个测试文件，0 个失败（但**编译失败** ⇒ 判红）"
  exit 1
fi
rm -f "$TSC_LOG"

# ── 装 mock（与 run.sh 逐项相同）─────────────────────────────────────────────
mkdir -p "$OUT/js/node_modules/@kit.NetworkKit"
cp "$HERE/mocks/NetworkKit.js" "$OUT/js/node_modules/@kit.NetworkKit/index.js"
mkdir -p "$OUT/js/node_modules/@kit.ArkTS"
cp "$HERE/mocks/ArkTS.js" "$OUT/js/node_modules/@kit.ArkTS/index.js"
cat > "$OUT/js/node_modules/@kit.ArkTS/package.json" <<'PKG2'
{ "name": "@kit.ArkTS", "version": "0.0.0", "main": "index.js" }
PKG2
cat > "$OUT/js/node_modules/@kit.NetworkKit/package.json" <<'PKG'
{ "name": "@kit.NetworkKit", "version": "0.0.0", "main": "index.js" }
PKG
mkdir -p "$OUT/js/node_modules/@hxa-atpc/noties_prism4j"
cp "$HERE/mocks/prism4j.js" "$OUT/js/node_modules/@hxa-atpc/noties_prism4j/index.js"
cat > "$OUT/js/node_modules/@hxa-atpc/noties_prism4j/package.json" <<'PKG3'
{ "name": "@hxa-atpc/noties_prism4j", "version": "0.0.0", "main": "index.js" }
PKG3
install_notify_sdk() {
  local name="$1"
  mkdir -p "$OUT/js/node_modules/${name}"
  cp "$HERE/mocks/notify_sdk.js" "$OUT/js/node_modules/${name}/index.js"
  printf '{ "name": "%s", "version": "0.0.0", "main": "index.js" }\n' "${name}" \
    > "$OUT/js/node_modules/${name}/package.json"
}
install_notify_sdk '@ohos.notificationManager'
install_notify_sdk '@ohos.app.ability.wantAgent'
install_notify_sdk '@ohos.resourceschedule.backgroundTaskManager'
cp "$HERE/mocks/decorators.js" "$OUT/js/__decorators.js"

# ── 跑**全部**测试，边跑边汇总（不早退）──────────────────────────────────────
total=0
failed=0
failed_names=()
FAIL_DETAIL="$(mktemp -t xbot-run-all-fail.XXXXXX)"

echo "══ 纯逻辑测试（聚合 · 跑完全部）══"
for t in "$OUT"/js/*.test.js; do
  [ -f "$t" ] || continue
  total=$((total + 1))
  b="$(basename "$t" .test.js)"
  out="$(node -r "$OUT/js/__decorators.js" "$t" 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    # 通过的测试：原样打印它的自述（与 run.sh 的可读性对齐）
    printf '%s\n' "${out}"
  else
    failed=$((failed + 1))
    failed_names+=("${b}")
    printf '❌ %s（exit %s）\n' "${b}" "${rc}"
    printf '%s\n' "${out}" | tail -8 | sed 's/^/     /'
    # 汇总明细：测试名 + 失败断言行（`✗` 开头）或错误行
    {
      printf '── %s（exit %s）──\n' "${b}" "${rc}"
      hits="$(printf '%s\n' "${out}" | grep -E '✗|Error|error:|AssertionError' | head -12)"
      if [ -n "${hits}" ]; then
        printf '%s\n' "${hits}" | sed 's/^/   /'
      else
        printf '%s\n' "${out}" | tail -6 | sed 's/^/   /'
      fi
    } >> "$FAIL_DETAIL"
  fi
done

# ── 汇总 ────────────────────────────────────────────────────────────────────
echo ""
echo "════════ 聚合结果 ════════"
if [ "${failed}" -eq 0 ]; then
  echo "✅ 共 ${total} 个测试文件，0 个失败"
  rm -f "$FAIL_DETAIL"
  exit 0
fi
echo "❌ 共 ${total} 个测试文件，${failed} 个失败"
echo "   失败测试：${failed_names[*]}"
echo "-------- 失败明细（谁的红）--------"
cat "$FAIL_DETAIL"
rm -f "$FAIL_DETAIL"
exit 1
