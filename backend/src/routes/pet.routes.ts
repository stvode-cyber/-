import { Router } from 'express'
import { z } from 'zod'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import { parseEquipped } from '../lib/petShop.js'
import { getEvolution, evolutionUnlockedBetween } from '../lib/petEvolution.js'
import { calcLevel, getMaxPets } from '../utils/level.js'

const execFileAsync = promisify(execFile)

// 桌面宠物（QQ宠物式陪伴）：状态随时间衰减，互动恢复。支持多宠物。
const router = Router()
router.use(authRequired)

// ---- 衰减常量（每分钟）----
const DECAY = { hunger: 0.2, mood: 0.15, clean: 0.2, energy: 0.1 }

// 自定义桌宠形象有效期：24 小时
const SPRITE_TTL_MS = 24 * 60 * 60 * 1000

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

// 依据 elapsed 计算衰减后数值（不落库，仅用于实时展示 / 互动前先折算）
function computeDecay(pet: {
  hunger: number; mood: number; clean: number; energy: number; lastUpdated: Date
}) {
  const minutes = Math.max(0, (Date.now() - pet.lastUpdated.getTime()) / 60000)
  return {
    hunger: clamp(pet.hunger - DECAY.hunger * minutes),
    mood: clamp(pet.mood - DECAY.mood * minutes),
    clean: clamp(pet.clean - DECAY.clean * minutes),
    energy: clamp(pet.energy - DECAY.energy * minutes),
  }
}

// 取当前激活宠物（支持多宠物：优先 activePetId，其次第一只，无则自动创建）
async function getOrCreatePet(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activePetId: true },
  })
  // 1. 有 activePetId → 取该宠物
  if (user?.activePetId) {
    const pet = await prisma.pet.findFirst({
      where: { id: user.activePetId, userId },
    })
    if (pet) return pet
  }
  // 2. 无 activePetId 或已删除 → 取第一只
  const firstPet = await prisma.pet.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })
  if (firstPet) {
    // 更新 activePetId
    await prisma.user.update({
      where: { id: userId },
      data: { activePetId: firstPet.id },
    })
    return firstPet
  }
  // 3. 无宠物 → 自动创建一只
  const newPet = await prisma.pet.create({ data: { userId } })
  await prisma.user.update({
    where: { id: userId },
    data: { activePetId: newPet.id },
  })
  return newPet
}

// 检查自定义形象是否过期，过期则清除数据库记录
async function checkSpriteExpiry<T extends { id: string; customSprite: string | null; customSpriteExpireAt: Date | null }>(pet: T): Promise<T> {
  if (pet.customSprite && pet.customSpriteExpireAt && pet.customSpriteExpireAt.getTime() < Date.now()) {
    const updated = await prisma.pet.update({
      where: { id: pet.id },
      data: { customSprite: null, customSpriteExpireAt: null },
    })
    return updated as unknown as T
  }
  return pet
}

// 本地日期 YYYY-MM-DD（用于签到日期比较，统一按用户本地时区）
function dateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const todayStr = () => dateStr(new Date())
function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return dateStr(d)
}

// 互动动作效果表（先做衰减折算，再叠加动作，最后写回）
const ACTIONS: Record<string, { hunger?: number; mood?: number; clean?: number; energy?: number; exp?: number; coins?: number; moodFloor?: number }> = {
  feed: { hunger: 25, mood: 5, clean: -5, exp: 10, coins: 2 },
  play: { mood: 20, energy: -15, clean: -8, exp: 15, coins: 3 },
  clean: { clean: 40, mood: 3, exp: 5 },
  sleep: { energy: 50, hunger: -5, exp: 5 },
}

// 高等级专属互动动作（等级特权）：未达 unlockLevel 不可使用，体现等级的实际回报
const SPECIAL_ACTIONS: Record<string, { name: string; unlockLevel: number; hunger?: number; mood?: number; clean?: number; energy?: number; exp?: number; coins?: number }> = {
  walk: { name: '遛弯', unlockLevel: 5, mood: 15, energy: -10, exp: 20, coins: 5 },
  train: { name: '特训', unlockLevel: 8, mood: 10, energy: -20, exp: 35, coins: 8 },
}

