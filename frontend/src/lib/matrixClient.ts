/**
 * Matrix IM 底层客户端封装
 * - 单例模式：整个应用共享一个 MatrixClient 实例
 * - 封装 SDK 初始化 / 登录 / 收消息 / 发消息 / 房间操作
 * - 与绿角犀 Express 后端 SSO 对接：前端先调 /api/v1/matrix/auth 拿 token
 * - baseUrl 用 Vite proxy 路径 '/_matrix'（开发环境）
 *
 * Day 5-6 MVP：只做明文消息（无 E2EE），硬编码 admin room
 */

import * as sdk from 'matrix-js-sdk'

/** Continuwuity homeserver 的 Matrix 端点 baseUrl */
// 开发环境走 Vite proxy /_matrix → http://47.116.59.141:8008
// Electron 生产环境也可以走自家 Express proxy，或直接公网
const BASE_URL = '/_matrix'

/** Day 5-6 MVP 硬编码 admin room（Day 2 fresh create 后验证有效） */
export const DEFAULT_ROOM_ID = '!3b7C96Koy6pTBSfIlgxi5-R77vvIdsnrq1lfI6495t8'

export type MatrixConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface MatrixInitParams {
  /** Matrix user_id，如 @admin:lujax.fun */
  userId: string
  /** Matrix access_token，从绿角犀 Express /api/v1/matrix/auth 换得 */
  accessToken: string
  /** device_id 可选，不传则 SDK 自动生成 */
  deviceId?: string
}

class MatrixClientManager {
  private client: sdk.MatrixClient | null = null
  private status: MatrixConnectionStatus = 'disconnected'
  private listeners = new Set<(status: MatrixConnectionStatus) => void>()
  private messageListeners = new Set<(msg: MatrixRoomMessage) => void>()

  /** 当前连接状态 */
  getStatus() {
    return this.status
  }

  /** 订阅状态变化 */
  onStatusChange(fn: (s: MatrixConnectionStatus) => void) {
    this.listeners.add(fn)
    fn(this.status) // 立即回调一次当前状态
    return () => this.listeners.delete(fn)
  }

  /** 订阅新消息（任意房间） */
  onMessage(fn: (msg: MatrixRoomMessage) => void) {
    this.messageListeners.add(fn)
    return () => this.messageListeners.delete(fn)
  }

  private setStatus(s: MatrixConnectionStatus) {
    this.status = s
    this.listeners.forEach(fn => fn(s))
  }

  /**
   * 初始化并连接 Matrix homeserver
   * 前置条件：绿角犀 Express 后端返回了有效的 Matrix access_token
   */
  async init(params: MatrixInitParams): Promise<sdk.MatrixClient> {
    if (this.client) {
      console.warn('[Matrix] client already initialized, stop first')
      return this.client
    }

    this.setStatus('connecting')
    console.log('[Matrix] creating client', { userId: params.userId, baseUrl: BASE_URL })

    try {
      this.client = sdk.createClient({
        baseUrl: BASE_URL,
        userId: params.userId,
        accessToken: params.accessToken,
        deviceId: params.deviceId,
      })

      // 监听 /sync 到达事件
      this.client.on(sdk.ClientEvent.Sync, (state) => {
        console.log('[Matrix] sync state:', state)
        if (state === 'PREPARED' || state === 'SYNCING') {
          this.setStatus('connected')
        } else if (state === 'ERROR') {
          this.setStatus('error')
        }
      })

      // 监听 Timeline 事件（新消息）
      this.client.on(sdk.RoomEvent.Timeline, (event, room) => {
        if (event.getType() !== 'm.room.message') return
        const msg = event.getContent()
        if (!msg) return

        const senderId = event.getSender()
        const body = msg.body || ''
        const msgtype = msg.msgtype || 'm.text'
        const roomId = room?.roomId || event.getRoomId() || ''
        const timestamp = event.getTs()

        const parsed: MatrixRoomMessage = {
          id: event.getId() || `${roomId}_${timestamp}_${Math.random()}`,
          roomId,
          senderId: senderId || '',
          body: typeof body === 'string' ? body : JSON.stringify(body),
          msgtype,
          timestamp,
          isSelf: senderId === params.userId,
        }

        // 只处理 text 消息（Day 5-6 MVP 范围）
        if (msgtype === 'm.text') {
          this.messageListeners.forEach(fn => fn(parsed))
        }
      })

      // startClient 发起首次 /sync，等待 PREPARED 或超时
      const syncPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Matrix /sync timeout 15s')), 15000)
        const handler = (state: string) => {
          if (state === 'PREPARED') {
            clearTimeout(timeout)
            this.client?.off(sdk.ClientEvent.Sync, handler)
            resolve()
          } else if (state === 'ERROR') {
            clearTimeout(timeout)
            this.client?.off(sdk.ClientEvent.Sync, handler)
            reject(new Error('Matrix /sync error'))
          }
        }
        this.client?.on(sdk.ClientEvent.Sync, handler)
      })

