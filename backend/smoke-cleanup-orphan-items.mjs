// 一次性脚本：清理 PetOwnedItem 中引用了已不存在用户的孤儿记录
// PetOwnedItem.userId 为标量字段（无 FK 级联），删除 user 后会残留指向已删 user 的孤儿行
process.env.DATABASE_URL = 'file:./dev.db'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

try {
  const all = await prisma.petOwnedItem.findMany()
  console.log(`total PetOwnedItem: ${all.length}`)
  if (all.length === 0) {
    console.log('无 PetOwnedItem 记录，无需清理。')
    process.exit(0)
  }
  const userIds = [...new Set(all.map((x) => x.userId))]
  const existing = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true },
  })
  const existingIds = new Set(existing.map((u) => u.id))
  const orphans = all.filter((x) => !existingIds.has(x.userId))
  console.log(`orphan PetOwnedItem: ${orphans.length}`)
  if (orphans.length === 0) {
    console.log('无孤儿记录，dev.db 干净。')
    process.exit(0)
  }
  console.log('孤儿详情:', JSON.stringify(orphans, null, 2))
  const r = await prisma.petOwnedItem.deleteMany({
    where: { id: { in: orphans.map((x) => x.id) } },
  })
  console.log(`已删除孤儿: ${r.count}`)
  // 校验
  const after = await prisma.petOwnedItem.count()
  console.log(`清理后 PetOwnedItem 总数: ${after}（应等于存活用户持有的记录数）`)
  console.log('=== 孤儿清理: PASS ===')
  process.exit(0)
} catch (e) {
  console.error('清理异常:', e.message)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
