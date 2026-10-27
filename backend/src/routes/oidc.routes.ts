/**
 * OIDC OAuth2 Provider — 绿角犀 Express 当身份提供者
 *
 * Continuwuity delegated OIDC 认证 → Continuwuity 用户登录跳绿角犀授权页 → 授权通过自动拿 Matrix 账号。
 *
 * 5 端点（OIDC Discovery 声明的全覆盖）：
 *   GET  /api/oidc/.well-known/openid-configuration  — Discovery
 *   GET  /api/oidc/auth                              — 授权端点（绿角犀登录检查 → 发 auth code）
 *   POST /api/oidc/token                             — Token 端点（code → id_token，client_secret 常量时间校验）
 *   GET  /api/oidc/userinfo                          — 用户信息（Matrix 客户端查 sub/preferred_username）
 *   GET  /api/oidc/jwks                              — RSA 公钥 JWK Set（Continuwuity 验 id_token 签名）
 *
 * 安全设计：
 *   - auth code 存内存 Map（oauthCodes），5 分钟过期，一次性使用
 *   - state 参数原样回传（防 CSRF）
 *   - client_secret 常量时间比较（防时序攻击）
 *   - RSA RS256 签名，密钥文件放 backend/keys/，chmod 600
 */
import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'
import { HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import logger from '../lib/logger.js'

const router = Router()

// ── 配置常量 ──
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID || 'continuwuity'
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '334etYKd_mB9JPsBF1wsNNpw3o5UzrKMJjuRvaQOfdA'
// Continuwuity 要求 issuer 必须等于 discovery_url 基础路径
// discovery_url = "https://lujax.fun/api/oidc" → 自动追加 /.well-known/openid-configuration
// 所以 issuer 必须也是 "https://lujax.fun/api/oidc"
const OIDC_ISSUER = process.env.OIDC_ISSUER || 'https://lujax.fun/api/oidc'
const OIDC_KEYS_DIR = process.env.OIDC_KEYS_DIR || path.join(process.cwd(), 'keys')

// ── RSA 密钥运行时加载 ──
let privateKey: string
let publicKey: string
try {
  privateKey = fs.readFileSync(path.join(OIDC_KEYS_DIR, 'oidc-private.pem'), 'utf8')
  publicKey = fs.readFileSync(path.join(OIDC_KEYS_DIR, 'oidc-public.pem'), 'utf8')
  logger.info('[OIDC] RSA 密钥加载成功')
} catch (e) {
  logger.error({ err: e }, '[OIDC] RSA 密钥加载失败，OIDC 端点不可用')
  privateKey = ''
  publicKey = ''
}

// ── auth code 内存存储（单实例 Map，跟 smsStore 同模式） ──
interface OauthCodeEntry {
  userId: string
  username: string
  redirect_uri: string
  expires: number
  client_id: string
}
const oauthCodes = new Map<string, OauthCodeEntry>()

/** 清理过期 auth code（每分钟跑一次） */
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of oauthCodes) {
    if (v.expires < now) oauthCodes.delete(k)
  }
}, 60_000)

/** 常量时间字符串比较（防时序攻击） */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/** RSA 公钥 JWK — 在云端 openssl rsa -RSAPublicKey_out -outform DER | asn1parse 后算好
 * 密钥轮换时用 `python3` 脚本重新算并替换 n/e 值 */
const JWK_N = '4M2Vk0Rf36t78gO8hIEr6PeBT5XRhu2gZWeBqIZ0xhA_qb1ntgKbB3TsAuGBz3K0lrszyAglubImfMU3blseKvxNF6MR6ZxPDB5yN3ftPcAdX7WXrEYU0wO41rxJ6w2E8Uf1an5HVvs-njQzMY2_xyV1cNBetMO1kibiDF6Y3nL4uhTG8ixCGIZlQ43o6feApPEf5_oMpJh5WscT6REZYP8aickrOk-cQ48yHLcq3QSsNCovK9tsymmdY-6cVZMK5zGLDJJAnrl1Uol50l58wHYXNzD5seT_OkqPtJOjz8E44ecFqwm2ct1peRzAtbWWjaX4vhG7a4NdFAsYCqJZBQ'
const JWK_E = 'AQAB'

