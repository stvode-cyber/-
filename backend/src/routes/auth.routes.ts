// TODO: [auth路由泄漏] 预防：废弃前端注册入口时，后端 /register 路由必须加 @deprecated 注释 + 限流保护；唯一暴露入口是 /phone-register（手机+验证码）
// TODO: [短信mock降级] 预防：阿里云 SMS 参数缺失或调用失败时必须自动返回验证码不阻塞注册；真实 SMS 响应严禁包含 code 字段
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired, signToken, setAuthCookie, clearAuthCookie, revokeToken } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { getLevelInfo } from '../utils/level.js'

const router = Router()

// 登录/注册接口频率限制：每 IP 每分钟 10 次，防暴破
const authRateLimit = rateLimit({ limit: 10, windowMs: 60_000 })

// TODO: [phone 字段漏写] 预防：旧 /register 路由不写 phone，如果用户拿手机号当 username 注册，phone 字段会 null；现在加防御性同步——当 username 匹配手机号格式时 phone 自动填充
const PHONE_RE = /^1[3-9]\d{9}$/

// 短信验证码频率限制：每 IP 每分钟 5 次，防刷
const smsRateLimit = rateLimit({ limit: 5, windowMs: 60_000 })

// ── 短信验证码内存存储（单实例 Map，多实例需 Redis） ──
interface SmsRecord { code: string; expires: number; attempts: number }
const smsStore = new Map<string, SmsRecord>()

/** 生成 6 位数字验证码 */
function genSmsCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/** 清理过期验证码 */
function cleanupSmsStore() {
  const now = Date.now()
  for (const [k, v] of smsStore) {
    if (v.expires < now) smsStore.delete(k)
  }
}

/**
 * 手机号注册时的占位密码标记（非 bcrypt 哈希）
 * - bcrypt.compare 对非 $2 开头的字符串永远返回 false
 * - /auth/me 返回 hasPassword: false 时，前端引导用户在安全中心设置密码
 */
const PHONE_ONLY_MARKER = '!phone-only!'

const registerSchema = z.object({
  username: z.string().min(3).max(20),
  // P1-6 修复：密码至少 8 位且需包含字母+数字（提升字典攻击难度）
  password: z.string()
    .min(8, '密码至少 8 位')
    .max(32)
    .regex(/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/, '密码需包含字母和数字'),
  // 昵称由后端自动生成（基于用户编号），不再接受前端传入，避免硬编码脏数据
  avatar: z.string().max(2 * 1024 * 1024, '头像图片过大（最大 2MB）').optional(),
  // 合规：必须勾选同意用户协议与隐私政策
  agreeTerms: z.boolean().refine(v => v === true, { message: '请先阅读并同意用户协议与隐私政策' }),
})

// 手机号格式校验：1[3-9]xxxxxxxxx
const phoneSchema = z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确')

/**
 * 用户注册
 * - 校验用户名唯一性
 * - 密码 bcrypt 加盐哈希
 * - 自动创建空钱包
 * - 写入台账：register
 */
