/**
 * P2 办公小助手冒烟测试：读文档摘要 / 生成新版本 / 导出 / 预览下载 / docx 解包 / 属主校验
 * 运行：node smoke-office.mjs（后端需已启动，LLM 需已配置）
 */
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
  try { json = JSON.parse(text) } catch { /* download 类接口返回纯文本 */ }
  return { status: r.status, json, text, headers: r.headers }
}

// ---------- 极简 ZIP 构造器（stored，不校验 CRC——后端解包不验 CRC） ----------
function u16(n) { return [n & 255, (n >> 8) & 255] }
function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255] }
function makeZip(files) {
  const chunks = []
  const central = []
  let offset = 0
  for (const { name, data } of files) {
    const nameB = Buffer.from(name, 'utf8')
    const dataB = Buffer.from(data, 'utf8')
    const local = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), // sig, version, flags, method=0(stored)
      ...u16(0), ...u16(0), ...u32(0), ...u32(dataB.length), ...u32(dataB.length), // time, date, crc, sizes
      ...u16(nameB.length), ...u16(0),
    ])
    chunks.push(local, nameB, dataB)
    const cd = Buffer.from([
      0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(dataB.length), ...u32(dataB.length),
      ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ])
    central.push(Buffer.concat([cd, nameB]))
    offset += local.length + nameB.length + dataB.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.from([
    0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length), ...u32(cdBuf.length), ...u32(offset), ...u16(0),
  ])
  return Buffer.concat([...chunks, cdBuf, eocd])
}

