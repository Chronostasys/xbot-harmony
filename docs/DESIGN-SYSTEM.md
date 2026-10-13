# 设计系统（原生端）—— "深空仪表盘"

> 目的：让 UI 改造**有判据**，而不是凭感觉堆样式。
> 本轮（2026-10）用户否决过一版"到处描边 + 多色混用"的界面，本文是重做后沉淀的纪律。

---

> ## ⚠️ 状态声明（2026-10-11 起，**先读这段**）
>
> **本文已并入 [`docs/REDESIGN.md`](./REDESIGN.md)（设计语言宪法）。**
> **冲突时一律以宪法为准**；本文降级为**历史实现说明 + 指向宪法的索引**。
>
> **本文仍然保留、且仍然是权威的只有三类**（⛔ 不要删，删了会断掉其它文档/门禁的引用）：
> 1. **§4 ArkUI 可用手段** —— 已用 SDK d.ts 核实的**事实清单**（不是规则，宪法未复述）；
> 2. **§7 光球 / §8 在飞视觉语言 / §9 `Surfaces` / §10 空与失败 / §11 `accentDeep` 取证** ——
>    **实现细节与取证记录**（宪法 §3.2/§4.3/§5/§6.2 引用本文的同一处）；
>    ⚠️ **§8 仍被机器门禁与 `docs/ARKTS-GOTCHAS.md` 直接引用**
>    （`tools/lint/inflight-single-source.sh:4`、`tools/tests/inflight_language.test.ts:6`、
>    `docs/ARKTS-GOTCHAS.md:825`、`docs/WEB-ALIGNMENT.md:622`）⇒ **保留，但不再新增规则**；
> 3. **§6 与 webui 对齐** 的**指针**（正文见 `docs/WEB-PARITY.md`）。
>
> **新增/修改任何设计规则 ⇒ 改宪法（`docs/REDESIGN.md`）+ 令牌层（`core/design.ets`）**，
> 不要再往本文加规则（否则又是"同一信息两处判据"）。

---

## 0. 一句话

> ⚠️ **已被 `REDESIGN.md §0/§1` 取代**（"深空仪表盘"是深色单主题时代的定位；宪法定位是 **porcelain 白色主题 + 分层语义面**）。以下原句仅作历史。

**底色与主色同色相（紫）、靠亮度阶梯与留白分层、颜色只留给"进行中/失败"、图标一律用系统矢量符号。**

## 1. 三层来源

> ⚠️ **已被 `REDESIGN.md §11` + `core/design.ets` 取代**。新的三层是：
> ① `core/tokens.ets`（原始刻度）② **`core/design.ets`（语义令牌：尺度/层级/材质/动效/交互）**
> ③ `core/theme.ets`（色板/效果/派生面）。下表是**旧**的三层，仅作历史。

| 层 | 文件 | 内容 |
|---|---|---|
| 1. 令牌 | `core/theme.ets` | `Palette`（24 语义角色）+ `Effects`（玻璃/光晕/渐变/层级阴影） |
| 2. 尺度 | `core/tokens.ets` | 圆角 5 档 / 间距 8 档 / 字阶 4 档 / 动效时长 3 档 |
| 3. 使用 | `pages/Index.ets`、`components/*.ets` | 一律 `this.pal()` / `this.eff()` 取色，**禁止颜色字面量** |

## 2. 硬性纪律（违反即回归）

> ⚠️ **规则部分已被 `REDESIGN.md §2/§3` + `core/design.ets` 取代**（圆角/间距/字阶/材质的分层与不变量）。
> 本文的 §2.1「禁颜色字面量」、§2.3「border ≠ surfaceHi」等**实现级纪律仍然有效**（宪法同向、未重复）；其余按宪法。

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

> ⚠️ **已被 `REDESIGN.md §1/§2` + `core/design.ets` 取代**：宪法给的是**语义档**
> （`type.*` / `space.*` / `radius.*` / `surface.*`），直接消费 `core/design.ets`；
> 本节只是 `tokens.ets` 的**原始数值**，作为 scale 的出处保留。

```
圆角  R_SM=4  R_MD=6  R_LG=8  R_XL=12  R_2XL=16
间距  SP_1..SP_8 = 4,8,12,16,20,24,28,32
字阶  FS_CAPTION=12  FS_BODY=14  FS_TITLE=16  FS_HERO=21
阶梯外（有意，组件专属；⛔ 不进 STEPS 阶梯）FS_META=11  FS_BOOT_WORDMARK=18  FS_BRAND_WORDMARK=34
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

> ⚠️ **已被 `REDESIGN.md §8`（可验证）+ `core/design.ets` 的不变量取代**：
> 现在的判据是 `bash tools/gate.sh`（真门禁）+ `bash tools/tests/run-one.sh design`（168 断言）。
> 下面的手工清单仍可用于**截图前**的快速自查（与门禁同向、不冲突）。

```bash
source ~/ohos-cli/env.sh; cd ~/src/xbot-harmony
# 1) 无颜色字面量（应为 0）—— 用判据脚本，**别用 grep**：
#    grep 会把注释里"为什么用这个角色/值"的**文档**误报成违规（本仓组件大量这样写，是好实践）
bash tools/lint/no-color-literals.sh
# 2) 无 emoji 图标（应为空）
grep -rnoE "Text\('(✳|📎|➕|✦|✕|☰|⊞|⚙|⋯)'\)" entry/src/main/ets/ | head
# 3) 三项门禁
bash tools/tests/run.sh && bash tools/lint/render-path.sh && bash tools/typecheck/check.sh
# 3b) 取色 role 合法性（⛔ 未知 role 会被 colorOf 静默解析成 transparent ⇒ 文字/图标不可见；见 §12）
bash tools/lint/color-roles.sh
# 4) 构建 + 装机 + 截图
~/ohos-cli/deploy.sh
```

> ⚠️ 上面第 2 条里的 `⋯` 是**例外**：它没有 emoji 变体，是正确用法
> （鸿蒙 `sys.symbol.more` 实际是四宫格，语义不符）。详见 `docs/WEB-PARITY.md` §4。

## 6. 与 webui 的功能/设置对齐

> ⚠️ **指针仍有效**：功能面对齐见 `docs/WEB-PARITY.md`；**视觉面**的对齐规则已改由
> `REDESIGN.md §10` + `docs/WEB-ALIGNMENT.md §16` 管理（**视觉不再逐像素对齐 web**）。

见 **`docs/WEB-PARITY.md`**（共享设置键映射、强调色/MD主题/星标的落地与守护测试、
刻意不做的项及其理由、启动健壮性与会话池的根因记录）。

## 7. 思路光球（`AssistantOrb`）—— 旗舰「思考中 / 工具中 / 让位 / 静默」指示器

> 用户口令：「极简、苹果那种科技感、干净、交互起来很爽」「比苹果官方做的 Siri 还好看」，
> 且**原生独享的白色主题（`porcelain`）下同样成立**。
> 实现分层：`core/orb.ets`（纯数学，可脱机单测）+ `components/AssistantOrb.ets`（取色/画布/状态机）。
> 挂载点：`components/LiveTailView.ets` 在飞块的**首位**（= web `LiveIteration` 的 `ShimmerThinking` 槽位）。

### 7.1 四态状态机（态 → 视觉 → 驱动 `@Prop` → 降级）

| 态 | 呼吸/能量 | 公转相位 | 轨道 | **景深** | 环色 | 帧率 | 驱动 | 读作 |
|---|---|---|---|---|---|---|---|---|
| `thinking` | 1.0（既有观感） | 1.0× | 1.0× | 0.85 | `accentSoft` | **20** | `orbMode`（调用方给） | 在思考 / 在写 |
| `tool` | 0.9 | **2.2×** | **1.08×** | **1.0（最立体）** | `statusRunning` | 30 | `orbMode`（任一工具在飞） | 工具在飞 |
| `secondary` | **0.5** | **0.5×** | 1.0× | 0.45 | `accentSoft` | **18** | `orbMode`（`thinkingIsPrimary()`） | **让位**（别处才是主角） |
| `idle` | **0.25** | **0（冻结）** | 1.0× | **0.2（近平面）** | `accentSoft` | **12** | `orbMode` 或**心跳停摆自判** | 静默（静止也是设计） |

⚠️ 帧率列**以 `core/orb.ets` 的 `ORB_FPS_*` 为准**：`tool` = 30、**`thinking` = 20**、`secondary` = 18、
`idle` = 12。`thinking` **确实**走 `orbTargetFps` 的 `ORB_FPS_THINKING`(20) 降频分支
（`core/orb.ets:405`；由 `a3f0cc1`「慢波形降频」引入，`tools/tests/orb.test.ts` 钉死 20，
真机实测流式期 CPU 4.4–4.7% 正是它的地板）。**本表与组件头曾一度把 `thinking` "订正"成 30**
（并附"thinking 不在降频分支里"的说法）—— **那是错的**，2026-10-11 按**代码 + 判据**回正。

**景深列** = `core/orb.ets:orbDepthOf(mode)`（"深度 = 在场感"：`tool` 最立体、`idle` 近平面）。
它是一条**与颜色/速度都无关的静态形态维度** —— `porcelain`/`light` 下 `tool` 与 `thinking` 的环
**同为 `#0071E3`**（`core/theme.ets`）⇒ 颜色维度静帧不可辨；深度给"工具在飞"一个**静帧可辨**的线索。

⛔ **优先级的唯一判据 = `core/orb.ets:orbEffectiveMode(orbMode, quiet)`（纯函数）**：
`tool > idle(显式) > idle(静默自判) > secondary > thinking`。组件侧**不得**自己再写一份 `if` 链 ——
**2026-10-11 事故**：旧组件实现只认 `tool`/`idle` 两档、其余回落 `quiet ? idle : thinking` ⇒
**`secondary` 永久不可达**（`LiveTailView.ets:129` 传了也白传），而 `orbTargetFps` 的 18fps 分支与
`ST_SECONDARY` 两处参数**全部白写**：光球在"该让位"时仍满幅呼吸 ⇒ 与 `思考 N 字` **争主高亮**
（与 §8.2 同一个病根）。上收纯函数后该优先级有唯一判据、可脱机单测、可变异自证。

### 7.1.1 波形塑形（2026-10-11 波，"比 Siri 好看"的量化落点）

两处**只改形状、不改刻度**的提升（周期/幅度/token 全不动 ⇒ 不新造节奏体系）：

1. **呼吸非对称（快吸慢呼）** —— `core/orb.ets:ORB_BREATH_INHALE = 0.4`。
   `0.5 - 0.5·cos(2πp)` 的升/降**镜像等时** ⇒ 读作**节拍器/呼吸机**（可预测 = 机械感）。
   改为 `smoothstep` 非对称波：**吸气占 0.4 周期、呼气占 0.6** ⇒ 峰值来得果断、回落绵长，
   一眼读作"有肺、有惯性"。峰值时刻 = `ORB_BREATH_INHALE × ORB_BREATH_MS`。
2. **公转非匀速（有余势）** —— `core/orb.ets:ORB_SPIN_EASE = 0.35`。
   线性相位 ⇒ 粒子环**永恒匀速**（loading 圈 = 廉价头号特征）。改走
   `g(s) = s − c/(2π)·sin(2πs)`（`g(0)=0, g(1)=1, g'∈[1−c,1+c]`）⇒ 一个公转周期内角速度
   在 `0.65× ~ 1.35×` 起伏。**周期不变**（`orbParticles(t+turnMs) ≡ orbParticles(t)`）、
   **只快不退**（`c<1` ⇒ 严格单调），且"`tool` 加速 = 用更短周期跑同一函数"的等价关系仍成立。

纪律：`0 < ORB_BREATH_INHALE < 0.5`、`0 < ORB_SPIN_EASE < 1`（**改回 0.5 / 0 即红**，`orb.test.ts` 逐条守护）。

### 7.1.2 「双频呼吸 + 轨道景深」—— 再提升一档（2026-10-11 第三波）

两处**只加"形状/层次"、不加元素、不加时长、不加动效面**的提升（判据 `tools/tests/orb_motion.test.ts`，57 断言）：

1. **双频呼吸**（`core/orb.ets:orbBreathFine` / `orbRadiusFine` / `orbOpacityFine`）。
   主呼吸是"快吸慢呼"的**单峰**波形 —— 单峰且每周期完全一致 = **节拍器**（可预测 = 机械感）。
   叠加一个 **2× 谐波**（`ORB_BREATH_FINE_HARMONIC = 2`，**整数倍 ⇒ 周期仍是 `ORB_BREATH_MS`，
   不新造时长刻度**）的微弱分量，与真实心跳的"二次搏动"同构 ⇒ 读作"有生命的呼吸"。
   ⛔ 窗口 `4·b·(1−b)` 在两端恰为 0 ⇒ **端点逐值不变**（峰仍 1 / 谷仍 0）、值域仍 `[0,1]`；
   `ORB_BREATH_FINE_AMP = 0.18`（实测峰-峰偏差 ≈ 0.30vp @3× 屏 ≈ 0.9px —— 够读到"不是节拍"，
   不至于读成"抖"；`0` 即退回单频）。映射与 `orbRadius`/`orbOpacity` **同源**（共用私有 `radiusOf`/`opacityOf`）。
   ⛔ 单频 `orbBreath`/`orbRadius`/`orbOpacity` **一字未动**（`orb.test.ts` 的波形/单调/端点契约继续成立）。
2. **轨道景深**（`core/orb.ets:orbDepthNear` / `orbDepthGain` / `ORB_DEPTH_*`）。
   **等大等亮的一圈光点 = 2D loading 圈**的头号特征；人眼读空间靠"近大远小 + 亮度差"。
   逐粒子按**纵向位置** `y` 给尺寸/亮度增益（近 `1.28×/1.15×`、远 `0.78×/0.72×`）⇒ 环读作
   **倾斜的三维轨道**，**一个像素都没多画**。`orbDepthOf(mode)` 给每态一个强度（见 §7.1 景深列）。

**为什么不更花哨**（三条硬边界，逐条都有判据）：① 不加**颜色**（取色仍只走 accent 家族 + `statusRunning`
+ `inflightHaloOf`/`hairlineOf`）；② 不加**元素/图元**（没有 specular 高光点、没有第二圈环、没有光斑）；
③ 不加**动效面/定时器**（`animateTo(` 仍 2、`.transition(`/`.animation(` 仍 0、`setInterval(` 仍 1 ——
`orb_motion.test.ts` 与 `motion_budget`／`one_inflight_motion` 同源钉住）。新增的只有**两个纯函数维度**。
⚠️ **观感（"是不是真比 Siri 好看"）必须真机连拍验收** —— 离线判据只证明"参数不变量与接线在位"，
**不证明好看**。

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
| 细环描边 | `eff().glowSoft` | `surfacesOf().hairline`（结构性发丝；⛔ 不是 `border`——白底 `border` 只有 ~1.18，半透明再打对折后基本消失） |

**`tool` 态的"静态可辨"补充线索（2026-10-11 波）**：porcelain/light 下 `statusRunning` 与 `accent`
**同为 `#0071E3`**（`core/theme.ets:343` / `:170`）⇒ `tool` 与 `thinking` 的环**色相同**，"工具在飞"
只剩"公转快 2.2×"这一个**动态**线索，**静帧下不可辨**（违反 §8.2「一眼可辨」）。故细环在 `tool` 态
**变亮**：`alpha = op * 0.5 * (1 + ORB_TOOL_STROKE_SPAN * colorMix)`（`components/AssistantOrb.ets`），
`ORB_TOOL_STROKE_SPAN = 0.8`，且由**已缓动的 `colorMix`** 驱动 ⇒ 换态不硬切；细环本就跑在既有
30/20fps 循环里 ⇒ **不是新造动效**。