// 等级特权：互动/游戏获得的经验随等级小幅加成（每级 +2%，封顶 +50%）
const LEVEL_EXP_MUL = (level: number) => Math.min(1 + level * 0.02, 1.5)

// 经验 → 升级（每级所需经验 = level * 100）
function applyLevelUp(pet: { level: number; exp: number }) {
  while (pet.exp >= pet.level * 100) {
    pet.exp -= pet.level * 100
    pet.level += 1
  }
}

// 将宠物（含衰减后数值）转为前端 DTO
function toDTO(pet: any, decayed: { hunger: number; mood: number; clean: number; energy: number }) {
  const state =
    decayed.energy < 20 ? 'sleepy' :
    decayed.hunger < 25 ? 'hungry' :
    decayed.clean < 25 ? 'dirty' :
    decayed.mood < 30 ? 'sad' : 'happy'
  return {
    id: pet.id,
    name: pet.name,
    species: pet.species,
    level: pet.level,
    exp: pet.exp,
    coins: pet.coins,
    hunger: decayed.hunger,
    mood: decayed.mood,
    clean: decayed.clean,
    energy: decayed.energy,
    state,
    lastUpdated: pet.lastUpdated.toISOString(),
    equipped: parseEquipped(pet.equipped),
    checkedInToday: pet.lastCheckinDate === todayStr(),
    checkinStreak: pet.checkinStreak,
    checkinTotal: pet.checkinTotal,
    // 进化阶段（成长体系）：当前形态 / 光环
    evolutionStage: getEvolution(pet.level).currentStage.stage,
    evolutionTitle: getEvolution(pet.level).currentStage.title,
    evolutionAura: getEvolution(pet.level).currentStage.aura,
    // 自定义桌宠形象（24小时有效）
    customSprite: pet.customSprite || null,
    customSpriteExpireAt: pet.customSpriteExpireAt ? pet.customSpriteExpireAt.toISOString() : null,
    customSpriteRemaining: pet.customSpriteExpireAt
      ? Math.max(0, Math.floor((pet.customSpriteExpireAt.getTime() - Date.now()) / 1000))
      : 0,
  }
}

// GET /pet —— 取或创建，返回当前（含衰减）状态
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    let pet = await getOrCreatePet(userId)
    pet = await checkSpriteExpiry(pet)
    const decayed = computeDecay(pet)
    return success(res, toDTO(pet, decayed), 'ok')
  } catch (e) {
    next(e)
  }
})

// GET /pet/list —— 获取所有宠物列表（含激活标记，支持多宠物管理）
router.get('/list', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activePetId: true, totalOnlineMinutes: true },
    })
    const pets = await prisma.pet.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    })
    const checked = await Promise.all(pets.map((p) => checkSpriteExpiry(p)))
    const list = checked.map((p) => ({
      ...toDTO(p, computeDecay(p)),
      isActive: p.id === user?.activePetId,
    }))
    const maxPets = getMaxPets(calcLevel(user?.totalOnlineMinutes ?? 0))
    return success(res, { list, activePetId: user?.activePetId || null, maxPets }, 'ok')
  } catch (e) {
    next(e)
  }
})

// POST /pet/create —— 创建新宠物（上限按账号等级：Lv1-5 仅 1 只，之后每 6 级 +1）
const createSchema = z.object({
  name: z.string().trim().min(1).max(12),
  species: z.enum(['shiba', 'corgi', 'panda', 'cat', 'snake']).default('shiba'),
})
router.post('/create', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('名字需 1-12 字符，物种为 shiba/corgi/panda/cat/snake', 422)
    const userId = req.user!.userId
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { totalOnlineMinutes: true },
    })
    const level = calcLevel(user?.totalOnlineMinutes ?? 0)
    const maxPets = getMaxPets(level)
    const count = await prisma.pet.count({ where: { userId } })
    if (count >= maxPets) {
      throw new HttpError(
        level < 6 ? '账号 Lv6 起才能领养第二只宠物，多陪伴在线即可升级' : `当前最多可领养 ${maxPets} 只宠物，升级后可领养更多`,
        400,
      )
    }
    const newPet = await prisma.pet.create({
      data: { userId, name: parsed.data.name, species: parsed.data.species },
    })
    // 第一只宠物自动设为激活
    if (count === 0) {
      await prisma.user.update({ where: { id: userId }, data: { activePetId: newPet.id } })
    }
    auditReq(req, res, {
      category: 'pet', action: 'pet_create',
      summary: `创建宠物:${parsed.data.name}`, detail: `species=${parsed.data.species}`,
    })
    return success(res, toDTO(newPet, computeDecay(newPet)), '创建成功')
  } catch (e) {
    next(e)
  }
})

