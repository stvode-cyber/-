// Setup Matrix Bot: try login → if fails, send admin room command to create user → login again
// Run on server: node setup-bot.cjs

const http = require('http')

const CONTINUUITY = process.env.CONTINUUITY_URL || 'http://127.0.0.1:8008'
const ADMIN_TOKEN = process.env.CONTINUUITY_ADMIN_TOKEN || '7nLXqrFgZwjbnZoZiJ6KoygK'
const ADMIN_ROOM = process.env.CONTINUUITY_ADMIN_ROOM || '!3b7C96Koy6pTBSfIlgxi5-R77vvIdsnrq1lfI6495t8'
const BOT_USER = process.env.MATRIX_BOT_USERNAME || 'greenrhino_ai'
const BOT_PWD = process.env.MATRIX_BOT_PASSWORD || '0BnzmtPrE5v4Lhye6XuxGcJiYWVf2QOF'

function matrixPost(path, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONTINUUITY + path)
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.admin ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
      },
    }, (res) => {
      let data = ''
      res.on('data', (c) => data += c)
      res.on('end', () => {
        try { resolve({ code: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ code: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    req.write(JSON.stringify(body))
    req.end()
  })
}

function matrixPut(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONTINUUITY + path)
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
      },
    }, (res) => {
      let data = ''
      res.on('data', (c) => data += c)
      res.on('end', () => {
        try { resolve({ code: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ code: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    req.write(JSON.stringify(body))
    req.end()
  })
}

async function main() {
  console.log('=== Matrix Bot Setup ===')
  console.log(`Bot: ${BOT_USER}, Password: ${BOT_PWD.slice(0,4)}...`)

  // Step 1: Try login
  console.log('\n1. Try login (check if bot exists)...')
  let res = await matrixPost('/_matrix/client/v3/login', {
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: BOT_USER },
    password: BOT_PWD,
  })
  if (res.code === 200 && res.body.access_token) {
    console.log(`✅ Bot already exists! userId=${res.body.user_id}`)
    console.log(`   access_token=${res.body.access_token.slice(0,20)}...`)
    return
  }

  // Step 2: Create via admin room
  console.log(`2. Creating bot via admin room command...`)
  const txnId = `greenrhino_bot_${Date.now()}`
  res = await matrixPut(
    `/_matrix/client/v3/rooms/${ADMIN_ROOM}/send/m.room.message/${txnId}`,
    { msgtype: 'm.text', body: `!admin users create-user ${BOT_USER} ${BOT_PWD}` },
  )
  console.log(`   Admin command sent: code=${res.code}`)

  // Step 3: Wait + login
  console.log('3. Wait 3s + retry login...')
  await new Promise(r => setTimeout(r, 3000))
  res = await matrixPost('/_matrix/client/v3/login', {
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: BOT_USER },
    password: BOT_PWD,
  })
  if (res.code === 200 && res.body.access_token) {
    console.log(`✅ Bot created & logged in! userId=${res.body.user_id}`)
    console.log(`   access_token=${res.body.access_token.slice(0,20)}...`)
    return
  }
  console.error(`❌ Login still failed: ${JSON.stringify(res.body)}`)
  process.exit(1)
}

main().catch(console.error)
