// 清理 dev.db 中的 smoke 测试污染（auth/doublespend/asset smoke 产生的测试用户及其级联数据）
// 打包前可运行此脚本恢复 dev.db 干净态；不删除合法开发用户。
// 匹配模式：smoketest | smoke_* | dp_* | asset_*（smoke 测试套件创建的用户名约定）
process.env.DATABASE_URL = 'file:./dev.db'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// smoke 测试用户名匹配模式
const SMOKE_PATTERNS = [
  { username: 'smoketest' },
  { username: { startsWith: 'smoke_' } },
  { username: { startsWith: 'dp_' } },
  { username: { startsWith: 'asset_' } },
]

try {
  // --- 1. 统计清理前 ---
  const smokeUsers = await prisma.user.findMany({
    where: { OR: SMOKE_PATTERNS },
    select: { id: true, username: true },
  })
  const userIds = smokeUsers.map((u) => u.id)
  console.log(`找到 ${smokeUsers.length} 个 smoke 测试用户:`)
  smokeUsers.forEach((u) => console.log(`  - ${u.username} (${u.id})`))

  if (userIds.length === 0) {
    console.log('\n无需清理：dev.db 无 smoke 测试用户。')
    process.exit(0)
  }

  const before = {
    spaces: await prisma.space.count({ where: { ownerId: { in: userIds } } }),
    pets: await prisma.pet.count({ where: { userId: { in: userIds } } }),
    assets: await prisma.asset.count({ where: { ownerId: { in: userIds } } }),
    ownedItems: await prisma.petOwnedItem.count({ where: { userId: { in: userIds } } }),
    auditLogs: await prisma.auditLog.count({ where: { userId: { in: userIds } } }),
  }
  console.log(`\n清理前（级联范围内）: spaces=${before.spaces} pets=${before.pets} assets=${before.assets} ownedItems=${before.ownedItems} auditLogs=${before.auditLogs}`)

  // --- 2. 删除（标量 userId 无 FK 级联的表需手动；user 删除触发 Space→Folder→Asset、Pet、Wallet 等级联）---
  // PetOwnedItem 与 AuditLog 均为标量 userId（无 user 关联），不会随 user 级联，需先手动清理
  const delOwnedItems = await prisma.petOwnedItem.deleteMany({ where: { userId: { in: userIds } } })
  const delAudit = await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } })
  // 删 user（触发 Space→Folder→Asset、Pet、Wallet 等级联；PetOwnedItem 已手动清理）
  const delUsers = await prisma.user.deleteMany({ where: { id: { in: userIds } } })

  // --- 3. 统计清理后 ---
  const after = {
    spaces: await prisma.space.count({ where: { ownerId: { in: userIds } } }),
    pets: await prisma.pet.count({ where: { userId: { in: userIds } } }),
    assets: await prisma.asset.count({ where: { ownerId: { in: userIds } } }),
    ownedItems: await prisma.petOwnedItem.count({ where: { userId: { in: userIds } } }),
    auditLogs: await prisma.auditLog.count({ where: { userId: { in: userIds } } }),
    users: await prisma.user.count({ where: { OR: SMOKE_PATTERNS } }),
  }

  console.log(`\n删除：users=${delUsers.count} ownedItems=${delOwnedItems.count} auditLogs=${delAudit.count}`)
  console.log(`\n清理后（级联残留校验，应全为 0）: spaces=${after.spaces} pets=${after.pets} assets=${after.assets} ownedItems=${after.ownedItems} auditLogs=${after.auditLogs} smokeUsers=${after.users}`)

  const clean = after.spaces === 0 && after.pets === 0 && after.assets === 0 && after.ownedItems === 0 && after.auditLogs === 0 && after.users === 0
  console.log(`\n=== dev.db smoke 清理: ${clean ? 'PASS（全 0 残留）' : 'FAIL（有残留）'} ===`)
  process.exit(clean ? 0 : 1)
} catch (e) {
  console.error('清理异常:', e)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
