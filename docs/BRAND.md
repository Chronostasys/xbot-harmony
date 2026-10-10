# 品牌与开屏（BRAND）—— xbot 原生端

> 本文件是 **应用图标 / 开屏（startWindow）** 的唯一判据。
> 改图标或开屏前先读这里；颜色一律取设计系统 token，**禁止颜色字面量另起一套**
> （见 `docs/DESIGN-SYSTEM.md` 与 `entry/src/main/ets/core/theme.ets`）。

## 0. 一句话

**一枚满幅强调色方块 + 白色对话气泡 + 同色四角星芒**——极简两色，无渐变、无描边、无阴影。

## 1. 标记语义

| 元素 | 语义 | 说明 |
|---|---|---|
| 满幅方块底（accent `#7C5CFF`） | 品牌主色 | 与 `darkPalette.accent` 逐字一致；系统桌面自行施加圆角/形状遮罩 |
| 圆角对话气泡（白） | 「对话」 | 圆角方 + 左下角尾巴，chat 通用语义，48px 下仍清晰 |
| 四角星芒（accent） | 「智能体 / 生成」 | AI 的通用图形语汇；`sym.symbol` 无 spark 名，故以几何星芒表达 |

> 为什么不用 emoji / 富细节：桌面图标常被缩到 48–72px，细节会糊成一团。两色 + 两个形状是
> 在最小尺寸下仍可辨识的上限（Apple 式克制）。

## 2. 几何与留白

坐标一律以 **1024×1024 viewBox** 表达（`app_icon.svg`）；`start_icon.svg` 为 **512×512**
的同构缩放（×0.5）。

| 项 | 值（1024 画布） | 规则 |
|---|---|---|
| 画布 | `0 0 1024 1024` | 满幅，**不画圆角**（圆角由系统遮罩给，自绘会双重圆角） |
| 气泡外框 | `x 224..800, y 232..700` | 左右各留 ~22% 边距 |
| 气泡圆角 | `r = 148` | ≈ 气泡高（468）的 31.6% —— squircle 观感 |
| 气泡尾巴 | 底边向左延至 `x=476`，尖点 `(300, 844)` | 左下，高 ≈ 144 |
| 星芒中心 | `(512, 466)` = 气泡主体中心 | 必须与气泡主体同心 |
| 星芒半径 | `132` 外接（实际画到 120） | 直径 ≈ 气泡高的 56% |

**缩放/再绘制规则**：任何尺寸都从 1024 画布**等比**缩放（几何是比例驱动，不是像素驱动）。
新增尺寸不要手改坐标，改 viewBox 宽度即可。

## 3. 颜色（全部取设计系统 token）

| 用途 | 值 | token 来源 |
|---|---|---|
| 图标底 / 星芒 / 开屏气泡 | `#7C5CFF` | `darkPalette().accent`（`core/theme.ets`） |
| 气泡 / 开屏星芒 | `#FFFFFF` | `darkPalette().onAccent` |

刻意**不用渐变**：`linearGradient` 若在 SVG 渲染器里解析失败，`fill=url()` 会退化成不可见，
满幅底一旦不可见就是「桌面图标变透明」。**稳定 > 花哨**。（若将来要渐变，见 §6 再生成。）

## 4. 深浅两版与开屏背景

开屏由两部分组成：**背景色（随系统深浅色模式切换）+ 居中的开屏标记**。

| 资源 | 值 | 生效条件 |
|---|---|---|
| `entry/src/main/resources/base/element/color.json` → `start_window_background` | `#F8FAFC` | 系统**浅色**模式（base 无 qualifier） |
| `entry/src/main/resources/dark/element/color.json` → `start_window_background` | `#0B0B0E` | 系统**深色**模式（`dark` 是合法 ColorMode 资源 qualifier，已在 restool 帮助文本核实） |

- 两值分别取自 `lightPalette().appBg` 与 `darkPalette().appBg`（**与主界面同色**，开屏→首屏无跳色）。
- `dark/` 是资源 qualifier 目录（`ColorMode[dark]`），与 `base/` 并列，**不是**页面代码分支。
- 开屏标记（`start_icon.svg`）**自带颜色**（紫气泡 + 白星芒）：因此同一个 SVG 在浅底与深底上
  都可见，**不需要**为标记再做深浅两版。

