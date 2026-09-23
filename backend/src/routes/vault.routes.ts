/**
 * 用户资料库（AI 记忆 / Obsidian 式）路由
 *
 * 每个账号一套独立 vault：对话自动沉淀 + 用户手动管理。
 * 前端设置页「我的资料库」调用。
 */
import { Router } from 'express'
import { z } from 'zod'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import {
  listVaultNotes,
  createVaultNote,
  updateVaultNote,
  deleteVaultNote,
  getVaultStats,
  VAULT_CATEGORIES,
} from '../services/vaultService.js'

const router = Router()
router.use(authRequired)

// 写操作限流：每用户每分钟 30 次（防脚本刷库）
const writeRateLimit = rateLimit({
  limit: 30,
  windowMs: 60_000,
  keyFn: (req) => `vault:${req.user!.userId}`,
})

const categoryEnum = z.enum(VAULT_CATEGORIES as unknown as [string, ...string[]])

/** 列表（支持分类筛选 + 关键词搜索）+ 统计 */
router.get('/', async (req, res, next) => {
  try {
    const category = (req.query.category || '').toString().trim()
    const search = (req.query.search || '').toString().trim()
    const [notes, stats] = await Promise.all([
      listVaultNotes(req.user!.userId, {
        category: categoryEnum.safeParse(category).success ? category : undefined,
        search: search || undefined,
      }),
      getVaultStats(req.user!.userId),
    ])
    success(res, { notes, stats })
  } catch (err) {
    next(err)
  }
})

/** 新建笔记（手动） */
router.post('/', writeRateLimit, async (req, res, next) => {
  try {
    const body = z.object({
      title: z.string().min(1).max(60),
      content: z.string().min(1).max(2000),
      category: categoryEnum.optional(),
      tags: z.array(z.string().max(20)).max(5).optional(),
      pinned: z.boolean().optional(),
    }).parse(req.body)
    const note = await createVaultNote(req.user!.userId, body)
    success(res, note)
  } catch (err) {
    next(err)
  }
})

/** 更新笔记 */
router.put('/:id', writeRateLimit, async (req, res, next) => {
  try {
    const body = z.object({
      title: z.string().min(1).max(60).optional(),
      content: z.string().min(1).max(2000).optional(),
      category: categoryEnum.optional(),
      tags: z.array(z.string().max(20)).max(5).optional(),
      pinned: z.boolean().optional(),
    }).parse(req.body)
    try {
      const note = await updateVaultNote(req.user!.userId, req.params.id, body)
      success(res, note)
    } catch (e: any) {
      // Prisma P2025：记录不存在或非本人
      if (e?.code === 'P2025') throw new HttpError('笔记不存在', 404)
      throw e
    }
  } catch (err) {
    next(err)
  }
})

/** 删除笔记 */
router.delete('/:id', writeRateLimit, async (req, res, next) => {
  try {
    try {
      await deleteVaultNote(req.user!.userId, req.params.id)
    } catch (e: any) {
      if (e?.code === 'P2025') throw new HttpError('笔记不存在', 404)
      throw e
    }
    success(res, { deleted: true })
  } catch (err) {
    next(err)
  }
})

export default router
