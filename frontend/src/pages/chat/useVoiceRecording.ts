import { useCallback, useEffect, useRef, useState } from 'react'
import { api, unwrap } from '../../lib/api'

/**
 * 语音录制 hook — 从 ChatPage.tsx 抽离
 * 流程：idle → recording → uploading → idle
 * 依赖 ChatPage 传入：toast + onVoiceComplete（追加消息回调）
 */
export function useVoiceRecording(
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void,
  onVoiceComplete: (msg: any) => void,
) {
  const [recState, setRecState] = useState<'idle' | 'recording' | 'uploading'>('idle')
  const [recElapsed, setRecElapsed] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recStartTsRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  const stopRecording = useCallback(() => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }, [])

  const handleRecordingStop = useCallback(async () => {
    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
    if (blob.size > 5 * 1024 * 1024) {
      toast('录音文件过大（上限 5MB），请缩短录音时长', 'error')
      setRecState('idle'); return
    }
    const duration = Math.floor((Date.now() - recStartTsRef.current) / 1000)

    setRecState('uploading')
    try {
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const r = reader.result
          if (typeof r !== 'string') reject(new Error('转 base64 失败'))
          else resolve(r.split(',')[1] ?? '')
        }
        reader.onerror = () => reject(reader.error)
      })

      const memo = await unwrap<any>(api.post('/voice-memos', { audioData: base64, audioFormat: 'webm', duration }))

      onVoiceComplete({
        id: 'temp-voice-' + Date.now(), role: 'user',
        content: `🎙️ 录音 ${duration}s`, messageType: 'voice_memo',
        createdAt: new Date().toISOString(),
      })
      if (memo?.transcript || memo?.summary) {
        onVoiceComplete({
          id: 'ai-voice-' + Date.now(), role: 'assistant',
          content: memo.summary || memo.transcript || '录音已处理', messageType: 'voice_memo',
          metadata: JSON.stringify({ transcript: memo.transcript, todoItems: memo.todoItems, duration }),
          createdAt: new Date().toISOString(),
        })
      }
      toast('录音已处理 ✅', 'success')
    } catch (err) {
      toast(`录音上传失败：${(err as Error).message}`, 'error')
    } finally {
      setRecState('idle'); setRecElapsed(0)
    }
  }, [toast, onVoiceComplete])

  const toggleRecording = useCallback(async () => {
    if (recState === 'uploading') return
    if (recState === 'recording') { stopRecording(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      audioChunksRef.current = []
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = handleRecordingStop
      mr.start()
      mediaRecorderRef.current = mr
      recStartTsRef.current = Date.now()
      setRecElapsed(0); setRecState('recording')
      recTimerRef.current = setInterval(() => setRecElapsed(Math.floor((Date.now() - recStartTsRef.current) / 1000)), 1000)
    } catch (err) {
      toast(`无法访问麦克风：${(err as Error).message}`, 'error')
      setRecState('idle')
    }
  }, [recState, stopRecording, handleRecordingStop, toast])

  useEffect(() => () => {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    if (mediaRecorderRef.current?.state !== 'inactive') { try { mediaRecorderRef.current?.stop() } catch {} }
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  return { recState, recElapsed, toggleRecording }
}
