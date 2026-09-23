import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Trash2, ChevronDown, ChevronUp, CheckSquare, AlertCircle } from 'lucide-react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { useConfirm } from '../components/ConfirmDialog'
import { formatDateTime } from '../lib/utils'
import { voiceMemoStatusMeta } from '../lib/constants'

/**
 * 录音纪要（与后端 VoiceMemoDTO 对齐）
 */
interface VoiceMemo {
  id: string
  title: string
  duration: number
  audioData?: string
  audioFormat: string
  transcript: string | null
  todoItems: string[]
  summary: string | null
  status: string
  errorMsg: string | null
  createdAt: string
  updatedAt: string
}

/**
 * 录音纪要列表页 · DG-10
 *
 * 功能：
 * 1. 列表展示：按创建时间倒序，每项显示标题、时长、状态徽章、摘要
 * 2. 展开/折叠：点击展开查看完整转写文本 + 待办列表
 * 3. 音频播放：展开时从 GET /voice-memos/:id 加载 audioData，<audio> 元素播放
 * 4. 手动重试提取：状态为 failed / transcribed 时支持 PATCH /:id/extract
 * 5. 删除：确认对话框，避免误操作
 * 6. 待办转任务：点击待办项跳转 /tasks?new=1 预填创建（携带 title）
 *
 * 数据来源：GET /voice-memos  /  GET /voice-memos/:id  /  PATCH /voice-memos/:id/extract  /  DELETE /voice-memos/:id
 */
