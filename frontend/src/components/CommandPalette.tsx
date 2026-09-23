import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, ArrowRight, Hash } from 'lucide-react'
import { searchAll, getHotKeywords, type SearchResultItem } from '../lib/api'
import { useDebounce } from '../hooks/useDebounce'
import { fromNow } from '../lib/utils'

/**
 * 全局搜索命令面板（Ctrl+K）
 *
 * 特性：
 * - 在任何页面按 Ctrl/Cmd+K 唤起
 * - 实时搜索 11 大模块（防抖 200ms）
 * - 结果按模块分组，键盘上下导航
 * - 回车跳转，Escape 关闭
 * - 空输入时展示热门词 + 搜索历史
 */

interface ModuleMeta {
  label: string
  icon: string
  route: string
  color: string
}

const MODULE_META: Record<string, ModuleMeta> = {
  tasks: { label: '任务', icon: '📋', route: '/tasks', color: 'text-purple-600' },
  bills: { label: '账单', icon: '💰', route: '/finance', color: 'text-green-600' },
  diets: { label: '饮食', icon: '🍱', route: '/diet', color: 'text-orange-600' },
  reminders: { label: '提醒', icon: '🔔', route: '/tasks?view=reminders', color: 'text-indigo-600' },
  posts: { label: '社区', icon: '💬', route: '/community', color: 'text-blue-600' },
  handovers: { label: '交接', icon: '📋', route: '/handover', color: 'text-teal-600' },
  fragments: { label: '碎片', icon: '📝', route: '/fragments', color: 'text-amber-600' },
  voiceMemos: { label: '语音', icon: '🎙️', route: '/voice-memos', color: 'text-rose-600' },
  manualEvents: { label: '事件', icon: '📅', route: '/tasks', color: 'text-cyan-600' },
  countdowns: { label: '倒计时', icon: '⏰', route: '/countdowns', color: 'text-red-600' },
  stickyNotes: { label: '便签', icon: '📌', route: '/sticky', color: 'text-yellow-600' },
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [results, setResults] = useState<Record<string, SearchResultItem[]> | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hotWords, setHotWords] = useState<string[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const debouncedInput = useDebounce(input, 200)
  const inputRef = useRef<HTMLInputElement>(null)

  // 加载热门词 + 搜索历史
  useEffect(() => {
    if (open) {
      getHotKeywords().then(setHotWords).catch(() => {})
      try {
        const h = JSON.parse(localStorage.getItem('aie_search_history') || '[]')
        setHistory(h)
      } catch {
        setHistory([])
      }
    }
  }, [open])

  // 自动聚焦
  useEffect(() => {
    if (open) {
      setInput('')
      setResults(null)
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // 防抖搜索
  useEffect(() => {
    if (!open || !debouncedInput.trim()) {
      setResults(null)
      setTotal(0)
      return
    }
    let cancelled = false
    setLoading(true)
    searchAll(debouncedInput)
      .then((res) => {
        if (cancelled) return
        setResults(res.results)
        setTotal(res.total)
        setActiveIndex(0)
      })
      .catch(() => {
        if (cancelled) return
        setResults(null)
        setTotal(0)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedInput, open])

  // 保存搜索历史
  const saveHistory = useCallback((q: string) => {
    try {
      const h = JSON.parse(localStorage.getItem('aie_search_history') || '[]')
      const filtered = h.filter((x: string) => x !== q)
      const updated = [q, ...filtered].slice(0, 8)
      localStorage.setItem('aie_search_history', JSON.stringify(updated))
    } catch {
      // ignore
    }
  }, [])

  // 扁平化结果用于键盘导航
  const flatResults: { module: string; item: SearchResultItem }[] = results
    ? Object.entries(results).flatMap(([module, items]) => items.map((item) => ({ module, item })))
    : []

  const handleNavigate = useCallback(
    (module: string, _item: SearchResultItem) => {
      const meta = MODULE_META[module]
      if (meta) {
        saveHistory(input)
        navigate(meta.route)
        onClose()
      }
    },
    [input, navigate, onClose, saveHistory]
  )

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (flatResults[activeIndex]) {
        const { module, item } = flatResults[activeIndex]
        handleNavigate(module, item)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* 面板 */}
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-accent-200 overflow-hidden">
        {/* 搜索框 */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-accent-100">
          <Search size={20} className="text-accent-400 shrink-0" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索任务、账单、饮食、提醒、碎片..."
            className="flex-1 text-[15px] outline-none placeholder:text-accent-300 bg-transparent"
          />
          {loading && (
            <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin shrink-0" />
          )}
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded-md text-accent-400 hover:text-accent-600 hover:bg-accent-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 结果区 */}
        <div className="max-h-[50vh] overflow-y-auto">
          {/* 无输入时展示热门词 + 历史 */}
          {!input.trim() && (
            <div className="p-4 space-y-4">
              {history.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-400 mb-2">
                    搜索历史
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {history.map((h) => (
                      <button
                        key={h}
                        onClick={() => setInput(h)}
                        className="px-3 py-1.5 text-[13px] rounded-lg bg-accent-50 text-accent-600 hover:bg-accent-100 transition-colors"
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {hotWords.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-400 mb-2">
                    热门搜索
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {hotWords.map((w) => (
                      <button
                        key={w}
                        onClick={() => setInput(w)}
                        className="px-3 py-1.5 text-[13px] rounded-lg bg-accent-50 text-accent-600 hover:bg-accent-100 transition-colors flex items-center gap-1"
                      >
                        <Hash size={12} className="text-accent-300" />
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 搜索结果 */}
          {input.trim() && results && total === 0 && !loading && (
            <div className="px-4 py-12 text-center text-accent-400 text-sm">
              未找到与「{input}」相关的内容
            </div>
          )}

          {results && total > 0 && (
            <div className="py-2">
              {Object.entries(results).map(([module, items]) => {
                if (items.length === 0) return null
                const meta = MODULE_META[module]
                if (!meta) return null
                return (
                  <div key={module} className="mb-1">
                    <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent-400 flex items-center gap-1.5">
                      <span>{meta.icon}</span>
                      {meta.label}
                      <span className="text-accent-300">({items.length})</span>
                    </div>
                    {items.map((item) => {
                      const idx = flatResults.findIndex(
                        (f) => f.module === module && f.item.id === item.id
                      )
                      const active = idx === activeIndex
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleNavigate(module, item)}
                          onMouseEnter={() => setActiveIndex(idx)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            active ? 'bg-primary-50' : 'hover:bg-accent-50'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className={`text-[14px] font-medium truncate ${active ? 'text-primary-700' : 'text-accent-700'}`}>
                              {item.title}
                            </div>
                            <div className="text-[12px] text-accent-400 truncate">
                              {item.subtitle} · {fromNow(item.createdAt)}
                            </div>
                          </div>
                          {active && <ArrowRight size={16} className="text-primary-400 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-accent-100 bg-accent-50/50">
          <div className="flex items-center gap-3 text-[11px] text-accent-400">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-white border border-accent-200 text-[10px]">↑↓</kbd>
              导航
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-white border border-accent-200 text-[10px]">↵</kbd>
              跳转
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-white border border-accent-200 text-[10px]">Esc</kbd>
              关闭
            </span>
          </div>
          {total > 0 && (
            <span className="text-[11px] text-accent-400">{total} 条结果</span>
          )}
        </div>
      </div>
    </div>
  )
}
