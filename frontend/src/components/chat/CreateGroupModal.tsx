import { useEffect, useState } from 'react'
import { X, Users, Check, ChevronRight } from 'lucide-react'
import { api, unwrap } from '../../lib/api'

/**
 * 发起群聊弹层
 * 1. 输入群名
 * 2. 从好友列表勾选成员
 * 3. 提交创建群组
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

export default function CreateGroupModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [name, setName] = useState('')
  const [friends, setFriends] = useState<Friend[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const list = await unwrap<Friend[]>(api.get('/conversations/friends'))
        setFriends(list)
      } catch (e: any) {
        setError(e?.message || '加载好友失败')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('请输入群名')
      return
    }
    if (selected.size === 0) {
      setError('至少邀请 1 位好友')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await unwrap(
        api.post('/conversations/groups', {
          name: name.trim(),
          memberIds: [...selected],
        }),
      )
      onSuccess()
    } catch (e: any) {
      setError(e?.message || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div
          className="px-4 py-3 text-white flex items-center justify-between bg-gradient-to-br from-primary-500 to-teal-500"
        >
          <h2 className="font-semibold">发起群聊</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <label className="text-xs text-gray-500 mb-1.5 block">群名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="给群起个名字"
              className="input"
              maxLength={50}
            />
          </div>

          <div className="text-xs text-gray-500 mb-2">
            选择好友（{selected.size}）
          </div>

          {loading ? (
            <p className="text-center text-sm text-gray-500 py-8">加载好友...</p>
          ) : friends.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              <Users size={40} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">还没有好友，先添加好友再建群</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {friends.map((f) => {
                const friend = f.friend
                const isImg =
                  friend.avatar &&
                  (friend.avatar.startsWith('data:image') ||
                    friend.avatar.startsWith('http') ||
                    friend.avatar.startsWith('/'))
                const isSelected = selected.has(friend.id)
                return (
                  <li key={f.id}>
                    <button
                      onClick={() => toggle(friend.id)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-2xl transition-colors ${
                        isSelected ? 'bg-primary-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {isImg ? (
                        <img
                          src={friend.avatar as string}
                          alt=""
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-xl">
                          {friend.avatar || '👤'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0 text-left">
                        <p className="font-medium text-gray-900 truncate">
                          {f.remark || friend.nickname || friend.username}
                        </p>
                        <p className="text-xs text-gray-500">@{friend.username}</p>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-primary-500 border-primary-500'
                            : 'border-gray-300'
                        }`}
                      >
                        {isSelected && <Check size={12} className="text-white" />}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {error && (
            <p className="text-sm text-urgent mt-3 bg-red-50 rounded-xl p-3">{error}</p>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="border-t border-gray-100 p-4 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || selected.size === 0}
            className="btn-primary flex-1"
          >
            创建群聊
          </button>
        </div>
      </div>
    </div>
  )
}
