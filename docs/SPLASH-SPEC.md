# SPLASH-SPEC.md —— 开屏（splash）阶段模型与判据（唯一真源规格）

> **范围**：本文件只定义**开屏的动效/阶段/判据**；资源与降级链见 `docs/BRAND.md`。
> **状态**：这是**规格**（可实现），不是实现。⛔ 本波**未改任何 `.ets`/`.ts`/`.json5`/`resources/**`**；
> 需要落码处只给**精确 diff 建议**（§10）。⛔ 本文件不 commit（由调度者统一提交）。
> **纪律**：所有时长/easing 一律从底板**实调**并标 `file:line`；**不得自造**。缺档见 §11。

---

## 0. 一句话

冷启动的**经历时间线**有四段：**T0 系统开屏（静态，系统画）→ T1 应用内开屏（品牌底 + 标记）→ T2 标记让位 / 首页内容淡入 → T3 光球接管（仅当首个会话在流式）**。
本仓现状：**T0 有、T1/T2/T3 全无** ⇒ 用户从"系统开屏"直接跳到"首页首帧"，中间没有任何品牌过渡。

---

## 1. 现状（逐条 file:line，作为 T0 的输入）

| 事实 | 证据 | 结论 |
|---|---|---|
| 系统开屏由 `module.json5` 的 `startWindowIcon/startWindowBackground` **静态**给出 | `entry/src/main/module.json5:18-19` | T0 **不可动画**（系统画，亚秒级） |
| 底色**跟随系统深浅**（非应用主题） | `docs/BRAND.md §4.2`（SDK `startWindow.json` schema：`startWindowColorModeType` default = `FOLLOW_SYSTEM`） | 冷启动**跳色**根因（§6） |
| `EntryAbility` 只 `loadContent('pages/Index')` + 设系统栏 | `entry/src/main/ets/entryability/EntryAbility.ets:53`、`:70`、`:80` | **无任何应用内开屏实现** |
| 应用主题在 `onCreate` 由 `setColorMode` 决定（读本地缓存） | `EntryAbility.ets:37`（`readCachedTheme` @`:35`） | T1 底色可**取应用主题**（§6） |
| 页面首帧是 `LoadingView`（`LoadingProgress` + `Text('xbot')`），**与品牌无关** | `pages/Index.ets`（`LoadingView`） | 它就是 T1/T2 要**取代**的那个"无关首帧" |

---

## 2. 阶段模型（T0–T3）

**时钟定义**：`elapsedMs` = 自**应用内开屏挂载**（页面 `aboutToAppear`/首帧）起算的毫秒数，`elapsedMs = 0` 即 T1 起点。
T0 发生在此之前（系统画），**不在**本时间线内 ⇒ `splashPhaseAt()` 的取值域是 `{T1, T2, T3}`（T0 由 `shouldShowSplash`/系统决定，见 §4）。

| 阶段 | 语义 | 进入条件 | 退出条件 | 时长（file:line） | easing（file:line） | 失败/超时兜底 |
|---|---|---|---|---|---|---|
| **T0** | 系统开屏：`startWindowIcon` 居中压在 `startWindowBackground` 上（静态） | 进程冷启动 | 应用首帧就绪（`loadContent` 回调成功 `EntryAbility.ets:53-58`） | 系统决定（亚秒级，不可控） | 无（静态） | `loadContent` 失败 ⇒ 只有日志 `EntryAbility.ets:54-57`；**建议补 error 分支**（§10 diff ②） |
| **T1** | 应用内开屏：**品牌底 + 标记入场**（`opacity 0→1` + `scale→1`），**一次** | `elapsedMs == 0` 且 `shouldShowSplash()==true` | `elapsedMs ≥ T1 时长` 或**用户交互**（点/滑）或 `elapsedMs ≥ SPLASH_TIMEOUT_MS` | `MOTION_BASE_MS = 220`（`core/motion.ets:36`）⇒ `animBase()`（`components/anim.ets:53-55`） | spring `cubic-bezier(0.34,1.56,0.64,1)`（`core/tokens.ets:54`；`anim.ets:39-45` 的 `springCurve()`） | `reduceMotion` ⇒ 静态呈现（§5）；超时 ⇒ 直接进 T3 |
| **T2** | **整层**让位（`opacity 1→0`，标记再乘自身 `markOpacity→0` + 轻微上移）+ 首页内容淡入 | `elapsedMs ≥ T1 时长` | `elapsedMs ≥ T1+T2 时长` 或用户交互 | `MOTION_SLOW_MS = 320`（`core/motion.ets:43`）⇒ `animEaseOut()`（`components/anim.ets:103`，**滑入位移见 `MOTION_SHEET_SLIDE_VP`**） | **`easeOut`（零超调）** —— ⛔ 不是 spring（`anim.ets:103`；判据 `splashPhaseCurve(T2)===easeOut`） | 同 T1（可整体跳过 ⇒ 立即 T3） |
| **T3** | 交棒首页；**光球接管**（仅当首个会话在流式） | `elapsedMs ≥ T1+T2` 且 `shouldShowSplash()==false` 且首个会话 `running/isLive` | 回合结束（光球按自身状态机降为 `idle`，`components/AssistantOrb.ets` 头注的三态表） | 呼吸 `MOTION_BREATH_MS = 2560`（`components/anim.ets:96` ← `core/orb.ets:26`） | 光球自持节拍（`core/orb.ets`）；**入场**用 `animBase()`（`anim.ets:53`） | 无在飞会话 ⇒ T3 只是"首页静态"（**不启动光球**，见 §9） |

**总时长（默认档）**：`T1 + T2 = 220 + 320 = 540ms`。
**最短停留（minDwell）**：见 §11 缺档 ①——**底座没有该常量**，建议取 `MOTION_BASE_MS + MOTION_FAST_MS = 400ms`（由两个底板常量**相加**得出，非自造）。

---

## 3. 时长 / easing 台账（全部**实调**自底板，`file:line`）

