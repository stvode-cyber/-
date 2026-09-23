import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import ePub, { type Book, type Rendition, type NavItem } from 'epubjs'
import type { NovelSettings } from '../../lib/novelStore'
import { READER_THEMES } from '../../lib/novelStore'

interface Props {
  blob: Blob
  settings: NovelSettings
  initialCfi: string | null
  onProgress: (cfi: string, percent: number) => void
}

/**
 * EPUB 阅读器（epubjs 分页渲染）
 * - 目录来自 EPUB 自带 navigation
 * - 进度以 CFI 定位（精确到段落，可跨设备恢复）
 */
export default function EpubReader({ blob, settings, initialCfi, onProgress }: Props) {
  const holderRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [toc, setToc] = useState<NavItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const theme = READER_THEMES[settings.theme]

  useEffect(() => {
    let destroyed = false
    const holder = holderRef.current
    if (!holder) return

    ;(async () => {
      try {
        const buf = await blob.arrayBuffer()
        const book = ePub(buf as ArrayBuffer)
        bookRef.current = book
        const rendition = book.renderTo(holder, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          spread: 'none',
        })
        renditionRef.current = rendition
        await rendition.display(initialCfi || undefined)

        book.loaded.navigation
          .then((nav: { toc: NavItem[] }) => { if (!destroyed) setToc(nav.toc) })
          .catch(() => undefined)

        rendition.on('relocated', (location: { start: { cfi: string; index?: number; displayed?: { page: number; total: number } } }) => {
          const start = location.start || { cfi: '' }
          const spine = bookRef.current?.spine as unknown as { items?: unknown[]; length?: number } | undefined
          const total = spine?.items?.length || spine?.length || 0
          let percent = 0
          if (total > 0) {
            const idx = typeof start.index === 'number' ? start.index : 0
            const pageFrac = start.displayed && start.displayed.total > 0 ? (start.displayed.page - 1) / start.displayed.total : 0
            percent = Math.round(((idx + pageFrac) / total) * 100)
          }
          onProgress(start.cfi, percent)
        })
      } catch {
        if (!destroyed) setError('EPUB 解析失败，文件可能已损坏')
      }
    })()

    return () => {
      destroyed = true
      try { renditionRef.current?.destroy() } catch { /* ignore */ }
      try { bookRef.current?.destroy() } catch { /* ignore */ }
      renditionRef.current = null
      bookRef.current = null
    }
    // initialCfi 仅用于首次打开定位，不响应运行时变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob])

  // 应用字号与主题
  useEffect(() => {
    const r = renditionRef.current
    if (!r) return
    const t = READER_THEMES[settings.theme]
    r.themes.override('font-size', `${settings.fontSize}px`)
    r.themes.override('color', t.text)
    r.themes.override('background', t.bg)
  }, [settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') renditionRef.current?.prev()
      if (e.key === 'ArrowRight') renditionRef.current?.next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="relative flex-1 min-h-0 w-full flex flex-col">
      <div ref={holderRef} className="flex-1 min-h-0 w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-red-500">{error}</div>
      )}
      <div
        className="flex items-center justify-between px-4 py-2 border-t shrink-0"
        style={{ background: theme.bg, color: theme.text, borderColor: 'rgba(128,128,128,.2)' }}
      >
        <button onClick={() => renditionRef.current?.prev()} className="flex items-center gap-1 text-sm opacity-80 hover:opacity-100">
          <ChevronLeft size={16} /> 上一页
        </button>
        <span className="text-xs opacity-50">← → 键或点击翻页</span>
        <button onClick={() => renditionRef.current?.next()} className="flex items-center gap-1 text-sm opacity-80 hover:opacity-100">
          下一页 <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
