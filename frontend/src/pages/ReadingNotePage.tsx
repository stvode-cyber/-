import { useState, useMemo, useCallback } from 'react'
import {
  BookText, Plus, Trash2, X, Search, ChevronLeft, Download, Tag,
  BookOpen, StickyNote as NoteIcon, Pencil,
} from 'lucide-react'
import {
  listBooks, listNotes, addBook, deleteBook, updateBook,
  addNote, deleteNote, searchNotes, getStat, getAllTags,
  exportBookMarkdown, getBook,
  STATUS_META, NOTE_TYPE_META,
  type Book, type Note, type BookStatus, type NoteType,
} from '../lib/readingNoteStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 读书笔记页
 *
 * 视图：
 * 1. 书架视图：网格展示所有书（按状态筛选 + 搜索）
 * 2. 书籍详情视图：单本书的所有笔记（高亮/心得/总结）
 * 3. 添加书弹窗 / 添加笔记弹窗
 */

type View = 'shelf' | 'detail'

const STATUS_TABS: { key: BookStatus | 'all'; label: string; emoji: string }[] = [
  { key: 'all', label: '全部', emoji: '📚' },
  { key: 'reading', label: '在读', emoji: '📖' },
  { key: 'done', label: '已读', emoji: '✅' },
  { key: 'wish', label: '想读', emoji: '🌟' },
  { key: 'abandoned', label: '弃读', emoji: '🗑️' },
]