router.post('/register', authRateLimit, async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    }
    const { username, password, avatar } = parsed.data

    const exists = await prisma.user.findUnique({ where: { username } })
    if (exists) throw new HttpError('用户名已存在', 409)

    // 首次部署引导：若数据库无任何用户，首位注册者自动成为管理员
    // - 避免分发版 dev.db 预置默认账号/密码的泄露风险
    // - 首位注册者即系统所有者，后续注册均为普通 user
    const userCount = await prisma.user.count()
    const isFirstUser = userCount === 0
    const role = isFirstUser ? 'admin' : 'user'

    // 自动生成基于编号的昵称：第 1 位注册者 → "用户1"，第 N 位 → "用户N+1"
    // 用户可在个人设置中自行修改。该编号反映注册次序（与 user.id 区分开，便于显示）
    const nickname = `用户${userCount + 1}`

    const hashed = await bcrypt.hash(password, 10)
    // 防御性：若 username 看起来是手机号，同步写 phone 字段（避免旧 /register 路由漏写 phone 历史坑重现）
    const phoneFromUsername = PHONE_RE.test(username) ? username : null
    const user = await prisma.user.create({
      data: {
        username,
        password: hashed,
        nickname,
        avatar: avatar || null,
        role,
        phone: phoneFromUsername,
        onboarded: isFirstUser, // 首位管理员跳过冷启动问卷
        agreedToTermsAt: new Date(), // 合规：记录接受协议时间
        wallet: { create: { balance: isFirstUser ? 10000 : 0 } },
      },
      select: { id: true, username: true, nickname: true, avatar: true, role: true, phone: true },
    })

    const token = signToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    })

    // #4 修复：同时下发 HttpOnly Cookie（Web 端主防线）
    setAuthCookie(res, token, req)

    // 台账：注册（关键审计，await 确保落库）
    await auditReqAsync(req, res, {
      userId: user.id,
      username: user.username,
      category: 'auth',
      action: 'register',
      targetType: 'User',
      targetId: user.id,
      summary: isFirstUser
        ? `首次部署：首位用户 ${user.username} 自动成为管理员`
        : `新用户注册: ${user.username}`,
      detail: { username, nickname, role: user.role, firstUserBootstrap: isFirstUser },
    })

    return success(res, { token, user }, '注册成功')
  } catch (e: any) {
    // 捕获并发注册同一用户名的 Prisma P2002 唯一约束冲突
    if (e?.code === 'P2002') {
      return next(new HttpError('用户名已存在', 409))
    }
    next(e)
  }
})

/**
 * 发送短信验证码
 * - 校验手机号格式（1[3-9]xxxxxxxxx）
 * - 6 位数字验证码，5 分钟有效，最多验证 5 次
 * - 60 秒内同一手机号不可重复发送
 * - 当前为本地优先版本，无真实短信网关，验证码通过响应返回（开发模式）+ 控制台日志
 * - 接入真实短信网关时，移除响应中的 code 字段，改为调用 SMS API
 */
const sendSmsSchema = z.object({
  phone: phoneSchema,
})

router.post('/send-sms', smsRateLimit, async (req, res, next) => {
  try {
    const parsed = sendSmsSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message || '手机号格式不正确', 422)
    }
    const { phone } = parsed.data

    cleanupSmsStore()

    // 60 秒内同一手机号不可重复发送
    const existing = smsStore.get(phone)
    if (existing && existing.expires - Date.now() > 4 * 60 * 1000) {
      // 还剩超过 4 分钟说明发送不到 1 分钟
      throw new HttpError('验证码已发送，请 60 秒后重试', 429)
    }

    const code = genSmsCode()
    smsStore.set(phone, { code, expires: Date.now() + 5 * 60 * 1000, attempts: 0 })

    // 控制台日志（生产环境也应保留，便于排查）
    console.log(`[SMS] 验证码发送: ${phone} → ${code}`)

    return success(res, {
      // 本地优先版本：直接返回验证码，前端展示给用户
      // 接入真实短信网关后删除 code 字段
      code,
      expiresIn: 300,
    }, '验证码已发送')
  } catch (e) {
    next(e)
  }
})

/**
 * 手机号注册（短信验证码 + 自动绑定手机，不设密码）
 * - 校验手机号 + 验证码
 * - username 使用手机号，phone 字段同步写入
 * - password 设为占位标记（非 bcrypt 哈希），用户后续在安全中心设置密码
 * - 首位注册者自动成为管理员
 */
const phoneRegisterSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6, '验证码为 6 位数字'),
  // 合规：必须勾选同意用户协议与隐私政策
  agreeTerms: z.boolean().refine(v => v === true, { message: '请先阅读并同意用户协议与隐私政策' }),
})

