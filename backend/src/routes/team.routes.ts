import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'

/**
 * 团队管理路由（方案 A）
 * 部门 CRUD、成员列表、角色分配、人员转移。
 * boss 和 supervisor 能改，普通成员只读。
 */

const router = Router()
router.use(authRequired)

// ============ 门槛校验 ============

/**
 * 团队功能门槛：必须先"群立团队"（创建一个部门并成为 boss）才能使用团队功能。
 * - 创建团队接口 /bootstrap 放行（校验方向相反：只给无团队的人用）
 * - 其他所有团队接口需要 departmentId 不为空
 */
async function requireTeam(userId: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true },
  })
  if (!u?.departmentId) {
    const err = new HttpError('你还没有团队，请先群立团队', 403) as any
    err.code = 'NO_TEAM'
    throw err
  }
}

// ============ 群立团队（bootstrap） ============

const bootstrapSchema = z.object({
  name: z.string().min(1, '团队名不能为空').max(50),
  description: z.string().max(500).optional(),
})

/** 创建团队（只能给自己建，有团队的人再调会报错） */
router.post('/bootstrap', async (req, res, next) => {
  try {
    const body = bootstrapSchema.parse(req.body)
    const userId = req.user!.userId

    // 已经有团队就不允许再建
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { departmentId: true, employeeRole: true },
    })
    if (existing?.departmentId) throw new HttpError('你已经在团队中，无需重复创建', 400)

    const { dept, group, conversation } = await prisma.$transaction(async (tx) => {
      // 1. 创建部门
      const d = await tx.department.create({
        data: { name: body.name, description: body.description || null },
      })
      // 2. 创建团队对话群（群名 = 团队名，创建者 = owner）
      const g = await tx.group.create({
        data: {
          name: `${body.name} 团队`,
          ownerId: userId,
          departmentId: d.id,
          members: { create: [{ userId, role: 'owner' }] },
        },
      })
      // 3. 部门也绑定 groupId（双向关联）
      await tx.department.update({
        where: { id: d.id },
        data: { groupId: g.id },
      })
      // 4. 把自己设为部门 leader + 绑定 departmentId + employeeRole=boss
      await tx.user.update({
        where: { id: userId },
        data: {
          employeeRole: 'boss',
          departmentId: d.id,
        },
      })
      // 5. 部门 leaderId 也指向自己（双向关联保持一致）
      await tx.department.update({
        where: { id: d.id },
        data: { leaderId: userId },
      })
      // 6. 创建群聊会话（让老板进群聊列表）
      const conv = await tx.conversation.create({
        data: {
          userId,
          type: 'group',
          groupId: g.id,
        },
      })
      return { dept: d, group: g, conversation: conv }
    })

    auditReq(req, res, {
      category: 'team', action: 'bootstrap', targetType: 'department', targetId: dept.id,
      summary: `群立团队: ${dept.name}（用户成为 boss + leader + 群 owner）`,
    })

    // 返回时把用户对象也一并带回，让前端同步 store
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, employeeRole: true, departmentId: true, department: { select: { id: true, name: true, groupId: true } } },
    })
    success(res, { department: dept, group, conversation, me }, `团队「${dept.name}」已创建，对话群也建好了`)
  } catch (err) { next(err) }
})

// 其他所有团队接口加门槛（bootstrap 除外，上面已经定义）
router.use((req, _res, next) => {
  // /bootstrap 放行，其余需要团队
  if (req.path === '/bootstrap') return next()
  requireTeam(req.user!.userId).then(() => next()).catch(next)
})

// ============ 工具函数 ============

async function requireRole(minRole: 'supervisor' | 'boss', userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeRole: true } })
  if (!user) throw new HttpError('未登录', 401)
  if (minRole === 'supervisor' && user.employeeRole === 'user') throw new HttpError('需要主管或老板权限', 403)
  if (minRole === 'boss' && user.employeeRole !== 'boss') throw new HttpError('需要老板权限', 403)
}

async function requireBoss(userId: string): Promise<void> {
  await requireRole('boss', userId)
}

// ============ 校验 Schema ============

const createDeptSchema = z.object({
  name: z.string().min(1, '部门名不能为空').max(50),
  description: z.string().max(500).optional(),
  leaderId: z.string().optional(),
})

const updateRoleSchema = z.object({
  employeeRole: z.enum(['user', 'supervisor', 'boss']),
  departmentId: z.string().optional(),
})

const transferSchema = z.object({
  newOwnerId: z.string().min(1, '必须指定接手人'),
})

// ============ 路由：部门 ============

/** 部门列表（全员可读） */
router.get('/departments', async (req, res, next) => {
  try {
    const depts = await prisma.department.findMany({
      include: {
        leader: { select: { id: true, nickname: true, avatar: true } },
        members: { select: { id: true, nickname: true, avatar: true, employeeRole: true } },
      },
    })
    success(res, depts)
  } catch (err) { next(err) }
})