**光核/光晕的绘制几何（2026-10-11 波，收敛为 `core/orb.ets` 命名常量、可脱机断言）**：
核渐变 = `亮心@0 → 亮心@ORB_CORE_SOLID_STOP(0.28) → 主色@ORB_CORE_MID_STOP(0.68) → 透明@1`
（实心平台 ⇒ 读作"一颗有体积的实心核"，而非"从圆心立即糊开的一团光"）；
外光晕 = `halo@0 → 透明@ORB_HALO_DECAY_STOP(0.82) → 透明@1`
（衰减到 0 的停靠点 < 1 ⇒ 光晕在**画布边缘之前**归零，留干净留白、不与邻接内容糊）。

**白底为什么不能沿用 glow**：45% 饱和色晕压在纯白上会糊成一片灰蓝，读作"脏"，与"干净"相反；
白底要的是"实心色核 + 中性柔影 + 中性发丝"。

### 7.3 性能纪律（流式期每帧都在跑）

1. 帧率：`tool`/`thinking` 30fps、`secondary` 18fps、`idle` 12fps（呼吸是慢动作；60fps 无肉眼收益却双倍功耗）。帧率随态走，只在**目标变化**时重启定时器；**不可见（滚出屏幕）⇒ 0（停表）**。
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
2. 本组件的**源码形态契约**（四态表数值、`isLightPalette` 判据、`draw()` 零解析、基类成员名黑名单、
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
- 光球：浅色 ⇒ `eff().elev2` 中性柔影 + 实体色核/环 + `surfacesOf().hairline` 发丝（§7.2）；
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
| `glassBase` | **玻璃拟态面的基色**（`Effects.glassBg` 的派生源） | ≡ `surface`（**逐字节**） | **显式活规则**：`surface` 对画布 ≥ `GLASS_BASE_MIN_RATIO`(1.02) ⇒ 用 `surface`；否则（真退化 `surface≈appBg`）退 `surfaceAlt`（**仅当更可辨**）。porcelain/light 实测 1.0616/1.0380 ⇒ 走 `surface` |

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

`glassBg = 基色 @84%(浅) / @62%(深)` 压在**它身后的画布**上。若基色与画布恒等，合成结果 = 画布本身
⇒ **玻璃面板恒等不可见**（历史上 porcelain 的 `surface == appBg == #FFFFFF` 即此情形）。

**⚠️ 订正（2026-10-11，porcelain-audit ⚠️-2）**：L2 把 porcelain 画布改成 `#F7F7F8`（白卡浮淡灰）
⇒ 旧判据 `surface === appBg` **对现有 5 套主题全为假**（死分支）⇒ 已改为**显式活规则**：
浅色系 `surface` 对画布 ≥ `GLASS_BASE_MIN_RATIO`(1.02) 就用它；否则退 `surfaceAlt`（**仅当更可辨**）。
⛔ 审计处方的「浅色一律 `surfaceAlt`」**被实测否掉**（porcelain 玻璃对画布会掉到 **1.0088 < 1.02**，更不可见）。

| 主题 | 玻璃基色 | 合成底 | 对画布 |
|---|---|---|---|
| dark | `#0E0E14`（不变） | `#0D0D12` | 1.0140 |
| light | `#FFFFFF`（不变） | `#FCFDFE` | 1.0380 |
| aurora | `#0b1424`（不变） | `#09111F` | 1.0358 |
| nebula | `#0f0a1e`（不变） | `#0C0818` | 1.0194 |
| porcelain | `#FFFFFF`（= `surface`，阈值守卫；零像素变化） | `#FEFEFE` | **1.0616** |

> 判据：`theme_contrast.test.ts` §E5（+ §E5b 合成退化板自证活分支）；mutation：改回旧 `==` 判据 ⇒ §E5b 红。

### 9.5 纪律（违反即回归）

1. **深色族的 `hairline` 必须逐字节 ≡ `border`**，浅色族必须达到 `HAIRLINE_TARGET_RATIO`：
   门禁 `theme_contrast.test.ts` §E2/E3（含 10 条"能红"的断言，mutation 已证）。
2. **`sunken` 必须逐字节 ≡ `compositeOver(effectsOf(p).elev1, p.surface)`**：§E4 逐主题复核。
3. **任何面都不许与它的底恒等**（`glassBg` 压画布 ≠ 画布）：§E5。
4. `Surfaces` 的字段若增减，必须同步 `surfacesComplete()` 与门禁 §E1 的字段数断言。

### 9.6 接线记录（波3b-6）—— 谁是"该用的人"

| file:line | 旧 | 新 | 为什么 |
|---|---|---|---|
| `ThinkingLine.ets` 展开体左栅栏 | `paletteOf(theme).border` | `surfacesOf(...).hairline` | 左栅栏是**承载信息**的边界（"这是思考展开体"） |
| `MarkdownView.ets` 分隔线（Divider） | `pal().border` | `surfacesOf(pal()).hairline` | 分段线承载结构信息，浅色下必须看得见 |
| `AuthImage.ets` 图片卡描边 | `pal().border` | `surfacesOf(pal()).hairline` | 描边界定"这是一张可点的图" |
| `ContextRing.ets` 用量环**轨道** | `pal().border` | `surfacesOf(pal()).hairline` | 轨道是"弧占多少"的参照系；太淡读不出占比 |
| `ToolPopover.ets` 代码/终端块/diff 行底（5 处） | `eff().elev1` | `surf().sunken` | **阴影 token 被当底色用**的语义错位；取值逐字节等价 ⇒ 零像素变化 |

**判定**：门禁 §B.2 新增 `hairline` 边界判定表（浅色族阈值 = `HAIRLINE_TARGET_RATIO`；深色族 =
它替代的 `border` 可见度）；`hairline`/`sunken` 已移入 §B `JUDGED_ROLES`，`PENDING_WIRING_ROLES`
只剩 `glassBase`（设计如此：只喂 `effectsOf.glassBg`，组件不直呼）。

**本波**不**改**的两类（语义/纪律决定，非遗漏）：
- **引用块**（`MarkdownView` Quote）：底 = `eff().glassBg`（不是 `elev*` ⇒ 不改 `sunken`），边 = 左侧 3px
  **`accent` 竖条**（是强调语义、不是结构性发丝 ⇒ 不改 `hairline`）。它此前"白底不可见"的根因已由
  §9.4 的 `glassBase` 切换修掉。改任何一处都会破坏"深色零像素变化"。
- **装饰性容器描边**（设置页表单/卡片描边、选中态描边、`glassBorder`、`withAlpha(border,α)`）：
  见 §2.5「少用描边」—— 一律不动（换 `hairline` 会让浅色设置页"到处描边"，从极简白滑走）。

**移交下一波**：`MessageRow.ets:857`（虚线描边）/ `:891`（描边）—— 本波因该文件另有在飞改动而跳过。




## 10. 「空与失败」—— 一个空白屏换来的语言（波5g）

> 起因（真机实测 2026-10-11）：服务端历史 `role=user len=19` + **`role=assistant len=0`**、
> `processing=False` ⇒ app 里 **用户气泡下面一片空白**，用户以为"坏了 / 卡了 / 我是不是没发出去"。
> 根因：`MessageRowView.build()` 用 `rowIsEmpty` 把**空**当成了**不存在**（整块跳过）。
> **「模型没返回内容」与「这个回合不存在」是两件事** —— 后者才该静默。

### 9.1 契约：触发条件 × 呈现 × 颜色 × 是否抢主高亮源

| 情况 | 判据（稳定信号） | 呈现 | 颜色 | 抢主高亮源？ |
|---|---|---|---|---|
| **空回复**（回合已结束、整行无产出） | `!row.isLive && rowIsEmpty(row)` | 一行小字（无图标、无填充、无边框、无发光） | `pal().textMuted` | **否**（静态） |
| **服务端标记的空响应**（哨兵 `'(empty response)'`） | `row.content.trim() === EMPTY_RESPONSE_SENTINEL` | 同一行 + 一枚 `xmark_circle_fill` | `pal().dangerText` | **否**（静态） |
| 在飞但还没有内容（首个 delta 未到） | `row.isLive && rowIsEmpty(row)` | **本组件不渲染** | — | 否 —— 由列表尾「思考中…」占位承担（`core/indicators.ets`） |
| 在飞、有内容但长时间无进展 | 光球心跳静默 > `MOTION_QUIET_MS` | 光球转 `idle`（幅度 0.25/12fps）；**内容仍在屏上，不会出现空白** | §7/§8 | 是（光球，但已极弱） |
| 有内容 | `!rowIsEmpty(row)` | 正常助手气泡 | §7/§8 | 由 §8 的优先级表决定 |

**不变量**：任何时刻**恰好一个**指示器 —— 在飞 ⇒ 占位符 或 在飞块（光球）；回合已结束但无产出 ⇒
**本提示行**；两者互斥（判据里含 `!row.isLive`，由 `tools/tests/empty_notice.test.ts` 守护）。

### 9.2 web 对齐证据（权威基准，文案**逐字**取用，禁自创）

| 用途 | web 出处 | 取到的值 |
|---|---|---|
| 空回复文案 | `web/src/i18n/zh-CN.ts:223` `agent.emptyAssistant`（en.ts:226） | **`（无文本输出）`** / `(no text output)` |
| 空回复的触发条件 | `AssistantMessage.tsx:150-152`：`!isStreaming && !finalContent && !emptyResponseWarning && iterations.length === 0 && !showProgress(progress)` | 原生等价 =「回合已结束 + 整行无产出」 |
| 失败/异常文案 | `web/src/i18n/zh-CN.ts:224` `agent.emptyResponseWarning`（en.ts:227） | **`LLM 本次没有返回文本内容，可能是模型输出异常或中途结束。`** |
| 哨兵字面量与判据 | `AssistantMessage.tsx:169-171` `content.trim() === '(empty response)'` | `EMPTY_RESPONSE_SENTINEL`（同字面量） |
| 哨兵处的分支 | `AssistantMessage.tsx:147-149` | 先判哨兵 ⇒ 显示提示**而不是**把哨兵当正文渲染 |

**刻意偏离 web 的一处（有据）**：web 的失败态是一个**填充红盒**
（`AssistantMessage.tsx:173-179`：`rounded border border-status-error/40 bg-status-error/10 px-2 py-1 text-sm`）。
原生端按用户口令「Apple 的做法是一行小字 + 中性色，**不是大红报错**」⇒ 只保留**一行**（无填充/无边框/无发光），
加重手段仅有"颜色升一档 + 一枚图标"。若日后要回到 web 的盒子形态，改点在 `EmptyNotice.build()` 一处。

### 9.3 与 §8（在飞视觉语言）的关系

- 空/失败提示**永远是静态**（零动画、零定时器）⇒ 它只出现在"回合已结束"之后，**不可能**与在飞的
  主高亮源（光球）同屏争抢 ⇒ §8 的"同一时刻只允许一个主高亮源"依然成立。
- 颜色只用**语义角色**（`textMuted` / `dangerText`）⇒ 深浅色与 `porcelain` 纯白**自动成立**，
  无需 `isLightPalette` 分叉、无需外发光（白底上 `#B42318` 可见但不刺眼）。
- 形态与正常回复**同列同左边界**（同一 `BUBBLE.assistantPadX/rowPadY`）⇒ 空态不像"另一个东西"。

### 9.4 契约守护

`tools/tests/empty_notice.test.ts`（49 条）：
1. **真判定（可执行）**：用真 `ChatRow` 跑「空/非空 × 在飞/已结束」四组合 —— `rowIsEmpty` /
   `rowHasInFlightSignal` 是 `core/streammerge.ets` 的真函数；并**证明**哨兵被 `rowIsEmpty` 判为"非空"
   （所以它必须有独立分支）。
2. **源码形态**：`showsEmptyNotice()` 含 `!this.row.isLive`；哨兵判定 = `trim() ===` 哨兵常量；
   `build()` 的空分支与正文路径两条出口都接上；文案**逐字**断言；`EmptyNotice` 内**无**
   `.backgroundColor(` / `.border(` / `.shadow(` / `.blur(` / `isLightPalette` / `animateTo(` / `setInterval(`；
   基类成员名黑名单逐名校验。

## 11. 霓虹深色系的 `accentDeep` 与「主按钮白字」取证（波 C/D，2026-10-11）

> 来源：`tools/tests/theme_contrast.test.ts` 的**对比度台账**（根因 C / 根因 D）。
> 波 C/D 把 aurora/nebula 的 `accentDeep` 压暗到可读（消 5 条台账）；主按钮（根因 D）当时取证后
> **暂缓**（见 §11.3 的历史结论）—— **2026-10-11 ② 已由用户拍板并落地**：**只护航派生端色**
> `gradientFrom/gradientTo`（⛔ 不动 `accent`），决策记录 + 新值 + 实测见 **§11.3**。
> 门禁：同一文件新增 **§G**（取值守护 + D 取证守卫，已回退证红）与 **§I**（主按钮渐变两端判定）。

### 11.1 为什么要改：`accentDeep` 是**填充**，上面压着**真实**生产文字

`accentDeep`（"强调色的深色形态"，徽标/标签底）在霓虹深色主题里承载三处**有据可查**的落点：

| 落点 | 前景（阈值） | 旧实测 aurora | 旧实测 nebula |
|---|---|---|---|
| `pages/Index.ets`「回到最新」pill（12fp） | `textPrimary`（4.5） | **3.33** ✗ | 5.79 ✓ |
| `SettingsRows.ets`「默认」徽标 / `ToolPopover.ets` hunk 标记 | `accentText`（4.5） | **3.09** ✗ | **3.85** ✗ |
| `ToolPopover.ets` hunk 尾注（10fp） | `textMuted`（2.0） | **1.07** ✗ | **1.77** ✗ |

### 11.2 取值口径（两条约束一起解，阈值一个都没放宽）

| 约束 | 内容 | aurora | nebula |
|---|---|---|---|
| ① 可读性（不许更亮） | 三条落点全达标，**最紧的一条**留绝对余量 0.15（与门禁 §F2 同刻度）⇒ `textMuted ≥ 2.15` | 亮度上界 `L ≤ 0.0740` | `L ≤ 0.0718` |
| ② 填充仍可辨（不许更暗） | 地板 = **dark 已批准徽标底** `#2A1F5C` 压 `#14141C` = **1.2638**（WCAG） | 亮度下界 `L ≥ 0.0284` | `L ≥ 0.0229` |
| 取值 | 窗口内**余量归一化最优的中点** | **`#04473a`**（L=0.0484） | **`#4a1998`**（L=0.0442） |

| 主题 | 新 `accentDeep` | `textMuted` | `accentText` | `textPrimary` | 对 `surface` / `surfaceAlt` |
|---|---|---|---|---|---|
| aurora | `#04473a`（旧 `#0f8b73`） | 1.07 → **2.71** | 3.09 → **7.80** | 3.33 → **8.40** | 1.726 / 1.582 |
| nebula | `#4a1998`（旧 `#6d28d9`） | 1.77 → **2.78** | 3.85 → **6.04** | 5.79 → **9.08** | 1.740 / 1.633 |

色相不变（= 原值在线性空间**同比压深**）；`accentDeep` 是**叶子**（不喂 `Effects`/`Surfaces`/`hairline`/
`sunken` 任何派生）⇒ 两套主题**其余 28 个角色逐字节不变**（门禁 §G4）。台账 **14 → 9 项**
（消 5：aurora `accentText`/`textMuted`/`textPrimary` + nebula `accentText`/`textMuted`）。