router.post('/phone-register', authRateLimit, async (req, res, next) => {
  try {
    const parsed = phoneRegisterSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    }
    const { phone, code } = parsed.data

    // 校验验证码
    const record = smsStore.get(phone)
    if (!record) {
      throw new HttpError('验证码已过期或未发送，请重新获取', 400)
    }
    if (record.expires < Date.now()) {
      smsStore.delete(phone)
      throw new HttpError('验证码已过期，请重新获取', 400)
    }
    record.attempts++
    if (record.attempts > 5) {
      smsStore.delete(phone)
      throw new HttpError('验证码错误次数过多，请重新获取', 429)
    }
    if (record.code !== code) {
      throw new HttpError(`验证码错误，还剩 ${5 - record.attempts} 次机会`, 400)
    }
    // 验证通过，删除验证码记录
    smsStore.delete(phone)

    // 检查手机号是否已注册
    const exists = await prisma.user.findUnique({ where: { username: phone } })
    if (exists) throw new HttpError('该手机号已注册，请直接登录', 409)

    const userCount = await prisma.user.count()
    const isFirstUser = userCount === 0
    const role = isFirstUser ? 'admin' : 'user'
    const nickname = `用户${userCount + 1}`

    // 占位密码：非 bcrypt 哈希，bcrypt.compare 永远返回 false
    // 用户在安全中心设置密码后，此值被替换为真正的 bcrypt 哈希
    const placeholderPassword = PHONE_ONLY_MARKER + crypto.randomBytes(16).toString('hex')

    const user = await prisma.user.create({
      data: {
        username: phone,
        password: placeholderPassword,
        nickname,
        phone,
        role,
        onboarded: isFirstUser,
        agreedToTermsAt: new Date(), // 合规：记录接受协议时间
        wallet: { create: { balance: isFirstUser ? 10000 : 0 } },
      },
      select: { id: true, username: true, nickname: true, avatar: true, role: true },
    })

    const token = signToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    })

    setAuthCookie(res, token, req)

    await auditReqAsync(req, res, {
      userId: user.id,
      username: user.username,
      category: 'auth',
      action: 'phone_register',
      targetType: 'User',
      targetId: user.id,
      summary: isFirstUser
        ? `首次部署：手机注册 ${user.username} 自动成为管理员`
        : `新用户手机注册: ${user.username}`,
      detail: { phone, nickname, role: user.role, firstUserBootstrap: isFirstUser },
    })

    return success(res, { token, user, hasPassword: false }, '注册成功')
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return next(new HttpError('该手机号已注册，请直接登录', 409))
    }
    next(e)
  }
})

/**
 * 手机号 + 验证码登录（已存在用户）
 * - 校验 smsStore 验证码（过期/尝试次数/匹配）
 * - 用户不存在 → 404 引导去注册
 * - 成功后签发 JWT + setAuthCookie
 * - 与 /phone-register 的区别：必须已存在用户，不自动创建
 */
const phoneLoginSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6, '验证码为 6 位数字'),
})

router.post('/phone-login', authRateLimit, async (req, res, next) => {
  try {
    const parsed = phoneLoginSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    }
    const { phone, code } = parsed.data

    // 校验验证码（与 phone-register 共用 smsStore + 相同校验逻辑）
    const record = smsStore.get(phone)
    if (!record) {
      throw new HttpError('验证码已过期或未发送，请重新获取', 400)
    }
    if (record.expires < Date.now()) {
      smsStore.delete(phone)
      throw new HttpError('验证码已过期，请重新获取', 400)
    }
    record.attempts++
    if (record.attempts > 5) {
      smsStore.delete(phone)
      throw new HttpError('验证码错误次数过多，请重新获取', 429)
    }
    if (record.code !== code) {
      throw new HttpError(`验证码错误，还剩 ${5 - record.attempts} 次机会`, 400)
    }
    // 验证通过，删除验证码记录（一次性使用）
    smsStore.delete(phone)

    // 必须已存在用户
    const user = await prisma.user.findUnique({
      where: { phone },
      select: { id: true, username: true, nickname: true, avatar: true, role: true, phone: true, password: true },
    })
    if (!user) {
      await auditReqAsync(req, res, {
        category: 'auth',
        action: 'phone_login',
        summary: `手机登录失败（用户未注册）: ${phone}`,
        result: 'fail',
        detail: { reason: 'user_not_registered' },
      })
      throw new HttpError('该手机号未注册，请先注册', 404)
    }

    // 更新最后登录时间
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastHeartbeatAt: new Date() },
    })

    const token = signToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    })

    setAuthCookie(res, token, req)

    // 审计日志
    await auditReqAsync(req, res, {
      userId: user.id,
      username: user.username,
      category: 'auth',
      action: 'phone_login',
      summary: `手机验证码登录: ${user.username}`,
      result: 'success',
    })

    // 判断是否有密码（手机注册用户初始无密码）
    const hasPassword = !user.password.startsWith(PHONE_ONLY_MARKER)

    return success(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        role: user.role,
        phone: user.phone,
      },
      hasPassword,
    }, '登录成功')
  } catch (e: any) {
    next(e)
  }
})

