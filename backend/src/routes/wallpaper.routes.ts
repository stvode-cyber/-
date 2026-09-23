import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'

// 桌面动态壁纸配置（每用户唯一）：是否启用 + 主题 + 速度 + 不透明度 + 是否显示宠物
const router = Router()
router.use(authRequired)

const THEMES = ['aurora', 'bubbles', 'gradient', 'starfield', 'pet'] as const

function toDTO(s: any) {
  return {
    id: s.id,
    enabled: s.enabled,
    theme: s.theme,
    speed: s.speed,
    opacity: s.opacity,
    showPet: s.showPet,
    updatedAt: s.updatedAt.toISOString(),
  }
}

// GET /wallpaper —— 取或自动创建默认配置
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    // upsert 防止并发懒创建 TOCTOU 竞态
    let s = await prisma.wallpaperSetting.upsert({
      where: { userId },
      create: { userId },
      update: {},
    })
    return success(res, toDTO(s), 'ok')
  } catch (e) {
    next(e)
  }
})

// PUT /wallpaper —— 更新配置（upsert）
const updateSchema = z.object({
  enabled: z.boolean().optional(),
  theme: z.enum(THEMES).optional(),
  speed: z.number().int().min(0).max(100).optional(),
  opacity: z.number().int().min(0).max(100).optional(),
  showPet: z.boolean().optional(),
})
router.put('/', async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('壁纸参数错误', 422)
    const userId = req.user!.userId
    const data: any = {}
    if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled
    if (parsed.data.theme !== undefined) data.theme = parsed.data.theme
    if (parsed.data.speed !== undefined) data.speed = parsed.data.speed
    if (parsed.data.opacity !== undefined) data.opacity = parsed.data.opacity
    if (parsed.data.showPet !== undefined) data.showPet = parsed.data.showPet

    const s = await prisma.wallpaperSetting.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    })
    auditReq(req, res, { category: 'wallpaper', action: 'wallpaper_update', summary: '更新动态壁纸配置', detail: JSON.stringify(data) })
    return success(res, toDTO(s), '已更新')
  } catch (e) {
    next(e)
  }
})

export default router