| 常量 / 工厂 | 值 | 定义处 `file:line` | 本规格用途 |
|---|---|---|---|
| `MOTION_FAST_MS` | `180` | `core/motion.ets:31`（← `core/tokens.ets:46` `D_FAST`） | minDwell 组成项 |
| `MOTION_MSG_IN_MS` | `200` | `core/motion.ets:38` | （备用：单行入场） |
| `MOTION_BASE_MS` | `220` | `core/motion.ets:36` | **T1 时长** |
| `MOTION_SLOW_MS` | `320` | `core/motion.ets:43`（← `tokens.ets:48` `D_SLOW`） | **T2 时长** |
| `MOTION_BREATH_MS` | `2560` | `components/anim.ets:96` ← `core/orb.ets:26`（`D_SLOW*8`） | **T3 光球呼吸** / 建议超时档 |
| `MOTION_BEAT_MS` | `640` | `components/anim.ets:98`（`D_SLOW*2`） | （在飞细节拍，T3 才用） |
| `MOTION_QUIET_MS` | `640` | `components/anim.ets:104`（`MOTION_BREATH_MS/4`） | （静默判定，T3 才用） |
| `animFast()` | 180ms + spring | `components/anim.ets:48-50` | 备用 |
| `animBase()` | 220ms + spring | `components/anim.ets:53-55` | **T1 入场** |
| `animMsgIn()` | 200ms + spring | `components/anim.ets:58-60` | 备用 |
| `animSlow()` | 320ms + spring | `components/anim.ets:63-65` | **T2 让位** |
| `animSpring()` | 物理弹簧（duration 无意义） | `components/anim.ets:72-74`（← `tokens.ets:76-78`） | T1 的另一可选档 |
| spring 曲线 | `cubic-bezier(0.34,1.56,0.64,1)` | `core/tokens.ets:54`（`EASE_SPRING_CSS`） | **T1/T2 唯一曲线** |
| spring 三参 | `response 0.30s / damping 0.65 / overlap 0` | `core/tokens.ets:76-78` | `animSpring()` 用 |
| `sheetTransition()` 曲线 | `Curve.Friction` + 220/180 | `components/anim.ets:114-117` | ⚠️ **不用**（它是面板出入场，且用了底座外的 `Curve.Friction`） |

> ⛔ **T1/T2 只允许用上表里的 `animBase()` / `animSlow()`**（或 `animSpring()`）；⛔ 不得新造时长。
> ⛔ **开屏是"一次性过渡"，不是"在飞"**（`docs/REDESIGN-INPUT-BRAND.md:136`）⇒ 不得循环/常驻呼吸。

---

## 4. 判据（纯函数：签名 + 真值表；**不写实现**）

四种类型（全部可脱机单测，放 `core/splash.ets` 之类；⛔ 本波不落码）：

**已落地**（本波）：`entry/src/main/ets/core/splash.ets`（纯逻辑）+ `tools/tests/splash.test.ts`（89 断言）+
`entry/src/main/ets/components/SplashOverlay.ets`（真 `@Component`）。下面是**实现即契约**的签名。

```
// 标识（字符串常量，沿用本仓惯例；不用 union 字面量类型）
SPLASH_T0 | SPLASH_T1 | SPLASH_T2 | SPLASH_T3          // 阶段
LAUNCH_COLD | LAUNCH_WARM                              // 启动类型

// 时长（**全部由底座派生，零裸数字**；见 §3 台账与 §11 缺档）
SPLASH_ENTER_MS   = MOTION_BASE_MS                 // 220
SPLASH_EXIT_MS    = MOTION_SLOW_MS                 // 320
SPLASH_TOTAL_MS   = ENTER + EXIT                   // 540
SPLASH_MIN_DWELL_MS = MOTION_BASE_MS + MOTION_FAST_MS   // 400
SPLASH_TIMEOUT_MS = ORB_BREATH_MS                  // 2560
SPLASH_MARK_ENTER_SCALE = 0.92                     // 标记专属（缺档③ 裁决：不强行统一）
SPLASH_MARK_BOX_VP = SPACE_XXL * 5                 // 160

// ① 阶段推进（elapsedMs 自 T1 挂载起算；T0 不在取值域）
function splashPhaseAt(elapsedMs: number, reduceMotion: boolean, userDismissed: boolean = false): string;
function splashPhaseStartMs(phase: string, reduceMotion: boolean): number;
function splashPhaseDurationMs(phase: string, reduceMotion: boolean): number;

// ② 开屏是否仍应可见（overlay 的显隐判据）
function shouldShowSplash(launchKind: string, elapsedMs: number, contentReady: boolean,
                          userDismissed: boolean = false): boolean;

// ③ T1 底色（**恒定**，方案 (a)「品牌开屏恒深」；纯函数，**无 theme 入参**）
function splashBrandCanvas(): string;                          // = darkPalette().appBg（= T0 色）

// ④ T1 标记档位（**恒定深色面**；**委托** `core/brand.ets:markLevelFor`，不另立判据）
function splashBrandMarkLevel(sizeVp: number, monochrome: boolean): string;  // 深色面 ⇒ FULL

// ⑤ 在飞唯一性（铁律的机器判据，见 §9）
function splashOrbAllowed(phase: string, streaming: boolean): boolean;
function splashPhaseIsInFlight(phase: string): boolean;      // 恒 false

// ⑥ 曲线（§4.5 —— 入场可超调；让位/退出**不许**超调）
function splashPhaseCurve(phase: string): string;            // 'spring' | 'easeOut' | ''
function curveCssOf(curve: string): string;                  // → EASE_SPRING_CSS / EASE_OUT_CSS
function curveHasOvershoot(css: string): boolean;            // 解析 cubic-bezier 的两个 y
```

### 4.1 `splashPhaseAt(elapsedMs, cfg)` 真值表

`reduceMotion = false`（默认档；`enterMs=220`，`exitMs=320`）：

| `elapsedMs` | 结果 | 边界语义 |
|---|---|---|
| `< 0` / `NaN` | `T1` | 视为 0（防御，不抛） |
| `[0, 220)` | `T1` | `0` ⇒ T1（**不是** T0） |
| `[220, 540)` | `T2` | `220` 恰好 ⇒ T2（**左闭右开**） |
| `[540, ∞)` | `T3` | `540` 恰好 ⇒ T3 |

`reduceMotion = true`（**只降动效、不降可达性**）：T2 **收起为 0**，T1 静态保留到 minDwell（§5）。

| `elapsedMs` | 结果 |
|---|---|
| `< minDwellMs`（建议 400） | `T1`（**静态**，无 transform/opacity 动效） |
| `≥ minDwellMs` | `T3`（**跳切**，无淡出） |

### 4.2 `shouldShowSplash(launchKind, elapsedMs, contentReady, cfg)` 真值表