// POST /pet/switch —— 切换激活宠物
const switchSchema = z.object({ petId: z.string().min(1) })
router.post('/switch', async (req, res, next) => {
  try {
    const parsed = switchSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('缺少 petId', 422)
    const userId = req.user!.userId
    const pet = await prisma.pet.findFirst({ where: { id: parsed.data.petId, userId } })
    if (!pet) throw new HttpError('宠物不存在', 404)
    await prisma.user.update({ where: { id: userId }, data: { activePetId: pet.id } })
    auditReq(req, res, {
      category: 'pet', action: 'pet_switch',
      summary: `切换宠物:${pet.name}`, detail: `petId=${pet.id}`,
    })
    return success(res, toDTO(pet, computeDecay(pet)), '切换成功')
  } catch (e) {
    next(e)
  }
})

// DELETE /pet/:petId —— 删除宠物（至少保留 1 只；删除激活宠物时自动切换）
router.delete('/:petId', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const petId = req.params.petId
    const count = await prisma.pet.count({ where: { userId } })
    if (count <= 1) throw new HttpError('至少保留 1 只宠物', 400)
    const pet = await prisma.pet.findFirst({ where: { id: petId, userId } })
    if (!pet) throw new HttpError('宠物不存在', 404)
    await prisma.pet.delete({ where: { id: petId } })
    // 删除的是激活宠物 → 自动切换到第一只
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { activePetId: true } })
    if (user?.activePetId === petId) {
      const firstPet = await prisma.pet.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
      await prisma.user.update({ where: { id: userId }, data: { activePetId: firstPet?.id || null } })
    }
    auditReq(req, res, {
      category: 'pet', action: 'pet_delete',
      summary: `删除宠物:${pet.name}`, detail: `petId=${petId}`,
    })
    return success(res, null, '删除成功')
  } catch (e) {
    next(e)
  }
})

// GET /pet/evolution —— 当前进化阶段 / 下一阶段 / 已解锁形态（成长体系可视化）
router.get('/evolution', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const pet = await getOrCreatePet(userId)
    const evo = getEvolution(pet.level)
    return success(res, {
      level: pet.level,
      exp: pet.exp,
      expToNext: pet.level * 100,
      currentStage: evo.currentStage,
      currentStageIndex: evo.currentStageIndex,
      nextStage: evo.nextStage,
      nextLevelNeeded: evo.nextLevelNeeded,
      unlockedStages: evo.unlockedStages,
      totalStages: evo.totalStages,
    }, 'ok')
  } catch (e) {
    next(e)
  }
})

// GET /pet/special-actions —— 专属互动动作及其解锁状态（等级特权可视化）
router.get('/special-actions', async (req, res, next) => {
  try {
    const pet = await getOrCreatePet(req.user!.userId)
    const list = Object.entries(SPECIAL_ACTIONS).map(([key, v]) => ({
      key,
      name: v.name,
      unlockLevel: v.unlockLevel,
      unlocked: pet.level >= v.unlockLevel,
    }))
    return success(res, { level: pet.level, specialActions: list }, 'ok')
  } catch (e) {
    next(e)
  }
})

