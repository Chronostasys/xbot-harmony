# RELEASE-NOTES.md — 稳定版本（验收）· 面向用户的变更说明

> **给验收者的用法**：先读本文第 1 节（**这版里有什么**）与第 2 节（**还差什么**），
> 再按 `docs/RELEASE.md` 装机走查。
> **本文件的每条都在 `git log` 里可考据**：行尾 `→ <短哈希>` 即该提交。
> ⏳ 标记 = **已落地但截至本文撰写时尚未提交**（工作树内，无哈希可引）——见第 2 节末。
>
> 生成日期：2026-10-11 · 生成快照 HEAD `37a0e56`（⚠️ 工作树仍在推进；本文件引用的哈希均为 `git log` 实测）

---

## 0. 一句话

把原生客户端的**功能面**对齐官方 webui（通知 / 插件 / 设置 / 消息流 / 交互），并把**视觉**从"逐像素抄 web"
改为**一套自建的设计系统**（语义令牌 + 设计宪法 + 静态样张），同时把**性能**变成可执行护栏。

---

## 1. 变更清单（按 5 大目标分组）

### 1.1 通知（Notifications）

| 用户能感知的一句话 | 提交 |
|---|---|
| 回合结束、或助手在**等你回答问题时**，通知栏会提醒；点通知**直达对应会话**。 | `e058e11` `9ce733d` |
| 同一会话连发多回合**只提示一条**；同时有多个会话在跑时**提醒并存**，不会互相顶掉。 | `399a7ed` |
| 通知带「**查看**」动作按钮；长回复**多行展开不省略**、问句**响铃**、回合完成**静默**。 | `95d213a` |
| 应用图标上的**未读角标**上线，点开通知后**清零**（与系统通知对账）。 | `d300fb8` |
| 设置里新增开关「**通知显示回复内容**」——关掉后通知只剩标题（**隐私**）。 | `536c554` |
| 设置里新增独立的「**通知**」分区，上面那个隐私开关就在这里。 | `73a7240` |

### 1.2 插件（Plugins）

| 用户能感知的一句话 | 提交 |
|---|---|
| 设置里新增「**插件**」分区：可**查看/修改插件配置、启停、重载**。 | `919bbea` `35ad89f` `42f5a86` `74552d8` `fdb4904` |
| 「打开插件面板」进的是**正确的插件宿主页**（此前会弹出**裸脚本**）。 | `74a9141` `abaec53` |
| 插件图标名**大小写不同**也能正确显示（用真实服务器数据逐条复核）。 | `2283620` |
| 插件推送的 **widget 数据不再被静默丢弃**（解析层显式保留）。 | `5d97987` |
| 插件**运行时地基**：ArkWeb 与原生之间的 JS 桥 + 可注入的宿主容器。 | `260eddd` |

### 1.3 设置对齐（Settings alignment）

| 用户能感知的一句话 | 提交 |
|---|---|
| 设置面板**规格化**：分区门控（按可用性显示/隐藏）+ 各分区分工清晰。 | `fdb4904` |
| 分区成建：**工具 / 模型 / 智能体 / 存储 / Web 账号 / 关于 / 账号 / 通知 / 开发者 / 插件** 全部到位。 | `76550dd` `6a2c8e0` `2605e72` `c1cf2cf` `a5096df` `919bbea` `73a7240` `2d531e7` |
| 「关于」页可在**应用内一键更新服务端 + 重启服务**（**两步确认**，失败/超时明确提示）；release notes **链接可点**。 | `a67bff7` |
| LLM 面板：**SubAgent 三档模型**、**并发数**、**思考模式**、以及**模型 / 订阅的增删改查**。 | `39af198` `8a80741` `af64609` |
| 编辑订阅**不再悄悄清空** `max_output_tokens` / `thinking_mode`（曾是真数据丢失）。 | `6fd4570` |
| **非系统订阅**才可编辑/删除/加模型；**没有订阅时**模型推理区块不再整块消失。 | `3eb5924` |
| 删除 Web 账号加**二次确认**（不可逆操作）。 | `be302c1` |
| 越界数字**不再写默认值覆盖后端**（对齐 web「以后端为准」）。 | `024256d` |
| **偏好设置**：字号 / 代码换行 / 思考默认 / 发送快捷键——与 web **共用同一份服务端偏好**。 | `09703dd` `e919628` |
| 设置页**主题入口 5 选 1**，玻璃材质跟随主题。 | `686ebf1` |
| 「**消息渠道（Channels）**」分区：web 的渠道配置面。**组件与纯逻辑已提交，但尚未接线进设置面板**（tab 登记为"未实现" ⇒ 隐藏，避免空壳）⇒ **当前用户不可见**。 | `4b200af` `37a0e56`（⏳ 未接线） |