// ── 1. Discovery ──
router.get('/.well-known/openid-configuration', (_req, res) => {
  if (!privateKey) {
    return res.status(503).json({ error: 'OIDC keys not loaded' })
  }
  // issuer 已经是 https://lujax.fun/api/oidc（Continuwuity 要求），base 直接用它
  const base = OIDC_ISSUER
  res.json({
    issuer: OIDC_ISSUER,
    authorization_endpoint: `${base}/auth`,
    token_endpoint: `${base}/token`,
    userinfo_endpoint: `${base}/userinfo`,
    jwks_uri: `${base}/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    scope_supported: ['openid', 'profile', 'email'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  })
})

// ── 2. Auth（用 authRequired 查绿角犀登录态 → 发 auth code） ──
router.get('/auth', authRequired, async (req, res, next) => {
  try {
    const { response_type, client_id, redirect_uri, scope, state } = req.query

    if (!redirect_uri || typeof redirect_uri !== 'string') {
      throw new HttpError('redirect_uri required', 400)
    }
    if (!client_id || client_id !== OIDC_CLIENT_ID) {
      throw new HttpError('unknown client_id', 400)
    }
    if (response_type !== 'code') {
      throw new HttpError('unsupported response_type', 400)
    }

    // authRequired 已验过绿角犀登录态，req.user.userId 可用
    const userId = req.user!.userId
    const username = req.user!.username

    // 查 Prisma user 确认用户真实存在
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, nickname: true, avatar: true },
    })
    if (!user) {
      throw new HttpError('user not found', 404)
    }

    // 生成一次性 auth code
    const code = crypto.randomBytes(32).toString('hex')
    oauthCodes.set(code, {
      userId: user.id,
      username: user.username,
      redirect_uri,
      client_id,
      expires: Date.now() + 5 * 60 * 1000,
    })

    logger.info({ code: code.slice(0, 8) + '...', userId: user.id, username: user.username }, '[OIDC] auth code issued')

    // 跳回 Continuwuity 带 code + state（state 原样回传防 CSRF）
    const sep = redirect_uri.includes('?') ? '&' : '?'
    const params = new URLSearchParams({ code })
    if (state) params.set('state', String(state))
    res.redirect(`${redirect_uri}${sep}${params.toString()}`)
  } catch (e) {
    next(e)
  }
})

// ── 3. Token（code → id_token + access_token） ──
router.post('/token', async (req, res, next) => {
  try {
    if (!privateKey) {
      return res.status(503).json({ error: 'OIDC keys not loaded' })
    }

    const body = req.body as Record<string, string>
    const grant_type = body.grant_type
    const code = body.code
    const redirect_uri = body.redirect_uri
    const client_id = body.client_id || req.headers['x-client-id']
    const client_secret = body.client_secret || req.headers['x-client-secret']

    // client_secret_basic（Authorization: Basic base64(client_id:client_secret)）
    let cid = client_id
    let csec = client_secret
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8')
        const [id, sec] = decoded.split(':')
        cid = id || cid
        csec = sec || csec
      } catch { /* ignore */ }
    }

    if (grant_type !== 'authorization_code') {
      return res.status(400).json({ error: 'unsupported_grant_type' })
    }
    if (!code) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'code required' })
    }

    // 常量时间比较 client_id + client_secret
    const cidStr = typeof cid === 'string' ? cid : ''
    const csecStr = typeof csec === 'string' ? csec : ''
    if (!cidStr || !safeCompare(cidStr, OIDC_CLIENT_ID)) {
      return res.status(401).json({ error: 'invalid_client' })
    }
    if (!csecStr || !safeCompare(csecStr, OIDC_CLIENT_SECRET)) {
      return res.status(401).json({ error: 'invalid_client' })
    }

    const codeEntry = oauthCodes.get(code)
    if (!codeEntry) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'code not found' })
    }
    if (codeEntry.expires < Date.now()) {
      oauthCodes.delete(code)
      return res.status(400).json({ error: 'invalid_grant', error_description: 'code expired' })
    }
    // redirect_uri 必须跟 /auth 时传的一致
    if (redirect_uri && redirect_uri !== codeEntry.redirect_uri) {
      oauthCodes.delete(code)
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' })
    }

    // 一次性使用
    oauthCodes.delete(code)

    // 查 Prisma user（可能 auth code 发出后用户被删）
    const user = await prisma.user.findUnique({
      where: { id: codeEntry.userId },
      select: { id: true, username: true, nickname: true, avatar: true, email: true, phone: true },
    })
    if (!user) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'user deleted' })
    }

    // 签 id_token（RS256）
    const now = Math.floor(Date.now() / 1000)
    const idToken = jwt.sign({
      iss: OIDC_ISSUER,
      sub: String(user.username),
      aud: cid,
      exp: now + 3600,
      iat: now,
      auth_time: now,
      preferred_username: user.username,
      nickname: user.nickname,
      avatar: user.avatar || undefined,
      email: user.email || undefined,
    }, privateKey, { algorithm: 'RS256', keyid: 'rsa-oidc-2026', expiresIn: '1h' })

    // access_token（简短，给 userinfo 用）
    const accessToken = jwt.sign({
      iss: OIDC_ISSUER,
      sub: String(user.username),
      aud: cid,
      scope: 'openid profile email',
    }, privateKey, { algorithm: 'RS256', keyid: 'rsa-oidc-2026', expiresIn: '1h' })

    logger.info({ username: user.username }, '[OIDC] token issued')

    res.json({
      id_token: idToken,
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
    })
  } catch (e) {
    next(e)
  }
})

// ── 4. Userinfo（access_token 验签 → 返回用户信息） ──
router.get('/userinfo', (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing_token' })
    }
    if (!publicKey) {
      return res.status(503).json({ error: 'OIDC keys not loaded' })
    }

    let payload: Record<string, unknown>
    try {
      payload = jwt.verify(authHeader.slice(7), publicKey, {
        algorithms: ['RS256'],
        issuer: OIDC_ISSUER,
      }) as Record<string, unknown>
    } catch {
      return res.status(401).json({ error: 'invalid_token' })
    }

    // payload 里已经带了 sub/preferred_username/nickname/avatar/email
    res.json({
      sub: payload.sub,
      preferred_username: payload.preferred_username,
      nickname: payload.nickname,
      avatar: payload.avatar,
      email: payload.email,
    })
  } catch (e) {
    next(e)
  }
})

// ── 5. JWKS（Continuwuity 验 id_token 签名必须这个） ──
router.get('/jwks', (_req, res) => {
  res.json({
    keys: [{
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
      kid: 'rsa-oidc-2026',
      n: JWK_N,
      e: JWK_E,
    }],
  })
})

export default router
