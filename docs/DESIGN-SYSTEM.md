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
9. **主题**：`dark` / `light` / `aurora(#34d3b4)` / `nebula(#a78bfa)`，由 `paletteOf(themeName)` 统一供给。
   ⛔ 新增/修改主题时必须同步 `tools/tests/theme.test.ts` 的快照值（它会逐值核对关键角色）。
   ⛔ `toggleTheme` 是**深/浅二态**（测试钉死），极光/星云经 `normalizeTheme` + `paletteOf` 进入。

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
