/**
 * 创建 Matrix 房间弹窗 · Day 6 MVP
 * - 输入：房间名称（必填）
 * - 选项：E2EE 加密（默认开，Day 8-9 已就绪）
 * - 创建后自动 join + 刷新 rooms 列表
 */

import { useState } from 'react'
import { X, Lock, Hash, Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (name: string, opts: { isEncrypted: boolean }) => Promise<string>
  /** 是否允许加密（取决于 Rust crypto 初始化是否成功） */
  encryptionAvailable: boolean
}

export function MatrixCreateRoomModal({ open, onClose, onCreate, encryptionAvailable }: Props) {
  const [name, setName] = useState('')
  const [isEncrypted, setIsEncrypted] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请输入房间名称')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onCreate(trimmed, { isEncrypted: isEncrypted && encryptionAvailable })
      // 重置状态
      setName('')
      setIsEncrypted(true)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (submitting) return
    setName('')
    setIsEncrypted(true)
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
            <Hash size={16} className="text-primary-600" />
            <h3 className="font-semibold text-gray-800">新建群聊</h3>
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
          {/* 房间名称 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              群聊名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null) }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="例如：产品讨论组"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:border-primary-500 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-all"
              autoFocus
              maxLength={60}
            />
          </div>

          {/* E2EE 加密开关 */}
          <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-2">
              <Lock size={14} className={isEncrypted && encryptionAvailable ? 'text-emerald-500' : 'text-gray-400'} />
              <div>
                <div className="text-xs font-medium text-gray-700">端到端加密</div>
                <div className="text-[10px] text-gray-400">
                  {encryptionAvailable ? '消息仅群内成员可读' : 'Rust crypto 未就绪，暂不可用'}
                </div>
              </div>
            </div>
            <button
              onClick={() => encryptionAvailable && setIsEncrypted((v) => !v)}
              disabled={!encryptionAvailable}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                isEncrypted && encryptionAvailable ? 'bg-emerald-500' : 'bg-gray-300'
              } ${!encryptionAvailable ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                  isEncrypted && encryptionAvailable ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

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
            disabled={submitting || !name.trim()}
            className="px-4 py-1.5 text-sm text-white rounded-lg bg-gradient-accent hover:shadow-lg hover:shadow-primary-300/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {submitting ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
