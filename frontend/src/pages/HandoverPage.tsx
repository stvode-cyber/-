import { useEffect, useState } from 'react'
import { useSearchParams, useLocation } from 'react-router-dom'
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Edit3,
  Send,
  Archive,
  Check,
  X,
  Copy,
} from 'lucide-react'
import Header from '../components/Header'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { formatDateTime, formatDate, priorityMeta, handoverToMarkdown, copyToClipboard } from '../lib/utils'
import { handoverStatusMeta, handoverShiftMeta } from '../lib/constants'
import { useConfirm } from '../components/ConfirmDialog'

/** 待跟进事项结构（与后端 pendingItemSchema 对应） */
interface PendingItem {
  text: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueDate?: string
}

/** 交接单结构（与后端 serializeHandover 返回对应） */
interface Handover {
  id: string
  title: string
  shift: string
  handoverDate: string
  summary?: string | null
  completedItems: string[]
  pendingItems: PendingItem[]
  notes?: string | null
  status: 'draft' | 'submitted' | 'archived'
  submittedAt?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * AI 预填数据（来自 ChatPage 交接卡跳转）
 * - priority 用 string 而非 PendingItem['priority']，因为 AI 输出可能包含非标枚举值，需在消费时归一化
 */
interface HandoverAiPrefill {
  completedItems?: string[]
  pendingItems?: { text: string; priority: string; dueDate?: string }[]
  billsSummary?: { expense: number; income: number; count: number }
  dietsSummary?: { meals: number; totalCalories: number }
}

/** 表单初始值 */
const emptyForm: HandoverForm = {
  title: '',
  shift: 'all-day',
  handoverDate: new Date().toISOString().slice(0, 10),
  summary: '',
  completedItems: [],
  pendingItems: [],
  notes: '',
}

interface HandoverForm {
  title: string
  shift: string
  handoverDate: string
  summary: string
  completedItems: string[]
  pendingItems: PendingItem[]
  notes: string
}

/**
 * 工作交接表页
 *
 * 功能：
 * 1. Tab 切换：全部 / 草稿 / 已提交 / 已归档
 * 2. 列表卡片：标题、班次、日期、状态徽章、已完成/待跟进数量统计
 * 3. 点击卡片展开详情：工作总结、已完成列表、待跟进列表、注意事项
 * 4. 状态流转按钮：
 *    - 草稿 → 编辑 / 提交 / 删除
 *    - 已提交 → 归档 / 删除
 *    - 已归档 → 删除
 * 5. 新建/编辑弹层：支持动态增删已完成事项与待跟进事项
 *
 * 与其他模块的交接工作点：
 * - HomePage 快捷入口：`/handover?new=1` 自动打开新建弹层
 * - ChatPage AI 卡片跳转：`/handover?new=1` 携带 location.state.aiPrefill 预填表单
 *   - aiPrefill.completedItems: string[]      预填已完成事项
 *   - aiPrefill.pendingItems:   PendingItem[] 预填待跟进事项
 *   - aiPrefill.billsSummary / dietsSummary:  展示在弹层顶部，供用户参考
 */
export default function HandoverPage() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const location = useLocation()
  const [list, setList] = useState<Handover[]>([])
  const [filter, setFilter] = useState<'all' | 'draft' | 'submitted' | 'archived'>('all')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Handover | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  // AI 卡片跳转携带的预填数据（来自 ChatPage 的 handover_card）
  // 通过 location.state.aiPrefill 传入，新建弹层会读取并预填表单
  const [aiPrefill, setAiPrefill] = useState<HandoverAiPrefill | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    load()
    // 来自 HomePage / ChatPage 快捷入口 ?new=1 → 自动打开新增弹层
    if (searchParams.get('new') === '1') {
      setShowForm(true)
      // 读取 location.state 中的 AI 预填数据（若有）
      const state = location.state as { aiPrefill?: HandoverAiPrefill } | null
      if (state?.aiPrefill) {
        setAiPrefill(state.aiPrefill)
      }
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [filter])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`
      const data = await unwrap<Handover[]>(api.get(`/handover${query}`))
      setList(data)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /** 提交交接单（draft → submitted） */
  const submit = async (h: Handover) => {
    try {
      await unwrap(api.post(`/handover/${h.id}/submit`))
      toast('交接单已提交', 'success')
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /** 归档交接单（submitted → archived） */
  const archive = async (h: Handover) => {
    try {
      await unwrap(api.post(`/handover/${h.id}/archive`))
      toast('交接单已归档', 'success')
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /** 删除交接单 */
  const remove = async (h: Handover) => {
    if (!(await confirm({
      title: '删除交接单',
      message: `确认删除交接单「${h.title}」？此操作不可恢复。`,
      confirmText: '删除',
      danger: true,
    }))) return
    try {
      await unwrap(api.delete(`/handover/${h.id}`))
      toast('已删除', 'success')
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /**
   * 复制交接单为 Markdown 到剪贴板
   * - 用于跨系统交接（飞书 / 钉钉 / 邮件等粘贴使用）
   * - 共享 utils.copyToClipboard 自动回退 execCommand
   */
  const copyAsMarkdown = async (h: Handover) => {
    const md = handoverToMarkdown(h)
    const ok = await copyToClipboard(md)
    toast(
      ok ? '已复制为 Markdown，可粘贴到飞书/文档' : '复制失败，请手动选择文本复制',
      ok ? 'success' : 'error',
    )
  }

  /** 打开编辑弹层（仅草稿可编辑） */
  const openEdit = (h: Handover) => {
    setEditing(h)
    setShowForm(true)
  }

  /** 打开新建弹层 */
  const openCreate = () => {
    setEditing(null)
    setShowForm(true)
  }

  const tabs = [
    { key: 'all', label: '全部' },
    { key: 'draft', label: '草稿' },
    { key: 'submitted', label: '已提交' },
    { key: 'archived', label: '已归档' },
  ] as const

  return (
    <div className="app-shell">
      <Header
        title="工作交接表"
        right={
          <button onClick={openCreate} className="p-2 text-primary-600">
            <Plus size={20} />
          </button>
        }
      />
      <div className="sticky top-12 bg-white z-10 border-b border-gray-100">
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`flex-1 py-3 text-sm border-b-2 ${
                filter === t.key
                  ? 'border-primary-500 text-primary-600 font-medium'
                  : 'border-transparent text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-3 space-y-2">
        {loading ? (
          <LoadingState skeleton count={3} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : list.length === 0 ? (
          <EmptyState icon="📋" text="暂无交接单" hint="点击右上角 + 创建" />
        ) : (
          list.map((h) => {
            const sMeta = handoverStatusMeta[h.status] || handoverStatusMeta.draft
            const shMeta = handoverShiftMeta[h.shift] || handoverShiftMeta['all-day']
            const expanded = expandedId === h.id
            return (
              <div key={h.id} className="card group">
                <div
                  className="flex items-start gap-3 cursor-pointer"
                  onClick={() => setExpandedId(expanded ? null : h.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-300">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                      <span className="text-sm font-medium text-gray-800 truncate">{h.title}</span>
                      <span className={`badge ${sMeta.bg} ${sMeta.color}`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${sMeta.dot} mr-1`} />
                        {sMeta.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400 ml-5">
                      <span>{shMeta.icon} {shMeta.label}</span>
                      <span>📅 {formatDate(h.handoverDate)}</span>
                    </div>
                    {/* 数量统计徽章 */}
                    <div className="flex items-center gap-2 mt-2 ml-5">
                      <span className="badge bg-green-50 text-green-600">
                        <Check size={10} className="mr-0.5" /> 已完成 {h.completedItems.length}
                      </span>
                      <span className="badge bg-orange-50 text-orange-600">
                        ⏳ 待跟进 {h.pendingItems.length}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 展开详情 */}
                {expanded && (
                  <div className="mt-3 pt-3 border-t border-gray-50 ml-5 space-y-3">
                    {/* 工作总结 */}
                    {h.summary ? (
                      <div>
                        <div className="text-xs text-gray-500 mb-1">工作总结</div>
                        <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-2 whitespace-pre-wrap">
                          {h.summary}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">未填写工作总结</div>
                    )}

                    {/* 已完成事项 */}
                    {h.completedItems.length > 0 && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1">已完成事项</div>
                        <ul className="space-y-1">
                          {h.completedItems.map((item, i) => (
                            <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                              <Check size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                              <span className="line-through text-gray-500">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 待跟进事项 */}
                    {h.pendingItems.length > 0 && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1">待跟进事项</div>
                        <ul className="space-y-1.5">
                          {h.pendingItems.map((item, i) => {
                            const pMeta = priorityMeta[item.priority] || priorityMeta.medium
                            return (
                              <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                                <span className={`badge ${pMeta.bg} ${pMeta.color} text-[10px] flex-shrink-0`}>
                                  {pMeta.label}
                                </span>
                                <span className="flex-1">{item.text}</span>
                                {item.dueDate && (
                                  <span className="text-xs text-gray-400">📅 {formatDate(item.dueDate)}</span>
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
                        <div className="text-xs text-gray-500 mb-1">注意事项</div>
                        <div className="text-sm text-gray-700 bg-yellow-50 rounded-lg p-2 whitespace-pre-wrap">
                          {h.notes}
                        </div>
                      </div>
                    )}

                    {/* 提交时间 */}
                    {h.submittedAt && (
                      <div className="text-xs text-gray-400">提交于 {formatDateTime(h.submittedAt)}</div>
                    )}

                    {/* 操作按钮（依状态显示） */}
                    <div className="flex gap-2 pt-2 flex-wrap">
                      {h.status === 'draft' && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); openEdit(h) }}
                            className="btn-secondary flex items-center gap-1 text-xs px-3 py-1.5"
                          >
                            <Edit3 size={12} /> 编辑
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); submit(h) }}
                            className="btn-primary flex items-center gap-1 text-xs px-3 py-1.5"
                          >
                            <Send size={12} /> 提交
                          </button>
                        </>
                      )}
                      {h.status === 'submitted' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); archive(h) }}
                          className="btn-secondary flex items-center gap-1 text-xs px-3 py-1.5"
                        >
                          <Archive size={12} /> 归档
                        </button>
                      )}
                      {/* 复制为 Markdown：所有状态可用，用于跨系统粘贴 */}
                      <button
                        onClick={(e) => { e.stopPropagation(); copyAsMarkdown(h) }}
                        className="btn-secondary flex items-center gap-1 text-xs px-3 py-1.5"
                      >
                        <Copy size={12} /> 复制MD
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); remove(h) }}
                        className="ml-auto text-xs px-3 py-1.5 text-red-500 hover:bg-red-50 rounded-lg flex items-center gap-1"
                      >
                        <Trash2 size={12} /> 删除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {showForm && (
        <HandoverFormModal
          editing={editing}
          aiPrefill={aiPrefill}
          onClose={() => {
            setShowForm(false)
            setEditing(null)
            setAiPrefill(null)
          }}
          onSaved={load}
        />
      )}
    </div>
  )
}

/**
 * 交接单新建/编辑弹层
 *
 * - editing 为 null → 新建模式
 * - editing 不为 null → 编辑模式（仅草稿可进入）
 * - aiPrefill 不为 null → 新建模式下使用 AI 预填数据
 *
 * 表单字段：
 * - 标题 / 班次 / 交接日期
 * - 工作总结（textarea）
 * - 已完成事项（可动态增删的字符串列表）
 * - 待跟进事项（可动态增删，每项含 text / priority / dueDate）
 * - 注意事项（textarea）
 */
function HandoverFormModal({
  editing,
  aiPrefill,
  onClose,
  onSaved,
}: {
  editing: Handover | null
  aiPrefill?: HandoverAiPrefill | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast((s) => s.show)
  const isEdit = !!editing
  // 是否使用 AI 预填数据（仅新建模式 + 有 aiPrefill 时生效）
  const hasAiPrefill = !isEdit && !!aiPrefill

  const [form, setForm] = useState<HandoverForm>(() => {
    if (editing) {
      return {
        title: editing.title,
        shift: editing.shift,
        handoverDate: editing.handoverDate.slice(0, 10),
        summary: editing.summary || '',
        completedItems: [...editing.completedItems],
        pendingItems: editing.pendingItems.map((p) => ({
          text: p.text,
          priority: p.priority,
          dueDate: p.dueDate ? p.dueDate.slice(0, 10) : '',
        })),
        notes: editing.notes || '',
      }
    }
    // AI 预填：用 ChatPage 传入的今日已完成事项和待跟进事项
    if (aiPrefill) {
      const today = new Date().toISOString().slice(0, 10)
      return {
        title: `${today} 工作交接（AI 生成）`,
        shift: 'all-day',
        handoverDate: today,
        summary: '',
        completedItems: [...(aiPrefill.completedItems || [])],
        pendingItems: (aiPrefill.pendingItems || []).map((p) => ({
          text: p.text || '',
          priority: (['low', 'medium', 'high', 'urgent'].includes(p.priority)
            ? p.priority
            : 'medium') as PendingItem['priority'],
          dueDate: p.dueDate ? String(p.dueDate).slice(0, 10) : '',
        })),
        notes: '',
      }
    }
    return { ...emptyForm }
  })
  const [loading, setLoading] = useState(false)

  // 已完成事项：临时输入框 + 提交
  const [completedInput, setCompletedInput] = useState('')

  const addCompleted = () => {
    const text = completedInput.trim()
    if (!text) return
    setForm((f) => ({ ...f, completedItems: [...f.completedItems, text] }))
    setCompletedInput('')
  }

  const removeCompleted = (i: number) => {
    setForm((f) => ({ ...f, completedItems: f.completedItems.filter((_, idx) => idx !== i) }))
  }

  const addPending = () => {
    setForm((f) => ({
      ...f,
      pendingItems: [...f.pendingItems, { text: '', priority: 'medium', dueDate: '' }],
    }))
  }

  const updatePending = (i: number, patch: Partial<PendingItem>) => {
    setForm((f) => ({
      ...f,
      pendingItems: f.pendingItems.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    }))
  }

  const removePending = (i: number) => {
    setForm((f) => ({ ...f, pendingItems: f.pendingItems.filter((_, idx) => idx !== i) }))
  }

  const submit = async () => {
    if (!form.title.trim()) {
      toast('请输入交接单标题', 'error')
      return
    }
    // 校验待跟进事项：若填了，文本不能为空
    const invalidPending = form.pendingItems.find((p) => !p.text.trim())
    if (invalidPending) {
      toast('待跟进事项内容不能为空', 'error')
      return
    }

    setLoading(true)
    try {
      const payload = {
        title: form.title.trim(),
        shift: form.shift,
        handoverDate: new Date(form.handoverDate).toISOString(),
        summary: form.summary.trim() || undefined,
        completedItems: form.completedItems,
        pendingItems: form.pendingItems.map((p) => ({
          text: p.text.trim(),
          priority: p.priority,
          dueDate: p.dueDate ? new Date(p.dueDate).toISOString() : undefined,
        })),
        notes: form.notes.trim() || undefined,
      }

      if (isEdit && editing) {
        await unwrap(api.patch(`/handover/${editing.id}`, payload))
        toast('交接单已更新', 'success')
      } else {
        await unwrap(api.post('/handover', payload))
        toast('交接单已创建', 'success')
      }
      onSaved()
      onClose()
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
        className="relative bg-white w-full max-w-[480px] mx-auto rounded-t-2xl max-h-[90vh] overflow-y-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{isEdit ? '编辑交接单' : '新建交接单'}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* AI 预填数据展示（来自 ChatPage 的 handover_card） */}
          {hasAiPrefill && (aiPrefill.billsSummary || aiPrefill.dietsSummary) && (
            <div className="bg-teal-50 border border-teal-100 rounded-lg p-3 space-y-1">
              <div className="text-xs font-medium text-teal-700 flex items-center gap-1">
                🤖 AI 已汇总今日数据，已预填到下方表单
              </div>
              {aiPrefill.billsSummary && (
                <div className="text-xs text-gray-600">
                  💰 今日支出 ¥{aiPrefill.billsSummary.expense.toFixed(2)}
                  {aiPrefill.billsSummary.income > 0 && (
                    <> · 收入 ¥{aiPrefill.billsSummary.income.toFixed(2)}</>
                  )}
                  {' '}/ {aiPrefill.billsSummary.count} 笔
                </div>
              )}
              {aiPrefill.dietsSummary && (
                <div className="text-xs text-gray-600">
                  🍱 {aiPrefill.dietsSummary.meals} 餐 · 🔥 {aiPrefill.dietsSummary.totalCalories} kcal
                </div>
              )}
            </div>
          )}

          {/* 标题 */}
          <div>
            <label className="text-xs text-gray-500">交接单标题 *</label>
            <input
              autoFocus
              className="input mt-1"
              placeholder="例如：8月3日工作交接"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          {/* 班次 + 日期 */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500">班次</label>
              <div className="flex gap-1 mt-1 flex-wrap">
                {Object.entries(handoverShiftMeta).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => setForm((f) => ({ ...f, shift: key }))}
                    className={`px-2 py-1 rounded-lg text-xs border ${
                      form.shift === key
                        ? 'border-primary-500 bg-primary-50 text-primary-600'
                        : 'border-gray-200 text-gray-500'
                    }`}
                  >
                    {meta.icon} {meta.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500">交接日期</label>
            <input
              type="date"
              className="input mt-1"
              value={form.handoverDate}
              onChange={(e) => setForm((f) => ({ ...f, handoverDate: e.target.value }))}
            />
          </div>

          {/* 工作总结 */}
          <div>
            <label className="text-xs text-gray-500">工作总结</label>
            <textarea
              className="input mt-1 min-h-[80px] resize-y"
              placeholder="本期完成的主要工作、关键进展..."
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
            />
          </div>

          {/* 已完成事项 */}
          <div>
            <label className="text-xs text-gray-500">已完成事项</label>
            <div className="flex gap-2 mt-1">
              <input
                className="input flex-1"
                placeholder="输入后回车添加"
                value={completedInput}
                onChange={(e) => setCompletedInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCompleted()
                  }
                }}
              />
              <button onClick={addCompleted} className="btn-secondary px-3">
                <Plus size={16} />
              </button>
            </div>
            {form.completedItems.length > 0 && (
              <ul className="mt-2 space-y-1">
                {form.completedItems.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-2 py-1.5">
                    <Check size={14} className="text-green-500 flex-shrink-0" />
                    <span className="flex-1 text-gray-700">{item}</span>
                    <button
                      onClick={() => removeCompleted(i)}
                      className="text-gray-300 hover:text-red-500"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 待跟进事项 */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500">待跟进事项</label>
              <button
                onClick={addPending}
                className="text-xs text-primary-600 flex items-center gap-1"
              >
                <Plus size={12} /> 添加
              </button>
            </div>
            {form.pendingItems.length === 0 ? (
              <div className="text-xs text-gray-400 mt-1">暂无待跟进事项</div>
            ) : (
              <ul className="mt-2 space-y-2">
                {form.pendingItems.map((item, i) => (
                  <li key={i} className="bg-orange-50/50 border border-orange-100 rounded-lg p-2 space-y-2">
                    <div className="flex gap-2">
                      <input
                        className="input flex-1"
                        placeholder="待跟进事项内容"
                        value={item.text}
                        onChange={(e) => updatePending(i, { text: e.target.value })}
                      />
                      <button
                        onClick={() => removePending(i)}
                        className="text-gray-300 hover:text-red-500 px-2"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex gap-1 flex-wrap">
                        {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                          <button
                            key={p}
                            onClick={() => updatePending(i, { priority: p })}
                            className={`px-2 py-0.5 rounded text-[10px] border ${
                              item.priority === p
                                ? `border-primary-500 ${priorityMeta[p].bg} ${priorityMeta[p].color}`
                                : 'border-gray-200 text-gray-500'
                            }`}
                          >
                            {priorityMeta[p].label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="date"
                        className="input flex-1 text-xs py-1"
                        value={item.dueDate || ''}
                        onChange={(e) => updatePending(i, { dueDate: e.target.value })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 注意事项 */}
          <div>
            <label className="text-xs text-gray-500">注意事项</label>
            <textarea
              className="input mt-1 min-h-[60px] resize-y"
              placeholder="交接给后续班次/接手人的关键提醒..."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">取消</button>
          <button onClick={submit} disabled={loading} className="btn-primary flex-1 disabled:opacity-50">
            {loading ? '保存中...' : isEdit ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
