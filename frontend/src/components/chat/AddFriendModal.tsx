import { useState } from 'react'
import { X, UserPlus, Search, Check, Clock, UserCheck } from 'lucide-react'
import { api, unwrap } from '../../lib/api'

/**
 * 添加好友弹层
 * - Tab 1：搜索用户名发起好友请求
 * - Tab 2：待处理请求（接受/拒绝）
 */

interface Friend {
  id: string
  username: string
  nickname: string | null
  avatar: string | null
}

interface PendingRequest {
  id: string
  userId: string
  user: Friend
  remark: string | null
  status: string
  createdAt: string
}

export default function AddFriendModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [tab, setTab] = useState<'search' | 'pending'>('search')
  const [username, setUsername] = useState('')
  const [remark, setRemark] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<Friend | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [requested, setRequested] = useState(false)
  const [requestMsg, setRequestMsg] = useState('')

  // 待处理
  const [pending, setPending] = useState<PendingRequest[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingLoaded, setPendingLoaded] = useState(false)

  const handleSearch = async () => {
    if (!username.trim()) return
    setSearching(true)
    setSearchError(null)
    setSearchResult(null)
    setRequested(false)
    try {
      const list = await unwrap<Friend[]>(api.get(`/conversations/users/search?q=${encodeURIComponent(username)}`))
      const user = Array.isArray(list) ? list[0] : null
      if (!user) {
        setSearchError('未找到用户')
      } else {
        setSearchResult(user)
      }
    } catch (e: any) {
      setSearchError(e?.message || '搜索失败')
    } finally {
      setSearching(false)
    }
  }

  const handleSendRequest = async () => {
    if (!username.trim()) return
    setRequesting(true)
    setRequestMsg('')
    try {
      const r = await unwrap<{ targetUserId: string }>(
        api.post('/conversations/friends/request', {
          username: username.trim(),
          remark: remark.trim() || undefined,
        }),
      )
      setRequested(true)
      setRequestMsg('好友请求已发送，等待对方同意')
      onSuccess()
    } catch (e: any) {
      setRequestMsg(e?.message || '发送失败')
    } finally {
      setRequesting(false)
    }
  }

  const loadPending = async () => {
    setPendingLoading(true)
    try {
      const list = await unwrap<PendingRequest[]>(api.get('/conversations/friends/pending'))
      setPending(list)
    } catch {
      /* ignore */
    } finally {
      setPendingLoading(false)
      setPendingLoaded(true)
    }
  }

  const handleAccept = async (id: string) => {
    try {
      await api.post(`/conversations/friends/${id}/accept`)
      setPending((prev) => prev.filter((p) => p.id !== id))
      onSuccess()
    } catch {
      /* ignore */
    }
  }

  const handleReject = async (id: string) => {
    try {
      await api.post(`/conversations/friends/${id}/reject`)
      setPending((prev) => prev.filter((p) => p.id !== id))
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div
          className="px-4 py-3 text-white flex items-center justify-between bg-gradient-to-br from-primary-500 to-teal-500"
        >
          <h2 className="font-semibold">添加好友</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        {/* Tab */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setTab('search')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === 'search'
                ? 'text-primary-600 border-b-2 border-primary-500'
                : 'text-gray-500'
            }`}
          >
            搜索添加
          </button>
          <button
            onClick={() => {
              setTab('pending')
              if (!pendingLoaded) loadPending()
            }}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === 'pending'
                ? 'text-primary-600 border-b-2 border-primary-500'
                : 'text-gray-500'
            }`}
          >
            待处理
            {pending.length > 0 && (
              <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full bg-urgent text-white text-[10px]">
                {pending.length}
              </span>
            )}
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'search' ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">用户名</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="输入对方用户名"
                    className="input flex-1"
                    inputMode="text"
                  />
                  <button
                    onClick={handleSearch}
                    disabled={searching || !username.trim()}
                    className="btn-secondary px-3"
                  >
                    <Search size={16} />
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">备注名（可选）</label>
                <input
                  type="text"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="给对方起个备注名"
                  className="input"
                  maxLength={30}
                />
              </div>

              {searchError && (
                <p className="text-sm text-urgent">{searchError}</p>
              )}

              {searchResult && (
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-primary-50">
                  {searchResult.avatar && (
                    searchResult.avatar.startsWith('data:image') ||
                    searchResult.avatar.startsWith('http') ||
                    searchResult.avatar.startsWith('/')
                  ) ? (
                    <img
                      src={searchResult.avatar}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-xl">
                      {searchResult.avatar || '👤'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {searchResult.nickname || searchResult.username}
                    </p>
                    <p className="text-xs text-gray-500">@{searchResult.username}</p>
                  </div>
                  <Check size={20} className="text-mint-500" />
                </div>
              )}

              {requested && (
                <div className="text-sm text-mint-600 bg-mint-50 rounded-xl p-3">
                  ✓ {requestMsg}
                </div>
              )}

              {requestMsg && !requested && (
                <div className="text-sm text-urgent bg-red-50 rounded-xl p-3">
                  {requestMsg}
                </div>
              )}

              <button
                onClick={handleSendRequest}
                disabled={requesting || !username.trim()}
                className="btn-primary w-full"
              >
                <UserPlus size={18} />
                {requesting ? '发送中...' : '发送好友请求'}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingLoading ? (
                <p className="text-center text-sm text-gray-500 py-8">加载中...</p>
              ) : pending.length === 0 ? (
                <div className="text-center text-gray-400 py-12">
                  <Clock size={40} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无待处理请求</p>
                </div>
              ) : (
                pending.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50"
                  >
                    {p.user.avatar && (
                      p.user.avatar.startsWith('data:image') ||
                      p.user.avatar.startsWith('http') ||
                      p.user.avatar.startsWith('/')
                    ) ? (
                      <img
                        src={p.user.avatar}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-xl">
                        {p.user.avatar || '👤'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {p.user.nickname || p.user.username}
                      </p>
                      <p className="text-xs text-gray-500">@{p.user.username}</p>
                    </div>
                    <button
                      onClick={() => handleAccept(p.id)}
                      className="btn-primary px-3 py-1.5 text-xs"
                    >
                      接受
                    </button>
                    <button
                      onClick={() => handleReject(p.id)}
                      className="px-3 py-1.5 text-xs text-gray-500 bg-gray-200 rounded-full"
                    >
                      拒绝
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
