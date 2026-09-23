import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  NotebookPen, Search, Trash2, Save, ChevronLeft, ChevronRight, X, PenLine, CalendarDays, Flame,
} from 'lucide-react'
import {
  getEntry, saveEntry, deleteEntry, searchEntries, getDiaryStat, getMonthDates, countWords, todayStr,
  type DiaryEntry,
} from '../lib/diaryStore'
import { MOOD_META, type MoodLevel } from '../lib/moodStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'
import { useDebounce } from '../hooks/useDebounce'

/**
 * 日记页
 *
 * 布局（桌面双栏 / 移动单栏）：
 * - 左：编辑器（日期 + 标题 + 心情快照 + 正文 + 字数 + 保存/删除）
 * - 右：统计 + 月历打卡 + 搜索 + 历史列表（点击加载到编辑器）
 */

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 摘要：截断正文前 N 字 */
function excerpt(text: string, n = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > n ? clean.slice(0, n) + '…' : clean
}

/** 日期显示：2026-08-17 → 8月17日 周一 */
function prettyDate(date: string): string {
  const [, m, d] = date.split('-')
  const wd = WEEKDAY_LABELS[new Date(date + 'T00:00:00').getDay()]
  return `${Number(m)}月${Number(d)}日 周${wd}`
}

export default function DiaryPage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  // 编辑器状态
  const [editDate, setEditDate] = useState(todayStr())
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [mood, setMood] = useState<MoodLevel | null>(null)
  const [syncMood, setSyncMood] = useState(false)

  // 列表状态
  const [keyword, setKeyword] = useState('')
  const debouncedKeyword = useDebounce(keyword, 200)
  const [expandedDate, setExpandedDate] = useState<string | null>(null)

  // 当前编辑日的已有日记
  const existing = useMemo(() => getEntry(editDate), [editDate, version])

  // 切换编辑日期时载入该日内容
  useEffect(() => {
    const e = getEntry(editDate)
    setTitle(e?.title || '')
    setContent(e?.content || '')
    setMood(e?.mood ?? null)
    setSyncMood(false)
  }, [editDate, version])

  const stat = useMemo(() => getDiaryStat(), [version])
  const entries = useMemo(() => searchEntries(debouncedKeyword), [debouncedKeyword, version])

  // 月历（跟随编辑日期所在月）
  const [calCursor, setCalCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const monthDates = useMemo(
    () => getMonthDates(calCursor.year, calCursor.month),
    [calCursor, version],
  )

  const words = countWords(content) + countWords(title)

  const handleSave = useCallback(() => {
    if (!content.trim() && !title.trim()) {
      toast('写点什么再保存吧', 'error')
      return
    }
    saveEntry(editDate, title, content, mood, syncMood && mood !== null)
    toast(existing ? '日记已更新' : '日记已保存 ✍️', 'success')
    refresh()
  }, [editDate, title, content, mood, syncMood, existing, toast, refresh])

  const handleDelete = useCallback(() => {
    deleteEntry(editDate)
    toast('日记已删除', 'info')
    refresh()
  }, [editDate, toast, refresh])

  /** 加载历史日记到编辑器 */
  const loadEntry = useCallback((e: DiaryEntry) => {
    setEditDate(e.date)
    setExpandedDate(null)
    // 滚到顶部便于编辑
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  /** 上/下一天 */
  const shiftDate = useCallback((delta: number) => {
    const d = new Date(editDate + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    const next = todayStr(d)
    if (next > todayStr()) return
    setEditDate(next)
  }, [editDate])

  // 月历网格
  const calendar = useMemo(() => {
    const first = new Date(calCursor.year, calCursor.month, 1)
    const daysInMonth = new Date(calCursor.year, calCursor.month + 1, 0).getDate()
    const startWeekday = first.getDay()
    const cells: { date: string | null; day: number }[] = []
    for (let i = 0; i < startWeekday; i++) cells.push({ date: null, day: 0 })
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: todayStr(new Date(calCursor.year, calCursor.month, d)), day: d })
    }
    return cells
  }, [calCursor])

  const today = todayStr()

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-5xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <NotebookPen size={22} className="text-teal-500" /> 日记
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              每天一篇 · 记录生活的心情与思考
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1" title="总篇数"><NotebookPen size={13} /> {stat.total} 篇</span>
            <span className="flex items-center gap-1" title="连续写作"><Flame size={13} className="text-orange-400" /> {stat.streak} 天</span>
            <span className="hidden sm:inline">{stat.totalWords} 字</span>
          </div>
        </div>

        <div className={isDesktop() ? 'grid grid-cols-5 gap-4 items-start' : ''}>
          {/* ===== 编辑器 ===== */}
          <div className={isDesktop() ? 'col-span-3 space-y-4' : 'space-y-4'}>
            <div className="card p-5">
              {/* 日期行 */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => shiftDate(-1)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-teal-50"
                    title="前一天"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-sm font-semibold text-gray-700 tabular-nums">{prettyDate(editDate)}</span>
                  <button
                    onClick={() => shiftDate(1)}
                    disabled={editDate >= today}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-teal-50 disabled:opacity-30 disabled:hover:bg-transparent"
                    title="后一天"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                {editDate === today ? (
                  existing ? (
                    <span className="text-[10px] text-teal-600 bg-teal-50 rounded-full px-2 py-0.5">今日已写</span>
                  ) : (
                    <span className="text-[10px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 flex items-center gap-0.5">
                      <PenLine size={9} /> 待写
                    </span>
                  )
                ) : existing ? (
                  <span className="text-[10px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">补记</span>
                ) : (
                  <span className="text-[10px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">补记空缺</span>
                )}
              </div>

              {/* 标题 */}
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={50}
                placeholder="标题（可选）"
                className="w-full mb-3 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 outline-none focus:border-teal-400 bg-transparent"
              />

              {/* 心情 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-400 mr-0.5">心情</span>
                  {([1, 2, 3, 4, 5] as MoodLevel[]).map((lv) => (
                    <button
                      key={lv}
                      onClick={() => setMood(mood === lv ? null : lv)}
                      className={`w-8 h-8 rounded-full text-base transition-all active:scale-90 ${
                        mood === lv ? 'scale-110 bg-gray-100' : 'opacity-40 hover:opacity-80'
                      }`}
                      title={MOOD_META[lv].label}
                    >
                      {MOOD_META[lv].emoji}
                    </button>
                  ))}
                </div>
                {mood !== null && (
                  <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={syncMood}
                      onChange={(e) => setSyncMood(e.target.checked)}
                      className="accent-teal-500 w-3 h-3"
                    />
                    同步到心情记录
                  </label>
                )}
              </div>

              {/* 正文 */}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="今天过得怎么样？"
                rows={isDesktop() ? 10 : 7}
                className="w-full px-3 py-2.5 rounded-lg text-sm leading-relaxed border border-gray-200 outline-none focus:border-teal-400 bg-transparent resize-y"
              />

              {/* 底部操作 */}
              <div className="flex items-center justify-between mt-3">
                <span className="text-[10px] text-gray-400">{words} 字{existing ? ` · 更新于 ${new Date(existing.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                <div className="flex items-center gap-2">
                  {existing && (
                    <button
                      onClick={handleDelete}
                      className="p-2 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50"
                      title="删除这篇日记"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={!content.trim() && !title.trim()}
                    className="px-5 py-2 rounded-lg bg-teal-500 text-white text-sm font-medium hover:bg-teal-600 active:scale-95 transition-all disabled:opacity-40 flex items-center gap-1"
                  >
                    <Save size={14} /> {existing ? '更新' : '保存'}
                  </button>
                </div>
              </div>
            </div>

            {/* 移动端历史列表（桌面在右栏） */}
            {!isDesktop() && (
              <HistoryList
                entries={entries}
                keyword={keyword}
                onKeyword={setKeyword}
                expandedDate={expandedDate}
                onExpand={setExpandedDate}
                onLoad={loadEntry}
              />
            )}
          </div>

          {/* ===== 右栏：月历 + 历史 ===== */}
          {isDesktop() && (
            <div className="col-span-2 space-y-4">
              {/* 月历打卡 */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                    <CalendarDays size={14} className="text-teal-500" /> 写作日历
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCalCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 }))}
                      className="p-1 rounded text-gray-400 hover:text-teal-500"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-xs text-gray-500 tabular-nums w-14 text-center">
                      {calCursor.year}.{String(calCursor.month + 1).padStart(2, '0')}
                    </span>
                    <button
                      onClick={() => setCalCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 }))}
                      className="p-1 rounded text-gray-400 hover:text-teal-500"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {WEEKDAY_LABELS.map((w) => (
                    <span key={w} className="text-[9px] text-gray-400 py-0.5">{w}</span>
                  ))}
                  {calendar.map((c, i) =>
                    c.date === null ? (
                      <span key={`empty-${i}`} />
                    ) : (
                      <button
                        key={c.date}
                        onClick={() => c.date && setEditDate(c.date)}
                        disabled={c.date > today}
                        className="relative h-8 rounded-lg text-[11px] tabular-nums transition-colors disabled:opacity-30"
                        style={
                          c.date === editDate
                            ? { background: '#14B8A6', color: 'white', fontWeight: 600 }
                            : monthDates.has(c.date)
                              ? { background: 'rgba(20,184,166,0.14)', color: '#0D9488' }
                              : { color: 'rgb(var(--color-accent-500))' }
                        }
                        title={monthDates.has(c.date) ? '已写日记' : ''}
                      >
                        {c.day}
                        {monthDates.has(c.date) && c.date !== editDate && (
                          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-teal-500" />
                        )}
                      </button>
                    ),
                  )}
                </div>
                <div className="text-[10px] text-gray-400 mt-2.5">
                  本月已写 <span className="text-teal-600 font-semibold">{stat.monthCount}</span> 篇
                </div>
              </div>

              <HistoryList
                entries={entries}
                keyword={keyword}
                onKeyword={setKeyword}
                expandedDate={expandedDate}
                onExpand={setExpandedDate}
                onLoad={loadEntry}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 历史列表（搜索 + 条目，点击展开/加载） */
function HistoryList({ entries, keyword, onKeyword, expandedDate, onExpand, onLoad }: {
  entries: DiaryEntry[]
  keyword: string
  onKeyword: (v: string) => void
  expandedDate: string | null
  onExpand: (d: string | null) => void
  onLoad: (e: DiaryEntry) => void
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700">历史日记</span>
        {keyword.trim() && (
          <span className="text-[10px] text-gray-400">{entries.length} 篇匹配</span>
        )}
      </div>
      {/* 搜索框 */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
        <input
          value={keyword}
          onChange={(e) => onKeyword(e.target.value)}
          placeholder="搜索标题或内容…"
          className="w-full pl-9 pr-8 py-2 rounded-lg text-xs border border-gray-200 outline-none focus:border-teal-400 bg-transparent"
        />
        {keyword && (
          <button
            onClick={() => onKeyword('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-6">
          <div className="text-xl mb-1">📖</div>
          <p className="text-xs text-gray-400">{keyword.trim() ? '没有匹配的日记' : '还没有日记，从今天开始写吧'}</p>
        </div>
      ) : (
        <div className={isDesktop() ? 'max-h-[420px] overflow-y-auto space-y-1 pr-1' : 'space-y-1'}>
          {entries.map((e) => {
            const expanded = expandedDate === e.date
            return (
              <div key={e.date} className="rounded-xl border border-gray-100 overflow-hidden">
                <button
                  onClick={() => onExpand(expanded ? null : e.date)}
                  className="w-full flex items-start gap-2.5 p-3 text-left hover:bg-gray-50 transition-colors"
                >
                  {e.mood !== null && <span className="text-sm leading-none mt-0.5">{MOOD_META[e.mood].emoji}</span>}
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-400 tabular-nums flex-shrink-0">{e.date.slice(5).replace('-', '/')}</span>
                      <span className="text-xs font-medium text-gray-700 truncate">{e.title || '无题'}</span>
                    </span>
                    {!expanded && (
                      <span className="block text-[10px] text-gray-400 mt-0.5 truncate">{excerpt(e.content) || '（空）'}</span>
                    )}
                  </span>
                  <span className="text-[9px] text-gray-300 flex-shrink-0 tabular-nums">{countWords(e.content)}字</span>
                </button>
                {expanded && (
                  <div className="px-3 pb-3">
                    <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto rounded-lg bg-gray-50 p-2.5">
                      {e.content || '（空）'}
                    </p>
                    <button
                      onClick={() => onLoad(e)}
                      className="mt-2 text-[11px] text-teal-500 hover:text-teal-600"
                    >
                      编辑这篇 →
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
