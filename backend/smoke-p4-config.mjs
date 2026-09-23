/**
 * P4 运营配置化 冒烟测试
 * 覆盖：admin 配置端点读写/校验 422、PUT 热更即时生效（问候语料）、A/B 稳定分桶、
 *       人设覆盖与内置回归、POST reload 外部改文件热更、审计日志、配置恢复
 * 运行：node smoke-p4-config.mjs（后端需已启动）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from './dist/lib/prisma.js'
import { bucketOf, getGreetingConfig, getWeeklyNotes, getPersonaPrompt, getAgentConfig } from './dist/services/agentConfig.js'
import { buildSystemPrompt } from './dist/services/llmService.js'

const BASE = 'http://127.0.0.1:3001/api/v1'
const CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'config/agent-config.json')
const results = []
let token = ''
let testToken = ''

function ok(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail })
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function req(method, path_, body, opts = {}) {
  const t = opts.asTest ? testToken : token
  const r = await fetch(`${BASE}${path_}`, {
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

/** 最小 ctx（满足 buildSystemPrompt 全字段访问） */
function miniCtx(userId) {
  return {
    userId,
    hour: 10,
    tasks: { todayPendingCount: 0, todayPending: [], todayDoneCount: 0 },
    finance: { walletBalance: null, walletFrozen: 0, todayExpense: 0, monthExpense: 0, monthIncome: 0 },
    health: { todayMeals: 0, totalCalories: 0, lastSleep: null },
    countdowns: { items: [] },
    fragments: { undigestedCount: 0 },
    habits: null,
    statusScore: { taskPressure: 10, overallEnergy: 80 },
    chatHistory: [],
  }
}

