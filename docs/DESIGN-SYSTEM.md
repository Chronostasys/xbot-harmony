# 设计系统（原生端）—— "深空仪表盘"

> 目的：让 UI 改造**有判据**，而不是凭感觉堆样式。
> 本轮（2026-10）用户否决过一版"到处描边 + 多色混用"的界面，本文是重做后沉淀的纪律。

## 0. 一句话

**底色与主色同色相（紫）、靠亮度阶梯与留白分层、颜色只留给"进行中/失败"、图标一律用系统矢量符号。**

## 1. 三层来源

| 层 | 文件 | 内容 |
|---|---|---|
| 1. 令牌 | `core/theme.ets` | `Palette`（24 语义角色）+ `Effects`（玻璃/光晕/渐变/层级阴影） |
| 2. 尺度 | `core/tokens.ets` | 圆角 5 档 / 间距 8 档 / 字阶 4 档 / 动效时长 3 档 |
| 3. 使用 | `pages/Index.ets`、`components/*.ets` | 一律 `this.pal()` / `this.eff()` 取色，**禁止颜色字面量** |

## 2. 硬性纪律（违反即回归）

1. **禁颜色字面量**：页面/组件里只能 `pal()` / `eff()`。
   自检：`grep -rnoE "#[0-9a-fA-F]{3,8}\b" entry/src/main/ets/pages entry/src/main/ets/components | wc -l` 应为 **0**。
2. **`accentSoft` 必须是紫系**。历史 bug：它曾是浅蓝 `#93C5FD`，与紫主色 `#7C5CFF` 打架，导致蓝/紫/绿/红同屏。
   守护测试：`tools/tests/theme.test.ts`「强调浅色同色相(紫)」。
3. **`border` ≠ `surfaceHi`**。历史 bug：两者都曾是 `#1F2937`，描边与填充撞色。
   守护测试：`tools/tests/theme.test.ts`「边框与选中面不同值」。
4. **亮度阶梯每级约 8%**：`appBg #0B0B0E → surface #0E0E14 → surfaceAlt #14141C → surfaceHi #1D1D28`。
   差 <5% 会导致"整屏糊成一块黑"。
5. **少用描边**。分层优先用**填充亮度**；只在这两种情况下用 `border`：
   (a) 输入区聚焦态；(b) 顶栏/弹层的**单边**发丝线（`borderWidth({bottom:1})`）。
6. **玻璃必须锁深色模式**：`backgroundBlurStyle(BlurStyle.Thin, { colorMode: ThemeColorMode.DARK })`。
   默认是 `ThemeColorMode.SYSTEM`，**系统浅色时材质会渲染成浅灰**，压在深色 UI 上就是"割裂"（已踩）。
7. **颜色纪律**：只有"运行中"（accent / accentSoft）与"失败"（danger）可以有颜色。
   已完成/中性态一律 `textMuted` —— 几十个绿点是全局最花的噪音源。
8. **图标禁用 emoji**：用 `SymbolGlyph($r('sys.symbol.<name>'))`。
   ⚠️ `✳ 📎 ➕` 这类字符在部分字体下走 **emoji 字形**（彩色、无法用 `fontColor` 控制）。
   ⚠️ 符号名**必须**在 `toolchains/id_defined.json` 的 `record[type=="symbol"].name` 里核实存在，
   否则编译失败。常用：`line_3_horizontal` `square_grid_2x2` `gearshape` `paperclip` `picture`
   `paperplane_fill` `square_fill` `xmark` `chevron_right` `chevron_down`（`sparkles`/`ellipsis` **不存在**）。
9. **主题**：`dark` / `light` / `aurora(#34d3b4)` / `nebula(#a78bfa)` / `porcelain(#0071E3，极简白，原生独享)`,
   由 `paletteOf(themeName)` 统一供给。
   ⛔ 新增/修改主题时必须同步 `tools/tests/theme.test.ts` 的快照值（它会逐值核对关键角色）。
   ⛔ `toggleTheme` 是**深/浅二态**（测试钉死），极光/星云/极简白经 `normalizeTheme` + `paletteOf` 进入。
   ⛔ 明暗判据有两把：`isDarkThemeName(theme)`（按**名**，porcelain 归浅色）与
   `isLightPalette(palette)`（按 **appBg 亮度**，供只拿得到 Palette 的调用点用，如 `effectsOf` /
   `mdtheme.codeBgOf`）——**不要**再把某个色板的 appBg 当魔法常量判浅色。浅色主题的阴影走
   `effectsOf` 的柔影分支（正文色 @6/10/16% + 中性 sheen），深色四值不动。

