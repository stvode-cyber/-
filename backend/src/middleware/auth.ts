// TODO: [koacontext泄漏] 预防：Express → Koa 迁移时优先原生重写 middleware，不要用 koa-connect wrapper，复杂中间件链会导致 ctx 丢失
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { fail } from '../utils/response.js'
import { prisma } from '../lib/prisma.js'
import { setRequestToken } from '../utils/requestContext.js'

export interface JwtPayload {
  userId: string
  username: string
  role: string
}

// 扩展 Express Request 类型
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

/**
 * JWT 密钥：支持 HS256（JWT_SECRET）与 RS256（JWT_PRIVATE_KEY / JWT_PUBLIC_KEY）两套体系。
 * - 云端（身份签发方）：用 JWT_PRIVATE_KEY 以 RS256 签发 per-user token；JWT_SECRET 仍保留
 *   供 remoteFetch/verify 等自用 HS 令牌，不能删。
 * - 桌面客户端（数据侧）：只带 JWT_PUBLIC_KEY（只能验签、不能伪造），只验不签，即上架激活方案。
 * - 启动校验：HS(JWT_SECRET) 或 RS(公钥 JWT_PUBLIC_KEY) 至少其一，绝不允许无密钥静默运行。
 */
const AUTH_MODE: string = process.env.AUTH_MODE || 'local'
const JWT_SECRET_RAW = process.env.JWT_SECRET
const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY
const JWT_PUBLIC_KEY: string | undefined = process.env.JWT_PUBLIC_KEY
if (!JWT_SECRET_RAW && !JWT_PUBLIC_KEY) {
  throw new Error('[启动失败] 缺少 JWT 密钥：需配置 JWT_SECRET(HS) 或 JWT_PUBLIC_KEY(RS 公钥)，请在 .env 中设置')
}
const JWT_SECRET: string = JWT_SECRET_RAW || ''
// P2-5 修复：缩短默认有效期至 24 小时（原 7d），降低令牌泄露后的风险窗口
// 客户端可通过重新登录获取新令牌；如需无感续期可后续实现 refresh token 机制
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h'

/**
 * P2-5 修复：轻量 token 黑名单（登出可撤销）
 * - 进程内 Map 存储 { jti → exp }，单实例部署足够
 * - 按 exp 精准清理过期记录（不 clear 整个 Map，避免重新激活已撤销令牌）
 * - 多实例部署需替换为 Redis 实现
 */
const revokedTokens = new Map<string, number>()
const revokeCleanupInterval = setInterval(() => {
  const now = Math.floor(Date.now() / 1000)
  for (const [jti, exp] of revokedTokens) {
    if (exp <= now) revokedTokens.delete(jti)
  }
}, 60 * 60 * 1000).unref?.()

export function revokeToken(jti: string, exp?: number): void {
  // exp 默认 24h 后过期（与 JWT 有效期一致），确保清理逻辑最终生效
  revokedTokens.set(jti, exp || Math.floor(Date.now() / 1000) + 86400)
}

export function isTokenRevoked(jti?: string): boolean {
  if (!jti) return false
  return revokedTokens.has(jti)
}

/**
 * 本地身份懒同步（上架激活方案）
 * - 云端是唯一身份签发方；桌面本地库没有对应 User 行。
 * - 本地后端用公钥验签通过后，把云端 userId 懒 upsert 成本地 User 行（id=云端 userId），
 *   使既有业务路由按 req.user.userId 查询本地行（wallet/heartbeat/level 等）照常工作。
 * - 带 60s 内存缓存，DB 异常时 fail-open（放行），避免数据库抖动导致全站 401 踢人。
 * - 云端自身（AUTH_MODE=local）同样可复用：用户本就存在，upsert update:{} 不产生副作用。
 */
const userExistsCache = new Map<string, { exists: boolean; ts: number }>()
const USER_EXISTS_CACHE_TTL = 60 * 1000 // 60 秒

async function ensureLocalUser(decoded: JwtPayload): Promise<boolean> {
  const cached = userExistsCache.get(decoded.userId)
  if (cached && Date.now() - cached.ts < USER_EXISTS_CACHE_TTL) {
    return cached.exists
  }
  try {
    // upsert：云端 userId 已存在则不变，不存在则创建最小本地行（id=云端 userId）
    await prisma.user.upsert({
      where: { id: decoded.userId },
      update: {},
      create: {
        id: decoded.userId,
        username: decoded.username || `cloud_${decoded.userId}`,
        password: '!cloud-sso!', // 非 bcrypt 哈希，本地仅作落库兜底，不准本地登录
        role: decoded.role || 'user',
        wallet: { create: { balance: 0 } },
      },
    })
    userExistsCache.set(decoded.userId, { exists: true, ts: Date.now() })
    return true
  } catch {
    // DB 异常时 fail-open，避免抖动踢人
    return true
  }
}

/**
 * 轻量 cookie 解析（#4 修复：避免新增 cookie-parser 依赖）
 * 从 req.headers.cookie 解析出键值对
 */
function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx > 0) {
      const k = pair.slice(0, idx).trim()
      const v = pair.slice(idx + 1).trim()
      try {
        out[k] = decodeURIComponent(v)
      } catch {
        out[k] = v
      }
    }
  }
  return out
}

/**
 * 无感续期阈值：access token 剩余有效期低于此值时自动续期
 * - 默认 2 小时（即 24h 过期的 token 在最后 2h 内会被刷新）
 * - 续期后的新 token 通过响应头 X-New-Token 下发，前端拦截器读取并更新
 */
const REFRESH_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 小时

