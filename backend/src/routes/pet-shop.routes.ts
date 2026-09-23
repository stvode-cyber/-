import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import {
  PET_SHOP_MAP, PET_SHOP_ITEMS, PET_SLOTS, parseEquipped,
  type PetSlot,
} from '../lib/petShop.js'

// 宠物装扮商店：消费金币购买装扮并装备（闭合"赚取→消费"经济环）
const router = Router()
router.use(authRequired)

// 取当前激活宠物（支持多宠物：优先 activePetId，其次第一只，无则自动创建）
async function getOrCreatePet(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activePetId: true },
  })
  if (user?.activePetId) {
    const pet = await prisma.pet.findFirst({ where: { id: user.activePetId, userId } })
    if (pet) return pet
  }
  const firstPet = await prisma.pet.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
  if (firstPet) {
    await prisma.user.update({ where: { id: userId }, data: { activePetId: firstPet.id } })
    return firstPet
  }
  const newPet = await prisma.pet.create({ data: { userId } })
  await prisma.user.update({ where: { id: userId }, data: { activePetId: newPet.id } })
  return newPet
}

// GET /pet-shop —— 目录 + 当前用户持有/装备状态 + 金币
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const pet = await getOrCreatePet(userId)
    const owned = await prisma.petOwnedItem.findMany({ where: { userId } })
    const ownedKeys = new Set(owned.map((o) => o.itemKey))
    const equipped = parseEquipped(pet.equipped)

    const items = PET_SHOP_ITEMS.map((it) => {
      const needLevel = it.unlockLevel ?? 1
      return {
        ...it,
        unlockLevel: needLevel,
        locked: pet.level < needLevel, // 等级未达，不可购买
        owned: ownedKeys.has(it.key),
        equipped: equipped[it.slot] === it.key,
      }
    })

    return success(res, {
      coins: pet.coins,
      equipped,
      items,
    }, 'ok')
  } catch (e) {
    next(e)
  }
})

// POST /pet-shop/buy { itemKey } —— 花费金币购买（防重复购买、余额不足拦截、并发双花拦截）
const buySchema = z.object({ itemKey: z.string().min(1) })
router.post('/buy', async (req, res, next) => {
  try {
    const parsed = buySchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('商品参数错误', 422)
    const item = PET_SHOP_MAP[parsed.data.itemKey]
    if (!item) throw new HttpError('商品不存在', 404)

    const userId = req.user!.userId
    const pet = await getOrCreatePet(userId)

    // 已拥有 → 409
    const existed = await prisma.petOwnedItem.findUnique({
      where: { userId_itemKey: { userId, itemKey: item.key } },
    })
    if (existed) throw new HttpError('已经拥有该装扮', 409)

    // 等级不足 → 403（装扮有解锁门槛，与成长体系联动）
    const needLevel = item.unlockLevel ?? 1
    if (pet.level < needLevel) {
      throw new HttpError(`宠物需达到 Lv${needLevel} 才能购买「${item.name}」`, 403)
    }

    // #12 修复：事务内条件更新防双花
    // 原实现"事务外读 coins + 绝对值写"，并发购买不同商品时双花。
    // 改为：updateMany where coins >= cost → data coins decrement，通过返回 count 判断是否扣成功。
    // 若 count=0 表示并发场景下余额已被其他事务扣走，本次购买失败。
    const buyResult = await prisma.$transaction(async (tx) => {
      const updateRes = await tx.pet.updateMany({
        where: { id: pet.id, coins: { gte: item.cost } },
        data: { coins: { decrement: item.cost } },
      })
      if (updateRes.count === 0) {
        // 余额不足（或并发场景下被先扣走）
        throw new HttpError(`金币不足，还差 ${item.cost - pet.coins} 枚`, 400)
      }
      // 创建持有记录（同事务内；若并发重复购买触发唯一约束会回滚整个事务）
      await tx.petOwnedItem.create({ data: { userId, itemKey: item.key } })
      // 读取扣币后的最新 pet 用于响应
      const updated = await tx.pet.findUnique({ where: { id: pet.id }, select: { coins: true } })
      return updated!
    })

    auditReq(req, res, {
      category: 'pet', action: 'pet_shop_buy',
      summary: `购买装扮:${item.key}`, detail: `cost=${item.cost} left=${buyResult.coins}`,
    })
    return success(res, { coins: buyResult.coins, itemKey: item.key }, '购买成功')
  } catch (e) {
    next(e)
  }
})

// POST /pet-shop/equip { itemKey } —— 装备已拥有的装扮（按 slot 切换）
const equipSchema = z.object({ itemKey: z.string().min(1) })
router.post('/equip', async (req, res, next) => {
  try {
    const parsed = equipSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('商品参数错误', 422)
    const item = PET_SHOP_MAP[parsed.data.itemKey]
    if (!item) throw new HttpError('商品不存在', 404)

    const userId = req.user!.userId
    const pet = await getOrCreatePet(userId)

    // 必须已拥有
    const owned = await prisma.petOwnedItem.findUnique({
      where: { userId_itemKey: { userId, itemKey: item.key } },
    })
    if (!owned) throw new HttpError('尚未拥有该装扮', 400)

    const equipped = parseEquipped(pet.equipped)
    // 同 slot 再次装备 = 取消装备（切换）；否则设为该 itemKey
    equipped[item.slot] = equipped[item.slot] === item.key ? null : item.key

    const updated = await prisma.pet.update({
      where: { id: pet.id },
      data: { equipped: JSON.stringify(equipped) },
    })
    auditReq(req, res, {
      category: 'pet', action: 'pet_shop_equip',
      summary: `装备装扮:${item.key}`, detail: `slot=${item.slot}`,
    })
    return success(res, { equipped: parseEquipped(updated.equipped) }, '装备已更新')
  } catch (e) {
    next(e)
  }
})

// POST /pet-shop/unequip { slot } —— 卸下某槽位
const unequipSchema = z.object({ slot: z.enum(PET_SLOTS as [PetSlot, ...PetSlot[]]) })
router.post('/unequip', async (req, res, next) => {
  try {
    const parsed = unequipSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('槽位参数错误', 422)
    const userId = req.user!.userId
    const pet = await getOrCreatePet(userId)
    const equipped = parseEquipped(pet.equipped)
    equipped[parsed.data.slot] = null
    const updated = await prisma.pet.update({
      where: { id: pet.id },
      data: { equipped: JSON.stringify(equipped) },
    })
    return success(res, { equipped: parseEquipped(updated.equipped) }, '已卸下')
  } catch (e) {
    next(e)
  }
})

export default router
