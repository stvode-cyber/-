import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Trash2, Pencil, Search, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { useConfirm } from '../components/ConfirmDialog'
import { useDebounce } from '../hooks/useDebounce'
import { formatDateTime } from '../lib/utils'
import { fragmentKindMeta, FRAGMENT_KINDS } from '../lib/constants'

/**
 * 碎片信息（与后端 FragmentDTO 对齐）
 */
interface FragmentItem {
  id: string
  content: string
  kind: string
  tags: string[]
  sourceMsgId: string | null
  digested: boolean
  note: string | null
  createdAt: string
}

/**
 * DG-09 跨模块洞察：单条信号样本（与后端 InsightSample 对齐）
 */
interface InsightSample {
  fragmentId: string
  content: string
  createdAt: string
  suggestion: string
}

/**
 * DG-09 跨模块洞察：任务回响（与后端 InsightTaskEcho 对齐）
 */
interface InsightTaskEcho {
  taskId: string
  taskTitle: string
  taskStatus: string
  echoCount: number
  samples: InsightSample[]
}

/**
 * DG-09 跨模块洞察结果（与后端 InsightsResult 对齐）
 */
interface InsightsData {
  days: number
  totalCount: number
  signals: {
    orphanTodos: InsightSample[]
    unactedIdeas: InsightSample[]
    financeMentions: InsightSample[]
    taskEchoes: InsightTaskEcho[]
  }
  signalCount: number
  summary: string
  generatedAt: string
}

/** kind 筛选选项：全部 + 5 种分类 */
type KindFilter = 'all' | typeof FRAGMENT_KINDS[number]

/**
 * 碎片信息管理页 · DG-07 补全
 *
 * 功能：
 * 1. 列表展示：按创建时间倒序，支持 kind 分类筛选 + 关键词搜索
 * 2. 编辑：调整内容、分类、标签、备注（PATCH /fragment/:id）
 * 3. 删除：确认对话框，避免误操作
 * 4. 新建：手动添加碎片（POST /fragment），自动分类仍由后端完成
 * 5. ?new=1 自动打开新建弹层（与项目其他页保持一致）
 *
 * 数据来源：GET /fragment?kind=  /  POST /fragment  /  PATCH /fragment/:id  /  DELETE /fragment/:id
 */