**残余（不是没修，是解不存在）**：`onAccent|accentDeep` —— aurora `#04150f` / nebula `#150a2b` 是
**深色字**（角色定义 = "压在**实心** accent 上"），要求 `accentDeep` 够**亮**（L ≥ 0.20）；而浅色字要求
它够**暗**（L ≤ 0.083）⇒ **亮度窗口无交集，压暗无解**。该组合当前**无生产调用点**（唯一曾用它的一处
已改用 `accentText`），台账保留当**回归护栏**；真要修在**消费者侧**。

### 11.3 主按钮「白字 `#FFFFFF` 压 accent 家族」—— **已决策并落地**（2026-10-11 ②）

- **换算（不是机械按 4.5）**：主按钮 `Button('登录')`（`pages/Index.ets`）= `.fontSize(FS_TITLE)` = **16fp**
  + `FontWeight.Medium`（经 `typeOf('type.subhead').weight`）= **500**。WCAG 2.1 SC 1.4.3 的"大字"例外
  = **≥18.66px 且 bold（≥700）**，或 **≥24px 常规** ⇒ 16px + 500 两条都不满足 ⇒ **不是大字 ⇒ 阈值仍是 4.5**
  （用户把字号调到最大档 1.3 也只有 20.8px、且仍非 bold）。
- **真问题在"渐变的最亮端"（不是纯色 accent）**：主按钮/应用徽标的真实底色是**渐变**
  `gradientFrom → gradientTo`（`core/theme.ets:effectsOf`）。旧派生 `gradientFrom = accent`、
  `gradientTo = accentSoft` ⇒ dark 实测白字压 `accent #7C5CFF` = **4.35**、压 `accentSoft #B9A7FF`
  = **2.09**（连大字 3:1 都过不了）。⇒ **只压 `accent` 是"让测试变绿、真按钮仍不达标"**。
- **决策（用户 2026-10-11 拍板）**：把**渐变两端**都护航到白字 ≥ **4.5**（保色相、取最小压深），
  且**只动派生 `gradientFrom/gradientTo`**，⛔ 不动 `accent`/`accentSoft`/`onAccent` 本身
  ⇒ 品牌主色 `#7C5CFF`（`brandAccent()`）、发光 token（`glow = accent@45%`）、链接色**零回归**。
- **落地**：`core/theme.ets` 新增 `GRADIENT_TEXT_MIN_RATIO = 4.5` 与 `gradientEndOf(color, onAccent)`
  （= `contrastRatio` 已达标则**逐字节返回原值**；否则 `deepenToRatio` 在**线性空间三通道等比缩放**、
  取满足目标的**最小**压深）。实测（`docs/ACCENT-CONTRAST.md §6`）：

  | 主题 | gradientFrom | 白字 | gradientTo | 白字 | 备注 |
  |---|---|---|---|---|---|
  | **dark** | `#7C5CFF` → **`#795AFA`** | 4.35 → **4.5104** | `#B9A7FF` → **`#7B6EAB`** | 2.09 → **4.5058** | 唯一改动面 |
  | light | `#6D28D9`（不动） | 7.1049 | `#1D4ED8`（不动） | 6.7016 | 原本达标 |
  | aurora | `#34d3b4`（不动） | 9.9370 | `#63e6c8`（不动） | 12.2246 | 原本达标（深色字） |
  | nebula | `#a78bfa`（不动） | 6.9507 | `#d68bff`（不动） | 8.1034 | 原本达标（深色字） |
  | porcelain | `#0071E3`（不动） | 4.6967 | `#0066CC`（不动） | 5.5666 | 原本达标 |

- **门禁**：`tools/tests/theme_contrast.test.ts` 新增 **§I**（把"渐变两端"纳入判定，阈值仍 4.5、
  ⛔ 未放宽；mutation = 改回裸 accent ⇒ dark 两条跌破 4.5 红）；`tools/tests/theme_tokens.test.ts`
  的 `gradientFrom = accent` 不变量替换为"端色对 `onAccent` ≥4.5 + 已达标的端逐字节不动"。
- **`dark|onAccent|accent` 台账条目保留**（§G6 断言不许删）—— 它建模的是**纯色** accent；
  真实按钮由渐变端色承重，已达标（§I）。**保留 = 不放宽阈值、不删断言。**

### 11.4 纪律（违反即回归）

1. aurora/nebula 的 `accentDeep` 对三条真实落点必须达标且留 0.15 余量（§G1），并**严格强于旧值**（§G3）。
2. 徽标底必须仍可辨（对 `surface`/`surfaceAlt` ≥ 1.2638，且亮于该主题 `surfaceHi`）
   —— ⛔ 不许为了可读性把它一路压到全黑（§G2 会红）。
3. 两套主题**其余角色逐字节不变**（§G4）；`accentDeep` 若将来被接进任何派生，§G4 立刻红。
4. `dark|onAccent|accent` 台账条目**不许删**（§G6）—— 删 = 放宽阈值。

## 12. 取色 role 的合法集合（唯一入口 + 静默陷阱 + 机器判据）

> 新增于 2026-10-11（我在审计"令牌层完备性"时钓出，属**真缺陷类别**，非风格问题）。

### 12.1 唯一入口

| 你要什么 | 唯一入口 | role 形态 |
|---|---|---|
| 文字/强调/语义色 | `core/design.ets: colorOf(p, role)` | **camelCase、不含点** |
| 面 / 底 / 卡片 | `surfaceFillOf(p, role)`（或 `SURFACE_*` 常量） | **带点**（`surface.*`） |
| 字号+配套字色 | `typeOf('type.x')`（或 `TYPE_*` 常量） | 带点（`type.*`） |
| 品牌色（logo/开屏/标记） | `core/brand.ets: brandAccent()` / `brandOnAccent()` | **函数**，不是 role |
| 发丝 / 玻璃 / 高程 | `hairlineOf(p)` / `glassFillOf(p)` / `elevationColorOf(p, lv)` | — |
| 在飞光晕 / 光球细环 | `inflightHaloOf(p)` / `orbRingStrokeOf(p)`（浅深两套值；经 `colorOf` 的 role 亦可用） | — |

合法集合**从真源自动抽取**（见 §12.3），此处不复制粘贴以免两处漂移。

### 12.2 ⛔ 陷阱：未知 role **静默**变透明

`colorOf()` 的末尾是 `return p.transparent;` —— 也就是说**写错 role 不会报错**：

```
colorOf(p, 'text.pillName')   // ← docs/REDESIGN-INPUT-*.md 与 docs/mockups/*.html 里的"散文记号"
                              //   不是 API！编译零警告、运行时 → transparent → 文字/图标不可见
```

这就是本仓最容易踩的坑：**设计文档写得越漂亮，实现越容易照抄记号**。常用映射：

`text.pillName → textPrimary`｜`text.chip → textSecondary`｜`text.pillNameError → dangerText`｜
`status.danger → statusError`｜`text.thinkingPrimary → textPrimary`｜
`brand.primary → brandAccent()`｜`brand.onPrimary → brandOnAccent()`

✅ **2026-10-11 补齐**：`warn` 已并入 `colorOf` 合法集合（`colorOf(p, 'warn') → Palette.warn`，
逐主题语义色，不自造色相）。守护 = `tools/tests/design.test.ts` 的"`warn` 必须解析出非 transparent"
断言 + 门禁 **⑥b**（`tools/lint/color-roles.sh`）。此前 `pal().warn` 只能绕过唯一入口（组件侧临时口径），
落地后应改回 `colorOf(p, 'warn')`。

✅ **2026-10-11 再补齐（目标⑤，porcelain-audit ⚠️-4）**：6 个此前**只能 `pal().xxx` 直取**
（⇒ 绕过 ⑥b）的角色已并入 `colorOf`，**取值逐字不变**（= 同名 `Palette` 字段）：
`foreground3` · `accentHover` · `accentSoftFade` · `bubbleUser` · `borderStrong` · `success`。
守护 = `tools/tests/porcelain_surfacehi_contrast.test.ts` §2（**形态**：真源必须含 `role === 'x'` 分支
+ **取值**：逐主题 `colorOf(p,'x') === p.x` 且非 transparent）。
⚠️ **`foreground3` 目前仍 0 消费点**（预留角色，见 `Palette.foreground3` 与 `theme_contrast.test.ts`
的 `ZERO_USE_ROLES`）——接入**只为门禁覆盖**，⛔ 不代表它有落点。
⛔ **`transparent` 刻意不接入**：它是"未知 role"的**兜底返回值**，登记成合法 role 会让"请求了一个
渲染为不可见的名字"（拼错 role 的典型症状）不再被 ⑥b 抓住 ⇒ 保留其**哨兵**语义。

### 12.3 机器判据（硬红）

`bash tools/lint/color-roles.sh`（已接入 `tools/gate.sh` 的 **⑥b**，**硬红**）：

- **合法集合从 `core/design.ets` 抽取**（`role === '…'` / `new SurfaceRole('…')` / `new TypeRole('…')`）
  ⇒ 真源改集合，判据自动跟随；⛔ 不硬编码、不复制粘贴。
- 只查**字符串字面量**实参 ⇒ 写 `SURFACE_COMPOSER` / `TYPE_PILL_NAME` 常量天然是推荐姿势。
- 自带**零扫描判红**（防"正则与真源脱节 ⇒ 白绿"）。
- **mutation 自证**：注入 `colorOf(p,'text.pillName')` 必红（实测✅）、同一副本不注入必绿（实测✅）。
  2026-10-11 落地时真树 **32 处取色调用全部合法** ⇒ 无存量欠账 ⇒ 可直接硬红。

### 12.4 纪律（违反即回归）

1. 组件里**不许出现**真源集合之外的取色 role 字面量（⑥b 会红）。
2. 需要**新**颜色角色 ⇒ 加进 `core/design.ets` 的角色表（⛔ 不在组件里硬写字面量 hex）。
3. `docs/REDESIGN-INPUT-*.md` 与 `docs/mockups/*.html` 中的**带点记号是散文**，
   实现时必须按 §12.1 翻译；发现新记号 ⇒ 回填本表。

---

## 13. 「特制白色主题」的层次语言（porcelain/light 专属，2026-10-11）

> 问题（本波起点）：porcelain 此前本质是"**把深色 token 中性化**"（`glow/glowSoft` 落中性柔影等）。
> 但"特制白主题"要的是**反向设计**：**深色靠发光/玻璃分层；浅色必须靠结构分层**。
> 依据：`docs/REDESIGN.md §3.1/§3.4`（浅色系禁彩色发光；白底靠"发丝 + 柔影"立层次）。

### 13.1 原则（一句话）

**深色的层次 = 加色（发光/彩色玻璃/深影）；浅色的层次 = 减色 + 结构（发丝、内描边、白度差、柔影）。**
⇒ 浅色下任何"靠光晕/彩色渐变立住"的表达都是**错译**，必须换成结构手段。

### 13.2 四处落点（面 / `file:line` / 改前 → 改后 / 判据）

> ✅ **L2/L3/L4 已落地**（2026-10-11，`core/theme.ets` 由 tokens-ux 交出后）。**实测改前→改后**：
> · **L2**：porcelain `appBg #FFFFFF → #F7F7F8`；`contrastRatio(surface, appBg)` **1.0000 → 1.0706**（≥1.03 ✓）；
>   `hairline` 由 `border` 按 `HAIRLINE_TARGET_RATIO` **派生**⇒自动压深 `#DFDFE1 → #D8D8DA`（**1.3294 ≥ 1.3201**，
>   结构边界**未被削弱** —— 这是 L2 安全的证据）；四阶文字全部复核达标（`theme_contrast` 617/0）。
> · **L3**：浅色 `elev2` `textPrimary@10% → @7%`（`#1A1D1D1F → #121D1D1F`）；**副作用已知并接受**：
>   `elev2` 同时是浅色 `inflightHaloOf`（光球外光晕）与「`glowSoft` 的同族参照」⇒ 契约改为**强弱序**
>   `elev2(@7%) < glowSoft(@10%) ≤ glow === elev3(@16%)`（原"同值"断言按新值更新）。
> · **L4**：浅色 `glassBg @62% → @80%`（`#9E… → #CC…`）、`glassBorder @55% → @70%`；**深色臂逐字节不变**
>   （原公共段的值搬进 `else` 臂，`dark/aurora/nebula` 三条快照未动）。
> · **L2 的连锁（正确）**：porcelain `surface≠appBg` 后，历史那条"玻璃基色切换为 `surfaceAlt`"**不再必要**
>   ⇒ `glassBase` 自动回到 `surface`（纯白玻璃压淡灰画布 = 更清楚）。

| # | 面 | 落点 | 改前（浅色实测） | 改后（浅色目标） | 判据（可量化） |
|---|---|---|---|---|---|
| L1 | **面-to-面的结构性分隔**（卡片轮廓 / 分区边界） | `components/SettingsRows.ets:540` 等卡片边界（本波已落 **`structuralRuleOf`**，见 §13.4） | `hairline` = `#DFDFE1`，对画布 **1.3308:1** | `borderStrong` = `#D8D8DC`，对画布 **≈1.45:1** ⇒ 卡片轮廓在纯白上"看得见" | 分隔色对相邻底的对比 ≥ **1.32**（`HAIRLINE_TARGET_RATIO`，web 基线）且**卡轮廓 > 内行分隔**（层级差 ≥ 一个档） |
| L2 | **卡片/well 的"白度差"**（`appBg` 与 `surface` 在 porcelain 下**同为 `#FFFFFF`**） | `core/theme.ets` 的 `porcelainPalette()`：`appBg=#FFFFFF` / `surface=#FFFFFF` | 卡片只能靠发丝区分（无白度差） | 画布压**极淡灰**（如 `appBg` → `#F7F7F8`），卡片保持纯白 ⇒ "白卡浮在淡灰底上" | `contrastRatio(surface, appBg) ≥ 1.03`（肉眼可辨的白度差）|
| L3 | **柔影 vs 白度差**（`elev1/elev2`） | `core/theme.ets:buildEffects()` 浅色臂 | 浅色 `elev2 = textPrimary@10%`（**纯柔影**） | 浅色**降低柔影依赖**：卡片优先"白度差 + 内描边"，柔影只留给**真浮层**（Sheet/菜单） | 卡片面**不依赖**柔影也能被识别（L2 的白度差 + L1 的轮廓）|
| L4 | **玻璃的浅色档** | `core/theme.ets:buildEffects()`：`glassBg = alphaHex(glassBaseOf(p), 0.62)` | 62% 不透明度（深色同理） | 浅色**提高不透明度**到 ~0.80（白底玻璃更"实"）+ 边界走 `glassBorder`（现 55%→更明确） | 玻璃面上的文字对比 **≥4.5**（合成后），且玻璃边缘对比 ≥1.32 |

> ⚠️ **L2/L3/L4 全部落在 `core/theme.ets` 的 `buildEffects()`/`porcelainPalette()`**。该文件**当前被 `tokens-ux` 在改**（强调色根因调查）⇒ 本波**只出 spec、不落代码**（§13.5 给出待落参数表）。

### 13.3 浅色专属参数表（`core/theme.ets`，待 `tokens-ux` 释放后落地）

