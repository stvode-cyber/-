import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { transcribeAudio, extractMemo } from '../lib/voice-memo.js'

/**
 * 录音直达纪要（DG-10）
 *
 * 用户在对话页长按录音按钮，上传录音文件：
 * 1. POST /voice-memos         上传录音（含 base64 音频），立即返回 202，后台异步转写+提取
 * 2. GET  /voice-memos         列出用户录音纪要（按时间倒序）
 * 3. GET  /voice-memos/:id     查询单条录音纪要详情（前端轮询 status 直至 extracted/failed）
 * 4. PATCH /voice-memos/:id/extract  手动触发 AI 提取待办/纪要（重试 / 失败补跑）
 *
 * status 流转：uploaded → transcribed → extracted（或 failed）
 * - POST 上传后立即返回，后台异步调用 transcribeAudio + extractMemo
 * - 前端通过 GET /:id 轮询 status 字段直至终态
 *
 * 审计：
 * - voice_memo.upload：上传录音（同步记录）
 * - voice_memo.transcribe/extract：后台处理完成/失败时记录（异步）
 *
 * 性能（#10 修复）：原实现请求内同步等待 STT+LLM，单请求占用数十秒；
 * 现改为上传立即返回 + 后台异步处理，避免连接池耗尽与超时。
 */
const router = Router()
router.use(authRequired)

/** 单条录音 base64 大小上限（约 5MB，避免超大音频拖垮服务） */
const MAX_AUDIO_BASE64_SIZE = 5 * 1024 * 1024

/** 上传速率限制：每用户每分钟最多 5 次（音频转写耗时，防止队列堆积） */
const uploadRateLimit = rateLimit({
  limit: 5,
  windowMs: 60_000,
  keyFn: (req) => `vm:${req.user!.userId}`,
})

/** 上传 schema：音频数据 + 元信息 */
const uploadSchema = z.object({
  audioData: z.string().min(1, '音频数据不能为空'),
  audioFormat: z.enum(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg']).default('audio/webm'),
  duration: z.number().int().min(0).max(3600).default(0), // 秒，最长 1 小时
  title: z.string().max(100).optional(), // 不传则按时间自动生成
})

/** 提取参数 schema：手动重试时可选传 transcript 覆盖 */
const extractSchema = z.object({
  transcript: z.string().optional(),
})

/**
 * 后台异步处理录音：转写 + 提取
 *
 * #10 修复：从请求链路中剥离，不阻塞 HTTP 响应。
 * 失败时仅更新 VoiceMemo 状态，不抛错（错误已落库，前端通过 status 轮询感知）。
 */
async function processVoiceMemoInBackground(
  memoId: string,
  userId: string,
  audioData: string,
  audioFormat: string,
  title: string,
) {
  try {
    const transcript = await transcribeAudio(memoId, userId, audioData, audioFormat)
    await prisma.voiceMemo.update({
      where: { id: memoId },
      data: { transcript, status: 'transcribed' },
    })

    // 转写成功后触发提取
    try {
      const extracted = await extractMemo(transcript)
      await prisma.voiceMemo.update({
        where: { id: memoId },
        data: {
          todoItems: JSON.stringify(extracted.todoItems),
          summary: extracted.summary,
          status: 'extracted',
        },
      })
    } catch (extractErr) {
      await prisma.voiceMemo.update({
        where: { id: memoId },
        data: { status: 'failed', errorMsg: `提取失败: ${(extractErr as Error).message}` },
      })
    }
  } catch (transcribeErr) {
    await prisma.voiceMemo.update({
      where: { id: memoId },
      data: { status: 'failed', errorMsg: `转写失败: ${(transcribeErr as Error).message}` },
    })
  }
}

/**
 * 上传录音
 *
 * #10 修复：上传后立即返回 202（status=uploaded），后台异步触发转写+提取。
 * 前端通过 GET /:id 轮询 status 字段直至 extracted/failed。
 */
router.post('/', uploadRateLimit, async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = uploadSchema.parse(req.body)

    // 大小校验：base64 字符串长度 ≈ 原始字节数的 4/3
    if (body.audioData.length > MAX_AUDIO_BASE64_SIZE) {
      throw new HttpError(`音频数据过大（上限 ${Math.floor(MAX_AUDIO_BASE64_SIZE / 1024 / 1024)}MB）`, 413)
    }

    const title = body.title || `录音纪要 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`

    // 创建录音记录
    const memo = await prisma.voiceMemo.create({
      data: {
        userId,
        title,
        duration: body.duration,
        audioData: body.audioData,
        audioFormat: body.audioFormat,
        status: 'uploaded',
      },
    })

    auditReq(req, res, {
      category: 'voice_memo',
      action: 'upload',
      targetType: 'VoiceMemo',
      targetId: memo.id,
      summary: `上传录音: ${title} · ${body.duration}秒 · ${body.audioFormat}`,
      detail: { duration: body.duration, audioFormat: body.audioFormat },
    })

    // #10 修复：后台异步处理（不 await，立即返回 202）
    // 错误已在 processVoiceMemoInBackground 内部捕获并落库，此处 catch 仅记录日志
    processVoiceMemoInBackground(memo.id, userId, body.audioData, body.audioFormat, title).catch((err) => {
      console.error(`[voice-memo ${memo.id}] 后台处理异常:`, err.message)
    })

    // 立即返回 uploaded 状态（不含 audioData，避免响应膨胀）
    const uploaded = await prisma.voiceMemo.findUnique({
      where: { id: memo.id },
      select: {
        id: true,
        title: true,
        duration: true,
        audioFormat: true,
        transcript: true,
        todoItems: true,
        summary: true,
        status: true,
        errorMsg: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    success(res, toDTO(uploaded!), '录音已上传，正在后台处理', 202)
  } catch (e) {
    next(e)
  }
})

/**
 * 列出用户录音纪要
 *
 * - 按 createdAt 倒序
 * - 不返回 audioData（列表展示用不到，避免响应膨胀）
 * - 默认 50 条，支持 ?limit 调整（上限 100）
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const limit = Math.min(Number(req.query.limit as string) || 50, 100)

    const rows = await prisma.voiceMemo.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        duration: true,
        audioFormat: true,
        transcript: true,
        todoItems: true,
        summary: true,
        status: true,
        errorMsg: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    const dtos = rows.map(toDTO)
    success(res, dtos)
  } catch (e) {
    next(e)
  }
})

/**
 * 查询单条录音纪要详情
 *
 * - 包含完整字段（audioData 仅在 detail 接口返回，便于前端播放）
 */
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const id = req.params.id

    const memo = await prisma.voiceMemo.findFirst({
      where: { id, userId },
    })
    if (!memo) {
      throw new HttpError('录音不存在', 404)
    }

    success(res, toDTO(memo))
  } catch (e) {
    next(e)
  }
})

