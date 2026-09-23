import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserPlus, Pin, Trash2, Edit3, MessageCircle } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { LoadingState, ErrorState, EmptyState } from '../StateView'

/**
 * 好友列表面板（嵌入消息页「好友」视图）
 *
 * - 展示已接受好友（备注 > 昵称 > 用户名）
 * - 点击好友 → 自动创建/复用私聊会话并进入聊天
 * - 长按/右键：设置备注名 / 删除好友
 * - 顶部搜索框本地过滤
 *
 * 接口：
 * - GET    /conversations/friends              好友列表
 * - POST   /conversations/friends/:id/conversation 与好友开启私聊
 * - PATCH  /conversations/friends/:id/remark   设置备注名（id 为对方用户 ID）
 * - DELETE /conversations/friends/:id          删除好友（id 为对方用户 ID）
 */

interface Friend {
  id: string
  username: string
  friend: {
    id: string
    username: string
    nickname: string | null
    avatar: string | null
  }
  remark: string | null
}

function isImgAvatar(avatar: string | null | undefined): avatar is string {
  return !!avatar && (
    avatar.startsWith('data:image') ||
    avatar.startsWith('http') ||
    avatar.startsWith('/')
  )
}

export default function FriendsPanel({
  onAddFriend,
  onChanged,
}: {
  /** 点击「添加好友」入口（打开添加好友弹层） */
  onAddFriend: () => void
  /** 好友关系变化（删除/备注）后通知父级刷新会话列表 */
  onChanged?: () => void
}) {
  const nav = useNavigate()
  const [friends, setFriends] = useState<Friend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [enteringId, setEnteringId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await unwrap<Friend[]>(api.get('/conversations/friends'))
      setFriends(list)
    } catch (e: any) {
      setError(e?.message || '加载好友失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /** 进入私聊：自动创建/复用会话 */
  const openChat = async (f: Friend) => {
    if (enteringId) return
    setEnteringId(f.friend.id)
    try {
      const conv = await unwrap<{ id: string }>(
        api.post(`/conversations/friends/${f.friend.id}/conversation`),
      )
      nav(`/chat/u/${conv.id}`)
    } catch {
      /* 失败静默，错误由拦截器 toast */
    } finally {
      setEnteringId(null)
    }
  }

  /** 设置备注名 */
  const setRemark = async (f: Friend) => {
    setMenuOpenId(null)
    const remark = window.prompt('设置备注名（留空清除）', f.remark || '')
    if (remark === null) return
    try {
      await api.patch(`/conversations/friends/${f.friend.id}/remark`, { remark })
      setFriends((prev) =>
        prev.map((x) => (x.id === f.id ? { ...x, remark } : x)),
      )
      onChanged?.()
    } catch {
      /* ignore */
    }
  }

  /** 删除好友 */
  const removeFriend = async (f: Friend) => {
    setMenuOpenId(null)
    const name = f.remark || f.friend.nickname || f.friend.username
    if (!window.confirm(`确定删除好友「${name}」吗？聊天记录将一并删除`)) return
    try {
      await api.delete(`/conversations/friends/${f.friend.id}`)
      setFriends((prev) => prev.filter((x) => x.id !== f.id))
      onChanged?.()
    } catch {
      /* ignore */
    }
  }

  /** 本地过滤：备注/昵称/用户名 */
  const filtered = friends.filter((f) => {
    if (!keyword.trim()) return true
    const kw = keyword.trim().toLowerCase()
    return (
      (f.remark || '').toLowerCase().includes(kw) ||
      (f.friend.nickname || '').toLowerCase().includes(kw) ||
      f.friend.username.toLowerCase().includes(kw)
    )
  })

  /** 按备注/昵称/用户名首字符分组（简单字母序） */
  const displayName = (f: Friend) => f.remark || f.friend.nickname || f.friend.username
  const grouped = filtered.reduce<Record<string, Friend[]>>((acc, f) => {
    const ch = displayName(f).charAt(0).toUpperCase()
    const key = /[A-Z]/.test(ch) ? ch : '#'
    ;(acc[key] = acc[key] || []).push(f)
    return acc
  }, {})
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    if (a === '#') return 1
    if (b === '#') return -1
    return a.localeCompare(b)
  })

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 搜索 + 添加入口 */}
      <div className="px-3 pt-3 pb-2 flex gap-2">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索好友"
            className="input pl-9 py-2 text-sm"
          />
        </div>
        <button
          onClick={onAddFriend}
          className="px-3 rounded-full bg-primary-500 text-white flex items-center gap-1 text-sm active:scale-95 transition-transform"
        >
          <UserPlus size={16} />
          <span className="hidden xs:inline">添加</span>
        </button>
      </div>

      {/* 好友列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingState text="加载好友..." />
        ) : error ? (
          <ErrorState text={error} onRetry={load} />
        ) : friends.length === 0 ? (
          <EmptyState
            icon="👥"
            text="还没有好友"
            hint="搜索用户名添加好友，开始私聊吧"
            action={
              <button onClick={onAddFriend} className="btn-primary text-sm">
                添加好友
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon="🔍" text="没有匹配的好友" />
        ) : (
          <div className="bg-white">
            {groupKeys.map((key) => (
              <div key={key}>
                <div className="px-4 py-1 text-xs text-gray-400 bg-gray-50 sticky top-0">
                  {key}
                </div>
                {grouped[key].map((f) => {
                  const name = displayName(f)
                  const isEntering = enteringId === f.friend.id
                  return (
                    <div key={f.id} className="relative">
                      <button
                        onClick={() => openChat(f)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setMenuOpenId(menuOpenId === f.id ? null : f.id)
                        }}
                        disabled={isEntering}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-primary-50/30 active:bg-primary-50/50 transition-colors disabled:opacity-60"
                      >
                        {isImgAvatar(f.friend.avatar) ? (
                          <img
                            src={f.friend.avatar}
                            alt={name}
                            className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center text-xl flex-shrink-0">
                            {f.friend.avatar || '👤'}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">{name}</div>
                          <div className="text-xs text-gray-400 truncate">
                            @{f.friend.username}
                          </div>
                        </div>
                        {isEntering ? (
                          <span className="text-xs text-gray-400">进入中...</span>
                        ) : (
                          <MessageCircle size={16} className="text-gray-300" />
                        )}
                      </button>

                      {/* 长按/右键菜单 */}
                      {menuOpenId === f.id && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setMenuOpenId(null)}
                          />
                          <div className="absolute right-4 top-2 z-50 bg-white rounded-xl shadow-lg shadow-black/10 overflow-hidden min-w-[140px]">
                            <button
                              onClick={() => setRemark(f)}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-primary-50 text-left"
                            >
                              <Edit3 size={14} />
                              设置备注名
                            </button>
                            <button
                              onClick={() => removeFriend(f)}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-urgent hover:bg-red-50 text-left border-t border-gray-50"
                            >
                              <Trash2 size={14} />
                              删除好友
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
            {/* 底部统计 */}
            <div className="px-4 py-3 text-center text-xs text-gray-400 border-t border-gray-50">
              共 {friends.length} 位好友
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