| token | 深色现状（**逐字节不变**） | 浅色现状（"中性等价"） | 浅色目标（**特制**） | 为什么"有手感"而不是"深色去掉发光" |
|---|---|---|---|---|
| `sheen` | `#FFFFFF@6%` | `#000000@6%`（极淡黑扫光） | 保持（浅色扫光=极淡黑，物理正确） | 浅底"高光"是**暗**的（不是白），已正确；无需动 |
| `elev1` | `legacyElev1Of` | `legacyElev1Of`（同一支） | 保持（最小档不承载结构） | 最小档只做"贴边"暗示 |
| `elev2` | `#000000@32%` | `textPrimary@10%` | **降到 `@7%`**（浅色柔影更克制）+ 由 L2 白度差接管分层 | 浅色**不该**用深影分层（会"脏"）；影越克制、结构越清晰 = 白主题的"手感" |
| `elev3` | `#000000@42%` | `textPrimary@16%` | 保持（只用于真浮层 Sheet） | 真浮层需要"浮起"，浅色也需要 |
| `glow` / `glowSoft` | `accent@45% / @22%` | `textPrimary@16% / @10%`（中性） | **不动**（V6 待真机截图定夺，见 §13.6） | — |
| `glassBg` | `glassBase@62%` | `glassBase@62%` | **浅色 `@80%`**（白底玻璃更实、更明确边界） | 深色玻璃=**透光**（露出后面的彩色）；浅色玻璃=**磨砂白**（透出灰会"脏"）⇒ 不透明度必须更高 |
| `glassBorder` | `borderStrong@55%` | 同 | 浅色 `@70%`（边界更明确） | 浅色靠"描边"立玻璃边界（不是靠对比） |
| `appBg`（porcelain） | — | `#FFFFFF` | **`#F7F7F8`**（画布淡灰）| 白卡浮在淡灰上 = Apple 浅色语言；纯白画布上白卡**无白度差** |

### 13.4 已落地（本波，`core/design.ets` 干净、可动）

**`structuralRuleOf(p)`** —— "面-to-面的**结构性分隔**"唯一出口（与 `hairlineOf` 的"面**内**发丝"成对）：

| | 浅色系（`isLightPalette`） | 深色系 |
|---|---|---|
| 取值 | `p.borderStrong`（`#D8D8DC`，对白 ≈1.45:1） | `p.border`（**逐字节不变**） |
| 用途 | **卡片/分区的轮廓**（面的外边界，必须"看得见"） | 同（深色族 `borderStrong≈border`，观感不变）|
| ⛔ 不用于 | 面**内**的行分隔（那是 `hairlineOf`） | — |

- **为什么需要**：`hairline` 的目标是 **1.3201**（`docs/DESIGN-SYSTEM.md §9.2` 的 web 权威基线，**面内**发丝够用）；
  但**面的轮廓**（卡片压画布的边界）在纯白上需要**更强**的档 ⇒ 用色板里**既有的** `borderStrong`
  （本来就是"次要按钮描边"用的强边界色），**不新造色值**。
- **判据**：`tools/tests/porcelain_layering.test.ts`（浅色 `structuralRule` 强于 `hairline`；深色 `=== border` 逐字节）。

### 13.5 纪律（违反即回归）

1. **浅色禁"靠发光/彩色渐变立住"**（`docs/REDESIGN.md §3.1`）——层次只能来自**发丝 / 结构分隔 / 白度差 / 柔影**。
2. 分隔分两档、⛔ 不可混用：**面内** = `hairlineOf(p)`；**面到面** = `structuralRuleOf(p)`。
3. 深浅只经 `isLightPalette(paletteOf(theme))`；新建 role 必须登记 `colorOf` + 有判据。
4. **深色逐字节不变**：任何浅色再设计都必须在 `if (light) {…}` 分支内完成。
5. ⛔ **`surface.card` 的面线必须有立边**（2026-10-13 加）：`surface.card` 与 `surface.overlay`
   **同属 `RUNG_CARD`**（`core/design.ets:345-346` ⇒ 同一 `fillOfRung`）——**填充色逐字节相同**。
   所以"给容器设了 `surface.card` 底色"**本身不产生任何视觉分离**：卡片写在面板（`surface.overlay`）上时，
   缺 `.border({ width: STROKE_HAIRLINE, color: structuralRuleOf(p) })` ⇒ 卡片**完全隐形**
   （真机像素实测：卡内 / 卡间隙 / 面板底三点同为 `(13,15,20)`，面板读作"一墙数字"）。
   豁免（如坐在画布上、与底本就不同色；或纯裁切容器）**必须**登记 `tools/tests/free_surface_unify.test.ts`
   的 `KNOWN_CARD_GAPS` 并写明理由。判据：该文件 ③（含"**无立边也算违规**"）+ L2 站点表（含访问器形态）。

### 13.6 品牌标记**不随主题**（2026-10-11 用户拍板，关闭 ① 第二半）

> **开屏/应用标记（logo）恒用品牌色 `brandAccent()`（深色紫 `#7C5CFF`），⛔ 不做浅色变体。**
> 依据（用户拍板原文）：① **logo 是品牌资产**，不该跟随主题强调色 —— 否则用户换强调色时 logo
> 跟着变色，反而**廉价**；② 系统 `startWindowIcon` 是**单一静态资产**，做两套必然引入
> **T0↔T1 品牌色跳变**。
> ⇒ 与 `docs/BRAND.md §12.1` 的结论一致：**不生成浅色标记资源**（本项关闭）。
> ⚠️ 应用内**界面**的强调色仍走各主题自己的 `accent`（`brandAccentFor` 仅用于"浅色面标记"的
> **对比度取值**判断，不改变渲染资源）。

### 13.7 `effects` 表 · 「辉光算不算光」的判据（E2，2026-10-11）

| 判据 | 阈值 | 依据 |
|---|---|---|
| ① 中心对底（合成后） | **≥ 1.5:1** | <1.5 的"光"在视觉上不是发光，是**一块更亮的底** |
| ② 色彩语义（chroma） | **饱和度 ≥ 3%** | 零 chroma 的中性灰叠一层 ≠ 光，读作**脏灰团**（⛔ 不能用严格 `r==g==b`：1/255 的差也算"有色彩"） |

**实测（改前）**：浅色 `glow = textPrimary@16%` ⇒ 合成 `rgb(212,212,213)`、对底 **1.383:1(porcelain)/1.394(light)**、chroma≈0.5%
⇒ **两条都不满足**（不是光，是灰团）。深色 = `accent` 紫 **1.771**、chroma 64% ✅。

**结论（已落地）**：**浅色系一律不出辉光** ⇒ `effectsOf().glow = p.transparent`（`core/theme.ets` 浅色臂）。
⛔ 备选"浅色改 accent"**已实测否掉**：`accent@16%`→1.238、`@10%`→1.14，须 ≥24% 才到 1.5 ⇒ 变**脏彩**。
星形图案 + 文案本身已足够表达空态；浅色的层次由 **发丝 / 白度差 / 柔影（§13.2-13.3）** 负责。
- 门禁：`tools/tests/porcelain_glow.test.ts`（判据 + 全主题 + 深色逐字节 + mutation）。
- ⚠️ **`glowSoft` 未动**（V6 冻结，等真机截图）——它同样零 chroma，若定夺采纳，同法改透明。
- ⚠️ **调用点**（`pages/Index.ets:3176/3191/3283/3949`，归 main agent）：把 glow 当**投影**用的那几处，
  浅色下会变成"无投影"；若要保留浅色柔影，改走 `elevationColorOf(p, …)`。

### 13.8 语义色**当小号正文**时的正文级门槛（porcelain ⚠️-1，2026-10-11）

`warn`/`success` 在 porcelain 被**当小号正文**用（13 处 `.fontColor(pal().warn|success)`：`AskUserSheet:113`/
`MessageRow:563`/`QueueSheet:111`/`SelfCheckSheet:60`/`SettingsAbout:445,461,552,568`/`SettingsChannels:476,556,562,1053`/
`Index.ets:3942,4053,4196`）⇒ 必须过 **AA 正文 4.5**（不是非文本 3.0）。旧值 `warn #B26A00`=4.238 / `success #1E8E3E`=4.205
（porcelain 专属；light 主题 `#92400E`=7.09 / `#047857`=5.48 早已达标）。

| 角色 | 旧 | 新（**保色相压深**） | 对 surfaceHi（最紧面） |
|---|---|---|---|
| `warn` | `#B26A00` | **`#9C5900`** | 3.625 → **4.674** |
| `success` | `#1E8E3E` | **`#1B7A34`** | 3.597 → **4.629** |
| `statusWaiting` | `#B26A00` | **`#9C5900`**（与 `warn` 同值；作点色，0 文本落点） | 3.625 → **4.674** |

- 取值 = 三通道**同比压深**（与 neon `accentDeep` 同法）；目标 = 白底族六面全 ≥4.5。
- ⛔ 未碰 `successText`(7.13)/`dangerText`(6.57)；⛔ 阈值未放宽。判据 = `theme_contrast.test.ts` **§J**（含零扫描 + mutation 18 红）。
- ⚠️ 影响面：`success` 亦作 goal 徽标 tint（`design.ets:635`）⇒ 浅绿底略深；**待真机连拍**核对观感。

> `foreground3`（web `--foreground-3` 对齐）：本仓 **0 生产消费点** ⇒ **预留角色**，已登记
> `theme_contrast.test.ts:ZERO_USE_ROLES`（⛔ 不删；接线后请纳入 §B 判定）。

### 13.9 L3（内嵌凹槽）的边界通道**二分** —— 含 `AuthImage`/`MarkdownView` 例外（2026-10-12 立规）

> **来源**：E1 待批 #4（`docs/WEB-ALIGNMENT.md §21` 留痕；判据侧登记见 `tools/tests/free_surface_unify.test.ts`
> 的 `KNOWN_PENDING` 两条：`components/AuthImage.ets` / `components/MarkdownView.ets`）。
> **问题**：`free_surface_unify.test.ts:8` 把 L3 写成「well/chip → `insetHairlineOf`」，
> 但 `AuthImage` 图片卡（`surface.chip`）与 `MarkdownView` 代码块（`wellOf`）**都是 L3 却用 `hairlineOf`**
> ⇒ 是"漏统一"还是"有意"？

**裁定：L3 必须二分。⛔ 无条件套 `insetHairlineOf` 会把 **web 也有的浅色边**删掉。**

| L3 子类 | 判据（**web 逐字**） | 通道 | 已确认成员 |
|---|---|---|---|
| **L3-a** 无 web 边依据 | web 侧该块**浅色也无边** | `insetHairlineOf`（深色画 / 浅色 `transparent`） | `ToolPopover` 4 处 well、`PluginHost`/`PluginWidgets` chip（`9990c4b`） |
| **L3-b** 有 web 边依据 | web 侧该块**浅色也有边** | `hairlineOf`（**两族都画**） | `MarkdownView` 代码块、`AuthImage` 图片卡（下节逐字） |

**L3-b 的逐字依据（web 只读 `/Users/bobli/src/xbot/web`）**

| 本仓站点 | `file:line` | 面（rung） | 边（现状） | web 逐字 |
|---|---|---|---|---|
| `MarkdownView` 代码块 | `MarkdownView.ets:523-525` | `wellOf(p)`（`RUNG_SUNKEN`） | `hairlineOf` | `MarkdownRenderer.tsx:204-211` `border: "1px solid var(--md-code-border)"` + `backgroundColor: var(--md-code-bg)`；`index.css:198/302` `--md-code-border: var(--border)` ⇒ 浅 `#e0e0e0`、深 `#3c3c3c` **两族都有边** |
| `AuthImage` 成功态图片卡 | `AuthImage.ets:88-98` | `surfaceFillOf(p, SURFACE_CHIP)`（`RUNG_SUNKEN`） | `hairlineOf` | 成功态 `MarkdownRenderer.tsx:291` 仅 `rounded object-contain`（**无边**）；**失败态** `:267-269` `border border-border bg-bg-tertiary`（**有边**） |
| `AuthImage` 失败/兜底态 | `AuthImage.ets:122-141` | 同上 | `hairlineOf` | 同上（web 失败态 `border-border`） |

⚠️ **`hairlineOf` ↔ `insetHairlineOf` 在深色三族（dark/aurora/nebula）逐字节相同**（都 = `surfacesOf(p).hairline`）
⇒ 上述二分**只在 light / porcelain 有像素差**（L3-b 保留那道线，L3-a 没有）。

**⛔ 不要硬套「内嵌卡」规格**（E1 统一的是 L2）：`AuthImage`/`MarkdownView` 的面阶是 `RUNG_SUNKEN`(4)，
而内嵌卡是 `RUNG_RAISED`(2)（`surface.card`/`surface.pill`）+ `structuralRuleOf` + `shadowLayersOf` **两层影**
（对照 `SyntheticCard.ets:301-319`）。硬套 = 同时改**面（色）+ 边（通道）+ 加影**；
而 web 的 markdown 内嵌容器**一律无影**（`MarkdownRenderer.tsx` 全文无 `shadow`；`index.css:532-594` 的
`.markdown-body` 段无 `shadow`）⇒ **硬套会错**。

**登记（本轮只立规、不改代码；两条均"需拍板"）**

1. `AuthImage` **加载态**（`AuthImage.ets:107-117`）**无 `.border`** —— 与同组件成功/失败态不一致；
   深色族 `chip vs 画布 = 1.0005`（`tools/tests/image_boundary_gate.test.ts` §C 实测）⇒ 该态深色下无边界。
   逃过判据的机制：`image_boundary_gate` 只扫 `Image(`，而加载态是 `LoadingProgress()` + `Text`（非 `Image(`）。
   ⚠️ **无 web 逐字依据**：web 加载占位 `MarkdownRenderer.tsx:283-287` 只有 `minHeight`（无面、无边）。
2. `MarkdownView` **引用块**（`MarkdownView.ets:272-277`）面 = `eff().glassBg`（**玻璃族**）；
   web = `background: var(--md-blockquote-bg)`（`index.css:568` + `:192` ⇒ `--bg-secondary`，即**语义面**而非玻璃）。
   `§9.3`（`:433-434`）**已记录其底 = `eff().glassBg`**，但那句只判「**不是 `elev*` ⇒ 不迁 `sunken`**」
   ⇒ **未与 web 的 `--bg-secondary` 对照过**；`docs/REDESIGN-INPUT-MARKDOWN.md:57/105`
   已判"语义错位"并给出目标角色 `mdQuoteSurface` ⇒ 属**已识别的 redesign 项**（涉 `core/**` 新角色）。

---

## §14 浮层/面板的**边界可读性**（含柔影的合成模型 · 2026-10-11 离线实测）

**背景**：`bindPopup` 的 **7 处**浮层 + `MenuSheets`/`StatusSheet`/`AskUserSheet`/`TodoPanel`/`Toast`
的 `.shadow(...)` 面板**只开三个口子**（`popupColor` / `radius` / `shadow`，⛔ **无描边**）
⇒ "面板 vs 页面"的边界只能由 **填充色差 + 柔影** 承担。玻璃/卡片的层数已单独量过，**这条此前没人量**。

**合成模型**（显式写出，⛔ 不藏假设）
- 浮层填充 = `surfaceFillOf(p,'surface.overlay')` ⇒ `RUNG_CARD` ⇒ **`p.surface`**（7 处 `popupColor` 全走它 ⇒ 单一口径）。
- 影色 = `elevationColorOf(p, ELEV_OVERLAY)` = `effectsOf(p).elev3`：浅色 **`textPrimary@16%`**、深色 **`#000000@42%`**。
- 影半径 = `shadowRadiusOf(p,'overlay')`：浅色 `20×1.5 = 30`、深色 `20`。
- **边的影强度** = 额定 α × **0.5**（对称模糊对直边恒为半高；本模型**唯一**近似，方向**乐观**）。
- 边界 = **浮层填充** 对 **被影压过的底** 的对比度（"台阶"）。

