# 品牌与开屏（BRAND）—— xbot 原生端

> 本文件是 **应用图标 / 开屏（startWindow）** 的唯一判据。
> 改图标或开屏前先读这里；颜色一律取设计系统 token，**禁止颜色字面量另起一套**
> （见 `docs/DESIGN-SYSTEM.md` 与 `entry/src/main/ets/core/theme.ets`）。

## 0. 一句话

**一枚满幅强调色方块 + 白色对话气泡 + 同色四角星芒**——极简两色，无渐变、无描边、无阴影。

> ⭐ **改图标/开屏前先看 §6.4**：几何/配色的**唯一真源是 `core/brand.ets`**，资源由
> `tools/brand/gen.sh` **生成**（可重复、可 `--check` 校验）；**不要**手改 `app_icon.svg` / `start_icon.png`。

## 1. 标记语义

| 元素 | 语义 | 说明 |
|---|---|---|
| 满幅方块底（accent `#7C5CFF`） | 品牌主色 | 与 `darkPalette.accent`（`core/theme.ets:118`）逐字一致；系统桌面自行施加圆角/形状遮罩 |
| 圆角对话气泡（白） | 「对话」 | 圆角方 + 左下角尾巴，chat 通用语义，48px 下仍清晰 |
| 四角星芒（accent） | 「智能体 / 生成」 | AI 的通用图形语汇；`sym.symbol` 无 spark 名，故以几何星芒表达 |

> 为什么不用 emoji / 富细节：桌面图标常被缩到 48–72px，细节会糊成一团。两色 + 两个形状是
> 在最小尺寸下仍可辨识的上限（Apple 式克制）。

## 2. 几何与留白

坐标一律以 **1024×1024 viewBox** 表达（`app_icon.svg`）；`start_icon` 为 **512×512**
的同构缩放（×0.5，改格式前的源见 §6.4）。

| 项 | 值（1024 画布） | 规则 |
|---|---|---|
| 画布 | `0 0 1024 1024` | 满幅，**不画圆角**（圆角由系统遮罩给，自绘会双重圆角） |
| 气泡外框 | `x 224..800, y 232..700` | 左右各留 ~22% 边距 |
| 气泡圆角 | `r = 148` | ≈ 气泡高（468）的 31.6% —— squircle 观感 |
| 气泡尾巴 | 底边向左延至 `x=476`，尖点 `(300, 844)` | 左下，高 ≈ 144 |
| 尾巴尖倒圆 | `r = 28`（`TAIL_TIP_ROUND`）| 锐角硬拐 → 柔性收尾（`Q` 切角）；**改它一个常量即可** |
| 星芒中心 | `(512, 466)` = 气泡主体中心 | 必须与气泡主体同心 |
| 星芒半径 | `130`（四个尖点各距中心 130，控制点全在中心） | 直径 ≈ 气泡高的 55%（本地栅格化实测尖点落在 ±130） |

> ⚠️ **这些数字不再手写在文档里当"真源"** —— 唯一真源是 `core/brand.ets` 的常量
> （`BUBBLE_*` / `TAIL_*` / `STAR_*`），本表是它的**镜像**。改样式请改代码常量，再跑生成脚本
> （见 §6.4），**不要**手改资源文件。

**缩放/再绘制规则**：任何尺寸都从 1024 画布**等比**缩放（几何是比例驱动，不是像素驱动）。
新增尺寸不要手改坐标，改 viewBox 宽度即可。

## 3. 颜色（全部取设计系统 token，附 file:line）

| 用途 | 值 | token 来源 |
|---|---|---|
| 图标底 / 星芒 / 开屏气泡 | `#7C5CFF` | `darkPalette().accent` —— `core/theme.ets:118` |
| 气泡 / 开屏星芒 | `#FFFFFF` | `darkPalette().onAccent` —— `core/theme.ets:124` |

刻意**不用渐变**：`linearGradient` 若在 SVG 渲染器里解析失败，`fill=url()` 会退化成不可见，
满幅底一旦不可见就是「桌面图标变透明」。**稳定 > 花哨**。（若将来要渐变，见 §6 再生成。）

> ⛔ **不许自造色**：图标里出现的每个色值都必须能在设计系统里指名道姓（上表两色）。若要第三色，
> 先在 `docs/DESIGN-SYSTEM.md` 立 token，再回来用。

## 4. 开屏背景（深浅两变体）—— 取值 / 推导 / SDK 证据

开屏由两部分组成：**背景色（随系统深浅色模式切换）+ 居中的开屏标记**。

| 资源 | 值 | 生效条件 |
|---|---|---|
| `entry/src/main/resources/base/element/color.json` → `start_window_background` | `#F8FAFC` | 系统**浅色**模式（base 无 qualifier） |
| `entry/src/main/resources/dark/element/color.json` → `start_window_background` | `#0B0B0E` | 系统**深色**模式（`dark` 是合法 ColorMode 资源 qualifier） |

### 4.1 为什么它「与主题无关」，而取画布 token