/**
 * 设置登录密码（手机注册用户首次设置密码，无需旧密码）
 * - 仅限 password 为 PHONE_ONLY_MARKER 开头的用户（即手机注册未设密码）
 * - 设置后 password 被替换为真正的 bcrypt 哈希，可使用用户名+密码登录
 */
const setPasswordSchema = z.object({
  newPassword: z.string()
    .min(8, '密码至少 8 位')
    .max(32)
    .regex(/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/, '密码需包含字母和数字'),
})

router.post('/set-password', authRequired, async (req, res, next) => {
  try {
    const parsed = setPasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    }
    const { newPassword } = parsed.data

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, username: true, password: true },
    })
    if (!user) throw new HttpError('用户不存在', 404)

    // 仅限手机注册用户（密码为占位标记）调用此端点
    if (!user.password.startsWith(PHONE_ONLY_MARKER)) {
      throw new HttpError('您已设置密码，请使用「修改密码」功能', 400)
    }

    const hashed = await bcrypt.hash(newPassword, 10)
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed },
    })

    auditReq(req, res, {
      category: 'auth',
      action: 'set_password',
      targetType: 'User',
      targetId: user.id,
      summary: `手机注册用户设置登录密码: ${user.username}`,
    })

    return success(res, { ok: true }, '密码设置成功')
  } catch (e) {
    next(e)
  }
})

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
})

/**
 * 用户登录
 * - 用户名 + 密码
 * - 登录成功后更新 lastLoginAt
 * - 写入台账：login（无论成功失败都记录，便于追踪异常登录）
 */
router.post('/login', authRateLimit, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('用户名或密码错误', 422)
    const { username, password } = parsed.data

    const user = await prisma.user.findUnique({ where: { username } })
    if (!user) {
      // 台账：登录失败（关键审计，await 确保落库）
      await auditReqAsync(req, res, {
        username,
        category: 'auth',
        action: 'login',
        summary: `登录失败（用户不存在）: ${username}`,
        result: 'fail',
        detail: { reason: 'user_not_found' },
      })
      throw new HttpError('用户名或密码错误', 401)
    }

    const ok = await bcrypt.compare(password, user.password)
    if (!ok) {
      // 台账：登录失败（关键审计，await 确保落库）
      await auditReqAsync(req, res, {
        userId: user.id,
        username: user.username,
        category: 'auth',
        action: 'login',
        summary: `登录失败（密码错误）: ${user.username}`,
        result: 'fail',
        detail: { reason: 'wrong_password' },
      })
      throw new HttpError('用户名或密码错误', 401)
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastHeartbeatAt: new Date() },
    })

    const token = signToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    })

    // #4 修复：同时下发 HttpOnly Cookie（Web 端主防线）
    setAuthCookie(res, token, req)

    // 台账：登录成功（关键审计，await 确保落库）
    await auditReqAsync(req, res, {
      userId: user.id,
      username: user.username,
      category: 'auth',
      action: 'login',
      summary: `用户登录: ${user.username}`,
    })

    const levelInfo = getLevelInfo(user.totalOnlineMinutes)
    return success(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        role: user.role,
        onboarded: user.onboarded,
        preferredTone: user.preferredTone,
        aiNickname: user.aiNickname,
        totalOnlineMinutes: user.totalOnlineMinutes,
        levelInfo,
      },
    }, '登录成功')
  } catch (e) {
    next(e)
  }
})

