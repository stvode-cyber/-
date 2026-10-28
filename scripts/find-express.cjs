// Check for leftover Express files + find .env / prod.db backups
const { execSync } = require('child_process')

const cmds = [
  // find prod.db and .env files
  'find /root /opt -maxdepth 5 -name "prod.db" 2>/dev/null',
  'find /root /opt -maxdepth 5 -name ".env" 2>/dev/null',
  // any android_releases .db
  'find /root /opt -maxdepth 5 -name "*.db" 2>/dev/null | grep -v "node_modules\\|pm2"',
  // pm2 app-backend log tail
  "tail -20 /root/.pm2/logs/app-backend-out.log 2>&1",
  "tail -20 /root/.pm2/logs/app-backend-error.log 2>&1",
  // check if /usr/share/nginx/html/apk/ is still there
  "ls /usr/share/nginx/html/apk/*.apk 2>&1",
]

for (const c of cmds) {
  console.log(`=== ${c.split('|')[0].slice(0, 60)} ===`)
  try { console.log(execSync(c, { encoding: 'utf8', timeout: 10000 }).slice(0, 3000)) }
  catch(e) { console.error('ERR:', e.message) }
}
