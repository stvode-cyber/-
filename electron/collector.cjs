// 桌面端采集核心逻辑（纯 Node，不依赖 Electron 运行时，可独立 node 测试）
// - 递归扫描指定文件夹，过滤出 DAM 关注的文档/图片/音频/视频
// - 按扩展名做离线可用的基础分类
// 主进程 main.cjs 在此之上注册 IPC（选文件夹 / 扫描 / 读字节 / 监听）并对接后端同步端点。

const fs = require('fs')
const path = require('path')

// 各类型关注的扩展名（与后端 inferType 保持一致口径）
const EXT_BY_TYPE = {
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'rtf', 'odt', 'pages', 'key', 'numbers'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tiff'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'flv'],
}
const ALLOWED_EXT = new Set(Object.values(EXT_BY_TYPE).flat())

function extOf(name) {
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return ''
  return name.slice(i + 1).toLowerCase()
}

// 离线基础分类：按扩展名判定类型；返回 null 表示不采集
function classifyByExt(name) {
  const ext = extOf(name)
  if (!ALLOWED_EXT.has(ext)) return null
  for (const [type, exts] of Object.entries(EXT_BY_TYPE)) {
    if (exts.includes(ext)) return type
  }
  return null
}

// 递归扫描：返回 [{ path, name, ext, size, mtime }]，mtime 为毫秒时间戳
// opts.max 限制采集条目数（防止超大目录打爆内存），opts.skipDirs 额外跳过的目录名
async function scanFolder(root, opts = {}) {
  const max = opts.max || 5000
  const skip = new Set(['node_modules', '.git', 'AppData', 'Library', 'Cache', ...(opts.skipDirs || [])])
  const out = []
  async function walk(dir) {
    if (out.length >= max) return
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return // 无权限或不存在则跳过
    }
    for (const e of entries) {
      if (out.length >= max) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || skip.has(e.name)) continue
        await walk(full)
      } else if (e.isFile()) {
        const type = classifyByExt(e.name)
        if (!type) continue
        try {
          const st = await fs.promises.stat(full)
          out.push({
            path: full,
            name: e.name,
            ext: extOf(e.name),
            type,
            size: st.size,
            mtime: st.mtimeMs,
          })
        } catch {
          /* 读取失败跳过 */
        }
      }
    }
  }
  await walk(root)
  return out
}

module.exports = { ALLOWED_EXT, classifyByExt, scanFolder, EXT_BY_TYPE }

// ---- 独立运行入口（P1-4 解耦验证）：node collector.cjs [--scan <dir> [--max N]] | [--selftest] ----
// collector 本就是纯 Node 模块（不依赖 electron runtime），此入口证明其可被独立 node 进程运行，
// 便于将来切壳（Tauri）或远程助手以 spawn/stdio 方式复用，而无需改动核心扫描逻辑。
if (require.main === module) {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) {
    runSelfTest()
      .then((ok) => process.exit(ok ? 0 : 1))
      .catch((e) => {
        console.error(e.message)
        process.exit(1)
      })
  }
  const scanIdx = argv.indexOf('--scan')
  if (scanIdx !== -1) {
    const dir = argv[scanIdx + 1]
    const maxIdx = argv.indexOf('--max')
    const max = maxIdx !== -1 ? Number(argv[maxIdx + 1]) : 5000
    if (!dir) {
      console.error('用法: node collector.cjs --scan <dir> [--max N]')
      process.exit(2)
    }
    scanFolder(dir, { max })
      .then((list) => console.log(JSON.stringify(list, null, 2)))
      .catch((e) => {
        console.error(e.message)
        process.exit(1)
      })
  } else {
    console.log('用法:')
    console.log('  node collector.cjs --scan <dir> [--max N]   扫描指定目录并输出 JSON')
    console.log('  node collector.cjs --selftest               运行 6 项自测（分类/过滤/递归）')
  }
}

// 6 项自测：4 类型分类 + 过滤非关注扩展名 + 递归扫描/mtime
async function runSelfTest() {
  const os = require('os')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-selftest-'))
  const sub = path.join(root, 'sub')
  fs.mkdirSync(sub, { recursive: true })
  for (const f of ['a.pdf', 'b.png', 'c.mp3', 'd.mp4', 'e.xyz', 'sub/f.txt']) {
    fs.writeFileSync(path.join(root, f), 'x')
  }
  const list = await scanFolder(root, { max: 5000 })
  const byName = Object.fromEntries(list.map((x) => [x.name, x]))
  const checks = [
    ['document 分类正确', byName['a.pdf'] && byName['a.pdf'].type === 'document'],
    ['image 分类正确', byName['b.png'] && byName['b.png'].type === 'image'],
    ['audio 分类正确', byName['c.mp3'] && byName['c.mp3'].type === 'audio'],
    ['video 分类正确', byName['d.mp4'] && byName['d.mp4'].type === 'video'],
    ['过滤非关注扩展名 e.xyz', !byName['e.xyz']],
    ['递归扫描 sub/f.txt 且 mtime 为数字', byName['f.txt'] && typeof byName['f.txt'].mtime === 'number'],
  ]
  let pass = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name}`)
    if (ok) pass++
  }
  console.log(`自测结果: ${pass}/${checks.length}`)
  fs.rmSync(root, { recursive: true, force: true })
  return pass === checks.length
}