**实测（5 套主题，`tools/tests/overlay_boundary_contrast.test.ts`）**

| 主题 | 浮层填充 | 画布 | 填充vs底 | 影@边 | 台阶 | 净影(独自) | 影半径 |
|---|---|---|---|---|---|---|---|
| dark | `#0E0E14` | `#0B0B0E` | 1.0217 | 21% | 1.0342 | **1.0122** | 20 |
| light | `#FFFFFF` | `#F8FAFC` | 1.0463 | 8% | **1.2381** | 1.1833 | 30 |
| aurora | `#0b1424` | `#070c16` | 1.0620 | 21% | 1.0804 | 1.0173 | 20 |
| nebula | `#0f0a1e` | `#08060f` | 1.0376 | 21% | 1.0461 | 1.0082 | 20 |
| porcelain | `#FFFFFF` | `#F7F7F8` | 1.0706 | 8% | **1.2588** | 1.1758 | 30 |

**判据**：**至少一条通道**（填充 ∥ 影）≥ **1.03** = 仓内已批准的"面 vs 面"标准
（`docs/DESIGN-SYSTEM.md §13.3` L2 白度差；代码先例 `tools/tests/palette_accent_rule.test.ts:55`）。
⛔ **刻意不用** `HAIRLINE_TARGET_RATIO`=1.3201 —— 发丝是**线性锐边**、浮层是**面差**，不同感知通道。

**结论（与"浅色更弱"的直觉相反）**
- **浅色不弱，反而明显更强**：台阶 `1.2381/1.2588` vs 深色 `1.0342–1.0804`。
  原因：浅色的分层由 **白度差**（`#FFFFFF` vs `#F7F7F8`/`#F8FAFC`）接管，**柔影独自就有 1.18**；
  深色几乎只剩影，而**黑影压在近黑画布上等于没有**（净影 1.008–1.017 < 1.03）。
- **"影更浓"≠"边界更清楚"**：深色 α42% > 浅色 α16%，但净影**更弱**。
- 深色族的边界**完全靠填充兜底**（`#0E0E14` vs `#0B0B0E` = 1.0217）—— 一旦填充贴近画布，边界立刻消失。

**⚠️ 待路由 spec（1 条，归 `brand-impl`）**
`dark` 的 `max(填充 vs 底 1.0217, 净影 1.0122) = 1.0217` **< 1.03 ⇒ 两条通道都不达标**（浮层没有可靠边界）。
根因：7 处浮层用的是 `elevationColorOf(p, ELEV_OVERLAY)`（深色 = `#000000@42%` 黑柔影），
而仓里另有 `shadowColorOf(p,'overlay')`（`theme.ets:893+`）在深色返回 **`glow` = `accent@45%`**（彩色发光）——
**浮层没用它**。可选方向（⛔ 由 brand-impl 定，本线不改 theme/design）：
① 深色浮层改用发光档（`shadowColorOf`）；② 或抬深色浮层的填充白度差 ≥1.03。
判据侧已把它登记为**受管的例外**（`PENDING_SPEC: string[] = ['dark']`，mutation 证"清空例外名单 ⇒ 判红"）
⇒ ⛔ 例外名单**只许缩短**，不许随手加。

---

## §15 深色主题「边界通道」总审计（`§14` 缺口的一般化 · 2026-10-11 离线实测）

`§14` 只量了**浮层**。本节把同一套模型扩到**深色全部面层级**，并给出一张**缺口表**。

**⛔ 本审计最重要的一条纪律：只把「实际接线」的通道计入判定。**
第一版我把 `effectsOf(p).glow`（accent@45%，净 1.25+）当成一条通道算进每个面 ⇒ **7 对全部"达标"、缺口表空**。
但 `§14` 已证：**浮层用的是 `elevationColorOf`（黑影），根本没接线 glow** ⇒ 那是**潜力**不是**通道**。
⇒ 现在每条通道都带 `wired` 语义；未接线的只报潜力、**不参与判定**（并有 mutation 钉住这条纪律）。

**深色逐层实测**（`tools/tests/dark_boundary_channels_contrast.test.ts`）

| 相邻对 | 上面 | 下面 | 填充白度差 | 影/边（**已接线**） | max | (参考)发光潜力 |
|---|---|---|---|---|---|---|
| **画布→卡** | `#0E0E14` | `#0B0B0E` | 1.0217 | 1.0064（elev1 @24% 黑） | **1.0217 ✗** | 1.2545 |
| 卡→抬升 | `#14141C` | `#0E0E14` | 1.0504 | 1.0142（elev2 @32%） | 1.0504 ✓ | 1.2725 |
| 抬升→激活 | `#1D1D28` | `#14141C` | 1.0977 | 1.0270（elev2 @32%） | 1.0977 ✓ | 1.2867 |
| **画布→下沉** | `#0B0B0F` | `#0B0B0E` | 1.0005 | ——（内凹·**无影**） | **1.0005 ✗** | 1.2545 |
| 画布→玻璃 | `#0D0D12` | `#0B0B0E` | 1.0140 | 1.0810（**玻璃描边**） | 1.0810 ✓ | 1.2545 |
| **卡→浮层** | `#0E0E14` | `#0E0E14` | **1.0000** | 1.0206（elev3 @42%） | **1.0206 ✗** | 1.2725 |
| **画布→浮层** | `#0E0E14` | `#0B0B0E` | 1.0217 | 1.0122（elev3 @42%） | **1.0217 ✗** | 1.2545 |

**结论：深色到底靠哪条通道分界？**
1. **靠「填充白度差」**（5/7 对的最强已接线通道）+ **「玻璃描边」**（玻璃面唯一通道，1.0810）。
2. **「影」几乎完全失效**：深色 `elev1/2/3` 全是 **`#000` 黑柔影**（@24/32/42%），压在近黑画布上 ⇒
   净影 **1.0000–1.0270**（**全部 < 1.03**，除空档外没有一对靠影达标）。
   ⚠️ 注意这**不**矛盾于 `§14` 的"影更浓"：α 更浓（42% > 浅色 16%）但**净贡献更弱**（黑影+暗底）。
3. **「发光」是存在的第二通道，但没接线**：`effectsOf(p).glow = accent@45%`，净潜力 **1.25–1.29**（远超 1.03）
   —— 7 处浮层/各面层级**都没用它**（`shadowColorOf(p,'overlay')` 在深色返回它，但调用方用的是
   `elevationColorOf`）。⇒ **缺口是"没接线"，不是"没有手段"**。

**缺口表（已接线通道全部 <1.03 = 真缺口，4 处）**

| 缺口 | 填充 | 已接线边缘 | max | 可用的未接线通道 |
|---|---|---|---|---|
| 画布→卡 | 1.0217 | 影elev1 1.0064 | 1.0217 | 发光 1.2545 |
| 画布→下沉 | 1.0005 | 无（内凹） | 1.0005 | 发光 1.2545 |
| 卡→浮层 | 1.0000 | 影elev3 1.0206 | 1.0206 | 发光 1.2725 |
| 画布→浮层 | 1.0217 | 影elev3 1.0122 | 1.0217 | 发光 1.2545 |

**⚠️ 待路由 spec（1 条，归 `brand-impl`：`core/theme.ets` / `core/design.ets`）**
深色 4 处相邻对没有可靠边界，机制同一个：**深色的边缘通道只有"黑柔影"，而它在近黑底上等于没有**。
可选方向（⛔ 由 brand-impl 定，本线不改 theme/design）：
① **把 `glow`（accent 彩色发光）接给浮层**（`shadowColorOf` 已为此存在）—— 一处改动覆盖 卡→浮层/画布→浮层；
② `画布→卡` 抬白度差至 ≥1.03（与 L2 白度差同法）；
③ `画布→下沉` 是内凹面：要么抬填充差、要么给它一条**内凹发丝**（它现在连发丝都不在位）。
判据侧把 4 处登记为**受管例外**（`PENDING_SPEC` = 实测缺口集合，mutation 证"清空例外 ⇒ 基线红"）⇒ ⛔ **只许缩短**。

**浅色对照**（同模型同通道）：浅色缺口 **0**；同层级 overlay 比对 —— 浅色柔影净 **1.1806/1.1758**
vs 深色黑柔影 **1.0206/1.0122** ⇒ 再次确认"浅色柔影比深色黑影有用"。

---

## §16 「过渡帧可读性」审计（用户亲报"某一帧文字看不清"的**动画面** · 2026-10-11 离线）

**与 ⑨ 的分工**：⑨ 管**静息态**被写成隐藏（**无界** ⇒ 永久看不清，已修）；
本节管**动画进行中的帧**（**有界**：最长 320ms）。问法：**是否存在某一帧 < 阈值**。

**全仓过渡清单**（grep 枚举 `.transition(` 15 处 + `animateTo` 21 处，逐条归并成 6 类）

| id | 出处 | 属性 | 时长 | 判定 |
|---|---|---|---|---|
| T1 `sheetTransition` | `anim.ets:150` → 8 处（QueueSheet:104 · SettingsPanel:367 · PluginsSheet:228 · MenuSheets:157/276/388 · StatusSheet:230 · AskUserSheet:273 · Index.ets:5443/6166） | `translate(y:260) ⊕ OPACITY` | 220/180 | **允许**（整层面板到达中 + 有界 + 静息可读） |
| T2 `toastTransition` | `anim.ets:165` → `Toast.ets:75` | `translate(y:65) ⊕ OPACITY` | 220/180 | **允许**（同上） |
| T3 `entryTransition` | `MessageRow.ets:654` | `OPACITY ⊕ translate(y:4)` | 200 | **允许**（有界；静息态恒 = `entryRestOpacity()`=1，fail-safe，⑨ 已钉） |
| T4 splash overlay | `SplashOverlay.ets:221` | `OPACITY`（整屏让位） | 320 | **允许**（该层本就在消失） |
| T5 splash hint | `SplashOverlay.ets:213/221` | `OPACITY + translate` | 320 | **允许**（淡入到位后常驻） |
| T6 orb enter | `AssistantOrb.ets:397/699` | `alpha + scale` | 220 | **允许**（图形，不承载文字） |

**最坏帧模型**（显式写出）：`.transition(TransitionEffect.OPACITY…)` 作用在**整个人层** ⇒ 层以 α 合成到底
⇒ 层内文字的有效对比度 = `contrastRatio(compositeOver(textPrimary@α, canvas), canvas)`。
α 取**进度 p 的线性映射**（⚠️ `sheetTransition` 的曲线是 `Curve.Friction`（系统 enum，离线不可求值），
其真实前段比线性**更快** ⇒ 线性是**保守**模型，最坏帧只会更糟 ⇒ 结论方向安全）。

| 进度 p | 0.00 | 0.10 | 0.25 | 0.50 | 0.75 | 0.90 | 1.00 |
|---|---|---|---|---|---|---|---|
| porcelain 正文对比 | **1.0000** | 1.2253 | 1.7068 | 3.2731 | 7.3313 | 12.6073 | 16.8300 |
| dark 正文对比 | **1.0000** | 1.2625 | 2.0528 | 4.7630 | 9.4205 | 13.4144 | 16.4867 |

⇒ **最坏帧恒在 p → 0，对比度 = 1.00**：**任何"从 α=0 淡入"的过渡都有这一帧**。

**推导**：若某过渡被声明为"**动画期间内容就该被读懂**"，其**不透明度地板**必须 ≥ ——

| 主题 | dark | light | aurora | nebula | porcelain |
|---|---|---|---|---|---|
| 正文需地板 α ≥ | 0.481 | 0.591 | 0.508 | 0.497 | **0.606** |

⇒ 全主题取最严 **α_floor = 0.606**（正文档 4.5 反解）。

**判定**：**全部 6 项归「允许」**（整层 reveal + 有界 ≤320ms + 静息态可读 = fail-safe）；
**「不足」0 项** —— 当前**没有任何**过渡被标为"动画期间内容就该被读懂" ⇒ **无真可读性缺陷**。
⚠️ 这也解释了为什么用户亲报的是 ⑨ 那类（**无界**）而不是过渡帧（**有界** ≤220ms，肉眼几乎抓不到）。

**判据 + mutation**（`tools/tests/transition_frame_contrast.test.ts`，12 passed / 0 failed）
- **内容型**过渡：地板必须 ≥ `α_floor`（0.606）；**reveal 型**：必须**有界**（≤320ms）。
- mutation：清单清空 ⇒ 红 · 把行入场标成"内容型"但地板仍 0 ⇒ **红**（"把可读性押在动画上"的复发形态）·
  **反向对照**：同样内容型但给了 ≥α_floor 的地板 ⇒ **绿**（证明不是"内容型一律红"）·
  把面板过渡拉成 600ms（超有界上限）⇒ 红 · 全部标成内容型 ⇒ 红。
- ⛔ 例外名单 `PENDING_SPEC` **只许缩短**。

**`0c0f13f` 复跑确认（`§15` 缺口表收敛）**：深色缺口 **4 → 2**（`卡→浮层` / `画布→浮层` 已修好，
浮层档净影 **1.2545–1.2725 ≥ 1.03**）；登记表按"只许缩短"同步缩短为 2 项（`画布→卡` / `画布→下沉`）。
⚠️ 同层级 overlay 比对随之**反转**：修复前浅色柔影（1.18）> 深色黑柔影（1.02），
**修复后深色浮层档（发光 1.27）> 浅色柔影（1.18）** —— 已按修复后事实更新断言。

### §15 附：**裁定 —— 发丝算不算「已接线通道」**（2026-10-11，回答 `brand-impl` 的卡点）

**裁定：算。** 判据是「**是否真的画出来**」，不是「由哪个 API 触发」。

**机制理由（两条证据 + 一条纪律）**
1. **声明 ≠ 接线**：`SurfaceRole.hairline`（`design.ets:314`）与其访问器 `surfaceHairlineOf`（`:362`）
   在生产代码里 **0 消费方**（9 处命中全在 `tools/`）⇒ **光有 `hairline=true` 不构成通道**。
   （这正是 AGENTS.md 批次 33b 的"死消费"形态。）
2. **但渲染是真的**：用 `surface.card` 填充的 **5/5** 组件（`SubAgentTree` / `SettingsPanel` /
   `PluginHost` / `PluginWidgets` / `SettingsRows`）**全部**调了 `hairlineOf(pal)` 画边；
   全仓共 **21 个组件**画发丝。⇒ `画布→卡` 这一对**确实有一道边**。
3. **纪律**：上轮"只计已接线通道"拦下的是**未渲染的潜力**（glow）。发丝**已渲染** ⇒ 按同一条纪律**必须计入**，
   否则就是反向自欺（把真实的边当不存在）。

**门槛**：发丝按**它自己的**标准判（浅 `HAIRLINE_MIN_LIGHT`=1.3201 / 深 `HAIRLINE_MIN_DARK`=1.20，
`design.ets:908-909`），**比面差 1.03 更严** ⇒ 达标的发丝不只是"够用"，是**更强**的边界手段。

⇒ **`画布→卡` 不再是缺口**（填充 1.0217 + **发丝 1.2194 ≥ 1.20**）⇒ `PENDING_SPEC` 由 2 项**缩到 1 项**
（`tools/tests/dark_boundary_channels_contrast.test.ts`，15 passed / 0 failed）。
⚠️ **对 `brand-impl` 的结论**：`画布→卡` **不必处置**，**也不需要改深色面阶梯** —— 通道已在。

