import { useEffect, useRef } from 'react'

export type WallpaperTheme = 'aurora' | 'bubbles' | 'gradient' | 'starfield' | 'pet' | 'sakura' | 'firefly' | 'stream'

interface Props {
  theme: WallpaperTheme
  /** 动画速度 0-100 */
  speed: number
  /** 不透明度 0-100 */
  opacity: number
  /** 壁纸上是否显示宠物漫游 */
  showPet?: boolean
}

interface P {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  hue: number
  ph: number
}

const PALETTES: Record<WallpaperTheme, string[]> = {
  aurora: ['#22d3ee', '#34d399', '#a78bfa', '#f472b6'],
  bubbles: ['#60a5fa', '#818cf8', '#c084fc', '#38bdf8'],
  gradient: ['#0ea5e9', '#6366f1', '#ec4899', '#f59e0b'],
  starfield: ['#ffffff', '#bae6fd', '#e9d5ff', '#fde68a'],
  pet: ['#fbcfe8', '#a7f3d0', '#bfdbfe', '#fde68a'],
  // 小鸟壁纸风格主题
  sakura: ['#fbcfe8', '#f9a8d4', '#fda4af', '#fde68a'],
  firefly: ['#a3e635', '#facc15', '#fde047', '#fef08a'],
  stream: ['#22d3ee', '#818cf8', '#c084fc', '#34d399'],
}

