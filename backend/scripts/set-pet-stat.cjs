const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

const field = process.argv[2]
const val = parseInt(process.argv[3], 10)

async function main() {
  const pet = await db.pet.findFirst({ where: { species: process.argv[4] || 'shiba' }, orderBy: { updatedAt: 'desc' } })
  if (!pet) { console.log('shiba pet not found'); process.exit(1) }
  await db.pet.update({ where: { id: pet.id }, data: { [field]: val, lastUpdated: new Date() } })
  console.log(`${pet.name}: ${field}=${val}`)
  await db.$disconnect()
}
main()
