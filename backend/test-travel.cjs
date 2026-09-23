const B = 'http://127.0.0.1:3001/api/v1'

async function sendAndRead(sid, H, text) {
  const r = await fetch(`${B}/chat/sessions/${sid}/messages`, {
    method: 'POST', headers: H, body: JSON.stringify({ content: text }),
  })
  if (!r.ok) { console.log('send failed:', r.status); return null }
  for (let i = 0; i < 25; i++) {
    await new Promise((s) => setTimeout(s, 1000))
    const msgs = await (await fetch(`${B}/chat/sessions/${sid}/messages`, { headers: H })).json()
    const list = msgs.data || []
    if (list.length >= 2 && list[list.length - 1].role === 'assistant') {
      console.log(`\n用户: ${text}`)
      console.log(`角角: ${list[list.length - 1].content}`)
      return list[list.length - 1].content
    }
  }
  console.log(`\n[${text}] 25秒内没等到回复`)
  return null
}

async function main() {
  const reg = await (await fetch(`${B}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'travel_tmp1', password: 'test1234a' }),
  })).json()
  if (!reg.data?.token) { console.log('register failed:', JSON.stringify(reg)); process.exit(1) }
  const H = { Authorization: `Bearer ${reg.data.token}`, 'Content-Type': 'application/json' }
  const sess = await (await fetch(`${B}/chat/sessions`, {
    method: 'POST', headers: H, body: JSON.stringify({ title: 'travel' }),
  })).json()
  const sid = sess.data.id

  // 第一轮：应该说路程
  await sendAndRead(sid, H, '我明天3点要去见客户')
  // 第二轮：给了路程 → 应创建任务+出发时间
  await sendAndRead(sid, H, '从公司过去，大概半小时车程')

  // 查任务和提醒是否带出行规划
  const tasks = await (await fetch(`${B}/tasks`, { headers: H })).json()
  const tList = tasks.data?.items || tasks.data || []
  console.log('\n任务:', JSON.stringify(tList.map((t) => ({ title: t.title, dueDate: t.dueDate }))))
  const rems = await (await fetch(`${B}/reminders`, { headers: H })).json()
  const rList = rems.data?.items || rems.data || []
  console.log('提醒:', JSON.stringify(rList.map((r) => ({ title: r.title, content: r.content, remindAt: r.remindAt }))))
  console.log('TEMP_USER_ID=' + reg.data.user.id)
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
