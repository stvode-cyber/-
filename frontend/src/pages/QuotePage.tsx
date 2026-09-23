import { useState, useMemo, useCallback } from 'react'
import {
  Quote as QuoteIcon, Plus, Trash2, X, Heart, Shuffle, Copy, BookOpen,
} from 'lucide-react'
import {
  getTodayQuote, getQuotesByCategory, getQuoteStat,
  addCustomQuote, deleteCustomQuote, toggleFavorite, isFavorite,
  CATEGORY_META, todayStr,
  type Quote, type QuoteCategory,
} from '../lib/quoteStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 每日金句页
 *
 * 布局：
 * 1. 今日金句大卡（含日期、随机换一条、收藏、复制）
 * 2. 分类筛选 Tab
 * 3. 金句列表（瀑布流卡片，点击收藏/复制）
 * 4. 添加自定义金句弹窗
 */

/** 分类选项（含 all 和 favorite） */
const TAB_OPTIONS: { key: QuoteCategory | 'all' | 'favorite'; label: string; emoji: string }[] = [
  { key: 'all', label: '全部', emoji: '📚' },
  { key: 'favorite', label: '收藏', emoji: '❤️' },
  ...(Object.keys(CATEGORY_META) as QuoteCategory[]).map((c) => ({
    key: c,
    label: CATEGORY_META[c].label,
    emoji: CATEGORY_META[c].emoji,
  })),
]

