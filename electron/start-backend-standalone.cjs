// 独立启动后端（无 UI 引导脚本，供开机自启调用）
// 逻辑复刻 electron/main.cjs：从 userData 注入 LLM 配置 + 人设，数据库指到 userData/data/aie.db
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const net = require('net')

/** 幂等检查：3001 已被监听（Electron 客户端已起后端 / 已有实例）则直接退出 */
function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' })
    sock.once('connect', () => { sock.destroy(); resolve(true) })
    sock.once('error', () => resolve(false))
  })
}

function parseEnvFile(filePath) {
  const result = {}
  if (!filePath || !fs.existsSync(filePath)) return result
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/)
      if (m) result[m[1]] = m[2]
    }
  } catch (e) {
    console.error('[autostart] 解析 env 失败:', e.message)
  }
  return result
}

function main() {
  const port = Number(process.env.PORT || '3001')
  const userData = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'aie-desktop')
  const backendPath = path.join(__dirname, 'resources', 'backend')
  const entry = path.join(backendPath, 'dist', 'index.js')
  const dbPath = path.join(userData, 'data', 'aie.db')
  const llmEnvPath = path.join(userData, 'llm.env')
  const personaPath = path.join(userData, 'agent-persona.txt')

  if (!fs.existsSync(entry)) {
    console.error('[autostart] 后端入口不存在:', entry)
    process.exit(1)
  }
  if (!fs.existsSync(dbPath)) {
    console.error('[autostart] 数据库不存在:', dbPath)
    process.exit(1)
  }

  // 幂等：3001 已在监听则静默退出（避免与 Electron 客户端/已有实例双开冲突）
  portInUse(port).then((inUse) => {
    if (inUse) {
      console.log(`[autostart] ${port} 已被监听，检测到后端已在运行，跳过启动`)
      process.exit(0)
    }
    launch()
  })

  function launch() {
    // 注入（主进程注入优先，dotenv 不覆盖已注入值 → 逻辑与 main.cjs getLLMEnv/getPersonaEnv 一致）
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL: 'file:' + dbPath.replace(/\\/g, '/'),
      ...parseEnvFile(llmEnvPath),
    }
    let persona = ''
    try {
      persona = fs.readFileSync(personaPath, 'utf8').trim()
    } catch { /* 无 persona 文件则跳过 */ }
    if (persona) env.AGENT_PERSONA_PROMPT = persona

    console.log('[autostart] 启动后端:', entry)
    console.log('[autostart] 数据库:', env.DATABASE_URL)
    console.log('[autostart] LLM:', env.LLM_MODEL || '(未注入)')

    const proc = spawn(process.execPath, [entry], {
      cwd: backendPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    proc.stdout.on('data', (d) => process.stdout.write('[backend] ' + d.toString()))
    proc.stderr.on('data', (d) => process.stderr.write('[backend:err] ' + d.toString()))
    proc.on('exit', (code, signal) => {
      console.log('[autostart] 后端退出 code=' + code + ' signal=' + signal)
      process.exit(code || 0)
    })
    proc.on('error', (e) => {
      console.error('[autostart] spawn 失败:', e.message)
      process.exit(1)
    })
  }
}

main()