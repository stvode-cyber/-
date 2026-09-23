// 从 pwa-512x512.png 生成 Windows .ico（PNG 嵌入格式，Win10+ 兼容）
// ICO 格式：6 字节头 + 16 字节目录项 + PNG 数据
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', 'frontend', 'dist', 'pwa-512x512.png')
const DEST_DIR = path.join(__dirname, 'build')
const DEST = path.join(DEST_DIR, 'icon.ico')

if (!fs.existsSync(SRC)) {
  console.error('源 PNG 不存在:', SRC)
  process.exit(1)
}

fs.mkdirSync(DEST_DIR, { recursive: true })

const png = fs.readFileSync(SRC)
const pngSize = png.length

// ICO 头（6 字节）：reserved=0, type=1(icon), count=1
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type = 1 (icon)
header.writeUInt16LE(1, 4) // image count = 1

// 目录项（16 字节）：宽/高/颜色数/保留/位面/bpp/大小/偏移
// 宽高：>255 时记为 0（表示 256+），512 记 0
const dir = Buffer.alloc(16)
dir.writeUInt8(0, 0) // width (0 = 256+, 实际 512)
dir.writeUInt8(0, 1) // height (0 = 256+, 实际 512)
dir.writeUInt8(0, 2) // color count (0 = >256 colors)
dir.writeUInt8(0, 3) // reserved
dir.writeUInt16LE(1, 4) // color planes
dir.writeUInt16LE(32, 6) // bits per pixel
dir.writeUInt32LE(pngSize, 8) // image data size
dir.writeUInt32LE(22, 12) // offset = 6(header) + 16(dir) = 22

const ico = Buffer.concat([header, dir, png])
fs.writeFileSync(DEST, ico)
console.log(`✓ 生成 ${DEST} (${ico.length} bytes, 嵌入 512x512 PNG)`)
