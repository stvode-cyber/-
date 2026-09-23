const process = require('process')
process.chdir('c:/Users/Administrator/Desktop/助理项目/助理项目/APP-AIE/backend')
process.env.DATABASE_URL = 'file:C:/Users/Administrator/AppData/Roaming/aie-desktop/data/aie.db'
let PrismaClient
try { ({ PrismaClient } = require('./dist/generated/prisma/index.js')) } catch { ({ PrismaClient } = require('@prisma/client')) }
const p = new PrismaClient()

async function main() {
  const u = await p.user.findFirst({ where: { username: 'travel_tmp1' } })
  if (!u) { console.log('no user'); return }
  const tasks = await p.task.findMany({ where: { userId: u.id } })
  console.log('tasks:', JSON.stringify(tasks.map((t) => ({ title: t.title, dueDate: t.dueDate, status: t.status }))))
  const rems = await p.reminder.findMany({ where: { userId: u.id } })
  console.log('reminders:', JSON.stringify(rems.map((r) => ({ title: r.title, content: r.content, remindAt: r.remindAt }))))
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1) }).finally(() => p.$disconnect())
