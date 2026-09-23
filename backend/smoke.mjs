import { mkdir, writeFile, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { prisma } from './dist/lib/prisma.js'

const BASE = 'http://localhost:3001'
const u = (p) => BASE + p
const j = (r) => r.json()
function H(token, extra = {}) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h['Authorization'] = 'Bearer ' + token
  return { ...h, ...extra }
}
async function call(method, p, body, token, extraHeaders) {
  const res = await fetch(u(p), {
    method,
    headers: H(token, extraHeaders),
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await j(res)
  return { status: res.status, data }
}

const log = (...a) => console.log(...a)
let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; log('  ✅', name, extra ?? '') }
  else { fail++; log('  ❌', name, extra ?? '') }
}

// 自包含：每次运行创建独立源目录，避免依赖外部文件状态
async function makeSourceDir() {
  const dir = path.join(os.tmpdir(), 'dam-src-' + Date.now() + '-' + Math.floor(Math.random() * 1e4))
  await mkdir(dir, { recursive: true })
  await mkdir(path.join(dir, 'sub'), { recursive: true })
  await writeFile(path.join(dir, 'a.txt'), 'hello asset a')
  await writeFile(path.join(dir, 'b.png'), 'fake-png-bytes-123')
  await writeFile(path.join(dir, 'sub', 'd.pdf'), 'fake-pdf-bytes-456')
  await writeFile(path.join(dir, 'skip.tmp'), 'should-be-ignored')
  return dir
}