// POST /pet/action { action: feed|play|clean|sleep }
const actionSchema = z.object({ action: z.enum(['feed', 'play', 'clean', 'sleep', 'walk', 'train']) })
router.post('/action', async (req, res, next) => {
  try {
    const parsed = actionSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('动作参数错误', 422)
    const userId = req.user!.userId
    const pet = await getOrCreatePet(userId)

    // 先按真实 elapsed 折算衰减，再叠加动作
    const decayed = computeDecay(pet)
    const actionKey = parsed.data.action
    const special = SPECIAL_ACTIONS[actionKey]
    if (special && pet.level < special.unlockLevel) {
      throw new HttpError(`需要宠物达到 Lv${special.unlockLevel} 才能${special.name}`, 403)
    }
    const eff = ACTIONS[actionKey] || special!
    // 等级特权：互动获得的经验随等级小幅加成
    const levelExpMul = LEVEL_EXP_MUL(pet.level)
    const nextStats = {
      hunger: clamp(decayed.hunger + (eff.hunger || 0)),
      mood: clamp(decayed.mood + (eff.mood || 0)),
      clean: clamp(decayed.clean + (eff.clean || 0)),
      energy: clamp(decayed.energy + (eff.energy || 0)),
      exp: pet.exp + Math.round((eff.exp || 0) * levelExpMul),
      coins: pet.coins + (eff.coins || 0),
      level: pet.level,
    }
    applyLevelUp(nextStats)

    const updated = await prisma.pet.update({
      where: { id: pet.id },
      data: {
        hunger: nextStats.hunger,
        mood: nextStats.mood,
        clean: nextStats.clean,
        energy: nextStats.energy,
        exp: nextStats.exp,
        coins: nextStats.coins,
        level: nextStats.level,
        lastUpdated: new Date(),
      },
    })
    const justEvo = evolutionUnlockedBetween(pet.level, nextStats.level)
    auditReq(req, res, {
      category: 'pet',
      action: 'pet_action',
      summary: `宠物互动:${parsed.data.action}`,
      detail: `level=${updated.level}`,
    })
    return success(res, {
      ...toDTO(updated, nextStats as any),
      levelUp: nextStats.level > pet.level,
      // 刚跨越进化阶段阈值时返回形态信息，供前端播放进化提示
      evolutionJustUnlocked: justEvo
        ? { stage: justEvo.stage, title: justEvo.title, aura: justEvo.aura, level: justEvo.level }
        : null,
    }, '互动成功')
  } catch (e) {
    next(e)
  }
})

// POST /pet/rename { name }
const renameSchema = z.object({ name: z.string().trim().min(1).max(12) })
router.post('/rename', async (req, res, next) => {
  try {
    const parsed = renameSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('名字需 1-12 个字符', 422)
    const userId = req.user!.userId
    const pet = await getOrCreatePet(userId)
    const updated = await prisma.pet.update({
      where: { id: pet.id },
      data: { name: parsed.data.name },
    })
    auditReq(req, res, { category: 'pet', action: 'pet_rename', summary: '宠物改名', detail: parsed.data.name })
    return success(res, toDTO(updated, computeDecay(updated)), '改名成功')
  } catch (e) {
    next(e)
  }
})

// POST /pet/play-game { game, score } —— 小游戏结算奖励
// 把本轮得分兑换为宠物金币(+ceil(score/2))与经验(+score)，并处理升级；
// 同时小幅提升心情、扣一点精力，让"玩得越久奖励越多"形成闭环。
const gameSchema = z.object({
  game: z.enum(['catch', 'poke', 'memory']),
  score: z.number().int().min(0).max(1000),
})
router.post('/play-game', async (req, res, next) => {
  try {
    const parsed = gameSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('游戏参数错误', 422)
    const userId = req.user!.userId
    const pet = await getOrCreatePet(userId)

    // 先折算衰减，再叠加奖励
    const decayed = computeDecay(pet)
    const score = parsed.data.score
    const nextStats = {
      hunger: decayed.hunger,
      mood: clamp(decayed.mood + 5),
      clean: decayed.clean,
      energy: clamp(decayed.energy - 3),
      // 等级特权：游戏经验随等级小幅加成
      exp: pet.exp + Math.round(score * LEVEL_EXP_MUL(pet.level)),
      coins: pet.coins + Math.ceil(score / 2),
      level: pet.level,
    }
    applyLevelUp(nextStats)

    const justEvo = evolutionUnlockedBetween(pet.level, nextStats.level)
    const updated = await prisma.pet.update({
      where: { id: pet.id },
      data: {
        hunger: nextStats.hunger,
        mood: nextStats.mood,
        clean: nextStats.clean,
        energy: nextStats.energy,
        exp: nextStats.exp,
        coins: nextStats.coins,
        level: nextStats.level,
        lastUpdated: new Date(),
      },
    })
    auditReq(req, res, {
      category: 'pet',
      action: 'pet_play_game',
      summary: `小游戏奖励:${parsed.data.game}`,
      detail: `score=${score} coins=${Math.ceil(score / 2)} exp=${score} level=${updated.level}`,
    })
    return success(res, {
      ...toDTO(updated, nextStats as any),
      levelUp: nextStats.level > pet.level,
      evolutionJustUnlocked: justEvo
        ? { stage: justEvo.stage, title: justEvo.title, aura: justEvo.aura, level: justEvo.level }
        : null,
    }, '游戏结算成功')
  } catch (e) {
    next(e)
  }
})

