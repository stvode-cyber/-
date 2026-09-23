import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Music, Plus, Trash2, X, Heart, Play, Square, Clock, Save,
} from 'lucide-react'
import {
  SCENES, SCENE_MAP, listMixes, addMix, deleteMix, getTimerMin, setTimerMin, getStat,
  type SoundSceneId, type MixItem, type SavedMix,
} from '../lib/focusSoundStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 专注音景页
 *
 * 布局：
 * 1. 顶栏：标题 + 统计 + 定时器
 * 2. 主控区：播放/停止 + 总进度 + 剩余时间
 * 3. 8 个音景场景卡（点击切换激活，含音量滑块）
 * 4. 收藏混音快速应用
 * 5. 保存当前混音弹窗
 *
 * 音频生成：使用 Web Audio API 合成色噪声 + 调制，无需音频文件
 */

/** 一个音频源的运行时句柄 */
interface AudioSourceRuntime {
  gain: GainNode
  stop: () => void
}

/** 单场景的激活态 */
interface ActiveScene {
  volume: number
}

const TIMER_OPTIONS = [0, 15, 25, 30, 45, 60, 90]

export default function FocusSoundPage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const [active, setActive] = useState<Record<SoundSceneId, ActiveScene>>({
    rain: { volume: 0 }, ocean: { volume: 0 }, forest: { volume: 0 },
    fire: { volume: 0 }, wind: { volume: 0 }, cafe: { volume: 0 },
    night: { volume: 0 }, white: { volume: 0 },
  })
  const [playing, setPlaying] = useState(false)
  const [timerMin, setTimerMin] = useState(() => getTimerMin())
  const [remainingSec, setRemainingSec] = useState<number | null>(null)
  const [showSave, setShowSave] = useState(false)
  const [showTimer, setShowTimer] = useState(false)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<Map<SoundSceneId, AudioSourceRuntime>>(new Map())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const mixes = useMemo(() => listMixes(), [version])
  const stat = useMemo(() => getStat(), [version])

  const activeCount = useMemo(() => Object.values(active).filter((a) => a.volume > 0).length, [active])

  /** 创建并启动一个场景的音频源 */
  const startSource = useCallback((ctx: AudioContext, scene: SoundSceneId, volume: number) => {
    const dest = ctx.createGain()
    dest.gain.value = volume
    dest.connect(ctx.destination)

    const stop = createSceneAudio(ctx, scene, dest)
    sourcesRef.current.set(scene, { gain: dest, stop })
  }, [])

  /** 停止某场景 */
  const stopSource = useCallback((scene: SoundSceneId) => {
    const r = sourcesRef.current.get(scene)
    if (r) {
      try { r.stop() } catch { /* noop */ }
      try { r.gain.disconnect() } catch { /* noop */ }
      sourcesRef.current.delete(scene)
    }
  }, [])

  /** 停止全部 */
  const stopAll = useCallback(() => {
    sourcesRef.current.forEach((_, k) => stopSource(k))
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setRemainingSec(null)
    setPlaying(false)
  }, [stopSource])

  /** 启动播放 */
  const startPlaying = useCallback(async () => {
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext
        audioCtxRef.current = new Ctx()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') await ctx.resume()

      // 启动所有音量 > 0 的场景
      for (const scene of Object.keys(active) as SoundSceneId[]) {
        if (active[scene].volume > 0 && !sourcesRef.current.has(scene)) {
          startSource(ctx, scene, active[scene].volume)
        }
      }
      setPlaying(true)

      // 定时器
      if (timerMin > 0) {
        setRemainingSec(timerMin * 60)
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = setInterval(() => {
          setRemainingSec((prev) => {
            if (prev === null) return null
            if (prev <= 1) {
              stopAll()
              toast('定时结束，已自动停止', 'info')
              return null
            }
            return prev - 1
          })
        }, 1000)
      }
    } catch (e) {
      toast('音频启动失败：' + (e as Error).message, 'error')
    }
  }, [active, timerMin, startSource, stopAll, toast])

  const handlePlayPause = useCallback(() => {
    if (playing) {
      stopAll()
    } else {
      if (activeCount === 0) {
        toast('请先选择至少一个音景', 'info')
        return
      }
      startPlaying()
    }
  }, [playing, activeCount, stopAll, startPlaying, toast])

  /** 播放中：自动同步音频源与 active 状态（启动新增激活场景，停止取消的场景）
   *  作用：toggleScene/changeVolume/applyMix 修改 active 后，无需各自手动管理 source，
   *  此 effect 统一 reconcile。startPlaying 仅负责建 AudioContext + setPlaying(true)。 */
  useEffect(() => {
    if (!playing) return
    const ctx = audioCtxRef.current
    if (!ctx) return
    for (const scene of Object.keys(active) as SoundSceneId[]) {
      const vol = active[scene].volume
      if (vol > 0 && !sourcesRef.current.has(scene)) {
        startSource(ctx, scene, vol)
      } else if (vol === 0 && sourcesRef.current.has(scene)) {
        stopSource(scene)
      }
    }
  }, [playing, active, startSource, stopSource])

  /** 切换场景激活（默认音量 0.5）；未播放时点击即自动开始播放，符合"点 rain 即出雨声"直觉 */
  const toggleScene = useCallback((scene: SoundSceneId) => {
    const wasActive = active[scene].volume > 0
    setActive((prev) => {
      const next = { ...prev }
      if (next[scene].volume > 0) {
        next[scene] = { volume: 0 }
        if (playing) stopSource(scene)
      } else {
        next[scene] = { volume: 0.5 }
        if (playing && audioCtxRef.current) {
          startSource(audioCtxRef.current, scene, 0.5)
        }
      }
      return next
    })
    // 新激活且当前未播放 → 自动开始播放；startPlaying 用旧 active 闭包不会启动本场景，
    // 但 setPlaying(true) 后上方 effect 会基于新 active 启动该场景 source
    if (!wasActive && !playing) {
      startPlaying()
    }
  }, [active, playing, startSource, stopSource, startPlaying])

  /** 调整音量 */
  const changeVolume = useCallback((scene: SoundSceneId, volume: number) => {
    setActive((prev) => ({ ...prev, [scene]: { volume } }))
    const r = sourcesRef.current.get(scene)
    if (r && audioCtxRef.current) {
      r.gain.gain.setValueAtTime(volume, audioCtxRef.current.currentTime)
    }
  }, [])

  /** 应用收藏的混音 */
  const applyMix = useCallback((mix: SavedMix) => {
    stopAll()
    const next = { ...active }
    ;(Object.keys(next) as SoundSceneId[]).forEach((k) => { next[k] = { volume: 0 } })
    mix.items.forEach((it) => {
      next[it.scene] = { volume: it.volume }
    })
    setActive(next)
    toast(`已应用混音「${mix.name}」`, 'success')
    setTimeout(() => startPlaying(), 50)
  }, [active, stopAll, startPlaying, toast])

  const handleSaveMix = useCallback((name: string) => {
    const items: MixItem[] = (Object.keys(active) as SoundSceneId[])
      .map((scene) => ({ scene, volume: active[scene].volume }))
      .filter((i) => i.volume > 0)
    if (items.length === 0) {
      toast('请先选择至少一个音景', 'info')
      return
    }
    addMix(name, items)
    toast('混音已保存 ❤️', 'success')
    setShowSave(false)
    refresh()
  }, [active, toast, refresh])

  const handleDeleteMix = useCallback((id: string) => {
    deleteMix(id)
    toast('已删除混音', 'info')
    refresh()
  }, [toast, refresh])

  const handleTimerChange = useCallback((min: number) => {
    setTimerMin(min)
    setTimerMinStore(min)
    setShowTimer(false)
    if (playing) {
      // 重启定时器
      if (timerRef.current) clearInterval(timerRef.current)
      if (min > 0) {
        setRemainingSec(min * 60)
        timerRef.current = setInterval(() => {
          setRemainingSec((prev) => {
            if (prev === null) return null
            if (prev <= 1) {
              stopAll()
              toast('定时结束，已自动停止', 'info')
              return null
            }
            return prev - 1
          })
        }, 1000)
      } else {
        setRemainingSec(null)
      }
    }
  }, [playing, stopAll, toast])

  // 卸载时清理
  useEffect(() => {
    return () => {
      sourcesRef.current.forEach((r) => { try { r.stop() } catch { /* noop */ } })
      if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch { /* noop */ } }
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Music size={22} className="text-violet-500" /> 专注音景
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {SCENES.length} 个场景 · {stat.mixes} 个收藏混音 · 离线合成，无需联网
            </p>
          </div>
          <button
            onClick={() => setShowTimer(true)}
            className="px-3 py-2 rounded-lg bg-violet-50 text-violet-600 text-sm font-medium hover:bg-violet-100 active:scale-95 transition-all flex items-center gap-1"
          >
            <Clock size={15} /> {timerMin > 0 ? `${timerMin}分` : '定时'}
          </button>
        </div>

        {/* 主控区 */}
        <div
          className="rounded-2xl p-6 mb-4 relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #8B5CF615 0%, #8B5CF605 100%)',
            border: '1px solid #8B5CF620',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500 mb-1">
                {playing ? `正在播放 · ${activeCount} 个音源` : '已暂停'}
              </div>
              <div className="text-2xl font-bold text-gray-800 tabular-nums">
                {remainingSec !== null ? fmtTime(remainingSec) : (timerMin > 0 ? `${timerMin}:00` : '--:--')}
              </div>
              {remainingSec !== null && (
                <div className="mt-1.5 h-1 bg-violet-100 rounded-full overflow-hidden w-48">
                  <div
                    className="h-full bg-violet-500 transition-all"
                    style={{ width: `${(1 - remainingSec / (timerMin * 60)) * 100}%` }}
                  />
                </div>
              )}
            </div>
            <button
              onClick={handlePlayPause}
              disabled={activeCount === 0}
              className={`w-16 h-16 rounded-full flex items-center justify-center text-white transition-all active:scale-95 ${
                playing ? 'bg-rose-500 hover:bg-rose-600' : 'bg-violet-500 hover:bg-violet-600'
              } disabled:opacity-30`}
            >
              {playing ? <Square size={22} /> : <Play size={22} className="ml-1" />}
            </button>
          </div>
        </div>

        {/* 音景场景网格 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          {SCENES.map((scene) => {
            const isActive = active[scene.id].volume > 0
            return (
              <div
                key={scene.id}
                onClick={() => toggleScene(scene.id)}
                className={`rounded-xl p-3 cursor-pointer transition-all border-2 ${
                  isActive ? 'border-violet-400 bg-violet-50' : 'border-gray-100 bg-white hover:border-gray-200'
                }`}
              >
                <div className="text-2xl mb-1">{scene.emoji}</div>
                <div className={`text-xs font-semibold ${isActive ? 'text-violet-600' : 'text-gray-700'}`}>{scene.label}</div>
                <div className="text-[10px] text-gray-400 leading-tight mt-0.5 h-6">{scene.description}</div>
                {isActive && (
                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={active[scene.id].volume}
                      onChange={(e) => changeVolume(scene.id, parseFloat(e.target.value))}
                      className="w-full accent-violet-500"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 收藏混音 */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <Heart size={15} className="text-rose-500" /> 收藏混音
          </h3>
          <button
            onClick={() => setShowSave(true)}
            disabled={activeCount === 0}
            className="text-xs text-violet-600 flex items-center gap-1 disabled:opacity-30"
          >
            <Save size={13} /> 保存当前
          </button>
        </div>

        {mixes.length === 0 ? (
          <div className="card p-6 text-center">
            <div className="text-2xl mb-1.5">🎵</div>
            <p className="text-xs text-gray-400">还没有收藏混音，调配好后保存吧</p>
          </div>
        ) : (
          <div className="space-y-2">
            {mixes.map((mix) => (
              <div
                key={mix.id}
                className="card p-3 flex items-center gap-3 hover:shadow-md transition-shadow"
              >
                <div className="flex -space-x-1">
                  {mix.items.slice(0, 5).map((it, i) => (
                    <div
                      key={i}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-sm border-2 border-white"
                      style={{ background: SCENE_MAP[it.scene].color + '20' }}
                      title={SCENE_MAP[it.scene].label}
                    >
                      {SCENE_MAP[it.scene].emoji}
                    </div>
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-700 truncate">{mix.name}</div>
                  <div className="text-[10px] text-gray-400">{mix.items.length} 个音源</div>
                </div>
                <button
                  onClick={() => applyMix(mix)}
                  className="px-3 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-medium hover:bg-violet-600"
                >
                  播放
                </button>
                <button
                  onClick={() => handleDeleteMix(mix.id)}
                  className="p-1.5 rounded text-gray-300 hover:text-rose-500 hover:bg-rose-50"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showSave && (
        <SaveMixModal onClose={() => setShowSave(false)} onSave={handleSaveMix} active={active} />
      )}
      {showTimer && (
        <TimerModal
          current={timerMin}
          onClose={() => setShowTimer(false)}
          onSelect={handleTimerChange}
        />
      )}
    </div>
  )
}

// ===== 保存混音弹窗 =====

function SaveMixModal({ onClose, onSave, active }: {
  onClose: () => void
  onSave: (name: string) => void
  active: Record<SoundSceneId, ActiveScene>
}) {
  const [name, setName] = useState('')
  const activeScenes = (Object.keys(active) as SoundSceneId[]).filter((s) => active[s].volume > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-1.5">
            <Save size={15} className="text-violet-500" /> 保存混音
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {activeScenes.map((s) => (
              <span key={s} className="text-xs px-2 py-1 rounded-full bg-violet-50 text-violet-600">
                {SCENE_MAP[s].emoji} {SCENE_MAP[s].label}
              </span>
            ))}
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-2 block">混音名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              placeholder="如：清晨森林 + 雨声"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-violet-400"
              autoFocus
            />
          </div>
        </div>

        <div className="border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={() => onSave(name.trim() || '我的混音')}
            className="flex-1 py-2.5 text-sm rounded-lg bg-violet-500 text-white hover:bg-violet-600"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 定时器弹窗 =====

function TimerModal({ current, onClose, onSelect }: {
  current: number
  onClose: () => void
  onSelect: (min: number) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-xs rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-1.5">
            <Clock size={15} className="text-violet-500" /> 定时停止
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 grid grid-cols-2 gap-2">
          {TIMER_OPTIONS.map((min) => (
            <button
              key={min}
              onClick={() => onSelect(min)}
              className={`py-3 rounded-lg text-sm font-medium border-2 transition ${
                current === min
                  ? 'border-violet-400 bg-violet-50 text-violet-600'
                  : 'border-gray-100 text-gray-600 hover:border-gray-200'
              }`}
            >
              {min === 0 ? '不定时' : `${min} 分钟`}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ===== Web Audio 合成 =====

/** 为指定场景生成持续音频 */
function createSceneAudio(ctx: AudioContext, scene: SoundSceneId, dest: AudioNode): () => void {
  switch (scene) {
    case 'white':
      return createNoiseSource(ctx, 'white', dest, 0.15)
    case 'rain':
      return createRain(ctx, dest)
    case 'ocean':
      return createOcean(ctx, dest)
    case 'forest':
      return createForest(ctx, dest)
    case 'fire':
      return createFire(ctx, dest)
    case 'wind':
      return createWind(ctx, dest)
    case 'cafe':
      return createCafe(ctx, dest)
    case 'night':
      return createNight(ctx, dest)
    default:
      return createNoiseSource(ctx, 'white', dest, 0.1)
  }
}

/** 生成色噪声 buffer（white/pink/brown） */
function createNoiseBuffer(ctx: AudioContext, type: 'white' | 'pink' | 'brown', durationSec = 2): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const length = sampleRate * durationSec
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)

  if (type === 'white') {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  } else if (type === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.95000 * b3 + w * 0.3104856
      b4 = 0.85000 * b4 + w * 0.5329522
      b5 = 0.62000 * b5 + w * 0.6913060
      b6 = 0.25000 * b6 + w * 1.0267751
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.2) * 0.11
    }
  } else {
    // brown
    let last = 0
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.02 * w) / 1.02
      data[i] = last * 3.5
    }
  }
  return buffer
}

/** 基础噪声源（loop） */
function createNoiseSource(ctx: AudioContext, type: 'white' | 'pink' | 'brown', dest: AudioNode, gain: number): () => void {
  const buf = createNoiseBuffer(ctx, type, 4)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(g)
  g.connect(dest)
  src.start()
  return () => { try { src.stop() } catch { /* noop */ } }
}

/** 雨声：高频白噪 + 偶尔滴答 */
function createRain(ctx: AudioContext, dest: AudioNode): () => void {
  const stops: (() => void)[] = []

  // 高频白噪主体
  const buf = createNoiseBuffer(ctx, 'white', 4)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1800
  filter.Q.value = 0.5
  const g = ctx.createGain()
  g.gain.value = 0.25
  src.connect(filter)
  filter.connect(g)
  g.connect(dest)
  src.start()
  stops.push(() => { try { src.stop() } catch { /* noop */ } })

  // 低频底噪
  const buf2 = createNoiseBuffer(ctx, 'brown', 4)
  const src2 = ctx.createBufferSource()
  src2.buffer = buf2
  src2.loop = true
  const g2 = ctx.createGain()
  g2.gain.value = 0.1
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 600
  src2.connect(lp)
  lp.connect(g2)
  g2.connect(dest)
  src2.start()
  stops.push(() => { try { src2.stop() } catch { /* noop */ } })

  // 调制（模拟雨势强弱）
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.15
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 0.05
  lfo.connect(lfoGain)
  lfoGain.connect(g.gain)
  lfo.start()
  stops.push(() => { try { lfo.stop() } catch { /* noop */ } })

  return () => stops.forEach((s) => s())
}

/** 海浪：棕色噪声 + 慢调制 */
function createOcean(ctx: AudioContext, dest: AudioNode): () => void {
  const stops: (() => void)[] = []
  const buf = createNoiseBuffer(ctx, 'brown', 6)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 800
  const g = ctx.createGain()
  g.gain.value = 0.3
  src.connect(lp)
  lp.connect(g)
  g.connect(dest)
  src.start()
  stops.push(() => { try { src.stop() } catch { /* noop */ } })

  // 慢调制（模拟潮汐）
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.08
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 0.2
  lfo.connect(lfoGain)
  lfoGain.connect(g.gain)
  lfo.start()
  stops.push(() => { try { lfo.stop() } catch { /* noop */ } })

  return () => stops.forEach((s) => s())
}

/** 森林：棕色底 + 偶尔鸟鸣（短促正弦扫频） */
function createForest(ctx: AudioContext, dest: AudioNode): () => void {
  const stops: (() => void)[] = []
  let cancelled = false

  // 底噪（风）
  const buf = createNoiseBuffer(ctx, 'pink', 4)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 500
  const g = ctx.createGain()
  g.gain.value = 0.15
  src.connect(lp)
  lp.connect(g)
  g.connect(dest)
  src.start()
  stops.push(() => { try { src.stop() } catch { /* noop */ } })

  // 鸟鸣（随机播放）
  const chirp = () => {
    if (cancelled) return
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    const baseFreq = 1500 + Math.random() * 2500
    const g3 = ctx.createGain()
    g3.gain.value = 0
    osc.connect(g3)
    g3.connect(dest)
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(baseFreq, t)
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.4, t + 0.05)
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, t + 0.12)
    g3.gain.linearRampToValueAtTime(0.08, t + 0.02)
    g3.gain.linearRampToValueAtTime(0, t + 0.15)
    osc.start(t)
    osc.stop(t + 0.2)
    // 下一只鸟
    const delay = 1500 + Math.random() * 4000
    setTimeout(chirp, delay)
  }
  setTimeout(chirp, 800)

  return () => {
    cancelled = true
    stops.forEach((s) => s())
  }
}

/** 篝火：棕色底 + 偶尔爆裂（短脉冲） */
function createFire(ctx: AudioContext, dest: AudioNode): () => void {
  const stops: (() => void)[] = []
  let cancelled = false

  // 棕色底噪
  const buf = createNoiseBuffer(ctx, 'brown', 4)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1000
  const g = ctx.createGain()
  g.gain.value = 0.2
  src.connect(lp)
  lp.connect(g)
  g.connect(dest)
  src.start()
  stops.push(() => { try { src.stop() } catch { /* noop */ } })

  // 爆裂脉冲
  const crackle = () => {
    if (cancelled) return
    const len = 0.05 + Math.random() * 0.05
    const buf2 = createNoiseBuffer(ctx, 'white', len)
    const src2 = ctx.createBufferSource()
    src2.buffer = buf2
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1500 + Math.random() * 2500
    bp.Q.value = 2
    const g2 = ctx.createGain()
    g2.gain.value = 0.15 + Math.random() * 0.1
    src2.connect(bp)
    bp.connect(g2)
    g2.connect(dest)
    const t = ctx.currentTime
    src2.start(t)
    src2.stop(t + len)
    setTimeout(crackle, 200 + Math.random() * 1200)
  }
  setTimeout(crackle, 500)

  return () => {
    cancelled = true
    stops.forEach((s) => s())
  }
}

/** 风声：带通白噪 + 慢调制 */
function createWind(ctx: AudioContext, dest: AudioNode): () => void {
  const stops: (() => void)[] = []
  const buf = createNoiseBuffer(ctx, 'white', 6)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 500
  bp.Q.value = 0.7
  const g = ctx.createGain()
  g.gain.value = 0.25
  src.connect(bp)
  bp.connect(g)
  g.connect(dest)
  src.start()
  stops.push(() => { try { src.stop() } catch { /* noop */ } })

  // 慢调制
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.12
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 0.15
  lfo.connect(lfoGain)
  lfoGain.connect(g.gain)
  lfo.start()
  stops.push(() => { try { lfo.stop() } catch { /* noop */ } })

  // 频率调制（让风"飘")
  const lfo2 = ctx.createOscillator()
  lfo2.frequency.value = 0.07
  const lfo2Gain = ctx.createGain()
  lfo2Gain.gain.value = 300
  lfo2.connect(lfo2Gain)
  lfo2Gain.connect(bp.frequency)
  lfo2.start()
  stops.push(() => { try { lfo2.stop() } catch { /* noop */ } })

  return () => stops.forEach((s) => s())
}

/** 咖啡馆：棕色底 + 偶尔人声脉冲 */
function createCafe(ctx: AudioContext, dest: AudioNode): () => void {
  const stops: (() => void)[] = []
  let cancelled = false

  // 棕色底噪
  const buf = createNoiseBuffer(ctx, 'brown', 5)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 400
  bp.Q.value = 0.5
  const g = ctx.createGain()
  g.gain.value = 0.2
  src.connect(bp)
  bp.connect(g)
  g.connect(dest)
  src.start()
  stops.push(() => { try { src.stop() } catch { /* noop */ } })

  // 偶尔人声脉冲（中频脉冲）
  const murmur = () => {
    if (cancelled) return
    const len = 0.3 + Math.random() * 0.6
    const buf2 = createNoiseBuffer(ctx, 'pink', len)
    const src2 = ctx.createBufferSource()
    src2.buffer = buf2
    const bp2 = ctx.createBiquadFilter()
    bp2.type = 'bandpass'
    bp2.frequency.value = 300 + Math.random() * 400
    bp2.Q.value = 5
    const g2 = ctx.createGain()
    const t = ctx.currentTime
    g2.gain.setValueAtTime(0, t)
    g2.gain.linearRampToValueAtTime(0.08, t + 0.1)
    g2.gain.linearRampToValueAtTime(0, t + len)
    src2.connect(bp2)
    bp2.connect(g2)
    g2.connect(dest)
    src2.start(t)
    src2.stop(t + len)
    setTimeout(murmur, 1500 + Math.random() * 3000)
  }
  setTimeout(murmur, 1000)

  return () => {
    cancelled = true
    stops.forEach((s) => s())
  }
}

/** 夜虫：高频脉冲（持续虫鸣 + 偶尔蛙声） */
function createNight(ctx: AudioContext, dest: AudioNode): () => void {
  const stops: (() => void)[] = []
  let cancelled = false

  // 持续高频脉冲（蟋蟀）
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.value = 4500
  const g = ctx.createGain()
  g.gain.value = 0.015
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 8
  lfo.type = 'sine'
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 0.015
  lfo.connect(lfoGain)
  lfoGain.connect(g.gain)
  osc.connect(g)
  g.connect(dest)
  osc.start()
  lfo.start()
  stops.push(() => { try { osc.stop() } catch { /* noop */ } })
  stops.push(() => { try { lfo.stop() } catch { /* noop */ } })

  // 偶尔蛙声（低频脉冲）
  const croak = () => {
    if (cancelled) return
    const len = 0.15
    const buf2 = createNoiseBuffer(ctx, 'pink', len)
    const src2 = ctx.createBufferSource()
    src2.buffer = buf2
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 350
    const g2 = ctx.createGain()
    const t = ctx.currentTime
    g2.gain.setValueAtTime(0, t)
    g2.gain.linearRampToValueAtTime(0.15, t + 0.02)
    g2.gain.linearRampToValueAtTime(0, t + len)
    src2.connect(lp)
    lp.connect(g2)
    g2.connect(dest)
    src2.start(t)
    src2.stop(t + len)
    setTimeout(croak, 3000 + Math.random() * 6000)
  }
  setTimeout(croak, 2000)

  return () => {
    cancelled = true
    stops.forEach((s) => s())
  }
}

// 本地封装 setTimerMin（避免循环依赖）
function setTimerMinStore(min: number) {
  setTimerMin(min)
}
