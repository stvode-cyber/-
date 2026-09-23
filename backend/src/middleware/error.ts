// TODO: [koacontext泄漏] 预防：Express → Koa 迁移时优先原生重写 middleware，不要用 koa-connect wrapper，复杂中间件链会导致 ctx 丢失
import type { Request, Response, NextFunction } from 'express'
import { fail, HttpError, generateRequestId } from '../utils/response.js'
import { auditReq } from '../utils/audit.js'

/**
 * 请求 ID 注入中间件
 * - 优先读取请求头 x-request-id（用于链路追踪）
 * - 否则生成随机 ID
 * - 注入 res.locals.requestId，供响应体和台账使用
 */
export function requestId(req: Request, res: Response, next: NextFunction) {
  res.locals.requestId = (req.headers['x-request-id'] as string) || generateRequestId()
  next()
}

/**
 * 404 处理
 * - 记录台账：system.not_found（便于发现扫描行为或前端调用错误接口）
 * - 使用 auditReq 自动捕获 ip / userAgent / durationMs
 */
export function notFound(req: Request, res: Response) {
  auditReq(req, res, {
    category: 'system',
    action: 'not_found',
    targetType: 'Route',
    summary: `404 ${req.method} ${req.originalUrl}`,
    detail: { method: req.method, path: req.path, query: req.query },
    result: 'fail',
  })
  return fail(res, '接口不存在', 404)
}

/**
 * 全局错误处理中间件
 *
 * 处理流程：
 * 1. HttpError：按业务错误码返回
 * 2. Prisma 唯一约束冲突：返回 409
 * 3. 其他 Error：生产环境返回通用错误，开发环境返回具体信息
 *
 * 台账记录：所有抛错的请求都写入 system.error，便于排查问题
 * 使用 auditReq 自动捕获 ip / userAgent / durationMs
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // 统一台账记录：失败请求
  const auditDetail: Record<string, unknown> = {
    method: req.method,
    path: req.path,
    error: err instanceof Error ? err.message : String(err),
  }
  if (err instanceof Error && err.stack && process.env.NODE_ENV !== 'production') {
    auditDetail.stack = err.stack.split('\n').slice(0, 5).join('\n')
  }

  auditReq(req, res, {
    category: 'system',
    action: 'error',
    targetType: 'Route',
    targetId: req.path,
    summary: `${req.method} ${req.path} → ${err instanceof Error ? err.message : '未知错误'}`.slice(0, 200),
    detail: auditDetail,
    result: 'fail',
  })

  if (err instanceof HttpError) {
    return fail(res, err.message, err.code)
  }
  // 云端 AI 网关拒绝（用户未开通/已到期）：业务语义 403，统一转成对用户的友善消息。
  // 由 llmService.GatewayUpstreamError 抛出，在此兜底可覆盖所有调用点，避免 500。
  if (err instanceof Error && err.name === 'GatewayUpstreamError') {
    const status = (err as Error & { statusCode?: number }).statusCode
    return fail(res, err.message, status === 403 ? 403 : 502)
  }
  if (err instanceof Error) {
    console.error('[ERROR]', err.message, err.stack)
    // Prisma 已知错误可在此分支处理
    if (err.message.includes('Unique constraint')) {
      return fail(res, '数据已存在，请勿重复提交', 409)
    }
    // Express body-parser 错误（PayloadTooLargeError 等）：使用其 status 码
    const parserErr = err as Error & { status?: number; type?: string }
    if (typeof parserErr.status === 'number' && parserErr.status >= 400 && parserErr.status < 500) {
      const msg = parserErr.type === 'entity.too.large' ? '请求体过大' : err.message
      return fail(res, msg, parserErr.status)
    }
    return fail(res, process.env.NODE_ENV === 'production' ? '服务器内部错误' : err.message, 500)
  }
  return fail(res, '未知错误', 500)
}
