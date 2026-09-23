import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'

// 桌面便签（PC 端浮动便签）：每位用户多张，可拖拽/改色/置顶，落库持久化
const router = Router()
router.use(authRequired)

const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange']

// 把数据库便签转为前端 DTO
function toDTO(n: any) {
  return {
    id: n.id,
    content: n.content,
    color: n.color,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    z: n.z,
    pinned: n.pinned,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  }
}

// GET /sticky —— 列出当前用户全部便签（按 z 升序，便于叠放）
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const notes = await prisma.stickyNote.findMany({
      where: { userId },
      orderBy: { z: 'asc' },
    })
    return success(res, notes.map(toDTO), 'ok')
  } catch (e) {
    next(e)
  }
})

// POST /sticky —— 新建便签
const createSchema = z.object({
  content: z.string().max(2000).optional(),
  color: z.enum(COLORS as [string, ...string[]]).optional(),
  x: z.number().int().min(-10000).max(10000).optional(),
  y: z.number().int().min(-10000).max(10000).optional(),
  w: z.number().int().min(120).max(1200).optional(),
  h: z.number().int().min(100).max(1200).optional(),
  pinned: z.boolean().optional(),
})
router.post('/', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('便签参数错误', 422)
    const userId = req.user!.userId
    // 新便签默认 z 取当前最大 + 1
    const max = await prisma.stickyNote.aggregate({ where: { userId }, _max: { z: true } })
    const nextZ = (max._max.z ?? 0) + 1
    const note = await prisma.stickyNote.create({
      data: {
        userId,
        content: parsed.data.content ?? '',
        color: parsed.data.color ?? 'yellow',
        x: parsed.data.x ?? 80,
        y: parsed.data.y ?? 120,
        w: parsed.data.w ?? 220,
        h: parsed.data.h ?? 180,
        z: nextZ,
        pinned: parsed.data.pinned ?? false,
      },
    })
    auditReq(req, res, { category: 'sticky', action: 'sticky_create', summary: '新建便签', detail: note.id })
    return success(res, toDTO(note), '已创建', 201)
  } catch (e) {
    next(e)
  }
})

// PUT /sticky/:id —— 更新便签（owner 校验）
const updateSchema = z.object({
  content: z.string().max(2000).optional(),
  color: z.enum(COLORS as [string, ...string[]]).optional(),
  x: z.number().int().min(-10000).max(10000).optional(),
  y: z.number().int().min(-10000).max(10000).optional(),
  w: z.number().int().min(120).max(1200).optional(),
  h: z.number().int().min(100).max(1200).optional(),
  z: z.number().int().min(1).max(9999).optional(),
  pinned: z.boolean().optional(),
})
router.put('/:id', async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('便签参数错误', 422)
    const userId = req.user!.userId
    const existing = await prisma.stickyNote.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new HttpError('便签不存在', 404)
    if (existing.userId !== userId) throw new HttpError('无权操作该便签', 403)
    const note = await prisma.stickyNote.update({
      where: { id: req.params.id },
      data: {
        ...(parsed.data.content !== undefined ? { content: parsed.data.content } : {}),
        ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
        ...(parsed.data.x !== undefined ? { x: parsed.data.x } : {}),
        ...(parsed.data.y !== undefined ? { y: parsed.data.y } : {}),
        ...(parsed.data.w !== undefined ? { w: parsed.data.w } : {}),
        ...(parsed.data.h !== undefined ? { h: parsed.data.h } : {}),
        ...(parsed.data.z !== undefined ? { z: parsed.data.z } : {}),
        ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
      },
    })
    auditReq(req, res, { category: 'sticky', action: 'sticky_update', summary: '更新便签', detail: note.id })
    return success(res, toDTO(note), '已更新')
  } catch (e) {
    next(e)
  }
})

// DELETE /sticky/:id —— 删除便签（owner 校验）
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const existing = await prisma.stickyNote.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new HttpError('便签不存在', 404)
    if (existing.userId !== userId) throw new HttpError('无权操作该便签', 403)
    await prisma.stickyNote.delete({ where: { id: req.params.id } })
    auditReq(req, res, { category: 'sticky', action: 'sticky_delete', summary: '删除便签', detail: req.params.id })
    return success(res, null, '已删除')
  } catch (e) {
    next(e)
  }
})

export default router
