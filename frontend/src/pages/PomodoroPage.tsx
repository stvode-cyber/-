import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Play, Pause, RotateCcw, SkipForward, Settings2, X, Timer, Coffee, Volume2, VolumeX,
} from 'lucide-react'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'
import {
  type PomodoroSettings,
  loadPomodoroSettings, savePomodoroSettings,
  recordSession, getTodayStat, getRecentStats, getOverview, formatMin,
} from '../lib/pomodoroStore'

type Phase = 'focus' | 'short' | 'long'

const PHASE_META: Record<Phase, { label: string; color: string; bg: string }> = {
  focus: { label: '专注', color: 'text-rose-600', bg: 'from-rose-500 to-rose-600' },
  short: { label: '短休', color: 'text-emerald-600', bg: 'from-emerald-500 to-emerald-600' },
  long: { label: '长休', color: 'text-sky-600', bg: 'from-sky-500 to-sky-600' },
}

/** 用 Web Audio API 生成一声短促的提示音（无需音频文件） */
function playBeep() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g)
    g.connect(ctx.destination)
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
    o.start()
    o.stop(ctx.currentTime + 0.5)
  } catch {
    /* 静默失败：浏览器策略阻止音频 */
  }
}

export default function PomodoroPage() {
  const toast = useToast((s) => s.show)
  const [settings, setSettings] = useState<PomodoroSettings>(() => loadPomodoroSettings())
  const [phase, setPhase] = useState<Phase>('focus')
  const [running, setRunning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(settings.focusMin * 60)
  const [completedFocus, setCompletedFocus] = useState(0) // 当前循环内已完成的专注次数
  const [showSettings, setShowSettings] = useState(false)
  const [todayStat, setTodayStat] = useState(() => getTodayStat())
  const [recent, setRecent] = useState(() => getRecentStats(7))
  const [overview, setOverview] = useState(() => getOverview())
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const completedRef = useRef(completedFocus)
  completedRef.current = completedFocus
  const startTsRef = useRef<number | null>(null)
  const totalSecondsRef = useRef(settings.focusMin * 60)

  // 时长由 phase + settings 决定
  const phaseSeconds = useCallback((p: Phase, s: PomodoroSettings): number => {
    if (p === 'focus') return s.focusMin * 60
    if (p === 'short') return s.shortBreakMin * 60
    return s.longBreakMin * 60
  }, [])

  // 切换 phase 时重置秒数
  useEffect(() => {
    setSecondsLeft(phaseSeconds(phase, settings))
    totalSecondsRef.current = phaseSeconds(phase, settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, settings.focusMin, settings.shortBreakMin, settings.longBreakMin])

  // 倒计时：仅递减秒数，不在 updater 内触发副作用
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running])

  // 倒计时归零时触发 phase 切换（避免在 state updater 内调用副作用）
  useEffect(() => {
    if (running && secondsLeft === 0) {
      handlePhaseEnd()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, running])

  const refreshStats = useCallback(() => {
    setTodayStat(getTodayStat())
    setRecent(getRecentStats(7))
    setOverview(getOverview())
  }, [])

  const handlePhaseEnd = useCallback(() => {
    const s = settingsRef.current
    if (s.soundEnabled) playBeep()
    if (phaseRef.current === 'focus') {
      // 记录一次完成的专注
      recordSession(s.focusMin, true)
      refreshStats()
      const nextCount = completedRef.current + 1
      setCompletedFocus(nextCount)
      // 进入长休或短休
      const nextPhase: Phase = nextCount % s.longBreakInterval === 0 ? 'long' : 'short'
      const nextSecs = phaseSeconds(nextPhase, s)
      setPhase(nextPhase)
      setSecondsLeft(nextSecs) // 同步重置，防止 secondsLeft===0 效应重复触发
      totalSecondsRef.current = nextSecs
      toast(`完成一次专注！进入${nextPhase === 'long' ? '长休' : '短休'}`, 'success')
      setRunning(s.autoStartBreak)
    } else {
      // 休息结束
      const nextSecs = phaseSeconds('focus', s)
      setPhase('focus')
      setSecondsLeft(nextSecs)
      totalSecondsRef.current = nextSecs
      toast('休息结束，开始新一轮专注', 'info')
      setRunning(s.autoStartFocus)
    }
  }, [refreshStats, toast, phaseSeconds])

  const start = () => {
    if (!running) {
      startTsRef.current = Date.now()
      setRunning(true)
    }
  }
  const pause = () => {
    setRunning(false)
    startTsRef.current = null
  }
  const reset = () => {
    setRunning(false)
    setSecondsLeft(phaseSeconds(phase, settings))
    startTsRef.current = null
  }
  /** 跳过当前 phase：专注跳过不记录，休息跳过直接进入专注 */
  const skip = () => {
    setRunning(false)
    if (phase === 'focus') {
      // 中断专注：记录但不完成
      const elapsedMin = Math.floor((totalSecondsRef.current - secondsLeft) / 60)
      if (elapsedMin > 0) recordSession(elapsedMin, false)
      const nextCount = completedRef.current + 1
      setCompletedFocus(nextCount)
      const nextPhase: Phase = nextCount % settings.longBreakInterval === 0 ? 'long' : 'short'
      const nextSecs = phaseSeconds(nextPhase, settings)
      setPhase(nextPhase)
      setSecondsLeft(nextSecs)
      totalSecondsRef.current = nextSecs
    } else {
      const nextSecs = phaseSeconds('focus', settings)
      setPhase('focus')
      setSecondsLeft(nextSecs)
      totalSecondsRef.current = nextSecs
    }
    refreshStats()
  }

  const applySettings = (patch: Partial<PomodoroSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    savePomodoroSettings(next)
    if (!running) setSecondsLeft(phaseSeconds(phase, next))
  }

  // 进度环
  const total = totalSecondsRef.current || 1
  const progress = 1 - secondsLeft / total
  const radius = 110
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - progress)

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const ss = String(secondsLeft % 60).padStart(2, '0')

  const meta = PHASE_META[phase]
  const maxRecent = Math.max(...recent.map((r) => r.focusMinutes), 60)

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'min-h-screen bg-panel-100'}>
      <div className={isDesktop() ? 'max-w-3xl mx-auto' : 'app-shell p-4 pb-8'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-accent-800 flex items-center gap-2">
              <Timer size={22} className="text-rose-500" /> 番茄钟
            </h1>
            <p className="text-xs text-accent-400 mt-1">
              专注 {settings.focusMin} 分钟 · 短休 {settings.shortBreakMin} 分钟 · 长休 {settings.longBreakMin} 分钟
            </p>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg border border-gray-200 bg-white text-accent-700 hover:bg-gray-50"
            title="设置"
          >
            <Settings2 size={18} />
          </button>
        </div>

        {/* 计时器卡片 */}
        <div className="card p-8 mb-4">
          {/* Phase 切换 */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {(['focus', 'short', 'long'] as Phase[]).map((p) => (
              <button
                key={p}
                onClick={() => { if (!running) { setPhase(p); setSecondsLeft(phaseSeconds(p, settings)) } }}
                disabled={running}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  phase === p ? `bg-gradient-to-r ${PHASE_META[p].bg} text-white` : 'bg-gray-100 text-accent-500 hover:bg-gray-200'
                } ${running ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {p === 'focus' && <Timer size={11} className="inline mr-1" />}
                {p === 'short' && <Coffee size={11} className="inline mr-1" />}
                {p === 'long' && <Coffee size={11} className="inline mr-1" />}
                {PHASE_META[p].label}
              </button>
            ))}
          </div>

          {/* 圆形进度 */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <svg width="240" height="240" className="-rotate-90">
                <circle cx="120" cy="120" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="12" />
                <circle
                  cx="120" cy="120" r={radius} fill="none"
                  stroke={phase === 'focus' ? '#F43F5E' : phase === 'short' ? '#10B981' : '#0EA5E9'}
                  strokeWidth="12" strokeLinecap="round"
                  strokeDasharray={circumference} strokeDashoffset={offset}
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-5xl font-bold tabular-nums text-accent-800">{mm}:{ss}</div>
                <div className={`text-sm mt-1 ${meta.color}`}>{meta.label}{running ? '中' : ''}</div>
                {phase === 'focus' && completedFocus > 0 && (
                  <div className="text-[11px] text-accent-400 mt-1">本轮已完成 {completedFocus} 次</div>
                )}
              </div>
            </div>
          </div>

          {/* 控制按钮 */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={reset}
              className="w-11 h-11 rounded-full border border-gray-200 bg-white text-accent-500 hover:bg-gray-50 flex items-center justify-center"
              title="重置"
            >
              <RotateCcw size={18} />
            </button>
            <button
              onClick={() => (running ? pause() : start())}
              className={`w-16 h-16 rounded-full bg-gradient-to-br ${meta.bg} text-white shadow-lg hover:shadow-xl flex items-center justify-center transition`}
              title={running ? '暂停' : '开始'}
            >
              {running ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
            </button>
            <button
              onClick={skip}
              className="w-11 h-11 rounded-full border border-gray-200 bg-white text-accent-500 hover:bg-gray-50 flex items-center justify-center"
              title="跳过"
            >
              <SkipForward size={18} />
            </button>
          </div>
        </div>

        {/* 今日 + 总览 */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="card p-3 text-center">
            <div className="text-lg font-bold text-rose-600">{todayStat.sessions}</div>
            <div className="text-[10px] text-accent-400 mt-0.5">今日番茄</div>
          </div>
          <div className="card p-3 text-center">
            <div className="text-lg font-bold text-emerald-600">{formatMin(todayStat.focusMinutes)}</div>
            <div className="text-[10px] text-accent-400 mt-0.5">今日专注</div>
          </div>
          <div className="card p-3 text-center">
            <div className="text-lg font-bold text-amber-600">{overview.streak}</div>
            <div className="text-[10px] text-accent-400 mt-0.5">连续天数</div>
          </div>
        </div>

        {/* 近 7 天柱状图 */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-accent-700">近 7 天专注时长</span>
            <span className="text-xs text-accent-400">累计 {formatMin(overview.totalMinutes)} · {overview.totalSessions} 个番茄</span>
          </div>
          <div className="flex items-end justify-between gap-2 h-28">
            {recent.map((d) => {
              const h = Math.max(2, (d.focusMinutes / maxRecent) * 100)
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] text-accent-400 tabular-nums">{d.focusMinutes > 0 ? `${d.focusMinutes}m` : ''}</div>
                  <div className="w-full flex items-end justify-center" style={{ height: '70px' }}>
                    <div
                      className="w-full max-w-[28px] rounded-t bg-gradient-to-t from-rose-300 to-rose-500 transition-all"
                      style={{ height: `${h}%` }}
                      title={`${d.date}：${d.focusMinutes} 分钟 / ${d.sessions} 个`}
                    />
                  </div>
                  <div className="text-[9px] text-accent-400">{d.date.slice(5)}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowSettings(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full sm:w-96 rounded-t-2xl sm:rounded-2xl p-5 shadow-xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-sm">番茄钟设置</span>
              <button onClick={() => setShowSettings(false)} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
            </div>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-3">
                {([
                  { k: 'focusMin', label: '专注', min: 5, max: 90 },
                  { k: 'shortBreakMin', label: '短休', min: 1, max: 30 },
                  { k: 'longBreakMin', label: '长休', min: 5, max: 60 },
                ] as const).map((x) => (
                  <div key={x.k}>
                    <div className="text-xs text-accent-500 mb-1">{x.label}（分）</div>
                    <input
                      type="number" min={x.min} max={x.max} value={settings[x.k]}
                      onChange={(e) => {
                        const v = Math.min(x.max, Math.max(x.min, Number(e.target.value) || x.min))
                        applySettings({ [x.k]: v } as Partial<PomodoroSettings>)
                      }}
                      className="w-full px-2 py-1.5 text-center border border-gray-200 rounded-lg focus:border-primary-400 focus:outline-none tabular-nums"
                    />
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs text-accent-500 mb-1.5">长休间隔（每完成 N 次专注后长休）</div>
                <div className="flex gap-2">
                  {[2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n} onClick={() => applySettings({ longBreakInterval: n })}
                      className={`flex-1 py-1.5 rounded-lg border text-xs ${settings.longBreakInterval === n ? 'border-rose-500 text-rose-600 font-semibold' : 'opacity-60'}`}
                    >{n}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center justify-between">
                  <span className="text-accent-600">完成专注后自动开始休息</span>
                  <input type="checkbox" checked={settings.autoStartBreak} onChange={(e) => applySettings({ autoStartBreak: e.target.checked })} className="accent-rose-500" />
                </label>
                <label className="flex items-center justify-between">
                  <span className="text-accent-600">休息结束后自动开始专注</span>
                  <input type="checkbox" checked={settings.autoStartFocus} onChange={(e) => applySettings({ autoStartFocus: e.target.checked })} className="accent-rose-500" />
                </label>
                <label className="flex items-center justify-between">
                  <span className="text-accent-600 flex items-center gap-1">
                    {settings.soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />} 完成时声音提醒
                  </span>
                  <input type="checkbox" checked={settings.soundEnabled} onChange={(e) => applySettings({ soundEnabled: e.target.checked })} className="accent-rose-500" />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
