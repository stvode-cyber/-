/**
 * Day 8：Matrix AI 助理 Bot（Express 后端常驻）
 *
 * 架构：
 *   - 原生 Matrix REST API（不用 matrix-js-sdk，省后端依赖）
 *   - sync 长轮询（timeout=30s）循环拉新事件
 *   - @mention 触发（@绿角犀AI助理 / @botId）或 PM（成员数=2 且 bot 在）
 *   - 复用 llmProxyCompletion（服务器侧 LLM key）
 *
 * 配置（全从 .env 读）：
 *   CONTINUUITY_URL         — Continuwuity homeserver（Express 已有）
 *   MATRIX_BOT_USERNAME     — bot 用户名（默认 greenrhino_ai）
 *   MATRIX_BOT_PASSWORD     — bot 密码（默认用 Matrix 确定性密码派生）
 *   MATRIX_BOT_TOKEN        — 直接给 token（可选，setup 接口会写入 env）
 */

import logger from '../lib/logger.js'
import { llmProxyCompletion } from './llmService.js'

const CONTINUUITY_URL = process.env.CONTINUUITY_URL || 'http://127.0.0.1:8008'
const MATRIX_BOT_USERNAME = process.env.MATRIX_BOT_USERNAME || 'greenrhino_ai'
const MATRIX_BOT_PASSWORD = process.env.MATRIX_BOT_PASSWORD || ''

interface BotState {
  botUserId: string | null
  accessToken: string | null
  nextBatch: string | null
  running: boolean
  lastSync: number
  processedCount: number
  lastError: string | null
}

class MatrixBotService {
  private state: BotState = {
    botUserId: null,
    accessToken: null,
    nextBatch: null,
    running: false,
    lastSync: 0,
    processedCount: 0,
    lastError: null,
  }

  private abortController: AbortController | null = null
  private syncPromise: Promise<void> | null = null

