import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Search, Copy } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../../components/StateView'
import { formatDateTime, formatDate, priorityMeta, handoverToMarkdown, copyToClipboard } from '../../lib/utils'
import { handoverStatusBadge, handoverShiftMeta } from '../../lib/constants'

/** 交接单（管理员视角，含 user 关联） */
interface AdminHandover {
  id: string
  userId: string
  user: { id: string; username: string; nickname: string | null }
  title: string
  shift: string
  handoverDate: string
  summary?: string | null
  completedItems: string[]
  pendingItems: { text: string; priority: string; dueDate?: string }[]
  notes?: string | null
  status: 'draft' | 'submitted' | 'archived'
  submittedAt?: string | null
  createdAt: string
  updatedAt: string
}

interface ListRes {
  list: AdminHandover[]
  total: number
  page: number
  pageSize: number
}

/** 状态 → 中文标签 + 配色 */
const statusMeta = handoverStatusBadge

/** 过滤器表单值 */
interface FilterForm {
  username?: string
  status?: string
  startDate?: string
  endDate?: string
}

/**
 * 管理后台 · 交接单列表页
 *
 * 功能：
 * 1. 过滤器：用户名搜索 + 状态 + 日期范围
 * 2. 列表表格：时间 / 用户 / 标题 / 班次 / 状态 / 已完成 / 待跟进
 * 3. 点击行展开详情：工作总结 / 已完成事项 / 待跟进事项 / 注意事项
 * 4. 分页
 *
 * 说明：管理员仅查看，不代用户编辑或删除（写操作走用户侧 /handover）
 */
export default function AdminHandovers() {
  const toast = useToast((s) => s.show)
  const [data, setData] = useState<ListRes | null>(null)
  const [filter, setFilter] = useState<FilterForm>({})
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

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
      if (filter.username) params.set('username', filter.username)
      if (filter.status) params.set('status', filter.status)
      if (filter.startDate) params.set('startDate', filter.startDate)
      if (filter.endDate) params.set('endDate', `${filter.endDate}T23:59:59`)
      const res = await unwrap<ListRes>(api.get(`/admin/handovers?${params}`))
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
   * 复制交接单为 Markdown
   * - 管理员视角同样支持导出，方便跨系统同步交接内容
   */
  const copyAsMarkdown = async (h: AdminHandover) => {
    const md = handoverToMarkdown(h)
    const ok = await copyToClipboard(md)
    toast(
      ok ? '已复制为 Markdown' : '复制失败，请手动选择文本复制',
      ok ? 'success' : 'error',
    )
  }

  const statuses = ['draft', 'submitted', 'archived']

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-800 mb-6">交接单管理</h1>

      {/* 过滤器 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* 用户名搜索 */}
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

          {/* 状态 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">状态：</span>
            <select
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
              value={filter.status || ''}
              onChange={(e) => {
                setFilter({ ...filter, status: e.target.value || undefined })
                setPage(1)
              }}
            >
              <option value="">全部</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{statusMeta[s]?.label || s}</option>
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
          {(filter.username || filter.status || filter.startDate || filter.endDate) && (
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
          <EmptyState icon="📋" text="暂无交接单" hint="尝试调整筛选条件" />
        ) : (
          <>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left px-3 py-3 font-medium w-8"></th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap">交接日期</th>
                <th className="text-left px-4 py-3 font-medium">用户</th>
                <th className="text-left px-4 py-3 font-medium">标题</th>
                <th className="text-left px-4 py-3 font-medium">班次</th>
                <th className="text-left px-4 py-3 font-medium">状态</th>
                <th className="text-left px-4 py-3 font-medium">已完成</th>
                <th className="text-left px-4 py-3 font-medium">待跟进</th>
                <th className="text-left px-4 py-3 font-medium">提交时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
            {data.list.map((h) => {
              const sMeta = statusMeta[h.status] || statusMeta.draft
              const shMeta = handoverShiftMeta[h.shift] || handoverShiftMeta['all-day']
              const expanded = expandedId === h.id
              return (
                <Fragment key={h.id}>
                  <tr
                    className={`hover:bg-gray-50 cursor-pointer ${expanded ? 'bg-gray-50' : ''}`}
                    onClick={() => setExpandedId(expanded ? null : h.id)}
                  >
                    <td className="px-3 py-3 text-gray-400">
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {formatDate(h.handoverDate)}
                    </td>
                    <td className="px-4 py-3 text-gray-800">
                      {h.user.nickname || h.user.username}
                      <span className="text-xs text-gray-400 ml-1">@{h.user.username}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-xs truncate" title={h.title}>
                      {h.title}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {shMeta.icon} {shMeta.label}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${sMeta.color}`}>{sMeta.label}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{h.completedItems.length}</td>
                    <td className="px-4 py-3 text-gray-600">{h.pendingItems.length}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {h.submittedAt ? formatDateTime(h.submittedAt) : '—'}
                    </td>
                  </tr>
                  {/* 展开详情 */}
                  {expanded && (
                    <tr className="bg-gray-50">
                      <td colSpan={9} className="px-12 py-4 text-sm text-gray-700">
                        <div className="space-y-3">
                          {/* 工作总结 */}
                          {h.summary ? (
                            <div>
                              <div className="text-xs text-gray-400 mb-1">工作总结</div>
                              <div className="bg-white border border-gray-200 rounded p-2 whitespace-pre-wrap">
                                {h.summary}
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400">未填写工作总结</div>
                          )}

                          {/* 已完成事项 */}
                          {h.completedItems.length > 0 && (
                            <div>
                              <div className="text-xs text-gray-400 mb-1">已完成事项</div>
                              <ul className="bg-white border border-gray-200 rounded p-2 space-y-1">
                                {h.completedItems.map((item, i) => (
                                  <li key={i} className="flex items-start gap-2">
                                    <span className="text-green-500">✓</span>
                                    <span className="line-through text-gray-500">{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* 待跟进事项 */}
                          {h.pendingItems.length > 0 && (
                            <div>
                              <div className="text-xs text-gray-400 mb-1">待跟进事项</div>
                              <ul className="bg-white border border-gray-200 rounded p-2 space-y-1.5">
                                {h.pendingItems.map((item, i) => {
                                  const pMeta = priorityMeta[item.priority] || priorityMeta.medium
                                  return (
                                    <li key={i} className="flex items-center gap-2">
                                      <span className={`badge ${pMeta.bg} ${pMeta.color} text-[10px]`}>
                                        {pMeta.label}
                                      </span>
                                      <span className="flex-1">{item.text}</span>
                                      {item.dueDate && (
                                        <span className="text-xs text-gray-400">
                                          📅 {formatDate(item.dueDate)}
                                        </span>
                                      )}
                                    </li>
                                  )
                                })}
                              </ul>
                            </div>
                          )}

                          {/* 注意事项 */}
                          {h.notes && (
                            <div>
                              <div className="text-xs text-gray-400 mb-1">注意事项</div>
                              <div className="bg-yellow-50 border border-yellow-200 rounded p-2 whitespace-pre-wrap">
                                {h.notes}
                              </div>
                            </div>
                          )}

                          {/* 操作区：复制为 Markdown（跨系统同步用） */}
                          <div className="pt-1">
                            <button
                              onClick={() => copyAsMarkdown(h)}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-white border border-gray-200 rounded text-gray-600 hover:bg-gray-50"
                            >
                              <Copy size={12} /> 复制为 Markdown
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>

        {/* 分页 */}
        {data && data.total > data.pageSize && (
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