开屏（startWindow）由**系统**在应用 ArkUI 内容首帧之前绘制，此刻**主题真值（服务端 settings）
还没到**，用户在当前会话里选的 `dark/light/aurora/nebula/porcelain` 也尚未生效
（主题真值链路：`core/config.ets` 本地缓存 → `EntryAbility.ets:33` 同步读 → 页面 `paletteOf(themeName)`）。
⇒ 开屏底色**不能**取「当前主题的 `appBg`」，只能取**一套与主题无关的中性画布**。

两个值就是设计系统的**两套基准画布**（不是另起炉灶、更不是拍脑袋的近白）：

| 变体 | 值 | 推导（逐字取 token） |
|---|---|---|
| 浅色 | `#F8FAFC` | `lightPalette().appBg` —— `core/theme.ets:146` |
| 深色 | `#0B0B0E` | `darkPalette().appBg` —— `core/theme.ets:110` |

- 取「基准画布」而非某个具体主题，是因为 `dark`/`light` 是**与系统深浅色一一对应的基准**；
  `aurora/nebula` 都归深色系、`porcelain` 归浅色系，开屏只要跟到「深/浅」这一档即可。
- 开屏标记（`start_icon`）**自带颜色**（紫气泡 + 白星芒）：同一个标记在浅底与深底上都可见，
  **不需要**为标记再做深浅两版。

### 4.2 SDK 证据（不是猜：来自本地 SDK 的 schema / 声明文件）

| 结论 | 证据 | 结论类型 |
|---|---|---|
| 开屏底色的深浅**跟随系统**（不是跟随当前主题） | `sdk/default/openharmony/toolchains/modulecheck/startWindow.json`：`startWindowColorModeType` 的枚举 = `FOLLOW_SYSTEM \| FOLLOW_APPLICATION`，**default = `FOLLOW_SYSTEM`** | ✅ 已核实（本地 schema） |
| `startWindowBackground` 收 `$color:`、`startWindowIcon` 收 `$media:`，**无 PNG 硬性要求** | `toolchains/modulecheck/module.json`（abilities.items.properties） | ✅ 已核实（本地 schema） |
| `module.json5` / `app.json5` **没有** `darkMode` 字段（无需额外配置即「跟随系统」） | 同上 schema（`grep darkMode` = 0 命中）；`app.json` schema 亦无 `colorMode` | ✅ 已核实 |
| 应用侧也可主动锁定系统表面（状态栏/玻璃）的深浅 | `EntryAbility.ets:35-37` `setColorMode(...)`；`ApplicationContext.d.ts:326` | ✅ 已核实 |

> 为什么仍用「跟随系统」而不是 `FOLLOW_APPLICATION`（记录取舍，别当成没想过）：
> `startWindowColorModeType` 可显式设为 `FOLLOW_APPLICATION`，理论上能让开屏跟应用实际色板（消掉
> 「系统浅、应用深」时的闪色）。但：① 该字段所在的 `startWindow` profile 机制（`module.json5` 的
> `abilities[].startWindow = "$profile:..."` + `resources/base/profile/startWindow.json`）是**更重的
> 另一套启动页描述**，一旦启用会同时接管开屏图标/背景的渲染路径，**改动的是用户天天看到的表面**；
> ② 应用侧 `setColorMode` 在本工程里于 `onCreate` 调用，而 `ApplicationContext.d.ts:326` 的注释要求
> 「window 已创建、页面已 load 之后」再调，二者时序在**真机**上是否让开屏吃到应用色板**未经证实**。
> ⇒ 采用**已被证实的**「跟随系统 + 基准画布」方案；`FOLLOW_APPLICATION` 列为**待真机决策项**（§9）。

### 4.3 纪律：这两个值**禁止**退化回字面量

- 字面量（如历史上的 `#F8FAFC` 被当成「随便一个近白」写死）会**脱离设计系统**：色板一改，
  开屏与首屏立刻不同色（冷启动「跳色」），而且没人会想到去开屏资源里同步。
- 判据：任何改 `start_window_background` 的 PR，**值必须能指到 `core/theme.ets` 的某个 `appBg`**；
  指不到就不能合。
- `dark/` 限定目录的 **key 必须与 `base/` 完全一致**（都是 `start_window_background`）；不一致时
  深色下取不到 ⇒ 崩。两个文件当前 key 一致，已核对。

## 5. 资源落点与引用链（自洽，无断链）

```
AppScope/app.json5            app.icon            → $media:app_icon   → AppScope/resources/base/media/app_icon.svg
AppScope/resources/base/media/app_icon.svg
entry/src/main/module.json5   ability.icon        → $media:app_icon   → entry/src/main/resources/base/media/app_icon.svg
                              ability.startWindowIcon → $media:start_icon → entry/src/main/resources/base/media/start_icon.png
entry/src/main/resources/base/element/color.json   → start_window_background (#F8FAFC)
entry/src/main/resources/dark/element/color.json   → start_window_background (#0B0B0E)
```

**降级链 / 分层图标资源**（由 `tools/brand/gen.sh` 生成；分层图标资源在 **entry 与 AppScope 两侧各一份、逐字节相同**）：