判据：`launchKind == 'cold'` **且**（`elapsedMs < minDwellMs` **或** `!contentReady`）**且** `elapsedMs < timeoutMs` ⇒ `true`。

| `launchKind` | `elapsedMs` | `contentReady` | 结果 | 场景 |
|---|---|---|---|---|
| `warm` | 任意 | 任意 | **`false`** | 热启动（进程活着、ability 再拉起）⇒ **不进 T1**（无系统开屏，也不该假装有） |
| `cold` | `< minDwell` | `false`/`true` | `true` | 保证品牌**至少停留** minDwell（避免"一闪而过"） |
| `cold` | `[minDwell, timeout)` | `false` | `true` | 内容未就绪 ⇒ 继续显示（**不闪白**） |
| `cold` | `[minDwell, timeout)` | `true` | **`false`** | 内容已就绪且过了最短停留 ⇒ 撤下 |
| `cold` | `≥ timeoutMs` | 任意 | **`false`** | **超时兜底**：宁可显示首帧，也不无限停在开屏 |

**用户中途交互**：T1/T2 期间发生点/滑 ⇒ 上层立即置 `contentReady = true` 并**跳表**到 `T3`（`elapsedMs` 不再影响结果）——即"用户不想等"。该跳变**只允许一次**（不允许回退到 T1/T2）。

#### 4.2b `shouldStartSplash(launchKind, elapsedMs, contentReady)` —— **迟滞闸门**（"要不要展示"）

`elapsedMs` 自**应用启动**起算；**只在迟滞到点评估一次**。用户口径「尽可能快；加载慢才播动画」：

| `launchKind` | `elapsedMs` | `contentReady` | 结果 | 场景 |
|---|---|---|---|---|
| `warm` | 任意 | 任意 | **`false`** | 热启动 ⇒ 不开屏 |
| `cold` | `< 迟滞(150)` | 任意 | **`false`** | 观察窗内（**快启动若在此就绪 ⇒ 永远不展示**） |
| `cold` | `≥ 迟滞(150)` | `true` | **`false`** | 迟滞内已就绪 ⇒ **从 T0 直接过渡到主界面，开屏不出现** |
| `cold` | `≥ 迟滞(150)` | `false` | **`true`** | 加载慢 ⇒ 展示，并**完整播完**（入场 → T2） |

> ⚠️ **两个闸门语义不同、不可互换**：`shouldStartSplash` 答"**要不要展示**"（迟滞闸门）；
> `shouldShowSplash` 答"**一旦展示了，这一帧还在不在**"（`minDwell` 下限 + 内容就绪 + 超时兜底）。
> 机器判据 = `tools/tests/splash.test.ts ★Db`（mutation：把 `shouldStartSplash` 改成恒 `true` ⇒ 必红）。

### 4.3 `splashBrandCanvas()` 真值表 —— **恒定**（方案 (a)，2026-10-11 真机缺陷修复）

| 入参 | 结果 | 说明 |
|---|---|---|
| （无） | `darkPalette().appBg` = `#0B0B0E` | = T0 系统开屏色（base/dark 两处 `start_window_background`）⇒ **T0→T1 零跳色** |

> **为什么不再按主题取画布**：旧 `splashCanvasOf(theme, followApplication=true, systemDark)`
> = `paletteOf(theme).appBg`，画布绑在可变 `@Prop theme`（← `Index.themeName`，**初值字面量 `'dark'`**，
> 服务端 settings 到达后才覆盖）上 ⇒ 浅色主题用户在同一段展示期间看到画布由深翻白。
> 而 T0 系统开屏**恒** `#0B0B0E`（`FOLLOW_APPLICATION` 真机不生效，见 §6 / `BRAND.md §12.1`）
> ⇒ 取主题色**必然**跳变。⇒ 判据 = **品牌开屏恒深**；T1→T3 由 T2 淡出（`animEaseOut()`，零超调）
> 过渡到应用主题（渐隐，非硬切）。机器判据 = `tools/tests/splash.test.ts §①`（值恒定 + 无 theme 入参）。

### 4.4 `splashBrandMarkLevel(sizeVp, monochrome)` 真值表 —— 承载面**恒定深色**

**委托** `core/brand.ets markLevelFor(BrandSurface)`（不另立判据）；承载面 = `splashBrandCanvas()`（深色）：

| `sizeVp` | `monochrome` | 结果 | 含义 |
|---|---|---|---|
| ≥ 24 | `false` | `FULL` | 满幅品牌色 + 反色 glyph（= 预生成的品牌紫 PNG `$r('app.media.start_icon')`） |
| 任意 | `true` | `OUTLINE` | 单色轮廓（零填充零发光） |
| `< 24` | 任意 | `WORDMARK` | 几何标记太小 ⇒ 纯文字 |

> ⛔ **品牌标记不随主题**（`docs/DESIGN-SYSTEM.md §13.6`）：恒用品牌色、**不做浅色变体**。
> 此前 porcelain 走 `solid` 档，但 `SplashOverlay` 对 `full`/`solid` 渲染的是**同一张**品牌紫 PNG
> （`tools/brand/emit.js` 用 `brandAccent()` 生成）⇒ 真机标记**永远紫**（与"走 `brandAccentFor`"的声称不符）。

### 4.5 曲线语义（**设计系统级约定**）：入场可超调；让位/退出 **不许**超调

底座唯一的曲线是 **spring**（`cubic-bezier(0.34,1.56,0.64,1)`，`core/tokens.ets:66`，**带超调**）。
**超调用在"入场"是对的**（有生气）；用在**"让位/移交"（退出）上是观感错误** —— 元素冲过头再退回来，看着像抖了一下。

⇒ **约定**：`enter`（进入视野）**允许**超调；`exit`（离开/移交）**一律无超调缓出**。
这条已写成**可测数据**（`core/splash.ets: splashPhaseCurve / curveCssOf / curveHasOvershoot`）：

| 阶段 | 曲线 | 底座来源 | 超调 |
|---|---|---|---|
| T1（入场） | `spring` | `core/tokens.ets:66`（`EASE_SPRING_CSS`）→ `animBase()`（`components/anim.ets:54-56`） | **允许**（y1 = 1.56 > 1） |
| T2（让位） | `easeOut` | `core/tokens.ets:68`（`EASE_OUT_CSS` = `cubic-bezier(0,0,0.2,1)`） | **禁止**（y 全 ≤ 1） |
| T0 / T3 | 无（不由本组件驱动） | — | — |