/**
 * 手动触发 AI 提取待办/纪要
 *
 * 适用场景：
 * - 录音转写后提取失败（status=failed）时手动重试
 * - 用户对自动提取结果不满意，希望覆盖 transcript 重试
 *
 * 流程：
 * 1. 校验录音存在且属于当前用户
 * 2. 取请求体中的 transcript（可选）或数据库中的 transcript
 * 3. 调用 extractMemo 提取
 * 4. 更新 todoItems / summary，置 status=extracted
 *
 * 审计：voice_memo.extract
 */
router.patch('/:id/extract', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const id = req.params.id
    const body = extractSchema.parse(req.body)

    const memo = await prisma.voiceMemo.findFirst({
      where: { id, userId },
    })
    if (!memo) {
      throw new HttpError('录音不存在', 404)
    }

    const transcript = body.transcript || memo.transcript
    if (!transcript) {
      throw new HttpError('缺少转写文本，无法提取纪要', 422)
    }

    try {
      const extracted = await extractMemo(transcript)
      const updated = await prisma.voiceMemo.update({
        where: { id },
        data: {
          transcript,
          todoItems: JSON.stringify(extracted.todoItems),
          summary: extracted.summary,
          status: 'extracted',
          errorMsg: null,
        },
      })

      auditReq(req, res, {
        category: 'voice_memo',
        action: 'extract',
        targetType: 'VoiceMemo',
        targetId: id,
        summary: `手动提取纪要: ${memo.title} · ${extracted.todoItems.length} 项待办`,
        detail: { todoCount: extracted.todoItems.length, manual: true },
      })

      success(res, toDTO(updated), '已提取纪要')
    } catch (extractErr) {
      await prisma.voiceMemo.update({
        where: { id },
        data: { status: 'failed', errorMsg: `提取失败: ${(extractErr as Error).message}` },
      })
      auditReq(req, res, {
        category: 'voice_memo',
        action: 'extract',
        targetType: 'VoiceMemo',
        targetId: id,
        summary: `手动提取失败: ${memo.title}`,
        detail: { error: (extractErr as Error).message, manual: true },
        result: 'fail',
      })
      throw new HttpError(`提取失败: ${(extractErr as Error).message}`, 500)
    }
  } catch (e) {
    next(e)
  }
})

/** 删除录音 */
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const id = req.params.id

    const memo = await prisma.voiceMemo.findFirst({
      where: { id, userId },
      select: { id: true, title: true },
    })
    if (!memo) {
      throw new HttpError('录音不存在', 404)
    }

    await prisma.voiceMemo.delete({ where: { id } })

    auditReq(req, res, {
      category: 'voice_memo',
      action: 'delete',
      targetType: 'VoiceMemo',
      targetId: id,
      summary: `删除录音: ${memo.title}`,
    })

    success(res, { id }, '已删除')
  } catch (e) {
    next(e)
  }
})

// ============ 工具函数 ============

/** VoiceMemo 行类型（含全部字段） */
interface VoiceMemoRow {
  id: string
  title: string
  duration: number
  audioData?: string
  audioFormat: string
  transcript: string | null
  todoItems: string | null
  summary: string | null
  status: string
  errorMsg: string | null
  createdAt: Date
  updatedAt: Date
}

/** 前端 DTO（todoItems 解析为数组） */
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

function toDTO(row: VoiceMemoRow): VoiceMemoDTO {
  let todoItems: string[] = []
  try {
    const parsed = JSON.parse(row.todoItems || '[]')
    if (Array.isArray(parsed)) todoItems = parsed.filter((x) => typeof x === 'string')
  } catch {
    /* ignore */
  }
  const dto: VoiceMemoDTO = {
    id: row.id,
    title: row.title,
    duration: row.duration,
    audioFormat: row.audioFormat,
    transcript: row.transcript,
    todoItems,
    summary: row.summary,
    status: row.status,
    errorMsg: row.errorMsg,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }
  // 仅在传入 audioData 时返回（列表查询不返回，详情查询返回）
  if (row.audioData !== undefined) dto.audioData = row.audioData
  return dto
}

export default router
