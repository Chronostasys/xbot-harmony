/**
 * demo.ets —— AppGallery 审核/测试用的**本地演示账号**。
 *
 * ⛔ 只走客户端本地模式：不连接任何真实服务端、不读取真实会话、不缓存真实数据。
 * 账号写死；任意输入都会产生固定演示事件；登录后自动出现 3 个不同 demo 会话。
 * 真实账号/服务端路径不变。
 */
import { SessionItem } from './types';
import { WebIteration, WebToolProgress } from './chattypes';

export const DEMO_USERNAME: string = 'xbot-demo';
export const DEMO_PASSWORD: string = 'xbot-demo';

export function isDemoLogin(username: string, password: string): boolean {
  // 审核账号只接受固定的演示用户名。密码在页面上仍展示/可填写，但演示模式
  // 不依赖它（避免审核员输错密码或输入法额外字符导致进不去本地演示）。
  return username.trim() === DEMO_USERNAME;
}

export function demoSessions(): SessionItem[] {
  return [
    {
      chat_id: 'demo-welcome',
      channel: 'web',
      label: '欢迎使用 xbot',
      preview: '开源 · 自主可控 · 不收集信息',
      last_active: '刚刚',
    },
    {
      chat_id: 'demo-tools',
      channel: 'web',
      label: '工具执行演示',
      preview: 'Shell · 代码 · 迭代',
      last_active: '刚刚',
    },
    {
      chat_id: 'demo-liveview',
      channel: 'web',
      label: '实况窗演示',
      preview: '长任务进度 · 通知',
      last_active: '刚刚',
    },
  ];
}

export function demoSeedPrompt(chatId: string): string {
  if (chatId === 'demo-tools') {
    return '演示一次完整的工具调用';
  }
  if (chatId === 'demo-liveview') {
    return '演示长任务进度和实况窗';
  }
  return '介绍一下 xbot，以及如何开始使用';
}

export function demoReasoningFor(chatId: string): string {
  if (chatId === 'demo-tools') {
    return '先分析需要执行的步骤，再模拟一次 Shell 工具调用，最后汇总结果。';
  }
  if (chatId === 'demo-liveview') {
    return '正在模拟一个长任务：准备、执行、更新实况窗，最后结束。';
  }
  return '正在整理 xbot 的开源定位、使用方式和安全边界；这里只使用本地演示数据。';
}

const WELCOME_ANSWER: string =
  '## xbot\n\n' +
  '这是一个**本地演示会话**，界面与真实客户端完全一致。\n\n' +
  '### 你能看到\n\n' +
  '- 流式思考与正文\n' +
  '- 工具调用和迭代历史\n' +
  '- 长任务实况窗与通知\n\n' +
  '### 使用方式\n\n' +
  '在输入框输入任何内容，即可查看流式动画效果。\n\n' +
  '### 重要说明\n\n' +
  '1. 本应用**不收集、不上传**任何个人信息；演示模式只使用本地固定数据。\n' +
  '2. 我们不提供任何服务器。正常使用必须自行部署 MIT 开源的 Agent 平台，并自行配置模型/API。\n' +
  '3. 项目地址：\n\n' +
  '- [Agent 平台（MIT）](https://github.com/ai-pivot/xbot)\n' +
  '- [鸿蒙客户端](https://github.com/Chronostasys/xbot-harmony)\n\n' +
  '4. 请只连接**你自己部署、自己控制**的服务器。不要相信他人提供的服务器地址；' +
  '使用来路不明的服务器造成的后果，开发者不承担责任。\n\n' +
  '> 自主可控，从自己部署开始。';

const TOOLS_ANSWER: string =
  '## 工具执行演示\n\n' +
  '我刚刚演示了一次工具调用，过程如下：\n\n' +
  '```text\n' +
  '1. 分析需求\n' +
  '2. 执行 Shell 工具\n' +
  '3. 汇总结果\n' +
  '```\n\n' +
  '这是一段固定的演示内容，不会访问真实终端。\n\n' +
  '真实使用时，工具会由你自行部署的 Agent 平台执行；客户端只负责展示。';

const LIVEVIEW_ANSWER: string =
  '## 实况窗演示\n\n' +
  '长任务可以通过实况窗查看进度：\n\n' +
  '- **准备**：解析任务\n' +
  '- **执行**：运行工具\n' +
  '- **完成**：通知用户\n\n' +
  '本页展示的是本地模拟状态；真实实况窗需要部署 Agent 平台，并配置对应权益。\n\n' +
  '项目地址：[Agent 平台（MIT）](https://github.com/ai-pivot/xbot)';

export function demoAnswerFor(chatId: string): string {
  if (chatId === 'demo-tools') return TOOLS_ANSWER;
  if (chatId === 'demo-liveview') return LIVEVIEW_ANSWER;
  return WELCOME_ANSWER;
}

/** 演示工具（状态 done，用于展示 pill/工具卡）。 */
export function demoToolFor(chatId: string): WebToolProgress {
  return {
    name: 'demo_shell',
    label: '演示 Shell',
    status: 'done',
    elapsedMs: 1200,
    summary: '演示工具执行完成',
    detail: '这是本地演示工具，不会执行真实命令。',
    args: '{"cmd":"echo demo"}',
    toolHints: '',
    iteration: 1,
  };
}

/** 第一条已完成迭代（用于展示迭代历史）。 */
export function demoFirstIteration(chatId: string): WebIteration {
  return {
    iteration: 1,
    content: '第一步：分析并准备执行。',
    reasoning: demoReasoningFor(chatId),
    tools: [demoToolFor(chatId)],
    toolCount: 1,
  };
}
