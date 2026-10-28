/**
 * Matrix 房间列表侧边栏 · Day 7a 扩展
 * - Day 6 MVP：房间列表 + 新建按钮
 * - Day 7a：每个房间卡片 hover 显示分享链接按钮（复制 matrix.to 链接）
 */

import { Plus, Hash, Lock, Users, Link2 } from 'lucide-react'
import type { MatrixRoomSummary } from '../../lib/matrixClient'

interface Props {
  rooms: MatrixRoomSummary[]
  currentRoomId: string | null
  onSelectRoom: (roomId: string) => void
  onCreateRoom: () => void
  /** Day 7a：点击分享链接按钮 */
  onShareLink: (roomId: string) => void
  disabled?: boolean
}

export function MatrixRoomSidebar({
  rooms,
  currentRoomId,
  onSelectRoom,
  onCreateRoom,
  onShareLink,
  disabled,
}: Props) {
  return (
    <div className="w-60 flex-shrink-0 bg-white border-r border-primary-100 flex flex-col h-full">
      {/* 顶部标题栏 */}
      <div className="px-3 py-3 border-b border-primary-50 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-primary-700">
          <Hash size={14} />
          <span>群聊列表</span>
        </div>
        <button
          onClick={onCreateRoom}
          disabled={disabled}
          className="p-1 rounded-md bg-primary-50 text-primary-600 hover:bg-primary-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="新建房间"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* 房间列表（滚动） */}
      <div className="flex-1 overflow-y-auto py-1">
        {rooms.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">
            还没有加入任何群聊
          </div>
        ) : (
          rooms.map((room) => {
            const active = room.roomId === currentRoomId
            return (
              <div key={room.roomId} className="group relative">
                <button
                  onClick={() => onSelectRoom(room.roomId)}
                  disabled={disabled}
                  className={`w-full text-left px-3 py-2.5 transition-colors border-l-2 ${
                    active
                      ? 'bg-primary-50 border-primary-500 text-primary-800'
                      : 'border-transparent hover:bg-gray-50 text-gray-700'
                  } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    {room.encryption ? (
                      <Lock size={11} className="text-emerald-500 flex-shrink-0" />
                    ) : (
                      <Hash size={11} className="text-gray-400 flex-shrink-0" />
                    )}
                    <span className="font-medium text-sm truncate flex-1">
                      {room.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1 ml-[22px] text-[10px] text-gray-400">
                    <Users size={10} />
                    <span>{room.memberCount} 人</span>
                    {room.lastMessageAt > 0 && (
                      <>
                        <span>·</span>
                        <span>{formatRelative(room.lastMessageAt)}</span>
                      </>
                    )}
                  </div>
                </button>

                {/* Day 7a：分享链接按钮（hover 出现） */}
                {!disabled && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onShareLink(room.roomId)
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all p-1.5 rounded-md text-gray-400 hover:bg-primary-50 hover:text-primary-600"
                    title="复制邀请链接"
                  >
                    <Link2 size={12} />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/** 相对时间（今天 HH:mm / 昨天 / N 天前） */
function formatRelative(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  const oneDayMs = 24 * 60 * 60 * 1000

  if (diff < oneDayMs) {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  if (diff < 2 * oneDayMs) return '昨天'
  if (diff < 7 * oneDayMs) return `${Math.floor(diff / oneDayMs)} 天前`
  return new Date(ts).toLocaleDateString()
}