async function main() {
  // 0. 登录
  let r = await req('POST', '/auth/login', { username: 'test', password: 'Test1234' }, { noAuth: true })
  token = r.json?.data?.token || ''
  ok('登录 test 账号', !!token)

  // 1. 新会话
  r = await req('POST', '/chat/sessions', { title: 'office 冒烟' })
  const sid = r.json?.data?.id
  ok('创建会话', !!sid)

  // 2. 发 txt 文件（多模态）
  const txtContent = '项目周报草稿\n本周完成了三件事：\n1. 完成了登录模块的重构，bug 数从 12 个降到 2 个。\n2. 和设计团队对齐了新版视觉稿，下周开始切图。\n3. 数据库查询慢的问题定位到了缺索引，加了一个联合索引后接口耗时从 800ms 降到 90ms。\n下周计划：开始做消息推送模块，预计周三提测。'
  const mediaUrl = `data:text/plain;base64,${Buffer.from(txtContent, 'utf8').toString('base64')}`
  r = await req('POST', `/chat/sessions/${sid}/messages/multimodal`, {
    messageType: 'file', content: '周报草稿.txt', mediaUrl, metadata: { fileName: '周报草稿.txt', fileType: 'text/plain' },
  })
  ok('发送 txt 文件', r.json?.code === 201, `code=${r.json?.code}`)

  // 3. 读文档摘要
  r = await req('POST', `/chat/sessions/${sid}/messages`, { content: '总结一下这个文件' })
  const readMeta = r.json?.data?.metadata ? JSON.parse(r.json.data.metadata) : null
  ok('read：office.read 摘要返回',
    readMeta?.office?.type === 'read' && !!readMeta.office.summary,
    readMeta?.office?.type === 'read' ? `摘要：${String(readMeta.office.summary).slice(0, 60)}…` : `metadata=${JSON.stringify(readMeta)?.slice(0, 100)}`)
  ok('read：字数与格式正确', readMeta?.office?.charCount === txtContent.length && readMeta?.office?.format === 'txt')

  // 4. 纯创作 write
  r = await req('POST', `/chat/sessions/${sid}/messages`, { content: '帮我写个请假条，明天身体不舒服要去医院看看' })
  let writeMeta = r.json?.data?.metadata ? JSON.parse(r.json.data.metadata) : null
  ok('write：纯创作生成新版本', writeMeta?.office?.type === 'write' && !!writeMeta.office.docId,
    writeMeta?.office ? `标题「${writeMeta.office.title}」docId=${String(writeMeta.office.docId).slice(0, 14)}…` : `reply=${String(r.json?.data?.content).slice(0, 60)}`)
  ok('write：标题提取正确（请假条）', writeMeta?.office?.title === '请假条', `实际=${writeMeta?.office?.title}`)

  // 4.5 回归：带钟点的日程提醒仍走日程快路（不被 office 创作意图抢走）
  r = await req('POST', `/chat/sessions/${sid}/messages`, { content: '明天上午10点提醒我开产品评审会' })
  const schMeta = r.json?.data?.metadata ? JSON.parse(r.json.data.metadata) : null
  ok('回归：带钟点日程仍走快路', !!schMeta?.schedule?.taskId, `reply=${String(r.json?.data?.content).slice(0, 50)}`)

  // 5. 有源改写 write（基于刚才的 txt）
  r = await req('POST', `/chat/sessions/${sid}/messages`, { content: '改成周报口吻重新整理一下' })
  writeMeta = r.json?.data?.metadata ? JSON.parse(r.json.data.metadata) : null
  ok('write：有源改写 + basedOn 溯源', writeMeta?.office?.type === 'write' && writeMeta.office.basedOn === '周报草稿.txt',
    writeMeta?.office ? `基于「${writeMeta.office.basedOn}」` : `reply=${String(r.json?.data?.content).slice(0, 60)}`)
  const docId = writeMeta?.office?.docId

  // 6. 预览接口
  r = await req('GET', `/chat/office-docs/${docId}`)
  const doc = r.json?.data
  ok('预览：GET office-docs/:id', r.status === 200 && doc?.title === '周报口吻' && doc.content.startsWith('# '),
    `title=${doc?.title}，${doc?.meta?.charCount} 字，v${doc?.meta?.version}`)

  // 7. 导出意图
  r = await req('POST', `/chat/sessions/${sid}/messages`, { content: '导出成txt' })
  const expMeta = r.json?.data?.metadata ? JSON.parse(r.json.data.metadata) : null
  ok('export：导出意图返回下载卡', expMeta?.office?.type === 'export' && expMeta.office.format === 'txt' && expMeta.office.docId === docId)

  // 8. 下载 md（Markdown 源码）
  r = await req('GET', `/chat/office-docs/${docId}/download?format=md`)
  const isMd = r.text.includes('#') || r.text.includes('**') || r.text.includes('- ')
  ok('下载 md：Markdown 记号保留', r.status === 200 && isMd, `${r.text.length} 字符`)

  // 9. 下载 txt（剥记号）
  r = await req('GET', `/chat/office-docs/${docId}/download?format=txt`)
  const hasHeadingMark = /^#{1,6}\s/m.test(r.text)
  ok('下载 txt：Markdown 记号已剥', r.status === 200 && !hasHeadingMark, `${r.text.length} 字符`)

  // 10. docx 解包
  const docxXml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${'<w:p><w:r><w:t>会议纪要：周三上午十点，产品评审会，确认了二期范围砍掉直播功能，优先做导出。</w:t></w:r></w:p>'.repeat(3)}</w:body></w:document>`
  const docxUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.sheet;base64,${makeZip([{ name: 'word/document.xml', data: docxXml }]).toString('base64')}`
  r = await req('POST', `/chat/sessions/${sid}/messages/multimodal`, {
    messageType: 'file', content: '会议纪要.docx', mediaUrl: docxUrl, metadata: { fileName: '会议纪要.docx' },
  })
  ok('发送 docx 文件', r.json?.code === 201, `code=${r.json?.code}`)
  r = await req('POST', `/chat/sessions/${sid}/messages`, { content: '看下这个文档讲了什么' })
  const docxMeta = r.json?.data?.metadata ? JSON.parse(r.json.data.metadata) : null
  ok('docx：ZIP 解包读出文本', docxMeta?.office?.type === 'read' && docxMeta.office.format === 'docx' && (docxMeta.office.charCount || 0) > 30,
    docxMeta?.office ? `${docxMeta.office.charCount} 字` : `reply=${String(r.json?.data?.content).slice(0, 80)}`)

  // 11. 属主校验：admin 看不到 test 的文档
  const testToken = token
  r = await req('POST', '/auth/login', { username: 'admin', password: 'admin123456' }, { noAuth: true })
  token = r.json?.data?.token || ''
  r = await req('GET', `/chat/office-docs/${docId}`)
  ok('属主校验：他人文档 404', r.status === 404 || r.json?.code === 404)
  token = testToken

  // 汇总
  const passed = results.filter((x) => x.pass).length
  console.log(`\n===== 冒烟结果：${passed}/${results.length} 通过 =====`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((e) => {
  console.error('冒烟脚本异常：', e)
  process.exit(1)
})