## 3. 常用尺度（`core/tokens.ets`）

```
圆角  R_SM=4  R_MD=6  R_LG=8  R_XL=12  R_2XL=16
间距  SP_1..SP_8 = 4,8,12,16,20,24,28,32
字阶  FS_CAPTION=12  FS_BODY=14  FS_TITLE=16  FS_HERO=21
动效  D_FAST=180ms  D_BASE=240ms  D_SLOW=320ms
弹簧  EASE_SPRING_RESPONSE=0.30s  DAMPING=0.65  OVERLAP=0.0（→ curves.springMotion）
```

## 4. ArkUI 可用手段（已用 SDK d.ts 核实，非猜测）

| 手段 | API | 备注 |
|---|---|---|
| 线性渐变 | `linearGradient({angle, colors})` | 主按钮/登录字 |
| 径向渐变 | `radialGradient({center, radius, colors})` | 登录页顶部光晕 |
| 玻璃 | `backgroundBlurStyle(BlurStyle, {colorMode})` / `backdropBlur(n)` | **必须锁 DARK** |
| 发光 | `shadow({radius, color: eff().glow, offsetX:0, offsetY:0})` | 圆形发送键 |
| 层级阴影 | `shadow({color: eff().elev1|2|3})` | |
| 文字投影 | `textShadow({radius, color, offsetX, offsetY})` | 空态 ✦ |
| 按压反馈 | `stateStyles({pressed:{.opacity().scale()}})` | 全站统一 |
| 系统图标 | `SymbolGlyph($r('sys.symbol.x'))` | `.fontColor([...])` 收**数组** |
| 弹簧 | `animateTo({curve: curves.springMotion(...)})` | |

❌ 不可行 / 高风险：渐变文字（`background-clip:text` 无等价）、mask 尾缘淡出、`.position()` 百分比。

## 5. 自检清单（改 UI 后逐条跑）

```bash
source ~/ohos-cli/env.sh; cd ~/src/xbot-harmony
# 1) 无颜色字面量（应为 0）
grep -rnoE "#[0-9a-fA-F]{3,8}\b" entry/src/main/ets/pages entry/src/main/ets/components | wc -l
# 2) 无 emoji 图标（应为空）
grep -rnoE "Text\('(✳|📎|➕|✦|✕|☰|⊞|⚙|⋯)'\)" entry/src/main/ets/ | head
# 3) 三项门禁
bash tools/tests/run.sh && bash tools/lint/render-path.sh && bash tools/typecheck/check.sh
# 4) 构建 + 装机 + 截图
~/ohos-cli/deploy.sh
```

> ⚠️ 上面第 2 条里的 `⋯` 是**例外**：它没有 emoji 变体，是正确用法
> （鸿蒙 `sys.symbol.more` 实际是四宫格，语义不符）。详见 `docs/WEB-PARITY.md` §4。

## 6. 与 webui 的功能/设置对齐

见 **`docs/WEB-PARITY.md`**（共享设置键映射、强调色/MD主题/星标的落地与守护测试、
刻意不做的项及其理由、启动健壮性与会话池的根因记录）。

## 7. 思路光球（`AssistantOrb`）—— 旗舰「思考中 / 工具中 / 静默」指示器

> 用户口令：「极简、苹果那种科技感、干净、交互起来很爽」「比苹果官方做的 Siri 还好看」，
> 且**原生独享的白色主题（`porcelain`）下同样成立**。
> 实现分层：`core/orb.ets`（纯数学，可脱机单测）+ `components/AssistantOrb.ets`（取色/画布/状态机）。
> 挂载点：`components/LiveTailView.ets` 在飞块的**首位**（= web `LiveIteration` 的 `ShimmerThinking` 槽位）。

### 7.1 三态状态机（态 → 视觉 → 驱动 `@Prop` → 降级）