export default function WallpaperCanvas({ theme, speed, opacity, showPet = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    let particles: P[] = []
    let stars: P[] = []
    let t = 0
    let last = performance.now()
    let raf = 0

    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      initParticles()
    }

    const initParticles = () => {
      const pal = PALETTES[theme]
      let count
      if (theme === 'starfield') count = Math.floor((w * h) / 9000)
      else if (theme === 'sakura') count = Math.min(50, Math.floor((w * h) / 18000) + 18)
      else if (theme === 'firefly') count = Math.min(45, Math.floor((w * h) / 22000) + 16)
      else if (theme === 'stream') count = 12
      else count = Math.min(40, Math.floor((w * h) / 26000) + 14)
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: theme === 'bubbles'
          ? 6 + Math.random() * 26
          : theme === 'sakura'
          ? 24 + Math.random() * 28
          : theme === 'firefly'
          ? 20 + Math.random() * 40
          : theme === 'stream'
          ? 40 + Math.random() * 80
          : 40 + Math.random() * 120,
        vx: theme === 'sakura' ? (Math.random() - 0.5) * 0.5 : (Math.random() - 0.5) * 0.3,
        vy: theme === 'bubbles'
          ? -(0.2 + Math.random() * 0.6)
          : theme === 'sakura'
          ? 0.4 + Math.random() * 0.5
          : (Math.random() - 0.5) * 0.3,
        hue: Math.floor(Math.random() * pal.length),
        ph: Math.random() * Math.PI * 2,
      }))
      stars = Array.from({ length: Math.floor((w * h) / 6000) + 40 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.6 + 0.4,
        vx: 0,
        vy: 0,
        hue: Math.floor(Math.random() * pal.length),
        ph: Math.random() * Math.PI * 2,
      }))
    }

    const baseBg = () => {
      ctx.fillStyle = theme === 'starfield' ? '#0b1026' : '#0f172a'
      ctx.fillRect(0, 0, w, h)
    }

    const drawGradient = () => {
      const off = (t * 0.04) % 1
      const g = ctx.createLinearGradient(0, 0, w, h)
      const pal = PALETTES.gradient
      g.addColorStop(0, pal[0])
      g.addColorStop(Math.min(0.999, 0.33 + off * 0.3), pal[1])
      g.addColorStop(Math.min(0.999, 0.66 + off * 0.2), pal[2])
      g.addColorStop(1, pal[3])
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }

    const drawAurora = () => {
      baseBg()
      ctx.globalCompositeOperation = 'lighter'
      const pal = PALETTES.aurora
      particles.forEach((p, i) => {
        const x = (p.x + Math.sin(t * 0.3 + p.ph + i) * 120 + t * p.vx * 20) % (w + 300)
        const y = h * 0.5 + Math.sin(t * 0.4 + p.ph) * h * 0.28 + (i % 3) * 30
        const xx = x < -150 ? x + w + 300 : x
        const rg = ctx.createRadialGradient(xx, y, 0, xx, y, p.r * 1.6)
        rg.addColorStop(0, pal[p.hue] + 'cc')
        rg.addColorStop(1, pal[p.hue] + '00')
        ctx.fillStyle = rg
        ctx.beginPath()
        ctx.arc(xx, y, p.r * 1.6, 0, Math.PI * 2)
        ctx.fill()
      })
      ctx.globalCompositeOperation = 'source-over'
    }

    const drawBubbles = () => {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#0c4a6e')
      g.addColorStop(1, '#082f49')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      const pal = PALETTES.bubbles
      particles.forEach((p) => {
        p.y += p.vy * (0.5 + speed / 60)
        p.x += Math.sin(t + p.ph) * 0.3
        if (p.y + p.r < 0) {
          p.y = h + p.r
          p.x = Math.random() * w
        }
        const rg = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, 1, p.x, p.y, p.r)
        rg.addColorStop(0, '#ffffff66')
        rg.addColorStop(0.4, pal[p.hue] + '55')
        rg.addColorStop(1, pal[p.hue] + '11')
        ctx.fillStyle = rg
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      })
    }

    const drawStarfield = () => {
      baseBg()
      stars.forEach((s) => {
        const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.5 + s.ph))
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
        s.y += 0.02 + speed / 4000
        if (s.y > h) s.y = 0
      })
      // 缓慢漂移的星云
      ctx.globalCompositeOperation = 'lighter'
      const pal = PALETTES.starfield
      particles.forEach((p, i) => {
        const xx = (p.x + Math.cos(t * 0.1 + i) * 80) % w
        const yy = (p.y + Math.sin(t * 0.13 + i) * 60) % h
        const rg = ctx.createRadialGradient(xx, yy, 0, xx, yy, p.r)
        rg.addColorStop(0, pal[i % pal.length] + '22')
        rg.addColorStop(1, pal[i % pal.length] + '00')
        ctx.fillStyle = rg
        ctx.beginPath()
        ctx.arc(xx, yy, p.r, 0, Math.PI * 2)
        ctx.fill()
      })
      ctx.globalCompositeOperation = 'source-over'
    }

    const drawPet = () => {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#1e1b4b')
      g.addColorStop(1, '#312e81')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      if (!showPet) return
      // Lissajous 漫游路径
      const cx = w / 2 + Math.sin(t * 0.5) * w * 0.32
      const cy = h / 2 + Math.sin(t * 0.7 + 1) * h * 0.28
      const bob = Math.sin(t * 3) * 6
      const R = Math.min(w, h) * 0.12
      // 影子
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.beginPath()
      ctx.ellipse(cx, cy + R * 0.95 + 8, R * 0.9, R * 0.28, 0, 0, Math.PI * 2)
      ctx.fill()
      // 身体
      ctx.fillStyle = '#fbcfe8'
      ctx.beginPath()
      ctx.ellipse(cx, cy + bob, R, R * 0.92, 0, 0, Math.PI * 2)
      ctx.fill()
      // 耳朵
      ctx.beginPath()
      ctx.ellipse(cx - R * 0.6, cy - R * 0.8 + bob, R * 0.28, R * 0.4, -0.4, 0, Math.PI * 2)
      ctx.ellipse(cx + R * 0.6, cy - R * 0.8 + bob, R * 0.28, R * 0.4, 0.4, 0, Math.PI * 2)
      ctx.fill()
      // 眼睛
      ctx.fillStyle = '#1f2937'
      ctx.beginPath()
      ctx.arc(cx - R * 0.3, cy - R * 0.05 + bob, R * 0.1, 0, Math.PI * 2)
      ctx.arc(cx + R * 0.3, cy - R * 0.05 + bob, R * 0.1, 0, Math.PI * 2)
      ctx.fill()
      // 腮红 + 嘴
      ctx.fillStyle = '#f9a8d4'
      ctx.beginPath()
      ctx.arc(cx - R * 0.45, cy + R * 0.2 + bob, R * 0.12, 0, Math.PI * 2)
      ctx.arc(cx + R * 0.45, cy + R * 0.2 + bob, R * 0.12, 0, Math.PI * 2)
      ctx.fill()
    }

    // ---- 小鸟壁纸风格：樱花飘落 ----
    const drawSakura = () => {
      // 暮色渐变底（粉橙暮空）
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#fef3c7')
      g.addColorStop(0.5, '#fbcfe8')
      g.addColorStop(1, '#fda4af')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      const pal = PALETTES.sakura
      ctx.globalCompositeOperation = 'source-over'
      particles.forEach((p, i) => {
        // 下落 + 风吹横向摆动
        p.y += p.vy * (0.6 + speed / 40)
        p.x += Math.sin(t * 0.6 + p.ph) * 0.8 + p.vx
        if (p.y > h + 20) {
          p.y = -20
          p.x = Math.random() * w
        }
        if (p.x < -20) p.x = w + 20
        if (p.x > w + 20) p.x = -20
        const rot = t * (0.5 + (i % 5) * 0.2) + p.ph
        const R = p.r * 0.18
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(rot)
        ctx.fillStyle = pal[p.hue] + 'dd'
        // 五瓣樱花（5 个椭圆花瓣）
        for (let k = 0; k < 5; k++) {
          ctx.beginPath()
          ctx.ellipse(0, -R * 0.8, R * 0.45, R * 0.85, (k / 5) * Math.PI * 2, 0, Math.PI * 2)
          ctx.fillStyle = pal[p.hue] + (k === 0 ? 'ee' : 'cc')
          ctx.fill()
        }
        // 花蕊
        ctx.fillStyle = '#fde68a'
        ctx.beginPath()
        ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      })
      ctx.globalCompositeOperation = 'source-over'
    }

    // ---- 小鸟壁纸风格：萤火虫 ----
    const drawFirefly = () => {
      // 深夜渐变底（深绿黑）
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#0b132b')
      g.addColorStop(1, '#0a1f14')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      const pal = PALETTES.firefly
      ctx.globalCompositeOperation = 'lighter'
      particles.forEach((p, i) => {
        // 缓慢漂浮（Lissajous 漫游 + 微抖动）
        p.x += Math.sin(t * 0.3 + p.ph) * 0.4 + p.vx * 0.5
        p.y += Math.cos(t * 0.25 + p.ph * 1.3) * 0.3 + p.vy * 0.3
        if (p.x < -30) p.x = w + 30
        if (p.x > w + 30) p.x = -30
        if (p.y < -30) p.y = h + 30
        if (p.y > h + 30) p.y = -30
        // 呼吸闪烁
        const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2 + p.ph + i))
        const col = pal[p.hue]
        const r = p.r * 0.12 + 1.5
        const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 6)
        rg.addColorStop(0, col + 'ff')
        rg.addColorStop(0.3, col + '88')
        rg.addColorStop(1, col + '00')
        ctx.globalAlpha = a
        ctx.fillStyle = rg
        ctx.beginPath()
        ctx.arc(p.x, p.y, r * 6, 0, Math.PI * 2)
        ctx.fill()
        // 萤火虫核心亮点
        ctx.fillStyle = '#fffbeb'
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      })
      ctx.globalCompositeOperation = 'source-over'
    }

    // ---- 小鸟壁纸风格：流光瀑布（多层流动波带）----
    const drawStream = () => {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#0f172a')
      g.addColorStop(1, '#1e1b4b')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      const pal = PALETTES.stream
      ctx.globalCompositeOperation = 'lighter'
      // 4 条波带，每条不同相位/颜色/振幅
      for (let band = 0; band < 4; band++) {
        const col = pal[band % pal.length]
        const yBase = h * (0.25 + band * 0.18)
        const amp = h * 0.08 * (1 + band * 0.15)
        const phase = t * (0.4 + band * 0.12) + band
        ctx.beginPath()
        ctx.moveTo(0, yBase + Math.sin(phase) * amp)
        for (let x = 0; x <= w; x += 8) {
          const y = yBase + Math.sin(phase + x * 0.008) * amp + Math.sin(phase * 0.7 + x * 0.02) * amp * 0.4
          ctx.lineTo(x, y)
        }
        ctx.lineTo(w, h)
        ctx.lineTo(0, h)
        ctx.closePath()
        const rg = ctx.createLinearGradient(0, yBase - amp, 0, yBase + amp)
        rg.addColorStop(0, col + '55')
        rg.addColorStop(0.5, col + '22')
        rg.addColorStop(1, col + '00')
        ctx.fillStyle = rg
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    const loop = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      t += dt * (0.3 + speed / 40)
      switch (theme) {
        case 'gradient':
          drawGradient()
          break
        case 'aurora':
          drawAurora()
          break
        case 'bubbles':
          drawBubbles()
          break
        case 'starfield':
          drawStarfield()
          break
        case 'pet':
          drawPet()
          break
        case 'sakura':
          drawSakura()
          break
        case 'firefly':
          drawFirefly()
          break
        case 'stream':
          drawStream()
          break
      }
      raf = requestAnimationFrame(loop)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [theme, speed, showPet])

  return (
    <canvas
      ref={canvasRef}
      className="block w-full h-full"
      style={{ opacity: Math.max(0.05, Math.min(1, opacity / 100)) }}
    />
  )
}
