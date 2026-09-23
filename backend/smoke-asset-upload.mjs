// asset 上传 MIME 白名单 + 10MB 限额运行时测试
// 验证约束 #7：HTML/SVG/JS 上传被拒（415）、>10MB 被拒（422）、合法 PNG 通过（201）
// + gap 探针：省略 mime 字段上传 .html，探测白名单是否可绕过（mime 校验是 if(mime && ...)，省略则跳过）
process.env.DATABASE_URL = 'file:./dev.db'
import { PrismaClient } from '@prisma/client'

const BASE = 'http://127.0.0.1:3001'
const prisma = new PrismaClient()
let total = 0, okCount = 0
function check(name, ok, detail = '') { total++; if (ok) okCount++; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' -> ' + detail : ''}`) }

// 1x1 透明 PNG 的 base64（合法小图）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const TXT_B64 = 'dGVzdA==' // "test"

try {
  // --- 1. 注册 + 建 space ---
  const U = `asset_${Date.now()}`
  const regRes = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: U, password: 'Test1234', nickname: '资产测试' }),
  })
  const regJson = await regRes.json().catch(() => null)
  const token = regJson?.data?.token
  check('register 成功 + token', regRes.status === 200 && !!token, `status=${regRes.status}`)

  const user = await prisma.user.findUnique({ where: { username: U }, select: { id: true } })
  const space = await prisma.space.create({ data: { ownerId: user.id, name: 'smoke-asset' } })
  const spaceId = space.id
  console.log(`  已建 space: ${spaceId}`)

  const hdr = { 'Content-Type': 'application/json', Cookie: `aie_token=${token}` }
  const upload = (body) => fetch(`${BASE}/api/v1/assets/upload`, { method: 'POST', headers: hdr, body: JSON.stringify(body) }).then((r) => r.status)

  // --- 2. 危险 MIME 应被拒（415） ---
  console.log('\n--- 危险 MIME 拒绝（415）---')
  const htmlStatus = await upload({ spaceId, name: 'evil.html', mime: 'text/html', base64: TXT_B64 })
  check('text/html 被拒 415', htmlStatus === 415, `实际 ${htmlStatus}`)

  const svgStatus = await upload({ spaceId, name: 'evil.svg', mime: 'image/svg+xml', base64: TXT_B64 })
  check('image/svg+xml 被拒 415', svgStatus === 415, `实际 ${svgStatus}`)

  const jsStatus = await upload({ spaceId, name: 'evil.js', mime: 'application/javascript', base64: TXT_B64 })
  check('application/javascript 被拒 415', jsStatus === 415, `实际 ${jsStatus}`)

  // 补：text/html 大小写混合（应归一化后拒）
  const htmlMixed = await upload({ spaceId, name: 'x.html', mime: 'TEXT/HTML', base64: TXT_B64 })
  check('TEXT/HTML（大写）被拒 415', htmlMixed === 415, `实际 ${htmlMixed}`)

  // --- 3. >10MB base64 应被拒（422） ---
  console.log('\n--- 体积限额（10MB）---')
  // ASSET_MAX_BYTES = 10*1024*1024 = 10485760；base64 字符串长度 > 该值即触发 zod .max 422
  const oversized = 'A'.repeat(10485761) // 10MB + 1
  const bigStatus = await upload({ spaceId, name: 'big.png', mime: 'image/png', base64: oversized })
  check('>10MB base64 被拒 422', bigStatus === 422, `实际 ${bigStatus}`)

  // --- 4. 合法 PNG 应通过（201） ---
  console.log('\n--- 合法上传（201）---')
  const okStatus = await upload({ spaceId, name: 'ok.png', mime: 'image/png', base64: PNG_B64 })
  check('合法 image/png 上传成功 200|201', okStatus === 200 || okStatus === 201, `实际 ${okStatus}`)

  // --- 5. gap 探针：省略 mime 字段上传 .html ---
  console.log('\n--- gap 探针：省略 mime 上传 .html ---')
  const gapStatus = await upload({ spaceId, name: 'gap.html', base64: TXT_B64 }) // 无 mime 字段
  if (gapStatus === 201) {
    check('⚠ gap: 省略 mime 可上传 .html（白名单可绕过）', false, `实际 ${gapStatus}（潜在 stored XSS 风险：mime 校验为 if(mime&&...)，省略则跳过）`)
    // 清理该资产
    const gapAsset = await prisma.asset.findFirst({ where: { spaceId, name: 'gap.html' } })
    if (gapAsset) await prisma.asset.delete({ where: { id: gapAsset.id } })
  } else {
    check('省略 mime 上传 .html 被拒（白名单不可绕过）', gapStatus === 415 || gapStatus === 422, `实际 ${gapStatus}`)
  }

  // --- 清理 ---
  await prisma.asset.deleteMany({ where: { spaceId } })
  await prisma.space.delete({ where: { id: spaceId } })
  console.log('\n  已清理测试 space + assets')
} catch (e) {
  console.error('测试异常:', e)
} finally {
  await prisma.$disconnect()
  console.log(`\n=== asset 上传 MIME/限额测试: ${okCount}/${total} 通过 ===`)
  process.exit(okCount === total ? 0 : 1)
}
