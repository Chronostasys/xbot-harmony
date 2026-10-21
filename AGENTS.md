# AGENTS.md — xbot-harmony

HarmonyOS 原生客户端，目标是与官方 webui（`/Users/bobli/src/xbot/web`，**权威基准**）功能与
视觉对齐。ArkTS/ArkUI（Stage 模型），SDK pin `compatibleSdkVersion 21`。

## 构建 / 门禁（全部必须绿）

```bash
source ~/ohos-cli/env.sh                       # hvigorw/ohpm/hdc/Emulator + JAVA_HOME + LANG=zh_CN.UTF-8
cd /Users/bobli/src/xbot-harmony
bash tools/tests/run.sh                        # 纯逻辑测试（.ets 当 TS 编译后 node 跑）
bash tools/lint/render-path.sh                 # 渲染路径门禁
bash tools/typecheck/check.sh                  # core/ 静态检查
hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
# 装机 + 截图
hdc -t 127.0.0.1:5555 install -r entry/build/default/outputs/default/entry-default-unsigned.hap
hdc -t 127.0.0.1:5555 shell "aa force-stop com.chronostasys.xbot"; hdc -t 127.0.0.1:5555 shell "aa start -a EntryAbility -b com.chronostasys.xbot"
```

模拟器 `xbot_phone`（1320×2848，包名 `com.chronostasys.xbot`）。驱动 UI 用 `uitest uiInput`。

## ⛔ GOTCHAS（会浪费数小时的坑）

- **带参全局 `@Builder` 的子树不随参数重建**（参数是"调用那一刻的快照"）。用它承载"会变的内容"
  ⇒ 卡片/数字卡在首帧、打字机不动、**点不开**、tool pill 状态恒为初值。
  **凡需响应更新 ⇒ 真 `@Component` + `@Prop`**；`@Builder` 只用于"参数不变"的静态片段
  （或无参、读 `this` 的片段）。详见 `docs/ARKTS-GOTCHAS.md`。
- **ArkTS 禁对象字面量作类型标注**（圆角等）—— 用内联 `.borderRadius({...})`。
- **⛔ 真门禁是 `bash tools/gate.sh`**（离线三条 + **ArkTS 编译** + 取色 role + 颜色字面量 + 性能预算 + **⑧未消费 core 模块** + **⑨动画透明度**）。脱机三条脚本全绿 **≠** 能编译：
  `run.sh` 只把 `core/**` 当纯 TS 编译，`lint`/`typecheck` 也不碰 ArkUI 组件与页面 ⇒ 组件/页面的
  ArkTS 严格性与类型错误（如 `Stack` 无 `justifyContent`、调用联合类型、SDK 版本门限）**一个都抓不到**。
  唯一判据是 `hvigorw assembleHap` 打出 `BUILD SUCCESSFUL`。
  **推论（2026-10-11 我连踩两次，实测）**：**新增/修改的判据脚本必须先在"门禁同环境"自证** ——
  ① 先 `source ~/ohos-cli/env.sh` 再跑（否则 `${var}`+全角括号那条 GOTCHA、以及 UTF-8 locale
  相关的行为**不复现**：我新写的 ⑥b 单独跑绿、进门禁必挂 `unbound variable` ⇒ 直接红给全部并行线）；
  ② 跑一次**真门禁**确认它在门禁里真绿（别只看单独跑）；
  ③ 做 **mutation 自证**：注入一个"必红样本"⇒ 必须红、同副本不注入 ⇒ 必须绿；
  ④ 抓取规则要**只取调用片段**（`grep -o`），别"取整行第一个引号"（我把 `Text('保存').fontSize(
  typeOf('type.subhead')…)` 误判成 `typeOf('保存')` ⇒ 假红）；⑤ 扫到 0 处要**判红**（白绿防线）；
  ⑥ 在**干净 worktree / 新 clone** 里跑门禁前先 `ohpm install --all` —— `oh_modules` 是 git-ignored，
  否则 ④ 必因缺 `@hxa-atpc/noties_prism4j` 之类**假红**（我本人差点因此拦住一次装机；
  `deploy.sh` 与验收脚本自带这步，装机路径不受影响）。详见 `docs/ARKTS-GOTCHAS.md` 批次 28。
