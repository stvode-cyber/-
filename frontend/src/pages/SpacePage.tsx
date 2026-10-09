import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Heart, MessageCircle, Bookmark, X, Send, Loader2,
} from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { fromNow } from '../lib/utils'
import { communityCategoryMeta } from '../lib/constants'

/**
 * 个人空间页（对标 QQ 空间个人主页）
 *
 * 路由：/space/:userId
 *
 * 结构：
 * 1. 顶部封面（渐变模拟，后端未存 coverUrl）
 * 2. 头像 + 昵称 + 简介 + 加入时间
 * 3. 统计区：说说数 / 收到赞 / 收到评论
 * 4. 说说时间线：该用户的所有帖子，支持点赞/收藏/评论
 *
 * 接口：
 * - GET /community/users/:userId        个人资料 + 统计 + 关系
 * - GET /community/users/:userId/posts   说说列表
 * - POST/DELETE /community/posts/:id/like       点赞/取消
 * - POST/DELETE /community/posts/:id/favorite   收藏/取消
 * - GET/POST      /community/posts/:id/comments 评论列表/发表
 */

/** 帖子作者信息 */
interface PostUser {
  id: string
  username: string
  nickname: string | null
  avatar: string | null
}

/** AI 资料卡 */
interface AiSource {
  name: string
  confidence: number
}

/** 帖子结构（与后端 serializePost 返回对应） */
interface Post {
  id: string
  content: string
  category: 'life' | 'work' | 'finance'
  images: string[]
  aiSource: AiSource | null
  likesCount: number
  commentsCount: number
  favoritesCount: number
  liked: boolean
  favorited: boolean
  createdAt: string
  user: PostUser | null
}

/** 评论结构 */
interface Comment {
  id: string
  content: string
  createdAt: string
  user: PostUser | null
}

/** 个人空间数据 */
interface SpaceData {
  user: {
    id: string
    username: string
    nickname: string | null
    avatar: string | null
    /** 个人简介（User 表未存 bio 时为 undefined，UI 不展示） */
    bio?: string | null
    createdAt: string
  }
  stats: {
    postsCount: number
    totalLikesReceived: number
    totalCommentsReceived: number
  }
  relation: {
    isSelf: boolean
    isFriend: boolean
  }
}

/** 头像兜底：无 avatar 时取 nickname 首字 */
function avatarText(user: { nickname: string | null; username: string | null }): string {
  const name = user.nickname || user.username || '?'
  return name.charAt(0).toUpperCase()
}

