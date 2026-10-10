# 品牌与开屏（BRAND）—— xbot 原生端

> 本文件是 **应用图标 / 开屏（startWindow）** 的唯一判据。
> 改图标或开屏前先读这里；颜色一律取设计系统 token，**禁止颜色字面量另起一套**
> （见 `docs/DESIGN-SYSTEM.md` 与 `entry/src/main/ets/core/theme.ets`）。

## 0. 一句话

**一枚满幅强调色方块 + 白色对话气泡 + 同色四角星芒**——极简两色，无渐变、无描边、无阴影。

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
| 星芒中心 | `(512, 466)` = 气泡主体中心 | 必须与气泡主体同心 |
| 星芒半径 | `120`（四个尖点各距中心 120，控制点全在中心） | 直径 ≈ 气泡高的 51%（本地栅格化实测尖点落在 ±120） |

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

### 6.4 再生成（比例驱动）

标记是**比例驱动的几何**，改样式只需改 §2 的坐标，再等比缩放：

- **开屏标记（现为 PNG）**：先用下面这份 512 画布源重画，再 `sips -s format png <src.svg> --out start_icon.png`：

  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <path fill="#7C5CFF" d="M 186 116 H 326 A 74 74 0 0 1 400 190 V 276 A 74 74 0 0 1 326 350
      H 238 L 150 422 L 150 350 H 186 A 74 74 0 0 1 112 276 V 190 A 74 74 0 0 1 186 116 Z"/>
    <path fill="#FFFFFF" d="M 256 173 Q 256 233 316 233 Q 256 233 256 293 Q 256 233 196 233
      Q 256 233 256 173 Z"/>
  </svg>
  ```

- **启动器图标（保持 SVG 源）**：直接改 `app_icon.svg` 的几何；换主色把 `#7C5CFF` 全量替换为新
  `accent` 值；换尺寸只改 `<svg width height viewBox>` 的第二/三位，**不要**改 path 坐标。

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
| **HarmonyOS 分层图标（layered icon）落法** | 全 SDK / hvigor 插件内**搜不到** `layered_image` / `layeredImage` 任何约定或 schema（仅 hvigor 有一条资源压缩告警提到「layered launcher icon」） | ⚠️ **待验证**（故采用**单层**图标 —— 保守方案） |
| **`startWindowColorModeType: FOLLOW_APPLICATION` 能否消除冷启动跳色** | 机制存在（schema 已核实），但需 `startWindow` profile 接管启动页且与 `EntryAbility.onCreate` 的 `setColorMode` 时序耦合 | ⚠️ **待真机决策**（见 §4.2） |

### 待真机回退（若主 agent 装机发现图标/开屏仍不显示）

1. 启动器图标若仍异常：用任意 SVG→PNG 工具把 `app_icon.svg` 栅格化为 **512×512 PNG**，
   同名存为 `app_icon.png`（**同名会与 .svg 冲突，须先删 .svg**），引用链参数不变。
2. 若桌面要求分层图标：需在 `AppScope/resources/base/media/` 增加
   `foreground.*` + `background.*` 与 `layered_image.json`，并把 `app.json5` 的 `icon`
   指向 `$media:layered_image` —— **该 API 形状未经本地核实，必须先查 DevEco 文档再动**。