### 1.4 web 功能迁移（Web feature migration）

| 用户能感知的一句话 | 提交 |
|---|---|
| 消息**长按菜单**：复制（正文 / 含思考 / 含工具 / 原始 Markdown）+ **打开链接 / 复制链接**。 | `abaa69c` |
| **消息导航**：一键跳到历史的用户消息，带**位置指示**与 44×44 命中区。 | `97e301c` `26f56dd` `0c75cd1` |
| **上下文用量环**（当前对话占用了多少上下文）。 | `ec4ff40` |
| **上下文压缩点分隔行**（对话被压缩处有可见标记）。 | `d896145` |
| 抽屉会话列表的**分组 / 分类 / 折叠**。 | `f022668` `b021483` |
| 待发队列「**插队 / 清空**」+「**编辑并重发**」（rewind）+ **渠道过滤**。 | `3cc645c` `d63a627` |
| 抽屉渠道过滤现在**正确含父/子渠道**（选「飞书」能列出飞书会话**及其 SubAgent 子会话**，不再空列表）。 | `5b94f78` |
| 选项题答案按**问题下标**对齐、多选值**正确拼接**。 | `38e0062` |
| **Markdown 正文里的链接可点**（此前带下划线却点不开）。 | ⏳ 在途（`MarkdownView.ets` 未提交）｜已提交的相邻能力：`abaa69c` |
| 工具浮层**真语法高亮**（Prism4j）+ **diff 渲染**。 | `37ea786` |
| **Markdown 性能**：按块增量复用解析，流式喂入字符量降到约 **1/3.4**。 | `96299ec`（+ 按原文缓存 `33120ec`；行内块窗口 `6ad8477`） |
| Markdown 视图逻辑收敛到 `core/mdview`（链接目标 / 溢出策略 / 代码色对比度护栏）。 | `8f4e8e2` |
| 白色主题下的 Markdown 配色跨来源修正。 | `fd80ef2` |

### 1.5 界面与动画（UI & animation）

| 用户能感知的一句话 | 提交 |
|---|---|
| **设计系统**：`core/design.ets` 语义令牌层（尺度 / 层级 / 材质 / 动效 / 对比度门禁）。 | `88e67bf` |
| **设计语言宪法** `docs/REDESIGN.md` + **静态样张**（`docs/mockups/`，浏览器直接打开）。 | `86adb1d` `c2a990a` `7111b3d` |
| 设计系统有**机器门禁**（123 条断言 + mutation 自证），改动可被证伪。 | `f8188c7` `1d03cc4` |
| **骨架重构方案**（strangler，分阶段、可回滚）+ **令牌迁移计划**。 | `1d76ab1` |
| `Index.ets` **拆分 P1**：状态详情面板抽成独立组件（行为不变）。 | `19b58bb` |
| `Index.ets` **拆分 P2**：其余只读弹层（队列/插件/选项/自检/上下文/会话/搜索）抽成组件。 | ⏳ 在途（部分已 `add`：`PluginsSheet` / `QueueSheet` / `SelfCheckSheet`） |
| **性能预算与护栏**（`tools/perf/guard.sh`，退化就红）。 | `1715e4f` |
| **行内块级窗口**：单行 340 块 → 24 块（大消息不再卡）。 | `6ad8477` |
| **动效收敛**：同一时刻**只有一个「在飞」动效 = 光球**（其余只允许一次性过渡）。 | `2753031` `4f1489c` `0c45e97` |
| **思考光球**旗舰动效，由**真实内容速率**驱动。 | `5ff1c7c` `828b28a` `5160f99` `eff0967` |
| **动效底座**（弹簧）：`core/motion.ets` + `components/anim.ets`。 | `e954639` |
| **极简白主题**（porcelain）+ 系统表面（状态栏）跟随主题。 | `fce3b39` `3105f50` `2d2200a` |
| 工具 **pill 六档**的**可辨性**（色盲可用 + WCAG 对比度）有机器门禁。 | `3cc7388` `0558147` `fa9f87d` `7a81564` |
| **品牌**：矢量应用图标 + 开屏（可重复生成 + 安全区/对比度门禁）。 | `b416e4a` `2835423` `3956fee` |

#### 1.5.1 用户亲报的两处 bug（均已修）