| 态 | 呼吸/能量 | 公转相位 | 轨道 | 环色 | 帧率 | 驱动 | 读作 |
|---|---|---|---|---|---|---|---|
| `thinking` | 1.0（既有观感） | 1.0× | 1.0× | `accentSoft` | 30 | `orbMode`（调用方给） | 在思考 / 在写 |
| `tool` | 0.9 | **2.2×** | **1.08×** | `statusRunning` | 30 | `orbMode`（任一工具在飞） | 工具在飞 |
| `idle` | **0.25** | **0（冻结）** | 1.0× | `accentSoft` | **12** | `orbMode` 或**心跳停摆自判** | 静默（静止也是设计） |

- **`idle` 自判**：`orbBeat`（正文+思考的码点长度和）超过 `ORB_QUIET_MS`（= 呼吸周期/4 = 640ms = 2×`D_SLOW`）
  未再前进 ⇒ 转入 `idle`。**为什么放在组件内**：父组件（`LiveTailView`）流式期以 ≤20Hz 重建，
  任何"带时间的状态"放父层都会抖（打字机每拍追平/落后）；光球本就有 30fps 循环，自己数时间最省最稳。
  ⚠️ 反过来：**父层只允许传稳定信号**（"是否有工具在飞"这档），**不许**把 `typingText()/typingReason()` 接进 `orbMode`
  —— 那会让 Canvas 组件以 ≤20Hz 频率卸载/重建。
- **换态不硬切**：全部参数按**实际帧间隔**缓动到目标（`ORB_EASE_MS` = 呼吸周期/8 = 320ms = `tokens.D_SLOW`，
  与全站过渡同刻度）；环色用**双色交叉淡出**。⇒ 换态无跳变，且 `orbMode` 即使抖动也被缓动吸收。
- **停表/降级**（`shouldRun()`）：`active=false` / `paused=true`（应用后台，官方性能规范 §3）/
  `reduceMotion=true` ⇒ 立即停表并补画一帧静息态。
  ⚠️ `reduceMotion` 目前**没有系统来源**：`accessibility.isAnimationReduceEnabledSync()` 是 **@since 23**，
  本工程 `compatibleSdkVersion 21` ⇒ 不可用（同族 `onAnimationReduceStateChange` 亦为 23）。
  接线点预留在 `LiveTailView` 的传参处（现传 `false` 占位）；将来 SDK 抬到 23 时在组件里取系统值求"或"即可。

### 7.2 深浅 / 白色主题分叉（⛔ 按**色板亮度**判，绝不按主题名）

判据：`isLightPalette(paletteOf(theme))`（按 `appBg` 感知亮度 —— 见 §2.9，未来新增色板/强调色覆盖都不会漏）。

| 角色 | 深色系（dark / aurora / nebula） | 浅色系（light / **porcelain** 纯白） |
|---|---|---|
| 外光晕 | `eff().glow`（accent@45%）—— **既有观感逐字节不变** | `eff().elev2`（正文色相@10% 的**中性柔影**） |
| 光晕不透明度 | 0.9 | 0.7 |
| 核亮心 / 主色 | `accentSoft` / `accent` | `accentSoft` / `accent`（更饱和的**实体**色） |
| 粒子环 | `accentSoft` | `accent` |
| 细环描边 | `eff().glowSoft` | `pal().border`（中性发丝） |

**白底为什么不能沿用 glow**：45% 饱和色晕压在纯白上会糊成一片灰蓝，读作"脏"，与"干净"相反；
白底要的是"实心色核 + 中性柔影 + 中性发丝"。

### 7.3 性能纪律（流式期每帧都在跑）

1. 帧率：thinking/tool 30fps、idle 12fps（呼吸是慢动作；60fps 无肉眼收益却双倍功耗）。帧率随态走，只在**目标变化**时重启定时器。
2. ⛔ **绘制路径零解析、零字符串运算**：`paletteOf/effectsOf`（每次都会新建 ~31 个字符串 + 9 次
   `alphaHex` 字符串运算）**只在 `theme` 变化时**预解析进私有 `OrbPaint`，逐帧只读字段。
   往 `draw()` 里加代码前先自查：**不得**出现 `paletteOf(` / `effectsOf(`（由 `tools/tests/orb.test.ts` 守护）。
   每帧不可避免的分配只剩 2 个 `CanvasGradient` + `core/orb.ets` 的粒子数组（Canvas API 与既有纯函数的形态）。
3. 进场复用既有底座 `components/anim.ets` 的 `animBase()`（220ms + 全站 spring 曲线）：opacity 0→1 + scale 0.86→1
   —— **不新造曲线/时长**（用户明令"不许自造轮子/严禁割裂"）。
