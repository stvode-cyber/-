const { Client } = require('ssh2')
const fs = require('fs')
const path = require('path')

const HOST = '121.40.145.206'
const USER = 'root'
const PASS = 'trnepwq0101A'
const REMOTE_DIR = '/root/greenrhino'
const BACKEND_DIR = path.resolve(__dirname, '..', 'backend')

console.log('=== 绿角犀后端部署 ===')

function collectFiles(dir, base = '') {
  const files = []
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dev.db', 'dist', '.git', 'data'].includes(item.name)) continue
    const full = path.join(dir, item.name)
    const rel = base ? `${base}/${item.name}` : item.name
    if (item.isDirectory()) files.push(...collectFiles(full, rel))
    else files.push({ local: full, remote: rel })
  }
  return files
}

const files = collectFiles(BACKEND_DIR)
console.log(`1. 收集到 ${files.length} 个文件`)

const envContent = fs.readFileSync(path.join(BACKEND_DIR, '.env'), 'utf8')
const prodEnv = envContent.replace(/CORS_ORIGIN=.*/, 'CORS_ORIGIN="*"') + '\nHOST=0.0.0.0\n'

const conn = new Client()
conn.on('error', (err) => console.error('SSH error:', err.message))

conn.on('ready', () => {
  console.log('2. SSH 连接成功')

  // 打开一个 SFTP 会话用于所有文件上传
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err); conn.end(); return }

    // 创建所有需要的目录
    const dirs = new Set(['/backend'])
    for (const f of files) {
      const parts = f.remote.split('/')
      for (let i = 1; i < parts.length; i++) dirs.add('/backend/' + parts.slice(0, i).join('/'))
    }

    function mkdirRecursive(dirs, idx, done) {
      if (idx >= dirs.length) { done(); return }
      const dirPath = REMOTE_DIR + [...dirs][idx]
      sftp.mkdir(dirPath, (err) => {
        // 忽略 "已存在" 错误
        mkdirRecursive(dirs, idx + 1, done)
      })
    }

    // 递归创建目录（用 exec 更可靠）
    const dirArray = [...dirs]
    function createDirs(i) {
      if (i >= dirArray.length) { uploadFiles(0); return }
      conn.exec(`mkdir -p ${REMOTE_DIR}${dirArray[i]}`, () => createDirs(i + 1))
    }

    function uploadFiles(i) {
      if (i >= files.length) {
        console.log(`   全部 ${files.length} 个文件上传完成`)
        writeEnv()
        return
      }
      const f = files[i]
      const remotePath = `${REMOTE_DIR}/backend/${f.remote}`
      sftp.fastPut(f.local, remotePath, (err) => {
        if (err) console.error(`   失败: ${f.remote}`)
        if ((i + 1) % 10 === 0 || i === files.length - 1) console.log(`   已上传 ${i + 1}/${files.length}`)
        uploadFiles(i + 1)
      })
    }

    function writeEnv() {
      console.log('\n3. 写入 .env...')
      sftp.writeFile(`${REMOTE_DIR}/backend/.env`, Buffer.from(prodEnv, 'utf8'), (err) => {
        if (err) { console.error(err); return }
        console.log('   .env OK')
        sftp.end()
        runCmds()
      })
    }

    createDirs(0)
  })
})

function runCmds() {
  const cmds = [
    ['安装依赖', `cd ${REMOTE_DIR}/backend && npm install 2>&1 | tail -3`],
    ['Prisma Generate', `cd ${REMOTE_DIR}/backend && npx prisma generate 2>&1 | tail -3`],
    ['Prisma DB Push', `cd ${REMOTE_DIR}/backend && npx prisma db push 2>&1 | tail -3`],
    ['Seed', `cd ${REMOTE_DIR}/backend && npx tsx prisma/seed.ts 2>&1 | tail -5`],
  ]

  function run(i) {
    if (i >= cmds.length) { startPm2(); return }
    console.log(`\n${4 + i}. ${cmds[i][0]}...`)
    conn.exec(cmds[i][1], (err, stream) => {
      if (err) { console.error(err); run(i + 1); return }
      let out = ''
      stream.on('data', d => out += d)
      stream.stderr.on('data', d => out += d)
      stream.on('close', () => {
        console.log('   ' + out.trim().split('\n').slice(-3).join('\n   '))
        run(i + 1)
      })
    })
  }
  run(0)
}

function startPm2() {
  console.log('\n8. 启动 PM2...')
  conn.exec(`cd ${REMOTE_DIR}/backend && pm2 delete greenrhino 2>/dev/null; pm2 start "npx tsx src/index.ts" --name greenrhino && pm2 save 2>&1 | tail -5`, (err, stream) => {
    if (err) { console.error(err); conn.end(); return }
    let out = ''
    stream.on('data', d => out += d)
    stream.stderr.on('data', d => out += d)
    stream.on('close', () => {
      console.log('   ' + out.trim().split('\n').slice(-5).join('\n   '))
      setTimeout(() => {
        conn.exec(`curl -s http://127.0.0.1:3001/health`, (err, stream) => {
          if (err) { console.error(err); conn.end(); return }
          let out = ''
          stream.on('data', d => out += d)
          stream.on('close', () => {
            console.log('\n9. 健康检查: ' + out)
            console.log('\n=== 部署完成 ===')
            console.log(`   后端: http://${HOST}:3001/api/v1`)
            conn.end()
          })
        })
      }, 5000)
    })
  })
}

conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 })
