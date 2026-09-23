import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { useToast } from '../components/Toast'
import { isDesktop } from '../hooks/useIsDesktop'
import {
  Sparkles, CalendarClock, PawPrint, MessageCircle, ShieldCheck,
  ArrowRight, KeyRound, X, Smartphone,
  Phone, MessageSquare,
} from 'lucide-react'

/**
 * 登录 / 注册页
 *
 * 桌面端：左右分栏宽屏设计（左侧品牌展示 + 右侧表单），深色专业风
 * 移动端：单列居中（保留原有 app-shell 480px 布局）
 *
 * 功能：
 * 1. 登录 / 注册模式切换（默认登录）
 * 2. 注册模式默认「手机号注册」（输入手机号 → 发送验证码 → 输入验证码 → 注册）
 *    手动用户名注册折叠为次要选项
 * 3. 登录失败差异化提示：基于本地失败次数给出针对性引导
 * 4. 忘记密码弹窗（MVP 阶段无邮箱找回，提供指引）
 */
/**
 * 失败提示条：密码错了、注册失败等，常驻表单内（不依赖顶部 toast）
 * 注意：必须在模块顶层定义（不能在 LoginPage 内部定义）——内部定义的话每次渲染组件类型都会变化，
 *       React 会卸载并重挂整棵子树，导致输入框失焦（输入一个数字后必须再点一次才能继续）
 */
function ErrorBanner({ formError, dark }: { formError: string; dark?: boolean }) {
  if (!formError) return null
  return (
    <div className={`p-2.5 rounded-lg flex items-start gap-2 text-xs ${dark ? 'bg-red-500/10 border border-red-400/30 text-red-300' : 'bg-red-50 border border-red-200 text-red-600'}`}>
      <span className="flex-1">{formError}</span>
    </div>
  )
}

/**
 * 手机号注册区块（移动端 + 桌面端共用），顶层组件保证输入框在重渲染后保持聚焦
 */
interface PhoneRegisterSectionProps {
  dark?: boolean
  formError: string
  phone: string
  smsCode: string
  loading: boolean
  countdown: number
  smsSent: boolean
  smsCodeShown: string
  agreeTerms: boolean
  onAgreeTerms: (v: boolean) => void
  onPhoneChange: (v: string) => void
  onSmsChange: (v: string) => void
  onSendSms: () => void
  onRegister: (e: React.FormEvent) => void
}

function PhoneRegisterSection({
  dark, formError, phone, smsCode, loading, countdown, smsSent, smsCodeShown, agreeTerms, onAgreeTerms, onPhoneChange, onSmsChange, onSendSms, onRegister,
}: PhoneRegisterSectionProps) {
  return (
    <div className="space-y-3">
      <ErrorBanner formError={formError} dark={dark} />
      {/* 手机号输入 */}
      <div>
        <label className={`block text-sm mb-1.5 font-medium ${dark ? 'text-slate-300' : 'text-gray-600'}`}>手机号</label>
        <div className="relative">
          <Phone size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark ? 'text-slate-500' : 'text-gray-400'}`} />
          <input
            className="input pl-9"
            placeholder="请输入手机号"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            disabled={loading}
          />
        </div>
      </div>

      {/* 验证码输入 + 发送按钮 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MessageSquare size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark ? 'text-slate-500' : 'text-gray-400'}`} />
          <input
            className="input pl-9"
            placeholder="6 位验证码"
            value={smsCode}
            onChange={(e) => onSmsChange(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={loading}
          />
        </div>
        <button
          type="button"
          onClick={onSendSms}
          disabled={loading || countdown > 0 || !phone}
          className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap hover:bg-primary-700 transition-colors"
        >
          {countdown > 0 ? `${countdown}s` : '发送验证码'}
        </button>
      </div>

      {/* 本地版验证码提示 */}
      {smsSent && smsCodeShown && (
        <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700 flex items-center gap-2">
          <Smartphone size={14} className="flex-shrink-0" />
          <span>本次验证码：<strong className="font-mono tracking-wider">{smsCodeShown}</strong>（本地版直接展示）</span>
        </div>
      )}

      {/* 合规：协议勾选 */}
      <label className={`flex items-start gap-2 px-1 text-xs cursor-pointer select-none ${dark ? 'text-slate-400' : 'text-gray-500'}`}>
        <input
          type="checkbox"
          checked={agreeTerms}
          onChange={(e) => onAgreeTerms(e.target.checked)}
          className="mt-0.5 accent-primary-600"
        />
        <span>
          我已阅读并同意
          <Link to="/terms" target="_blank" className={`${dark ? 'text-slate-300 hover:text-white' : 'text-primary-600 hover:text-primary-700'} underline underline-offset-1`}>《用户协议》</Link>
          和
          <Link to="/prprivacy-policy" target="_blank" className={`${dark ? 'text-slate-300 hover:text-white' : 'text-primary-600 hover:text-primary-700'} underline underline-offset-1`}>《隐私政策》</Link>
        </span>
      </label>

      {/* 注册按钮 */}
      <button
        onClick={onRegister}
        disabled={loading || !phone || !smsCode}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-600 to-primary-800 text-white font-semibold disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-primary-500/20 hover:shadow-primary-500/30 transition-all"
      >
        {loading ? '注册中...' : (
          <>
            <Smartphone size={18} />
            手机号注册
            <ArrowRight size={16} />
          </>
        )}
      </button>
      <p className={`text-center text-xs ${dark ? 'text-slate-500' : 'text-gray-400'}`}>
        自动绑定手机号，注册后可在安全中心设置密码
      </p>

    </div>
  )
}