// POST /pet/checkin —— 每日签到（领取金币奖励 + 连续天数）
// 规则：同一天重复签到返回 409；连续天数 = 上一次签到为"昨天"则 +1，否则重置为 1；
// 奖励 = 5 + min(streak-1, 6)*2（第1天5，逐日+2，第7天起封顶17）。
router.post('/checkin', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const pet = await getOrCreatePet(userId)
    const today = todayStr()
    if (pet.lastCheckinDate === today) {
      throw new HttpError('今日已签到', 409)
    }
    const streak = pet.lastCheckinDate === yesterdayStr() ? pet.checkinStreak + 1 : 1
    // 基础奖励随连续天数提升；等级特权：等级越高每日签到额外加成越多（每级 +1，封顶 +10）
    const base = 5 + Math.min(streak - 1, 6) * 2
    const levelBonus = Math.min(pet.level, 10)
    const award = base + levelBonus
    const updated = await prisma.pet.update({
      where: { id: pet.id },
      data: {
        coins: pet.coins + award,
        lastCheckinDate: today,
        checkinStreak: streak,
        checkinTotal: pet.checkinTotal + 1,
      },
    })
    auditReq(req, res, {
      category: 'pet', action: 'pet_checkin',
      summary: '每日签到', detail: `streak=${streak} award=${award}`,
    })
    return success(res, {
      coins: updated.coins,
      award,
      base,
      levelBonus,
      streak,
      total: updated.checkinTotal,
      checkedInToday: true,
    }, '签到成功')
  } catch (e) {
    next(e)
  }
})

// GET /pet/leaderboard —— 跨会话宠物排行榜（按等级/经验排序，脱敏展示宠物名+主人昵称）
// range: all(默认,全局) | week(近7天活跃) | month(近30天活跃)，按 lastUpdated 时间窗过滤
router.get('/leaderboard', async (req, res, next) => {
  try {
    const take = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50)
    const range = String(req.query.range || 'all')
    const where: Record<string, unknown> = {}
    if (range === 'week' || range === 'month') {
      const days = range === 'week' ? 7 : 30
      const cutoff = new Date(Date.now() - days * 86400000)
      where.lastUpdated = { gte: cutoff }
    }
    const pets = await prisma.pet.findMany({
      where,
      include: { user: { select: { nickname: true, username: true } } },
      orderBy: [{ level: 'desc' }, { exp: 'desc' }],
      take,
    })
    const meId = req.user!.userId
    const list = pets.map((p, i) => {
      const evo = getEvolution(p.level).currentStage
      return {
        rank: i + 1,
        petId: p.id,
        name: p.name,
        ownerName: p.user.nickname || p.user.username || '匿名',
        level: p.level,
        exp: p.exp,
        evolutionTitle: evo.title,
        evolutionAura: evo.aura,
        isMe: p.userId === meId,
      }
    })
    return success(res, { list, total: await prisma.pet.count(), range }, 'ok')
  } catch (e) {
    next(e)
  }
})