### §15 附：`画布→下沉`（well/chip）**该不该加内凹发丝** —— 测量侧数据判断

| 主题 | 画布→下沉（填充） | 下沉发丝 vs 画布 | 下沉发丝 vs 下沉 | 发丝门槛 |
|---|---|---|---|---|
| **dark** | **1.0005** | 1.2194 | 1.2188 | 1.2000 |
| light | 1.0788 | 1.3327 | 1.2354 | 1.3201 |
| aurora | 1.0198 | 1.4441 | 1.4160 | 1.2000 |
| nebula | 1.0173 | 1.3518 | 1.3288 | 1.2000 |
| **porcelain** | **1.0456** | 1.3294 | 1.2714 | 1.3201 |

**数据判断**：
- **浅色 well/chip 本来就分得开**：porcelain **1.0456** / light **1.0788**（≥1.03 面差标准）⇒
  加内凹发丝是**锦上添花（1.0456 → 1.2714），不是补缺** —— ⚠️ 而且会**给浅色凭空多一道线**，
  在"浅色靠白度差分层、发丝应当克制"的既定口径下属于**增噪**。
- **深色才是真缺**：dark **1.0005**（几乎完全重合）且**无任何已接线通道** ⇒ 加内凹发丝能把它救到 **1.2188 ≥ 1.20** ✓。
- ⇒ **倾向：该加，但只该对深色加**（否则浅色平白多一道边）。
  ⛔ 而 `SurfaceRole.hairline` 是**主题无关的 `boolean`**，`surfacesOf().hairline` 也**按主题取值**
  （浅色 `deepenToRatio(border,…)` / 深色 = `border`）—— 所以"只对深色加"**不能**靠现成的 role 开关表达，
  需要 `brand-impl` 决定用哪种机制（例：新增一个**只服务深色**的 role，或给 sunken 一个深浅分叉的发丝出口）。
  **最终设计裁定归 `brand-impl`**；本节只给"浅色不缺、深色缺"的数据。

### §16 附：裁定 —— **代码条/表格标签有意保持紧凑，不随字号档放大**

**裁决（2026-10-11）**：`MarkdownView` 的**代码条**（语言标签 / 「复制」）与**表格字段标签**的 `fontSize(11/12)`
**不走 `sz()`**（即**不乘 `fontScale`**）—— 这是**有意**，不是缺陷。

**理由**：它们是**结构性附属说明**（附着在代码块/表格上的元信息），跟着正文一起放大只会
**挤占代码/表格本身的可读宽度**；字号档要放大的是"要读的内容"，不是"内容的标签"。

**已钉住**：`tools/tests/type_role_gate.test.ts §C2` —— 断言这三个站点**不得**被改走 `sz()`
（若后人"顺手统一"就会红，并把这条裁决原文回放出来）。⛔ 别再当 spec 挂着。

### §17 附：**口径修正（2026-10-11，代修 3 条 spec 时发现）**

代修 `SettingsDeveloper:302` / `SettingsLlm:1420` / `SplashOverlay:174` 三条 spec 时，**逐条核实语义位后发现三条都不是真违规**
—— 是**判据口径不对**（按主 agent 的指示：口径与真实语义位不符 ⇒ **修判据，不回退代码**）。

**(a) 禁用/降级态弱化不算违规。**
`textMuted` 出现在**三元表达式的退化分支**（`cond ? A : textMuted`）时，语义是"**不可用/降级时灰显**"，
且那时**不可点** ⇒ 禁用态的可视性要求低于可交互态 ⇒ **有意弱化**，不算违规。实测两处：
- `SettingsDeveloper.ets:302`：`chatID.length > 0 ? onAccent : textMuted`（压在它自己的 `surfaceAlt` 上）；
- `SettingsLlm.ets:1420`：`perModelEditReason(...).length > 0 ? textMuted : accentSoft`
  —— 源码注释原文："拿不到既有配置 ⇒ **灰显 + 不可点**"。
⇒ 判据已改为：**三元分支里的 `textMuted` 不计**（仅在**无条件取色**时才算候选）。

**(b) 必须按「实际宿主底」判，⛔ 不能按"porcelain × 光面"一刀切。**
`SplashOverlay.ets:174`「轻点跳过」的宿主是 **`splashBrandCanvas()` = 恒深 `#0B0B0E`**（不是浅面）⇒
`textMuted` 在其上：**porcelain 7.73 · light 7.67 · dark 3.32 · aurora 4.99 · nebula 4.90**（**全 ≥ 3**）
⇒ **达标，不是违规**。⇒ 判据已加 **宿主感知**（对该站点用真宿主色），并把这份数字**钉成断言**（画布若变浅会立刻红）。
⚠️ 原先的红是**判据口径错**，不是产品错 —— 这正是"判据 ≠ 信号"的又一例。

**⭐ 校准口径（铁律）**：`role_surface_floor` 的台账按**已提交树**（`git worktree add --detach /tmp/x-ck HEAD`）校准，
**主树只用于开发**——主树可能含**别人未提交的修复**，按主树校准 ⇒ 一到干净树就"未登记"（我踩过：4 处 `MessageRow` 违规被主树在途修复掩盖）。
**他域待修项登记为 `PENDING_SPEC`；谁修完谁收缩台账。** 另：判据的输出必须**逐条打印全部违规**
（`role_surface_floor` 第一版只打印**去重键** ⇒ 4 处显示 1 行 ＝"摘要掩盖真数"，已修并加**打印完整度断言**）。

### §17 附：**台账已收缩为空（2026-10-11，`8591d85` 之后）** + 一条方法论

`chat-surface-ux` 在 `8591d85` 修掉 7 处（`MessageRow` 图标×4 + 可点×1 · `LiveTailView` · `MarkdownView` ·
`Index` 的 `SymbolGlyph`×2 + `Text`）⇒ 按"**谁修谁收缩**"，`role_surface_floor` 的
`KNOWN_OK` 与 `PENDING_SPEC` **两张表都已收缩为空**（实测 0 命中）；`SplashOverlay:174` 由口径 (b) 覆盖、
`GoalBanner:153` 由口径 (a) 覆盖 ⇒ 都不占台账。**当前判据 = 纯守卫**（12 passed / 0 failed）。

**⚠️ 补上了一条本该早有的断言：「陈旧 == 0」。**
原先只断言"未登记 == 0"，**没断言"陈旧 == 0"** ⇒ `chat-surface-ux` 修完后我的 `PENDING_SPEC` 仍静静留着，
**没有任何东西逼我收缩** —— 这正是"台账悄悄腐烂"的入口。现已补：**台账挂着已修好的条目 ⇒ 必红**。

**⚠️ 方法论（第二次踩）：口径修正必须落到「扫描」里，不能只写进「台账 / 数字断言」。**
我把口径 (b)（宿主感知）只做成"登记 + 断言" ⇒ 扫描**仍报** `SplashOverlay:174` ⇒ "未登记"永远挡着；
把它**做进 `scanBad`**（判断是否压在 `splashBrandCanvas()` 上、用真宿主算）后才真正干净。

---

## §18 浅色「光感白」材质再设计（C3，2026-10-11）

> **backlog（本波起点）**：`sheen` / `elev` / `glass` 的**浅色档**此前只是**中性等价**（"把深色去色"），
> 不是**重新设计的手感**。**用户判据**：「一套**特制**的、**原生独享**的应用白色主题」+ 苹果科技感
> ⇒ 浅色档**不能只是"把深色去色"**。
> 与 §13 的关系：§13 立了"浅色靠**结构**（发丝/白度差/柔影）分层"的**原则**；本波（C3）在**同一原则**下
> 补**材质手感**（多层柔影 + 玻璃更实/亮边更明确），⛔ 不引入彩色辉光（§13.7 E2 仍成立）。

### §18.1 取证：浅色档"现状取值 + 怎么从深色派生"（`core/theme.ets:buildEffects`）

| token | 深色（`else` 臂 `:816-824`，**逐字节冻结**） | 浅色（`if (light)` 臂 `:788-813`，C3 前） | 浅色的"派生方式"（= backlog 说的"中性等价"） |
|---|---|---|---|
| `glassBg` | `glassBase@62%` | `glassBase@80%`（`:788`） | 同公式**只调高 alpha**（深色透光 ⇒ 浅色磨砂白） |
| `glassBorder` | `borderStrong@55%` | `borderStrong@70%`（`:789`） | 同公式**只调高 alpha** |
| `sheen` | `#FFFFFF@6%` | **`#000000@6%`（硬编码字面量，不走调色板）**（`:791`） | 白 → **黑的取反**（"浅底无法再提亮"） |
| `elev1` | `legacyElev1Of` = `#000@24%`（`:706`） | `legacyElev1Of` = `textPrimary@6%`（`:793`） | 同一公式，深色黑@24% → 浅色**正文色**@6% |
| `elev2` | `#000000@32%` | `textPrimary@7%`（`:798`，L3 由 @10% 降到 @7%） | 黑@32% → 正文色@7%（**去色 + 大幅降 alpha**） |
| `elev3` | `#000000@42%` | `textPrimary@16%`（`:799`） | 黑@42% → 正文色@16% |
| `glow` | `accent@45%` | `p.transparent`（`:810`，E2：浅色不出辉光） | 彩色 → **透明**（短路） |
| `glowSoft` | `accent@22%` | `textPrimary@10%`（`:813`，V6 冻结） | 彩色 → 中性正文色@10% |

**结论（= backlog 的实证）**：浅色档**每一个都是"深色同公式换基色/调 alpha"** ⇒ 有"正确性"，但没有
**为白色主题专门设计**的**层次/材质结构**：柔影只有**单层**（一个 `.shadow()`）、玻璃只是"更不透明"。

### §18.2 web 依据（只读 `/Users/bobli/src/xbot/web`）

| 观察 | `file:line` | 一句话 |
|---|---|---|
| 浅色 shimmer **是黑**（不是白） | `web/src/index.css:652` `:root { --shimmer-color: rgba(0,0,0,0.06); }` | 浅底"高光"物理上是**暗**的 ⇒ 本仓 `sheen=#000@6%` **与 web 同口径**（⛔ 不改） |
| 深色 shimmer 才是白 | `web/src/index.css:653` `.dark { --shimmer-color: rgba(255,255,255,0.08); }` | 深/浅 shimmer 基色**相反** = 既有正解 |
| 浮层/弹窗普遍用**多层 box-shadow**（`shadow-sm/md/lg/xl/2xl`） | `web/src/components/agent/SelectionToolbar.tsx:162`（`shadow-lg shadow-black/10`）· `AskUserPanel.tsx:114`（`shadow-lg shadow-black/[0.04]`）· `FoldedToolGroup.tsx:53`（`shadow-2xl`）· `SyntheticToolCard.tsx:451,576`（`shadow-sm`） | web **靠多层/多档 box-shadow 立层次**，且浅色档是**近乎中性黑**的低 alpha（`black/10`、`black/[0.04]`）⇒ 对标"贴合 + 环境"两档 |
| 玻璃 = **磨砂 + 描边**（不靠对比） | `web/src/index.css:1198-1247`（`.ambience-glass` 覆盖 `--bg-*`）+ `PanelChrome.tsx:106`（`shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.055)]` 内描边） | 玻璃的"边"是**一条明确的描边**（浅色下即"亮边"），与 §13.2-L4 一致 |

⇒ **苹果式手感的两个抓手**（本波落地）：① **多层柔影**（贴合 + 环境，web 即 `shadow-sm`+`shadow-lg` 的组合）；
② **玻璃更实 + 亮边更明确**（磨砂白 + 明确描边）。

### §18.3 改前 / 改后数值表（**只动浅色臂**；含影响面）

| # | token / 行为 | 改前（浅色） | 改后（浅色） | 为什么 | 影响面 |
|---|---|---|---|---|---|
| 1 | `glassBg`（`:793`） | `glassBase@80%`（`#CCFFFFFF`） | **`@84%`**（`#D6FFFFFF`） | 磨砂白**更像实心材质**（Apple material），不是"半透明灰" | **全站浅色玻璃**：`Index` 浮层/面板 8 处 + `MarkdownView:251` 代码块 + `MenuSheets` 等 |
| 2 | `glassBorder`（`:794`） | `borderStrong@70%`（`#B3D8D8DC`） | **`@86%`**（`#DBD8D8DC`） | **亮边更明确一档** —— 浅色玻璃靠**描边立边界**（§13.2-L4） | 同上（玻璃的面外边界） |
| 3 | **多层柔影**（新 `shadowLayersOf`，`:941-1029`） | 每元素**单层** `.shadow()`（浅色卡片只有一层柔影） | **浅色恒 2 层**：`near`（`elev1`，半径 `round(base×0.30)`、offsetY 1）+ `far`（`elev2`，半径 `shadowRadiusOf`、offsetY 4） | 苹果式层次 = **同族两档半径**（贴合 + 环境），不是"一个更大的影" ⇒ 有"落在纸面上"的接触感 | **首接** `components/SyntheticCard.ets`（卡面；外层 `Stack` 承载 `far`）；其余调用点可逐个迁移 |
| 4 | 深色 `shadowLayersOf` | — | 恒 `[near=**透明**, far=原单层]` | `near` **透明 ⇒ 不渲染**、`far` = 迁移前原值 ⇒ **净观感逐字节不变**，且**视图树不随主题分叉** | 深色/aurora/nebula **零观感变化** |
| 5 | `sheen`（`:791`） | `#000000@6%` | **保持** | web 权威 `index.css:652`：浅色 shimmer **就是黑@6%**（物理正确）；改白 ⇒ 白底不可见 + 背离 web | — |
| 6 | `elev1/2/3`（`:793/798/799`） | `textPrimary@6/7/16%` | **保持**（值） | L3 已定"浅色降柔影依赖"，本波**不加重影子**，改用**分层结构**（#3）提手感 | — |
| 7 | `glow`/`glowSoft` | 透明 / `textPrimary@10%` | **保持** | §13.7 E2（浅色不出辉光）+ V6 冻结 | — |

> ⛔ **深色逐字节不变**：`else` 臂（`:816-824`）一字未动；`shadowLayersOf` 深色臂的 `far` 也 = 原值。

### §18.4 判据与 mutation（`tools/tests/light_material.test.ts`，55 断言）

- **★① 深色逐字节不变**（⛔ **硬编码期望值**，不自比）：深色族 `shadowLayersOf('card')` 必须
  `[near 透明, far = {color: #3D000000, radius: 10, offsetY: 2}]`。
- **★② 浅色 = ≥2 层**：浅色族浅色 `shadowLayersOf` 必须 **2 层且都可见**（alpha>0），
  `near.radius(3) < far.radius(15)`、`near = elev1`、`far = elev2`；大面档走 `elev2/elev3`。
  **反向**：深色族**可见层数必须 == 1**（加层即回归）。
- **★③ 玻璃**：浅色 `glassBg=#D6FFFFFF` / `glassBorder=#DBD8D8DC`（硬编码）+ 方向断言（alpha ≥ 新值 > 旧值）；
  深色/aurora/nebula 玻璃**逐字节**。
- **★④ 零扫描判红**：`ALL_THEMES` 非空（白绿防线）。
- **mutation 自证（实测必红）**：① 浅色 `near.color` 改回透明（退回单层）⇒ **6 红**；
  ② 浅色 `glassBg` 改回 0.80 ⇒ **3 红**。（两处均**还原后复跑 55/0 绿**。）

