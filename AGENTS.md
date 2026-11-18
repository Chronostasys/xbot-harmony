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
- ⚠️ `docs/NATIVE-COURT-VIEW.md` — **通信视图面板**（web `/court` 的原生对等实现）：数据 =`GET /api/groups*` + SSE `group.message`；面板**必须用独立 `SseClient`**（主 `sse` 是 per-chat 单订阅，复用会踢掉聊天流）；判据 `tools/tests/court.test.ts`。⛔ 真实面板**不伪造数据**（web 同口径：失败显示错误 + 空态）。⛔ 入口**唯一** = 运行面板「代理」tab（`embedded: true`，**代替**老子代理列表；关面板唯一出口 `closePanels()` 同时退订 SSE）—— 不另设顶栏按钮/独立浮层。
- ⚠️ `AGENTS.md`（会话动作）— **新建/分叉/删除的会话动作必须收敛到一条身份路径**：`store.createSession()` **只建 + 刷列表并返回 id**、`forkSession(id, srcChannel, label)` 用**源会话自己的** channel、`deleteSession(id, channel)` 同样用该行 channel + `canonicalChatId` 归一（旧实现一律用当前 store 的 channel ⇒ 跨渠道会话 403/400，用户观感「删除按钮没作用」）；切换身份**只有** `Index.switchSession(id, channel)` 一条路（禁止在 store 内静默 openSession）。删除当前会话后自动落到列表里的下一行。
- ⚠️ `docs/NATIVE-COURT-VIEW.md` — 子代理 interactive 四态（`idle|running|interrupted|unloaded`，后端 `agent/interactive_persist.go`）：`interrupted`/`unloaded` **都不是运行中**，且**不得显示成「完成」**（`core/panels.ets:subagentSubText`）。
- **⛔ 恢复/对账只许"边沿触发"，禁止轮询**（用户 2026-10-24：*「轮询是世界上最丑陋最傻逼的东西」*）：锁屏/冻结恢复的判定点是**帧到达的边沿** —— `onSse` 里比较 `now - lastEventAtMs >= SSE_GAP_RESUME_MS(10s)`（SSE 心跳 15s ⇒ 解锁后第一帧必命中），命中即 `resumeContinuity('silence-gap')`。⛔ 不要在 600ms 页级脉冲/任何定时器里"定期判静默"（那是轮询：恒定唤醒、把状态正确性挂到节拍上）。判据 `tools/tests/stale_snapshot_escape.test.ts` ⑥（含反向：`SILENCE_RESUME_MS` 不得回归）。
- **⛔ 模型的 effects 必须真的执行**（不是打日志）：`docs/STATE-MODEL.md §8` 定死"模型只产出 effect、由驱动层去拉权威"——`runShadowModel` 曾把 `pullIter`/`pullTurn` 只 `log('model', …)`（"接线期由 W2 落地"）⇒ 缺口永远补不上、模型每帧重复发同一个 effect、`live` 永久停在旧轮（2026-10-22 真机「重连后卡死在老 turn 不 resync」，日志 `effect=pullTurn turn=1127` 刷屏）。现状：`pullIter` ⇒ `fetchIterationDetail`（结果经 `iterations_loaded` 回同一条管道）、`pullTurn`/`snapshot` ⇒ `resyncAfterResume`；**必须带合并窗**（(turn,iter) 2s / turn 3s / 整体 10s）否则每帧一枪 = 重连风暴。判据 `tools/tests/model_effects_wiring.test.ts`。
- **⛔ 连续性基线以模型影子为准**：`currentMark()` 先取 `shadow.live`，再回落 legacy `state.activeTurn`（取更新的那个）。行源是模型，legacy 可能已 idle 而模型仍 live ⇒ 只读 legacy 会得到 `turnID=0` ⇒ 判据落 `NONE` ⇒ **永不 resync**。
- **⛔ 后台恢复 / SSE 重连只有一个连续性判据**（`core/resume.ets:resumeVerdict` + `store.resumeContinuity`）：`markBackground()` 记「turn + iter」基线；回前台/重连各打一发共享的 `get_active_progress`（1s TTL）⇒ `NONE`（只对账会话树）/ `GAP`（**只补洞**：快照 `iteration_history` 走既有 `iteration` 事件管道）/ `RELOAD`（换轮·后台期间跑完·`resync_required` ⇒ 唯一权威重载出口 `resyncAfterResume`）。⛔ 禁止在触发点上自己判、也禁止"一律重历史"（旧 `sse-reopen` 就是无条件重载）。判据 `tools/tests/resume_verdict.test.ts`。
- **⛔ 水合的"在飞"必须带单调性**（`core/model_hydrate.ts`）：`running = active.turnID===turn || (prev.live.turn===turn && !liveOvertaken)`，且 `liveOvertaken`（快照出现比 `prev.live.turn` 更大的回合）⇒ **旧轮不得复活、`live` 归 null**。旧实现无条件信 `prev.live` ⇒ 断线/切后台期间跑完的旧轮被水合成 running（`final=null`/`streaming=true`），新轮不流式（用户 2026-10-22「重新连接时历史推进到下一个 turn 有 bug」的根因）。判据 `tools/tests/hydrate_liveness.test.ts`（mutation：去掉 `!liveOvertaken` ⇒ 红）。
- **子代理转录必须"建 turn"**（用户 2026-10-27：「agent 历史渲染在用户消息**上方**」）：`ChatStore.parseSubAgentMessages` 里 `user` 开一轮（`turnSeq++`）、其后 `assistant` 归该轮、连续多条 assistant 合并进同一条、`iterations` 挂最后一条 assistant（无 assistant 时**追加到当前 turn**，顺序 = user → assistant）。⛔ 绝不能整批 `turnID: 0` —— 那会进 `historyToReplaced` 的 **legacy 段**，而 legacy 在渲染上排在 turns **之前**（锚点无效即沉底）⇒ 顺序必然反转。判据 `tools/tests/subagent_transcript_order.test.ts`。
- **子代理历史必须走 `get_agent_session_dump`（web 同源）**：`role/instance` 型子代理的 **assistant 正文在 `iteration_history`**、session_messages 只留**空壳占位**，且常无 turn 结构 ⇒ 只走 `/api/history` 会被"空 assistant 行"规则过滤掉 ⇒ **只看得到 user 消息**（用户 2026-10-26 P0）。入口 = `store.loadSubAgentTranscript(parentChatID, role, instance)`：① `RPC_GET_AGENT_SESSION_DUMP`（messages + iterations）② 兜底 `RPC_GET_SESSION_MESSAGES` ③ 结果经 `historyToReplaced` 进同一条事件管道；拿不到内容返回 false 由调用方回落常规历史。面板点行 = 先 `switchSession(chat_id)` 再按 `role` 补这一枪。判据 `tools/tests/subagent_view.test.ts` ⑥。
- **子代理树必须能渲染任何畸形数据**（用户 2026-10-26：「后端可能会出 bug，可能有没父亲的子节点，任何情况前端都要能渲染」）：`core/panels.allSubAgentRows(root, orphans)` 统一兜底 —— ① **无父节点的孤立子代理**（`orphan_subagents`/脏数据）作为额外根渲染（`orphan=true`、副行「无上级（孤立子代理）」）⛔ 不得因找不到父就丢；② **同 `chat_id` 多行**（幽灵行 `children=0` + 真身行 `children=N`）**择优**（children 多 → running → 非历史），否则整棵子树丢失；③ 缺 `chat_id`/`label` 的空壳仍渲染（主行 `(未命名子代理)`、ForEach key 用序号兜底）；④ **自引用/成环**用 `seen` 去重；⑤ **超深**截断到 `SUB_TREE_MAX_DEPTH`（竖线列上限 `SUB_TREE_MAX_RAILS`）；⑥ 未知 `status` **原样显示**（不谎报"空闲"）。判据 `tools/tests/subagent_view.test.ts` ⑤a~⑤f。
- **树线必须"全局前瞻"推导**（`allSubAgentRows` ③ 段）：折角竖线延续 ⇔ 后面还有 `depth ≥ 本行 depth` 的行；祖先第 k 列延续 ⇔ 后面还有 `depth ≥ k+2` 的行 ⇒ **只有整表最后一行是 `└─`**。⛔ 别退回"按父节点算 last"——真机上孤立节点排在末尾时，上一棵子树的 `└─` 会让**主干断半行**（用户："下面两个子代理还没和上面连一起"）。
- **子代理行间不要分隔线**（2026-10-26 用户：「灰色那个为什么要有，看起来出头了」）：树线已表达分组，再叠横线会被看成折角拖尾；行高固定即够稳。
- **子代理视图（运行面板「代理」tab）**（2026-10-26 用户回滚 + 两点增强）：数据源 = **`store.subagentsAll`**（`core/panels.allSubAgentRows(root)`：会话树 `children` 的 **DFS 前序 + `depth`**，**含 idle/完成/历史**，排序 运行中 → interrupted → 其它，同级保持 DFS 序）；按 `depth` 缩进，点行切到该子代理会话。⛔ 别再退回 `activeSubAgentNodes`（那会**隐藏 idle**）；⛔ 旧的 `store.subagents`（仅活跃）保留给 tab 角标/侧栏计数，两者判据不同不要合并。判据 `tools/tests/subagent_view.test.ts`。
- **通信视图（`CourtSheet`）当前无入口**：用户 2026-10-26 要求回滚「代理」tab 的结构化视图 ⇒ `CourtSheet.ets` / `core/court.ets` / store 的 court 数据仍在，但**页面不再接线**（`court.test.ts` ⑨ 已反向固化：Index 里出现 `CourtSheet({` 即红）。重新挂入口 = 显式决策 + 同时改该判据。
- **⛔ `hydrate()`（busy→idle 的权威重载）也必须逐字段合并工具 meta**（用户 2026-10-28 P0，原话「新的 toolcall 只要从 busy 变成 idle 了，就无法看她的详情了…这个必须修好」）：idle 边沿会触发 `loadHistory → history_replaced → hydrate()`，而历史载荷里的工具是 **DB 轻字段**（只有 name/label/status）。旧实现整表替换 ⇒ 在飞期间拿到（或刚经 `/api/iteration_detail` 补全）的 `args/detail` 在**变 idle 那一刻被抹掉**。修法：`model_hydrate.mergeSnapshotBlock`（同一 `(turn, iteration)` 的块 + 同号 `prev.live.tools` 走 `mergeToolLists`；正文/迭代集合仍以快照为权威），在飞快照的 `live.tools` 同样合并。判据 `tools/tests/tool_meta_merge.test.ts` §9。
- **注入型工具一律按普通 pill 渲染**（用户 2026-10-28：「background task / subagent done / pre_turn_end 之类的，都改成普通工具渲染」）：`core/synthhints.isSyntheticToolName()` **恒 false**（专用卡 `SyntheticCard` 是"无论怎样都有暂无详情"的观感来源；名字集合与 `inferSyntheticKind` 保留，只用于解析 hints）。工具 pill 宽度 `PILL_MAX_W` = **168**（一行两枚）。
- **⛔ 模型层**绝不删工具**（P0「不是渲染重复，是渲染丢了，tool 不见了」）**（用户 2026-10-28）：去重不能靠"删数据"。我先前加的 `dropAssignedCalls`（按 call 全局删）与 `dropForeignTools`（按 `tool.iteration < block.iteration` 删）都会**误杀真工具**——`call_id` 可能跨迭代复用（`call_0`），工具号也可能落后于块号 ⇒ 界面上"思考 29 字之后工具整个消失"。现在：`dropForeignTools` **恒等**（留名标记此处出过 P0）、`dropAssignedCalls` 已删除；重复只在**渲染层窄口径**吸收：`MessageRow.committedHasSameIterCall`（仅"同迭代 + 同 call"）+ `pillmerge`（去重键 = `迭代号 + call_id`）+ `groupShownPills`。⛔ 任何"为了不重复"而删模型数据的改动都是回归。
- **⛔ 前沿唯一（live 不得是已提交迭代的副本）**（P0「思考 29 字 + 思考中…」）：`hydrate` 里若某块是 live 指向的那一迭代**且有实质内容**（content/reasoning/tools/subAgents 任一非空）⇒ `live = null`；⚠️ **空壳块不算**（cancel/边界快照清 live 会让正文整段闪没，`hydrate_liveness ③` 判据）。
- **⛔ 一轮里 `iteration` 必须唯一（P0「连续思考」）**（用户 2026-10-28 截图：思考 25 字 / 38 字 / 50 字 三条叠着）：`model_hydrate` 旧实现 `[...rec.blocks, ...add]` 直接**追加**，而历史里同一回合可能有多行 assistant 快照（进度快照 / 重连重放），每行都带**同一个 `iteration`** ⇒ 同一迭代被画成多条思考行（字数递增 = 不同时刻的快照）。修法：按 `iteration` **upsert** —— 后到者覆盖正文/思考（取非空新值），工具仍 `mergeToolLists` 逐字段合并（不倒退）。判据 `tools/tests/live_tools_no_stale.test.ts` §11（修复前实测红：`got 3 want 1`、`got "一二三"`）。
- **⛔ 单一归属不变量（P0：同一 toolcall 绝不能出现在两个容器）**（用户 2026-10-28 连续复发，最终形态「行1: tool1 / 行2: tool1 tool2」，且「重连后」必然复现）：模型状态里每个 `call` 在一轮内**只能归属一个位置**（某个已提交块 **或** pending **或** 在飞列表）。四条过滤缺一不可：① `model_step.onlyOwnIterTools`（`live.tools` 只留 `iteration === live.iteration` 且 call 未被块/缓冲占用）；② `dropForeignTools`（块内丢 `tool.iteration < block.iteration`）；③ `dropAssignedCalls`（块内丢已被**其它**块/pending 占用的 call，**必须排除自身迭代**否则升级同一块会自噬）；④ `model_hydrate` 的 `assigned` + `remember()`（**重连** `history_replaced → hydrate` 按快照重建块，快照里同样有残留；且快照工具常缺 `call_id`、call 回落到 `${iter}#${idx}` ⇒ 必须再用 `名字|label|args` 内容身份兜底）。⛔ 渲染层去重（`pillmerge`/`groupShownPills`）只能兜底：重复横跨 `IterBlocksView` × `LiveTailView` **两个组件**，互相看不见。判据 `tools/tests/live_tools_no_stale.test.ts`（§1/§3 **修复前实测为红**；§1–§10 覆盖 tick/块内/重盖章/detail/整轮集合/重连 hydrate/live 快照重叠）。
- **⛔ 「同一迭代两份」的另一条腿：子代理回合号漂移**（用户 2026-11-14 P0「子代理的 shell 转后台之后，该迭代被重复渲染」——截图为同一个「思考 44 字」出现两遍，第二份还多出后台投递的 `delivered_message` 与「执行中」的 Shell）：子代理会话的 turn 号有**两套来源**（`dump`/`history` 派生的本地回合 1..N、SSE `progress` 携带的服务端回合任意大数），旧实现在"turn 号不认"时**现场建新回合** ⇒ 同一迭代被画进两个回合（块进老回合、`live` 进新回合）⇒ 重复。修法六处（缺一不可）：① `model_step.alignSubChatTurn` —— 新回合号的 `tick`/`done` 若与某回合**最后一块**是**同号迭代**且正文/思考**逐字相同**（所有非空维度都要相等）⇒ 归一回合号；② `onTick` 的"已提交前沿迭代收到迟到帧"不再整帧丢弃，改为把工具/正文**并进前沿块**（否则后台投递的 `delivered_message` 全丢）；③ `enrichDoneBlock` 吸收同号 `live` 里更完整的正文/思考、`onDone` 对**空壳块**不清 `live`；④ `model_hydrate` 的**跨回合**前沿判据（`live` 与块所属回合不同，逐字相同即判副本 ⇒ 清 live）；⑤ `model_project.assistantRow` 的**投影层前沿唯一**（同号块已在 ⇒ 不画 live 副本；空壳块除外）；⑥ `model_project.uniqueIterBlocks` 按号取"更完整的一份"（同回合同号两份块只画一份，`[DUP-ITER]` 日志留证）；⑦ **平行回合集去重** `model_hydrate.dedupeParallelTurns` —— 一段子代理历史有**两套回合号**（`/api/history` 的 DB 回合 vs `dump` 派生的 1..N），而 hydrate 以 `prev.turns` 为底**合并** ⇒ 两套并存 ⇒ 同一迭代投影成两行；判据 = 两回合块按号**逐字相同**（或子集）且至少一块有正文/思考 ⇒ 合并成一份（有 user 行的当宿主，块按号取更完整者；`[TURN-MERGE]` 日志留证）。判据 `tools/tests/subagent_bg_dup_iter.test.ts`（22 绿；mutation 自证：摘 ①/④/⑤/⑥/⑦ 与恢复整帧丢弃、去掉空壳守卫 ⇒ 各自必红）。
- **⛔ 在飞迭代也必须能补详情**（用户 2026-10-28：「最后一个完成的工具看不到详情」）：一轮的**最后一次**迭代常常还挂在 `live`（提交只来轻快照、甚至尚未提交）⇒ ① `onDetail` 只遍历 `t.blocks` 会把详情丢掉 ⇒ 必须同时按号合并进 `s.live.tools`；② `LiveTailView` 自带 popup、**从不通知页面去拉详情** ⇒ 所有在飞 pill 永远无参数/输出。修法：`onDetail` 补 `live.tools`（`mergeToolLists`，幂等），`LiveTailView.onNeedDetail(iter, name, toolIter)` 在**打开那一刻**回调 → `MessageRow.onToggleTool`（已扩成三参）→ 页面 `toggleToolByKey` → `fetchIterationDetail`。判据 `tools/tests/tool_meta_merge.test.ts` §7~§8（mutation：删 live 合并 ⇒ ⑦ 红；删 onNeedDetail ⇒ ⑧ 红）。
- **⛔ 工具 `meta` 必须**字段级合并**，绝不整体替换**（用户 2026-10-27 P0：「老的 tool 能看到详情，新的看不到；新的迭代所有 tool 完成后都没参数和结果」）：wire 上 `args/detail/summary/tool_hints` **只在部分帧携带** —— 流式的 `streaming_tools`/`completed_tools` 有，但提交帧（`iteration` 的 `iterations_delta`）与 `text_final.progress_history` 里的工具是**轻字段**。模型此前四处都是整体替换（`applyToolTicks` 的 `tk.meta !== undefined ? …`、`onDone` 的 `stampBlock(f.block)`、`onFinal` 的"空才保留"、`onDetail` 的整块替换）⇒ 迭代一提交详情就被轻 meta 盖掉（在飞能看到、完成后消失；旧版"最后一个工具能看"是因为它还挂在 `live` 里）。web `progressStore.dedupTools` 是对象展开合并 ⇒ 原生同源：`model_step.mergeToolMeta/mergeToolLists`（**新值优先、空则保留旧值**；状态/标签以新值为准、`exitCode` 缺省保留；返回值完全一致时保留**旧引用** ⇒ 幂等零重渲染），提交前用 `enrichDoneBlock` 把在飞 rich meta 并进提交块。判据 `tools/tests/tool_meta_merge.test.ts`。
- **⛔ 工具详情按「详情是否缺」拉取，不看 `tools_folded` 标记**（用户 2026-10-27 P0：「和历史工具交互**看不到详情（包括参数都看不到）**」）：**两层根因**——① 模型侧 `Block` **不携带**折叠标记，`core/model_bridge.toHistoryIteration` 把它硬编码成 `false`，而 `Index.toggleTool` 旧判据是 `it.tools_folded === true` ⇒ 历史折叠载荷（后端已省略 `summary/args/detail/tool_hints`）**永远不发** `/api/iteration_detail`；② 即使发出去，**行源是模型**（`applyModel`）而 `model_adapter.adapt` 对 `iterations_loaded` **没有分支**（落 `default` ⇒ 丢弃）⇒ 详情只进旧管线 `reduce`，模型块永远没有 `args/detail`。⇒ 修法 = 判据换成 `core/toolmerge.toolNeedsDetail(t)`（四字段全空）+ `turnID>0 && iteration>0` + `(turn, detailIterationOf(...))` in-flight 去重；**并且** `iterations_loaded → {kind:'detail'}`（`model_types.DetailInput`）+ `model_step.onDetail` **按号覆盖**已提交块（只补不抹：空字段保留原值、无变化返回原 state 引用）。判据 `tools/tests/tool_detail_gate.test.ts` + `tools/tests/iteration_detail_model.test.ts`。
- **⛔ Markdown 块 key 必须含**逐项/逐格内容**（用户 2026-10-27：「打字机遇到列表表格之类的，会漏字」）：`core/markdown.assignKeys` 的 sig 只有 `items.length`/`rows.length`/`text.length` —— 列表项或表格单元格**内容增长**时三者不变 ⇒ key 不变 ⇒ ArkUI `ForEach` **复用旧子树、不重跑 item builder** ⇒ 新打的字永远不上屏。web 用「整篇解析成 DOM + 只裁文本节点」（`MarkdownRenderer.clipTextNodes`）没有这个失效面；原生用 `blockContentHash`（FNV-1a 覆盖 text/code/items/header/rows）进 sig 等价解决。判据 `tools/tests/stream_md_keys.test.ts`（mutation：去掉哈希 ⇒ 红）。
- **⛔ 相对链接必须按浏览器语义拼 host**（用户 2026-10-27：「后端的链接是相对地址，要自动拼上 host」）：`core/msgops.resolveOpenable` 旧实现只认绝对/协议相对/`/` 开头 ⇒ `docs/a.md`、`./a`、`../a`、`?q` 全返回空串；且 `MarkdownView.linkBase` **全仓零注入**（恒 `''`）⇒ 连 `/api/...` 也打不开。现实现 = RFC 3986 §5.2（目录合并 + `remove_dot_segments`、`?`/`#` 保留），基地址由**唯一写入点** `XbotHttp` 构造时 `setLinkBase(baseUrl)` 注册（`MarkdownView` 用 `currentLinkBase()` 兜底）。⛔ 不再「其余相对地址拒绝不猜」——无 base 时才 fail-closed。判据 `tools/tests/link_resolve.test.ts`。
- **⛔ 折叠徽标与溢出浮层必须"同源取数"**（2026-10-25 用户：「折叠的工具展开后是空白」）：`+N` 现在画在**合并块**上（`core/pillmerge.ts` 把连续纯工具迭代并成一个渲染单元，`iteration` = 该段最后一个），而浮层 `overTools()` 曾仍按 `iteration` 去 `iters.blocks` 里查 ⇒ 查到的是**单工具迭代** ⇒ `foldPills(1).hidden` 恒空 ⇒ 点开空白。⇒ 凡"从徽标派生"的取数（浮层列表、展开态、详情键）都必须走**同一个** `mergedBlocks()`。判据 `tools/tests/pill_merge.test.ts` ⑤。

