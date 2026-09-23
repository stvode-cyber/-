import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Users, UserPlus, Search, MoreVertical, Pin, BellOff, ChevronLeft, MessageSquare } from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import AddFriendModal from '../components/chat/AddFriendModal'
import CreateGroupModal from '../components/chat/CreateGroupModal'
import FriendsPanel from '../components/chat/FriendsPanel'

/**
 * 微信式会话列表页（/chat）
 *
 * 设计要点：
 * - 顶部固定标题"消息" + 右上角 + 按钮（添加好友/发起群聊）
 * - 列表项：头像 + 名称（备注覆盖昵称） + 最近消息预览 + 时间 + 未读红点
 * - 排序：pinned 置顶 > lastMessageAt 倒序
 * - 点击进入对应会话页：
 *   - AI 助理 → /chat/ai（保留原 ChatPage，含 DG-* 卡片能力）
 *   - 用户私聊 → /chat/u/:convId
 *   - 群聊 → /chat/g/:convId
 */

interface ConversationUser {
  id: string
  username: string
  nickname: string | null
  avatar: string | null
}

interface ConversationGroup {
  id: string
  name: string
  avatar: string | null
}

interface Conversation {
  id: string
  type: 'ai' | 'user' | 'group'
  pinned: boolean
  muted: boolean
  unreadCount: number
  lastMessageAt: string | null
  lastMessagePreview: string | null
  remark: string | null
  sessionId: string | null
  targetUserId: string | null
  groupId: string | null
  targetUser: ConversationUser | null
  group: ConversationGroup | null
}

/** 获取会话显示名称（备注 > 昵称 > 用户名 > 群名 > 绿角犀） */
function getDisplayName(conv: Conversation): string {
  if (conv.type === 'ai') return '绿角犀'
  if (conv.type === 'user' && conv.targetUser) {
    return conv.remark || conv.targetUser.nickname || conv.targetUser.username
  }
  if (conv.type === 'group' && conv.group) {
    return conv.group.name
  }
  return '未知会话'
}

/** 获取头像（支持 data URL / http / 相对路径 / emoji） */
function isImageAvatar(avatar: string | null | undefined): avatar is string {
  return !!avatar && (
    avatar.startsWith('data:image') ||
    avatar.startsWith('http') ||
    avatar.startsWith('/')
  )
}

function getAvatar(conv: Conversation): { src: string } | { emoji: string } {
  if (conv.type === 'ai') return { src: '/default-avatar.jpg' }
  if (conv.type === 'user' && conv.targetUser) {
    if (isImageAvatar(conv.targetUser.avatar)) return { src: conv.targetUser.avatar }
    return { emoji: conv.targetUser.avatar || '👤' }
  }
  if (conv.type === 'group') return { emoji: '👥' }
  return { emoji: '💬' }
}

