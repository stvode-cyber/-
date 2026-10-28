// Check android_releases tables: both MySQL (ERP) and SQLite (Express)
const { execSync } = require('child_process')

console.log('=== Express SQLite android_releases ===')
try {
  const r = execSync(`sqlite3 /root/backend-new/prisma/prod.db "SELECT id, version, downloadUrl, fileSize, md5, createdAt FROM android_releases ORDER BY id DESC LIMIT 5;"`, { encoding: 'utf8' })
  console.log(r || '(empty)')
} catch(e) { console.error('SQLite error:', e.message) }

console.log('\n=== Express SQLite windows_releases ===')
try {
  const r = execSync(`sqlite3 /root/backend-new/prisma/prod.db "SELECT id, version, setupSha256, createdAt FROM windows_releases ORDER BY id DESC LIMIT 5;"`, { encoding: 'utf8' })
  console.log(r || '(empty)')
} catch(e) { console.error(e.message) }

console.log('\n=== MySQL ERP android_releases ===')
try {
  const r = execSync(`mysql -uroot -p'ErpRoot2026@Sec' zhiyun_erp -e "SELECT id, appType, version, downloadUrl FROM android_releases ORDER BY id DESC LIMIT 5;"`, { encoding: 'utf8' })
  console.log(r || '(empty)')
} catch(e) { console.error('MySQL error:', e.message) }
