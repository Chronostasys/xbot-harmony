#!/bin/bash
# xbot-server-notify —— Server 主动 push 通知插件
#
# 功能：当后台事件发生时（构建完成、cron 触发、长时任务结束等），
#       主动推送通知到原生客户端，原生客户端收到后发布系统通知。
#
# 输入：stdin = hook payload JSON（包含 event, tool_name, result 等字段）
# 输出：stdout = widget spans JSON（原生端解析后发布系统通知）
#
# 用法：
#   - 默认输出空 spans（不干扰正常流程）
#   - 当检测到需要通知的事件时，输出带 "notify" 标记的 span
#   - 原生端在收到带 "notify" 标记的 widget 时，发布系统通知
#
# 扩展：
#   - 可以检查 $input 中的 event 类型（用 grep/sed 或 jq）
#   - 可以检查文件状态、构建结果等
#   - 可以根据时间条件输出定时提醒

input=$(cat)

# 默认输出空 spans（不干扰正常流程）
# 原生端检测到 spans 中有 "notify" 标记的 span 时，会发布系统通知
# 示例通知 span（取消注释以启用）：
# echo '{"spans":[{"text":"🔔 构建完成","style":"info","notify":true,"notifyTitle":"xbot","notifyBody":"构建已完成"}]}'

echo '{"spans":[]}'
