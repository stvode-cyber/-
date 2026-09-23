/**
 * 云端 AI 网关鉴权 + 订阅控权
 *
 * 上架激活方案下，云端是唯一身份签发方，网关用**云端公钥（RS256）验签**——
 * 每个注册用户持有自己专属、由云端私钥签发的 JWT，公钥随包分发只验不签，杜绝伪造。
 *
 * 与本地 `authRequired` 的差异：
 * - 只验签 + 查云端库用户，不做本地懒同步（网关不写本地数据）。
 * - 验签通过后校验用户订阅状态：未开通（aiEnabled=false）或用户不存在 → 拒权。
 * - 解出的 userId 用于速率限制键、计费/审计归属与订阅判权。
 */
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'
import { fail } from '../utils/response.js'
import type { JwtPayload } from './auth.js'

const JWT_PUBLIC_KEY: string | undefined = process.env.JWT_PUBLIC_KEY

export async function gatewayAuth(req: Request, res: Response, next: NextFunction) {
  if (!JWT_PUBLIC_KEY) {
    return fail(res, '网关未配置验证公钥', 500)
  }

  let token: string | undefined
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7)
  }
  if (!token) {
    const cookies = req.headers.cookie || ''
    const match = /(?:^|;\s*)aie_token=([^;]+)/.exec(cookies)
    if (match) token = decodeURIComponent(match[1])
  }
  if (!token) {
    return fail(res, '未授权：缺少访问令牌', 401)
  }

  let decoded: JwtPayload
  try {
    decoded = jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as JwtPayload
  } catch {
    return fail(res, '令牌无效或已过期', 401)
  }

  // 订阅控权：校验用户存在且已开通 AI
  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, aiEnabled: true, aiExpiresAt: true },
    })
    if (!user) {
      return fail(res, '用户不存在，请重新注册登录', 401)
    }
    if (!user.aiEnabled) {
      return fail(res, 'AI 服务未开通，请联系管理员', 403)
    }
    if (user.aiExpiresAt && user.aiExpiresAt.getTime() < Date.now()) {
      return fail(res, 'AI 服务已到期，请联系管理员续费', 403)
    }
  } catch {
    // DB 异常：fail-open（放行），避免云端库抖动导致全站 502
  }

  req.user = {
    userId: decoded.userId,
    username: decoded.username || '',
    role: decoded.role || 'user',
  }
  next()
}