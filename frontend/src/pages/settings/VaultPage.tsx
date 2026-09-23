import { useEffect, useState, useCallback } from 'react'
import {
  Brain, Plus, Search, Pin, PinOff, Pencil, Trash2, X, Loader2,
} from 'lucide-react'
import Header from '../../components/Header'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { LoadingState, ErrorState } from '../../components/StateView'

/**
 * AI 记忆库（用户资料库 / Obsidian 式）
 *
 * 每个账号在服务端有独立资料库：
 * - 对话中 AI 自动提炼值得长期记住的用户资料（人物/偏好/事项/时间线）
 * - 对话时自动检索注入，让 AI"记得"用户
 * - 本页可查看/搜索/置顶/编辑/删除，也可手动添加
 */

interface VaultNote {
  id: string
  title: string
  category: string
  content: string
  tags: string[]
  pinned: boolean
  source: string
  updatedAt: string
}

interface VaultData {
  notes: VaultNote[]
  stats: { total: number; byCategory: Record<string, number> }
}

const CATEGORY_TABS: { key: string; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'person', label: '人物' },
  { key: 'preference', label: '偏好' },
  { key: 'event', label: '事项' },
  { key: 'timeline', label: '时间线' },
  { key: 'other', label: '其他' },
]

const CATEGORY_BADGE: Record<string, string> = {
  person: 'bg-blue-50 text-blue-600',
  preference: 'bg-teal-50 text-teal-600',
  event: 'bg-amber-50 text-amber-600',
  timeline: 'bg-purple-50 text-purple-600',
  other: 'bg-gray-100 text-gray-500',
}

/** 编辑/新建弹层状态 */
interface EditState {
  mode: 'create' | 'edit'
  id?: string
  title: string
  content: string
  category: string
  tags: string
}

