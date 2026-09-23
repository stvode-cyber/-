import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Heart, MessageCircle, Bookmark, Plus, X, Send, Loader2, Camera, Images, ChevronRight } from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { fromNow } from '../lib/utils'
import { communityCategoryMeta } from '../lib/constants'

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
  aiSource: AiSource | null
  likesCount: number
  commentsCount: number
  favoritesCount: number
  liked: boolean
  favorited: boolean
  createdAt: string
  user: PostUser | null
}

/** 评论结构（与后端 serializeComment 返回对应） */
interface Comment {
  id: string
  content: string
  createdAt: string
  user: PostUser | null
}

type Tab = 'recommend' | 'companion' | 'life' | 'work' | 'finance'

/** 头像兜底：无 avatar 时取 nickname 首字 */
function avatarText(post: Post): string {
  const name = post.user?.nickname || post.user?.username || '?'
  return name.charAt(0).toUpperCase()
}

/**
 * 社区页
 *
 * 功能：
 * 1. Tab 切换：推荐 / 同行者 / 生活 / 工作 / 财务
 *    - 推荐：按点赞数降序
 *    - 同行者：按时间降序
 *    - 生活 / 工作 / 财务：按 category 过滤
 * 2. 帖子卡片：作者、时间、正文、AI 资料卡、点赞/评论/收藏
 * 3. 交互：点赞、收藏、评论均为真实接口调用
 * 4. 发帖：顶部 + 按钮打开发帖弹层
 * 5. 分页：滚动到底部加载更多
 *
 * 接口：
 * - GET  /community/posts              帖子列表
 * - POST /community/posts              创建帖子
 * - POST /community/posts/:id/like     点赞
 * - DELETE /community/posts/:id/like   取消点赞
 * - POST /community/posts/:id/favorite 收藏
 * - DELETE /community/posts/:id/favorite 取消收藏
 * - GET  /community/posts/:id/comments 评论列表
 * - POST /community/posts/:id/comments 发表评论
 */
