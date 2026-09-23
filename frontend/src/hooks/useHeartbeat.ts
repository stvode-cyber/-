import { useEffect } from 'react'
import { api, unwrap } from '../lib/api'
import { useAuthStore, type LevelInfo } from '../stores/auth'

/**
 * 在线心跳 Hook
 *
 * - 每 3 分钟向后端发送一次心跳
 * - 页面重新可见时也发送一次
 * - 后端累计在线时间并计算等级
 * - 静默失败，不影响用户体验
 */

const HEARTBEAT_INTERVAL = 3 * 60 * 1000 // 3 分钟
const INITIAL_DELAY = 10 * 1000 // 登录后 10 秒首次心跳

interface HeartbeatResponse {
  totalOnlineMinutes: number
  levelInfo: LevelInfo
  addedMinutes: number
}

export function useHeartbeat() {
  const token = useAuthStore((s) => s.token)
  const userId = useAuthStore((s) => s.user?.id)
  const updateUser = useAuthStore((s) => s.updateUser)

  useEffect(() => {
    if (!token || !userId) return

    const sendHeartbeat = async () => {
      // 离线不发心跳（后端不可达，静默跳过）
      if (!navigator.onLine) return
      try {
        const res = await unwrap<HeartbeatResponse>(api.post('/auth/heartbeat', {}))
        updateUser({
          totalOnlineMinutes: res.totalOnlineMinutes,
          levelInfo: res.levelInfo,
        })
      } catch {
        // 静默失败
      }
    }

    // 首次延迟发送，避免与页面初始化请求冲突
    const initialTimer = setTimeout(sendHeartbeat, INITIAL_DELAY)

    // 定时心跳
    const intervalTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(intervalTimer)
    }
  }, [token, userId, updateUser])

  // 页面从后台切回前台时发送心跳
  useEffect(() => {
    if (!token || !userId) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // 延迟 2 秒发送，避免与页面恢复请求冲突
        setTimeout(async () => {
          if (!navigator.onLine) return
          try {
            const res = await unwrap<HeartbeatResponse>(api.post('/auth/heartbeat', {}))
            updateUser({
              totalOnlineMinutes: res.totalOnlineMinutes,
              levelInfo: res.levelInfo,
            })
          } catch {
            // ignore
          }
        }, 2000)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [token, userId, updateUser])
}
