import React from 'react'
import { Link } from 'react-router-dom'
import { Phone, MessageSquare, Smartphone, ArrowRight, KeyRound, X } from 'lucide-react'

/**
 * 失败提示条：密码错了、注册失败等，常驻表单内（不依赖顶部 toast）
 * 注意：必须在模块顶层定义（不能在 LoginPage 内部定义）——内部定义的话每次渲染组件类型都会变化，
 *       React 会卸载并重挂整棵子树，导致输入框失焦（输入一个数字后必须再点一次才能继续）
 */
export function ErrorBanner({ formError, dark }: { formError: string; dark?: boolean }) {
  if (!formError) return null
  return (
    <div className={`p-2.5 rounded-lg flex items-start gap-2 text-xs ${dark ? 'bg-red-500/10 border border-red-400/30 text-red-300' : 'bg-red-50 border border-red-200 text-red-600'}`}>
      <span className="flex-1">{formError}</span>
    </div>
  )
}

export interface PhoneRegisterSectionProps {
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

/** 手机号注册区块（移动端 + 桌面端共用） */
export function PhoneRegisterSection({
  dark, formError, phone, smsCode, loading, countdown, smsSent, smsCodeShown, agreeTerms, onAgreeTerms, onPhoneChange, onSmsChange, onSendSms, onRegister,
}: PhoneRegisterSectionProps) {
  return (
    <div className="space-y-3">
      <ErrorBanner formError={formError} dark={dark} />
      {/* 手机号输入 */}
      <div>
        <label className={`block text-sm mb-1.5 font-medium ${dark ? 'text-accent-300' : 'text-gray-600'}`}>手机号</label>
        <div className="relative">
          <Phone size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark ? 'text-accent-500' : 'text-gray-400'}`} />
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
          <MessageSquare size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark ? 'text-accent-500' : 'text-gray-400'}`} />
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
      <label className={`flex items-start gap-2 px-1 text-xs cursor-pointer select-none ${dark ? 'text-accent-400' : 'text-gray-500'}`}>
        <input
          type="checkbox"
          checked={agreeTerms}
          onChange={(e) => onAgreeTerms(e.target.checked)}
          className="mt-0.5 accent-primary-600"
        />
        <span>
          我已阅读并同意
          <Link to="/terms" target="_blank" className={`${dark ? 'text-accent-300 hover:text-white' : 'text-primary-600 hover:text-primary-700'} underline underline-offset-1`}>《用户协议》</Link>
          和
          <Link to="/prprivacy-policy" target="_blank" className={`${dark ? 'text-accent-300 hover:text-white' : 'text-primary-600 hover:text-primary-700'} underline underline-offset-1`}>《隐私政策》</Link>
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
      <p className={`text-center text-xs ${dark ? 'text-accent-500' : 'text-gray-400'}`}>
        自动绑定手机号，注册后可在安全中心设置密码
      </p>

    </div>
  )
}

export interface PhoneLoginSectionProps {
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

/** 手机号验证码登录区块（登录模式专用，无协议勾选） */
export function PhoneLoginSection({
  dark, formError, phone, smsCode, loading, countdown, smsSent, smsCodeShown,
  onPhoneChange, onSmsChange, onSendSms, onLogin,
}: PhoneLoginSectionProps) {
  return (
    <div className="space-y-3">
      <ErrorBanner formError={formError} dark={dark} />
      {/* 手机号输入 */}
      <div>
        <label className={`block text-sm mb-1.5 font-medium ${dark ? 'text-accent-300' : 'text-gray-600'}`}>手机号</label>
        <div className="relative">
          <Phone size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark ? 'text-accent-500' : 'text-gray-400'}`} />
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
          <MessageSquare size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark ? 'text-accent-500' : 'text-gray-400'}`} />
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
export function ForgotDialog({ showForgot, onClose }: { showForgot: boolean; onClose: () => void }) {
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
