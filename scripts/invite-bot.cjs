// Invite bot to admin room
const http = require('http')
const ADMIN_TOKEN = '7nLXqrFgZwjbnZoZiJ6KoygK'
const ADMIN_ROOM = '!3b7C96Koy6pTBSfIlgxi5-R77vvIdsnrq1lfI6495t8'
const BOT_USER = '@greenrhino_ai:lujax.fun'

function req(path, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('http://127.0.0.1:8008' + path)
    const r = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ code: res.statusCode, body: d }))
    })
    r.on('error', reject)
    if (body) r.write(JSON.stringify(body))
    r.end()
  })
}

async function main() {
  console.log(`Inviting ${BOT_USER} to ${ADMIN_ROOM}...`)
  let res = await req(`/_matrix/client/v3/rooms/${ADMIN_ROOM}/invite`, 'POST', { user_id: BOT_USER })
  console.log('Invite:', res.code, res.body)

  // Bot auto-accepts, check after 3s
  await new Promise(r => setTimeout(r, 3000))
  res = await req(`/_matrix/client/v3/rooms/${ADMIN_ROOM}/joined_members`, 'GET')
  if (res.code === 200) {
    const joined = Object.keys(JSON.parse(res.body).joined || {})
    console.log(`Members (${joined.length}):`, joined)
    console.log(`Bot in room? ${joined.includes(BOT_USER) ? 'YES ✅' : 'NO ❌'}`)
  } else {
    console.log('Cannot check members:', res.code)
  }
}
main().catch(console.error)
