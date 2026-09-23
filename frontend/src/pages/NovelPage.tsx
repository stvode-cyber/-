import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, Plus, Trash2, Clock, FileText, Loader2, Search, X, BarChart3 } from 'lucide-react'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'
import {
  type NovelBook, listBooks, removeBook, deleteBookFile, saveBookFile, upsertBook, genBookId,
  detectFormat, unsupportedHint, formatSize, SUPPORTED_EXTS, type NovelFormat,
  getStatOverview, formatDuration,
} from '../lib/novelStore'

const FORMAT_META: Record<NovelFormat, { label: string; color: string }> = {
  txt: { label: 'TXT', color: 'bg-sky-100 text-sky-700' },
  epub: { label: 'EPUB', color: 'bg-emerald-100 text-emerald-700' },
  pdf: { label: 'PDF', color: 'bg-red-100 text-red-700' },
  docx: { label: 'DOCX', color: 'bg-indigo-100 text-indigo-700' },
  html: { label: 'HTML', color: 'bg-orange-100 text-orange-700' },
  md: { label: 'MD', color: 'bg-violet-100 text-violet-700' },
}

function timeAgo(ts: number | null): string {
  if (!ts) return '未读'
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export default function NovelPage() {
  const toast = useToast((s) => s.show)
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [books, setBooks] = useState<NovelBook[]>([])
  const [importing, setImporting] = useState(false)
  const [query, setQuery] = useState('')
  const [showStats, setShowStats] = useState(false)

  const refresh = () => setBooks(listBooks().sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt)))

  useEffect(() => { refresh() }, [])

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return books
    return books.filter((b) => b.title.toLowerCase().includes(q) || b.format.toLowerCase().includes(q))
  }, [books, query])

  const stats = useMemo(() => showStats ? getStatOverview() : null, [showStats])

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setImporting(true)
    try {
      let okCount = 0
      for (const file of Array.from(files)) {
        const format = detectFormat(file.name)
        if (!format) {
          const hint = unsupportedHint(file.name)
          toast(hint ? `${file.name}：${hint}` : `不支持的格式：${file.name}`, 'error')
          continue
        }
        const book: NovelBook = {
          id: genBookId(),
          title: file.name.replace(/\.[^.]+$/, ''),
          format, size: file.size, addedAt: Date.now(), lastReadAt: null,
          percent: 0, chapterIdx: 0, scrollRatio: 0, cfi: null, page: 1, totalPages: 0, chapterCount: 0,
          readSeconds: 0,
        }
        await saveBookFile(book.id, file)
        upsertBook(book)
        okCount++
      }
      if (okCount > 0) {
        toast(`成功导入 ${okCount} 本书`, 'success')
        refresh()
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '导入失败', 'error')
    } finally {
      setImporting(false)
    }
  }

  const del = async (book: NovelBook) => {
    if (!confirm(`确定删除《${book.title}》吗？阅读进度将一并清除。`)) return
    removeBook(book.id)
    await deleteBookFile(book.id).catch(() => undefined)
    toast('已删除', 'success')
    refresh()
  }

  const accept = SUPPORTED_EXTS.map((e) => `.${e}`).join(',') + ',.mobi,.azw3,.azw,.prc,.doc,.fb2,.chm'

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'min-h-screen bg-panel-100'}>
      <div className={isDesktop() ? 'max-w-5xl mx-auto' : 'app-shell p-4 pb-8'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5 gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-accent-800 flex items-center gap-2">
              <BookOpen size={22} className="text-primary-500" /> 本地书架
            </h1>
            <p className="text-xs text-accent-400 mt-1">
              支持 TXT / EPUB / PDF / DOCX / HTML / Markdown，本地存储不上传
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowStats(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-accent-700 hover:bg-gray-50 hover:border-gray-300 transition"
              title="阅读统计"
            >
              <BarChart3 size={16} />
              <span className="hidden sm:inline">统计</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2.5 disabled:opacity-60"
            >
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              导入书籍
            </button>
            <input
              ref={fileRef} type="file" multiple accept={accept} className="hidden"
              onChange={(e) => { importFiles(e.target.files); e.target.value = '' }}
            />
          </div>
        </div>

        {/* 搜索框 */}
        {books.length > 0 && (
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-300" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索书名或格式…"
              className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 transition"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-accent-300 hover:text-accent-500 p-0.5"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* 书架 */}
        {sorted.length === 0 ? (
          <div className="card p-10 text-center">
            <BookOpen size={44} className="mx-auto text-accent-200 mb-3" />
            {query ? (
              <>
                <p className="text-accent-500 text-sm mb-1">没有匹配的书籍</p>
                <p className="text-accent-400 text-xs">试试其他关键词，或 <button onClick={() => setQuery('')} className="text-primary-500 underline">清空搜索</button></p>
              </>
            ) : (
              <>
                <p className="text-accent-500 text-sm mb-1">书架还是空的</p>
                <p className="text-accent-400 text-xs mb-5">点击「导入书籍」选择本地小说文件，支持多选</p>
                <button onClick={() => fileRef.current?.click()} className="btn-primary text-sm px-5 py-2.5">
                  导入第一本书
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map((b) => {
              const meta = FORMAT_META[b.format]
              return (
                <div
                  key={b.id}
                  className="card p-4 flex gap-3 hover:shadow-md transition-shadow group cursor-pointer"
                  onClick={() => navigate(`/novel/${b.id}`)}
                >
                  <div className="w-12 h-16 rounded-lg bg-gradient-to-b from-primary-50 to-primary-100 flex items-center justify-center shrink-0">
                    <FileText size={22} className="text-primary-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-accent-800 text-sm truncate group-hover:text-primary-600 transition-colors">
                        {b.title}
                      </h3>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${meta.color}`}>{meta.label}</span>
                      <span className="text-[11px] text-accent-400">{formatSize(b.size)}</span>
                      <span className="text-[11px] text-accent-400 flex items-center gap-0.5">
                        <Clock size={10} /> {timeAgo(b.lastReadAt)}
                      </span>
                    </div>
                    <div className="mt-2.5">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-400 rounded-full transition-all" style={{ width: `${b.percent}%` }} />
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[11px] text-accent-400">
                          {b.percent > 0 ? `已读 ${b.percent}%` : '未开始'}
                          {b.readSeconds > 0 && <span className="ml-1.5 text-accent-300">· {formatDuration(b.readSeconds)}</span>}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); del(b) }}
                            className="text-accent-300 hover:text-red-500 transition-colors p-1"
                            title="删除"
                          >
                            <Trash2 size={13} />
                          </button>
                          <button
                            onClick={() => navigate(`/novel/${b.id}`)}
                            className="text-[11px] text-primary-600 hover:text-primary-500 font-medium"
                          >
                            {b.percent > 0 ? '继续阅读' : '开始阅读'} →
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 阅读统计弹窗 */}
      {showStats && stats && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowStats(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full sm:w-[440px] rounded-t-2xl sm:rounded-2xl p-5 shadow-xl bg-white max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-sm flex items-center gap-2">
                <BarChart3 size={16} className="text-primary-500" /> 阅读统计
              </span>
              <button onClick={() => setShowStats(false)} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <div className="bg-primary-50 rounded-lg py-2.5">
                <div className="text-base font-bold text-primary-600">{formatDuration(stats.totalSeconds)}</div>
                <div className="text-[10px] text-accent-400 mt-0.5">累计阅读</div>
              </div>
              <div className="bg-emerald-50 rounded-lg py-2.5">
                <div className="text-base font-bold text-emerald-600">{stats.totalDays}</div>
                <div className="text-[10px] text-accent-400 mt-0.5">阅读天数</div>
              </div>
              <div className="bg-amber-50 rounded-lg py-2.5">
                <div className="text-base font-bold text-amber-600">{stats.streakDays}</div>
                <div className="text-[10px] text-accent-400 mt-0.5">连续天数</div>
              </div>
            </div>
            <div className="mb-4">
              <div className="text-xs text-accent-500 mb-2">近 7 天阅读时长</div>
              <div className="flex items-end justify-between gap-1.5 h-24">
                {stats.last7Days.map((d) => {
                  const max = Math.max(...stats.last7Days.map((x) => x.seconds), 60)
                  const h = Math.max(2, (d.seconds / max) * 100)
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-gradient-to-t from-primary-300 to-primary-500 transition-all"
                        style={{ height: `${h}%` }}
                        title={formatDuration(d.seconds)}
                      />
                      <div className="text-[9px] text-accent-400">{d.date.slice(5)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
            {stats.topBooks.length > 0 && (
              <div>
                <div className="text-xs text-accent-500 mb-2">阅读最多的书</div>
                <div className="space-y-1.5">
                  {stats.topBooks.map((b, i) => (
                    <div key={b.bookId} className="flex items-center gap-2 text-xs">
                      <span className="w-4 text-accent-400">{i + 1}</span>
                      <span className="flex-1 truncate text-accent-700">{b.title}</span>
                      <span className="text-accent-400 tabular-nums">{formatDuration(b.seconds)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {stats.totalSeconds === 0 && (
              <div className="text-center text-xs text-accent-400 py-4">
                还没有阅读记录，开始你的第一本书吧
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
