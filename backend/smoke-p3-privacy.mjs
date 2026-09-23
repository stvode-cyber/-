/**
 * P3 画像+检索+隐私 冒烟测试
 * 覆盖：隐私四档行为（off 不写库 / full 写 / text 跳多模态）、画像聚合 API、
 *       碎片列表/改标签/撤销、导出 md+json、属主校验、@画像/@找 metadata 结构化
 * 运行：node smoke-p3-privacy.mjs（后端需已启动）
 */
import { prisma } from './dist/lib/prisma.js'

const BASE = 'http://127.0.0.1:3001/api/v1'
const results = []
let token = ''

function ok(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail })
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function req(method, path, body, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && !opts.noAuth ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 导出接口返回纯文本 */ }
  return { status: r.status, json, text, headers: r.headers }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** test 用户记忆碎片计数（直接查库，验证管线真实写入） */
async function countMemory(userId) {
  return prisma.fragment.count({ where: { userId, kind: { in: ['preference', 'habit', 'entity', 'mood'] } } })
}

async function main() {
  // 0. 登录 + 拿 test userId
  let r = await req('POST', '/auth/login', { username: 'test', password: 'Test1234' }, { noAuth: true })
  token = r.json?.data?.token || ''
  const testUser = await prisma.user.findUnique({ where: { username: 'test' }, select: { id: true } })
  const uid = testUser.id
  ok('登录 test 账号', !!token && !!uid)

  // 新会话
  r = await req('POST', '/chat/sessions', { title: 'P3 隐私冒烟' })
  const sid = r.json?.data?.id
  ok('创建会话', !!sid)

  // ===== 1. 隐私四档：读写与校验 =====
  r = await req('GET', '/chat/privacy')
  const initialMode = r.json?.data?.mode
  ok('GET privacy 返回当前档', !!initialMode, `mode=${initialMode}`)

  r = await req('PUT', '/chat/privacy', { mode: 'invalid' })
  ok('PUT 非法档位 422', r.json?.code === 422)

  // ===== 2. off 档：不写库 =====
  await req('PUT', '/chat/privacy', { mode: 'off' })
  const beforeOff = await countMemory(uid)
  await req('POST', `/chat/sessions/${sid}/messages`, { content: '我最近特别爱吃酸汤肥牛' })
  await sleep(800) // 管线 fire-and-forget
  const afterOff = await countMemory(uid)
  ok('off 档：说话不写库', afterOff === beforeOff, `${beforeOff} → ${afterOff}`)

  // ===== 3. full 档：正常写入（随机内容避免去重误伤；一句话可提取多类，断言 ≥+1） =====
  await req('PUT', '/chat/privacy', { mode: 'full' })
  const beforeFull = await countMemory(uid)
  const dish = `酸汤鱼${Date.now() % 1000}`
  await req('POST', `/chat/sessions/${sid}/messages`, { content: `我喜欢吃${dish}` })
  await sleep(800)
  const afterFull = await countMemory(uid)
  ok('full 档：偏好入库', afterFull >= beforeFull + 1, `${beforeFull} → ${afterFull}`)

  // ===== 4. text 档：多模态描述跳过 =====
  await req('PUT', '/chat/privacy', { mode: 'text' })
  const beforeText = await countMemory(uid)
  await req('POST', `/chat/sessions/${sid}/messages/multimodal`, {
    messageType: 'image', content: '这张图是我家猫，我最爱撸它了', mediaUrl: 'data:image/png;base64,iVBORw0KGgo=',
  })
  await sleep(800)
  const afterText = await countMemory(uid)
  ok('text 档：多模态描述不入库', afterText === beforeText, `${beforeText} → ${afterText}`)

  // full 档下同样的多模态描述应入库（随机宠物名避免去重）
  await req('PUT', '/chat/privacy', { mode: 'full' })
  await req('POST', `/chat/sessions/${sid}/messages/multimodal`, {
    messageType: 'image', content: `这张图是我家狗${Date.now() % 1000}，我最爱遛它了`, mediaUrl: 'data:image/png;base64,iVBORw0KGgo=',
  })
  await sleep(800)
  const afterFullMM = await countMemory(uid)
  ok('full 档：多模态描述入库', afterFullMM === afterText + 1, `${afterText} → ${afterFullMM}`)

  // ===== 5. 画像聚合 API =====
  r = await req('GET', '/chat/profile')
  const panel = r.json?.data
  ok('GET profile 结构完整',
    !!panel?.month && typeof panel.finance.expense === 'number' && typeof panel.tasks.doneRate === 'number' &&
    Array.isArray(panel.moods) && panel.moods.length === 7 && !!panel.memory.counts && typeof panel.relation.streak === 'number',
    `month=${panel?.month} moods=${panel?.moods?.length} streak=${panel?.relation?.streak}`)

  // @画像 消息 → metadata.portrait
  r = await req('POST', `/chat/sessions/${sid}/messages`, { content: '@画像' })
  const portraitMeta = r.json?.data?.metadata ? JSON.parse(r.json.data.metadata) : null
  ok('@画像 metadata.portrait 结构化', !!portraitMeta?.portrait?.finance && !!portraitMeta.portrait.memory,
    `reply=${String(r.json?.data?.content).slice(0, 40)}…`)

  // ===== 6. @找 结构化 =====
  r = await req('POST', `/chat/sessions/${sid}/messages`, { content: '@找 酸汤' })
  const searchMeta = r.json?.data?.metadata ? JSON.parse(r.json.data.metadata) : null
  ok('@找 metadata.search 结构化数组',
    Array.isArray(searchMeta?.search?.fragments) && searchMeta.search.fragments.some((f) => f.content.includes('酸汤')),
    `命中 ${searchMeta?.search?.fragments?.length} 条记忆`)

  // ===== 7. 碎片管理 =====
  r = await req('GET', '/chat/fragments?limit=5')
  const fl = r.json?.data
  ok('GET fragments 列表+分页字段', Array.isArray(fl?.list) && typeof fl.hasMore === 'boolean',
    `${fl?.list?.length} 条，hasMore=${fl?.hasMore}`)
  const target = fl?.list?.find((x) => x.content.includes('酸汤鱼') || x.kind === 'preference') || fl?.list?.[0]
  ok('碎片含 tags/createdAt/sourceMsgId', !!target?.id && Array.isArray(target?.tags) && !!target?.createdAt)

  // kind 过滤
  r = await req('GET', '/chat/fragments?kind=preference&limit=50')
  const prefList = r.json?.data?.list
  ok('kind 过滤生效', Array.isArray(prefList) && prefList.every((x) => x.kind === 'preference'), `${prefList?.length} 条 preference`)

  // 改标签
  r = await req('PATCH', `/chat/fragments/${target.id}`, { tags: ['饮食', '测试'] })
  ok('PATCH 改标签', r.json?.data?.tags?.length === 2, `tags=${JSON.stringify(r.json?.data?.tags)}`)

  // 改标签校验（空串）
  r = await req('PATCH', `/chat/fragments/${target.id}`, { tags: [''] })
  ok('PATCH 非法标签 422', r.json?.code === 422)

  // ===== 8. 导出 =====
  r = await req('GET', '/chat/export?format=md')
  const mdOk = r.text.startsWith('---') && r.text.includes('# 记忆碎片') && r.text.includes('# 账单') && r.text.includes('# 待办')
  ok('导出 md（Obsidian 兼容）', mdOk, `${r.text.length} 字符`)
  const isAttachment = (r.headers.get('content-disposition') || '').includes('attachment')
  ok('导出 md 附件头', isAttachment)

  r = await req('GET', '/chat/export?format=json')
  let jsonData = null
  try { jsonData = JSON.parse(r.text) } catch { /* parse 失败则 fail */ }
  ok('导出 json 可解析', !!jsonData?.memories && !!jsonData?.bills && !!jsonData?.tasks,
    `memories=${jsonData?.memories?.length} bills=${jsonData?.bills?.length} tasks=${jsonData?.tasks?.length}`)

  // ===== 9. 撤销 + 属主校验 =====
  const beforeRevoke = await countMemory(uid)
  r = await req('DELETE', `/chat/fragments/${target.id}`)
  ok('DELETE 撤销记忆', r.json?.data?.id === target.id)
  const afterRevoke = await countMemory(uid)
  ok('撤销后计数 -1', afterRevoke === beforeRevoke - 1, `${beforeRevoke} → ${afterRevoke}`)
  r = await req('DELETE', `/chat/fragments/${target.id}`)
  ok('重复撤销 404', r.json?.code === 404)

  // admin 看不到/删不了 test 的记忆
  const testToken = token
  r = await req('POST', '/auth/login', { username: 'admin', password: 'admin123456' }, { noAuth: true })
  token = r.json?.data?.token || ''
  const adminList = await req('GET', '/chat/fragments?limit=50')
  ok('属主校验：admin 列表无 test 记忆', !(adminList.json?.data?.list || []).some((x) => x.id === fl.list.find((y) => y.id !== target.id)?.id))
  r = await req('DELETE', `/chat/fragments/${fl.list.find((x) => x.id !== target.id)?.id}`)
  ok('属主校验：admin 删 test 记忆 404', r.json?.code === 404)
  token = testToken

  // ===== 10. 恢复档位 =====
  await req('PUT', '/chat/privacy', { mode: initialMode || 'full' })
  r = await req('GET', '/chat/privacy')
  ok('档位已恢复', r.json?.data?.mode === (initialMode || 'full'))

  const passed = results.filter((x) => x.pass).length
  console.log(`\n===== P3 冒烟结果：${passed}/${results.length} 通过 =====`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch(async (e) => {
  console.error('冒烟脚本异常：', e)
  process.exit(1)
})
