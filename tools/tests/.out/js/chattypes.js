"use strict";
/**
 * 聊天状态的**数据类型**（逐字移植自 xbot web：`web/src/types/shared.ts` + `web/src/chat/types.ts`）。
 *
 * 移植原则（用户要求「逻辑一比一」）：**不重新设计**，原样搬运字段与语义 ——
 * 这样原生端的渲染/状态行为与 web 由**代码同一性**保证一致，而不是靠我"照着理解再写"。
 */
Object.defineProperty(exports, "__esModule", { value: true });
