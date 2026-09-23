// VACUUM the dev.db to reclaim freed space from deletes
const { PrismaClient } = await import('@prisma/client')
const DB_PATH = 'C:/Users/Administrator/Desktop/助理项目/助理项目/APP-AIE/backend/prisma/dev.db'
process.env.DATABASE_URL = `file:${DB_PATH}`
const prisma = new PrismaClient()
try {
  console.log('Running VACUUM...')
  await prisma.$queryRaw`VACUUM`
  console.log('VACUUM complete')
} catch (e) {
  console.error('VACUUM failed:', e.message)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
