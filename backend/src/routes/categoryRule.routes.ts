import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import { assertSpaceAccess } from '../lib/spaceAccess.js'
import { classifyAsset, ASSET_CATEGORIES } from '../lib/classifyAsset.js'
import { loadCategoryRules } from '../lib/categoryRule.js'

const router = Router()
router.use(authRequired)

const MATCH_TYPES = ['extension', 'nameContains', 'mimeStartsWith'] as const

const ruleSchema = z.object({
  spaceId: z.string().min(1),
  matchType: z.enum(MATCH_TYPES),
  pattern: z.string().min(1).max(128),
  targetCategory: z.string().min(1).max(32),
  priority: z.coerce.number().int().min(0).max(999).optional(),
  enabled: z.boolean().optional(),
})

// 列出某空间的分类规则
router.get('/', async (req, res, next) => {
  try {
    const spaceId = String(req.query.spaceId || '')
    if (!spaceId) throw new HttpError('spaceId 必填', 422)
    await assertSpaceAccess(spaceId, req.user!.userId)
    const rules = await prisma.categoryRule.findMany({
      where: { spaceId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    })
    return success(res, { rules, categories: ASSET_CATEGORIES })
  } catch (e) {
    next(e)
  }
})

// 新建规则
router.post('/', async (req, res, next) => {
  try {
    const parsed = ruleSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { spaceId, matchType, pattern, targetCategory, priority, enabled } = parsed.data
    await assertSpaceAccess(spaceId, req.user!.userId, true)
    const rule = await prisma.categoryRule.create({
      data: {
        spaceId,
        ownerId: req.user!.userId,
        matchType,
        pattern: pattern.toLowerCase(),
        targetCategory,
        priority: priority ?? 0,
        enabled: enabled ?? true,
      },
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'category_rule_create',
      targetType: 'CategoryRule',
      targetId: rule.id,
      summary: `新增分类规则: ${matchType}=${pattern} → ${targetCategory}`,
      detail: { spaceId },
    })
    return success(res, rule, '规则已创建', 201)
  } catch (e) {
    next(e)
  }
})

// 更新规则（priority / targetCategory / enabled / pattern）
router.put('/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.categoryRule.findUnique({ where: { id } })
    if (!existing) throw new HttpError('规则不存在', 404)
    await assertSpaceAccess(existing.spaceId, req.user!.userId, true)
    const parsed = z
      .object({
        matchType: z.enum(MATCH_TYPES).optional(),
        pattern: z.string().min(1).max(128).optional(),
        targetCategory: z.string().min(1).max(32).optional(),
        priority: z.coerce.number().int().min(0).max(999).optional(),
        enabled: z.boolean().optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const data: Record<string, unknown> = {}
    if (parsed.data.matchType !== undefined) data.matchType = parsed.data.matchType
    if (parsed.data.pattern !== undefined) data.pattern = parsed.data.pattern.toLowerCase()
    if (parsed.data.targetCategory !== undefined) data.targetCategory = parsed.data.targetCategory
    if (parsed.data.priority !== undefined) data.priority = parsed.data.priority
    if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled
    const rule = await prisma.categoryRule.update({ where: { id }, data })
    return success(res, rule, '规则已更新')
  } catch (e) {
    next(e)
  }
})

// 删除规则
router.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.categoryRule.findUnique({ where: { id } })
    if (!existing) throw new HttpError('规则不存在', 404)
    await assertSpaceAccess(existing.spaceId, req.user!.userId, true)
    await prisma.categoryRule.delete({ where: { id } })
    auditReq(req, res, {
      category: 'dam',
      action: 'category_rule_delete',
      targetType: 'CategoryRule',
      targetId: id,
      summary: `删除分类规则: ${existing.matchType}=${existing.pattern}`,
      detail: { spaceId: existing.spaceId },
    })
    return success(res, { id }, '规则已删除')
  } catch (e) {
    next(e)
  }
})

