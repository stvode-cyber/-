import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Shield, KeyRound, Loader2, AlertCircle } from 'lucide-react'
import Header from '../../components/Header'
import { Switch } from '../../components/ui/switch'
import { useToast } from '../../components/Toast'
import { api, unwrap } from '../../lib/api'
import { useAuthStore } from '../../stores/auth'

/**
 * 安全中心页（设置子页）
 *
 * - 修改登录密码：旧密码校验 + 新密码（8位+字母+数字）+ 不与旧密码相同
 * - 设置登录密码（手机注册用户）：仅需新密码，无需旧密码
 * - 支付密码：跳转钱包页（/wallet）
 * - 设备管理 / 登录历史：MVP 占位（Toast 提示）
 */
export default function SecuritySettingsPage() {
  const toast = useToast((s) => s.show)
  const { logout, setPassword, user } = useAuthStore()

  // 手机注册用户未设密码 → 显示"设置登录密码"，否则"修改登录密码"
  const hasPassword = user?.hasPassword !== false

  const [showPwdDialog, setShowPwdDialog] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const openDialog = () => {
    setOldPwd(''); setNewPwd(''); setConfirmPwd('')
    setShowOld(false); setShowNew(false)
    setShowPwdDialog(true)
  }

  const onSubmitChange = async (e: React.FormEvent) => {
    e.preventDefault()
    // 手机注册用户设置密码：不需要旧密码
    if (hasPassword && !oldPwd) {
      toast('请输入旧密码', 'error')
      return
    }
    if (!newPwd || !confirmPwd) {
      toast('请填写新密码', 'error')
      return
    }
    if (newPwd.length < 8) {
      toast('新密码至少 8 位', 'error')
      return
    }
    if (!/[a-zA-Z]/.test(newPwd) || !/\d/.test(newPwd)) {
      toast('新密码需同时包含字母和数字', 'error')
      return
    }
    if (newPwd !== confirmPwd) {
      toast('两次输入的新密码不一致', 'error')
      return
    }
    if (hasPassword && newPwd === oldPwd) {
      toast('新密码不能与旧密码相同', 'error')
      return
    }
    setSubmitting(true)
    try {
      if (hasPassword) {
        // 修改密码：需要旧密码
        await unwrap(api.post('/auth/change-password', { oldPassword: oldPwd, newPassword: newPwd }))
        toast('密码修改成功，其他设备需重新登录', 'success', 3500)
      } else {
        // 设置密码：手机注册用户首次设置，无需旧密码
        await setPassword(newPwd)
        toast('密码设置成功，现在可使用手机号+密码登录', 'success', 3500)
      }
      setShowPwdDialog(false)
    } catch (err) {
      const msg = (err as Error).message || ''
      if (msg.includes('旧密码')) {
        toast('旧密码错误，请重新输入', 'error')
      } else if (msg.includes('相同')) {
        toast('新密码不能与旧密码相同', 'error')
      } else if (msg.includes('已设置')) {
        toast('您已设置密码，请使用「修改密码」功能', 'error')
      } else {
        toast(`操作失败：${msg}`, 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="app-shell">
      <Header title="安全中心" />

      <div className="px-3 py-4 space-y-4">
        {/* 手机注册用户未设密码提示 */}
        {!hasPassword && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2">
            <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              您的账号通过手机号注册，尚未设置登录密码。设置密码后可使用手机号 + 密码登录。
            </p>
          </div>
        )}

        <section className="card">
          <div className="space-y-1">
            <button
              onClick={openDialog}
              className="w-full flex items-center justify-between py-2.5 border-b border-gray-50 hover:bg-gray-50 -mx-1 px-1 rounded"
            >
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <KeyRound size={16} className="text-primary-500" />
                {hasPassword ? '修改登录密码' : '设置登录密码'}
              </span>
              <ChevronRight size={16} className="text-gray-300" />
            </button>
            <Link
              to="/wallet"
              className="flex items-center justify-between py-2.5 border-b border-gray-50 hover:bg-gray-50 -mx-1 px-1 rounded"
            >
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <Shield size={16} className="text-gray-400" /> 支付密码
              </span>
              <ChevronRight size={16} className="text-gray-300" />
            </Link>
            <button
              onClick={() => toast('设备管理：MVP 阶段待完善', 'info')}
              className="w-full flex items-center justify-between py-2.5 border-b border-gray-50 hover:bg-gray-50 -mx-1 px-1 rounded"
            >
              <span className="text-sm text-gray-600">设备管理</span>
              <ChevronRight size={16} className="text-gray-300" />
            </button>
            <button
              onClick={() => toast('登录历史：MVP 阶段待完善', 'info')}
              className="w-full flex items-center justify-between py-2.5 hover:bg-gray-50 -mx-1 px-1 rounded"
            >
              <span className="text-sm text-gray-600">登录历史</span>
              <ChevronRight size={16} className="text-gray-300" />
            </button>
          </div>
        </section>

        <section className="card">
          <button
            onClick={() => {
              if (confirm('确定退出当前账号吗？')) logout()
            }}
            className="w-full py-2.5 text-sm text-red-500 hover:bg-red-50 rounded transition-colors"
          >
            退出登录
          </button>
        </section>
      </div>

      {/* 设置/修改密码弹窗 */}
      {showPwdDialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50" onClick={() => !submitting && setShowPwdDialog(false)}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <KeyRound size={18} className="text-primary-500" />
                {hasPassword ? '修改登录密码' : '设置登录密码'}
              </h3>
              {!submitting && (
                <button onClick={() => setShowPwdDialog(false)} aria-label="关闭" className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              )}
            </div>
            <form onSubmit={onSubmitChange} className="space-y-3">
              {/* 旧密码：仅已设密码用户需要 */}
              {hasPassword && (
                <div>
                  <label id="old-pwd-label" className="block text-xs text-gray-500 mb-1">旧密码</label>
                  <div className="relative flex items-center gap-2">
                    <input
                      type={showOld ? 'text' : 'password'}
                      className="input pr-9 flex-1"
                      placeholder="请输入旧密码"
                      value={oldPwd}
                      onChange={(e) => setOldPwd(e.target.value)}
                      autoComplete="current-password"
                      disabled={submitting}
                    />
                    <Switch
                      checked={showOld}
                      onChange={setShowOld}
                      size="sm"
                      aria-labelledby="old-pwd-label"
                      aria-describedby="old-pwd-desc"
                      testId="toggle-old-pwd"
                    />
                  </div>
                  <p id="old-pwd-desc" className="sr-only">{showOld ? '密码可见' : '密码已隐藏'}</p>
                </div>
              )}
              <div>
                <label id="new-pwd-label" className="block text-xs text-gray-500 mb-1">新密码</label>
                <div className="relative flex items-center gap-2">
                  <input
                    type={showNew ? 'text' : 'password'}
                    className="input pr-9 flex-1"
                    placeholder="至少8位，含字母和数字"
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    autoComplete="new-password"
                    disabled={submitting}
                  />
                  <Switch
                    checked={showNew}
                    onChange={setShowNew}
                    size="sm"
                    aria-labelledby="new-pwd-label"
                    aria-describedby="new-pwd-desc"
                    testId="toggle-new-pwd"
                  />
                </div>
                <p id="new-pwd-desc" className="sr-only">{showNew ? '密码可见' : '密码已隐藏'}</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">确认新密码</label>
                <input
                  type={showNew ? 'text' : 'password'}
                  className="input"
                  placeholder="再次输入新密码"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  autoComplete="new-password"
                  disabled={submitting}
                />
              </div>
              <button type="submit" disabled={submitting} className="btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                {submitting ? <><Loader2 size={14} className="animate-spin" /> 提交中...</> : (hasPassword ? '确认修改' : '确认设置')}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
