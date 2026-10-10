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
# core/*.ets 是纯 TS：直接拷成 .ts 一起编译
for f in "$ROOT"/entry/src/main/ets/core/*.ets; do
  cp "$f" "$OUT/$(basename "${f%.ets}").ts"
done
# 测试文件里用「指向真实源码」的相对路径（便于人读）；
# 拷进临时目录时把它改写成同目录的 ./xxx（core 也已拷到同目录）
for t in "$HERE"/*.test.ts; do
  sed 's#\.\./\.\./entry/src/main/ets/core/#./#g' "$t" > "$OUT/$(basename "$t")"
done

# core/ 里 http/sse/config 依赖 @kit.* ⇒ 必须带上最小 SDK stub 才能整体编译
cp "$ROOT/tools/typecheck/stubs/kits.d.ts" "$OUT/kits.d.ts"
$TSC_BIN "$OUT"/*.ts --module commonjs --target ES2021 --strict --skipLibCheck --outDir "$OUT/js"
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
for t in "$OUT"/js/*.test.js; do
  node "$t"
done
echo "✅ 纯逻辑测试通过"
