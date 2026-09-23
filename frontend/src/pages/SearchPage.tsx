import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, ArrowLeft } from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { fromNow } from '../lib/utils'
import { useDebounce } from '../hooks/useDebounce'

/** 单条搜索结果（与后端 6 大模块序列化结构对应） */
interface SearchResult {
  id: string
  type: 'task' | 'bill' | 'diet' | 'reminder' | 'post' | 'handover'
  title: string
  subtitle: string
  createdAt: string
  // 各模块特有字段（可选）
  status?: string
  dueDate?: string | null
  billDate?: string
  eatenAt?: string
  remindAt?: string
  content?: string
  handoverDate?: string
}

/** 聚合搜索结果 */
interface SearchResponse {
  results: {
    tasks: SearchResult[]
    bills: SearchResult[]
    diets: SearchResult[]
    reminders: SearchResult[]
    posts: SearchResult[]
    handovers: SearchResult[]
  }
  total: number
  q: string
}

/** 模块 → 展示配置 */
const moduleMeta: Record<string, { label: string; icon: string; route: string; color: string }> = {
  tasks: { label: '任务', icon: '📋', route: '/tasks', color: 'text-purple-600' },
  bills: { label: '账单', icon: '💰', route: '/finance', color: 'text-green-600' },
  diets: { label: '饮食', icon: '🍱', route: '/diet', color: 'text-orange-600' },
  reminders: { label: '提醒', icon: '🔔', route: '/tasks?view=reminders', color: 'text-indigo-600' },
  posts: { label: '社区', icon: '💬', route: '/community', color: 'text-blue-600' },
  handovers: { label: '交接单', icon: '📋', route: '/handover', color: 'text-teal-600' },
}

/** localStorage 搜索历史 key */
const HISTORY_KEY = 'aie_search_history'
const MAX_HISTORY = 8

/**
 * 全局搜索页
 *
 * 功能：
 * 1. 顶部搜索框（自动聚焦）+ 实时搜索（防抖 300ms）
 * 2. 无输入时：展示搜索历史 + 热门推荐词
 * 3. 有输入时：分模块展示聚合结果，每模块最多 5 条
 * 4. 点击结果跳转到对应模块页面
 * 5. 搜索历史保存在 localStorage，最多 8 条
 *
 * 接口：
 * - GET /search?q=keyword  全局聚合搜索
 * - GET /search/hot         热门推荐词
 */
