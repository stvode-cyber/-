/**
 * 图片压缩工具：File → 压缩后的 data URL（JPEG）
 *
 * 用于朋友圈九宫格 / 相册上传前的体积控制（1280px / quality 0.8 ≈ 300-500KB），
 * 与聊天图片压缩策略一致。
 *
 * @param file 原始文件
 * @param maxSize 最长边像素上限
 * @param quality JPEG 质量 0-1
 */
export function compressImage(file: File, maxSize: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height * maxSize) / width)
            width = maxSize
          } else {
            width = Math.round((width * maxSize) / height)
            height = maxSize
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 上下文不可用'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(reader.error || new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 头像专用压缩：File → 居中裁剪正方形 → 缩放到 maxSize → JPEG data URL
 *
 * 圆形头像展示需要正方形源图，避免宽高比不匹配导致的变形。
 *
 * @param file 原始文件
 * @param maxSize 输出边长像素（头像建议 256）
 * @param quality JPEG 质量 0-1
 */
export function compressAvatarImage(file: File, maxSize: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        // 居中裁剪为正方形
        const minSize = Math.min(img.width, img.height)
        const sx = (img.width - minSize) / 2
        const sy = (img.height - minSize) / 2

        const canvas = document.createElement('canvas')
        canvas.width = maxSize
        canvas.height = maxSize
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 上下文不可用'))
          return
        }
        ctx.drawImage(img, sx, sy, minSize, minSize, 0, 0, maxSize, maxSize)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(reader.error || new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}
