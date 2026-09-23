import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, RefreshCw, Download, FileCode2 } from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { isDesktop } from '../lib/localCache'
import { downloadOfficeDoc } from './ChatPage'

/** GET /chat/office-docs/:id 返回结构 */
interface OfficeDoc {
  id: string
  title: string
  content: string
  meta: {
    basedOn: string | null
    instruction: string | null
    version: number
    charCount: number
    createdAt: string
  }
}

/**
 * 办公文档预览页（P2）
 * 数据源：GET /chat/office-docs/:id（office.write_document 生成的新版本，Fragment kind='office_doc'）
 * 入口：对话气泡 office 卡片「预览」按钮 / 直达路由 /office-doc/:id
 * 红线：只读展示，不提供任何编辑入口；下载走带认证的 blob 接口
 */
export default function OfficeDocPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [doc, setDoc] = useState<OfficeDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const d = await unwrap<OfficeDoc>(api.get(`/chat/office-docs/${id}`))
      setDoc(d)
    } catch (err) {
      setError((err as Error).message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const handleDownload = async (format: 'md' | 'txt') => {
    if (!doc) return
    setDownloading(format)
    try {
      await downloadOfficeDoc(doc.id, format, doc.title)
    } catch (err) {
      setError((err as Error).message || '下载失败')
    } finally {
      setDownloading('')
    }
  }

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-3xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏：返回主页 + 标题 + 操作 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
              title="返回主页"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2 truncate">
                <FileText size={20} className="text-emerald-500 flex-shrink-0" />
                <span className="truncate">{doc ? doc.title : '文档'}</span>
              </h1>
              {doc && (
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {doc.meta.basedOn ? `基于 ${doc.meta.basedOn} · 原件未动 · ` : ''}
                  v{doc.meta.version} · {doc.meta.charCount} 字 · {new Date(doc.meta.createdAt).toLocaleString('zh-CN')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => load()}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
              title="刷新"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
            </button>
          </div>
        </div>

        {/* 改写指令溯源 */}
        {doc?.meta.instruction && (
          <div className="card p-4 mb-4 bg-gradient-to-br from-emerald-50 via-white to-teal-50">
            <div className="text-xs font-medium text-gray-500 mb-1.5">当时的指令</div>
            <p className="text-sm text-gray-600 leading-relaxed">{doc.meta.instruction}</p>
          </div>
        )}

        {loading && !doc && (
          <div className="card p-10 text-center text-sm text-gray-400">正在取文档…</div>
        )}
        {error && <div className="card p-6 text-center text-sm text-red-400">{error}</div>}

        {/* 正文（Markdown 渲染，只读） */}
        {doc && (
          <div className="card p-5 mb-4">
            <div
              className="office-doc-rich text-sm text-gray-700 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: mdToHtml(doc.content) }}
            />
          </div>
        )}

        {/* 下载操作 */}
        {doc && (
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => handleDownload('md')}
              disabled={!!downloading}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              <Download size={15} /> {downloading === 'md' ? '下载中…' : '下载 Markdown'}
            </button>
            <button
              onClick={() => handleDownload('txt')}
              disabled={!!downloading}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <FileCode2 size={15} /> {downloading === 'txt' ? '下载中…' : '下载纯文本'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 转义 HTML，防注入（先转义再拼标签） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 行内标记：code / 加粗 / 斜体 */
function renderInline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 mx-0.5 rounded bg-gray-100 text-emerald-600 text-[12px]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

/**
 * 轻量 Markdown → HTML（无第三方依赖）
 * 支持：代码块 / 标题 / 引用 / 无序有序列表 / 分割线 / 段落
 * 输入先整体转义，再拼安全标签，无 XSS 面
 */
function mdToHtml(md: string): string {
  const lines = escapeHtml(md).split('\n')
  const out: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let inCode = false
  let codeBuf: string[] = []
  let paraBuf: string[] = []

  const flushPara = () => {
    if (paraBuf.length) {
      out.push(`<p>${renderInline(paraBuf.join(' '))}</p>`)
      paraBuf = []
    }
  }
  const flushList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    // 代码块围栏
    if (/^```/.test(line.trim())) {
      if (inCode) {
        out.push(`<pre class="my-2 p-3 rounded-lg bg-gray-900 text-gray-100 text-[12px] overflow-x-auto"><code>${codeBuf.join('\n')}</code></pre>`)
        codeBuf = []
        inCode = false
      } else {
        flushPara()
        flushList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(raw)
      continue
    }
    // 空行：结束段落/列表
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flushPara()
      flushList()
      const level = h[1].length
      const size = ['text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm', 'text-sm'][level - 1]
      out.push(`<h${level} class="${size} font-bold text-gray-800 mt-4 mb-2 ${out.length ? '' : 'mt-0'}">${renderInline(h[2])}</h${level}>`)
      continue
    }
    // 分割线
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara()
      flushList()
      out.push('<hr class="my-4 border-gray-100" />')
      continue
    }
    // 引用
    const q = line.match(/^&gt;\s?(.*)$/)
    if (q) {
      flushPara()
      flushList()
      out.push(`<blockquote class="my-2 pl-3 border-l-[3px] border-emerald-200 text-gray-500">${renderInline(q[1])}</blockquote>`)
      continue
    }
    // 无序列表
    const ul = line.match(/^[-*]\s+(.*)$/)
    if (ul) {
      flushPara()
      if (listType !== 'ul') {
        flushList()
        out.push('<ul class="my-2 pl-5 list-disc list-outside space-y-1">')
        listType = 'ul'
      }
      out.push(`<li>${renderInline(ul[1])}</li>`)
      continue
    }
    // 有序列表
    const ol = line.match(/^\d+[.、]\s+(.*)$/)
    if (ol) {
      flushPara()
      if (listType !== 'ol') {
        flushList()
        out.push('<ol class="my-2 pl-5 list-decimal list-outside space-y-1">')
        listType = 'ol'
      }
      out.push(`<li>${renderInline(ol[1])}</li>`)
      continue
    }
    // 普通文本 → 段落累积
    flushList()
    paraBuf.push(line.trim())
  }
  // 收尾
  if (inCode && codeBuf.length) {
    out.push(`<pre class="my-2 p-3 rounded-lg bg-gray-900 text-gray-100 text-[12px] overflow-x-auto"><code>${codeBuf.join('\n')}</code></pre>`)
  }
  flushPara()
  flushList()
  return out.join('\n')
}
