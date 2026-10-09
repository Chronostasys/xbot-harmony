# 路线图

原则：**每一里程碑都能在手机上跑**（CI 出包 → 安装 → 用），不留"半成品分支"。

## M1 · 能聊天（当前）

- [x] 工程骨架 + CI（未签名 HAP 构建 / tag 签名发布）
- [x] Cookie 会话客户端（登录 / 注册 / 冷启动免登录）
- [x] 会话列表 / 新建 / 切换
- [x] 历史加载 + `active_progress` 恢复
- [x] 发送 / 取消
- [x] SSE 实时流（结构化进度 + 流式文本 + 会话态 + resync 回退）
- [x] 迭代渲染（T/O/C）+ 工具状态视觉
- [x] ArkWeb 逃生舱（一键打开服务端 Web UI）

## M2 · 好用（对齐 Web 的观感与正确性）

- [ ] **状态机化**：把 `ChatStore` 迁移为纯函数 reducer（对齐 xbot Web 的
      `channel/web` 语义），补齐**不变量**：每 turn 只渲染一条 user 行、live/committed 四象限、
      `internal_only` 注入行过滤
- [ ] **seq 水位线 + 遮蔽解除**：`isStaleSeq` 语义（新 Run 的 seq 归零不能吞事件）
- [ ] **Markdown 渲染**：标题/列表/表格/代码块高亮（ArkTS 原生或社区库），公式/图表降级到 ArkWeb
- [ ] **窗口化**：超长 turn（上千迭代）下保帧；ArkUI `List` + `LazyForEach` + `cachedCount` 实测调参
      （注意：鸿蒙长列表本身也有"滑动白块"，需按官方建议设 `cachedCount`）
- [ ] 上拉加载更早历史（`before_id` 游标 + `has_more`/`oldest_id`）
- [ ] AskUser（`ask_user` / `ask_user_resolved`）原生弹层
- [ ] 待发队列（`/api/queue/*`）+ 重排
- [ ] 工具详情：点击 pill 展开 `summary/args/detail`（含 `/api/iteration_detail` 按需拉取）
- [ ] 复制菜单、长按选择、图片查看（`/api/files/download` / `viewimg`）

## M3 · 完整能力入口

- [ ] **插件面板原生入口**：从后端 `web_plugin_list`（RPC）拉插件清单，识别 `web.entry` ⇒
      **按插件打开 ArkWeb 面板**（而不是单个"打开 Web UI"按钮），能力与 Web 版一致
- [ ] **GenUI**：`ui_mode=genui` 的工具结果 ⇒ 内嵌 ArkWeb 渲染（复用 Web 的 `XBOT_UI` 运行时）
- [ ] **终端**：`/ws/terminal` WebSocket + ArkWeb 里 xterm（或原生终端控件）
- [ ] 设置（LLM 订阅 / 渠道 / 模型选择 / 文件存储）
- [ ] 多会话并行（切会话不断流）+ 后台任务面板

## M4 · 打磨

- [ ] 深/浅色主题、字号、代码换行等显示设置
- [ ] 分享链接页（`/s/:token`）
- [ ] 离线草稿、失败重发
- [ ] 性能基准：冷启动 / 首屏 / 长 turn 滚动帧率（对齐 Web 版的实测口径）
- [ ] iOS/Android？——**不做**（本仓库只服务鸿蒙）

## 已知风险与对策

| 风险 | 对策 |
|---|---|
| 无 DevEco Studio 时签名繁琐 | CI 里用 `hap-sign-tool.jar`；文档给出材料生成步骤 |
| ArkWeb 内核版本由系统锁定（HarmonyOS 5.x = Chromium M114） | 插件/GenUI 面板以"能用"为准，不做深度性能优化承诺 |
| 自建服务明文 HTTP 被系统拦截（API 23+） | `module.json5` 显式 `cleartextTrafficPermitted`；公网建议 HTTPS |
| SDK 版本与手机不匹配（API 26 工程装不进 HarmonyOS 5.x） | 需要时换 `harmonyos-ci:api24/api23` 镜像并同步 `compatibleSdkVersion`；见 docs/CI.md |