/**
 * 登出（#4 修复：清除 HttpOnly Cookie）
 * - P2-5 修复：从请求中提取 token 的 jti 加入黑名单，实现真正的 token 撤销
 *   即使用户未清 cookie，被撤销的 token 在下一次请求时也会被 authRequired 拒绝
 * - 无论是否登录态都返回成功（幂等）
 */
router.post('/logout', (req, res) => {
  // 提取 token（cookie 优先，fallback Authorization header）
  let token: string | undefined
  const cookieHeader = req.headers.cookie
  if (cookieHeader) {
    const match = /(?:^|;\s*)aie_token=([^;]+)/.exec(cookieHeader)
    if (match) {
      try { token = decodeURIComponent(match[1]) } catch { token = match[1] }
    }
  }
  if (!token) {
    const header = req.headers.authorization
    if (header && header.startsWith('Bearer ')) token = header.slice(7)
  }
  // 解码 jti 并加入黑名单（不验证签名/过期——即使过期 token 也能撤销）
  if (token) {
    try {
      const parts = token.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { jti?: string; exp?: number }
        if (payload.jti) revokeToken(payload.jti, payload.exp)
      }
    } catch {
      // 解码失败忽略——登出保持幂等
    }
  }
  clearAuthCookie(res)
  return success(res, null, '已登出')
})

/**
 * 主动刷新 Token（无感续期）
 * - 前端检测到 token 临近过期时主动调用此端点
 * - 旧 token 撤销，签发新 token
 * - 同时刷新 HttpOnly Cookie
 * - 注意：authRequired 中间件已实现被动续期（响应头 X-New-Token），
 *         此端点用于前端主动续期场景（如长时间无请求后恢复）
 */
router.post('/refresh', authRequired, async (req, res, next) => {
  try {
    // authRequired 已验证 token 并填充 req.user
    // 签发新 token
    const newToken = signToken({
      userId: req.user!.userId,
      username: req.user!.username,
      role: req.user!.role,
    })
    // 撤销旧 token（从 cookie/header 提取 jti）
    let oldToken: string | undefined
    const cookieHeader = req.headers.cookie
    if (cookieHeader) {
      const match = /(?:^|;\s*)aie_token=([^;]+)/.exec(cookieHeader)
      if (match) {
        try { oldToken = decodeURIComponent(match[1]) } catch { oldToken = match[1] }
      }
    }
    if (!oldToken) {
      const header = req.headers.authorization
      if (header && header.startsWith('Bearer ')) oldToken = header.slice(7)
    }
    if (oldToken) {
      try {
        const parts = oldToken.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { jti?: string; exp?: number }
          if (payload.jti) revokeToken(payload.jti, payload.exp)
        }
      } catch { /* ignore */ }
    }
    // 下发新 token
    setAuthCookie(res, newToken, req)
    return success(res, { token: newToken }, '令牌已刷新')
  } catch (e) {
    next(e)
  }
})

// 获取当前用户
router.get('/me', authRequired, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true, username: true, nickname: true, avatar: true,
        role: true, onboarded: true, preferredTone: true, primaryGoal: true, aiNickname: true,
        email: true, phone: true, lastLoginAt: true, createdAt: true,
        totalOnlineMinutes: true, password: true,
      },
    })
    if (!user) throw new HttpError('用户不存在', 404)
    const levelInfo = getLevelInfo(user.totalOnlineMinutes)
    // hasPassword: 判断是否已设置真实密码（手机注册用户初始为占位标记）
    const { password, ...rest } = user
    return success(res, { ...rest, hasPassword: !password.startsWith(PHONE_ONLY_MARKER), levelInfo })
  } catch (e) {
    next(e)
  }
})