`curveHasOvershoot(css)` 由 CSS 的**两个 y 控制点**实解析（任一 `y > 1` ⇒ 有超调），不是硬编码布尔
⇒ 把 T2 改回 spring，`tools/tests/splash.test.ts` ★E **必红**（mutation 已自证）。

> ✅ **T2 曲线已就绪**（`animEaseOut()` 工厂，`components/anim.ets:104` =
> `{ duration: MOTION_SLOW_MS, curve: EASE_OUT_CSS }`）。`SplashOverlay.onPhaseChange` 的
> `animateTo` 已改用 `animEaseOut()`（不再是 `animSlow()`），T2 **零超调**。
> ⛔ 组件侧**不得**自造曲线、**不得** import `@ohos.curves`（唯一出口 = `components/anim.ets`）。

---

### 4.6 观感细节（"能跑≠好看"）—— T2 上移 + 提示延迟淡入

补两处"看得出来的廉价感"（判据 = `tools/tests/splash.test.ts ★G`，含组件**源码形态**守卫）：

| 细节 | 改前（廉价） | 改后 | 纯数值（`core/splash.ets`） |
|---|---|---|---|
| **T2 让位** | 只把整层 `opacity` 淡到 0 ⇒ 读作"整层被抠掉"，没有方向 | 淡出 **+ 标记轻微上移**（`translate({y: -this.markLift})`）⇒ 有"向上交棒"的气息 | `SPLASH_MARK_EXIT_LIFT_VP = SPACE_SM` = **12vp**（= 标记盒 160vp 的 7.5% ⇒ 是"气息"不是位移表演） |
| **跳过提示** | 从**首帧**就满不透明度 ⇒ 第一眼是"轻点跳过"、**品牌反而后到**（顺序反 + 廉价） | 先给**纯品牌** `SPLASH_ENTER_MS`(220)，提示再**淡入**（`AnimateParam.delay` + `animEaseOut()`） | `SPLASH_HINT_DELAY_MS = MOTION_BASE_MS`, `SPLASH_HINT_ENTER_OPACITY = 0` |

- ⛔ **不许新增曲线/时长**：上移走 `animEaseOut()`（**无超调**，符合 `splashPhaseCurve(T2)===easeOut`）；
  提示淡入的**曲线**也来自底座工厂，只补了一个 `delay` 字段（`components/anim.ets` 不在本波文件边界，
  故不加"带 delay 的工厂变体"；组件内 `withDelay()` 只改 `delay`，**不构造 curve**）。
- ⛔ **不引入第二个"在飞"**：两者都是**一次性过渡**，`iterations=1`（`tools/lint/inflight-single-source.sh` 守护）；
  ⛔ **不给标记加发光**（全场唯一发光体 = 光球，`DESIGN-SYSTEM §8.3`）。
- 真机判据（连拍前 N 帧）：T1 帧与 T2 帧对比 ⇒ 标记应**更淡且更高约 12vp**；首 ~220ms 内**不应**看到"轻点跳过"。

### 4.7 T1→T3 过渡（T2 让位）的**透明度轨迹** —— "渐隐 / 无硬切 / 无白闪"的机器判据

**现状取证**（`file:line`，2026-10-11 复核订正行号）：T2 = `SplashOverlay.ets:141-145` 的 `animateTo(animEaseOut(), …)`，把**整层**
`Stack` 的 `.opacity(this.overlayOpacity)`（`:204`）由 `1 → 0`（标记**再乘**自身 `markOpacity→0`
⇒ 标记比底更快隐去 = "让位"的层次）。曲线 `animEaseOut()`（`components/anim.ets:104`）=
`MOTION_SLOW_MS`(**320ms**) + `EASE_OUT_CSS`(`cubic-bezier(0,0,0.2,1)`，**零超调**)。
**中间态 = 灰**（品牌底以**均匀 α** 叠在应用页面上：`α·品牌底 + (1-α)·应用底`）——
⛔ **不是"半透明白"**：整层是同一个 α，没有"白色蒙层"这一层。

**纯逻辑判据**：`core/splash.ets` 的 `splashExitOpacityAt(elapsedMs, reduceMotion)`（由
`SPLASH_EXIT_MS`(=motion) + `EASE_OUT_CSS`(=tokens) **派生**，曲线用 `curveProgressAt` 离线二分求值）：

| 性质 | 断言 | 为什么它等于"无硬切/无白闪" |
|---|---|---|
| 端点 | `t≤0 ⇒ 1`、`t≥EXIT ⇒ 0` | 满铺起步、让位收尾 |
| **值域 [0,1]** | 全程 `0 ≤ α ≤ 1` | 无超调 ⇒ α 不越界 ⇒ 合成色**永不亮于目的地** ⇒ **无"白闪一帧"** |
| **单调不增** | 采样 101 点非增 | 一致朝目的地走，不来回抖 |
| **存在中间态** | ∃ t: `α ∈ (0,1)` | 是**渐隐**，不是硬切 |
| `reduceMotion` | 即时 `0`（T2 收起） | 硬切 = "只降动效"的**既有裁决**（§5），⛔ 不属"渐隐"要求范围 |
| 深色主题 | `splashBrandCanvas() === paletteOf('dark').appBg` | 品牌底与应用页**同色** ⇒ 过渡无色差 ⇒ **不可见（无感）** |

判据 = `tools/tests/splash.test.ts ★I`；两条 mutation 已自证：曲线换 `EASE_SPRING_CSS`（超调）⇒
"值域[0,1]"+"单调不增"**必红**；把轨迹退化成阶跃（`t<EXIT?1:0`）⇒ "存在中间态"**必红**。

> 同源机制：判据与渲染**共用同一 token**（时长 `MOTION_SLOW_MS` + 曲线 `EASE_OUT_CSS`），
> 而非耦合调用（`animateTo` 的中间帧由 ArkUI 驱动，组件不能逐帧设值）。组件侧源码形态也在 ★I 里被钉住。

## 5. `reduceMotion` 阶段表（**只降动效、不降可达性**）

铁律：`reduceMotion=true` ⇒ **降级的是"动"，不是"反馈"**。⛔ 不许出现"空白屏 / 无任何指示"。

