import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { formatTime } from '../../lib/utils'
import { LoadingState, ErrorState } from '../StateView'
import { useToast } from '../Toast'
import { eventScopeMeta } from '../../lib/constants'
import { HomeData, EventDetail } from './homeTypes'
import { formatCountdown, repeatLabel, priorityLabel } from './HomeWidgets'

/**
 * EV-03 事件详情弹层
 * 独立文件（类似 ChatPage 的 MessageBubble），避免主文件膨胀。
 */
export default function EventDetailModal({
  event,
  onClose,
}: {
  event: HomeData['events'][number]
  onClose: () => void
}) {
  const toast = useToast((s) => s.show)
  const [detail, setDetail] = useState<EventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadDetail = async () => {
      setLoading(true)
      setError(false)
      try {
        const res = await unwrap<EventDetail>(
          api.get(`/manual-events/${event.id}/detail`, { params: { type: event.type } })
        )
        if (!cancelled) setDetail(res)
      } catch (err) {
        if (!cancelled) { setError(true); toast((err as Error).message, 'error') }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadDetail()
    return () => { cancelled = true }
  }, [event.id, event.type])

  const scopeMeta = eventScopeMeta[event.scope] || eventScopeMeta.life
  const typeLabel = event.type === 'manual' ? '手动事件' : event.type === 'task' ? '任务' : '提醒'
  const typeEmoji = event.type === 'manual' ? '📌' : event.type === 'task' ? '✅' : '🔔'

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white w-full max-w-[480px] mx-auto rounded-t-2xl p-5 animate-slide-up max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* 头部：来源标签 + 关闭 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">{typeEmoji}</span>
            <span className="text-xs text-gray-500">{typeLabel}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${scopeMeta.bg} ${scopeMeta.color}`}>
              {scopeMeta.emoji} {scopeMeta.label}
            </span>
            {event.manual && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">手动</span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
        </div>

        {/* 标题 */}
        <h3 className="text-lg font-semibold text-gray-800 mb-1">{event.title}</h3>

        {/* 倒计时 */}
        {detail && (
          <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs mb-3 ${
            formatCountdown(detail.countdown).status === 'ended' ? 'bg-gray-100 text-gray-500' :
            formatCountdown(detail.countdown).status === 'ongoing' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
          }`}>
            <span>⏰</span>
            <span>{formatCountdown(detail.countdown).text}</span>
            <span className="text-gray-400 ml-1">· {formatTime(detail.time)}</span>
          </div>
        )}

        {loading && <div className="py-8"><LoadingState text="加载事件详情..." /></div>}

        {error && (
          <div className="py-6">
            <ErrorState onRetry={() => {
              setLoading(true); setError(false)
              setTimeout(() => {
                api.get(`/manual-events/${event.id}/detail`, { params: { type: event.type } })
                  .then((res) => { setDetail((res as { data: EventDetail }).data) })
                  .catch((err) => { setError(true); toast((err as Error).message, 'error') })
                  .finally(() => setLoading(false))
              }, 50)
            }} />
          </div>
        )}

        {detail && !loading && !error && (
          <div className="space-y-3 text-sm">
            {detail.description && (
              <div>
                <div className="text-xs text-gray-500 mb-1">备注</div>
                <div className="text-gray-700 bg-gray-50 rounded-lg p-2 whitespace-pre-wrap">{detail.description}</div>
              </div>
            )}
            {detail.location && (
              <div className="flex items-center gap-2 text-gray-600">
                <MapPin size={14} className="text-gray-400" />
                <span>{detail.location}</span>
              </div>
            )}
            {detail.type === 'task' && (
              <div className="flex flex-wrap gap-2">
                {detail.priority && <span className="text-[11px] px-2 py-0.5 rounded bg-gray-50 text-gray-600">优先级：{priorityLabel[detail.priority] || detail.priority}</span>}
                {detail.important && <span className="text-[11px] px-2 py-0.5 rounded bg-rose-50 text-rose-600">⭐ 重要</span>}
                {typeof detail.progress === 'number' && <span className="text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-600">进度：{detail.progress}%</span>}
              </div>
            )}
            {detail.type === 'reminder' && (
              <div className="flex flex-wrap gap-2">
                {detail.level && <span className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-600">等级：{detail.level}</span>}
                {detail.repeat && <span className="text-[11px] px-2 py-0.5 rounded bg-gray-50 text-gray-600">重复：{repeatLabel[detail.repeat] || detail.repeat}</span>}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary flex-1">关闭</button>
        </div>
      </div>
    </div>
  )
}
