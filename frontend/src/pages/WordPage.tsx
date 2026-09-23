import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  BookOpen, Plus, Trash2, X, Heart, Shuffle, Copy, Volume2, Brain, ChevronRight, Check, RotateCcw,
} from 'lucide-react'
import {
  getTodayWord, getWordsByCategory, getWordStat, getDueWords, getDueCount,
  addCustomWord, deleteCustomWord, toggleFavorite, isFavorite,
  reviewWord, getReviewState,
  CATEGORY_META, todayStr,
  type Word, type WordCategory, type ReviewQuality,
} from '../lib/wordStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 每日单词页
 *
 * 布局：
 * 1. 今日单词大卡（含发音、释义、例句、收藏、复制）
 * 2. 待复习卡片（SRS 间隔重复，今日到期词）
 * 3. 分类筛选 Tab
 * 4. 单词列表（卡片样式）
 * 5. 添加自定义单词弹窗
 */

const TAB_OPTIONS: { key: WordCategory | 'all' | 'favorite'; label: string; emoji: string }[] = [
  { key: 'all', label: '全部', emoji: '📚' },
  { key: 'favorite', label: '收藏', emoji: '❤️' },
  ...(Object.keys(CATEGORY_META) as WordCategory[]).map((c) => ({
    key: c,
    label: CATEGORY_META[c].label,
    emoji: CATEGORY_META[c].emoji,
  })),
]