| 资源 | 是什么 | 生成命令 | 消费方 |
|---|---|---|---|
| `entry/.../media/brand_mark_outline.svg` | 降级链第 3 档：单色轮廓（零填充零发光，`outlineMarkSvg`） | `bash tools/brand/gen.sh` | 待接线（无障碍/黑白时由 `markLevelFor` 选中） |
| `entry/.../media/brand_foreground.svg` + `AppScope/.../media/brand_foreground.svg` | 分层图标**前景**：标记缩进 313 安全区（`layeredForegroundSvg`），1024×1024 | 同上 | `AppScope/.../media/layered_image.json` → `app.icon`（需改 `app.json5`，§12.2） |
| `entry/.../media/brand_background.svg` + `AppScope/.../media/brand_background.svg` | 分层图标**背景**：满幅品牌色（`layeredBackgroundSvg`），1024×1024 | 同上 | 同上 |
| `AppScope/.../media/layered_image.json` | 分层描述符（静态；**未被引用时惰性**） | 手工（不依赖真源） | 同上 |

> ⚠️ `$media:` 按**资源名**解析，与扩展名无关。
> `$media:app_icon` 在 **AppScope 与 entry 两侧各放一份**（沿用改造前的既有结构）：
> 模块级资源覆盖 app 级同名资源，两侧同名**不算冲突**。

## 6. 图标：SVG 图元清单 / 打包行为 / 再生成

### 6.1 SVG 图元清单（逐条说明为什么被支持）

| 图元 / 属性 | 用在 | 为什么安全 |
|---|---|---|
| `<rect>` + 纯色 `fill` | 图标满幅底 | SVG 1.1 最基础图元 |
| `<path>` + `M/H/V/L/A/Q/Z` + 纯色 `fill` | 气泡（直线 + `A` 圆角弧 + `L` 尾巴）、星芒（`Q` 二次贝塞尔） | 直线/圆弧/二次贝塞尔都是 SVG 1.1 核心命令 |
| `xmlns` + `width/height/viewBox` | 根节点 | 标准 |
| **未使用**：`linearGradient` / `radialGradient` / `<filter>` / `<mask>` / `<clipPath>` / `<use>` / CSS `style` | — | **刻意规避**——渲染器支持不齐；尤其 `fill="url(#g)"` 一旦解析失败，整块填充退化为「不可见」 |

### 6.2 本地渲染验证（无真机时的自检手段）

用 macOS 自带 `qlmanage` / `sips` 把 SVG 栅格化，再用一个极简 PNG 解码脚本逐像素复核：

```bash
sips -s format png entry/src/main/resources/base/media/start_icon.svg --out /tmp/start_icon.png
sips -g hasAlpha -g pixelWidth -g pixelHeight /tmp/start_icon.png   # hasAlpha: yes, 512x512
```

实测结论：气泡为 `#7C5CFF`、星芒为白、四角透明 ⇒ **几何与配色与设计一致**（星芒尖点确实落在 ±120）。

### 6.3 打包行为与 `start_icon` 的格式决定（本波的关键发现）

构建实测（解包 HAP）：

| 资源 | 源文件 | HAP 内 | 说明 |
|---|---|---|---|
| `app_icon` | `app_icon.svg`（1024） | **`resources/base/media/app_icon.png`（512×512）** | 构建工具链**自动**把启动器图标栅格化为 PNG |
| `start_icon` | `start_icon.svg`（512） | **`resources/base/media/start_icon.svg`（原样 SVG）** | 工具链**不**为它做转换 |

- `restool` 的 `--icon-check` 开关自述是 **"Enable the PNG image verification function for icons and
  startwindows"**（`restool -h`）——**图标与开屏窗口都按 PNG 校验**；本模块该开关是开启的。
- 既然工具链只把 `app_icon` 转成了 PNG，而把 `start_icon` 留作 SVG，**开屏标记就存在「渲染不出 / 空白」
  的风险**（系统开屏渲染器对 SVG 的支持未经证实）。
- ⇒ **决定：`start_icon` 显式以 PNG 交付**（`entry/src/main/resources/base/media/start_icon.png`，
  512×512 透明底，由源 SVG 用 macOS `sips` 栅格化 —— 见 §6.4 的源）。这是上一版 BRAND 里
  「SVG→PNG 保守回退」的落地：**空白 logo 的代价远大于一点点光栅化软度**。
- `app_icon` 保持 SVG 源（工具链会转 PNG）；**同一资源名不能同时存在 `.svg` 与 `.png`**
  ——实测报 `Resource 'start_icon' conflict`（`CompileResource` 失败），故 `start_icon.svg` 必须移除。

### 6.4 再生成（**唯一真源在代码里**，禁止手改资源）

标记是**比例驱动的几何**，全部收敛到 `entry/src/main/ets/core/brand.ets`（常量 + `bubblePath()` /
`starPath()` / `appIconSvg()` / `splashMarkSvg()`）。资源**由脚本生成**，不要手改：

