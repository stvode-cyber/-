/**
 * Matrix 邀请弹窗 · Day 6b
 * - 输入 Matrix user_id（如 @用户名:lujax.fun）
 * - 调用 hooks 层 inviteUser
 */

import { useState } from 'react'
import { X, UserPlus, Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onInvite: (userId: string) => Promise<void>
  /** 当前房间名（显示用） */
  roomName?: string
}

export function MatrixInviteModal({ open, onClose, onInvite, roomName }: Props) {
  const [userId, setUserId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const isValidUserId = (u: string) => {
    // Matrix user_id 格式：@localpart:homeserver
    return /^@[a-zA-Z0-9._\-]+:.+$/.test(u.trim())
  }

  const handleSubmit = async () => {
    const trimmed = userId.trim()
    if (!trimmed) {
      setError('请输入用户 ID')
      return
    }
    if (!isValidUserId(trimmed)) {
      setError('格式应为 @用户名:homeserver，如 @alice:lujax.fun')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onInvite(trimmed)
      setUserId('')
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '邀请失败'
      // Matrix 常见错误提示优化
      if (msg.includes('is already in the room')) {
        setError('该用户已在群内')
      } else if (msg.includes('not found')) {
        setError('找不到该用户，请确认 user_id 正确')
      } else if (msg.includes('power')) {
        setError('权限不足，无法邀请')
      } else {
        setError(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (submitting) return
    setUserId('')
    setError(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={handleClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[380px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus size={16} className="text-primary-600" />
            <h3 className="font-semibold text-gray-800">邀请成员</h3>
          </div>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="p-1 rounded-md hover:bg-gray-100 text-gray-400 disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        {/* 表单 */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Matrix 用户 ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={userId}
              onChange={(e) => { setUserId(e.target.value); setError(null) }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="@用户名:homeserver"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:border-primary-500 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-all font-mono"
              autoFocus
              maxLength={120}
            />
            <div className="text-[10px] text-gray-400 mt-1">
              例：@alice:lujax.fun 或 @bob:matrix.org
            </div>
          </div>

          {roomName && (
            <div className="text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              邀请到：<span className="font-medium text-gray-700">{roomName}</span>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* 按钮栏 */}
        <div className="px-5 py-3 border-t border-gray-100 flex gap-2 justify-end">
          <button
            onClick={handleClose}
            disabled={submitting}
            className="px-4 py-1.5 text-sm text-gray-600 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !userId.trim()}
            className="px-4 py-1.5 text-sm text-white rounded-lg bg-gradient-accent hover:shadow-lg hover:shadow-primary-300/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {submitting ? '邀请中...' : '发送邀请'}
          </button>
        </div>
      </div>
    </div>
  )
}
