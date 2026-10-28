/**
 * Day 7b：Matrix 邀请链接接受页
 *
 * 用户点击绿角犀分享的邀请链接 → /chat/join?token=xxx → 此页自动：
 * 1. 未登录 → 跳 /login?redirect=/chat/join?token=xxx → 登录后跳回来
 * 2. 已登录 → POST /api/v1/matrix/accept-invite { token } → 后端验签 + joinRoom
 * 3. 成功 → 跳 /chat/ai（ChatPage）
 * 4. 失败 → 显示错误，提供重试按钮
 */

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

export default function JoinInvitePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, token } = useAuthStore()

  const [status, setStatus] = useState<'loading' | 'error' | 'success'>('loading')
  const [errMsg, setErrMsg] = useState<string>('')
  const [roomId, setRoomId] = useState<string>('')

  const inviteToken = searchParams.get('token') || ''

  useEffect(() => {
    // 没有 token → 无效邀请
    if (!inviteToken) {
      setStatus('error')
      setErrMsg('邀请链接无效（缺少 token 参数）')
      return
    }

    // 未登录 → 跳登录，带 redirect 回来
    if (!token || !user) {
      const redirect = `/chat/join?token=${encodeURIComponent(inviteToken)}`
      navigate(`/login?redirect=${encodeURIComponent(redirect)}`, { replace: true })
      return
    }

    // 已登录 → 调后端 accept-invite
    ;(async () => {
      try {
        const res = await api.post('/matrix/accept-invite', { token: inviteToken })
        // api 拦截器已解包 { code, data }
        const data = res.data?.data || res.data
        if (data?.ok) {
          setRoomId(data.roomId || '')
          setStatus('success')
          // 成功后 1.5s 自动跳 ChatPage
          setTimeout(() => navigate('/chat/ai', { replace: true }), 1500)
        } else {
          throw new Error(data?.message || '接受邀请失败')
        }
      } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || '网络请求失败'
        setStatus('error')
        setErrMsg(msg)
      }
    })()
  }, [inviteToken, token, user, navigate])

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4">
        <div className="text-4xl animate-bounce">💬</div>
        <p className="text-gray-500">正在接受邀请...</p>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4">
        <div className="text-4xl">🎉</div>
        <h2 className="text-xl font-semibold text-gray-800">已加入房间</h2>
        {roomId && (
          <p className="text-sm text-gray-500 font-mono break-all max-w-sm text-center">{roomId}</p>
        )}
        <p className="text-gray-400 text-sm">正在跳转到聊天...</p>
      </div>
    )
  }

  // error
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4 px-6">
      <div className="text-4xl">😕</div>
      <h2 className="text-xl font-semibold text-gray-800">无法加入房间</h2>
      <p className="text-red-500 text-center max-w-sm">{errMsg}</p>
      <div className="flex gap-3">
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-[#00856A] text-white rounded-lg hover:bg-[#006e58] transition-colors"
        >
          重试
        </button>
        <button
          onClick={() => navigate('/chat/ai', { replace: true })}
          className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
        >
          回到聊天
        </button>
      </div>
    </div>
  )
}
