import type { Request, Response, NextFunction } from 'express'
import { fail } from '../utils/response.js'

/**
 * 简易内存频率限制中间件
 *
 * 设计取舍：
 * - 不引入 express-rate-limit 等外部依赖，保持 MVP 轻量
 * - 使用进程内 Map 存储，单实例部署足够；多实例需替换为 Redis 实现
 * - 定期清理过期记录，避免内存无限增长
 *
 * 适用场景：登录/注册等敏感接口防暴破
 */

interface HitRecord {
  count: number
  resetAt: number
}

const store = new Map<string, HitRecord>()

// 每 5 分钟清理一次过期记录
setInterval(() => {
  const now = Date.now()
  for (const [key, rec] of store) {
    if (rec.resetAt < now) store.delete(key)
  }
}, 5 * 60 * 1000).unref?.()

/**
 * 创建频率限制中间件
 * @param options.limit  时间窗口内最大请求数（默认 10）
 * @param options.windowMs 时间窗口（默认 60_000ms）
 * @param options.keyFn  自定义 key 生成函数（默认按 IP）
 */
export function rateLimit({
  limit = 10,
  windowMs = 60_000,
  keyFn = (req) => req.ip || 'unknown',
}: {
  limit?: number
  windowMs?: number
  keyFn?: (req: Request) => string
} = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req)
    const now = Date.now()
    const rec = store.get(key)

    if (!rec || rec.resetAt < now) {
      // 新窗口开始
      store.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    rec.count += 1
    if (rec.count > limit) {
      const retryAfter = Math.ceil((rec.resetAt - now) / 1000)
      res.setHeader('Retry-After', String(retryAfter))
      return fail(res, `请求过于频繁，请 ${retryAfter} 秒后重试`, 429)
    }
    next()
  }
}