- **⛔ `core/*.ts`（纯 TS 端口）不许 import `.ets`**：`import { X } from './types'` 解析到 `types.ets` ⇒
  ArkTS 硬红 `10605999 Importing ArkTS files in JS and TS files is forbidden`（实例 `core/reasoningopen.ts:25`，
  **推前隔离门禁 ④ 实测**）。**脱机三条（run.sh/lint/typecheck）永远抓不到** —— 只有真门禁 ④ 能抓。
  合法修法：本文件 `export interface XLike {…}` 最小**结构**契约（调用点由 ArkTS 校验），或类型搬纯 `.ts`；
  ⛔ 别把有同源语义的纯函数拆成"消费者各写一份"。
- **⛔ "死消费"类缺陷（函数/偏好全仓 0 消费方 ⇒ 用户操作静默无效）**：已抓到 3 例 —— 强调色 `withAccent`
  （全仓仅 1 调用点 `Index.ets pal()`，而 **40 组件/80 处走 `paletteOf`** ⇒ 拿不到覆盖）、通知 3 开关
  `applyNotifyPrefs`（**0 调用点**）、思考展开态 `reasoningopen`（**0 消费方**，接线前"修好了"是假的）。
  **2026-10-17 第 4 例 `gapReloadToken`**：`reduce.ts` 的洞判据（`liveAheadGapSig`/`lostIterGapSig`/
  `unreachableGapSig`）一直在自增该令牌，而**原生侧零消费方**（全仓只有声明 + 一句注释）⇒ 判据触发、
  **没人重载** ⇒ 用户亲报「历史停在 `迭代1 迭代2`、在飞到 50 时看着正常，50 一结束合成块消失」＝
  洞永久补不上。修法照 web `AgentPanel.tsx:446-462`：`store.watchGapReload`（token 变 ⇒
  `resetStateMachine` + `initialChatState` + `loadHistory`）；判据 `tools/tests/gap_reload_wiring.test.ts`
  （含 mutation 自证：摘掉消费点必红）。
  ⇒ **形态断言必须钉"调用点计数"**（钉"方法体存在"会假绿）；改这类函数前先 `grep -rn` 数消费点。
- **⛔ 会话 busy/idle 是**服务端**权威信号 —— 别在客户端打补丁（用户 2026-10-17：「严禁做 hack，
  后端乱发 session_idle 就必须修后端」）**：`agent/agent.go` 的回合收尾 defer 曾在
  `processMessage` 返回后**无条件**发 `session(idle)`；若用户在前一轮收尾前就发来下一条消息
  （新一轮已 active），这条**迟到的旧轮 idle** 落在新一轮 busy 之后 ⇒ 前后端都把在跑的新轮
  误标 idle（卡 busy / 界面冻结 / 历史闪烁）。**修在服务端**：每会话单调递增 `runGen`，
  只有"仍是当前轮"的收尾才允许发 idle（`emitSessionIdleIfCurrent`，判据
  `xbot/agent/session_idle_guard_test.go`）。客户端侧保留的是 **web 同款**两层
  （HTTP `session-tree` 为持久权威 + SSE 意图 15s 有界提示 + 无条件轮询）——
  那是 web 的既有设计，不是补丁。
  另：`/api/session-tree` 的 `running` 是 **`omitempty`（false 缺字段）** ⇒ 客户端必须把
  "缺字段"折成 `false`（当 unknown 跳过对账 ⇒ 丢一条 idle 就永久卡 busy）。
- **开屏 T0 不跟应用主题（真机实测）**：`startWindowColorModeType: FOLLOW_APPLICATION`（`base/profile/startWindow.json`）
  **真机不生效**；`base`/`dark` 的 `element/color.json` **都是 `#0B0B0E`** ⇒ 系统开屏恒深。
  ⛔ 别把 `base` 改浅（会让系统浅色下的深色主题用户白闪，`18db95a` 修过）⇒ **T1 品牌开屏恒深**
  （`core/splash.ets` 的 `splashBrandCanvas`），靠 T2 渐隐过渡到应用主题（否则浅色用户看到画布中途翻白）。
