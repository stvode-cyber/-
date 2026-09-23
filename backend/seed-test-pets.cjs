const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  // cardtest1 提升在线时长到 Lv12（360 分钟起步），maxPets=3
  const user = await p.user.update({
    where: { username: 'cardtest1' },
    data: { totalOnlineMinutes: 400 },
  })
  console.log('user level minutes:', user.totalOnlineMinutes)

  const pets = await p.pet.findMany({ where: { userId: user.id } })
  console.log('pets before:', pets.map((x) => `${x.name}:${x.species}`).join(', '))
  if (pets.length >= 1) await p.pet.update({ where: { id: pets[0].id }, data: { species: 'shiba' } })
  if (pets.length >= 2) await p.pet.update({ where: { id: pets[1].id }, data: { species: 'panda' } })
  if (pets.length < 3) {
    await p.pet.create({
      data: {
        userId: user.id,
        name: '柯基测试',
        species: 'corgi',
      },
    })
  } else if (pets[2].species !== 'corgi') {
    await p.pet.update({ where: { id: pets[2].id }, data: { species: 'corgi' } })
  }
  const after = await p.pet.findMany({ where: { userId: user.id } })
  console.log('pets after:', after.map((x) => `${x.name}:${x.species}`).join(', '))
  await p.user.update({ where: { id: user.id }, data: { activePetId: after[0].id } })
  await p.$disconnect()
}
main().catch((e) => { console.error(e.message); process.exit(1) })