| 阶段 | 默认档 | `reduceMotion=true` | 可达性保证 |
|---|---|---|---|
| T0 | 系统静态开屏 | 同左 | 系统负责 |
| T1 | 标记 `opacity 0→1` + `scale→1`（220ms spring） | **静态**：标记**立即**全亮、**scale=1**，停留到 `minDwellMs` | 标记**可见**（有反馈，非空白） |
| T2 | **整层** `opacity 1→0`（320ms **ease-out**，零超调；标注记 `opacity 1→0`） | **收起为 0ms**（跳切到 T3） | 内容立即出现（不淡入≠不可达） |
| T3 | 光球呼吸（2560ms） | 光球**静态一帧**（`reduceMotion` 已是光球既有停表条件，见 `components/AssistantOrb.ets` 头注） | 仍有"在跑"的**静态**线索（状态点/文案） |
| 时长 | T1+T2=540ms | **总时长 = `minDwellMs`（建议 400ms）** | 品牌**至少**停留 minDwell |

> ⚠️ `reduceMotion` **不得**把 T1 变成"直接跳过"——跳过 = 品牌零曝光 + 首帧无过渡（白闪）。**必须**保留静态标记与最短停留。

---

## 6. 冷启动跳色（与 `docs/BRAND.md §12.1` 衔接）

**根因**：开屏底色**跟随系统**（§1），而应用色板由 `EntryAbility.onCreate` 的 `setColorMode` 决定（`EntryAbility.ets:37`）⇒「系统浅 + 应用选深」（或反之）时"开屏 → 首帧"**跳一帧色**。

**方案 A（`FOLLOW_APPLICATION`）—— ⚠️ 真机证实不生效（2026-10-11）**：`docs/BRAND.md §12.1` 的配置补丁
（`startWindow` profile + `startWindowColorModeType: FOLLOW_APPLICATION`）**已落地**，但真机实测：系统浅色 +
应用深色时 T0 **仍是** `#F8FAFC` ⇒ 没跟随应用主题。**根因**：T0 由系统在**应用代码之前**绘制，而应用色模式
只能由运行时 `setColorMode` 设定（SDK 还要求它在 loadContent **之后**调用）⇒ 生成 T0 时拿不到。
**已真机证实**：补一次"按文档时机"的 `setColorMode` 也**无效**；**只有改 base 资源取值才生效**。

**方案 B（实际采用的修法）**：让 **base** 的 `start_window_background` = 应用**默认主题**（dark）的画布色
`#0B0B0E`（`entry/src/main/resources/base/element/color.json`）。⇒ 系统浅色下 T0 也取 `#0B0B0E`
（不再白闪）。机器判据 = `tools/tests/splash.test.ts ★F`（base/dark 两值都必须 == `darkPalette().appBg`）。

**观感差异（真机实测后的真实矩阵）**：

| 场景 | 改前（base `#F8FAFC`） | 改后（base `#0B0B0E`） |
|---|---|---|
| 系统浅 + 应用 `dark`（默认） | 开屏 `#F8FAFC` → 首帧 `#0B0B0E`（**白闪 0.24–0.5s**）✗ | 开屏 `#0B0B0E` ⇒ **零跳色** ✓ |
| 系统深 + 应用 `dark` | `#0B0B0E` ⇒ 零 ✓ | `#0B0B0E` ⇒ 零 ✓ |
| 系统浅 + 应用 `light`/`porcelain` | `#F8FAFC` ⇒ 零/近零 ✓ | `#0B0B0E` → 首帧浅色（**黑闪 0.24–0.5s**）✗ ← **代价** |
| 系统深 + 应用 `light`/`porcelain` | `#0B0B0E` → 首帧浅色（黑闪）✗ | 同左 ✗ |

> **结论（如实）**：`FOLLOW_APPLICATION` 在真机上**做不到**"T0 精确跟随应用主题"。退而求其次，把 base 固定为
> **默认主题 dark** 的画布色 ⇒ **默认（深色）用户在任何系统深浅下零跳色**；**浅色主题用户会反方向黑闪一次**
> （≈0.24–0.5s，系统开屏停留时长）——**这是本次修复的代价**，取舍依据：本应用默认主题是 dark、设计系统以深色玻璃为主。

---

## 7. porcelain（白主题）在开屏下的表现（**实调**）

实调方式：把 `core/brand.ets` + `core/theme.ets` 当纯 TS 编译后 `node` **直调**（与门禁同源，非手抄）。

| 量 | 实调结果 | 出处 |
|---|---|---|
| `splashMarkLevelOf('porcelain', 512, false)` | **`SOLID`** | `brand.ets:348 markLevelFor` + `BrandSurface(浅色面)` |
| `splashMarkLevelOf('dark', 512, false)` | `FULL` | 同上 |
| `brandAccent()` | `#7C5CFF` | `brand.ets:43`（← `darkPalette().accent`） |
| `brandOnAccent()` | `#FFFFFF` | `brand.ets:48` |
| `contrastRatio(brandAccent, porcelain.appBg #FFFFFF)` | **`4.3461`** | `brand.ets:290 contrastRatio` |
| `contrastRatio(brandAccent, light.appBg #F8FAFC)` | `4.1539` | 同上 |
| `contrastRatio(brandAccent, dark.appBg #0B0B0E)` | `4.5224` | 同上 |
| `contrastRatio(brandOnAccent, brandAccent)` | `4.3461` | 同上 |
| `contrastRatio(porcelain.accent #0071E3, #FFFFFF)` | `4.6967` | 同上 |

**WCAG 判定（诚实版）**：
- 标记是**图形**（气泡 + 星芒），按 WCAG 2.1 §1.4.11 **非文本 3:1** ⇒ `4.3461 ≥ 3` **达标** ✅。
- 但 **4.3461 < 4.5**（AA 正文阈值）⇒ 若标记**含文字**（`WORDMARK` 档 / logo 文字版），**不达标** ✗。
- ⚠️ **白主题"标记用紫"是已知未决项**：porcelain 的界面强调色是 **Apple Blue `#0071E3`**（对白 `4.6967` ✅ 达标），
  而 `brandAccent()` 是**品牌紫 `#7C5CFF`**（对白 `4.3461`）——二者**不是同一个色**（`docs/BRAND.md §2.4` 断层④）。
  ⇒ **标记档位（SOLID）由 `markLadder()` 判出，但"用紫还是用蓝"必须用户拍板**（§12 待拍板 ①）。
  ⛔ 本规格**不改**品牌色值；两条路线的**实调对比度**都已给出（紫 `4.3461` / 蓝 `4.6967`）。