// 重算某空间全部资产的分类（应用当前自定义规则 + 内置引擎）
router.post('/reclassify', async (req, res, next) => {
  try {
    const parsed = z.object({ spaceId: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) throw new HttpError('spaceId 必填', 422)
    const { spaceId } = parsed.data
    await assertSpaceAccess(spaceId, req.user!.userId, true)
    const rules = await loadCategoryRules(spaceId)
    const assets = await prisma.asset.findMany({ where: { spaceId } })
    // P2-2 修复：按目标分类分组，批量 updateMany 替代逐条 update（消除 N+1）
    const updatesByCat = new Map<string, string[]>()
    let changed = 0
    for (const a of assets) {
      const nextCat = classifyAsset({ name: a.name, mime: a.mime, size: a.size }, rules)
      if (nextCat !== a.category) {
        changed++
        if (!updatesByCat.has(nextCat)) updatesByCat.set(nextCat, [])
        updatesByCat.get(nextCat)!.push(a.id)
      }
    }
    for (const [cat, ids] of updatesByCat) {
      await prisma.asset.updateMany({ where: { id: { in: ids } }, data: { category: cat } })
    }
    auditReq(req, res, {
      category: 'dam',
      action: 'asset_reclassify',
      targetType: 'Space',
      targetId: spaceId,
      summary: `重算分类: 共 ${assets.length} 项，变更 ${changed} 项`,
      detail: { spaceId, total: assets.length, changed },
    })
    return success(res, { total: assets.length, changed }, `重算完成：共 ${assets.length} 项，变更 ${changed} 项`)
  } catch (e) {
    next(e)
  }
})

// 导出某空间全部分类规则（备份 / 跨空间迁移）
router.get('/export', async (req, res, next) => {
  try {
    const spaceId = String(req.query.spaceId || '')
    if (!spaceId) throw new HttpError('spaceId 必填', 422)
    await assertSpaceAccess(spaceId, req.user!.userId)
    const rules = await prisma.categoryRule.findMany({ where: { spaceId } })
    const payload = {
      version: 1,
      spaceId,
      exportedAt: new Date().toISOString(),
      rules: rules.map((r) => ({
        matchType: r.matchType,
        pattern: r.pattern,
        targetCategory: r.targetCategory,
        priority: r.priority,
        enabled: r.enabled,
      })),
    }
    return success(res, payload)
  } catch (e) {
    next(e)
  }
})

// 导入规则
// mode: cover(默认,覆盖式——替换该空间全部现有规则) | merge(增量合并——按 spaceId+matchType+pattern 去重，存在则更新、不存在则创建)
router.post('/import', async (req, res, next) => {
  try {
    const parsed = z
      .object({
        spaceId: z.string().min(1),
        mode: z.enum(['cover', 'merge']).optional(),
        rules: z
          .array(
            z.object({
              matchType: z.enum(MATCH_TYPES),
              pattern: z.string().min(1).max(128),
              targetCategory: z.string().min(1).max(32),
              priority: z.coerce.number().int().min(0).max(999).optional(),
              enabled: z.boolean().optional(),
            }),
          )
          .max(500),
      })
      .safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { spaceId, rules, mode = 'cover' } = parsed.data
    await assertSpaceAccess(spaceId, req.user!.userId, true)

    let created = 0
    let updated = 0
    if (mode === 'cover') {
      // 覆盖式：先删后建（同一空间维度）
      // P2-2 修复：用 createMany 批量插入替代逐条 create（消除 N+1）
      await prisma.categoryRule.deleteMany({ where: { spaceId } })
      if (rules.length > 0) {
        await prisma.categoryRule.createMany({
          data: rules.map((r) => ({
            spaceId,
            ownerId: req.user!.userId,
            matchType: r.matchType,
            pattern: r.pattern.toLowerCase(),
            targetCategory: r.targetCategory,
            priority: r.priority ?? 0,
            enabled: r.enabled ?? true,
          })),
        })
        created = rules.length
      }
    } else {
      // 增量合并：以 (spaceId, matchType, pattern) 为去重键
      const existing = await prisma.categoryRule.findMany({ where: { spaceId } })
      const keyOf = (m: string, p: string) => `${m}|${p.toLowerCase()}`
      const map = new Map(existing.map((e) => [keyOf(e.matchType, e.pattern), e]))
      for (const r of rules) {
        const key = keyOf(r.matchType, r.pattern)
        const lower = r.pattern.toLowerCase()
        const found = map.get(key)
        if (found) {
          const changed =
            found.targetCategory !== r.targetCategory ||
            found.priority !== (r.priority ?? 0) ||
            found.enabled !== (r.enabled ?? true)
          if (changed) {
            await prisma.categoryRule.update({
              where: { id: found.id },
              data: { targetCategory: r.targetCategory, priority: r.priority ?? 0, enabled: r.enabled ?? true },
            })
            updated++
          }
        } else {
          await prisma.categoryRule.create({
            data: {
              spaceId,
              ownerId: req.user!.userId,
              matchType: r.matchType,
              pattern: lower,
              targetCategory: r.targetCategory,
              priority: r.priority ?? 0,
              enabled: r.enabled ?? true,
            },
          })
          created++
        }
      }
    }
    auditReq(req, res, {
      category: 'dam',
      action: 'category_rule_import',
      targetType: 'Space',
      targetId: spaceId,
      summary: `导入分类规则(模式=${mode}) 新增${created}/更新${updated}`,
      detail: { spaceId, mode, total: rules.length, created, updated },
    })
    return success(res, { mode, created, updated, total: rules.length }, `导入成功：新增 ${created} 条${mode === 'merge' ? `、更新 ${updated} 条` : ''}`)
  } catch (e) {
    next(e)
  }
})

export default router
