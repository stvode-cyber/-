import { useCallback, useEffect, useState } from 'react'
import { api, unwrap } from '../../lib/api'

/**
 * HomePage 数据获取 hook — 从 HomePage.tsx 抽离
 * 并行加载 5 个子源（home/today + daily-question + wellness-check + confusion-check + countdowns）
 * 每个子源静默失败不阻塞主数据（DG-05/DG-13/DG-15）
 *
 * 注意：HomeData / HomeTaskItem / HomeReminderItem 类型保留在 HomePage.tsx
 *       hook 只搬数据获取 + 交互函数，类型通过泛型参数传入
 */
export function useHomeData(
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void,
  confirm: (opts: { title: string; message: string; confirmText?: string; danger?: boolean }) => Promise<boolean>,
) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [hidingId, setHidingId] = useState<string | null>(null)
  const [detailEvent, setDetailEvent] = useState<any>(null)

  const [dailyQuestion, setDailyQuestion] = useState<{ question: string; topic: string; hint: string | null; date: string } | null>(null)
  const [dailyQuestionLoading, setDailyQuestionLoading] = useState(false)

  const [wellness, setWellness] = useState<{
    needCare: boolean
    level: 'gentle' | 'suggest' | 'urgent'
    title: string
    message: string
    suggestions: Array<{ label: string; desc: string; to?: string; emoji: string }>
    signals: string[]
  } | null>(null)
  const [wellnessDismissed, setWellnessDismissed] = useState(false)

  const [confusion, setConfusion] = useState<{
    needGuide: boolean
    level: 'light' | 'moderate' | 'deep'
    title: string
    message: string
    guideActions: Array<{ label: string; desc: string; to?: string; emoji: string }>
    signals: string[]
  } | null>(null)
  const [confusionDismissed, setConfusionDismissed] = useState(false)

  const [countdownCards, setCountdownCards] = useState<Array<{
    id: string; type: string; title: string; targetDate: string | null
    recurringConfig: { nextTrigger?: string; pattern?: string; countdownStartAt?: string } | null
    remainingDays: number | null; remainingHours: number | null
    isPinned: boolean; isImportant: boolean; progress: number; status: string
  }>>([])

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const [res] = await Promise.all([
        unwrap<any>(api.get('/home/today')),
        (async () => { try { const dq = await unwrap<any>(api.get('/home/daily-question')); setDailyQuestion(dq) } catch {} })(),
        (async () => { try { const w = await unwrap<any>(api.get('/home/wellness-check')); setWellness(w); setWellnessDismissed(false) } catch {} })(),
        (async () => { try { const c = await unwrap<any>(api.get('/home/confusion-check')); setConfusion(c); setConfusionDismissed(false) } catch {} })(),
        (async () => {
          try {
            const cd = await unwrap<any>(api.get('/countdowns?status=active'))
            const getTargetTime = (c: any) => c.targetDate || c.recurringConfig?.nextTrigger
            const sorted = [...(cd.items || [])].sort((a: any, b: any) => {
              if (a.isImportant !== b.isImportant) return a.isImportant ? -1 : 1
              if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
              const at = getTargetTime(a) ? new Date(getTargetTime(a)!).getTime() : Number.MAX_SAFE_INTEGER
              const bt = getTargetTime(b) ? new Date(getTargetTime(b)!).getTime() : Number.MAX_SAFE_INTEGER
              return at - bt
            })
            setCountdownCards(sorted.slice(0, 3))
          } catch {}
        })(),
      ])
      setData(res)
    } catch (err) {
      setError(true); toast((err as Error).message, 'error')
    } finally { setLoading(false) }
  }, [toast])

  const refreshDailyQuestion = useCallback(async () => {
    setDailyQuestionLoading(true)
    try {
      const res = await unwrap<any>(api.get('/home/daily-question'))
      setDailyQuestion(res)
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setDailyQuestionLoading(false) }
  }, [toast])

  const hideEvent = useCallback(async (ev: any) => {
    const ok = await confirm({
      title: '隐藏事件', message: `将从事件总览中隐藏「${ev.title}」，可在事件管理页恢复。`,
      confirmText: '隐藏', danger: true,
    })
    if (!ok) return
    setHidingId(`${ev.type}-${ev.id}`)
    try {
      if (ev.type === 'manual') await unwrap(api.patch(`/manual-events/${ev.id}`, { hidden: true }))
      else await unwrap(api.post('/manual-events/hidden-auto', { sourceType: ev.type, sourceId: ev.id }))
      toast('已隐藏', 'success'); await load()
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setHidingId(null) }
  }, [confirm, load, toast])

  const openDetail = useCallback((ev: any) => setDetailEvent(ev), [])

  useEffect(() => { load() }, [load])

  return {
    // state
    data, loading, error, hidingId, detailEvent,
    dailyQuestion, dailyQuestionLoading,
    wellness, wellnessDismissed, setWellnessDismissed,
    confusion, confusionDismissed, setConfusionDismissed,
    countdownCards,
    // actions
    load, refreshDailyQuestion, hideEvent, openDetail, setDetailEvent,
  }
}