- **⛔ `+N` 的"直出 / 徽标 N / 溢出列表"三处必须来自**同一次** `core/streammerge.pillView`**
  （用户 2026-11-14 P0：「你那个变成 `+N` 的工具列表里的工具是错的，和真实的对不上」）：
  旧实现三处各算一遍 —— 直出 = `foldPills(group).shown` **再去重**；徽标 N = `foldPills(group).hideCount`
  （**不去重**）；溢出列表 = `foldPills(块内全部).hidden`（**整块重算 + 位置切片**）。组里一旦有
  "同一调用的残留副本"（服务端 `active_tools` 跨帧残留；`call_id` 每迭代从 `call_0` 重编号 ⇒ 同迭代同 id
  = 同一枚），三处必然对不上：数字比列表多、列表里冒出"已经直出在上面那枚"、真工具被重复副本挤出列表。
  ⇒ 权威口径（web `FoldedToolGroup.tsx:541-586` 的 `MergedPills`+`OverflowPillsMenu`）= **一个数组 → 一次去重
  → 一次切片**：`pillView(tools)` 返回 `{shown, hidden, hideCount}` 三者同源（去重键 `迭代号+call_id`，
  无 call_id 用 `迭代号+名字+序号`；⛔ 绝不按内容去重）。配套：`toolPillGroups(tools)`（分组，按数组身份
  记忆化）、溢出浮层锚到**被点的那一组**（`overGroup`，同块多组时 `bindPopup` 与徽标底色都必须带组下标）。
  判据 `tools/tests/pill_view_consistency.test.ts`（13 绿）+ `tools/tests/pill_badge_single_source.test.ts`
  （11 绿，钉**调用点**：组件层不得直调 `foldPills`）。mutation：把 pillView 改成"先 fold 再 dedupe" ⇒ ② 红；
  摘 dedupe ⇒ ① 红；`overTools()` 改回整块取数 ⇒ ③d 红。
  **补充（用户 2026-11-17「有时候 `+N` 这个数字 N 会多 1 个」）**：徽标数字是**每帧重算**的，而浮层内容是
  **打开那一刻构建**的 ⇒ 浮层开着时来一帧（工具完成/合并块变化）就出现「数字比列表多 1」。修法 =
  `IterBlocksView.captureOverList()` + `@State overList`（点击时捕获该组的 `hidden`，浮层只渲染它）
  + `badgeCount(group, it, gi)`（**浮层打开期间徽标显示 `overList.length`**，与列表恒等；关闭后回到实时值）；
  在飞尾项同口径（`LiveTailView.badgeN()` + `@State overList`）。判据 `pill_badge_single_source` ③e~③j。
  **补充（用户 2026-11-17「第一次点开看不到参数和输出，关闭再打开才有」）**：`bindPopup` 的 builder 在
  **打开那一刻构建**，之后 `/api/iteration_detail` 回来、模型换了新工具对象，**浮层子树不重建** ⇒ 只能重开。
  修法 = **成员冻结 + 数据保鲜**：`streammerge.resolveByKeys(current, captured)`（成员/顺序 = 点击那一批，
  对象 = 当前表里同身份的**最新**一份）+ `core/toollayer`（`rememberToolDetail`/`withToolDetail` 覆盖层，
  `model_step.onDetail` 写入、`store.fetchIterationDetail` 自增 `AppStorage('toolDetailGen')`）+
  `ToolOverflowList` `@StorageProp('toolDetailGen')` 自渲染并在 `shownTools()` 里合覆盖层；详情仍缺
  （`toolNeedsDetail`）⇒ 展开区显示 **LoadingProgress 占位**（不再是「暂无详情」空壳）。
  判据 `tools/tests/pill_over_resolve.test.ts` + `tools/tests/tool_detail_overlay.test.ts`（共 17 绿）+
  `pill_badge_single_source` ③k~③n。
