// 后端 auth 链运行时 smoke test：register → login → cookie 访问受保护端点
// 验证协同生效：password 正则 + bcrypt + JWT 签发 + HttpOnly Cookie + authRequired + wallet 路由
// 注意：auth 路由限流 10 次/分钟（authRateLimit），本测试约 6 次调用，
//   但若 60 秒内重复运行会触发 429——属正确行为，间隔 ≥60s 重跑即可。
// 用户名带时间戳后缀，保证每次运行独立（不因用户已存在而 409）。
const BASE = 'http://127.0.0.1:3001'
const U = `smoke_${Date.now()}`, P = 'Test1234' // 满足 min8 + 字母 + 数字

function pass(name, ok, detail = '') { console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' -> ' + detail : ''}`) }

let total = 0, okCount = 0
function check(name, ok, detail = '') { total++; if (ok) okCount++; pass(name, ok, detail) }

// --- 1. 注册 ---
const regRes = await fetch(`${BASE}/api/v1/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: U, password: P, nickname: '冒烟测试' }),
})
const regJson = await regRes.json().catch(() => null)
check('register 状态码 200|201', regRes.status === 200 || regRes.status === 201, `实际 ${regRes.status}`)
check('register 返回 token', !!(regJson?.data?.token || regJson?.data?.user), JSON.stringify(regJson?.data || regJson).slice(0, 100))

// 提取 Set-Cookie（验证 HttpOnly + SameSite）
const regSetCookie = regRes.headers.get('set-cookie') || ''
check('register Set-Cookie 含 HttpOnly', regSetCookie.includes('HttpOnly'), regSetCookie.slice(0, 120))
check('register Set-Cookie 含 SameSite=Lax', regSetCookie.includes('SameSite=Lax'), '')
check('register Set-Cookie 含 aie_token', regSetCookie.includes('aie_token='), '')

// 从 cookie 提取 token（供后续 Authorization header fallback 用）
const tokenMatch = regSetCookie.match(/aie_token=([^;]+)/)
const regToken = tokenMatch ? tokenMatch[1] : (regJson?.data?.token || '')

// --- 2. 重复注册应拒绝（防重复） ---
const dupRes = await fetch(`${BASE}/api/v1/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: U, password: P }),
})
check('重复 register 拒绝 (409/400)', dupRes.status === 409 || dupRes.status === 400, `实际 ${dupRes.status}`)

// --- 3. 弱密码注册应拒绝（password 正则） ---
const weakRes = await fetch(`${BASE}/api/v1/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'weaktest', password: 'allletters' }), // 无数字
})
check('弱密码(无数字) register 拒绝 422', weakRes.status === 422, `实际 ${weakRes.status}`)
const weak2 = await fetch(`${BASE}/api/v1/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'weaktest2', password: 'short1' }), // <8
})
check('短密码(<8) register 拒绝 422', weak2.status === 422, `实际 ${weak2.status}`)

// --- 4. 登录 ---
const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: U, password: P }),
})
const loginJson = await loginRes.json().catch(() => null)
check('login 状态码 200', loginRes.status === 200, `实际 ${loginRes.status}`)
const loginSetCookie = loginRes.headers.get('set-cookie') || ''
check('login Set-Cookie 含 HttpOnly', loginSetCookie.includes('HttpOnly'), loginSetCookie.slice(0, 120))
const loginToken = loginSetCookie.match(/aie_token=([^;]+)/)?.[1] || loginJson?.data?.token || ''

// --- 5. 错误密码登录应拒绝 ---
const badLogin = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: U, password: 'WrongPassword1' }),
})
check('错误密码 login 拒绝 401', badLogin.status === 401, `实际 ${badLogin.status}`)

// --- 6. 受保护端点：无 token 应 401 ---
const noAuth = await fetch(`${BASE}/api/v1/wallet`, {})
check('无 token 访问 wallet 返回 401', noAuth.status === 401, `实际 ${noAuth.status}`)

// --- 7. 受保护端点：带 cookie 访问应 200（authRequired 接受 cookie） ---
const cookieAuth = await fetch(`${BASE}/api/v1/wallet`, {
  headers: { Cookie: `aie_token=${loginToken}` },
})
check('带 cookie 访问 wallet 返回 200', cookieAuth.status === 200, `实际 ${cookieAuth.status}`)
const walletJson = await cookieAuth.json().catch(() => null)
check('wallet 返回 balance 字段', typeof walletJson?.data?.balance === 'number' || typeof walletJson?.data?.wallet?.balance === 'number', JSON.stringify(walletJson?.data || walletJson).slice(0, 100))

// --- 8. 受保护端点：带 Authorization header 访问应 200（Electron fallback） ---
const headerAuth = await fetch(`${BASE}/api/v1/wallet`, {
  headers: { Authorization: `Bearer ${loginToken}` },
})
check('带 Authorization header 访问 wallet 返回 200', headerAuth.status === 200, `实际 ${headerAuth.status}`)

// --- 9. 钱包限额：充值 >5000 应拒绝 ---
const overLimit = await fetch(`${BASE}/api/v1/wallet/recharge`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `aie_token=${loginToken}` },
  body: JSON.stringify({ amount: 5001, channel: 'wechat' }),
})
check('充值 >5000 拒绝 422/400', overLimit.status === 422 || overLimit.status === 400, `实际 ${overLimit.status}`)

console.log(`\n=== auth 链 smoke test: ${okCount}/${total} 通过 ===`)
process.exit(okCount === total ? 0 : 1)
