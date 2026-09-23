import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'

/**
 * 倒计时完成庆祝动画覆盖层
 *
 * 支持 4 种样式（与后端 celebrationConfig.style 对齐）：
 * - confetti: 全屏撒花动画（彩色 emoji 从顶部下落）
 * - fireworks: 全屏烟花动画（中心爆发 + 多点闪烁）
 * - milestone: 里程碑达成动画（大奖杯 + 脉动光环）
 * - minimal: 极简横幅通知（顶部滑入）
 *
 * 设计要点：
 * - 纯 CSS + emoji 实现，不引入额外依赖
 * - 自动 5 秒后关闭（minimal 为 3 秒）
 * - 点击任意位置或按 ESC 可提前关闭
 * - z-index 100，覆盖在所有内容之上
 */

interface Props {
  style: 'confetti' | 'fireworks' | 'milestone' | 'minimal'
  title: string
  message?: string
  /** 自动关闭时长（毫秒），默认 confetti/fireworks/milestone=5000, minimal=3000 */
  duration?: number
  onClose: () => void
}

/** 撒花 emoji 池 */
const CONFETTI_EMOJIS = ['🎉', '🎊', '✨', '🌟', '💫', '🎈', '🌈', '⭐']
/** 烟花 emoji 池 */
const FIREWORK_EMOJIS = ['✨', '🎆', '💥', '⚡', '🌟', '💫']

interface Particle {
  id: number
  emoji: string
  left: number
  delay: number
  duration: number
  size: number
}

/** 生成随机粒子（撒花用） */
function genConfettiParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    emoji: CONFETTI_EMOJIS[i % CONFETTI_EMOJIS.length],
    left: Math.random() * 100,
    delay: Math.random() * 1.5,
    duration: 2.5 + Math.random() * 2,
    size: 16 + Math.random() * 16,
  }))
}

/** 生成随机粒子（烟花用） */
function genFireworkParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    emoji: FIREWORK_EMOJIS[i % FIREWORK_EMOJIS.length],
    left: 20 + Math.random() * 60,
    delay: Math.random() * 1.2,
    duration: 1.5 + Math.random() * 1.5,
    size: 20 + Math.random() * 20,
  }))
}

export default function CelebrationOverlay({ style, title, message, duration, onClose }: Props) {
  // 默认关闭时长
  const autoCloseMs = duration ?? (style === 'minimal' ? 3000 : 5000)
  // 是否显示（用于淡出动画）
  const [visible, setVisible] = useState(true)

  // 粒子（仅 confetti / fireworks 用）
  const particles = useMemo(() => {
    if (style === 'confetti') return genConfettiParticles(30)
    if (style === 'fireworks') return genFireworkParticles(24)
    return []
  }, [style])

  // 自动关闭
  useEffect(() => {
    const timer = setTimeout(() => {
      handleClose()
    }, autoCloseMs)
    return () => clearTimeout(timer)
  }, [autoCloseMs])

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleClose = () => {
    setVisible(false)
    // 等淡出动画结束
    setTimeout(onClose, 200)
  }

  // ===== minimal: 顶部横幅 =====
  if (style === 'minimal') {
    return (
      <div
        className={`fixed top-0 left-0 right-0 z-[100] flex justify-center transition-all duration-300 ${
          visible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
        }`}
        onClick={handleClose}
      >
        <div className="mt-3 mx-3 max-w-[480px] w-full bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-2xl shadow-lg p-3 flex items-center gap-3">
          <span className="text-2xl">✨</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">🎉 {title}</div>
            <div className="text-xs opacity-90 truncate">{message || '恭喜达成！'}</div>
          </div>
          <button onClick={handleClose} className="p-1 hover:bg-white/20 rounded">
            <X size={16} />
          </button>
        </div>
      </div>
    )
  }

  // ===== confetti / fireworks / milestone: 全屏覆盖 =====
  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleClose}
    >
      {/* 粒子层 */}
      {style === 'confetti' && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {particles.map((p) => (
            <span
              key={p.id}
              className="absolute -top-10 animate-confetti-fall"
              style={{
                left: `${p.left}%`,
                fontSize: `${p.size}px`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
              }}
            >
              {p.emoji}
            </span>
          ))}
        </div>
      )}

      {style === 'fireworks' && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {particles.map((p) => (
            <span
              key={p.id}
              className="absolute top-1/2 left-1/2 animate-firework-burst"
              style={{
                left: `${p.left}%`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                fontSize: `${p.size}px`,
              }}
            >
              {p.emoji}
            </span>
          ))}
        </div>
      )}

      {/* 中央卡片 */}
      <div
        className="relative text-center px-8 max-w-[90vw] animate-celebration-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {style === 'milestone' ? (
          <div className="relative inline-block">
            {/* 脉动光环 */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-32 h-32 rounded-full bg-amber-400/30 animate-ping" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-24 h-24 rounded-full bg-amber-400/40 animate-pulse" />
            </div>
            <div className="relative text-7xl animate-bounce">🏆</div>
          </div>
        ) : (
          <div className="text-6xl mb-3 animate-celebration-pop">🎉</div>
        )}

        <div className="text-white text-2xl font-bold mt-4 mb-2">
          🎊 恭喜达成！
        </div>
        <div className="text-white/90 text-lg font-medium mb-1">
          {title}
        </div>
        {message && (
          <div className="text-white/80 text-sm mt-3 max-w-sm mx-auto">
            {message}
          </div>
        )}
        <button
          onClick={handleClose}
          className="mt-6 px-6 py-2 bg-white text-primary-600 rounded-full text-sm font-medium hover:bg-primary-50 transition-colors"
        >
          知道了
        </button>
      </div>

      {/* 关闭按钮（右上角） */}
      <button
        onClick={handleClose}
        className="absolute top-4 right-4 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full"
        aria-label="关闭"
      >
        <X size={24} />
      </button>
    </div>
  )
}
