import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImagePlus, Send, Heart, MessageCircle, X, Loader2, ArrowLeft } from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState } from '../components/StateView'
import { fromNow } from '../lib/utils'
import { compressImage } from '../lib/imageCompress'
import { ImageViewer } from '../components/ImageViewer'

/** 帖子作者信息 */
interface PostUser {
  id: string
  username: string
  nickname: string | null
  avatar: string | null
}

/** 朋友圈动态（与后端 serializePost 返回对应，images 为九宫格配图） */
interface Moment {
  id: string
  content: string
  category: 'life' | 'work' | 'finance'
  images: string[]
  likesCount: number
  commentsCount: number
  liked: boolean
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

const MAX_IMAGES = 9

/**
 * 朋友圈页面（QQ空间说说风格）
 *
 * 功能：
 * 1. 发布框：文字 + 九宫格配图（最多 9 张，上传前压缩）+ 发表
 * 2. 动态流：全部用户按时间倒序；头像/昵称/相对时间/正文/九宫格
 * 3. 互动：点赞（乐观更新）/ 评论（展开式评论区 + 输入框）
 * 4. 大图浏览：点击九宫格图片全屏查看，左右切换
 * 5. 分页：滚动到底部加载更多
 *
 * 接口：
 * - GET    /community/posts              动态列表（tab=companion 时间倒序）
 * - POST   /community/posts              发布（content + images + category）
 * - POST   /community/posts/:id/like     点赞
 * - DELETE /community/posts/:id/like     取消点赞
 * - GET    /community/posts/:id/comments 评论列表
 * - POST   /community/posts/:id/comments 发表评论
 */
export default function MomentsPage() {
  const toast = useToast((s) => s.show)
  const navigate = useNavigate()

  // 动态列表
  const [moments, setMoments] = useState<Moment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10

  // 发布框
  const [draft, setDraft] = useState('')
  const [draftImages, setDraftImages] = useState<string[]>([])
  const [publishing, setPublishing] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 评论（按动态 id 展开的评论区）
  const [expanded, setExpanded] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, Comment[]>>({})
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSending, setCommentSending] = useState(false)

  // 大图浏览
  const [viewer, setViewer] = useState<{ images: string[]; index: number } | null>(null)

  const hasMore = moments.length < total