- **⛔ 同一视觉只许一份实现（「+N」溢出徽标）**：工具 pill 折叠的 `+N` 曾在 `IterBlocksView`（无最小高度=对）与 `LiveTailView`（多写 `constraintSize({minHeight:HIT_TARGET_MIN})` ⇒ **视觉盒被撑成 44**）各写一遍 ⇒ 用户 2026-10-23 截图「一个高度不对」。现唯一实现 = `components/OverflowPillBadge.ets`：**视觉高度与 pill 同构**（`FS_CAPTION + 2×INSET_PILL_Y`），**命中盒**靠外层 `Row().height(HIT_TARGET_MIN)` + 负边距收回占位（⛔ `responseRegion` 真机无效、⛔ 别用 `constraintSize(minHeight)` 撑视觉盒）；浮层底座（面/圆角/柔影/宽度）也在这里，调用方只给「计数 + 开合 + 内容 builder」。判据 `tools/tests/overflow_badge_unified.test.ts`。
- **⛔ 叠加层禁止百分比高度（`height('100%')`）**：父容器高度由内容决定时是**环形约束**——百分比解析的是**父级 constraint**，不是兄弟节点的实际高度。症状：同一条 pill 在 live 尾项里正常，一旦被收尸进 `LazyForEach` 列表（`ListItem` 高度无界）就被拉成一整屏（2026-10-22 用户亲报「cancel 后最后一个 tool 有概率高度极高」：块先提交进列表、工具状态尚未降级 ⇒ `toolLive()` 仍 true ⇒ 扫光带 `height('100%')` 爆炸）。⇒ 覆盖层高度一律用 **token 推导的确定值**（`typeOf(...).size + 2×INSET_*`），并在无信息量时**不渲染**（如已提交块的静态扫光）。判据 `tools/tests/tool_pill_sweep.test.ts`。
- **⛔ `user_ack.queued` 必须被消费（busy 时发消息 = 排队）**：服务端在会话忙时把消息**入队**，回包带 `queued:true`（同时带 `turn_id` = 将来要跑的那一轮）。旧 `model_adapter` 只认 `command/delivered` ⇒ `AckIntent.how='queued'` 是**零生产者死值** ⇒ 排队消息按普通气泡留在消息流里（还带「发送中/已送达」语义）⇒ 与 StagingTray 的队列视图矛盾、回合归属混乱（用户 2026-10-22 亲报）。规则：`adapt` 必须 `queued ⇒ how='queued'`，`onAck` 对 queued **只退役 pending 行、绝不绑 turn**（与 `reduce.ts:2565`、web `useChatMessages.ts:870` 同语义）。判据 `tools/tests/queued_ack.test.ts`（mutation：还原 adapt ⇒ 红）。
- **⛔ live 行的"已提交块"必须走 @Prop **值投递**（`blocksOverride`）——`@ObjectLink` 在真机驱动不了 live 行的 `build()`**
  （用户 2026-11-18 P0「每个迭代完成后整个 turn 只剩『思考中』，idle 一瞬间全部重新出现」，**修了 8 次都没命中**）：
  真机日志（`[ITR]`）铁证 —— 模型/投影层**全程正确**（`committed=4`、每块正文/思考/工具都在），
  但 `[ITR] view` **整段会话只打印 1 次**（还是回合结束后）⇒ `IterBlocksView.build()` 在 live 期从未执行。
  根因：live 行由页面 `LiveRowBody` 直驱（非 LazyForEach），`row` 引用恒定 ⇒ ArkUI 看不到值变化；
  而 `IterBlocksView` 只读 `@ObjectLink iters` ⇒ 在 live 行**不触发 build** ⇒ 已提交块区冻结在创建那一瞬（空）⇒
  只剩「思考中」；idle ⇒ `isLive` 变 false ⇒ 行回到 `LazyForEach` 走 `applyRows` 全量重建 ⇒ 块一次性全出现。
  修法（**恢复本仓原有设计**，它被后来重构删掉了）：`Index.LiveRowBody` 传 `liveBlocks: this.liveBlocks` →
  `MessageRowView.@Prop liveBlocks` → `IterBlocksView.@Prop blocksOverride`（非空时 `mergedBlocks()` 以它为准）。
  `@Prop` 是**值语义** ⇒ 值变即重建，不依赖任何 `@Observed` 通知；普通行传空 ⇒ 仍走 `@ObjectLink` 持有者（性能预算 §3 不变）。
  判据 `tools/tests/live_row_blocks_delivery.test.ts`（15 绿，钉 5 个调用点；mutation：删 prop/忽略 override/删页面投递 ⇒ 各自必红）。