      // startClient + 等首次 sync 准备好
      this.client.startClient({ initialSyncLimit: 20 })
      await syncPromise

      this.setStatus('connected')
      console.log('[Matrix] connected OK')
      return this.client

    } catch (err) {
      console.error('[Matrix] init FAILED:', err)
      this.setStatus('error')
      // 清理半初始化的 client
      if (this.client) {
        try { await this.client.stopClient() } catch { /* ignore */ }
        this.client = null
      }
      throw err
    }
  }

  /** 加入一个房间（如果还没 join） */
  async joinRoom(roomId: string): Promise<unknown> {
    if (!this.client) throw new Error('Matrix not initialized')
    console.log('[Matrix] joining room:', roomId)
    return this.client.joinRoom(roomId)
  }

  /** 发一条 text 消息 */
  async sendText(roomId: string, text: string): Promise<string | null> {
    if (!this.client) throw new Error('Matrix not initialized')
    const res = await this.client.sendTextMessage(roomId, text)
    // sendTextMessage 返回 { event_id: string }
    return (res as { event_id?: string })?.event_id ?? null
  }

  /** 获取指定房间最近 N 条消息 */
  async getRoomMessages(roomId: string, limit = 30): Promise<MatrixRoomMessage[]> {
    if (!this.client) throw new Error('Matrix not initialized')
    const room = this.client.getRoom(roomId)
    if (!room) return []

    const messages: MatrixRoomMessage[] = []
    const timeline = room.getLiveTimeline()
    // getEvents() 返回按时间升序的事件数组
    const events = timeline.getEvents()

    // 取最后 N 条
    const recentEvents = events.slice(-limit)

    for (const event of recentEvents) {
      const type = event.getType()
      if (type !== 'm.room.message') continue
      const content = event.getContent()
      if (!content || content.msgtype !== 'm.text') continue

      messages.push({
        id: event.getId() || `fallback_${messages.length}`,
        roomId,
        senderId: event.getSender() || '',
        body: typeof content.body === 'string' ? content.body : JSON.stringify(content.body),
        msgtype: content.msgtype,
        timestamp: event.getTs(),
        isSelf: event.getSender() === this.client.getUserId(),
      })
    }

    return messages
  }

  /** 断开连接 */
  async stop() {
    if (!this.client) return
    try {
      await this.client.stopClient()
    } catch (e) {
      console.warn('[Matrix] stopClient error:', e)
    }
    this.client = null
    this.setStatus('disconnected')
    console.log('[Matrix] disconnected')
  }

  /** 当前 client 实例（供高级用法） */
  getClient() {
    return this.client
  }
}

export interface MatrixRoomMessage {
  id: string
  roomId: string
  senderId: string
  body: string
  msgtype: string
  timestamp: number
  isSelf: boolean
}

/** 全局单例 */
export const matrixManager = new MatrixClientManager()