export default function QuotePage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const [tab, setTab] = useState<QuoteCategory | 'all' | 'favorite'>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [todayQuote, setTodayQuote] = useState<Quote>(() => getTodayQuote())

  const quotes = useMemo(() => getQuotesByCategory(tab), [tab, version])
  const stat = useMemo(() => getQuoteStat(), [version])
  const favSet = useMemo(() => {
    const map = new Set<string>()
    quotes.forEach((q) => { if (isFavorite(q.id)) map.add(q.id) })
    return map
  }, [quotes, version])

  const handleFavorite = useCallback((quote: Quote) => {
    const wasFav = isFavorite(quote.id)
    toggleFavorite(quote.id)
    toast(wasFav ? '已取消收藏' : '已收藏 ❤️', wasFav ? 'info' : 'success')
    refresh()
  }, [toast, refresh])

  const handleCopy = useCallback((quote: Quote) => {
    const text = `"${quote.text}" —— ${quote.author}`
    navigator.clipboard?.writeText(text).then(
      () => toast('已复制到剪贴板', 'success'),
      () => toast('复制失败，请手动复制', 'error'),
    )
  }, [toast])

  const handleShuffle = useCallback(() => {
    const all = getQuotesByCategory('all')
    const next = all[Math.floor(Math.random() * all.length)]
    setTodayQuote(next)
    toast('换一条', 'info')
  }, [toast])

  const handleDelete = useCallback((quote: Quote) => {
    if (quote.source !== 'custom') return
    deleteCustomQuote(quote.id)
    toast('已删除自定义金句', 'info')
    refresh()
  }, [toast, refresh])

  const handleAdd = useCallback((text: string, author: string, category: QuoteCategory) => {
    addCustomQuote(text, author, category)
    toast('金句已添加 ✨', 'success')
    setShowAdd(false)
    refresh()
  }, [toast, refresh])

  const today = todayStr()
  const tqMeta = CATEGORY_META[todayQuote.category]

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <QuoteIcon size={22} className="text-amber-500" /> 每日金句
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              共 {stat.total} 条 · 收藏 {stat.favorites} · 自定义 {stat.custom}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 active:scale-95 transition-all flex items-center gap-1"
          >
            <Plus size={15} /> 添加
          </button>
        </div>

        {/* 今日金句大卡 */}
        <div
          className="rounded-2xl p-6 mb-4 relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${tqMeta.color}18 0%, ${tqMeta.color}06 100%)`, border: `1px solid ${tqMeta.color}20` }}
        >
          {/* 装饰大引号 */}
          <div
            className="absolute top-2 right-3 text-6xl select-none pointer-events-none leading-none"
            style={{ color: tqMeta.color, opacity: 0.1 }}
          >
            "
          </div>
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">{tqMeta.emoji}</span>
              <span className="text-xs font-medium" style={{ color: tqMeta.color }}>{tqMeta.label}</span>
              <span className="text-[10px] text-gray-400 ml-auto">{today.slice(5).replace('-', '/')} 每日一签</span>
            </div>
            <p className="text-base leading-relaxed text-gray-800 font-medium mb-3" style={{ fontFamily: 'serif' }}>
              {todayQuote.text}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500" style={{ fontFamily: 'serif' }}>—— {todayQuote.author}</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleShuffle}
                  className="p-2 rounded-lg text-gray-400 hover:text-amber-500 hover:bg-amber-50 transition-colors"
                  title="换一条"
                >
                  <Shuffle size={15} />
                </button>
                <button
                  onClick={() => handleFavorite(todayQuote)}
                  className="p-2 rounded-lg transition-colors"
                  style={isFavorite(todayQuote.id) ? { color: '#EF4444' } : { color: 'rgb(156,163,175)' }}
                  title="收藏"
                >
                  <Heart size={15} className={isFavorite(todayQuote.id) ? 'fill-current' : ''} />
                </button>
                <button
                  onClick={() => handleCopy(todayQuote)}
                  className="p-2 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                  title="复制"
                >
                  <Copy size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 分类筛选 Tab */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
          {TAB_OPTIONS.map((opt) => {
            const active = tab === opt.key
            const count = opt.key === 'all' ? stat.total : opt.key === 'favorite' ? stat.favorites : undefined
            return (
              <button
                key={opt.key}
                onClick={() => setTab(opt.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
                  active ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                <span>{opt.emoji}</span>
                {opt.label}
                {count !== undefined && (
                  <span className={`tabular-nums ${active ? 'text-white/70' : 'text-gray-400'}`}>{count}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* 金句列表 */}
        {quotes.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="text-2xl mb-1.5">{tab === 'favorite' ? '❤️' : '📖'}</div>
            <p className="text-xs text-gray-400">
              {tab === 'favorite' ? '还没有收藏的金句' : '该分类暂无金句'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {quotes.map((quote) => {
              const meta = CATEGORY_META[quote.category]
              const fav = favSet.has(quote.id)
              return (
                <div
                  key={quote.id}
                  className="card p-4 group hover:shadow-md transition-shadow"
                  style={{ borderLeft: `3px solid ${meta.color}` }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-xs">{meta.emoji}</span>
                    <span className="text-[10px] font-medium" style={{ color: meta.color }}>{meta.label}</span>
                    {quote.source === 'custom' && (
                      <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-amber-50 text-amber-500">自定义</span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed text-gray-700 mb-2" style={{ fontFamily: 'serif' }}>
                    {quote.text}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400" style={{ fontFamily: 'serif' }}>—— {quote.author}</span>
                    <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleFavorite(quote)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={fav ? { color: '#EF4444' } : { color: 'rgb(209,213,219)' }}
                      >
                        <Heart size={13} className={fav ? 'fill-current' : ''} />
                      </button>
                      <button
                        onClick={() => handleCopy(quote)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                      >
                        <Copy size={13} />
                      </button>
                      {quote.source === 'custom' && (
                        <button
                          onClick={() => handleDelete(quote)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 添加自定义金句弹窗 */}
      {showAdd && (
        <QuoteModal onClose={() => setShowAdd(false)} onSave={handleAdd} />
      )}
    </div>
  )
}

// ===== 添加弹窗 =====

const CATEGORY_LIST = Object.keys(CATEGORY_META) as QuoteCategory[]

function QuoteModal({ onClose, onSave }: {
  onClose: () => void
  onSave: (text: string, author: string, category: QuoteCategory) => void
}) {
  const [text, setText] = useState('')
  const [author, setAuthor] = useState('')
  const [category, setCategory] = useState<QuoteCategory>('wisdom')

  const valid = text.trim().length >= 4 && text.trim().length <= 200

  const submit = () => {
    if (!valid) return
    onSave(text.trim(), author.trim(), category)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-1.5">
            <BookOpen size={15} className="text-amber-500" /> 添加金句
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-2 block">内容（4-200 字）</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={200}
              rows={4}
              placeholder="写下打动你的那句话…"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-amber-400 resize-none"
              style={{ fontFamily: 'serif' }}
            />
            <div className="text-right text-[10px] text-gray-300 mt-0.5">{text.length}/200</div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-2 block">作者（可选）</label>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              maxLength={30}
              placeholder="如：杨绛"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-amber-400"
              style={{ fontFamily: 'serif' }}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-2 block">分类</label>
            <div className="grid grid-cols-3 gap-1.5">
              {CATEGORY_LIST.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`py-2 rounded-lg text-xs border transition flex items-center justify-center gap-1 ${
                    category === c ? 'border-amber-400 bg-amber-50 text-amber-600 font-semibold' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  <span>{CATEGORY_META[c].emoji}</span>
                  {CATEGORY_META[c].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="flex-1 py-2.5 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}
