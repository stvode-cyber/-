import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma.js'

/**
 * 台账 / 动作记录 工具
 *
 * 设计要点：
 * 1. 普通审计采用 fire-and-forget（audit / auditReq），不阻塞主流程
 * 2. 关键审计（登录/充值/删除）使用 auditReqAsync，await 确保日志落库后再返回，
 *    避免进程退出或 serverless 冷却时丢失日志（违反"Failed requests must be logged"硬约束）
 * 3. detail 字段会自动截断，避免超大请求体占用数据库空间
 * 4. 仅记录"有意义"的关键动作，避免日志爆炸（GET 查询通常不记录）
 */

export interface AuditInput {
  userId?: string | null
  username?: string | null
  category: string
  action: string
  targetType?: string
  targetId?: string
  summary: string
  detail?: unknown
  result?: 'success' | 'fail'
  ip?: string
  userAgent?: string
  durationMs?: number
}

/**
 * 写入一条审计日志（fire-and-forget，不抛错）
 * - 适用于普通审计：任务更新、点赞、评论等
 * - 不等待写入完成，不阻塞业务返回
 */
export function audit(input: AuditInput): void {
  prisma.auditLog
    .create({
      data: {
        userId: input.userId || null,
        username: input.username || null,
        category: input.category,
        action: input.action,
        targetType: input.targetType || null,
        targetId: input.targetId || null,
        summary: input.summary.slice(0, 200),
        detail: input.detail ? truncate(JSON.stringify(input.detail)) : null,
        result: input.result || 'success',
        ip: input.ip || null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 200) : null,
        durationMs: input.durationMs || null,
      },
    })
    .catch((err) => {
      // 日志写入失败只打印控制台，不抛出
      console.error('[AUDIT] 写入失败:', err.message)
    })
}

/**
 * 写入审计日志并等待落库（关键审计用）
 * - 适用于登录/充值/删除等不可丢失的审计场景
 * - 失败时仅打印控制台不抛错，避免影响业务流程
 */
export async function auditAsync(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId || null,
        username: input.username || null,
        category: input.category,
        action: input.action,
        targetType: input.targetType || null,
        targetId: input.targetId || null,
        summary: input.summary.slice(0, 200),
        detail: input.detail ? truncate(JSON.stringify(input.detail)) : null,
        result: input.result || 'success',
        ip: input.ip || null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 200) : null,
        durationMs: input.durationMs || null,
      },
    })
  } catch (err) {
    console.error('[AUDIT] 关键日志写入失败:', (err as Error).message)
  }
}

/**
 * 从 Request 中提取 ip / userAgent / durationMs，构造 AuditInput
 */
function buildInput(
  req: Request,
  res: Response,
  input: Omit<AuditInput, 'userId' | 'username' | 'ip' | 'userAgent' | 'durationMs'> & {
    userId?: string | null
    username?: string | null
  },
): AuditInput {
  const forwarded = req.headers['x-forwarded-for']
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded || req.ip || undefined
  const userAgent = req.headers['user-agent'] || undefined
  const startTime = res.locals?.startTime as number | undefined
  const durationMs = startTime ? Date.now() - startTime : undefined

  return {
    ...input,
    userId: input.userId !== undefined ? input.userId : req.user?.userId,
    username: input.username !== undefined ? input.username : req.user?.username,
    ip,
    userAgent,
    durationMs,
  }
}

/**
 * 写入审计日志（自动从 Request 中提取 ip / userAgent / durationMs）
 * - fire-and-forget，不阻塞主流程
 *
 * 用法：
 *   auditReq(req, res, { category: 'task', action: 'create', summary: '...' })
 */
export function auditReq(
  req: Request,
  res: Response,
  input: Omit<AuditInput, 'userId' | 'username' | 'ip' | 'userAgent' | 'durationMs'> & {
    userId?: string | null
    username?: string | null
  },
): void {
  audit(buildInput(req, res, input))
}

/**
 * 写入审计日志并等待落库（关键审计用，自动从 Request 提取上下文）
 * - 适用于登录/充值/删除等不可丢失的审计场景
 * - 用法：await auditReqAsync(req, res, { ... })
 */
export async function auditReqAsync(
  req: Request,
  res: Response,
  input: Omit<AuditInput, 'userId' | 'username' | 'ip' | 'userAgent' | 'durationMs'> & {
    userId?: string | null
    username?: string | null
  },
): Promise<void> {
  await auditAsync(buildInput(req, res, input))
}

/**
 * 截断超长字符串，避免单条日志过大
 */
function truncate(s: string, max = 1000): string {
  return s.length > max ? s.slice(0, max) + '...[truncated]' : s
}
