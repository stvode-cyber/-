import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'
import { ChevronLeft, ChevronRight } from 'lucide-react'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  blob: Blob
  initialPage: number
  onPage: (page: number, total: number) => void
}

/**
 * PDF 阅读器（pdfjs canvas 渲染，逐页查看）
 */
export default function PdfReader({ blob, initialPage, onPage }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(initialPage || 1)
  const [scale, setScale] = useState(1.2)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let destroyed = false
    ;(async () => {
      try {
        const buf = await blob.arrayBuffer()
        const doc = await pdfjsLib.getDocument({ data: buf }).promise
        if (destroyed) { void doc.destroy(); return }
        docRef.current = doc
        setNumPages(doc.numPages)
        onPage(page, doc.numPages)
      } catch {
        if (!destroyed) setError('PDF 解析失败，文件可能已损坏或已加密')
      }
    })()
    return () => {
      destroyed = true
      void docRef.current?.destroy()
      docRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob])

  // 渲染当前页
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const doc = docRef.current
      const canvas = canvasRef.current
      if (!doc || !canvas || page < 1 || page > doc.numPages) return
      try {
        const pdfPage = await doc.getPage(page)
        if (cancelled) return
        const container = wrapRef.current
        const avail = container ? container.clientWidth - 32 : 800
        const base = pdfPage.getViewport({ scale: 1 })
        const fit = Math.min(avail / base.width, 1.6)
        const viewport = pdfPage.getViewport({ scale: Math.max(scale, 0.1) * fit })
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await pdfPage.render({ canvasContext: ctx, viewport }).promise
      } catch { /* 翻页竞态时忽略 */ }
    })()
    return () => { cancelled = true }
  }, [page, scale, numPages])

  const go = useCallback((delta: number) => {
    setPage((p) => {
      const next = p + delta
      if (next < 1 || (numPages && next > numPages)) return p
      onPage(next, numPages)
      return next
    })
  }, [numPages, onPage])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  if (error) return <div className="flex-1 flex items-center justify-center text-sm text-red-500">{error}</div>

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={wrapRef} className="flex-1 overflow-auto flex justify-center p-4 bg-gray-500/10">
        <canvas ref={canvasRef} className="shadow-lg rounded bg-white max-w-full" />
      </div>
      <div className="flex items-center justify-center gap-3 py-2 border-t border-gray-200 bg-white/80 text-sm">
        <button onClick={() => go(-1)} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30">
          <ChevronLeft size={18} />
        </button>
        <span className="tabular-nums text-gray-600">
          <input
            type="number" min={1} max={numPages || 1} value={page}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v >= 1 && (!numPages || v <= numPages)) { setPage(v); onPage(v, numPages) }
            }}
            className="w-14 text-center border border-gray-200 rounded px-1 py-0.5"
          />
          {' / '}{numPages || '…'} 页
        </span>
        <button onClick={() => go(1)} disabled={!!numPages && page >= numPages} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30">
          <ChevronRight size={18} />
        </button>
        <span className="mx-2 text-gray-300">|</span>
        <button onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(1)))} className="px-2 py-0.5 rounded hover:bg-gray-100" title="缩小">−</button>
        <span className="tabular-nums text-gray-500 w-10 text-center">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(1)))} className="px-2 py-0.5 rounded hover:bg-gray-100" title="放大">＋</button>
      </div>
    </div>
  )
}
