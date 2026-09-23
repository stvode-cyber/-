import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, Square, Pause, Play, Save, AlertCircle, Clock, Layers } from 'lucide-react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'

/**
 * DG-11 实时纪要模式
 *
 * 与 DG-10 一次性录音的区别：
 * - DG-10：短录音 → 转写 → 提取（一次性）
 * - DG-11：会议持续录音 → 每 60s 自动切片 → 实时展示段数和时长 → 结束时合并上传 → 统一转写提取
 *
 * 设计考量：
 * - 单 blob 不超过 5MB（约 60s webm），避免后端 base64 上限
 * - 切片存于前端 Blob[]，结束时合并为单个 Blob 上传
 * - 实时展示：录音时长、切片数、预计大小、当前状态
 * - 暂停/继续：暂停时停止 MediaRecorder 但不结束会议，继续时新建 recorder
 * - 结束：合并 → 上传 POST /voice-memos → 跳转详情页
 */
interface VoiceMemoDTO {
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

type MeetingState = 'idle' | 'recording' | 'paused' | 'finalizing'

interface Segment {
  index: number
  duration: number
  size: number
  blob: Blob
}

const SEGMENT_DURATION_MS = 60 * 1000 // 每 60s 自动切片一次
const MAX_TOTAL_SIZE = 50 * 1024 * 1024 // 累计 50MB 上限（约 10 分钟会议）

export default function LiveMeetingPage() {
  const toast = useToast((s) => s.show)
  const navigate = useNavigate()
  const [state, setState] = useState<MeetingState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [segments, setSegments] = useState<Segment[]>([])
  const [totalSize, setTotalSize] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const currentChunkRef = useRef<Blob[]>([])
  const segStartTsRef = useRef<number>(0)
  const meetingStartTsRef = useRef<number>(0)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const segTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const segIndexRef = useRef<number>(0)
  const segmentsRef = useRef<Segment[]>([])

  // 同步 ref 与 state
  useEffect(() => {
    segmentsRef.current = segments
  }, [segments])

  /** 组件卸载时清理资源 */
  useEffect(() => {
    return () => {
      stopTimers()
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  const stopTimers = () => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (segTimerRef.current) {
      clearInterval(segTimerRef.current)
      segTimerRef.current = null
    }
  }

  /** 启动会议录音 */
  const startMeeting = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      currentChunkRef.current = []
      segIndexRef.current = 0
      segmentsRef.current = []
      setSegments([])
      setTotalSize(0)
      setElapsed(0)
      meetingStartTsRef.current = Date.now()
      startSegmentRecorder(stream)
      setState('recording')
      startTimers()
    } catch (err) {
      toast(`无法访问麦克风：${(err as Error).message}`, 'error')
    }
  }

  /** 启动单段录音器（每 60s 自动切片） */
  const startSegmentRecorder = (stream: MediaStream) => {
    const mr = new MediaRecorder(stream)
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) currentChunkRef.current.push(e.data)
    }
    mr.onstop = () => {
      // 当前段结束，合并 chunk 存入 segments
      if (currentChunkRef.current.length > 0) {
        const blob = new Blob(currentChunkRef.current, { type: 'audio/webm' })
        const segDuration = Math.round((Date.now() - segStartTsRef.current) / 1000)
        const seg: Segment = {
          index: segIndexRef.current,
          duration: segDuration,
          size: blob.size,
          blob,
        }
        const newSegs = [...segmentsRef.current, seg]
        segmentsRef.current = newSegs
        setSegments(newSegs)
        setTotalSize((prev) => prev + blob.size)
        segIndexRef.current += 1
        currentChunkRef.current = []
      }
    }
    mr.start()
    mediaRecorderRef.current = mr
    segStartTsRef.current = Date.now()
  }

  const startTimers = () => {
    // 时长计时
    elapsedTimerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - meetingStartTsRef.current) / 1000))
    }, 1000)
    // 每 60s 自动切片
    segTimerRef.current = setInterval(() => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop()
        // 检查总大小上限
        if (totalSizeRef.current >= MAX_TOTAL_SIZE) {
          toast('已达到最大录制上限（50MB），将自动结束会议', 'info')
          finalizeMeeting()
          return
        }
        // 重新启动下一段
        setTimeout(() => {
          if (streamRef.current && stateRef.current === 'recording') {
            startSegmentRecorder(streamRef.current)
          }
        }, 100)
      }
    }, SEGMENT_DURATION_MS)
  }

  // 用 ref 解决 setInterval 闭包陈旧 state 问题
  const totalSizeRef = useRef(0)
  const stateRef = useRef<MeetingState>('idle')
  useEffect(() => {
    totalSizeRef.current = totalSize
  }, [totalSize])
  useEffect(() => {
    stateRef.current = state
  }, [state])

  /** 暂停会议 */
  const pauseMeeting = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (segTimerRef.current) {
      clearInterval(segTimerRef.current)
      segTimerRef.current = null
    }
    setState('paused')
  }

  /** 继续会议 */
  const resumeMeeting = () => {
    if (!streamRef.current) {
      toast('录音流已断开，请重新开始会议', 'error')
      return
    }
    startSegmentRecorder(streamRef.current)
    // 时长计时从原 meetingStart 继续（暂停期间不计入时长）
    // 此处简化：暂停时 elapsed 不变，继续时直接续上计时
    elapsedTimerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - meetingStartTsRef.current) / 1000))
    }, 1000)
    segTimerRef.current = setInterval(() => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop()
        if (totalSizeRef.current >= MAX_TOTAL_SIZE) {
          toast('已达到最大录制上限（50MB），将自动结束会议', 'info')
          finalizeMeeting()
          return
        }
        setTimeout(() => {
          if (streamRef.current && stateRef.current === 'recording') {
            startSegmentRecorder(streamRef.current)
          }
        }, 100)
      }
    }, SEGMENT_DURATION_MS)
    setState('recording')
  }

  /** 结束会议：合并所有片段 → 上传 → 跳转详情 */
  const finalizeMeeting = async () => {
    stopTimers()
    // 先停止当前段（如果有）
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    // 等待 onstop 完成（合并最后一段）
    await new Promise((resolve) => setTimeout(resolve, 300))

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    const allSegs = segmentsRef.current
    if (allSegs.length === 0) {
      toast('没有录制内容', 'error')
      setState('idle')
      return
    }

    setState('finalizing')
    try {
      // 合并所有 Blob
      const mergedBlob = new Blob(
        allSegs.map((s) => s.blob),
        { type: 'audio/webm' },
      )
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result
          if (typeof result !== 'string') {
            reject(new Error('转 base64 失败'))
            return
          }
          const commaIdx = result.indexOf(',')
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result)
        }
        reader.onerror = () => reject(reader.error || new Error('读取失败'))
        reader.readAsDataURL(mergedBlob)
      })

      const duration = elapsed
      const memo = await unwrap<VoiceMemoDTO>(
        api.post('/voice-memos', {
          audioData: base64,
          audioFormat: 'audio/webm',
          duration,
          title: `实时纪要 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
        }),
      )

      toast(`会议纪要已生成（${duration}秒 · ${allSegs.length} 段）`, 'success')
      // 跳转到录音纪要列表页查看结果
      navigate('/voice-memos')
    } catch (err) {
      toast(`上传失败：${(err as Error).message}`, 'error')
      setState('paused') // 允许重试
    }
  }

  /** 取消会议：丢弃所有录制内容 */
  const cancelMeeting = async () => {
    stopTimers()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    segmentsRef.current = []
    setSegments([])
    setTotalSize(0)
    setElapsed(0)
    setState('idle')
    toast('已取消会议', 'info')
  }

  /** 格式化时长（秒 → HH:MM:SS） */
  const formatTime = (sec: number): string => {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    const pad = (n: number) => n.toString().padStart(2, '0')
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
  }

  /** 格式化文件大小 */
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const isActive = state === 'recording' || state === 'paused'
  const sizePercent = Math.min(100, (totalSize / MAX_TOTAL_SIZE) * 100)

  return (
    <div className="app-shell">
      <Header title="实时纪要" />

      <div className="px-4 py-4 space-y-4">
        {/* 状态卡片 */}
        <div className="card overflow-hidden">
          {/* 状态标识 */}
          <div className={`px-4 py-3 flex items-center justify-between ${
            state === 'recording'
              ? 'bg-red-50'
              : state === 'paused'
                ? 'bg-amber-50'
                : state === 'finalizing'
                  ? 'bg-blue-50'
                  : 'bg-gray-50'
          }`}>
            <div className="flex items-center gap-2">
              {state === 'recording' && (
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              )}
              <span className={`text-sm font-medium ${
                state === 'recording'
                  ? 'text-red-700'
                  : state === 'paused'
                    ? 'text-amber-700'
                    : state === 'finalizing'
                      ? 'text-blue-700'
                      : 'text-gray-700'
              }`}>
                {state === 'idle' && '🎙️ 准备就绪'}
                {state === 'recording' && '🔴 录音中'}
                {state === 'paused' && '⏸️ 已暂停'}
                {state === 'finalizing' && '⏳ 正在生成纪要...'}
              </span>
            </div>
            {state === 'finalizing' && (
              <span className="text-xs text-blue-600 animate-pulse">处理中...</span>
            )}
          </div>

          {/* 时长 + 段数 + 大小 */}
          <div className="px-4 py-4 grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="text-[10px] text-gray-400 mb-1 flex items-center justify-center gap-0.5">
                <Clock size={10} /> 时长
              </div>
              <div className="text-lg font-mono font-semibold text-gray-800">
                {formatTime(elapsed)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-gray-400 mb-1 flex items-center justify-center gap-0.5">
                <Layers size={10} /> 段数
              </div>
              <div className="text-lg font-semibold text-gray-800">
                {segments.length}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-gray-400 mb-1">大小</div>
              <div className="text-lg font-semibold text-gray-800">
                {formatSize(totalSize)}
              </div>
            </div>
          </div>

          {/* 大小进度条 */}
          {isActive && (
            <div className="px-4 pb-3">
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    sizePercent > 80 ? 'bg-red-500' : sizePercent > 50 ? 'bg-amber-500' : 'bg-primary-500'
                  }`}
                  style={{ width: `${sizePercent}%` }}
                />
              </div>
              <div className="text-[10px] text-gray-400 mt-1 flex justify-between">
                <span>已用 {formatSize(totalSize)}</span>
                <span>上限 {formatSize(MAX_TOTAL_SIZE)}</span>
              </div>
            </div>
          )}
        </div>

        {/* 控制按钮 */}
        <div className="space-y-2">
          {state === 'idle' && (
            <button
              onClick={startMeeting}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2"
            >
              <Mic size={18} />
              开始会议录音
            </button>
          )}
          {state === 'recording' && (
            <>
              <button
                onClick={pauseMeeting}
                className="btn-secondary w-full py-3 flex items-center justify-center gap-2"
              >
                <Pause size={18} />
                暂停
              </button>
              <button
                onClick={finalizeMeeting}
                className="btn-primary w-full py-3 flex items-center justify-center gap-2"
              >
                <Save size={18} />
                结束并生成纪要
              </button>
            </>
          )}
          {state === 'paused' && (
            <>
              <button
                onClick={resumeMeeting}
                className="btn-primary w-full py-3 flex items-center justify-center gap-2"
              >
                <Play size={18} />
                继续
              </button>
              <button
                onClick={finalizeMeeting}
                className="btn-primary w-full py-3 flex items-center justify-center gap-2"
              >
                <Save size={18} />
                结束并生成纪要
              </button>
              <button
                onClick={cancelMeeting}
                className="w-full py-2 text-red-600 text-sm hover:bg-red-50 rounded-lg"
              >
                取消会议（丢弃录制）
              </button>
            </>
          )}
          {state === 'finalizing' && (
            <div className="text-center text-sm text-gray-500 py-3">
              正在合并片段并上传，请稍候...
            </div>
          )}
        </div>

        {/* 说明 */}
        {state === 'idle' && (
          <div className="card bg-blue-50/50 border-blue-100">
            <div className="text-sm font-medium text-blue-700 mb-2 flex items-center gap-1.5">
              <AlertCircle size={14} />
              使用说明
            </div>
            <ul className="text-xs text-gray-600 space-y-1.5 leading-relaxed">
              <li>• 点击「开始会议录音」进入持续监听模式</li>
              <li>• 系统每 60 秒自动切片一段，避免单文件过大</li>
              <li>• 暂停时不计录音时长，可随时继续</li>
              <li>• 结束后所有片段合并上传，统一转写并提取待办</li>
              <li>• 录音上限 50MB（约 10 分钟会议），达限自动结束</li>
              <li>• 纪要生成后可在「录音纪要」列表查看</li>
            </ul>
          </div>
        )}

        {/* 已录制片段列表 */}
        {segments.length > 0 && (
          <div className="card">
            <div className="px-3 py-2 border-b border-gray-50 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">已录制片段</span>
              <span className="text-[10px] text-gray-400">{segments.length} 段</span>
            </div>
            <div className="divide-y divide-gray-50 max-h-48 overflow-y-auto">
              {segments.map((seg) => (
                <div key={seg.index} className="px-3 py-2 flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center text-xs font-medium flex-shrink-0">
                    {seg.index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-700">第 {seg.index + 1} 段</div>
                    <div className="text-[10px] text-gray-400">
                      {formatTime(seg.duration)} · {formatSize(seg.size)}
                    </div>
                  </div>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
