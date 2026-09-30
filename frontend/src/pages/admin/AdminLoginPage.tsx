import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/auth'
import { useToast } from '../../components/Toast'
import { ArrowRight } from 'lucide-react'

/**
 * 管理后台登录页 — 极简
 *
 * 与客户端 LoginPage 分离，只保留 admin 真正需要的：
 * - Logo + 用户名 + 密码 + 登录按钮
 * - 白底浅灰 + 蓝紫品牌色（与 AdminLayout 统一）
 * - 登录后校验 role === 'admin'，非管理员拒绝
 *
 * 为什么不共用 LoginPage.tsx？
 * LoginPage.tsx 841 行，包含手机号注册、验证码登录、忘记密码、
 * 客户端功能亮点、DEV 一键进入等一堆 admin 不需要的东西。
 * 共用 → 加 variant props → 文件更大更难维护。
 * 独立文件，admin 路径 → AdminLoginPage，客户端路径 → LoginPage，清晰。
 */
export default function AdminLoginPage() {
  const { login } = useAuthStore()
  const toast = useToast((s) => s.show)
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) { setFormError('请输入用户名和密码'); return }
    setLoading(true); setFormError('')
    try {
      const res: any = await login(username, password)
      if (res?.user?.role !== 'admin') {
        setFormError('该账号无管理员权限')
        toast('该账号无管理员权限', 'error', 3000)
        return
      }
      toast('登录成功', 'success')
      navigate('/admin')
    } catch (err: any) {
      const msg = err?.message || '登录失败'
      setFormError(msg)
      toast(msg, 'error', 3000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-[380px] px-6">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-10">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-sm"
            style={{ background: 'linear-gradient(135deg, #2563EB 0%, #4F46E5 100%)' }}
          >L</div>
          <div>
            <div className="font-semibold text-gray-900 leading-tight">绿角犀</div>
            <div className="text-[11px] text-gray-400 leading-tight">运营后台</div>
          </div>
        </div>

        {/* 标题 */}
        <h1 className="text-2xl font-bold text-gray-900">管理员登录</h1>
        <p className="text-[13px] text-gray-500 mt-1.5">请使用管理员账号登录运营后台</p>

        {/* 表单 */}
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {formError && (
            <div className="p-2.5 rounded-lg text-xs bg-red-50 border border-red-200 text-red-600">
              {formError}
            </div>
          )}
          <div>
            <label className="block text-[13px] text-gray-600 mb-1.5 font-medium">用户名</label>
            <input
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 outline-none transition"
              placeholder="请输入用户名"
              value={username}
              onChange={(e) => { setUsername(e.target.value); if (formError) setFormError('') }}
              autoComplete="username"
              disabled={loading}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[13px] text-gray-600 mb-1.5 font-medium">密码</label>
            <input
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 outline-none transition"
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (formError) setFormError('') }}
              autoComplete="current-password"
              disabled={loading}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-sm disabled:opacity-50 hover:shadow-md hover:shadow-blue-500/25 transition-all flex items-center justify-center gap-2"
          >
            {loading ? '登录中...' : '登 录'}
            {!loading && <ArrowRight size={14} />}
          </button>
        </form>

        {/* 底部 */}
        <div className="mt-10 text-center text-[11px] text-gray-300">
          v1.0.6 · 绿角犀运营后台
        </div>
      </div>
    </div>
  )
}