### §18.5 诚实记账（⛔ 不藏限制）

1. **ArkUI `.shadow()` 每元素只能一层**（SDK `common.d.ts:21070` `shadow(value: ShadowOptions | ShadowStyle)`；
   同元素连调两次 = 覆盖，不是叠加）⇒ 真正"多层柔影"必须**两个元素**各挂一层
   ⇒ `shadowLayersOf` 返回**两层**，调用点（`SyntheticCard`）用外层 `Stack` 承载 `far`。
2. **`sheen` 不改**（方向里写的"sheen 改顶部高光"**被 web 证据否掉**）：web 浅色 shimmer = 黑@6%
   （`index.css:652`），浅底"高光"物理上是**暗**的 ⇒ "顶部高光"的语义改由 **玻璃亮边（#2）** 承担，更符合材质语言。
3. **`glowSoft` 仍冻结**（V6）；`glow` 仍透明（E2）。
4. `shadowLayersOf` 目前**只接 `SyntheticCard`**（浅色卡片的"接触感"最先可见）；其余档位（sheet/浮层）迁移
   不在本波，⛔ 但**函数已非死码**（`shadow_radius.test.ts` 的消费点断言已同步）。

### §18.6 二次复核（2026-10-11）：**C3 已落地，勿重复派单** + 真余量 G1/G2

> **写这一节的原因**：`C3 浅色「光感白」材质再设计` 在**后续批次**里又被当作"未做"提出过一次
> （任务书引用的"现状"正是 **§18.1 的 C3 前取证表**）⇒ 本节是**反工作留痕**：先把"已落地"钉死，
> 再列**真正剩下**的两项。

**① 复核（逐项，§18.2/§18.3 的设计均已在 HEAD）**：落地提交 = **`6534857`**（HEAD 祖先 ✓）。
| 设计项 | 现值（`core/theme.ets:buildEffects` 浅色臂） | 判据 |
|---|---|---|
| 玻璃更实 | `glassBg = glassBase@84%`（`:832`） | `light_material` ★③ |
| 亮边更明确 | `glassBorder = borderStrong@86%`（`:833`） | 同上 |
| `sheen`（浅色） | `#000000@6%`（`:835`）＝ web 权威 `index.css:652`（浅色 shimmer **就是黑@6%**） | ★③ |
| `glow`（浅色） | `p.transparent`（`:855`，E2：①<1.5:1 ②chroma=0 ⇒ 不是光） | `porcelain_glow` ★① |
| 多层柔影 | `shadowLayersOf` 浅色恒 2 层（`near`=elev1 贴合 / `far`=elev2 环境） | `light_material` ★② |
| **深色逐字节** | `else` 臂 `:861-869` 一字未动（0.62/0.55 · `#FFF@6%` · `#000@32/42%` · `accent@45/22%`） | 4 判据全绿：`light_material` 55/0 · `shadow_radius` 80/0 · `shadow_color` 22/0 · `porcelain_glow` 19/0 |

**三问答复（任务书 ① ② ③）**：
- **① 层次通道**：浅色**已**用「**发丝 + 白度差 + 柔影**」三分工（§13 立原则、§18 补手感）——`structuralRuleOf`
  （面→面轮廓，浅=`borderStrong`）、`hairlineOf`（面内发丝，浅=按 web 基线压深）、L2 白度差（`appBg` 淡灰 + 白卡）、
  `shadowLayersOf`（贴合+环境）。**「微内凹」已裁决不做**（`insetHairlineOf` 浅色 = `transparent`；理由：浅色填充差
  本就够（light 1.0788 / porcelain 1.0456）⇒ 加线 = 凭空增噪，见 `9990c4b`）。**「微降饱和」不适用**：浅色下
  `accent` 系本就按面派生（`accentDeep`/`accentSoft`），无"降饱和"通道需求。
- **② 玻璃档**：**已**按 web 权威重设计（`glass = 磨砂 + 描边`：web `PanelChrome.tsx:106` 内描边 / `.ambience-glass`
  `index.css:1198-1247`）⇒ 浅色 84% + 86% 亮边，**不再是"中性等价"**。
- **③ sheen**：**已裁决**——web 权威 `index.css:652` 明确浅色 shimmer **是黑@6%**（浅底"高光"物理上是**暗**的）
  ⇒ 保留 `#000@6%`；"顶部高光"的语义改由**玻璃亮边**承担（§18.5 #2）。⛔ "白底不该有 sheen"**被 web 证据否掉**。

**② 真余量 G1：多层柔影**落点**只 1 处**（`shadowLayersOf` 消费点 = `SyntheticCard`）
- 实测：全站 `.shadow({` **17 处**（9 文件）；**多层实现只 1 文件** ⇒ **15 处单层遗留 / 7 文件**
  （`AskUserSheet` · `Lightbox` · `MenuSheets`×3 · `StatusSheet` · `Toast` · `ToolVisual` · `Index.ets`×6）
  ⇒ 浅色的"贴合 + 环境"手感**在这些面看不到**（§18.5 #4 自认）。
- ⛔ **本线不改组件** ⇒ **交主 agent 串行派单**（迁移 = 把单层 `.shadow()` 换成 `shadowLayersOf` 的两元素两层）。
- ✅ **本线已把余量钉成机器台账**：`tools/tests/shadow_radius.test.ts` **★⑤**（多层消费文件 / 单层遗留文件
  **双向白名单**，任何变化 ⇒ 红 ⇒ 逼同步；mutation 自证：注入一个单层站点 ⇒ 红）。

**③ 真缺陷 G2：浅色 `glow = 透明` 与 `sweep.ets` 的 `core = glow` **冲突**（跨 token 交互，本轮发现）
- 实测：`core/sweep.ets:53-54` 浅色 `b.core = e.glow`（**E2 后恒透明**）、`b.fade = e.glowSoft`（`#1A1D1D1F` 可见）
  ⇒ 浅色扫光带**核心透明、两端有色＝反序退化**；该文件 `:52` 注释仍称 "core=`glow`(16%) 强于 fade=`glowSoft`(10%)"
  ⇒ **E2 后已陈旧**。
- ⛔ `core/sweep.ets` **不在本线域** ⇒ **只登记**（`porcelain_glow.test.ts` 的「E2 下游一致性」台账
  `KNOWN_GLOW_CONSUMER_DEFECTS`，只许缩短）+ **请派单**。
- **修法（供派单，二选一）**：ⓐ `sweepBandOf` 浅色臂的 `core` 换**独立中性档**（如 `effectsOf(p).elev2`），
  **⛔ 不复用 `glow`**；ⓑ **显式裁决「白底不做扫光」** ⇒ 整带全透明并把该渲染路径摘除
  （⛔ 不是"悄悄退化成两端有色"）。
- ⚠️ **诚实边界**：`glowSoft` 浅色**有真实消费**（`core/sweep.ets:53` 的 fade 端 + `Index.ets:3593` 的辉光渐变）
  ⇒ 它**不是死通道**；其"是否也改透明"仍按 **V6 冻结**（等用户真机截图）。


---

## §18 role × **实际合成底** 的可读性矩阵（2026-10-11）

**为什么需要它**：`theme_contrast` 只覆盖「**role vs 画布**」；而用户亲报的"白主题正文看不清"，
根因正是**底不是画布**（表格/代码块/玻璃/浮层/强调色叠加）⇒ 只比画布会**假过**。

**有效底的类别（**全部从渲染真源取，⛔ 不猜**）**：10 类 —— 画布 · `surface.card` · `surface.chip` ·
`surface.well`（代码块/终端/diff 行底）· `surface.pill` · `surface.overlay` · **玻璃（合成）** ·
`accent` · `dangerBg` · `warnBg`（真源：`core/design.ets` 的 `surfaceRoles()` 表层 + `surfaceFillOf`）。

**⛔ 半透明的底必须先合成，不许拿 `#AARRGGBB` 直接比。**
`effectsOf(p).glassBg` 是**基色 @62%**（实测 alpha=204）⇒ 有效底 = `compositeOver(glassBg, appBg)`
（合成后 alpha=253，**整数舍入**，故判据用「≥250 近似不透明」而**不是** `=== 255`）。
⚠️ 这条口径是**必要**的：我曾想用"对比度差 > 0.5"自证它，但 porcelain 的玻璃≈白底 ⇒ 与正文的对比度几乎不变
（16.56 vs 16.83）——**拿不敏感的量当判据＝假红**；改为直接断言 **alpha**（204 → 253）。

**矩阵规模**：12 role × 10 底（含"只允许压自家实心"的 `onAccent`/`dangerOnFill`/`warnOnFill`）× 5 主题 = **330 格**，
**逐格打印数值**（`!` 标低于门槛）。门槛取仓内已批准常量：正文 `AA_TEXT`=**4.5** · 非文本 `AA_NON_TEXT`=**3** ·
`textMuted` 的**非交互元信息**档 `AA_MUTED`=**2.0**（⛔ 一字不放宽）。

**当前最紧的几格（porcelain）**：

| role × 底 | 比值 | 门槛 | 余量 |
|---|---|---|---|
| `textSecondary` × 凹槽 chip / 行底 well | **4.53** | 4.5 | **+0.03** ⚠️ 最紧 |
| `iconMuted` × pill（dark） | 3.09 | 3 | +0.09 |
| `textSecondary` × pill | 4.70 | 4.5 | +0.20 |
| `onAccent` × accent（porcelain） | 4.70 | 4.5 | +0.20 |

**⛔ 硬性提醒（改动前必读）**：`textSecondary × 凹槽 chip / 行底 well` 的余量只有 **+0.03**
⇒ **任何人改「chip/well 面的填充」或「textSecondary 的字号/字重」之前，必须先跑
`bash tools/tests/run-one.sh role_surface_matrix`** —— 这两类改动最容易把该格推过门槛，
而它**肉眼看不出来**（4.53 → 4.4x 只差一点点，但已低于正文门槛）。

**不达标 1 格**：`dark | onAccent | accent` = **4.35 < 4.5** —— ⛔ **不是新缺口**，是**继承既有台账的既知条目**
（出处 `tools/tests/theme_contrast.test.ts:314` §G6「不许删」：它建模的是**纯色** accent，真主按钮渲的是**渐变**、
端色由 `gradientEndOf()` 护航到 ≥4.5）⇒ 本判据 `KNOWN_TIGHT` 登记它（⛔ 只许缩短）。

**⚠️ 本判据不硬红**：颜色对的缺口属**主题层**（`core/theme.ets` = `brand-impl`），本文件只把矩阵与缺口**如实列清**；
硬红仍由 `theme_contrast` 的既批准台账承担。本文件的断言只做"矩阵非空 / 无解析失败 / 覆盖健全 / 台账只许缩短 / mutation"。

---

## 15. 对比度阈值 = **字号档**（2026-10-11 校正）

> 问题（裁决 1）：同一个 role 在仓内被判成不同阈值 —— `textSecondary` 在 `contrastReqs()` 是 **4.5**、
> 在 `theme_contrast.test.ts` 的 `CANVAS_ROLES` 是 **3.0**、在 `role_surface_matrix` 是 **4.5**。
> 裁决方向：WCAG 的 4.5/3.0 分界**本质是字号**，所以**档位该跟"该 role 的消费落点用多大字号"绑**。

### 15.1 规则（唯一判据）

| 档 | 常量 | WCAG | 判什么 |
|---|---|---|---|
| **4.5** | `AA_TEXT` | §1.4.3 normal text | 有 **normal 字号（< 18.66px，或非 bold）的文字落点**的 role |
| **3.0** | `AA_NON_TEXT` | §1.4.11 非文本（= §1.4.3 large text 同值） | **只有非文本/图形落点**（图标/描边/点/弧/环）的 role |
| **2.0** | `AA_MUTED` | （仓内**有意**低于 AA） | 仅 `textMuted`：**非交互元信息**（时间戳/占位） |

- **large text**（≥18.66px **bold** 或 ≥24px）在本仓**不构成第三条**：排版阶梯（`core/design.ets: typeRoles()`）
  里只有 `type.display`(28) / `type.title`(21 **bold**) 达 large ⇒ **没有任何 role 只出现在 large 档**
  ⇒ 判据退化成"**有 normal 文字落点 ⇒ 4.5**，否则 3.0"。
- ⛔ `AA_MUTED` **不外扩**：它只给 `textMuted`（元信息不是"正文"）。

### 15.2 校正结果（逐 role 落点字号取证）

| role | 落点字号（`file:line`） | 校正后档 | 三个判据是否一致 |
|---|---|---|---|
| `textPrimary` | 15 / 17 / 21 / 28 | 4.5 | ✅（本来就一致）|
| `textSecondary` | 12 `LiveTailView.ets:439`/`SettingsLlm.ets:817`、10 `type.micro`、14 `type.callout` | **4.5** | ✅ 三处一致（`theme_contrast` 由 3.0 **收紧**到 4.5）|
| `accentSoft` | 12 `Index.ets:3891` '详情' / '重试' / '打开' | **4.5** | ✅（`theme_contrast`/`role_surface_matrix` 由 3.0 **收紧**）|
| `dangerText` | 12 `Index.ets:3618`、14 `Index.ets:3753` | **4.5** | ✅（`theme_contrast` 由 3.0 **收紧**）|
| `successText` | 10 `ToolPopover.ets:460`、12 `Index.ets:6803` | **4.5** | ✅（同上；与 §J 的 porcelain ≥4.5 断言同口径）|
| `warn` | 11 `MessageRow.ets:563`、12 `QueueSheet.ets:111` | **4.5** | ✅（`theme_contrast`/`role_surface_matrix` 由 3.0 **收紧**）|
| `dangerOnFill` / `warnOnFill` | 实心底上的**文字** | **4.5**（原误用 3.0） | ✅（与 `role_surface_matrix` 原有 4.5 对齐）|
| `accent` | **图形**（弧/环/点/图标） | 3.0 | ⚠️ **跨类**（见 §15.3）|
| `statusError` / `statusRunning` | **图形**（弧/环） | 3.0 | ⚠️ **跨类**（见 §15.3）|
| `iconMuted` | **非文本**（图标） | 3.0 | ✅ |
| `textMuted` | 元信息 | 2.0 | ✅ |

### 15.3 跨类 role：`accent` / `statusError` / `statusRunning`（**已裁决为"显式例外"**，见 §15.4）

三者在本表里建模的是**图形**落点，但它们**另有 normal 字号（10–14）的**文字**落点**（跨类把图形 role 当文字用）：

| role | 文字落点（**现状**） | 字号 | 实算（不达标面）|
|---|---|---|---|
| `accent` | **仅** ANSI 终端文本 `SyntheticCard.ets:248/260`、`ToolVisual.ets:115`（原 `MessageNav.ets:129` 序号等 5 处 UI 铬文本**已于 `e1428a2` 改走文字 role**，见 §15.4） | 12/14 | dark 压 `surface` 4.43 / `surfaceAlt` 4.21 / `surfaceHi` 3.84；porcelain 压 `appBg` 4.39 / `surfaceAlt` 4.35 / `surfaceHi` 4.02 / `sunken` 4.20 |
| `statusError` | ANSI 终端（槽 1 红）`SyntheticCard.ets:248/260` | 12/14 | light 压 `surfaceHi` 4.25 |
| `statusRunning` | ANSI 终端（槽 6/14 青）`SyntheticCard.ets:248/260` | 12/14 | light 压 `appBg` 3.73 / `surface` 3.90 / `surfaceAlt` 3.56 / `surfaceHi` 3.17 / `sunken` 3.46 / `glassBg/appBg` 3.87 / `glassBg/surface` 3.90；porcelain 压 `appBg` 4.39 / `surfaceAlt` 4.35 / `surfaceHi` 4.02 / `sunken` 4.20；dark 压 `surfaceHi` 4.27 |

