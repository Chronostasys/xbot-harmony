# 重新设计输入 · 品牌与开屏（BRAND/SPLASH）

> **读者**：`design-lead`（新设计语言重构负责人）。
> **目的**：说明品牌/开屏**为什么"调样式救不了"**、新设计系统需要哪些**语义 token**、开屏**动效/过渡**的可行方案与红线、以及**待用户拍板**项。
> **背景**：用户方向已变 —— 「不是只调整样式，要做**大的重构重新设计**」「这样才能**超过苹果**」。
> **状态**：本文是**设计输入**，不含代码改动。品牌标记的几何/配色真源已由 `3956fee` 收敛到代码（见 §7），可直接作为新设计语言的起点或推翻重来。

---

## 0. 一句话结论

现在的品牌呈现是**三个互不相关的"logo" + 一套"满幅强调色"的开屏**，套在一个**玻璃拟态 + 低饱和画布**的主界面上。
问题不在"某处颜色不好看"，而在**四层结构性断层**：① 资源层与 token 层不相通；② 开屏跟系统而非跟应用主题；③ 图标/开屏是静态光栅、无分层语义；④ 品牌色与应用强调色（白色主题下）**不是同一个色**。
⇒ 只改样式（换色值、调圆角）**无法**消除这些断层，必须由新设计语言在**语义层**重定角色。

---

## 1. 现状：三套"品牌呈现"（逐条 file:line）

| 载体 | 文件 | 现在长什么样 |
|---|---|---|
| **启动器图标** | `AppScope/resources/base/media/app_icon.svg`、`entry/src/main/resources/base/media/app_icon.svg`（两份逐字节相同） | 满幅 `#7C5CFF` 方块 + 白气泡 + 紫星（1024²；系统桌面自行加蒙版） |
| **开屏标记** | `entry/src/main/resources/base/media/start_icon.png`（512² 透明底） | 紫气泡 + 白星（居中压在纯色底上） |
| **开屏底色** | `entry/src/main/resources/base/element/color.json:3`、`entry/src/main/resources/dark/element/color.json:3` | `start_window_background` = `#F8FAFC`（浅）/ `#0B0B0E`（深） |
| **开屏引用链** | `entry/src/main/module.json5:18-19` | `startWindowIcon:$media:start_icon` / `startWindowBackground:$color:start_window_background` |
| **App 内首帧** | `pages/Index.ets:2628-2629`（`LoadingView`） | `LoadingProgress(48)`（`accent`）+ 文字 `xbot` —— **无标记** |
| **登录页徽标**（第 3 个 logo） | `pages/Index.ets:2655-2671` | 108×108 渐变 squircle（`effect.gradientFrom→gradientTo`）+ 文字 `xbot` —— **与图标几何无关** |
| **登录页背景** | `pages/Index.ets:2639-2650` | 垂直渐变底 + 620² 径向辉光（`glowSoft`） |
| **登录 CTA** | `pages/Index.ets:2753-2761` | `Button('登录')` 渐变底（`gradientFrom→gradientTo`）+ `onAccent` 文字 |
| **主界面** | `pages/Index.ets:2683,2696,2732,2742,2791,2862` | 玻璃面 `eff().glassBg`（6 处）+ 低饱和画布 `pal.appBg` |
| **图标/开屏几何真源** | `core/brand.ets`（`3956fee`） | `bubblePath()` / `starPath()` / `appIconSvg()` / `splashMarkSvg()`；配色取 `darkPalette().accent/onAccent` |

---

## 2. 为什么"调样式救不了"（逐条 file:line）

### 2.1 结构性断层 ①：开屏色值在**资源层**，取不到**代码 token**

- `entry/src/main/resources/base/element/color.json:3` 与 `dark/.../color.json:3` 是**两个写死的六位十六进制**；它们由 `restool` 在**编译期**消费，**无法引用 `core/theme.ets` 的 `darkPalette().appBg` / `lightPalette().appBg`**。
- 已有的"纪律"只能靠**人工**（`docs/BRAND.md §4.3`：「改这个值的 PR，值必须能指到 `core/theme.ets` 的某个 `appBg`」）。
- ⇒ 换新设计语言时，只要画布 token 一改，这两个 JSON **必须手工同步**，否则冷启动"跳色"（开屏色 ≠ 首帧色）。这正是"样式层改不动系统"的根。

### 2.2 结构性断层 ②：开屏跟随**系统**深浅，不跟随**应用主题**