export default function ReadingNotePage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const [view, setView] = useState<View>('shelf')
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
  const [statusTab, setStatusTab] = useState<BookStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [showAddBook, setShowAddBook] = useState(false)

  const books = useMemo(() => {
    if (search.trim()) {
      const kw = search.toLowerCase()
      return listBooks().filter((b) =>
        b.title.toLowerCase().includes(kw) || b.author.toLowerCase().includes(kw),
      )
    }
    return listBooks(statusTab === 'all' ? undefined : statusTab)
  }, [statusTab, search, version])

  const stat = useMemo(() => getStat(), [version])

  const selectedBook = useMemo(
    () => selectedBookId ? getBook(selectedBookId) : null,
    [selectedBookId, version],
  )
  const notes = useMemo(
    () => selectedBookId ? listNotes(selectedBookId) : [],
    [selectedBookId, version],
  )
  const tags = useMemo(() => getAllTags(), [version])

  const handleOpenBook = useCallback((id: string) => {
    setSelectedBookId(id)
    setView('detail')
  }, [])

  const handleBack = useCallback(() => {
    setView('shelf')
    setSelectedBookId(null)
  }, [])

  const handleAddBook = useCallback((data: {
    title: string; author: string; totalPages?: number; status: BookStatus
  }) => {
    const book = addBook(data)
    toast(`已添加《${book.title}》`, 'success')
    setShowAddBook(false)
    refresh()
  }, [toast, refresh])

  const handleDeleteBook = useCallback((book: Book) => {
    deleteBook(book.id)
    toast(`已删除《${book.title}》`, 'info')
    refresh()
  }, [toast, refresh])

  const handleAddNote = useCallback((data: {
    bookId: string; type: NoteType; content: string; chapter?: string; page?: number; tags: string[]
  }) => {
    addNote(data)
    toast('笔记已添加', 'success')
    refresh()
  }, [toast, refresh])

  const handleDeleteNote = useCallback((id: string) => {
    deleteNote(id)
    toast('已删除笔记', 'info')
    refresh()
  }, [toast, refresh])

  const handleStatusChange = useCallback((book: Book, status: BookStatus) => {
    const patch: Partial<Book> = { status }
    if (status === 'done' && !book.finishDate) patch.finishDate = new Date().toISOString().slice(0, 10)
    if (status === 'reading' && !book.startDate) patch.startDate = new Date().toISOString().slice(0, 10)
    updateBook(book.id, patch)
    refresh()
    toast(`状态已更新为「${STATUS_META[status].label}」`, 'success')
  }, [toast, refresh])

  const handleExport = useCallback((bookId: string) => {
    const md = exportBookMarkdown(bookId)
    const book = getBook(bookId)
    if (!book) return
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${book.title}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast('已导出 Markdown', 'success')
  }, [toast])

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {view === 'shelf' ? (
          <>
            {/* 顶栏 */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <BookText size={22} className="text-emerald-500" /> 读书笔记
                </h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  书 {stat.totalBooks} 本 · 在读 {stat.reading} · 已读 {stat.done} · 笔记 {stat.notes} 条
                </p>
              </div>
              <button
                onClick={() => setShowAddBook(true)}
                className="px-3 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 active:scale-95 transition-all flex items-center gap-1"
              >
                <Plus size={15} /> 添加书
              </button>
            </div>

            {/* 搜索框 */}
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索书名或作者"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-emerald-400 bg-white"
              />
            </div>

            {/* 状态筛选 Tab */}
            <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
              {STATUS_TABS.map((opt) => {
                const active = statusTab === opt.key
                return (
                  <button
                    key={opt.key}
                    onClick={() => setStatusTab(opt.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
                      active ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    <span>{opt.emoji}</span>
                    {opt.label}
                  </button>
                )
              })}
            </div>

            {/* 标签云 */}
            {tags.length > 0 && !search && (
              <div className="mb-4">
                <div className="text-[10px] text-gray-400 mb-1.5 flex items-center gap-1">
                  <Tag size={11} /> 标签
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tags.slice(0, 10).map((t) => (
                    <button
                      key={t.tag}
                      onClick={() => setSearch(t.tag)}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                    >
                      {t.tag} <span className="text-emerald-400">{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 书架 */}
            {books.length === 0 ? (
              <div className="card p-8 text-center">
                <div className="text-2xl mb-1.5">{search ? '🔍' : '📚'}</div>
                <p className="text-xs text-gray-400">
                  {search ? '没有匹配的书籍' : '书架空空如也，添加第一本吧'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {books.map((book) => {
                  const meta = STATUS_META[book.status]
                  const noteCount = listNotes(book.id).length
                  return (
                    <div
                      key={book.id}
                      onClick={() => handleOpenBook(book.id)}
                      className="rounded-xl overflow-hidden border border-gray-100 hover:shadow-md transition-shadow cursor-pointer bg-white group"
                    >
                      {/* "书脊" 模拟 */}
                      <div
                        className="h-24 p-3 relative flex flex-col justify-end"
                        style={{
                          background: `linear-gradient(135deg, ${book.coverColor} 0%, ${book.coverColor}cc 100%)`,
                        }}
                      >
                        <div className="absolute top-1.5 right-1.5 text-xs">{meta.emoji}</div>
                        <div className="absolute top-2 left-2 w-1 h-20 bg-black/20 rounded-full" />
                        <div className="text-white text-xs font-bold line-clamp-2 leading-snug pl-2">
                          {book.title}
                        </div>
                        <div className="text-white/70 text-[10px] mt-0.5 pl-2 truncate">{book.author}</div>
                      </div>
                      <div className="p-2 flex items-center justify-between text-[10px] text-gray-500">
                        <span className="flex items-center gap-0.5">
                          <NoteIcon size={11} /> {noteCount}
                        </span>
                        <span style={{ color: meta.color }}>{meta.label}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          // 详情视图
          <>
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-xs text-gray-500 mb-3 hover:text-emerald-600"
            >
              <ChevronLeft size={16} /> 返回书架
            </button>

            {selectedBook ? (
              <BookDetailView
                book={selectedBook}
                notes={notes}
                onAddNote={handleAddNote}
                onDeleteNote={handleDeleteNote}
                onStatusChange={handleStatusChange}
                onExport={handleExport}
                onDeleteBook={handleDeleteBook}
              />
            ) : (
              <div className="card p-8 text-center text-xs text-gray-400">书籍不存在或已删除</div>
            )}
          </>
        )}
      </div>

      {showAddBook && (
        <BookModal onClose={() => setShowAddBook(false)} onSave={handleAddBook} />
      )}
    </div>
  )
}

// ===== 书籍详情 =====

function BookDetailView({ book, notes, onAddNote, onDeleteNote, onStatusChange, onExport, onDeleteBook }: {
  book: Book
  notes: Note[]
  onAddNote: (data: {
    bookId: string; type: NoteType; content: string; chapter?: string; page?: number; tags: string[]
  }) => void
  onDeleteNote: (id: string) => void
  onStatusChange: (book: Book, status: BookStatus) => void
  onExport: (bookId: string) => void
  onDeleteBook: (book: Book) => void
}) {
  const [showAddNote, setShowAddNote] = useState(false)
  const meta = STATUS_META[book.status]

  return (
    <>
      {/* 书籍卡片 */}
      <div
        className="rounded-2xl p-5 mb-4 relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${book.coverColor}20 0%, ${book.coverColor}08 100%)`,
          border: `1px solid ${book.coverColor}30`,
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-12 h-16 rounded shrink-0 flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${book.coverColor} 0%, ${book.coverColor}cc 100%)` }}
          >
            <BookOpen size={20} className="text-white/80" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-800 truncate">{book.title}</h2>
            <p className="text-xs text-gray-500 mb-2">{book.author}</p>
            <div className="flex flex-wrap gap-1.5 items-center">
              <span
                className="text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: meta.color + '20', color: meta.color }}
              >
                {meta.emoji} {meta.label}
              </span>
              {book.totalPages && (
                <span className="text-[10px] text-gray-400">{book.totalPages} 页</span>
              )}
              {book.rating && (
                <span className="text-[10px] text-amber-500">{'⭐'.repeat(book.rating)}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 mt-4 flex-wrap">
          <span className="text-[10px] text-gray-400 mr-1">状态：</span>
          {(['reading', 'done', 'wish', 'abandoned'] as BookStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => onStatusChange(book, s)}
              className={`text-[10px] px-2 py-1 rounded ${
                book.status === s ? 'bg-white shadow-sm' : 'bg-white/40'
              }`}
              style={{ color: STATUS_META[s].color }}
            >
              {STATUS_META[s].label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => setShowAddNote(true)}
            className="flex-1 py-2 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 flex items-center justify-center gap-1"
          >
            <Plus size={14} /> 添加笔记
          </button>
          <button
            onClick={() => onExport(book.id)}
            className="p-2 rounded-lg bg-white text-emerald-600 hover:bg-emerald-50"
            title="导出 Markdown"
          >
            <Download size={14} />
          </button>
          <button
            onClick={() => onDeleteBook(book)}
            className="p-2 rounded-lg bg-white text-gray-400 hover:text-rose-500 hover:bg-rose-50"
            title="删除书籍"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* 笔记列表 */}
      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
        <NoteIcon size={15} className="text-emerald-500" /> 笔记 ({notes.length})
      </h3>

      {notes.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-2xl mb-1.5">📝</div>
          <p className="text-xs text-gray-400">还没有笔记，开始记录你的第一条吧</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {notes.map((note) => {
            const nm = NOTE_TYPE_META[note.type]
            return (
              <div
                key={note.id}
                className="card p-3.5 group hover:shadow-md transition-shadow"
                style={{ borderLeft: `3px solid ${nm.color}` }}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-xs">{nm.emoji}</span>
                  <span className="text-[10px] font-medium" style={{ color: nm.color }}>{nm.label}</span>
                  {(note.chapter || note.page) && (
                    <span className="text-[10px] text-gray-400 ml-1">
                      {[note.chapter, note.page ? `第 ${note.page} 页` : ''].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <button
                    onClick={() => onDeleteNote(note.id)}
                    className="ml-auto p-1 rounded text-gray-300 hover:text-rose-500 hover:bg-rose-50 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {note.type === 'highlight' ? (
                  <blockquote
                    className="text-sm text-gray-700 italic pl-3 border-l-2 leading-relaxed"
                    style={{ borderColor: nm.color }}
                  >
                    {note.content}
                  </blockquote>
                ) : (
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{note.content}</p>
                )}
                {note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {note.tags.map((t) => (
                      <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAddNote && (
        <NoteModal
          bookId={book.id}
          onClose={() => setShowAddNote(false)}
          onSave={onAddNote}
        />
      )}
    </>
  )
}

// ===== 添加书籍弹窗 =====

function BookModal({ onClose, onSave }: {
  onClose: () => void
  onSave: (data: { title: string; author: string; totalPages?: number; status: BookStatus }) => void
}) {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [totalPages, setTotalPages] = useState('')
  const [status, setStatus] = useState<BookStatus>('wish')

  const valid = title.trim().length >= 1

  const submit = () => {
    if (!valid) return
    onSave({
      title: title.trim(),
      author: author.trim(),
      totalPages: totalPages ? parseInt(totalPages, 10) : undefined,
      status,
    })
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
            <BookOpen size={15} className="text-emerald-500" /> 添加书籍
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3.5">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">书名 *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              placeholder="如：活着"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-emerald-400"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">作者</label>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              maxLength={50}
              placeholder="如：余华"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-emerald-400"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">总页数（可选）</label>
            <input
              value={totalPages}
              onChange={(e) => setTotalPages(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="如：280"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-emerald-400"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-2 block">阅读状态</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['reading', 'done', 'wish', 'abandoned'] as BookStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`py-2 rounded-lg text-xs border transition ${
                    status === s ? 'border-emerald-400 bg-emerald-50 font-semibold' : 'border-gray-200 text-gray-500'
                  }`}
                  style={status === s ? { color: STATUS_META[s].color } : {}}
                >
                  {STATUS_META[s].label}
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
            className="flex-1 py-2.5 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 添加笔记弹窗 =====

const NOTE_TYPES: NoteType[] = ['highlight', 'thought', 'summary']

function NoteModal({ bookId, onClose, onSave }: {
  bookId: string
  onClose: () => void
  onSave: (data: {
    bookId: string; type: NoteType; content: string; chapter?: string; page?: number; tags: string[]
  }) => void
}) {
  const [type, setType] = useState<NoteType>('highlight')
  const [content, setContent] = useState('')
  const [chapter, setChapter] = useState('')
  const [page, setPage] = useState('')
  const [tags, setTags] = useState('')

  const valid = content.trim().length >= 2

  const submit = () => {
    if (!valid) return
    onSave({
      bookId,
      type,
      content: content.trim(),
      chapter: chapter.trim() || undefined,
      page: page ? parseInt(page, 10) : undefined,
      tags: tags.split(/[,，#\s]+/).map((t) => t.trim()).filter(Boolean),
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between sticky top-0 bg-white z-10">
          <span className="font-semibold text-sm flex items-center gap-1.5">
            <Pencil size={15} className="text-emerald-500" /> 添加笔记
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3.5">
          <div>
            <label className="text-xs text-gray-500 mb-2 block">类型</label>
            <div className="grid grid-cols-3 gap-1.5">
              {NOTE_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`py-2 rounded-lg text-xs border transition flex items-center justify-center gap-1 ${
                    type === t ? 'border-emerald-400 bg-emerald-50 font-semibold' : 'border-gray-200 text-gray-500'
                  }`}
                  style={type === t ? { color: NOTE_TYPE_META[t].color } : {}}
                >
                  <span>{NOTE_TYPE_META[t].emoji}</span>
                  {NOTE_TYPE_META[t].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              内容 * {type === 'highlight' ? '（摘录原文）' : type === 'summary' ? '（你的总结）' : '（你的感悟）'}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={1000}
              rows={5}
              placeholder={type === 'highlight' ? '摘录打动你的句子…' : '写下你的思考…'}
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-emerald-400 resize-none"
            />
            <div className="text-right text-[10px] text-gray-300 mt-0.5">{content.length}/1000</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">章节</label>
              <input
                value={chapter}
                onChange={(e) => setChapter(e.target.value)}
                maxLength={30}
                placeholder="如：第三章"
                className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-emerald-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">页码</label>
              <input
                value={page}
                onChange={(e) => setPage(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                placeholder="如：128"
                className="w-full px-3 py-2 rounded-lg text-sm border border-gray-200 outline-none focus:border-emerald-400"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">标签（逗号/空格分隔）</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              maxLength={100}
              placeholder="如：哲学, 成长"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-emerald-400"
            />
          </div>
        </div>

        <div className="border-t border-gray-100 px-5 py-3 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="flex-1 py-2.5 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}