export default function VoiceMemoListPage() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [items, setItems] = useState<VoiceMemo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // 当前播放录音 ID（用于互斥播放）
  const [playingId, setPlayingId] = useState<string | null>(null)
  // 重新提取中的录音 ID（防重复点击）
  const [extractingId, setExtractingId] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const list = await unwrap<VoiceMemo[]>(api.get('/voice-memos'))
      setItems(list)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /** 展开时按需加载 audioData（列表接口不返回，详情接口才返回） */
  const toggleExpand = async (item: VoiceMemo) => {
    if (expandedId === item.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(item.id)
    // 若列表项未带 audioData，从详情接口拉取（用于音频播放）
    if (!item.audioData) {
      try {
        const detail = await unwrap<VoiceMemo>(api.get(`/voice-memos/${item.id}`))
        setItems((prev) =>
          prev.map((m) => (m.id === item.id ? { ...m, audioData: detail.audioData } : m)),
        )
      } catch {
        // 静默失败：音频播放是辅助功能
      }
    }
  }

  /** 手动触发重新提取（用于 failed 状态或对结果不满意） */
  const reExtract = async (item: VoiceMemo) => {
    setExtractingId(item.id)
    try {
      const updated = await unwrap<VoiceMemo>(
        api.patch(`/voice-memos/${item.id}/extract`, {}),
      )
      setItems((prev) => prev.map((m) => (m.id === item.id ? updated : m)))
      toast('已重新提取纪要', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setExtractingId(null)
    }
  }

  /** 删除录音 */
  const remove = async (item: VoiceMemo) => {
    const ok = await confirm({
      title: '删除录音',
      message: `确定删除「${item.title}」吗？录音文件与转写纪要将一并删除，此操作不可撤销。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await unwrap(api.delete(`/voice-memos/${item.id}`))
      setItems((prev) => prev.filter((m) => m.id !== item.id))
      toast('已删除', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /** 待办项转任务：跳转 /tasks?new=1 携带预填 title */
  const todoToTask = (text: string) => {
    navigate('/tasks?new=1', { state: { prefillTitle: text } })
    toast('已为你预填任务标题，去完善详情', 'info')
  }

  /** 格式化时长（秒 → M分S秒） */
  const formatDuration = (sec: number): string => {
    if (!sec) return '0秒'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return m > 0 ? `${m}分${s}秒` : `${s}秒`
  }

  return (
    <div className="app-shell">
      <Header
        title="录音纪要"
        right={
          <button
            onClick={load}
            className="p-2 text-primary-600"
            aria-label="刷新"
            disabled={loading}
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      <div className="px-4 py-3 space-y-3">
        {/* 顶部提示条 */}
        <div className="text-xs text-gray-500 bg-blue-50 rounded-lg px-3 py-2 leading-relaxed flex items-center justify-between gap-2">
          <span>🎙️ 在对话页点击麦克风按钮录音，系统会自动转写并提取待办纪要。</span>
          <button
            onClick={() => navigate('/live-meeting')}
            className="flex-shrink-0 text-primary-600 hover:text-primary-700 font-medium"
          >
            实时纪要 →
          </button>
        </div>

        {/* 列表区域：三态渲染 */}
        {loading ? (
          <LoadingState skeleton count={2} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="🎙️"
            text="还没有录音纪要"
            hint="去对话页点击麦克风按钮，开始你的第一条录音纪要"
            action={
              <button
                onClick={() => navigate('/chat')}
                className="btn-primary text-sm"
              >
                去对话页
              </button>
            }
          />
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const meta = voiceMemoStatusMeta[item.status] || voiceMemoStatusMeta.uploaded
              const expanded = expandedId === item.id
              const isExtracting = extractingId === item.id
              return (
                <div
                  key={item.id}
                  className="card hover:shadow-md transition-shadow overflow-hidden"
                >
                  {/* 卡片头部 */}
                  <button
                    onClick={() => toggleExpand(item)}
                    className="w-full flex items-start gap-3 p-3 text-left"
                  >
                    {/* 状态图标 */}
                    <div className={`w-9 h-9 rounded-lg ${meta.color} flex items-center justify-center text-base flex-shrink-0`}>
                      {meta.emoji}
                    </div>

                    {/* 内容区 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color}`}>
                          {meta.label}
                        </span>
                        <span className="text-[10px] text-gray-400 ml-auto">
                          {formatDateTime(item.createdAt)}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                        <span>⏱️ {formatDuration(item.duration)}</span>
                        {item.todoItems.length > 0 && (
                          <span className="text-amber-600">
                            · {item.todoItems.length} 项待办
                          </span>
                        )}
                      </div>
                      {/* 摘要（仅展开时隐藏，避免重复） */}
                      {!expanded && item.summary && (
                        <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {item.summary}
                        </div>
                      )}
                    </div>

                    {/* 展开/折叠图标 */}
                    {expanded ? (
                      <ChevronUp size={16} className="text-gray-400 flex-shrink-0 mt-1" />
                    ) : (
                      <ChevronDown size={16} className="text-gray-400 flex-shrink-0 mt-1" />
                    )}
                  </button>

                  {/* 展开内容：音频 + 转写 + 待办 */}
                  {expanded && (
                    <div className="px-3 pb-3 space-y-3 border-t border-gray-50 pt-3">
                      {/* 失败提示 */}
                      {item.status === 'failed' && item.errorMsg && (
                        <div className="text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1.5 flex items-start gap-1.5">
                          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                          <span>{item.errorMsg}</span>
                        </div>
                      )}

                      {/* 音频播放器 */}
                      {item.audioData && (
                        <div>
                          <div className="text-[10px] text-gray-500 mb-1">原始录音</div>
                          <audio
                            controls
                            className="w-full h-8"
                            src={`data:${item.audioFormat};base64,${item.audioData}`}
                            onPlay={() => setPlayingId(item.id)}
                            onPause={() => playingId === item.id && setPlayingId(null)}
                          />
                        </div>
                      )}

                      {/* 摘要 */}
                      {item.summary && (
                        <div>
                          <div className="text-[10px] text-gray-500 mb-1">纪要摘要</div>
                          <div className="text-xs text-gray-700 bg-gray-50 rounded-lg px-2 py-1.5 leading-relaxed whitespace-pre-wrap break-words">
                            {item.summary}
                          </div>
                        </div>
                      )}

                      {/* 转写文本 */}
                      {item.transcript && (
                        <div>
                          <div className="text-[10px] text-gray-500 mb-1">转写文本</div>
                          <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-2 py-1.5 leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                            {item.transcript}
                          </div>
                        </div>
                      )}

                      {/* 待办列表（可点击转任务） */}
                      {item.todoItems.length > 0 && (
                        <div>
                          <div className="text-[10px] text-gray-500 mb-1">
                            待办事项 · 点击转任务
                          </div>
                          <div className="space-y-1">
                            {item.todoItems.map((todo, i) => (
                              <button
                                key={i}
                                onClick={() => todoToTask(todo)}
                                className="w-full flex items-start gap-2 text-left bg-amber-50 hover:bg-amber-100 rounded-lg px-2 py-1.5 transition-colors"
                              >
                                <CheckSquare size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                                <span className="text-xs text-gray-700 flex-1 leading-snug">
                                  {todo}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 操作按钮区 */}
                      <div className="flex gap-2 pt-1">
                        {/* 手动重新提取：仅 failed / transcribed / extracted 状态可用 */}
                        {(item.status === 'failed' ||
                          item.status === 'transcribed' ||
                          item.status === 'extracted') && (
                          <button
                            onClick={() => reExtract(item)}
                            disabled={isExtracting}
                            className="flex-1 text-xs py-1.5 text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            <RefreshCw size={12} className={isExtracting ? 'animate-spin' : ''} />
                            {isExtracting ? '提取中...' : '重新提取'}
                          </button>
                        )}
                        <button
                          onClick={() => remove(item)}
                          className="flex-1 text-xs py-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg flex items-center justify-center gap-1"
                        >
                          <Trash2 size={12} />
                          删除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
