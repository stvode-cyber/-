// 检查当前电脑的 AI 环境是否激活
const fs = require('fs')
const path = require('path')
const userDataDir = path.join(
  process.env.APPDATA || process.env.HOME + '/.config',
  'aie-desktop'
)
const llmEnvPath = path.join(userDataDir, 'llm.env')
const personaPath = path.join(userDataDir, 'agent-persona.txt')

console.log('=== 当前电脑 aie-desktop 信息 ===')
console.log('userData 目录:', userDataDir)
console.log('')

const fsExists = (p) => fs.existsSync(p)
const fileStat = (p) => { try { return fs.statSync(p).size } catch { return 0 } }

console.log('1. LLM 配置文件 (llm.env):')
console.log('   路径:', llmEnvPath)
if (fsExists(llmEnvPath)) {
  const size = fileStat(llmEnvPath)
  const content = fs.readFileSync(llmEnvPath, 'utf8').trim()
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0)
  console.log('   存在 ✓ 大小 %d 字节 %d 行', size, lines.length)
  console.log('   --- 配置内容（key 脱敏，key 展示，value 只显示长度）---')
  lines.forEach(line => {
    const [k, v] = line.split('=', 2)
    if (!k) return
    console.log('   ', k + '=', v ? `[${v.length} 字符]` : '(空)')
  })
  const hasProvider = lines.some(l => l.startsWith('LLM_PROVIDER')) && !lines.some(l => /LLM_PROVIDER\s*=\s*(none|)$/.test(l))
  const hasKey = lines.some(l => l.startsWith('LLM_API_KEY') && l.split('=')[1]?.trim().length > 0)
  console.log('')
  console.log('   LLM_PROVIDER 有效:', hasProvider ? '是 ✓' : '否 ✗')
  console.log('   LLM_API_KEY 非空:', hasKey ? '是 ✓' : '否 ✗')
  if (hasProvider && hasKey) {
    console.log('   👉 AI 配置已就绪，可以正常使用智能对话')
  } else {
    console.log('   👉 AI 配置不完整，智能对话无法激活')
  }
} else {
  console.log('   ❌ 不存在')
  console.log('   需要手动复制 llm.env 到该目录，否则无法激活 AI')
}

console.log('\n2. 老朋友人设 (agent-persona.txt):')
console.log('   路径:', personaPath)
if (fsExists(personaPath)) {
  const size = fileStat(personaPath)
  console.log('   存在 ✓ 大小 %d 字节', size)
  if (size > 10) {
    console.log('   👉 老朋友人设已激活')
  } else {
    console.log('   ⚠️ 文件存在但内容为空')
  }
} else {
  console.log('   ❌ 不存在，首次启动时会自动从配置提取')
}

console.log('\n3. 数据库状态:')
const dbPath = path.join(userDataDir, 'data', 'aie.db')
console.log('   路径:', dbPath)
if (fsExists(dbPath)) {
  const size = fileStat(dbPath)
  console.log('   存在 ✓ 大小 %d KB', Math.round(size/1024))
  if (size > 100 * 1024) {
    console.log('   👉 数据库已正常初始化（50 表已建好）')
  } else {
    console.log('   ⚠️ 文件过小，疑似初始化失败')
  }
} else {
  console.log('   ❌ 不存在，应用还没启动过，或初始化未完成')
}

console.log('\n=== 总结 ===')
