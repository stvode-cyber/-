import { useCallback, useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, ShieldCheck, Eye, FileText, HardDrive, EyeOff,
  Trash2, Tag, Download, Loader2, ChevronDown, Fingerprint,
} from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { isDesktop } from '../lib/localCache'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

/** 理解开关四档 */
type PrivacyMode = 'full' | 'text' | 'local' | 'off'

const MODES: { value: PrivacyMode; label: string; desc: string; icon: typeof Eye }[] = [
  { value: 'full', label: '全开', desc: '聊到的偏好/习惯/情绪都默默记住，画像和周报靠这些变聪明', icon: Eye },
  { value: 'text', label: '仅文本', desc: '只记打字聊的内容，图片/文件里带的描述不入库', icon: FileText },
  { value: 'local', label: '仅本地', desc: '理解只在本地跑，不上云做深度理解', icon: HardDrive },
  { value: 'off', label: '关闭', desc: '只聊天+干活，什么都不再记（已记的可下面删）', icon: EyeOff },
]

const KIND_CHIPS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'preference', label: '偏好' },
  { value: 'habit', label: '习惯' },
  { value: 'entity', label: '人物' },
  { value: 'mood', label: '情绪' },
]

interface MemoryItem {
  id: string
  content: string
  kind: string
  tags: string[]
  sourceMsgId: string | null
  createdAt: string
}

/**
 * 隐私控制面板（P3）
 * 三块能力：理解开关四档 / 记忆撤销与改标签 / 一键导出（Markdown + JSON）
 * 入口：设置页「隐私与理解」 / 画像面板底部入口
 * 红线：仅管理理解管线写入的记忆（偏好/习惯/人物/情绪），系统缓存（周报/文档）不在此删
 */
