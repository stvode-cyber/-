// 验证 prod.db：表数量 + 用户数（服务器部署验证用）
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
;(async () => {
  const users = await p.user.count()
  const tables = await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  console.log('users:', users)
  console.log('tables:', tables.length)
  await p.$disconnect()
})().catch(async (e) => { console.error('ERR', e.message); await p.$disconnect(); process.exit(1) })