- **⛔ 静息态必须 fail-safe —— 可读性不能是动画的函数**（用户亲报「白主题正文看不清」的真根因）：
  `.opacity(x ? 1 : 0)`（`x` 初值 `false`）+ `onAppear(() => animateTo(..., () => x = true))` 这类写法，
  一旦动画被打断/`onAppear` 未触发就**永久不可见** —— 实测正文被卡在 **≈13% 不透明度**（对底 1.32:1）。
  **web 权威恰好相反**：`web/src/index.css:683-714` 的 `@keyframes msgIn` **无 `forwards`** ⇒ 元素自身
  opacity 仍是 1 ⇒ **动画不跑就停在 1（天然 fail-safe）**；宿主把静息态写反了。同罪第二处：切会话把
  **整张列表** `.opacity` 置 0.001 再 anim 回 1（`Index.ets`，已修）。⇒ 入场一律用**出现过渡**
  `.transition(...)`、静息态恒为可见值；门禁 **⑨**（`tools/lint/anim-opacity-gate.sh`）硬红拦 A 级形态、
  警告 B 级（不透明度由 `animateTo`/`anim` 驱动）；失败方向安全的一次性过渡（初值可见、动画到 0，
  如开屏退出淡出）登记 `tools/lint/anim-opacity-allowlist.txt` 并写明理由。
- **⛔ 行源已是模型（W3 之后）：判据必须走 `tools/tests/model_harness.ts` 的 `ModelFeed`**。
  旧的 `deriveRows + applyRow`（`core/derive.ts` / `render.ets` 的 apply 路径）**已删除** ——
  还在用它写判据 = 判据与真机不同源（"判据绿、真机红"）。
  ⛔ **在飞块必须带 `live: true`**：页面 `syncLiveTail` 靠 `iterations[last].live === true`
  找到它并把正文/思考/工具投给打字机（`Index.ets:10320-10341`）；漏标记 ⇒ 流式内容只在收尾出现。
  ⛔ **「有产出」的判定必须与 `liveHasOutput` 同源**（content **或 reasoning 或 tools 或 genui**）：
  只看 content/tools 会漏掉"只有思考流"的帧 ⇒ 行里没有在飞块 ⇒ **页面停在「思考中…」**
  （用户 2026-10-20 亲报现场，2026-10-21 在桥接层复现并修复）。判据
  `tools/tests/live_cache_lifecycle.test.ts`（①b/② 必红形态）+ `tool_status_rowrebuild.test.ts`（①d）。
- **⛔ `LazyForEach` + 「最小通知键」⇒ 已存在行永不更新**（本轮两起事故的同一根因，我各踩一次）：
  `LazyForEach(ds, …)` 的 item builder **只在新建时执行**；此后父级 `@State` 变化**不会**重新投递 `@Prop`。
  若数据源按 `id#rev` 之类的键做最小通知（`ChatRowDataSource.applyRows`），**主题变更不改变任何键 ⇒ 零通知
  ⇒ 已存在行永远用创建那一刻的快照** ⇒ 真机症状「切浅色后**历史**消息仍白字/live 正常」、「（过去迭代的）tool
  永远显示排队」。⇒ **凡"会变的值"要么让行自己订阅（`AppStorage`+`@StorageProp`），要么在变更路径显式发通知**；
  ⛔ 别靠 ForEach 重投 `@Prop`。细节见 `docs/ARKTS-GOTCHAS.md`。
- **⛔ 401 后 `ChatStore` 必须真正停掉**：`dispose()` 只 `sse.close()` 不清 `sessionPollTimer`、
  不摘 `http/sse.onUnauthorized` / `onAuthExpired` ⇒ 后端重启（`web_auth.go` 的会话是**内存 map**，
  一重启全失效）后，被清池的旧 store 仍每 5s/30s 带旧 cookie 打 `/api/session-tree` → 401 →
  把刚重新登录成功的页面**再次踢回登录页**，每个轮询周期重复一次（用户 2026-10-17 亲报
  「模拟器每过几秒就退出到登录显示登录过期」）。判据 `tools/tests/auth_expiry_dispose.test.ts`
  （dispose 清 timer + 摘 4 个回调；doLogin 先 `disposeAllStores()` 并置 `authExpiredHandled=true`）。
