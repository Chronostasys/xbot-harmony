# 鸿蒙推送（Push Kit）· xbot 插件

服务端**主动**把通知推到安装了 xbot 的华为手机上（HarmonyOS Push Kit），用户不打开应用也能收到。

**纯非侵入**：只往服务端插件目录新增一个目录，不改 xbot 服务端任何源码；删除目录即完全回原状。

| 项 | 值 |
|---|---|
| 插件 ID | `xbot.harmony-push` |
| 运行形态 | `stdio`（NDJSON，协议见 xbot `plugin/PROTOCOL.md`） |
| 工具（**全渠道**） | `push_harmony_noti` —— 任何会话/渠道的 LLM 都能调用 |
| 上下文注入 | `harmony-push-hint` —— 提示 AI 在长任务结束时主动通知（可在设置里关） |
| 前端 RPC | `xbot.harmony-push.<method>`（经 `web_plugin_rpc`） |
| 设置 | `contributes.configuration` → App「设置 → 插件 → 鸿蒙推送」原生渲染（**与插件同一份 config.json**） |

## 安装

```bash
# 在本仓（xbot-harmony）：
plugins/xbot-harmony-push/package.sh
# ⇒ 安装到 ${XBOT_HOME:-~/.xbot}/plugins/xbot.harmony-push/{plugin.json, bin/harmony-push}
```

然后在服务端**重载插件或重启 xbot**，插件才会被发现。

## 首次配置（3 步）

1. **AGC 取凭证**：AppGallery Connect → 项目设置 → 常规 → 记下 **App ID / Project ID / Client ID**；同页或 Server SDK 处取 **Client Secret**。
2. **App 里填**：设置 → 插件 → 鸿蒙推送（Push Kit）→ 填入上述值（secret 遮蔽存储）。
   - HarmonyOS **5.x 及以上**：接口版本选 **V3**（用 Project ID）；
   - HarmonyOS **3.x/4.x**：选 **V1**（用 App ID）。
3. **手机端登记**：手机打开 xbot → 插件页 → 「登记本机」上报 Push Token →「发送测试推送」。
   看到通知即链路打通。

> ⛔ 前置：AGC 已开通**推送服务权益**；应用签名 profile 需含 push 能力（即 `agconnect-services.json` 对应的
> client_id 已与包名绑定）。若显示"无权限发送"（80300002），先查权益与消息分类 `category`。

## 工具 `push_harmony_noti`

| 参数 | 必填 | 说明 |
|---|---|---|
| `title` | ✅ | 通知标题（≤100 字，超出按语义截断） |
| `body` | ✅ | 通知正文（≤500 字） |
| `level` | | `info`（默认）/ `warn` / `error`；`error` **豁免静音时段** |
| `category` | | 华为消息分类（如 `IM`/`ACCOUNT`/`ORDER`）；留空用设置默认 |
| `ttl` | | 设备侧留存秒数（默认按设置里的天数） |
| `silent` | | 静默推送（只进通知栏，不亮屏不响铃） |
| `notifyId` | | 相同值**覆盖**上一条通知（用于"进度更新"合并） |
| `data` | | 附加 JSON 字符串（应用内可解析） |
| `dryRun` | | 只校验并回执，不真发（排查用） |

回执为 JSON：`{ok, sent, failed, devices:[掩码名], code, hint, skipped, error}`。
**任何失败都给出可读中文结论**（含华为错误码解释），LLM 与用户都能据此自查。

## 前端 RPC

| 方法 | 作用 |
|---|---|
| `status` | 就绪状态 / 设备数 / 令牌缓存 / 最近一次投递 |
| `register_token` | 上报本机 Push Token（`{token, name?, platform?, version?, profileId?}`，幂等） |
| `unregister_token` | 注销某设备 |
| `list_devices` | 设备台账（token 一律掩码） |
| `rename_device` | 给设备起可读名 |
| `clear_devices` | 清空台账（换机/重装排查用） |
| `send` | 手动发一条（支持全部工具参数，含 `dryRun`） |
| `send_test` | 发一条固定的测试通知 |
| `log_recent` | 最近投递日志（成功/失败/错误码） |
| `settings_get` / `settings_set` | 读写设置（secret 只回掩码） |

## 设置项（App 原生渲染）

启用推送 · App ID · Project ID · Client ID · Client Secret（遮蔽）· 接口版本(V3/V1) · 默认消息分类 ·
默认提醒强度 · 默认留存天数 · 相同内容合并窗口(秒) · 每分钟发送上限 · 静音时段(如 `23:00-07:00`) ·
是否提示 AI 在长任务结束时通知。

## 运行期数据（全在插件目录内）

```
<XBOT_HOME>/plugins/xbot.harmony-push/
├─ plugin.json            清单（工具/设置 schema/i18n）
├─ bin/harmony-push       可执行文件
├─ config.json            设置（与 App 界面同一份；由 host 写入）
└─ data.json              设备台账 + 投递日志（原子写）
```

⛔ 安全：真 Push Token 只在 `data.json`（0600）里；**日志、RPC 回执、错误串一律掩码**（`前6…后4`）；
`client_secret` 从不明文下发。

## 常见错误码

| code | 含义与处置 |
|---|---|
| `80000000` | 成功 |
| `80100000` | 部分 Token 无效 → 该设备重新登录应用以刷新 Token |
| `80200001/80200003` | 访问令牌无效 → 检查 Client Secret / 系统时间 |
| `80300002` | 无权限发送 → 查推送服务权益 + `category` 与已开通场景是否一致 |
| `80300007` | 全部 Token 无效 → 应用重装/清数据后 Token 会变，重新「登记本机」 |
| `81000001` | 华为侧内部错误 → 稍后重试 |

## 开发

```bash
cd plugins/xbot-harmony-push
go build ./... && go vet ./... && go test ./...   # 19 条单测（假 HTTP，不联网）
```

单测覆盖：设置解析/钳制/校验、静音时段（含跨天/非法）、V3/V1 URL、请求体逐字段
（category/clickAction/foregroundShow/notifyId/ttl/data/testMessage/silent）、台账幂等与原子落盘、
限流与合并窗口、令牌缓存（第二次不联网）、错误码→中文建议、`doSend` 端到端（跳过静音/合并/限流、
无设备报错、dryRun、分批）、RPC 掩码（真 token/secret 绝不外泄）。