/** 创建部门（supervisor 及以上） */
router.post('/departments', async (req, res, next) => {
  try {
    await requireRole('supervisor', req.user!.userId)
    const body = createDeptSchema.parse(req.body)
    const dept = await prisma.department.create({
      data: { name: body.name, description: body.description, leaderId: body.leaderId || null },
    })
    if (body.leaderId) {
      await prisma.user.update({ where: { id: body.leaderId }, data: { departmentId: dept.id, employeeRole: 'supervisor' } })
    }
    auditReq(req, res, { category: 'team', action: 'create-dept', targetType: 'department', targetId: dept.id, summary: `创建部门: ${dept.name}` })
    success(res, dept, '部门已创建')
  } catch (err) { next(err) }
})

/** 删部门（boss） */
router.delete('/departments/:id', async (req, res, next) => {
  try {
    await requireBoss(req.user!.userId)
    const dept = await prisma.department.findUnique({ where: { id: req.params.id } })
    if (!dept) throw new HttpError('部门不存在', 404)
    await prisma.user.updateMany({ where: { departmentId: req.params.id }, data: { departmentId: null } })
    await prisma.department.delete({ where: { id: req.params.id } })
    auditReq(req, res, { category: 'team', action: 'delete-dept', targetType: 'department', targetId: req.params.id, summary: `删除部门: ${dept.name}` })
    success(res, null, '部门已删除')
  } catch (err) { next(err) }
})

// ============ 路由：成员 ============

/** 团队成员列表（含角色 + 部门 + 任务数） */
router.get('/members', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeRole: true, departmentId: true } })
    if (!user) throw new HttpError('未登录', 401)
    const where: any = {}
    if (user.employeeRole === 'user') {
      if (user.departmentId) where.departmentId = user.departmentId
      else where.id = userId
    }
    const members = await prisma.user.findMany({
      where,
      select: {
        id: true, nickname: true, avatar: true, phone: true,
        employeeRole: true, departmentId: true, supervisorId: true,
        createdAt: true,
        _count: { select: { tasks: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ employeeRole: 'desc' }, { nickname: 'asc' }],
    })
    success(res, members)
  } catch (err) { next(err) }
})

/** 改成员角色/部门（boss 全能；supervisor 只能调自己部门的） */
router.patch('/members/:id/role', async (req, res, next) => {
  try {
    const body = updateRoleSchema.parse(req.body)
    const userId = req.user!.userId
    const operator = await prisma.user.findUnique({ where: { id: userId }, select: { employeeRole: true, departmentId: true } })
    if (!operator) throw new HttpError('未登录', 401)
    if (operator.employeeRole === 'supervisor') {
      if (body.employeeRole === 'boss') throw new HttpError('只有老板能改 boss 角色', 403)
      const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { departmentId: true } })
      if (target?.departmentId && operator.departmentId !== target.departmentId) {
        throw new HttpError('不能操作其他部门成员', 403)
      }
    }
    const updateData: any = { employeeRole: body.employeeRole }
    if ('departmentId' in body) updateData.departmentId = body.departmentId || null
    const updated = await prisma.user.update({ where: { id: req.params.id }, data: updateData })
    auditReq(req, res, { category: 'team', action: 'update-role', targetType: 'user', targetId: req.params.id, summary: `更新成员角色: ${updated.nickname || updated.username} → ${body.employeeRole}` })
    success(res, updated, '角色已更新')
  } catch (err) { next(err) }
})

/** 一键转移人员名下所有团队任务 */
router.post('/members/:id/transfer', async (req, res, next) => {
  try {
    await requireBoss(req.user!.userId)
    const body = transferSchema.parse(req.body)
    const from = await prisma.user.findUnique({ where: { id: req.params.id } })
    const to = await prisma.user.findUnique({ where: { id: body.newOwnerId } })
    if (!from) throw new HttpError('转出人不存在', 404)
    if (!to) throw new HttpError('接手人不存在', 400)
    if (from.id === to.id) throw new HttpError('不能转移给自己', 400)

    const result = await prisma.task.updateMany({ where: { assigneeId: from.id, origin: 'team' }, data: { assigneeId: to.id } })
    const result2 = await prisma.task.updateMany({ where: { userId: from.id, origin: 'team' }, data: { userId: to.id } })

    auditReq(req, res, {
      category: 'team', action: 'transfer', targetType: 'user', targetId: req.params.id,
      summary: `转移: ${from.nickname || from.username} → ${to.nickname || to.username} (任务 ${result.count + result2.count} 个)`,
    })
    success(res, { transferredTasks: result.count + result2.count, from: from.nickname || from.username, to: to.nickname || to.username }, `已转移 ${result.count + result2.count} 个团队任务`)
  } catch (err) { next(err) }
})

export default router