- `module.json5` 未声明 `startWindow` profile ⇒ 用 SDK 默认 `FOLLOW_SYSTEM`（证据：`docs/BRAND.md §4.2`，本地 `startWindow.json` schema）。
- 但应用主题由 `entryability/EntryAbility.ets:33-37` 的 `setColorMode(...)` 在 `onCreate` 决定（读本地缓存的**应用**主题）。
- ⇒ 用户选 `porcelain`（纯白 `core/theme.ets:318`）而系统深色时：**开屏=深色 `#0B0B0E` → 首帧=纯白**，跳一帧。白色主题（用户点名的场景）**必然踩到**。

### 2.3 结构性断层 ③：图标/开屏是**静态资源**，无分层、不能随主题/尺寸自适应

- 单层图标（无 `foreground.*`/`background.*`/`layered_image.json`）⇒ 无法表达"前景 glyph + 背景层"的语义。
- 已算出的**裁切风险**：标记最大半径 **393.9**（`core/brand.ets:markMaxRadius()`），而分层图标前景安全区半径 = `33/108×1024 ≈ 313` ⇒ 气泡尾巴会**被裁**（`tools/tests/brand.test.ts` 的 `fitsLayeredSafeZone()` 现为 false）。
- 图标一旦生成就是**光栅/矢量文件**：不能随深浅主题变色、不能动画、不能在小尺寸自动简化细节。

### 2.4 结构性断层 ④：**品牌主色 ≠ 应用强调色**（白色主题下直接冲突）

| 场景 | 品牌色 | 应用强调色 | 结果 |
|---|---|---|---|
| 启动器/开屏 | `#7C5CFF`（`core/brand.ets:brandAccent()` ← `darkPalette().accent`） | — | 紫 |
| 主界面（`dark`） | — | `#7C5CFF`（`core/theme.ets:118`） | 一致 ✅ |
| 主界面（`porcelain` 白色主题） | — | **`#0071E3` Apple Blue**（`core/theme.ets:334`） | **紫图标 + 蓝界面** ✗ |

- 用户点名「配合一套**特制的、原生独享的白色主题**」⇒ 白色主题下，**品牌标记（紫）与界面强调色（蓝）各说各话**。这不是"颜色没调好"，是**角色缺失**：现在没有"品牌主色"这个独立于 `accent` 的语义角色。

### 2.5 视觉语言断裂：开屏"满幅强调色" vs 主界面"玻璃/低饱和"

- 开屏 = **满幅品牌色方块**（`app_icon.svg`）+ 纯色底（`color.json`）；系统 `startWindow` 是**静态**的。
- 主界面 = **玻璃拟态**（`eff().glassBg`，`core/theme.ets:534` `glassBg = glassBase@62%`）+ 低饱和画布 + 玻璃描边（`:535`）+ 柔影。
- App 内首帧 `LoadingView`（`pages/Index.ets:2628-2629`）= **系统转圈 + 文字**，与"品牌标记"**毫无关系**。
- ⇒ 三段拼起来读作："Android 图标 → iOS 转圈 → iOS 玻璃界面"，**没有形成一条品牌线**。

### 2.6 白色主题下"靠什么立住"——现在是靠**发光/渐变**（要避免的方向）

- 登录页顶部**径向辉光**（`pages/Index.ets:2646-2650`，`glowSoft = accent@22%`，`core/theme.ets:538`）。
- 登录**徽标/CTA 渐变**（`pages/Index.ets:2666-2669, 2758-2761`，`gradientFrom=accent → gradientTo=accentSoft`）。
- 这些手段在白底上"发光"几乎不可见、渐变最亮端对比度掉到 **2.09:1**（见 §5.1）。新设计在白色主题下**必须换一套立得住的表达**（实心/描边/负形），**不能靠发光**。

### 2.7 散落的硬编码（新设计系统的"待收编"清单）

| 位置 | 内容 | 性质 |
|---|---|---|
| `entryability/EntryAbility.ets:81-82` | 状态栏/导航栏前景 `'#FFFFFF'` / `'#000000'` | 系统 API **只收字符串** ⇒ 结构性（需 token→字符串的导出层） |
| `core/accent.ets:13,16` | `DEFAULT_ACCENT='#3388BB'`、6 个预设色 + 中文名（`:21-26`） | 用户自定义强调色的**独立色源**，未接入新品牌角色 |
| `core/accent.ets:89-92` | `onColorFor` 返回 `'#0B0B0E'`/`'#FFFFFF'` | 对比度取色，同样是字面量 |
| `core/mdtheme.ets:90-100` | 代码高亮主题的十几组底色/前景 | 第三方主题镜像，可保留但需纳入 token 台账 |

> 统计：`core/theme.ets` 之外现仍有 **57 处** `#RRGGBB`（含上面四类）—— `docs/theme` 自称"唯一颜色来源"的口径在新设计系统下需要重新划线。

---

## 3. 对新设计系统的需求

### 3.1 logo 需要的**语义 token**（建议）