export default function VaultPage() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const [data, setData] = useState<VaultData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams()
      if (category) params.set('category', category)
      if (search.trim()) params.set('search', search.trim())
      const d = await unwrap<VaultData>(api.get(`/vault${params.toString() ? `?${params}` : ''}`))
      setData(d)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [category, search])

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0) // 搜索防抖
    return () => clearTimeout(t)
  }, [load, search])

  /** 置顶/取消置顶 */
  const togglePin = async (n: VaultNote) => {
    try {
      await unwrap(api.put(`/vault/${n.id}`, { pinned: !n.pinned }))
      toast(n.pinned ? '已取消置顶' : '已置顶（始终注入对话）', 'success')
      load()
    } catch (e: any) {
      toast(e?.message || '操作失败', 'error')
    }
  }

  /** 删除 */
  const remove = async (n: VaultNote) => {
    if (!(await confirm({ title: '删除笔记', message: `确定删除「${n.title}」？AI 将不再记得这条信息。`, confirmText: '删除' }))) return
    try {
      await unwrap(api.delete(`/vault/${n.id}`))
      toast('已删除', 'success')
      load()
    } catch (e: any) {
      toast(e?.message || '删除失败', 'error')
    }
  }

  /** 保存（新建/编辑） */
  const save = async () => {
    if (!edit) return
    const title = edit.title.trim()
    const content = edit.content.trim()
    if (!title || !content) {
      toast('标题和内容不能为空', 'error')
      return
    }
    setSaving(true)
    try {
      const tags = edit.tags.split(/[,，\s]+/).filter(Boolean).slice(0, 5)
      if (edit.mode === 'create') {
        await unwrap(api.post('/vault', { title, content, category: edit.category, tags }))
      } else {
        await unwrap(api.put(`/vault/${edit.id}`, { title, content, category: edit.category, tags }))
      }
      toast(edit.mode === 'create' ? '已添加' : '已保存', 'success')
      setEdit(null)
      load()
    } catch (e: any) {
      toast(e?.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app-shell">
      <Header title="AI 记忆库" />

      <div className="px-3 py-4 space-y-4">
        {/* 说明卡 */}
        <div className="card p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
            <Brain size={18} className="text-primary-600" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-800">AI 记住的你的资料</div>
            <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
              对话中提到的个人信息（人物、偏好、重要事项）会自动沉淀到这里，AI 对话时会自动引用。
              你可以查看、修改或删除任何一条——置顶的笔记会始终被 AI 记得。
            </p>
            {data && (
              <div className="mt-2 text-xs text-gray-400">
                共 {data.stats.total} 条
                {Object.entries(data.stats.byCategory).map(([k, v]) => ` · ${CATEGORY_TABS.find((t) => t.key === k)?.label || k} ${v}`).join('')}
              </div>
            )}
          </div>
        </div>

        {/* 搜索 + 新建 */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索标题或内容…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-primary-400 focus:outline-none"
            />
          </div>
          <button
            onClick={() => setEdit({ mode: 'create', title: '', content: '', category: 'other', tags: '' })}
            className="px-3 py-2 rounded-xl bg-primary-600 text-white text-sm flex items-center gap-1 hover:bg-primary-700 transition-colors cursor-pointer"
          >
            <Plus size={15} /> 添加
          </button>
        </div>

        {/* 分类筛选 */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {CATEGORY_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setCategory(t.key)}
              className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors cursor-pointer ${
                category === t.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-primary-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 列表 */}
        {loading ? (
          <LoadingState text="加载记忆库…" />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : !data || data.notes.length === 0 ? (
          <div className="card p-10 text-center text-sm text-gray-400">
            {search || category ? '没有匹配的笔记' : '还没有记忆。去和 AI 聊聊你的事，它会自动记住值得记的。'}
          </div>
        ) : (
          <div className="space-y-2">
            {data.notes.map((n) => (
              <div key={n.id} className="card p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {n.pinned && <Pin size={13} className="text-primary-500 flex-shrink-0" />}
                    <span className="text-sm font-medium text-gray-800 truncate">{n.title}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => togglePin(n)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors cursor-pointer" title={n.pinned ? '取消置顶' : '置顶（始终注入对话）'}>
                      {n.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button onClick={() => setEdit({ mode: 'edit', id: n.id, title: n.title, content: n.content, category: n.category, tags: n.tags.join(' ') })} className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors cursor-pointer" title="编辑">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => remove(n)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer" title="删除">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <p className="mt-1.5 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{n.content}</p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${CATEGORY_BADGE[n.category] || CATEGORY_BADGE.other}`}>
                    {CATEGORY_TABS.find((t) => t.key === n.category)?.label || '其他'}
                  </span>
                  {n.source === 'auto' && <span className="text-[10px] text-gray-400">AI 自动沉淀</span>}
                  {n.tags.map((t) => (
                    <span key={t} className="text-[10px] text-gray-400">#{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新建/编辑弹层 */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setEdit(null)}>
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800">{edit.mode === 'create' ? '添加笔记' : '编辑笔记'}</h3>
              <button onClick={() => setEdit(null)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 cursor-pointer"><X size={18} /></button>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">标题</label>
              <input
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                maxLength={60}
                placeholder="如：不吃香菜"
                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-primary-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">分类</label>
              <div className="flex gap-2 flex-wrap">
                {CATEGORY_TABS.filter((t) => t.key).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setEdit({ ...edit, category: t.key })}
                    className={`px-3 py-1.5 rounded-full text-xs transition-colors cursor-pointer ${
                      edit.category === t.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">内容</label>
              <textarea
                value={edit.content}
                onChange={(e) => setEdit({ ...edit, content: e.target.value })}
                maxLength={2000}
                rows={4}
                placeholder="一句话事实，如：用户不吃香菜，点外卖要去掉"
                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-primary-400 focus:outline-none resize-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">标签（空格分隔，最多 5 个）</label>
              <input
                value={edit.tags}
                onChange={(e) => setEdit({ ...edit, tags: e.target.value })}
                placeholder="如：饮食 忌口"
                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-primary-400 focus:outline-none"
              />
            </div>
            <button
              onClick={save}
              disabled={saving}
              className="w-full py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {edit.mode === 'create' ? '添加' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
