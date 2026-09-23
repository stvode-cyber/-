const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(
  'C:/Users/Administrator/AppData/Roaming/aie-desktop/data/aie.db',
  { readOnly: true }
)
// 找到 countdown 相关表
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%countdown%'").all().map(r=>r.name)
console.log('countdown 相关表:', tables.join(', ') || '无')
if (tables.includes('countdowns')) {
  const cols = db.prepare("PRAGMA table_info(countdowns)").all()
  console.log('列:', cols.map(c=>`${c.name}(${c.type})`).join(' '))
  const rows = db.prepare('SELECT * FROM countdowns').all()
  console.log('countdowns 记录数:', rows.length)
  for (const r of rows) {
    console.log('---')
    console.log('id:', r.id, '| type:', r.type, '| status:', r.status)
    console.log('title:', r.title)
    console.log('targetDate:', r.targetDate)
    console.log('recurringConfig:', r.recurringConfig)
    console.log('createdDate:', r.createdDate, '| progress:', r.progress, '| linkedModules:', r.linkedModules)
  }
}