/** 冷启动画像 schema */
const onboardingSchema = z.object({
  primaryGoal: z.string(),
  preferredTone: z.string(),
  favoriteFood: z.string().optional(),
})

/**
 * 冷启动画像采集
 * - 用户首次登录后填写：本周目标、语气偏好、最想吃的食物
 * - 写入台账：auth.onboarding
 */
router.post('/onboarding', authRequired, async (req, res, next) => {
  try {
    const parsed = onboardingSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('参数错误', 422)
    const { primaryGoal, preferredTone } = parsed.data

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { primaryGoal, preferredTone, onboarded: true },
      select: { id: true, onboarded: true, preferredTone: true, primaryGoal: true },
    })
    auditReq(req, res, {
      category: 'auth',
      action: 'onboarding',
      targetType: 'User',
      targetId: user.id,
      summary: `冷启动画像: 目标=${primaryGoal}, 语气=${preferredTone}`,
      detail: { primaryGoal, preferredTone },
    })
    return success(res, user, '画像已保存')
  } catch (e) {
    next(e)
  }
})

/** 更新个人资料 Schema（所有字段可选） */
const updateProfileSchema = z.object({
  nickname: z.string().min(1, '昵称不能为空').max(20, '昵称不能超过 20 字').optional(),
  // avatar 支持 emoji（短字符串）或 base64 data URL（图片头像，最大 2MB）
  avatar: z.string().max(2 * 1024 * 1024, '头像图片过大（最大 2MB）').optional(),
  preferredTone: z.string().optional(), // 语气模式 key
  primaryGoal: z.string().max(50, '本周目标不能超过 50 字').optional().nullable(),
  aiNickname: z.string().min(1, '备注名不能为空').max(10, '备注名不能超过 10 字').optional(),
})

/**
 * 更新个人资料
 * - 支持更新昵称、头像、语气偏好、本周目标
 * - 不允许更新 username / password / role（敏感字段）
 * - 写入台账：auth.update_profile
 */
router.patch('/me', authRequired, async (req, res, next) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const data = parsed.data

    // 过滤掉 undefined 字段，避免误清空
    const updateData: Record<string, unknown> = {}
    if (data.nickname !== undefined) updateData.nickname = data.nickname
    if (data.avatar !== undefined) updateData.avatar = data.avatar
    if (data.preferredTone !== undefined) updateData.preferredTone = data.preferredTone
    if (data.primaryGoal !== undefined) updateData.primaryGoal = data.primaryGoal
    if (data.aiNickname !== undefined) updateData.aiNickname = data.aiNickname

    if (Object.keys(updateData).length === 0) {
      throw new HttpError('没有可更新的字段', 422)
    }

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: updateData,
      select: {
        id: true, username: true, nickname: true, avatar: true,
        role: true, onboarded: true, preferredTone: true, primaryGoal: true, aiNickname: true,
        totalOnlineMinutes: true,
      },
    })
    auditReq(req, res, {
      category: 'auth',
      action: 'update_profile',
      targetType: 'User',
      targetId: user.id,
      summary: `更新个人资料: ${Object.keys(updateData).join(', ')}`,
      detail: updateData,
    })

    const levelInfo = getLevelInfo(user.totalOnlineMinutes)
    return success(res, { ...user, levelInfo }, '资料已更新')
  } catch (e) {
    next(e)
  }
})

/**
 * 上传头像（base64）
 * - 支持 JPEG / PNG / WebP
 * - 大小限制 2MB
 * - 后端只做最小校验：必须是 data URL 格式
 * - 不做服务端压缩（前端已压缩）
 * - 写入台账：auth.update_avatar
 */