| 用户原话 / 现象 | 根因（一句话） | 提交 |
|---|---|---|
| 「**有时所有工具都在排队**」 | 同键合并时 `generating` 档位排序**低于** `pending`，导致整批工具被翻回「排队」。 | `f422a1b`（配套：`6bc76c2` `8682505` `8996425`） |
| 「**点工具 pill 被拽到最底部**」 | 「是否跟随到底部」是**自动判据**而非**用户意图**，点头部工具时把列表强拽到底。 | `290fba1`（前置纯函数：`1821950`） |

> 两处都被登记为"**同一信息两处判据**"这一类根因，并加了**机器门禁**防复发
> （`tools/lint/criteria-single-source.sh`）——见 `docs/WEB-ALIGNMENT.md §16 #5`。

---

## 2. 已知限制 / 未做项（诚实一节）

> 逐条写清"**为什么没做**"，并标**出处**（不自己判断）。收口前应清空本表或写明移出理由。

| # | 项 | 状态 | 为什么没做 / 后续 | 出处 |
|---|---|---|---|---|
| 1 | 后台**实时**接收通知（App 被杀/冻结后仍实时） | **待用户拍板** | SDK21 下要做到"实时后台接收"**必须动权限面**（`module.json5`：`KEEP_BACKGROUND_RUNNING` + 常驻通知）。零权限的极限就是现状（前台 + 单次 ≤3 min 短时任务窗）。B（长时任务）/C（WorkScheduler）的**patch 已备好**，改配置须用户明确同意；C **不是实时**。 | `docs/PATCHES/background-notify.md §1`（含三档对照 + file:line 的 SDK 依据）；`docs/RELEASE.md §3.1` |
| 2 | 厂商推送（Push Kit） | **本 SDK 不可用 / 未验证** | 本机 SDK 无 `@kit.PushKit.d.ts`（实测 `ls`）；要走需 AGC 账号 + 服务端接入 ⇒ 超出"先不动服务端"。 | `docs/PATCHES/background-notify.md §1 D` |
| 3 | 常驻前台 Service | **平台不开放给三方** | 三方拿不到常驻后台能力。 | 同上 |
| 4 | `Index.ets` 拆分 **P3–P6**（服务层 **17 个域**） | **后续阶段** | 拆分是 strangler、逐块批准；服务层 3600 行按"操作域"切成 17 个候选域，且**有 5 组必须同搬**（否则判据分叉）。不阻塞验收。 | `docs/INDEX-SPLIT-PLAN.md §4.5`（含 17 域表 + 同搬组） |
| 5 | 令牌**迁移**（把各组件散落值换成 `core/design.ets` token） | **后续阶段** | 现状 `components+pages` 仍有约 70 处圆角字面量、`this.pal()` ≤1250 处；迁移每阶段门禁必绿、可回滚。 | `docs/REDESIGN-STRUCTURE.md §3`（分阶段）+ `§0` 实测口径 |
| 6 | 插件 **widget 界面渲染** | **未做渲染** | core 侧已解析并显式暴露（`core/panels.ets:parseWidgetsPayload` + `WIDGETS_RENDERABLE=false`），但**无渲染组件**；接线清单已交。 | `docs/RELEASE.md §5` |
| 7 | 渠道过滤 `activeChannel` 的**页面接线** | **未接线** | 纯逻辑 + IO 已就绪（`core/sessionpick.ets` / `core/config.ets:saveActiveChannel`），Index 侧三处调用待接。 | `docs/RELEASE.md §5` |
| 8 | 代码块**语法高亮配色来源**分歧 | **待设计定稿** | 原生用**全局语义色板角色**（含对比度护栏），web 用每套 md 主题的 CSS 变量；23 套 × 20 变量搬进 ArkTS 属**外观**决策，归 `design-lead` 的 `core/design.ets`。 | `docs/WEB-ALIGNMENT.md §16 #6` |
| 9 | **两条明暗轴**并存（`isLightPalette` × `isLightMdTheme`） | **待设计定稿** | md 主题是**用户可见功能**（与 web 共享 `web:ui:md-theme`），移除=功能回归；存量收敛需 `core/design.ets` 先给出"代码面色角色"。 | `docs/WEB-ALIGNMENT.md §16 #7` |
| 10 | 长词换行策略 | **待设计定稿** | ArkUI **无** `wrap-anywhere` 等价物，现用 `BREAK_ALL` + "不撑破气泡"妥协。 | `docs/WEB-ALIGNMENT.md §16 #9` |
| 11 | **PWA 安装诊断**（添加到主屏/离线） | **不迁** | 原生无 PWA 概念（web 的 SW/多标签本就不适用）。 | `docs/WEB-PARITY.md`（设置 About 行）+ `docs/ARCHITECTURE.md §5` |
| 12 | 构建门禁的"**并发假红**" | **部分缓解** | `check.sh` 的 PID 目录 + hvigor 串行锁已缓解，但多线同树并行仍可能互扰（**非阻塞**，重跑即可）。 | `docs/RELEASE.md §5` |
| 13 | 「消息渠道（Channels）」分区**接线** | **组件已提交，未接线** | `SettingsChannels.ets` 与 `core/channelscfg.ets` 已提交（`4b200af` / `37a0e56`），但 `SettingsPanel` **未实例化**它（`build()` 里无 `SettingsChannels({…})`），且 tab 显式登记 `implemented=false`（隐藏，避免"点进去是空壳"）⇒ **用户暂不可见**；接线后把 `implemented` 改 `true` 即出现。 | `SettingsPanel.ets:81`（`new SettingsTabSpec(SETTINGS_TAB_CHANNELS, '渠道', false)`，头注 `:46-50`）+ `core/settingsplugins.ets:636-656` |
| 14 | Markdown 正文链接直点 / Index P2 弹层抽取 | **落盘未提交（在途）** | 见第 1 节里 `⏳` 标记的两处：`MarkdownView.ets` 的链接 `onClick`（HEAD 尚无）与 `Index` 的 P2 弹层（`PluginsSheet`/`QueueSheet`/`SelfCheckSheet` 已 `add` 未提交）。截至本文撰写时**无哈希可引**。 | `git status --porcelain`（2026-10-11，HEAD `37a0e56`） |

