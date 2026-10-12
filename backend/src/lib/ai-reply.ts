/**
 * ai-reply 拆分桥接 — 真正代码在 ./ai-reply/index.ts
 * 外部 agentCore.ts 只 import { generateReply } from "../lib/ai-reply.js"
 */
export * from './ai-reply/index.js'
export * from './ai-reply/crisis.js'
export * from './ai-reply/task-detect.js'
export * from './ai-reply/smart-slots.js'
export * from './ai-reply/generators.js'
