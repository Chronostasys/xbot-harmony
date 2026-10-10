#!/usr/bin/env bash
# 跑纯逻辑测试（无需鸿蒙 SDK）：把 .ets 当 TS 编译后用 node 执行。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/.out"

# 每次先清空产物目录：否则源码删除/改名后，过期产物会以假错误误导（2026-10 踩到）
rm -rf "$OUT"

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
# 装饰器运行期垫片：编译期由 stubs/*.d.ts 解决，运行期需要真实存在（见 mocks/decorators.js）
cp "$HERE/mocks/decorators.js" "$OUT/js/__decorators.js"
for t in "$OUT"/js/*.test.js; do
  node -r "$OUT/js/__decorators.js" "$t"
done
echo "✅ 纯逻辑测试通过"
