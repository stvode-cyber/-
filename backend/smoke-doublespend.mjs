// pet-shop /buy 并发防双花运行时测试
// 场景：pet 金币=15（仅够1个 glass_nerd，cost=15），并发 8 次 /buy 同一商品
// 期望（事务 updateMany 防双花生效）：
//   - 恰好 1 次 200（赢家），其余 409(已拥有) 或 400(金币不足)
//   - 最终 pet.coins = 0（15 - 15，不超扣 8*15=120）
//   - owned glass_nerd 记录数 = 1（不重复）
// 反例（无事务保护的"读后写"）：多个请求同时读到 coins=15，各自扣 15，净扣 >15 → 双花
process.env.DATABASE_URL = 'file:./dev.db'
import { PrismaClient } from '@prisma/client'

const BASE = 'http://127.0.0.1:3001'
const ITEM = 'glass_nerd' // cost=15, 无 unlockLevel
const COST = 15
const N = 8

const prisma = new PrismaClient()
let total = 0, okCount = 0
function check(name, ok, detail = '') { total++; if (ok) okCount++; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' -> ' + detail : ''}`) }

try {
  // --- 1. 注册新用户（唯一时间戳，避免 409/重复） ---
  const U = `dp_${Date.now()}`
  const regRes = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: U, password: 'Test1234', nickname: '双花测试' }),
  })
  const regJson = await regRes.json().catch(() => null)
  const token = regJson?.data?.token
  check('register 成功 + 取得 token', regRes.status === 200 && !!token, `status=${regRes.status}`)

  // --- 2. GET /pet-shop 触发 getOrCreatePet（建宠） ---
  const shopRes = await fetch(`${BASE}/api/v1/pet-shop`, { headers: { Cookie: `aie_token=${token}` } })
  check('GET /pet-shop 200', shopRes.status === 200, `status=${shopRes.status}`)

  // --- 3. DB 直设：pet.coins=COST(15)、level=1、清空 glass_nerd 持有记录 ---
  const user = await prisma.user.findUnique({ where: { username: U }, select: { id: true, activePetId: true } })
  let petId = user?.activePetId
  if (!petId) {
    const pet = await prisma.pet.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } })
    petId = pet?.id
  }
  check('找到用户 pet', !!petId, `petId=${petId}`)
  await prisma.pet.update({ where: { id: petId }, data: { coins: COST, level: 1 } })
  await prisma.petOwnedItem.deleteMany({ where: { userId: user.id, itemKey: ITEM } })
  console.log(`  已重置 pet.coins=${COST}, level=1, 清空 ${ITEM} 持有记录`)

  // --- 4. 并发 N 次 /buy 同一商品 ---
  const buyReqs = Array.from({ length: N }, () =>
    fetch(`${BASE}/api/v1/pet-shop/buy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `aie_token=${token}` },
      body: JSON.stringify({ itemKey: ITEM }),
    }).then((r) => r.status)
  )
  const statuses = await Promise.all(buyReqs)
  const tally = {}
  statuses.forEach((s) => { tally[s] = (tally[s] || 0) + 1 })
  console.log(`  并发 ${N} 次 /buy 结果: ${JSON.stringify(tally)}`)

  const successCount = tally[200] || 0
  const failCount = (tally[409] || 0) + (tally[400] || 0)

  // --- 5. 断言 ---
  check(`恰好 1 次成功 (200)`, successCount === 1, `实际 ${successCount}`)
  check(`其余 ${N - 1} 次失败 (409|400)`, failCount === N - 1, `实际 409=${tally[409] || 0} 400=${tally[400] || 0}`)

  // 最终 DB 校验
  const finalPet = await prisma.pet.findUnique({ where: { id: petId }, select: { coins: true } })
  const ownedCount = await prisma.petOwnedItem.count({ where: { userId: user.id, itemKey: ITEM } })
  check(`最终 coins=0（扣 ${COST}，不超扣 ${N * COST}）`, finalPet?.coins === 0, `实际 coins=${finalPet?.coins}`)
  check(`owned ${ITEM} 记录数=1（不重复）`, ownedCount === 1, `实际 ${ownedCount}`)

  // 核心反双花断言：净扣 = COST（而非 N*COST）
  const netDeduct = COST - (finalPet?.coins ?? 0)
  check(`净扣金币=${COST}（防双花核心：非 ${N * COST}）`, netDeduct === COST, `实际净扣 ${netDeduct}`)
} catch (e) {
  console.error('测试异常:', e)
} finally {
  await prisma.$disconnect()
  console.log(`\n=== 并发防双花测试: ${okCount}/${total} 通过 ===`)
  process.exit(okCount === total ? 0 : 1)
}
