#!/usr/bin/env bash
# Linux Previewer 自验（零 GPU：Xvfb + Mesa llvmpipe 软件渲染）
#
# 逐个踩过的坑（全部有源码/日志证据）：
#  1) `-lws` 是 **WebSocket 监听端口号**，不是分辨率 —— 传 `4000x` 会 `Launch -lws parameters is not match regex`
#     => `Start args is invalid` => 进程直接退出（引擎根本没起来）。hvigor 内置样例：`'-lws', portNum`。
#  2) `-j` = app path，且该目录**名里要含 `.abc`**、且**该目录直接放着 modules.abc**
#     （ark 的 RS asset provider 在 `-j` 根目录找 modules.abc，不在 ets/ 子目录找）；
#     `-arp` = 含 resources.index 的目录；`-ljPath` = `<...>/loader.json`（**没有**多一层 loader/）。
#  3) `-url` 必须用**限定名** `com.<bundle>/pages/Index`（用 `pages/Index` 会
#     `Cannot find module 'com.../pages/Index'` => `failed to create page in LoadPage`）。
#  4) FATAL 真因（源码级）：`JSNApi::SetAssetPath` 在 Linux 上走
#     `ModulePathHelper::ValidateAbcPath`（要求以 `/data/storage/el1/bundle/` 开头且含 `.abc`），
#     失败即 LOG_FULL(FATAL)；而该校验被 `#if !PANIC_WINDOWS && !MACOS` 排除在 Win/Mac 之外
#     —— 这就是「Mac 能预览、Linux 一跑就 FATAL」的根因。
#     绕过：把 previewer 目录**拷到 /tmp**，改 `libark_jsruntime.so` 里那 25 字节常量；
#     **SDK 本体不动**。
#  5) 仍需 `/tmp/zvlib/libshared_libz.so`（SDK 缺这个库名）+ Xvfb + 软件 GL。
#
# 未打通的最后一环（诚实记录）：帧经**本地 socket** 送给 IDE（`-s`/`-ts`），无 IDE 时不 present
# => `import -window root` 只有空白窗口；eglSwapBuffers/glXSwapBuffers/glFinish/glDrawArrays 的
# LD_PRELOAD 钩子命中 0 次。=> UI 走查当前以真机「走查并上传」为准。
set -u
CLI=${CLI:-/home/smith/ohos-cli/command-line-tools}
SRC="$CLI/sdk/default/openharmony/previewer/common/bin"
PREFIX=/tmp/xbot_preview_bundle
BINS=/tmp/pvbins
PROJ=$(cd "$(dirname "$0")/../.." && pwd)
PORT=${PORT:-40021}
XDISP=${XDISP:-77}

mkdir -p /tmp/zvlib /tmp/pvlibs
[ -e /tmp/zvlib/libshared_libz.so ] || ln -sf /usr/lib/x86_64-linux-gnu/libz.so.1 /tmp/zvlib/libshared_libz.so
[ -e /tmp/pvlibs/libhilog.so ] || ln -sf "$CLI/sdk/default/hms/toolchains/lib/libhilog.so" /tmp/pvlibs/libhilog.so

echo "== 1/4 拷贝 previewer 到 $BINS 并打 SetAssetPath 常量补丁（不动 SDK）=="
mkdir -p "$BINS"; cp -r "$SRC/." "$BINS/"
python3 - "$BINS/libark_jsruntime.so" "$PREFIX/" <<'PY'
import sys
so, new = sys.argv[1], sys.argv[2]
OLD = b"/data/storage/el1/bundle/"
NEW = new.encode()
assert len(OLD) == len(NEW) == 25, (len(OLD), len(NEW))
d = open(so, 'rb').read(); n = d.count(OLD)
print('  常量出现次数:', n)
if n == 1 and NEW not in d:
    open(so, 'r+b').write(d.replace(OLD, NEW)); print('  已打补丁 ->', new)
elif NEW in d:
    print('  已打过补丁')
else:
    print('  未打补丁（次数异常）')
PY

echo "== 2/4 准备资产（PreviewBuild 产物 -> 含 .abc 的目录）=="
( cd "$PROJ" && hvigorw PreviewBuild --mode module -p product=default -p buildMode=debug --no-daemon >/tmp/pv_previewbuild.log 2>&1 )
R="$PREFIX/modules.abc"; mkdir -p "$R"; cp -r "$PROJ/.preview/default/." "$R/"
ln -sfn "$R" "$PREFIX/entry"; ln -sfn "$R" "$PREFIX/com.chronostasys.xbot"
ls "$R" >/dev/null && echo "  资产就绪: $R/ets/modules.abc"

echo "== 3/4 起 Xvfb :$XDISP（软件 GL）=="
Xvfb ":$XDISP" -screen 0 1320x2848x24 +extension GLX +render >/tmp/xvfb$XDISP.log 2>&1 &
echo "  Xvfb PID=$! （结束请：kill <PID>，禁用 pkill）"
sleep 3

echo "== 4/4 跑 Previewer（端口 $PORT）=="
export LD_LIBRARY_PATH="/tmp/zvlib:/tmp/pvlibs:$BINS:$BINS/module:$CLI/sdk/default/hms/toolchains/lib"
DISPLAY=":$XDISP" LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe MESA_GL_VERSION_OVERRIDE=4.5 \
  "$BINS/Previewer" -refresh region -projectID 743055776 -ts trace_hbt_commandPipe \
  -j "$R/ets" -s phone_hbt_1 -cpm false -device phone -shape rect -sd 480 \
  -or 1320 2848 -cr 1320 2848 -n entry -av ACE_2_0 -p 15038 \
  -url com.chronostasys.xbot/pages/Index -pages main_pages -arp "$R" -pm Stage \
  -l zh_CN -cm dark -o portrait -ljPath "$R/loader.json" -lws "$PORT"
