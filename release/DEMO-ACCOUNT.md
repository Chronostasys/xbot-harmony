# 演示账号（AppGallery 审核用）

## 账号

```text
用户名：xbot-demo
密码：  xbot-demo
```

登录页已显示该提示，无需服务器地址。

## 行为

- **纯本地演示模式**：不连接任何真实服务端、不上传任何信息；
- 登录后自动出现 3 个 demo 会话：
  - 欢迎使用 xbot
  - 工具执行演示
  - 实况窗演示
- 任意输入都会生成**同一条固定演示 SSE 事件流**：思考、正文、工具/迭代展示；
- demo 会话内容包含：
  - xbot 基础介绍
  - MIT 开源说明
  - 不收集信息说明
  - 输入框提示（输入任意内容查看实时动画）
  - 必须自行部署 Agent 平台的说明与源码地址
  - 不要相信他人提供服务器地址的安全警告

## 源码地址

- Agent 平台：https://github.com/Chronostasys/xbot
- 鸿蒙客户端：https://github.com/Chronostasys/xbot-harmony

## 审核注意

演示账号不依赖公网服务器，审核员可以直接登录体验 UI 与流式动效。真实使用仍需用户自行部署 MIT 开源 Agent 平台并自行配置模型/API。