export default function FragmentsPage() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const [items, setItems] = useState<FragmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 250)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<FragmentItem | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  // DG-09 跨模块洞察：失败不阻塞列表展示
  const [insights, setInsights] = useState<InsightsData | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsExpanded, setInsightsExpanded] = useState(true)

  useEffect(() => {
    load()
    loadInsights()
    if (searchParams.get('new') === '1') {
      setShowForm(true)
      setEditing(null)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [kindFilter])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const params = kindFilter !== 'all' ? `?kind=${kindFilter}` : ''
      const list = await unwrap<FragmentItem[]>(api.get(`/fragment${params}`))
      setItems(list)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /**
   * DG-09 加载跨模块洞察（不阻塞主列表，失败静默）
   * - 4 类信号：orphanTodos / unactedIdeas / financeMentions / taskEchoes
   * - 信号数为 0 时不展开卡片，避免干扰浏览
   */
  const loadInsights = async () => {
    setInsightsLoading(true)
    try {
      const data = await unwrap<InsightsData>(api.get('/fragment/insights?days=7'))
      setInsights(data)
      // 无信号时自动折叠
      if (data.signalCount === 0) setInsightsExpanded(false)
    } catch {
      // 静默失败：洞察是辅助信息，不影响主功能
    } finally {
      setInsightsLoading(false)
    }
  }

  /** 关键词过滤（本地，避免每次按键都打后端） */
  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (f) =>
        f.content.toLowerCase().includes(q) ||
        f.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }, [items, debouncedQuery])

  const remove = async (item: FragmentItem) => {
    const ok = await confirm({
      title: '删除碎片',
      message: '确定删除该条碎片吗？此操作不可撤销。',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await unwrap(api.delete(`/fragment/${item.id}`))
      setItems((prev) => prev.filter((f) => f.id !== item.id))
      toast('已删除', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const openEdit = (item: FragmentItem) => {
    setEditing(item)
    setShowForm(true)
  }

  const openCreate = () => {
    setEditing(null)
    setShowForm(true)
  }

  const onSaved = (item: FragmentItem, isEdit: boolean) => {
    setItems((prev) => {
      const idx = prev.findIndex((f) => f.id === item.id)
      if (idx === -1) return [item, ...prev]
      const next = [...prev]
      next[idx] = item
      return next
    })
    setShowForm(false)
    setEditing(null)
    toast(isEdit ? '已更新' : '已添加', 'success')
  }

  /** kind 筛选 tab 配置：全部 + 各分类 */
  const kindTabs: { key: KindFilter; label: string; emoji?: string }[] = [
    { key: 'all', label: '全部' },
    ...FRAGMENT_KINDS.map((k) => ({
      key: k as KindFilter,
      label: fragmentKindMeta[k].label,
      emoji: fragmentKindMeta[k].emoji,
    })),
  ]

  return (
    <div className="app-shell">
      <Header
        title="碎片收藏"
        right={
          <button onClick={openCreate} className="p-2 text-primary-600" aria-label="新建碎片">
            <Plus size={20} />
          </button>
        }
      />

      <div className="px-4 py-3 space-y-3">
        {/* DG-09 跨模块洞察卡片：仅在 insights 加载完成且存在信号时展示 */}
        {insights && insights.signalCount > 0 && (
          <InsightsCard
            insights={insights}
            loading={insightsLoading}
            expanded={insightsExpanded}
            onToggle={() => setInsightsExpanded((v) => !v)}
            onRefresh={loadInsights}
          />
        )}

        {/* 搜索框 */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="搜索碎片内容或标签..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* kind 筛选 tab */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {kindTabs.map((tab) => {
            const active = kindFilter === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setKindFilter(tab.key)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tab.emoji && <span className="mr-1">{tab.emoji}</span>}
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* 列表区域：三态渲染 */}
        {loading ? (
          <LoadingState skeleton count={3} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="🧩"
            text={query || kindFilter !== 'all' ? '没有匹配的碎片' : '还没有碎片记录'}
            hint={
              query || kindFilter !== 'all'
                ? '试试调整筛选条件'
                : '在对话页发送任何文字、链接或想法，我会自动帮你分类存储'
            }
            action={
              !query && kindFilter === 'all' ? (
                <button onClick={openCreate} className="btn-primary text-sm">
                  手动添加
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((item) => {
              const meta = fragmentKindMeta[item.kind] || fragmentKindMeta.note
              return (
                <div
                  key={item.id}
                  className="card hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-3">
                    {/* 分类图标 */}
                    <div className={`w-9 h-9 rounded-lg ${meta.bg} flex items-center justify-center text-base flex-shrink-0`}>
                      {meta.emoji}
                    </div>

                    {/* 内容区 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.bg} ${meta.color}`}>
                          {meta.label}
                        </span>
                        {item.digested && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600">
                            已整合
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 ml-auto">
                          {formatDateTime(item.createdAt)}
                        </span>
                      </div>

                      {/* 内容 */}
                      <div className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
                        {item.content}
                      </div>

                      {/* 标签 */}
                      {item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {item.tags.map((tag, i) => (
                            <span
                              key={`${tag}-${i}`}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 备注 */}
                      {item.note && (
                        <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
                          📝 {item.note}
                        </div>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button
                        onClick={() => openEdit(item)}
                        className="p-1.5 text-gray-300 hover:text-primary-500 rounded"
                        aria-label="编辑"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => remove(item)}
                        className="p-1.5 text-gray-300 hover:text-red-500 rounded"
                        aria-label="删除"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showForm && (
        <FragmentFormModal
          onClose={() => {
            setShowForm(false)
            setEditing(null)
          }}
          onSaved={onSaved}
          editing={editing}
        />
      )}
    </div>
  )
}

/**
 * 碎片新增/编辑共用弹层
 *
 * - editing 为 null 时为新建模式：POST /fragment
 * - editing 不为 null 时为编辑模式：PATCH /fragment/:id
 *
 * 字段：
 * - content：必填，1-2000 字
 * - kind：5 选 1，新建时未指定则由后端自动分类
 * - tags：逗号分隔输入，提交时拆分为数组
 * - note：可选备注
 */
function FragmentFormModal({
  onClose,
  onSaved,
  editing,
}: {
  onClose: () => void
  onSaved: (item: FragmentItem, isEdit: boolean) => void
  editing: FragmentItem | null
}) {
  const toast = useToast((s) => s.show)
  const isEdit = !!editing
  const [content, setContent] = useState(editing?.content || '')
  const [kind, setKind] = useState<string>(editing?.kind || '')
  const [tagsInput, setTagsInput] = useState(editing?.tags.join(', ') || '')
  const [note, setNote] = useState(editing?.note || '')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!content.trim()) {
      toast('请输入碎片内容', 'error')
      return
    }
    setLoading(true)
    try {
      // tags 按逗号分隔，去空去重
      const tags = tagsInput
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean)

      const payload: Record<string, unknown> = {
        content: content.trim(),
        tags,
      }
      // kind：未选择时不传，让后端自动分类
      if (kind) payload.kind = kind
      // note：空字符串转为 null
      if (note.trim()) payload.note = note.trim()
      else payload.note = null

      const item = isEdit
        ? await unwrap<FragmentItem>(api.patch(`/fragment/${editing!.id}`, payload))
        : await unwrap<FragmentItem>(api.post('/fragment', payload))

      onSaved(item, isEdit)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white w-full max-w-[480px] mx-auto rounded-t-2xl p-5 animate-slide-up max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">{isEdit ? '编辑碎片' : '新建碎片'}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500">内容</label>
            <textarea
              className="input mt-1 min-h-[100px] resize-y"
              placeholder="记录任何文字、链接、代码、想法..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-gray-500">
              分类 {isEdit ? '' : '（不选则自动分类）'}
            </label>
            <div className="grid grid-cols-5 gap-1.5 mt-1">
              {FRAGMENT_KINDS.map((k) => {
                const meta = fragmentKindMeta[k]
                const active = kind === k
                return (
                  <button
                    key={k}
                    onClick={() => setKind(active ? '' : k)}
                    className={`py-2 rounded-lg text-xs border flex flex-col items-center gap-0.5 ${
                      active
                        ? 'border-primary-500 bg-primary-50 text-primary-600'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    <span className="text-sm">{meta.emoji}</span>
                    <span>{meta.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">标签（逗号分隔）</label>
            <input
              className="input mt-1"
              placeholder="工作, 重要, 跟进"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500">备注（可选）</label>
            <input
              className="input mt-1"
              placeholder="补充说明..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary flex-1">取消</button>
          <button
            onClick={submit}
            disabled={loading}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {loading ? '保存中...' : isEdit ? '更新' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * DG-09 跨模块洞察卡片（FragmentsPage 顶部）
 *
 * 展示碎片与任务/账单之间的未闭环关联信号：
 * - orphanTodos：待办碎片未转化为任务
 * - unactedIdeas：灵感碎片搁置 3 天以上
 * - financeMentions：提及金额但未入账
 * - taskEchoes：任务标题在碎片中重复出现（任务有相关思考）
 *
 * 交互：
 * - 折叠/展开切换（信号数为 0 时默认折叠）
 * - 刷新按钮重新拉取
 * - 每条信号样本展示内容摘要 + 建议行动
 */
function InsightsCard({
  insights,
  loading,
  expanded,
  onToggle,
  onRefresh,
}: {
  insights: InsightsData
  loading: boolean
  expanded: boolean
  onToggle: () => void
  onRefresh: () => void
}) {
  const { signals, summary, days, totalCount, signalCount } = insights
  // 信号类型元数据：label + emoji + 配色
  const signalMeta = [
    {
      key: 'orphanTodos' as const,
      label: '待办未转化',
      emoji: '📋',
      items: signals.orphanTodos,
      color: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    {
      key: 'unactedIdeas' as const,
      label: '灵感搁置',
      emoji: '💡',
      items: signals.unactedIdeas,
      color: 'bg-purple-50 text-purple-700 border-purple-200',
    },
    {
      key: 'financeMentions' as const,
      label: '金额未入账',
      emoji: '💰',
      items: signals.financeMentions,
      color: 'bg-rose-50 text-rose-700 border-rose-200',
    },
    {
      key: 'taskEchoes' as const,
      label: '任务有相关思考',
      emoji: '🔄',
      items: signals.taskEchoes,
      color: 'bg-blue-50 text-blue-700 border-blue-200',
    },
  ]

  return (
    <div className="rounded-2xl border border-primary-200 overflow-hidden bg-gradient-to-br from-primary-50/50 to-accent-50/30">
      {/* 头部：标题 + 信号数 + 折叠按钮 */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-violet-50/50 transition-colors"
      >
        <span className="text-base">🔍</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-800">跨模块洞察</div>
          <div className="text-[10px] text-gray-500 truncate">
            最近 {days} 天 · {totalCount} 条碎片 · {signalCount} 个信号
          </div>
        </div>
        <span className="text-[10px] text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full flex-shrink-0">
          {signalCount} 信号
        </span>
        {expanded ? (
          <ChevronUp size={16} className="text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
        )}
      </button>

      {/* 展开时显示信号详情 */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2.5">
          {/* 摘要文案 */}
          <div className="text-xs text-gray-600 bg-white/60 rounded-lg px-3 py-2 leading-relaxed">
            {summary}
          </div>

          {/* 4 类信号列表 */}
          {signalMeta.map((meta) => {
            if (meta.items.length === 0) return null
            return (
              <div
                key={meta.key}
                className={`rounded-xl border ${meta.color} overflow-hidden`}
              >
                {/* 信号标题 */}
                <div className="px-3 py-2 flex items-center gap-2 bg-white/40">
                  <span className="text-sm">{meta.emoji}</span>
                  <span className="text-xs font-medium flex-1">{meta.label}</span>
                  <span className="text-[10px] bg-white/60 px-1.5 py-0.5 rounded-full">
                    {meta.items.length}
                  </span>
                </div>

                {/* 信号样本列表 */}
                <div className="px-3 py-2 space-y-1.5 bg-white/60">
                  {/* taskEchoes 的结构略有不同（含 taskTitle） */}
                  {meta.key === 'taskEchoes' ? (
                    (meta.items as InsightTaskEcho[]).map((echo, i) => (
                      <div key={i} className="text-xs">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-gray-700 font-medium truncate">
                            {echo.taskTitle}
                          </span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">
                            {echo.echoCount} 条碎片
                          </span>
                        </div>
                        {echo.samples.map((s) => (
                          <div key={s.fragmentId} className="pl-2 border-l border-gray-200 mt-1">
                            <div className="text-gray-600 leading-snug">{s.content}</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">{s.suggestion}</div>
                          </div>
                        ))}
                      </div>
                    ))
                  ) : (
                    (meta.items as InsightSample[]).map((s) => (
                      <div key={s.fragmentId} className="text-xs">
                        <div className="text-gray-700 leading-snug">{s.content}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{s.suggestion}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}

          {/* 刷新按钮 */}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="w-full py-1.5 text-[11px] text-violet-600 bg-white/60 rounded-lg hover:bg-white/80 disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? '刷新中...' : '刷新洞察'}
          </button>
        </div>
      )}
    </div>
  )
}