4. ⛔ ArkTS 基类成员名黑名单：`size/width/height/position/offset/scale/rotate/opacity/visibility/clip/zIndex/id/key/enabled`
   + 一切 `on*` **都不能**做自定义组件成员名（否则 `10505001 not assignable to the same property in base type 'CustomComponent'`）
   —— 直径成员因此叫 `orbSize`。`orb.test.ts` 逐名守护。

### 7.4 契约守护

`tools/tests/orb.test.ts` 两部分：
1. `core/orb.ets` 纯数学（值域/单调性/周期性/边界/确定性）—— 真函数跑数值；
2. 本组件的**源码形态契约**（三态表数值、`isLightPalette` 判据、`draw()` 零解析、基类成员名黑名单、
   停表门控含 `paused`+`reduceMotion`、`LiveTailView` 传参不接打字机每拍状态）——
   因为组件层**不进离线 harness**（`run.sh` 只把 `core/**` 当纯 TS 编译），故按本仓既有先例
   （`tools/tests/live_tail_delivery.test.ts`）读**真实源码**做断言；改坏任一条即红。

## 8. 「在飞视觉语言」—— 机器在呼吸（波5e）

> 问题：流式期间同时有四个"高亮源"（光球 / `思考 N 字` / 打字机光标 / 工具 pill 的在飞态），
> 各自的动效与节奏是**分别长出来的** ⇒ 合起来"两个高亮源打架"。
> 原则：**统一不是把动效做多，而是做成同一个语言** —— 一个心跳、一个主角、一份分工、一个开关。
> 契约守护：`tools/tests/inflight_language.test.ts`（38 条，读真实源码 + 真函数数值）。

### 8.1 一个心跳（共享节奏刻度）

| 刻度 | 值 | 出处 | 谁在用 |
|---|---|---|---|
| 主呼吸 | `MOTION_BREATH_MS` = **8×D_SLOW = 2560ms** | `anim.ets`（**直接引用** `core/orb.ets:ORB_BREATH_MS`，不复制数值） | 光球的呼吸/呼吸幅度、`思考 N 字` 的强调脉冲 |
| 细节拍 | `MOTION_BEAT_MS` = **2×D_SLOW = 640ms** | `anim.ets` | 打字机光标的闪烁 |
| 静默窗 | `MOTION_QUIET_MS` = **主呼吸/4 = 640ms** | `anim.ets` | 光球"该不该转 idle"、`思考 N 字`"该不该继续强调"（**同一个值**） |
| 态过渡 | 主呼吸/8 = 320ms | `AssistantOrb:ORB_EASE_MS` | 光球换态的缓动收敛 |

- ⛔ **纪律**：在飞组里任何呼吸/脉冲/闪烁都必须是主呼吸刻度的**整数分数或倍数**
  （1× / 1/4 / 1/8），否则就是"新造了一套时长"。
- **同源同相**：相位只由 `Date.now()` + 刻度决定（`orbBreath()` 是纯函数、无本地累加器）
  ⇒ 光球与思考行**各自算也必然同步**，读作一个整体在呼吸。

### 8.2 一个主角（谁在什么时候领读）

同一时刻**只允许一个主高亮源**，优先级表（`LiveTailView.orbMode()` / `thinkingIsPrimary()`）：

| 时刻 | 主高亮源 | 光球 | `思考 N 字` | 打字机光标 | 工具 pill |
|---|---|---|---|---|---|
| 有工具在飞 | **光球**（`tool`） | 公转 2.2× + 轨道 1.08× + 环色 `statusRunning` | 静态 muted | 不显示（无正文在写） | 自己的系统 spinner（= 工具身份，不是"整机状态"） |
| 正在写正文（无工具） | **光球**（`thinking`） | 满幅呼吸 | 静态 muted | 极弱呼吸（`MOTION_BEAT_MS`，无发光） | — |
| **只有思考、无正文、无工具** | **`思考 N 字`** | **让位**（`secondary`：呼吸/光晕/公转全减半） | 图标+标签转 `accentSoft`，按共享呼吸极弱强调（0.72→1.0） | — | — |
| 静默（>640ms 无进展） | 光球 → `idle` | 幅度 0.25 / 粒子冻结 / 12fps（**静止也是设计**） | 静态 muted | 定格 | — |

