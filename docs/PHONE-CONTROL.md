# 手机操作能力（phone tools）

> 目标：让 agent **在自己手机上**执行「看界面 / 点 / 滑 / 输入 / 按键 / 截图」，
> 不需要 Mac 上的 `hdc` CLI、不需要连线、不依赖已弃用的无障碍接口。

## 1. 架构（服务端下发 / 客户端自取）

```
agent 调 phone_* 工具
      │
      ▼
xbot 插件 ~/.xbot/plugins/xbot.phone        （Mac，stdio 注册工具）
      │  命令入队 + 阻塞等待（默认 20s）
      ▼
命令口 http://<mac>:8791   GET /poll?wait=25000（长轮询）   POST /result
      ▲                                                      │
      └──────────── xbot-harmony 客户端（手机上） ────────────┘
                     probe/phoneclient.ets
                            │
                            ▼
                     probe/hdcphone.ets → probe/hdcclient.ets
                            │  App 自连本机 hdcd（127.0.0.1:8710）
                            ▼
                     uitest（dumpLayout / uiInput / screenCap）
```

**为什么是"客户端拉"**：手机在 NAT 后面、IP 会变，服务端**不能**拨入手机；
客户端本来就连着 xbot 后端，因此由它主动拉命令、执行、回传结果。
长轮询（服务端挂住 25s，有命令立刻返回）⇒ 空闲时几乎零开销。

## 2. 协议要点（hdc 自连，已用真机抓包逐字节验证）

| 层 | 内容 |
|---|---|
| 帧头 | `'H','W'` + reserve[2] + protocolVer(1) + headSize(u16 BE) + dataSize(u32 BE) |
| 头载荷 | protobuf：1 channelId / 2 commandFlag / 3 checkSum / 4 vCode |
| 握手 | `SessionHandShake`：1 banner / 2 authType / 3 sessionId / 4 connectKey / 5 buf / 6 version |
| 认证 | 服务端挑战 → 客户端 **RSA-3072 + SHA-512 + PSS(salt=digest)** 签名（`auth.cpp:RsaSign`） |
| 命令 | `CMD_UNITY_EXECUTE = 1001`，载荷是 shell 命令文本 |

**踩过的坑（都写进判据了）**：

1. 首帧 feature 串末尾的 **`,TCP,mac,heartbeat` 不能少** —— 缺了 daemon 会按"非 TCP 会话"处理，
   直接回 `E000010 DAEMON_UUTH`（`authstatus 13`）。
2. `sessionId` 必须**每次新生成**，复用会被当重放**静默丢弃**。
3. 签名帧的 `authType` 要 **echo 服务端挑战包里的值**（2），不是常量 3。
4. `TCPSocket.send` 只接受 `string | ArrayBuffer`，传 `Uint8Array` 会抛 401。
5. `cryptoFramework` 只支持 `RSA3072|SHA512|PKCS1`，**不支持 PSS** ⇒ `probe/hdccrypto.ets`
   自己实现 EMSA-PSS + 裸 RSA（`s = m^d mod n`）。
6. 客户端拼命令口地址必须**强制 `http://`**（命令口是明文），见 `core/phonecmd.ts` + `phone_cmd.test.ts`。

## 3. 文件

| 文件 | 职责 |
|---|---|
| `entry/src/main/ets/probe/hdcclient.ets` | hdcd 自连：握手 / RSA-PSS 签名 / `CMD_UNITY_EXECUTE` |
| `entry/src/main/ets/probe/hdccrypto.ets` | PKCS#8 解析、EMSA-PSS、裸 RSA 签名 |
| `entry/src/main/ets/probe/hdcphone.ets` | 6 个动作（dump/tap/swipe/inputText/keyEvent/screenshot） |
| `entry/src/main/ets/probe/phoneclient.ets` | 长轮询取命令 → 执行 → 回传 |
| `entry/src/main/ets/core/phonecmd.ts` | 纯逻辑（地址推导 / 响应切分 / 字段解析） |
| `~/.xbot/plugins/xbot.phone/` | 插件：注册工具 + 命令队列（8791） |
| `tools/phone/install_and_check.sh` | 一键验收（装机 → 拉起 → 等长轮询 → 真跑 dump） |

## 4. 判据

- `tools/tests/phone_cmd.test.ts`（18 条）：地址推导（含 https→http 回归）、响应切分、字段解析
- `tools/tests/hdc_codec.test.ts`（31 条）：帧/protobuf/握手编解码，**golden = 真机抓包逐字节相等**
- `tools/tests/hdc_probe.test.ts`（16 条）：端口探测结论（自检优先于结论、对照端口不污染判定）

## 5. 已知限制

1. **私钥在 HAP 里**（`resources/rawfile/hdckey.pem`，debug 期方案，已在 `.gitignore` 屏蔽）。
   任何真实分发都必须移除，改成"用户从文件选择器导入"。
2. 需要设备侧 `hdc tmode port 8710`（TCP 调试口）可连；不同 ROM 版本策略可能收紧。
3. `uitest` 的能力面随系统版本变化（`dumpLayout` / `uiInput` / `screenCap` 已实测可用）。