- `SOLID` 档**零发光**（`markLadder` 语义 + 宪法 §3.1：白主题禁彩色发光/渐变）。

---

## 8. 与"标记资源"的接口（不重复造）

| 档位 | 资源 / 渲染 | 出处 |
|---|---|---|
| `FULL` | `$media:app_icon`（满幅）/ `splashMarkSvg()` 生成的 `start_icon.png` | `brand.ets:147/163`、`docs/BRAND.md §5` |
| `SOLID` | 实心品牌色 glyph（**T1 用**；同 `splashMarkSvg()` 的透明底 PNG） | `brand.ets:163` |
| `OUTLINE` | `$media:brand_mark_outline`（`.svg`，零填充零发光） | `docs/BRAND.md §5` |
| `WORDMARK` | 纯文字（`Text('xbot')`），非图片资源 | `docs/BRAND.md §11` |

⛔ 开屏**不新增**资源，只用既有真源产物（避免第二份 logo）。

---

## 9. 动效唯一性约束（项目铁律）—— T1/T2 期间光球**未启动**

**铁律**：同一时刻**只允许一个"在飞动效" = 光球**（`docs/DESIGN-SYSTEM.md §8`；`core/design.ets:655-657`）。

- **T1/T2 期间：光球必须处于"未挂载 / 未启动"状态**（`active=false` 或不实例化）。T1 的入场是**一次性过渡**，**不是**在飞；
  开屏**不得**做成循环/常驻呼吸（`docs/REDESIGN-INPUT-BRAND.md:136`）。
- **T3 才允许光球启动**（且仅当首个会话在流式）。
- **若违反：门禁会这样红**
  1. `tools/lint/inflight-single-source.sh`（**gate ③b，A 类硬红**）：源码里出现循环/重复动效（`AnimateParam.iterations ≠ 1` 或 `playMode`，如给标记加"呼吸"）⇒ **A 类命中 ⇒ `tools/gate.sh` 判红**（脚本头 `:11-18` 定义 A 类）。
  2. `core/design.ets` 的 `motionRoles()`（`:701-710`）把在飞角色**限定**为 `motion.breath` / `motion.beat`，且 `owner` 必须 = `INFLIGHT_OWNER_ORB`（`:660`）；
     `designIssues()` 断言 owner **唯一**（`:655-657`）⇒ **新增第二个在飞角色** ⇒ `tools/tests/design.test.ts` 红。
  3. `tools/tests/one_inflight_motion.test.ts` / `in_flight_signal.test.ts` / `inflight_language.test.ts` 为同族守卫。
- ⇒ **T1/T2 的正确写法**：`animateTo(animBase())` / `.animation(animSlow())` **一次性**，且 `iterations=1`（默认）。

---

## 10. 落码（✅ 组件 + 页面接线**均已落地**；照 `docs/BRAND.md §12` 格式）

### ① 开屏组件（`components/SplashOverlay.ets`，已落地）

```
✅ entry/src/main/ets/components/SplashOverlay.ets   （真 @Component + @Prop；⛔ 未用带参 @Builder）
    · props: phase(@Prop @Watch) / reduceMotion / onDone / onSkip
      ⚠️ 2026-10-11 更新：`theme` / `canvasFollowApp` / `systemDark` **已删**（方案 (a)「品牌开屏恒深」
      ⇒ 画布/标记**不随主题变化**是**结构性保证**；见 §4.3/§4.4 与 `docs/BRAND.md §12.1`）
    · 画布 = `splashBrandCanvas()`（**恒定深色** = T0 色）；标记档位 = `splashBrandMarkLevel(...)`
      （恒定深色面 ⇒ `FULL` ⇒ `$media:start_icon`；`brand_mark_outline` 是降级链 OUTLINE 档，**待无障碍接线**）
    · 动效：T1 = animBase() 入场；T2 = animEaseOut() 让位（**无超调**；⛔ 不 import @ohos.curves）
    · 判据：splashPhaseAt / splashBrandMarkLevel / splashBrandCanvas / splashExitOpacityAt
      （纯函数在 core/splash.ets，可脱机单测）
```

### ② 页面接线（`pages/Index.ets`，已落地）

```
✅ pages/Index.ets
    · @State showSplash:boolean = false;  @State splashPhase:string = SPLASH_T1
    · booted 加 @Watch('onBootedChanged')（首帧内容就绪 ⇒ 重新评估）
    · aboutToAppear → startSplash() —— **迟滞**定时器（SPLASH_HYSTERESIS_MS）到点，按
      shouldStartSplash(cold, 迟滞, booted) 判定"要不要展示"：就绪在迟滞内 ⇒ **不展示**；
      否则置 showSplash=true + 记录 splashT0，再装 minDwell / timeout 两枚表
    · 撤下：shouldShowSplash(cold, now-splashT0, booted) 为假 ⇒ beginExitSplash（T2 让位 → T3 交棒）
    · ⛔ SplashOverlay 是**根 Stack 的末子节点**（ArkUI Stack **后入子的在上层** ⇒ 才会叠在内容之上；
      "LoadingView 之前"的首子节点会盖在内容**下面**看不到）
    · EntryAbility 侧配合：页面 aboutToAppear **同步**读回缓存主题（readCachedTheme）⇒ themeName 与
      系统开屏/应用色板同源（§12.1 零跳色）
```
（⚠️ **孤儿风险**：ArkTS 不检查无消费者的组件文件（`docs/ARKTS-GOTCHAS.md` 批次13）—— 本组件**已接线**进 `pages/Index.ets`，进编译图。）

### ③ `EntryAbility.ets` 的 error 分支（**最小改动**，§2 T0 兜底）

```
~ entry/src/main/ets/entryability/EntryAbility.ets:53-57
    windowStage.loadContent('pages/Index', (err: BusinessError) => {
      if (err.code !== 0) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err));
-        return;
+        // 兜底：loadContent 失败时**至少**让系统开屏/一帧可读提示存在，而不是停在空白。
+        // ⛔ 具体形态待拍板（见 §12 待拍板 ③）；本行只是"不要静默 return"。
+        return;
      }
```
（⚠️ 已核 `EntryAbility.ets` **无在途改动**；`pages/Index.ets` **有在途** ⇒ 该文件的接线不归本波。）

---

