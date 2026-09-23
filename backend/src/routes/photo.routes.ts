import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'

/**
 * 相册路由（QQ空间式个人相册）
 *
 * 用途：个人照片库的浏览、上传、删除；前端按月份分组渲染时间线宫格。
 *
 * 存储：MVP 方案 dataUrl 直存 SQLite（与聊天图片/宠物形象一致），前端上传前压缩到 1280px。
 *
 * 审计：上传/删除均记台账，category = 'photo'。
 *
 * 路由清单：
 * - GET    /photos          照片列表（倒序，分页）
 * - POST   /photos          上传照片（单张；前端多选时循环调用）
 * - DELETE /photos/:id      删除照片（属主校验）
 */

const router = Router()
router.use(authRequired)

// 单张上限 5MB base64 字符（前端已压缩到 ~500KB，5MB 为兜底）
const PHOTO_MAX_BYTES = 5 * 1024 * 1024

const uploadSchema = z.object({
  dataUrl: z.string().min(1, '图片内容不能为空').max(PHOTO_MAX_BYTES, '图片过大（上限 5MB）'),
  caption: z.string().max(200, '说明不能超过 200 字').optional(),
  takenAt: z.string().datetime({ offset: true }).optional(),
})

/**
 * 照片列表
 * - 按拍摄时间倒序（QQ空间时间线从近到远）
 * - 分页：page + pageSize（默认 60，覆盖一个月的量）
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 60))

    const [photos, total] = await Promise.all([
      prisma.photo.findMany({
        where: { userId },
        orderBy: [{ takenAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, dataUrl: true, caption: true, takenAt: true, createdAt: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.photo.count({ where: { userId } }),
    ])

    return success(res, { list: photos, total, page, pageSize })
  } catch (e) {
    next(e)
  }
})

/**
 * 上传照片（单张）
 * - dataUrl：data:image/jpeg;base64,...（前端压缩后）
 * - caption：可选说明
 * - takenAt：可选拍摄时间（ISO），缺省用当前时间
 */
router.post('/', async (req, res, next) => {
  try {
    const parsed = uploadSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { dataUrl, caption, takenAt } = parsed.data

    // 仅允许图片 data URL（防借道上传 HTML/SVG 等危险类型）
    if (!/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(dataUrl)) {
      throw new HttpError('仅支持 png/jpeg/gif/webp/bmp 图片', 415)
    }

    const photo = await prisma.photo.create({
      data: {
        userId: req.user!.userId,
        dataUrl,
        caption: caption?.trim() || null,
        takenAt: takenAt ? new Date(takenAt) : new Date(),
      },
      select: { id: true, dataUrl: true, caption: true, takenAt: true, createdAt: true },
    })

    auditReq(req, res, {
      category: 'photo',
      action: 'upload',
      targetType: 'Photo',
      targetId: photo.id,
      summary: `上传照片${caption ? `: ${caption.slice(0, 50)}` : ''}`,
      detail: { sizeKB: Math.round(dataUrl.length / 1024), hasCaption: !!caption },
    })

    return success(res, photo, '照片已上传', 201)
  } catch (e) {
    next(e)
  }
})

/**
 * 删除照片（仅属主）
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const photo = await prisma.photo.findUnique({ where: { id } })
    if (!photo || photo.userId !== req.user!.userId) throw new HttpError('照片不存在', 404)

    await prisma.photo.delete({ where: { id } })

    auditReq(req, res, {
      category: 'photo',
      action: 'delete',
      targetType: 'Photo',
      targetId: id,
      summary: '删除照片',
      detail: { id },
    })

    return success(res, { id }, '照片已删除')
  } catch (e) {
    next(e)
  }
})

export default router
