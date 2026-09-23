// Verify the actual content of the bundled dev.db template using absolute paths.
// Hard constraint: "Packaged distribution must clean dev.db by setting audit_log and user tables to 0 entries"
import path from 'path'
import { PrismaClient } from '@prisma/client'

const dbs = [
  {
    name: 'backend/prisma/dev.db (source template)',
    path: 'C:/Users/Administrator/Desktop/助理项目/助理项目/APP-AIE/backend/prisma/dev.db',
  },
  {
    name: 'electron/resources/backend/prisma/dev.db (bundled template)',
    path: 'C:/Users/Administrator/Desktop/助理项目/助理项目/APP-AIE/electron/resources/backend/prisma/dev.db',
  },
]

for (const db of dbs) {
  process.env.DATABASE_URL = `file:${db.path}`
  const prisma = new PrismaClient()
  try {
    const users = await prisma.user.count()
    const auditLogs = await prisma.auditLog.count()
    const countdowns = await prisma.countdown.count()
    const info = await prisma.$queryRaw`PRAGMA database_list`
    console.log(`\n${db.name}:`)
    console.log(`  resolved file: ${info[0]?.file}`)
    console.log(`  users: ${users}`)
    console.log(`  audit_logs: ${auditLogs}`)
    console.log(`  countdowns: ${countdowns}`)
    if (users > 0 || auditLogs > 0) {
      console.log(`  STATUS: CONTAMINATED — violates "clean dev.db" constraint`)
    } else {
      console.log(`  STATUS: CLEAN — meets bootstrap constraint`)
    }
  } catch (e) {
    console.log(`\n${db.name}: ERROR - ${e.message}`)
  } finally {
    await prisma.$disconnect()
  }
}
