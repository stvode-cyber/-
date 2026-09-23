const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const USER_ID = 'cmsvkziv20003w4tgkibgv5qz'

async function main() {
  const u = await db.user.findUnique({ where: { id: USER_ID }, select: { totalOnlineMinutes: true } })
  const pets = await db.pet.count({ where: { userId: USER_ID } })
  const lv = Math.floor((1 + Math.sqrt(1 + (4 * u.totalOnlineMinutes) / 30)) / 2)
  const maxPets = 1 + Math.floor(lv / 6)
  console.log(JSON.stringify({ totalOnlineMinutes: u.totalOnlineMinutes, computedLevel: lv, maxPets, currentPets: pets }, null, 2))
  await db.$disconnect()
}
main()
