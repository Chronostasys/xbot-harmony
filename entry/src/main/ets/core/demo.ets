/**
 * demo.ets —— AppGallery 审核/测试用的**本地演示账号**。
 *
 * ⛔ 只走客户端本地模式：不连接任何真实服务端、不读取真实会话、不缓存真实数据。
 * 账号写死；任何输入都会产生**完全相同的演示回复事件**；登录后自动出现 3 个 demo 会话。
 * 真实账号/服务端路径不变。
 */
import { SessionItem } from './types';

export const DEMO_USERNAME: string = 'xbot-demo';
export const DEMO_PASSWORD: string = 'xbot-demo';

export function isDemoLogin(username: string, password: string): boolean {
  return username.trim() === DEMO_USERNAME && password.trim() === DEMO_PASSWORD;
}

export function demoSessions(): SessionItem[] {
  return [
    {
      chat_id: 'demo-welcome',
      channel: 'web',
      label: '欢迎使用 xbot',
      preview: 'AI 编程助手演示',
      last_active: '刚刚',
    },
    {
      chat_id: 'demo-tools',
      channel: 'web',
      label: '工具执行演示',
      preview: 'Shell · 检索 · 文件',
      last_active: '刚刚',
    },
    {
      chat_id: 'demo-liveview',
      channel: 'web',
      label: '实况窗演示',
      preview: '长任务进度',
      last_active: '刚刚',
    },
  ];
}

export function demoSeedPrompt(chatId: string): string {
  if (chatId === 'demo-tools') {
    return '展示一次工具调用和迭代过程';
  }
  if (chatId === 'demo-liveview') {
    return '演示长任务进度的实况窗';
  }
  return '介绍一下 xbot 能帮我做什么';
}

export const DEMO_REASONING: string =
  '正在分析请求，准备生成一个可复现的演示结果。这里展示的是本地演示数据，不连接真实服务端。';

export const DEMO_ANSWER: string =
  '这是 xbot 的本地演示会话，界面与真实客户端完全一致。\n\n' +
  'xbot 是一个面向开发者的 AI 编程助手：支持流式对话、工具调用、迭代历史、上下文用量和实况窗；' +
  '客户端与 Agent 平台均以 MIT 协议开源，主打自主可控、完全开源。\n\n' +
  '你可以现在在输入框输入任何内容，查看实时思考、流式输出和工具动画效果。\n\n' +
  '重要说明：\n' +
  '1. 本应用不收集、不上传任何个人信息；演示模式只使用本地固定数据。\n' +
  '2. 我们不会向用户提供任何服务器。正常使用必须自行部署 MIT 开源的 Agent 平台，并自行配置模型/API。\n' +
  '3. Agent 平台：https://github.com/Chronostasys/xbot\n' +
  '   鸿蒙客户端：https://github.com/Chronostasys/xbot-harmony\n' +
  '4. 请只连接你自己部署、自己控制的服务器。不要相信任何他人提供的服务器地址；' +
  '使用来路不明的服务器造成的后果，开发者不承担责任。\n\n' +
  '自主可控，从自己部署开始。';

export const DEMO_TOOL_NAME: string = 'demo_tool';
export const DEMO_TOOL_LABEL: string = '演示工具 · 已完成';