export default function SpacePage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const [space, setSpace] = useState<SpaceData | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // 评论弹层
  const [commentPost, setCommentPost] = useState<Post | null>(null)

  /** 加载个人空间数据 + 说说列表 */
  const load = useCallback(async () => {
    if (!userId) return
    try {
      setLoading(true)
      setError(false)
      const [spaceRes, postsRes] = await Promise.all([
        unwrap<SpaceData>(api.get(`/community/users/${userId}`)),
        unwrap<{ list: Post[]; total: number }>(
          api.get(`/community/users/${userId}/posts`, { params: { pageSize: 50 } }),
        ),
      ])
      setSpace(spaceRes)
      setPosts(postsRes.list)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }, [userId, toast])

  useEffect(() => {
    load()
  }, [load])

  /** 点赞/取消点赞 */
  const toggleLike = async (post: Post) => {
    const wasLiked = post.liked
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, liked: !wasLiked, likesCount: p.likesCount + (wasLiked ? -1 : 1) }
          : p,
      ),
    )
    try {
      if (wasLiked) {
        await unwrap(api.delete(`/community/posts/${post.id}/like`))
      } else {
        await unwrap(api.post(`/community/posts/${post.id}/like`))
      }
    } catch (err) {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, liked: wasLiked, likesCount: p.likesCount + (wasLiked ? 1 : -1) }
            : p,
        ),
      )
      toast((err as Error).message, 'error')
    }
  }

  /** 收藏/取消收藏 */
  const toggleFavorite = async (post: Post) => {
    const wasFav = post.favorited
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, favorited: !wasFav, favoritesCount: p.favoritesCount + (wasFav ? -1 : 1) }
          : p,
      ),
    )
    try {
      if (wasFav) {
        await unwrap(api.delete(`/community/posts/${post.id}/favorite`))
      } else {
        await unwrap(api.post(`/community/posts/${post.id}/favorite`))
      }
      toast(wasFav ? '已取消收藏' : '已收藏', 'success')
    } catch (err) {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, favorited: wasFav, favoritesCount: p.favoritesCount + (wasFav ? 1 : -1) }
            : p,
        ),
      )
      toast((err as Error).message, 'error')
    }
  }

  /** 评论发表后更新评论数 */
  const onCommentAdded = (postId: string) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, commentsCount: p.commentsCount + 1 } : p)),
    )
  }

  if (loading) return <LoadingState />
  if (error || !space) return <ErrorState text="空间加载失败" onRetry={load} />

  const { user, stats, relation } = space

  return (
    <div className="app-shell pb-4">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-accent-200">
        <div className="h-12 flex items-center px-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 text-gray-600 hover:text-gray-900"
            aria-label="返回"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-semibold text-gray-800 text-lg ml-2">个人空间</h1>
        </div>
      </header>

      {/* 封面 + 头像 + 资料 */}
      <div className="relative">
        {/* 渐变封面（后端未存 coverUrl，用品牌色渐变模拟 QQ 空间封面） */}
        <div className="h-28 bg-gradient-to-br from-primary-500 via-primary-400 to-teal-500" />

        {/* 头像 + 资料 */}
        <div className="px-4 -mt-10 relative">
          <div className="flex items-end gap-3">
            {/* 头像 */}
            <div className="w-20 h-20 rounded-full border-4 border-white bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center text-primary-600 text-2xl font-bold overflow-hidden flex-shrink-0">
              {user.avatar ? (
                <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                avatarText(user)
              )}
            </div>

            {/* 昵称 + 加入时间 */}
            <div className="flex-1 pb-1 min-w-0">
              <div className="text-lg font-semibold text-gray-800 truncate">
                {user.nickname || user.username}
              </div>
              <div className="text-xs text-gray-400">加入于 {fromNow(user.createdAt)}</div>
            </div>

            {/* 关系/操作按钮 */}
            {relation.isSelf ? (
              <Link
                to="/settings/profile"
                className="px-3 py-1.5 text-xs rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors flex-shrink-0"
              >
                编辑资料
              </Link>
            ) : relation.isFriend ? (
              <span className="px-3 py-1.5 text-xs rounded-full bg-green-50 text-green-600 flex-shrink-0">
                已好友
              </span>
            ) : (
              <button
                className="px-3 py-1.5 text-xs rounded-full bg-primary-500 text-white hover:bg-primary-600 transition-colors flex-shrink-0"
                onClick={() => toast('好友功能即将开放', 'info')}
              >
                加好友
              </button>
            )}
          </div>

          {/* 简介 */}
          {user.bio && (
            <p className="text-sm text-gray-600 mt-3 leading-relaxed">{user.bio}</p>
          )}

          {/* 统计区 */}
          <div className="flex gap-6 mt-3 py-2 border-b border-gray-100">
            <div className="text-center">
              <div className="text-lg font-bold text-gray-800">{stats.postsCount}</div>
              <div className="text-[11px] text-gray-400">说说</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-gray-800">{stats.totalLikesReceived}</div>
              <div className="text-[11px] text-gray-400">收到赞</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-gray-800">{stats.totalCommentsReceived}</div>
              <div className="text-[11px] text-gray-400">收到评论</div>
            </div>
          </div>
        </div>
      </div>

      {/* 说说时间线 */}
      <div className="px-3 py-3 space-y-3">
        <div className="text-xs font-medium text-gray-500 px-1 flex items-center justify-between">
          <span>说说 · {posts.length}</span>
          {relation.isSelf && (
            <Link to="/community" className="text-primary-600 hover:underline">
              去发布 →
            </Link>
          )}
        </div>

        {posts.length === 0 ? (
          <EmptyState
            icon="📝"
            text={relation.isSelf ? '还没有说过什么' : 'TA还没有说过什么'}
            hint={relation.isSelf ? '去圈子发第一条说说吧' : ''}
          />
        ) : (
          posts.map((p) => (
            <div key={p.id} className="card hover:shadow-md transition-shadow">
              {/* 用户信息（在个人空间里作者就是当前主人，简化展示） */}
              <div className="flex items-center gap-2 mb-2">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center text-primary-600 text-xs font-medium overflow-hidden">
                  {user.avatar ? (
                    <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    avatarText(user)
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">
                    {user.nickname || user.username}
                  </div>
                  <div className="text-xs text-gray-400">{fromNow(p.createdAt)}</div>
                </div>
                {/* 分类标签 */}
                <span
                  className={`badge text-[10px] ${
                    communityCategoryMeta[p.category]?.color || 'bg-gray-50 text-gray-600'
                  }`}
                >
                  {communityCategoryMeta[p.category]?.label || '生活'}
                </span>
              </div>

              {/* 正文 */}
              <p className="text-sm text-gray-700 leading-relaxed mb-3 whitespace-pre-wrap">
                {p.content}
              </p>

              {/* 配图九宫格 */}
              {p.images && p.images.length > 0 && (
                <div
                  className={`grid gap-1 mb-3 ${
                    p.images.length === 1
                      ? 'grid-cols-1'
                      : p.images.length <= 4
                      ? 'grid-cols-2'
                      : 'grid-cols-3'
                  }`}
                >
                  {p.images.map((img, idx) => (
                    <img
                      key={idx}
                      src={img}
                      alt={`配图${idx + 1}`}
                      className="rounded-lg w-full object-cover"
                      style={{ aspectRatio: p.images!.length === 1 ? '16/9' : '1/1' }}
                    />
                  ))}
                </div>
              )}

              {/* AI 资料卡 */}
              {p.aiSource && (
                <div className="mb-3 bg-blue-50 rounded-lg p-3 border border-blue-100">
                  <div className="flex items-center gap-2 text-xs text-blue-700">
                    <span>🤖 AI自动检索资料</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    来源：{p.aiSource.name}
                    <span className="ml-2 text-blue-600">置信度 {p.aiSource.confidence}%</span>
                  </div>
                </div>
              )}

              {/* 互动 */}
              <div className="flex items-center gap-4 pt-2 border-t border-gray-50">
                <button
                  onClick={() => toggleLike(p)}
                  className={`flex items-center gap-1 text-sm ${
                    p.liked ? 'text-red-500' : 'text-gray-500'
                  }`}
                >
                  <Heart size={16} fill={p.liked ? 'currentColor' : 'none'} />
                  {p.likesCount}
                </button>
                <button
                  onClick={() => setCommentPost(p)}
                  className="flex items-center gap-1 text-sm text-gray-500"
                >
                  <MessageCircle size={16} />
                  {p.commentsCount}
                </button>
                <button
                  onClick={() => toggleFavorite(p)}
                  className={`flex items-center gap-1 text-sm ml-auto ${
                    p.favorited ? 'text-amber-500' : 'text-gray-500'
                  }`}
                >
                  <Bookmark size={16} fill={p.favorited ? 'currentColor' : 'none'} />
                  {p.favoritesCount > 0 && p.favoritesCount}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 评论弹层 */}
      {commentPost && (
        <CommentModal
          post={commentPost}
          onClose={() => setCommentPost(null)}
          onCommentAdded={onCommentAdded}
        />
      )}
    </div>
  )
}

/**
 * 评论弹层（复用 CommunityPage 的结构）
 * - 展示帖子正文 + 评论列表
 * - 支持发表新评论
 */
function CommentModal({
  post,
  onClose,
  onCommentAdded,
}: {
  post: Post
  onClose: () => void
  onCommentAdded: (postId: string) => void
}) {
  const toast = useToast((s) => s.show)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  /** 头像兜底 */
  const avatarChar = (u: PostUser | null) => {
    if (!u) return '?'
    return (u.nickname || u.username || '?').charAt(0).toUpperCase()
  }

  const loadComments = useCallback(async () => {
    try {
      setLoading(true)
      const res = await unwrap<{ list: Comment[]; total: number }>(
        api.get(`/community/posts/${post.id}/comments`, { params: { pageSize: 50 } }),
      )
      setComments(res.list)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }, [post.id, toast])

  useEffect(() => {
    loadComments()
  }, [loadComments])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const newComment = await unwrap<Comment>(
        api.post(`/community/posts/${post.id}/comments`, { content: text }),
      )
      setComments((prev) => [...prev, newComment])
      setInput('')
      onCommentAdded(post.id)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:rounded-xl rounded-t-xl max-w-lg max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="font-medium text-gray-800">评论 ({post.commentsCount})</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* 帖子正文 */}
        <div className="px-4 py-3 border-b border-gray-50 bg-gray-50">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-medium overflow-hidden">
              {post.user?.avatar || avatarChar(post.user)}
            </div>
            <span className="text-sm font-medium text-gray-700">
              {post.user?.nickname || post.user?.username || '匿名用户'}
            </span>
          </div>
          <p className="text-sm text-gray-600 line-clamp-3">{post.content}</p>
        </div>

        {/* 评论列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="py-8 text-center text-gray-400">
              <Loader2 size={20} className="animate-spin mx-auto mb-2" />
              加载中...
            </div>
          ) : comments.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">暂无评论，来抢沙发吧 ~</div>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-xs font-medium flex-shrink-0 overflow-hidden">
                    {c.user?.avatar || avatarChar(c.user)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">
                        {c.user?.nickname || c.user?.username || '匿名用户'}
                      </span>
                      <span className="text-xs text-gray-400">{fromNow(c.createdAt)}</span>
                    </div>
                    <p className="text-sm text-gray-700 mt-0.5">{c.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 评论输入 */}
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="flex items-end gap-2">
            <div className="flex-1 bg-gray-100 rounded-2xl px-3 py-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="写下你的评论..."
                className="w-full text-sm bg-transparent outline-none resize-none max-h-24"
                rows={1}
                maxLength={500}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
              />
            </div>
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className="p-2 text-white rounded-full disabled:opacity-40 transition-all active:scale-90 bg-gradient-to-br from-primary-500 to-teal-500"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