- **⛔ 同一个 P0 修两次没命中，就必须换手段：先取证，再动代码**（2026-11-18 的教训，代价 ~10 版装机）：
  这一轮我连续改了 `enrichDoneBlock` 守卫、`onTick` 物化、`uniqueIterBlocks` 合并、`assistantRow` memo、
  `onDidBuild`、`dedupeParallelTurns` …… 每一处都"看起来合理"，但**真正断点在渲染层的值投递**，
  模型层从头到尾没坏 ⇒ 全都不命中，还引入新 P0（"两个思考连在一起"= 物化块与 done 块同号两份）。
  **正确姿势**：① 先在**每一层**打一条可 grep 的日志（`[ITR] tick/row/view/done`）；② 请用户复现一次；
  ③ 读 `hdc shell hilog -x | grep "\[ITR\]"`，用"哪一层开始不对"定位；④ 只改那一层；⑤ 判据钉**调用点**。
  ⛔ 反例（我踩过的）：靠"服务端可能先发下一迭代"这类**假设**去加物化逻辑——用户明确说「SSE seq 有序，不存在乱序」。
  ⛔ 另一个反例：`git log` 最新是 10-22（此后再无提交）⇒ 根本**没有"昨天的版本"可 diff**，
  别再声称"对比昨日版本"，直接按层取证。