export default function CommunityPage() {
  const toast = useToast((s) => s.show)
  const [posts, setPosts] = useState<Post[]>([])
  const [tab, setTab] = useState<Tab>('recommend')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [showPostForm, setShowPostForm] = useState(false)
  // 评论弹层
  const [commentPost, setCommentPost] = useState<Post | null>(null)

  const pageSize = 10
  const hasMore = posts.length < total

  /** 加载帖子列表 */
  const load = useCallback(async (pageNum: number, append: boolean) => {
    try {
      if (append) setLoadingMore(true)
      else {
        setLoading(true)
        setError(false)
      }
      const res = await unwrap<{ list: Post[]; total: number; page: number; pageSize: number }>(
        api.get('/community/posts', { params: { tab, page: pageNum, pageSize } }),
      )
      setPosts((prev) => (append ? [...prev, ...res.list] : res.list))
      setTotal(res.total)
      setPage(pageNum)
    } catch (err) {
      // 初始加载失败展示 error 重试态；加载更多失败仅 toast
      if (!append) setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [tab, toast])

  useEffect(() => {
    load(1, false)
  }, [load])

  /** 切换 Tab */
  const onTabChange = (t: Tab) => {
    setTab(t)
  }

  /** 加载更多 */
  const loadMore = () => {
    if (!loadingMore && hasMore) load(page + 1, true)
  }

  /** 点赞/取消点赞 */
  const toggleLike = async (post: Post) => {
    // 乐观更新
    const wasLiked = post.liked
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? {
              ...p,
              liked: !wasLiked,
              likesCount: p.likesCount + (wasLiked ? -1 : 1),
            }
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
      // 回滚
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                liked: wasLiked,
                likesCount: p.likesCount + (wasLiked ? 1 : -1),
              }
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
          ? {
              ...p,
              favorited: !wasFav,
              favoritesCount: p.favoritesCount + (wasFav ? -1 : 1),
            }
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
            ? {
                ...p,
                favorited: wasFav,
                favoritesCount: p.favoritesCount + (wasFav ? 1 : -1),
              }
            : p,
        ),
      )
      toast((err as Error).message, 'error')
    }
  }

  /** 打开评论区 */
  const openComments = (post: Post) => {
    setCommentPost(post)
  }

  /** 帖子发布成功后刷新列表 */
  const onPostCreated = () => {
    setShowPostForm(false)
    load(1, false)
    toast('帖子已发布', 'success')
  }

  /** 评论发表后更新评论数 */
  const onCommentAdded = (postId: string) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, commentsCount: p.commentsCount + 1 } : p,
      ),
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'recommend', label: '推荐' },
    { key: 'companion', label: '同行者' },
    { key: 'life', label: '生活' },
    { key: 'work', label: '工作' },
    { key: 'finance', label: '财务' },
  ]

  return (
    <div className="app-shell pb-4">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-accent-200">
        <div className="h-12 flex items-center justify-between px-4">
          <h1 className="font-semibold text-gradient text-lg">社区</h1>
          <button
            onClick={() => setShowPostForm(true)}
            className="p-2 text-white rounded-full transition-all active:scale-90 bg-gradient-to-br from-primary-500 to-teal-500"
            aria-label="发布帖子"
          >
            <Plus size={20} />
          </button>
        </div>
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => onTabChange(t.key)}
              className={`flex-1 py-2.5 text-sm border-b-2 transition-all ${
                tab === t.key
                  ? 'border-primary-500 text-primary-600 font-semibold'
                  : 'border-transparent text-gray-500 hover:text-primary-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="px-3 py-3 space-y-3">
        {/* 同步入口：朋友圈 / 相册（QQ 空间动态式快捷区） */}
        <div className="card grid grid-cols-2 divide-x divide-gray-100">
          <Link to="/moments" className="no-underline flex items-center gap-3 px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors">
            <div className="w-9 h-9 rounded-full bg-primary-50 flex items-center justify-center flex-shrink-0">
              <Camera size={18} className="text-primary-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800">朋友圈</div>
              <div className="text-[11px] text-gray-400 truncate">记录此刻 · 好友互动</div>
            </div>
            <ChevronRight size={14} className="text-gray-300" />
          </Link>
          <Link to="/album" className="no-underline flex items-center gap-3 px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors">
            <div className="w-9 h-9 rounded-full bg-primary-50 flex items-center justify-center flex-shrink-0">
              <Images size={18} className="text-primary-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800">相册</div>
              <div className="text-[11px] text-gray-400 truncate">按月整理 · 云端保存</div>
            </div>
            <ChevronRight size={14} className="text-gray-300" />
          </Link>
        </div>

        {loading ? (
          <LoadingState skeleton count={3} />
        ) : error ? (
          <ErrorState text="帖子加载失败" onRetry={() => load(1, false)} />
        ) : posts.length === 0 ? (
          <EmptyState
            icon="🌿"
            text="该分类下暂无内容"
            hint="点击右上角 + 发布第一条"
          />
        ) : (
          posts.map((p) => (
            <div key={p.id} className="card hover:shadow-md transition-shadow">
              {/* 用户信息 */}
              <div className="flex items-center gap-2 mb-2">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center text-primary-600 text-sm font-medium">
                  {p.user?.avatar || avatarText(p)}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">
                    {p.user?.nickname || p.user?.username || '匿名用户'}
                  </div>
                  <div className="text-xs text-gray-400">{fromNow(p.createdAt)}</div>
                </div>
                {/* 分类标签 */}
                <span className={`badge text-[10px] ${communityCategoryMeta[p.category]?.color || 'bg-gray-50 text-gray-600'}`}>
                  {communityCategoryMeta[p.category]?.label || '生活'}
                </span>
              </div>

              {/* 正文 */}
              <p className="text-sm text-gray-700 leading-relaxed mb-3 whitespace-pre-wrap">
                {p.content}
              </p>

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
                  onClick={() => openComments(p)}
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

        {/* 加载更多 */}
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full py-3 text-center text-sm text-primary-600 hover:bg-primary-50 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
          >
            {loadingMore ? (
              <>
                <Loader2 size={14} className="animate-spin" /> 加载中...
              </>
            ) : (
              '加载更多'
            )}
          </button>
        )}

        {!hasMore && (
          <div className="text-center text-xs text-gray-400 py-4">— 已经到底了 —</div>
        )}
      </div>

      {/* 发帖弹层 */}
      {showPostForm && (
        <PostFormModal
          onClose={() => setShowPostForm(false)}
          onCreated={onPostCreated}
        />
      )}

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
 * 发帖弹层
 * - 支持选择分类（生活/工作/财务）
 * - 正文最多 2000 字
 */
function PostFormModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast((s) => s.show)
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<'life' | 'work' | 'finance'>('life')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!content.trim()) {
      toast('请输入帖子内容', 'error')
      return
    }
    setSubmitting(true)
    try {
      await unwrap(api.post('/community/posts', { content: content.trim(), category }))
      onCreated()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const cats: { key: 'life' | 'work' | 'finance'; label: string }[] = [
    { key: 'life', label: '生活' },
    { key: 'work', label: '工作' },
    { key: 'finance', label: '财务' },
  ]

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:rounded-xl rounded-t-xl max-w-lg max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="font-medium text-gray-800">发布帖子</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* 分类选择 */}
        <div className="px-4 py-3 border-b border-gray-50">
          <div className="flex gap-2">
            {cats.map((c) => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={`px-3 py-1 text-xs rounded-full ${
                  category === c.key
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* 正文输入 */}
        <div className="flex-1 px-4 py-3 overflow-y-auto">
          <textarea
            autoFocus
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="分享你的想法、经验或问题..."
            className="w-full h-40 text-sm outline-none resize-none border-0"
            maxLength={2000}
          />
          <div className="text-right text-xs text-gray-400">{content.length}/2000</div>
        </div>

        {/* 底部按钮 */}
        <div className="flex gap-2 px-4 py-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={submitting || !content.trim()}
            className="flex-1 py-2 text-sm text-white bg-primary-600 rounded-lg disabled:opacity-40 flex items-center justify-center gap-1"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            发布
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 评论弹层
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

  /** 加载评论 */
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

  /** 发表评论 */
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
            <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-medium">
              {post.user?.avatar || avatarText(post)}
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
            <div className="py-8 text-center text-gray-400 text-sm">
              暂无评论，来抢沙发吧 ~
            </div>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-xs font-medium flex-shrink-0">
                    {c.user?.avatar || (c.user?.nickname || c.user?.username || '?').charAt(0).toUpperCase()}
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