**一句话说清"眼睛该看哪"**：*工具在跑就看光球（它换成"运行中"色在转）；只是在想就看字数在涨；在写就看字在长出来。*

### 8.3 一份分工（不许重复表达同一件事）

| 元素 | 唯一职责 | 明确**不做** |
|---|---|---|
| 光球 | **状态**（在飞 / 工具 / 静默 / 让位） | 不表达"正在写入"、不表达工具身份 |
| 打字机光标 | **正在写入**（2×14 的 accent 竖条，按细节拍呼吸） | 不发光（**发光体全场只允许光球一个**）、不硬闪 |
| 工具 pill | **工具身份 + 状态色**（`core/toolstatus` 的语义色 + 系统 `LoadingProgress`） | 不重复表达"整机在跑"（那是光球的活） |
| `思考 N 字` | 思考的**字数/内容**（可点开） | 只在"只有思考"时才做强调；其余时刻**静态** |

### 8.4 一个开关（降级一致）

`LiveTailView.reduceMotion()` 是**整组在飞动效的唯一开关**，一处取值、三处生效：
① 光球（`AssistantOrb.reduceMotion` ⇒ 停表 + 一帧静息态）；
② `思考 N 字`（`breath()` 恒返回 1 ⇒ 不呼吸、静态强调）；
③ 打字机光标（`caretAlpha` 恒 1 ⇒ 常亮不闪）。

⚠️ 系统来源：`accessibility.isAnimationReduceEnabledSync()` 是 **@since 23**，本工程
`compatibleSdkVersion 21` ⇒ **当前拿不到系统值**；`reduceMotion()` 作为**唯一接线点**暂时恒 `false`，
将来 SDK 抬到 23 时只改这一个方法体（理由已注释在代码里，测试亦守护该注释存在）。

### 8.5 白色主题一致

在飞组**只用** `isLightPalette(paletteOf(theme))` 分叉（**不按主题名硬判**）：
- 光球：浅色 ⇒ `eff().elev2` 中性柔影 + 实体色核/环 + `pal().border` 发丝（§7.2）；
- 光标：**已去掉彩色外发光**（原 `eff().glow` 在白底会读成"脏"，且是第二个发光体）⇒ 白底自动成立；
- `思考 N 字` 强调：`accentSoft`（porcelain #0066CC，白底可读）—— 纯前景色，无发光、无灰雾。

## 9. 补齐的三处语义缺失（波5f，`Surfaces`）

> 来源：波5 全主题一致性审查（真机截图 + 代码审查）认定三处**语义缺失**，
> 都是「白色主题不割裂」的**结构性根因**（不是"某处颜色不好看"）。
> 落地：`core/theme.ets` 新增**派生结构** `Surfaces` + `surfacesOf(palette)`（与 `Effects` 同一纪律）。
> 门禁：`tools/tests/theme_contrast.test.ts`（WCAG 2.1 对比度，已把这 3 个角色纳入矩阵与台账）。

### 9.1 三个角色

| 角色 | 语义（用途，不是颜色） | 深色系取值 | 浅色系取值 |
|---|---|---|---|
| `hairline` | **结构性发丝**：承载信息的边界 / 分隔线（`ThinkingLine` 展开体左栅栏、`MarkdownView` 分隔线、`AuthImage` 缩略图卡描边、`MessageRow` 压缩卡描边） | ≡ 该主题 `border`（**逐字节**，观感已批准不动） | `border` **按对比度压深**到 §9.2 的目标（保持各自色相：slate / 中性） |
| `sunken` | **下沉内容面**：比卡片更深一档的"内容块"底（代码块 / 终端块 / diff 行底） | ≡ 旧 `elev1` 压 `surface` 的合成色 | 同左（同一公式） |
| `glassBase` | **玻璃拟态面的基色**（`Effects.glassBg` 的派生源） | ≡ `surface`（**逐字节**） | `surface`；仅当 `surface == appBg`（porcelain）⇒ 改用 `surfaceAlt` |

**为什么进派生结构，而不是往 `Palette` 加字段**（这是新角色的既定纪律，不是偷懒）：
1. 三个值都**由色板按规则得出**，跨主题自动一致、新主题零重复；
2. `core/accent.ets` 的 `withAccent()` 是**逐字段复制**建新色板 ⇒ 往 `Palette` 加字段会让
   "换强调色后的色板"多出**空字段**（`tools/tests/accent.test.ts:80`「换色后无空字段」立刻红）；
