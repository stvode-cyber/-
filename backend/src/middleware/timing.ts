import type { Request, Response, NextFunction } from 'express'

/**
 * 请求耗时统计中间件
 *
 * 在 res.locals 上记录：
 * - startTime: 请求开始时间戳（供 auditReq 计算 durationMs）
 *
 * 必须挂在 requestId 之后、所有业务路由之前。
 */
export function timing(_req: Request, res: Response, next: NextFunction) {
  res.locals.startTime = Date.now()
  next()
}

// 扩展 Express 类型
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Response {
      locals: {
        requestId?: string
        startTime?: number
      }
    }
  }
}