- **⛔ 流式期滚动不得写页面 `@State`**：`syncLiveTail` 的**顶部**必须早退
  （`userScrolling || (userTouchActive && busy)`）——尾随定时器会绕过 `syncFrom` 的滚动早退，
  每 100ms 写 `liveText/liveBlocks/liveTools` ⇒ 整页 rebuild 与手势抢主线程 ⇒ 刷新率骤降
  （用户 2026-10-17 亲报「滚动时像卡死」）。滚动停止由 `onScrollStop → syncFrom` 一次补齐；
  判据 `tools/tests/session_isolation_wiring.test.ts`（mutation：删守卫必红）。
  **但这还不够**（同一天用户再报「高度不断抖动」）：① `store.rebuildRows` 会**就地**改
  `rowCache` 里的 `ChatRow`，而 LazyForEach 的 `MessageRowView` 用 `@ObjectLink` 订阅它 ⇒
  **绕过**页面 `syncFrom` 早退、每帧改行高；② LazyForEach 的 item builder 只在新建时执行 ⇒
  页面传的 `paused` 对**已有条目**不会更新 ⇒ `LiveTailView` 打字机继续推进。⇒ 滚动/触摸期
  必须同时 `ChatStore.suspendUiUpdates(true)`（挂起 `rebuildRows`，恢复时一次重建）**且**
  `setUiScrolling(true)`（模块级标志；`LiveTailView.tick` 直接读 `uiIsScrolling()`）。
  判据同上（mutation：删 `uiSuspended`/`uiIsScrolling`/`setUiScrolling` 任一处必红）。
- **⛔ notification `turn_started` 不得在已有 live turn 时抢 `activeTurn`**（2026-10-18 用户截图：
  两条 user msg 邻接 + turn 结束卡 busy）：后台任务完成可能在主 turn 仍在跑时注入
  `turn_started(trigger=notification)`。旧实现无条件 `activeTurn := 通知 turn` ⇒ 主 turn 被收尸成空壳、
  无 turn_id 的 stream/text 落到通知 turn（回答渲染在通知 user 行后）、通知 turn 永不收尾 ⇒ busy。
  （⛔ 2026-10-21 该旧函数已删除：服务端只在**回合收尾后** drain 通知，客户端不再冻结主 turn；
  见 `tools/tests/reduce.test.ts` 的 REPRO 2026-10-18 与 `docs/STATE-AUDIT.md §4.2 F2`）
  ~~修法见 `core/reduce.ts:attachNotificationWhileLive`~~（只插 frozen user-only 空壳，不动
  activeTurn/lastSeq/sessionRunning）+ `text_final` 权威收尾时清 sessionRunning；web 同源修法在
  `web/src/chat/reduce.ts`；判据 `tools/tests/reduce.test.ts`（REPRO 2026-10-18）。
- **⛔ i18n 不是“把字符串包上 `i18nT`”就完了**（2026-10-18 用户三连报）：
  ① 冷启动首帧必须**同步**读本地语言（`core/config.readCachedLocale` + `EntryAbility.onCreate`
  的 `initLocale`），只靠登录后 `loadSettings` 异步到达 ⇒ 侧边栏先中文；
  ② 切换语言必须让**组件自己重建**（`@StorageProp('appLocale')`，组件级订阅；仅父级 state
  变化不会重投 `@Prop`）——设置面板/已存在行都要；
  ③ 抽屉 `drawerGroups()` 的缓存指纹必须含 `getLocale()`，且组标题/分类/渠道/相对时间
  的唯一出口（core 纯函数）内部翻译；否则缓存/直出中文；
  ④ 服务端生成的通知正文不是 i18n key ⇒ `tNotification` 只翻协议标签（任务 ID/命令/输出
  原样）；⛔ 别把用户内容当文案改写。
- **⛔ 跨会话投影/异步回包必须有身份/代数守卫**：`syncFrom` 首行 `if (store !== this.store) return;`
  （否则旧 store 的 16ms flush 会把 `currentChat` 改回旧会话 = 界面 A、`this.store` B）；
  `ChatStore.chatGen` 在 `beginSwitch` 自增，所有异步回包（history/status/queue/sessions/
  settings/terminals/subscription）await 后比对 `gen !== this.chatGen || forChat !== currentChatId`
  ⇒ 丢弃旧回包（同一个 store 被重开到另一 chat 的串台根因）。同一判据文件覆盖。
