// 验证 dev.db 清理后状态：合法用户保留、无 smoke 残留、无孤儿引用
process.env.DATABASE_URL = 'file:./dev.db'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const SMOKE_PATTERNS = [
  { username: 'smoketest' },
  { username: { startsWith: 'smoke_' } },
  { username: { startsWith: 'dp_' } },
  { username: { startsWith: 'asset_' } },
]

try {
  const users = await prisma.user.findMany({ select: { id: true, username: true, createdAt: true } })
  const smokeUsers = users.filter((u) => SMOKE_PATTERNS.some((p) => {
    if (p.username === u.username) return true
    const pref = p.username.startsWith
    return pref ? u.username.startsWith(pref) : false
  }))
  const auditLogs = await prisma.auditLog.count()
  const pets = await prisma.pet.count()
  const ownedItems = await prisma.petOwnedItem.count()
  const spaces = await prisma.space.count()

  // 孤儿校验：PetOwnedItem.userId 是否都在 User 表
  const allOwned = await prisma.petOwnedItem.findMany({ select: { userId: true } })
  const userIdSet = new Set(users.map((u) => u.id))
  const orphanOwned = allOwned.filter((o) => !userIdSet.has(o.userId))

  console.log('=== dev.db 清理后状态 ===')
  console.log(`users: ${users.length} (合法 ${users.length - smokeUsers.length}, smoke 残留 ${smokeUsers.length})`)
  console.log(`audit_logs: ${auditLogs}`)
  console.log(`pets: ${pets}`)
  console.log(`pet_owned_items: ${ownedItems} (孤儿 ${orphanOwned.length})`)
  console.log(`spaces: ${spaces}`)
  console.log('\n合法用户列表:')
  users.filter((u) => !smokeUsers.includes(u)).forEach((u) => console.log(`  - ${u.username} (${u.id.slice(-8)}) 创建于 ${u.createdAt.toISOString().slice(0, 10)}`))

  const clean = smokeUsers.length === 0 && orphanOwned.length === 0
  console.log(`\n=== 综合校验: ${clean ? 'PASS（dev.db 干净）' : 'FAIL（有残留）'} ===`)
  process.exit(clean ? 0 : 1)
} catch (e) {
  console.error('校验异常:', e.message)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
