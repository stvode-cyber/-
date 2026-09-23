import { useEffect, useState } from 'react'

interface TimeLeft {
  days: number
  hours: number
  minutes: number
  seconds: number
  isOverdue: boolean
}

/** 计算剩余时间 */
function calcTimeLeft(targetDate: string): TimeLeft {
  const target = new Date(targetDate).getTime()
  const diff = target - Date.now()

  if (diff <= 0) {
    const overdueDays = Math.abs(Math.floor(diff / 86400000))
    return { days: overdueDays, hours: 0, minutes: 0, seconds: 0, isOverdue: true }
  }

  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    isOverdue: false,
  }
}

/**
 * 实时倒计时组件
 *
 * 显示天 / 时 : 分 : 秒，每秒更新一次。
 * - 超期时显示 "超期 X天"
 * - 不到 1 天时只显示 时:分:秒
 * - 超过 1 天时显示 "X天 XX:XX:XX"
 */
export default function LiveCountdown({
  targetDate,
  className = '',
}: {
  targetDate: string
  className?: string
}) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => calcTimeLeft(targetDate))

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calcTimeLeft(targetDate))
    }, 1000)
    return () => clearInterval(timer)
  }, [targetDate])

  if (timeLeft.isOverdue) {
    return (
      <span className={`tabular-nums ${className}`}>
        ‼️ 超期 {timeLeft.days}天
      </span>
    )
  }

  const hh = String(timeLeft.hours).padStart(2, '0')
  const mm = String(timeLeft.minutes).padStart(2, '0')
  const ss = String(timeLeft.seconds).padStart(2, '0')

  if (timeLeft.days > 0) {
    return (
      <span className={`tabular-nums ${className}`}>
        {timeLeft.days}天 {hh}:{mm}:{ss}
      </span>
    )
  }

  return (
    <span className={`tabular-nums ${className}`}>
      {hh}:{mm}:{ss}
    </span>
  )
}
