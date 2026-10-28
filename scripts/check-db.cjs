const { PrismaClient } = require('/opt/aie-app/node_modules/@prisma/client')
const p = new PrismaClient()

async function main() {
  // Show all tables via raw query
  const r = await p.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  console.log('Tables:', r)

  // Show AndroidRelease
  try {
    const ar = await p.androidRelease.findMany({ take: 5 })
    console.log('AndroidRelease count:', ar.length)
    for (const a of ar) console.log(' -', a.version, a.apkUrl)
  } catch(e) { console.error('AndroidRelease error:', e.message) }

  // Show WindowsRelease  
  try {
    const wr = await p.windowsRelease.findMany({ take: 5 })
    console.log('WindowsRelease count:', wr.length)
    for (const w of wr) console.log(' -', w.version)
  } catch(e) { console.error('WindowsRelease error:', e.message) }
}
main().then(() => p.$disconnect()).catch(e => { console.error(e); p.$disconnect() })