/**
 * 验签：RS256（JWT_PUBLIC_KEY）优先，否则回退 HS256（JWT_SECRET）。
 * - 云端签发身份用 RS256 私钥；桌面/网关用公钥验。公钥可安全分发（只能验签，不能伪造）。
 * - remoteFetch/verify 的 HS255 令牌在本函数之外独立校验，不受影响。
 */
export function verifyToken(token: string): JwtPayload & { jti?: string; exp?: number } {
  if (JWT_PUBLIC_KEY) {
    return jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as JwtPayload & {
      jti?: string
      exp?: number
    }
  }
  return jwt.verify(token, JWT_SECRET) as JwtPayload & { jti?: string; exp?: number }
}

export async function authRequired(req: Request, res: Response, next: NextFunction) {
  // #4 修复：优先从 HttpOnly Cookie 取 token（防 XSS 窃取）
  const cookies = parseCookies(req)
  let token = cookies.aie_token
  // 兼容 fallback：Electron file:// 场景 cookie 跨域可能失效，从 Authorization header 取
  if (!token) {
    const header = req.headers.authorization
    if (header && header.startsWith('Bearer ')) {
      token = header.slice(7)
    }
  }
  // SSE fallback：EventSource 不支持自定义 header，从 query 参数取 token
  if (!token && typeof req.query.token === 'string') {
    token = req.query.token
  }
  if (!token) {
    return fail(res, '未授权：缺少访问令牌', 401)
  }
  try {
    const decoded = verifyToken(token)
    // P2-5 修复：检查 token 黑名单（登出可撤销）
    if (decoded.jti && isTokenRevoked(decoded.jti)) {
      return fail(res, '令牌已撤销，请重新登录', 401)
    }
    // 上架激活：云端身份 → 本地懒同步最小 User 行（云端自身时即校验用户仍在）
    const userExists = await ensureLocalUser(decoded)
    if (!userExists) {
      return fail(res, '用户不存在或已被删除，请重新登录', 401)
    }
    req.user = decoded
    // 把原始 token 写入请求上下文，供 LLM 云端网关等服务层读取
    setRequestToken(token)

    // 无感续期：仅非客户端模式（本地/云端持有可签密钥）才签发新 token。
    // 桌面客户端只有公钥、不能签，在此跳过，绝不用公钥签发 HS256 污染 X-New-Token。
    const canSign = AUTH_MODE !== 'cloud-proxy'
    if (canSign && decoded.exp) {
      const expiresAtMs = decoded.exp * 1000
      const remainingMs = expiresAtMs - Date.now()
      if (remainingMs < REFRESH_THRESHOLD_MS) {
        const newToken = signToken({
          userId: decoded.userId,
          username: decoded.username,
          role: decoded.role,
        })
        // 撤销旧 token（防止旧 token 被继续使用），传入 exp 用于精准清理
        if (decoded.jti) revokeToken(decoded.jti, decoded.exp)
        // 通过响应头下发新 token（前端拦截器读取）
        res.setHeader('X-New-Token', newToken)
        // 同时刷新 HttpOnly Cookie
        setAuthCookie(res, newToken, req)
      }
    }

    next()
  } catch {
    return fail(res, '令牌无效或已过期，请重新登录', 401)
  }
}

export function adminRequired(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return fail(res, '权限不足：需要管理员权限', 403)
  }
  next()
}

export function signToken(payload: JwtPayload): string {
  // P3 修复：用 crypto.randomBytes 生成 jti，替代可预测的 Math.random
  const jti = crypto.randomBytes(16).toString('hex')
  // 云端用私钥以 RS256 签发身份令牌；本地客户端只有公钥，不允许签发，调用即抛错。
  if (JWT_PRIVATE_KEY) {
    return jwt.sign({ ...payload, jti }, JWT_PRIVATE_KEY, {
      algorithm: 'RS256',
      expiresIn: JWT_EXPIRES_IN,
    } as jwt.SignOptions)
  }
  if (JWT_SECRET) {
    return jwt.sign({ ...payload, jti }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    } as jwt.SignOptions)
  }
  throw new Error('无法签发令牌：未配置 JWT_PRIVATE_KEY 或 JWT_SECRET')
}

/**
 * 设置认证 Cookie（#4 修复：HttpOnly 防 XSS，SameSite=Lax 防 CSRF）
 * - secure 仅在 HTTPS 下启用（开发环境 http://localhost 不启用）
 * - P2-5 修复：maxAge 与 JWT_EXPIRES_IN 对齐（默认 24h，原 7d 会导致 cookie 在 token 失效后仍残留）
 */
export function setAuthCookie(res: Response, token: string, req: Request): void {
  const isHttps = req.secure || req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https'
  // 解析 JWT_EXPIRES_IN（支持 "24h"、"7d"、"3600s" 等格式），默认 24 小时
  const maxAgeMs = parseExpiresIn(JWT_EXPIRES_IN)
  // 手写 Set-Cookie（避免新增 cookie-parser 依赖）
  const parts = [
    `aie_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ]
  if (isHttps) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

/**
 * 解析 expiresIn 字符串为毫秒数
 * 支持 "24h"、"7d"、"3600s"、"60m" 等格式；纯数字按秒处理
 */
function parseExpiresIn(expiresIn: string): number {
  const m = /^(\d+)([hmsd])?$/.exec(expiresIn.trim())
  if (!m) return 24 * 60 * 60 * 1000 // 默认 24h
  const n = parseInt(m[1], 10)
  switch (m[2]) {
    case 'h': return n * 60 * 60 * 1000
    case 'm': return n * 60 * 1000
    case 's': return n * 1000
    case 'd': return n * 24 * 60 * 60 * 1000
    default: return n * 1000 // 纯数字按秒
  }
}

/** 清除认证 Cookie */
export function clearAuthCookie(res: Response): void {
  res.setHeader('Set-Cookie', 'aie_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
}
