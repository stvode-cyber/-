// Test bot reply: send @greenrhino_ai hello, wait, check bot log + poll room
const http = require('http')
const CONTINUUITY = 'http://127.0.0.1:8008'
const ADMIN_TOKEN = '7nLXqrFgZwjbnZoZiJ6KoygK'
const ADMIN_ROOM = '!3b7C96Koy6pTBSfIlgxi5-R77vvIdsnrq1lfI6495t8'

function req(path, method, body, auth = ADMIN_TOKEN) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONTINUUITY + path)
    const r = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
    }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ code: res.statusCode, body: d }))
    })
    r.on('error', reject)
    if (body) r.write(JSON.stringify(body))
    r.end()
  })
}

async function main() {
  const txnId = `bot_test_${Date.now()}`
  console.log('Sending test message: @greenrhino_ai 你好')
  let res = await req(`/_matrix/client/v3/rooms/${ADMIN_ROOM}/send/m.room.message/${txnId}`, 'PUT', {
    msgtype: 'm.text', body: '@greenrhino_ai 你好'
  })
  console.log('Send:', res.code, res.body)

  // Wait for bot to process (LLM call takes a few seconds)
  console.log('Waiting 8s for bot reply...')
  await new Promise(r => setTimeout(r, 8000))

  // Check latest room messages via /rooms/{roomId}/messages
  res = await req(`/_matrix/client/v3/rooms/${ADMIN_ROOM}/messages?dir=b&limit=5`, 'GET')
  if (res.code === 200) {
    const data = JSON.parse(res.body)
    const events = data.chunk || []
    console.log(`Latest ${events.length} messages:`)
    for (const e of events) {
      if (e.type === 'm.room.message') {
        console.log(`  [${new Date(e.origin_server_ts).toLocaleTimeString()}] ${e.sender}: ${e.content?.body?.slice(0,60)}`)
      }
    }
  }
}
main().catch(console.error)