| token（角色） | 用途 | 备注 |
|---|---|---|
| `brand.primary` | 品牌主色**角色**（≠ `accent`；启动器/开屏/徽标共用） | 现为 `#7C5CFF`；是否保留见 §5.1 |
| `brand.on-primary` | 标记反色（气泡/星芒反相） | 现为 `#FFFFFF` |
| `brand.mark.foreground` | **分层图标前景**（glyph 只含此二色） | 新增，为 layered 做准备 |
| `brand.mark.background` | **分层图标背景**（满幅色块） | 新增 |
| `splash.canvas.light` / `splash.canvas.dark` | 开屏底（**与主题无关**的中性档，或"跟应用主题"档） | 现为字面量 `#F8FAFC`/`#0B0B0E`（§2.1） |
| `splash.mark.surface` | 开屏标记的承载面（玻璃/卡片，**与主界面同源**） | 用于"标记压在玻璃卡上"以接上 §2.5 的断层 |

### 3.2 底色**层级**与对比度**下限**

- 需要一条**统一层级**：`canvas(底) → surface(面板) → surfaceAlt(次级) → sunken(下沉)`（现已在 `core/theme.ets:674+ Surfaces` 部分存在），开屏必须能落到这套层级里（而不是自成一套"纯色底"）。
- **对比度下限**（建议写进新 token 台账）：
  - 品牌**图形**（标记、图标）≥ **3:1**（WCAG 2.1 §1.4.11 非文本）；
  - 品牌**文字**（logo 文字版、"xbot" 字样）≥ **4.5:1**（AA）；
  - 玻璃面上的文字按**合成后**颜色判（`core/theme.ets:648+` 已有合成口径）。

### 3.3 开屏在**白色主题**下应该怎么做（⛔ 不许靠发光）

- **原则**：白色主题 = **低饱和画布 + 一个实心品牌标记**（或负形/描边），**不用** `glowSoft`/`gradientFrom`（§2.6 失效手段）。
- 建议三档（新设计语言里定义优先级）：
  1. **满幅品牌色**（深色底/启动器图标）：标记 = 反色 glyph 压在 `brand.primary` 上；
  2. **实心标记 on 中性白**（浅色底/白色主题）：标记 = `brand.primary` glyph 压在 `splash.canvas.light` 上（**无发光**）；
  3. **单色轮廓**（极端降级：极低功耗/黑白/无障碍）：`brand.primary` 描边 glyph，零填充、零发光。

### 3.4 深/浅两套下的**最小安全区**与**降级方案**

| 约束 | 值 | 来源 |
|---|---|---|
| 圆形/方形/圆角蒙版可见半径 | **≤ 512**（内切圆） | `core/brand.ets:ICON_INSCRIBED_RADIUS` |
| 建议**留白后**的标记最大半径 | **≤ 0.8×512 ≈ 410** | 现设计 393.9，余量 ~4%（偏紧，新设计建议放宽） |
| 分层图标**前景安全区半径** | **≤ 313**（66/108×1024） | `core/brand.ets:LAYERED_SAFE_RADIUS` |
| 降级链 | 满幅色 → 实心标记 → 单色轮廓 → 纯文字 wordmark | 本文 §3.3 |

---

## 4. 开屏动画 / 过渡方案（**建议给 design-lead 的落点**）

### 4.1 红线（必须遵守）

- ⛔ **同一时刻只允许一个"在飞动效" = 光球**（`docs/DESIGN-SYSTEM.md §8.2`，`components/anim.ets:63-78`）。
- **开屏动效属于"一次性过渡"，不是"在飞"** ⇒ 它**不得**与光球并发、**不得**做成循环/常驻呼吸。
- **必须走动效底座** `components/anim.ets`（全仓唯一 `@ohos.curves` 出口）；⛔ **不新造时长/曲线**（现有：`animFast` 180ms / `animBase` 220ms / `animMsgIn` 200ms / `animSlow` 320ms / `animSpring` 物理弹簧）。
- ⛔ **不得让启动变慢**：过渡只在**首帧之后**、且**不阻塞** `bootstrap()`（`pages/Index.ets:722`）。

### 4.2 建议方案（三段，全部为一次性）

| 阶段 | 内容 | 时长/曲线 | 依据 |
|---|---|---|---|
| A. 系统开屏（不可控） | 静态标记 + `startWindowBackground` | 系统决定 | `module.json5:18-19` |
| B. 品牌标记入场 | 标记 `scale 0.92→1` + `opacity 0→1`，**一次** | `animBase()`（220ms，spring `cubic-bezier(0.34,1.56,0.64,1)`）或 `animSpring()` | `components/anim.ets:39,58` |
| C. 让位主界面 | 标记 `opacity 1→0` / 上移消隐，交棒首帧内容 | `animSlow()`（320ms）或与 B 合并 | `components/anim.ets:49` |