async function main() {
  const ts = Date.now()
  const MARK_A = `P4热更A${ts}`
  const MARK_B = `P4热更B${ts}`
  const MARK_C = `P4外部C${ts}`
  const MARK_W = `P4周报W${ts}`

  // 0. 登录
  let r = await req('POST', '/auth/login', { username: 'admin', password: 'admin123456' }, { noAuth: true })
  token = r.json?.data?.token || ''
  ok('登录 admin', !!token)
  r = await req('POST', '/auth/login', { username: 'test', password: 'Test1234' }, { noAuth: true })
  testToken = r.json?.data?.token || ''
  const testUser = await prisma.user.findUnique({ where: { username: 'test' }, select: { id: true } })
  ok('登录 test', !!testToken && !!testUser)

  // 1. GET 配置
  r = await req('GET', '/admin/agent-config')
  const desc = r.json?.data
  ok('GET agent-config 返回 config/file/defaults', !!desc?.config?.greeting?.A && !!desc?.file && !!desc?.defaults?.greeting?.A)
  ok('文件信息含 exists/mtime', typeof desc?.file?.exists === 'boolean' && (desc.file.exists ? !!desc.file.mtime : true))
  const original = structuredClone(desc.config) // 结尾恢复用

  // 2. 权限：普通用户 403
  r = await req('GET', '/admin/agent-config', null, { asTest: true })
  ok('非管理员访问 403', r.status === 403)

  // 3. PUT 热更问候语料（全池 marker，noteProb=0 保证确定性）+ 周报 marker
  const variantA = {
    timePools: { morning: [MARK_A], noon: [MARK_A], evening: [MARK_A], late: [MARK_A] },
    relationPools: { first: [MARK_A], returning: [MARK_A], daily: [MARK_A], streak: [MARK_A] },
    casualNotes: [MARK_A], noteProb: 0,
  }
  const variantB = structuredClone(variantA)
  variantB.timePools.morning = [MARK_B]; variantB.timePools.noon = [MARK_B]; variantB.timePools.evening = [MARK_B]; variantB.timePools.late = [MARK_B]
  variantB.relationPools.first = [MARK_B]; variantB.relationPools.returning = [MARK_B]; variantB.relationPools.daily = [MARK_B]; variantB.relationPools.streak = [MARK_B]
  r = await req('PUT', '/admin/agent-config', {
    ...original,
    abTest: { enabled: true },
    greeting: { A: variantA, B: variantB },
    weeklyNotes: { A: [MARK_W], B: [MARK_W] },
    personaPrompt: '',
  })
  ok('PUT 配置成功', r.json?.code === 200 && r.json?.data?.abTest?.enabled === true, r.json?.message || '')

  // 4. 热更即时生效：test 用户新建会话拉问候（服务进程内缓存已被 PUT 刷新，无需重启）
  r = await req('POST', '/chat/sessions', { title: 'P4 冒烟' }, { asTest: true })
  const sid = r.json?.data?.id
  r = await req('GET', `/chat/sessions/${sid}/messages`, null, { asTest: true })
  const greetingMsg = (r.json?.data || []).find((m) => m.role === 'assistant')
  const testBucket = bucketOf(testUser.id)
  const expectMark = testBucket === 'B' ? MARK_B : MARK_A
  ok(`问候热更即时生效（test 桶=${testBucket}）`, !!greetingMsg?.content?.includes(expectMark), (greetingMsg?.content || '').slice(0, 40))

  // 5. A/B 分桶稳定性 + 双池路由
  ok('bucketOf 同 ID 稳定', bucketOf(testUser.id) === bucketOf(testUser.id) && ['A', 'B'].includes(bucketOf(testUser.id)))
  const users = await prisma.user.findMany({ select: { id: true }, take: 50 })
  const bUser = users.find((u) => bucketOf(u.id) === 'B')
  const aUser = users.find((u) => bucketOf(u.id) === 'A')
  ok('存在 A/B 双桶用户', !!aUser && !!bUser)
  if (aUser && bUser) {
    const ga = getGreetingConfig(aUser.id)
    const gb = getGreetingConfig(bUser.id)
    ok('A 桶用户拿 A 池语料', ga.timePools.morning[0] === MARK_A)
    ok('B 桶用户拿 B 池语料', gb.timePools.morning[0] === MARK_B)
  }
  ok('周报模板热更生效', getWeeklyNotes(testUser.id)[0] === MARK_W)

  // 6. 校验失败 → 422
  const bad1 = structuredClone(original)
  bad1.greeting.A.timePools.morning = []
  r = await req('PUT', '/admin/agent-config', bad1)
  ok('空时段池 422', r.json?.code === 422, r.json?.message || '')
  const bad2 = structuredClone(original)
  bad2.greeting.A.noteProb = 5
  r = await req('PUT', '/admin/agent-config', bad2)
  ok('noteProb 越界 422', r.json?.code === 422, r.json?.message || '')
  const bad3 = structuredClone(original)
  bad3.personaPrompt = 'x'.repeat(3001)
  r = await req('PUT', '/admin/agent-config', bad3)
  ok('人设超长 422', r.json?.code === 422, r.json?.message || '')

  // 7. 人设覆盖：自定义替换内置
  const PERSONA = `P4人设覆盖${ts}：你是测试室友。`
  r = await req('PUT', '/admin/agent-config', { ...getAgentConfig(), personaPrompt: PERSONA })
  ok('PUT 人设覆盖', r.json?.code === 200, r.json?.message || '')
  ok('getPersonaPrompt 返回覆盖文本', getPersonaPrompt() === PERSONA)
  let prompt = ''
  try { prompt = buildSystemPrompt(miniCtx(testUser.id), '测试') } catch { /* ignore */ }
  ok('system prompt 含自定义人设', prompt.includes(PERSONA) && !prompt.includes('【你怎么说话】'))
  // 清空 → 内置回归
  r = await req('PUT', '/admin/agent-config', { ...getAgentConfig(), personaPrompt: '' })
  ok('清空人设回归内置', getPersonaPrompt() === '' && (() => { try { return buildSystemPrompt(miniCtx(testUser.id), '测试').includes('【你怎么说话】') } catch { return false } })())

  // 8. 外部改文件 + POST reload 热更（服务进程 mtime 检测）
  const diskCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  diskCfg.weeklyNotes.A = [MARK_C]
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(diskCfg, null, 2), 'utf8')
  r = await req('POST', '/admin/config/reload')
  ok('POST config/reload', r.json?.code === 200 && !!r.json?.data?.mtime, r.json?.message || '')
  r = await req('GET', '/admin/agent-config')
  ok('外部改文件热更生效', r.json?.data?.config?.weeklyNotes?.A?.[0] === MARK_C)

  // 9. 审计日志
  const audit = await prisma.auditLog.findMany({
    where: { action: { in: ['agent_config_update', 'agent_config_reload'] } },
    orderBy: { createdAt: 'desc' }, take: 2,
  })
  ok('审计日志已记录', audit.length >= 2 && audit.some((a) => a.action === 'agent_config_update') && audit.some((a) => a.action === 'agent_config_reload'))

  // 10. 恢复原配置
  r = await req('PUT', '/admin/agent-config', original)
  const restored = getAgentConfig()
  ok('恢复原配置', r.json?.code === 200 && restored.weeklyNotes.A[0] === original.weeklyNotes.A[0] && restored.greeting.A.timePools.morning[0] === original.greeting.A.timePools.morning[0], r.json?.message || '')

  // 汇总
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
