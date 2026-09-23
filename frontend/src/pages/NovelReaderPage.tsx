import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, List, Settings2, ChevronLeft, ChevronRight, X, Loader2,
  Bookmark, BookmarkCheck, StickyNote, Play, Pause, Square, Gauge, Trash2,
} from 'lucide-react'
import { useToast } from '../components/Toast'
// 格式阅读器懒加载：epubjs / pdfjs-dist 体积大（合计 >600KB），
// 按需加载拆出独立 chunk，避免全部塞进 NovelReaderPage 主 chunk（原 720KB 超 500KB 推荐值）
const EpubReader = lazy(() => import('../components/novel/EpubReader'))
const PdfReader = lazy(() => import('../components/novel/PdfReader'))
import { decodeTxt, splitChapters, type TxtChapter } from '../lib/txtParse'
import {
  type NovelBook, type NovelSettings, type NovelMark,
  getBook, loadBookFile, upsertBook,
  loadSettings, saveSettings, READER_THEMES,
  listBookMarks, addMark, removeMark, updateMarkNote,
  addReadSeconds, formatDuration,
} from '../lib/novelStore'

/** Markdown → HTML（轻量实现：标题/列表/引用/粗斜体/行内代码/链接/图片/围栏代码） */
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let inCode = false
  let inList = false
  let inQuote = false
  const closeBlocks = () => {
    if (inList) { out.push('</ul>'); inList = false }
    if (inQuote) { out.push('</blockquote>'); inQuote = false }
  }
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      closeBlocks()
      out.push(inCode ? '</code></pre>' : '<pre><code>')
      inCode = !inCode
      continue
    }
    if (inCode) { out.push(esc(line)); continue }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      closeBlocks()
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }
    const li = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (li) {
      if (!inList) { closeBlocks(); out.push('<ul>'); inList = true }
      out.push(`<li>${inline(li[1])}</li>`)
      continue
    }
    const bq = /^>\s?(.*)$/.exec(line)
    if (bq) {
      if (inList) { out.push('</ul>'); inList = false }
      if (!inQuote) { out.push('<blockquote>'); inQuote = true }
      out.push(`<p>${inline(bq[1])}</p>`)
      continue
    }
    if (!line.trim()) { closeBlocks(); continue }
    closeBlocks()
    out.push(`<p>${inline(line)}</p>`)
  }
  closeBlocks()
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}

/** HTML 文件：去掉 script/iframe 后渲染（本地文件，样式保留） */
function sanitizeHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
}

