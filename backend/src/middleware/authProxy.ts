/**
 * 认证反向代理（上架激活方案 · 客户端模式）
 *
 * 桌面本地后端把 `/api/v1/auth/*` 透明转发到云端身份源。
 * - 前端无需改动：仍把登录/注册请求发到本机 127.0.0.1:3001，
 *   本地后端原样透传给云端，云端签发 per-user JWT（RS256 私钥），本端只留公钥验签。
 * - 关键响应头必须原样透传：`X-New-Token`（无感续期下发新 token）与 `Set-Cookie`
 *   （HttpOnly cookie，Web 端主防线），否则前端续期失效。
 *
 * 目标地址由 CLOUD_AUTH_BASE_URL 注入（main.cjs 提供），不在前端写死 IP。
 */
import { Router } from 'express'
import type { Request, Response } from 'express'
import { fail } from '../utils/response.js'

const CLOUD_AUTH_BASE_URL: string | undefined = process.env.CLOUD_AUTH_BASE_URL

export function createAuthProxyRouter(): Router {
  const router = Router()

  router.all('*', async (req: Request, res: Response) => {
    if (!CLOUD_AUTH_BASE_URL) {
      return fail(res, '服务端未配置云端认证地址', 500)
    }

    // req.originalUrl 包含被挂载的 mount path（/auth/...），直接拼上即可
    const target = `${CLOUD_AUTH_BASE_URL}${req.originalUrl}`

    const headers: Record<string, string> = {}
    const contentType = req.headers['content-type']
    if (typeof contentType === 'string') headers['Content-Type'] = contentType
    const authorization = req.headers.authorization
    if (typeof authorization === 'string') headers.Authorization = authorization
    const cookie = req.headers.cookie
    if (typeof cookie === 'string') headers.Cookie = cookie

    let body: string | undefined
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body != null) {
      body = JSON.stringify(req.body)
    }

    try {
      const up = await fetch(target, {
        method: req.method,
        headers,
        body,
      })

      // 透传续期与 cookie 相关响应头
      const xNewToken = up.headers.get('x-new-token')
      if (xNewToken && typeof xNewToken === 'string') {
        res.setHeader('X-New-Token', xNewToken)
      }
      const setCookies = up.headers.getSetCookie ? up.headers.getSetCookie() : []
      if (Array.isArray(setCookies) && setCookies.length > 0) {
        res.setHeader('Set-Cookie', setCookies)
      }
      const ct = up.headers.get('content-type')
      if (ct && typeof ct === 'string') res.setHeader('Content-Type', ct)

      const text = await up.text()
      res.status(up.status)
      res.send(text)
    } catch {
      return fail(res, '云端认证服务暂不可用，请稍后再试', 502)
    }
  })

  return router
}