/**
 * 手机号验证码登录区块（登录模式专用，无协议勾选）
 */
interface PhoneLoginSectionProps {
  dark?: boolean
  formError: string
  phone: string
  smsCode: string
  loading: boolean
  countdown: number
  smsSent: boolean
  smsCodeShown: string
  onPhoneChange: (v: string) => void
  onSmsChange: (v: string) => void
  onSendSms: () => void
  onLogin: (e: React.FormEvent) => void
}

function PhoneLoginSection({
  dark, formError, phone, smsCode, loading, countdown, smsSent, smsCodeShown,
  onPhoneChange, onSmsChange, onSendSms, onLogin,
}: PhoneLoginSectionProps) {
  return (
    <div className="space-y-3">
      <ErrorBanner formError={formError} dark={dark} />
      {/* 手机号输入 */}
      <div>
        <label className={`block text-sm mb-1.5 font-medium ${dark ? 'text-slate-300' : 'text-gray-600'}`}>手机号</label>
        <div className="relative">
          <Phone size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark ? 'text-slate-500' : 'text-gray-400'}`} />
          <input
            className="input pl-9"
            placeholder="请输入手机号"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            disabled={loading}
          />
        </div>
      </div>

      {/* 验证码输入 + 发送按钮 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MessageSquare size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark ? 'text-slate-500' : 'text-gray-400'}`} />
          <input
            className="input pl-9"
            placeholder="6 位验证码"
            value={smsCode}
            onChange={(e) => onSmsChange(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={loading}
          />
        </div>
        <button
          type="button"
          onClick={onSendSms}
          disabled={loading || countdown > 0 || !phone}
          className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap hover:bg-primary-700 transition-colors"
        >
          {countdown > 0 ? `${countdown}s` : '发送验证码'}
        </button>
      </div>

      {/* 本地版验证码提示 */}
      {smsSent && smsCodeShown && (
        <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700 flex items-center gap-2">
          <Smartphone size={14} className="flex-shrink-0" />
          <span>本次验证码：<strong className="font-mono tracking-wider">{smsCodeShown}</strong>（本地版直接展示）</span>
        </div>
      )}

      {/* 登录按钮 */}
      <form onSubmit={onLogin}>
        <button
          type="submit"
          disabled={loading || !phone || !smsCode}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-600 to-primary-800 text-white font-semibold disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-primary-500/20 hover:shadow-primary-500/30 transition-all"
        >
          {loading ? '登录中...' : (
            <>
              <Smartphone size={18} />
              验证码登录
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>
    </div>
  )
}

/**
 * 忘记密码弹窗（MVP 阶段无邮箱找回，提供指引）
 * 同样放在模块顶层：内部定义组件每次渲染类型都会变，React 会卸载重挂整个子树（输入框失焦的万恶之源）
 */
function ForgotDialog({ showForgot, onClose }: { showForgot: boolean; onClose: () => void }) {
  if (!showForgot) return null
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <KeyRound size={18} className="text-primary-500" /> 找回密码
          </h3>
          <button onClick={onClose} aria-label="关闭" className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div className="text-sm text-gray-600 space-y-2.5 leading-relaxed">
          <p>当前为本地优先版本，暂未提供邮箱/短信找回。</p>
          <p>您可以通过以下方式恢复访问：</p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-gray-600">
            <li>如已登录其他账号：前往「设置 → 安全中心 → 修改登录密码」自助修改；</li>
            <li>如未登录：联系本机管理员，通过管理后台重置密码；</li>
            <li>若为本机唯一管理员：可在「应用数据目录」删除 de1.db 后重启应用（数据会清空，请谨慎操作）。</li>
          </ul>
          <p className="text-xs text-gray-400 pt-1">提示：密码需 8 位以上且含字母+数字。</p>
        </div>
        <button onClick={onClose} className="btn-primary w-full mt-4 py-2 text-sm">我知道了</button>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const { login, register, sendSms, phoneRegister, phoneLogin, devLogin } = useAuthStore()
  const toast = useToast((s) => s.show)
  const nnavigate = useNavigate()
  const desktop = isDesktop()

  const [mode, setMode] = useState<'login' | 'register'>('login')
  // 登录方式（仅 mode='login' 时有效）
  const [loginMethod, setLoginMethod] = useState<'password' | 'phoneCode'>('password')
  // 登录 / 手动注册表单
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [failCount, setFailCount] = useState(0)
  const [formError, setFormError] = useState('') // 表单内常驻错误提示条（密码错了等失败原因）
  const [showForgot, setShowForgot] = useState(false)
  
  // 手机号注册表单
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsSent, setSmsSent] = useState(false)
  const [countdown, setCountdown] = useState(0)
  // 合规：注册协议勾选（共用 state，手机注册和手动注册两处均校验）
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [smsCodeShown, setSmsCodeShown] = useState('') // 本地版：后端返回的验证码展示
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // DEV 一键进入：点版本号 5 次触发，或直接点 DEV 按钮
  const [devClickCount, setDevClickCount] = useState(0)
  const [devLoading, setDevLoading] = useState(false)
  const devClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 版本号点击：5 次触发 DEV 按钮显示 */
  const onVersionClick = () => {
    setDevClickCount((c) => c + 1)
    if (devClickTimerRef.current) clearTimeout(devClickTimerRef.current)
    devClickTimerRef.current = setTimeout(() => setDevClickCount(0), 3000)
  }

  /** DEV 一键进入 */
  const handleDevLogin = async () => {
    setDevLoading(true)
    setFormError('')
    try {
      const { role } = await devLogin()
      toast(`DEV 进入成功（role: ${role}）`, 'success')
      nnavigate('/')
    } catch (err) {
      const msg = (err as Error).message || 'DEV 登录失败'
      setFormError(msg)
      toast(msg, 'error', 4000)
    } finally {
      setDevLoading(false)
    }
  }

  // 倒计时
  useEffect(() => {
    if (countdown > 0) {
      timerRef.current = setInterval(() => {
        setCountdown((c) => c - 1)
      }, 1000)
      return () => { if (timerRef.current) clearInterval(timerRef.current) }
    }
  }, [countdown])

  /** 登录失败时根据失败次数给出差异化提示 */
  const handleLoginFail = (rawMessage: string) => {
    const next = failCount + 1
    setFailCount(next)
    let msg = ''
    if (next === 1) {
      msg = '用户名或密码错误'
    } else if (next === 2) {
      msg = '密码错误，请检查大小写与数字是否正确'
    } else if (next === 3) {
      msg = '连续 3 次密码错误，忘记密码？可点击下方"忘记密码"找回'
    } else if (next >= 5) {
      msg = `已连续 ${next} 次失败，建议联系管理员重置数据库或使用其他账号`
    } else {
      msg = rawMessage || '用户名或密码错误'
    }
    setFormError(msg)
    toast(msg, next >= 3 ? 'warning' : 'error', next >= 3 ? 4000 : 3000)
  }

  /** 发送短信验证码 */
  const onSendSms = async () => {
    if (!phone) {
      toast('请输入手机号', 'error')
      return
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      toast('手机号格式不正确', 'error')
      return
    }
    try {
      setLoading(true)
      const code = await sendSms(phone)
      setSmsSent(true)
      setCountdown(60)
      setSmsCodeShown(code) // 本地版：后端直接返回验证码
      setFormError('')
      toast(`验证码已发送${code ? `：${code}` : ''}`, 'success', 5000)
    } catch (err) {
      const msg = (err as Error).message || ''
      if (msg.includes('60') || msg.includes('429')) {
        setFormError('验证码已发送，请 60 秒后重试')
        toast('验证码已发送，请 60 秒后重试', 'warning', 3000)
      } else {
        setFormError(`发送失败：${msg || '请稍后重试'}`)
        toast(`发送失败：${msg}`, 'error', 3000)
      }
    } finally {
      setLoading(false)
    }
  }

  /** 手机号注册 */
  const onPhoneRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!phone || !smsCode) {
      toast('请输入手机号和验证码', 'error')
      return
    }
    if (!agreeTerms) {
      toast('请先阅读并同意用户协议与隐私政策', 'error')
      return
    }
    setLoading(true)
    try {
      await phoneRegister(phone, smsCode, agreeTerms)
      setFormError('')
      toast('注册成功，欢迎使用绿角犀', 'success')
      nnavigate('/')
    } catch (err) {
      const msg = (err as Error).message || ''
      if (msg.includes('已注册') || msg.includes('409')) {
        setFormError('该手机号已注册，请直接登录')
        toast('该手机号已注册，请直接登录', 'error', 3000)
      } else if (msg.includes('验证码')) {
        setFormError(msg)
        toast(msg, 'error', 3000)
      } else {
        setFormError(`注册失败：${msg || '请稍后重试'}`)
        toast(`注册失败：${msg || '请稍后重试'}`, 'error', 3000)
      }
    } finally {
      setLoading(false)
    }
  }

  /** 手机号 + 验证码登录 */
  const onPhoneLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!phone || !smsCode) {
      toast('请输入手机号和验证码', 'error')
      return
    }
    setLoading(true)
    try {
      await phoneLogin(phone, smsCode)
      setFormError('')
      toast('登录成功', 'success')
      nnavigate('/')
    } catch (err) {
      const msg = (err as Error).message || ''
      if (msg.includes('未注册') || msg.includes('404')) {
        setFormError('该手机号未注册，请先注册')
        toast('该手机号未注册，请先注册', 'error', 3000)
      } else if (msg.includes('验证码')) {
        setFormError(msg)
        toast(msg, 'error', 3000)
      } else {
        setFormError(`登录失败：${msg || '请稍后重试'}`)
        toast(`登录失败：${msg || '请稍后重试'}`, 'error', 3000)
      }
    } finally {
      setLoading(false)
    }
  }

  /** 表单提交：登录或手动注册 */
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) {
      setFormError('请输入用户名和密码')
      toast('请输入用户名和密码', 'error')
      return
    }
    if (mode === 'register') {
      if (password.length < 8) {
        setFormError('密码至少 8 位')
        toast('密码至少 8 位', 'error')
        return
      }
      if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
        setFormError('密码需同时包含字母和数字')
        toast('密码需同时包含字母和数字', 'error')
        return
      }
      if (!agreeTerms) {
        setFormError('请先阅读并同意用户协议与隐私政策')
        toast('请先阅读并同意用户协议与隐私政策', 'error')
        return
      }
    }
    setLoading(true)
    try {
      setFormError('')
      if (mode === 'login') {
        await login(username, password)
        toast('登录成功', 'success')
        nnavigate('/')
      } else {
        await register(username, password, agreeTerms)
        toast('注册成功', 'success')
        nnavigate('/')
      }
    } catch (err) {
      const msg = (err as Error).message || ''
      if (mode === 'login') {
        handleLoginFail(msg)
      } else {
        if (msg.includes('已存在') || msg.includes('already') || msg.includes('409')) {
          setFormError('用户名已被注册，请换一个')
          toast('用户名已被注册，请换一个', 'error', 3000)
        } else if (msg.includes('密码') || msg.includes('password')) {
          setFormError(`注册失败：${msg}`)
          toast(`注册失败：${msg}`, 'error', 3000)
        } else {
          setFormError(`注册失败：${msg || '请稍后重试'}`)
          toast(`注册失败：${msg || '请稍后重试'}`, 'error', 3000)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  /** 忘记密码弹窗（顶层组件 ForgotDialog，见模块顶部定义） */



  // ===== 移动端布局（保留原有单列 app-shell） =====
  if (!desktop) {
    return (
      <div className="app-shell flex flex-col items-center justify-center px-6 min-h-screen">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-primary-400 to-teal-500 flex items-center justify-center text-white text-4xl font-bold shadow-lg shadow-primary-200/60 ring-4 ring-white/60">
              小
            </div>
            <h1 className="mt-4 text-2xl font-bold text-gradient">绿角犀</h1>
            <p className="mt-1 text-sm text-gray-500">你的全能个人助理</p>
          </div>

          {mode === 'register' ? (
            <div className="space-y-4">
              <PhoneRegisterSection
                formError={formError} phone={phone} smsCode={smsCode} loading={loading}
                countdown={countdown} smsSent={smsSent} smsCodeShown={smsCodeShown}
                agreeTerms={agreeTerms} onAgreeTerms={setAgreeTerms}
                onPhoneChange={(v) => { setPhone(v.replace(/\D/g, '').slice(0, 11)); if (formError) setFormError('') }}
                onSmsChange={(v) => { setSmsCode(v.replace(/\D/g, '').slice(0, 6)); if (formError) setFormError('') }}
                onSendSms={onSendSms}
                onRegister={onPhoneRegister}
              />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Tab 切换：密码登录 / 验证码登录 */}
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg text-sm">
                <button
                  type="button"
                  className={`flex-1 py-1.5 rounded-md font-medium transition-colors ${loginMethod === 'password' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => { setLoginMethod('password'); setFormError('') }}
                >密码登录</button>
                <button
                  type="button"
                  className={`flex-1 py-1.5 rounded-md font-medium transition-colors ${loginMethod === 'phoneCode' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => { setLoginMethod('phoneCode'); setFormError('') }}
                >验证码登录</button>
              </div>

              {loginMethod === 'password' ? (
                <form onSubmit={onSubmit} className="space-y-4">
                  <ErrorBanner formError={formError} />
                  <div>
                    <label className="block text-sm text-gray-600 mb-1.5 font-medium">用户名</label>
                    <input className="input" placeholder="请输入用户名" value={username} onChange={(e) => { setUsername(e.target.value); if (formError) setFormError('') }} autoComplete="username" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1.5 font-medium">密码</label>
                    <input className="input" type="password" placeholder="请输入密码" value={password} onChange={(e) => { setPassword(e.target.value); if (formError) setFormError('') }} autoComplete="current-password" />
                  </div>
                  <button type="submit" disabled={loading} className="btn-primary w-full py-3 disabled:opacity-60">{loading ? '处理中...' : '登录'}</button>
                </form>
              ) : (
                <PhoneLoginSection
                  formError={formError} phone={phone} smsCode={smsCode} loading={loading}
                  countdown={countdown} smsSent={smsSent} smsCodeShown={smsCodeShown}
                  onPhoneChange={(v) => { setPhone(v.replace(/\D/g, '').slice(0, 11)); if (formError) setFormError('') }}
                  onSmsChange={(v) => { setSmsCode(v.replace(/\D/g, '').slice(0, 6)); if (formError) setFormError('') }}
                  onSendSms={onSendSms}
                  onLogin={onPhoneLogin}
                />
              )}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between text-sm">
            {mode === 'login' ? (
              <>
                <button className="text-gray-500 hover:text-primary-600 flex items-center gap-1" onClick={() => setShowForgot(true)}>
                  <KeyRound size={13} /> 忘记密码？
                </button>
                <span className="text-gray-500">还没有账号？
                  <button className="text-primary-600 ml-1 font-medium hover:text-primary-700" onClick={() => { setMode('register'); setPhone(''); setSmsCode(''); setSmsSent(false); setSmsCodeShown(''); setFormError('') }}>去注册</button>
                </span>
              </>
            ) : (
              <>
                <span />
                <span className="text-gray-500">已有账号？
                  <button className="text-primary-600 ml-1 font-medium hover:text-primary-700" onClick={() => { setMode('login'); setFormError('') }}>去登录</button>
                </span>
              </>
            )}
          </div>

          {failCount >= 3 && mode === 'login' && (
            <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700 flex items-center gap-2">
              <KeyRound size={14} className="flex-shrink-0" />
              <span>已连续失败 {failCount} 次，可点击「忘记密码」找回</span>
            </div>
          )}

          {/* DEV 一键进入（仅开发环境用） */}
          {import.meta.env.DEV && (
          <div className="mt-6 text-center">
            <button
              onClick={handleDevLogin}
              disabled={devLoading}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50 select-none"
            >
              {devLoading ? 'DEV 登录中...' : 'DEV 一键进入'}
            </button>
          </div>
          )}
        </div>
        <ForgotDialog showForgot={showForgot} onClose={() => setShowForgot(false)} />
      </div>
    )
  }

  // ===== 桌面端布局（左右分栏 + 深色专业风） =====
  const features = [
    { icon: MessageCircle, title: 'AI 对话', desc: '随时与 AI 助理交流' },
    { icon: CalendarClock, title: '任务管理', desc: '待办、倒计时、提醒' },
    { icon: PawPrint, title: '桌面宠物', desc: '陪伴你工作的伙伴' },
    { icon: ShieldCheck, title: '本地优先', desc: '数据加密，安全可靠' },
  ]

  return (
    <div className="desktop-login flex h-screen">
      {/* 左侧：品牌展示区（深色渐变） */}
      <div className="hidden lg:flex flex-col justify-between w-[45%] p-12 bg-gradient-to-br from-accent-900 via-[#0B1120] to-accent-800 text-white relative overflow-hidden">
        {/* 装饰光晕 */}
        <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-primary-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-10 w-96 h-96 rounded-full bg-teal-500/10 blur-3xl" />

        {/* Logo + 标语 */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-400 to-teal-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-primary-500/30">
              小
            </div>
            <span className="text-xl font-semibold tracking-wide">绿角犀</span>
          </div>
          <h2 className="mt-10 text-3xl font-bold leading-tight">
            你的全能<br />
            <span className="bg-gradient-to-r from-primary-300 to-teal-300 bg-clip-text text-transparent">桌面个人助理</span>
          </h2>
          <p className="mt-3 text-slate-400 text-sm leading-relaxed max-w-sm">
            对话、任务、财务、宠物、社区 —— 一个应用，搞定你的数字生活。
          </p>
        </div>

        {/* 功能亮点 */}
        <div className="relative z-10 grid grid-cols-2 gap-4 max-w-md">
          {features.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/5">
              <div className="w-9 h-9 rounded-lg bg-primary-500/15 flex items-center justify-center shrink-0">
                <Icon size={18} className="text-primary-300" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-white">{title}</div>
                <div className="text-[11px] text-slate-400 truncate">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="relative z-10 flex items-center gap-2 text-xs text-slate-500 select-none">
          <Sparkles size={14} />
          <span onClick={import.meta.env.DEV ? onVersionClick : undefined} className={`transition-colors ${import.meta.env.DEV ? 'cursor-pointer hover:text-slate-400' : ''}`}>v1.0.6 · 本地优先 · 隐私安全</span>
          {import.meta.env.DEV && devClickCount >= 5 && (
            <button
              onClick={handleDevLogin}
              disabled={devLoading}
              className="ml-2 px-2 py-0.5 text-[10px] font-mono bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded border border-red-500/30 transition-all disabled:opacity-50"
              title="DEV: 一键跳过登录"
            >
              {devLoading ? 'DEV...' : 'DEV 一键进入'}
            </button>
          )}
        </div>
      </div>

      {/* 右侧：表单区（浅色） */}
      <div className="flex-1 flex items-center justify-center p-8 bg-accent-50">
        <div className="w-full max-w-sm">
          {/* 移动端 Logo（小屏显示） */}
          <div className="lg:hidden text-center mb-8">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-primary-400 to-teal-500 flex items-center justify-center text-white text-3xl font-bold shadow-lg">
              小
            </div>
          </div>

          <h1 className="text-2xl font-bold text-accent-800">
            {mode === 'login' ? '欢迎回来' : '创建账号'}
          </h1>
          <p className="mt-1.5 text-sm text-accent-500">
            {mode === 'login' ? '登录以继续使用 绿角犀' : '手机号验证，即刻开始'}
          </p>

          {mode === 'register' ? (
            <div className="mt-8 space-y-4">
              <PhoneRegisterSection
                dark
                formError={formError} phone={phone} smsCode={smsCode} loading={loading}
                countdown={countdown} smsSent={smsSent} smsCodeShown={smsCodeShown}
                agreeTerms={agreeTerms} onAgreeTerms={setAgreeTerms}
                onPhoneChange={(v) => { setPhone(v.replace(/\D/g, '').slice(0, 11)); if (formError) setFormError('') }}
                onSmsChange={(v) => { setSmsCode(v.replace(/\D/g, '').slice(0, 6)); if (formError) setFormError('') }}
                onSendSms={onSendSms}
                onRegister={onPhoneRegister}
              />
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              {/* Tab 切换：密码登录 / 验证码登录 */}
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg text-sm">
                <button
                  type="button"
                  className={`flex-1 py-1.5 rounded-md font-medium transition-colors ${loginMethod === 'password' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => { setLoginMethod('password'); setFormError('') }}
                >密码登录</button>
                <button
                  type="button"
                  className={`flex-1 py-1.5 rounded-md font-medium transition-colors ${loginMethod === 'phoneCode' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  onClick={() => { setLoginMethod('phoneCode'); setFormError('') }}
                >验证码登录</button>
              </div>

              {loginMethod === 'password' ? (
                <form onSubmit={onSubmit} className="space-y-4">
                  <ErrorBanner formError={formError} />
                  <div>
                    <label className="block text-sm text-accent-600 mb-1.5 font-medium">用户名</label>
                    <input
                      className="input"
                      placeholder="请输入用户名"
                      value={username}
                      onChange={(e) => { setUsername(e.target.value); if (formError) setFormError('') }}
                      autoComplete="username"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-accent-600 mb-1.5 font-medium">密码</label>
                    <input
                      className="input"
                      type="password"
                      placeholder="请输入密码"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); if (formError) setFormError('') }}
                      autoComplete="current-password"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full py-3 disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {loading ? '处理中...' : (
                      <>
                        登录
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <PhoneLoginSection
                  dark
                  formError={formError} phone={phone} smsCode={smsCode} loading={loading}
                  countdown={countdown} smsSent={smsSent} smsCodeShown={smsCodeShown}
                  onPhoneChange={(v) => { setPhone(v.replace(/\D/g, '').slice(0, 11)); if (formError) setFormError('') }}
                  onSmsChange={(v) => { setSmsCode(v.replace(/\D/g, '').slice(0, 6)); if (formError) setFormError('') }}
                  onSendSms={onSendSms}
                  onLogin={onPhoneLogin}
                />
              )}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between text-sm text-accent-500">
            {mode === 'login' ? (
              <>
                <button className="text-accent-500 hover:text-primary-600 flex items-center gap-1" onClick={() => setShowForgot(true)}>
                  <KeyRound size={13} /> 忘记密码？
                </button>
                <span>还没有账号？
                  <button className="text-primary-600 ml-1 font-medium hover:text-primary-700" onClick={() => { setMode('register'); setPhone(''); setSmsCode(''); setSmsSent(false); setSmsCodeShown(''); setFormError('') }}>去注册</button>
                </span>
              </>
            ) : (
              <>
                <span />
                <span>已有账号？
                  <button className="text-primary-600 ml-1 font-medium hover:text-primary-700" onClick={() => { setMode('login'); setFormError('') }}>去登录</button>
                </span>
              </>
            )}
          </div>

          {failCount >= 3 && mode === 'login' && (
            <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700 flex items-center gap-2">
              <KeyRound size={14} className="flex-shrink-0" />
              <span>已连续失败 {failCount} 次，可点击「忘记密码」找回</span>
            </div>
          )}

          {/* DEV 一键进入 */}
          {import.meta.env.DEV && (
          <div className="mt-6 text-center">
            <button
              onClick={handleDevLogin}
              disabled={devLoading}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50 select-none"
            >
              {devLoading ? 'DEV 登录中...' : 'DEV 一键进入'}
            </button>
          </div>
          )}

          </div>
      </div>
      <ForgotDialog showForgot={showForgot} onClose={() => setShowForgot(false)} />
    </div>
  )
}