```bash
bash tools/brand/gen.sh            # 生成/覆盖：app_icon.svg（AppScope + entry 两份）+ start_icon.png
                                   #   + brand_mark_outline.svg + brand_foreground.svg + brand_background.svg
bash tools/brand/gen.sh --check    # 只校验：与已提交资源逐字节比对（drift 门禁；含上面全部 6 个产物）
bash tools/brand/gen.sh --proofs /tmp/xbot-brand-proofs   # 另出浅/深开屏底色的 proof PNG（人工走查）
```

#### 6.4.1 通知小图标用的 **128×128 PNG 变体**（`brand_mark_128.png`）

**为什么**：`NotificationRequest.smallIcon?: image.PixelMap` 要的是**解码后的位图**，且 SDK 对图标推荐
**128×128**；`workreconcile/icons.ets`（orb-ux）此前**优先**解 `brand_mark_outline.svg`，而
"`createImageSource` 能不能吃 SVG"**未经任何验证** ⇒ 需要一份**保证可解码**、尺寸合规的 PNG 变体。

**资产**：`entry/src/main/resources/base/media/brand_mark_128.png`（**128×128、透明底、品牌紫
`#7C5CFF` 气泡 + 白星芒**；实测不透明像素 3744/3938 ≈ 95% 为品牌紫，与 `start_icon.png` 同形）。

**再生成（可复现，一行）**：
```bash
sips -z 128 128 entry/src/main/resources/base/media/start_icon.png \
     --out entry/src/main/resources/base/media/brand_mark_128.png
# 核验：尺寸 + 紫色仍在（纯 stdlib 探针）
sips -g pixelWidth -g pixelHeight entry/src/main/resources/base/media/brand_mark_128.png
python3 tools/brand/png_probe.py entry/src/main/resources/base/media/brand_mark_128.png --bbox-nontransparent
```
- **来源链**：`core/brand.ets`（几何/配色）→ `tools/brand/gen.sh` → `start_icon.png`（512×512）
  → `sips -z 128 128` → `brand_mark_128.png`。⇒ 任一环改了就**重跑这条**（`start_icon.png` 变了，本变体也得重出）。
- ⛔ **不改既有 SVG**（`brand_mark_outline.svg` / `brand_foreground.svg` / `brand_background.svg`）：
  它们是 §6.4 的产物与规格，本变体是**派生物**。
- ⚠️ **尚未并入 `tools/brand/gen.sh`**（该脚本归品牌资产维护者）⇒ 目前靠上面这条命令手工复现；
  若并入，`gen.sh --check` 的 drift 门禁应把它一并纳入。
- **消费方优先级（结论）**：`icons.ets` 应**优先 PNG**（保证可解码 + 尺寸合规）、**SVG 降为备选/增强** ——
  理由见回报（SVG 解码路径**无证据**，不该在关键路径上）。

- **可重复性**：生成器只从 `core/brand.ets`（+ `theme.ets` 取 token）产出；`sips` 栅格化已实测**确定性**
  （同输入两次跑出的 PNG `shasum` 完全一致）⇒ `--check` 三次全部"一致"。
- **改样式**：改 `core/brand.ets` 的常量（如 `STAR_R` / `TAIL_TIP_ROUND`）→ 跑 gen.sh → 跑
  `tools/tests/brand.test.ts`（几何/安全区/配色/产物一致的守护）。
- **改主色**：品牌主色 = `darkPalette().accent`（`brand.ets:brandAccent()`），**不是**在 SVG 里替换字符串
  —— 因为 `brand.ets` 直接 import token，色值天然同源。
- ⛔ `app_icon` 的 `.svg` 与 `start_icon` 的 `.png` **不能同名共存**（实测 `Resource conflict`），故启动器图标
  保持 SVG 源、开屏标记以 PNG 交付（见 §6.3）。

## 6.5 蒙版安全区（不被圆形/方形/圆角裁坏）+ 浅/深 proof

**问题**：启动器图标会被系统按 squircle / 圆形等蒙版裁切；分层图标（adaptive icon）还会把前景限制在
一个**安全区圆**内。若标记超出安全区，真机上就会被裁掉一角（而本地看源文件完全正常）。

**检算**（`core/brand.ets` 的纯函数 + `tools/tests/brand.test.ts` 的断言，可复现）：

| 量 | 值 | 判定 |
|---|---|---|
| 画布内切圆半径（圆形蒙版可见半径） | `512` | — |
| 标记最大半径（边中点 + 圆角弧最远点 + 尾巴尖的极值） | `393.9`（尾巴尖主导） | `< 512` ⇒ **圆形/方形/圆角蒙版都不裁** ✅ |
| 单色轮廓最大半径（= 393.9 + 1/2×描边 28） | `407.9` | `≤ 410`（样张建议最大半径）✅ |
| 分层图标前景安全区半径（108dp 里的 66dp ⇒ `33/108×1024`） | `313` | 原标记 `393.9 > 313` ⇒ **做分层时前景须缩进**；已由 `layeredForegroundScale()`（`0.7946`）缩到 `313.0` ✅（`brand_foreground.svg`） |
| 左右边距对称 | `224 == 1024-800` | ✅ |

