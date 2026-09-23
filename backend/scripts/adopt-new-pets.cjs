const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const USER_ID = 'cmsvkziv20003w4tgkibgv5qz'

const NEW_PETS = [
  { name: '灰灰', species: 'cat' },
  { name: '小青', species: 'snake' },
]

async function main() {
  const before = await db.pet.count({ where: { userId: USER_ID } })
  if (before + NEW_PETS.length > 5) throw new Error(`当前已有 ${before} 只，超出 5 只上限`)
  for (const p of NEW_PETS) {
    const created = await db.pet.create({ data: { userId: USER_ID, name: p.name, species: p.species } })
    console.log(`已领养: ${created.name} (${created.species}) id=${created.id} 属性: 饥饿${created.hunger} 心情${created.mood} 清洁${created.clean} 精力${created.energy} 金币${created.coins}`)
  }
  const after = await db.pet.count({ where: { userId: USER_ID } })
  console.log(`宠物总数: ${before} -> ${after} / 5`)
  await db.$disconnect()
}
main()