> 未决项口径（供验收时对账 AskUser 问题清单是否穷尽）：
> `grep -rIcE '待用户拍板|待拍板' docs` —— 见 `docs/RELEASE.md §3.2`。

---

## 3. 验收材料索引（用户要看的文件清单）

| 文件 | 是什么 |
|---|---|
| `docs/mockups/index.html` | **样张总索引**（5 张静态样张的入口）。双击即可打开，纯静态、无外链。 |
| `docs/mockups/{chat-flow,white-theme,brand-splash,interaction,03-tool-states}.html` | 5 张**静态视觉样张**：聊天流现状 vs 新设计 / 白色主题三级层次 / 开屏+logo / 关键交互态 / 工具 pill 六档。**样张里的数值旁注即 token 名**。 |
| `docs/REDESIGN.md` | **设计语言宪法**（建层级 / 收敛值 / 判据变门禁）。任何 UI 改动的第一读物。 |
| `docs/REDESIGN-STRUCTURE.md` | **骨架重构 + 令牌迁移方案**（strangler，分阶段、可回滚）。 |
| `core/design.ets` + `tools/tests/design.test.ts` | 设计系统的**可执行部分**：语义令牌层 + 123 条断言（样张与实现不一致即红）。 |
| `docs/PERF-BUDGET.md` | **性能预算与护栏**：现状基线（可复现命令 + 数字）+ 重构不许越过的预算 + `tools/perf/guard.sh`。 |
| `docs/PATCHES/background-notify.md` | **后台接收通知**的决策材料（三档方案对照 + 可直接施行的 patch）——**待你拍板**。 |
| `docs/RELEASE.md` | **验收手册**：稳定版本定义（5 条判据）/ 版本号约定 / 装机步骤 / 走查清单 / 回滚。一键判定 `bash tools/release/check-all.sh`。 |
| `docs/INDEX-SPLIT-PLAN.md` | `pages/Index.ets` 拆分方案（度量 / 阶段 P1–P6 / 17 个服务域）。 |
| `docs/WEB-ALIGNMENT.md` · `docs/WEB-PARITY.md` | 与 web 的**功能对齐台账** + **有意分歧登记表**（§16）。 |
| `docs/UI-AUDIT-CHECKLIST.md` | 逐页走查清单（几何期望值 + 异常签名 + 修复原则）。 |
| `docs/ARKTS-GOTCHAS.md` | ArkTS/ArkUI 陷阱大全（改 UI 前必读）。 |

---

## 4. 版本号建议 + 打标签命令

**建议版本号**：`v0.3.0-acceptance`（与 `docs/RELEASE.md §2` 的约定一致：
`v<major>.<minor>.<patch>-acceptance`）。

```bash
source ~/ohos-cli/env.sh
cd /Users/bobli/src/xbot-harmony
bash tools/release/check-all.sh          # 必须 RELEASE: READY
git tag -a v0.3.0-acceptance -m "acceptance build: 通知/插件/设置对齐/web迁移/设计系统 + 用户亲报两 bug 修复"
# ⛔ 以下两条仅在用户确认收口后执行（日常开发不 push）：
# git push origin main
# git push origin v0.3.0-acceptance
```

> 回滚见 `docs/RELEASE.md §4`（回代码 / 只回 App / 回 tag）。