## 11. 缺档 / 矛盾（本规格**不新造**，只上报）

**本波裁决结果（调度者 2026-10-11）**：① ② ⑥ **采纳建议值**（⛔ 落地时必须**作为底座常量新增**，
不许把数字散落在组件里）；③ **不强行统一**（保留两个具名常量，见下）；④ 已记账；⑤ 不新增。

| # | 缺档 / 矛盾 | 说明 | 状态 / 建议（**由底板常量推导**，非自造） |
|---|---|---|---|
| ① | **`SPLASH_MIN_DWELL_MS` 不存在** | 底座只有 `MOTION_*`（动画时长），没有"**最短停留策略**"常量 ⇒ 若直接用 `T1+T2=540`，品牌在"内容秒就绪"时可能一闪而过 | ✅ **裁决：采纳** `MOTION_BASE_MS + MOTION_FAST_MS = 400ms`；⚠️ 待 `orb-ux` 提升为底座常量（现由 `core/splash.ets` 以派生表达式先行落地，**零裸数字**） |
| ② | **`SPLASH_TIMEOUT_MS` 不存在** | 没有"冷启动超时"档位；不设 ⇒ 慢网时无限停在开屏 | ✅ **裁决：采纳** `ORB_BREATH_MS = 2560ms`（= 在飞主呼吸刻度 1×）；同上待提升 |
| ③ | **入场 scale 起点有两个不同值** | 设计输入 `docs/REDESIGN-INPUT-BRAND.md:145` 写 `scale 0.92→1`；而 `components/AssistantOrb.ets:94` 的 `ORB_ENTER_SCALE = 0.86` | ✅ **裁决：不强行统一** —— 二者**同语义、按元素变体**：**标记**用 `0.92`（`SPLASH_MARK_ENTER_SCALE`，建议提升为底座 `MOTION_ENTER_SCALE`），**光球**用 `0.86`（`ORB_ENTER_SCALE`，光球专属，已具名）。理由：强行合并会人为耦合两者的调参 |
| ④ | **开屏曲线的"另一个可能"** | `sheetTransition()`（`anim.ets:114-117`）用了 `Curve.Friction`（**底座外**的 ArkUI 内置曲线）⇒ 若开屏误用它，就是"第二套曲线" | ✅ 已记账（不在本波域）；⛔ 开屏**必须**用 §4.5 的两条曲线（spring 入场 / ease-out 让位） |
| ⑤ | **T3 光球的"首个会话在流式"判据不在本规格** | 该判据属状态机（`row.isLive` / `busy`），已有唯一源 | ✅ 组件消费既有判据，**不新增** |
| ⑥ | **标记的展示尺寸无 token** | `spaceRoles()` 只到 `xxl=32`；开屏标记盒（居中大标记）的边长**没有**语义档 ⇒ 若各写各的，就是散落字面量（本仓禁） | ✅ **裁决：采纳** `5 × SPACE_XXL(32) = 160pt`；⚠️ 待提升为底座尺寸档 |
| ⑦ | **`EASE_OUT_CSS` 无工厂**（本波新发现） | token 已定义（`core/tokens.ets:56`）但**无消费者/无工厂** ⇒ 组件无法消费"无超调缓出"（`@ohos.curves` 只许在 `components/anim.ets` import） | ✅ **已收口**：`orb-ux` 已把 `EASE_OUT_CSS` 收成具名工厂 `animEaseOut()`（`components/anim.ets:103`）；`SplashOverlay` T2 已改用它（见 §4.5） |
| ⑧ | **"快启动不该开屏"的闸门缺失**（接线时新发现） | `shouldShowSplash` 在 `cold` + `t=0` 即 `true` ⇒ 只要一挂载就开屏，**快启动也被拖 minDwell+** —— 与用户口径「尽可能快；加载慢才播动画」相反 | ✅ **已补**：新增迟滞常量 `SPLASH_HYSTERESIS_MS(150)` + 纯函数 `shouldStartSplash(cold, elapsed, contentReady)`（`core/splash.ets`）：内容在迟滞**内**就绪 ⇒ **压根不展示**（T0 直接过渡）；迟滞已过仍未就绪才展示并完整播完 |

---

## 12. 需要用户拍板的点（一条一条）

> **已被裁决销账**：#4（minDwell/timeout 取值）与 #5（入场 scale）—— 见 §11 的"本波裁决结果"。
> 仍待拍板的只剩下面 4 条。

1. **白主题标记用"品牌紫"还是"Apple 蓝"？**（`SOLID` 档的颜色）
   实调：紫 `#7C5CFF` 对白 **4.3461**（≥3 非文本 ✅，<4.5 文本 ✗）；蓝 `#0071E3` 对白 **4.6967**（两者皆 ✅）。
   ⚠️ 选蓝 ⇒ 与 porcelain 界面强调色统一，但**改动品牌主色**会牵连图标/深色主题/与 web 对齐（`docs/BRAND.md §2.4`）。
2. **是否采用方案 A（`FOLLOW_APPLICATION`）消除冷启动跳色？**（`docs/BRAND.md §12.1` 的精确 diff；**不需卸载重装**）
   不采用 ⇒ 只能上方案 B（固定底色 + T1 同色），**跨深浅必闪**（§6 表）。两方案**可叠加**。
3. **T1/T2 是否真的要做（引入应用内开屏）？** 现状无它也能跑（系统开屏 → 首页）。
   做了才有"品牌过渡"；组件已实现（`components/SplashOverlay.ets`），但**接线归 `sidebar-ux`**（见交付的接线补丁）。
4. **交互打断的语义**（§4.2，已实现为"立即 T3"）：T1/T2 期间用户点击 ⇒ **立即进 T3**（`splashPhaseAt(..., userDismissed=true)`），对吗？
   （另一选项：忽略点击、走完过渡。当前实现 = 前者。）

---

## 13. 与既有文档的关系

| 文档 | 关系 |
|---|---|
| `docs/BRAND.md §4.2 / §11 / §12.1` | 开屏底色 SDK 证据 / 降级链 / `FOLLOW_APPLICATION` 补丁 —— 本规格**引用不重复** |
| `docs/REDESIGN-INPUT-BRAND.md §4` | 三段过渡（A/B/C）设计输入 + 红线 —— 本规格把它**收敛成可实现的 T0–T3** |
| `docs/DESIGN-SYSTEM.md §8` | "在飞"铁律（唯一 owner = 光球）—— 本规格 §9 引用 |
| `docs/mockups/splash.html` | 本规格的**静态样张**（T1/T2/T3 静帧 + 时间轴） |

