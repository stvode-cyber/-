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
// SDK 内部会自己拼 /_matrix/client/... 路径 → BASE_URL 必须只到 origin
// ① 相对 '/_matrix' → SDK 拼绝对 URL 时炸 TypeError (baseUrl 不是 http)
// ② 'http://localhost:5173/_matrix' → SDK 再拼 '/_matrix/client/...' → 路径重复 → 404
// ✅ 正确: window.location.origin → SDK 拼 '_matrix/client/...' → 'http://localhost:5173/_matrix/client/...'
// Vite proxy path: /_matrix 匹配转发到 Continuwuity
const BASE_URL = window.location.origin

/** Day 8-9 E2EE 加密测试房间（admin creator，power 100，已开启 m.room.encryption） */
export const DEFAULT_ROOM_ID = '!HZ8bM_Zad8SU8ZnqWk8zlM9iWezPLPIHORGSJJ7sPP0'

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
  /** Day 7a：房间列表变化订阅（自动 accept invite 后刷新侧边栏） */
  private roomsListeners = new Set<(rooms: MatrixRoomSummary[]) => void>()

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

  /** Day 7a：订阅房间列表变化 */
  onRoomsChange(fn: (rooms: MatrixRoomSummary[]) => void) {
    this.roomsListeners.add(fn)
    return () => this.roomsListeners.delete(fn)
  }

  /** Day 7a：内部触发 rooms 变化 */
  private notifyRoomsChanged(rooms: MatrixRoomSummary[]) {
    for (const fn of this.roomsListeners) {
      try { fn(rooms) } catch {}
    }
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
        // 前缀加 _v2 换独立 IndexedDB，避免之前 admin 账户的旧密钥与当前 device 冲突
        // SDK initRustCrypto 发现 store 里的 device 不等于当前 device → 抛错
        console.log('[Matrix] initRustCrypto({ useIndexedDB: true, prefix: greenrhino_matrix_v3_ })...')
        try {
          await this.client.initRustCrypto({
            useIndexedDB: true,
            cryptoDatabasePrefix: 'greenrhino_matrix_v3_',
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

      // === Day 7a：自动接受房间邀请 ===
      // SDK 官方推荐：监听 RoomEvent.MyMembership
      // 当 membership 变为 invite → 自动 joinRoom
      this.client.on(sdk.RoomEvent.MyMembership, (room, membership, prevMembership) => {
        if (membership === sdk.KnownMembership.Invite) {
          const roomInfo = `room=${room.roomId} name="${room.name}"`
          console.log('[Matrix] 🎯 收到邀请 → 自动接受', roomInfo)
          this.client!.joinRoom(room.roomId)
            .then((res) => {
              const joinedRoomId = (res as { roomId?: string }).roomId || room.roomId
              console.log('[Matrix] ✅ 自动加入成功', joinedRoomId)
              // 刷新 rooms 列表（让侧边栏看到新房间）
              const newRooms = this.getJoinedRooms()
              this.notifyRoomsChanged(newRooms)
            })
            .catch((err) => {
              console.warn('[Matrix] ⚠️ 自动加入失败（可能已加过）：', err.message)
            })
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

  // === Day 6：房间管理 API ===

  /**
   * 创建新房间
   * @param name 房间显示名称
   * @param opts.isEncrypted 是否开启 E2EE（默认 true，创建后自动发送 m.room.encryption state event）
   * @param opts.preset 房间类型 preset：private_chat（默认，仅邀请可加入）/ public_chat / trusted_private_chat
   */
  async createRoom(
    name: string,
    opts: { isEncrypted?: boolean; preset?: string } = {},
  ): Promise<string> {
    if (!this.client) throw new Error('Matrix not initialized')
    const isEncrypted = opts.isEncrypted !== false
    const preset = opts.preset || 'private_chat'

    console.log('[Matrix] createRoom:', { name, isEncrypted, preset })

    const res = await this.client.createRoom({
      name,
      // SDK default preset = 'private_chat', default visibility = 'private' —— 跟我们要的一样
      initial_state: isEncrypted && this.encryptionEnabled
        ? [{
            type: sdk.EventType.RoomEncryption,
            state_key: '',
            content: {
              algorithm: 'm.megolm.v1.aes-sha2',
              rotation_period_msgs: 100,
            },
          }]
        : [],
    } as sdk.ICreateRoomOpts)

    const roomId = (res as { room_id: string }).room_id
    console.log('[Matrix] ✅ room created:', roomId)
    return roomId
  }

  /**
   * 列出当前用户已 join 的所有房间（侧边栏数据）
   * 按最后消息时间倒序
   */
  getJoinedRooms(): MatrixRoomSummary[] {
    if (!this.client) return []
    const rooms = this.client.getRooms()

    const summaries: MatrixRoomSummary[] = rooms
      .filter((r) => r.getMyMembership() === 'join')
      .map((r) => {
        const timeline = r.getLiveTimeline()
        const lastEvent = timeline.getEvents().slice(-1)[0]
        const encryption = r.hasEncryptionStateEvent()
        return {
          roomId: r.roomId,
          name: r.name || r.roomId,
          encryption,
          memberCount: r.getJoinedMemberCount(),
          lastMessageAt: lastEvent?.getTs() || 0,
        }
      })
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)

    return summaries
  }

  /** 获取指定房间的成员列表 */
  getRoomMembers(roomId: string): MatrixMember[] {
    if (!this.client) return []
    const room = this.client.getRoom(roomId)
    if (!room) return []

    const members = room.getMembers()
    return members.map((m) => ({
      userId: m.userId,
      name: m.name || m.userId,
      membership: (m.membership as MatrixMember['membership']) || 'join',
      powerLevel: m.powerLevel || 0,
    }))
  }

  /** 邀请用户加入房间 */
  async invite(roomId: string, userId: string): Promise<void> {
    if (!this.client) throw new Error('Matrix not initialized')
    console.log('[Matrix] invite:', { roomId, userId })
    await this.client.invite(roomId, userId)
    console.log('[Matrix] ✅ invited', userId, 'to', roomId)
  }

  /** 踢人（可选 reason） */
  async kick(roomId: string, userId: string, reason?: string): Promise<void> {
    if (!this.client) throw new Error('Matrix not initialized')
    console.log('[Matrix] kick:', { roomId, userId, reason })
    await this.client.kick(roomId, userId, reason)
    console.log('[Matrix] ✅ kicked', userId, 'from', roomId)
  }

  // === Day 6b：权限检查 ===

  /** 当前用户在指定房间的 powerLevel（0 默认成员，50 管理员，100 创建者） */
  getMyPowerLevel(roomId: string): number {
    if (!this.client) return 0
    const room = this.client.getRoom(roomId)
    if (!room) return 0
    const myUserId = this.client.getUserId()
    if (!myUserId) return 0
    const member = room.getMember(myUserId)
    return member?.powerLevel ?? 0
  }

  /** 检查当前用户是否有权在该房间邀请他人 */
  canInvite(roomId: string): boolean {
    if (!this.client) return false
    const room = this.client.getRoom(roomId)
    if (!room) return false
    const state = room.currentState
    const myLevel = this.getMyPowerLevel(roomId)
    // SDK 有 hasSufficientPowerLevelFor：invite 默认 0（private room），kick 默认 50
    if (typeof state.hasSufficientPowerLevelFor === 'function') {
      return state.hasSufficientPowerLevelFor('invite', myLevel)
    }
    // fallback：private room 用 preset 判断（invite=0）
    return myLevel >= 0
  }

  /** 检查当前用户是否有权踢人（踢人需要 powerLevel 50 以上，且目标 powerLevel < 我） */
  canKick(roomId: string, targetUserId: string): boolean {
    if (!this.client) return false
    const room = this.client.getRoom(roomId)
    if (!room) return false
    const myLevel = this.getMyPowerLevel(roomId)
    const targetMember = room.getMember(targetUserId)
    const targetLevel = targetMember?.powerLevel ?? 0
    // 不能踢自己，不能踢 powerLevel >= 自己的
    if (targetUserId === this.client.getUserId()) return false
    if (targetLevel >= myLevel) return false
    // kick 默认需要 powerLevel 50
    const state = room.currentState
    if (typeof state.hasSufficientPowerLevelFor === 'function') {
      return state.hasSufficientPowerLevelFor('kick', myLevel)
    }
    return myLevel >= 50
  }

  // === Day 7a：分享邀请链接 ===

  /**
   * 生成 Matrix Room 分享链接（matrix.to 格式，可在任意 Matrix 客户端打开）
   * 优先用 canonical alias（#room:homeserver），fallback 用 roomId（!xxx:homeserver）
   */
  generateShareLink(roomId: string): string {
    if (!this.client) return ''
    const room = this.client.getRoom(roomId)
    if (!room) return ''

    // 优先 canonical alias（如果有设置的话）
    const alias = room.getCanonicalAlias() || room.getAltAliases()?.[0]
    if (alias) {
      return `https://matrix.to/#/${encodeURIComponent(alias)}`
    }

    // fallback：从 roomId 里提取 homeserver（roomId 格式 !xxx:homeserver）
    const homeserver = roomId.includes(':') ? roomId.split(':').slice(1).join(':') : ''
    const via = homeserver ? `?via=${encodeURIComponent(homeserver)}` : ''
    return `https://matrix.to/#/${encodeURIComponent(roomId)}${via}`
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

/** Day 6：房间摘要（侧边栏用） */
export interface MatrixRoomSummary {
  roomId: string
  name: string
  encryption: boolean
  memberCount: number
  /** 最后一条消息时间戳（ms） */
  lastMessageAt: number
}

/** Day 6：房间成员 */
export interface MatrixMember {
  userId: string
  name: string
  membership: 'join' | 'invite' | 'leave' | 'ban' | 'knock'
  powerLevel: number
}

/** 全局单例 */
export const matrixManager = new MatrixClientManager()
