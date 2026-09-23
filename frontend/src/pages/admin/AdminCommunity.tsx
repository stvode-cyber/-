import { useEffect, useState } from 'react'
import { Search, Trash2, MessageCircle, Heart, Star } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../../components/StateView'
import { formatDateTime } from '../../lib/utils'
import { COMMUNITY_CATEGORIES, communityCategoryMeta } from '../../lib/constants'
import { useConfirm } from '../../components/ConfirmDialog'

/** 社区帖子（管理员视角，含作者信息） */
interface Post {
  id: string
  content: string
  category: string
  aiSource?: string | null
  likesCount: number
  commentsCount: number
  favoritesCount: number
  createdAt: string
  updatedAt: string
  user: {
    id: string
    username: string
    nickname: string | null
    avatar?: string | null
  } | null
}

interface ListRes {
  list: Post[]
  total: number
  page: number
  pageSize: number
}

/** 过滤器表单值 */
interface FilterForm {
  keyword?: string
  username?: string
  category?: string
  startDate?: string
  endDate?: string
}

/**
 * 管理后台 · 社区内容管理页
 *
 * 功能：
 * 1. 过滤器：内容关键词 + 用户名 + 分类 + 日期范围
 * 2. 列表表格：内容预览 / 作者 / 分类 / 互动统计（点赞·评论·收藏）/ 发布时间
 * 3. 删除帖子：二次确认，级联清理评论/点赞/收藏（后端 onDelete: Cascade）
 *
 * 说明：管理员仅做内容审核与违规清理，不代用户编辑帖子内容
 */
export default function AdminCommunity() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const [data, setData] = useState<ListRes | null>(null)
  const [filter, setFilter] = useState<FilterForm>({})
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [page, filter])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '20')
      if (filter.keyword) params.set('keyword', filter.keyword)
      if (filter.username) params.set('username', filter.username)
      if (filter.category) params.set('category', filter.category)
      if (filter.startDate) params.set('startDate', filter.startDate)
      if (filter.endDate) params.set('endDate', `${filter.endDate}T23:59:59`)
      const res = await unwrap<ListRes>(api.get(`/admin/community?${params}`))
      setData(res)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const resetFilter = () => {
    setFilter({})
    setPage(1)
  }

  /**
   * 删除帖子
   * - 二次确认，避免误删
   * - 删除后刷新当前页
   */
  const remove = async (post: Post) => {
    if (!(await confirm({
      title: '删除帖子',
      message: '确认删除该帖子？此操作将级联清理其评论/点赞/收藏，不可恢复。',
      confirmText: '删除',
      danger: true,
    }))) return
    setDeleting(post.id)
    try {
      await unwrap(api.delete(`/admin/community/${post.id}`))
      toast('帖子已删除', 'success')
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setDeleting(null)
    }
  }

  const categories = COMMUNITY_CATEGORIES

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-800 mb-6">社区内容管理</h1>

      {/* 过滤器 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* 内容关键词 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">内容：</span>
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="关键词"
                value={filter.keyword || ''}
                onChange={(e) => setFilter({ ...filter, keyword: e.target.value || undefined })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setPage(1)
                    load()
                  }
                }}
                className="border border-gray-200 rounded-lg pl-7 pr-2 py-1 text-sm w-32"
              />
            </div>
          </div>

          {/* 用户名 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">用户：</span>
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="用户名"
                value={filter.username || ''}
                onChange={(e) => setFilter({ ...filter, username: e.target.value || undefined })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setPage(1)
                    load()
                  }
                }}
                className="border border-gray-200 rounded-lg pl-7 pr-2 py-1 text-sm w-32"
              />
            </div>
          </div>

          {/* 分类 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">分类：</span>
            <select
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
              value={filter.category || ''}
              onChange={(e) => {
                setFilter({ ...filter, category: e.target.value || undefined })
                setPage(1)
              }}
            >
              <option value="">全部</option>
              {categories.map((c) => (
                <option key={c} value={c}>{communityCategoryMeta[c]?.label || c}</option>
              ))}
            </select>
          </div>

          {/* 日期范围 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">日期：</span>
            <input
              type="date"
              value={filter.startDate || ''}
              onChange={(e) => {
                setFilter({ ...filter, startDate: e.target.value || undefined })
                setPage(1)
              }}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
            />
            <span className="text-gray-400">—</span>
            <input
              type="date"
              value={filter.endDate || ''}
              onChange={(e) => {
                setFilter({ ...filter, endDate: e.target.value || undefined })
                setPage(1)
              }}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
            />
          </div>

          {/* 重置 */}
          {(filter.keyword || filter.username || filter.category || filter.startDate || filter.endDate) && (
            <button
              onClick={resetFilter}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              重置
            </button>
          )}
        </div>
      </div>

      {/* 列表表格 */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <LoadingState skeleton count={5} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : !data || data.list.length === 0 ? (
          <EmptyState icon="💬" text="暂无社区帖子" hint="尝试调整筛选条件" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">内容</th>
                    <th className="text-left px-4 py-3 font-medium whitespace-nowrap">作者</th>
                    <th className="text-left px-4 py-3 font-medium">分类</th>
                    <th className="text-left px-4 py-3 font-medium whitespace-nowrap">互动统计</th>
                    <th className="text-left px-4 py-3 font-medium whitespace-nowrap">发布时间</th>
                    <th className="text-left px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.list.map((p) => {
                    const cMeta = communityCategoryMeta[p.category] || { label: p.category, color: 'bg-gray-100 text-gray-700' }
                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-800 max-w-md">
                          <div className="line-clamp-2 break-words">{p.content}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {p.user?.nickname || p.user?.username || '未知'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs ${cMeta.color}`}>
                            {cMeta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          <div className="flex items-center gap-3 text-xs">
                            <span className="inline-flex items-center gap-0.5" title="点赞">
                              <Heart size={12} /> {p.likesCount}
                            </span>
                            <span className="inline-flex items-center gap-0.5" title="评论">
                              <MessageCircle size={12} /> {p.commentsCount}
                            </span>
                            <span className="inline-flex items-center gap-0.5" title="收藏">
                              <Star size={12} /> {p.favoritesCount}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                          {formatDateTime(p.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => remove(p)}
                            disabled={deleting === p.id}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40"
                          >
                            <Trash2 size={12} />
                            {deleting === p.id ? '删除中...' : '删除'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {data.total > data.pageSize && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50 text-sm">
                <span className="text-gray-500">共 {data.total} 条 · 第 {data.page} 页</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                  >
                    上一页
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page * data.pageSize >= data.total}
                    className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