3. 派生结构天然规避：换强调色不动 `border/surface/...` ⇒ 派生值不变。
   ⛔ 若将来要把某角色提升为 `Palette` 字段，**必须同时**给 `withAccent` 加复制行。

### 9.2 `hairline` 的量化根因与目标（**web 为权威基线**）

web 浅色 `src/index.css:160 --border: #e0e0e0` 压在 `:153 --bg-primary: #ffffff` 上 = **1.3201:1**（WCAG）。

| 主题 | 旧 `border` 对画布 | 新 `hairline` | 对画布 | 结论 |
|---|---|---|---|---|
| dark | `#20202B` = 1.2197 | `#20202B`（≡ border） | 1.2197 | 不变（已批准观感） |
| light | `#E2E8F0` = **1.1783** | `#D5DBE2` | **1.3327** | 补强 |
| aurora | `#1d2f47` = 1.4441 | `#1d2f47`（≡ border） | 1.4441 | 不变 |
| nebula | `#2c1f4d` = 1.3518 | `#2c1f4d`（≡ border） | 1.3518 | 不变 |
| porcelain | `#ECECEE` = **1.1798** | `#DFDFE1` | **1.3308** | 补强 |

⇒ **原生浅色系的 `border` 比 web 基线弱约 11%**，这就是"白底上结构性边界糊掉"的量化根因。
目标常量：`core/theme.ets:HAIRLINE_TARGET_RATIO = 1.3201`（逐字取 web 实测值，测试里当场复算校对）。

### 9.3 `sunken`：逐公式等价（零回归）

历史上 5 处把**阴影 token** `Effects.elev1` 当块底色用（`ToolPopover.ets:280/303/336/370/421`，
其卡底是 `surface`，见 `:383`）—— 语义上"阴影色"不该是底色。
`sunken = compositeOver(elev1, surface)`，且 `elev1` 的公式抽成共用函数（`legacyElev1Of`）
⇒ **等价性由构造保证**，门禁再逐字节复核 `compositeOver(effectsOf(p).elev1, p.surface) === surfacesOf(p).sunken`。

| 主题 | sunken | 与 `surface` 对比度 |
|---|---|---|
| dark | `#0B0B0F` | 1.021 |
| light | `#F1F1F2` | 1.129 |
| aurora | `#080F1B` | 1.041 |
| nebula | `#0B0817` | 1.020 |
| porcelain | `#F2F2F2` | 1.119 |

### 9.4 `glassBase`：白底玻璃不再恒等不可见

`glassBg = 基色 @62%` 压在画布上。porcelain 里 `surface == appBg == #FFFFFF`
⇒ 合成结果 == 画布 ⇒ **玻璃面板在白底上恒等不可见**（实测 1.0000；受影响点：`MarkdownView` 引用块底色）。
浅色系若 `surface == appBg` ⇒ 玻璃基色改用**次级面** `surfaceAlt`；**深色四套 + light 逐字节不变**。

| 主题 | 玻璃基色 | 合成底 | 对画布 |
|---|---|---|---|
| dark | `#0E0E14`（不变） | `#0D0D12` | 1.0140 |
| light | `#FFFFFF`（不变） | `#FCFDFE` | 1.0274 |
| aurora | `#0b1424`（不变） | `#09111F` | 1.0358 |
| nebula | `#0f0a1e`（不变） | `#0C0818` | 1.0194 |
| porcelain | `#F6F6F7`（**改**） | `#F9F9FA` | **1.0000 → 1.0522** |

### 9.5 纪律（违反即回归）

1. **深色族的 `hairline` 必须逐字节 ≡ `border`**，浅色族必须达到 `HAIRLINE_TARGET_RATIO`：
   门禁 `theme_contrast.test.ts` §E2/E3（含 10 条"能红"的断言，mutation 已证）。
2. **`sunken` 必须逐字节 ≡ `compositeOver(effectsOf(p).elev1, p.surface)`**：§E4 逐主题复核。
3. **任何面都不许与它的底恒等**（`glassBg` 压画布 ≠ 画布）：§E5。
4. `Surfaces` 的字段若增减，必须同步 `surfacesComplete()` 与门禁 §E1 的字段数断言。