- **⛔ 服务端 `active_tools` 整批先标 `pending`**（`agent/engine_run_tools.go:49-64`，到 goroutine 启动才翻
  `running`），且这些条目会**残留进后续帧**；服务端**明确要求前端按 `iteration` 过滤**
  （`agent/engine_wire.go:2436-2445` 原文 "the frontend cannot filter it"）⇒ 渲染 live 工具列表时**必须**照
  web `LiveIteration.toolDeriv` 的 `t.iteration > maxCompletedIter` 滤陈旧项（本仓落点 `core/render.ets:isCurrentIterTool`）。
- **⛔ `onWillScroll` 里**不要**写「这一帧不是用户滚动就清位」**：流式期间**每帧都有程序滚动**
  （`scrollEdge(Bottom)`）⇒ 清位会**吃掉**用户刚置的滚动意图 ⇒ 用户**滚不动**（被反复拽回底部）。
  一律走 `core/listfollow.markUserScrollFrame`（**只置位、不清位**；清位只在 `onScrollIndex` 一次性消费）。
- **⛔ 「mid-turn idle 冻结」（用户 2026-10-17 P0，症状「少了一些迭代」）的真根因是 **wiring 缺乐观
  running**，不是 `reduce.ts`**：粗粒度 idle 闸门 `if (s.sessionRunning) return s` 要求「turn 进行中
  `sessionRunning===true`」；web 靠**发送成功后乐观置 running**（`AgentPanel.tsx:177-180` + `sendStartsTurn`
  门控，命令 `!cmd`/slash 不置位）维持它，本仓此前缺这一步 ⇒ 闸门恒失效 ⇒ 一条迟到 `session(idle)`
  就冻结在飞 turn、同迭代 stream 被整批丢弃。**修在 wiring**（`store.send()` 回执后乐观
  `pushEvent({type:'session_running',running:true})`），⛔ **别去改状态机**（与 web 逐字一致）。
  服务端 `/api/session-tree` 的 `running` 是 `omitempty`（false 缺字段）⇒ 落库对账是慢路径、不能替代。
  详见 `docs/WEB-ALIGNMENT.md §21.122cf`（含判别力测试 + mutation 自证）。
- **⛔ 共享工作树里禁 `rm -rf`、禁一切 git 写命令**（只许 `git add <确切文件>` / `git commit -o -F - -- <确切文件>`）：
  本轮一条线用 `rm -rf "$(dirname "$(dirname "$D")")"` 拼路径，**误删整个 `tools/tests/`（251 文件）**。
  临时产物只 `rm -f <字面绝对路径>`；⛔ 永不 `dirname` 拼删除路径、永不 `checkout -- .`/`git clean`/`restore -R`。
- **⛔ 提交前必看 `git diff --stat`：行数必须"只有你的"**（2026-10-11 **我本人**踩中）：
  `git commit -o -F - -- <file>` 提交的是该文件的**当前全部内容** ⇒ 若**别人正持有同一文件**的未提交改动，
  会**一并卷进你这一笔**。症状 = **改动行数远超预期**（我提交自己的小修复却看到 `147 insertions` 没停下核对）
  ⇒ 把另一条线的**半成品**（`pages/Index.ets` 里 `import { selPrev } from '../core/composer'`，而该导出
  **尚未提交**）写进历史 ⇒ **真门禁 ArkTS 编译红**（脱机三条永远绿，**只有真编译能抓**）。
  ⇒ 处置：先与文件持有人对齐，或**把两边改动同批提交**（缺一边就不自洽）；⛔ 别在别人持有某文件时对它做 `-o` 提交。
- **⛔ 真机实测：`responseRegion` 的"负偏移外扩"不生效**（2026-10-11 装机对照实验，**我亲手验的**）：
  给一个 X 图标加 `.responseRegion({x:-6, y:-6, width:44, height:44})`，装机后点：**视觉中心 ⇒ 命中** ✓；
  **框外 11px（上方）/15px（左侧，仍在父容器内）⇒ 不命中** ✗ ⇒ 「靠 `responseRegion` 把热区外扩到 44」
  **在本机/SDK21 上是无效做法**（等于没修）。**可靠做法 = 让元素自己的布局盒 ≥ 44**：
  把图标放进 `Row().width(HIT_TARGET_MIN).height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)`
  并把 `onClick` 落在**该 Row** 上（视觉尺寸不变、盒内居中）。⚠️ 本仓多处（`PluginsSheet`/`AskUserSheet`/
  `MessageNav`/`Index`「回到最新」等）用的是失效的那套 ⇒ **判据只能看到属性存在，抓不到"真机是否生效"**，
  必须**装机点击对照实验**（点中心 vs 点框外）才能定性。详见 `docs/UI-AUDIT-CHECKLIST.md`。
