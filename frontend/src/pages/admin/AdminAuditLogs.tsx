import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { formatDateTime } from '../../lib/utils'
import { LoadingState, ErrorState, EmptyState } from '../../components/StateView'
import { AUDIT_CATEGORIES, auditCategoryMeta } from '../../lib/constants'

/**
 * 单条审计日志（与后端 AuditLog 模型对应）
 */
interface AuditLog {
  id: string
  userId?: string | null
  username?: string | null
  category: string
  action: string
  targetType?: string | null
  targetId?: string | null
  summary: string
  detail?: string | null
  result: string
  ip?: string | null
  userAgent?: string | null
  durationMs?: number | null
  createdAt: string
}

/** 列表接口响应 */
interface AuditListRes {
  list: AuditLog[]
  total: number
  page: number
  pageSize: number
}

/** 统计接口响应（近 N 天） */
interface AuditStats {
  days: number
  total: number
  success: number
  fail: number
  byCategory: Record<string, number>
}

/** 过滤器表单值 */
interface FilterForm {
  username?: string
  category?: string
  result?: string
  startDate?: string
  endDate?: string
}

/**
 * 管理后台 · 台账页面
 *
 * 功能：
 * 1. 顶部统计卡片：近 7 天总数 / 成功 / 失败 / 分类数
 * 2. 分类占比条：按分类显示日志数量分布
 * 3. 过滤器：用户名搜索 + 分类 + 结果 + 日期范围
 * 4. 日志表格：时间 / 用户 / 分类 / 动作 / 描述 / IP / 耗时 / 结果
 * 5. 点击行展开详情（detail / userAgent / targetId）
 * 6. 分页
 */