> 结论：**当前单层图标**对圆形/方形/圆角蒙版都安全（余量 ~118px）。若将来改**分层图标**（见 §9 待验证项），
> 前景用已生成的 `brand_foreground.svg`（半径恰好 313，`foregroundFitsLayeredSafeZone()` 恒 true）；
> 未缩进的原始标记 `fitsLayeredSafeZone()` 仍为 false —— 它是"提醒"，不是 bug。

**浅/深两套开屏底色的 proof**（证明"同一标记在浅底与深底都成立"）：

```bash
bash tools/brand/gen.sh --proofs /tmp/xbot-brand-proofs
# 产出 proof_light.png（底 #F8FAFC = lightPalette().appBg）与 proof_dark.png（底 #0B0B0E = darkPalette().appBg）
```

实测（逐像素）：浅底四角 `(248,250,252)`、深底四角 `(11,11,14)`，两者标记中心均为白星 `(255,255,255)`、
气泡均为 `#7C5CFF` ⇒ **同一个标记在纯白/近白/近黑底上都可读**，无需为深浅各做一版标记。

**对比度实测**（`tools/tests/brand.test.ts`）：

| 组合 | 比值 | 阈值 | 判定 |
|---|---|---|---|
| 主色 `#7C5CFF` vs 浅底 `#F8FAFC` | `4.20:1` | ≥ 3:1（非文本图形） | ✅ |
| 主色 `#7C5CFF` vs 深底 `#0B0B0E` | `4.43:1` | ≥ 3:1 | ✅ |
| 白星 `#FFFFFF` vs 主色 `#7C5CFF` | `4.35:1` | ≥ 3:1 | ✅（**不到** AA 正文 4.5:1 —— 但星芒是图形不是文字） |

## 7. 启动器裁切 vs 开屏标记（为什么两者不同）

| 维度 | 启动器图标 `app_icon`（`icon`） | 开屏标记 `start_icon`（`startWindowIcon`） |
|---|---|---|
| 谁画 | 系统桌面/启动器 | 系统开屏窗口，居中压在 `startWindowBackground` 上 |
| 形状 | **满幅方块、不画圆角**——桌面按 squircle/圆形自行裁切；自绘圆角会「双圆角/露直角」 | **可有自己的形状**（这里是带尾巴的气泡）——它不被裁切 |
| 尺寸 | 系统缩到 48–72px 仍要可辨 | 常数倍居中，细节可略多 |
| 底色 | 满幅 accent（保证任意裁切下都是实心块） | 透明底（背景色由 `startWindowBackground` 给） |

> 判据一句话：**启动器图标交给系统裁，自己别画角；开屏标记自己定义形状**。

## 8. 与白色主题（`porcelain`）的关系

- `porcelain` 的 `appBg = #FFFFFF`（纯白，`core/theme.ets:273`）。开屏浅色变体取的是**基准浅画布** `#F8FAFC`
  （`lightPalette().appBg`），而非 porcelain 的纯白——因为开屏要覆盖「所有浅色系主题」，不能偏向某一套。
- 二者差异（`#F8FAFC` vs `#FFFFFF`）为极浅的近白差；在 porcelain 下是**可接受的一帧近白**，
  换取 `light` 主题下「开屏 = 首屏」的零跳色。
- 开屏标记自带颜色，在纯白/近白/近黑底上都可读，无需为 porcelain 另做一版。

## 9. SDK 约定与「待验证 / 待真机决策」清单

| 结论 | 证据 | 状态 |
|---|---|---|
| restool 有 `--icon-check`：「Enable the PNG image verification function for icons and startwindows」 | `restool -h`（SDK toolchains） | ✅ 已核实 |
| **本模块的 `--icon-check` 是开启的** | `hvigor-ohos-plugin` 的 `isEnabledIconCheck()`：entry 模块 + deviceTypes 含 phone/tablet + API≥10 + `app.bundleType==="app"` ⇒ true；本模块全部满足 | ✅ 已核实（读 hvigor 源码） |
| 开屏底色**默认跟随系统深浅色** | `startWindow.json` schema：`startWindowColorModeType` default = `FOLLOW_SYSTEM` | ✅ 已核实（本波新增） |
| 构建会把 `app_icon.svg` 自动转 **512×512 PNG** 打进 HAP，而 `start_icon.svg` 原样保留 | 解包 HAP：`resources/base/media/app_icon.png` + `resources/base/media/start_icon.svg` | ✅ 已核实（本波新增） |
| **`.svg` 开屏标记在真机开屏窗口能否渲染** | 无法本地复现系统开屏渲染器 | ⚠️ **待真机验收**（本波已改用 PNG 规避） |
| **HarmonyOS 分层图标（layered icon）形状** | 官方文档 + 社区实证：`AppScope/.../media/layered_image.json` = `{"layered-image":{"background":"$media:...","foreground":"$media:..."}}`；`app.icon` 指向 `$media:layered_image`（DEV 社区《Detailed Explanation of HarmonyOS App.json5 Configuration》+ 实证贴） | ✅ **已核实**（本地 SDK/hvigor 无 schema，以文档为准）；资源已就位（§5），配置待拍板（§12.2） |
| **分层图标：AppScope 覆盖 module 同名资源** | 社区实证 ⇒ 两边文件名/图形须一致，或只在 AppScope 配（推荐） | ⚠️ 已记入 §12.2（本仓两侧由同一真源生成、逐字节相同 ⇒ 无冲突） |
| **分层图标需卸载重装才刷新** | 社区一致结论：桌面图标有系统级缓存 ⇒ 卸载重装会清 App 数据 | ⚠️ **必须用户拍板**（§12.2） |
| **`startWindowColorModeType: FOLLOW_APPLICATION` 能否消除冷启动跳色** | 机制存在（schema 已核实），但需 `startWindow` profile 接管启动页且与 `EntryAbility.onCreate` 的 `setColorMode` 时序耦合 | ⚠️ **待真机决策**（见 §4.2） |