- **ArkUI `CustomComponent` 基类的成员名不能用作组件成员名**：`size`/`width`/`height`/`position`/
  `offset`/`scale`/`rotate`/`opacity`/`visibility`/`clip`/`zIndex`/`id`/`key`（以及 `onClick` 等事件名）。
  写成 `@Prop size: number` 会报 `10505001 Property 'size' in type 'X' is not assignable to the same
  property in base type 'CustomComponent'`（实例：`AssistantOrb`）。**改名**（如 `orbSize`）即可。
- **⛔ 未被消费的组件文件不会被 ArkTS 类型检查** ⇒ 新建组件时"门禁全绿"是**假绿**，
  直到它被接线进页面才暴露错误（实例：`AssistantOrb` 的 `size` 冲突在 `828b28a` 提交时没报，
  接进 `LiveTailView` 后才红）。⇒ **新组件要尽早接线，接线后必须重跑 `bash tools/gate.sh`**。
- **`$var` 紧跟中文字符会被 bash 3.2 当成变量名** ⛔：`env.sh` 设了 `LANG/LC_ALL=zh_CN.UTF-8`
  （模拟器地域校验需要），macOS 自带 bash 3.2 在 UTF-8 locale 下把 `$s（` 的 `（` 就读进变量名 ⇒
  `unbound variable`（`set -u` 下直接挂）。**症状**：脚本单独跑正常、经过 `source ~/ohos-cli/env.sh`
  就报错（`LC_CTYPE=C` 时不复现）。**规则**：含中文的字符串里一律写 **`${var}`**，别写 `$var`。
- **⛔ 编译结果落地前，不许写"真编译通过"、不许提交**（我在 2026-10-11 亲手犯过）：我把
  `hvigorw assembleHap` **丢到后台任务**，然后在提交信息里写"真 ArkTS 编译通过"就提交了 —— 结果那次编译
  **FAILED**（`10505001 Property 'iconMuted' does not exist on type 'Palette'`），**HEAD 直接坏**。
  两条推论：① **唯一判据是编译输出里的 `BUILD SUCCESSFUL`**（"我起了编译" ≠ "编译通过"）；
  ② 判据**要贴在提交信息里就必须先拿到它的输出**，否则改写成"待编译验证"。我随后用一笔纠正提交（`54ef97f`）修好。
- **⛔ `iconMuted` 是\*\*计算型 role\*\*，不是 `Palette` 字段**：`pal().iconMuted` ⇒ ArkTS 硬红
  `10505001 Property 'iconMuted' does not exist`。唯一出口是 `colorOf(p, 'iconMuted')`
  （实现 `core/design.ets:816 iconMutedOf`：**浅 = `textSecondary` ≥3:1 / 深 = `textMuted` 逐字节**）。
  ⇒ 凡「图标弱色」一律**走 `colorOf`**（范例 `GoalBanner.ets:192/208`、`LlmErrorNotice.ets:83`）；
  拿不准某 role 是不是 `Palette` 字段时，先 `grep` `colorOf` 实现里的 `if (role === '…')` 分支。
- **取色 role 写错 = 运行时静默不可见** ⛔（2026-10-11 我在审计令牌层时钓出）：
  `core/design.ets: colorOf(p, role)` 末尾是 `return p.transparent` ⇒ 写**不在真源角色表里**的名字
  （典型：`docs/REDESIGN-INPUT-*.md` 与 `docs/mockups/*.html` 里的**散文记号** `'text.pillName'`/
  `'status.danger'`，以及新造字符串）**编译零警告、运行时文字/图标不可见**，其它测试全抓不到。
  同类第二入口：`elevationColorOf`（未知档静默落 `elev1`）。
  合法集合/映射表见 `docs/DESIGN-SYSTEM.md §12`；机器判据 = `tools/gate.sh` 的 **⑥b**
  （`tools/lint/color-roles.sh`，硬红；mutation 自证过：注入 `colorOf(p,'text.pillName')` 必红）。
