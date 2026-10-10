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

## 5. 实测进展与当前卡点（2026-10-10）

**已打通的**（全部参数从 hvigor 自己的预览调用代码
`hvigor-ohos-plugin/node_modules/@ohos/coverage/lib/src/commandLine/localTest/previewer.js` 逐字取得，
**关键：`-or`/`-cr` 各是两个独立 token**，不是一个 `WxH` 字符串 —— 这是之前一直报
"not match regex" 的真因）：

```
Previewer -refresh region -projectID <id> -ts <sock> \
  -j <.../intermediates/assets/default/ets>   # 需含 modules.abc（+ resources.index/module.json/resources）
  -device phone -shape rect -sd 480 -pm Stage -av ACE_2_0 -n entry \
  -or 1320 2848  -cr 1320 2848  -lws <port> -p <port> \
  -pages main_pages -url pages/Index -arp <.../intermediates/res/default> \
  -ljPath <.../intermediates/loader/default/loader.json> -cm dark -l zh_CN -o portrait
```
实测它**能启动 ArkUI 引擎并创建页面**（日志：`root node OnAttachToFrameNode` +
`Page router manager is creating page[1]: url: pages/Index`）⇒ **参数与产物都对了**。

**当前卡点（本机环境）**：
1. `[ERROR][JsAppImpl.cpp][InitGlfwEnv]: Could not create window` —— 它自带的 GLFW 需要 GL 上下文；
   本机是无 GPU 容器，已试并**全部被拒**：`LIBGL_ALWAYS_SOFTWARE=1`、`GALLIUM_DRIVER=llvmpipe`、
   `LIBGL_DRIVERS_PATH=<dri>`、`MESA_GL_VERSION_OVERRIDE=4.5`、`MESA_GLSL_VERSION_OVERRIDE=450`、
   `Xvfb +extension GLX +iglx +render`（`swrast_dri.so` 确实存在，但仍建窗失败）。
2. `[SetAssetPath] Invalid input assetPath` —— 还需要对齐它期望的资源路径形状（hvigor 模板用的是
   `<module>/.test/default/intermediates/assets/default/ets`，与本机 `entry/build/.../assets/default/ets` 形状一致，
   仍被判非法 ⇒ 需继续核对 `-arp`/`-j` 的组合约束）。

**替代的自检闭环（当下最省事、可立刻用）**：App 内置**手动**自检快照（自动走查已按用户要求删除）——
在真机点一次「走查并上传」，`componentSnapshot` 会把**真实渲染 PNG + layout dump** 传到服务端；
本机从 `~/.xbot/uploads/...` 直接 `view_image` 就能看真实界面 ⇒ 可以据此逐屏修 UI（1 次点击的代价）。

### 5.1 补充诊断（2026-10-10 晚）：不是缺库，是拿不到 GL 上下文

- `ldd` 结果：Previewer 主程序、`libglfw.so`、`libglfw_render_context.so` **均无 "not found"**
  （补齐 `/tmp/zvlib` + `$B` + `$B/module` + `$SDK/default/hms/toolchains/lib` 后全部解析成功）；
- 系统侧 `libGL.so.1` / `libEGL.so.1` / `libX11.so.6` / `libxcb.so.1` 与
  `/usr/lib/x86_64-linux-gnu/dri/{swrast,kms_swrast}_dri.so` **都在**；
- 但 `InitGlfwEnv` 仍报 `Could not create window`。
⇒ 结论：**卡点是 GL 上下文创建本身**（无 GPU 容器里，捆绑的 GLFW 不接受本机 Xvfb 的软件 GL，
即使开了 `+iglx`、`LIBGL_ALWAYS_SOFTWARE=1`、`llvmpipe`、`MESA_GL_VERSION_OVERRIDE=4.5`）。
⇒ 走通这条路需要：**有真实 GL/EGL 的环境**（GPU 机器、或带 mesa 完整 GLX 的 X 服务器），
   或者 DevEco 的官方模拟器（Linux 上仅随 IDE 提供）。
   在此之前，真实界面自检请用「App 手动自检快照 → 上传 → 本机 `view_image`」这条闭环（§5 末段）。