export default function NovelReaderPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)

  const [book, setBook] = useState<NovelBook | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [settings, setSettings] = useState<NovelSettings>(() => loadSettings())
  const [loading, setLoading] = useState(true)
  const [showToc, setShowToc] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMarks, setShowMarks] = useState(false)

  // TXT 状态
  const [chapters, setChapters] = useState<TxtChapter[] | null>(null)
  const [chapterIdx, setChapterIdx] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollRatioRef = useRef(0)
  const chapterRef = useRef(0)
  chapterRef.current = chapterIdx
  // 富文本状态（docx/md/html）
  const [htmlContent, setHtmlContent] = useState<string | null>(null)
  const [srcDoc, setSrcDoc] = useState<string | null>(null)

  // 各格式最新进度（离开页面时兜底保存）
  const bookRef = useRef<NovelBook | null>(null)
  bookRef.current = book
  const chaptersRef = useRef<TxtChapter[] | null>(null)
  chaptersRef.current = chapters
  const epubProgressRef = useRef<{ cfi: string; percent: number } | null>(null)
  const pdfProgressRef = useRef<{ page: number; total: number } | null>(null)

  // 书签 / 笔记
  const [marks, setMarks] = useState<NovelMark[]>([])
  const [noteDraft, setNoteDraft] = useState<{ id: string; text: string } | null>(null)
  const refreshMarks = useCallback(() => {
    if (id) setMarks(listBookMarks(id))
  }, [id])

  // 阅读时长追踪：每 30s 累加一次（仅当页面可见时）
  const readSecondsRef = useRef(0)
  useEffect(() => {
    if (!id) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        readSecondsRef.current += 30
        addReadSeconds(id, 30)
      }
    }, 30000)
    return () => window.clearInterval(timer)
  }, [id])

  // 自动滚动（TXT/HTML/MD）
  const [autoScroll, setAutoScroll] = useState(false)
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(2)
  const autoScrollRef = useRef<number | null>(null)
  const toggleAutoScroll = useCallback(() => {
    setAutoScroll((on) => !on)
  }, [])
  // 统一在 effect 中管理 interval，避免在 state updater 内启动副作用（StrictMode 双调用导致泄漏）
  useEffect(() => {
    if (!autoScroll) return
    const el = scrollRef.current
    if (!el) return
    autoScrollRef.current = window.setInterval(() => {
      el.scrollTop += autoScrollSpeed
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
        setAutoScroll(false)
      }
    }, 40)
    return () => {
      if (autoScrollRef.current) {
        window.clearInterval(autoScrollRef.current)
        autoScrollRef.current = null
      }
    }
  }, [autoScroll, autoScrollSpeed])

  // TTS 朗读
  const [ttsPlaying, setTtsPlaying] = useState(false)
  const ttsPausedRef = useRef(false)
  const stopTts = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setTtsPlaying(false)
    ttsPausedRef.current = false
  }, [])
  const speakTts = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast('当前浏览器不支持语音朗读', 'error')
      return
    }
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    u.rate = 1
    u.onend = () => setTtsPlaying(false)
    u.onerror = () => setTtsPlaying(false)
    window.speechSynthesis.speak(u)
    setTtsPlaying(true)
    ttsPausedRef.current = false
  }, [toast])
  const toggleTts = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast('当前浏览器不支持语音朗读', 'error')
      return
    }
    if (ttsPlaying) {
      if (ttsPausedRef.current) {
        window.speechSynthesis.resume()
        ttsPausedRef.current = false
      } else {
        window.speechSynthesis.pause()
        ttsPausedRef.current = true
      }
    } else {
      // 取当前章节/全文朗读
      let text = ''
      if (book?.format === 'txt' && chapters) {
        text = chapters[chapterIdx]?.content || ''
      } else if (htmlContent) {
        // 去标签（DOCX/MD 已转为 HTML 存入 htmlContent）
        text = htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      }
      if (text.length > 5000) text = text.slice(0, 5000)
      if (!text) {
        toast('当前格式暂不支持朗读（EPUB/PDF 需使用阅读器内置功能）', 'error')
        return
      }
      speakTts(text)
    }
  }, [ttsPlaying, book, chapters, chapterIdx, htmlContent, speakTts, toast])
  // 页面卸载时停止 TTS / 自动滚动
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
      if (autoScrollRef.current) window.clearInterval(autoScrollRef.current)
    }
  }, [])

  // 节流保存进度
  const saveTimerRef = useRef<number | null>(null)
  const persist = useCallback((patch: Partial<NovelBook>) => {
    if (!book) return
    upsertBook({ ...book, lastReadAt: Date.now(), ...patch })
    setBook((b) => (b ? { ...b, ...patch, lastReadAt: Date.now() } : b))
  }, [book])
  const scheduleSave = useCallback((patch: Partial<NovelBook>) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => persist(patch), 800)
  }, [persist])

  // 加载书籍
  useEffect(() => {
    if (!id) return
    const b = getBook(id)
    if (!b) { toast('书籍不存在或已删除', 'error'); navigate('/novel', { replace: true }); return }
    // 兼容旧书籍：补齐 readSeconds 字段
    if (b.readSeconds === undefined) b.readSeconds = 0
    loadBookFile(id).then((file) => {
      if (!file) { toast('书籍文件丢失，请重新导入', 'error'); navigate('/novel', { replace: true }); return }
      setBook(b)
      setBlob(file)
      setLoading(false)
    })
    refreshMarks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // TXT/DOCX/MD/HTML 解析
  useEffect(() => {
    if (!blob || !book) return
    let cancelled = false
    ;(async () => {
      try {
        if (book.format === 'txt') {
          const text = decodeTxt(await blob.arrayBuffer())
          const chs = splitChapters(text)
          if (cancelled) return
          setChapters(chs)
          setChapterIdx(Math.min(book.chapterIdx, chs.length - 1))
          upsertBook({ ...book, chapterCount: chs.length })
        } else if (book.format === 'docx') {
          const mammoth = await import('mammoth')
          const res = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() })
          if (!cancelled) setHtmlContent(res.value)
        } else if (book.format === 'md') {
          if (!cancelled) setHtmlContent(mdToHtml(await blob.text()))
        } else if (book.format === 'html') {
          if (!cancelled) setSrcDoc(sanitizeHtml(await blob.text()))
        }
      } catch {
        if (!cancelled) toast('文件解析失败，可能已损坏', 'error')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob])

  // TXT 章节切换后恢复滚动位置
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !chapters) return
    if (scrollRatioRef.current > 0) {
      const ratio = scrollRatioRef.current
      const t = window.setTimeout(() => { el.scrollTop = (el.scrollHeight - el.clientHeight) * ratio }, 60)
      return () => window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIdx, chapters])

  // 离开页面时保存阅读进度（所有格式兜底；节流未落盘的进度在此补存）
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      // 停止朗读 / 自动滚动
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
      if (autoScrollRef.current) window.clearInterval(autoScrollRef.current)
      const b = bookRef.current
      if (!b) return
      if (b.format === 'txt' && chaptersRef.current) {
        upsertBook({
          ...b, lastReadAt: Date.now(), chapterIdx: chapterRef.current, scrollRatio: scrollRatioRef.current,
          percent: Math.round(((chapterRef.current + 1) / chaptersRef.current.length) * 100),
        })
      } else if (b.format === 'epub' && epubProgressRef.current) {
        upsertBook({ ...b, lastReadAt: Date.now(), cfi: epubProgressRef.current.cfi, percent: epubProgressRef.current.percent })
      } else if (b.format === 'pdf' && pdfProgressRef.current) {
        const { page, total } = pdfProgressRef.current
        upsertBook({ ...b, lastReadAt: Date.now(), page, totalPages: total, percent: total ? Math.round((page / total) * 100) : 0 })
      }
    }
  }, [])

  const theme = READER_THEMES[settings.theme]
  const applySettings = (patch: Partial<NovelSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const ratio = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0
    scrollRatioRef.current = ratio
    if (chapters && book) {
      const percent = Math.round(((chapterIdx + ratio / 2) / chapters.length) * 100)
      scheduleSave({ chapterIdx, scrollRatio: ratio, percent, chapterCount: chapters.length })
    }
  }

  const gotoChapter = (idx: number) => {
    scrollRatioRef.current = 0
    setChapterIdx(idx)
    setShowToc(false)
  }

  // === 书签 / 笔记 ===
  const currentLocation = useCallback((): { location: string; chapterTitle: string; excerpt: string } | null => {
    if (!book) return null
    if (book.format === 'txt' && chapters) {
      const ch = chapters[chapterIdx]
      const excerpt = (ch?.content || '').slice(0, 80).replace(/\s+/g, ' ').trim()
      return {
        location: `ch:${chapterIdx}:r:${scrollRatioRef.current.toFixed(3)}`,
        chapterTitle: ch?.title || `第 ${chapterIdx + 1} 章`,
        excerpt,
      }
    }
    if (book.format === 'epub' && epubProgressRef.current) {
      return {
        location: epubProgressRef.current.cfi,
        chapterTitle: `进度 ${epubProgressRef.current.percent}%`,
        excerpt: `EPUB 定位：${epubProgressRef.current.cfi.slice(0, 60)}`,
      }
    }
    if (book.format === 'pdf' && pdfProgressRef.current) {
      return {
        location: `p:${pdfProgressRef.current.page}`,
        chapterTitle: `第 ${pdfProgressRef.current.page} 页`,
        excerpt: `共 ${pdfProgressRef.current.total} 页`,
      }
    }
    if (['docx', 'html', 'md'].includes(book.format)) {
      const el = scrollRef.current
      const r = el ? (el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)) : 0
      return {
        location: `r:${r.toFixed(3)}`,
        chapterTitle: book.title,
        excerpt: '',
      }
    }
    return null
  }, [book, chapters, chapterIdx])

  const addBookmark = () => {
    if (!id || !book) return
    const loc = currentLocation()
    if (!loc) { toast('当前格式无法添加书签', 'error'); return }
    // 同位置去重：location 相同则提示
    if (marks.some((m) => m.location === loc.location)) {
      toast('此位置已存在书签', 'error')
      return
    }
    addMark({ bookId: id, type: 'bookmark', location: loc.location, chapterTitle: loc.chapterTitle, excerpt: loc.excerpt })
    refreshMarks()
    toast('已添加书签', 'success')
  }

  const addNote = () => {
    if (!id || !book) return
    const loc = currentLocation()
    if (!loc) { toast('当前格式无法添加笔记', 'error'); return }
    // 取选中文本（TXT/HTML/MD 才有 scrollRef 内的 selection）
    let sel = ''
    if (scrollRef.current) {
      const s = window.getSelection()
      if (s && s.toString()) sel = s.toString()
    }
    const mark = addMark({
      bookId: id, type: 'note',
      location: loc.location, chapterTitle: loc.chapterTitle,
      excerpt: sel || loc.excerpt,
      note: '',
    })
    refreshMarks()
    setNoteDraft({ id: mark.id, text: '' })
  }

  const jumpToMark = (m: NovelMark) => {
    if (!book) return
    if (book.format === 'txt' && chapters) {
      const match = /^ch:(\d+):r:([\d.]+)$/.exec(m.location)
      if (match) {
        const idx = parseInt(match[1], 10)
        scrollRatioRef.current = parseFloat(match[2])
        setChapterIdx(Math.min(idx, chapters.length - 1))
        setShowMarks(false)
        return
      }
    }
    if (book.format === 'pdf') {
      const match = /^p:(\d+)$/.exec(m.location)
      if (match) {
        // PDF 跳转通过刷新 page 状态实现：直接重置 book.page，让 PdfReader 重新渲染
        const page = parseInt(match[1], 10)
        if (book) {
          upsertBook({ ...book, page })
          setBook({ ...book, page })
        }
        setShowMarks(false)
        return
      }
    }
    if (['docx', 'html', 'md'].includes(book.format)) {
      const match = /^r:([\d.]+)$/.exec(m.location)
      if (match && scrollRef.current) {
        const r = parseFloat(match[1])
        const el = scrollRef.current
        const t = window.setTimeout(() => {
          el.scrollTop = (el.scrollHeight - el.clientHeight) * r
        }, 60)
        window.setTimeout(() => window.clearTimeout(t), 200)
        setShowMarks(false)
        return
      }
    }
    // EPUB 跳转通过 CFI 需要 rendition.display(cfi)，这里仅提示
    if (book.format === 'epub') {
      toast('EPUB 跳转请使用阅读器内翻页恢复进度', 'info')
    }
    setShowMarks(false)
  }

  const deleteMark = (markId: string) => {
    removeMark(markId)
    refreshMarks()
  }

  const saveNoteDraft = () => {
    if (!noteDraft) return
    updateMarkNote(noteDraft.id, noteDraft.text)
    refreshMarks()
    setNoteDraft(null)
    toast('笔记已保存', 'success')
  }

  const body = useMemo(() => {
    if (!book || !blob) return null
    if (book.format === 'epub') {
      return (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-400 text-sm">加载阅读器…</div>}>
          <EpubReader
            blob={blob} settings={settings} initialCfi={book.cfi}
            onProgress={(cfi, percent) => {
              epubProgressRef.current = { cfi, percent }
              scheduleSave({ cfi, percent })
            }}
          />
        </Suspense>
      )
    }
    if (book.format === 'pdf') {
      return (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-400 text-sm">加载阅读器…</div>}>
          <PdfReader
            blob={blob} initialPage={book.page}
            onPage={(page, total) => {
              pdfProgressRef.current = { page, total }
              scheduleSave({ page, totalPages: total, percent: total ? Math.round((page / total) * 100) : 0 })
            }}
          />
        </Suspense>
      )
    }
    if (book.format === 'txt' && chapters) {
      const ch = chapters[chapterIdx]
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <div
            ref={scrollRef} onScroll={onScroll}
            className="flex-1 overflow-y-auto px-5 sm:px-10 py-6"
            style={{ background: theme.bg, color: theme.text }}
          >
            <div className="max-w-2xl mx-auto" style={{ fontSize: settings.fontSize, lineHeight: settings.lineHeight }}>
              <h2 className="font-bold mb-6 text-center opacity-80" style={{ fontSize: settings.fontSize + 2 }}>{ch.title}</h2>
              <div className="whitespace-pre-wrap break-words">{ch.content}</div>
              <div className="text-center text-xs opacity-40 mt-10 mb-4">—— 第 {chapterIdx + 1} / {chapters.length} 章 ——</div>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-2 border-t" style={{ background: theme.bg, borderColor: 'rgba(128,128,128,.2)', color: theme.text }}>
            <button
              onClick={() => { scrollRatioRef.current = 0; setChapterIdx((i) => Math.max(0, i - 1)) }}
              disabled={chapterIdx <= 0} className="flex items-center gap-1 text-sm disabled:opacity-30"
            >
              <ChevronLeft size={16} /> 上一章
            </button>
            <span className="text-xs opacity-50 tabular-nums">{Math.round(((chapterIdx + 1) / chapters.length) * 100)}%</span>
            <button
              onClick={() => { scrollRatioRef.current = 0; setChapterIdx((i) => Math.min(chapters.length - 1, i + 1)) }}
              disabled={chapterIdx >= chapters.length - 1} className="flex items-center gap-1 text-sm disabled:opacity-30"
            >
              下一章 <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )
    }
    if (htmlContent !== null) {
      return (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-5 sm:px-10 py-6"
          style={{ background: theme.bg, color: theme.text }}
        >
          <div
            className="max-w-2xl mx-auto novel-rich"
            style={{ fontSize: settings.fontSize, lineHeight: settings.lineHeight }}
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </div>
      )
    }
    if (srcDoc !== null) {
      return (
        <iframe
          title={book.title} srcDoc={srcDoc} sandbox="allow-same-origin"
          className="flex-1 w-full border-0" style={{ background: theme.bg }}
        />
      )
    }
    return (
      <div className="flex-1 flex items-center justify-center text-sm opacity-50">
        <Loader2 size={18} className="animate-spin mr-2" /> 正在解析…
      </div>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, blob, chapters, chapterIdx, htmlContent, srcDoc, settings, theme])

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-accent-400 text-sm">
        <Loader2 size={18} className="animate-spin mr-2" /> 正在打开书籍…
      </div>
    )
  }
  if (!book) return null

  return (
    <div className="h-screen flex flex-col" style={{ background: theme.bg }}>
      {/* 顶栏 */}
      <header
        className="h-12 shrink-0 flex items-center gap-1 px-3 border-b"
        style={{ background: theme.bg, color: theme.text, borderColor: 'rgba(128,128,128,.2)' }}
      >
        <button onClick={() => navigate('/novel')} className="p-1.5 rounded hover:bg-black/5" title="返回书架">
          <ArrowLeft size={18} />
        </button>
        <h1 className="flex-1 text-sm font-semibold truncate">{book.title}</h1>
        {/* 阅读时长 */}
        <span className="text-[11px] opacity-40 tabular-nums px-1 hidden sm:inline">
          {formatDuration(book.readSeconds || 0)}
        </span>
        {/* 书签 */}
        <button onClick={addBookmark} className="p-1.5 rounded hover:bg-black/5" title="添加书签">
          <Bookmark size={16} />
        </button>
        {/* 笔记 */}
        <button onClick={addNote} className="p-1.5 rounded hover:bg-black/5" title="添加笔记">
          <StickyNote size={16} />
        </button>
        {/* 书签/笔记列表 */}
        <button
          onClick={() => setShowMarks(true)}
          className="p-1.5 rounded hover:bg-black/5 relative"
          title="书签与笔记"
        >
          <BookmarkCheck size={16} />
          {marks.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary-500 text-white text-[9px] flex items-center justify-center">
              {marks.length}
            </span>
          )}
        </button>
        {/* TTS 朗读（仅 TXT/DOCX/HTML/MD 显示） */}
        {book.format !== 'epub' && book.format !== 'pdf' && (
          <button onClick={toggleTts} className="p-1.5 rounded hover:bg-black/5" title="语音朗读">
            {ttsPlaying ? <Pause size={16} className="text-primary-500" /> : <Play size={16} />}
          </button>
        )}
        {ttsPlaying && (
          <button onClick={stopTts} className="p-1.5 rounded hover:bg-black/5" title="停止朗读">
            <Square size={14} />
          </button>
        )}
        {/* 自动滚动（仅 TXT/HTML/MD 显示，依赖 scrollRef） */}
        {(book.format === 'txt' || ['docx', 'html', 'md'].includes(book.format)) && (
          <button
            onClick={toggleAutoScroll}
            className={`p-1.5 rounded hover:bg-black/5 ${autoScroll ? 'text-primary-500' : ''}`}
            title="自动滚动"
          >
            <Gauge size={16} />
          </button>
        )}
        <button onClick={() => setShowToc(true)} className="p-1.5 rounded hover:bg-black/5 text-xs flex items-center gap-1">
          <List size={16} /> <span className="hidden sm:inline">目录</span>
        </button>
        <button onClick={() => setShowSettings(true)} className="p-1.5 rounded hover:bg-black/5" title="阅读设置">
          <Settings2 size={16} />
        </button>
      </header>

      {body}

      {/* 目录抽屉 */}
      {showToc && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setShowToc(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-72 sm:w-80 h-full shadow-xl flex flex-col"
            style={{ background: theme.bg, color: theme.text }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-12 flex items-center justify-between px-4 border-b" style={{ borderColor: 'rgba(128,128,128,.2)' }}>
              <span className="font-semibold text-sm">目录{chapters ? `（${chapters.length} 章）` : ''}</span>
              <button onClick={() => setShowToc(false)} className="p-1 rounded hover:bg-black/5"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {book.format === 'txt' && chapters?.map((c, i) => (
                <button
                  key={i} onClick={() => gotoChapter(i)}
                  className={`w-full text-left px-4 py-2 text-sm truncate hover:bg-black/5 ${i === chapterIdx ? 'font-semibold text-primary-600' : 'opacity-80'}`}
                >
                  {c.title}
                </button>
              ))}
              {book.format === 'epub' && (
                <div className="px-4 py-3 text-xs opacity-60">EPUB 目录切换请使用阅读器内左右翻页（章节导航随翻页自动前进）</div>
              )}
              {book.format === 'pdf' && <div className="px-4 py-3 text-xs opacity-60">PDF 共 {book.totalPages || '…'} 页，使用底部页码框直接跳转</div>}
              {['docx', 'html', 'md'].includes(book.format) && (
                <div className="px-4 py-3 text-xs opacity-60">该格式为连续文档，无章节目录</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 设置面板 */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowSettings(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full sm:w-96 rounded-t-2xl sm:rounded-2xl p-5 shadow-xl"
            style={{ background: theme.bg, color: theme.text }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-sm">阅读设置</span>
              <button onClick={() => setShowSettings(false)} className="p-1 rounded hover:bg-black/5"><X size={16} /></button>
            </div>
            <div className="space-y-4 text-sm">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="opacity-70">字号</span>
                  <span className="tabular-nums opacity-50">{settings.fontSize}px</span>
                </div>
                <div className="flex gap-2">
                  {[14, 16, 18, 20, 22, 24].map((s) => (
                    <button
                      key={s} onClick={() => applySettings({ fontSize: s })}
                      className={`flex-1 py-1.5 rounded-lg border text-xs ${settings.fontSize === s ? 'border-primary-500 text-primary-600 font-semibold' : 'opacity-60'}`}
                      style={{ borderColor: settings.fontSize === s ? undefined : 'rgba(128,128,128,.3)' }}
                    >{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="opacity-70">行距</span>
                  <span className="tabular-nums opacity-50">{settings.lineHeight.toFixed(1)}</span>
                </div>
                <input
                  type="range" min={1.4} max={2.6} step={0.1} value={settings.lineHeight}
                  onChange={(e) => applySettings({ lineHeight: Number(e.target.value) })}
                  className="w-full accent-emerald-600"
                />
              </div>
              <div>
                <div className="mb-1.5 opacity-70">背景主题</div>
                <div className="flex gap-2">
                  {(Object.keys(READER_THEMES) as Array<keyof typeof READER_THEMES>).map((k) => (
                    <button
                      key={k} onClick={() => applySettings({ theme: k })}
                      className={`flex-1 py-2 rounded-lg text-xs border ${settings.theme === k ? 'border-primary-500 font-semibold' : ''}`}
                      style={{ background: READER_THEMES[k].bg, color: READER_THEMES[k].text, borderColor: settings.theme === k ? undefined : 'rgba(128,128,128,.3)' }}
                      title={READER_THEMES[k].name}
                    >{READER_THEMES[k].name}</button>
                  ))}
                </div>
              </div>
              {autoScroll && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="opacity-70 flex items-center gap-1"><Gauge size={13} /> 自动滚动速度</span>
                    <span className="tabular-nums opacity-50">{autoScrollSpeed}px/帧</span>
                  </div>
                  <input
                    type="range" min={1} max={8} step={1} value={autoScrollSpeed}
                    onChange={(e) => setAutoScrollSpeed(Number(e.target.value))}
                    className="w-full accent-emerald-600"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 书签 / 笔记抽屉 */}
      {showMarks && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setShowMarks(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-72 sm:w-80 h-full shadow-xl flex flex-col"
            style={{ background: theme.bg, color: theme.text }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-12 flex items-center justify-between px-4 border-b shrink-0" style={{ borderColor: 'rgba(128,128,128,.2)' }}>
              <span className="font-semibold text-sm">书签 / 笔记（{marks.length}）</span>
              <button onClick={() => setShowMarks(false)} className="p-1 rounded hover:bg-black/5"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {marks.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs opacity-50">
                  还没有书签或笔记<br />点击顶栏的 ★ 或 便签 图标添加
                </div>
              ) : marks.map((m) => (
                <div
                  key={m.id}
                  className="px-4 py-2.5 hover:bg-black/5 cursor-pointer border-b"
                  style={{ borderColor: 'rgba(128,128,128,.08)' }}
                  onClick={() => jumpToMark(m)}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    {m.type === 'bookmark' ? (
                      <Bookmark size={11} className="text-primary-500 shrink-0" />
                    ) : (
                      <StickyNote size={11} className="text-amber-500 shrink-0" />
                    )}
                    <span className="text-xs font-medium opacity-80 truncate">{m.chapterTitle}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteMark(m.id) }}
                      className="ml-auto text-accent-300 hover:text-red-500 p-0.5 shrink-0"
                      title="删除"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  {m.excerpt && (
                    <div className="text-[11px] opacity-60 line-clamp-2 mb-1">{m.excerpt}</div>
                  )}
                  {m.type === 'note' && (
                    <div className="mt-1">
                      {m.note ? (
                        <div className="text-[11px] opacity-70 italic line-clamp-3">📝 {m.note}</div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setNoteDraft({ id: m.id, text: '' }) }}
                          className="text-[11px] text-primary-500 hover:underline"
                        >+ 添加笔记内容</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 笔记编辑弹窗 */}
      {noteDraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setNoteDraft(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-md rounded-2xl p-5 shadow-xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-sm flex items-center gap-1.5">
                <StickyNote size={15} className="text-amber-500" /> 编辑笔记
              </span>
              <button onClick={() => setNoteDraft(null)} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
            </div>
            <textarea
              value={noteDraft.text}
              onChange={(e) => setNoteDraft({ ...noteDraft, text: e.target.value })}
              placeholder="写下你的想法…"
              rows={5}
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 resize-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setNoteDraft(null)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
              >取消</button>
              <button
                onClick={saveNoteDraft}
                className="px-3 py-1.5 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600"
              >保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