- **`tools/gate.sh` 的第 ⑤ 步（孤儿组件）是警告级**：ArkTS **不检查没有任何消费者的组件文件**
  ⇒ "新组件 + 门禁全绿"可能是假绿（见上一条）；接线后请重跑。
  `No signingConfig found for product default` ⇒ 只产出 `*-unsigned.hap` ⇒ 装机报
  `install sign info inconsistent`(9568332)。装机请用 `~/ohos-cli/deploy.sh`。
- **实机点击是移动靶**：流式时列表自动滚动 ⇒ `dumpLayout → click → snapshot` 必须**同一条
  shell 命令原子执行**，坐标才准。
- **bytecode HAR** 要求 `useNormalizedOHMUrl: true`；依赖抬 `compatibleSdkVersion` 时需用户拍板。
- **不许自造轮子**：高亮用 `@hxa-atpc/noties_prism4j`（`core/highlight.ets`）；diff 移植 web
  `DiffView.tsx`（`core/diffparse.ets`）。自造的 `core/jsontok.ets` 已删。
- **玻璃材质必须锁深色**（`colorMode: DARK`），否则与设计系统割裂。

## 知识文件（本仓用 `docs/` 平铺；读它，别猜）

| 文件 | 内容 |
|---|---|
| `docs/ARCHITECTURE.md` | 分层与数据流（store/状态机/渲染） |
| `docs/ARKTS-GOTCHAS.md` | ArkTS/ArkUI 陷阱大全（**改 UI 前必读**） |
| `docs/WEB-ALIGNMENT.md` | 与 web 的逐条对照 + 历批修复记录（**最权威**） |
| `docs/WEB-PARITY.md` | 功能面 parity 清单 |
| `docs/DESIGN-SYSTEM.md` | 设计系统（tokens/主题/玻璃） |
| `docs/BRAND.md` | 品牌：应用图标 / 开屏的 SVG 设计与再生成 |
| `docs/TOOLPOPOVER-SPEC.md` | 工具 pill 浮层规格 |
| `docs/UI-AUDIT-CHECKLIST.md` | UI 自检清单 |
| `docs/INSTALL.md` / `docs/CI.md` / `docs/PREVIEWER-LINUX.md` | 环境/CI/预览器 |
| `docs/RENDER-LOAD-MEASUREMENT.md` | 渲染规模实测方法 |
| `docs/ROADMAP.md` | 路线图 |
| `docs/NOTIFY.md` | 通知能力专项（能力清点 / SDK 实证 / 后台接收明账）——**改通知前必读** |
| `docs/NOTIFY-ACCEPTANCE.md` | 通知真机验收清单（步骤/预期/判据/最可能原因；两用：不装机也能审） |
| `docs/SPLASH-SPEC.md` | 开屏阶段模型与判据（**唯一真源规格**；资源与降级链见 `BRAND.md`） |
| `docs/PERF-BUDGET.md` | 性能预算与护栏（量化基线 + 重构后不许越过的预算 + `tools/perf/guard.sh`） |
| `docs/ACCENT-CONTRAST.md` | 强调色 a11y 对比度拆解与候选值（纯分析，服务 `theme_contrast`） |

## 关键约定

- **状态机是 web 的逐字移植**（`core/*.ts` 端口件，沿用 `.ts` 以避开 ArkTS 严格规则）——
  **不要重写逻辑**，改 web 侧的同一处。
- 组件只消费状态机产物；**判据与渲染必须同源**（同一个纯函数）。
- 每个纯逻辑模块都要有判别力测试（`tools/tests/*.test.ts`，结尾 `process.exit`）。
- 图标用 `SymbolGlyph($r('sys.symbol.*'))`；**HarmonyOS 无 brain 符号**，思考用 `lightbulb`。
- **动效统一走底座**：`core/motion.ets`（纯数值，可脱机单测）+ `components/anim.ets`（UI 侧 `AnimateParam`
  工厂，唯一 import `@ohos.curves` 处）。**`core/*.ets` 禁止 import ArkUI/`@ohos.*` 全局类型**
  —— `run.sh` 把它当纯 TS 编译，会 TS2307。
