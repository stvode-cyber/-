// Phase 3: clean remaining orphaned scalar-only ownerId tables (ExecInstance)
const { PrismaClient } = await import('@prisma/client')

const DB_PATH = 'C:/Users/Administrator/Desktop/助理项目/助理项目/APP-AIE/backend/prisma/dev.db'
process.env.DATABASE_URL = `file:${DB_PATH}`

const prisma = new PrismaClient()

try {
  await prisma.$queryRaw`PRAGMA journal_mode=DELETE`
  await prisma.$queryRaw`PRAGMA defer_foreign_keys=ON`

  const beforeExec = await prisma.execInstance.count()
  console.log(`execInstances before: ${beforeExec}`)

  const del = await prisma.execInstance.deleteMany({})
  console.log(`deleted: execInstances=${del.count}`)

  // Final verification across ALL tables
  const tables = [
    'user', 'auditLog', 'petOwnedItem', 'space', 'folder', 'asset', 'tag', 'assetTag',
    'spaceMember', 'categoryRule', 'resourceZone', 'fetchJob', 'assetVersion',
    'shareLink', 'assetSource', 'execInstance', 'stickyNote', 'wallpaperSetting',
    'pushSubscription', 'countdown', 'countdownReminder', 'pet', 'wallet',
    'transaction', 'task', 'diet', 'sleep', 'bill', 'reminder', 'chatSession',
    'message', 'handover', 'post', 'comment', 'postLike', 'postFavorite',
    'conversation', 'conversationMessage', 'friendship', 'group', 'groupMember',
    'userHabit', 'trackHabit', 'trackHabitLog', 'manualEvent', 'hiddenEvent',
    'fragment', 'voiceMemo', 'realName',
  ]
  const counts = {}
  for (const t of tables) {
    try { counts[t] = await prisma[t].count() } catch (e) { counts[t] = `ERR:${e.message}` }
  }
  console.log('=== FINAL COUNTS ===')
  console.log(JSON.stringify(counts, null, 2))

  const nonzero = Object.entries(counts).filter(([k, v]) => typeof v === 'number' && v > 0)
  const PASS_STRICT = nonzero.length === 0
  const PASS_CONSTRAINT = counts.user === 0 && counts.auditLog === 0
  console.log(`\n=== HARD CONSTRAINT (users=0 AND audit_logs=0): ${PASS_CONSTRAINT ? 'PASS ✅' : 'FAIL ❌'} ===`)
  console.log(`=== STRICT (all tables = 0): ${PASS_STRICT ? 'PASS ✅' : 'FAIL ❌'} ===`)
  if (nonzero.length > 0) {
    console.log('Non-zero tables:')
    nonzero.forEach(([k, v]) => console.log(`  ${k}: ${v}`))
  }
  process.exit(PASS_STRICT ? 0 : 1)
} catch (e) {
  console.error('PHASE-3 CLEANUP FAILED:', e)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
