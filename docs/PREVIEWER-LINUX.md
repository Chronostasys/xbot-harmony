# 在 Linux 上跑 ArkUI Previewer（本机实测：可行 ✓）

**为什么需要它**：真机自检依赖用户的手机；而在 Linux 上跑 Previewer 就能**直接渲染本 App 的 UI 并截图**，
让界面改动能被"看见后再改"，而不是盲改（用户多次要求"自己看看你渲染了啥"）。

## 1. 二进制在哪
```
$SDK/default/openharmony/previewer/common/bin/Previewer      # 719KB，纯原生二进制（Linux 版）
$SDK/default/openharmony/previewer/common/bin/libace_compatible.so  # 62MB ArkUI 运行时
```
即 **command-line-tools 的 Linux SDK 自带 Previewer**（不需要 DevEco Studio GUI）。

## 2. 缺两个运行库 —— 补齐后即可加载（实测）
```
libshared_libz.so  # SDK 未随附；内容就是 zlib ⇒ 做符号链接即可
libhilog.so        # 随 SDK 提供：$SDK/default/hms/toolchains/lib/libhilog.so
```
```bash
mkdir -p /tmp/zvlib
ln -sf /usr/lib/x86_64-linux-gnu/libz.so.1 /tmp/zvlib/libshared_libz.so
SDK=/home/smith/ohos-cli/command-line-tools/sdk
B=$SDK/default/openharmony/previewer/common/bin
HMS=$SDK/default/hms/toolchains/lib
export LD_LIBRARY_PATH="/tmp/zvlib:$B:$B/module:$HMS"
ldd $B/Previewer | grep "not found"     # 期望：无输出（已全部解析）
$B/Previewer -h                          # 实测输出：
#   [INFO][RichPreviewer.cpp][main][103]:RichPreviewer enter the main function.
#   [ERROR][CommandParser.cpp][ProcessCommand]:ProcessCommand Set -h!
```
即**二进制可正常加载并进入主函数**；`-h` 没有帮助文本（走参数解析分支后直接报 Set -h）。

## 3. 无头渲染 + 截图（本机工具齐备 ✓）
- `Xvfb` / `xvfb-run` ✓、ImageMagick（`import`、`convert`）✓。
```bash
xvfb-run -s "-screen 0 1320x2848x24" "$B/Previewer" <args> &
sleep 8 && import -window root /tmp/preview.png   # 或 convert x:root
```

## 4. 仍待补：Previewer 的完整参数
DevEco 调用形如：`-refresh region -projectID <id> -ts <socket> -j <预览产物> -n <name> -d <device>
-or <分辨率> -cm <dark|light> -lws <port> …`；`-j` 指向 hvigor 的**预览产物**（本项目在
`entry/build/default/intermediates/loader_out/`），需用 hvigor 的 Previewer 构建任务产出。
（另：`libark_inspector.so` / `libark_tooling.so` 也在同一 bin 目录 ⇒ ArkUI Inspector 的
自动化通道理论上同样可在 Linux 上跑，可用 `harmony-next` skill 的
`references/ideGuides/DevEco Studio IDE私有接口与AI自动化.md` 与 `lib/hdc + uitest` 路线推进。）
