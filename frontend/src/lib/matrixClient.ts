/**
 * Matrix IM 底层客户端封装 · Day 8-9 E2EE 升级
 * - 单例模式：整个应用共享一个 MatrixClient 实例
 * - SDK v44 Rust crypto：initRustCrypto({ useIndexedDB: true }) 自动 WASM + IndexedDB 持久化
 * - 与绿角犀 Express 后端 SSO 对接：前端先调 /api/v1/matrix/auth 拿 token
 * - baseUrl 用 Vite proxy 路径 '/_matrix'（开发环境）
 *
 * Day 8-9 E2EE MVP：只做 Rust crypto + 房间级加密开关，无跨设备备份
 */

import * as sdk from 'matrix-js-sdk'

/** Continuwuity homeserver 的 Matrix 端点 baseUrl */
// 之前用相对路径 '/_matrix' — SDK 内部拼绝对 URL（TURN/key backup/server versions）时炸 TypeError
// 改成完整绝对 URL，开发环境走 Vite proxy，生产环境走自家 Express proxy
const BASE_URL = `${window.location.origin}/_matrix`

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
  /** 是否开启 E2EE（默认 true · Day 8-9 核心） */
  enableE2EE?: boolean
}

class MatrixClientManager {
  private client: sdk.MatrixClient | null = null
  private status: MatrixConnectionStatus = 'disconnected'
  private encryptionEnabled = false  // Day 8-9：Rust crypto 初始化状态
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
    const enableE2EE = params.enableE2EE !== false  // 默认 true
    console.log('[Matrix] creating client', { userId: params.userId, baseUrl: BASE_URL, enableE2EE })

