/**
 * Matrix 房间成员面板 · Day 6b
 * - 展示当前房间所有成员（按 powerLevel 降序）
 * - 邀请按钮（标题栏，权限检查通过才显示）
 * - 踢人按钮（成员行，权限检查通过才显示）
 *
 * 权限规则（Matrix 默认值）：
 *   invite: private room 0（任何人能邀），public room 50
 *   kick/ban: 50（管理员以上）
 *   不能踢自己，不能踢 powerLevel >= 自己的人
 */

import { X, Crown, Shield, User, UserPlus, UserMinus } from 'lucide-react'
import type { MatrixMember } from '../../lib/matrixClient'

interface Props {
  open: boolean
  members: MatrixMember[]
  onClose: () => void
  currentUserId: string | null
  /** Day 6b：当前用户是否有邀请权限 */
  canInvite: boolean
  /** Day 6b：判断当前用户是否能踢某个成员（取决于两边 powerLevel） */
  canKickMember: (userId: string) => boolean
  /** Day 6b：点击邀请按钮 */
  onInviteClick: () => void
  /** Day 6b：点击踢人按钮 */
  onKickClick: (userId: string) => void
}

export function MatrixMemberPanel({
  open,
  members,
  onClose,
  currentUserId,
  canInvite,
  canKickMember,
  onInviteClick,
  onKickClick,
}: Props) {
  if (!open) return null

  // 排序：join 的在最前，按 powerLevel 降序；invite/leave/ban 的在后
  const sorted = [...members].sort((a, b) => {
    const order = { join: 0, invite: 1, knock: 2, leave: 3, ban: 4 } as const
    const oa = order[a.membership] ?? 5
    const ob = order[b.membership] ?? 5
    if (oa !== ob) return oa - ob
    return b.powerLevel - a.powerLevel
  })

  return (
    <div className="w-60 flex-shrink-0 bg-white border-l border-primary-100 flex flex-col h-full">
      {/* 标题栏 */}
      <div className="px-3 py-3 border-b border-primary-50 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-primary-700">
          <User size={14} />
          <span>成员 ({members.filter((m) => m.membership === 'join').length})</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Day 6b：邀请按钮（有权限才显示） */}
          {canInvite && (
            <button
              onClick={onInviteClick}
              className="p-1 rounded-md bg-primary-50 text-primary-600 hover:bg-primary-100 transition-colors"
              title="邀请成员"
            >
              <UserPlus size={12} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 成员列表 */}
      <div className="flex-1 overflow-y-auto py-1">
        {sorted.map((m) => {
          const isSelf = m.userId === currentUserId
          const isCreator = m.powerLevel >= 100
          const isAdmin = m.powerLevel >= 50 && m.powerLevel < 100
          const isMod = m.powerLevel >= 10 && m.powerLevel < 50
          const isInvited = m.membership === 'invite'
          const isLeft = m.membership === 'leave' || m.membership === 'ban'
          const canKickThis = canKickMember(m.userId)

          return (
            <div
              key={m.userId}
              className={`px-3 py-2 flex items-center gap-2 group ${
                isLeft ? 'opacity-40' : ''
              }`}
            >
              {/* 头像占位 */}
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${
                  isCreator
                    ? 'bg-gradient-accent text-white'
                    : isAdmin
                    ? 'bg-violet-100 text-violet-700'
                    : isMod
                    ? 'bg-sky-100 text-sky-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {m.name.charAt(0).toUpperCase()}
              </div>

              {/* 昵称 + 标签 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-gray-800 truncate">
                    {m.name}
                    {isSelf && <span className="text-[10px] text-primary-500 ml-1">(我)</span>}
                  </span>
                  {isCreator && <span title="创建者"><Crown size={11} className="text-amber-500 flex-shrink-0" /></span>}
                  {isAdmin && <span title="管理员"><Shield size={11} className="text-violet-500 flex-shrink-0" /></span>}
                </div>
                <div className="text-[10px] text-gray-400 truncate">{m.userId}</div>
              </div>

              {/* 状态标签 + 踢人按钮 */}
              <div className="flex items-center gap-1">
                {isInvited && (
                  <span className="text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded flex-shrink-0">
                    待加入
                  </span>
                )}
                {isLeft && m.membership === 'ban' && (
                  <span className="text-[9px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded flex-shrink-0">
                    已禁言
                  </span>
                )}
                {/* Day 6b：踢人按钮（hover 出现 + 权限检查） */}
                {canKickThis && !isSelf && (
                  <button
                    onClick={() => onKickClick(m.userId)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-red-400 hover:bg-red-50 hover:text-red-600 transition-all flex-shrink-0"
                    title="移出群聊"
                  >
                    <UserMinus size={12} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