export default function SearchPage() {
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const [input, setInput] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [lastQuery, setLastQuery] = useState('')
  const [data, setData] = useState<SearchResponse | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [hot, setHot] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  // 防抖后的搜索词：停止输入 300ms 后才触发搜索
  const debouncedInput = useDebounce(input, 300)

  /** 自动聚焦 + 加载历史和热门词 */
  useEffect(() => {
    inputRef.current?.focus()
    // 加载搜索历史
    try {
      const saved = localStorage.getItem(HISTORY_KEY)
      if (saved) setHistory(JSON.parse(saved))
    } catch {
      // ignore
    }
    // 加载热门推荐
    unwrap<string[]>(api.get('/search/hot'))
      .then(setHot)
      .catch(() => {
        // ignore，热门词加载失败不阻塞
      })
  }, [])

  /** 保存搜索历史（去重 + 最新在前 + 最多 8 条） */
  const saveHistory = useCallback((q: string) => {
    setHistory((prev) => {
      const next = [q, ...prev.filter((h) => h !== q)].slice(0, MAX_HISTORY)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  /** 执行搜索 */
  const doSearch = useCallback(async (q: string) => {
    setSearching(true)
    setSearchError(false)
    setLastQuery(q)
    try {
      const res = await unwrap<SearchResponse>(api.get('/search', { params: { q } }))
      setData(res)
      // 保存到历史
      saveHistory(q)
    } catch (err) {
      setSearchError(true)
      toast((err as Error).message, 'error')
    } finally {
      setSearching(false)
    }
  }, [toast, saveHistory])

  /** 防抖搜索：监听 debouncedInput 变化 */
  useEffect(() => {
    const q = debouncedInput.trim()
    if (!q) {
      setData(null)
      setSearchError(false)
      return
    }
    doSearch(q)
  }, [debouncedInput, doSearch])

  /** 清空搜索历史 */
  const clearHistory = () => {
    setHistory([])
    localStorage.removeItem(HISTORY_KEY)
    toast('搜索历史已清空', 'info')
  }

  /** 点击历史/热门词快速搜索 */
  const quickSearch = (q: string) => {
    setInput(q)
  }

  /** 点击结果项跳转 */
  const onItemClick = (type: string, _item: SearchResult) => {
    const meta = moduleMeta[type]
    if (meta) navigate(meta.route)
  }

  // 有搜索关键词时展示结果
  const hasQuery = input.trim().length > 0
  const results = data?.results

  // 非空模块列表
  const activeModules = results
    ? Object.entries(results).filter(([, items]) => items.length > 0)
    : []

  return (
    <div className="app-shell">
      {/* 顶部搜索框 */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-100">
        <div className="flex items-center gap-2 px-3 py-2">
          <button onClick={() => navigate(-1)} className="p-1 text-gray-500">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 flex items-center bg-gray-100 rounded-lg px-3 py-2 gap-2">
            <Search size={16} className="text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="搜索任务、账单、饮食..."
              className="flex-1 bg-transparent text-sm outline-none"
            />
            {input && (
              <button onClick={() => setInput('')} className="text-gray-400">
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-3 py-3">
        {/* 搜索中 */}
        {searching && <LoadingState text="搜索中..." />}

        {/* 搜索失败重试态 */}
        {!searching && searchError && (
          <ErrorState text="搜索失败，请稍后重试" onRetry={() => doSearch(lastQuery)} retryText="重新搜索" />
        )}

        {/* 无输入时：历史 + 热门推荐 */}
        {!hasQuery && !searching && !searchError && (
          <div className="space-y-5">
            {/* 搜索历史 */}
            {history.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs text-gray-500">搜索历史</h3>
                  <button onClick={clearHistory} className="text-xs text-gray-400">
                    清空
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {history.map((h) => (
                    <button
                      key={h}
                      onClick={() => quickSearch(h)}
                      className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* 热门推荐 */}
            {hot.length > 0 && (
              <section>
                <h3 className="text-xs text-gray-500 mb-2">热门搜索</h3>
                <div className="flex flex-wrap gap-2">
                  {hot.map((h) => (
                    <button
                      key={h}
                      onClick={() => quickSearch(h)}
                      className="px-3 py-1.5 text-sm bg-primary-50 text-primary-600 rounded-full hover:bg-primary-100"
                    >
                      🔥 {h}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {history.length === 0 && hot.length === 0 && (
              <EmptyState
                icon="🔍"
                text="输入关键词开始搜索"
                hint="支持任务/账单/饮食/提醒/社区/交接单"
              />
            )}
          </div>
        )}

        {/* 搜索结果 */}
        {hasQuery && !searching && !searchError && data && (
          <div>
            {/* 总数 */}
            <div className="text-xs text-gray-500 mb-3">
              找到 <b className="text-primary-600">{data.total}</b> 条与「{data.q}」相关的结果
            </div>

            {/* 无结果 */}
            {data.total === 0 && (
              <EmptyState
                icon="🔍"
                text="没有找到相关结果"
                hint="试试其他关键词？"
              />
            )}

            {/* 分模块展示结果 */}
            {activeModules.map(([moduleKey, items]) => {
              const meta = moduleMeta[moduleKey]
              if (!meta) return null
              const typedItems = items as SearchResult[]
              return (
                <section key={moduleKey} className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className={`text-sm font-medium ${meta.color}`}>
                      {meta.icon} {meta.label}
                      <span className="ml-1 text-xs text-gray-400">({typedItems.length})</span>
                    </h3>
                  </div>
                  <div className="card divide-y divide-gray-50">
                    {typedItems.map((item) => (
                      <button
                        key={`${moduleKey}-${item.id}`}
                        onClick={() => onItemClick(moduleKey, item)}
                        className="w-full flex items-start gap-2 py-2.5 text-left hover:bg-gray-50 -mx-1 px-1 rounded"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-800 truncate">{item.title}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{item.subtitle}</div>
                        </div>
                        <div className="text-xs text-gray-300 flex-shrink-0">
                          {fromNow(item.createdAt)}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
