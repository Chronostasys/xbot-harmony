# xbot.phone（手机操作插件）

把已配对的鸿蒙手机暴露成 6 个 agent 工具：`phone_dump_ui` / `phone_tap` / `phone_swipe` /
`phone_input_text` / `phone_key` / `phone_screenshot`。

> 架构与协议细节见 [`docs/PHONE-CONTROL.md`](../../docs/PHONE-CONTROL.md)。
> **命令是客户端主动拉取的**（长轮询 8791），服务端不拨入手机。

## 安装

```bash
cp -R plugins/xbot.phone ~/.xbot/plugins/
# ⚠️ xbot 的 PATH 里通常没有 nvm 的 node ⇒ plugin.json 的 entry 必须写**绝对路径**
node -e 'const fs=require("fs"),p=process.env.HOME+"/.xbot/plugins/xbot.phone/plugin.json";
const j=JSON.parse(fs.readFileSync(p,"utf8"));j.entry=process.execPath+" main.js";
fs.writeFileSync(p,JSON.stringify(j,null,2))'
```

然后用 `config` 工具的 `reload_plugins` 让 xbot 重新加载（**注意**：`reload_plugins` 曾经漏挂
`WirePluginTools`，导致"插件已激活但工具不可见"——该 bug 已在 xbot `agent/agent.go` 修复；
未修复的旧版本需要重启后端）。

## 依赖

- 手机端：`xbot-harmony` 已安装并登录（客户端会自己长轮询本机 `8791`）。
- 手机端 hdcd 需开 TCP 调试口：设备上执行 `hdc tmode port 8710`（模拟器不支持）。
- 客户端私钥：debug 期打进 `entry/src/main/resources/rawfile/hdckey.pem`（**已在 `.gitignore` 屏蔽，发版前必须移除**）。

## 自测

```bash
node tools/phone/queue_selftest.js     # 队列：并发/乱序/超时/未知 id（无需手机）
bash tools/phone/install_and_check.sh  # 真机：装机 → 拉起 → 等长轮询 → 真跑一次 dump
```