## 5. 资源落点与引用链（自洽，无断链）

```
AppScope/app.json5            app.icon            → $media:app_icon   → AppScope/resources/base/media/app_icon.svg
AppScope/resources/base/media/app_icon.svg
entry/src/main/module.json5   ability.icon        → $media:app_icon   → entry/src/main/resources/base/media/app_icon.svg
                              ability.startWindowIcon → $media:start_icon → entry/src/main/resources/base/media/start_icon.svg
entry/src/main/resources/base/element/color.json   → start_window_background (#F8FAFC)
entry/src/main/resources/dark/element/color.json   → start_window_background (#0B0B0E)
```

> ⚠️ `$media:app_icon` 在 **AppScope 与 entry 两侧各放一份**（沿用改造前的既有结构）：
> 模块级资源覆盖 app 级同名资源，两侧同名**不算冲突**（旧 PNG 也是这么放的）。

## 6. 如何再生成

标记是**比例驱动的几何**，改样式只需改 §2 的坐标，再等比缩放：

- 换主色：把 `#7C5CFF` 全量替换为新的 `accent` 值（两处：`app_icon.svg` 底与星芒、
  `start_icon.svg` 气泡）。
- 换尺寸：只改 `<svg width height viewBox>` 的第二/三位，**不要**改 path 坐标。
- 若要试渐变（默认不建议）：把 `app_icon.svg` 的底 `<rect fill="#7C5CFF">` 换成
  `<rect fill="url(#g)"/>` 并在 `<defs>` 里加
  `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#8F73FF"/></linearGradient>`
  （`accent` → `accentHover`）。**必须先确认渲染器支持**再合入。

## 7. SDK 约定与「待验证」清单（勘察结论，勿臆断）

| 结论 | 证据 | 状态 |
|---|---|---|
| restool 有 `--icon-check`：「Enable the PNG image verification function for icons and startwindows」 | `restool -h`（SDK toolchains） | ✅ 已核实 |
| **本模块的 `--icon-check` 是开启的** | `hvigor-ohos-plugin` 的 `isEnabledIconCheck()`：entry 模块 + deviceTypes 含 phone/tablet + API≥10 + `app.bundleType==="app"` ⇒ true；本模块全部满足 | ✅ 已核实（读 hvigor 源码） |
| 图标/开屏非 PNG 时 restool 只报 **Warning**（非致命） | restool 二进制字符串 `Warning: ... is not png format` | ✅ 已核实（warning 级） |
| **`.svg` 能否作为 `$media:` 资源被 restool 收录、桌面能否渲染 SVG 图标** | 无法用本地 `restool` CLI 复现 hvigor 的 stage-model 调用（CLI 单独跑要求 FA 风格 `distro` 节点而失败） | ⚠️ **待验证** |
| **HarmonyOS 分层图标（layered icon）落法** | 全 SDK / hvigor 插件内**搜不到** `layered_image` / `layeredImage` 任何约定或 schema；仅 hvigor 有一条告警字符串提到「layered launcher icon」 | ⚠️ **待验证**（故本次采用**单层 SVG** —— 上级给出的保守方案） |

### 待验证项的保守回退（若主 agent 构建/装机发现图标不显示）

1. 用任意 SVG→PNG 工具把 `app_icon.svg` / `start_icon.svg` 栅格化为 **512×512 PNG**，
   同名存为 `app_icon.png` / `start_icon.png`（**同名会与 .svg 冲突，须先删 .svg 或改名**），
   引用链参数不变（`$media:app_icon` / `$media:start_icon` 按**资源名**解析，与扩展名无关）。
2. 若桌面要求分层图标：需在 `AppScope/resources/base/media/` 增加
   `foreground.*` + `background.*` 与 `layered_image.json`，并把 `app.json5` 的 `icon`
   指向 `$media:layered_image` —— **该 API 形状未经本地核实，必须先查 DevEco 文档再动**。