- **⛔ `onSend` 必须按 `requestID` 幂等（发消息的一瞬间出现两条 user 气泡）**：本地乐观行
  `user_sent`（requestID = R）之后，服务端还会回显 `user_echo`（后端把 requestID 序列化进
  `WSMessage.ID`，`normalize.normalizeUserEcho` 已按 `env.request_id ?? env.id` 解析出**同一个 R**）
  ⇒ 旧 `model_step.onSend` **无条件 append** ⇒ `local.pending` 同 R 两行 ⇒ 投影两条气泡，直到
  `turn_started` 才一起退役（用户 2026-11-16 截图：「我说用消息的方式发给我」连着两条）。
  语义与 web `chat/reduce.ts:1822-1838` 逐字同源：① 该 R 已绑定某回合 `user` ⇒ 零副作用；
  ② `pending` 已有同 R ⇒ **就地替换**（回填权威字段、清 `sending`、保留原 `id`）；③ 才 append。
  ⛔ 绝不按**内容**去重（连发两条「继续」是两次真消息）。判据 `tools/tests/user_send_idempotent.test.ts`
  （8 绿；mutation：还原无条件 append ⇒ `got 2 want 1` 必红）。
- **⛔ user 行位置三不变量（P0：刚发出的消息跑到上面）**（用户 2026-11-17：「user 消息刚发出去、还没
  发送成功的时候，可能出现在错误的位置（在上一个 user msg 后面，下方是之前的回复）」）：
  ① `model_project.project` 遍历回合**只许按到达顺序**（`Map` 插入序），⛔ **绝不 `ids.sort(号)`** ——
  turn 号会倒退（重连后 DB 号 vs 本地新号、子代理 dump 号 1..N vs SSE 号、服务端重启后重排），按号排
  会把**新轮**排到旧轮前面；② `onAck(delivered + turn)`：目标回合**已有块或已收尾**且不是本条 ⇒ **不绑**
  （乐观行继续留在 `pending` ⇒ 永远渲染在最后），等真正的空回合再绑；③ `onOpen` 遇到**号复用**
  （同号回合已有内容且 `requestID` 不同）⇒ 旧内容**归档到 `maxId+1`**（数据不丢、位置不变），
  `f.turn` 空出来给新回合。判据 `tools/tests/user_row_order.test.ts`（15 绿；mutation：恢复按号排序 ⇒ ① 红；
  去掉 ack 守卫 ⇒ ③ 红；去掉 open 归档 ⇒ ④ 红）。
