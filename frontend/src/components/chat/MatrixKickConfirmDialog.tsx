/**
 * Matrix 踢人确认弹窗 · Day 6b
 * - 防误操作：必须明确显示 target 用户 + 群名
 * - 确认后调 kickUser
 */

import { AlertTriangle, X, Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
  targetName: string
  targetUserId: string
  roomName?: string
  submitting?: boolean
}

export function MatrixKickConfirmDialog({
  open,
  onClose,
  onConfirm,
  targetName,
  targetUserId,
  roomName,
  submitting,
}: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={!submitting ? onClose : undefined}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[360px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 警告标题栏 */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 bg-amber-50/60">
          <AlertTriangle size={16} className="text-amber-500" />
          <h3 className="font-semibold text-gray-800">移出成员</h3>
          <button
            onClick={onClose}
            disabled={submitting}
            className="ml-auto p-1 rounded-md hover:bg-gray-100 text-gray-400 disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-5 py-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            确定要将以下成员移出群聊吗？
          </p>
          <div className="mt-3 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
            <div className="text-sm font-medium text-gray-800">{targetName}</div>
            <div className="text-[10px] text-gray-400 font-mono mt-0.5">{targetUserId}</div>
          </div>
          {roomName && (
            <div className="mt-2 text-[11px] text-gray-500">
              来自群聊：<span className="font-medium text-gray-700">{roomName}</span>
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-400">
            移出后该用户无法发送/接收消息，但可通过新邀请重新加入。
          </p>
        </div>

        {/* 按钮栏 */}
        <div className="px-5 py-3 border-t border-gray-100 flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-1.5 text-sm text-gray-600 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="px-4 py-1.5 text-sm text-white rounded-lg bg-red-500 hover:bg-red-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {submitting ? '移出中...' : '确认移出'}
          </button>
        </div>
      </div>
    </div>
  )
}
