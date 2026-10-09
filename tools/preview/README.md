# Linux 上运行鸿蒙预览器（Previewer）—— 实测记录

> 结论先说：**能做到"预览器在 Linux 上启动、参数校验通过、应用 ABC 被加载、帧能被抓出来"**，
> 但**拿到的帧恒为空白**（连最小绿色测试页也一样）——预览器的取帧/重绘是由 **DevEco 编排器**
> 通过本地套接字驱动的那套协议，脱离 IDE 时它只保留一份"首帧缓冲"。
> ⇒ 要真机级、逐页可信的截图，请用 **设备 + hdc**（见文末），预览器只适合做"能否加载"的冒烟检查。

## 1. 工具链里的预览器

`$CMDLINE_TOOLS/sdk/default/openharmony/previewer/common/bin/Previewer`（**Linux x86-64 原生二进制**）。

### 1.1 缺库（本 SDK 包漏发）
`ldd` 报 14 处 `not found`：`libshared_libz.so`（zlib+minizip，装了 OH 改名的
`unzLocateFile2` / `unzOpenFile` / `unzCloseFile`）与 `libhilog.so`。
后者的替代在 `sdk/default/hms/toolchains/lib/`；前者需自建 shim（见 `shim/libshared_libz` 的做法）：

```bash
# libminizip-dev 提供标准 unz*/zip* 符号；补 3 个 OH 专有名即可
gcc -shared -fPIC -O2 -o libshared_libz.so zshim.c -lminizip -lz
```
（zshim.c = `unzLocateFile2`→`unzLocateFile`、`unzOpenFile`→`unzOpen`、`unzCloseFile`→`unzClose`）

运行时把 `/tmp/zvlib`（含该 shim）+ previewer/bin + hms/toolchains/lib 放进 `LD_LIBRARY_PATH`。

## 2. 启动参数（从公开源码 `openharmony/ide_previewer` 反查，非文档）

必填 / 关键项：

| 参数 | 含义 | 本工程取值 |
|---|---|---|
| `-j` | **必须是以 `/data/storage/el1/bundle/` 开头、且含 `.abc` 的"目录"** | `/data/storage/el1/bundle/xbot/ets/modules.abc`（目录名就叫 modules.abc，里面放真包） |
| `-n` | 模块名 | `entry` |
| `-or W H` / `-cr W H` | **宽高分别是两个独立参数**（不是 `WxH`！） | `1200 2600` |
| `-url` | **必须是 ABC 里的记录名**（`<bundle>/<module>/ets/<page>`） | `entry/ets/pages/Index` |
| `-arp` | **含 `resources.index` + `module.json` 的目录** | 预览根目录 |
| `-ljPath` | `loader.json`（含 `modulePathMap`） | 预览根/loader.json |
| `-pm` | `Stage` 或 `FA` | `Stage` |
| `-f` | 配置文件（存在即可） | 预览根/module.json |
| `-device -cm -av -o -l -refresh -card -s -lws -p` | 设备/色模式/ACE 版本/方向/语言/刷新模式/卡片/套接字名/WS 端口/调试端口 | `phone dark ACE_2_0 portrait zh_CN full false xbotprev 8891 8890` |

关键校验（源码 `arkcompiler_ets_runtime/ecmascript/module/module_path_helper.cpp`）：

```cpp
BUNDLE_INSTALL_PATH = "/data/storage/el1/bundle/";
bool ValidateAbcPath(p, mode) {
  return p.startsWith(BUNDLE_INSTALL_PATH) && p.rfind(".abc") != npos;  // 纯字符串校验
}
```

## 3. 预览根的目录形状

```
<prevroot>/
├── module.json           # process_profile/default/module.json
├── resources.index       # res/default/resources.index
├── resources/            # res/default/resources/**（含 base/profile/main_pages.json）
├── pkgContextInfo.json   # loader/default/pkgContextInfo.json
├── loader.json           # loader/default/loader.json
├── apiMock/jsMockHmos.abc# ← 在 sdk/default/HMS/previewer/apiMock/（openharmony 侧没有！）
└── ets/modules.abc       # loader_out/default/ets/modules.abc
```
并且 `/data/storage/el1/bundle/xbot/ets/modules.abc/modules.abc` 也要有同一份（`-j` 指向它）。

## 4. 抓帧（websocket）

预览器自己起 WS 服务（`-lws`），DevEco 作为客户端取帧。帧格式：

```
[6×uint32 大端] magic=0x12345678 | width | height | crWidth | crHeight | 0
[8 字节 0]
[JPEG（ffd8ff…）]        ← 直接按偏移找 ffd8ff 即可
```
本目录 `ws_grab.py` 就是最简 WS 客户端；`socket_server.py` 是本地套接字对端
（预览器是**客户端**，连 `/tmp/<name>`；不提供对端会在 `LocalSocket::WriteData` 崩）。

## 5. 推荐做法：设备 + hdc（真机级截图，Linux 即可）

```bash
HDC=$CMDLINE_TOOLS/sdk/default/openharmony/toolchains/hdc
$HDC list targets                     # 手机 USB 连接 + 开启 USB 调试
$HDC install dist/xbot-harmony-release.hap
$HDC shell aa start -a EntryAbility -b com.chronostasys.xbot
$HDC shell snapshot_display -f /data/local/tmp/s.jpeg && $HDC file recv /data/local/tmp/s.jpeg ./s.jpeg
$HDC shell uinput -T -c <x> <y>        # 模拟点击，逐页走查
$HDC shell hilog | grep -i xbot        # 日志/崩溃栈
```

