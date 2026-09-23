/**
 * P4+ A/B 效果统计 冒烟测试
 * 覆盖：权限 403、days 夹取、埋点（问候 metadata.abBucket 快照）、
 *       曝光/24h 回复率/活跃/记账/待办指标按桶聚合、结构完整性、配置恢复
 * 运行：node smoke-ab-stats.mjs（后端需已启动）
 */
import { prisma } from './dist/lib/prisma.js'
import { bucketOf, getAgentConfig, describeAgentConfig, writeAgentConfig } from './dist/services/agentConfig.js'

const BASE = 'http://127.0.0.1:3001/api/v1'
const results = []
let token = ''
let testToken = ''

function ok(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail })
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function req(method, path, body, opts = {}) {
  const t = opts.asTest ? testToken : token
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(t && !opts.noAuth ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* ignore */ }
  return { status: r.status, json }
}

async function main() {
  const ts = Date.now()

  // 0. 登录
  let r = await req('POST', '/auth/login', { username: 'admin', password: 'admin123456' }, { noAuth: true })
  token = r.json?.data?.token || ''
  ok('登录 admin', !!token)
  r = await req('POST', '/auth/login', { username: 'test', password: 'Test1234' }, { noAuth: true })
  testToken = r.json?.data?.token || ''
  const testUser = await prisma.user.findUnique({ where: { username: 'test' }, select: { id: true } })
  ok('登录 test', !!testToken && !!testUser)
  const original = structuredClone(describeAgentConfig().config)
  const testBucket = bucketOf(testUser.id)

  // 1. 权限 + 参数
  r = await req('GET', '/admin/ab-stats', null, { asTest: true })
  ok('非管理员 403', r.status === 403)
  r = await req('GET', '/admin/ab-stats?days=999')
  let stats = r.json?.data
  ok('GET ab-stats 结构完整', stats?.buckets?.length === 2 && typeof stats.abEnabled === 'boolean' && !!stats.since)
  ok('days 超界夹取 90', stats?.days === 90, `days=${stats?.days}`)
  r = await req('GET', '/admin/ab-stats?days=0')
  ok('days=0 夹取 1', r.json?.data?.days === 1, `days=${r.json?.data?.days}`)

  // 2. 开 A/B 双池 → 造问候（埋点快照）+ 互动 + 记账 + 待办完成
  const mk = (m) => ({
    timePools: { morning: [m], noon: [m], evening: [m], late: [m] },
    relationPools: { first: [m], returning: [m], daily: [m], streak: [m] },
    casualNotes: [], noteProb: 0,
  })
  r = await req('PUT', '/admin/agent-config', {
    ...original,
    abTest: { enabled: true },
    greeting: { A: mk(`AB统计A${ts}`), B: mk(`AB统计B${ts}`) },
    weeklyNotes: { A: [`AB统计W${ts}`], B: [`AB统计W${ts}`] },
    personaPrompt: '',
  })
  ok('PUT 开启 A/B 双池', r.json?.code === 200)

  r = await req('POST', '/chat/sessions', { title: 'AB 统计冒烟' }, { asTest: true })
  const sid = r.json?.data?.id
  r = await req('GET', `/chat/sessions/${sid}/messages`, null, { asTest: true })
  const greetingMsg = (r.json?.data || []).find((m) => m.role === 'assistant' && m.metadata)
  const gMeta = JSON.parse(greetingMsg?.metadata || '{}')
  ok(`问候埋点含 abBucket=${testBucket} 快照`, gMeta.abBucket === testBucket, JSON.stringify(gMeta))

  // 互动：test 在该会话回一条（计回复率分子）
  r = await req('POST', `/chat/sessions/${sid}/messages`, { content: '嗯，在呢' }, { asTest: true })
  ok('test 会话互动消息', r.json?.code === 200 || r.status === 200)
  // 记账 + 待办完成（直接造数，避免依赖 LLM）
  await prisma.bill.create({ data: { userId: testUser.id, type: 'expense', amount: 12.5, category: '食物', title: `AB冒烟${ts}` } })
  const t = await prisma.task.create({ data: { userId: testUser.id, title: `AB冒烟待办${ts}`, status: 'done' } })

  // 3. 统计指标验证（days=1 窗口聚焦今天数据）
  r = await req('GET', '/admin/ab-stats?days=1')
  stats = r.json?.data
  const mine = stats.buckets.find((x) => x.bucket === testBucket)
  const other = stats.buckets.find((x) => x.bucket !== testBucket)
  ok('曝光按快照分桶（本桶 ≥1）', mine.greetingCount >= 1, `A=${stats.buckets[0].greetingCount}/B=${stats.buckets[1].greetingCount}`)
  ok('回复率 100%（刚互动过）', mine.replyRate === 100, `replyRate=${mine.replyRate}`)
  ok('活跃用户计入本桶', mine.activeUsers >= 1)
  ok('人均消息 ≥1', (mine.msgPerActiveUser ?? 0) >= 1)
  ok('记账计入本桶', mine.billCount >= 1)
  ok('待办完成计入本桶', mine.taskDone >= 1)
  ok('abEnabled/hasBPools 反映配置', stats.abEnabled === true && stats.hasBPools === true)

  // 4. 清理 + 恢复配置
  await prisma.bill.deleteMany({ where: { title: `AB冒烟${ts}` } })
  await prisma.task.deleteMany({ where: { id: t.id } })
  r = await req('PUT', '/admin/agent-config', original)
  ok('恢复原配置', r.json?.code === 200 && getAgentConfig().abTest.enabled === original.abTest.enabled)

  const fail = results.filter((x) => !x.pass)
  console.log(`\n${fail.length === 0 ? '🎉 全部通过' : '💥 存在失败'}：${results.length - fail.length}/${results.length}`)
  await prisma.$disconnect()
  process.exit(fail.length === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('冒烟脚本异常:', e)
  await prisma.$disconnect()
  process.exit(1)
})
