import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import { assertSpaceAccess } from '../lib/spaceAccess.js'

const router = Router()
router.use(authRequired)

const createSchema = z.object({
  spaceId: z.string().min(1),
  name: z.string().min(1).max(120).refine((n) => !n.includes('/'), { message: '文件夹名称不能包含 "/" 分隔符' }),
  parentId: z.string().optional(),
})

// 创建文件夹（支持嵌套，自动计算冗余路径）
router.post('/', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { spaceId, name, parentId } = parsed.data
    await assertSpaceAccess(spaceId, req.user!.userId, true)

    let pathStr = '/' + name
    if (parentId) {
      const parent = await prisma.folder.findUnique({ where: { id: parentId } })
      if (!parent || parent.spaceId !== spaceId) throw new HttpError('父文件夹不存在或无权限', 404)
      pathStr = parent.path + '/' + name
    }
    const folder = await prisma.folder.create({
      data: { spaceId, parentId: parentId ?? null, name, path: pathStr },
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'folder_create',
      targetType: 'Folder',
      targetId: folder.id,
      summary: `创建文件夹: ${pathStr}`,
    })
    return success(res, folder, '文件夹已创建', 201)
  } catch (e) {
    next(e)
  }
})

// 列出空间内文件夹（扁平返回，前端按 parentId 构建树）
router.get('/', async (req, res, next) => {
  try {
    const spaceId = req.query.spaceId as string
    if (!spaceId) throw new HttpError('spaceId 必填', 422)
    await assertSpaceAccess(spaceId, req.user!.userId)
    const folders = await prisma.folder.findMany({
      where: { spaceId },
      orderBy: { path: 'asc' },
      include: { _count: { select: { assets: true } } },
    })
    return success(res, folders)
  } catch (e) {
    next(e)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const folder = await prisma.folder.findUnique({ where: { id: req.params.id } })
    if (!folder) return fail(res, '文件夹不存在', 404)
    await assertSpaceAccess(folder.spaceId, req.user!.userId)
    return success(res, folder)
  } catch (e) {
    next(e)
  }
})

// 删除文件夹（级联删除子文件夹；资产 folderId 置空）
router.delete('/:id', async (req, res, next) => {
  try {
    const folder = await prisma.folder.findUnique({ where: { id: req.params.id } })
    if (!folder) return fail(res, '文件夹不存在', 404)
    await assertSpaceAccess(folder.spaceId, req.user!.userId, true)
    await prisma.folder.delete({ where: { id: folder.id } })
    auditReq(req, res, {
      category: 'dam',
      action: 'folder_delete',
      targetType: 'Folder',
      targetId: folder.id,
      summary: `删除文件夹: ${folder.path}`,
    })
    return success(res, null, '文件夹已删除')
  } catch (e) {
    next(e)
  }
})

export default router
