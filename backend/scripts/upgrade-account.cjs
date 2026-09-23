const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const USER_ID = 'cmsvkziv20003w4tgkibgv5qz'

// Lv24 需要总在线 24*23/2*60 = 16560 分钟 → maxPets = 1 + floor(24/6) = 5
const MINUTES = 16560

async function main() {
  const before = await db.user.findUnique({ where: { id: USER_ID }, select: { totalOnlineMinutes: true, activePetId: true } })
  await db.user.update({ where: { id: USER_ID }, data: { totalOnlineMinutes: MINUTES } })
  const level = Math.floor((1 + Math.sqrt(1 + (4 * MINUTES) / 30)) / 2)
  console.log(`在线时长 ${before.totalOnlineMinutes} -> ${MINUTES} 分钟，等级 Lv${level}，宠物栏 1+floor(${level}/6)=5`)
  await db.$disconnect()
}
main()
