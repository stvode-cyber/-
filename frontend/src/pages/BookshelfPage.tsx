import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen, Plus, Trash2, X, Check, Pencil, Star, ChevronRight, StickyNote, Quote,
} from 'lucide-react'
import {
  groupByStatus, getBookStat, addBook, updateBook, deleteBook, advanceStatus,
  addNote, deleteNote, progressPct,
  STATUS_META, CATEGORY_META, EMOJI_OPTIONS, todayStr,
  type Book, type BookStatus, type BookCategory,
} from '../lib/bookStore'
import { listBooks as listNovelBooks } from '../lib/novelStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 书架管理页
 *
 * 布局：
 * 1. 统计汇总：总书数 / 本年已读 / 在读进度 / 均分
 * 2. 状态 Tab 筛选（全部/想读/在读/已读）
 * 3. 书目卡片（进度条 + 评分星 + 笔记数）
 * 4. 点击卡片展开笔记面板
 */

export default function BookshelfPage() {
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const [tab, setTab] = useState<BookStatus | 'all'>('all')
  const [editing, setEditing] = useState<Book | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [noteBookId, setNoteBookId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [notePage, setNotePage] = useState('')

  const groups = useMemo(() => groupByStatus(), [version])
  const stat = useMemo(() => getBookStat(), [version])

  const handleAdvance = useCallback((book: Book) => {
    const next = advanceStatus(book.id)
    if (next) {
      toast(`「${book.title}」→ ${STATUS_META[next].label} ${STATUS_META[next].emoji}`, 'info')
      refresh()
    }
  }, [toast, refresh])

  const handleDelete = useCallback((book: Book) => {
    deleteBook(book.id)
    toast(`已删除「${book.title}」`, 'info')
    refresh()
  }, [toast, refresh])

  const handleSave = useCallback((data: Omit<Book, 'id' | 'createdAt' | 'notes'>, id?: string) => {
    if (id) {
      updateBook(id, data)
      toast('书目已更新', 'success')
    } else {
      addBook(data)
      toast('书目已添加 📚', 'success')
    }
    setShowAdd(false)
    setEditing(null)
    refresh()
  }, [toast, refresh])

  const handleAddNote = useCallback((bookId: string) => {
    if (!noteText.trim()) return
    const page = notePage ? parseInt(notePage, 10) : undefined
    addNote(bookId, noteText, Number.isFinite(page) && page! > 0 ? page : undefined)
    setNoteText('')
    setNotePage('')
    toast('笔记已添加', 'success')
    refresh()
  }, [noteText, notePage, toast, refresh])

  const handleDeleteNote = useCallback((bookId: string, noteId: string) => {
    deleteNote(bookId, noteId)
    refresh()
  }, [refresh])

  // Tab 过滤
  const filteredGroups = useMemo(() => {
    if (tab === 'all') return groups
    return groups.filter((g) => g.status === tab)
  }, [groups, tab])

  const tabCount = (s: BookStatus | 'all') => s === 'all' ? stat.total : stat.byStatus[s]

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <BookOpen size={22} className="text-sky-500" /> 书架
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">想读 → 在读 → 已读</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-2 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 active:scale-95 transition-all flex items-center gap-1"
          >
            <Plus size={15} /> 添加书目
          </button>
        </div>

        {/* 统计汇总 */}
        <div className="card p-5 mb-4">
          <div className="grid grid-cols-4 divide-x divide-gray-100 text-center">
            <div>
              <div className="text-2xl font-bold text-sky-500 tabular-nums">{stat.total}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">总书目</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-500 tabular-nums">{stat.readThisYear}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">本年已读</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-500 tabular-nums">
                {stat.readingTotal > 0 ? `${Math.round((stat.readingPages / stat.readingTotal) * 100)}%` : '—'}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">在读进度</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-500 tabular-nums flex items-center justify-center gap-0.5">
                {stat.avgRating > 0 ? (
                  <><Star size={14} className="fill-amber-400 text-amber-400" /> {stat.avgRating}</>
                ) : '—'}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">平均评分</div>
            </div>
          </div>
        </div>

        {/* Tab 筛选 */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
          {(['all', 'want', 'reading', 'read'] as const).map((s) => {
            const meta = s === 'all' ? null : STATUS_META[s]
            const active = tab === s
            return (
              <button
                key={s}
                onClick={() => setTab(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
                  active ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {meta && <span>{meta.emoji}</span>}
                {s === 'all' ? '全部' : meta!.label}
                <span className={`tabular-nums ${active ? 'text-white/70' : 'text-gray-400'}`}>{tabCount(s)}</span>
              </button>
            )
          })}
        </div>

        {/* 书目列表 */}
        {filteredGroups.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="text-2xl mb-1.5">📚</div>
            <p className="text-xs text-gray-400 mb-3">
              {tab === 'all' ? '还没有书目，把想读的书加进来吧' : `还没有${STATUS_META[tab as BookStatus].label}的书`}
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 rounded-lg bg-sky-50 text-sky-600 text-xs font-medium hover:bg-sky-100 active:scale-95 transition-all"
            >
              + 添加书目
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredGroups.map((group) => {
              const meta = STATUS_META[group.status]
              return (
                <div key={group.status}>
                  {/* 组标题（仅"全部"Tab 显示） */}
                  {tab === 'all' && (
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <span className="text-sm">{meta.emoji}</span>
                      <span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                      <span className="text-[10px] text-gray-400">({group.items.length})</span>
                    </div>
                  )}
                  {/* 书目卡片 */}
                  <div className="space-y-2">
                    {group.items.map((book) => {
                      const expanded = expandedId === book.id
                      const pct = progressPct(book)
                      const cmeta = CATEGORY_META[book.category]
                      const isNotePanel = noteBookId === book.id
                      return (
                        <div key={book.id} className="card overflow-hidden">
                          {/* 书目行：关联了本地书籍 → 点整行直接进阅读；否则展开面板 */}
                          <div
                            className="flex items-start gap-3 p-4 cursor-pointer group"
                            onClick={() => {
                              if (book.novelId) {
                                navigate(`/novel/${book.novelId}`)
                              } else {
                                setExpandedId(expanded ? null : book.id)
                              }
                            }}
                          >
                            {/* 封面 */}
                            <div
                              className="w-12 h-16 rounded-lg flex items-center justify-center text-2xl flex-shrink-0"
                              style={{ background: `${meta.color}14` }}
                            >
                              {book.emoji}
                            </div>
                            {/* 信息 */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium text-gray-800 truncate">{book.title}</span>
                                {book.status === 'read' && book.rating > 0 && (
                                  <span className="flex items-center gap-0.5 flex-shrink-0">
                                    {[1, 2, 3, 4, 5].map((s) => (
                                      <Star
                                        key={s}
                                        size={9}
                                        className={s <= book.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}
                                      />
                                    ))}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-400 flex items-center gap-1.5 mt-0.5">
                                <span>{book.author}</span>
                                <span>·</span>
                                <span>{cmeta.emoji} {cmeta.label}</span>
                                {book.notes.length > 0 && <><span>·</span><span className="flex items-center gap-0.5"><StickyNote size={9} />{book.notes.length}</span></>}
                              </div>
                              {/* 进度条 */}
                              {book.status === 'reading' && book.totalPages && (
                                <div className="mt-2">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-blue-400 transition-all duration-500"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <span className="text-[9px] text-gray-400 tabular-nums">{book.currentPage}/{book.totalPages}</span>
                                  </div>
                                </div>
                              )}
                              {book.status === 'read' && book.finishDate && (
                                <div className="text-[9px] text-gray-400 mt-1">读完于 {book.finishDate.slice(5).replace('-', '/')}</div>
                              )}
                              {book.status === 'reading' && book.startDate && !book.totalPages && (
                                <div className="text-[9px] text-gray-400 mt-1">开始于 {book.startDate.slice(5).replace('-', '/')}</div>
                              )}
                            </div>
                            {/* 展开箭头 / 阅读入口提示 */}
                            {book.novelId ? (
                              <span className="text-[10px] text-primary-600 font-medium mt-1 flex items-center gap-0.5 flex-shrink-0">
                                <BookOpen size={12} /> 阅读
                              </span>
                            ) : (
                              <ChevronRight
                                size={16}
                                className={`text-gray-300 mt-1 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
                              />
                            )}
                          </div>

                          {/* 展开面板 */}
                          {expanded && (
                            <div className="border-t border-gray-50 px-4 pb-4">
                              {/* 书评 */}
                              {book.review && (
                                <div className="mt-3 rounded-lg bg-gray-50 p-2.5">
                                  <div className="text-[10px] text-gray-400 mb-1 flex items-center gap-1"><Quote size={10} /> 书评</div>
                                  <p className="text-xs text-gray-600 leading-relaxed">{book.review}</p>
                                </div>
                              )}

                              {/* 操作按钮 */}
                              <div className="flex items-center gap-2 mt-3">
                                {book.status !== 'read' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleAdvance(book) }}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1"
                                    style={{ background: `${meta.color}14`, color: meta.color }}
                                  >
                                    <ChevronRight size={12} />
                                    {book.status === 'want' ? '开始阅读' : '标记读完'}
                                  </button>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); setNoteBookId(isNotePanel ? null : book.id); setNoteText(''); setNotePage('') }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-600 flex items-center gap-1"
                                >
                                  <StickyNote size={12} /> {isNotePanel ? '收起笔记' : `笔记 (${book.notes.length})`}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditing(book) }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-500 flex items-center gap-1 ml-auto"
                                >
                                  <Pencil size={12} /> 编辑
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDelete(book) }}
                                  className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>

                              {/* 笔记面板 */}
                              {isNotePanel && (
                                <div className="mt-3">
                                  {/* 已有笔记 */}
                                  {book.notes.length > 0 && (
                                    <div className="space-y-1.5 mb-3">
                                      {book.notes.map((note) => (
                                        <div key={note.id} className="flex items-start gap-2 rounded-lg bg-amber-50/50 p-2 group/note">
                                          <Quote size={11} className="text-amber-300 mt-0.5 flex-shrink-0" />
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs text-gray-600 leading-relaxed break-words">{note.content}</p>
                                            <div className="text-[9px] text-gray-400 mt-0.5">
                                              {new Date(note.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                                              {note.page && ` · P${note.page}`}
                                            </div>
                                          </div>
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteNote(book.id, note.id) }}
                                            className="p-0.5 rounded text-gray-300 hover:text-rose-500 opacity-0 group-hover/note:opacity-100 flex-shrink-0"
                                          >
                                            <Trash2 size={11} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {/* 新增笔记 */}
                                  <div className="flex items-start gap-2">
                                    <textarea
                                      value={noteText}
                                      onChange={(e) => setNoteText(e.target.value)}
                                      placeholder="摘录一句或写下感悟…"
                                      rows={2}
                                      className="flex-1 px-2.5 py-2 rounded-lg text-xs border border-gray-200 outline-none focus:border-amber-400 resize-none bg-transparent"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <input
                                      value={notePage}
                                      onChange={(e) => setNotePage(e.target.value)}
                                      inputMode="numeric"
                                      placeholder="页"
                                      className="w-10 px-1.5 py-2 rounded-lg text-xs border border-gray-200 outline-none focus:border-amber-400 text-center bg-transparent"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleAddNote(book.id) }}
                                      disabled={!noteText.trim()}
                                      className="px-2.5 py-2 rounded-lg text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 flex-shrink-0"
                                    >
                                      添加
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 新增/编辑弹窗 */}
      {(showAdd || editing) && (
        <BookModal
          initial={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ===== 新增/编辑弹窗 =====

const CATEGORY_LIST = Object.keys(CATEGORY_META) as BookCategory[]

function BookModal({ initial, onClose, onSave }: {
  initial: Book | null
  onClose: () => void
  onSave: (data: Omit<Book, 'id' | 'createdAt' | 'notes'>, id?: string) => void
}) {
  const [title, setTitle] = useState(initial?.title || '')
  const [author, setAuthor] = useState(initial?.author || '')
  const [emoji, setEmoji] = useState(initial?.emoji || '📖')
  const [status, setStatus] = useState<BookStatus>(initial?.status || 'want')
  const [category, setCategory] = useState<BookCategory>(initial?.category || 'fiction')
  const [totalPages, setTotalPages] = useState(initial?.totalPages ? String(initial.totalPages) : '')
  const [currentPage, setCurrentPage] = useState(initial ? String(initial.currentPage) : '0')
  const [rating, setRating] = useState(initial?.rating || 0)
  const [review, setReview] = useState(initial?.review || '')
  // 关联本地书架：novelBooks 为本地导入的书（txt/epub/pdf）
  const [novelBooks] = useState(() => listNovelBooks().sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || b.addedAt)))
  const [novelId, setNovelId] = useState(initial?.novelId || '')

  const valid = title.trim().length > 0 && author.trim().length > 0

  const submit = () => {
    if (!valid) return
    const tp = parseInt(totalPages, 10)
    const cp = parseInt(currentPage, 10)
    onSave(
      {
        title: title.trim().slice(0, 50),
        author: author.trim().slice(0, 30),
        emoji,
        status,
        category,
        totalPages: Number.isFinite(tp) && tp > 0 ? tp : undefined,
        currentPage: Number.isFinite(cp) && cp >= 0 ? cp : 0,
        rating: status === 'read' ? rating : 0,
        review: review.trim() || undefined,
        novelId: novelId || undefined,
        startDate: initial?.startDate,
        finishDate: initial?.finishDate,
      },
      initial?.id,
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">{initial ? '编辑书目' : '添加书目'}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* 封面 + 书名 + 作者 */}
          <div className="flex items-start gap-3">
            <span className="w-14 h-18 rounded-lg flex items-center justify-center text-3xl flex-shrink-0 bg-sky-50">
              {emoji}
            </span>
            <div className="flex-1 space-y-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={50}
                placeholder="书名"
                className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400 font-medium"
              />
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                maxLength={30}
                placeholder="作者"
                className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400"
              />
            </div>
          </div>

          {/* emoji */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">封面图标</label>
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_OPTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`h-8 rounded-lg text-sm flex items-center justify-center border transition ${
                    emoji === e ? 'border-sky-400 bg-sky-50 scale-110' : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* 状态 + 分类 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-2 block">状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as BookStatus)}
                className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400 bg-white"
              >
                {(Object.keys(STATUS_META) as BookStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-2 block">分类</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as BookCategory)}
                className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400 bg-white"
              >
                {CATEGORY_LIST.map((c) => (
                  <option key={c} value={c}>{CATEGORY_META[c].emoji} {CATEGORY_META[c].label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 页码 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-2 block">总页数（可选）</label>
              <input
                value={totalPages}
                onChange={(e) => setTotalPages(e.target.value)}
                inputMode="numeric"
                placeholder="300"
                className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-2 block">当前页</label>
              <input
                value={currentPage}
                onChange={(e) => setCurrentPage(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400"
              />
            </div>
          </div>

          {/* 关联本地书籍（可选；关联后点书行直接进入阅读） */}
          {novelBooks.length > 0 && (
            <div>
              <label className="text-xs text-gray-500 mb-2 block">关联本地书籍（可选）</label>
              <select
                value={novelId}
                onChange={(e) => setNovelId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400 bg-white"
              >
                <option value="">不关联（仅打卡记录）</option>
                {novelBooks.map((nb) => (
                  <option key={nb.id} value={nb.id}>{nb.title}（{nb.format.toUpperCase()}）</option>
                ))}
              </select>
              {novelId && (
                <p className="text-[10px] text-sky-500 mt-1.5">已关联：点击书目行将直接进入阅读</p>
              )}
            </div>
          )}

          {/* 评分（仅已读） */}
          {status === 'read' && (
            <div>
              <label className="text-xs text-gray-500 mb-2 block">评分</label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    onClick={() => setRating(rating === s ? 0 : s)}
                    className="p-1 active:scale-90 transition-transform"
                  >
                    <Star
                      size={22}
                      className={s <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200 hover:text-amber-300'}
                    />
                  </button>
                ))}
                {rating > 0 && <span className="text-xs text-gray-400 ml-1">{rating} 星</span>}
              </div>
            </div>
          )}

          {/* 书评 */}
          {status === 'read' && (
            <div>
              <label className="text-xs text-gray-500 mb-2 block">书评（可选）</label>
              <textarea
                value={review}
                onChange={(e) => setReview(e.target.value)}
                maxLength={200}
                rows={3}
                placeholder="一句话感受…"
                className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-sky-400 resize-none"
              />
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="flex-1 py-2.5 text-sm rounded-lg bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