  /** 加载动态列表 */
  const load = useCallback(async (pageNum: number, append: boolean) => {
    try {
      if (append) setLoadingMore(true)
      else {
        setLoading(true)
        setError(false)
      }
      const res = await unwrap<{ list: Moment[]; total: number }>(
        api.get('/community/posts', { params: { tab: 'companion', page: pageNum, pageSize } }),
      )
      setMoments((prev) => (append ? [...prev, ...res.list] : res.list))
      setTotal(res.total)
      setPage(pageNum)
    } catch (err) {
      if (!append) setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [toast])

  useEffect(() => {
    load(1, false)
  }, [load])

  /** 选择图片（多选 → 压缩 → 加入草稿九宫格） */
  const onPickImages = async (files: FileList | null) => {
    if (!files?.length) return
    const remain = MAX_IMAGES - draftImages.length
    if (remain <= 0) {
      toast(`最多 ${MAX_IMAGES} 张图片`, 'warning')
      return
    }
    const list = Array.from(files).slice(0, remain)
    if (Array.from(files).length > remain) toast(`最多 ${MAX_IMAGES} 张，已截取前 ${remain} 张`, 'warning')
    try {
      setCompressing(true)
      const compressed: string[] = []
      for (const f of list) {
        if (!f.type.startsWith('image/')) continue
        compressed.push(await compressImage(f, 1280, 0.8))
      }
      if (compressed.length) setDraftImages((prev) => [...prev, ...compressed].slice(0, MAX_IMAGES))
    } catch (err) {
      toast('图片处理失败：' + (err as Error).message, 'error')
    } finally {
      setCompressing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  /** 移除草稿图片 */
  const removeDraftImage = (i: number) => {
    setDraftImages((prev) => prev.filter((_, idx) => idx !== i))
  }

  /** 发表 */
  const publish = async () => {
    const content = draft.trim()
    if (!content && draftImages.length === 0) {
      toast('写点什么或配张图再发吧', 'warning')
      return
    }
    try {
      setPublishing(true)
      const res = await unwrap<Moment>(
        api.post('/community/posts', {
          content: content || '分享图片',
          images: draftImages,
          category: 'life',
        }),
      )
      setMoments((prev) => [res, ...prev])
      setTotal((t) => t + 1)
      setDraft('')
      setDraftImages([])
      toast('动态已发布', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setPublishing(false)
    }
  }

  /** 点赞/取消点赞（乐观更新） */
  const toggleLike = async (m: Moment) => {
    const wasLiked = m.liked
    setMoments((prev) =>
      prev.map((p) =>
        p.id === m.id ? { ...p, liked: !wasLiked, likesCount: p.likesCount + (wasLiked ? -1 : 1) } : p,
      ),
    )
    try {
      if (wasLiked) await unwrap(api.delete(`/community/posts/${m.id}/like`))
      else await unwrap(api.post(`/community/posts/${m.id}/like`))
    } catch (err) {
      setMoments((prev) =>
        prev.map((p) =>
          p.id === m.id ? { ...p, liked: wasLiked, likesCount: p.likesCount + (wasLiked ? 1 : -1) } : p,
        ),
      )
      toast((err as Error).message, 'error')
    }
  }

  /** 展开/收起评论区 */
  const toggleComments = async (m: Moment) => {
    if (expanded === m.id) {
      setExpanded(null)
      return
    }
    setExpanded(m.id)
    setCommentDraft('')
    if (!comments[m.id]) {
      try {
        const res = await unwrap<{ list: Comment[] }>(
          api.get(`/community/posts/${m.id}/comments`, { params: { pageSize: 50 } }),
        )
        setComments((prev) => ({ ...prev, [m.id]: res.list }))
      } catch (err) {
        toast((err as Error).message, 'error')
      }
    }
  }

  /** 发表评论 */
  const sendComment = async (m: Moment) => {
    const content = commentDraft.trim()
    if (!content) return
    try {
      setCommentSending(true)
      const res = await unwrap<Comment>(api.post(`/community/posts/${m.id}/comments`, { content }))
      setComments((prev) => ({ ...prev, [m.id]: [...(prev[m.id] || []), res] }))
      setMoments((prev) =>
        prev.map((p) => (p.id === m.id ? { ...p, commentsCount: p.commentsCount + 1 } : p)),
      )
      setCommentDraft('')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setCommentSending(false)
    }
  }

  /** 九宫格布局类（1 张大图 / 4 张 2x2 / 其余 3 列） */
  const gridClass = (n: number) => {
    if (n === 1) return 'grid grid-cols-1 gap-1 max-w-[240px]'
    if (n === 2 || n === 4) return 'grid grid-cols-2 gap-1 max-w-[320px]'
    return 'grid grid-cols-3 gap-1 max-w-[360px]'
  }

  return (
    <div className="app-shell pb-4">
      {/* 头部横幅（QQ 风白灰） */}
      <div className="relative overflow-hidden text-slate-800 px-4 pt-5 pb-4 bg-white border-b border-slate-200/70">
        <div className="absolute w-[160px] h-[160px] rounded-full bg-slate-100/80 -top-16 -right-10 pointer-events-none" />
        <div className="absolute w-[100px] h-[100px] rounded-full bg-slate-50 -bottom-10 -left-6 pointer-events-none" />
        <div className="relative flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 active:scale-95 transition-all"
            title="返回主页"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-lg font-bold leading-tight">朋友圈</h1>
            <p className="text-sm text-slate-400">记录此刻 · 分享生活</p>
          </div>
        </div>
      </div>

      <div className="px-3 pt-3 space-y-3">
        {/* 发布框（QQ空间说说式） */}
        <div className="card p-3 space-y-3">
          <textarea
            className="w-full text-sm bg-gray-50 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary-300"
            rows={2}
            placeholder="这一刻的想法..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {/* 草稿九宫格预览 */}
          {draftImages.length > 0 && (
            <div className={gridClass(draftImages.length)}>
              {draftImages.map((img, i) => (
                <div key={i} className="relative aspect-square rounded-lg overflow-hidden group">
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeDraftImage(i)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70"
                    title="移除"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onPickImages(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={compressing}
                className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 disabled:opacity-50"
                title="添加图片"
              >
                {compressing ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
              </button>
              {draftImages.length > 0 && (
                <span className="text-[10px] text-gray-400">{draftImages.length}/{MAX_IMAGES}</span>
              )}
            </div>
            <button
              onClick={publish}
              disabled={publishing}
              className="px-4 py-1.5 rounded-full text-white text-sm font-medium disabled:opacity-50 flex items-center gap-1"
              style={{ background: 'linear-gradient(135deg, #334155, #1E293B)' }}
            >
              {publishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 发表
            </button>
          </div>
        </div>

        {/* 动态列表 */}
        {loading ? (
          <LoadingState text="加载动态中..." />
        ) : error ? (
          <ErrorState text="动态加载失败" onRetry={() => load(1, false)} />
        ) : moments.length === 0 ? (
          <div className="card p-8 text-center text-gray-400">
            <p className="text-sm">还没有动态</p>
            <p className="text-xs mt-1">发第一条，让大家认识你</p>
          </div>
        ) : (
          moments.map((m) => (
            <div key={m.id} className="card p-3">
              {/* 作者行：头像 + 昵称 + 时间（QQ空间左头像右内容布局） */}
              <div className="flex gap-2.5">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white text-sm font-bold shrink-0 overflow-hidden">
                  {m.user?.avatar ? (
                    <img src={m.user.avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (m.user?.nickname || m.user?.username || '?').charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-primary-700">
                    {m.user?.nickname || m.user?.username || '匿名'}
                  </div>
                  <div className="text-[10px] text-gray-400">{fromNow(m.createdAt)}</div>
                </div>
              </div>

              {/* 正文 */}
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap mt-2">{m.content}</p>

              {/* 九宫格配图 */}
              {m.images.length > 0 && (
                <div className={`${gridClass(m.images.length)} mt-2`}>
                  {m.images.map((img, i) => (
                    <button
                      key={i}
                      onClick={() => setViewer({ images: m.images, index: i })}
                      className="aspect-square rounded-lg overflow-hidden bg-gray-100 active:opacity-80 transition-opacity"
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}

              {/* 操作条：赞 / 评论（QQ空间右下角互动条） */}
              <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-50">
                <button
                  onClick={() => toggleLike(m)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs transition-colors ${
                    m.liked
                      ? 'bg-red-50 text-red-500'
                      : 'text-gray-400 hover:bg-gray-50'
                  }`}
                >
                  <Heart size={14} className={m.liked ? 'fill-red-500' : ''} />
                  {m.liked ? '已赞' : '赞'}
                  {m.likesCount > 0 && <span className="tabular-nums">{m.likesCount}</span>}
                </button>
                <button
                  onClick={() => toggleComments(m)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs transition-colors ${
                    expanded === m.id ? 'bg-primary-50 text-primary-600' : 'text-gray-400 hover:bg-gray-50'
                  }`}
                >
                  <MessageCircle size={14} /> 评论
                  {m.commentsCount > 0 && <span className="tabular-nums">{m.commentsCount}</span>}
                </button>
              </div>

              {/* 评论区（展开式） */}
              {expanded === m.id && (
                <div className="mt-2 rounded-xl bg-gray-50 p-2.5 space-y-2">
                  {(comments[m.id] || []).length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-1">还没有评论</p>
                  ) : (
                    (comments[m.id] || []).map((c) => (
                      <div key={c.id} className="text-xs leading-relaxed">
                        <span className="font-medium text-primary-700">
                          {c.user?.nickname || c.user?.username || '匿名'}
                        </span>
                        <span className="text-gray-300 mx-1">:</span>
                        <span className="text-gray-600">{c.content}</span>
                      </div>
                    ))
                  )}
                  {/* 评论输入 */}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      className="flex-1 text-xs bg-white rounded-full px-3 py-1.5 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-200"
                      placeholder="说点什么..."
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendComment(m)
                      }}
                    />
                    <button
                      onClick={() => sendComment(m)}
                      disabled={commentSending || !commentDraft.trim()}
                      className="w-7 h-7 rounded-full text-white flex items-center justify-center disabled:opacity-40 shrink-0"
                      style={{ background: 'linear-gradient(135deg, #334155, #1E293B)' }}
                    >
                      {commentSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        {/* 加载更多 */}
        {!loading && hasMore && (
          <button
            onClick={() => load(page + 1, true)}
            disabled={loadingMore}
            className="w-full py-2.5 text-xs text-primary-600 font-medium hover:bg-primary-50/50 rounded-xl transition-colors flex items-center justify-center gap-1"
          >
            {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
            {loadingMore ? '加载中...' : '加载更多动态'}
          </button>
        )}
        {!loading && !hasMore && moments.length > 0 && (
          <p className="text-center text-[10px] text-gray-300 py-2">— 到底了 —</p>
        )}
      </div>

      {/* 全屏大图浏览 */}
      {viewer && (
        <ImageViewer
          images={viewer.images}
          index={viewer.index}
          onIndexChange={(i) => setViewer({ ...viewer, index: i })}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  )
}
