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
  name: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
})

// 创建空间（创建者自动成为 owner 成员）
router.post('/', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { name, description } = parsed.data
    const userId = req.user!.userId

    const space = await prisma.space.create({
      data: {
        name,
        description: description ?? null,
        ownerId: userId,
        members: { create: { userId, role: 'owner' } },
      },
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'space_create',
      targetType: 'Space',
      targetId: space.id,
      summary: `创建资料空间: ${name}`,
    })
    return success(res, space, '空间已创建', 201)
  } catch (e) {
    next(e)
  }
})

// 列出我的空间（我是 owner 或成员）
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const spaces = await prisma.space.findMany({
      where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { members: true, assets: true, resourceZones: true } },
      },
    })
    return success(res, spaces)
  } catch (e) {
    next(e)
  }
})

// 空间详情
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    await assertSpaceAccess(id, req.user!.userId)
    const space = await prisma.space.findUnique({
      where: { id },
      include: {
        members: { include: { /* 仅返回必要字段，隐私最小化 */ } },
        _count: { select: { assets: true, folders: true, tags: true } },
      },
    })
    if (!space) return fail(res, '空间不存在', 404)
    return success(res, space)
  } catch (e) {
    next(e)
  }
})

const memberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['owner', 'operator', 'member', 'viewer']).default('viewer'),
})

// 添加/更新空间成员
router.post('/:id/members', async (req, res, next) => {
  try {
    const { id } = req.params
    const access = await assertSpaceAccess(id, req.user!.userId, true)
    if (!access.isOwner && access.role !== 'operator') {
      throw new HttpError('权限不足：仅空间所有者或管理员可管理成员', 403)
    }
    const parsed = memberSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { userId, role } = parsed.data

    const member = await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: id, userId } },
      create: { spaceId: id, userId, role },
      update: { role },
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'space_member_update',
      targetType: 'Space',
      targetId: id,
      summary: `更新空间成员 ${userId} 角色为 ${role}`,
      detail: { userId, role },
    })
    return success(res, member, '成员已更新')
  } catch (e) {
    next(e)
  }
})

// 删除空间（仅 owner）
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const access = await assertSpaceAccess(id, req.user!.userId)
    if (!access.isOwner) throw new HttpError('权限不足：仅空间所有者可删除', 403)
    await prisma.space.delete({ where: { id } })
    auditReq(req, res, {
      category: 'dam',
      action: 'space_delete',
      targetType: 'Space',
      targetId: id,
      summary: `删除空间 ${id}`,
    })
    return success(res, null, '空间已删除')
  } catch (e) {
    next(e)
  }
})

export default router