export default function WordPage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const [tab, setTab] = useState<WordCategory | 'all' | 'favorite'>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [todayWord, setTodayWord] = useState<Word>(() => getTodayWord())

  const words = useMemo(() => getWordsByCategory(tab), [tab, version])
  const stat = useMemo(() => getWordStat(), [version])
  const dueCount = useMemo(() => getDueCount(), [version])
  const favSet = useMemo(() => {
    const map = new Set<string>()
    words.forEach((w) => { if (isFavorite(w.id)) map.add(w.id) })
    return map
  }, [words, version])

  const speak = useCallback((text: string) => {
    try {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        toast('当前浏览器不支持语音', 'error')
        return
      }
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-US'
      u.rate = 0.9
      window.speechSynthesis.speak(u)
    } catch {
      toast('发音失败', 'error')
    }
  }, [toast])

  const handleFavorite = useCallback((w: Word) => {
    const was = isFavorite(w.id)
    toggleFavorite(w.id)
    toast(was ? '已取消收藏' : '已收藏 ❤️', was ? 'info' : 'success')
    refresh()
  }, [toast, refresh])

  const handleCopy = useCallback((w: Word) => {
    const text = `${w.word} ${w.phonetic}\n${w.pos} ${w.meaning}\n${w.example}\n${w.exampleTrans}`
    navigator.clipboard?.writeText(text).then(
      () => toast('已复制', 'success'),
      () => toast('复制失败', 'error'),
    )
  }, [toast])

  const handleShuffle = useCallback(() => {
    const all = getWordsByCategory('all')
    const next = all[Math.floor(Math.random() * all.length)]
    setTodayWord(next)
    toast('换一个', 'info')
  }, [toast])

  const handleDelete = useCallback((w: Word) => {
    if (w.source !== 'custom') return
    deleteCustomWord(w.id)
    toast('已删除自定义单词', 'info')
    refresh()
  }, [toast, refresh])

  const handleAdd = useCallback((
    word: string, phonetic: string, meaning: string, pos: string,
    example: string, exampleTrans: string, category: WordCategory,
  ) => {
    addCustomWord(word, phonetic, meaning, pos, example, exampleTrans, category)
    toast('单词已添加 ✨', 'success')
    setShowAdd(false)
    refresh()
  }, [toast, refresh])

  const handleReviewDone = useCallback(() => {
    refresh()
    toast('复习进度已更新', 'success')
  }, [refresh, toast])

  const today = todayStr()
  const twMeta = CATEGORY_META[todayWord.category]

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <BookOpen size={22} className="text-sky-500" /> 每日单词
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              共 {stat.total} 词 · 已学 {stat.learned} · 待复习 {stat.due} · 收藏 {stat.favorites}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 active:scale-95 transition-all flex items-center gap-1"
          >
            <Plus size={15} /> 添加
          </button>
        </div>

        {/* 今日单词大卡 */}
        <div
          className="rounded-2xl p-6 mb-4 relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${twMeta.color}18 0%, ${twMeta.color}06 100%)`, border: `1px solid ${twMeta.color}20` }}
        >
          <div
            className="absolute top-2 right-3 text-5xl select-none pointer-events-none leading-none"
            style={{ color: twMeta.color, opacity: 0.1 }}
          >
            Aa
          </div>
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">{twMeta.emoji}</span>
              <span className="text-xs font-medium" style={{ color: twMeta.color }}>{twMeta.label}</span>
              <span className="text-[10px] text-gray-400 ml-auto">{today.slice(5).replace('-', '/')} 每日一词</span>
            </div>
            <div className="flex items-baseline gap-3 mb-2">
              <h2 className="text-2xl font-bold text-gray-800">{todayWord.word}</h2>
              <button
                onClick={() => speak(todayWord.word)}
                className="p-1.5 rounded-lg hover:bg-sky-50 transition-colors"
                style={{ color: twMeta.color }}
                title="发音"
              >
                <Volume2 size={18} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-2">{todayWord.phonetic}</p>
            <p className="text-sm text-gray-700 mb-2">
              <span className="text-[11px] text-gray-400 mr-1.5 italic">{todayWord.pos}</span>
              {todayWord.meaning}
            </p>
            <div className="rounded-lg bg-white/50 p-2.5 mb-3 border border-black/5">
              <p className="text-xs text-gray-700 italic mb-0.5">{todayWord.example}</p>
              <p className="text-[11px] text-gray-400">{todayWord.exampleTrans}</p>
            </div>
            <div className="flex items-center justify-end gap-1">
              <button
                onClick={handleShuffle}
                className="p-2 rounded-lg text-gray-400 hover:text-sky-500 hover:bg-sky-50 transition-colors"
                title="换一个"
              >
                <Shuffle size={15} />
              </button>
              <button
                onClick={() => handleFavorite(todayWord)}
                className="p-2 rounded-lg transition-colors"
                style={isFavorite(todayWord.id) ? { color: '#EF4444' } : { color: 'rgb(156,163,175)' }}
                title="收藏"
              >
                <Heart size={15} className={isFavorite(todayWord.id) ? 'fill-current' : ''} />
              </button>
              <button
                onClick={() => handleCopy(todayWord)}
                className="p-2 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                title="复制"
              >
                <Copy size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* 待复习入口 */}
        {dueCount > 0 && (
          <button
            onClick={() => setShowReview(true)}
            className="w-full mb-4 p-3.5 rounded-2xl flex items-center justify-between bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:from-violet-600 hover:to-purple-600 transition-all"
          >
            <div className="flex items-center gap-2.5">
              <Brain size={20} />
              <div className="text-left">
                <div className="text-sm font-semibold">智能复习</div>
                <div className="text-[11px] text-white/80">今日有 {dueCount} 个单词待复习</div>
              </div>
            </div>
            <ChevronRight size={18} />
          </button>
        )}

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
                  active ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
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

        {/* 单词列表 */}
        {words.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="text-2xl mb-1.5">{tab === 'favorite' ? '❤️' : '📖'}</div>
            <p className="text-xs text-gray-400">
              {tab === 'favorite' ? '还没有收藏的单词' : '该分类暂无单词'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {words.map((w) => {
              const meta = CATEGORY_META[w.category]
              const fav = favSet.has(w.id)
              const rs = getReviewState(w.id)
              return (
                <div
                  key={w.id}
                  className="card p-4 group hover:shadow-md transition-shadow"
                  style={{ borderLeft: `3px solid ${meta.color}` }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-xs">{meta.emoji}</span>
                    <span className="text-[10px] font-medium" style={{ color: meta.color }}>{meta.label}</span>
                    {w.source === 'custom' && (
                      <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-sky-50 text-sky-500">自定义</span>
                    )}
                    {rs && (
                      <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-violet-50 text-violet-500" title={`已复习 ${rs.reps} 次，下次 ${rs.due}`}>
                        ×{rs.reps}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base font-bold text-gray-800">{w.word}</span>
                    <button
                      onClick={() => speak(w.word)}
                      className="p-1 rounded text-gray-300 hover:text-sky-500 hover:bg-sky-50 transition-colors"
                      title="发音"
                    >
                      <Volume2 size={13} />
                    </button>
                    <span className="text-[11px] text-gray-400">{w.phonetic}</span>
                  </div>
                  <p className="text-xs text-gray-600 mb-1.5">
                    <span className="text-[10px] text-gray-400 mr-1 italic">{w.pos}</span>
                    {w.meaning}
                  </p>
                  <p className="text-[11px] text-gray-500 italic leading-relaxed">{w.example}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-gray-400">{w.exampleTrans}</span>
                    <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleFavorite(w)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={fav ? { color: '#EF4444' } : { color: 'rgb(209,213,219)' }}
                      >
                        <Heart size={13} className={fav ? 'fill-current' : ''} />
                      </button>
                      <button
                        onClick={() => handleCopy(w)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                      >
                        <Copy size={13} />
                      </button>
                      {w.source === 'custom' && (
                        <button
                          onClick={() => handleDelete(w)}
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

      {showAdd && (
        <WordModal onClose={() => setShowAdd(false)} onSave={handleAdd} />
      )}
      {showReview && (
        <ReviewPanel
          onClose={() => setShowReview(false)}
          onDone={handleReviewDone}
          onSpeak={speak}
        />
      )}
    </div>
  )
}

// ===== 添加弹窗 =====

const CATEGORY_LIST = Object.keys(CATEGORY_META) as WordCategory[]

function WordModal({ onClose, onSave }: {
  onClose: () => void
  onSave: (
    word: string, phonetic: string, meaning: string, pos: string,
    example: string, exampleTrans: string, category: WordCategory,
  ) => void
}) {
  const [word, setWord] = useState('')
  const [phonetic, setPhonetic] = useState('')
  const [meaning, setMeaning] = useState('')
  const [pos, setPos] = useState('n.')
  const [example, setExample] = useState('')
  const [exampleTrans, setExampleTrans] = useState('')
  const [category, setCategory] = useState<WordCategory>('daily')

  const valid = word.trim().length >= 2 && word.trim().length <= 50 && meaning.trim().length >= 2

  const submit = () => {
    if (!valid) return
    onSave(word.trim(), phonetic.trim(), meaning.trim(), pos.trim(), example.trim(), exampleTrans.trim(), category)
  }

  const POS_OPTIONS = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'interj.']

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between sticky top-0 bg-white z-10">
          <span className="font-semibold text-sm flex items-center gap-1.5">
            <BookOpen size={15} className="text-sky-500" /> 添加单词
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3.5">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">单词 *</label>
              <input
                value={word}
                onChange={(e) => setWord(e.target.value)}
                maxLength={50}
                placeholder="如：serendipity"
                className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">词性</label>
              <select
                value={pos}
                onChange={(e) => setPos(e.target.value)}
                className="w-full px-2 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400 bg-white"
              >
                {POS_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">音标（可选）</label>
            <input
              value={phonetic}
              onChange={(e) => setPhonetic(e.target.value)}
              maxLength={50}
              placeholder="如：/ˌserənˈdɪpəti/"
              className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">释义 *</label>
            <input
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              maxLength={100}
              placeholder="如：意外发现美好事物的能力"
              className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">例句（可选）</label>
            <textarea
              value={example}
              onChange={(e) => setExample(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="英文例句"
              className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400 resize-none italic"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">例句翻译（可选）</label>
            <input
              value={exampleTrans}
              onChange={(e) => setExampleTrans(e.target.value)}
              maxLength={200}
              placeholder="例句中文翻译"
              className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">分类</label>
            <div className="grid grid-cols-3 gap-1.5">
              {CATEGORY_LIST.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`py-2 rounded-lg text-xs border transition flex items-center justify-center gap-1 ${
                    category === c ? 'border-sky-400 bg-sky-50 text-sky-600 font-semibold' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  <span>{CATEGORY_META[c].emoji}</span>
                  {CATEGORY_META[c].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 px-5 py-3 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="flex-1 py-2.5 text-sm rounded-lg bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 复习面板（SRS 闪卡） =====

const QUALITY_OPTIONS: { q: ReviewQuality; label: string; color: string; bg: string }[] = [
  { q: 0, label: '忘了', color: '#EF4444', bg: '#FEE2E2' },
  { q: 2, label: '困难', color: '#F59E0B', bg: '#FEF3C7' },
  { q: 3, label: '一般', color: '#3B82F6', bg: '#DBEAFE' },
  { q: 4, label: '良好', color: '#22C55E', bg: '#DCFCE7' },
  { q: 5, label: '熟练', color: '#8B5CF6', bg: '#EDE9FE' },
]

function ReviewPanel({ onClose, onDone, onSpeak }: {
  onClose: () => void
  onDone: () => void
  onSpeak: (text: string) => void
}) {
  const toast = useToast((s) => s.show)
  const [queue, setQueue] = useState<Word[]>(() => getDueWords())
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [completed, setCompleted] = useState(0)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // 队列空 → 完成
  useEffect(() => {
    if (queue.length > 0 && idx >= queue.length) {
      onDone()
      toast(`复习完成！本次 ${completed} 词`, 'success')
      closeRef.current()
    }
  }, [queue.length, idx, completed, onDone, toast])

  const current = queue[idx]

  const handleReview = (q: ReviewQuality) => {
    if (!current) return
    reviewWord(current.id, q)
    setCompleted((c) => c + 1)
    setFlipped(false)
    setIdx((i) => i + 1)
  }

  if (queue.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative bg-white rounded-2xl p-8 max-w-sm w-full mx-4 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-4xl mb-3">🎉</div>
          <h3 className="text-base font-semibold mb-1">暂无待复习单词</h3>
          <p className="text-xs text-gray-500 mb-4">学新单词后，过段时间再来复习吧</p>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-sky-500 text-white text-sm">关闭</button>
        </div>
      </div>
    )
  }

  if (!current) return null

  const meta = CATEGORY_META[current.category]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-white rounded-2xl w-full sm:max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-5 py-3 flex items-center justify-between border-b border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Brain size={15} className="text-violet-500" />
            <span>智能复习</span>
            <span className="text-gray-400">·</span>
            <span className="tabular-nums">{idx + 1}/{queue.length}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        {/* 闪卡 */}
        <div className="p-6 min-h-[280px] flex flex-col">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-xs">{meta.emoji}</span>
            <span className="text-[10px] font-medium" style={{ color: meta.color }}>{meta.label}</span>
          </div>

          {!flipped ? (
            <>
              <div className="flex-1 flex flex-col items-center justify-center">
                <h2 className="text-3xl font-bold text-gray-800 mb-2">{current.word}</h2>
                <p className="text-xs text-gray-400 mb-4">{current.phonetic}</p>
                <button
                  onClick={() => onSpeak(current.word)}
                  className="p-2 rounded-full hover:bg-sky-50 text-sky-500"
                  title="发音"
                >
                  <Volume2 size={20} />
                </button>
              </div>
              <button
                onClick={() => setFlipped(true)}
                className="w-full py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={14} /> 翻看释义
              </button>
            </>
          ) : (
            <>
              <div className="flex-1">
                <div className="flex items-baseline gap-2 mb-2">
                  <h2 className="text-xl font-bold text-gray-800">{current.word}</h2>
                  <span className="text-[11px] text-gray-400">{current.phonetic}</span>
                </div>
                <p className="text-sm text-gray-700 mb-2">
                  <span className="text-[11px] text-gray-400 mr-1.5 italic">{current.pos}</span>
                  {current.meaning}
                </p>
                <div className="rounded-lg bg-gray-50 p-2.5 border border-gray-100">
                  <p className="text-xs text-gray-700 italic mb-0.5">{current.example}</p>
                  <p className="text-[11px] text-gray-400">{current.exampleTrans}</p>
                </div>
              </div>
              {/* 评分 */}
              <div className="mt-4">
                <p className="text-xs text-gray-500 mb-2 text-center">回忆难度？</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {QUALITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.q}
                      onClick={() => handleReview(opt.q)}
                      className="py-2 rounded-lg text-xs font-medium transition active:scale-95"
                      style={{ color: opt.color, background: opt.bg }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 进度条 */}
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-violet-500 transition-all"
            style={{ width: `${(completed / queue.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}