export default function AdminAuditLogs() {
  const toast = useToast((s) => s.show)
  const [data, setData] = useState<AuditListRes | null>(null)
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [filter, setFilter] = useState<FilterForm>({})
  const [page, setPage] = useState(1)
  // 当前展开详情的日志 ID
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // 列表加载/错误状态
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // 统计加载/错误状态
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState(false)

  // 列表与统计在同一 effect 内加载：filter / page 变化时同步刷新统计
  useEffect(() => {
    load()
    loadStats()
  }, [page, filter])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '30')
      if (filter.username) params.set('username', filter.username)
      if (filter.category) params.set('category', filter.category)
      if (filter.result) params.set('result', filter.result)
      if (filter.startDate) params.set('startDate', filter.startDate)
      if (filter.endDate) params.set('endDate', `${filter.endDate}T23:59:59`)
      const res = await unwrap<AuditListRes>(api.get(`/admin/audit-logs?${params}`))
      setData(res)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    setStatsLoading(true)
    setStatsError(false)
    try {
      const res = await unwrap<AuditStats>(api.get('/admin/audit-logs/stats?days=7'))
      setStats(res)
    } catch (err) {
      setStatsError(true)
      toast((err as Error).message, 'error')
    } finally {
      setStatsLoading(false)
    }
  }

  /** 重置过滤器 */
  const resetFilter = () => {
    setFilter({})
    setPage(1)
  }

  /** 格式化耗时 */
  const formatDuration = (ms?: number | null): string => {
    if (!ms && ms !== 0) return '—'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  /** 解析 detail JSON 用于展示 */
  const parseDetail = (detail?: string | null): unknown => {
    if (!detail) return null
    try {
      return JSON.parse(detail)
    } catch {
      return detail
    }
  }

  const categories = AUDIT_CATEGORIES
  const results = ['success', 'fail']

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-800 mb-6">台账 · 操作日志</h1>

      {/* 统计卡片 */}
      {statsError ? (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <ErrorState text="统计加载失败" onRetry={loadStats} />
        </div>
      ) : statsLoading ? (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-5 animate-pulse">
              <div className="h-3 w-16 bg-gray-200 rounded mb-3" />
              <div className="h-7 w-20 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="text-sm text-gray-500 mb-1">近7天总数</div>
            <div className="text-2xl font-bold text-gray-800">{stats.total}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="text-sm text-gray-500 mb-1">成功</div>
            <div className="text-2xl font-bold text-green-500">{stats.success}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="text-sm text-gray-500 mb-1">失败</div>
            <div className="text-2xl font-bold text-red-500">{stats.fail}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="text-sm text-gray-500 mb-1">分类数</div>
            <div className="text-2xl font-bold text-primary-600">
              {Object.keys(stats.byCategory).length}
            </div>
          </div>
        </div>
      ) : null}

      {/* 分类占比 */}
      {stats && stats.total > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-medium text-gray-800 mb-4">分类占比</h2>
          <div className="space-y-2">
            {Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
              const meta = auditCategoryMeta[cat] || { label: cat, color: 'bg-gray-100 text-gray-700' }
              const percent = ((count / stats.total) * 100).toFixed(1)
              return (
                <div key={cat} className="flex items-center gap-3">
                  <span className={`badge ${meta.color} w-12 justify-center`}>{meta.label}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-16 text-right">{count} 条</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
                <option key={c} value={c}>{auditCategoryMeta[c]?.label || c}</option>
              ))}
            </select>
          </div>

          {/* 结果 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">结果：</span>
            <select
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
              value={filter.result || ''}
              onChange={(e) => {
                setFilter({ ...filter, result: e.target.value || undefined })
                setPage(1)
              }}
            >
              <option value="">全部</option>
              {results.map((r) => (
                <option key={r} value={r}>{r === 'success' ? '成功' : '失败'}</option>
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
          {(filter.username || filter.category || filter.result || filter.startDate || filter.endDate) && (
            <button
              onClick={resetFilter}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              重置
            </button>
          )}
        </div>
      </div>

      {/* 日志表格：四态渲染（loading / error / empty / 正常） */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          // 加载中：骨架屏
          <LoadingState skeleton count={5} />
        ) : error ? (
          // 加载失败：错误兜底 + 重试
          <ErrorState text="日志加载失败" onRetry={load} />
        ) : !data || data.list.length === 0 ? (
          // 空状态：用 📊 图标
          <EmptyState icon="📊" text="暂无日志" hint="尝试调整过滤条件或稍后再试" />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-3 py-3 font-medium w-8"></th>
                  <th className="text-left px-4 py-3 font-medium whitespace-nowrap">时间</th>
                  <th className="text-left px-4 py-3 font-medium">用户</th>
                  <th className="text-left px-4 py-3 font-medium">分类</th>
                  <th className="text-left px-4 py-3 font-medium">动作</th>
                  <th className="text-left px-4 py-3 font-medium">描述</th>
                  <th className="text-left px-4 py-3 font-medium">IP</th>
                  <th className="text-left px-4 py-3 font-medium">耗时</th>
                  <th className="text-left px-4 py-3 font-medium">结果</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.list.map((log) => {
                  const meta = auditCategoryMeta[log.category] || { label: log.category, color: 'bg-gray-100' }
                  const expanded = expandedId === log.id
                  const detail = parseDetail(log.detail)
                  return (
                    <Fragment key={log.id}>
                      <tr
                        className={`hover:bg-gray-50 cursor-pointer ${expanded ? 'bg-gray-50' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : log.id)}
                      >
                        <td className="px-3 py-3 text-gray-400">
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-gray-800">{log.username || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`badge ${meta.color}`}>{meta.label}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 font-mono text-xs">{log.action}</td>
                        <td className="px-4 py-3 text-gray-700 max-w-xs truncate" title={log.summary}>
                          {log.summary}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs font-mono">{log.ip || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {formatDuration(log.durationMs)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`badge ${
                              log.result === 'success'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {log.result === 'success' ? '成功' : '失败'}
                          </span>
                        </td>
                      </tr>
                      {/* 展开行：详情 */}
                      {expanded && (
                        <tr className="bg-gray-50">
                          <td colSpan={9} className="px-12 py-4 text-xs text-gray-600">
                            <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                              <div>
                                <span className="text-gray-400">关联资源：</span>
                                <span className="font-mono">
                                  {log.targetType || '—'} {log.targetId ? `#${log.targetId.slice(-8)}` : ''}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400">用户ID：</span>
                                <span className="font-mono">{log.userId || '—'}</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-gray-400">UserAgent：</span>
                                <span className="break-all">{log.userAgent || '—'}</span>
                              </div>
                              {detail !== null && (
                                <div className="col-span-2">
                                  <span className="text-gray-400">详情：</span>
                                  <pre className="mt-1 bg-white border border-gray-200 rounded p-2 overflow-x-auto text-xs">
                                    {typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}
                                  </pre>
                                </div>
                              )}
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