- **门禁并发安全**：`tools/tests/run.sh` 的产物目录带 PID（`.out.$$`），可多线并发跑互不干扰。
- **⛔ 推送走 SSH，不要用 HTTPS（本机只挡 HTTPS、不挡 SSH，2026-10-11 实测）**：
  `git push origin main` 会**每次都干等 75 秒**再失败：`Failed to connect to github.com port 443`。
  探通道：`ssh -o BatchMode=yes -T git@github.com` ⇒ 认证成功（`Hi <user>!`）。
  **正确姿势（不改 remote 配置）**：
  ```bash
  git push git@github.com:Chronostasys/xbot-harmony.git main:main
  git ls-remote git@github.com:Chronostasys/xbot-harmony.git refs/heads/main   # 校验远端真实值
  git update-ref refs/remotes/origin/main <sha>   # 推匿名 URL 不会自动更新 remote-tracking，必须手工同步
  ```
  ⚠️ 忘了最后一步，`git log origin/main..HEAD` 会一直显示一堆"待推"（假象）。
- **⛔ 脱机 harness 会全量编译 `core/**`**：`tools/tests/run.sh`/`run-one.sh` 把 `core/` 当**整体**纯 TS 编译
  ⇒ **别人一个在途 `core/` 文件不干净，你的 `run-one.sh <任意测试>` 也红**（假红）。
  看到红**先看错误落在哪个文件、它是不是别人的在途文件**（是 ⇒ 只上报别修）；
  自证改用**隔离 harness / 隔离 worktree**。**"红了"不等于"你错了"。**
- **⛔ 动手前先 `git status`（多线并行下的保命动作）**：本仓常有多条线（人或 agent）同时改不同文件
  ⇒ 派单/开工**前**必须先 `git status --short`，**凡出现在在途列表里的文件一律只上报不改**。
  真实事故：主 agent 把 `components/ContextRing.ets` / `ThinkingLine.ets` 派给新线，
  而它们已在别人的在途改动里 ⇒ 差点互相覆盖。
  同理**自证时不要替别人改、也不要把别人的在途错误算自己头上**：主树 `gate.sh` 的 ④ 步
  可能因**别人的在途文件**变红（如 `WebSurface.ets:415`/`GoalBanner.ets:85`），
  自证请用**隔离 worktree**（`git worktree add` 到临时目录 + 复制整树 + 把在途文件回退到 HEAD）。
  ⚠️ `git worktree add` 会**静默失败**（注册残留）⇒ 先 `git worktree remove --force` + `git worktree prune`。
- **⛔ 干净 worktree / 新 clone 里跑门禁前必须装依赖**：`oh_modules` 是 git-ignored ⇒
  不 `ohpm install --all` 会因缺 `@hxa-atpc/noties_prism4j` 在 ④ 步**假红**（实例见 GOTCHAS 批次 28）。
- **判据 ≠ 信号（我本人假报三次的根因）**：粗放 `grep -rn` 取整行再猜"行内第一个引号"会把
  `Text('保存').fontSize(typeOf('type.subhead')…)` 误判成 `typeOf('保存')`；把**注释里记录色值的文档**
  当违规；`$VAR（`（变量紧跟全角括号）在 bash 3.2 + UTF-8 locale 下会 `unbound variable`。
  ⇒ 只取**调用片段**（`grep -o` 风格）、**剥注释**、**先 `source ~/ohos-cli/env.sh` 自证**、
  零扫描要判红、mutation 自证、**上报前逐条看上下文**。
- **wire 测试的「函数体截取窗」对"中间一行加长"型改动脆弱（A2a 实踩，2026-10-14）**：`src.substring(i, i+500)`
  这类定长窗断言，在中间一行被加长（`channelForChat(`→`channelForChatIndexed(this.sessions, this.channelIdx(), …`，+19 字符）时会把**后面的锚推出窗口** ⇒ 假红（实例 `status_sheet_wiring` ⑥ 的 `currentLastActive`）。修窗不修判别力（500→800，断言意图不变）；新写 wire 断言宁按函数 boundary（`\n  }`）截取，别用定长窗。
