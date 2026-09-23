import { create } from 'zustand'
import { api, unwrap } from '../lib/api'
import { useHeaderAuth } from '../lib/platform'

/**
 * 等级信息接口（对标QQ等级，按在线时间累计）
 */
export interface LevelInfo {
  level: number
  totalOnlineMinutes: number
  totalOnlineHours: number
  currentLevelMinutes: number
  nextLevelMinutes: number
  progress: number
  icon: string
  title: string
}

/**
 * 用户信息接口
 * - onboarded：是否完成冷启动画像采集
 * - preferredTone：AI 对话语气偏好（9种模式之一）
 * - primaryGoal：用户主目标（用于个性化推荐）
 * - levelInfo：等级信息（按在线时间累计）
 */
export interface UserInfo {
  id: string
  username: string
  nickname?: string
  avatar?: string
  role: string
  onboarded: boolean
  preferredTone?: string
  aiNickname?: string
  primaryGoal?: string
  totalOnlineMinutes?: number
  levelInfo?: LevelInfo
  /** 是否已设置登录密码（手机注册用户初始为 false） */
  hasPassword?: boolean
}

/**
 * 全局认证状态（Zustand）
 *
 * #4 修复后的持久化策略：
 * - Web 端：token 通过 HttpOnly Cookie 携带（不存 localStorage，防 XSS），user 信息仍存 localStorage 用于乐观恢复
 * - Electron 桌面端：file:// 协议下 cookie 跨域可能失效，token 仍存 localStorage（已有 sandbox+CSP+contextIsolation 多重防护）
 * - 401 响应在 api.ts 拦截器中统一处理，会清除缓存并跳转登录
 */
interface AuthState {
  user: UserInfo | null
  token: string | null
  loading: boolean
  init: () => void
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, agreeTerms: boolean) => Promise<void>
  /** 发送短信验证码，返回验证码（本地版直接返回，无真实短信网关） */
  sendSms: (phone: string) => Promise<string>
  /** 手机号 + 验证码注册（不设密码，自动绑定手机） */
  phoneRegister: (phone: string, code: string, agreeTerms: boolean) => Promise<void>
  /** 手机号 + 验证码登录（已存在用户） */
  phoneLogin: (phone: string, code: string) => Promise<void>
  /** DEV 一键进入：自动 send-sms → phone-login（用户不存在则先 phone-register） */
  devLogin: () => Promise<{ phone: string; role: string }>
  /** 设置登录密码（手机注册用户首次设置，无需旧密码） */
  setPassword: (newPassword: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
  setOnboarded: () => void
  /** 本地合并更新用户信息（同步到 localStorage） */
  updateUser: (patch: Partial<UserInfo>) => void
}

