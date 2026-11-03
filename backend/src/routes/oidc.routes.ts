/**
 * OIDC OAuth2 Provider — 绿角犀 Express 当身份提供者
 *
 * Continuwuity delegated OIDC 认证 → Continuwuity 用户登录跳绿角犀授权页 → 授权通过自动拿 Matrix 账号。
 *
 * 5 端点（OIDC Discovery 声明的全覆盖）：
 *   GET  /api/oidc/.well-known/openid-configuration  — Discovery
 *   GET  /api/oidc/auth                              — 授权端点（可选认证：有 cookie 直发 code，无 cookie 出登录表单）
 *   POST /api/oidc/auth                              — 登录表单提交（验密码 → 发 code）
 *   POST /api/oidc/token                             — Token 端点（code + PKCE verifier → id_token）
 *   GET  /api/oidc/userinfo                          — 用户信息
 *   GET  /api/oidc/jwks                              — RSA 公钥 JWK Set
 *
 * PKCE：Continuwuity 强制发 code_challenge(S256) → /token 端点必须验 code_verifier
 */
import express, { Router } from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { HttpError } from '../utils/response.js'
import { verifyToken } from '../middleware/auth.js'
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
  code_challenge?: string   // PKCE
  code_challenge_method?: string  // PKCE (S256 / plain)
  nonce?: string   // OIDC nonce — Continuwuity 强制要求在 id_token 里回显
}
const oauthCodes = new Map<string, OauthCodeEntry>()

/** 清理过期 auth code（每分钟跑一次） */
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of oauthCodes) {
    if (v.expires < now) oauthCodes.delete(k)
  }
}, 60_000)

/** 从 cookie/header 尝试提取绿角犀登录态（不强制，失败返回 null） */
function extractAuth(req: any): { userId: string; username: string } | null {
  const cookies: Record<string, string> = {}
  const hdr = req.headers?.cookie
  if (hdr) {
    for (const pair of hdr.split(';')) {
      const idx = pair.indexOf('=')
      if (idx > 0) cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
    }
  }
  let token = cookies.aie_token
  if (!token && req.headers?.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7)
  }
  if (!token) return null
  try {
    const decoded = verifyToken(token)
    return { userId: decoded.userId, username: decoded.username }
  } catch {
    return null
  }
}

/** PKCE S256 验证：SHA256(code_verifier) → base64url → 比 code_challenge */
function verifyPkce(code: string, verifier: string, method: string): boolean {
  if (method === 'S256') {
    const hash = crypto.createHash('sha256').update(verifier).digest()
    const expected = hash.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return safeCompare(code, expected)
  }
  if (method === 'plain') {
    return safeCompare(code, verifier)
  }
  return false // 不认识的 method 一律拒绝
}

/** 生成一次性 auth code + 存储（含 PKCE + nonce） */
function issueAuthCode(
  userId: string, username: string,
  redirect_uri: string, client_id: string,
  code_challenge?: string, code_challenge_method?: string,
  nonce?: string,
): { code: string } {
  const code = crypto.randomBytes(32).toString('hex')
  oauthCodes.set(code, {
    userId, username, redirect_uri, client_id,
    code_challenge, code_challenge_method, nonce,
    expires: Date.now() + 5 * 60 * 1000,
  })
  logger.info({ code: code.slice(0, 8) + '...', userId, username }, '[OIDC] auth code issued')
  return { code }
}

/** 拼 redirect_uri + code + state */
function buildRedirect(redirect_uri: string, code: string, state?: string): string {
  const sep = redirect_uri.includes('?') ? '&' : '?'
  const params = new URLSearchParams({ code })
  if (state) params.set('state', state)
  return `${redirect_uri}${sep}${params.toString()}`
}

