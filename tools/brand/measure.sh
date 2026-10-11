#!/usr/bin/env bash
# 品牌交付的**可复现测量命令** —— 一次跑出安全区/对比度的实测数字（纯读数，不改任何文件）。
#
# 用途：交付里"实测数字 + 测量命令"的**命令**部分。数字全部来自 `core/brand.ets`（唯一真源）
#       与已提交资源，二者同源 ⇒ 断言（tools/tests/brand.test.ts §⑦-⑩）与这里读数一致。
#
# 用法：bash tools/brand/measure.sh
# 依赖：仓库同机的 tsc（同 gen.sh）+ macOS `sips` + python3（tools/brand/png_probe.py）。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CORE="$ROOT/entry/src/main/ets/core"
MEDIA="$ROOT/entry/src/main/resources/base/media"

find_tsc() {
  if [ -n "${TSC:-}" ] && [ -x "$TSC" ]; then echo "$TSC"; return; fi
  if command -v tsc >/dev/null 2>&1; then command -v tsc; return; fi
  for p in "$ROOT/../xbot/web/node_modules/.bin/tsc" "$HOME/src/xbot/web/node_modules/.bin/tsc"; do
    if [ -x "$p" ]; then echo "$p"; return; fi
  done
  echo "npx --yes -p typescript@5 tsc"
}
TSC_BIN="$(find_tsc)"

WORK="$(mktemp -d -t xbot-brand-measure.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
cp "$CORE/brand.ets" "$WORK/brand.ts"
cp "$CORE/theme.ets" "$WORK/theme.ts"
$TSC_BIN "$WORK/brand.ts" "$WORK/theme.ts" --module commonjs --target ES2021 --strict \
  --skipLibCheck --outDir "$WORK/js" >/dev/null

echo "== 安全区（半径；画布 1024 的几何真值）=="
node -e '
const b=require(process.argv[1]+"/brand.js");
const f=(x)=>x.toFixed(4);
console.log("  markMaxRadius              =", f(b.markMaxRadius()), " (圆形/方/圆角蒙版安全:", b.fitsInscribedCircle(), "; < 512)");
console.log("  outlineMaxRadius           =", f(b.outlineMaxRadius()), " (<=410 建议最大半径:", b.outlineMaxRadius()<=b.SUGGESTED_MAX_RADIUS, ")");
console.log("  layeredForegroundScale     =", f(b.layeredForegroundScale()));
console.log("  foregroundMarkMaxRadius    =", f(b.foregroundMarkMaxRadius()), " (<=313 分层安全区:", b.foregroundFitsLayeredSafeZone(), ")");
' "$WORK/js"

echo "== 对比度（WCAG 2.1）=="
node -e '
const b=require(process.argv[1]+"/brand.js"), t=require(process.argv[1]+"/theme.js");
const A=b.brandAccent(), ON=b.brandOnAccent();
const lb=t.lightPalette().appBg, db=t.darkPalette().appBg, pc=t.porcelainPalette().appBg;
const f=(x)=>x.toFixed(4);
console.log("  accent(#"+A.slice(1)+") vs light(#"+lb.slice(1)+")   =", f(b.contrastRatio(A,lb)), "(>=3 图形)");
console.log("  accent vs dark(#"+db.slice(1)+")    =", f(b.contrastRatio(A,db)), "(>=3)");
console.log("  onAccent vs accent            =", f(b.contrastRatio(ON,A)), "(>=3 图形; <4.5 AA 正文 = 已知未决)");
console.log("  accent vs porcelain(#FFFFFF)  =", f(b.contrastRatio(A,pc)), "(>=3)");
' "$WORK/js"

echo "== 降级链（markLevelFor 真值）=="
node -e '
const b=require(process.argv[1]+"/brand.js"), t=require(process.argv[1]+"/theme.js");
const A=b.brandAccent(), ON=b.brandOnAccent();
const lb=t.lightPalette().appBg;
console.log("  深色面 (dark, ratio ", b.contrastRatio(ON,A).toFixed(2), ") =>", b.markLevelFor(new b.BrandSurface(true,false,512,b.contrastRatio(ON,A))));
console.log("  浅色面 (light,ratio ", b.contrastRatio(A,lb).toFixed(2), ") =>", b.markLevelFor(new b.BrandSurface(false,false,512,b.contrastRatio(A,lb))));
console.log("  单色/无障碍            =>", b.markLevelFor(new b.BrandSurface(false,true,512,b.contrastRatio(A,lb))));
console.log("  边长 20vp (<24)        =>", b.markLevelFor(new b.BrandSurface(true,false,20,b.contrastRatio(ON,A))));
' "$WORK/js"

echo "== 像素核验（栅格化后逐像素；profile of start_icon + outline）=="
sips -s format png "$MEDIA/brand_mark_outline.svg" --out "$WORK/outline.png" >/dev/null 2>&1
python3 "$HERE/png_probe.py" "$MEDIA/start_icon.png" | head -2
python3 "$HERE/png_probe.py" "$WORK/outline.png" | head -2
echo "   （outline 中心 px 应透明=内部零填充；非透明 bbox 半径 ≈ 407.9/1024×512 = 204）"