// #4 修复：判断是否走 Authorization header 模式（Electron file:// 下 cookie 跨域失效；
// Capacitor 跨源请求 cookie 不可靠）。
// 浮窗等子窗口可能因 sandbox 时序问题导致 desktopAPI 未注入，
// 额外用 file: 协议兜底，确保子窗口也走 localStorage token 恢复路径
const useLocalToken = () => useHeaderAuth

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  loading: true,

  /** 应用启动时调用：恢复登录态 */
  init: () => {
    if (useLocalToken()) {
      // Electron/Capacitor：从 localStorage 恢复 token + user（断网也能直接进入应用）
      const token = localStorage.getItem('aie_token')
      const userStr = localStorage.getItem('aie_user')
      if (token && userStr) {
        try {
          const user = JSON.parse(userStr) as UserInfo
          set({ token, user, loading: false })
          return
        } catch {
          // ignore
        }
      }
      set({ token: null, user: null, loading: false })
      return
    }
    // Web 端：依赖 HttpOnly Cookie，从 localStorage 乐观恢复 user，后台调 /auth/me 验证
    const userStr = localStorage.getItem('aie_user')
    if (userStr) {
      try {
        const user = JSON.parse(userStr) as UserInfo
        // 乐观恢复：先显示已登录态，后台验证 cookie 有效性
        set({ token: '__cookie__', user, loading: false })
        unwrap<UserInfo>(api.get('/auth/me'))
          .then((u) => set({ user: u }))
          .catch(() => {
            // 离线兜底：断网导致的请求失败不清登录态，保持离线模式可用；
            // 恢复网络后由后续请求的 401 处理或下次启动验证纠正
            if (!navigator.onLine) return
            // cookie 失效，清 user 跳登录
            localStorage.removeItem('aie_user')
            set({ token: null, user: null })
            // HashRouter 兼容：file:// 协议下用 hash 跳转
            if (!window.location.hash.includes('/login')) {
              window.location.hash = '/login'
            }
          })
        return
      } catch {
        // ignore
      }
    }
    set({ token: null, user: null, loading: false })
  },

  /** 登录：成功后缓存 user；Electron/Capacitor 端额外缓存 token（Web 端用 cookie） */
  login: async (username, password) => {
    const res = await unwrap<{ token: string; user: UserInfo }>(
      api.post('/auth/login', { username, password }),
    )
    if (useLocalToken()) {
      localStorage.setItem('aie_token', res.token)
    }
    localStorage.setItem('aie_user', JSON.stringify(res.user))
    set({ token: useLocalToken() ? res.token : '__cookie__', user: res.user })
  },

  /** 注册：成功后等同于登录。昵称由后端基于编号自动生成（"用户1"、"用户2"...） */
  register: async (username, password, agreeTerms) => {
    const res = await unwrap<{ token: string; user: UserInfo }>(
      api.post('/auth/register', { username, password, agreeTerms }),
    )
    if (useLocalToken()) {
      localStorage.setItem('aie_token', res.token)
    }
    localStorage.setItem('aie_user', JSON.stringify(res.user))
    set({ token: useLocalToken() ? res.token : '__cookie__', user: res.user })
  },

  /** 发送短信验证码，返回验证码（本地版无真实短信网关，直接返回 code） */
  sendSms: async (phone) => {
    const res = await unwrap<{ code: string; expiresIn: number }>(
      api.post('/auth/send-sms', { phone }),
    )
    return res.code
  },

  /** 手机号 + 验证码注册（不设密码，自动绑定手机） */
  phoneRegister: async (phone, code, agreeTerms) => {
    const res = await unwrap<{ token: string; user: UserInfo; hasPassword: boolean }>(
      api.post('/auth/phone-register', { phone, code, agreeTerms }),
    )
    if (useLocalToken()) {
      localStorage.setItem('aie_token', res.token)
    }
    const user = { ...res.user, hasPassword: false }
    localStorage.setItem('aie_user', JSON.stringify(user))
    set({ token: useLocalToken() ? res.token : '__cookie__', user })
  },

  /** 手机号 + 验证码登录（已存在用户） */
  phoneLogin: async (phone, code) => {
    const res = await unwrap<{ token: string; user: UserInfo; hasPassword: boolean }>(
      api.post('/auth/phone-login', { phone, code }),
    )
    if (useLocalToken()) {
      localStorage.setItem('aie_token', res.token)
    }
    const user = { ...res.user, hasPassword: res.hasPassword }
    localStorage.setItem('aie_user', JSON.stringify(user))
    set({ token: useLocalToken() ? res.token : '__cookie__', user })
  },

  /**
   * DEV 一键进入（仅开发环境使用）
   * 1. 先发验证码
   * 2. phone-login 自动登录
   * 3. 如果 404（用户不存在），先 phone-register 再 phone-login
   * 使用固定手机号 13800000000，避免每次换号导致 rate limit
   */
  devLogin: async () => {
    // 安全守卫：生产环境彻底禁用 DEV 登录
    if (import.meta.env.PROD) {
      throw new Error('DEV login is disabled in production')
    }
    const DEV_PHONE = '13800000000'
    // 先等 rate limit 冷却（最多等 65 秒）
    const waitForSms = async () => {
      for (let i = 0; i < 7; i++) {
        try {
          const code = await unwrap<{ code: string }>(api.post('/auth/send-sms', { phone: DEV_PHONE }))
          return code.code
        } catch (_) {
          // 429 → 等 10 秒后重试
          await new Promise((r) => setTimeout(r, 10000))
        }
      }
      throw new Error('send-sms rate limited too long')
    }

    let code: string
    let needsRegister = false
    try {
      code = await waitForSms()
    } catch (e) {
      throw new Error('获取验证码失败')
    }

    try {
      // 先尝试直接登录
      const loginRes = await unwrap<{ token: string; user: UserInfo; hasPassword: boolean }>(
        api.post('/auth/phone-login', { phone: DEV_PHONE, code }),
      )
      if (useLocalToken()) localStorage.setItem('aie_token', loginRes.token)
      const u = { ...loginRes.user, hasPassword: loginRes.hasPassword }
      localStorage.setItem('aie_user', JSON.stringify(u))
      set({ token: useLocalToken() ? loginRes.token : '__cookie__', user: u })
      return { phone: DEV_PHONE, role: u.role }
    } catch (loginErr) {
      // 登录失败（可能是验证码错了或用户不存在），先尝试注册
    }

    // 重新等一个验证码 + 注册
    await new Promise((r) => setTimeout(r, 11000))
    code = await waitForSms()
    try {
      const regRes = await unwrap<{ token: string; user: UserInfo; hasPassword: boolean }>(
        api.post('/auth/phone-register', { phone: DEV_PHONE, code, agreeTerms: true }),
      )
      if (useLocalToken()) localStorage.setItem('aie_token', regRes.token)
      const u = { ...regRes.user, hasPassword: false }
      localStorage.setItem('aie_user', JSON.stringify(u))
      set({ token: useLocalToken() ? regRes.token : '__cookie__', user: u })
      return { phone: DEV_PHONE, role: u.role }
    } catch (regErr) {
      throw new Error('dev 登录/注册都失败了，请手动尝试')
    }
  },

  /** 设置登录密码（手机注册用户首次设置，无需旧密码） */
  setPassword: async (newPassword) => {
    await unwrap(api.post('/auth/set-password', { newPassword }))
    // 更新本地 hasPassword 状态
    set((state) => {
      if (!state.user) return state
      const user = { ...state.user, hasPassword: true }
      localStorage.setItem('aie_user', JSON.stringify(user))
      return { user }
    })
  },

  /** 登出：调后端清 cookie + 清本地缓存 + 跳登录页 */
  logout: () => {
    // 调后端清 HttpOnly Cookie（不 await，快速跳转）
    api.post('/auth/logout').catch(() => { /* ignore */ })
    localStorage.removeItem('aie_token')
    localStorage.removeItem('aie_user')
    set({ user: null, token: null })
    // HashRouter 兼容：file:// 协议下用 hash 跳转
    window.location.hash = '/login'
  },

  /** 拉取最新用户信息（如冷启动完成后刷新 onboarded 字段） */
  refreshUser: async () => {
    const user = await unwrap<UserInfo>(api.get('/auth/me'))
    localStorage.setItem('aie_user', JSON.stringify(user))
    set({ user })
  },

  /** 冷启动完成标记（不立即请求后端，提交时由 OnboardingPage 调用 refreshUser） */
  setOnboarded: () => {
    set((state) => ({
      user: state.user ? { ...state.user, onboarded: true } : null,
    }))
  },

  /** 本地合并更新用户信息（同步到 localStorage，不请求后端） */
  updateUser: (patch) => {
    set((state) => {
      if (!state.user) return state
      const user = { ...state.user, ...patch }
      localStorage.setItem('aie_user', JSON.stringify(user))
      return { user }
    })
  },
}))

// Zustand subscribe: token 变化时同步 JWT 给 Electron 主进程里的 Worker
// （登录成功 → setWorkerJwt(token)；登出 → setWorkerJwt('')）
if (typeof window !== 'undefined' && window.desktopAPI?.setWorkerJwt) {
  const desktopApi = window.desktopAPI  // 缓存，避免闭包里 TS 认为可能 undefined
  let lastToken: string | null = null
  useAuthStore.subscribe((state) => {
    if (state.token !== lastToken) {
      lastToken = state.token
      try {
        const raw = state.token || ''
        if (raw && raw !== '__cookie__') {
          desktopApi.setWorkerJwt(raw).catch(() => {})
        } else if (!raw) {
          desktopApi.setWorkerJwt('').catch(() => {})
        }
      } catch (_) {}
    }
  })
}