/** 登录表单 HTML（未认证时显示） */
function loginFormHtml(params: Record<string, string>, error?: string): string {
  const hidden = Object.entries(params).map(([k, v]) =>
    `<input type="hidden" name="${k}" value="${v}">`
  ).join('\n')
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>绿角犀 · 登录</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.card{background:#fff;padding:32px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:340px}.card h1{font-size:18px;margin:0 0 8px;color:#059669}.card p{color:#666;font-size:14px;margin:0 0 24px}input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;margin-bottom:12px;box-sizing:box-size;font-size:14px}button{width:100%;padding:10px;background:#059669;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer}.err{color:#dc2626;font-size:13px;margin-bottom:12px}label{font-size:13px;color:#555;display:block;margin-bottom:4px}</style></head>
<body><div class="card">
<h1>🔐 绿角犀登录</h1>
<p>用绿角犀账号继续 Matrix 登录</p>
${error ? `<div class="err">${error}</div>` : ''}
<form method="post">
${hidden}
<label>用户名</label><input type="text" name="username" required autofocus>
<label>密码</label><input type="password" name="password" required>
<button type="submit">登录</button>
</form></div></body></html>`
}

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

// ── 2a. GET /auth（可选认证） ──
// 有 cookie/header JWT → 直接发 code + PKCE + 跳回 Continuwuity
// 无认证 → 返回登录表单 HTML（把 OIDC params 存 hidden input）
router.get('/auth', async (req, res, next) => {
  try {
    const { response_type, client_id, redirect_uri, scope, state, nonce,
      code_challenge, code_challenge_method } = req.query

    // 参数校验
    if (!redirect_uri || typeof redirect_uri !== 'string') {
      throw new HttpError('redirect_uri required', 400)
    }
    if (!client_id || client_id !== OIDC_CLIENT_ID) {
      throw new HttpError('unknown client_id', 400)
    }
    if (response_type !== 'code') {
      throw new HttpError('unsupported response_type', 400)
    }
    if (code_challenge_method && code_challenge_method !== 'S256' && code_challenge_method !== 'plain') {
      throw new HttpError('unsupported code_challenge_method', 400)
    }

    // 尝试从 cookie/header 拿绿角犀登录态
    const auth = extractAuth(req)
    if (auth) {
      // 已登录 → 查 Prisma user 确认存在
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, username: true },
      })
      if (!user) {
        throw new HttpError('user not found', 404)
      }
      const { code } = issueAuthCode(
        user.id, user.username, redirect_uri, client_id,
        typeof code_challenge === 'string' ? code_challenge : undefined,
        typeof code_challenge_method === 'string' ? code_challenge_method : undefined,
        typeof nonce === 'string' ? nonce : undefined,
      )
      return res.redirect(buildRedirect(redirect_uri, code, typeof state === 'string' ? state : undefined))
    }

    // 未登录 → 返回登录表单
    const formParams: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === 'string' && v.length > 0) formParams[k] = v
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(200).send(loginFormHtml(formParams))
  } catch (e) {
    next(e)
  }
})

// ── 2b. POST /auth（登录表单提交 → bcrypt 验密码 → 发 code） ──
router.post('/auth', express.urlencoded({ extended: false }), async (req, res, next) => {
  try {
    const body = req.body as Record<string, string> || {}
    const { username, password, response_type, client_id, redirect_uri, scope, state, nonce,
      code_challenge, code_challenge_method } = body

    const formParams: Record<string, string> = {}
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'string' && v.length > 0 && k !== 'username' && k !== 'password') {
        formParams[k] = v
      }
    }

    // 参数校验
    if (!redirect_uri) { res.status(400).send('redirect_uri required'); return }
    if (!client_id || client_id !== OIDC_CLIENT_ID) { res.status(400).send('unknown client_id'); return }
    if (!username || !password) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.status(200).send(loginFormHtml(formParams, '请填写用户名和密码'))
    }

    // 查用户 + 验密码
    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, password: true, role: true },
    })
    if (!user) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.status(200).send(loginFormHtml(formParams, '用户名或密码错误'))
    }
    const ok = await bcrypt.compare(password, user.password)
    if (!ok) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.status(200).send(loginFormHtml(formParams, '用户名或密码错误'))
    }

    const { code } = issueAuthCode(
      user.id, user.username, redirect_uri, client_id,
      code_challenge, code_challenge_method, nonce,
    )
    res.redirect(buildRedirect(redirect_uri, code, state))
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

    // PKCE 验证（如果 /auth 时 Continuwuity 传了 code_challenge）
    if (codeEntry.code_challenge && codeEntry.code_challenge_method) {
      const code_verifier = typeof body.code_verifier === 'string' ? body.code_verifier : ''
      if (!code_verifier) {
        oauthCodes.delete(code)
        return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier required' })
      }
      if (!verifyPkce(codeEntry.code_challenge, code_verifier, codeEntry.code_challenge_method)) {
        oauthCodes.delete(code)
        return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' })
      }
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

    // 签 id_token（RS256）— 必须带 nonce（Continuwuity 强制要求）
    const now = Math.floor(Date.now() / 1000)
    const idToken = jwt.sign({
      iss: OIDC_ISSUER,
      sub: String(user.username),
      aud: cid,
      iat: now,
      auth_time: now,
      nonce: codeEntry.nonce || undefined,
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

// ── 4. Userinfo（access_token 验签 → 查 Prisma User → 返回完整 OIDC Claims） ──
router.get('/userinfo', async (req, res, next) => {
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

    // payload.sub = username（id_token 和 access_token 签的都是 String(user.username)）
    const username = typeof payload.sub === 'string' ? payload.sub : ''

    // 查 Prisma User 拿完整字段（fail-open：查不到就只返回 sub）
    if (username) {
      try {
        const user = await prisma.user.findUnique({
          where: { username },
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
            email: true,
            phone: true,
          },
        })
        if (user) {
          return res.json({
            sub: user.username,
            preferred_username: user.username,
            nickname: user.nickname ?? undefined,
            avatar: user.avatar ?? undefined,
            email: user.email ?? undefined,
            email_verified: !!user.email,
            phone_number: user.phone ?? undefined,
            phone_number_verified: false,
          })
        }
      } catch (dbErr) {
        // DB 查询失败不阻塞，退回 payload 兜底
        logger.warn({ err: dbErr, username }, '[OIDC] userinfo Prisma 查询失败，退回 payload 兜底')
      }
    }

    // Fail-open：只用 access_token payload 里有的字段
    res.json({
      sub: payload.sub,
      preferred_username: payload.sub,
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
