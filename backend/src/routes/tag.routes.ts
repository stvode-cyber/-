import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import { assertSpaceAccess } from '../lib/spaceAccess.js'

const router = Router()
router.use(authRequired)

const createSchema = z.object({ spaceId: z.string().min(1), name: z.string().trim().min(1).max(40) })

// 列出空间内标签（含使用计数）
router.get('/', async (req, res, next) => {
  try {
    const spaceId = req.query.spaceId as string
    if (!spaceId) throw new HttpError('spaceId 必填', 422)
    await assertSpaceAccess(spaceId, req.user!.userId)
    const tags = await prisma.tag.findMany({
      where: { spaceId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { assetTags: true } } },
    })
    return success(res, tags)
  } catch (e) {
    next(e)
  }
})

// 创建/复用标签（空间内唯一）
router.post('/', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { spaceId, name } = parsed.data
    await assertSpaceAccess(spaceId, req.user!.userId, true)
    const tag = await prisma.tag.upsert({
      where: { spaceId_name: { spaceId, name } },
      create: { spaceId, name },
      update: {},
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'tag_upsert',
      targetType: 'Tag',
      targetId: tag.id,
      summary: `标签: ${name}`,
    })
    return success(res, tag, '标签已保存', 201)
  } catch (e) {
    next(e)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const tag = await prisma.tag.findUnique({ where: { id: req.params.id } })
    if (!tag) return fail(res, '标签不存在', 404)
    await assertSpaceAccess(tag.spaceId, req.user!.userId, true)
    await prisma.tag.delete({ where: { id: tag.id } })
    auditReq(req, res, {
      category: 'dam',
      action: 'tag_delete',
      targetType: 'Tag',
      targetId: tag.id,
      summary: `删除标签: ${tag.name}`,
    })
    return success(res, null, '标签已删除')
  } catch (e) {
    next(e)
  }
})

export default router