### 待真机回退（若主 agent 装机发现图标/开屏仍不显示）

1. 启动器图标若仍异常：用任意 SVG→PNG 工具把 `app_icon.svg` 栅格化为 **512×512 PNG**，
   同名存为 `app_icon.png`（**同名会与 .svg 冲突，须先删 .svg**），引用链参数不变。
2. 若桌面要求分层图标：需在 `AppScope/resources/base/media/` 增加
   `foreground.*` + `background.*` 与 `layered_image.json`，并把 `app.json5` 的 `icon`
   指向 `$media:layered_image` —— **该 API 形状未经本地核实，必须先查 DevEco 文档再动**。

## 10. 需要用户拍板 / 尚未做的项（2026-10-11 品牌波）

| # | 项 | 为什么没做 | 需要什么 |
|---|---|---|---|
| 1 | **App 内启动动效（真正的"开屏动画"）** | 系统 `startWindow` 是**静态**的（无法动画）；App 内首帧是 `pages/Index.ets:2605 LoadingView`（转圈 + "xbot"），**`pages/Index.ets` 与 `components/**` 不在本波文件边界** | 批准后新增一个 splash 组件/页面（注意本仓"同一时刻只有一个在飞动效"铁律 `DESIGN-SYSTEM.md §8`） |
| 2 | **冷启动跳色**（系统浅、应用选深，或反之）| 开屏底色**跟随系统**（`FOLLOW_SYSTEM` 默认，§4.2）；应用色板由 `EntryAbility.onCreate` 的 `setColorMode` 决定 ⇒ 二者不一致时"开屏 → 首帧"跳一帧 | 改用 `startWindow` profile + `FOLLOW_APPLICATION`（要改 `module.json5` ⇒ 配置拍板）；见 §4.2 |
| 3 | **分层图标（adaptive icon）** | **形状已核实**（§9）；启用需改 `AppScope/app.json5` 一行 `icon`（§12.2） | 配置拍板；**资源已就位**：`AppScope/.../brand_foreground.svg`（前景，半径恰 313）+ `brand_background.svg`（背景）+ `layered_image.json`。⚠️ 需卸载重装（清数据） |
| 4 | **品牌主色 `#7C5CFF` 调整** | 改主色影响全应用（token）与 web 对齐 | **只出建议**：白底族上 `#7C5CFF` vs `#FFFFFF` 对比约 4.3:1，若要做"纯白主题专属 logo"，可评估加深一档（如 `#6A4CF0`）——**但要用户拍板且需同步 `theme.ets`（不在本波边界）** |
| 5 | **真机开屏/桌面图标截图** | 系统开屏是**亚秒级**、且模拟器为共享资源（拍照需抢时序）| 见交付 ④ 的说明 |

> 一并以**代码级 + 构建级**证据交付：`core/brand.ets` + `tools/brand/gen.sh`（可重复生成）+
> `tools/tests/brand.test.ts`（几何/安全区/配色/产物一致的守护）+ 浅/深 proof PNG。

## 11. 降级链（presentation ladder）—— 品牌呈现的**唯一判据**

依据样张 `docs/mockups/brand-splash.html §③` 与 `docs/REDESIGN-INPUT-BRAND.md §3.3/§3.4`。
四档（信息量从大到小）：**满幅品牌色 → 实心标记 on 中性白 → 单色轮廓 → wordmark**。

判据**全部收敛到 `core/brand.ets: markLevelFor(BrandSurface)`**（纯逻辑、可脱机单测）：

| 上下文（`BrandSurface`） | 结果 | 说明 |
|---|---|---|
| 可用边长 > 0 且 < `MARK_MIN_GLYPH_VP`(24vp) | `wordmark` | 几何标记糊成一团 |
| `monochrome`（无障碍/黑白/低功耗） | `outline` | 零填充零发光 |
| 已测对比度 < `MARK_GRAPHIC_MIN_RATIO`(3:1) | `outline` | 轮廓线仍可辨 |
| 深色面 | `full` | 满幅品牌色 + 反色 glyph |
| 浅色面（白主题） | `solid` | 实心品牌色 glyph on 中性白；**永不** `full` |

各档的资源与生成：`full` → `app_icon.svg`；`solid` → `start_icon.png`；`outline` → `brand_mark_outline.svg`；
`wordmark` → 纯文字（`Text('xbot')`，非图片资源）。⛔ 白主题一律**不靠发光/渐变**（宪法 §3.1）。