export default function PrivacyPage() {
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()

  const [mode, setMode] = useState<PrivacyMode>('full')
  const [modeLoading, setModeLoading] = useState(true)
  const [savingMode, setSavingMode] = useState('')

  const [kind, setKind] = useState('')
  const [list, setList] = useState<MemoryItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [exporting, setExporting] = useState('')

  const loadMode = useCallback(async () => {
    try {
      const r = await unwrap<{ mode: PrivacyMode }>(api.get('/chat/privacy'))
      setMode(r.mode)
    } catch { /* 默认全开 */ } finally {
      setModeLoading(false)
    }
  }, [])

  const loadList = useCallback(async (k: string, cursor?: string | null) => {
    setListLoading(true)
    try {
      const r = await unwrap<{ list: MemoryItem[]; hasMore: boolean; nextCursor: string | null }>(
        api.get('/chat/fragments', { params: { ...(k ? { kind: k } : {}), limit: 20, ...(cursor ? { cursor } : {}) } }),
      )
      setList((prev) => (cursor ? [...prev, ...r.list] : r.list))
      setHasMore(r.hasMore)
      setNextCursor(r.nextCursor)
    } catch (err) {
      toast((err as Error).message || '记忆列表加载失败', 'error')
    } finally {
      setListLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadMode()
    loadList('')
  }, [loadMode, loadList])

  const switchMode = async (m: PrivacyMode) => {
    if (m === mode) return
    setSavingMode(m)
    try {
      await unwrap(api.put('/chat/privacy', { mode: m }))
      setMode(m)
      toast('已切换', 'success')
    } catch (err) {
      toast((err as Error).message || '切换失败', 'error')
    } finally {
      setSavingMode('')
    }
  }

  const switchKind = (k: string) => {
    if (k === kind) return
    setKind(k)
    setList([])
    setNextCursor(null)
    loadList(k)
  }

  const revoke = async (item: MemoryItem) => {
    const ok = await confirm({
      title: '撤销这条记忆',
      message: `「${item.content.slice(0, 40)}」删掉后我就不记得了，画像和周报也不再统计它。`,
      confirmText: '撤销',
      danger: true,
    })
    if (!ok) return
    try {
      await unwrap(api.delete(`/chat/fragments/${item.id}`))
      setList((prev) => prev.filter((x) => x.id !== item.id))
      toast('已撤销', 'success')
    } catch (err) {
      toast((err as Error).message || '撤销失败', 'error')
    }
  }

  const editTags = async (item: MemoryItem) => {
    const input = window.prompt('改标签（逗号分隔，最多 8 个）', item.tags.join(','))
    if (input === null) return
    const tags = input.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 8)
    if (!tags.length) {
      toast('至少留一个标签，不想要就直接撤销这条', 'error')
      return
    }
    try {
      await unwrap(api.patch(`/chat/fragments/${item.id}`, { tags }))
      setList((prev) => prev.map((x) => (x.id === item.id ? { ...x, tags } : x)))
      toast('标签改好了', 'success')
    } catch (err) {
      toast((err as Error).message || '改标签失败', 'error')
    }
  }

  const exportData = async (format: 'md' | 'json') => {
    setExporting(format)
    try {
      const blob = (await api.get('/chat/export', {
        params: { format },
        responseType: 'blob',
        timeout: 30000,
      })) as unknown as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `绿角犀-记忆导出-${new Date().toISOString().slice(0, 10)}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast((err as Error).message || '导出失败', 'error')
    } finally {
      setExporting('')
    }
  }

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-3xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏：返回主页 */}
        <div className="flex items-center gap-2 mb-5">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            title="返回主页"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <ShieldCheck size={20} className="text-primary-500" /> 隐私与理解
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">记忆归你管：开关、撤销、带走</p>
          </div>
        </div>

        {/* 理解开关四档 */}
        <div className="card p-4 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">理解开关</h2>
          {modeLoading ? (
            <div className="py-4 text-center text-xs text-gray-400">加载中…</div>
          ) : (
            <div className="space-y-2">
              {MODES.map((m) => {
                const active = mode === m.value
                const Icon = m.icon
                return (
                  <button
                    key={m.value}
                    onClick={() => switchMode(m.value)}
                    disabled={!!savingMode}
                    className={`w-full flex items-start gap-3 px-3.5 py-3 rounded-xl border text-left transition-colors ${
                      active
                        ? 'border-primary-300 bg-primary-50'
                        : 'border-gray-100 bg-white hover:border-gray-200'
                    } disabled:opacity-60`}
                  >
                    {savingMode === m.value ? (
                      <Loader2 size={18} className="text-primary-500 animate-spin mt-0.5 flex-shrink-0" />
                    ) : (
                      <Icon size={18} className={`mt-0.5 flex-shrink-0 ${active ? 'text-primary-500' : 'text-gray-400'}`} />
                    )}
                    <div className="min-w-0">
                      <div className={`text-sm font-medium ${active ? 'text-primary-600' : 'text-gray-700'}`}>
                        {m.label}{active && ' · 当前'}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 leading-relaxed">{m.desc}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 记忆管理：撤销 / 改标签 */}
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">我记下的（可撤销）</h2>
            <Link to="/profile-panel" className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-primary-500">
              <Fingerprint size={12} /> 看画像
            </Link>
          </div>
          {/* kind 筛选 */}
          <div className="flex gap-1.5 mb-3 overflow-x-auto">
            {KIND_CHIPS.map((c) => (
              <button
                key={c.value}
                onClick={() => switchKind(c.value)}
                className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors ${
                  kind === c.value ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {listLoading && !list.length ? (
            <div className="py-6 text-center text-xs text-gray-400">加载中…</div>
          ) : list.length ? (
            <>
              <div className="space-y-2">
                {list.map((item) => (
                  <div key={item.id} className="flex items-center gap-2.5 px-3 py-2.5 bg-gray-50 rounded-xl">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-700 leading-relaxed">{item.content}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {item.tags.map((t) => (
                          <span key={t} className="px-1.5 py-0.5 text-[10px] rounded bg-white border border-gray-200 text-gray-400">
                            {t}
                          </span>
                        ))}
                        <span className="text-[10px] text-gray-300">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => editTags(item)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-white hover:text-primary-500 flex-shrink-0"
                      title="改标签"
                    >
                      <Tag size={13} />
                    </button>
                    <button
                      onClick={() => revoke(item)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-white hover:text-rose-500 flex-shrink-0"
                      title="撤销这条记忆"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              {hasMore && (
                <button
                  onClick={() => loadList(kind, nextCursor)}
                  disabled={listLoading}
                  className="mt-3 mx-auto flex items-center gap-1 px-4 py-1.5 text-xs text-gray-500 bg-gray-100 rounded-full hover:bg-gray-200 disabled:opacity-50"
                >
                  {listLoading ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
                  加载更多
                </button>
              )}
            </>
          ) : (
            <p className="py-4 text-center text-xs text-gray-400">这个分类下还没有记忆</p>
          )}
        </div>

        {/* 一键导出 */}
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">带走我的数据</h2>
          <p className="text-xs text-gray-400 mb-3 leading-relaxed">
            导出记忆、账单、待办三块数据。Markdown 可直接丢进 Obsidian / Logseq / Notion。
          </p>
          <div className="flex gap-2.5">
            <button
              onClick={() => exportData('md')}
              disabled={!!exporting}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50"
            >
              {exporting === 'md' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {exporting === 'md' ? '导出中…' : '导出 Markdown'}
            </button>
            <button
              onClick={() => exportData('json')}
              disabled={!!exporting}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {exporting === 'json' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {exporting === 'json' ? '导出中…' : '导出 JSON'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