  /** 用 bot 账户 login 拿 access token */
  async login(username: string, password: string): Promise<{ token: string; userId: string }> {
    const res = await fetch(`${CONTINUUITY_URL}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: username },
        password,
        initial_device_display_name: 'GreenRhino AI Bot',
      }),
    })
    const body = (await res.json()) as any
    if (res.status !== 200 || !body.access_token) {
      throw new Error(`Matrix bot login failed (${res.status}): ${body.error || res.statusText}`)
    }
    this.state.accessToken = body.access_token
    this.state.botUserId = body.user_id
    logger.info({ username, userId: body.user_id }, '[MatrixBot] login OK')
    return { token: body.access_token, userId: body.user_id }
  }

  /** 启动 bot（需要先 login 过或 token 已设置） */
  async start(): Promise<void> {
    if (this.state.running) {
      logger.warn('[MatrixBot] already running')
      return
    }

    // token 来源优先级：直接设置 → 已 login → 重新 login
    if (!this.state.accessToken && MATRIX_BOT_PASSWORD) {
      try {
        await this.login(MATRIX_BOT_USERNAME, MATRIX_BOT_PASSWORD)
      } catch (err) {
        logger.error({ err }, '[MatrixBot] auto-login failed, bot NOT started')
        return
      }
    }

    if (!this.state.accessToken) {
      logger.warn('[MatrixBot] no access token, bot NOT started. Call POST /api/v1/matrix/bot/setup first.')
      return
    }

    this.state.running = true
    this.abortController = new AbortController()
    logger.info({ botUserId: this.state.botUserId }, '[MatrixBot] starting sync loop...')
    this.syncPromise = this.syncLoop()
  }

  /** 优雅停机 */
  async stop(): Promise<void> {
    if (!this.state.running) return
    logger.info('[MatrixBot] stopping...')
    this.state.running = false
    this.abortController?.abort()
    try { await this.syncPromise } catch { /* 正常 */ }
    logger.info('[MatrixBot] stopped')
  }

  /** 状态（Express /bot/status 端点用） */
  getStatus() {
    return { ...this.state }
  }

  // ─────────────── sync 长轮询循环 ───────────────

  private async syncLoop(): Promise<void> {
    while (this.state.running) {
      try {
        const url = new URL(`${CONTINUUITY_URL}/_matrix/client/v3/sync`)
        url.searchParams.set('timeout', '30000')
        url.searchParams.set('initial_sync_limit', '20')
        if (this.state.nextBatch) {
          url.searchParams.set('since', this.state.nextBatch)
        }

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${this.state.accessToken!}` },
          signal: this.abortController?.signal,
        })

        if (res.status !== 200) {
          const body = await res.text()
          this.state.lastError = `sync ${res.status}: ${body.slice(0, 200)}`
          logger.warn({ status: res.status, body }, '[MatrixBot] sync failed, retry in 5s')
          await this.sleep(5000)
          continue
        }

        const data = (await res.json()) as any
        this.state.nextBatch = data.next_batch
        this.state.lastSync = Date.now()

        // 处理 rooms.join 里的 timeline events
        const joinedRooms = data.rooms?.join || {}
        for (const [roomId, roomData] of Object.entries(joinedRooms)) {
          const events = (roomData as any)?.timeline?.events || []
          for (const event of events) {
            await this.handleEvent(roomId, event)
          }
        }

        // 处理 invite（bot 也自动 accept）
        const invitedRooms = data.rooms?.invite || {}
        for (const [roomId] of Object.entries(invitedRooms)) {
          await this.acceptInvite(roomId)
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          logger.info('[MatrixBot] sync aborted (stop)')
          return
        }
        this.state.lastError = err?.message || String(err)
        logger.warn({ err }, '[MatrixBot] sync loop error, retry in 10s')
        await this.sleep(10000)
      }
    }
  }

  // ─────────────── 事件处理 ───────────────

  private async handleEvent(roomId: string, event: any): Promise<void> {
    const type = event?.type
    if (type !== 'm.room.message') return

    const senderId = event.sender
    const body = event.content?.body || ''
    const msgtype = event.content?.msgtype || 'm.text'
    const botId = this.state.botUserId

    // 1. 自己发的 → skip
    if (botId && senderId === botId) return
    // 2. 只处理 text 消息
    if (msgtype !== 'm.text') return

    // 3. 判断是否要 reply：@mention bot 或 DM（2 成员且 bot 在）
    const shouldReply = await this.shouldReply(roomId, body)
    if (!shouldReply) return

    logger.info({ roomId, senderId, body: body.slice(0, 80) }, '[MatrixBot] 触发 AI 回复')
    this.state.processedCount++

    try {
      // 构造 LLM messages
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: '你是绿角犀 AI 助理（Matrix 频道）。回复简洁友好，中文。不知道的就说不知道。' },
        { role: 'user', content: this.stripMention(body) },
      ]

      const result = await llmProxyCompletion({ messages })
      const reply = result?.text || '抱歉，我暂时处理不了这个问题。'

      await this.sendText(roomId, reply)
      logger.info({ roomId, replyLen: reply.length }, '[MatrixBot] ✅ 已回复')
    } catch (err: any) {
      logger.error({ err }, '[MatrixBot] AI reply failed')
      this.state.lastError = err?.message || String(err)
      try { await this.sendText(roomId, '❌ AI 服务暂时不可用，请稍后再试。') } catch { /* ignore */ }
    }
  }

  /** 判断是否需要 bot 回复：@mention 或 PM */
  private async shouldReply(roomId: string, body: string): Promise<boolean> {
    const botId = this.state.botUserId
    if (!botId) return false

    // @mention 检测
    const botLocalpart = botId.split(':')[0].slice(1) // 去掉 @
    if (body.includes(`@${botLocalpart}`) || body.includes('绿角犀AI助理') || body.includes('绿角犀 AI')) {
      return true
    }

    // DM 检测：拉 joined members → === 2（bot + sender）
    try {
      const res = await fetch(`${CONTINUUITY_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`, {
        headers: { Authorization: `Bearer ${this.state.accessToken!}` },
      })
      if (res.status !== 200) return false
      const data = (await res.json()) as any
      const joined = Object.keys(data.joined || {})
      // 2 个成员且 bot 在里面 → 是 DM
      if (joined.length === 2 && joined.includes(botId)) {
        return true
      }
    } catch { /* ignore */ }

    return false
  }

  /** 去掉消息里的 @mention 前缀 */
  private stripMention(body: string): string {
    return body.replace(/@[^\s]+\s*/g, '').replace(/绿角犀AI助理[：:]\s*/g, '').trim()
  }

  // ─────────────── accept invite ───────────────

  private async acceptInvite(roomId: string): Promise<void> {
    try {
      const res = await fetch(`${CONTINUUITY_URL}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.state.accessToken!}` },
        body: JSON.stringify({}),
      })
      if (res.status === 200) {
        logger.info({ roomId }, '[MatrixBot] auto-accepted invite')
      } else {
        logger.warn({ roomId, status: res.status }, '[MatrixBot] accept invite failed')
      }
    } catch (err: any) {
      logger.warn({ roomId, err }, '[MatrixBot] accept invite error')
    }
  }

  // ─────────────── send text ───────────────

  async sendText(roomId: string, text: string): Promise<void> {
    const txnId = `greenrhino_bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const res = await fetch(
      `${CONTINUUITY_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${this.state.accessToken!}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'm.text', body: text }),
      },
    )
    if (res.status !== 200) {
      const body = await res.text()
      throw new Error(`sendText failed (${res.status}): ${body.slice(0, 200)}`)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }
}

/** 全局单例（Express index.ts 启动时 start） */
export const matrixBot = new MatrixBotService()