### 4.3 **何时必须不做动效**（硬兜底）

1. **`reduceMotion` 为真** ⇒ **直接静态呈现**（同源开关：`components/LiveTailView.ets:156`、`components/AssistantOrb.ets:263` —— 一处取值、全应用生效）。
2. **App 在后台 / 不可见** ⇒ 停表，不累积相位（同 `core/orb.ets:181` 的"停表"纪律）。
3. **冷启动预算紧张**（低端机/首帧卡顿）⇒ 降级为**零动效**（B/C 段整体跳过），只保留静态标记。
4. **任何"呼吸/脉冲"**都不属于开屏 —— 那是"在飞"的语言，开屏**不许**借用。

---

## 5. 待用户拍板项

### 5.1 品牌主色 `#7C5CFF` 是否更换（**附实测对比度**）

| 组合 | 实测 | AA 4.5:1 | 非文本 3:1 |
|---|---|---|---|
| 白星 `#FFFFFF` on 主色 `#7C5CFF` | **4.35:1** | ✗（差 0.15） | ✅ |
| 登录 CTA 文字 on 渐变**最亮端** `accentSoft #B9A7FF` | **2.09:1** | ✗✗ | ✗ |
| 主色 vs 浅底 `#F8FAFC` | 4.20:1 | — | ✅ |
| 主色 vs 深底 `#0B0B0E` | 4.43:1 | — | ✅ |

- 影响面：改 `brand.primary` 会**同时**影响启动器图标/开屏标记**与**`dark/aurora/nebula` 的主色（`core/theme.ets:118,232,271` 用的是同一个值），且需与 web 对齐。
- ⛔ 本波**不动**它（`core/theme.ets` 不在边界内）——**仅出建议**：若要在白色主题下让品牌标记达 AA，可评估加深一档（例如 `#6A4CF0` 一带，需实算后定）。

### 5.2 其它需要拍板

| # | 决策 | 现状 | 影响 |
|---|---|---|---|
| 1 | 是否启用 `startWindow` profile + `FOLLOW_APPLICATION`（消冷启动跳色） | 默认 `FOLLOW_SYSTEM`（§2.2） | 要改 `module.json5`（配置） |
| 2 | 是否采用**分层图标**（foreground/background + `layered_image.json`） | 单层（§2.3） | 要改 `app.json5` 的 `icon`；API 形状待核实 |
| 3 | 白色主题下品牌标记用**品牌紫**还是**统一到 Apple Blue** | 紫图标 + 蓝界面（§2.4） | 决定 `brand.primary` 与 `porcelainPalette().accent` 是否合并 |
| 4 | 是否引入 App 内**品牌开屏页**（真·动效载体） | 无（首帧是转圈） | 新增页面/路由，需用户批准；须遵守 §4 红线 |

---

## 6. 现有可复用资产（新设计可直接用/推翻）

| 资产 | 路径 | 说明 |
|---|---|---|
| 品牌几何/配色**唯一真源** | `core/brand.ets` | 常量 + `bubblePath()`/`starPath()`/`appIconSvg()`/`splashMarkSvg()` + 安全区检算；**设计改了只需改这里** |
| 可复现**生成器** | `tools/brand/gen.sh` + `tools/brand/emit.js` | `--check` 校验漂移、`--proofs` 出浅/深 proof；⛔ 不许手改二进制 |
| 像素核验工具 | `tools/brand/png_probe.py` | 纯 stdlib PNG 解码器（无 PIL 环境可用） |
| **品牌门禁** | `tools/tests/brand.test.ts`（42 断言） | 配色同源 / 对比度 / 安全区 / path 确定性 / 产物一致 |
| 动效底座 | `components/anim.ets`、`core/motion.ets` | 唯一 `@ohos.curves` 出口；时长/曲线都在这里 |
| 色彩/派生系统 | `core/theme.ets`（`Palette`/`Effects`/`Surfaces`）、`core/tokens.ets` | 五套色板 + 玻璃/层级/发丝派生 + 尺度字阶 |
| 设计判据文档 | `docs/BRAND.md`（含 §6.5 安全区、§10 待拍板）、`docs/DESIGN-SYSTEM.md`（含 §8 在飞铁律） | 改品牌前必读 |

---

## 7. 本波纪律声明（已遵守）

- `3956fee`（品牌唯一真源 + 生成器 + 蒙版安全区/对比度门禁）**保持不动**；工作树中品牌相关文件**已全部提交、干净**，无"纯调样式"半成品。
- 本文档**只**新增设计输入，**未**新增在飞动效、**未**新增色值字面量、**未**改服务端、**未**触碰 `core/theme.ets` / `core/design.ets`（后者尚不存在）。
