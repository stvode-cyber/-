import type { CompatibilityResult } from './api'

const CARD_W = 750
const CARD_H = 1200
const SCALE = 2

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// 中文按字符宽度累计换行，返回实际绘制的行
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(current)
      current = ''
      continue
    }
    const test = current + ch
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current)
      current = ch
      if (lines.length >= maxLines) return lines
    } else {
      current = test
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines
}

function drawStars(ctx: CanvasRenderingContext2D, seed: number) {
  // 固定伪随机种子，保证每次生成同一配对卡片一致
  let s = seed
  const rand = () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
  for (let i = 0; i < 40; i++) {
    const x = rand() * CARD_W
    const y = rand() * CARD_H * 0.45
    const r = rand() * 1.8 + 0.4
    ctx.globalAlpha = rand() * 0.5 + 0.15
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawScoreRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, score: number) {
  const start = Math.PI * 0.75
  const end = Math.PI * 2.25
  ctx.lineCap = 'round'
  ctx.lineWidth = 14
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  ctx.beginPath()
  ctx.arc(cx, cy, radius, start, end)
  ctx.stroke()

  const grad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius)
  grad.addColorStop(0, '#f472b6')
  grad.addColorStop(1, '#c084fc')
  ctx.strokeStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, radius, start, start + (end - start) * (score / 100))
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 64px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(String(score), cx, cy + 12)
  ctx.font = '20px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText('契合指数', cx, cy + 48)
}

function drawSignCircle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, symbol: string, name: string, element: string,
) {
  const r = 64
  const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  grad.addColorStop(0, 'rgba(255,255,255,0.22)')
  grad.addColorStop(1, 'rgba(255,255,255,0.08)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = '56px "Segoe UI Symbol", "PingFang SC", sans-serif'
  ctx.fillText(symbol, cx, cy + 20)

  ctx.font = 'bold 22px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(name, cx, cy + r + 30)
  ctx.font = '16px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText(`${element}象`, cx, cy + r + 54)
}

export function drawCompatibilityCard(result: CompatibilityResult): string {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W * SCALE
  canvas.height = CARD_H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.scale(SCALE, SCALE)

  // 背景：深紫夜空渐变
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H)
  bg.addColorStop(0, '#1e1b4b')
  bg.addColorStop(0.55, '#4c1d95')
  bg.addColorStop(1, '#831843')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // 顶部/底部光晕
  const glow = ctx.createRadialGradient(CARD_W / 2, 360, 40, CARD_W / 2, 360, 420)
  glow.addColorStop(0, 'rgba(244,114,182,0.28)')
  glow.addColorStop(1, 'rgba(244,114,182,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  const seed = (result.sign1.key.length + result.sign2.key.charCodeAt(0)) * 137
  drawStars(ctx, seed)

  const centerX = CARD_W / 2
  ctx.textAlign = 'center'

  // 标题
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.font = 'bold 30px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('✦ 星座配对 ✦', centerX, 88)
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = '15px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('星象见证你们的缘分', centerX, 116)

  // 星座对
  drawSignCircle(ctx, centerX - 150, 230, result.sign1.symbol, result.sign1.name, result.sign1.element)
  drawSignCircle(ctx, centerX + 150, 230, result.sign2.symbol, result.sign2.name, result.sign2.element)

  // 中间爱心
  const heartGrad = ctx.createRadialGradient(centerX, 230, 4, centerX, 230, 40)
  heartGrad.addColorStop(0, '#fb7185')
  heartGrad.addColorStop(1, '#e11d48')
  ctx.fillStyle = heartGrad
  ctx.font = '44px "Segoe UI Symbol", "Apple Symbols", sans-serif'
  ctx.fillText('♥', centerX, 245)

  // 分数环
  drawScoreRing(ctx, centerX, 470, 105, result.score)

  // 等级徽章
  const level = result.level
  ctx.font = 'bold 24px "PingFang SC", "Microsoft YaHei", sans-serif'
  const badgeW = ctx.measureText(level).width + 56
  const badgeGrad = ctx.createLinearGradient(centerX - badgeW / 2, 610, centerX + badgeW / 2, 654)
  badgeGrad.addColorStop(0, '#ec4899')
  badgeGrad.addColorStop(1, '#a855f7')
  ctx.fillStyle = badgeGrad
  roundRect(ctx, centerX - badgeW / 2, 610, badgeW, 44, 22)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.fillText(level, centerX, 640)

  // 元素关系 + 相位卡片
  const boxX = 60, boxW = CARD_W - 120
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  roundRect(ctx, boxX, 686, boxW, 132, 16)
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = '15px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('元 素', boxX + 24, 718)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = '17px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(result.elementRelation, boxX + 84, 719)
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = '15px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('相 位', boxX + 24, 758)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = '17px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(result.aspect.name, boxX + 84, 759)
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = '14px "PingFang SC", "Microsoft YaHei", sans-serif'
  wrapText(ctx, result.aspect.desc, boxW - 128, 1).forEach((line) => ctx.fillText(line, boxX + 84, 788))

  // AI 摘要
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = '15px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('— 星象解读 —', centerX, 872)
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = '18px "PingFang SC", "Microsoft YaHei", sans-serif'
  const lines = wrapText(ctx, result.interpretation.summary, boxW - 48, 3)
  lines.forEach((line, i) => ctx.fillText(line, centerX, 908 + i * 32))

  // 建议语
  ctx.fillStyle = 'rgba(251,209,139,0.95)'
  ctx.font = '16px "PingFang SC", "Microsoft YaHei", sans-serif'
  wrapText(ctx, result.interpretation.advice, boxW - 48, 2).forEach((line, i) =>
    ctx.fillText(line, centerX, 908 + lines.length * 32 + 34 + i * 28),
  )

  // 底部品牌
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = 'bold 20px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('绿角犀 app', centerX, 1120)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = '13px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('配对结果仅供娱乐参考 · 真心与包容才是相处的秘诀', centerX, 1148)

  return canvas.toDataURL('image/png')
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
