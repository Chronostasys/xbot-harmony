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
bash tools/brand/gen.sh --check    # 只校验：与已提交资源逐字节比对（drift 门禁）
bash tools/brand/gen.sh --proofs /tmp/xbot-brand-proofs   # 另出浅/深开屏底色的 proof PNG（人工走查）
```

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
| 标记最大半径（边中点 + 圆角弧最远点 + 尾巴尖的极值） | `≈ 393.9`（尾巴尖主导） | `< 512` ⇒ **圆形/方形/圆角蒙版都不裁** ✅ |
| 分层图标前景安全区半径（108dp 里的 66dp ⇒ `33/108×1024`） | `313` | 标记 `393.9 > 313` ⇒ **做分层时前景需缩进** ⚠️（当前是**单层**图标，不依赖它） |
| 左右边距对称 | `224 == 1024-800` | ✅ |

> 结论：**当前单层图标**对圆形/方形/圆角蒙版都安全（余量 ~118px）。若将来改**分层图标**（见 §9 待验证项），
> 必须把前景缩进到 313 半径内（`tools/tests/brand.test.ts` 的 `fitsLayeredSafeZone()` 会提醒）。

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
| **HarmonyOS 分层图标（layered icon）落法** | 全 SDK / hvigor 插件内**搜不到** `layered_image` / `layeredImage` 任何约定或 schema（仅 hvigor 有一条资源压缩告警提到「layered launcher icon」） | ⚠️ **待验证**（故采用**单层**图标 —— 保守方案） |
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
| 3 | **分层图标（adaptive icon）** | `layered_image` 落法在本地 SDK/hvigor **搜不到**（§9）；且启用需改 `app.json5` 的 `icon` | 查 DevEco 文档 + 配置拍板；本波已把前景安全区约束与检算备好（§6.5） |
| 4 | **品牌主色 `#7C5CFF` 调整** | 改主色影响全应用（token）与 web 对齐 | **只出建议**：白底族上 `#7C5CFF` vs `#FFFFFF` 对比约 4.3:1，若要做"纯白主题专属 logo"，可评估加深一档（如 `#6A4CF0`）——**但要用户拍板且需同步 `theme.ets`（不在本波边界）** |
| 5 | **真机开屏/桌面图标截图** | 系统开屏是**亚秒级**、且模拟器为共享资源（拍照需抢时序）| 见交付 ④ 的说明 |

> 一并以**代码级 + 构建级**证据交付：`core/brand.ets` + `tools/brand/gen.sh`（可重复生成）+
> `tools/tests/brand.test.ts`（几何/安全区/配色/产物一致的守护）+ 浅/深 proof PNG。