**为什么不把三者整体抬到 4.5**（主 agent 裁决 2，2026-10-11）：那会把「该 role × **无落点的面**」也判红
（≈22 格虚构台账 = **造账**，不是修缺陷），并迫使**只作图形**的落点（青/紫弧、进度环）满足**正文**阈值；
且这三个 role 的**文字**落点全在 **ANSI 终端输出**，其色相是 **xterm 语义色**、与 **web 权威
（`noties_prism4j` / 标准 xterm 色板）一致** ⇒ 为凑 AA 压深 = **偏离 web 权威基准**
（**parity 优先于局部 AA**）。

### 15.4 「ANSI 终端语义色」**显式例外**（明账；⛔ 不放宽 `AA_TEXT` 本身）

> ⛔ **本例外只覆盖"终端/代码块输出里的文字色"**，**不覆盖任何 UI 铬文本**。
> 机器实现 = `core/design.ets: ansiTerminalExceptions()`（登记）+ `ansiRoleTextLeaks()`（越界台账）；
> 判据 = `tools/tests/porcelain_surfacehi_contrast.test.ts §6`（**只许缩短** + 边界扫描 + mutation）。

| role | ANSI 槽 | 文字落点（`file:line`） | 字号 | 实算（低于 4.5 的格）|
|---|---|---|---|---|
| `accent` | 4 蓝 / 12 bright 蓝 | `SyntheticCard.ets:248/260`、`ToolVisual.ets:115` | 12 / 14 | dark 压 `surface` 4.43 / `surfaceAlt` 4.21 / `surfaceHi` 3.84；porcelain 压 `appBg` 4.39 / `surfaceAlt` 4.35 / `surfaceHi` 4.02 / `sunken` 4.20 |
| `statusError` | 1 红 | `SyntheticCard.ets:248/260` | 12 / 14 | light 压 `surfaceHi` 4.25 |
| `statusRunning` | 6 / 14 青 | `SyntheticCard.ets:248/260` | 12 / 14 | light 压 `appBg` 3.73 / `surface` 3.90 / `surfaceAlt` 3.56 / `surfaceHi` 3.17 / `sunken` 3.46 / `glassBg/appBg` 3.87 / `glassBg/surface` 3.90；porcelain 压 `appBg` 4.39 / `surfaceAlt` 4.35 / `surfaceHi` 4.02 / `sunken` 4.20；dark 压 `surfaceHi` 4.27 |

**边界（机器钉死，防"以后随便用"）**：
1. `ansiTerminalExceptions()` 的 role 集合**冻结** = `{accent, statusError, statusRunning}`（改 ⇒ 红）；
2. 这三个 role **不得**在 `contrastReqs()` 里以 `AA_TEXT` 出现（⛔ 不许接成"文字类"，断言直钉）；
3. `core/ansi.ets: ANSI_COLOR_ROLES` 必须含这三者（"终端是**受认可**的文字通道"，无则例外无据）；
4. **边界扫描**：`components/**`+`pages/**` 里这三个 role 的**非终端直接文字用法**（`.fontColor` 且最近
   前导 widget 是 `Text`/`Span`）必须 ⊆ `ansiRoleTextLeaks()`（**只许缩短**）。

**⚠️ 越界台账 —— ✅ 已清空（`accent-chrome` 线，commit `e1428a2`）**：先前列出的 **5 处** `accent` 直接当
**文字**用的 UI 铬文本（10–12 的 normal 字号、**非**终端）：`GoalBanner.ets:132`（'保存'）· `GoalBanner.ets:180`（状态徽标）·
`MessageNav.ets:129`（序号）· `SettingsAbout.ets:358`（'发布说明'）· `TodoPanel.ets:190`（'goal' 徽标）
⇒ **全部改走文字 role**（`accentText` 等 4.5 档）。`ansiRoleTextLeaks()` 现返回 **`[]`**
（⛔ 函数**保留**：它是 §6 边界扫描的白名单，将来任何"图形 role 当文字用"会被立刻抓住；mutation 已自证）。

---

### 15.5 面名别名 = **同一 rung**（结构性教训，2026-10-11）

> 教训来源：`contrast-landing` 复核 `porcelain_surfacehi_contrast` 的落点排查时发现 ——
> 它**只搜了字面量 `'surfaceHi'`**，因此**漏掉**坐在**别名底**上的同类文字落点。

**规则**：`surfaceRoles()` 里 **rung 相同 ⇒ 面填充色相同**（`surfaceFillOf` 只按 rung 取色，见 `core/design.ets`）。
`RUNG_ACTIVE` 一族的名字有 **3 个**：`surface.active` / `surface.overlayRowHover` / `surface.pillSelected`
（它们的填充都 = `Palette.surfaceHi`）；`RUNG_RAISED` 有 `surface.raised` / `surface.overlayRow` / `surface.pill`
（= `surfaceAlt`）；`RUNG_CARD` 有 `surface.card` / `surface.overlay` / `surface.input`（= `surface`）。

⇒ **凡"按面名搜落点"的排查/判据，必须展开别名家族**，否则**永远漏**。
**实测**：**曾漏** 3 处 `textSecondary` **文字**落点 —— 坐在 `surface.overlayRowHover`(= `RUNG_ACTIVE`) 底上 ——
`pages/Index.ets:6626`（'取消'）· `pages/Index.ets:6687`（'⋯'）· `components/AskUserSheet.ets:202`
（`type.callout`）；**已修**（`surface-alias`，commit **`3f3e7d1`**）：A/B **只换"当前会话"支的 fg** → `textPrimary`
（⛔ 不换底：换底会削掉"当前会话"的强调），C **整条梯子下移一档**（选中 `surface.overlayRow` / 未选中 `surface.overlay`）。

**机器防线（三处，互补）**：
1. `core/design.ets: surfaceAliasesOf(name)` —— **从 `surfaceRoles()` 派生**同 rung 家族，⛔ 不硬编面名；
2. `tools/tests/porcelain_surfacehi_contrast.test.ts §7` —— 家族冻结 + 每成员逐主题 ≡ `p.surfaceHi`
   + 反面"异 rung 不入家族" + 「未回落」反向锚；
3. `tools/tests/surface_alias.test.ts` —— 落点检查清单**由别名表派生**（⛔ 不硬编）+ 三处落点的**修法形态**
   + mutation 锚（回退 ⇒ 必红）。

**⚠️ `surface.active` 的去留（裁决：保留，登记为「预留 / 暂无消费」）**——其**唯一**消费者
（`SettingsLlm.ets` 就地编辑框底）在 `8fbe8d2` 换底为 `surface.raised` ⇒ 现 **0 个 `.ets` 消费者**。三条依据：
1. **语义不重复**：`surface.active` = `RUNG_ACTIVE`（`surfaceHi`）；`surface.raised` = `RUNG_RAISED`（`surfaceAlt`）
   —— **不同层级**（`surface_active.test.ts ★③` 已钉二者不等）；
2. **它是 `RUNG_ACTIVE` 的"中性恒等入口"**：同层另两名（`pillSelected` / `overlayRowHover`）语义狭窄
   ⇒ 未来"激活/选中"面直取 `pal().surfaceHi` 的调用点，收散到它才不丢语义 ⇒ **有意预留**；
3. **删除跨域**：删它会让**他域**判据红 —— `tools/tests/design.test.ts:145`（面表计数 12）+
   `tools/tests/surface_active.test.ts`（专属判据）⇒ 非本线可单方面决定。
⛔ 与 `Palette.foreground3`（`PORCELAIN-AUDIT ⚠️-5`）同类：**预留角色，已登记，不静默删**。
⛔ 若将来真要收敛：须**同批**改 `design.test.ts` 计数 + 退役 `surface_active.test.ts`，并论证
「`RUNG_ACTIVE` 不需要中性入口」（现有两个名字覆盖不了）。留痕处：`core/design.ets` 的
`surfaceRoles()` 注释（`new SurfaceRole('surface.active', …)` 上方）。

### 15.6 ⭐ 星标图标地面：`iconMuted` 压 `RUNG_ACTIVE` 面（**已登记，走落点侧**）

**发现**（`surface-alias` 复核别名底时钓出）：会话行**星标** = `SymbolGlyph` + `colorOf(p,'iconMuted')`
（未收藏支），坐在**当前会话**那一行的底 `surface.overlayRowHover`（= `RUNG_ACTIVE` = `surfaceHi`）上
⇒ 触到 WCAG §1.4.11 的**图标 3:1 地板**。

| 落点 | 前景 role | 底 | 字号 | 逐主题实算（地板 3.0）|
|---|---|---|---|---|
| `pages/Index.ets:6692`（唯一，**仅"当前会话"那行**） | `iconMuted` | `surface.overlayRowHover`(= `surfaceHi`) | `type.headline` | dark **2.816 ✗** · light 6.147 ✓ · aurora 3.902 ✓ · nebula 4.154 ✓ · porcelain 4.337 ✓ |

**⚠️ 订正（重要）**：常被误记为"**深色三主题都不足 3.0**（dark 2.816 / aurora 2.594 / nebula 2.810）"——
后两个是把 **`dark` 的 `textMuted`（`#63636F`）** 拿去压 aurora/nebula 的 `surfaceHi`（**跨主题错配**）算出的。
按 `iconMutedOf` 的**正确**取值（各主题用自己的 `textMuted`：aurora `#6b8399` / nebula `#8577ad`），
**只有 dark 一主题缺 0.184**。

**裁决：走落点侧（(b)），⛔ 不改 role（(a) 已被算掉）**——
- (a) 改 `iconMutedOf` 的深色臂 ⇒ ① **过改**：aurora/nebula **本已达标**（3.902 / 4.154）也会被抬高；
  ② **爆炸半径 ≈25 个 `iconMuted` 落点 × 3 个深色主题（≈75 处渲染）** 全部变亮（dark `#63636F→#9A9AAB` 等）；
  ③ 该函数的分支判据是 `isLightPalette(p)`（**色板亮度**，仓规⛔不许按主题名硬判）⇒ **无法只修 dark**。
- (b) 落点侧：`Index.ets:6692` 未收藏支改用 `textSecondary`（各主题 ≥4.33 ⇒ 达标；浅色族 `iconMuted`
  本就 = `textSecondary` ⇒ **浅色零变化**）⇒ **爆炸半径 = 1 处 × 1 状态**。
- ⚠️ 该落点在 `pages/Index.ets`（**非本线域**）⇒ **由主 agent 另派线落地；落地后收缩台账**。

**机器登记（本线已落）**：`core/design.ets: contrastReqs()` 新增 `iconMuted|surfaceHi`（`AA_NON_TEXT`）
+ `knownContrastLedger()` 新增 `dark|iconMuted|surfaceHi`；判据
`tools/tests/porcelain_surfacehi_contrast.test.ts §8`（矩阵形态 + 门槛 3.0 + **逐主题实算**
+ **只 dark 缺** + 缺口数值**钉死 2.8164**（只许变好）+ 落点存活锚）。

---

## 16. 「加载中…」的层级 = `textMuted`（web 权威口径，2026-10-11 · 任务 A2）

**取证（只读 `/Users/bobli/src/xbot/web`）**：web 侧同句**一律** `text-text-muted` ——

| web 落点 | class |
|---|---|
| `src/pages/SharePage.tsx:111` | `p-8 text-center text-sm **text-text-muted**` |
| `src/plugins/ssh-runner/index.tsx:1565` | `px-2 py-3 text-[10px] **text-text-muted**` |
| `src/plugins/ssh-runner/index.tsx:1759` | `text-[10px] **text-text-muted**` |
| `src/plugins/git-fancy/index.tsx:248` / `:415` | `text-xs / text-[10px] **text-text-muted**` |
| `src/plugins/git-fancy/commit.tsx:60` | `flex h-full … text-xs **text-text-muted**` |

token：`src/index.css:163`（浅 `--text-muted:#999999`）/ `:269`（深 `#6b6b6b`）+ `:397`
`--color-text-muted: var(--text-muted)` ⇒ 原生对应 role = **`textMuted`**。

**⚠️ 与 web 不符的一处**：`components/SettingsAbout.ets:283` 用 `this.secondaryText()`
（= `isLightPalette ? textSecondary : textMuted`）⇒ **浅色族（light/porcelain）变 `textSecondary`**，
与其余 **7 处**（`SettingsAgent:?` / `SettingsChannels:1006` / `SettingsLlm:1050` / `SettingsPlugins:757` /
`SettingsStorage:285` / `SettingsTools:146` / `SettingsWebUsers:186`，均 `pal().textMuted`）**层级不一致**，
且**偏离 web 权威**。

**裁决：收敛到 `textMuted`**（web 口径；⛔ 不是"哪个顺眼"）。⚠️ 落在 `components/SettingsAbout.ets`
（**非本线域**）⇒ **由主 agent 另派线落地**。
**机器登记（本线已落）**：`core/design.ets` 的 `AA_MUTED` 注释写明该约定；
判据 `tools/tests/porcelain_surfacehi_contrast.test.ts §9`（源码扫 `Settings*.ets` 的「加载中…」⇒
必须 `this.pal().textMuted`；`SettingsAbout.ets` 登记为**唯一已知偏离**，**修好 ⇒ 断言红 ⇒ 逼删白名单**）。

---

## 17. 弹层高度：**无档，不新造 token**（2026-10-11 · 任务 C3）

**取证（只读 `/Users/bobli/src/xbot/web`）**：web **没有**"弹层高度阶梯"这一语义 ——
- `src/components/ui/sheet.tsx` 是 Radix `Sheet` 原语（`data-slot="sheet-*"`），**不含高度 token**；
- `src/components/settings/SettingsDialog.tsx:142` = `h-[70vh] max-h-[80vh]`（**视口相对**，非固定档）；
- 其余全是**内容区上限**：`max-h-[240px]`（`panel/rails.tsx:361`、`agent/TodoPullOut.tsx:126`）、
  `max-h-[40dvh]`（`TodoPullOut.tsx:158`）、`max-h-[70vh]`（`agent/GenUIPanel.tsx:96`）、
  `max-h-[85vh]`（`file/ImagePreview.tsx:68`）⇒ 各按内容/场景取，**不是一套档位**。

**裁决：⛔ 不新增 `SHEET_H_*` token**（web 无对应语义；原生弹层按**内容自适应**更合理）。
**⚠️ 但复核出一个更真的问题（交主 agent 派线）**：仓内这 5 个高度**不是同一种东西** ——
| 落点 | 形态 | 值 |
|---|---|---|
| `QueueSheet.ets:147` | **固定高** `.height(300)` | 300 |
| `PluginsSheet.ets:214` | **固定高** `.height(320)` | 320 |
| `MenuSheets.ets:64→262` | **上限** `.constraintSize({maxHeight})` | 420 |
| `AskUserSheet.ets:63→256` | **上限** `maxHeight` | 420 |
| `MessageNav.ets:51→393` | **上限** `maxHeight`（web `max-h-[60vh]`） | 420 |

⇒ 真正的"不一致"是 **固定高 vs 上限**（不是缺档位）：固定高的两个面板**在内容为空时仍占满 300/320**。
**本线不改组件**；**留痕处 = 本节**（`MenuSheets`/`AskUserSheet` 的头注已有"无 `list.maxHeight` token（报备）"）。


