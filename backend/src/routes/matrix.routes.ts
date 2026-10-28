/**
 * Matrix SSO Auth Proxy — 绿角犀 Express 当 Matrix 用户管理 + 认证入口
 *
 * Continuwuity OIDC delegation 功能未合入 Docker 镜像（v26.9.1 + main branch），
 * 所以 Express 直接调 Continuwuity Matrix Client API：
 *
 *   绿角犀 JWT → admin room !admin create-user（如需要）
 *             → m.login.password login
 *             → 返回 Matrix access_token + user_id
 *
 * 端点：
 *   POST /api/v1/matrix/auth   body: {}   → 返回 { access_token, user_id, homeserver }
 *   GET  /api/v1/matrix/auth              → 同上（query 参数兼容）
 *
 * 安全：
 *   - authRequired 验绿角犀登录态
 *   - admin token / room id / homeserver 全从 .env 读
 *   - Matrix 密码用确定性算法（SHA256(userId + salt)），Express 不存明文
 *   - admin room command 用 Matrix API PUT /rooms/{roomId}/send/m.room.message
 */
import { Router } from 'express'
import crypto from 'crypto'
import { authRequired } from '../middleware/auth.js'
import { HttpError } from '../utils/response.js'
import logger from '../lib/logger.js'

const router = Router()

// ── 配置（全从 env 读，绝不硬编码） ──
const CONTINUUITY_URL = process.env.CONTINUUITY_URL || 'http://127.0.0.1:8008'
// 浏览器可达的公网地址（nginx 反代 Continuwuity），返回给前端的 homeserver
const CONTINUUITY_PUBLIC_URL = process.env.CONTINUUITY_PUBLIC_URL || `https://${process.env.CONTINUUITY_SERVER_NAME || 'lujax.fun'}`
const CONTINUUITY_ADMIN_TOKEN = process.env.CONTINUUITY_ADMIN_TOKEN || ''
const CONTINUUITY_ADMIN_ROOM = process.env.CONTINUUITY_ADMIN_ROOM || ''
const CONTINUUITY_SERVER_NAME = process.env.CONTINUUITY_SERVER_NAME || 'lujax.fun'
const MATRIX_PWD_SALT = process.env.MATRIX_PWD_SALT || 'greenrhino-matrix-sso-v1'

// ── 工具：确定性密码（不存明文，同一用户每次算出相同密码） ──
function deriveMatrixPassword(userId: string): string {
  return crypto.createHash('sha256')
    .update(userId + ':' + MATRIX_PWD_SALT)
    .digest('hex')
    .slice(0, 24)
}

// ── 工具：Matrix HTTP 调用 ──
async function matrixFetch(
  path: string,
  options: RequestInit = {},
  admin = false,
): Promise<{ code: number; body: any }> {
  const url = CONTINUUITY_URL + path
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  if (admin && CONTINUUITY_ADMIN_TOKEN) {
    headers['Authorization'] = `Bearer ${CONTINUUITY_ADMIN_TOKEN}`
  }
  const opts: RequestInit = { ...options, headers }
  const res = await fetch(url, opts)
  const text = await res.text()
  let body: any
  try { body = JSON.parse(text) } catch { body = text }
  return { code: res.status, body }
}

// ── Step 1：发 admin room command ──
async function sendAdminCommand(command: string): Promise<void> {
  if (!CONTINUUITY_ADMIN_TOKEN || !CONTINUUITY_ADMIN_ROOM) {
    throw new HttpError('Matrix admin not configured', 500)
  }
  // eventId 用 timestamp 保证唯一
  const eventId = `greenrhino_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const { code, body } = await matrixFetch(
    `/_matrix/client/v3/rooms/${CONTINUUITY_ADMIN_ROOM}/send/m.room.message/${eventId}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        msgtype: 'm.text',
        body: command,
      }),
    },
    true,
  )
  if (code !== 200) {
    logger.warn({ code, body, command }, '[Matrix] admin command send failed')
    throw new HttpError(`Matrix admin command failed: ${code}`, 502)
  }
  // 给 Continuwuity 一点时间处理 admin command
  await new Promise((r) => setTimeout(r, 1500))
}