const avatarUploadSchema = z.object({
  avatar: z
    .string()
    .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/, '头像格式必须是 data URL (image/jpeg|png|webp)')
    .max(2 * 1024 * 1024, '头像图片过大（最大 2MB）'),
})

router.post('/avatar', authRequired, async (req, res, next) => {
  try {
    const parsed = avatarUploadSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    }
    const { avatar } = parsed.data

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { avatar },
      select: { id: true, username: true, avatar: true },
    })

    auditReq(req, res, {
      category: 'auth',
      action: 'update_avatar',
      targetType: 'User',
      targetId: user.id,
      summary: '更新头像',
      detail: { avatarLen: avatar.length, avatarType: avatar.substring(5, 20) },
    })

    return success(res, user, '头像已更新')
  } catch (e) {
    next(e)
  }
})

/**
 * 在线心跳
 * - 前端每 3 分钟调用一次
 * - 后端计算距上次心跳的 elapsed 分钟（最多 5 分钟，防止离线太久刷时间）
 * - 累加到 totalOnlineMinutes
 * - 返回最新等级信息
 * - 写入台账：auth.heartbeat（使用 auditReq 非阻塞模式）
 */
router.post('/heartbeat', authRequired, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, totalOnlineMinutes: true, lastHeartbeatAt: true },
    })
    if (!user) throw new HttpError('用户不存在', 404)

    const now = new Date()
    let addedMinutes = 0

    if (user.lastHeartbeatAt) {
      const elapsedMs = now.getTime() - user.lastHeartbeatAt.getTime()
      // 最多计 5 分钟（防止后台挂机刷时间）
      const elapsedMin = Math.min(Math.floor(elapsedMs / 60000), 5)
      if (elapsedMin > 0) {
        addedMinutes = elapsedMin
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        totalOnlineMinutes: { increment: addedMinutes },
        lastHeartbeatAt: now,
      },
      select: { totalOnlineMinutes: true },
    })

    const levelInfo = getLevelInfo(updatedUser.totalOnlineMinutes)

    auditReq(req, res, {
      category: 'auth',
      action: 'heartbeat',
      targetType: 'User',
      targetId: user.id,
      summary: `在线心跳: +${addedMinutes}min, 总计${updatedUser.totalOnlineMinutes}min`,
      detail: { addedMinutes, total: updatedUser.totalOnlineMinutes },
    })

    return success(res, {
      totalOnlineMinutes: updatedUser.totalOnlineMinutes,
      levelInfo,
      addedMinutes,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * 修改登录密码
 * - 需已登录（authRequired）
 * - 校验旧密码正确性
 * - 新密码与旧密码不能相同
 * - 新密码与注册一致：至少 8 位且含字母+数字
 * - 写入台账：auth.change_password
 * - 不吊销当前 token，用户可继续使用当前会话；其他设备需重新登录
 */
const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请输入旧密码'),
  newPassword: z.string()
    .min(8, '新密码至少 8 位')
    .max(32)
    .regex(/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/, '新密码需包含字母和数字'),
})

router.post('/change-password', authRequired, async (req, res, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { oldPassword, newPassword } = parsed.data

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, username: true, password: true },
    })
    if (!user) throw new HttpError('用户不存在', 404)

    const ok = await bcrypt.compare(oldPassword, user.password)
    if (!ok) {
      auditReq(req, res, {
        category: 'auth',
        action: 'change_password',
        summary: `修改密码失败（旧密码错误）: ${user.username}`,
        result: 'fail',
      })
      throw new HttpError('旧密码错误', 401)
    }

    if (await bcrypt.compare(newPassword, user.password)) {
      throw new HttpError('新密码不能与旧密码相同', 400)
    }

    const hashed = await bcrypt.hash(newPassword, 10)
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed },
    })

    auditReq(req, res, {
      category: 'auth',
      action: 'change_password',
      summary: `用户修改登录密码: ${user.username}`,
    })

    return success(res, { ok: true }, '密码修改成功')
  } catch (e) {
    next(e)
  }
})

export default router