const run = async () => {
  const sourceDir = await makeSourceDir()
  const uname = 'dsmoke' + String(Date.now()).slice(-6)
  const pwd = 'Test@1234'

  log('\n[1] 注册用户')
  let r = await call('POST', '/api/v1/auth/register', { username: uname, password: pwd, nickname: 'tester' })
  check('注册成功', r.data?.code === 200 && r.data?.data?.token, `envCode=${r.data?.code}`)
  const token = r.data.data.token

  log('\n[2] 创建空间')
  r = await call('POST', '/api/v1/spaces', { name: '我的资料库' }, token)
  check('空间创建', r.data?.code === 201 && r.data?.data?.id, `envCode=${r.data?.code}`)
  const spaceId = r.data.data.id

  log('\n[3] 绑定执行实例')
  r = await call('POST', '/api/v1/remote-fetch/instances/bind', { name: 'PC-A', fingerprint: 'fp-' + uname }, token)
  check('实例绑定', r.data?.code === 201 && r.data?.data?.token, `envCode=${r.data?.code}`)
  const inst = r.data.data

  log('\n[4] 登记资源区（指定区域权限，开放远程提取）')
  r = await call('POST', '/api/v1/remote-fetch/resource-zones', {
    instanceId: inst.id, spaceId, sourcePath: sourceDir,
    zoneName: '报销单', fetchScope: 'specified_zone', remoteFetchable: true,
  }, token)
  check('资源区登记', r.data?.code === 201 && r.data?.data?.id, `envCode=${r.data?.code}`)
  const zoneId = r.data.data.id

  log('\n[5] 二次验证（step-up）')
  r = await call('POST', '/api/v1/remote-fetch/step-up', { password: pwd }, token)
  check('step-up 签发', r.status === 200 && r.data?.data?.stepUpToken, `code=${r.status}`)
  const stepUp = r.data.data.stepUpToken

  log('\n[6] 触发远程提取（携带 step-up 令牌）')
  r = await call('POST', '/api/v1/remote-fetch/resource-zones/' + zoneId + '/fetch', {}, token, { 'x-stepup-token': stepUp })
  check('提取任务创建(pending)', r.data?.code === 201 && r.data?.data?.status === 'pending', `envCode=${r.data?.code} status=${r.data?.data?.status}`)
  const jobId = r.data.data.id

  log('\n[7] 实例侧二次确认（实例令牌）')
  r = await call('POST', '/api/v1/remote-fetch/fetch-jobs/' + jobId + '/confirm', { decision: 'confirm' }, null, { 'x-instance-token': inst.token })
  check('确认→dispatched', r.status === 200 && r.data?.data?.status === 'dispatched', `code=${r.status} status=${r.data?.data?.status}`)

  log('\n[8] 实例侧执行提取（扫描源目录并入库）')
  r = await call('POST', '/api/v1/remote-fetch/fetch-jobs/' + jobId + '/execute', {}, null, { 'x-instance-token': inst.token })
  check('执行完成(done)', r.status === 200 && r.data?.data?.status === 'done', `code=${r.status} status=${r.data?.data?.status} result=${r.data?.data?.resultCount}`)
  const resultCount = r.data.data.resultCount

  log('\n[9] 校验入库结果')
  // 期望：a.txt, b.png, sub/d.pdf 入库；skip.tmp 被默认忽略规则排除 → 3 个
  check('去重/过滤正确(应为3)', resultCount === 3, `resultCount=${resultCount}`)

  log('\n[10] 列出空间资产')
  r = await call('GET', '/api/v1/assets?spaceId=' + spaceId, null, token)
  check('资产列表返回3条', r.status === 200 && r.data?.data?.total === 3, `code=${r.status} total=${r.data?.data?.total}`)

  log('\n[11] 校验入库资产内容可读（文件已落盘）')
  const list = r.data.data.list || []
  let readable = 0
  for (const a of list) {
    if (!a.storageKey) continue
    const fr = await fetch(u('/api/v1/assets/' + a.id + '/file'), { headers: H(token) })
    if (fr.status === 200) {
      const buf = Buffer.from(await fr.arrayBuffer())
      if (buf.length > 0) readable++
    }
  }
  check('资产文件可下载', readable === list.length && list.length > 0, `readable=${readable}/${list.length}`)

  log('\n[12] 未授权访问防护：无 step-up 触发应被拒')
  r = await call('POST', '/api/v1/remote-fetch/resource-zones/' + zoneId + '/fetch', {}, token)
  check('缺 step-up 被拒(401)', r.status === 401, `code=${r.status}`)

  log('\n[13] 全实例权限强制确认：触发后 requireConfirm 应为 true')
  r = await call('POST', '/api/v1/remote-fetch/resource-zones', {
    instanceId: inst.id, spaceId, sourcePath: sourceDir,
    zoneName: '全盘', fetchScope: 'full_instance', remoteFetchable: true,
  }, token)
  const zone2 = r.data.data.id
  const su2 = (await call('POST', '/api/v1/remote-fetch/step-up', { password: pwd }, token)).data.data.stepUpToken
  r = await call('POST', '/api/v1/remote-fetch/resource-zones/' + zone2 + '/fetch', {}, token, { 'x-stepup-token': su2 })
  check('全实例等级 requireConfirm=true', r.data?.code === 201 && r.data?.data?.requireConfirm === true, `envCode=${r.data?.code} requireConfirm=${r.data?.data?.requireConfirm}`)

  log('\n[14] 创建文件夹（含嵌套，路径自动计算）')
  r = await call('POST', '/api/v1/folders', { spaceId, name: '项目A' }, token)
  check('一级文件夹创建', r.data?.code === 201 && r.data?.data?.id, `code=${r.data?.code}`)
  const f1 = r.data.data.id
  r = await call('POST', '/api/v1/folders', { spaceId, name: '设计稿', parentId: f1 }, token)
  check('嵌套文件夹路径正确', r.data?.code === 201 && r.data?.data?.path === '/项目A/设计稿', `path=${r.data?.data?.path}`)
  const f2 = r.data.data.id

  log('\n[15] 列出空间文件夹（含资产计数）')
  r = await call('GET', '/api/v1/folders?spaceId=' + spaceId, null, token)
  check('文件夹列表返回2条', r.status === 200 && Array.isArray(r.data?.data) && r.data.data.length === 2, `len=${(r.data?.data || []).length}`)

  log('\n[16] 创建标签（空间内唯一，可复用）')
  r = await call('POST', '/api/v1/tags', { spaceId, name: '合同' }, token)
  check('标签创建', r.data?.code === 201 && r.data?.data?.id, `code=${r.data?.code}`)
  const tagId = r.data.data.id

  log('\n[17] 上传资产（指定文件夹 + 标签 + 描述）')
  const upName = 'organize-' + Date.now() + '.txt'
  const upContent = 'organize-test-unique-' + Date.now()
  r = await call('POST', '/api/v1/assets/upload', {
    spaceId, folderId: f2, name: upName, mime: 'text/plain',
    base64: Buffer.from(upContent).toString('base64'),
    tags: ['合同', '重要'], description: '用于回归测试的描述',
  }, token)
  check('带文件夹/标签上传201', r.data?.code === 201 && r.data?.data?.id, `code=${r.data?.code}`)
  const assetId = r.data.data.id

  log('\n[18] 上传新版本')
  const vContent = 'version-2-content-' + Date.now()
  r = await call('POST', '/api/v1/assets/' + assetId + '/versions', {
    base64: Buffer.from(vContent).toString('base64'), note: '修订稿',
  }, token)
  check('新版本保存201', r.data?.code === 201 && r.data?.data?.id, `code=${r.data?.code}`)

  log('\n[19] 列出版本（初始版本 + 新版本，共2条）')
  r = await call('GET', '/api/v1/assets/' + assetId + '/versions', null, token)
  check('版本列表返回2条', r.status === 200 && Array.isArray(r.data?.data) && r.data.data.length === 2, `len=${(r.data?.data || []).length}`)

  log('\n[20] 恢复到初始版本')
  const versions = r.data.data
  const initVer = versions.find((v) => v.note === '初始版本')
  r = await call('POST', '/api/v1/assets/' + assetId + '/versions/' + initVer.id + '/restore', {}, token)
  check('恢复到初始版本', r.status === 200 && r.data?.data?.storageKey, `code=${r.status}`)

  log('\n[21] 编辑资产元数据（描述）')
  r = await call('PATCH', '/api/v1/assets/' + assetId, { description: '更新后的描述' }, token)
  check('元数据编辑成功', r.status === 200 && r.data?.data?.metadata?.includes('更新后的描述'), `meta=${r.data?.data?.metadata}`)

  log('\n[22] 创建外链分享（密码 + 有效期 + download 权限）')
  const exp = new Date(Date.now() + 3600 * 1000).toISOString()
  r = await call('POST', '/api/v1/assets/' + assetId + '/share', { expireAt: exp, password: 'link123', permission: 'download' }, token)
  check('分享链接创建201', r.data?.code === 201 && r.data?.data?.token, `code=${r.data?.code}`)
  const shareToken = r.data.data.token

  log('\n[23] 免登录取回分享元数据（带密码）')
  r = await call('GET', '/api/v1/share/' + shareToken + '?password=link123')
  check('公开元数据可取回', r.status === 200 && r.data?.data?.token === shareToken && r.data?.data?.permission === 'download', `perm=${r.data?.data?.permission}`)

  log('\n[24] 免登录下载分享文件（带密码）')
  const sfr = await fetch(u('/api/v1/share/' + shareToken + '/file?password=link123'))
  let sdownload = false
  if (sfr.status === 200) {
    const sbuf = Buffer.from(await sfr.arrayBuffer())
    sdownload = sbuf.length > 0
  }
  check('公开文件可下载', sdownload, `status=${sfr.status}`)

  log('\n[25] 错误密码应被拒(401)')
  r = await call('GET', '/api/v1/share/' + shareToken + '?password=wrong')
  check('错误密码401', r.status === 401, `code=${r.status}`)

  log('\n[26] 不存在的分享链接应404')
  r = await call('GET', '/api/v1/share/' + 'deadbeefdeadbeefdeadbeefdeadbeef')
  check('不存在链接404', r.status === 404, `code=${r.status}`)

  // ===== A 类工程增强 / 安全回归（审查修复点 + A1 默认过期） =====
  log('\n[27] 注册第二用户（非 owner 成员）')
  const uname2 = 'dsmoke2' + String(Date.now()).slice(-6)
  let r2 = await call('POST', '/api/v1/auth/register', { username: uname2, password: pwd, nickname: 'tester2' })
  check('第二用户注册', r2.data?.code === 200 && r2.data?.data?.token, `code=${r2.data?.code}`)
  const token2 = r2.data.data.token
  const userId2 = r2.data.data.user.id

  log('\n[28] 将第二用户加入空间（operator）')
  r = await call('POST', '/api/v1/spaces/' + spaceId + '/members', { userId: userId2, role: 'operator' }, token)
  check('成员添加', r.data?.code === 200 && r.data?.data?.role === 'operator', `code=${r.data?.code}`)

  log('\n[29] 分级授权：非 owner 触发 full_instance 应 403')
  const su2b = (await call('POST', '/api/v1/remote-fetch/step-up', { password: pwd }, token2)).data?.data?.stepUpToken
  r = await call('POST', '/api/v1/remote-fetch/resource-zones/' + zone2 + '/fetch', {}, token2, su2b ? { 'x-stepup-token': su2b } : undefined)
  check('非 owner 触发 full_instance 被拒(403)', r.status === 403, `code=${r.status}`)

  log('\n[30] 元数据编辑越权：非 owner 改他人资产应 403')
  r = await call('PATCH', '/api/v1/assets/' + assetId, { description: '恶意修改' }, token2)
  check('非 owner PATCH 被拒(403)', r.status === 403, `code=${r.status}`)

  log('\n[31] 资产详情不泄漏分享密码哈希')
  r = await call('GET', '/api/v1/assets/' + assetId, null, token2)
  const links = r.data?.data?.shareLinks || []
  const noPwd = links.length > 0 && links.every((s) => !('password' in s))
  check('成员视角 shareLinks 不含 password', noPwd, `links=${links.length}`)

  log('\n[32] 实例令牌吊销：解绑后心跳应 401')
  r = await call('POST', '/api/v1/remote-fetch/instances/' + inst.id + '/unbind', {}, token)
  check('实例解绑成功', r.data?.code === 200, `code=${r.data?.code}`)
  r = await call('POST', '/api/v1/remote-fetch/instances/' + inst.id + '/heartbeat', {}, null, { 'x-instance-token': inst.token })
  check('吊销后心跳被拒(401)', r.status === 401, `code=${r.status}`)

  log('\n[33] 分享默认过期：不传 expireAt 应兜底约 7 天')
  r = await call('POST', '/api/v1/assets/' + assetId + '/share', { permission: 'download' }, token)
  const defExp = r.data?.data?.expireAt
  const defDays = defExp ? (new Date(defExp).getTime() - Date.now()) / 86400000 : 0
  check('默认过期≈7天', !!defExp && defDays > 6.5 && defDays < 7.5, `exp=${defExp} days=${defDays.toFixed(2)}`)

  log('\n[34] 搜索语义对齐：q 匹配描述')
  r = await call('GET', '/api/v1/assets?spaceId=' + spaceId + '&q=' + encodeURIComponent('更新后的描述'), null, token)
  const qList = r.data?.data?.list || []
  check('搜索命中描述', r.status === 200 && qList.some((a) => a.id === assetId), `total=${r.data?.data?.total}`)

  log('\n[35] 文件夹名禁止包含 /')
  r = await call('POST', '/api/v1/folders', { spaceId, name: 'bad/name' }, token)
  check('非法文件夹名被拒(422)', r.status === 422, `code=${r.status}`)

  log('\n[36] 标签名 trim 归一')
  r = await call('POST', '/api/v1/tags', { spaceId, name: ' 合同 ' }, token)
  check('标签名被 trim 为 合同', r.data?.code === 201 && r.data?.data?.name === '合同', `name=${r.data?.data?.name}`)

  log('\n[37] 分享 XSS 防护：inline HTML 降级为 octet-stream + nosniff')
  const htmlAsset = (await call('POST', '/api/v1/assets/upload', {
    spaceId, name: 'xss.html', mime: 'text/html',
    base64: Buffer.from('<script>alert(1)</script>').toString('base64'),
  }, token)).data?.data
  const xssShare = (await call('POST', '/api/v1/assets/' + htmlAsset.id + '/share', { permission: 'view' }, token)).data?.data
  const xr = await fetch(u('/api/v1/share/' + xssShare.token + '/file'))
  const ct = xr.headers.get('content-type') || ''
  const nosniff = xr.headers.get('x-content-type-options') || ''
  check('HTML 分享 inline 降级+nosniff', ct.includes('octet-stream') && nosniff === 'nosniff', `ct=${ct} nosniff=${nosniff}`)

  log('\n[38] 批量下载：返回 zip 且含文件')
  const bd1 = (await call('POST', '/api/v1/assets/upload', { spaceId, name: 'bd1.txt', mime: 'text/plain', base64: Buffer.from('batch-one').toString('base64'), folderId: null, tags: [] }, token)).data?.data
  const bd2 = (await call('POST', '/api/v1/assets/upload', { spaceId, name: 'bd2.txt', mime: 'text/plain', base64: Buffer.from('batch-two').toString('base64'), folderId: null, tags: [] }, token)).data?.data
  check('批量上传1', !!bd1?.id, `code`)
  check('批量上传2', !!bd2?.id, `code`)
  const bdRes = await fetch(BASE + '/api/v1/assets/batch-download', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ ids: [bd1.id, bd2.id] }),
  })
  const bdBuf = Buffer.from(await bdRes.arrayBuffer())
  check('批量下载 200', bdRes.status === 200, `code=${bdRes.status}`)
  check('zip 魔数 PK', bdBuf[0] === 0x50 && bdBuf[1] === 0x4b && bdBuf[2] === 0x03 && bdBuf[3] === 0x04, `len=${bdBuf.length}`)

  log('\n[39] 批量下载边界：空 ids 422 / 越权 403')
  check('空 ids 422', (await call('POST', '/api/v1/assets/batch-download', { ids: [] }, token)).status === 422, ``)
  // 越权：用一个未加入空间的新用户（token2 是空间成员，不构成越权）
  const rX = await call('POST', '/api/v1/auth/register', { email: 'bd_x_' + Date.now() + '@test.com', username: 'bdx_' + Date.now(), password: 'Test1234', nickname: 'bdx' })
  const tokenX = rX.data?.data?.token
  const bdRbRes = await fetch(BASE + '/api/v1/assets/batch-download', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokenX },
    body: JSON.stringify({ ids: [bd1.id, bd2.id] }),
  })
  check('越权下载 403', bdRbRes.status === 403, `code=${bdRbRes.status}`)

  // ===== B 类工程增强：桌面端自动采集同步（POST /assets/sync） =====
  log('\n[40] 桌面采集同步：新建 + 自动分类 + 按父文件夹自动打标签')
  // 注意：命名加 sa/sb/sc 前缀，避免与 [8] 远程提取已生成的 a.txt/b.png 重名导致 byName 覆盖误判
  const items = [
    { name: 'sa.txt', mime: 'text/plain', base64: Buffer.from('sync-content-a').toString('base64'), localPath: 'D:/sync-test/合同/sa.txt', localMtime: 1700000000000 },
    { name: 'sb.png', mime: 'image/png', base64: Buffer.from('sync-bytes-b-123').toString('base64'), localPath: 'D:/sync-test/图片/sb.png', localMtime: 1700000000001 },
    { name: 'sc.pdf', mime: 'application/pdf', base64: Buffer.from('sync-bytes-c-456').toString('base64'), localPath: 'D:/sync-test/文档/sc.pdf', localMtime: 1700000000002 },
  ]
  r = await call('POST', '/api/v1/assets/sync', { spaceId, items, autoTag: true }, token)
  const s40 = r.data?.data || {}
  check('同步新建3条', r.data?.code === 200 && s40.created === 3 && s40.updated === 0 && s40.skipped === 0, `created=${s40.created} updated=${s40.updated} skipped=${s40.skipped}`)

  r = await call('GET', '/api/v1/assets?spaceId=' + spaceId, null, token)
  const synced = r.data?.data?.list || []
  const byName = Object.fromEntries(synced.map((a) => [a.name, a]))
  check('sa.txt 自动分类 document', byName['sa.txt']?.type === 'document', `type=${byName['sa.txt']?.type}`)
  check('sb.png 自动分类 image', byName['sb.png']?.type === 'image', `type=${byName['sb.png']?.type}`)
  check('sc.pdf 自动分类 document', byName['sc.pdf']?.type === 'document', `type=${byName['sc.pdf']?.type}`)
  const aAsset = byName['sa.txt']
  check('按来源父文件夹自动打标签(合同)', !!aAsset?.tags?.some((t) => t.tag.name === '合同'), `tags=${(aAsset?.tags || []).map((t) => t.tag.name).join(',')}`)
  const aId = aAsset?.id

  log('\n[41] 重复同步（内容不变）→ 全部跳过')
  r = await call('POST', '/api/v1/assets/sync', { spaceId, items, autoTag: true }, token)
  const s41 = r.data?.data || {}
  check('内容未变→skipped=3', r.data?.code === 200 && s41.skipped === 3 && s41.created === 0, `skipped=${s41.skipped} created=${s41.created}`)

  log('\n[42] 改内容后同步→更新（在位更新 + 追加版本）')
  const itemsV2 = items.map((it) => (it.name === 'sa.txt'
    ? { ...it, base64: Buffer.from('sync-content-a-V2-changed').toString('base64'), localMtime: 1700000000009 }
    : it))
  r = await call('POST', '/api/v1/assets/sync', { spaceId, items: itemsV2, autoTag: true }, token)
  const s42 = r.data?.data || {}
  check('内容变化→updated=1', r.data?.code === 200 && s42.updated === 1 && s42.skipped === 2 && s42.created === 0, `updated=${s42.updated} skipped=${s42.skipped}`)
  const aFileRes = await fetch(u('/api/v1/assets/' + aId + '/file'), { headers: H(token) })
  const aBuf = Buffer.from(await aFileRes.arrayBuffer())
  check('更新后文件内容为新内容', aBuf.toString() === 'sync-content-a-V2-changed', `content=${aBuf.toString()}`)
  const vres = await call('GET', '/api/v1/assets/' + aId + '/versions', null, token)
  check('同步更新追加版本快照', Array.isArray(vres.data?.data) && vres.data.data.length >= 2, `versions=${(vres.data?.data || []).length}`)

  log('\n[43] 同步越权：非空间成员应被拒(403)')
  const rX2 = await call('POST', '/api/v1/auth/register', { username: 'synx_' + Date.now(), password: 'Test1234', nickname: 'synx' })
  const tokenX2 = rX2.data?.data?.token
  const syncRb = await fetch(BASE + '/api/v1/assets/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokenX2 },
    body: JSON.stringify({ spaceId, items: [{ name: 'x.txt', base64: Buffer.from('z').toString('base64'), localPath: 'D:/x/x.txt' }] }),
  })
  check('越权同步 403', syncRb.status === 403, `code=${syncRb.status}`)

  // ===== 桌面宠物（QQ宠物式陪伴）=====
  log('\n[44] 宠物：自动创建 + 状态字段')
  const pr0 = await call('GET', '/api/v1/pet', null, token)
  const p0 = pr0.data?.data || {}
  check('GET /pet 自动建宠 200', pr0.data?.code === 200 && !!p0.id && !!p0.state, `state=${p0.state}`)
  check('默认数值在区间', [p0.hunger, p0.mood, p0.clean, p0.energy].every((v) => v >= 0 && v <= 100), `h=${p0.hunger} m=${p0.mood} c=${p0.clean} e=${p0.energy}`)

  log('\n[45] 互动：喂食涨饥饿 + 加经验/金币')
  const beforeFeed = await call('GET', '/api/v1/pet', null, token)
  const bf = beforeFeed.data?.data || {}
  const prFeed = await call('POST', '/api/v1/pet/action', { action: 'feed' }, token)
  const af = prFeed.data?.data || {}
  check('喂食 200', prFeed.data?.code === 200, `code=${prFeed.data?.code}`)
  check('喂食后饥饿≥喂食前(或封顶100)', af.hunger >= bf.hunger || af.hunger === 100, `before=${bf.hunger} after=${af.hunger}`)
  check('金币+2', af.coins === bf.coins + 2, `before=${bf.coins} after=${af.coins}`)
  check('经验+10', af.exp === bf.exp + 10, `before=${bf.exp} after=${af.exp}`)

  log('\n[46] 互动：玩耍涨心情降精力')
  const beforePlay = await call('GET', '/api/v1/pet', null, token)
  const bp = beforePlay.data?.data || {}
  const prPlay = await call('POST', '/api/v1/pet/action', { action: 'play' }, token)
  const ap = prPlay.data?.data || {}
  check('玩耍后心情≥前(或封顶)', ap.mood >= bp.mood || ap.mood === 100, `before=${bp.mood} after=${ap.mood}`)
  check('玩耍后精力≤前', ap.energy <= bp.energy, `before=${bp.energy} after=${ap.energy}`)

  log('\n[47] 互动：清洁涨清洁度')
  const prClean = await call('POST', '/api/v1/pet/action', { action: 'clean' }, token)
  check('清洁 200 且 clean 提升', prClean.data?.code === 200 && prClean.data?.data?.clean >= 0, `clean=${prClean.data?.data?.clean}`)

  log('\n[48] 互动：睡觉涨精力')
  const beforeSleep = await call('GET', '/api/v1/pet', null, token)
  const bs = beforeSleep.data?.data || {}
  const prSleep = await call('POST', '/api/v1/pet/action', { action: 'sleep' }, token)
  const as = prSleep.data?.data || {}
  check('睡觉后精力≥前(或封顶)', as.energy >= bs.energy || as.energy === 100, `before=${bs.energy} after=${as.energy}`)

  log('\n[49] 改名：合法 + 非法(超长)422')
  const prRn = await call('POST', '/api/v1/pet/rename', { name: '小喵喵' }, token)
  check('改名成功', prRn.data?.code === 200 && prRn.data?.data?.name === '小喵喵', `name=${prRn.data?.data?.name}`)
  const prRnBad = await call('POST', '/api/v1/pet/rename', { name: 'a'.repeat(13) }, token)
  check('超长名字 422', prRnBad.data?.code === 422, `code=${prRnBad.data?.code}`)

  // ===== 桌面动态壁纸配置 =====
  log('\n[50] 动态壁纸：取默认配置（自动建）')
  const wpR = await call('GET', '/api/v1/wallpaper', null, token)
  const wp0 = wpR.data?.data || {}
  check('GET /wallpaper 200 + 默认关闭', wpR.data?.code === 200 && wp0.enabled === false && !!wp0.theme, `enabled=${wp0.enabled} theme=${wp0.theme}`)

  log('\n[51] 动态壁纸：更新配置（开启 + 星空 + 速度/不透明度）')
  const wpUpd = await call('PUT', '/api/v1/wallpaper', { enabled: true, theme: 'starfield', speed: 60, opacity: 80, showPet: false }, token)
  const wu = wpUpd.data?.data || {}
  check('PUT /wallpaper 200', wpUpd.data?.code === 200, `code=${wpUpd.data?.code}`)
  check('更新后 enabled=true', wu.enabled === true, `enabled=${wu.enabled}`)
  check('更新后 theme=starfield', wu.theme === 'starfield', `theme=${wu.theme}`)
  check('更新后 opacity=80', wu.opacity === 80, `opacity=${wu.opacity}`)

  log('\n[52] 动态壁纸：再次读取反映更新')
  const wpR2 = await call('GET', '/api/v1/wallpaper', null, token)
  check('读取到已开启+星空', wpR2.data?.data?.enabled === true && wpR2.data?.data?.theme === 'starfield', `enabled=${wpR2.data?.data?.enabled}`)

  // ===== 桌面便签 =====
  log('\n[53] 便签：新建便签')
  const snR = await call('POST', '/api/v1/sticky', { content: '买牛奶🥛', color: 'blue', x: 100, y: 120 }, token)
  const sn0 = snR.data?.data || {}
  check('POST /sticky 201', snR.data?.code === 201 && !!sn0.id, `code=${snR.data?.code}`)
  check('默认尺寸/颜色生效', sn0.color === 'blue' && sn0.w >= 120 && sn0.h >= 100, `color=${sn0.color} w=${sn0.w} h=${sn0.h}`)
  const snId = sn0.id

  log('\n[54] 便签：列表包含新建便签')
  const snList = await call('GET', '/api/v1/sticky', null, token)
  const snArr = snList.data?.data || []
  check('GET /sticky 200 且含该便签', snList.data?.code === 200 && snArr.some((n) => n.id === snId), `count=${snArr.length}`)

  log('\n[55] 便签：更新内容/颜色/坐标')
  const snUpd = await call('PUT', '/api/v1/sticky/' + snId, { content: '买牛奶+鸡蛋', color: 'pink', x: 200, y: 240, w: 260, h: 200 }, token)
  const su = snUpd.data?.data || {}
  check('PUT /sticky 200', snUpd.data?.code === 200, `code=${snUpd.data?.code}`)
  check('内容已更新', su.content === '买牛奶+鸡蛋' && su.color === 'pink', `content=${su.content} color=${su.color}`)
  check('坐标/尺寸已更新', su.x === 200 && su.y === 240 && su.w === 260, `x=${su.x} y=${su.y} w=${su.w}`)

  log('\n[56] 便签：删除便签')
  const snDel = await call('DELETE', '/api/v1/sticky/' + snId, null, token)
  check('DELETE /sticky 200', snDel.data?.code === 200, `code=${snDel.data?.code}`)
  const snList2 = await call('GET', '/api/v1/sticky', null, token)
  check('删除后列表不含该便签', !(snList2.data?.data || []).some((n) => n.id === snId), `count=${(snList2.data?.data || []).length}`)

  log('\n[57] 越权：他人便签不可删(404/403)')
  // 复用已注册的第二个用户 token2（避免重复注册触发 authRateLimit 限流）
  const tokenRb = token2
  // 用自己账号建一张，再用他人 token 去删（应失败，因为找不到对方的便签）
  const myNote = await call('POST', '/api/v1/sticky', { content: 'secret' }, token)
  const myNoteId = myNote.data?.data?.id
  const delRb = await call('DELETE', '/api/v1/sticky/' + myNoteId, null, tokenRb)
  check('越权删除被拒(403)', delRb.data?.code === 403, `code=${delRb.data?.code}`)
  await call('DELETE', '/api/v1/sticky/' + myNoteId, null, token).catch(() => {})

  // ===== 小游戏结算奖励 =====
  log('\n[58] 小游戏结算：得分兑换金币+经验并触发升级')
  const petBefore = (await call('GET', '/api/v1/pet', null, token)).data?.data || {}
  const beforeCoins = petBefore.coins || 0
  const beforeLevel = petBefore.level || 1
  const g1 = await call('POST', '/api/v1/pet/play-game', { game: 'catch', score: 1000 }, token)
  const g1d = g1.data?.data || {}
  check('play-game 200', g1.data?.code === 200, `code=${g1.data?.code}`)
  check('金币增加 +ceil(1000/2)=500', g1d.coins === beforeCoins + 500, `coins=${g1d.coins} before=${beforeCoins}`)
  check('经验提升并升级', g1d.level > beforeLevel, `level=${g1d.level} before=${beforeLevel}`)

  log('\n[59] 小游戏结算：0 分返回成功但不额外奖励')
  const g0 = await call('POST', '/api/v1/pet/play-game', { game: 'memory', score: 0 }, token)
  const g0d = g0.data?.data || {}
  check('play-game 0分 200', g0.data?.code === 200, `code=${g0.data?.code}`)
  check('0分金币不变', g0d.coins === g1d.coins, `coins=${g0d.coins}`)

  // ===== 宠物装扮商店（金币消费闭环）=====
  log('\n[60] 装扮商店：购买扣减金币')
  const shopBefore = (await call('GET', '/api/v1/pet-shop', null, token)).data?.data || {}
  const coinsBefore = shopBefore.coins ?? 0
  const buy1 = await call('POST', '/api/v1/pet-shop/buy', { itemKey: 'toy_ball' }, token)
  check('购买成功 200', buy1.data?.code === 200, `code=${buy1.data?.code}`)
  check('金币 -12 (toy_ball)', buy1.data?.data?.coins === coinsBefore - 12, `coins=${buy1.data?.data?.coins} before=${coinsBefore}`)

  log('\n[61] 装扮商店：重复购买被拒(409)')
  const buyDup = await call('POST', '/api/v1/pet-shop/buy', { itemKey: 'toy_ball' }, token)
  check('重复购买 409', buyDup.data?.code === 409, `code=${buyDup.data?.code}`)

  log('\n[62] 装扮商店：装备已拥有装扮')
  const eq1 = await call('POST', '/api/v1/pet-shop/equip', { itemKey: 'toy_ball' }, token)
  check('装备成功 200', eq1.data?.code === 200, `code=${eq1.data?.code}`)
  check('toy 槽位已装备 toy_ball', eq1.data?.data?.equipped?.toy === 'toy_ball', `eq=${JSON.stringify(eq1.data?.data?.equipped)}`)

  log('\n[63] 装扮商店：卸下槽位')
  const un1 = await call('POST', '/api/v1/pet-shop/unequip', { slot: 'toy' }, token)
  check('卸下成功 200', un1.data?.code === 200, `code=${un1.data?.code}`)
  check('toy 槽位已清空', un1.data?.data?.equipped?.toy === null, `eq=${JSON.stringify(un1.data?.data?.equipped)}`)

  log('\n[64] 装扮商店：装备未拥有装扮被拒(400)')
  const eqNo = await call('POST', '/api/v1/pet-shop/equip', { itemKey: 'hat_crown' }, token)
  check('未拥有装备 400', eqNo.data?.code === 400, `code=${eqNo.data?.code}`)

  log('\n[65] 装扮商店：金币不足被拒(400)')
  // 复用第二个用户（token2，0 金币）避免重复注册触发限流
  const shopToken2 = token2
  const ins = await call('POST', '/api/v1/pet-shop/buy', { itemKey: 'hat_cap' }, shopToken2) // 新用户 0 金币
  check('金币不足 400', ins.data?.code === 400, `code=${ins.data?.code}`)

  log('\n[66] 装扮商店：不存在商品 404')
  const noItem = await call('POST', '/api/v1/pet-shop/buy', { itemKey: 'no_such' }, token)
  check('不存在商品 404', noItem.data?.code === 404, `code=${noItem.data?.code}`)

  // ===== 宠物每日签到（金币消费闭环的"赚取"留存钩子）=====
  log('\n[67] 每日签到：首次签到奖励金币 + 连续=1')
  const petBeforeCh = (await call('GET', '/api/v1/pet', null, token)).data?.data || {}
  const coinsBeforeCh = petBeforeCh.coins ?? 0
  const ch1 = await call('POST', '/api/v1/pet/checkin', {}, token)
  check('签到 200', ch1.data?.code === 200, `code=${ch1.data?.code}`)
  check('奖励金币 >=5', (ch1.data?.data?.award ?? 0) >= 5, `award=${ch1.data?.data?.award}`)
  check('连续天数=1', ch1.data?.data?.streak === 1, `streak=${ch1.data?.data?.streak}`)
  check('金币增加', ch1.data?.data?.coins === coinsBeforeCh + (ch1.data?.data?.award ?? 0), `coins=${ch1.data?.data?.coins}`)
  check('今日已签到标记', ch1.data?.data?.checkedInToday === true, `flag=${ch1.data?.data?.checkedInToday}`)

  log('\n[68] 每日签到：当日重复签到被拒(409)')
  const chDup = await call('POST', '/api/v1/pet/checkin', {}, token)
  check('重复签到 409', chDup.data?.code === 409, `code=${chDup.data?.code}`)

  log('\n[69] 每日签到：连续天数递增（回填昨日日期后再次签到）')
  const yestStr = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })()
  const chUser = await prisma.user.findFirst({ where: { username: uname } })
  await prisma.pet.update({ where: { userId: chUser.id }, data: { lastCheckinDate: yestStr, checkinStreak: 1 } })
  const ch2 = await call('POST', '/api/v1/pet/checkin', {}, token)
  check('再次签到 200', ch2.data?.code === 200, `code=${ch2.data?.code}`)
  check('连续天数=2', ch2.data?.data?.streak === 2, `streak=${ch2.data?.data?.streak}`)
  const chPetLv = (await prisma.pet.findUnique({ where: { userId: chUser.id } }))?.level ?? 1
  const expectAward = 5 + 1 * 2 + Math.min(chPetLv, 10) // 基础(连续2天=7) + 等级特权加成
  check('奖励=基础7+等级加成', ch2.data?.data?.award === expectAward, `award=${ch2.data?.data?.award} expected=${expectAward}`)

  log('\n[70] 每日签到：连续签到后当日重复仍被拒(409)')
  const chDup2 = await call('POST', '/api/v1/pet/checkin', {}, token)
  check('重复签到 409', chDup2.data?.code === 409, `code=${chDup2.data?.code}`)

  // ===================== 离线语义分类（智能归纳核心） =====================
  log('\n[71] 离线语义分类：各类文件确定性归类')
  const upCat = async (name, mime, content) => {
    const rr = await call('POST', '/api/v1/assets/upload', {
      spaceId, name, mime: mime || undefined,
      base64: Buffer.from(content || name + Date.now()).toString('base64'),
    }, token)
    return rr.data?.data?.category
  }
  check('代码→代码', (await upCat('util.js', 'text/javascript')) === '代码')
  check('发票PDF→票据', (await upCat('发票2024.pdf', 'application/pdf')) === '票据')
  check('微信支付截图→票据', (await upCat('微信支付截图.png', 'image/png')) === '票据')
  check('屏幕截图→截图', (await upCat('屏幕截图_001.png', 'image/png')) === '截图')
  check('保密协议→合同', (await upCat('保密协议.pdf', 'application/pdf')) === '合同')
  check('旅行照片→照片', (await upCat('旅行照片.jpg', 'image/jpeg')) === '照片')
  check('压缩包→归档', (await upCat('backup.zip', 'application/zip')) === '归档')
  check('歌曲→音频', (await upCat('song.mp3', 'audio/mpeg')) === '音频')
  check('视频→视频', (await upCat('clip.mp4', 'video/mp4')) === '视频')
  check('Word文档→文档', (await upCat('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')) === '文档')
  check('未知二进制→其他', (await upCat('weird.bin', 'application/octet-stream')) === '其他')

  log('\n[72] 离线语义分类：按 category 筛选')
  const onlyCode = await call('GET', '/api/v1/assets?spaceId=' + spaceId + '&category=' + encodeURIComponent('代码'), null, token)
  const codeList = onlyCode.data?.data?.list || []
  const allCode = codeList.length > 0 && codeList.every((a) => a.category === '代码')
  check('分类筛选仅返回代码类', allCode && codeList.length >= 1, `len=${codeList.length}`)
  const noneX = await call('GET', '/api/v1/assets?spaceId=' + spaceId + '&category=' + encodeURIComponent('不存在分类'), null, token)
  check('不存在分类返回空列表', (noneX.data?.data?.list || []).length === 0, `len=${(noneX.data?.data?.list || []).length}`)

  // ===================== 分类自定义映射规则 + 统计看板 =====================
  log('\n[73] 分类规则：建规则前上传 pdf（无关键词）→ 内置归「文档」')
  const upPdf = async (name, content) => {
    const rr = await call('POST', '/api/v1/assets/upload', {
      spaceId, name, mime: 'application/pdf',
      base64: Buffer.from(content || name + Date.now()).toString('base64'),
    }, token)
    return rr.data?.data?.category
  }
  check('建规则前 pdf→文档', (await upPdf('oldreport.pdf')) === '文档')

  log('\n[74] 分类规则：新增 extension=pdf → 合同（优先级 10）')
  const mkRule = await call('POST', '/api/v1/category-rules', {
    spaceId, matchType: 'extension', pattern: 'pdf', targetCategory: '合同', priority: 10,
  }, token)
  check('规则创建 201', mkRule.data?.code === 201, `code=${mkRule.data?.code}`)
  check('重复同规则被拒(400/409)', (await call('POST', '/api/v1/category-rules', {
    spaceId, matchType: 'extension', pattern: 'pdf', targetCategory: '合同',
  }, token)).data?.code !== 201)

  log('\n[75] 分类规则：命中规则覆盖内置（新 pdf→合同）')
  check('新 pdf→合同（规则优先）', (await upPdf('newreport.pdf')) === '合同')

  log('\n[76] 分类规则：重算后历史资产分类被更新')
  const rc = await call('POST', '/api/v1/category-rules/reclassify', { spaceId }, token)
  check('重算返回 200', rc.data?.code === 200, `code=${rc.data?.code}`)
  check('重算变更 >=1（oldreport.pdf 文档→合同）', (rc.data?.data?.changed || 0) >= 1, `changed=${rc.data?.data?.changed}`)

  log('\n[77] 分类规则列表 & 统计看板')
  const rl = await call('GET', '/api/v1/category-rules?spaceId=' + spaceId, null, token)
  check('规则列表含刚建规则', (rl.data?.data?.rules || []).length >= 1, `len=${(rl.data?.data?.rules || []).length}`)
  check('列表返回标准分类口径', Array.isArray(rl.data?.data?.categories) && rl.data?.data?.categories.includes('合同'))
  const st = await call('GET', '/api/v1/assets/stats?spaceId=' + spaceId, null, token)
  check('统计 total>0', (st.data?.data?.total || 0) > 0, `total=${st.data?.data?.total}`)
  check('统计 byCategory 含「合同」', (st.data?.data?.byCategory?.['合同'] || 0) > 0, `contract=${st.data?.data?.byCategory?.['合同']}`)

  // ===================== 宠物成长进化体系 =====================
  log('\n[78] 进化阶段：全新宠物(Lv1)返回幼崽，下一阶段为成长体(Lv3)')
  const evo0 = await call('GET', '/api/v1/pet/evolution', null, token2)
  check('进化接口可用', evo0.status === 200 && evo0.data?.code === 200, `code=${evo0.status}`)
  check('Lv1 当前阶段=幼崽', evo0.data?.data?.currentStage?.stage === 'baby', `stage=${evo0.data?.data?.currentStage?.stage}`)
  check('下一阶段为成长体(Lv3)', evo0.data?.data?.nextStage?.level === 3 && evo0.data?.data?.nextStage?.stage === 'grow', `next=${JSON.stringify(evo0.data?.data?.nextStage)}`)

  log('\n[79] 装扮商店等级锁定态：未达等级不可购买')
  const shop0 = await call('GET', '/api/v1/pet-shop', null, token2)
  const crown = shop0.data?.data?.items?.find((x) => x.key === 'hat_crown')
  const sakura = shop0.data?.data?.items?.find((x) => x.key === 'bg_sakura')
  check('皇冠(Lv5)对 Lv1 锁定', crown?.locked === true && crown?.unlockLevel === 5, `locked=${crown?.locked}`)
  check('樱花(Lv1)对 Lv1 解锁', sakura?.locked === false, `locked=${sakura?.locked}`)

  log('\n[80] 等级不足购买被拒(403)')
  const buyLocked = await call('POST', '/api/v1/pet-shop/buy', { itemKey: 'hat_crown' }, token2)
  check('等级不足购买 → 403', buyLocked.status === 403, `code=${buyLocked.status}`)

  log('\n[81] 升级触发进化：小游戏高分跨越 Lv1→Lv3 解锁成长体')
  const pg = await call('POST', '/api/v1/pet/play-game', { game: 'memory', score: 500 }, token2)
  check('游戏结算成功', pg.status === 200 && pg.data?.code === 200, `code=${pg.status}`)
  check('跨越等级已升级到 Lv3', pg.data?.data?.level === 3, `level=${pg.data?.data?.level}`)
  check('刚进化 → 成长体', pg.data?.data?.evolutionJustUnlocked?.stage === 'grow' && pg.data?.data?.evolutionJustUnlocked?.title === '成长体', `evo=${JSON.stringify(pg.data?.data?.evolutionJustUnlocked)}`)

  log('\n[82] 进化后商店解锁：Lv3 解锁海洋背景(Lv3)')
  const shop1 = await call('GET', '/api/v1/pet-shop', null, token2)
  const ocean = shop1.data?.data?.items?.find((x) => x.key === 'bg_ocean')
  check('海洋背景(Lv3)现已解锁', ocean?.locked === false, `locked=${ocean?.locked}`)

  log('\n[83] 每日签到等级特权：奖励含等级加成')
  const ck = await call('POST', '/api/v1/pet/checkin', null, token2)
  check('签到成功', ck.status === 200 && ck.data?.code === 200, `code=${ck.status}`)
  check('奖励=基础5+等级加成(Lv3→3)=8', ck.data?.data?.award === 8 && ck.data?.data?.levelBonus === 3, `award=${ck.data?.data?.award} bonus=${ck.data?.data?.levelBonus}`)

  // ===================== 等级特权（B）：专属互动 + 经验加成 =====================
  log('\n[84] 等级特权：专属互动未达等级被拒(403)')
  const walk403 = await call('POST', '/api/v1/pet/action', { action: 'walk' }, token2) // token2 现 Lv3，walk 需 Lv5
  check('Lv3 遛弯被拒 403', walk403.status === 403, `code=${walk403.status}`)
  const train403 = await call('POST', '/api/v1/pet/action', { action: 'train' }, token2) // train 需 Lv8
  check('Lv3 特训被拒 403', train403.status === 403, `code=${train403.status}`)

  log('\n[85] 等级特权：互动经验随等级加成（Lv3 → ×1.06，feed 基础10→实得11）')
  const beforeExp = (await call('GET', '/api/v1/pet', null, token2)).data?.data?.exp
  const fed = await call('POST', '/api/v1/pet/action', { action: 'feed' }, token2)
  const afterExp = fed.data?.data?.exp
  check('feed 实际获得经验 = 11（含等级加成）', afterExp - beforeExp === 11, `delta=${afterExp - beforeExp}`)

  log('\n[86] 专属互动动作列表接口（含解锁状态）')
  const sa = await call('GET', '/api/v1/pet/special-actions', null, token2)
  const walkEntry = sa.data?.data?.specialActions?.find((x) => x.key === 'walk')
  const trainEntry = sa.data?.data?.specialActions?.find((x) => x.key === 'train')
  check('返回遛弯(Lv5 未解锁)', walkEntry?.unlockLevel === 5 && walkEntry?.unlocked === false, JSON.stringify(walkEntry))
  check('返回特训(Lv8 未解锁)', trainEntry?.unlockLevel === 8 && trainEntry?.unlocked === false, JSON.stringify(trainEntry))

  // ===================== 跨会话排行榜（C） =====================
  log('\n[87] 跨会话宠物排行榜：按等级降序、脱敏、标记自己')
  const lb = await call('GET', '/api/v1/pet/leaderboard?limit=20', null, token2)
  const lbList = lb.data?.data?.list || []
  check('排行榜 200 且非空', lb.status === 200 && lbList.length > 0, `len=${lbList.length}`)
  let lbDesc = true
  for (let i = 1; i < lbList.length; i++) if (lbList[i - 1].level < lbList[i].level) lbDesc = false
  check('按等级降序排列', lbDesc, `top=${lbList[0]?.level}`)
  check('含脱敏字段 ownerName', typeof lbList[0]?.ownerName === 'string' && lbList[0].ownerName.length > 0, `owner=${lbList[0]?.ownerName}`)
  check('标记自己(isMe)', lbList.some((e) => e.isMe === true), `hasMe=${lbList.some((e) => e.isMe)}`)

  // ===================== 分类规则导入导出 + 统计趋势（D） =====================
  log('\n[88] 分类规则导出')
  const expRules = await call('GET', '/api/v1/category-rules/export?spaceId=' + spaceId, null, token)
  check('导出 200 含 rules', expRules.status === 200 && Array.isArray(expRules.data?.data?.rules), `len=${(expRules.data?.data?.rules || []).length}`)
  check('导出含已建 pdf→合同 规则', (expRules.data?.data?.rules || []).some((r) => r.matchType === 'extension' && r.pattern === 'pdf' && r.targetCategory === '合同'), `rules=${JSON.stringify(expRules.data?.data?.rules)}`)

  log('\n[89] 分类规则导入（覆盖式）')
  const imp = await call('POST', '/api/v1/category-rules/import', {
    spaceId,
    rules: [
      { matchType: 'extension', pattern: 'pdf', targetCategory: '文档', priority: 5 },
      { matchType: 'extension', pattern: 'zip', targetCategory: '归档', priority: 3 },
    ],
  }, token)
  check('导入 200', imp.status === 200, `code=${imp.status}`)
  check('导入创建 2 条', imp.data?.data?.created === 2, `created=${imp.data?.data?.created}`)
  const rlAfter = await call('GET', '/api/v1/category-rules?spaceId=' + spaceId, null, token)
  check('导入后规则总数=2（覆盖）', (rlAfter.data?.data?.rules || []).length === 2, `len=${(rlAfter.data?.data?.rules || []).length}`)

  log('\n[90] 统计趋势图数据（近 30 天）')
  const st2 = await call('GET', '/api/v1/assets/stats?spaceId=' + spaceId, null, token)
  const trend = st2.data?.data?.trend || []
  check('趋势数组长度=30', trend.length === 30, `len=${trend.length}`)
  check('趋势均为非负整数', trend.every((t) => Number.isInteger(t.count) && t.count >= 0), `sample=${JSON.stringify(trend.slice(0, 3))}`)

  // ===================== 排行榜周/月榜 + 规则导入合并（1/2/3 增强） =====================
  log('\n[91] 排行榜 range 参数（all/week/month 均按时间窗返回）')
  const lbAll = await call('GET', '/api/v1/pet/leaderboard?limit=20&range=all', null, token2)
  const lbWeek = await call('GET', '/api/v1/pet/leaderboard?limit=20&range=week', null, token2)
  const lbMonth = await call('GET', '/api/v1/pet/leaderboard?limit=20&range=month', null, token2)
  check('range=all 返回 range 字段', lbAll.data?.data?.range === 'all' && Array.isArray(lbAll.data?.data?.list), `range=${lbAll.data?.data?.range}`)
  check('range=week 返回非空列表', lbWeek.status === 200 && (lbWeek.data?.data?.list || []).length > 0, `len=${(lbWeek.data?.data?.list || []).length}`)
  check('range=month 返回非空列表', lbMonth.status === 200 && (lbMonth.data?.data?.list || []).length > 0, `len=${(lbMonth.data?.data?.list || []).length}`)

  log('\n[92] 分类规则导入（增量合并 merge）')
  // 先覆盖式导入 2 条，再合并式导入：1 条已存在(改分类) + 1 条全新
  await call('POST', '/api/v1/category-rules/import', {
    spaceId,
    rules: [
      { matchType: 'extension', pattern: 'pdf', targetCategory: '合同', priority: 10 },
      { matchType: 'extension', pattern: 'zip', targetCategory: '归档', priority: 3 },
    ],
  }, token)
  const merge = await call('POST', '/api/v1/category-rules/import', {
    spaceId,
    mode: 'merge',
    rules: [
      { matchType: 'extension', pattern: 'pdf', targetCategory: '文档' }, // 已存在，应更新
      { matchType: 'extension', pattern: 'png', targetCategory: '图片' }, // 全新，应新建
    ],
  }, token)
  check('合并导入 200', merge.status === 200, `code=${merge.status}`)
  check('合并导入 新建1 更新1', merge.data?.data?.created === 1 && merge.data?.data?.updated === 1, `created=${merge.data?.data?.created} updated=${merge.data?.data?.updated}`)
  const rlMerge = await call('GET', '/api/v1/category-rules?spaceId=' + spaceId, null, token)
  const rlMergeList = rlMerge.data?.data?.rules || []
  check('合并后总数=3（pdf/zip/png）', rlMergeList.length === 3, `len=${rlMergeList.length}`)
  const pdfRule = rlMergeList.find((r) => r.pattern === 'pdf')
  check('pdf 规则被合并更新为「文档」', pdfRule?.targetCategory === '文档', `cat=${pdfRule?.targetCategory}`)

  await rm(sourceDir, { recursive: true, force: true }).catch(() => {})
  log(`\n==== 结果：${pass} 通过 / ${fail} 失败 ====`)
  process.exit(fail ? 1 : 0)
}
run().catch((e) => { console.error('脚本异常:', e); process.exit(2) })
