import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'

/**
 * Web Push 订阅 Hook（CD-XX 倒计时功能）
 *
 * 能力：
 * 1. 注册独立的 sw-push.js（仅处理 push/通知事件，不影响 vite-plugin-pwa 的主 SW）
 * 2. 请求通知权限
 * 3. 订阅 Push API（需配置 VITE_VAPID_PUBLIC_KEY 环境变量）
 * 4. 将订阅 endpoint + keys 提交到后端 /countdowns/push/subscribe
 * 5. 提供 showLocalNotification（通过 SW 显示本地通知，不依赖推送服务器）
 *
 * 设计要点：
 * - VAPID 公钥缺失时，仍可使用本地通知能力（前端轮询 + SW 显示）
 * - 所有失败静默处理，仅通过返回的 status 字段告知调用方结果
 * - SSR 安全：所有浏览器 API 调用均在 useEffect/useCallback 中执行
 */

const SW_PUSH_URL = '/sw-push.js'
const SW_PUSH_SCOPE = '/sw-push/'
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/** base64url → Uint8Array（PushManager.subscribe 需要的 applicationServerKey 格式） */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/** 将 Uint8Array 转为 PushManager.subscribe 接受的 BufferSource */
function toBufferSource(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer
}

export interface PushSubscriptionInfo {
  endpoint: string
  keys: { auth: string; p256dh: string }
}

export type SubscribeStatus =
  | 'ok' // 成功
  | 'unsupported' // 浏览器不支持
  | 'permission_denied' // 用户拒绝权限
  | 'no_vapid' // 未配置 VAPID 公钥
  | 'sw_failed' // SW 注册失败
  | 'subscribe_failed' // PushManager.subscribe 失败
  | 'backend_failed' // 后端存储失败
  | 'already_subscribed' // 已订阅

export interface UseWebPushReturn {
  /** 浏览器是否支持 Service Worker + Push API + Notification */
  supported: boolean
  /** 当前通知权限 */
  permission: NotificationPermission | 'unsupported'
  /** 是否已订阅 */
  subscribed: boolean
  /** 当前订阅信息（已订阅时返回） */
  subscription: PushSubscriptionInfo | null
  /** 订阅 */
  subscribe: () => Promise<SubscribeStatus>
  /** 取消订阅 */
  unsubscribe: () => Promise<boolean>
  /** 通过 SW 显示本地通知（不依赖推送服务器） */
  showLocalNotification: (title: string, body?: string, url?: string) => Promise<boolean>
}

export function useWebPush(): UseWebPushReturn {
  const [supported] = useState<boolean>(
    typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window,
  )
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  )
  const [subscription, setSubscription] = useState<PushSubscriptionInfo | null>(null)

  const subscribed = subscription !== null

  /** 注册独立 SW（仅处理 push 事件，与主 SW 共存） */
  const registerPushSW = useCallback(async (): Promise<ServiceWorkerRegistration | null> => {
    if (!supported) return null
    try {
      const reg = await navigator.serviceWorker.register(SW_PUSH_URL, { scope: SW_PUSH_SCOPE })
      await navigator.serviceWorker.ready
      return reg
    } catch (err) {
      console.error('[useWebPush] SW 注册失败:', err)
      return null
    }
  }, [supported])

  /** 检查并同步当前订阅状态 */
  const checkSubscription = useCallback(async () => {
    if (!supported) return
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_PUSH_SCOPE)
      if (!reg) {
        setSubscription(null)
        return
      }
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        setSubscription({
          endpoint: sub.endpoint,
          keys: {
            auth: sub.toJSON().keys?.auth || '',
            p256dh: sub.toJSON().keys?.p256dh || '',
          },
        })
      } else {
        setSubscription(null)
      }
    } catch {
      setSubscription(null)
    }
  }, [supported])

  useEffect(() => {
    checkSubscription()
  }, [checkSubscription])

  /** 订阅 Push */
  const subscribe = useCallback(async (): Promise<SubscribeStatus> => {
    if (!supported) return 'unsupported'

    // 1. 请求权限
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') return 'permission_denied'
    } else if (Notification.permission !== 'granted') {
      return 'permission_denied'
    }

    // 2. 注册 SW
    const reg = await registerPushSW()
    if (!reg) return 'sw_failed'

    // 3. 检查是否已订阅
    const existing = await reg.pushManager.getSubscription()
    if (existing) {
      const subInfo: PushSubscriptionInfo = {
        endpoint: existing.endpoint,
        keys: {
          auth: existing.toJSON().keys?.auth || '',
          p256dh: existing.toJSON().keys?.p256dh || '',
        },
      }
      setSubscription(subInfo)
      // 同步到后端（确保后端有记录）
      try {
        await api.post('/countdowns/push/subscribe', subInfo)
      } catch {
        // 后端同步失败不影响订阅状态
      }
      return 'already_subscribed'
    }

    // 4. 订阅 Push API（需要 VAPID 公钥）
    if (!VAPID_PUBLIC_KEY) {
      // 无 VAPID 公钥：仍保留本地通知能力，跳过 Push 订阅
      return 'no_vapid'
    }

    let sub: PushSubscription
    try {
      const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toBufferSource(key),
      })
    } catch (err) {
      console.error('[useWebPush] PushManager.subscribe 失败:', err)
      return 'subscribe_failed'
    }

    const subInfo: PushSubscriptionInfo = {
      endpoint: sub.endpoint,
      keys: {
        auth: sub.toJSON().keys?.auth || '',
        p256dh: sub.toJSON().keys?.p256dh || '',
      },
    }
    setSubscription(subInfo)

    // 5. 提交到后端
    try {
      await api.post('/countdowns/push/subscribe', subInfo)
    } catch (err) {
      console.error('[useWebPush] 后端订阅存储失败:', err)
      return 'backend_failed'
    }

    return 'ok'
  }, [supported, registerPushSW])

  /** 取消订阅 */
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) return false
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_PUSH_SCOPE)
      if (!reg) return true
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await sub.unsubscribe()
        // 通知后端取消
        try {
          await api.delete('/countdowns/push/subscribe', { data: { endpoint: sub.endpoint } })
        } catch {
          // 后端失败不影响本地取消
        }
      }
      setSubscription(null)
      return true
    } catch (err) {
      console.error('[useWebPush] 取消订阅失败:', err)
      return false
    }
  }, [supported])

  /** 通过 SW 显示本地通知（不依赖推送服务器） */
  const showLocalNotification = useCallback(
    async (title: string, body?: string, url?: string): Promise<boolean> => {
      if (!supported) return false
      try {
        let reg: ServiceWorkerRegistration | undefined = await navigator.serviceWorker.getRegistration(SW_PUSH_SCOPE)
        if (!reg) {
          reg = (await registerPushSW()) || undefined
          if (!reg) return false
        }
        // 通过 postMessage 让 SW 显示通知
        reg.active?.postMessage({
          type: 'SHOW_NOTIFICATION',
          payload: { title, body, url: url || '/countdowns' },
        })
        return true
      } catch (err) {
        console.error('[useWebPush] 显示本地通知失败:', err)
        return false
      }
    },
    [supported, registerPushSW],
  )

  return {
    supported,
    permission,
    subscribed,
    subscription,
    subscribe,
    unsubscribe,
    showLocalNotification,
  }
}