守护：`tools/tests/brand.test.ts` §⑦⑧⑨⑩（对比度口径自洽 / 判据真值表 / 各档 SVG 纪律 / 产物一致），
`process.exit` 非 0；判据改坏即红（mutation 已自证）。

## 12. 待用户拍板的**配置面**补丁（纯资源侧已做到天花板 —— 精确 diff）

以下两处**必须动配置**才能生效 ⇒ 本波**不改**，只给精确补丁（改哪行 / 为什么必须 / 影响 / 回滚）。
**§12.2 的 API 形状已核实、资源已就位**（只差一行配置）；§12.1 无需卸载重装，是**优先推荐**项。

### 12.1 开屏底色跟随**应用**主题（消「冷启动跳色」，§4.2 / §10 #2）—— ⚠️ **已真机证实 `FOLLOW_APPLICATION` 不生效**；改用 base 资源取值（2026-10-11）

> **真机结论（2026-10-11，实测）**：`startWindowColorModeType: FOLLOW_APPLICATION` **没能**让 T0 跟随应用主题
> —— 系统浅色 + 应用深色时，T0 仍是 `base` 的 `#F8FAFC`（白闪）。**根因**：T0 系统开屏由**系统**在
> **应用代码运行之前**绘制；而"应用色模式"只能由运行时 `ApplicationContext.setColorMode` 设定，且 SDK
> 文档明确要求它"**在窗口已创建 + 页面已 loadContent 之后**"调用（`ApplicationContext.d.ts` 的
> `setColorMode` NOTE）⇒ 生成 T0 时根本拿不到应用色模式 ⇒ `FOLLOW_APPLICATION` 回退成系统深浅。
> **实测证据**：(i) 补一次"按文档时机"的 `setColorMode`（`onWindowStageCreate` 的 loadContent 回调里）
> 后，冷启 #1/#2 的 T0 **仍是 `#F8FAFC`**；(ii) 只把 `base` 的 `start_window_background` 改成 `#0B0B0E`
> ⇒ T0 **立刻变 `#0B0B0E`**（=资源被采用、且 base 决定系统浅色下的取值）。
> ⇒ **真判据是 base 资源值，不是 profile 的 colorModeType**。
>
> **已落地的修复（(c) 最小代价替代）**：`entry/src/main/resources/base/element/color.json` 的
> `start_window_background` 由 `#F8FAFC` 改为 **`#0B0B0E`**（= 应用**默认主题 dark** 的画布色）。
> profile（`FOLLOW_APPLICATION`）保留 —— 它在**支持的平台**上是"更好"的机制（会精确跟随应用主题），
> 在此平台退化为"跟随系统"，而此时 base 已是深色 ⇒ **最坏也只是深色**。
>
> **谁闪、闪多久（如实记账）**：
> - **应用主题=dark（本应用默认，绝大多数）**：T0 = `#0B0B0E` = 首帧画布 ⇒ **零跳色**（不管系统深浅）。
> - **应用主题=light/porcelain**：T0 现在 = `#0B0B0E`（深）→ 首帧浅色 ⇒ **反方向闪一次黑**（≈0.24–0.5s，
>   即系统开屏的停留时长）。**这是这次修复的代价**——把"深色用户白闪"换成"浅色用户黑闪"；
>   因为本应用**默认主题是 dark**、且设计系统以深色玻璃为主，选择"默认用户零闪"。
> - 真机判据：连拍冷启前两帧，底色应为 **`#0B0B0E`**（不再是 `#F8FAFC`）。

**历史（已被上条取代）**：`module.json5` 未声明 `startWindow` profile ⇒ 系统默认 `FOLLOW_SYSTEM`；开屏底色
的深浅只跟系统 ⇒ 「系统浅 + 应用选深（或反之）」时开屏 → 首帧**跳一帧色**。
**补丁**（两处）：`module.json5:20` 已加 `"startWindow": "$profile:startWindow"`；
`entry/src/main/resources/base/profile/startWindow.json` 已新建（内容同下）。
**页面侧配合**（应用内开屏 T1）—— ⚠️ **2026-10-11 改为「品牌开屏恒深」（方案 (a)）**：
原 `SplashOverlay({ …, canvasFollowApp: true })`（T1 底色 = `paletteOf(theme).appBg`）**已废弃** ——
真机实证：画布绑在可变的 `themeName`（初值 `'dark'`）上 ⇒ 浅色主题用户在同一段展示期间看到画布由深翻白；
且 T0 系统开屏恒 `#0B0B0E`（见本节真机结论）⇒ 取主题色**必然**跳变。
现 T1 画布 = `core/splash.splashBrandCanvas()`（**恒定** = `darkPalette().appBg`，= T0 色 ⇒ **T0→T1 零跳色**），
`SplashOverlay` **不接 `theme`**（结构性保证"不随主题变化"）；T1→T3 由 T2 淡出（`animEaseOut()`，零超调）
过渡到应用主题（**渐隐，非硬切**）。品牌标记恒紫（`docs/DESIGN-SYSTEM.md §13.6`）。
`pages/Index.ets` 的 `aboutToAppear` 仍**同步**读回缓存主题初始化 `themeName`（供**页面首帧**与
`EntryAbility` 的系统表面，与开屏画布无关）。判据 = `tools/tests/splash.test.ts §①/§②/★H`。