- **⛔ `text_final` 缺 `turn_id` ≠ 命令回复（cancel ack 就没有 turn_id）**：后端  `handleCancelledRun` 返回的 `OutboundMsg` **不带 `TurnID`** ⇒ `normalizeText` 给
  `turnID: null`。旧 `model_adapter` 把 `turn <= 0` 一律当命令回复丢弃 ⇒ **被取消的回合永不
  `final`** ⇒ 行恒 `turn-N-live`（`finalized=false` ⇒ `isLive=true`）⇒ 页面 `syncRowDs` 把
  `isLive` 行**抽出列表当末尾在飞尾项** ⇒ 症状「cancel 后发新消息 ⇒ 历史变成 user1 user2
  + iter1-20 busy」（assistant1 不在原位，3s 后 resync 才自愈）。⇒ 只有**显式**
  `commandReply === true` 可以不进 turn；其余 turn-less final 由 `model_bridge.stepEvent`
  给 `fallbackTurn`（在飞轮 → **最早未收尾**轮；取"最晚"会在 cancel ack 晚于新轮
  `turn_started` 时误伤新轮）。判据 `tools/tests/cancel_final_turnless.test.ts`
  （mutation：恢复 `if (turn <= 0) return []` ⇒ ①/② 红；改"最晚" ⇒ ③ 红；去掉命令回复守卫 ⇒ ④ 红）。
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