---

## 14. 2026-10-11 审计复核（目标⑤）—— 发现 / 待裁决 / 引用订正

> 本波只**审计 + 订正引用**，⛔ 未改任何 `.ets` **行为**（规格条文除行号外原样）。
> 机器判据 = `tools/tests/splash_continuity.test.ts`（★A 品牌停驻窗 / ★B 提示有效可见度 / ★C 生产相位驱动）。

### 14.1 §11 补三条**缺口（待裁决）**

| # | 发现 | 证据（`file:line` + 数值） | 建议 / 状态 |
|---|---|---|---|
| ⑨ | **纯模型 `splashPhaseAt` 与生产时间线分叉** | §4.1 的 220/540 真值表在 `entry/` **0 消费点**（`splash_continuity ★C` 打印计数 = 0）：页面用**两道闸门**驱动 —— `Index.ets:839 startSplash()`（迟滞 `SPLASH_HYSTERESIS_MS`=150）→ `:883` 的 `minDwell(400)` 定时器 → `beginExitSplash()`（`:919`，置 T2）→ `:929` 320ms 后置 T3。⇒ 生产 **T1 实际 ≥ 400ms、总 ≈ 720ms**（非 540）。`splashPhaseStartMs` / `splashPhaseDurationMs` / `splashPhases` 同样 0 消费点。 | ⚠️ **待裁决**：(a) 以**闸门**为准（现状，含 180ms 品牌停驻窗，观感更好）⇒ 把 §4.1 标注为"仅测试模型"；或 (b) 按 §4.1 接线（需**同时**给标记加停驻，否则停驻窗归零 = "刚到就散"）。判据 = ★A / ★C。 |
| ⑩ | **跳过提示"有效可见度"峰值仅 25%** | `SplashOverlay.ets:200` 的 `.opacity(this.hintOpacity)` 嵌在 `:204` 的 `.opacity(this.overlayOpacity)` 内 ⇒ **有效 α = hint × overlay**。§4.6 令 hint 延迟 = `SPLASH_ENTER_MS`(220)、用 `animEaseOut()`(320，`:221`) 淡入；整层退场（`:141`）也在 [220,540] 由 1→0 ⇒ **两窗逐毫秒重合** ⇒ 有效 α = `p·(1−p)`，**峰值 0.25**（★B 实测打印 `0.2500`）。⇒ "轻点跳过"默认档几乎读不出来（反倒 `reduceMotion` 档因即时置 1 更清晰）。 | ⚠️ **待裁决**：让提示淡入在退场**开始前**跑完（hint 淡入取 `MOTION_FAST_MS`=180=停驻窗，或延迟前移到 `minDwell − fade`）⇒ 动 §4.6 已拍板值，**本波不改**。判据 = ★B。 |
| ⑪ | **"光球交接"铁律的唯一判据 `splashOrbAllowed` 生产 0 消费点** | `core/splash.ets:424` 定义；★C 计数 = 0（仅测试引用）。⇒ §9 铁律当前**只被测试钉住、未被运行时强制**。但 `tools/tests/handoff_motion.test.ts` 的"**揭示式**交接"（光球在覆盖层**背后**渲染）在语义上**允许**光球于 T2 期间已在跑 ⇒ 与 §9"T1/T2 必须未启动"**张力**。 | ⚠️ **待裁决 + 跨域**：要强制 ⇒ 在光球挂载点（`LiveTailView.ets:523` / `ThinkingLine.ets:119`，**归 `light-fix3`**）消费它；若确认以"揭示式交接"为准 ⇒ §9 应改写并删死判据。 |

### 14.2 样张 `docs/mockups/splash.html` **已过时**（待办，不在本波文件边界）

| 处 | 样张写的（旧） | 现行裁决（新） |
|---|---|---|
| T2 曲线（样张 §A） | `animSlow()`（spring，**有超调**） | `animEaseOut()`（ease-out，**零超调**，§4.5） |
| T1 画布（样张 §B/§C） | `splashCanvasOf(theme,…)`（方案 B，跟主题/系统）；整节"深浅对照" | `splashBrandCanvas()`（**恒深** `#0B0B0E`，与 T0 零跳色，§4.3） |

### 14.3 `file:line` 引用订正（2026-10-11 复核；**值不变，仅行号随上游增行漂移**）

上游 `core/motion.ets` / `core/tokens.ets` / `components/anim.ets` 增行 ⇒ §2/§3 台账行号整体偏移。
本波已**就地订正** §4.5 / §4.7 的**锚点**（`tokens.ets:54→66`、`tokens.ets:56→68`、
`anim.ets:103→104`、`SplashOverlay.ets:145-149→141-145`、`SplashOverlay.ets:224→204`）；
其余未逐一就地改（避免误改），映射如下（供下一波清理）：

| 旧引用（§2/§3 台账） | 新引用（2026-10-11 实核） |
|---|---|
| `core/motion.ets:31` | `:33`（MOTION_FAST_MS） |
| `core/motion.ets:36` | `:38`（MOTION_BASE_MS） |
| `core/motion.ets:38`（MSG_IN 行） | `:40`（MOTION_MSG_IN_MS） |
| `core/motion.ets:43` | `:45`（MOTION_SLOW_MS） |
| `core/tokens.ets:46` / `:48` | `:58`（D_FAST）/ `:60`（D_SLOW） |
| `core/tokens.ets:76-78` | `:88-90`（spring 三参 response/damping/overlap） |
| `components/anim.ets:48-50 / 53-55 / 58-60 / 63-65 / 72-74` | `:49-51 / :54-56 / :59-61 / :64-66 / :73-75` |
| `components/anim.ets:96 / :98 / :104` | `:115`（Breath）/ `:117`（Beat）/ `:123`（Quiet） |
| `components/anim.ets:114-117`（`sheetTransition`） | `:150-153` |
| `brand.ets:348`（`markLevelFor`） | `:355` |

> ⚠️ 上表"新引用"也**只是本次实核值**，上游再增行仍会漂移 ⇒ ⛔ 判据的**唯一真源是常量本身**（符号名），
> 行号仅供检索。`tools/tests/*` 一律按**符号名**导入（不按行号）⇒ 行号漂移**不影响门禁**。