    try {
      this.client = sdk.createClient({
        baseUrl: BASE_URL,
        userId: params.userId,
        accessToken: params.accessToken,
        deviceId: params.deviceId,
      })

      // ⭐ Day 8-9：E2EE Rust crypto 初始化（SDK v44 推荐路径）
      if (enableE2EE) {
        console.log('[Matrix] initRustCrypto({ useIndexedDB: true })...')
        try {
          await this.client.initRustCrypto({
            useIndexedDB: true,
            cryptoDatabasePrefix: 'greenrhino_matrix_',
          })
          this.encryptionEnabled = true
          console.log('[Matrix] ✅ Rust crypto ready, crypto API available')
        } catch (cryptoErr) {
          console.warn('[Matrix] ⚠️ initRustCrypto FAILED, falling back to plaintext:', cryptoErr)
          this.encryptionEnabled = false
          // E2EE 初始化失败不阻断连接 —— 先让用户能发明文
        }
      }

      // 监听 /sync 到达事件
      this.client.on(sdk.ClientEvent.Sync, (state) => {
        console.log('[Matrix] sync state:', state)
        if (state === 'PREPARED' || state === 'SYNCING') {
          this.setStatus('connected')
        } else if (state === 'ERROR') {
          this.setStatus('error')
        }
      })

      // 监听 Timeline 事件（新消息 · Day 8-9：区分加密/明文）
      this.client.on(sdk.RoomEvent.Timeline, (event, room) => {
        if (event.getType() !== 'm.room.message') return

        // Day 8-9：E2EE 消息 SDK 自动解密，但我们标记 isEncrypted 给 UI
        const isEncrypted = event.isEncrypted()

        const msg = event.getContent()
        if (!msg) return

        // SDK 可能解密失败 —— 显示 fallback
        if (!msg.body && msg.msgtype === 'm.bad.encrypted') {
          const parsed: MatrixRoomMessage = {
            id: event.getId() || '',
            roomId: room?.roomId || event.getRoomId() || '',
            senderId: event.getSender() || '',
            body: '🔐 加密消息（解密失败，请确认设备 key）',
            msgtype: 'm.bad.encrypted',
            timestamp: event.getTs(),
            isSelf: event.getSender() === params.userId,
            isEncrypted: true,
            isDecrypted: false,
          }
          this.messageListeners.forEach(fn => fn(parsed))
          return
        }

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
          isEncrypted,
          // SDK v44 无 isDecrypted() 方法，用 msgtype 判断：m.bad.encrypted = 解密失败
          isDecrypted: !isEncrypted || msgtype !== 'm.bad.encrypted',
        }

        // 只处理 text 消息（Day 5-6 MVP 范围 + Day 8-9 加密消息）
        if (msgtype === 'm.text' || msgtype === 'm.bad.encrypted') {
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

  /** 加/取 E2EE 加密状态 */
  isEncryptionEnabled() {
    return this.encryptionEnabled
  }

  /**
   * 给房间开启 E2EE（发 m.room.encryption state event）
   * Matrix 协议：加密是房间级开关，一旦开启不能关闭
   */
  async enableRoomEncryption(roomId: string): Promise<void> {
    if (!this.client) throw new Error('Matrix not initialized')
    if (!this.encryptionEnabled) throw new Error('E2EE not initialized — call init() first with enableE2EE: true')
    const room = this.client.getRoom(roomId)
    if (!room) throw new Error(`Room ${roomId} not found`)
    const existing = room.hasEncryptionStateEvent()
    if (existing) {
      console.log(`[Matrix] Room ${roomId} already encrypted, skip`)
      return
    }
    console.log(`[Matrix] Enabling E2EE on room ${roomId}...`)
    // sendStateEvent 参数顺序：(roomId, eventType, content, stateKey?)
    await this.client.sendStateEvent(
      roomId,
      sdk.EventType.RoomEncryption,
      {
        algorithm: 'm.megolm.v1.aes-sha2',
        rotation_period_msgs: 100,
      },
      '', // stateKey 空字符串（房间加密 state event 无 stateKey）
    )
    console.log(`[Matrix] ✅ Room ${roomId} encrypted`)
  }

  /**
   * 发一条 text 消息 · Day 8-9：自动感知房间加密
   * - 房间开了 E2EE → SDK 自动加密发送（msgtype: m.room.encrypted）
   * - 房间没开 → 明文发送（msgtype: m.text，走 Matrix 协议标准）
   */
  async sendText(roomId: string, text: string): Promise<string | null> {
    if (!this.client) throw new Error('Matrix not initialized')

    // Day 8-9：自动给房间开加密（首次发送时）
    if (this.encryptionEnabled) {
      const room = this.client.getRoom(roomId)
      if (room && !room.hasEncryptionStateEvent()) {
        console.log(`[Matrix] Auto-enabling E2EE for room ${roomId}...`)
        try {
          await this.enableRoomEncryption(roomId)
          // 加密房间后首次发消息可能需要等 SDK setup 完设备 key，给个小延迟
          await new Promise(r => setTimeout(r, 500))
        } catch (encErr) {
          console.warn('[Matrix] enableRoomEncryption failed, will send plaintext:', encErr)
        }
      }
    }

    const res = await this.client.sendTextMessage(roomId, text)
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

      const isEncrypted = event.isEncrypted()
      // getRoomMessages 已过滤 content.msgtype !== 'm.text'（L281 continue），
      // 能进到这里的都是明文或加密成功解密后的 m.text，解密一定成功
      messages.push({
        id: event.getId() || `fallback_${messages.length}`,
        roomId,
        senderId: event.getSender() || '',
        body: typeof content.body === 'string' ? content.body : JSON.stringify(content.body),
        msgtype: content.msgtype,
        timestamp: event.getTs(),
        isSelf: event.getSender() === this.client.getUserId(),
        isEncrypted,
        isDecrypted: true,
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
  /** Day 8-9：原消息是否加密发送（来自 event.isEncrypted()） */
  isEncrypted?: boolean
  /** Day 8-9：SDK 是否成功解密（m.bad.encrypted 时为 false） */
  isDecrypted?: boolean
}

/** 全局单例 */
export const matrixManager = new MatrixClientManager()