/** 格式化时间（最近消息时间） */
function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const oneDay = 24 * 60 * 60 * 1000
  if (diff < oneDay && now.getDate() === d.getDate()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (diff < 2 * oneDay) return '昨天'
  if (diff < 7 * oneDay) {
    const days = ['日', '一', '二', '三', '四', '五', '六']
    return `周${days[d.getDay()]}`
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function ChatListPage() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [convs, setConvs] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showAddFriend, setShowAddFriend] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [activeConvMenu, setActiveConvMenu] = useState<string | null>(null)
  // 视图切换：消息 / 好友
  const [view, setView] = useState<'messages' | 'friends'>('messages')
  // 待处理好友请求数（红点提示）
  const [pendingCount, setPendingCount] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await unwrap<Conversation[]>(api.get('/conversations'))
      setConvs(list)
    } catch (e: any) {
      setError(e?.message || '加载会话失败')
    } finally {
      setLoading(false)
    }
  }, [])

  /** 加载待处理好友请求数（静默，仅用于红点） */
  const loadPendingCount = useCallback(async () => {
    try {
      const list = await unwrap<unknown[]>(api.get('/conversations/friends/pending'))
      setPendingCount(Array.isArray(list) ? list.length : 0)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load()
    loadPendingCount()
  }, [load, loadPendingCount])

  // 进入页面时点击返回按钮（如果是手机端有历史）→ 否则回到首页
  const handleClickConversation = (conv: Conversation) => {
    if (conv.type === 'ai') {
      nav('/chat/ai')
    } else if (conv.type === 'user') {
      nav(`/chat/u/${conv.id}`)
    } else if (conv.type === 'group') {
      nav(`/chat/g/${conv.id}`)
    }
  }

  // 标记已读
  const handleMarkRead = async (conv: Conversation) => {
    try {
      await api.patch(`/conversations/${conv.id}/read`)
      setConvs((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c)),
      )
    } catch {
      /* ignore */
    }
  }

  // 切换置顶
  const togglePin = async (conv: Conversation) => {
    try {
      await api.patch(`/conversations/${conv.id}/pin`, { value: !conv.pinned })
      setConvs((prev) =>
        prev.map((c) =>
          c.id === conv.id ? { ...c, pinned: !c.pinned } : c,
        ),
      )
    } catch {
      /* ignore */
    }
    setActiveConvMenu(null)
  }

  // 切换免打扰
  const toggleMute = async (conv: Conversation) => {
    try {
      await api.patch(`/conversations/${conv.id}/mute`, { value: !conv.muted })
      setConvs((prev) =>
        prev.map((c) =>
          c.id === conv.id ? { ...c, muted: !c.muted } : c,
        ),
      )
    } catch {
      /* ignore */
    }
    setActiveConvMenu(null)
  }

  // 设置备注名（仅 user 会话）
  const handleSetRemark = async (conv: Conversation) => {
    const remark = window.prompt('设置备注名（留空清除）', conv.remark || '')
    if (remark === null) return
    try {
      await api.patch(`/conversations/${conv.id}/remark`, { remark })
      setConvs((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, remark } : c)),
      )
    } catch {
      /* ignore */
    }
    setActiveConvMenu(null)
  }

  return (
    <div className="min-h-screen flex flex-col bg-primary-50/30">
      {/* 顶部标题栏 */}
      <header
        className="sticky top-0 z-30 bg-gradient-to-br from-primary-500 to-teal-500 text-white shadow-md"
      >
        <div className="flex items-center justify-between px-4 py-3">
          {/* 视图切换：消息 / 好友 */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => setView('messages')}
              className={`flex items-center gap-1.5 text-base transition-opacity ${
                view === 'messages' ? 'font-semibold opacity-100' : 'opacity-60'
              }`}
            >
              <MessageSquare size={18} />
              消息
            </button>
            <button
              onClick={() => setView('friends')}
              className={`relative flex items-center gap-1.5 text-base transition-opacity ${
                view === 'friends' ? 'font-semibold opacity-100' : 'opacity-60'
              }`}
            >
              <Users size={18} />
              好友
              {pendingCount > 0 && (
                <span className="absolute -top-1.5 -right-5 min-w-[16px] h-4 px-1 bg-urgent text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {pendingCount > 9 ? '9+' : pendingCount}
                </span>
              )}
            </button>
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              aria-label="更多操作"
            >
              <Plus size={22} />
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 z-50 bg-white rounded-2xl shadow-lg shadow-black/10 overflow-hidden min-w-[160px]">
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      setShowAddFriend(true)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-primary-50 transition-colors"
                  >
                    <UserPlus size={18} className="text-primary-500" />
                    <span>添加好友</span>
                    {pendingCount > 0 && (
                      <span className="ml-auto min-w-[16px] h-4 px-1 bg-urgent text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                        {pendingCount > 9 ? '9+' : pendingCount}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      setShowCreateGroup(true)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-primary-50 transition-colors border-t border-gray-100"
                  >
                    <Users size={18} className="text-accent-500" />
                    <span>发起群聊</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 好友视图 */}
      {view === 'friends' ? (
        <FriendsPanel
          onAddFriend={() => setShowAddFriend(true)}
          onChanged={() => {
            load()
            loadPendingCount()
          }}
        />
      ) : (
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingState text="加载会话..." />
        ) : error ? (
          <ErrorState text={error} onRetry={load} />
        ) : convs.length === 0 ? (
          <EmptyState
            icon="💬"
            text="还没有会话"
            hint="AI 助理已就绪，点击右上角添加好友开启聊天吧"
            action={
              <button
                onClick={() => setShowAddFriend(true)}
                className="btn-primary text-sm"
              >
                添加好友
              </button>
            }
          />
        ) : (
          <ul className="bg-white divide-y divide-gray-50">
            {convs.map((conv) => {
              const avatar = getAvatar(conv)
              const name = getDisplayName(conv)
              const time = formatTime(conv.lastMessageAt)
              const preview =
                conv.lastMessagePreview ||
                (conv.type === 'ai' ? '有什么可以帮你？点我开始聊天' : '暂无消息')
              return (
                <li
                  key={conv.id}
                  className="relative hover:bg-primary-50/30 transition-colors"
                >
                  <button
                    onClick={() => handleClickConversation(conv)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setActiveConvMenu(
                        activeConvMenu === conv.id ? null : conv.id,
                      )
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-primary-50/50"
                  >
                    {/* 头像 */}
                    <div className="relative flex-shrink-0">
                      {'src' in avatar ? (
                        <img
                          src={avatar.src}
                          alt={name}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center text-2xl">
                          {avatar.emoji}
                        </div>
                      )}
                      {/* 未读红点 */}
                      {conv.unreadCount > 0 && !conv.muted && (
                        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 bg-urgent text-white text-xs font-bold rounded-full flex items-center justify-center">
                          {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                        </span>
                      )}
                      {/* 免打扰小点 */}
                      {conv.muted && conv.unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-gray-400 border-2 border-white" />
                      )}
                    </div>

                    {/* 名称 + 预览 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-900 truncate">
                          {name}
                        </span>
                        {conv.pinned && (
                          <Pin size={12} className="text-primary-400 flex-shrink-0" />
                        )}
                        {conv.muted && (
                          <BellOff size={12} className="text-gray-400 flex-shrink-0" />
                        )}
                        {conv.type === 'group' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-100 text-accent-700">
                            群
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {preview}
                      </p>
                    </div>

                    {/* 时间 */}
                    <div className="flex-shrink-0 text-xs text-gray-400">
                      {time}
                    </div>
                  </button>

                  {/* 长按/右键菜单 */}
                  {activeConvMenu === conv.id && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setActiveConvMenu(null)}
                      />
                      <div className="absolute right-4 top-2 z-50 bg-white rounded-xl shadow-lg shadow-black/10 overflow-hidden min-w-[140px]">
                        {conv.unreadCount > 0 && (
                          <button
                            onClick={() => handleMarkRead(conv)}
                            className="w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-primary-50 text-left"
                          >
                            标为已读
                          </button>
                        )}
                        <button
                          onClick={() => togglePin(conv)}
                          className="w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-primary-50 text-left"
                        >
                          {conv.pinned ? '取消置顶' : '置顶'}
                        </button>
                        <button
                          onClick={() => toggleMute(conv)}
                          className="w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-primary-50 text-left"
                        >
                          {conv.muted ? '取消免打扰' : '消息免打扰'}
                        </button>
                        {conv.type === 'user' && (
                          <button
                            onClick={() => handleSetRemark(conv)}
                            className="w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-primary-50 text-left border-t border-gray-50"
                          >
                            设置备注名
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      )}

      {/* 添加好友弹层 */}
      {showAddFriend && (
        <AddFriendModal
          onClose={() => setShowAddFriend(false)}
          onSuccess={() => {
            setShowAddFriend(false)
            load()
            loadPendingCount()
          }}
        />
      )}

      {/* 发起群聊弹层 */}
      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          onSuccess={() => {
            setShowCreateGroup(false)
            load()
          }}
        />
      )}
    </div>
  )
}