## 6. 实测补充（2026-10-09）

用带 refresh 命令的 WS 客户端（`ws_grab.py` 已内置发送）驱动后，**帧仍恒为空白**；
日志显示渲染服务在无头环境起不来：

```
RSUIDirectory::AttachSurface not ready
RSRenderNode::InitRenderParams failed
```

⇒ 结论：**本机（无 GPU 的无头容器 + Xvfb）无法作为渲染环境**；加之 Stage ability 在 Linux
未实现，预览器只能用于"参数/模块/资源是否加载成功"的冒烟检查，**不能用于视觉验证**。
视觉验证必须走真机 + hdc（`tools/device/shots.sh`）。

## 追加取证：公开镜像站全量目录扫描（qemu 路径穷举）

命令（可复现）：

```bash
curl -s --noproxy '*' https://repo.huaweicloud.com/openharmony/os/ | grep -o 'href="[^"]*"'   # 列全部发布目录
# 逐个发布目录搜 qemu / x86 / vbox：
for v in <列出的每个版本目录>; do
  curl -s --noproxy '*' "https://repo.huaweicloud.com/openharmony/os/$v/" | grep -io -e 'qemu[^"<]*' -e 'x86[^"<]*' -e 'vbox[^"<]*'
done
```

结果：

- `/openharmony/os/` 下的发布目录：`1.1.4` `1.1.5` `2.0` `2.2-Beta2` `3.0`…`3.2.4` `4.0-Beta1` … 以及 `5.x`
  —— **没有任何一个目录含 `qemu` / `x86` / `vbox` 镜像**（零命中）。
- 唯一细看过的 `5.1.0-Release/` 产物全部是真机开发板镜像：`dayu200` / `hispark_taurus` / `hispark_pegasus` 等。
- DevEco Device Tool 的模拟器官方只提供 **Windows / macOS**。

⇒ 因此"在 Linux 上跑 HarmonyOS 虚拟机并截图"**不存在可用的镜像来源**；
   与另两条（官方 Linux 预览器不实现 Stage ability；无头渲染 `AttachSurface not ready` 且抓到空白帧）
   合起来 = 三条路穷举完毕。设备侧取证通道（自检页几何 + 回传截图）即为此结论的补偿方案。

## 追加取证：排除"缺 EGL / 缺 X 显示"这两个变量（2026-10-09 22:0x）

上一次的失败是 **headless** 跑的，且宿主**没装 `libEGL`** —— 这两个变量都可能是
`RSUIDirectory::AttachSurface not ready` 的原因。因此本次把它们**同时补上**再跑：

```bash
sudo apt-get install -y --no-install-recommends libegl1 libegl-mesa0 libgles2   # 装成功
ls /usr/lib/x86_64-linux-gnu/libEGL.so.1 /usr/lib/x86_64-linux-gnu/dri/swrast_dri.so   # 都在
bash tools/preview/run_preview.sh /tmp/prevroot pages/Index egl1                 # 脚本内已起 Xvfb :77
```

结果：

```
[frame 1 条] BINARY 49567 bytes -> /tmp/frames/msg1.bin
saved /tmp/frames/egl1.jpg (49527 bytes)

$ convert /tmp/frames/egl1.jpg -format '%k' info:      # 唯一色数
1                                                      # ← 纯白（空白）
$ convert /tmp/frames/egl1.jpg -format '%[pixel:p{600,1300}]' info:
srgb(255,255,255)
$ md5sum /tmp/frames/{egl1,frame,live}.jpg
aebde8593768ae5abf01a34f57d4ad11  egl1.jpg             # ← 与历史帧**逐字节相同**
aebde8593768ae5abf01a34f57d4ad11  frame.jpg
aebde8593768ae5abf01a34f57d4ad11  live.jpg
```

日志里 `RSUIDirector::AttachSurface not ready` 与 `RSRenderNode::InitRenderParams failed`
**依旧存在**（EGL 装与不装、有 X 与无 X 都一样）。

### 结论（三条路全部有证据地排除）

| 路径 | 结论 | 证据 |
|---|---|---|
| 官方 Linux 预览器跑 Stage ability | **不可行** | 源码 `ide_previewer/jsapp/rich/JsAppImpl.cpp:408` → `JsApp::Run ability start failed. Linux is not supported.` |
| 绕开 ability，用虚拟屏取帧（headless / Xvfb+Mesa EGL 都试过） | **不可行** | `AttachSurface not ready` + `InitRenderParams failed`；帧唯一色数=1、md5 恒定 —— 渲染服务需要 DevEco 编排器提供 surface |
| QEMU 跑鸿蒙虚拟机 | **不可行** | `repo.huaweicloud.com/openharmony/os/` 全量目录逐个搜 `qemu/x86/vbox` 零命中；`5.1.0-Release/` 只有 dayu200/hispark 真机板镜像；DevEco 模拟器仅 Win/macOS |

⇒ 真正可用的路径只有 **真机 + (hdc | 应用内取证)**。应用内取证见
`docs/UI-AUDIT-CHECKLIST.md`（自检页那段可长按复制的文本）。