```diff
# ① entry/src/main/module.json5 —— abilities[0] 内新增一行（保留既有 startWindowIcon/Background）
         "startWindowIcon": "$media:start_icon",
         "startWindowBackground": "$color:start_window_background",
+        "startWindow": "$profile:startWindow",
```
```json
// ② 新增 entry/src/main/resources/base/profile/startWindow.json（schema: toolchains/modulecheck/startWindow.json）
{
  "startWindowBackgroundColor": "$color:start_window_background",
  "startWindowAppIcon": "$media:start_icon",
  "startWindowColorModeType": "FOLLOW_APPLICATION"
}
```

- **为什么必须**：`startWindowColorModeType` 只有放在 `startWindow` profile 里才生效；这是**唯一**能让开屏
  跟应用色板（而非系统）的开关（schema 已核实其 enum 含 `FOLLOW_APPLICATION`）。
- **影响**：开屏底色改由应用 colorMode（`EntryAbility.onCreate` 的 `setColorMode`）决定；profile 一旦生效会
  **接管**开屏图标/背景的整条渲染路径（`startWindowIcon/Background` 两个字段可能被 profile 覆盖）。
- **是否需要卸载重装**：**不需要**。开屏页配置随安装生效（普通增量安装 `hdc install -r` 即可），
  它**不是**系统缓存物（与桌面图标不同）。⇒ 这是**可优先推给用户**的那个补丁。
- ~~**风险（未证）**~~ ⇒ ⚠️ **已真机证实为真问题**（见本节开头"真机结论"）：`FOLLOW_APPLICATION` **不生效**，
  T0 不跟应用主题。真正生效的是 **base 资源取值**。
- **回滚**：删 ① 那一行 + 删 ② 的文件即可（无其它副作用，亦无需卸载重装）。若要回到旧观感，
  把 `base/element/color.json` 的 `start_window_background` 改回 `#F8FAFC` 即可（但深色用户会白闪）。

### 12.2 分层图标（adaptive / layered icon）—— ✅ 形状**已核实** + 资源已就位

**现状**：单层图标（`app_icon.svg` 满幅 + glyph）。**分层资源已就位**（见下表），只差 `app.json5` 一行配置。

**官方 / 社区核实的 API 形状**（出处：DEV 社区《Detailed Explanation of HarmonyOS App.json5
Configuration》+ 多位开发者实证贴；⛔ 本地 SDK/hvigor 内搜不到 schema，故以文档为准）：

- 分层描述符 `AppScope/resources/base/media/layered_image.json`：
  `{ "layered-image": { "background": "$media:...", "foreground": "$media:..." } }`；
- `AppScope/app.json5` 的 `app.icon` 指向该描述符（`"$media:layered_image"`）；
- ⚠️ **实证坑**：AppScope 的资源会**覆盖** module 同名资源 ⇒ 两边文件名/图形必须一致，或**只在 AppScope 配**（推荐）；
- ⚠️ 前景/背景层建议 **1024×1024**（应用市场审核要求）—— 本仓两层均为 1024 画布 ✅。

**已就位的资源**（全部由 `bash tools/brand/gen.sh` 从 `core/brand.ets` 真源生成；
**entry 与 AppScope 两侧逐字节相同** —— 由 `tools/tests/brand.test.ts §⑩` 断言，不可能漂移）：

| 文件 | 内容 |
|---|---|
| `AppScope/resources/base/media/layered_image.json` | 分层描述符（静态资源；**未被引用时惰性 ⇒ 落地安全**） |
| `AppScope/.../brand_background.svg`（+ entry 同名一份） | 背景层：满幅品牌色，1024×1024 |
| `AppScope/.../brand_foreground.svg`（+ entry 同名一份） | 前景层：标记缩进 313 安全区（`scale 0.79459`），1024×1024 |

**补丁**（一行）：
```diff
# AppScope/app.json5
-    "icon": "$media:app_icon",
+    "icon": "$media:layered_image",
```

- **影响**：桌面图标由"单层满幅"变为"背景层 + 前景层"叠加；系统按自适应蒙版裁切前景。
- ⛔⛔ **生效代价（社区一致结论）**：桌面图标有**系统级缓存** ⇒ 需 **卸载重装**才能刷新
  ⇒ **会清掉 App 数据（登录态 / 设置）**。**必须由用户拍板**，⛔ 不要自行触发。
- **回滚**：`icon` 改回 `$media:app_icon`（同样需卸载重装才回收图标缓存）。

> ⛔ §12.1 / §12.2 两处补丁都**只动配置/资源**，不动任何 ArkTS 逻辑；应用内"首帧品牌标记入场"
> （§10 #1）另需 `pages/Index.ets`（`LoadingView`）接线 —— 那不在本波文件边界。
