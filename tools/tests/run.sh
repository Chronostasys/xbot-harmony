#!/usr/bin/env bash
# 跑纯逻辑测试（无需鸿蒙 SDK）：把 .ets 当 TS 编译后用 node 执行。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# ⚠️ 目录名带 PID：多条线（subagent）并发跑本套件时，共享目录会互相 `rm -rf`
# ⇒ 假绿/假红（A 的产物被 B 清掉，报出与源码无关的错）。各跑各的目录，彻底解耦。
OUT="$HERE/.out.$$"

# 每次先清空产物目录：否则源码删除/改名后，过期产物会以假错误误导（2026-10 踩到）
rm -rf "$OUT"
# 退出（含失败）时清理本进程目录，不留垃圾
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

rm -f "$OUT"/*.js 2>/dev/null || true
mkdir -p "$OUT"
# core/* 是纯 TS：状态机端口件（reduce/derive/integrate/normalize/agent_normalize/
# progress_types/chat_types_full）以 .ts 形式存在（走 TS 语义，不受 ArkTS 严格规则约束）；
# 其余为 .ets。两者都拷进临时目录一起编译。
for f in "$ROOT"/entry/src/main/ets/core/*.ets "$ROOT"/entry/src/main/ets/core/*.ts; do
  [ -f "$f" ] || continue
  b="$(basename "$f")"
  case "$b" in
    *.ets) cp "$f" "$OUT/${b%.ets}.ts" ;;
    *.ts)  cp "$f" "$OUT/$b" ;;
  esac
done
# 测试文件里用「指向真实源码」的相对路径（便于人读）；
# 拷进临时目录时把它改写成同目录的 ./xxx（core 也已拷到同目录）
for t in "$HERE"/*.test.ts; do
  sed 's#\.\./\.\./entry/src/main/ets/core/#./#g' "$t" > "$OUT/$(basename "$t")"
done
# 非测试的 TS 辅助件（vitest 垫片等）—— 移植的 web 测试 `import … from './vitest_shim'`，
# 必须一起拷进临时目录，否则 tsc 解析不到（TS2307）。
for h in "$HERE"/*.ts; do
  case "$(basename "$h")" in
    *.test.ts) ;;
    *) cp "$h" "$OUT/$(basename "$h")" ;;
  esac
done

# core/ 里 http/sse/config 依赖 @kit.* ⇒ 必须带上最小 SDK stub 才能整体编译
# 全部 stub（kits + ArkUI 装饰器声明）都要带上，否则 core/*.ets 当纯 TS 编译会报未定义
cp "$ROOT/tools/typecheck/stubs/"*.d.ts "$OUT/"
$TSC_BIN "$OUT"/*.ts --module commonjs --target ES2021 --strict --skipLibCheck --experimentalDecorators --outDir "$OUT/js"
# 把 @kit.* 的 Node 实现装进编译产物目录，让 core/ 里的 SDK 调用在 Linux 上"真跑"
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
# noties_prism4j 是 bytecode HAR（真机才跑得起来）；脱机构建/运行时给它一个 stub 实现，
# 让 core/highlight.ets 能被单测覆盖其**退化路径**（衡量标准见 mocks/prism4j.js 注释）。
mkdir -p "$OUT/js/node_modules/@hxa-atpc/noties_prism4j"
cp "$HERE/mocks/prism4j.js" "$OUT/js/node_modules/@hxa-atpc/noties_prism4j/index.js"
cat > "$OUT/js/node_modules/@hxa-atpc/noties_prism4j/package.json" <<'PKG3'
{ "name": "@hxa-atpc/noties_prism4j", "version": "0.0.0", "main": "index.js" }
PKG3
# 通知/短时任务 SDK（core/notify.ets 在**模块顶层** import；任何 `import store` 的单测
# 都会 require 它们）—— 脱机给"能被 require 且不抛"的最小实现，否则整批测试 MODULE_NOT_FOUND。
# 同一份实现按三个模块名各装一份：三者都只用 default 导出（tsc commonjs 语义）。
install_notify_sdk() {
  local name="$1"
  mkdir -p "$OUT/js/node_modules/$name"
  cp "$HERE/mocks/notify_sdk.js" "$OUT/js/node_modules/$name/index.js"
  printf '{ "name": "%s", "version": "0.0.0", "main": "index.js" }\n' "$name" \
    > "$OUT/js/node_modules/$name/package.json"
}
install_notify_sdk '@ohos.notificationManager'
install_notify_sdk '@ohos.app.ability.wantAgent'
install_notify_sdk '@ohos.resourceschedule.backgroundTaskManager'
# 装饰器运行期垫片：编译期由 stubs/*.d.ts 解决，运行期需要真实存在（见 mocks/decorators.js）
cp "$HERE/mocks/decorators.js" "$OUT/js/__decorators.js"
for t in "$OUT"/js/*.test.js; do
  node -r "$OUT/js/__decorators.js" "$t"
done
echo "✅ 纯逻辑测试通过"
