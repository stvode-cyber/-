/**
 * Matrix IM React Hook — 独立于 ChatPage 现有 22 个 hooks
 * - 通过 React Context 注入，不污染 ChatPage 状态流
 * - connect() 链路：auth token → Express /matrix/auth → Matrix access_token → matrixManager.init()
 * - 监听消息 + 暴露 sendText / joinRoom 等方法
 *
 * Day 5-6 MVP：只做明文消息，硬编码 admin room
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { api, unwrap } from '../lib/api'
import { matrixManager, type MatrixConnectionStatus, type MatrixRoomMessage, DEFAULT_ROOM_ID } from '../lib/matrixClient'

export interface MatrixAuthResponse {
  /** Matrix user_id，如 @testuser:lujax.fun */
  userId: string
  /** Matrix access_token */
  accessToken: string
  /** Matrix device_id（可选，SDK 自动生成） */
  deviceId?: string
}

export interface MatrixState {
  /** 连接状态 */
  status: MatrixConnectionStatus
  /** 当前 Matrix user_id（连接成功后填充） */
  userId: string | null
  /** 当前房间 ID */
  roomId: string | null
  /** 当前房间消息列表（按时间升序） */
  messages: MatrixRoomMessage[]
  /** 最后一次错误 */
  error: string | null
  /** 是否已完成 connect（避免重复调） */
  connected: boolean
}

export interface MatrixActions {
  /** 连接 Matrix（调 Express /api/v1/matrix/auth 换 token → SDK init → joinRoom） */
  connect: (roomId?: string) => Promise<void>
  /** 断开 */
  disconnect: () => Promise<void>
  /** 发 text 消息到当前房间 */
  sendText: (text: string) => Promise<string | null>
  /** 切换/加入新房间 */
  switchRoom: (roomId: string) => Promise<void>
  /** 刷新当前房间消息 */
  reloadMessages: () => Promise<void>
}

type MatrixCtx = MatrixState & MatrixActions

const MatrixContext = createContext<MatrixCtx | null>(null)

const initialState: MatrixState = {
  status: 'disconnected',
  userId: null,
  roomId: null,
  messages: [],
  error: null,
  connected: false,
}

/** Provider — 整个应用或 ChatPage 级别包裹一次 */
export function MatrixProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MatrixState>(initialState)
  const mountedRef = useRef(true)

  useEffect(() => () => { mountedRef.current = false }, [])

  // 监听 matrixManager 状态变化
  useEffect(() => {
    const off = matrixManager.onStatusChange((status) => {
      if (!mountedRef.current) return
      setState((s) => ({ ...s, status, connected: status === 'connected', error: status === 'error' ? (s.error || 'Matrix 连接失败') : null }))
    })
    return () => { off() }
  }, [])

  // 监听新消息（全局，任意房间）
  useEffect(() => {
    const off = matrixManager.onMessage((msg) => {
      if (!mountedRef.current) return
      setState((s) => {
        // 只追加当前房间的消息，避免其他房间消息干扰
        if (s.roomId && msg.roomId !== s.roomId) return s
        // 去重：matrix-js-sdk 同一事件可能触发多次
        if (s.messages.some((m) => m.id === msg.id)) return s
        return { ...s, messages: [...s.messages, msg] }
      })
    })
    return () => { off() }
  }, [])

  const connect = useCallback(async (roomId?: string) => {
    setState((s) => ({ ...s, status: 'connecting', error: null }))
    try {
      // 1. 调自家 Express 后端换 Matrix token
      console.log('[useMatrix] calling /api/v1/matrix/auth...')
      const auth = await unwrap<MatrixAuthResponse>(api.post('/matrix/auth'))
      console.log('[useMatrix] got Matrix token for', auth.userId)

      // 2. init matrixManager
      await matrixManager.init({
        userId: auth.userId,
        accessToken: auth.accessToken,
        deviceId: auth.deviceId,
      })

      setState((s) => ({ ...s, userId: auth.userId }))

      // 3. join 默认房间
      const targetRoom = roomId || DEFAULT_ROOM_ID
      await matrixManager.joinRoom(targetRoom)

      // 4. 拉历史消息
      const history = await matrixManager.getRoomMessages(targetRoom, 30)
      setState((s) => ({ ...s, roomId: targetRoom, messages: history }))

      console.log('[useMatrix] connected + joined room +', history.length, 'msgs loaded')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useMatrix] connect FAILED:', msg)
      setState((s) => ({ ...s, status: 'error', error: msg, connected: false }))
      throw err
    }
  }, [])

  const disconnect = useCallback(async () => {
    try {
      await matrixManager.stop()
    } catch { /* ignore */ }
    setState(initialState)
    console.log('[useMatrix] disconnected')
  }, [])

  const sendText = useCallback(async (text: string) => {
    if (!state.roomId) throw new Error('Not joined any room')
    return matrixManager.sendText(state.roomId, text)
  }, [state.roomId])

  const switchRoom = useCallback(async (roomId: string) => {
    await matrixManager.joinRoom(roomId)
    const history = await matrixManager.getRoomMessages(roomId, 30)
    setState((s) => ({ ...s, roomId, messages: history }))
  }, [])

  const reloadMessages = useCallback(async () => {
    if (!state.roomId) return
    const history = await matrixManager.getRoomMessages(state.roomId, 30)
    setState((s) => ({ ...s, messages: history }))
  }, [state.roomId])

  const value: MatrixCtx = {
    ...state,
    connect,
    disconnect,
    sendText,
    switchRoom,
    reloadMessages,
  }

  return <MatrixContext.Provider value={value}>{children}</MatrixContext.Provider>
}

/** 消费 hook — ChatPage 或任意组件可用 */
export function useMatrix(): MatrixCtx {
  const ctx = useContext(MatrixContext)
  if (!ctx) {
    throw new Error('useMatrix must be used inside <MatrixProvider>')
  }
  return ctx
}