// POST /pet/custom-sprite { image: "data:image/...;base64,..." }
// 用户上传照片 → rembg 抠图 → 透明背景 PNG，作为桌宠形象（24小时有效，免费）
const customSpriteSchema = z.object({
  image: z.string().min(1),
})
router.post('/custom-sprite', async (req, res, next) => {
  const tmpFiles: string[] = []
  try {
    const parsed = customSpriteSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('缺少图片数据', 422)

    const { image } = parsed.data

    // 校验 MIME 类型（仅允许 JPEG/PNG/WebP，排除 HTML/SVG/JS 等危险类型）
    const mimeMatch = image.match(/^data:(image\/(jpeg|png|webp));base64,/)
    if (!mimeMatch) throw new HttpError('仅支持 JPEG/PNG/WebP 格式图片', 422)

    // 校验大小（base64 解码后不超过 10MB）
    const base64Data = image.split(',')[1]
    if (!base64Data) throw new HttpError('图片数据格式错误', 422)
    const buffer = Buffer.from(base64Data, 'base64')
    if (buffer.length > 10 * 1024 * 1024) throw new HttpError('图片大小不能超过 10MB', 422)

    const userId = req.user!.userId
    const pet = await getOrCreatePet(userId)

    // 创建临时文件
    const tmpDir = os.tmpdir()
    const tmpId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const inputPath = path.join(tmpDir, `rembg-in-${tmpId}.png`)
    const outputPath = path.join(tmpDir, `rembg-out-${tmpId}.png`)
    tmpFiles.push(inputPath, outputPath)

    await fs.writeFile(inputPath, buffer)

    // 调用 rembg 抠图：优先使用 CLI，回退到 python3 -m rembg
    const pythonScript =
      'import sys; from rembg import remove; ' +
      'open(sys.argv[2],"wb").write(remove(open(sys.argv[1],"rb").read()))'

    let rembgOk = false
    let lastErr: unknown = null
    for (const cmd of [
      ['rembg', ['i', inputPath, outputPath]],
      ['python3', ['-c', pythonScript, inputPath, outputPath]],
    ] as const) {
      try {
        await execFileAsync(cmd[0], [...cmd[1]], { timeout: 120000 })
        rembgOk = true
        break
      } catch (e) {
        lastErr = e
      }
    }

    if (!rembgOk) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
      throw new HttpError(`抠图失败，服务器可能未安装 rembg：${msg}`, 500)
    }

    // 读取抠图结果
    const outBuf = await fs.readFile(outputPath)
    if (outBuf.length === 0) throw new HttpError('抠图结果为空', 500)
    const outputBase64 = `data:image/png;base64,${outBuf.toString('base64')}`

    // 存入数据库，设置 24 小时过期
    const expireAt = new Date(Date.now() + SPRITE_TTL_MS)
    await prisma.pet.update({
      where: { id: pet.id },
      data: { customSprite: outputBase64, customSpriteExpireAt: expireAt },
    })

    auditReq(req, res, {
      category: 'pet', action: 'pet_custom_sprite',
      summary: '设置自定义桌宠形象', detail: `expireAt=${expireAt.toISOString()}`,
    })

    return success(res, {
      customSprite: outputBase64,
      customSpriteExpireAt: expireAt.toISOString(),
      customSpriteRemaining: Math.floor(SPRITE_TTL_MS / 1000),
    }, '抠图成功，形象有效期为 24 小时')
  } catch (e) {
    next(e)
  } finally {
    // 清理临时文件
    for (const f of tmpFiles) await fs.unlink(f).catch(() => {})
  }
})

// DELETE /pet/custom-sprite —— 手动清除自定义桌宠形象
router.delete('/custom-sprite', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const pet = await getOrCreatePet(userId)
    await prisma.pet.update({
      where: { id: pet.id },
      data: { customSprite: null, customSpriteExpireAt: null },
    })
    auditReq(req, res, {
      category: 'pet', action: 'pet_custom_sprite_clear',
      summary: '清除自定义桌宠形象',
    })
    return success(res, null, '已清除自定义形象')
  } catch (e) {
    next(e)
  }
})

export default router