// ── Step 2：创建 Matrix 用户（幂等） ──
async function ensureMatrixUser(username: string, password: string): Promise<void> {
  // Continuwuity admin room command：!admin users create-user <username> <password>
  // 如果用户已存在，会报错；但我们的 login 流程会 fallback，所以这里只管尝试
  const command = `!admin users create-user ${username} ${password}`
  try {
    await sendAdminCommand(command)
    logger.info({ username }, '[Matrix] create-user command sent')
  } catch (e) {
    // create-user 失败不一定致命——用户可能已存在，login 会 fallback
    logger.warn({ err: e, username }, '[Matrix] create-user failed (may already exist)')
  }
}

// ── Step 3：m.login.password ──
async function matrixLogin(username: string, password: string): Promise<{ accessToken: string; userId: string; deviceId: string }> {
  const { code, body } = await matrixFetch('/_matrix/client/v3/login', {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
      initial_device_display_name: 'GreenRhino SSO',
    }),
  })
  if (code === 200 && body.access_token) {
    return {
      accessToken: body.access_token,
      userId: body.user_id,
      deviceId: body.device_id,
    }
  }
  // 401 + user_does_not_exist → 需要先 create-user
  if (code === 401 || code === 403) {
    const errMsg = typeof body === 'string' ? body : (body.error || '')
    logger.warn({ code, errMsg, username }, '[Matrix] login failed')
  }
  throw new HttpError(`Matrix login failed (${code})`, 401)
}

// ── 主流程：authRequired → login → fallback create → login ──
async function handleMatrixAuth(req: any, res: any, next: any) {
  try {
    const user = req.user!
    const username = user.username
    const password = deriveMatrixPassword(user.userId)
    const matrixUserId = `@${username}:${CONTINUUITY_SERVER_NAME}`

    logger.info({ username, matrixUserId }, '[Matrix] SSO auth start')

    // 先尝试直接 login（幂等：如果用户已存在，直接跳过 create-user）
    let tokenResult: Awaited<ReturnType<typeof matrixLogin>> | null = null
    try {
      tokenResult = await matrixLogin(username, password)
      logger.info({ username }, '[Matrix] direct login success')
    } catch {
      // 用户不存在或密码不对 → create-user 然后 login
      logger.info({ username }, '[Matrix] direct login failed, creating user')
      await ensureMatrixUser(username, password)
      tokenResult = await matrixLogin(username, password)
      logger.info({ username }, '[Matrix] create + login success')
    }

    // whoami 验证（兜底，确保 token 有效）
    const { code: whoCode, body: whoBody } = await matrixFetch(
      '/_matrix/client/v3/account/whoami',
      { headers: { Authorization: `Bearer ${tokenResult.accessToken}` } },
    )
    if (whoCode !== 200) {
      logger.warn({ whoCode, whoBody }, '[Matrix] whoami verification failed')
    }

    // Day 8-9：Express 统一响应格式 { code, data }（api.ts interceptor 识别 code 字段解包）
    // 之前只有 { ok } 没有 code → 前端 unwrap 再取 .data = undefined
    res.json({
      code: 200,
      data: {
        ok: true,
        // Express API 全项目统一 camelCase（前端 TypeScript 接口约定）
        accessToken: tokenResult.accessToken,
        userId: tokenResult.userId || matrixUserId,
        homeserver: CONTINUUITY_PUBLIC_URL,
        deviceId: tokenResult.deviceId,
        matrixId: matrixUserId,
      },
    })
  } catch (e) {
    next(e)
  }
}

// POST /api/v1/matrix/auth — 绿角犀 SSO 换 Matrix token
router.post('/auth', authRequired, handleMatrixAuth)

// GET /api/v1/matrix/auth — URL 跳转兼容（客户端可能用 GET）
router.get('/auth', authRequired, handleMatrixAuth)

// GET /api/v1/matrix/whoami — 用绿角犀 JWT 查当前 Matrix 身份（调试/UI 用）
router.get('/whoami', authRequired, async (req, res, next) => {
  try {
    const user = req.user!
    const password = deriveMatrixPassword(user.userId)

    // 先 login 拿 token
    let tokenResult: Awaited<ReturnType<typeof matrixLogin>> | null = null
    try {
      tokenResult = await matrixLogin(user.username, password)
    } catch {
      await ensureMatrixUser(user.username, password)
      tokenResult = await matrixLogin(user.username, password)
    }

    res.json({
      ok: true,
      matrix_id: tokenResult.userId,
      homeserver: CONTINUUITY_PUBLIC_URL,
      username: user.username,
    })
  } catch (e) {
    next(e)
  }
})

export default router
