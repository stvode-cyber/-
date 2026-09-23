import jwt from 'jsonwebtoken'
const token = jwt.sign({ userId: 'gwtest', username: 'gw', role: 'user' }, 'd99989deabd14f5baf451316839511020fa3e1cc69e5d10b797cc953b5fbda11', { expiresIn: '24h' })
const bodyText = JSON.stringify({ messages: [{ role: 'user', content: '请回复：本地云网关转发链路测试通过' }] })
console.log('REQUEST_BODY=', bodyText)
const r = await fetch('http://47.116.59.141:3001/api/v1/ai/proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: bodyText,
})
console.log('STATUS=', r.status)
console.log('RESP=', (await r.text()).slice(0, 400))